use crate as css;
use crate::css_rules::Location;
use crate::css_values::color::CssColor;
use crate::css_values::ident::DashedIdent;
use crate::generics::DeepClone as _;
use crate::{PrintErr, Printer};

use super::ArrayList;

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
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@font-palette-values ")?;
        super::dashed_ident_to_css(&self.name, dest)?;
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
}

impl FontPaletteValuesRule {
    pub fn parse(
        name: DashedIdent,
        input: &mut css::Parser,
        loc: Location,
    ) -> css::Result<FontPaletteValuesRule> {
        let mut decl_parser = FontPaletteValuesDeclarationParser {};
        let mut parser = css::css_parser::RuleBodyParser::new(input, &mut decl_parser);
        let mut properties: ArrayList<FontPaletteValuesProperty> = ArrayList::new();
        while let Some(result) = parser.next() {
            if let Ok(decl) = result {
                properties.push(decl);
                // PERF(port): was `append(input.arena(), decl) catch unreachable`
            }
        }

        Ok(FontPaletteValuesRule {
            name,
            properties,
            loc,
        })
    }
}

/// A property within an `@font-palette-values` rule.
///
/// See [FontPaletteValuesRule](FontPaletteValuesRule).
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

impl FontPaletteValuesRule {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `FontPaletteValuesProperty`'s
        // variant-walk lands when its enum body un-gates (properties::{font,
        // custom}); the gated stub above panics with the blocker named.
        Self {
            name: self.name.deep_clone(bump),
            properties: self.properties.iter().map(|p| p.deep_clone(bump)).collect(),
            loc: self.loc,
        }
    }
}

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
                css::to_css::from_list(o.as_slice(), dest)
            }
            FontPaletteValuesProperty::Custom(custom) => {
                dest.write_str(custom.name.as_str())?;
                dest.delim(b':', false)?;
                custom.value.to_css(dest, true)
            }
        }
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` variant-walk.
        match self {
            Self::FontFamily(f) => Self::FontFamily(f.deep_clone(bump)),
            Self::BasePalette(b) => Self::BasePalette(b.deep_clone(bump)),
            Self::OverrideColors(o) => {
                Self::OverrideColors(o.iter().map(|c| c.deep_clone(bump)).collect())
            }
            Self::Custom(c) => Self::Custom(c.deep_clone(bump)),
        }
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

impl OverrideColors {
    pub fn parse(input: &mut css::Parser) -> css::Result<OverrideColors> {
        use crate::css_values::number::CSSIntegerFns;
        let index = CSSIntegerFns::parse(input)?;
        if index < 0 {
            return Err(input.new_custom_error(css::ParserError::invalid_value));
        }

        let color = CssColor::parse(input)?;
        if matches!(color, CssColor::CurrentColor) {
            return Err(input.new_custom_error(css::ParserError::invalid_value));
        }

        Ok(OverrideColors {
            index: u16::try_from(index).expect("int cast"),
            color,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::css_values::number::CSSIntegerFns;
        CSSIntegerFns::to_css(&(i32::from(self.index)), dest)?;
        dest.write_char(b' ')?;
        self.color.to_css(dest)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            index: self.index,
            color: self.color.deep_clone(bump),
        }
    }
}

impl css::generics::ToCss for OverrideColors {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        OverrideColors::to_css(self, dest)
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
    pub fn parse(input: &mut css::Parser) -> css::Result<BasePalette> {
        use crate::css_values::number::CSSIntegerFns;
        if let Ok(i) = input.try_parse(CSSIntegerFns::parse) {
            if i < 0 {
                return Err(input.new_custom_error(css::ParserError::invalid_value));
            }
            return Ok(BasePalette::Integer(u16::try_from(i).expect("int cast")));
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        crate::match_ignore_ascii_case! { ident, {
            b"light" => Ok(BasePalette::Light),
            b"dark" => Ok(BasePalette::Dark),
            _ => Err(location.new_unexpected_token_error(css::Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::css_values::number::CSSIntegerFns;
        match self {
            BasePalette::Light => dest.write_str("light"),
            BasePalette::Dark => dest.write_str("dark"),
            BasePalette::Integer(n) => CSSIntegerFns::to_css(&(i32::from(*n)), dest),
        }
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` — `Copy` payload (u16).
        match self {
            Self::Light => Self::Light,
            Self::Dark => Self::Dark,
            Self::Integer(n) => Self::Integer(*n),
        }
    }
}

pub struct FontPaletteValuesDeclarationParser {}

// PORT NOTE: Zig models these as nested namespace structs (`DeclarationParser`,
// `RuleBodyItemParser`, `AtRuleParser`, `QualifiedRuleParser`) duck-typed by
// `RuleBodyParser`. In Rust these are trait impls.
const _: () = {
    use crate::css_properties::custom::{CustomProperty, CustomPropertyName};
    use crate::css_properties::font::FontFamily;
    use css::css_parser::{
        AtRuleParser, DeclarationParser, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{
        BasicParseErrorKind, Maybe, Parser, ParserError, ParserOptions, ParserState, Result,
    };

    impl DeclarationParser for FontPaletteValuesDeclarationParser {
        type Declaration = FontPaletteValuesProperty;

        fn parse_value(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            let state = input.state();
            crate::match_ignore_ascii_case! { name, {
                b"font-family" => {
                    // https://drafts.csswg.org/css-fonts-4/#font-family-2-desc
                    if let Ok(font_family) = FontFamily::parse(input) {
                        if matches!(font_family, FontFamily::Generic(_)) {
                            return Err(input.new_custom_error(ParserError::invalid_declaration));
                        }
                        return Ok(FontPaletteValuesProperty::FontFamily(font_family));
                    }
                },
                b"base-palette" => {
                    // https://drafts.csswg.org/css-fonts-4/#base-palette-desc
                    if let Ok(base_palette) = BasePalette::parse(input) {
                        return Ok(FontPaletteValuesProperty::BasePalette(base_palette));
                    }
                },
                b"override-colors" => {
                    // https://drafts.csswg.org/css-fonts-4/#override-color
                    if let Ok(override_colors) = input.parse_comma_separated(OverrideColors::parse) {
                        return Ok(FontPaletteValuesProperty::OverrideColors(override_colors));
                    }
                },
                _ => return Err(input.new_custom_error(ParserError::invalid_declaration)),
            }}

            input.reset(&state);
            // PERF(port): Zig passed `input.arena()` + `null` here.
            let opts = ParserOptions::default(None);
            let custom = CustomProperty::parse(CustomPropertyName::from_str(name), input, &opts)?;
            Ok(FontPaletteValuesProperty::Custom(custom))
        }
    }

    impl RuleBodyItemParser for FontPaletteValuesDeclarationParser {
        fn parse_qualified(_this: &Self) -> bool {
            false
        }

        fn parse_declarations(_this: &Self) -> bool {
            true
        }
    }

    impl AtRuleParser for FontPaletteValuesDeclarationParser {
        type Prelude = ();
        type AtRule = FontPaletteValuesProperty;

        fn parse_prelude(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Prelude> {
            Err(
                input.new_error(BasicParseErrorKind::at_rule_invalid(std::ptr::from_ref::<
                    [u8],
                >(name))),
            )
        }

        fn parse_block(
            _this: &mut Self,
            _prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::AtRule> {
            Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid))
        }

        fn rule_without_block(
            _this: &mut Self,
            _prelude: Self::Prelude,
            _start: &ParserState,
        ) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl QualifiedRuleParser for FontPaletteValuesDeclarationParser {
        type Prelude = ();
        type QualifiedRule = FontPaletteValuesProperty;

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

// ported from: src/css/rules/font_palette_values.zig
