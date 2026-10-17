use crate as css;
use crate::css_rules::Location;
use crate::css_values::ident::DashedIdent;
use crate::css_values::syntax::SyntaxString;
use crate::{PrintErr, Printer};

use crate::css_values::syntax::ParsedComponent;

pub struct PropertyRule {
    pub name: DashedIdent,
    pub(crate) syntax: SyntaxString,
    pub(crate) inherits: bool,
    pub(crate) initial_value: Option<ParsedComponent>,
    pub(crate) loc: Location,
}

impl PropertyRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@property ")?;
        super::dashed_ident_to_css(&self.name, dest)?;
        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();
        dest.newline()?;

        dest.write_str("syntax:")?;
        dest.whitespace()?;
        self.syntax.to_css(dest)?;
        dest.write_char(b';')?;
        dest.newline()?;

        dest.write_str("inherits:")?;
        dest.whitespace()?;
        if self.inherits {
            dest.write_str("true")?;
        } else {
            dest.write_str("false")?;
        }

        if let Some(initial_value) = &self.initial_value {
            dest.write_char(b';')?;
            dest.newline()?;

            dest.write_str("initial-value:")?;
            dest.whitespace()?;
            // Printed without the targets: they lower `light-dark()` to `var()`, not valid here.
            let targets = core::mem::take(&mut dest.targets);
            let result = initial_value.to_css(dest);
            dest.targets = targets;
            result?;

            if !dest.minify {
                dest.write_char(b';')?;
            }
        }

        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')
    }
}

impl PropertyRule {
    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // `SyntaxString` and `ParsedComponent` provide inherent
        // `deep_clone(&self, &Arena)` impls.
        Self {
            name: self.name.deep_clone(bump),
            syntax: self.syntax.deep_clone(bump),
            inherits: self.inherits,
            initial_value: self.initial_value.as_ref().map(|v| v.deep_clone(bump)),
            loc: self.loc,
        }
    }
}

// ─── PropertyRule parse ───────────────────────────────────────────────────
impl PropertyRule {
    pub(crate) fn parse(
        name: DashedIdent,
        input: &mut css::Parser,
        loc: Location,
    ) -> css::Result<PropertyRule> {
        use css::css_parser::RuleBodyParser;
        use css::{Delimiters, ParserError};
        let mut p = PropertyRuleDeclarationParser {
            syntax: None,
            inherits: None,
            initial_value: None,
        };

        // `RuleBodyParser` borrows `input`+`p`; re-borrow `input` after
        // dropping `decl_parser`.
        {
            let mut decl_parser = RuleBodyParser::new(input, &mut p);
            while let Some(decl) = decl_parser.next() {
                decl?;
            }
        }

        // `syntax` and `inherits` are always required.
        // TODO(zack): source clones these two, but I omitted here becaues it seems 100% unnecessary
        let syntax: SyntaxString = match p.syntax.take() {
            Some(s) => s,
            None => return Err(input.new_custom_error(ParserError::at_rule_body_invalid)),
        };
        let inherits: bool = match p.inherits {
            Some(i) => i,
            None => return Err(input.new_custom_error(ParserError::at_rule_body_invalid)),
        };

        // `initial-value` is required unless the syntax is a universal definition.
        let initial_value = match p.initial_value {
            Some(InitialValue {
                value: Some(value), ..
            }) => Some(value?),
            Some(InitialValue { start, value: None }) => {
                let mut end = input.state();
                input.reset(&start);
                let value =
                    input.parse_until_before(Delimiters::SEMICOLON, |i| syntax.parse_value(i))?;
                // `Parser::reset` drops the import records after the count of its state.
                end.import_record_count = input.state().import_record_count;
                input.reset(&end);
                Some(value)
            }
            None if matches!(syntax, SyntaxString::Universal) => None,
            None => return Err(input.new_custom_error(ParserError::at_rule_body_invalid)),
        };

        Ok(PropertyRule {
            name,
            syntax,
            inherits,
            initial_value,
            loc,
        })
    }
}

pub(crate) struct PropertyRuleDeclarationParser {
    pub syntax: Option<SyntaxString>,
    pub inherits: Option<bool>,
    pub initial_value: Option<InitialValue>,
}

/// The last `initial-value` descriptor of the body.
pub(crate) struct InitialValue {
    /// Where the value starts.
    start: css::ParserState,
    /// `None` until `syntax` is known: `PropertyRule::parse` then reads the value from `start`.
    value: Option<css::Result<ParsedComponent>>,
}

// Parser trait impls for `@property` rule bodies.
const _: () = {
    use css::css_parser::{
        AtRuleParser, DeclarationParser, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{BasicParseErrorKind, Maybe, Parser, ParserError, ParserState, Result};

    impl DeclarationParser for PropertyRuleDeclarationParser {
        type Declaration = ();

        fn parse_value(
            this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            crate::match_ignore_ascii_case! { name, {
                b"syntax" => {
                    this.syntax = Some(SyntaxString::parse(input)?);
                    // A value that was read under an earlier `syntax` is read again.
                    if let Some(initial_value) = &mut this.initial_value {
                        initial_value.value = None;
                    }
                },
                b"inherits" => {
                    let location = input.current_source_location();
                    let ident = input.expect_ident_cloned()?;
                    this.inherits = Some(crate::match_ignore_ascii_case! { ident, {
                        b"true" => true,
                        b"false" => false,
                        _ => return Err(location.new_unexpected_token_error(css::Token::Ident(ident))),
                    }});
                },
                b"initial-value" => {
                    let mut start = input.state();
                    if let Some(previous) = &this.initial_value {
                        // Drop the replaced value's import records. No other descriptor adds any.
                        start.import_record_count = previous.start.import_record_count;
                        input.reset(&start);
                    }
                    let value = match &this.syntax {
                        Some(syntax) => {
                            let result = syntax.parse_value(input);
                            if result.is_err() {
                                // The error counts only when no later value replaces this one.
                                input.reset(&start);
                                while input.next().is_ok() {}
                            }
                            Some(result)
                        }
                        None => {
                            while input.next().is_ok() {}
                            None
                        }
                    };
                    this.initial_value = Some(InitialValue { start, value });
                },
                _ => return Err(input.new_custom_error(ParserError::invalid_declaration)),
            }}

            Ok(())
        }
    }

    impl RuleBodyItemParser for PropertyRuleDeclarationParser {
        fn parse_qualified(_this: &Self) -> bool {
            false
        }

        fn parse_declarations(_this: &Self) -> bool {
            true
        }
    }

    impl AtRuleParser for PropertyRuleDeclarationParser {
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

    impl QualifiedRuleParser for PropertyRuleDeclarationParser {
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
