//! Numeric literals.

use bun_engine_number::{NumberText, decimal_literal_value, radix_literal_value};
use bun_engine_text::Text;

use super::{Flaw, Lexer};
use crate::chars::{self, Start};
use crate::names::Name;
use crate::token::{Detail, Token, TokenKind};

/// Any number of so many digits fits in `Token::value`.
const PLAIN_DIGITS: usize = 9;

struct Radix {
    value: u32,
    no_digits: &'static str,
    no_space: &'static str,
}

impl Radix {
    fn of_prefix(letter: u8) -> Option<Radix> {
        Some(match letter | 0x20 {
            b'x' => Radix {
                value: 16,
                no_digits: "No hexadecimal digits after '0x'",
                no_space: "No space between hexadecimal literal and identifier",
            },
            b'o' => Radix {
                value: 8,
                no_digits: "No octal digits after '0o'",
                no_space: "No space between octal literal and identifier",
            },
            b'b' => Radix {
                value: 2,
                no_digits: "No binary digits after '0b'",
                no_space: "No space between binary literal and identifier",
            },
            _ => return None,
        })
    }
}

/// The kind of token, and where it ends.
type Scanned = Result<(TokenKind, usize), Flaw>;

fn unterminated(end: usize, message: &'static str) -> Scanned {
    let kind = TokenKind::Unterminated;
    Err(Flaw { kind, end, message })
}

/// LegacyOctalIntegerLiteral of ECMA-262.
fn is_legacy_octal(literal: &[u8]) -> bool {
    matches!(literal, [b'0', rest @ ..] if rest.iter().all(|digit| matches!(digit, b'0'..=b'7')))
}

/// Whether the number is an integer that is written as one, but for an exponent.
fn is_integer(value: f64) -> bool {
    value < 9_223_372_036_854_775_808.0 && value as i64 as f64 == value
}

impl Lexer<'_> {
    #[inline(always)]
    pub(super) fn number(&mut self, start: usize, lead: Detail, digit: u8) {
        let mut value = u32::from(digit - b'0');
        let mut end = start + 1;
        while value != 0 && self.byte(end).is_ascii_digit() && end - start < PLAIN_DIGITS {
            value = value * 10 + u32::from(self.byte(end) - b'0');
            end += 1;
        }
        if matches!(
            chars::start(self.byte(end)),
            Start::Name | Start::Digit | Start::Dot | Start::Other
        ) {
            return self.elaborate_number(start, lead);
        }
        self.set(TokenKind::Number, start, end, lead | Detail::value(value));
    }

    fn is_digit(&self, offset: usize, radix: u32) -> bool {
        char::from(self.byte(offset)).is_digit(radix)
    }

    /// Stops at a separator that no digit follows.
    fn skip_digits(&self, mut offset: usize, radix: u32) -> usize {
        loop {
            if self.is_digit(offset, radix) {
                offset += 1;
            } else if self.byte(offset) == b'_' && self.is_digit(offset + 1, radix) {
                offset += 2;
            } else {
                return offset;
            }
        }
    }

    #[inline(never)]
    pub(super) fn elaborate_number(&mut self, start: usize, lead: Detail) {
        match self.any_number(start) {
            Ok((kind, end)) => self.set(kind, start, end, lead | Detail::ELABORATE),
            Err(flaw) => self.fail(start, lead, flaw),
        }
    }

    fn any_number(&self, start: usize) -> Scanned {
        let mut offset = start;
        if self.byte(start) == b'0' {
            let second = self.byte(start + 1);
            if let Some(radix) = Radix::of_prefix(second) {
                return self.prefixed_number(start, &radix);
            }
            if second == b'_' {
                return unterminated(start + 1, "Numeric literals may not begin with 0_");
            }
            if second.is_ascii_digit() {
                return self.number_with_leading_zero(start);
            }
        }
        if self.byte(start) != b'.' {
            offset = self.skip_digits(start, 10);
            if self.byte(offset) == b'n' {
                return self.end_of_decimal(TokenKind::BigInt, offset + 1);
            }
        }
        self.fraction_and_exponent(offset)
    }

    fn prefixed_number(&self, start: usize, radix: &Radix) -> Scanned {
        if !self.is_digit(start + 2, radix.value) {
            return unterminated(start + 1, radix.no_digits);
        }
        let digits_end = self.skip_digits(start + 2, radix.value);
        let (kind, end) = match self.byte(digits_end) {
            b'n' => (TokenKind::BigInt, digits_end + 1),
            _ => (TokenKind::Number, digits_end),
        };
        if self.starts_name(end) {
            return unterminated(end, radix.no_space);
        }
        Ok((kind, end))
    }

    fn number_with_leading_zero(&self, start: usize) -> Scanned {
        if self.is_strict {
            return unterminated(
                start + 1,
                "Decimal integer literals with a leading zero are forbidden in strict mode",
            );
        }
        let mut end = start;
        while self.byte(end).is_ascii_digit() {
            end += 1;
        }
        if is_legacy_octal(&self.bytes[start..end]) {
            self.end_of_decimal(TokenKind::Number, end)
        } else {
            self.fraction_and_exponent(end)
        }
    }

    fn fraction_and_exponent(&self, mut offset: usize) -> Scanned {
        if self.byte(offset) == b'.' {
            offset += 1;
            if self.byte(offset).is_ascii_digit() {
                offset = self.skip_digits(offset, 10);
                if self.byte(offset) == b'_' {
                    return Err(self.flaw(offset, "Non-number found after decimal point"));
                }
            }
        }
        if self.byte(offset) | 0x20 == b'e' {
            offset += 1 + usize::from(matches!(self.byte(offset + 1), b'+' | b'-'));
            let has_digits = self.byte(offset).is_ascii_digit();
            if has_digits {
                offset = self.skip_digits(offset, 10);
            }
            if !has_digits || self.byte(offset) == b'_' {
                return Err(self.flaw(offset, "Non-number found after exponent indicator"));
            }
        }
        self.end_of_decimal(TokenKind::Number, offset)
    }

    fn end_of_decimal(&self, kind: TokenKind, end: usize) -> Scanned {
        if self.starts_name(end) {
            return Err(self.flaw(end, "No identifiers allowed directly after numeric literal"));
        }
        Ok((kind, end))
    }

    /// The number, and whether it is written as an integer.
    #[inline(always)]
    pub(crate) fn number_value(&self, token: Token) -> (f64, bool) {
        if token.is_elaborate() {
            self.elaborate_number_value(token)
        } else {
            (f64::from(token.value()), true)
        }
    }

    fn elaborate_number_value(&self, token: Token) -> (f64, bool) {
        let literal = self.bytes_of(token);
        let value = if let [b'0', letter, digits @ ..] = literal
            && let Some(radix) = Radix::of_prefix(*letter)
        {
            radix_literal_value(digits, radix.value)
        } else if is_legacy_octal(literal) {
            radix_literal_value(literal, 8)
        } else {
            decimal_literal_value(literal)
        };
        let has_point = bun_highway::index_of_char(literal, b'.').is_some();
        (value, !has_point && is_integer(value))
    }

    /// The digits and the radix.
    pub(crate) fn bigint_value(&mut self, token: Token) -> (Name, u8) {
        let (start, end) = (token.start() as usize, token.end() as usize - 1);
        let (start, radix) = match Radix::of_prefix(self.byte(start + 1)) {
            Some(radix) => (start + 2, radix.value as u8),
            None => (start, 10),
        };
        let digits = &self.bytes[start..end];
        if bun_highway::index_of_char(digits, b'_').is_none() {
            return (self.names.intern_source(self.source, start, end), radix);
        }
        self.scratch.clear();
        let digits = digits.iter().filter(|digit| digit.is_ascii_alphanumeric());
        self.scratch.extend(digits.map(|&digit| u16::from(digit)));
        let text = Text::Utf16(&self.scratch);
        (self.names.intern_text(self.source, text), radix)
    }

    /// The name of the property that a number is the key of.
    pub(crate) fn number_key(&mut self, token: Token) -> Name {
        if !token.is_elaborate() {
            return (self.names).intern_source(
                self.source,
                token.start() as usize,
                token.end() as usize,
            );
        }
        let text = NumberText::from(self.elaborate_number_value(token).0);
        self.names.intern_text(self.source, text.text())
    }

    /// None if it is too big.
    pub(crate) fn bigint_key(&mut self, token: Token) -> Option<Name> {
        use bun_engine_bigint::{LiteralRadix, from_literal};
        let (digits, radix) = self.bigint_value(token);
        let radix = match radix {
            2 => LiteralRadix::Binary,
            8 => LiteralRadix::Octal,
            16 => LiteralRadix::Hexadecimal,
            _ => return Some(digits),
        };
        let value = from_literal(self.names.text(digits, self.source.text), radix, false).ok()?;
        let value = value.into_owned(&mut || false).ok()?;
        let text = value.as_ref().to_string_ref(10, &mut || false).ok()?;
        Some(self.names.intern_text(self.source, text.text()))
    }
}
