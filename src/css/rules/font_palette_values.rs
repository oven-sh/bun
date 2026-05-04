use crate as css;
use crate::Printer;
use crate::PrintErr;
use crate::Parser;
use crate::ParserState;
use crate::ParserOptions;
use crate::ParserError;
use crate::BasicParseErrorKind;
use crate::Maybe;
use crate::Result as CssResult;
use crate::RuleBodyParser;
use crate::CSSIntegerFns;
use crate::CssColor;
use crate::Token;
use crate::css_rules::Location;
use crate::css_properties::font as fontprops;
use crate::css_properties::font::FontFamily;
use crate::css_properties::custom::{CustomProperty, CustomPropertyName};
use crate::css_values::ident::{DashedIdent, DashedIdentFns};
use crate::css_values::color::CssColor as ColorValue;

use bun_str::strings;

// PERF(port): Zig used arena-backed `std.ArrayListUnmanaged` via `input.allocator()`.
// Phase B: thread `bump: &'bump Bump` and switch to `bumpalo::collections::Vec<'bump, T>`
// across the css crate in one pass (cascades lifetimes through every rule type).
// Same pass must also restore the dropped `std.mem.Allocator` param on `deep_clone(&self)`
// and `ParserOptions::default()` as `bump: &'bump Bump` — css is an AST crate, so the
// allocator param is the arena, not deletable.
type ArrayList<T> = Vec<T>;

/// A [@font-palette-values](https://drafts.csswg.org/css-fonts-4/#font-palette-values) rule.
pub struct FontPaletteValuesRule {
    /// The name of the font palette.
    pub name: DashedIdent,
    /// Declarations in the `@font-palette-values` rule.
    pub properties: ArrayList<FontPaletteValuesProperty>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl FontPaletteValuesRule {
    pub fn parse(name: DashedIdent, input: &mut Parser, loc: Location) -> CssResult<FontPaletteValuesRule> {
        let mut decl_parser = FontPaletteValuesDeclarationParser {};
        let mut parser = RuleBodyParser::<FontPaletteValuesDeclarationParser>::new(input, &mut decl_parser);
        let mut properties: ArrayList<FontPaletteValuesProperty> = ArrayList::new();
        while let Some(result) = parser.next() {
            if let Some(decl) = result.as_value() {
                properties.push(decl);
                // PERF(port): was `append(input.allocator(), decl) catch unreachable`
            }
        }

        CssResult::Ok(FontPaletteValuesRule {
            name,
            properties,
            loc,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@font-palette-values ")?;
        DashedIdentFns::to_css(&self.name, dest)?;
        dest.whitespace()?;
        dest.write_char('{')?;
        dest.indent();
        let len = self.properties.len();
        for (i, prop) in self.properties.iter().enumerate() {
            dest.newline()?;
            prop.to_css(dest)?;
            if i != len - 1 || !dest.minify {
                dest.write_char(';')?;
            }
        }
        dest.dedent();
        dest.newline()?;
        dest.write_char('}')
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }
}

/// A property within an `@font-palette-values` rule.
///
/// See [FontPaletteValuesRule](FontPaletteValuesRule).
pub enum FontPaletteValuesProperty {
    /// The `font-family` property.
    FontFamily(fontprops::FontFamily),

    /// The `base-palette` property.
    BasePalette(BasePalette),

    /// The `override-colors` property.
    OverrideColors(ArrayList<OverrideColors>),

    /// An unknown or unsupported property.
    Custom(CustomProperty),
}

impl FontPaletteValuesProperty {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            FontPaletteValuesProperty::FontFamily(f) => {
                dest.write_str("font-family")?;
                dest.delim(':', false)?;
                f.to_css(dest)
            }
            FontPaletteValuesProperty::BasePalette(b) => {
                dest.write_str("base-palette")?;
                dest.delim(':', false)?;
                b.to_css(dest)
            }
            FontPaletteValuesProperty::OverrideColors(o) => {
                dest.write_str("override-colors")?;
                dest.delim(':', false)?;
                css::to_css::from_list::<OverrideColors>(o.as_slice(), dest)
            }
            FontPaletteValuesProperty::Custom(custom) => {
                dest.write_str(custom.name.as_str())?;
                dest.delim(':', false)?;
                custom.value.to_css(dest, true)
            }
        }
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }
}

/// A value for the [override-colors](https://drafts.csswg.org/css-fonts-4/#override-color)
/// property in an `@font-palette-values` rule.
pub struct OverrideColors {
    /// The index of the color within the palette to override.
    pub index: u16,

    /// The replacement color.
    pub color: ColorValue,
}

impl OverrideColors {
    pub fn parse(input: &mut Parser) -> CssResult<OverrideColors> {
        let index = match CSSIntegerFns::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        if index < 0 {
            return CssResult::Err(input.new_custom_error(ParserError::InvalidValue));
        }

        let color = match CssColor::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        if matches!(color, CssColor::CurrentColor) {
            return CssResult::Err(input.new_custom_error(ParserError::InvalidValue));
        }

        CssResult::Ok(OverrideColors {
            index: u16::try_from(index).unwrap(),
            color,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        CSSIntegerFns::to_css(&(i32::from(self.index)), dest)?;
        dest.write_char(' ')?;
        self.color.to_css(dest)
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }
}

/// A value for the [base-palette](https://drafts.csswg.org/css-fonts-4/#base-palette-desc)
/// property in an `@font-palette-values` rule.
pub enum BasePalette {
    /// A light color palette as defined within the font.
    Light,

    /// A dark color palette as defined within the font.
    Dark,

    /// A palette index within the font.
    Integer(u16),
}

impl BasePalette {
    pub fn parse(input: &mut Parser) -> CssResult<BasePalette> {
        if let Some(i) = input.try_parse(CSSIntegerFns::parse).as_value() {
            if i < 0 {
                return CssResult::Err(input.new_custom_error(ParserError::InvalidValue));
            }
            return CssResult::Ok(BasePalette::Integer(u16::try_from(i).unwrap()));
        }

        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        if strings::eql_case_insensitive_ascii_check_length(b"light", ident) {
            CssResult::Ok(BasePalette::Light)
        } else if strings::eql_case_insensitive_ascii_check_length(b"dark", ident) {
            CssResult::Ok(BasePalette::Dark)
        } else {
            CssResult::Err(location.new_unexpected_token_error(Token::Ident(ident)))
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            BasePalette::Light => dest.write_str("light"),
            BasePalette::Dark => dest.write_str("dark"),
            BasePalette::Integer(n) => CSSIntegerFns::to_css(&(i32::from(*n)), dest),
        }
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }
}

pub struct FontPaletteValuesDeclarationParser {}

// TODO(port): Zig models these as nested namespace structs (`DeclarationParser`,
// `RuleBodyItemParser`, `AtRuleParser`, `QualifiedRuleParser`) duck-typed by
// `RuleBodyParser`. In Rust these are trait impls. Phase B: confirm trait
// names/signatures in `bun_css` match.

impl css::DeclarationParser for FontPaletteValuesDeclarationParser {
    type Declaration = FontPaletteValuesProperty;

    fn parse_value(&mut self, name: &[u8], input: &mut Parser) -> CssResult<Self::Declaration> {
        let state = input.state();
        // todo_stuff.match_ignore_ascii_case
        if strings::eql_case_insensitive_ascii_check_length(b"font-family", name) {
            // https://drafts.csswg.org/css-fonts-4/#font-family-2-desc
            if let Some(font_family) = FontFamily::parse(input).as_value() {
                if matches!(font_family, FontFamily::Generic(_)) {
                    return CssResult::Err(input.new_custom_error(ParserError::InvalidDeclaration));
                }
                return CssResult::Ok(FontPaletteValuesProperty::FontFamily(font_family));
            }
        } else if strings::eql_case_insensitive_ascii_check_length(b"base-palette", name) {
            // https://drafts.csswg.org/css-fonts-4/#base-palette-desc
            if let Some(base_palette) = BasePalette::parse(input).as_value() {
                return CssResult::Ok(FontPaletteValuesProperty::BasePalette(base_palette));
            }
        } else if strings::eql_case_insensitive_ascii_check_length(b"override-colors", name) {
            // https://drafts.csswg.org/css-fonts-4/#override-color
            if let Some(override_colors) = input.parse_comma_separated(OverrideColors::parse).as_value() {
                return CssResult::Ok(FontPaletteValuesProperty::OverrideColors(override_colors));
            }
        } else {
            return CssResult::Err(input.new_custom_error(ParserError::InvalidDeclaration));
        }

        input.reset(&state);
        let opts = ParserOptions::default();
        // PERF(port): Zig passed `input.allocator()` + `null` here.
        let custom = match CustomProperty::parse(
            CustomPropertyName::from_str(name),
            input,
            &opts,
        ) {
            CssResult::Ok(v) => v,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        CssResult::Ok(FontPaletteValuesProperty::Custom(custom))
    }
}

impl css::RuleBodyItemParser for FontPaletteValuesDeclarationParser {
    fn parse_qualified(&self) -> bool {
        false
    }

    fn parse_declarations(&self) -> bool {
        true
    }
}

impl css::AtRuleParser for FontPaletteValuesDeclarationParser {
    type Prelude = ();
    type AtRule = FontPaletteValuesProperty;

    fn parse_prelude(&mut self, name: &[u8], input: &mut Parser) -> CssResult<Self::Prelude> {
        CssResult::Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
    }

    fn parse_block(&mut self, _prelude: Self::Prelude, _start: &ParserState, input: &mut Parser) -> CssResult<Self::AtRule> {
        CssResult::Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
    }

    fn rule_without_block(&mut self, _prelude: Self::Prelude, _start: &ParserState) -> Maybe<Self::AtRule, ()> {
        Maybe::Err(())
    }
}

impl css::QualifiedRuleParser for FontPaletteValuesDeclarationParser {
    type Prelude = ();
    type QualifiedRule = FontPaletteValuesProperty;

    fn parse_prelude(&mut self, input: &mut Parser) -> CssResult<Self::Prelude> {
        CssResult::Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }

    fn parse_block(&mut self, _prelude: Self::Prelude, _start: &ParserState, input: &mut Parser) -> CssResult<Self::QualifiedRule> {
        CssResult::Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/font_palette_values.zig (294 lines)
//   confidence: medium
//   todos:      1
//   notes:      ArrayList kept as Vec<T> + deep_clone/ParserOptions::default drop allocator param (arena `bump: &'bump Bump` threading deferred to Phase B crate-wide pass); nested parser namespaces → trait impls; CssResult/Maybe variant names assumed Ok/Err
// ──────────────────────────────────────────────────────────────────────────
