use crate as css;
use crate::css_rules::Location;
use crate::css_values::ident::DashedIdent;
use crate::css_values::syntax::SyntaxString;
use crate::{PrintErr, Printer};

// `ParsedComponent` is `#[cfg(any())]`-gated in values/syntax.rs (its variant
// payloads need the gated `properties::{transform,custom}` + `values::{image,
// color}` un-gates). Re-export when available; otherwise unit-stub so the
// `initial_value: Option<ParsedComponent>` field compiles. The `to_css`/`parse`
// bodies that touch its variants are gated below.
#[cfg(any())]
use crate::css_values::syntax::ParsedComponent;
#[cfg(not(any()))]
type ParsedComponent = ();

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
            // blocked_on: values/syntax.rs ParsedComponent un-gate (its variant
            // payloads need properties::{transform,custom} + values::{image,
            // color}). While gated, `ParsedComponent = ()` and `initial_value`
            // is never `Some` — panic loudly if that invariant is violated.
            #[cfg(any())]
            initial_value.to_css(dest)?;
            #[cfg(not(any()))]
            {
                let _ = initial_value;
                todo!("blocked_on: ParsedComponent::to_css — values/syntax.rs un-gate")
            }

            #[allow(unreachable_code)]
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
        // `#[cfg(any())]`-gated to `()`, `Option<()>` is `Copy` → identity;
        // once it un-gates, swap to `self.initial_value.as_ref().map(|v|
        // v.deep_clone(bump))` (values/syntax.rs already provides the
        // inherent impl).
        Self {
            name: self.name.deep_clone(bump),
            syntax: self.syntax.deep_clone(bump),
            inherits: self.inherits,
            #[cfg(any())]
            initial_value: self.initial_value.as_ref().map(|v| v.deep_clone(bump)),
            #[cfg(not(any()))]
            initial_value: self.initial_value,
            loc: self.loc,
        }
    }
}

// ─── PropertyRule parse ───────────────────────────────────────────────────
// blocked_on: RuleBodyParser, ParserInput, Parser::new signature,
// SyntaxString::{parse,parse_value}, ParsedComponent::TokenList,
// ParserError variants.
#[cfg(any())]
impl PropertyRule {
    pub fn parse(
        name: DashedIdent,
        input: &mut css::Parser,
        loc: Location,
    ) -> css::Result<PropertyRule> {
        use css::{ParserError, ParserInput, RuleBodyParser, TokenList};
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
            None => return Err(decl_parser.input.new_custom_error(ParserError::AtRuleBodyInvalid)),
        };
        let inherits: bool = match parser.inherits {
            Some(i) => i,
            None => return Err(decl_parser.input.new_custom_error(ParserError::AtRuleBodyInvalid)),
        };

        // `initial-value` is required unless the syntax is a universal definition.
        let initial_value = match syntax {
            SyntaxString::Universal => {
                if let Some(val) = parser.initial_value {
                    let mut i = ParserInput::new(val);
                    // TODO(port): Parser::new options/import_records params (None, default, None)
                    let mut p2 = css::Parser::new(&mut i, None, Default::default(), None);

                    if p2.is_exhausted() {
                        Some(ParsedComponent::TokenList(TokenList { v: Default::default() }))
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
                let mut p2 = css::Parser::new(&mut i, None, Default::default(), None);
                break 'brk match syntax.parse_value(&mut p2) {
                    Ok(vv) => Some(vv),
                    Err(e) => return Err(e),
                };
            }
        };

        Ok(PropertyRule { name, syntax, inherits, initial_value, loc })
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is reflection-based; replace with #[derive(DeepClone)] trait
        css::implement_deep_clone(self, bump)
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
//
// blocked_on: css::{DeclarationParser,RuleBodyItemParser,AtRuleParser,
// QualifiedRuleParser} trait signatures, SyntaxString::parse, Parser::
// {expect_ident,current_source_location,position,slice_from,next,
// new_custom_error,new_error}, ParserError variants, BasicParseErrorKind
// variants.
#[cfg(any())]
const _: () = {
    use bun_str::strings;
    use css::{BasicParseErrorKind, Maybe, Parser, ParserError, ParserState, Result};

    impl css::DeclarationParser for PropertyRuleDeclarationParser {
        type Declaration = ();

        // TODO(port): the Zig defines a ComptimeStringMap over FieldEnum but never uses it
        // (usage is commented out). Preserved the active if/else-if chain instead.
        fn parse_value(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Declaration> {
            // todo_stuff.match_ignore_ascii_case

            //   if (Map.getASCIIICaseInsensitive(
            //   name)) |field| {
            //     return switch (field) {
            //         .syntax => |syntax| {

            if strings::eql_case_insensitive_ascii_check_length(b"syntax", name) {
                let syntax = match SyntaxString::parse(input) {
                    Ok(vv) => vv,
                    Err(e) => return Err(e),
                };
                self.syntax = Some(syntax);
            } else if strings::eql_case_insensitive_ascii_check_length(b"inherits", name) {
                let location = input.current_source_location();
                let ident = match input.expect_ident() {
                    Ok(vv) => vv,
                    Err(e) => return Err(e),
                };
                let inherits = if strings::eql_case_insensitive_ascii_check_length(b"true", ident) {
                    true
                } else if strings::eql_case_insensitive_ascii_check_length(b"false", ident) {
                    false
                } else {
                    return Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
                };
                self.inherits = Some(inherits);
            } else if strings::eql_case_insensitive_ascii_check_length(b"initial-value", name) {
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

    impl css::RuleBodyItemParser for PropertyRuleDeclarationParser {
        fn parse_qualified(&self) -> bool {
            false
        }

        fn parse_declarations(&self) -> bool {
            true
        }
    }

    impl css::AtRuleParser for PropertyRuleDeclarationParser {
        type Prelude = ();
        type AtRule = ();

        fn parse_prelude(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Prelude> {
            Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
        }

        fn parse_block(
            &mut self,
            _prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::AtRule> {
            Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
        }

        fn rule_without_block(
            &mut self,
            _prelude: Self::Prelude,
            _start: &ParserState,
        ) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl css::QualifiedRuleParser for PropertyRuleDeclarationParser {
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
//   source:     src/css/rules/property.zig (225 lines)
//   confidence: medium
//   todos:      4
//   notes:      structs un-gated (data-only); Zig nested-struct namespaces ported as trait impls; initial_value:&'static [u8] until 'bump threaded; parse/to_css/deep_clone + parser-trait impls gated on RuleBodyParser/SyntaxString::parse_value/DeepClone
// ──────────────────────────────────────────────────────────────────────────
