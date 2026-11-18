use bun_alloc::AllocError;
use bun_engine_text::{CodeUnit, StringBuilder, StringRef, Text, with_text};

use super::Source;
use super::token::{Lexed, Malformed, Token, lex};
use crate::{Cx, Thrown};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Expected {
    Value,
    /// In an array that is not empty.
    Element,
    /// After a comma.
    Key,
    Colon,
    ClosingBrace,
    ClosingBracket,
    EndOfText,
    EndOfPrimitive,
}

/// The token at `at` is malformed or is not what has to be there.
#[derive(Clone, Copy)]
pub(super) struct SyntaxError {
    pub(super) at: usize,
    pub(super) expected: Expected,
}

impl SyntaxError {
    #[cold]
    pub(super) fn throw(self, cx: &Cx, source: Source<'_>) -> Thrown {
        let message = self.with_rest(source, |rest| {
            with_text!(rest, |units| describe(units, self.expected))
        });
        match message {
            Ok(message) => cx.throw_syntax_error(message),
            Err(AllocError) => cx.throw_out_of_memory(),
        }
    }

    /// Whether the text ends before it is clear that no other could make it valid.
    pub(super) fn is_at_end(self, source: Source<'_>) -> Result<bool, AllocError> {
        self.with_rest(source, |rest| with_text!(rest, |units| is_last(units)))
    }

    /// Lends the characters from the token on.
    fn with_rest<R>(
        self,
        source: Source<'_>,
        read: impl FnOnce(Text<'_>) -> R,
    ) -> Result<R, AllocError> {
        Ok(match source {
            Source::Text(text) => read(text.slice_from(self.at)),
            Source::Utf8(bytes) => read(StringRef::try_from_utf8_lossy(&bytes[self.at..])?.text()),
        })
    }
}

fn is_last<T: CodeUnit>(units: &[T]) -> bool {
    let Lexed { end, token, .. } = lex(units, 0);
    end == units.len()
        || (token == Err(Malformed::ShortUnicodeEscape)
            && (units[end + 1..].iter()).all(|unit| unit.digit_value(16).is_some()))
}

/// Of the first token.
fn describe<T: CodeUnit>(units: &[T], expected: Expected) -> StringBuilder {
    const LONGEST_IDENTIFIER: usize = 200;
    let Lexed { start, end, token } = lex(units, 0);
    let mut message = StringBuilder::new();
    message.push_ascii("JSON Parse error: ");
    let mut quote = |before: &str, quoted: &[T], after: &str| {
        message.push_ascii(before);
        message.push_units(quoted);
        message.push_ascii(after);
    };
    let token = match token {
        Ok(token) => token,
        Err(malformed) => {
            match malformed {
                Malformed::Fixed(text) => quote(text, &[], ""),
                Malformed::UnknownCharacter => {
                    quote("Unrecognized token '", &units[end..end + 1], "'");
                }
                Malformed::UnknownEscape => {
                    quote("Invalid escape character ", &units[end..end + 1], "");
                }
                Malformed::ShortUnicodeEscape => {
                    quote("\\u must be followed by 4 hex digits", &[], "");
                }
                Malformed::BadUnicodeEscape => {
                    let escape = &units[end..end + "uXXXX".len()];
                    quote("\"\\", escape, "\" is not a valid unicode escape");
                }
            }
            return message;
        }
    };
    let text = match (expected, token) {
        (Expected::Element, Token::Punctuator(b']')) => {
            "Unexpected comma at the end of array expression"
        }
        (Expected::Value | Expected::Element, Token::End) => "Unexpected EOF",
        (Expected::Value | Expected::Element, Token::Identifier) => {
            let shown = end.min(start + LONGEST_IDENTIFIER);
            let after = if shown == end { "\"" } else { "...\"" };
            quote("Unexpected identifier \"", &units[start..shown], after);
            return message;
        }
        (
            Expected::Value | Expected::Element,
            Token::Punctuator(b'[' | b'{') | Token::Primitive,
        ) => "Could not parse value expression",
        (Expected::Value | Expected::Element, Token::Punctuator(_)) => {
            quote("Unexpected token '", &units[start..end], "'");
            return message;
        }
        (Expected::Key, _) => "Property name must be a string literal",
        (Expected::Colon, _) => "Expected ':' before value in object property definition",
        (Expected::ClosingBrace, _) => "Expected '}'",
        (Expected::ClosingBracket, _) => "Expected ']'",
        (Expected::EndOfText, _) => "Unable to parse JSON string",
        (Expected::EndOfPrimitive, _) => "Unexpected content at end of JSON literal",
    };
    message.push_ascii(text);
    message
}
