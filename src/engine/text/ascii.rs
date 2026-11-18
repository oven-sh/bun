use bun_alloc::AllocError;
use bun_highway::text as kernels;
use bun_pod::slice_as_bytes;

use crate::block::{self, BLOCK, Not, Positions, Units, block, singles};
use crate::{CodeUnit, StringRef, Text, with_text};

/// How many bytes are looked at before a kernel takes over.
const SHORT: usize = 512;

/// Whether a unit is above `LIMIT`, which is a power of two less one.
#[inline(always)]
fn any_above<T: CodeUnit, const LIMIT: u8>(units: &[T]) -> bool {
    let (bytes, length) = (slice_as_bytes(units), units.len());
    let above = Units(units, |unit: T| unit > T::from(LIMIT));
    if bytes.len() < 4 {
        let all = |[p, q, r]: [usize; 3]| units[p].to_u16() | units[q].to_u16() | units[r].to_u16();
        length > 0 && all(singles(length)) > u16::from(LIMIT)
    } else if bytes.len() <= 16 {
        let word = |at| u32::from_le_bytes(*block(bytes, at));
        let ones = if T::IS_LATIN1 {
            0x0101_0101
        } else {
            0x0001_0001
        };
        block::union_of_quarters(bytes.len(), word) & !(ones * u32::from(LIMIT)) != 0
    } else if length < BLOCK {
        let word = |at| u128::from_le_bytes(*block(bytes, at));
        (word(0) | word(bytes.len() - 16)) & !(u128::MAX / 0xffff * u128::from(LIMIT)) != 0
    } else if length <= 2 * BLOCK {
        above.any_in([0, length - BLOCK])
    } else if length <= 4 * BLOCK {
        above.any_in([0, BLOCK, length - 2 * BLOCK, length - BLOCK])
    } else {
        any_above_in_long::<T, LIMIT>(units)
    }
}

/// More than four blocks.
#[inline(never)]
fn any_above_in_long<T: CodeUnit, const LIMIT: u8>(units: &[T]) -> bool {
    let above = Units(units, |unit: T| unit > T::from(LIMIT));
    if size_of_val(units) > SHORT {
        return above.any_in([0]) || kernels::find_above(units, T::from(LIMIT)).is_some();
    }
    block::any_of_many(above)
}

#[inline]
pub(crate) fn is_ascii<T: CodeUnit>(units: &[T]) -> bool {
    !any_above::<T, 0x7f>(units)
}

#[inline]
pub(crate) fn fits_latin1<T: CodeUnit>(units: &[T]) -> bool {
    T::IS_LATIN1 || !any_above::<T, 0xff>(units)
}

#[inline(always)]
pub(crate) fn find_above<T: CodeUnit>(units: &[T], limit: T) -> Option<usize> {
    const SHORT: usize = kernels::MINIMUM_LENGTH;
    let long = |at: usize| {
        let at = at.min(units.len() - SHORT);
        kernels::find_above(&units[at..], limit).map(|index| at + index)
    };
    block::first_or_else(Not(Units(units, |unit| unit <= limit)), SHORT, long)
}

#[inline]
pub(crate) fn find_non_ascii<T: CodeUnit>(units: &[T]) -> Option<usize> {
    find_above(units, T::from(0x7f))
}

/// `None` if nothing changes.
#[inline]
fn convert<T: CodeUnit>(
    units: &[T],
    changes: impl Fn(T) -> bool + Copy,
    map: impl Fn(T) -> T + Copy,
) -> Result<Option<StringRef>, AllocError> {
    if !block::any(Units(units, changes)) {
        return Ok(None);
    }
    StringRef::try_write(units.len(), |cursor| cursor.push_mapped(units, map)).map(Some)
}

impl Text<'_> {
    #[inline(always)]
    pub fn is_ascii(self) -> bool {
        with_text!(self, |units| is_ascii(units))
    }

    /// Whether every unit fits in a byte, whichever width stores it.
    #[inline(always)]
    pub fn fits_latin1(self) -> bool {
        with_text!(self, |units| fits_latin1(units))
    }

    #[inline(always)]
    pub fn find_non_ascii(self) -> Option<usize> {
        with_text!(self, |units| find_non_ascii(units))
    }

    #[inline(always)]
    pub fn find_non_latin1(self) -> Option<usize> {
        match self {
            Text::Latin1(_) => None,
            Text::Utf16(units) => find_above(units, 0xff),
        }
    }

    /// `None` if nothing changes.
    #[inline(always)]
    pub fn to_ascii_lower_case(self) -> Result<Option<StringRef>, AllocError> {
        with_text!(self, |units| convert(
            units,
            CodeUnit::is_ascii_upper,
            CodeUnit::to_ascii_lower
        ))
    }

    /// `None` if nothing changes.
    #[inline(always)]
    pub fn to_ascii_upper_case(self) -> Result<Option<StringRef>, AllocError> {
        with_text!(self, |units| convert(
            units,
            CodeUnit::is_ascii_lower,
            CodeUnit::to_ascii_upper
        ))
    }
}
