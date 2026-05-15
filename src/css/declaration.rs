use crate::css_parser as css;
use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVecExt as _;
pub use css::Error;
use css::{CssResult as Result, PrintErr, Printer};

// PORT NOTE: every leaf property module is currently a `handler_stub!` ZST in
// properties/mod.rs (no-op `handle_property`/`finalize`). The real handler
// bodies un-gate per-module as the values/ calc lattice lands; this file
// composes over whichever surface is live.
use crate::css_properties::align::AlignHandler;
use crate::css_properties::background::BackgroundHandler;
use crate::css_properties::border::BorderHandler;
use crate::css_properties::box_shadow::BoxShadowHandler;
use crate::css_properties::custom::CustomPropertyName;
use crate::css_properties::flex::FlexHandler;
use crate::css_properties::font::FontHandler;
use crate::css_properties::margin_padding::{
    InsetHandler, MarginHandler, PaddingHandler, ScrollMarginHandler,
};
use crate::css_properties::prefix_handler::FallbackHandler;
use crate::css_properties::size::SizeHandler;
use crate::css_properties::text::Direction;
use crate::css_properties::transform::TransformHandler;
use crate::css_properties::transition::TransitionHandler;
use crate::css_properties::ui::ColorSchemeHandler;
// const GridHandler = css.css_properties.g

pub type DeclarationList<'bump> = bun_alloc::ArenaVec<'bump, css::Property>;

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

// SAFETY: `bun_alloc::ArenaVec<'bump, T>` is `!Send`/`!Sync` because it
// holds a raw `NonNull<T>` and `&'bump Bump` (Bump is `!Sync`). After parsing,
// the CSS AST is treated as an immutable, owned tree shared read-only across
// the bundler thread pool (Zig passes the same arena-backed AST between
// threads freely). The `&Bump` is never used to allocate post-parse, and the
// element storage is uniquely owned exactly like `Vec<T>`, so thread-safety
// follows `Property`'s auto-traits.
unsafe impl<'bump> Send for DeclarationBlock<'bump> {}
unsafe impl<'bump> Sync for DeclarationBlock<'bump> {}

pub struct DebugFmt<'a, 'bump>(&'a DeclarationBlock<'bump>);

// blocked_on: Printer::new signature (Zig passes arena + Managed(u8) +
// writer + options + null + null + &symbols; the Rust ctor shape is unsettled).

impl<'a, 'bump> core::fmt::Display for DebugFmt<'a, 'bump> {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // PORT NOTE: debug formatter — uses a throwaway local arena for the
        // printer's scratch buffers (Zig threaded the parser arena).
        let bump = Bump::new();
        let mut arraylist: Vec<u8> = Vec::new();
        let symbols = bun_ast::symbol::Map::init_list(Default::default());
        let mut printer = css::Printer::new(
            &bump,
            bun_alloc::ArenaVec::<u8>::new_in(&bump),
            &mut arraylist,
            css::PrinterOptions::default(),
            None,
            None,
            &symbols,
        );
        let res = self.0.to_css(&mut printer);
        // Release the printer's `&mut arraylist` borrow before reading it back.
        drop(printer);
        match res {
            Ok(()) => {}
            Err(e) => {
                return write!(writer, "<error writing declaration block: {}>\n", e.name());
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

    pub fn len(&self) -> usize {
        self.declarations.len() + self.important_declarations.len()
    }

    pub fn new_in(bump: &'bump Bump) -> Self {
        Self {
            important_declarations: DeclarationList::new_in(bump),
            declarations: DeclarationList::new_in(bump),
        }
    }

    pub fn minify(
        &mut self,
        handler: &mut DeclarationHandler<'bump>,
        important_handler: &mut DeclarationHandler<'bump>,
        context: &mut css::PropertyHandlerContext,
    ) {
        // PORT NOTE: Zig threaded `context.arena` through every append; the
        // Rust `PropertyHandlerContext` dropped that field, so we recover the
        // arena from the handler's own bump-backed accumulator instead.
        let bump: &'bump Bump = handler.decls.bump();

        // PORT NOTE: Zig used a local generic `handle` fn with comptime field
        // name + bool. Unrolled to two calls over a shared inner fn; reshaped
        // for borrowck (iterate via &mut, move prop out and overwrite slot).
        #[inline]
        fn handle<'bump>(
            decls: &mut DeclarationList<'bump>,
            ctx: &mut css::PropertyHandlerContext,
            hndlr: &mut DeclarationHandler<'bump>,
            important: bool,
        ) {
            for prop in decls.iter_mut() {
                ctx.is_important = important;

                let handled = hndlr.handle_property(prop, ctx);

                if !handled {
                    // Zig: `hndlr.decls.append(prop.*); prop.* = .{ .all = .@"revert-layer" }`
                    // — move the value out and overwrite the slot with a
                    // non-allocating placeholder so the source list's drop is a
                    // no-op.
                    hndlr
                        .decls
                        .push(core::mem::replace(prop, placeholder_property()));
                }
            }
        }

        handle(
            &mut self.important_declarations,
            context,
            important_handler,
            true,
        );
        handle(&mut self.declarations, context, handler, false);

        handler.finalize(context);
        important_handler.finalize(context);
        // PORT NOTE: Zig swapped old lists out, deferred their deinit, then
        // assigned the handler accumulators. In Rust the old bumpalo Vecs drop
        // implicitly on overwrite (arena reclaims on reset).
        self.important_declarations =
            core::mem::replace(&mut important_handler.decls, DeclarationList::new_in(bump));
        self.declarations = core::mem::replace(&mut handler.decls, DeclarationList::new_in(bump));
    }
}

/// Non-allocating placeholder used by `minify()` to overwrite moved-out slots.
/// Zig: `css.Property{ .all = .@"revert-layer" }`.
#[inline(always)]
fn placeholder_property() -> css::Property {
    css::Property::All(crate::css_properties::CSSWideKeyword::RevertLayer)
}

// ─── to_css ───────────────────────────────────────────────────────────────

impl<'bump> DeclarationBlock<'bump> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let length = self.len();
        let mut i: usize = 0;

        // PORT NOTE: Zig used `inline for` over field names with @field; unrolled to 2 arms.
        for decl in self.declarations.iter() {
            decl.to_css(dest, false)?;
            if i != length - 1 {
                dest.write_char(b';')?;
                dest.whitespace()?;
            }
            i += 1;
        }
        for decl in self.important_declarations.iter() {
            decl.to_css(dest, true)?;
            if i != length - 1 {
                dest.write_char(b';')?;
                dest.whitespace()?;
            }
            i += 1;
        }

        Ok(())
    }

    /// Writes the declarations to a CSS block, including starting and ending braces.
    pub fn to_css_block(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();

        let mut i: usize = 0;
        let length = self.len();

        // PORT NOTE: Zig used `inline for` over field names with @field; unrolled to 2 arms.
        for decl in self.declarations.iter() {
            dest.newline()?;
            decl.to_css(dest, false)?;
            if i != length - 1 || !dest.minify {
                dest.write_char(b';')?;
            }
            i += 1;
        }
        for decl in self.important_declarations.iter() {
            dest.newline()?;
            decl.to_css(dest, true)?;
            if i != length - 1 || !dest.minify {
                dest.write_char(b';')?;
            }
            i += 1;
        }

        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')
    }
}

// ─── parse ────────────────────────────────────────────────────────────────
//
// PORT NOTE: every consumer (`StyleRule`, `Keyframe`, `PageRule`,
// `StyleAttribute`, `NestedRuleParser`) stores `DeclarationBlock<'static>` —
// the crate-wide `'bump`-erasure placeholder until `'bump` threads through
// `CssRule`. `parse()` therefore lives on the `'static` instantiation and
// erases the parser arena's lifetime at the boundary; this collapses together
// with the lifetime cast in `rules/style.rs::minify` when `CssRule<'bump, R>`
// lands.

impl DeclarationBlock<'static> {
    pub fn parse(
        input: &mut css::Parser,
        options: &css::ParserOptions,
    ) -> Result<DeclarationBlock<'static>> {
        // SAFETY: `Tokenizer<'a>` owns `arena: &'a Bump`; the arena outlives
        // every `DeclarationBlock` produced from this parser. `'static` here is
        // the crate-wide erasure (see note above), not a real static borrow.
        let bump: &'static Bump = unsafe { bun_ptr::detach_lifetime_ref(input.arena()) };
        let mut important_declarations = DeclarationList::new_in(bump);
        let mut declarations = DeclarationList::new_in(bump);
        let mut decl_parser = PropertyDeclarationParser {
            important_declarations: &mut important_declarations,
            declarations: &mut declarations,
            options,
        };
        let mut parser = css::RuleBodyParser::new(input, &mut decl_parser);

        while let Some(res) = parser.next() {
            if let Err(e) = res {
                if options.error_recovery {
                    options.warn(e);
                    continue;
                }
                // errdefer doesn't fire on `return .{ .err = ... }` — Result(T) is a tagged
                // union, not an error union. Free any declarations accumulated so far.
                // PORT NOTE: in Rust, `declarations`/`important_declarations` are bumpalo
                // Vec<Property> and drop on early return; deepDeinit is implicit via Drop.
                return Err(e);
            }
        }

        Ok(DeclarationBlock {
            important_declarations,
            declarations,
        })
    }
}

// ─── hash / eql / deep_clone (gated) ──────────────────────────────────────
// blocked_on: properties_generated — `Property` lacks `DeepClone`/`CssEql`
// derives and `PropertyId` lacks a `hash(&mut Wyhash)` method. The bodies
// below are the real manual unrolls of Zig's comptime-reflection helpers
// (`implementEql`/`implementDeepClone`); they un-gate the moment the
// per-variant trait impls land in `properties_generated.rs`.

impl<'bump> DeclarationBlock<'bump> {
    pub fn hash_property_ids(&self, hasher: &mut bun_wyhash::Wyhash) {
        use std::hash::Hash;
        for decl in self.declarations.iter() {
            decl.property_id().hash(hasher);
        }
        for decl in self.important_declarations.iter() {
            decl.property_id().hash(hasher);
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        use crate::generics::CssEql;
        if self.declarations.len() != other.declarations.len()
            || self.important_declarations.len() != other.important_declarations.len()
        {
            return false;
        }
        self.declarations
            .iter()
            .zip(other.declarations.iter())
            .all(|(a, b)| a.eql(b))
            && self
                .important_declarations
                .iter()
                .zip(other.important_declarations.iter())
                .all(|(a, b)| a.eql(b))
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> Self {
        // PORT NOTE: `css.implementDeepClone` is comptime field reflection;
        // for a struct it deep-clones each field. `Property::deep_clone` is
        // the inherent per-variant impl in properties_generated.rs.
        Self {
            important_declarations: bun_alloc::vec_from_iter_in(
                self.important_declarations
                    .iter()
                    .map(|p| p.deep_clone(bump)),
                bump,
            ),
            declarations: bun_alloc::vec_from_iter_in(
                self.declarations.iter().map(|p| p.deep_clone(bump)),
                bump,
            ),
        }
    }
}

// ─── PropertyDeclarationParser ────────────────────────────────────────────

pub struct PropertyDeclarationParser<'a, 'bump> {
    pub important_declarations: &'a mut DeclarationList<'bump>,
    pub declarations: &'a mut DeclarationList<'bump>,
    pub options: &'a css::ParserOptions<'a>,
}

// PORT NOTE: Zig's nested AtRuleParser/QualifiedRuleParser/DeclarationParser/
// RuleBodyItemParser are structural duck-typing namespaces consumed by
// RuleBodyParser(T) at comptime. In Rust these are trait impls.

impl<'a, 'bump> css::AtRuleParser for PropertyDeclarationParser<'a, 'bump> {
    type Prelude = ();
    type AtRule = ();

    fn parse_prelude(
        _this: &mut Self,
        name: &[u8],
        input: &mut css::Parser,
    ) -> Result<Self::Prelude> {
        Err(input.new_error(css::BasicParseErrorKind::at_rule_invalid(name)))
    }

    fn parse_block(
        _this: &mut Self,
        _: Self::Prelude,
        _: &css::ParserState,
        input: &mut css::Parser,
    ) -> Result<Self::AtRule> {
        Err(input.new_error(css::BasicParseErrorKind::at_rule_body_invalid))
    }

    fn rule_without_block(
        _this: &mut Self,
        _: Self::Prelude,
        _: &css::ParserState,
    ) -> css::Maybe<Self::AtRule, ()> {
        Err(())
    }
}

impl<'a, 'bump> css::QualifiedRuleParser for PropertyDeclarationParser<'a, 'bump> {
    type Prelude = ();
    type QualifiedRule = ();

    fn parse_prelude(_this: &mut Self, input: &mut css::Parser) -> Result<Self::Prelude> {
        Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid))
    }

    fn parse_block(
        _this: &mut Self,
        _prelude: Self::Prelude,
        _start: &css::ParserState,
        input: &mut css::Parser,
    ) -> Result<Self::QualifiedRule> {
        Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid))
    }
}

impl<'a, 'bump> css::DeclarationParser for PropertyDeclarationParser<'a, 'bump> {
    type Declaration = ();

    fn parse_value(
        this: &mut Self,
        name: &[u8],
        input: &mut css::Parser,
    ) -> Result<Self::Declaration> {
        parse_declaration(
            name,
            input,
            this.declarations,
            this.important_declarations,
            this.options,
        )
    }
}

impl<'a, 'bump> css::RuleBodyItemParser for PropertyDeclarationParser<'a, 'bump> {
    fn parse_qualified(_this: &Self) -> bool {
        false
    }

    fn parse_declarations(_this: &Self) -> bool {
        true
    }
}

// ─── parse_declaration ────────────────────────────────────────────────────

pub fn parse_declaration<'bump>(
    name: &[u8],
    input: &mut css::Parser,
    declarations: &mut DeclarationList<'bump>,
    important_declarations: &mut DeclarationList<'bump>,
    options: &css::ParserOptions,
) -> Result<()> {
    parse_declaration_impl(
        name,
        input,
        declarations,
        important_declarations,
        options,
        &mut css::NoComposesCtx,
    )
}

// PORT NOTE: Zig `composes_ctx: anytype` — branches on
// `comptime @TypeOf(composes_ctx) != void`. The Rust shape is a `ComposesCtx`
// trait (defined in `css_parser.rs`); `NoComposesCtx` returns
// `DisallowEntirely` so the `void` fast-path collapses into the match's
// no-op arm.
pub fn parse_declaration_impl<'bump, C>(
    name: &[u8],
    input: &mut css::Parser,
    declarations: &mut DeclarationList<'bump>,
    important_declarations: &mut DeclarationList<'bump>,
    options: &css::ParserOptions,
    composes_ctx: &mut C,
) -> Result<()>
where
    C: css::ComposesCtx + ?Sized,
{
    let property_id = css::PropertyId::from_string(name);
    let mut delimiters = css::Delimiters::BANG;
    // Zig: `if (property_id != .custom or property_id.custom != .custom)` —
    // i.e. NOT (tag == .custom AND payload tag == .custom).
    if !matches!(
        property_id,
        css::PropertyId::Custom(CustomPropertyName::Custom(_))
    ) {
        delimiters |= css::Delimiters::CURLY_BRACKET;
    }
    let source_location = input.current_source_location();
    // PORT NOTE: Zig threaded `&closure` + fn through `parseUntilBefore`; the
    // Rust method takes a single `FnOnce(&mut Parser)`, so capture by move
    // (`PropertyId` is `Copy`, `options` is a borrow).
    let mut property = input.parse_until_before(delimiters, |input2: &mut css::Parser| {
        css::Property::parse(property_id, input2, options)
    })?;
    let important = input
        .try_parse(|i: &mut css::Parser| -> Result<()> {
            i.expect_delim(b'!')?;
            i.expect_ident_matching(b"important")
        })
        .is_ok();
    input.expect_exhausted()?;

    if input.flags.css_modules() {
        if let css::Property::Composes(composes) = &mut property {
            match composes_ctx.composes_state() {
                css::ComposesState::DisallowEntirely => {}
                css::ComposesState::Allow(_) => {
                    composes_ctx.record_composes(composes);
                }
                css::ComposesState::DisallowNested(info) => {
                    // PORT NOTE: Zig passed an empty notes slice; `warn_fmt`
                    // is the no-notes path.
                    options.warn_fmt(
                        format_args!("\"composes\" is not allowed inside nested selectors"),
                        info.line,
                        info.column,
                    );
                }
                css::ComposesState::DisallowNotSingleClass(info) => {
                    // blocked_on: ParserOptions::warn_fmt_with_notes
                    // (`bun_ast::Log` notes-ownership API). Until that
                    // lands the note ("The parent selector is not a single
                    // class selector because of the syntax here:" at
                    // `info.to_logger_location(options.filename)`) is dropped;
                    // the primary warning still fires at the right location.
                    let _ = info;
                    options.warn_fmt(
                        format_args!("\"composes\" only works inside single class selectors"),
                        source_location.line,
                        source_location.column,
                    );
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

/// Per-shorthand-group handler state used by `DeclarationBlock::minify`.
///
/// PORT NOTE: each `*Handler` is a `handler_stub!` ZST until its leaf module
/// un-gates; `Direction` is the data-only `properties::text` enum. The struct
/// shape is the real Zig layout — only the handler *bodies* are deferred.
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
    pub direction: Option<Direction>,
    pub decls: DeclarationList<'bump>,
}

impl<'bump> DeclarationHandler<'bump> {
    pub fn finalize(&mut self, context: &mut css::PropertyHandlerContext) {
        if let Some(direction) = self.direction.take() {
            self.decls.push(css::Property::Direction(direction));
        }
        // if (this.unicode_bidi) |unicode_bidi| {
        //     this.unicode_bidi = null;
        //     this.decls.append(context.arena, css.Property{ .unicode_bidi = unicode_bidi }) catch |err| bun.handleOom(err);
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
        self.background
            .handle_property(property, &mut self.decls, context)
            || self
                .border
                .handle_property(property, &mut self.decls, context)
            || self
                .flex
                .handle_property(property, &mut self.decls, context)
            || self
                .align
                .handle_property(property, &mut self.decls, context)
            || self
                .size
                .handle_property(property, &mut self.decls, context)
            || self
                .margin
                .handle_property(property, &mut self.decls, context)
            || self
                .padding
                .handle_property(property, &mut self.decls, context)
            || self
                .scroll_margin
                .handle_property(property, &mut self.decls, context)
            || self
                .transition
                .handle_property(property, &mut self.decls, context)
            || self
                .font
                .handle_property(property, &mut self.decls, context)
            || self
                .inset
                .handle_property(property, &mut self.decls, context)
            || self
                .transform
                .handle_property(property, &mut self.decls, context)
            || self
                .box_shadow
                .handle_property(property, &mut self.decls, context)
            || self
                .color_scheme
                .handle_property(property, &mut self.decls, context)
            || self
                .fallback
                .handle_property(property, &mut self.decls, context)
    }

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

// ported from: src/css/declaration.zig
