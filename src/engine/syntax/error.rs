//! Errors are noted in parts. Most are made while guessing at the syntax, and never put into words.

use core::fmt::Write;
use core::ops::Range;

use bun_engine_text::{StringBuilder, StringRef, Text};

use crate::names::{Name, Names};
use crate::source::Source;
use crate::token::{Token, TokenKind};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ErrorKind {
    Syntax,
    StackOverflow,
    OutOfMemory,
}

/// What more source text could do about a syntax error.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Recovery {
    Irrecoverable,
    UnterminatedLiteral,
    Recoverable,
}

#[derive(Clone, Debug)]
pub struct Error {
    pub kind: ErrorKind,
    pub recovery: Recovery,
    pub message: StringRef,
    /// Where the parser stopped.
    pub token: Range<u32>,
    /// Where the lexer stopped. The error is on this line.
    pub offset: u32,
}

/// What takes the place of a `%` in a message.
#[derive(Clone, Copy)]
pub(crate) enum Part {
    Text(&'static str),
    Name(Name),
    Source(u32, u32),
    /// With whatever characters it has.
    RawName(Name),
}

impl From<&'static str> for Part {
    fn from(text: &'static str) -> Part {
        Part::Text(text)
    }
}

impl From<Name> for Part {
    fn from(name: Name) -> Part {
        Part::Name(name)
    }
}

impl From<Token> for Part {
    fn from(token: Token) -> Part {
        Part::Source(token.start(), token.end())
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Complaint {
    unexpected: Option<Token>,
    text: &'static str,
    parts: [Part; 3],
    ending: &'static str,
}

#[derive(Clone, Copy)]
pub(crate) enum LexicalError {
    Verbatim(&'static str),
    InvalidCharacter(u16),
    UnterminatedRegExp(u32, u32),
    /// The literal so far. The character follows it.
    WideRegExpFlag(u32, u32),
}

/// Up to a null character, and without lone surrogates.
fn push_quotation(message: &mut StringBuilder, text: Text<'_>) {
    const LONGEST: usize = 5_000_000;
    const EXCERPT: usize = 1000;
    let shown = if text.len() > LONGEST {
        EXCERPT
    } else {
        text.len()
    };
    for code_point in text.slice(0..shown).code_points() {
        match code_point {
            0 => return,
            0xd800..=0xdfff => message.push_unit(0xfffd),
            _ => message.push_code_point(code_point),
        }
    }
    if shown < text.len() {
        let _ = write!(message, "...[{} characters not shown]", text.len() - shown);
    }
}

fn push_sentence(
    message: &mut StringBuilder,
    sentence: &str,
    parts: &[Part],
    source: Source<'_>,
    names: &Names,
) {
    let mut parts = parts.iter();
    for &byte in sentence.as_bytes() {
        if byte != b'%' {
            message.push_latin1(byte);
            continue;
        }
        match *parts.next().unwrap_or(&Part::Text("%")) {
            Part::Text(text) => message.push_ascii(text),
            Part::Name(Name::DEFAULT_EXPORT) => message.push_ascii("starDefault"),
            Part::Name(name) => push_quotation(message, names.text(name, source.text)),
            Part::Source(start, end) => push_quotation(message, source.slice(start, end)),
            Part::RawName(name) => message.push_text(names.text(name, source.text)),
        }
    }
}

fn unexpected(kind: TokenKind) -> &'static str {
    match kind {
        TokenKind::End => "Unexpected end of script",
        TokenKind::IncompleteEscape => "Incomplete unicode escape in identifier: '%'",
        TokenKind::InvalidEscape => "Invalid escape in identifier: '%'",
        TokenKind::InvalidUnicodeEscape => "Invalid unicode escape in identifier: '%'",
        TokenKind::InvalidEncoding => "Invalid unicode encoding: '%'",
        TokenKind::InvalidCodePoint => "Invalid unicode code point in identifier: '%'",
        TokenKind::EscapedKeyword => "Unexpected escaped characters in keyword token: '%'",
        TokenKind::String => "Unexpected string literal %",
        TokenKind::Number => "Unexpected number '%'",
        TokenKind::ReservedInStrictCode => "Unexpected use of reserved word '%' in strict mode",
        TokenKind::Enum => "Unexpected use of reserved word '%'",
        TokenKind::PrivateName => "Unexpected private name %",
        TokenKind::Identifier | TokenKind::Await => "Unexpected identifier '%'",
        _ if kind.is_keyword() => "Unexpected keyword '%'",
        _ => "Unexpected token '%'",
    }
}

impl Complaint {
    /// Up to three parts. The text, if any, follows what there is to say of the token.
    pub(crate) fn new(
        unexpected: Option<Token>,
        text: &'static str,
        given: &[Part],
        ending: &'static str,
    ) -> Complaint {
        let mut parts = [Part::Text("%"); 3];
        parts[..given.len()].copy_from_slice(given);
        Complaint {
            unexpected,
            text,
            parts,
            ending,
        }
    }

    pub(crate) fn write(&self, message: &mut StringBuilder, source: Source<'_>, names: &Names) {
        if let Some(token) = self.unexpected {
            let sentence = unexpected(token.kind());
            push_sentence(message, sentence, &[token.into()], source, names);
            if !self.text.is_empty() {
                message.push_ascii(". ");
            }
        }
        push_sentence(message, self.text, &self.parts, source, names);
        message.push_ascii(self.ending);
    }
}

impl LexicalError {
    pub(crate) fn write(self, message: &mut StringBuilder, source: Source<'_>) {
        match self {
            LexicalError::Verbatim(text) => message.push_ascii(text),
            LexicalError::InvalidCharacter(0) => message.push_ascii("Invalid character: '\\0'"),
            LexicalError::InvalidCharacter(0x23) => message.push_ascii("Invalid character: '#'"),
            LexicalError::InvalidCharacter(0x40) => message.push_ascii("Invalid character: '@'"),
            LexicalError::InvalidCharacter(unit) => {
                let _ = write!(message, "Invalid character '\\u{unit:04x}'");
            }
            LexicalError::UnterminatedRegExp(start, end) => {
                message.push_ascii("Unterminated regular expression literal '");
                message.push_text(source.slice(start, end));
                message.push_latin1(b'\'');
            }
            LexicalError::WideRegExpFlag(start, end) => {
                message.push_ascii("Invalid non-latin character in RexExp literal's flags '");
                message.push_text(source.slice(start, end));
                match source.text.code_point_at(end as usize) {
                    0xd800..=0xdfff => message.push_ascii("`invalid unicode character`"),
                    code_point => message.push_code_point(code_point),
                }
                message.push_latin1(b'\'');
            }
        }
    }
}
