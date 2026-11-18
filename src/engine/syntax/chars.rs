//! Classes of Latin-1 characters.

use crate::source::WIDE_UNIT;
use crate::token::TokenKind;

/// What a character is to the lexer when it looks for a token.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Start {
    Name,
    /// See [`punctuator`].
    Punctuator,
    Blank,
    Newline,
    Digit,
    Quote,
    Dot,
    Slash,
    Operator,
    Other,
}

pub(crate) const fn classify(byte: u8) -> Start {
    match byte {
        b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => Start::Name,
        b'(' | b')' | b'[' | b']' | b'{' | b'}' | b',' | b';' | b':' | b'~' | b'`' => {
            Start::Punctuator
        }
        b' ' | b'\t' | 0x0b | 0x0c | 0xa0 => Start::Blank,
        b'\n' | b'\r' => Start::Newline,
        b'0'..=b'9' => Start::Digit,
        b'"' | b'\'' => Start::Quote,
        b'.' => Start::Dot,
        b'/' => Start::Slash,
        b'=' | b'!' | b'?' | b'<' | b'>' | b'+' | b'-' | b'*' | b'%' | b'&' | b'|' | b'^' => {
            Start::Operator
        }
        _ => Start::Other,
    }
}

static STARTS: [Start; 256] = {
    let mut starts = [Start::Other; 256];
    let mut index = 0;
    while index < 256 {
        starts[index] = classify(index as u8);
        index += 1;
    }
    starts
};

static PUNCTUATORS: [TokenKind; 256] = {
    let mut kinds = [TokenKind::Invalid; 256];
    kinds[b'(' as usize] = TokenKind::OpenParen;
    kinds[b')' as usize] = TokenKind::CloseParen;
    kinds[b'[' as usize] = TokenKind::OpenBracket;
    kinds[b']' as usize] = TokenKind::CloseBracket;
    kinds[b'{' as usize] = TokenKind::OpenBrace;
    kinds[b'}' as usize] = TokenKind::CloseBrace;
    kinds[b',' as usize] = TokenKind::Comma;
    kinds[b';' as usize] = TokenKind::Semicolon;
    kinds[b':' as usize] = TokenKind::Colon;
    kinds[b'~' as usize] = TokenKind::BitNot;
    kinds[b'`' as usize] = TokenKind::Backquote;
    kinds
};

/// One bit for each character that may go on with a name that is ASCII so far.
static CONTINUES_NAME: [bool; 256] = {
    let mut table = [false; 256];
    let mut index = 0;
    while index < 256 {
        table[index] = matches!(
            index as u8,
            b'\\' | WIDE_UNIT | 0xaa | 0xb5 | 0xb7 | 0xba | 0xc0..=0xd6 | 0xd8..=0xf6 | 0xf8..=0xff
        );
        index += 1;
    }
    table
};

#[inline(always)]
pub(crate) fn start(byte: u8) -> Start {
    STARTS[usize::from(byte)]
}

/// The token that is just this character.
#[inline(always)]
pub(crate) fn punctuator(byte: u8) -> TokenKind {
    PUNCTUATORS[usize::from(byte)]
}

/// For a character that is no ASCII letter or digit.
#[inline(always)]
pub(crate) fn continues_name(byte: u8) -> bool {
    CONTINUES_NAME[usize::from(byte)]
}

#[inline(always)]
pub(crate) fn is_newline(byte: u8) -> bool {
    matches!(byte, b'\n' | b'\r')
}
