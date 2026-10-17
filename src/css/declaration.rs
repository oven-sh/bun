use crate::css_parser as css;
use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVecExt as _;
use css::{CssResult as Result, PrintErr, Printer};

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
use crate::css_properties::properties_generated::Owner;
use crate::css_properties::size::SizeHandler;
use crate::css_properties::text::Direction;
use crate::css_properties::transform::TransformHandler;
use crate::css_properties::transition::TransitionHandler;
use crate::css_properties::ui::ColorSchemeHandler;
use strum::VariantArray as _;

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
    pub(crate) important_declarations: DeclarationList<'bump>,
    /// A list of normal declarations in the block.
    pub(crate) declarations: DeclarationList<'bump>,
}

impl<'bump> DeclarationBlock<'bump> {
    pub(crate) fn is_empty(&self) -> bool {
        self.declarations.is_empty() && self.important_declarations.is_empty()
    }

    pub(crate) fn len(&self) -> usize {
        self.declarations.len() + self.important_declarations.len()
    }

    pub(crate) fn new_in(bump: &'bump Bump) -> Self {
        Self {
            important_declarations: DeclarationList::new_in(bump),
            declarations: DeclarationList::new_in(bump),
        }
    }

    pub(crate) fn minify(
        &mut self,
        handler: &mut DeclarationHandler<'bump>,
        important_handler: &mut DeclarationHandler<'bump>,
        context: &mut css::PropertyHandlerContext,
    ) {
        // `PropertyHandlerContext` carries no arena field, so we recover the
        // arena from the handler's own bump-backed accumulator instead.
        let bump: &'bump Bump = handler.decls.bump();

        // Two calls over a shared inner fn; iterate via &mut, move prop out
        // and overwrite the slot.
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
                    // Move the value out and overwrite the slot with a
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
        // The old bumpalo Vecs drop implicitly on overwrite (arena reclaims
        // on reset).
        self.important_declarations =
            core::mem::replace(&mut important_handler.decls, DeclarationList::new_in(bump));
        self.declarations = core::mem::replace(&mut handler.decls, DeclarationList::new_in(bump));
    }
}

/// Non-allocating placeholder used by `minify()` to overwrite moved-out slots.
#[inline(always)]
fn placeholder_property() -> css::Property {
    css::Property::All(crate::css_properties::CSSWideKeyword::RevertLayer)
}

// ─── to_css ───────────────────────────────────────────────────────────────

impl<'bump> DeclarationBlock<'bump> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let length = self.len();
        let mut i: usize = 0;

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
}

// ─── parse ────────────────────────────────────────────────────────────────
//
// Every consumer (`StyleRule`, `Keyframe`, `PageRule`,
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
                    options.warn(&e);
                    continue;
                }
                // `declarations`/`important_declarations` are bumpalo Vec<Property> and
                // drop on this early return; freeing them is implicit via Drop.
                return Err(e);
            }
        }

        Ok(DeclarationBlock {
            important_declarations,
            declarations,
        })
    }
}

// ─── hash / eql / deep_clone ──────────────────────────────────────────────

impl<'bump> DeclarationBlock<'bump> {
    pub fn eql(&self, other: &Self) -> bool {
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
}

// ─── PropertyDeclarationParser ────────────────────────────────────────────

pub(crate) struct PropertyDeclarationParser<'a, 'bump> {
    pub important_declarations: &'a mut DeclarationList<'bump>,
    pub declarations: &'a mut DeclarationList<'bump>,
    pub options: &'a css::ParserOptions<'a>,
}

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

pub(crate) fn parse_declaration<'bump>(
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

// Composes handling dispatches through the `ComposesCtx`
// trait (defined in `css_parser.rs`); `NoComposesCtx` returns
// `DisallowEntirely` so the no-tracking fast-path collapses into the match's
// no-op arm.
pub(crate) fn parse_declaration_impl<'bump, C>(
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
    // NOT (tag == custom AND payload tag == custom).
    if !matches!(
        property_id,
        css::PropertyId::Custom(CustomPropertyName::Custom(_))
    ) {
        delimiters |= css::Delimiters::CURLY_BRACKET;
    }
    let source_location = input.current_source_location();
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
                    options.warn_fmt(
                        format_args!("\"composes\" is not allowed inside nested selectors"),
                        info.line,
                        info.column,
                    );
                }
                css::ComposesState::DisallowNotSingleClass(info) => {
                    options.warn_fmt_with_notes(
                        format_args!("\"composes\" only works inside single class selectors"),
                        source_location.line,
                        source_location.column,
                        Box::new([bun_ast::Data {
                            text: b"The parent selector is not a single class selector because of the syntax here:"
                                .as_slice()
                                .into(),
                            location: Some(info.to_logger_location(options.filename)),
                        }]),
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
pub struct DeclarationHandler<'bump> {
    pub(crate) background: BackgroundHandler,
    pub(crate) border: BorderHandler,
    pub(crate) flex: FlexHandler,
    pub(crate) align: AlignHandler,
    pub(crate) size: SizeHandler,
    pub(crate) margin: MarginHandler,
    pub(crate) padding: PaddingHandler,
    pub(crate) scroll_margin: ScrollMarginHandler,
    pub(crate) transition: TransitionHandler,
    pub(crate) font: FontHandler,
    pub(crate) inset: InsetHandler,
    pub(crate) transform: TransformHandler,
    pub(crate) box_shadow: BoxShadowHandler,
    pub(crate) color_scheme: ColorSchemeHandler,
    pub fallback: FallbackHandler,
    pub(crate) direction: Option<Direction>,
    /// One bit for each `Owner` that got a declaration since `finalize`.
    touched: u32,
    pub(crate) decls: DeclarationList<'bump>,
}

impl<'bump> DeclarationHandler<'bump> {
    pub(crate) fn finalize(&mut self, context: &mut css::PropertyHandlerContext) {
        if let Some(direction) = self.direction.take() {
            self.decls.push(css::Property::Direction(direction));
        }

        // A handler that got no declaration has nothing to write.
        let touched = core::mem::take(&mut self.touched);
        macro_rules! finalize {
            ($($Owner:ident => $handler:ident,)+) => {
                const _: () = assert!(
                    $(Owner::$Owner.bit())|+ | Owner::Custom.bit() | Owner::Passthrough.bit()
                        == (1 << Owner::VARIANTS.len()) - 1,
                    "an owner with a handler is not in this list",
                );
                $(
                    if touched & Owner::$Owner.bit() != 0 {
                        self.$handler.finalize(&mut self.decls, context);
                    } else if cfg!(debug_assertions) {
                        let len = self.decls.len();
                        self.$handler.finalize(&mut self.decls, context);
                        assert!(
                            self.decls.len() == len,
                            concat!(stringify!($handler), " wrote a declaration that it did not get"),
                        );
                    }
                )+
            };
        }
        finalize! {
            Background => background,
            Border => border,
            Flex => flex,
            Align => align,
            Size => size,
            Margin => margin,
            Padding => padding,
            ScrollMargin => scroll_margin,
            Transition => transition,
            Font => font,
            Inset => inset,
            Transform => transform,
            BoxShadow => box_shadow,
            ColorScheme => color_scheme,
            Fallback => fallback,
        }
    }

    pub(crate) fn handle_property(
        &mut self,
        property: &css::Property,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        // Unlike lightningcss, which asks each handler in turn, only the owner gets the declaration.
        let (tag, typed) = match property {
            css::Property::Unparsed(unparsed) => (unparsed.property_id.tag(), false),
            _ => (property.variant_tag(), true),
        };
        let owner = tag.owner();
        #[cfg(debug_assertions)]
        if typed {
            self.assert_others_decline(owner, property, context);
        }
        self.touched |= owner.bit();
        let handled = self.offer(owner, property, context);
        debug_assert!(
            handled
                || match owner {
                    Owner::Custom | Owner::Passthrough => true,
                    // `ColorSchemeHandler` has no arm for a value that did not parse.
                    Owner::ColorScheme => !typed,
                    _ => false,
                },
            "{owner:?} did not claim {tag:?}",
        );
        handled
    }

    /// Gives the declaration to the handler of `owner`.
    #[inline(always)]
    fn offer(
        &mut self,
        owner: Owner,
        property: &css::Property,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        let decls = &mut self.decls;
        match owner {
            Owner::Background => self.background.handle_property(property, decls, context),
            Owner::Border => self.border.handle_property(property, decls, context),
            Owner::Flex => self.flex.handle_property(property, decls, context),
            Owner::Align => self.align.handle_property(property, decls, context),
            Owner::Size => self.size.handle_property(property, decls, context),
            Owner::Margin => self.margin.handle_property(property, decls, context),
            Owner::Padding => self.padding.handle_property(property, decls, context),
            Owner::ScrollMargin => self.scroll_margin.handle_property(property, decls, context),
            Owner::Transition => self.transition.handle_property(property, decls, context),
            Owner::Font => self.font.handle_property(property, decls, context),
            Owner::Inset => self.inset.handle_property(property, decls, context),
            Owner::Transform => self.transform.handle_property(property, decls, context),
            Owner::BoxShadow => self.box_shadow.handle_property(property, decls, context),
            Owner::ColorScheme => self.color_scheme.handle_property(property, decls, context),
            Owner::Fallback => self.fallback.handle_property(property, decls, context),
            // The place to call a handler that has to see custom and unknown names.
            Owner::Custom => false,
            Owner::Passthrough => false,
        }
    }

    /// The dispatch is correct only while no handler has an arm for a property of another owner.
    #[cfg(debug_assertions)]
    fn assert_others_decline(
        &mut self,
        owner: Owner,
        property: &css::Property,
        context: &mut css::PropertyHandlerContext,
    ) {
        let len = self.decls.len();
        for &other in Owner::VARIANTS {
            if other != owner {
                let claimed = self.offer(other, property, context);
                assert!(
                    !claimed && self.decls.len() == len,
                    "{other:?} has an arm for a declaration that `owner()` gives to {owner:?}",
                );
            }
        }
    }

    pub(crate) fn new(bump: &'bump Bump) -> Self {
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
            touched: 0,
            decls: DeclarationList::new_in(bump),
        }
    }
}
