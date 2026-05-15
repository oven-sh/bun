use crate as css;
use crate::css_rules::Location;
use crate::css_values::ident::DashedIdent;
use crate::css_values::syntax::SyntaxString;
use crate::{PrintErr, Printer};

use crate::css_values::syntax::ParsedComponent;

pub struct PropertyRule {
    pub name: DashedIdent,
    pub syntax: SyntaxString,
    pub inherits: bool,
    pub initial_value: Option<ParsedComponent>,
    pub loc: Location,
}

impl PropertyRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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
            initial_value.to_css(dest)?;

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
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `SyntaxString` has an
        // inherent `deep_clone(&self, &Arena)`. While `ParsedComponent` is
        // ``-gated to `()`, `Option<()>` is `Copy` → identity;
        // once it un-gates, swap to `self.initial_value.as_ref().map(|v|
        // v.deep_clone(bump))` (values/syntax.rs already provides the
        // inherent impl).
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
    pub fn parse(
        name: DashedIdent,
        input: &mut css::Parser,
        loc: Location,
    ) -> css::Result<PropertyRule> {
        use css::css_parser::{ParserOpts, RuleBodyParser};
        use css::{ParserError, ParserInput, TokenList};
        let mut p = PropertyRuleDeclarationParser {
            syntax: None,
            inherits: None,
            initial_value: None,
        };

        // PORT NOTE: split the borrows — `RuleBodyParser` borrows `input`+`p`;
        // we re-borrow `input` after dropping `decl_parser`.
        {
            let mut decl_parser = RuleBodyParser::new(input, &mut p);
            while let Some(decl) = decl_parser.next() {
                if let Err(e) = decl {
                    return Err(e);
                }
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

        // SAFETY: `Tokenizer<'a>` owns `arena: &'a Bump`; the arena outlives
        // the sub-`ParserInput` constructed below. `'static` is the crate-wide
        // erasure (PORTING.md §AST crates).
        let bump: &'static bun_alloc::Arena =
            unsafe { &*std::ptr::from_ref::<bun_alloc::Arena>(input.arena()) };

        // `initial-value` is required unless the syntax is a universal definition.
        let initial_value = match syntax {
            SyntaxString::Universal => {
                if let Some(val) = p.initial_value {
                    let mut i = ParserInput::new(val, bump);
                    let mut p2 = css::Parser::new(&mut i, None, ParserOpts::default(), None);

                    if p2.is_exhausted() {
                        Some(ParsedComponent::TokenList(TokenList {
                            v: Default::default(),
                        }))
                    } else {
                        Some(syntax.parse_value(&mut p2)?)
                    }
                } else {
                    None
                }
            }
            _ => {
                let Some(val) = p.initial_value else {
                    return Err(input.new_custom_error(ParserError::at_rule_body_invalid));
                };
                let mut i = ParserInput::new(val, bump);
                let mut p2 = css::Parser::new(&mut i, None, ParserOpts::default(), None);
                Some(syntax.parse_value(&mut p2)?)
            }
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

// PORT NOTE: borrows the parser input buffer for `initial_value` (arena-backed
// in CSS crate). Phase A keeps `&'static [u8]` per PORTING.md §AST crates;
// Phase B re-threads `'i`.
pub struct PropertyRuleDeclarationParser {
    pub syntax: Option<SyntaxString>,
    pub inherits: Option<bool>,
    pub initial_value: Option<&'static [u8]>,
}

// PORT NOTE: Zig's nested `pub const DeclarationParser = struct { ... }`
// namespaces are structural duck-typing for RuleBodyParser; in Rust these
// become trait impls.
const _: () = {
    use bun_core::strings;
    use css::css_parser::{
        AtRuleParser, DeclarationParser, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{BasicParseErrorKind, Maybe, Parser, ParserError, ParserState, Result};

    impl DeclarationParser for PropertyRuleDeclarationParser {
        type Declaration = ();

        // TODO(port): the Zig defines a ComptimeStringMap over FieldEnum but never uses it
        // (usage is commented out). Preserved the active if/else-if chain instead.
        fn parse_value(
            this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            crate::match_ignore_ascii_case! { name, {
                b"syntax" => {
                    this.syntax = Some(SyntaxString::parse(input)?);
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
                    // Buffer the value into a string. We will parse it later.
                    let start = input.position();
                    while input.next().is_ok() {}
                    let initial_value = input.slice_from_cloned(start);
                    this.initial_value = Some(initial_value);
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

// ported from: src/css/rules/property.zig
