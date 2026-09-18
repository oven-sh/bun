use crate as css;
use crate::css_rules::Location;
use crate::css_values::ident::NoneOrCustomIdentList;
use crate::generics::DeepClone as _;
use crate::{PrintErr, Printer};

use super::ArrayList;

/// A [@view-transition](https://drafts.csswg.org/css-view-transitions-2/#view-transition-rule) rule.
pub struct ViewTransitionRule {
    /// Declarations in the `@view-transition` rule.
    pub(crate) properties: ArrayList<ViewTransitionProperty>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl ViewTransitionRule {
    pub(crate) fn parse(input: &mut css::Parser, loc: Location) -> css::Result<ViewTransitionRule> {
        let mut decl_parser = ViewTransitionDeclarationParser {};
        let mut parser = css::css_parser::RuleBodyParser::new(input, &mut decl_parser);
        let mut properties: ArrayList<ViewTransitionProperty> = ArrayList::new();
        while let Some(result) = parser.next() {
            if let Ok(decl) = result {
                properties.push(decl);
            }
        }

        Ok(ViewTransitionRule { properties, loc })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str("@view-transition")?;
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

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            properties: self.properties.iter().map(|p| p.deep_clone(bump)).collect(),
            loc: self.loc,
        }
    }
}

/// A property within a `@view-transition` rule.
pub enum ViewTransitionProperty {
    /// The `navigation` property.
    Navigation(Navigation),
    /// The `types` property. Script sets the same names, so a CSS module keeps them as written.
    Types(NoneOrCustomIdentList),
    /// An unknown or unsupported property.
    Custom(crate::css_properties::custom::CustomProperty),
}

impl ViewTransitionProperty {
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            ViewTransitionProperty::Navigation(navigation) => {
                dest.write_str("navigation")?;
                dest.delim(b':', false)?;
                navigation.to_css(dest)
            }
            ViewTransitionProperty::Types(types) => {
                dest.write_str("types")?;
                dest.delim(b':', false)?;
                types.to_css_with_options(dest, false)
            }
            ViewTransitionProperty::Custom(custom) => {
                custom.name.to_css(dest)?;
                dest.delim(b':', false)?;
                custom.value.to_css(dest, true)
            }
        }
    }

    fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        match self {
            Self::Navigation(navigation) => Self::Navigation(*navigation),
            Self::Types(types) => Self::Types(types.deep_clone(bump)),
            Self::Custom(custom) => Self::Custom(custom.deep_clone(bump)),
        }
    }
}

/// A value for the [navigation](https://drafts.csswg.org/css-view-transitions-2/#view-transition-navigation-descriptor) descriptor.
#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum Navigation {
    /// There will be no transition.
    None,
    /// The transition will be enabled if the navigation is same-origin.
    Auto,
}

pub(crate) struct ViewTransitionDeclarationParser {}

const _: () = {
    use crate::css_properties::custom::{CustomProperty, CustomPropertyName};
    use css::css_parser::{
        AtRuleParser, DeclarationParser, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{BasicParseErrorKind, Maybe, Parser, ParserOptions, ParserState, Result};

    impl DeclarationParser for ViewTransitionDeclarationParser {
        type Declaration = ViewTransitionProperty;

        fn parse_value(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            // As in `@font-face`, what does not parse is kept as `Custom`. lightningcss drops it.
            let state = input.state();
            crate::match_ignore_ascii_case! { name, {
                b"navigation" => if let Ok(navigation) = Navigation::parse(input) {
                    if input.expect_exhausted().is_ok() {
                        return Ok(ViewTransitionProperty::Navigation(navigation));
                    }
                },
                b"types" => if let Ok(types) = NoneOrCustomIdentList::parse(input) {
                    if input.expect_exhausted().is_ok() {
                        return Ok(ViewTransitionProperty::Types(types));
                    }
                },
                _ => {},
            }}

            input.reset(&state);
            let opts = ParserOptions::default(None);
            Ok(ViewTransitionProperty::Custom(CustomProperty::parse(
                CustomPropertyName::from_str(name),
                input,
                &opts,
            )?))
        }
    }

    impl RuleBodyItemParser for ViewTransitionDeclarationParser {
        fn parse_qualified(_this: &Self) -> bool {
            false
        }

        fn parse_declarations(_this: &Self) -> bool {
            true
        }
    }

    impl AtRuleParser for ViewTransitionDeclarationParser {
        type Prelude = ();
        type AtRule = ViewTransitionProperty;

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

    impl QualifiedRuleParser for ViewTransitionDeclarationParser {
        type Prelude = ();
        type QualifiedRule = ViewTransitionProperty;

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
