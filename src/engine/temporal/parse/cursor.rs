use bun_engine_text::CodeUnit;

/// What is left of the input.
#[derive(Clone, Copy)]
pub(super) struct Cursor<'a, T>(&'a [T]);

impl<'a, T: CodeUnit> Cursor<'a, T> {
    /// `None` unless `parse` accepts all of `units`.
    #[inline]
    pub(super) fn parse_all<R>(
        units: &'a [T],
        parse: impl FnOnce(&mut Cursor<'a, T>) -> Option<R>,
    ) -> Option<R> {
        let mut cursor = Cursor(units);
        parse(&mut cursor).filter(|_| cursor.0.is_empty())
    }

    #[inline(always)]
    fn narrow(unit: T) -> u8 {
        unit.to_u16().min(0xff) as u8
    }

    /// Zero at the end. No production contains it, or any character that is not ASCII.
    #[inline(always)]
    pub(super) fn peek(&self) -> u8 {
        self.0.first().map_or(0, |&unit| Self::narrow(unit))
    }

    #[inline(always)]
    pub(super) fn next(&mut self) -> Option<u8> {
        let (&first, rest) = self.0.split_first()?;
        self.0 = rest;
        Some(Self::narrow(first))
    }

    #[inline(always)]
    pub(super) fn eat_if(&mut self, accepts: impl FnOnce(u8) -> bool) -> bool {
        accepts(self.peek()) && self.next().is_some()
    }

    #[inline(always)]
    pub(super) fn eat(&mut self, character: u8) -> bool {
        self.eat_if(|next| next == character)
    }

    #[inline(always)]
    pub(super) fn eat_letter(&mut self, uppercase: u8) -> bool {
        self.eat_if(|next| next.to_ascii_uppercase() == uppercase)
    }

    #[inline(always)]
    pub(super) fn expect(&mut self, character: u8) -> Option<()> {
        self.eat(character).then_some(())
    }

    /// 1 or -1.
    #[inline(always)]
    pub(super) fn sign(&mut self) -> Option<i8> {
        let sign = match self.peek() {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        self.next();
        Some(sign)
    }

    #[inline(always)]
    pub(super) fn take_while(&mut self, mut accepts: impl FnMut(u8) -> bool) -> &'a [T] {
        let count = (self.0.iter())
            .take_while(|&&unit| accepts(Self::narrow(unit)))
            .count();
        let (taken, rest) = self.0.split_at(count);
        self.0 = rest;
        taken
    }

    #[inline(always)]
    pub(super) fn two_digits(&mut self) -> Option<u8> {
        let (&[tens, ones], rest) = self.0.split_first_chunk()?;
        if !tens.is_ascii_digit() || !ones.is_ascii_digit() {
            return None;
        }
        self.0 = rest;
        Some((Self::narrow(tens) - b'0') * 10 + (Self::narrow(ones) - b'0'))
    }

    #[inline(always)]
    pub(super) fn two_digits_up_to(&mut self, maximum: u8) -> Option<u8> {
        self.two_digits().filter(|&value| value <= maximum)
    }

    /// An optional TemporalDecimalFraction, in units of 10^-9. The outer `None` is an error.
    #[inline(always)]
    pub(super) fn fraction(&mut self) -> Option<Option<u32>> {
        const SCALES: [u32; 9] = [
            100_000_000,
            10_000_000,
            1_000_000,
            100_000,
            10_000,
            1_000,
            100,
            10,
            1,
        ];
        if !self.eat_if(|next| next == b'.' || next == b',') {
            return Some(None);
        }
        let digits = self.take_while(|next| next.is_ascii_digit());
        let scale = SCALES.get(digits.len().checked_sub(1)?)?;
        let value = (digits.iter()).fold(0, |value, digit| value * 10 + (digit.to_u32() & 0xf));
        Some(Some(value * scale))
    }
}
