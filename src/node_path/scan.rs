//! Searches for either width.

use bun_core::strings;

use crate::{BACKSLASH, COLON, CodeUnits, DOT, SLASH, Unit, is_separator, leading_dots};

/// The first separator in front of another separator, "." or "..".
#[inline(always)]
pub(crate) fn first_untidy<U: Unit, const SEPARATOR: u8>(path: &[U]) -> Option<usize> {
    match U::units(path) {
        CodeUnits::U8(path) if SEPARATOR == SLASH => bun_highway::index_of_untidy_slash(path),
        CodeUnits::U8(path) => bun_highway::index_of_untidy_backslash(path),
        CodeUnits::U16(path) => wide::first_untidy::<SEPARATOR>(path, |_| false),
    }
}

#[inline(always)]
pub(crate) fn has_untidy_backslash_or_slash_or_colon<U: Unit>(path: &[U]) -> bool {
    match U::units(path) {
        CodeUnits::U8(path) => {
            bun_highway::index_of_untidy_backslash_or_slash_or_colon(path).is_some()
        }
        CodeUnits::U16(path) => {
            let stops = |unit: u16| unit.is(SLASH) | unit.is(COLON);
            path.last().is_some_and(|&unit| stops(unit))
                || wide::first_untidy::<BACKSLASH>(path, stops).is_some()
        }
    }
}

#[inline(always)]
pub(crate) fn first<U: Unit>(text: &[U], ascii: u8) -> Option<usize> {
    match U::units(text) {
        CodeUnits::U8(text) => strings::index_of_char_usize(text, ascii),
        CodeUnits::U16(text) => wide::first(text, |unit| unit.is(ascii)),
    }
}

/// The index of each `ascii`.
pub(crate) fn each<U: Unit>(text: &[U], ascii: u8) -> impl Iterator<Item = usize> {
    core::iter::successors(first(text, ascii), move |&at| {
        Some(at + 1 + first(&text[at + 1..], ascii)?)
    })
}

/// How many units [`either_bits`] takes.
pub(crate) const BLOCK: usize = 64;

/// A bit for each unit, the lowest first: whether it is `a` or `b`.
#[inline(always)]
pub(crate) fn either_bits<U: Unit>(block: &[U], a: u8, b: u8) -> u64 {
    match U::units(block) {
        CodeUnits::U8(block) => bun_highway::either_byte_bits(block, a, b),
        CodeUnits::U16(block) => wide::all(block, |unit| unit.is(a) | unit.is(b)),
    }
}

pub(crate) fn first_slash_or_backslash<U: Unit>(path: &[U]) -> Option<usize> {
    path.chunks(BLOCK).enumerate().find_map(|(index, block)| {
        let at = either_bits(block, SLASH, BACKSLASH).lowest_one()?;
        Some(index * BLOCK + at as usize)
    })
}

#[inline(always)]
pub(crate) fn last<U: Unit, const SEPARATOR: u8>(path: &[U]) -> Option<usize> {
    match U::units(path) {
        CodeUnits::U8(path) if SEPARATOR == SLASH => bun_highway::last_index_of_slash(path),
        CodeUnits::U8(path) => bun_highway::last_index_of_backslash(path),
        CodeUnits::U16(path) => wide::last(path, |unit| unit.is(SEPARATOR)),
    }
}

#[inline(always)]
pub(crate) fn last_separator<U: Unit, const WIN32: bool>(path: &[U]) -> Option<usize> {
    match U::units(path) {
        CodeUnits::U8(path) if WIN32 => bun_highway::last_index_of_slash_or_backslash(path),
        CodeUnits::U8(path) => bun_highway::last_index_of_slash(path),
        CodeUnits::U16(path) => wide::last(path, is_separator::<u16, WIN32>),
    }
}

#[inline(always)]
pub(crate) fn last_separator_or_dot<U: Unit, const WIN32: bool>(path: &[U]) -> Option<usize> {
    match U::units(path) {
        CodeUnits::U8(path) if WIN32 => bun_highway::last_index_of_slash_or_backslash_or_dot(path),
        CodeUnits::U8(path) => bun_highway::last_index_of_slash_or_dot(path),
        CodeUnits::U16(path) => {
            wide::last(path, |unit| is_separator::<u16, WIN32>(unit) | unit.is(DOT))
        }
    }
}

#[inline(always)]
pub(crate) fn count<U: Unit, const SEPARATOR: u8>(path: &[U]) -> usize {
    match U::units(path) {
        CodeUnits::U8(path) if SEPARATOR == SLASH => bun_highway::count_slashes(path),
        CodeUnits::U8(path) => bun_highway::count_backslashes(path),
        CodeUnits::U16(path) => path.iter().filter(|unit| unit.is(SEPARATOR)).count(),
    }
}

/// How many units `a` and `b` start with in common.
#[inline(always)]
pub(crate) fn common_prefix<A: Unit, B: Unit>(a: &[A], b: &[B]) -> usize {
    match (A::units(a), B::units(b)) {
        (CodeUnits::U8(a), CodeUnits::U8(b)) => bun_highway::common_prefix_length(a, b),
        _ => wide::first_pair(a, b, |a, b| a.into() != b.into(), |_| true)
            .unwrap_or_else(|| a.len().min(b.len())),
    }
}

#[inline(always)]
pub(crate) fn equal<A: Unit, B: Unit>(a: &[A], b: &[B]) -> bool {
    a.len() == b.len() && common_prefix(a, b) == a.len()
}

/// `is` is written with `&` and `|`, which is what lets a block be vectorized.
mod wide {
    use super::{DOT, Unit, leading_dots};

    const BLOCK: usize = 16;
    const HALF: usize = 8;

    #[inline(always)]
    fn bits<A: Copy, B: Copy, const N: usize>(
        a: &[A; N],
        b: &[B; N],
        is: impl Fn(A, B) -> bool,
    ) -> u32 {
        let mut bits = 0;
        for at in 0..N {
            bits |= u32::from(is(a[at], b[at])) << at;
        }
        bits
    }

    #[inline(always)]
    fn confirmed(start: usize, mut found: u32, confirm: impl Fn(usize) -> bool) -> Option<usize> {
        while found != 0 {
            let at = start + found.trailing_zeros() as usize;
            if confirm(at) {
                return Some(at);
            }
            found &= found - 1;
        }
        None
    }

    /// The first index that both have, at which `is` holds and which `confirm` takes.
    #[inline(always)]
    pub(super) fn first_pair<A: Copy, B: Copy>(
        a: &[A],
        b: &[B],
        is: impl Fn(A, B) -> bool + Copy,
        confirm: impl Fn(usize) -> bool + Copy,
    ) -> Option<usize> {
        let length = a.len().min(b.len());
        let (a, b) = (&a[..length], &b[..length]);
        if let (Some(a_end), Some(b_end)) = (a.last_chunk::<BLOCK>(), b.last_chunk::<BLOCK>()) {
            let (a, b) = (a.as_chunks::<BLOCK>().0, b.as_chunks::<BLOCK>().0);
            for index in 0..a.len() {
                let found = bits(&a[index], &b[index], is);
                if let Some(at) = confirmed(index * BLOCK, found, confirm) {
                    return Some(at);
                }
            }
            return confirmed(length - BLOCK, bits(a_end, b_end, is), confirm);
        }
        let found = if let (Some(a_start), Some(b_start), Some(a_end), Some(b_end)) = (
            a.first_chunk::<HALF>(),
            b.first_chunk::<HALF>(),
            a.last_chunk::<HALF>(),
            b.last_chunk::<HALF>(),
        ) {
            bits(a_start, b_start, is) | (bits(a_end, b_end, is) << (length - HALF))
        } else {
            let mut found = 0;
            for at in 0..length {
                found |= u32::from(is(a[at], b[at])) << at;
            }
            found
        };
        confirmed(0, found, confirm)
    }

    #[inline(always)]
    pub(super) fn first(text: &[u16], is: impl Fn(u16) -> bool + Copy) -> Option<usize> {
        first_pair(text, text, |unit, _| is(unit), |_| true)
    }

    /// A bit for each of at most 64 units.
    #[inline(always)]
    pub(super) fn all(text: &[u16], is: impl Fn(u16) -> bool + Copy) -> u64 {
        let is_pair = |unit, _| is(unit);
        let Some(end) = text.last_chunk::<HALF>() else {
            let bit = |(at, &unit)| u64::from(is(unit)) << at;
            return text.iter().enumerate().map(bit).sum();
        };
        let mut found = u64::from(bits(end, end, is_pair)) << (text.len() - HALF);
        for (index, block) in text.as_chunks::<HALF>().0.iter().enumerate() {
            found |= u64::from(bits(block, block, is_pair)) << (index * HALF);
        }
        found
    }

    /// Or the first unit before the last at which it `stops`.
    #[inline(always)]
    pub(super) fn first_untidy<const SEPARATOR: u8>(
        path: &[u16],
        stops: impl Fn(u16) -> bool + Copy,
    ) -> Option<usize> {
        let next = path.get(1..)?;
        first_pair(
            path,
            next,
            |unit, next| stops(unit) | (unit.is(SEPARATOR) & (next.is(SEPARATOR) | next.is(DOT))),
            |at| {
                stops(path[at])
                    || !next[at].is(DOT)
                    || leading_dots::<u16, SEPARATOR>(&next[at..]) != 0
            },
        )
    }

    #[inline(always)]
    pub(super) fn last(text: &[u16], is: impl Fn(u16) -> bool + Copy) -> Option<usize> {
        let is_pair = |unit, _| is(unit);
        let mut rest = text;
        while let Some((before, block)) = rest.split_last_chunk::<BLOCK>() {
            if let Some(at) = bits(block, block, is_pair).checked_ilog2() {
                return Some(before.len() + at as usize);
            }
            rest = before;
        }
        let found = if let Some(start) = text.first_chunk::<BLOCK>() {
            bits(start, start, is_pair)
        } else if let (Some(start), Some(end)) =
            (text.first_chunk::<HALF>(), text.last_chunk::<HALF>())
        {
            bits(start, start, is_pair) | (bits(end, end, is_pair) << (text.len() - HALF))
        } else {
            return text.iter().rposition(|&unit| is(unit));
        };
        found.checked_ilog2().map(|at| at as usize)
    }
}
