//! Highlights the expressions of Angular.
//!
//! The parser makes no tree and gives up at the first error, so this goes by the tokens of the lexer, which never stops,
//! and by the tokens next to each.

use super::lexer::{Kind, Token as Lexed, tokenize_with};
use super::parser::{comment_start, starts_with_arrow_function};
use crate::highlight::{Spans, Token};
use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Syntax {
    /// `[a]="b | c: d"`, `(a)="b = c; d()"`, `{{ a }}`, `@let a = b;`
    Expression,
    /// `*ngFor="let a of b; trackBy: c"`, `@for (a of b; track a.c)`, `@if (a; as b)`
    Microsyntax,
    /// `@defer (on timer(5s); prefetch on idle)`, `@placeholder (minimum 500ms)`
    Triggers,
}

/// What is allocated for one expression, and used again for the next.
#[derive(Default)]
pub(crate) struct Scratch {
    tokens: Vec<Lexed>,
    odd_blanks: Vec<u32>,
    /// The brackets that are open: `(`, `[`, `{`, and `$` for `${`.
    open: Vec<u8>,
}

/// A name that starts a part of `*ngFor="let a of b; trackBy: c"`. `next`: the token behind it.
fn key(name: &[u8], next: Option<(Kind, &[u8])>) -> Token {
    match (name, next) {
        (_, Some((Kind::Character(b':'), _))) => Token::Property,
        // `index as i`, and the `b` of `let a = $index, b = $even`
        (_, Some((Kind::Keyword, b"as") | (Kind::Operator, b"="))) => Token::Variable,
        (b"of", _) => Token::KeywordOperator,
        (b"then", _) => Token::KeywordControl,
        _ => Token::Keyword,
    }
}

fn keyword(word: &[u8]) -> Token {
    match word {
        b"null" | b"undefined" => Token::ConstantBuiltin,
        b"true" | b"false" => Token::Boolean,
        b"this" => Token::VariableBuiltin,
        b"if" | b"else" => Token::KeywordControl,
        b"let" | b"var" => Token::Keyword,
        _ => Token::KeywordOperator,
    }
}

/// Adds a string, which starts at `at`, and its escape sequences on top of it.
fn add_string(text: &[u8], at: u32, spans: &mut Spans) {
    spans.add(at, at + text.len() as u32, Token::String);
    let mut from = 0;
    while let Some(escape) = text
        .get(from..)
        .and_then(|rest| strings::index_of_char_usize(rest, b'\\'))
        .map(|found| from + found)
    {
        let escaped = text.get(escape + 1..).unwrap_or_default();
        let len = match escaped {
            [b'u', hex @ ..] => {
                1 + hex
                    .iter()
                    .take(4)
                    .take_while(|it| it.is_ascii_hexdigit())
                    .count()
            }
            [first, ..] => usize::from(strings::utf8_byte_sequence_length(*first)).max(1),
            [] => 0,
        };
        from = (escape + 1 + len).min(text.len());
        spans.add(at + escape as u32, at + from as u32, Token::StringEscape);
    }
}

/// Highlights `code`, which starts at `at`.
pub(crate) fn highlight(
    code: &[u8],
    at: u32,
    syntax: Syntax,
    scratch: &mut Scratch,
    spans: &mut Spans,
) {
    let Scratch {
        tokens,
        odd_blanks,
        open,
    } = scratch;
    tokens.clear();
    odd_blanks.clear();
    open.clear();
    let comment = match syntax {
        Syntax::Expression => comment_start(code),
        _ => None,
    };
    tokenize_with(
        code.get(..comment.unwrap_or(code.len())).unwrap_or(code),
        true,
        tokens,
        odd_blanks,
    );
    let text_of = |token: &Lexed| {
        code.get(token.start as usize..token.end as usize)
            .unwrap_or_default()
    };

    let mut previous: Option<(Lexed, &[u8])> = None;
    // The last token ends something with a value: `a`, `1`, `)`.
    let mut is_after_operand = false;
    // The last token is a `;` or a `,` in no bracket.
    let mut is_after_separator = false;
    // The last token is `let` or `as`.
    let mut is_declared = false;
    // In the `(a, b)` of `(a, b) => c`.
    let mut is_in_parameters = false;
    // The last token is the `}` of `${a}`.
    let mut continues_template = false;

    for (index, token) in tokens.iter().enumerate() {
        let text = text_of(token);
        let next = tokens.get(index + 1).map(|next| (next.kind, text_of(next)));
        let is_called = matches!(next, Some((Kind::Character(b'('), _)));
        let previous_kind = previous.map(|(it, text)| (it.kind, text));
        let (was_after_operand, was_after_separator, was_declared) = (
            std::mem::take(&mut is_after_operand),
            std::mem::take(&mut is_after_separator),
            std::mem::take(&mut is_declared),
        );
        let start = at + token.start;
        let found = match token.kind {
            _ if std::mem::take(&mut continues_template) => {
                is_after_operand = token.kind == Kind::TemplateEnd;
                add_string(text, start, spans);
                None
            }
            Kind::String | Kind::TemplatePart | Kind::TemplateEnd => {
                is_after_operand = token.kind != Kind::TemplatePart;
                add_string(text, start, spans);
                None
            }
            // An unclosed string.
            Kind::Error if matches!(text, [b'"' | b'\'' | b'`', ..]) => {
                add_string(text, start, spans);
                None
            }
            Kind::Error => match text {
                [b'/', ..] => Some(Token::StringRegexp),
                [b'0'..=b'9', ..] | [b'.', b'0'..=b'9', ..] => Some(Token::Number),
                _ => None,
            },
            Kind::Number => {
                is_after_operand = true;
                Some(Token::Number)
            }
            Kind::RegExpBody | Kind::RegExpFlags => {
                is_after_operand = true;
                Some(Token::StringRegexp)
            }
            Kind::Operator => Some(match text {
                b"${" => {
                    open.push(b'$');
                    Token::PunctuationSpecial
                }
                b"?." => Token::PunctuationDelimiter,
                _ => Token::Operator,
            }),
            Kind::Character(byte @ (b'(' | b'[' | b'{')) => {
                is_in_parameters |= byte == b'('
                    && starts_with_arrow_function(code, tokens.get(index..).unwrap_or_default());
                open.push(byte);
                Some(Token::PunctuationBracket)
            }
            Kind::Character(byte @ (b')' | b']')) => {
                is_in_parameters = false;
                is_after_operand = true;
                if open.last() == Some(&if byte == b')' { b'(' } else { b'[' }) {
                    open.pop();
                }
                Some(Token::PunctuationBracket)
            }
            Kind::Character(b'}') => {
                // The lexer only tracks braces, so a `}` also closes a `(` or `[` that is still open inside.
                let mut opening = open.pop();
                while matches!(opening, Some(b'(' | b'[')) {
                    opening = open.pop();
                }
                continues_template = opening == Some(b'$');
                is_after_operand = !continues_template;
                Some(match continues_template {
                    true => Token::PunctuationSpecial,
                    false => Token::PunctuationBracket,
                })
            }
            Kind::Character(byte) => {
                is_after_separator = matches!(byte, b';' | b',') && open.is_empty();
                Some(Token::PunctuationDelimiter)
            }
            Kind::PrivateIdentifier => {
                is_after_operand = true;
                Some(Token::Property)
            }
            // `a.b`, `a?.b()`
            Kind::Identifier | Kind::Keyword
                if matches!(
                    previous_kind,
                    Some((Kind::Character(b'.'), _) | (Kind::Operator, b"?."))
                ) =>
            {
                is_after_operand = true;
                Some(match is_called {
                    true => Token::FunctionMethod,
                    false => Token::Property,
                })
            }
            // `{ a: b }`
            Kind::Identifier | Kind::Keyword
                if open.last() == Some(&b'{')
                    && matches!(previous_kind, Some((Kind::Character(b'{' | b','), _)))
                    && matches!(next, Some((Kind::Character(b':'), _))) =>
            {
                Some(Token::Property)
            }
            Kind::Keyword => {
                let found = keyword(text);
                is_declared = matches!(text, b"let" | b"var" | b"as");
                is_after_operand = matches!(
                    found,
                    Token::ConstantBuiltin | Token::Boolean | Token::VariableBuiltin
                );
                Some(found)
            }
            Kind::Identifier => {
                is_after_operand = true;
                let is_at_top = open.is_empty();
                Some(if was_declared {
                    Token::Variable
                } else if previous
                    .is_some_and(|(it, _)| it.kind == Kind::Number && it.end == token.start)
                {
                    Token::NumberUnit
                } else if syntax == Syntax::Microsyntax
                    && is_at_top
                    && (was_after_operand || was_after_separator)
                {
                    let found = key(text, next);
                    is_after_operand = found == Token::Variable;
                    found
                } else if syntax == Syntax::Triggers
                    && is_at_top
                    && matches!(
                        text,
                        b"on"
                            | b"when"
                            | b"prefetch"
                            | b"hydrate"
                            | b"never"
                            | b"minimum"
                            | b"after"
                    )
                {
                    is_after_operand = false;
                    Token::Keyword
                } else if is_called || matches!(previous_kind, Some((Kind::Operator, b"|"))) {
                    Token::Function
                } else if is_in_parameters
                    || starts_with_arrow_function(code, tokens.get(index..).unwrap_or_default())
                {
                    Token::VariableParameter
                } else if matches!(
                    text,
                    b"$event" | b"$index" | b"$count" | b"$first" | b"$last" | b"$even" | b"$odd"
                ) {
                    Token::VariableBuiltin
                } else {
                    Token::Variable
                })
            }
        };
        if let Some(found) = found {
            spans.add(start, at + token.end, found);
        }
        previous = Some((*token, text));
    }
    if let Some(comment) = comment {
        let text = strings::trim_js_whitespace_end(code.get(comment..).unwrap_or_default());
        spans.add_range(
            at as usize + comment..at as usize + comment + text.len(),
            Token::Comment,
        );
    }
}
