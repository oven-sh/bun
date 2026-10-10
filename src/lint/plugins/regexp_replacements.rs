#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/utils/replacements-utils.ts` of eslint-plugin-regexp, and `parseReplacements` of its
//! `lib/utils/ast-utils/utils.ts`: what the second argument of `String.prototype.replace` says.

use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::char_source::parse_string_literal;

/// upstream's `ref`: a number or a string.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum ReplacementRef {
    Index(u32),
    Name(Vec<u8>),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum ReplacementElement {
    /// upstream's `CharacterElement`. `value` is one code point.
    Character { value: Vec<u8>, range: Span },
    /// upstream's `DollarElement`. `kind` is one of `` $ & ` ' ``.
    Dollar { kind: u8, range: Span },
    /// upstream's `ReferenceElement`: `$1`, `$01`, `$<name>`.
    Reference {
        reference: ReplacementRef,
        ref_text: Vec<u8>,
        range: Span,
    },
}

impl ReplacementElement {
    pub(crate) fn range(&self) -> Span {
        match *self {
            ReplacementElement::Character { range, .. }
            | ReplacementElement::Dollar { range, .. }
            | ReplacementElement::Reference { range, .. } => range,
        }
    }
}

/// upstream's `E`, whose `value` is one code point, with what its `getData` reads.
#[derive(Copy, Clone)]
struct Token {
    value: u32,
    range: Span,
}

impl Token {
    fn is(self, character: u8) -> bool {
        self.value == u32::from(character)
    }

    /// The digit, if `/^\d$/u.test(value)`.
    fn digit(self) -> Option<u32> {
        char::from_u32(self.value)?.to_digit(10)
    }
}

/// `tokens.map((c) => c.value).join("")`
fn values(tokens: &[Token]) -> Vec<u8> {
    let mut joined = Vec::with_capacity(tokens.len());
    for token in tokens {
        strings::push_codepoint_wtf8_joined(&mut joined, token.value);
    }
    joined
}

/// upstream's `parseReplacementsForString`. The ranges are empty.
pub(crate) fn parse_replacements_for_string(text: &[u8]) -> Vec<ReplacementElement> {
    let chars: Vec<Token> = strings::wtf8_codepoints(text)
        .map(|(_, value)| Token {
            value,
            range: Span::default(),
        })
        .collect();
    base_parse_replacements(&chars)
}

/// What the functions inside upstream's `baseParseReplacements` share.
struct Parser<'t> {
    chars: &'t [Token],
    index: usize,
    elements: Vec<ReplacementElement>,
    /// A `$<` has looked for its `>` up to the end: the next ones need not.
    unclosed: bool,
}

/// upstream's `baseParseReplacements`
fn base_parse_replacements(chars: &[Token]) -> Vec<ReplacementElement> {
    let mut parser = Parser {
        chars,
        index: 0,
        elements: Vec::new(),
        unclosed: false,
    };
    while let Some(token) = parser.next_char() {
        if token.is(b'$')
            && let Some(next) = parser.next_char()
        {
            if let Ok(kind @ (b'$' | b'&' | b'`' | b'\'')) = u8::try_from(next.value) {
                parser.elements.push(ReplacementElement::Dollar {
                    kind,
                    range: token.range.to(next.range),
                });
                continue;
            }
            if parser.parse_number_ref(token, next) {
                continue;
            }
            if parser.parse_named_ref(token, next) {
                continue;
            }
            parser.index -= 1;
        }
        parser.elements.push(ReplacementElement::Character {
            value: values(&[token]),
            range: token.range,
        });
    }
    parser.elements
}

impl Parser<'_> {
    /// `chars[index++]`: past the end too, so that the `0` of a `$0` at the end is no element.
    fn next_char(&mut self) -> Option<Token> {
        let token = self.chars.get(self.index).copied();
        self.index += 1;
        token
    }

    fn parse_number_ref(&mut self, dollar_token: Token, start_token: Token) -> bool {
        let Some(reference) = start_token.digit() else {
            return false;
        };
        if reference == 0 {
            // 01 - 09. Not 10 - 99: they may be 1 - 9 and a digit.
            if let Some(next) = self.next_char() {
                if let Some(reference @ 1..=9) = next.digit() {
                    self.elements.push(ReplacementElement::Reference {
                        reference: ReplacementRef::Index(reference),
                        ref_text: values(&[start_token, next]),
                        range: dollar_token.range.to(next.range),
                    });
                    return true;
                }
                self.index -= 1;
            }
            return false;
        }
        self.elements.push(ReplacementElement::Reference {
            reference: ReplacementRef::Index(reference),
            ref_text: values(&[start_token]),
            range: dollar_token.range.to(start_token.range),
        });
        true
    }

    fn parse_named_ref(&mut self, dollar_token: Token, start_token: Token) -> bool {
        if !start_token.is(b'<') || self.unclosed {
            return false;
        }
        let start_index = self.index;
        while let Some(t) = self.next_char() {
            if t.is(b'>') {
                let ref_chars = self.chars.get(start_index..self.index - 1);
                let reference = values(ref_chars.unwrap_or_default());
                self.elements.push(ReplacementElement::Reference {
                    ref_text: reference.clone(),
                    reference: ReplacementRef::Name(reference),
                    range: dollar_token.range.to(t.range),
                });
                return true;
            }
        }
        self.unclosed = true;
        self.index = start_index;
        false
    }
}

/// upstream's `parseReplacements`. `node` is a string literal. The ranges are places in the file.
pub(crate) fn parse_replacements(node: Expr<'_>) -> Vec<ReplacementElement> {
    if node.tag() != ExprTag::String {
        return Vec::new();
    }
    let literal = node.span();
    let mut tokens: Vec<Token> = Vec::new();
    let mut previous = Span::empty(literal.start + 1);
    for unit in parse_string_literal(node.text()) {
        let range = Span::new(literal.start + unit.start, literal.start + unit.end);
        // The two halves of a surrogate pair that is written as one character or one escape.
        if range == previous
            && let Some(last) = tokens.last_mut()
            && let Some(pair) = strings::decode_surrogate_pair(last.value as u16, unit.code_unit)
        {
            last.value = pair;
            continue;
        }
        push_escaped_separators(&mut tokens, node.file(), previous.between(range));
        tokens.push(Token {
            value: u32::from(unit.code_unit),
            range,
        });
        previous = range;
    }
    push_escaped_separators(&mut tokens, node.file(), Span::after(previous, literal.end));
    base_parse_replacements(&tokens)
}

/// `between` has line continuations only. upstream's tokenizer takes a `\` before U+2028 or U+2029
/// for the escape of that character: these alone have the byte 0xE2.
fn push_escaped_separators(tokens: &mut Vec<Token>, file: &File<'_>, between: Span) {
    let mut rest = between;
    while let Some(at) = strings::index_of_char_usize(file.slice(rest), 0xE2) {
        let (value, size) = strings::wtf8_codepoint_at(file.slice(rest), at);
        let separator = Span::new(rest.start + at as u32, rest.start + (at + size) as u32);
        tokens.push(Token {
            value,
            range: Span::new(separator.start.saturating_sub(1), separator.end),
        });
        rest.start = separator.end;
    }
}
