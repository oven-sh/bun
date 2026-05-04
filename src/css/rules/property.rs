use bun_css::{self as css, Parser, ParserInput, ParserState, Printer, PrintErr, TokenList};
use bun_css::{BasicParseErrorKind, ParserError, RuleBodyParser};
use bun_css::Result as CssResult;
use bun_css::Maybe as CssMaybe;
use bun_css::css_rules::Location;
use bun_css::css_values::ident::{DashedIdent, DashedIdentFns};
use bun_css::css_values::syntax::{ParsedComponent, SyntaxString};
use bun_str::strings;

pub struct PropertyRule {
    pub name: DashedIdent,
    pub syntax: SyntaxString,
    pub inherits: bool,
    pub initial_value: Option<ParsedComponent>,
    pub loc: Location,
}

impl PropertyRule {
    pub fn parse<'i>(
        name: DashedIdent,
        input: &mut Parser<'i, '_>,
        loc: Location,
    ) -> CssResult<'i, PropertyRule> {
        let mut p = PropertyRuleDeclarationParser {
            syntax: None,
            inherits: None,
            initial_value: None,
        };

        let mut decl_parser = RuleBodyParser::<PropertyRuleDeclarationParser>::new(input, &mut p);
        while let Some(decl) = decl_parser.next() {
            if let Err(e) = decl {
                return Err(e);
            }
        }

        // `syntax` and `inherits` are always required.
        let parser = decl_parser.parser;
        // TODO(zack): source clones these two, but I omitted here becaues it seems 100% unnecessary
        let syntax: SyntaxString = match parser.syntax {
            Some(s) => s,
            None => {
                return Err(decl_parser
                    .input
                    .new_custom_error(ParserError::AtRuleBodyInvalid))
            }
        };
        let inherits: bool = match parser.inherits {
            Some(i) => i,
            None => {
                return Err(decl_parser
                    .input
                    .new_custom_error(ParserError::AtRuleBodyInvalid))
            }
        };

        // `initial-value` is required unless the syntax is a universal definition.
        let initial_value = match syntax {
            SyntaxString::Universal => {
                if let Some(val) = parser.initial_value {
                    let mut i = ParserInput::new(val);
                    // TODO(port): Parser::new options/import_records params (None, default, None)
                    let mut p2 = Parser::new(&mut i, None, Default::default(), None);

                    if p2.is_exhausted() {
                        Some(ParsedComponent::TokenList(TokenList {
                            v: Default::default(),
                        }))
                    } else {
                        match syntax.parse_value(&mut p2) {
                            Ok(vv) => Some(vv),
                            Err(e) => return Err(e),
                        }
                    }
                } else {
                    None
                }
            }
            _ => 'brk: {
                let Some(val) = parser.initial_value else {
                    return Err(input.new_custom_error(ParserError::AtRuleBodyInvalid));
                };
                let mut i = ParserInput::new(val);
                // TODO(port): Parser::new options/import_records params (None, default, None)
                let mut p2 = Parser::new(&mut i, None, Default::default(), None);
                break 'brk match syntax.parse_value(&mut p2) {
                    Ok(vv) => Some(vv),
                    Err(e) => return Err(e),
                };
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@property ")?;
        DashedIdentFns::to_css(&self.name, dest)?;
        dest.whitespace()?;
        dest.write_char('{')?;
        dest.indent();
        dest.newline()?;

        dest.write_str("syntax:")?;
        dest.whitespace()?;
        self.syntax.to_css(dest)?;
        dest.write_char(';')?;
        dest.newline()?;

        dest.write_str("inherits:")?;
        dest.whitespace()?;
        if self.inherits {
            dest.write_str("true")?;
        } else {
            dest.write_str("false")?;
        }

        if let Some(initial_value) = &self.initial_value {
            dest.write_char(';')?;
            dest.newline()?;

            dest.write_str("initial-value:")?;
            dest.whitespace()?;
            initial_value.to_css(dest)?;

            if !dest.minify {
                dest.write_char(';')?;
            }
        }

        dest.dedent();
        dest.newline()?;
        dest.write_char('}')
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is reflection-based; replace with #[derive(DeepClone)] trait
        css::implement_deep_clone(self, bump)
    }
}

// PORT NOTE: 'i borrows the parser input buffer for `initial_value` (arena-backed in CSS crate).
pub struct PropertyRuleDeclarationParser<'i> {
    pub syntax: Option<SyntaxString>,
    pub inherits: Option<bool>,
    pub initial_value: Option<&'i [u8]>,
}

// PORT NOTE: Zig's nested `pub const DeclarationParser = struct { ... }` namespaces are
// structural duck-typing for RuleBodyParser; in Rust these become trait impls.

impl<'i> css::DeclarationParser<'i> for PropertyRuleDeclarationParser<'i> {
    type Declaration = ();

    // TODO(port): the Zig defines a ComptimeStringMap over FieldEnum but never uses it
    // (usage is commented out). Preserved the active if/else-if chain instead.
    fn parse_value(
        &mut self,
        name: &[u8],
        input: &mut Parser<'i, '_>,
    ) -> CssResult<'i, Self::Declaration> {
        // todo_stuff.match_ignore_ascii_case

        //   if (Map.getASCIIICaseInsensitive(
        //   name)) |field| {
        //     return switch (field) {
        //         .syntax => |syntax| {

        if strings::eql_case_insensitive_asciii_check_length(b"syntax", name) {
            let syntax = match SyntaxString::parse(input) {
                Ok(vv) => vv,
                Err(e) => return Err(e),
            };
            self.syntax = Some(syntax);
        } else if strings::eql_case_insensitive_asciii_check_length(b"inherits", name) {
            let location = input.current_source_location();
            let ident = match input.expect_ident() {
                Ok(vv) => vv,
                Err(e) => return Err(e),
            };
            let inherits = if strings::eql_case_insensitive_asciii_check_length(b"true", ident) {
                true
            } else if strings::eql_case_insensitive_asciii_check_length(b"false", ident) {
                false
            } else {
                return Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
            };
            self.inherits = Some(inherits);
        } else if strings::eql_case_insensitive_asciii_check_length(b"initial-value", name) {
            // Buffer the value into a string. We will parse it later.
            let start = input.position();
            while input.next().is_ok() {}
            let initial_value = input.slice_from(start);
            self.initial_value = Some(initial_value);
        } else {
            return Err(input.new_custom_error(ParserError::InvalidDeclaration));
        }

        Ok(())
    }
}

impl<'i> css::RuleBodyItemParser<'i> for PropertyRuleDeclarationParser<'i> {
    fn parse_qualified(&self) -> bool {
        false
    }

    fn parse_declarations(&self) -> bool {
        true
    }
}

impl<'i> css::AtRuleParser<'i> for PropertyRuleDeclarationParser<'i> {
    type Prelude = ();
    type AtRule = ();

    fn parse_prelude(
        &mut self,
        name: &[u8],
        input: &mut Parser<'i, '_>,
    ) -> CssResult<'i, Self::Prelude> {
        Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
    }

    fn parse_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &ParserState,
        input: &mut Parser<'i, '_>,
    ) -> CssResult<'i, Self::AtRule> {
        Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
    }

    fn rule_without_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &ParserState,
    ) -> CssMaybe<Self::AtRule, ()> {
        Err(())
    }
}

impl<'i> css::QualifiedRuleParser<'i> for PropertyRuleDeclarationParser<'i> {
    type Prelude = ();
    type QualifiedRule = ();

    fn parse_prelude(&mut self, input: &mut Parser<'i, '_>) -> CssResult<'i, Self::Prelude> {
        Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }

    fn parse_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &ParserState,
        input: &mut Parser<'i, '_>,
    ) -> CssResult<'i, Self::QualifiedRule> {
        Err(input.new_error(BasicParseErrorKind::QualifiedRuleInvalid))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/property.zig (225 lines)
//   confidence: medium
//   todos:      4
//   notes:      Zig nested-struct namespaces ported as trait impls; 'i lifetime added for arena-borrowed input slice; deep_clone needs derive
// ──────────────────────────────────────────────────────────────────────────
