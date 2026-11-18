use bun_engine_text::CodeUnit;

use crate::Flags;

/// A position in the source. The loops of the parser have it in registers as long as nothing that is not inlined gets
/// its address: [`Cursor::apart`] lends a copy.
#[derive(Clone, Copy)]
pub(super) struct Cursor<'a, C> {
    pub(super) units: &'a [C],
    pub(super) at: usize,
    /// With `u` or `v`.
    pub(super) is_unicode: bool,
    pub(super) has_class_sets: bool,
    /// An error if any group has a name.
    pub(super) has_passed_escaped_k: bool,
}

const NOT_HEXADECIMAL: u8 = 0xf0;

static HEXADECIMAL_VALUES: [u8; 256] = {
    let (mut values, mut digit) = ([NOT_HEXADECIMAL; 256], 0);
    while digit < 16 {
        values[b"0123456789abcdef"[digit] as usize] = digit as u8;
        values[b"0123456789ABCDEF"[digit] as usize] = digit as u8;
        digit += 1;
    }
    values
};

/// An ASCII character as it is, any other as a value above 0x7f.
#[inline(always)]
pub(super) fn ascii(unit: u32) -> u8 {
    unit.min(0xff) as u8
}

impl<'a, C: CodeUnit> Cursor<'a, C> {
    #[inline(always)]
    pub(super) fn new(units: &'a [C], flags: Flags) -> Self {
        Cursor {
            units,
            at: 0,
            is_unicode: flags.is_unicode_aware(),
            has_class_sets: flags.contains(Flags::UNICODE_SETS),
            has_passed_escaped_k: false,
        }
    }

    #[inline(always)]
    pub(super) fn apart<T>(&mut self, read: impl FnOnce(&mut Self) -> T) -> T {
        let mut copy = *self;
        let result = read(&mut copy);
        self.at = copy.at;
        self.has_passed_escaped_k = copy.has_passed_escaped_k;
        result
    }

    /// As by [`ascii`]. The end is a value above 0x7f too.
    #[inline(always)]
    pub(super) fn peek(&self) -> u8 {
        self.peek_at(0)
    }

    #[inline(always)]
    pub(super) fn peek_at(&self, offset: usize) -> u8 {
        let unit = self.units.get(self.at + offset);
        unit.map_or(0xff, |unit| ascii(unit.to_u32()))
    }

    #[inline(always)]
    pub(super) fn is_at_end(&self) -> bool {
        self.at >= self.units.len()
    }

    #[inline(always)]
    pub(super) fn eat(&mut self, ascii: u8) -> bool {
        let is_next = self.peek() == ascii;
        self.at += usize::from(is_next);
        is_next
    }

    #[inline(always)]
    pub(super) fn next_unit(&mut self) -> Option<u32> {
        let unit = self.units.get(self.at)?;
        self.at += 1;
        Some(unit.to_u32())
    }

    #[inline(always)]
    pub(super) fn units_since(&self, start: usize) -> &'a [C] {
        &self.units[start..self.at]
    }

    /// Takes the second half if `unit`, which is before the cursor, starts a surrogate pair.
    #[inline(always)]
    pub(super) fn complete_pair(&mut self, unit: u32) -> u32 {
        if !C::IS_LATIN1
            && is_lead_surrogate(unit)
            && let Some(trail) = self.units.get(self.at).map(|it| it.to_u32())
            && is_trail_surrogate(trail)
        {
            self.at += 1;
            return join_surrogates(unit, trail);
        }
        unit
    }

    /// The character that `unit`, which is before the cursor, starts.
    #[inline(always)]
    pub(super) fn complete_character(&mut self, unit: u32) -> u32 {
        match self.is_unicode {
            true => self.complete_pair(unit),
            false => unit,
        }
    }

    /// Saturates.
    #[inline(always)]
    pub(super) fn decimal(&mut self) -> Option<u64> {
        let start = self.at;
        let mut value = 0u64;
        while let digit @ b'0'..=b'9' = self.peek() {
            value = value
                .saturating_mul(10)
                .saturating_add(u64::from(digit - b'0'));
            self.at += 1;
        }
        (self.at > start).then_some(value)
    }

    /// Moves only if there are that many digits.
    #[inline(always)]
    pub(super) fn hexadecimal<const DIGITS: usize>(&mut self) -> Option<u32> {
        let digits = self.units.get(self.at..)?.first_chunk::<DIGITS>()?;
        let (mut value, mut all) = (0, 0);
        for digit in digits {
            let digit = HEXADECIMAL_VALUES[usize::from(ascii(digit.to_u32()))];
            value = value << 4 | u32::from(digit);
            all |= digit;
        }
        if all >= NOT_HEXADECIMAL {
            return None;
        }
        self.at += DIGITS;
        Some(value)
    }
}

#[inline(always)]
pub(super) fn is_lead_surrogate(unit: u32) -> bool {
    unit & !0x3ff == 0xd800
}

#[inline(always)]
pub(super) fn is_trail_surrogate(unit: u32) -> bool {
    unit & !0x3ff == 0xdc00
}

#[inline(always)]
pub(super) fn join_surrogates(lead: u32, trail: u32) -> u32 {
    0x10000 + ((lead - 0xd800) << 10) + (trail - 0xdc00)
}
