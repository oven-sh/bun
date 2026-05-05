use crate::css_parser as css;
pub use css::Error;
use bumpalo::Bump;
use css::{PrintErr, Printer, Result};

use crate::css_properties::align::AlignHandler;
use crate::css_properties::background::BackgroundHandler;
use crate::css_properties::border::BorderHandler;
use crate::css_properties::box_shadow::BoxShadowHandler;
use crate::css_properties::flex::FlexHandler;
use crate::css_properties::font::FontHandler;
use crate::css_properties::margin_padding::{InsetHandler, MarginHandler, PaddingHandler, ScrollMarginHandler};
use crate::css_properties::prefix_handler::FallbackHandler;
use crate::css_properties::size::SizeHandler;
use crate::css_properties::transform::TransformHandler;
use crate::css_properties::transition::TransitionHandler;
use crate::css_properties::ui::ColorSchemeHandler;
// const GridHandler = css.css_properties.g

pub type DeclarationList<'bump> = bumpalo::collections::Vec<'bump, css::Property>;

/// A CSS declaration block.
///
/// Properties are separated into a list of `!important` declararations,
/// and a list of normal declarations. This reduces memory usage compared
/// with storing a boolean along with each property.
///
/// TODO: multiarraylist will probably be faster here, as it makes one allocation
/// instead of two.
pub struct DeclarationBlock<'bump> {
    /// A list of `!important` declarations in the block.
    pub important_declarations: DeclarationList<'bump>,
    /// A list of normal declarations in the block.
    pub declarations: DeclarationList<'bump>,
}

pub struct DebugFmt<'a, 'bump>(&'a DeclarationBlock<'bump>);

impl<'a, 'bump> core::fmt::Display for DebugFmt<'a, 'bump> {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let mut arraylist: Vec<u8> = Vec::new();
        let mut symbols = bun_logger::symbol::Map::default();
        // TODO(port): Printer::new signature — Zig passes allocator + Managed(u8) + writer + options + null + null + &symbols
        let mut printer = css::Printer::new(
            Vec::<u8>::new(),
            &mut arraylist,
            css::PrinterOptions::default(),
            None,
            None,
            &mut symbols,
        );
        match self.0.to_css(&mut printer) {
            Ok(()) => {}
            Err(e) => {
                return write!(
                    writer,
                    "<error writing declaration block: {}>\n",
                    <&'static str>::from(e)
                );
            }
        }
        write!(writer, "{}", bstr::BStr::new(&arraylist))
    }
}

impl<'bump> DeclarationBlock<'bump> {
    pub fn debug(&self) -> DebugFmt<'_, 'bump> {
        DebugFmt(self)
    }

    pub fn is_empty(&self) -> bool {
        self.declarations.is_empty() && self.important_declarations.is_empty()
    }

    pub fn parse(input: &mut css::Parser<'bump>, options: &css::ParserOptions) -> Result<DeclarationBlock<'bump>> {
        let bump = input.allocator();
        let mut important_declarations = DeclarationList::new_in(bump);
        let mut declarations = DeclarationList::new_in(bump);
        let mut decl_parser = PropertyDeclarationParser {
            important_declarations: &mut important_declarations,
            declarations: &mut declarations,
            options,
        };
        let mut parser = css::RuleBodyParser::<PropertyDeclarationParser<'_, 'bump>>::new(input, &mut decl_parser);

        while let Some(res) = parser.next() {
            if let Err(e) = res {
                if options.error_recovery {
                    options.warn(e);
                    continue;
                }
                // errdefer doesn't fire on `return .{ .err = ... }` — Result(T) is a tagged
                // union, not an error union. Free any declarations accumulated so far.
                // PORT NOTE: in Rust, `declarations`/`important_declarations` are Vec<Property>
                // and drop on early return; deepDeinit is implicit via Drop.
                return Err(e);
            }
        }

        Ok(DeclarationBlock {
            important_declarations,
            declarations,
        })
    }

    pub fn len(&self) -> usize {
        self.declarations.len() + self.important_declarations.len()
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let length = self.len();
        let mut i: usize = 0;

        // PORT NOTE: Zig used `inline for` over field names with @field; unrolled to 2 arms.
        for decl in self.declarations.iter() {
            decl.to_css(dest, false)?;
            if i != length - 1 {
                dest.write_char(';')?;
                dest.whitespace()?;
            }
            i += 1;
        }
        for decl in self.important_declarations.iter() {
            decl.to_css(dest, true)?;
            if i != length - 1 {
                dest.write_char(';')?;
                dest.whitespace()?;
            }
            i += 1;
        }

        Ok(())
    }

    /// Writes the declarations to a CSS block, including starting and ending braces.
    pub fn to_css_block(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.whitespace()?;
        dest.write_char('{')?;
        dest.indent();

        let mut i: usize = 0;
        let length = self.len();

        // PORT NOTE: Zig used `inline for` over field names with @field; unrolled to 2 arms.
        for decl in self.declarations.iter() {
            dest.newline()?;
            decl.to_css(dest, false)?;
            if i != length - 1 || !dest.minify {
                dest.write_char(';')?;
            }
            i += 1;
        }
        for decl in self.important_declarations.iter() {
            dest.newline()?;
            decl.to_css(dest, true)?;
            if i != length - 1 || !dest.minify {
                dest.write_char(';')?;
            }
            i += 1;
        }

        dest.dedent();
        dest.newline()?;
        dest.write_char('}')
    }

    pub fn minify(
        &mut self,
        handler: &mut DeclarationHandler<'bump>,
        important_handler: &mut DeclarationHandler<'bump>,
        context: &mut css::PropertyHandlerContext<'bump>,
    ) {
        let bump: &'bump Bump = context.allocator;
        // PORT NOTE: Zig used a local generic `handle` fn with comptime field name + bool.
        // Unrolled to two loops; reshaped for borrowck (iterate via index, prop owned by Vec).
        #[inline]
        fn handle<'bump>(
            decls: &mut DeclarationList<'bump>,
            ctx: &mut css::PropertyHandlerContext<'bump>,
            hndlr: &mut DeclarationHandler<'bump>,
            important: bool,
        ) {
            for prop in decls.iter_mut() {
                ctx.is_important = important;

                let handled = hndlr.handle_property(prop, ctx);

                if !handled {
                    hndlr.decls.push(core::mem::replace(
                        prop,
                        // replacing with a property which does not require allocation
                        // to "delete"
                        css::Property::All(css::CssWideKeyword::RevertLayer),
                    ));
                }
            }
        }

        handle(&mut self.important_declarations, context, important_handler, true);
        handle(&mut self.declarations, context, handler, false);

        handler.finalize(context);
        important_handler.finalize(context);
        // PORT NOTE: Zig swapped old lists out, deferred their deinit, then assigned new ones.
        // In Rust, dropping the old Vecs is implicit when overwritten.
        self.important_declarations =
            core::mem::replace(&mut important_handler.decls, DeclarationList::new_in(bump));
        self.declarations = core::mem::replace(&mut handler.decls, DeclarationList::new_in(bump));
    }

    pub fn hash_property_ids(&self, hasher: &mut bun_wyhash::Wyhash) {
        for decl in self.declarations.iter() {
            decl.property_id().hash(hasher);
        }

        for decl in self.important_declarations.iter() {
            decl.property_id().hash(hasher);
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        // TODO(port): css.implementEql is comptime field reflection — replace with #[derive(PartialEq)]
        css::implement_eql(self, other)
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> Self {
        // TODO(port): css.implementDeepClone is comptime field reflection — replace with Clone impl
        css::implement_deep_clone(self, bump)
    }
}

pub struct PropertyDeclarationParser<'a, 'bump> {
    pub important_declarations: &'a mut DeclarationList<'bump>,
    pub declarations: &'a mut DeclarationList<'bump>,
    pub options: &'a css::ParserOptions,
}

// PORT NOTE: Zig's nested AtRuleParser/QualifiedRuleParser/DeclarationParser/RuleBodyItemParser
// are structural duck-typing namespaces consumed by RuleBodyParser(T) at comptime.
// In Rust these are trait impls.

impl<'a, 'bump> css::AtRuleParser for PropertyDeclarationParser<'a, 'bump> {
    type Prelude = ();
    type AtRule = ();

    fn parse_prelude(&mut self, name: &[u8], input: &mut css::Parser) -> Result<Self::Prelude> {
        Err(input.new_error(css::BasicParseErrorKind::AtRuleInvalid(name)))
    }

    fn parse_block(
        &mut self,
        _: Self::Prelude,
        _: &css::ParserState,
        input: &mut css::Parser,
    ) -> Result<Self::AtRule> {
        Err(input.new_error(css::BasicParseErrorKind::AtRuleBodyInvalid))
    }

    fn rule_without_block(
        &mut self,
        _: Self::Prelude,
        _: &css::ParserState,
    ) -> css::Maybe<Self::AtRule, ()> {
        Err(())
    }
}

impl<'a, 'bump> css::QualifiedRuleParser for PropertyDeclarationParser<'a, 'bump> {
    type Prelude = ();
    type QualifiedRule = ();

    fn parse_prelude(&mut self, input: &mut css::Parser) -> Result<Self::Prelude> {
        Err(input.new_error(css::BasicParseErrorKind::QualifiedRuleInvalid))
    }

    fn parse_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &css::ParserState,
        input: &mut css::Parser,
    ) -> Result<Self::QualifiedRule> {
        Err(input.new_error(css::BasicParseErrorKind::QualifiedRuleInvalid))
    }
}

impl<'a, 'bump> css::DeclarationParser for PropertyDeclarationParser<'a, 'bump> {
    type Declaration = ();

    fn parse_value(&mut self, name: &[u8], input: &mut css::Parser) -> Result<Self::Declaration> {
        parse_declaration(
            name,
            input,
            self.declarations,
            self.important_declarations,
            self.options,
        )
    }
}

impl<'a, 'bump> css::RuleBodyItemParser for PropertyDeclarationParser<'a, 'bump> {
    fn parse_qualified(&self) -> bool {
        false
    }

    fn parse_declarations(&self) -> bool {
        true
    }
}

pub fn parse_declaration<'bump>(
    name: &[u8],
    input: &mut css::Parser<'bump>,
    declarations: &mut DeclarationList<'bump>,
    important_declarations: &mut DeclarationList<'bump>,
    options: &css::ParserOptions,
) -> Result<()> {
    parse_declaration_impl::<css::NoComposesCtx>(
        name,
        input,
        declarations,
        important_declarations,
        options,
        None,
    )
}

// TODO(port): `composes_ctx: anytype` — Zig branches on `@TypeOf(composes_ctx) != void`.
// Modeled as Option<&mut C> where C provides composes_state + record_composes; define a
// ComposesCtx trait in css_parser (or wherever the real ctx type lives) in Phase B.
pub fn parse_declaration_impl<'bump, C>(
    name: &[u8],
    input: &mut css::Parser<'bump>,
    declarations: &mut DeclarationList<'bump>,
    important_declarations: &mut DeclarationList<'bump>,
    options: &css::ParserOptions,
    composes_ctx: Option<&mut C>,
) -> Result<()>
where
    C: css::ComposesCtx,
{
    let property_id = css::PropertyId::from_str(name);
    let mut delimiters = css::Delimiters { bang: true, ..Default::default() };
    if !matches!(property_id, css::PropertyId::Custom(css::CustomPropertyId::Custom(_))) {
        // TODO(port): Zig condition is `property_id != .custom or property_id.custom != .custom` —
        // i.e. NOT (tag == .custom AND payload tag == .custom). Verify enum shape in Phase B.
        delimiters.curly_bracket = true;
    }
    struct Closure<'a> {
        property_id: css::PropertyId,
        options: &'a css::ParserOptions,
    }
    let mut closure = Closure { property_id, options };
    let source_location = input.current_source_location();
    let mut property = match input.parse_until_before(
        delimiters,
        &mut closure,
        |this: &mut Closure<'_>, input2: &mut css::Parser| -> Result<css::Property> {
            css::Property::parse(this.property_id, input2, this.options)
        },
    ) {
        Err(e) => return Err(e),
        Ok(v) => v,
    };
    let important = input
        .try_parse(|i: &mut css::Parser| -> Result<()> {
            if let Err(e) = i.expect_delim('!') {
                return Err(e);
            }
            i.expect_ident_matching(b"important")
        })
        .is_ok();
    if let Err(e) = input.expect_exhausted() {
        return Err(e);
    }

    if let Some(composes_ctx) = composes_ctx {
        if input.flags.css_modules {
            if let css::Property::Composes(composes) = &mut property {
                match composes_ctx.composes_state() {
                    css::ComposesState::DisallowEntirely => {}
                    css::ComposesState::Allow => {
                        composes_ctx.record_composes(composes);
                    }
                    css::ComposesState::DisallowNested(info) => {
                        options.warn_fmt_with_notes(
                            "\"composes\" is not allowed inside nested selectors",
                            format_args!(""),
                            info.line,
                            info.column,
                            &[],
                        );
                    }
                    css::ComposesState::DisallowNotSingleClass(info) => {
                        let bump = input.allocator();
                        // TODO(port): warn_fmt_with_notes ownership — Zig dupes both text and the
                        // notes slice into options.allocator; verify whether the Rust signature
                        // borrows or owns.
                        options.warn_fmt_with_notes(
                            "\"composes\" only works inside single class selectors",
                            format_args!(""),
                            source_location.line,
                            source_location.column,
                            bump.alloc_slice_copy(&[bun_logger::Data {
                                text: bump.alloc_slice_copy(
                                    b"The parent selector is not a single class selector because of the syntax here:",
                                ),
                                location: info.to_logger_location(options.filename),
                                ..Default::default()
                            }]),
                        );
                    }
                }
            }
        }
    }
    if important {
        important_declarations.push(property);
    } else {
        declarations.push(property);
    }

    Ok(())
}

pub struct DeclarationHandler<'bump> {
    pub background: BackgroundHandler,
    pub border: BorderHandler,
    pub flex: FlexHandler,
    pub align: AlignHandler,
    pub size: SizeHandler,
    pub margin: MarginHandler,
    pub padding: PaddingHandler,
    pub scroll_margin: ScrollMarginHandler,
    pub transition: TransitionHandler,
    pub font: FontHandler,
    pub inset: InsetHandler,
    pub transform: TransformHandler,
    pub box_shadow: BoxShadowHandler,
    pub color_scheme: ColorSchemeHandler,
    pub fallback: FallbackHandler,
    pub direction: Option<crate::css_properties::text::Direction>,
    pub decls: DeclarationList<'bump>,
}

impl<'bump> DeclarationHandler<'bump> {
    pub fn finalize(&mut self, context: &mut css::PropertyHandlerContext<'bump>) {
        if let Some(direction) = self.direction.take() {
            self.decls.push(css::Property::Direction(direction));
        }
        // if (this.unicode_bidi) |unicode_bidi| {
        //     this.unicode_bidi = null;
        //     this.decls.append(context.allocator, css.Property{ .unicode_bidi = unicode_bidi }) catch |err| bun.handleOom(err);
        // }

        self.background.finalize(&mut self.decls, context);
        self.border.finalize(&mut self.decls, context);
        self.flex.finalize(&mut self.decls, context);
        self.align.finalize(&mut self.decls, context);
        self.size.finalize(&mut self.decls, context);
        self.margin.finalize(&mut self.decls, context);
        self.padding.finalize(&mut self.decls, context);
        self.scroll_margin.finalize(&mut self.decls, context);
        self.transition.finalize(&mut self.decls, context);
        self.font.finalize(&mut self.decls, context);
        self.inset.finalize(&mut self.decls, context);
        self.transform.finalize(&mut self.decls, context);
        self.box_shadow.finalize(&mut self.decls, context);
        self.color_scheme.finalize(&mut self.decls, context);
        self.fallback.finalize(&mut self.decls, context);
    }

    pub fn handle_property(
        &mut self,
        property: &css::Property,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        // return this.background.handleProperty(property, &this.decls, context);
        self.background.handle_property(property, &mut self.decls, context)
            || self.border.handle_property(property, &mut self.decls, context)
            || self.flex.handle_property(property, &mut self.decls, context)
            || self.align.handle_property(property, &mut self.decls, context)
            || self.size.handle_property(property, &mut self.decls, context)
            || self.margin.handle_property(property, &mut self.decls, context)
            || self.padding.handle_property(property, &mut self.decls, context)
            || self.scroll_margin.handle_property(property, &mut self.decls, context)
            || self.transition.handle_property(property, &mut self.decls, context)
            || self.font.handle_property(property, &mut self.decls, context)
            || self.inset.handle_property(property, &mut self.decls, context)
            || self.transform.handle_property(property, &mut self.decls, context)
            || self.box_shadow.handle_property(property, &mut self.decls, context)
            || self.color_scheme.handle_property(property, &mut self.decls, context)
            || self.fallback.handle_property(property, &mut self.decls, context)
    }
}

impl<'bump> DeclarationHandler<'bump> {
    pub fn new(bump: &'bump Bump) -> Self {
        Self {
            background: Default::default(),
            border: Default::default(),
            flex: Default::default(),
            align: Default::default(),
            size: Default::default(),
            margin: Default::default(),
            padding: Default::default(),
            scroll_margin: Default::default(),
            transition: Default::default(),
            font: Default::default(),
            inset: Default::default(),
            transform: Default::default(),
            box_shadow: Default::default(),
            color_scheme: Default::default(),
            fallback: Default::default(),
            direction: None,
            decls: DeclarationList::new_in(bump),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/declaration.zig (461 lines)
//   confidence: medium
//   todos:      6
//   notes:      Parser protocol namespaces → trait impls; composes_ctx anytype → Option<&mut C: ComposesCtx>; DeclarationList/Block/Handler are arena-backed (bumpalo Vec<'bump>) — Default replaced with new(bump)
// ──────────────────────────────────────────────────────────────────────────
