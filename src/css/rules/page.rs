use crate as css;
use crate::css_rules::Location;
use crate::{DeclarationBlock, PrintErr, Printer};

// PERF(port): Zig used arena-backed `std.ArrayListUnmanaged` fed by
// `input.allocator()`. Phase B threads `'bump` and switches to
// `bun_alloc::ArenaVec<'bump, T>` crate-wide; until then `Vec<T>`.
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

impl PageSelector {
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
}

impl PageSelector {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `name: Option<&'static
        // [u8]>` is an arena-owned slice → identity copy; `PagePseudoClass` is
        // `Copy`.
        Self {
            name: self.name,
            pseudo_classes: self.pseudo_classes.iter().map(|p| p.deep_clone(bump)).collect(),
        }
    }
}

// ─── PageSelector parse ───────────────────────────────────────────────────
impl PageSelector {
    pub fn parse(input: &mut css::Parser) -> css::Result<PageSelector> {
        // SAFETY: ident borrows parser source/arena; see `css_parser::src_str`.
        let name: Option<&'static [u8]> = input
            .try_parse(|i| i.expect_ident().map(|s| unsafe { css::css_parser::src_str(s) }))
            .ok();
        let mut pseudo_classes: ArrayList<PagePseudoClass> = ArrayList::new();

        loop {
            // Whitespace is not allowed between pseudo classes
            let state = input.state();
            let is_colon = match input.next_including_whitespace() {
                Ok(tok) => matches!(*tok, css::Token::Colon),
                Err(e) => return Err(e),
            };
            if is_colon {
                let vv = PagePseudoClass::parse(input)?;
                pseudo_classes.push(vv);
            } else {
                input.reset(&state);
                break;
            }
        }

        if name.is_none() && pseudo_classes.is_empty() {
            return Err(input.new_custom_error(css::ParserError::invalid_page_selector));
        }

        Ok(PageSelector { name, pseudo_classes })
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

impl PageMarginRule {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_char(b'@')?;
        self.margin_box.to_css(dest)?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl PageMarginRule {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `PageMarginBox` is `Copy`.
        Self {
            margin_box: self.margin_box,
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
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

impl PageRule {
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
        let decls_groups: [(&[crate::css_parser::Property], bool); 2] = [
            (self.declarations.declarations.as_slice(), false),
            (self.declarations.important_declarations.as_slice(), true),
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
}

impl PageRule {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        Self {
            selectors: self.selectors.iter().map(|s| s.deep_clone(bump)).collect(),
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            rules: self.rules.iter().map(|r| r.deep_clone(bump)).collect(),
            loc: self.loc,
        }
    }
}

// ─── PageRule parse ───────────────────────────────────────────────────────
impl PageRule {
    pub fn parse(
        selectors: ArrayList<PageSelector>,
        input: &mut css::Parser,
        loc: Location,
        options: &css::ParserOptions,
    ) -> css::Result<PageRule> {
        // SAFETY: `Tokenizer<'a>` owns `allocator: &'a Bump`; the arena outlives
        // every `DeclarationBlock` produced from this parser. `'static` here is
        // the crate-wide erasure (see declaration.rs `DeclarationBlock::parse`).
        let bump: &'static bun_alloc::Arena =
            unsafe { &*(input.allocator() as *const bun_alloc::Arena) };
        let mut declarations = DeclarationBlock::new_in(bump);
        let mut rules: ArrayList<PageMarginRule> = ArrayList::new();
        let mut rule_parser = PageRuleParser {
            declarations: &mut declarations,
            rules: &mut rules,
            options,
        };
        let mut parser = css::css_parser::RuleBodyParser::new(input, &mut rule_parser);

        while let Some(decl) = parser.next() {
            if let Err(e) = decl {
                if parser.parser.options.error_recovery {
                    parser.parser.options.warn(e);
                    continue;
                }
                return Err(e);
            }
        }

        Ok(PageRule { selectors, declarations, rules, loc })
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

// PORT NOTE: Zig `css.enum_property_util.{asStr,toCss}` used `@tagName` to get
// the lowercase variant name. Phase B should provide `#[derive(EnumProperty)]`;
// until then the `Into<&'static str>` table is hand-rolled.
impl From<PagePseudoClass> for &'static str {
    fn from(v: PagePseudoClass) -> &'static str {
        match v {
            PagePseudoClass::Left => "left",
            PagePseudoClass::Right => "right",
            PagePseudoClass::First => "first",
            PagePseudoClass::Last => "last",
            PagePseudoClass::Blank => "blank",
        }
    }
}

// PORT NOTE: Zig `css.DefineEnumProperty(@This())` — hand-rolled until
// `#[derive(DefineEnumProperty)]` covers `&[u8]` lookup.
impl css::EnumProperty for PagePseudoClass {
    fn from_ascii_case_insensitive(ident: &[u8]) -> Option<Self> {
        use bun_string::strings::eql_case_insensitive_ascii_check_length as eq;
        if eq(ident, b"left") { return Some(Self::Left); }
        if eq(ident, b"right") { return Some(Self::Right); }
        if eq(ident, b"first") { return Some(Self::First); }
        if eq(ident, b"last") { return Some(Self::Last); }
        if eq(ident, b"blank") { return Some(Self::Blank); }
        None
    }
}

impl PagePseudoClass {
    pub fn as_str(&self) -> &'static str {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

impl PagePseudoClass {
    #[inline]
    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // `Copy` enum (generics.zig "simple copy types" → identity).
        *self
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

// PORT NOTE: Zig `css.enum_property_util.{asStr,toCss}` used `@tagName`; Phase B
// should provide `#[derive(EnumProperty)]`. Hand-rolled kebab-case table.
impl From<PageMarginBox> for &'static str {
    fn from(v: PageMarginBox) -> &'static str {
        match v {
            PageMarginBox::TopLeftCorner => "top-left-corner",
            PageMarginBox::TopLeft => "top-left",
            PageMarginBox::TopCenter => "top-center",
            PageMarginBox::TopRight => "top-right",
            PageMarginBox::TopRightCorner => "top-right-corner",
            PageMarginBox::LeftTop => "left-top",
            PageMarginBox::LeftMiddle => "left-middle",
            PageMarginBox::LeftBottom => "left-bottom",
            PageMarginBox::RightTop => "right-top",
            PageMarginBox::RightMiddle => "right-middle",
            PageMarginBox::RightBottom => "right-bottom",
            PageMarginBox::BottomLeftCorner => "bottom-left-corner",
            PageMarginBox::BottomLeft => "bottom-left",
            PageMarginBox::BottomCenter => "bottom-center",
            PageMarginBox::BottomRight => "bottom-right",
            PageMarginBox::BottomRightCorner => "bottom-right-corner",
        }
    }
}

// PORT NOTE: Zig `css.DefineEnumProperty(@This())` — hand-rolled until
// `#[derive(DefineEnumProperty)]` covers `&[u8]` lookup.
impl css::EnumProperty for PageMarginBox {
    fn from_ascii_case_insensitive(ident: &[u8]) -> Option<Self> {
        use bun_string::strings::eql_case_insensitive_ascii_check_length as eq;
        if eq(ident, b"top-left-corner") { return Some(Self::TopLeftCorner); }
        if eq(ident, b"top-left") { return Some(Self::TopLeft); }
        if eq(ident, b"top-center") { return Some(Self::TopCenter); }
        if eq(ident, b"top-right") { return Some(Self::TopRight); }
        if eq(ident, b"top-right-corner") { return Some(Self::TopRightCorner); }
        if eq(ident, b"left-top") { return Some(Self::LeftTop); }
        if eq(ident, b"left-middle") { return Some(Self::LeftMiddle); }
        if eq(ident, b"left-bottom") { return Some(Self::LeftBottom); }
        if eq(ident, b"right-top") { return Some(Self::RightTop); }
        if eq(ident, b"right-middle") { return Some(Self::RightMiddle); }
        if eq(ident, b"right-bottom") { return Some(Self::RightBottom); }
        if eq(ident, b"bottom-left-corner") { return Some(Self::BottomLeftCorner); }
        if eq(ident, b"bottom-left") { return Some(Self::BottomLeft); }
        if eq(ident, b"bottom-center") { return Some(Self::BottomCenter); }
        if eq(ident, b"bottom-right") { return Some(Self::BottomRight); }
        if eq(ident, b"bottom-right-corner") { return Some(Self::BottomRightCorner); }
        None
    }
}

impl PageMarginBox {
    pub fn as_str(&self) -> &'static str {
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
const _: () = {
    use css::css_parser::{
        AtRuleParser, DeclarationParser, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{BasicParseErrorKind, Maybe, Parser, ParserError, ParserState, Result};

    impl<'a> DeclarationParser for PageRuleParser<'a> {
        type Declaration = ();

        fn parse_value(this: &mut Self, name: &[u8], input: &mut Parser) -> Result<Self::Declaration> {
            css::declaration::parse_declaration(
                name,
                input,
                &mut this.declarations.declarations,
                &mut this.declarations.important_declarations,
                this.options,
            )
        }
    }

    impl<'a> RuleBodyItemParser for PageRuleParser<'a> {
        fn parse_qualified(_this: &Self) -> bool {
            false
        }

        fn parse_declarations(_this: &Self) -> bool {
            true
        }
    }

    impl<'a> AtRuleParser for PageRuleParser<'a> {
        type Prelude = PageMarginBox;
        type AtRule = ();

        fn parse_prelude(_this: &mut Self, name: &[u8], input: &mut Parser) -> Result<Self::Prelude> {
            let loc = input.current_source_location();
            match css::parse_utility::parse_string(input.allocator(), name, PageMarginBox::parse) {
                Ok(v) => Ok(v),
                Err(_) => Err(loc.new_custom_error(ParserError::at_rule_invalid(name as *const [u8]))),
            }
        }

        fn parse_block(
            this: &mut Self,
            prelude: Self::Prelude,
            start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::AtRule> {
            let loc = start.source_location();
            let declarations = DeclarationBlock::parse(input, this.options)?;
            this.rules.push(PageMarginRule {
                margin_box: prelude,
                declarations,
                loc: Location {
                    source_index: this.options.source_index,
                    line: loc.line,
                    column: loc.column,
                },
            });
            Ok(())
        }

        fn rule_without_block(
            _this: &mut Self,
            _prelude: Self::Prelude,
            _start: &ParserState,
        ) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl<'a> QualifiedRuleParser for PageRuleParser<'a> {
        type Prelude = ();
        type QualifiedRule = ();

        fn parse_prelude(_this: &mut Self, input: &mut Parser) -> Result<Self::Prelude> {
            Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid))
        }

        fn parse_block(
            _this: &mut Self,
            _prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::QualifiedRule> {
            Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid))
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
