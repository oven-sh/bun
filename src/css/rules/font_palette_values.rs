use crate as css;
use crate::css_rules::Location;
use crate::css_values::color::CssColor;
use crate::css_values::ident::DashedIdent;
use crate::{PrintErr, Printer};

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

// blocked_on: RuleBodyParser, FontPaletteValuesDeclarationParser trait impls,
// FontPaletteValuesProperty::to_css, DashedIdentFns::to_css, DeepClone.
#[cfg(any())]
impl FontPaletteValuesRule {
    pub fn parse(name: DashedIdent, input: &mut css::Parser, loc: Location) -> css::Result<FontPaletteValuesRule> {
        let mut decl_parser = FontPaletteValuesDeclarationParser {};
        let mut parser = css::RuleBodyParser::<FontPaletteValuesDeclarationParser>::new(input, &mut decl_parser);
        let mut properties: ArrayList<FontPaletteValuesProperty> = ArrayList::new();
        while let Some(result) = parser.next() {
            if let Some(decl) = result.as_value() {
                properties.push(decl);
                // PERF(port): was `append(input.allocator(), decl) catch unreachable`
            }
        }

        Ok(FontPaletteValuesRule { name, properties, loc })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::css_values::ident::DashedIdentFns;
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@font-palette-values ")?;
        DashedIdentFns::to_css(&self.name, dest)?;
        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();
        let len = self.properties.len();
        for (i, prop) in self.properties.iter().enumerate() {
            dest.newline()?;
            prop.to_css(dest)?;
            if i != len - 1 || !dest.minify {
                dest.write_char(b';')?;
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

/// A property within an `@font-palette-values` rule.
///
/// See [FontPaletteValuesRule](FontPaletteValuesRule).
//
// blocked_on: properties::font::FontFamily + properties::custom::CustomProperty
// (`gated_prop!`-stubbed in properties/mod.rs). The enum body un-gates with the
// variant payloads once those leaves un-gate.
#[cfg(any())]
pub enum FontPaletteValuesProperty {
    /// The `font-family` property.
    FontFamily(crate::css_properties::font::FontFamily),
    /// The `base-palette` property.
    BasePalette(BasePalette),
    /// The `override-colors` property.
    OverrideColors(ArrayList<OverrideColors>),
    /// An unknown or unsupported property.
    Custom(crate::css_properties::custom::CustomProperty),
}
#[cfg(not(any()))]
/// Data-only stub: real variant payloads land when `properties::{font,custom}`
/// un-gate.
pub struct FontPaletteValuesProperty;

#[cfg(any())]
impl FontPaletteValuesProperty {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            FontPaletteValuesProperty::FontFamily(f) => {
                dest.write_str("font-family")?;
                dest.delim(b':', false)?;
                f.to_css(dest)
            }
            FontPaletteValuesProperty::BasePalette(b) => {
                dest.write_str("base-palette")?;
                dest.delim(b':', false)?;
                b.to_css(dest)
            }
            FontPaletteValuesProperty::OverrideColors(o) => {
                dest.write_str("override-colors")?;
                dest.delim(b':', false)?;
                css::to_css::from_list::<OverrideColors>(o.as_slice(), dest)
            }
            FontPaletteValuesProperty::Custom(custom) => {
                dest.write_str(custom.name.as_str())?;
                dest.delim(b':', false)?;
                custom.value.to_css(dest, true)
            }
        }
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A value for the [override-colors](https://drafts.csswg.org/css-fonts-4/#override-color)
/// property in an `@font-palette-values` rule.
pub struct OverrideColors {
    /// The index of the color within the palette to override.
    pub index: u16,
    /// The replacement color.
    pub color: CssColor,
}

// blocked_on: CSSIntegerFns::{parse,to_css}, CssColor::{parse,to_css,
// CurrentColor variant}, ParserError::InvalidValue, DeepClone.
#[cfg(any())]
impl OverrideColors {
    pub fn parse(input: &mut css::Parser) -> css::Result<OverrideColors> {
        use crate::css_values::number::CSSIntegerFns;
        let index = match CSSIntegerFns::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        if index < 0 {
            return Err(input.new_custom_error(css::ParserError::InvalidValue));
        }

        let color = match CssColor::parse(input) {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        if matches!(color, CssColor::CurrentColor) {
            return Err(input.new_custom_error(css::ParserError::InvalidValue));
        }

        Ok(OverrideColors { index: u16::try_from(index).unwrap(), color })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::css_values::number::CSSIntegerFns;
        CSSIntegerFns::to_css(&(i32::from(self.index)), dest)?;
        dest.write_char(b' ')?;
        self.color.to_css(dest)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, bump)
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

// blocked_on: CSSIntegerFns::{parse,to_css}, Parser::{try_parse,expect_ident,
// current_source_location,new_custom_error}, ParserError::InvalidValue,
// SourceLocation::new_unexpected_token_error, DeepClone.
#[cfg(any())]
impl BasePalette {
    pub fn parse(input: &mut css::Parser) -> css::Result<BasePalette> {
        use crate::css_values::number::CSSIntegerFns;
        use bun_str::strings;
        if let Some(i) = input.try_parse(CSSIntegerFns::parse).as_value() {
            if i < 0 {
                return Err(input.new_custom_error(css::ParserError::InvalidValue));
            }
            return Ok(BasePalette::Integer(u16::try_from(i).unwrap()));
        }

        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        if strings::eql_case_insensitive_ascii_check_length(b"light", ident) {
            Ok(BasePalette::Light)
        } else if strings::eql_case_insensitive_ascii_check_length(b"dark", ident) {
            Ok(BasePalette::Dark)
        } else {
            Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::css_values::number::CSSIntegerFns;
        match self {
            BasePalette::Light => dest.write_str("light"),
            BasePalette::Dark => dest.write_str("dark"),
            BasePalette::Integer(n) => CSSIntegerFns::to_css(&(i32::from(*n)), dest),
        }
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

pub struct FontPaletteValuesDeclarationParser {}

// PORT NOTE: Zig models these as nested namespace structs (`DeclarationParser`,
// `RuleBodyItemParser`, `AtRuleParser`, `QualifiedRuleParser`) duck-typed by
// `RuleBodyParser`. In Rust these are trait impls.
//
// blocked_on: css::{DeclarationParser,RuleBodyItemParser,AtRuleParser,
// QualifiedRuleParser} trait signatures, FontPaletteValuesProperty enum body,
// properties::font::FontFamily, properties::custom::{CustomProperty,
// CustomPropertyName::from_str}, BasePalette::parse, OverrideColors::parse.
#[cfg(any())]
const _: () = {
    use crate::css_properties::custom::{CustomProperty, CustomPropertyName};
    use crate::css_properties::font::FontFamily;
    use bun_str::strings;
    use css::{BasicParseErrorKind, Maybe, Parser, ParserError, ParserOptions, ParserState, Result};

    impl css::DeclarationParser for FontPaletteValuesDeclarationParser {
        type Declaration = FontPaletteValuesProperty;

        fn parse_value(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Declaration> {
            let state = input.state();
            // todo_stuff.match_ignore_ascii_case
            if strings::eql_case_insensitive_ascii_check_length(b"font-family", name) {
                // https://drafts.csswg.org/css-fonts-4/#font-family-2-desc
                if let Some(font_family) = FontFamily::parse(input).as_value() {
                    if matches!(font_family, FontFamily::Generic(_)) {
                        return Err(input.new_custom_error(ParserError::InvalidDeclaration));
                    }
                    return Ok(FontPaletteValuesProperty::FontFamily(font_family));
                }
            } else if strings::eql_case_insensitive_ascii_check_length(b"base-palette", name) {
                // https://drafts.csswg.org/css-fonts-4/#base-palette-desc
                if let Some(base_palette) = BasePalette::parse(input).as_value() {
                    return Ok(FontPaletteValuesProperty::BasePalette(base_palette));
                }
            } else if strings::eql_case_insensitive_ascii_check_length(b"override-colors", name) {
                // https://drafts.csswg.org/css-fonts-4/#override-color
                if let Some(override_colors) = input.parse_comma_separated(OverrideColors::parse).as_value() {
                    return Ok(FontPaletteValuesProperty::OverrideColors(override_colors));
                }
            } else {
                return Err(input.new_custom_error(ParserError::InvalidDeclaration));
            }

            input.reset(&state);
            let opts = ParserOptions::default();
            // PERF(port): Zig passed `input.allocator()` + `null` here.
            let custom = match CustomProperty::parse(CustomPropertyName::from_str(name), input, &opts) {
                Ok(v) => v,
                Err(e) => return Err(e),
            };
            Ok(FontPaletteValuesProperty::Custom(custom))
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

        fn parse_prelude(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Prelude> {
            Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
        }

        fn parse_block(&mut self, _prelude: Self::Prelude, _start: &ParserState, input: &mut Parser) -> Result<Self::AtRule> {
            Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
        }

        fn rule_without_block(&mut self, _prelude: Self::Prelude, _start: &ParserState) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl css::QualifiedRuleParser for FontPaletteValuesDeclarationParser {
        type Prelude = ();
        type QualifiedRule = FontPaletteValuesProperty;

        fn parse_prelude(&mut self, input: &mut Parser) -> Result<Self::Prelude> {
            Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
        }

        fn parse_block(&mut self, _prelude: Self::Prelude, _start: &ParserState, input: &mut Parser) -> Result<Self::QualifiedRule> {
            Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
        }
    }
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/font_palette_values.zig (294 lines)
//   confidence: medium
//   todos:      1
//   notes:      structs/enums un-gated except FontPaletteValuesProperty (payloads need gated_prop! properties::{font,custom}); ArrayList=Vec + deep_clone/ParserOptions allocator dropped (arena 'bump threading deferred to Phase B crate-wide pass); nested parser namespaces → trait impls; parse/to_css/deep_clone gated on properties::{font,custom} + RuleBodyParser + CSSIntegerFns + DeepClone
// ──────────────────────────────────────────────────────────────────────────
