use bun_engine_text::CodeUnit;
use bun_engine_unicode::{MAX_CODE_POINT, Property};

use super::ClassEscape;
use super::cursor::{Cursor, ascii, is_lead_surrogate, is_trail_surrogate, join_surrogates};
use crate::Error;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Context {
    Atom,
    Class,
    ClassSet,
}

/// For what follows a backslash, the character that the two stand for wherever they are. Zero if there is none.
static PLAIN_ESCAPES: [u8; 256] = {
    let mut values = [0; 256];
    let mut rest: &[u8] = b"^$\\.*+?()[]{}|/";
    while let [c, tail @ ..] = rest {
        values[*c as usize] = *c;
        rest = tail;
    }
    values[b't' as usize] = 0x09;
    values[b'n' as usize] = 0x0a;
    values[b'v' as usize] = 0x0b;
    values[b'f' as usize] = 0x0c;
    values[b'r' as usize] = 0x0d;
    values
};

impl<C: CodeUnit> Cursor<'_, C> {
    /// After the backslash. Moves only if there is one.
    #[inline(always)]
    pub(super) fn class_escape(&mut self) -> Result<Option<ClassEscape>, Error> {
        let escape = match self.peek() {
            b'd' => ClassEscape::Digit,
            b'D' => ClassEscape::NotDigit,
            b's' => ClassEscape::Space,
            b'S' => ClassEscape::NotSpace,
            b'w' => ClassEscape::Word,
            b'W' => ClassEscape::NotWord,
            letter @ (b'p' | b'P') if self.is_unicode => {
                let property = self.apart(Self::property).ok_or(Error::InvalidProperty)?;
                return match letter {
                    b'p' => Ok(Some(ClassEscape::Property(property))),
                    _ if property.has_strings() => Err(Error::NegatedStrings),
                    _ => Ok(Some(ClassEscape::NotProperty(property))),
                };
            }
            _ => return Ok(None),
        };
        self.at += 1;
        Ok(Some(escape))
    }

    /// After the backslash.
    #[inline(always)]
    pub(super) fn character_escape(&mut self, context: Context) -> Result<u32, Error> {
        match self.plain_escape() {
            Some(c) => Ok(c),
            None => self.other_escape(context),
        }
    }

    /// After the backslash. Moves only if there is one.
    #[inline(always)]
    pub(super) fn plain_escape(&mut self) -> Option<u32> {
        let c = PLAIN_ESCAPES[usize::from(self.peek())];
        (c != 0).then(|| {
            self.at += 1;
            c.into()
        })
    }

    /// After the backslash, if it is neither a plain one nor a class.
    #[inline(always)]
    pub(super) fn other_escape(&mut self, context: Context) -> Result<u32, Error> {
        let unit = self.next_unit().ok_or(Error::EscapeAtEnd)?;
        let value = match ascii(unit) {
            b'x' => self.hexadecimal::<2>(),
            b'u' if self.is_unicode => return self.apart(Self::strict_unicode_escape),
            b'u' => self.hexadecimal::<4>(),
            b'b' if context != Context::Atom => Some(0x08),
            digit @ b'0'..=b'9' => return self.apart(|it| it.octal_escape(digit - b'0')),
            b'c' => return self.apart(|it| it.control_escape(context)),
            b'k' => {
                self.has_passed_escaped_k = true;
                None
            }
            b'-' if context != Context::Atom => Some(unit),
            b'&' | b'!' | b'#' | b'%' | b',' | b':' | b';' | b'<' | b'=' | b'>' | b'@' | b'`'
            | b'~'
                if context == Context::ClassSet =>
            {
                Some(unit)
            }
            _ => None,
        };
        match value {
            Some(value) => Ok(value),
            None if self.is_unicode => Err(Error::InvalidIdentityEscape),
            None => Ok(unit),
        }
    }

    /// After the first digit.
    #[inline(never)]
    fn octal_escape(&mut self, first: u8) -> Result<u32, Error> {
        if first == 0 && !self.peek().is_ascii_digit() {
            return Ok(0);
        }
        if self.is_unicode {
            return Err(Error::InvalidOctalEscape);
        }
        if first > 7 {
            return Ok(u32::from(b'0' + first));
        }
        let mut value = u32::from(first);
        for _ in 0..if first < 4 { 2 } else { 1 } {
            let digit @ b'0'..=b'7' = self.peek() else {
                break;
            };
            value = value * 8 + u32::from(digit - b'0');
            self.at += 1;
        }
        Ok(value)
    }

    /// After `\c`.
    #[inline(never)]
    fn control_escape(&mut self, context: Context) -> Result<u32, Error> {
        let letter = self.peek();
        if !letter.is_ascii_alphabetic() {
            if self.is_unicode {
                return Err(match self.is_at_end() {
                    true => Error::InvalidIdentityEscape,
                    false => Error::InvalidControlEscape,
                });
            }
            if context == Context::Atom || !matches!(letter, b'0'..=b'9' | b'_') {
                self.at -= 1;
                return Ok(u32::from(b'\\'));
            }
        }
        self.at += 1;
        Ok(u32::from(letter & 0x1f))
    }

    /// RegExpUnicodeEscapeSequence[+UnicodeMode], after `\u`.
    #[inline(never)]
    pub(super) fn strict_unicode_escape(&mut self) -> Result<u32, Error> {
        if self.eat(b'{') {
            return self.code_point().ok_or(Error::InvalidCodePointEscape);
        }
        let unit = self.hexadecimal::<4>().ok_or(Error::InvalidUnicodeEscape)?;
        if is_lead_surrogate(unit) && self.peek() == b'\\' && self.peek_at(1) == b'u' {
            let start = self.at;
            self.at += 2;
            match self.hexadecimal::<4>().filter(|&it| is_trail_surrogate(it)) {
                Some(trail) => return Ok(join_surrogates(unit, trail)),
                None => self.at = start,
            }
        }
        Ok(unit)
    }

    /// After `\u{`.
    #[inline(always)]
    fn code_point(&mut self) -> Option<u32> {
        let mut value = self.hexadecimal::<1>()?;
        while let Some(digit) = self.hexadecimal::<1>() {
            value = value << 4 | digit;
            if value > MAX_CODE_POINT {
                return None;
            }
        }
        self.eat(b'}').then_some(value)
    }

    /// At the letter.
    #[inline(never)]
    fn property(&mut self) -> Option<Property> {
        self.at += 1;
        let mut word_after = |before: u8| {
            self.eat(before).then(|| {
                let start = self.at;
                while self.peek().is_ascii_alphanumeric() || self.peek() == b'_' {
                    self.at += 1;
                }
                C::text(self.units_since(start))
            })
        };
        let name = word_after(b'{')?;
        let value = word_after(b'=');
        if !self.eat(b'}') {
            return None;
        }
        match value {
            Some(value) => Property::with_value(name, value),
            None => Property::of_characters(name)
                .or_else(|| Property::of_strings(name).filter(|_| self.has_class_sets)),
        }
    }
}
