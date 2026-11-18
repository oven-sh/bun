use bun_engine_text::CodeUnit;
use bun_engine_unicode::is_white_space;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Spaces {
    Ascii,
    Unicode,
}

impl Spaces {
    /// The byte that stands for a character above ASCII: a space, or a letter that is in no keyword.
    #[cold]
    fn stand_in(self, character: u32) -> u8 {
        if self == Spaces::Unicode && is_white_space(character) {
            b' '
        } else {
            0x80
        }
    }
}

pub(super) struct Number {
    /// Of the first nine digits after the leading zeros.
    pub(super) value: i32,
    pub(super) digits: usize,
}

impl Number {
    const SIGNIFICANT_DIGITS: usize = 9;

    /// As the digits after a decimal point.
    #[inline(always)]
    pub(super) fn milliseconds(&self) -> i32 {
        const TO_NANOSECONDS: [u32; Number::SIGNIFICANT_DIGITS + 1] = [
            0,
            100_000_000,
            10_000_000,
            1_000_000,
            100_000,
            10_000,
            1000,
            100,
            10,
            1,
        ];
        let scale = TO_NANOSECONDS[self.digits.min(Number::SIGNIFICANT_DIGITS)];
        (self.value as u32 * scale / 1_000_000) as i32
    }
}

pub(super) struct Word {
    /// The first three letters in lower case, the first in the lowest byte.
    pub(super) prefix: u32,
    pub(super) is_longer: bool,
}

/// A position in a text that ends at its first zero.
pub(super) struct Cursor<'a, T> {
    text: &'a [T],
    position: usize,
    spaces: Spaces,
}

impl<'a, T: CodeUnit> Cursor<'a, T> {
    #[inline]
    pub(super) fn new(text: &'a [T], spaces: Spaces) -> Self {
        Cursor {
            text,
            position: 0,
            spaces,
        }
    }

    #[inline(always)]
    fn unit(&self) -> Option<T> {
        self.text.get(self.position).copied()
    }

    /// Zero at the end.
    #[inline(always)]
    pub(super) fn peek(&self) -> u8 {
        match self.unit() {
            None => 0,
            Some(unit) if unit.is_ascii() => unit.to_u16() as u8,
            Some(unit) => self.spaces.stand_in(unit.to_u32()),
        }
    }

    #[inline(always)]
    pub(super) fn peek_chunk<const N: usize>(&self) -> Option<&'a [T; N]> {
        self.text.get(self.position..)?.first_chunk()
    }

    #[inline(always)]
    pub(super) fn advance(&mut self, count: usize) {
        self.position += count;
    }

    #[inline(always)]
    pub(super) fn is_at_end(&self) -> bool {
        self.unit().is_none_or(|unit| unit.is(0))
    }

    #[inline(always)]
    pub(super) fn is_at(&self, ascii: u8) -> bool {
        self.unit().is_some_and(|unit| unit.is(ascii))
    }

    #[inline(always)]
    pub(super) fn is_at_digit(&self) -> bool {
        self.unit().is_some_and(T::is_ascii_digit)
    }

    #[inline(always)]
    pub(super) fn skip(&mut self, ascii: u8) -> bool {
        let is_next = self.is_at(ascii);
        if is_next {
            self.advance(1);
        }
        is_next
    }

    /// 1 or -1.
    #[inline(always)]
    pub(super) fn sign(&mut self) -> Option<i32> {
        if self.skip(b'+') {
            return Some(1);
        }
        self.skip(b'-').then_some(-1)
    }

    /// A number of exactly `N` digits that is in the range. Nothing is consumed otherwise.
    #[inline(always)]
    pub(super) fn fixed<const N: usize>(&mut self, min: i32, max: i32) -> Option<i32> {
        let mut value = 0;
        for &unit in self.peek_chunk::<N>()? {
            value = value * 10 + digit_value(unit)?;
        }
        let next = self.text.get(self.position + N);
        if next.is_some_and(|unit| unit.is_ascii_digit()) || !(min..=max).contains(&value) {
            return None;
        }
        self.advance(N);
        Some(value)
    }

    #[inline(always)]
    pub(super) fn number(&mut self) -> Option<Number> {
        let start = self.position;
        let mut value = 0;
        while let Some(digit) = self.unit().and_then(digit_value) {
            if value < 10i32.pow(Number::SIGNIFICANT_DIGITS as u32 - 1) {
                value = value * 10 + digit;
            }
            self.advance(1);
        }
        let digits = self.position - start;
        (digits != 0).then_some(Number { value, digits })
    }

    #[inline(always)]
    pub(super) fn word(&mut self) -> Word {
        let start = self.position;
        let mut prefix = 0;
        while let letter = self.peek()
            && is_letter(letter)
        {
            let index = self.position - start;
            if index < 3 {
                prefix |= u32::from(letter | 0x20) << (8 * index);
            }
            self.advance(1);
        }
        Word {
            prefix,
            is_longer: self.position - start > 3,
        }
    }

    /// From an opening parenthesis through the one that closes it.
    #[inline(always)]
    pub(super) fn skip_comment(&mut self) {
        let mut depth = 0usize;
        while let Some(unit) = self.unit() {
            if unit.to_u16() <= u16::from(b')') {
                if unit.is(0) {
                    return;
                }
                depth += usize::from(unit.is(b'('));
                depth -= usize::from(unit.is(b')'));
                if depth == 0 {
                    return self.advance(1);
                }
            }
            self.advance(1);
        }
    }
}

#[inline(always)]
fn digit_value<T: CodeUnit>(unit: T) -> Option<i32> {
    let value = unit.to_u32().wrapping_sub(u32::from(b'0'));
    (value < 10).then_some(value as i32)
}

#[inline(always)]
pub(super) fn is_letter(character: u8) -> bool {
    character >= b'A'
}
