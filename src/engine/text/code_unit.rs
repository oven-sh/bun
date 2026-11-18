use core::mem::MaybeUninit;

use crate::{Text, copy};

mod sealed {
    pub trait Sealed {}
    impl Sealed for u8 {}
    impl Sealed for u16 {}
}

/// An element of a string: a Latin-1 character (`u8`) or a UTF-16 code unit (`u16`).
pub trait CodeUnit:
    sealed::Sealed
    + bun_highway::text::Unit
    + bun_pod::Pod
    + Copy
    + Ord
    + Default
    + From<u8>
    + Into<u16>
    + Into<u32>
    + Send
    + Sync
    + 'static
{
    const IS_LATIN1: bool;

    fn to_u16(self) -> u16;

    /// Keeps the bits that fit.
    fn from_u16_truncating(unit: u16) -> Self;

    fn text(units: &[Self]) -> Text<'_>;

    /// The units of `text` if they are stored as `Self`.
    fn units(text: Text<'_>) -> Option<&[Self]>;

    /// Writes all of `target`, which is as long as `characters`.
    fn copy_from_latin1(target: &mut [MaybeUninit<Self>], characters: &[u8]);

    /// Writes all of `target`, which is as long as `units`, with the bits that fit.
    fn copy_from_utf16(target: &mut [MaybeUninit<Self>], units: &[u16]);

    fn to_ascii_lower(self) -> Self;

    fn to_ascii_upper(self) -> Self;

    /// `None` if the unit does not fit.
    #[inline(always)]
    fn from_u16(unit: u16) -> Option<Self> {
        (!Self::IS_LATIN1 || unit.is_latin1()).then(|| Self::from_u16_truncating(unit))
    }

    #[inline(always)]
    fn to_u32(self) -> u32 {
        u32::from(self.to_u16())
    }

    #[inline(always)]
    fn is(self, ascii: u8) -> bool {
        self.to_u16() == u16::from(ascii)
    }

    #[inline(always)]
    fn is_ascii(self) -> bool {
        self.to_u16() < 0x80
    }

    #[inline(always)]
    fn is_latin1(self) -> bool {
        self.to_u16() < 0x100
    }

    #[inline(always)]
    fn is_ascii_digit(self) -> bool {
        self.to_u16().wrapping_sub(u16::from(b'0')) < 10
    }

    #[inline(always)]
    fn is_ascii_alphabetic(self) -> bool {
        (self.to_u16() | 0x20).wrapping_sub(u16::from(b'a')) < 26
    }

    #[inline(always)]
    fn is_ascii_upper(self) -> bool {
        self.to_u16().wrapping_sub(u16::from(b'A')) < 26
    }

    #[inline(always)]
    fn is_ascii_lower(self) -> bool {
        self.to_u16().wrapping_sub(u16::from(b'a')) < 26
    }

    #[inline(always)]
    fn is_surrogate(self) -> bool {
        self.to_u16() & 0xf800 == 0xd800
    }

    #[inline(always)]
    fn is_lead_surrogate(self) -> bool {
        self.to_u16() & 0xfc00 == 0xd800
    }

    #[inline(always)]
    fn is_trail_surrogate(self) -> bool {
        self.to_u16() & 0xfc00 == 0xdc00
    }

    /// The value of a digit in a radix up to 36.
    #[inline]
    fn digit_value(self, radix: u32) -> Option<u32> {
        let unit = self.to_u32();
        let value = if self.is_ascii_digit() {
            unit - u32::from(b'0')
        } else if self.is_ascii_alphabetic() {
            (unit | 0x20) - u32::from(b'a') + 10
        } else {
            return None;
        };
        (value < radix).then_some(value)
    }
}

impl CodeUnit for u8 {
    const IS_LATIN1: bool = true;

    #[inline(always)]
    fn to_u16(self) -> u16 {
        u16::from(self)
    }

    #[inline(always)]
    fn from_u16_truncating(unit: u16) -> u8 {
        unit as u8
    }

    #[inline(always)]
    fn text(units: &[u8]) -> Text<'_> {
        Text::Latin1(units)
    }

    #[inline(always)]
    fn units(text: Text<'_>) -> Option<&[u8]> {
        match text {
            Text::Latin1(units) => Some(units),
            Text::Utf16(_) => None,
        }
    }

    #[inline(always)]
    fn copy_from_latin1(target: &mut [MaybeUninit<u8>], characters: &[u8]) {
        copy::copy(target, characters);
    }

    #[inline(always)]
    fn copy_from_utf16(target: &mut [MaybeUninit<u8>], units: &[u16]) {
        copy::narrow(target, units);
    }

    #[inline(always)]
    fn to_ascii_lower(self) -> u8 {
        self | u8::from(self.is_ascii_upper()) << 5
    }

    #[inline(always)]
    fn to_ascii_upper(self) -> u8 {
        self ^ u8::from(self.is_ascii_lower()) << 5
    }
}

impl CodeUnit for u16 {
    const IS_LATIN1: bool = false;

    #[inline(always)]
    fn to_u16(self) -> u16 {
        self
    }

    #[inline(always)]
    fn from_u16_truncating(unit: u16) -> u16 {
        unit
    }

    #[inline(always)]
    fn text(units: &[u16]) -> Text<'_> {
        Text::Utf16(units)
    }

    #[inline(always)]
    fn units(text: Text<'_>) -> Option<&[u16]> {
        match text {
            Text::Latin1(_) => None,
            Text::Utf16(units) => Some(units),
        }
    }

    #[inline(always)]
    fn copy_from_latin1(target: &mut [MaybeUninit<u16>], characters: &[u8]) {
        copy::widen(target, characters);
    }

    #[inline(always)]
    fn copy_from_utf16(target: &mut [MaybeUninit<u16>], units: &[u16]) {
        copy::copy(target, units);
    }

    #[inline(always)]
    fn to_ascii_lower(self) -> u16 {
        self | u16::from(self.is_ascii_upper()) << 5
    }

    #[inline(always)]
    fn to_ascii_upper(self) -> u16 {
        self ^ u16::from(self.is_ascii_lower()) << 5
    }
}
