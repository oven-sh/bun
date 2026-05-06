use crate as css;
use crate::css_rules::Location;
use crate::{DeclarationBlock, PrintErr, Printer};

// PERF(port): Zig used arena-backed `std.ArrayListUnmanaged` fed by
// `input.allocator()`. Phase B threads `'bump` and switches to
// `bumpalo::collections::Vec<'bump, T>` crate-wide; until then `Vec<T>`.
type ArrayList<T> = Vec<T>;

/// A [page selector](https://www.w3.org/TR/css-page-3/#typedef-page-selector)
/// within a `@page` rule.
///
/// Either a name or at least one pseudo class is required.
pub struct PageSelector {
    /// An optional named page type.
    // PORT NOTE: arena-owned slice borrowed from parser input; `&'static` per
    // PORTING.md §AST crates / rules/mod.rs lifetime-erasure note. Phase B
    // re-threads `'bump`.
    pub name: Option<&'static [u8]>,
    /// A list of page pseudo classes.
    pub pseudo_classes: ArrayList<PagePseudoClass>,
}

// ─── PageSelector behavior ────────────────────────────────────────────────
// blocked_on: Parser::{try_parse,expect_ident,next_including_whitespace,
// state,reset,new_custom_error,allocator} surface, ParserError::
// InvalidPageSelector, PagePseudoClass::{parse,to_css}, DeepClone.
#[cfg(any())]
impl PageSelector {
    pub fn parse(input: &mut css::Parser) -> css::Result<PageSelector> {
        let name = if let Some(name) = input.try_parse(css::Parser::expect_ident, ()).as_value() {
            Some(name)
        } else {
            None
        };
        let mut pseudo_classes: ArrayList<PagePseudoClass> = ArrayList::new();

        loop {
            // Whitespace is not allowed between pseudo classes
            let state = input.state();
            let is_colon = match input.next_including_whitespace() {
                Ok(tok) => matches!(*tok, css::Token::Colon),
                Err(e) => return Err(e),
            };
            if is_colon {
                let vv = match PagePseudoClass::parse(input) {
                    Ok(vv) => vv,
                    Err(e) => return Err(e),
                };
                pseudo_classes.push(vv);
            } else {
                input.reset(&state);
                break;
            }
        }

        if name.is_none() && pseudo_classes.is_empty() {
            return Err(input.new_custom_error(css::ParserError::InvalidPageSelector));
        }

        Ok(PageSelector { name, pseudo_classes })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if let Some(name) = self.name {
            dest.write_str(name)?;
        }

        for pseudo in &self.pseudo_classes {
            dest.write_char(b':')?;
            pseudo.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

pub struct PageMarginRule {
    /// The margin box identifier for this rule.
    pub margin_box: PageMarginBox,
    /// The declarations within the rule.
    // PORT NOTE: lifetime erased to `'static` per rules/mod.rs `CssRule<R>` note.
    pub declarations: DeclarationBlock<'static>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

// blocked_on: DeclarationBlock::to_css_block, PageMarginBox::to_css, DeepClone.
#[cfg(any())]
impl PageMarginRule {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_char(b'@')?;
        self.margin_box.to_css(dest)?;
        self.declarations.to_css_block(dest)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A [@page](https://www.w3.org/TR/css-page-3/#at-page-rule) rule.
pub struct PageRule {
    /// A list of page selectors.
    pub selectors: ArrayList<PageSelector>,
    /// The declarations within the `@page` rule.
    // PORT NOTE: lifetime erased to `'static` per rules/mod.rs `CssRule<R>` note.
    pub declarations: DeclarationBlock<'static>,
    /// The nested margin rules.
    pub rules: ArrayList<PageMarginRule>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

// ─── PageRule behavior ────────────────────────────────────────────────────
// blocked_on: RuleBodyParser, DeclarationBlock::{len,declarations,
// important_declarations}, Property::to_css, PageSelector::to_css,
// PageMarginRule::to_css, DeepClone.
#[cfg(any())]
impl PageRule {
    pub fn parse(
        selectors: ArrayList<PageSelector>,
        input: &mut css::Parser,
        loc: Location,
        options: &css::ParserOptions,
    ) -> css::Result<PageRule> {
        let mut declarations = DeclarationBlock::default();
        let mut rules: ArrayList<PageMarginRule> = ArrayList::new();
        let mut rule_parser = PageRuleParser {
            declarations: &mut declarations,
            rules: &mut rules,
            options,
        };
        let mut parser = css::RuleBodyParser::<PageRuleParser<'_>>::new(input, &mut rule_parser);

        while let Some(decl) = parser.next() {
            if let Some(e) = decl.as_err() {
                if parser.parser.options.error_recovery {
                    parser.parser.options.warn(e);
                    continue;
                }

                return Err(e);
            }
        }

        Ok(PageRule { selectors, declarations, rules, loc })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_str("@page")?;
        if self.selectors.len() >= 1 {
            let firstsel = &self.selectors[0];
            // Space is only required if the first selector has a name.
            if !dest.minify && firstsel.name.is_some() {
                dest.write_char(b' ')?;
            }
            let mut first = true;
            for selector in &self.selectors {
                if first {
                    first = false;
                } else {
                    dest.delim(b',', false)?;
                }
                selector.to_css(dest)?;
            }
        }

        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();

        let mut i: usize = 0;
        let len = self.declarations.len() + self.rules.len();

        // PORT NOTE: Zig used `inline for` over field-name tuple + @field reflection.
        // Unrolled to a 2-tuple of (slice, important) since both fields are property lists.
        let decls_groups: [(&[css::Property], bool); 2] = [
            (&self.declarations.declarations, false),
            (&self.declarations.important_declarations, true),
        ];
        for (decls, important) in decls_groups {
            for decl in decls {
                dest.newline()?;
                decl.to_css(dest, important)?;
                if i != len - 1 || !dest.minify {
                    dest.write_char(b';')?;
                }
                i += 1;
            }
        }

        if !self.rules.is_empty() {
            if !dest.minify && self.declarations.len() > 0 {
                dest.write_char(b'\n')?;
            }
            dest.newline()?;

            let mut first = true;
            for rule in &self.rules {
                if first {
                    first = false;
                } else {
                    if !dest.minify {
                        dest.write_char(b'\n')?;
                    }
                    dest.newline()?;
                }
                rule.to_css(dest)?;
            }
        }

        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A page pseudo class within an `@page` selector.
///
/// See [PageSelector](PageSelector).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PagePseudoClass {
    /// The `:left` pseudo class.
    Left,
    /// The `:right` pseudo class.
    Right,
    /// The `:first` pseudo class.
    First,
    /// The `:last` pseudo class.
    Last,
    /// The `:blank` pseudo class.
    Blank,
}

// blocked_on: css::enum_property_util trait bounds (EnumProperty derive),
// DeepClone.
#[cfg(any())]
impl PagePseudoClass {
    pub fn as_str(&self) -> &'static [u8] {
        // TODO(port): css::enum_property_util relied on @typeInfo; Phase B should provide a derive/trait.
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A [page margin box](https://www.w3.org/TR/css-page-3/#margin-boxes).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PageMarginBox {
    /// A fixed-size box defined by the intersection of the top and left margins of the page box.
    TopLeftCorner,
    /// A variable-width box filling the top page margin between the top-left-corner and top-center page-margin boxes.
    TopLeft,
    /// A variable-width box centered horizontally between the page's left and right border edges and filling the
    /// page top margin between the top-left and top-right page-margin boxes.
    TopCenter,
    /// A variable-width box filling the top page margin between the top-center and top-right-corner page-margin boxes.
    TopRight,
    /// A fixed-size box defined by the intersection of the top and right margins of the page box.
    TopRightCorner,
    /// A variable-height box filling the left page margin between the top-left-corner and left-middle page-margin boxes.
    LeftTop,
    /// A variable-height box centered vertically between the page's top and bottom border edges and filling the
    /// left page margin between the left-top and left-bottom page-margin boxes.
    LeftMiddle,
    /// A variable-height box filling the left page margin between the left-middle and bottom-left-corner page-margin boxes.
    LeftBottom,
    /// A variable-height box filling the right page margin between the top-right-corner and right-middle page-margin boxes.
    RightTop,
    /// A variable-height box centered vertically between the page's top and bottom border edges and filling the right
    /// page margin between the right-top and right-bottom page-margin boxes.
    RightMiddle,
    /// A variable-height box filling the right page margin between the right-middle and bottom-right-corner page-margin boxes.
    RightBottom,
    /// A fixed-size box defined by the intersection of the bottom and left margins of the page box.
    BottomLeftCorner,
    /// A variable-width box filling the bottom page margin between the bottom-left-corner and bottom-center page-margin boxes.
    BottomLeft,
    /// A variable-width box centered horizontally between the page's left and right border edges and filling the bottom
    /// page margin between the bottom-left and bottom-right page-margin boxes.
    BottomCenter,
    /// A variable-width box filling the bottom page margin between the bottom-center and bottom-right-corner page-margin boxes.
    BottomRight,
    /// A fixed-size box defined by the intersection of the bottom and right margins of the page box.
    BottomRightCorner,
}

// blocked_on: css::enum_property_util trait bounds (EnumProperty derive).
#[cfg(any())]
impl PageMarginBox {
    pub fn as_str(&self) -> &'static [u8] {
        // TODO(port): css::enum_property_util relied on @typeInfo; Phase B should provide a derive/trait.
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

pub struct PageRuleParser<'a> {
    pub declarations: &'a mut DeclarationBlock<'static>,
    pub rules: &'a mut ArrayList<PageMarginRule>,
    pub options: &'a css::ParserOptions<'a>,
}

// PORT NOTE: Zig modeled DeclarationParser/AtRuleParser/QualifiedRuleParser/
// RuleBodyItemParser as nested `pub const Foo = struct { ... }` namespaces with
// methods taking `*This`. In Rust these become trait impls on PageRuleParser;
// associated `pub const X = T` → `type X = T`.
//
// blocked_on: css::{DeclarationParser, AtRuleParser, QualifiedRuleParser,
// RuleBodyItemParser} trait signatures, css::declaration::parse_declaration,
// css::parse_utility::parse_string, PageMarginBox::parse, DeclarationBlock::
// parse, ParserOptions::source_index.
#[cfg(any())]
const _: () = {
    use css::{BasicParseErrorKind, Maybe, Parser, ParserError, ParserState, Result};

    impl<'a> css::DeclarationParser for PageRuleParser<'a> {
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

    impl<'a> css::RuleBodyItemParser for PageRuleParser<'a> {
        fn parse_qualified(&self) -> bool {
            false
        }

        fn parse_declarations(&self) -> bool {
            true
        }
    }

    impl<'a> css::AtRuleParser for PageRuleParser<'a> {
        type Prelude = PageMarginBox;
        type AtRule = ();

        fn parse_prelude(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Prelude> {
            let loc = input.current_source_location();
            match css::parse_utility::parse_string(input.allocator(), name, PageMarginBox::parse) {
                Ok(v) => Ok(v),
                Err(_) => Err(loc.new_custom_error(ParserError::AtRuleInvalid(name))),
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
                Ok(vv) => vv,
                Err(e) => return Err(e),
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
            Ok(())
        }

        fn rule_without_block(
            &mut self,
            _prelude: Self::Prelude,
            _start: &ParserState,
        ) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl<'a> css::QualifiedRuleParser for PageRuleParser<'a> {
        type Prelude = ();
        type QualifiedRule = ();

        fn parse_prelude(&mut self, input: &mut Parser) -> Result<Self::Prelude> {
            Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
        }

        fn parse_block(
            &mut self,
            _prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::QualifiedRule> {
            Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
        }
    }
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/page.zig (384 lines)
//   confidence: medium
//   todos:      3
//   notes:      structs/enums un-gated (data-only); ArrayList=Vec + DeclarationBlock<'static> + name:&'static [u8] until 'bump threaded; parse/to_css/deep_clone + parser-trait impls gated on css_parser trait surface + enum_property_util/EnumProperty derive + DeepClone
// ──────────────────────────────────────────────────────────────────────────
