//! <https://urlpattern.spec.whatwg.org/#tokenizing>

use core::ops::Range;

use bun_collections::smallvec::SmallVec;
use bun_core::{EncodedSlice, strings};

use super::PatternError;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum TokenType {
    Open,
    Close,
    Regexp,
    Name,
    Char,
    EscapedChar,
    OtherModifier,
    Asterisk,
    End,
    InvalidChar,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Policy {
    Strict,
    Lenient,
}

/// Positions are in code units of a string, which has fewer than 2^31.
#[derive(Clone, Copy)]
pub(super) struct Token {
    pub(super) kind: TokenType,
    index: u32,
    value_start: u32,
    value_end: u32,
}

impl Token {
    fn new(kind: TokenType, index: usize, value: Range<usize>) -> Self {
        Self {
            kind,
            index: index as u32,
            value_start: value.start as u32,
            value_end: value.end as u32,
        }
    }

    pub(super) fn index(self) -> usize {
        self.index as usize
    }

    pub(super) fn value(self) -> Range<usize> {
        self.value_start as usize..self.value_end as usize
    }
}

pub(super) type Tokens = SmallVec<[Token; 64]>;

/// WebKit's list holds as many bytes as a string has characters, which bounds what the URL parser is then given.
const WEBKIT_TOKEN_SIZE: usize = 40;

const NOTHING_TO_ESCAPE: PatternError =
    PatternError::Type("No character is provided after escape.");
const NOT_ASCII: PatternError = PatternError::Type("Current codepoint is not ascii");

/// <https://urlpattern.spec.whatwg.org/#is-a-valid-name-code-point>
pub(super) fn is_valid_name_code_point(code_point: u32, is_first: bool) -> bool {
    if code_point == u32::from(b'_') || code_point == u32::from(b'$') {
        return true;
    }
    if is_first {
        return strings::is_id_start(code_point);
    }
    strings::is_id_continue(code_point) || code_point == 0x200c || code_point == 0x200d
}

/// The code point at `position`, and the position after it.
fn code_point_at(input: EncodedSlice<'_>, position: usize) -> (u32, usize) {
    let unit = input.char_at(position);
    let next = position + 1;
    if strings::u16_is_lead(unit)
        && next < input.len
        && let Some(code_point) = strings::decode_surrogate_pair(unit, input.char_at(next))
    {
        return (code_point, next + 1);
    }
    (u32::from(unit), next)
}

fn ascii_at(input: EncodedSlice<'_>, position: usize) -> Option<u8> {
    u8::try_from(input.char_at(position))
        .ok()
        .filter(u8::is_ascii)
}

fn name_end(input: EncodedSlice<'_>, start: usize) -> Result<usize, PatternError> {
    let mut position = start;
    while position < input.len {
        let (code_point, next) = code_point_at(input, position);
        if !is_valid_name_code_point(code_point, position == start) {
            break;
        }
        position = next;
    }
    if position == start {
        return Err(PatternError::EmptyName(start));
    }
    Ok(position)
}

/// The position of the `)` that closes the group whose contents begin at `start`.
fn regexp_end(input: EncodedSlice<'_>, start: usize) -> Result<usize, PatternError> {
    let mut depth = 1usize;
    let mut position = start;
    while position < input.len {
        let is_last = position == input.len - 1;
        match ascii_at(input, position).ok_or(NOT_ASCII)? {
            b'?' if position == start => {
                return Err(PatternError::Type("Regex cannot start with modifier."));
            }
            b'\\' if is_last => return Err(NOTHING_TO_ESCAPE),
            b'\\' => {
                position += 1;
                ascii_at(input, position).ok_or(NOT_ASCII)?;
            }
            b')' if depth == 1 => return Ok(position),
            b')' => depth -= 1,
            b'(' if is_last => {
                return Err(PatternError::Type(
                    "No closing token is provided by end of string.",
                ));
            }
            b'(' if ascii_at(input, position + 1) != Some(b'?') => {
                return Err(PatternError::Type(
                    "Required OtherModifier token is not provided in regex.",
                ));
            }
            b'(' => depth += 1,
            _ => {}
        }
        position += 1;
    }
    Err(PatternError::Type(
        "Current open token does not have a corresponding close token.",
    ))
}

fn token_at(input: EncodedSlice<'_>, index: usize) -> Result<Token, PatternError> {
    let (code_point, next) = code_point_at(input, index);
    let (kind, value) = match u8::try_from(code_point) {
        Ok(b'*') => (TokenType::Asterisk, index..next),
        Ok(b'+' | b'?') => (TokenType::OtherModifier, index..next),
        Ok(b'{') => (TokenType::Open, index..next),
        Ok(b'}') => (TokenType::Close, index..next),
        Ok(b'\\') if next == input.len => return Err(NOTHING_TO_ESCAPE),
        Ok(b'\\') => (TokenType::EscapedChar, next..code_point_at(input, next).1),
        Ok(b':') => (TokenType::Name, next..name_end(input, next)?),
        Ok(b'(') => (TokenType::Regexp, next..regexp_end(input, next)?),
        _ => (TokenType::Char, index..next),
    };
    Ok(Token::new(kind, index, value))
}

/// <https://urlpattern.spec.whatwg.org/#tokenize>. It fills `tokens`, which ends with the one of [`TokenType::End`].
pub(super) fn tokenize(
    input: EncodedSlice<'_>,
    policy: Policy,
    tokens: &mut Tokens,
) -> Result<(), PatternError> {
    let max_tokens = bun_core::String::max_length() / WEBKIT_TOKEN_SIZE;
    let mut add = |token| {
        if tokens.len() >= max_tokens || tokens.try_reserve(1).is_err() {
            return Err(PatternError::Type(
                "URLPattern constructor: Failed to create URLPattern (from input string)",
            ));
        }
        tokens.push(token);
        Ok(())
    };

    let mut index = 0;
    while index < input.len {
        let invalid = Token::new(TokenType::InvalidChar, index, index..index + 1);
        let mut token = match token_at(input, index) {
            Ok(token) => token,
            Err(error) if policy == Policy::Strict => return Err(error),
            Err(_) => invalid,
        };
        let is_regexp = token.kind == TokenType::Regexp;
        // Unlike the spec, an empty group becomes a token too, and is accepted at the end of a pattern.
        let is_empty_regexp = is_regexp && token.value().is_empty();
        if is_empty_regexp && policy == Policy::Lenient {
            add(invalid)?;
            token.index += 1;
        }
        add(token)?;
        index = token.value().end + usize::from(is_regexp);
        if is_empty_regexp && policy == Policy::Strict && index < input.len {
            return Err(PatternError::Type("Regex length is zero."));
        }
    }
    add(Token::new(TokenType::End, index, index..index))
}
