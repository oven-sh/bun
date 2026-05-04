use crate as css;
use crate::css_rules::Location;
use crate::{Maybe, Parser, ParserOptions, ParserState, PrintErr, Printer, Result};
use crate::{BasicParseErrorKind, DeclarationBlock, ParserError, Property, RuleBodyParser};
use bumpalo::collections::Vec as BumpVec;
use bumpalo::Bump;

/// A [page selector](https://www.w3.org/TR/css-page-3/#typedef-page-selector)
/// within a `@page` rule.
///
/// Either a name or at least one pseudo class is required.
pub struct PageSelector<'bump> {
    /// An optional named page type.
    // TODO(port): arena-owned slice borrowed from parser input; raw ptr per PORTING.md §Allocators (CSS arena). Phase B: decide &'i [u8] vs StoreRef.
    pub name: Option<*const [u8]>,
    /// A list of page pseudo classes.
    pub pseudo_classes: BumpVec<'bump, PagePseudoClass>,
}

impl<'bump> PageSelector<'bump> {
    pub fn parse(input: &mut Parser) -> Result<PageSelector<'bump>> {
        let bump: &'bump Bump = input.allocator();
        let name = if let Some(name) = input.try_parse(Parser::expect_ident, ()).as_value() {
            Some(name as *const [u8])
        } else {
            None
        };
        let mut pseudo_classes: BumpVec<'bump, PagePseudoClass> = BumpVec::new_in(bump);

        loop {
            // Whitespace is not allowed between pseudo classes
            let state = input.state();
            let is_colon = match input.next_including_whitespace() {
                Result::Ok(tok) => tok.is_colon(),
                Result::Err(e) => return Result::Err(e),
            };
            if is_colon {
                let vv = match PagePseudoClass::parse(input) {
                    Result::Ok(vv) => vv,
                    Result::Err(e) => return Result::Err(e),
                };
                pseudo_classes.push(vv);
            } else {
                input.reset(&state);
                break;
            }
        }

        if name.is_none() && pseudo_classes.is_empty() {
            return Result::Err(input.new_custom_error(ParserError::InvalidPageSelector));
        }

        Result::Ok(PageSelector {
            name,
            pseudo_classes,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if let Some(name) = self.name {
            // SAFETY: `name` points into the parser arena which outlives this rule (CSS arena invariant).
            dest.write_str(unsafe { &*name })?;
        }

        for pseudo in &self.pseudo_classes {
            dest.write_char(':')?;
            pseudo.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

pub struct PageMarginRule {
    /// The margin box identifier for this rule.
    pub margin_box: PageMarginBox,
    /// The declarations within the rule.
    pub declarations: DeclarationBlock,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl PageMarginRule {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_char('@')?;
        self.margin_box.to_css(dest)?;
        self.declarations.to_css_block(dest)
    }

    pub fn deep_clone(&self, bump: &Bump) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A [@page](https://www.w3.org/TR/css-page-3/#at-page-rule) rule.
pub struct PageRule<'bump> {
    /// A list of page selectors.
    pub selectors: BumpVec<'bump, PageSelector<'bump>>,
    /// The declarations within the `@page` rule.
    pub declarations: DeclarationBlock,
    /// The nested margin rules.
    pub rules: BumpVec<'bump, PageMarginRule>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<'bump> PageRule<'bump> {
    pub fn parse(
        selectors: BumpVec<'bump, PageSelector<'bump>>,
        input: &mut Parser,
        loc: Location,
        options: &ParserOptions,
    ) -> Result<PageRule<'bump>> {
        let bump: &'bump Bump = input.allocator();
        let mut declarations = DeclarationBlock::default();
        let mut rules: BumpVec<'bump, PageMarginRule> = BumpVec::new_in(bump);
        let mut rule_parser = PageRuleParser {
            declarations: &mut declarations,
            rules: &mut rules,
            options,
        };
        let mut parser = RuleBodyParser::<PageRuleParser<'_, 'bump>>::new(input, &mut rule_parser);

        while let Some(decl) = parser.next() {
            if let Some(e) = decl.as_err() {
                if parser.parser.options.error_recovery {
                    parser.parser.options.warn(e);
                    continue;
                }

                return Result::Err(e);
            }
        }

        Result::Ok(PageRule {
            selectors,
            declarations,
            rules,
            loc,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_str(b"@page")?;
        if self.selectors.len() >= 1 {
            let firstsel = &self.selectors[0];
            // Space is only required if the first selector has a name.
            if !dest.minify && firstsel.name.is_some() {
                dest.write_char(' ')?;
            }
            let mut first = true;
            for selector in &self.selectors {
                if first {
                    first = false;
                } else {
                    dest.delim(',', false)?;
                }
                selector.to_css(dest)?;
            }
        }

        dest.whitespace()?;
        dest.write_char('{')?;
        dest.indent();

        let mut i: usize = 0;
        let len = self.declarations.len() + self.rules.len();

        // PORT NOTE: Zig used `inline for` over field-name tuple + @field reflection.
        // Unrolled to a 2-tuple of (slice, important) since both fields are property lists.
        let decls_groups: [(&[Property], bool); 2] = [
            (&self.declarations.declarations, false),
            (&self.declarations.important_declarations, true),
        ];
        for (decls, important) in decls_groups {
            for decl in decls {
                dest.newline()?;
                decl.to_css(dest, important)?;
                if i != len - 1 || !dest.minify {
                    dest.write_char(';')?;
                }
                i += 1;
            }
        }

        if !self.rules.is_empty() {
            if !dest.minify && self.declarations.len() > 0 {
                dest.write_char('\n')?;
            }
            dest.newline()?;

            let mut first = true;
            for rule in &self.rules {
                if first {
                    first = false;
                } else {
                    if !dest.minify {
                        dest.write_char('\n')?;
                    }
                    dest.newline()?;
                }
                rule.to_css(dest)?;
            }
        }

        dest.dedent();
        dest.newline()?;
        dest.write_char('}')
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A page pseudo class within an `@page` selector.
///
/// See [PageSelector](PageSelector).
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum PagePseudoClass {
    /// The `:left` pseudo class.
    #[strum(serialize = "left")]
    Left,
    /// The `:right` pseudo class.
    #[strum(serialize = "right")]
    Right,
    /// The `:first` pseudo class.
    #[strum(serialize = "first")]
    First,
    /// The `:last` pseudo class.
    #[strum(serialize = "last")]
    Last,
    /// The `:blank` pseudo class.
    #[strum(serialize = "blank")]
    Blank,
}

impl PagePseudoClass {
    pub fn as_str(&self) -> &'static [u8] {
        // TODO(port): css::enum_property_util relied on @typeInfo; Phase B should provide a derive/trait.
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut Parser) -> Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    pub fn deep_clone(&self, bump: &Bump) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A [page margin box](https://www.w3.org/TR/css-page-3/#margin-boxes).
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum PageMarginBox {
    /// A fixed-size box defined by the intersection of the top and left margins of the page box.
    #[strum(serialize = "top-left-corner")]
    TopLeftCorner,
    /// A variable-width box filling the top page margin between the top-left-corner and top-center page-margin boxes.
    #[strum(serialize = "top-left")]
    TopLeft,
    /// A variable-width box centered horizontally between the page’s left and right border edges and filling the
    /// page top margin between the top-left and top-right page-margin boxes.
    #[strum(serialize = "top-center")]
    TopCenter,
    /// A variable-width box filling the top page margin between the top-center and top-right-corner page-margin boxes.
    #[strum(serialize = "top-right")]
    TopRight,
    /// A fixed-size box defined by the intersection of the top and right margins of the page box.
    #[strum(serialize = "top-right-corner")]
    TopRightCorner,
    /// A variable-height box filling the left page margin between the top-left-corner and left-middle page-margin boxes.
    #[strum(serialize = "left-top")]
    LeftTop,
    /// A variable-height box centered vertically between the page’s top and bottom border edges and filling the
    /// left page margin between the left-top and left-bottom page-margin boxes.
    #[strum(serialize = "left-middle")]
    LeftMiddle,
    /// A variable-height box filling the left page margin between the left-middle and bottom-left-corner page-margin boxes.
    #[strum(serialize = "left-bottom")]
    LeftBottom,
    /// A variable-height box filling the right page margin between the top-right-corner and right-middle page-margin boxes.
    #[strum(serialize = "right-top")]
    RightTop,
    /// A variable-height box centered vertically between the page’s top and bottom border edges and filling the right
    /// page margin between the right-top and right-bottom page-margin boxes.
    #[strum(serialize = "right-middle")]
    RightMiddle,
    /// A variable-height box filling the right page margin between the right-middle and bottom-right-corner page-margin boxes.
    #[strum(serialize = "right-bottom")]
    RightBottom,
    /// A fixed-size box defined by the intersection of the bottom and left margins of the page box.
    #[strum(serialize = "bottom-left-corner")]
    BottomLeftCorner,
    /// A variable-width box filling the bottom page margin between the bottom-left-corner and bottom-center page-margin boxes.
    #[strum(serialize = "bottom-left")]
    BottomLeft,
    /// A variable-width box centered horizontally between the page’s left and right border edges and filling the bottom
    /// page margin between the bottom-left and bottom-right page-margin boxes.
    #[strum(serialize = "bottom-center")]
    BottomCenter,
    /// A variable-width box filling the bottom page margin between the bottom-center and bottom-right-corner page-margin boxes.
    #[strum(serialize = "bottom-right")]
    BottomRight,
    /// A fixed-size box defined by the intersection of the bottom and right margins of the page box.
    #[strum(serialize = "bottom-right-corner")]
    BottomRightCorner,
}

impl PageMarginBox {
    pub fn as_str(&self) -> &'static [u8] {
        // TODO(port): css::enum_property_util relied on @typeInfo; Phase B should provide a derive/trait.
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut Parser) -> Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

pub struct PageRuleParser<'a, 'bump> {
    pub declarations: &'a mut DeclarationBlock,
    pub rules: &'a mut BumpVec<'bump, PageMarginRule>,
    pub options: &'a ParserOptions,
}

// PORT NOTE: Zig modeled DeclarationParser/AtRuleParser/QualifiedRuleParser/RuleBodyItemParser
// as nested `pub const Foo = struct { ... }` namespaces with methods taking `*This`.
// In Rust these become trait impls on PageRuleParser; associated `pub const X = T` → `type X = T`.

impl<'a, 'bump> css::DeclarationParser for PageRuleParser<'a, 'bump> {
    type Declaration = ();

    fn parse_value(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Declaration> {
        css::declaration::parse_declaration(
            name,
            input,
            &mut self.declarations.declarations,
            &mut self.declarations.important_declarations,
            self.options,
        )
    }
}

impl<'a, 'bump> css::RuleBodyItemParser for PageRuleParser<'a, 'bump> {
    fn parse_qualified(&self) -> bool {
        false
    }

    fn parse_declarations(&self) -> bool {
        true
    }
}

impl<'a, 'bump> css::AtRuleParser for PageRuleParser<'a, 'bump> {
    type Prelude = PageMarginBox;
    type AtRule = ();

    fn parse_prelude(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Prelude> {
        let loc = input.current_source_location();
        match css::parse_utility::parse_string(
            input.allocator(),
            name,
            PageMarginBox::parse,
        ) {
            Result::Ok(v) => Result::Ok(v),
            Result::Err(_) => {
                Result::Err(loc.new_custom_error(ParserError::AtRuleInvalid(name)))
            }
        }
    }

    fn parse_block(
        &mut self,
        prelude: Self::Prelude,
        start: &ParserState,
        input: &mut Parser,
    ) -> Result<Self::AtRule> {
        let loc = start.source_location();
        let declarations = match DeclarationBlock::parse(input, self.options) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };
        self.rules.push(PageMarginRule {
            margin_box: prelude,
            declarations,
            loc: Location {
                source_index: self.options.source_index,
                line: loc.line,
                column: loc.column,
            },
        });
        Result::Ok(())
    }

    fn rule_without_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &ParserState,
    ) -> Maybe<Self::AtRule, ()> {
        Maybe::Err(())
    }
}

impl<'a, 'bump> css::QualifiedRuleParser for PageRuleParser<'a, 'bump> {
    type Prelude = ();
    type QualifiedRule = ();

    fn parse_prelude(&mut self, input: &mut Parser) -> Result<Self::Prelude> {
        Result::Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }

    fn parse_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &ParserState,
        input: &mut Parser,
    ) -> Result<Self::QualifiedRule> {
        Result::Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/page.zig (384 lines)
//   confidence: medium
//   todos:      3
//   notes:      Arena-backed: structs carry <'bump> and use bumpalo::collections::Vec (input.allocator() → &'bump Bump). PageSelector.name uses raw *const [u8] (arena-borrowed). enum_property_util/implement_deep_clone need trait/derive in Phase B; nested parser structs mapped to trait impls.
// ──────────────────────────────────────────────────────────────────────────
