//! ESLint's `lib/rules/utils/char-source.js`.

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

impl CharInfo {
    /// The range in the file, for a literal or a token that starts at `literal_start`.
    #[inline]
    pub const fn span(self, literal_start: u32) -> Span {
        Span::new(literal_start + self.start, literal_start + self.end)
    }

    /// ESLint's `codeUnit.source`, out of the text that was parsed.
    #[inline]
    pub fn source(self, literal: &[u8]) -> &[u8] {
        literal
            .get(self.start as usize..self.end as usize)
            .unwrap_or_default()
    }
}

struct Reader<'t> {
    source: &'t [u8],
    at: usize,
    units: Vec<CharInfo>,
}

impl Reader<'_> {
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
        let c = match c as u32 {
            _ if size == 0 => return,
            0x62 => 0x08,
            0x66 => 0x0C,
            0x6E => 0x0A,
            0x72 => 0x0D,
            0x74 => 0x09,
            0x76 => 0x0B,
            0x78 => self.digits(16, 2),
            0x75 => match self.braced_code_point() {
                Some(c) => c,
                None => self.digits(16, 4),
            },
            0x0D => {
                if self.source.get(self.at) == Some(&b'\n') {
                    self.at += 1;
                }
                return;
            }
            0x0A | 0x2028 | 0x2029 => return,
            first @ 0x30..=0x37 => {
                self.at -= 1;
                self.digits(8, if first <= 0x33 { 3 } else { 2 })
            }
            c => c,
        };
        self.push(start, c);
    }
}

/// ESLint's `parseStringLiteral`. `source` is the literal with its quotes. The result has one
/// element for each UTF-16 code unit of the value of the literal.
pub fn parse_string_literal(source: &[u8]) -> Vec<CharInfo> {
    let mut reader = Reader {
        source,
        at: 1,
        units: Vec::with_capacity(source.len().saturating_sub(2)),
    };
    let quote = source.first();
    loop {
        let start = reader.at;
        match char_and_size(source, start) {
            (_, 0) => break,
            (_, 1) if source.get(start) == quote => break,
            (0x5C, _) => reader.escape(),
            (c, size) => {
                reader.at += size;
                reader.push(start, c as u32);
            }
        }
    }
    reader.units
}

/// ESLint's `parseTemplateToken`. `source` is a template token with its delimiters `` ` ``, `${`
/// and `}`, or a template literal without substitutions. The result has one element for each
/// UTF-16 code unit of the cooked value.
pub fn parse_template_token(source: &[u8]) -> Vec<CharInfo> {
    let mut reader = Reader {
        source,
        at: 1,
        units: Vec::with_capacity(source.len().saturating_sub(2)),
    };
    loop {
        let start = reader.at;
        match char_and_size(source, start) {
            (_, 0) | (0x60, _) => break,
            (0x24, _) if source.get(start + 1) == Some(&b'{') => break,
            (0x5C, _) => reader.escape(),
            (0x0D, _) => {
                reader.at += if source.get(start + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
                reader.push(start, 0x0A);
            }
            (c, size) => {
                reader.at += size;
                reader.push(start, c as u32);
            }
        }
    }
    reader.units
}
