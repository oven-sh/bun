//! ESLint's `lib/rules/utils/char-source.js`.

use crate::ast::{Expr, ExprKind};
use crate::span::Span;
use bun_core::lexer::char_and_size;

/// ESLint's `CodeUnit`. One UTF-16 code unit of the value of a string literal or of a template
/// token, and the part of the source text that produces it.
///
/// `start` and `end` are offsets **in bytes** from the start of the literal or the token, its
/// delimiter included. Upstream's are in UTF-16 code units.
///
/// The two halves of a surrogate pair that come from one character of the source or from one
/// `\u{..}` have the same range, that of the character or of the escape sequence.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CharInfo {
    pub code_unit: u16,
    pub start: u32,
    pub end: u32,
}

struct Reader<'t> {
    source: &'t [u8],
    at: usize,
    units: Vec<CharInfo>,
}

impl<'t> Reader<'t> {
    /// At the character after the opening delimiter.
    fn new(source: &'t [u8]) -> Self {
        Reader {
            source,
            at: 1,
            units: Vec::with_capacity(source.len().saturating_sub(2)),
        }
    }

    /// Adds the code units of `c`, whose source is from `start` to the current position.
    fn push(&mut self, start: usize, c: u32) {
        let (start, end) = (start as u32, self.at as u32);
        let mut unit = |code_unit: u32| {
            self.units.push(CharInfo {
                code_unit: code_unit as u16,
                start,
                end,
            });
        };
        match c.checked_sub(0x10000) {
            Some(c) => {
                unit(0xD800 + (c >> 10));
                unit(0xDC00 + (c & 0x3FF));
            }
            None => unit(c),
        }
    }

    /// Reads at most `max` digits in base `radix`.
    fn digits(&mut self, radix: u32, max: usize) -> u32 {
        let mut value = 0u32;
        for _ in 0..max {
            let Some(digit) = self
                .source
                .get(self.at)
                .and_then(|&c| (c as char).to_digit(radix))
            else {
                break;
            };
            value = value.saturating_mul(radix).saturating_add(digit);
            self.at += 1;
        }
        value
    }

    /// Reads the `{41}` of `\u{41}`.
    fn braced_code_point(&mut self) -> Option<u32> {
        let start = self.at;
        if self.source.get(start) == Some(&b'{') {
            self.at += 1;
            let c = self.digits(16, usize::MAX);
            if self.at > start + 1 && self.source.get(self.at) == Some(&b'}') && c <= 0x10FFFF {
                self.at += 1;
                return Some(c);
            }
        }
        self.at = start;
        None
    }

    /// Reads an escape sequence or a line continuation. The current position is the backslash.
    fn escape(&mut self) {
        let start = self.at;
        let (c, size) = char_and_size(self.source, start + 1);
        self.at = start + 1 + size;
        let c = match char::from_u32(c as u32) {
            // The text ends with the backslash.
            None => return,
            Some('b') => 0x08,
            Some('f') => 0x0C,
            Some('n') => 0x0A,
            Some('r') => 0x0D,
            Some('t') => 0x09,
            Some('v') => 0x0B,
            Some('x') => self.digits(16, 2),
            Some('u') => match self.braced_code_point() {
                Some(c) => c,
                None => self.digits(16, 4),
            },
            Some('\r') => {
                if self.source.get(self.at) == Some(&b'\n') {
                    self.at += 1;
                }
                return;
            }
            Some('\n' | '\u{2028}' | '\u{2029}') => return,
            Some(first @ '0'..='7') => {
                self.at -= 1;
                self.digits(8, if first <= '3' { 3 } else { 2 })
            }
            Some(c) => c as u32,
        };
        self.push(start, c);
    }

    /// Reads a character that stands for itself.
    fn character(&mut self) {
        let start = self.at;
        let (c, size) = char_and_size(self.source, start);
        self.at += size;
        self.push(start, c as u32);
    }
}

/// ESLint's `parseStringLiteral`. `source` is the literal with its quotes. The result has one
/// element for each UTF-16 code unit of the value of the literal: for a pattern given to `RegExp`,
/// `regex::Node::utf16_start` and `utf16_end` are indices into it.
pub fn parse_string_literal(source: &[u8]) -> Vec<CharInfo> {
    let mut reader = Reader::new(source);
    let quote = source.first();
    while let Some(c) = source.get(reader.at)
        && Some(c) != quote
    {
        match c {
            b'\\' => reader.escape(),
            _ => reader.character(),
        }
    }
    reader.units
}

/// ESLint's `parseTemplateToken`. `source` is a template token with its delimiters `` ` ``, `${`
/// and `}`, or a template literal without substitutions. The result has one element for each
/// UTF-16 code unit of the cooked value.
pub fn parse_template_token(source: &[u8]) -> Vec<CharInfo> {
    let mut reader = Reader::new(source);
    loop {
        let start = reader.at;
        match source.get(start..).unwrap_or_default() {
            [] | [b'`', ..] | [b'$', b'{', ..] => break,
            [b'\\', ..] => reader.escape(),
            [b'\r', rest @ ..] => {
                reader.at += if rest.first() == Some(&b'\n') { 2 } else { 1 };
                reader.push(start, 0x0A);
            }
            _ => reader.character(),
        }
    }
    reader.units
}

/// Where the parts of the value of a string literal, or of a template without substitutions, are
/// written: for a pattern that is given to `RegExp`.
pub struct Written {
    /// Where the literal starts.
    start: u32,
    units: Vec<CharInfo>,
}

impl Written {
    /// `None` for any other expression.
    pub fn new(literal: Expr<'_>) -> Option<Written> {
        let units = match literal.kind() {
            ExprKind::String(_) => parse_string_literal(literal.text()),
            ExprKind::Template(template) if template.exprs().is_empty() => {
                parse_template_token(literal.text())
            }
            _ => return None,
        };
        Some(Written {
            start: literal.span().start,
            units,
        })
    }

    /// Where the UTF-16 code units of the value from `start` to `end` are written: for
    /// `regex::Node::utf16_start` and `utf16_end`. `None` if there are none.
    pub fn span(&self, start: u32, end: u32) -> Option<Span> {
        let first = self.units.get(start as usize)?;
        let last = self.units.get(end.checked_sub(1)? as usize)?;
        (start < end).then(|| Span::new(self.start + first.start, self.start + last.end))
    }
}
