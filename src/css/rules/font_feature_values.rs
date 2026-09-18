use crate as css;
use crate::css_properties::custom::{CustomProperty, CustomPropertyName};
use crate::css_properties::font::FontFamily;
use crate::css_rules::Location;
use crate::css_values::ident::Ident;
use crate::css_values::number::{CSSInteger, CSSIntegerFns};
use crate::generics::DeepClone as _;
use crate::{PrintErr, Printer};

use super::ArrayList;

/// A [@font-feature-values](https://drafts.csswg.org/css-fonts/#font-feature-values) rule.
pub struct FontFeatureValuesRule {
    /// The font family names the feature values apply to.
    pub name: ArrayList<FontFamily>,
    /// Descriptors in the rule body, such as `font-display`, kept as written.
    pub(crate) declarations: ArrayList<CustomProperty>,
    /// The sub-rules within the `@font-feature-values` rule, one per block type.
    pub(crate) rules: ArrayList<FontFeatureSubrule>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl FontFeatureValuesRule {
    pub(crate) fn parse(
        name: ArrayList<FontFamily>,
        input: &mut css::Parser,
        loc: Location,
        options: &css::ParserOptions,
    ) -> css::Result<FontFeatureValuesRule> {
        let mut declarations: ArrayList<CustomProperty> = ArrayList::new();
        let mut rules: ArrayList<FontFeatureSubrule> = ArrayList::new();
        let mut rule_parser = FontFeatureValuesRuleParser {
            declarations: &mut declarations,
            rules: &mut rules,
            options,
        };
        let mut parser = css::css_parser::RuleBodyParser::new(input, &mut rule_parser);

        while let Some(result) = parser.next() {
            if let Err(e) = result {
                if parser.parser.options.error_recovery {
                    parser.parser.options.warn(&e);
                    continue;
                }
                return Err(e);
            }
        }

        Ok(FontFeatureValuesRule {
            name,
            declarations,
            rules,
            loc,
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str("@font-feature-values ")?;
        dest.write_comma_separated(&self.name, |d, family| family.to_css(d))?;
        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();
        let len = self.declarations.len() + self.rules.len();
        for (i, decl) in self.declarations.iter().enumerate() {
            dest.newline()?;
            decl.name.to_css(dest)?;
            dest.delim(b':', false)?;
            decl.value.to_css(dest, true)?;
            if i != len - 1 || !dest.minify {
                dest.write_char(b';')?;
            }
        }
        for rule in &self.rules {
            dest.newline()?;
            rule.to_css(dest)?;
        }
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            name: self.name.iter().map(|f| f.deep_clone(bump)).collect(),
            declarations: self
                .declarations
                .iter()
                .map(|d| d.deep_clone(bump))
                .collect(),
            rules: self.rules.iter().map(|r| r.deep_clone(bump)).collect(),
            loc: self.loc,
        }
    }
}

/// The name of a `@font-feature-values` sub-rule, e.g. `@styleset`.
#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum FontFeatureSubruleType {
    /// @stylistic = @stylistic { <declaration-list> }
    Stylistic,
    /// @historical-forms = @historical-forms { <declaration-list> }
    HistoricalForms,
    /// @styleset = @styleset { <declaration-list> }
    Styleset,
    /// @character-variant = @character-variant { <declaration-list> }
    CharacterVariant,
    /// @swash = @swash { <declaration-list> }
    Swash,
    /// @ornaments = @ornaments { <declaration-list> }
    Ornaments,
    /// @annotation = @annotation { <declaration-list> }
    Annotation,
}

/// A feature value inside a sub-rule, e.g. `nice-style: 12`.
pub struct FontFeatureValue {
    /// The feature value name.
    pub(crate) name: Ident,
    /// One or more feature indices.
    pub(crate) indices: ArrayList<CSSInteger>,
}

/// A sub-rule of `@font-feature-values`, e.g. `@styleset { ... }`.
pub struct FontFeatureSubrule {
    /// The name of the sub-rule.
    pub(crate) name: FontFeatureSubruleType,
    /// The feature values, in source order. Names are unique.
    pub(crate) declarations: ArrayList<FontFeatureValue>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl FontFeatureSubrule {
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_char(b'@')?;
        self.name.to_css(dest)?;
        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();
        let len = self.declarations.len();
        for (i, decl) in self.declarations.iter().enumerate() {
            dest.newline()?;
            decl.name.to_css(dest)?;
            dest.delim(b':', false)?;
            dest.write_separated(
                &decl.indices,
                |d| d.write_char(b' '),
                |d, index| CSSIntegerFns::to_css(*index, d),
            )?;
            if i != len - 1 || !dest.minify {
                dest.write_char(b';')?;
            }
        }
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')
    }

    fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            name: self.name,
            declarations: self
                .declarations
                .iter()
                .map(|d| FontFeatureValue {
                    name: d.name.deep_clone(bump),
                    indices: d.indices.clone(),
                })
                .collect(),
            loc: self.loc,
        }
    }
}

struct FontFeatureValuesRuleParser<'a> {
    declarations: &'a mut ArrayList<CustomProperty>,
    rules: &'a mut ArrayList<FontFeatureSubrule>,
    options: &'a css::ParserOptions<'a>,
}

struct FontFeatureDeclarationParser<'a> {
    declarations: &'a mut ArrayList<FontFeatureValue>,
}

const _: () = {
    use css::css_parser::{
        AtRuleParser, DeclarationParser, EnumProperty, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{BasicParseErrorKind, Maybe, Parser, ParserError, ParserState, Result};

    impl<'a> DeclarationParser for FontFeatureValuesRuleParser<'a> {
        type Declaration = ();

        fn parse_value(
            this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            let custom =
                CustomProperty::parse(CustomPropertyName::from_str(name), input, this.options)?;
            this.declarations.push(custom);
            Ok(())
        }
    }

    impl<'a> RuleBodyItemParser for FontFeatureValuesRuleParser<'a> {
        fn parse_qualified(_this: &Self) -> bool {
            false
        }

        fn parse_declarations(_this: &Self) -> bool {
            true
        }
    }

    impl<'a> AtRuleParser for FontFeatureValuesRuleParser<'a> {
        type Prelude = FontFeatureSubruleType;
        type AtRule = ();

        fn parse_prelude(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Prelude> {
            let loc = input.current_source_location();
            FontFeatureSubruleType::from_ascii_case_insensitive(name).ok_or_else(|| {
                loc.new_custom_error(ParserError::at_rule_invalid(std::ptr::from_ref::<[u8]>(
                    name,
                )))
            })
        }

        fn parse_block(
            this: &mut Self,
            prelude: Self::Prelude,
            start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::AtRule> {
            let loc = start.source_location();
            let mut new_declarations: ArrayList<FontFeatureValue> = ArrayList::new();
            let (declarations, has_existing) =
                match this.rules.iter_mut().find(|r| r.name == prelude) {
                    Some(rule) => (&mut rule.declarations, true),
                    None => (&mut new_declarations, false),
                };
            let mut decl_parser = FontFeatureDeclarationParser { declarations };
            let mut parser = css::css_parser::RuleBodyParser::new(input, &mut decl_parser);
            while let Some(result) = parser.next() {
                if let Err(e) = result {
                    if this.options.error_recovery {
                        this.options.warn(&e);
                        continue;
                    }
                    return Err(e);
                }
            }

            if !has_existing {
                this.rules.push(FontFeatureSubrule {
                    name: prelude,
                    declarations: new_declarations,
                    loc: Location {
                        source_index: this.options.source_index,
                        line: loc.line,
                        column: loc.column,
                    },
                });
            }
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

    impl<'a> QualifiedRuleParser for FontFeatureValuesRuleParser<'a> {
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

    impl<'a> DeclarationParser for FontFeatureDeclarationParser<'a> {
        type Declaration = ();

        fn parse_value(
            this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            let mut indices: ArrayList<CSSInteger> = ArrayList::new();
            while let Ok(value) = input.try_parse(CSSIntegerFns::parse) {
                indices.push(value);
            }

            if indices.is_empty() {
                return Err(input.new_custom_error(ParserError::invalid_value));
            }
            input.expect_exhausted()?;

            let existing = this.declarations.iter_mut().find(|d| d.name.v() == name);
            match existing {
                Some(decl) => decl.indices = indices,
                None => this.declarations.push(FontFeatureValue {
                    name: Ident {
                        v: std::ptr::from_ref::<[u8]>(name),
                    },
                    indices,
                }),
            }
            Ok(())
        }
    }

    impl<'a> RuleBodyItemParser for FontFeatureDeclarationParser<'a> {
        fn parse_qualified(_this: &Self) -> bool {
            false
        }

        fn parse_declarations(_this: &Self) -> bool {
            true
        }
    }

    impl<'a> AtRuleParser for FontFeatureDeclarationParser<'a> {
        type Prelude = ();
        type AtRule = ();

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

    impl<'a> QualifiedRuleParser for FontFeatureDeclarationParser<'a> {
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
