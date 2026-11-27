use bun_core::strings::{self, CodeUnits};
use bun_paths::PathChar;

use crate::{BACKSLASH, COLON, CodeUnit, DOT, SLASH, is_sep};

const fn assert_is_sep(separator: u8) {
    assert!(separator == SLASH || separator == BACKSLASH);
}

/// The first separator that is followed by an empty, "." or ".." segment.
#[inline(always)]
pub(crate) fn index_of_untidy_sep<U: CodeUnit, const SEPARATOR: u8>(path: &[U]) -> Option<usize> {
    const { assert_is_sep(SEPARATOR) };
    match U::units(path) {
        CodeUnits::U8(path) if SEPARATOR == SLASH => bun_highway::index_of_untidy_slash(path),
        CodeUnits::U8(path) => bun_highway::index_of_untidy_backslash(path),
        CodeUnits::U16(path) => utf16::index_of_untidy_sep::<SEPARATOR>(path, |_| false),
    }
}

#[inline(always)]
pub(crate) fn has_untidy_backslash_or_slash_or_colon<U: CodeUnit>(path: &[U]) -> bool {
    match U::units(path) {
        CodeUnits::U8(path) => {
            bun_highway::index_of_untidy_backslash_or_slash_or_colon(path).is_some()
        }
        CodeUnits::U16(path) => {
            let is_stop = |unit: u16| unit.eq_ascii(SLASH) | unit.eq_ascii(COLON);
            path.last().is_some_and(|&unit| is_stop(unit))
                || utf16::index_of_untidy_sep::<BACKSLASH>(path, is_stop).is_some()
        }
    }
}

#[inline(always)]
pub(crate) fn index_of<U: CodeUnit>(text: &[U], ascii: u8) -> Option<usize> {
    match U::units(text) {
        CodeUnits::U8(text) => strings::index_of_char_usize(text, ascii),
        CodeUnits::U16(text) => utf16::first(text, |unit| unit.eq_ascii(ascii)),
    }
}

pub(crate) fn indices_of<U: CodeUnit>(text: &[U], ascii: u8) -> impl Iterator<Item = usize> {
    core::iter::successors(index_of(text, ascii), move |&at| {
        Some(at + 1 + index_of(&text[at + 1..], ascii)?)
    })
}

/// The most units that [`either_bits`] takes.
pub(crate) const BLOCK: usize = u64::BITS as usize;

/// Bit `i` is set if `block[i]` is `a` or `b`.
#[inline(always)]
pub(crate) fn either_bits<U: CodeUnit>(block: &[U], a: u8, b: u8) -> u64 {
    match U::units(block) {
        CodeUnits::U8(block) => bun_highway::either_byte_bits(block, a, b),
        CodeUnits::U16(block) => utf16::mask(block, |unit| unit.eq_ascii(a) | unit.eq_ascii(b)),
    }
}

pub(crate) fn index_of_slash_or_backslash<U: CodeUnit>(path: &[U]) -> Option<usize> {
    path.chunks(BLOCK).enumerate().find_map(|(index, block)| {
        let at = either_bits(block, SLASH, BACKSLASH).lowest_one()?;
        Some(index * BLOCK + at as usize)
    })
}

#[inline(always)]
pub(crate) fn last_index_of_sep<U: CodeUnit, const SEPARATOR: u8>(path: &[U]) -> Option<usize> {
    const { assert_is_sep(SEPARATOR) };
    match U::units(path) {
        CodeUnits::U8(path) if SEPARATOR == SLASH => bun_highway::last_index_of_slash(path),
        CodeUnits::U8(path) => bun_highway::last_index_of_backslash(path),
        CodeUnits::U16(path) => utf16::last(path, |unit| unit.eq_ascii(SEPARATOR)),
    }
}

#[inline(always)]
pub(crate) fn last_index_of_any_sep<U: CodeUnit, const WIN32: bool>(path: &[U]) -> Option<usize> {
    match U::units(path) {
        CodeUnits::U8(path) if WIN32 => bun_highway::last_index_of_slash_or_backslash(path),
        CodeUnits::U8(path) => bun_highway::last_index_of_slash(path),
        CodeUnits::U16(path) => utf16::last(path, is_sep::<u16, WIN32>),
    }
}

#[inline(always)]
pub(crate) fn last_index_of_any_sep_or_dot<U: CodeUnit, const WIN32: bool>(
    path: &[U],
) -> Option<usize> {
    match U::units(path) {
        CodeUnits::U8(path) if WIN32 => bun_highway::last_index_of_slash_or_backslash_or_dot(path),
        CodeUnits::U8(path) => bun_highway::last_index_of_slash_or_dot(path),
        CodeUnits::U16(path) => {
            utf16::last(path, |unit| is_sep::<u16, WIN32>(unit) | unit.eq_ascii(DOT))
        }
    }
}

#[inline(always)]
pub(crate) fn count_seps<U: CodeUnit, const SEPARATOR: u8>(path: &[U]) -> usize {
    const { assert_is_sep(SEPARATOR) };
    match U::units(path) {
        CodeUnits::U8(path) if SEPARATOR == SLASH => bun_highway::count_slashes(path),
        CodeUnits::U8(path) => bun_highway::count_backslashes(path),
        CodeUnits::U16(path) => path.iter().filter(|unit| unit.eq_ascii(SEPARATOR)).count(),
    }
}

#[inline(always)]
pub(crate) fn common_prefix_length<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> usize {
    match (A::units(a), B::units(b)) {
        (CodeUnits::U8(a), CodeUnits::U8(b)) => bun_highway::common_prefix_length(a, b),
        _ => utf16::first_pair(a, b, |a, b| a.into() != b.into(), |_| true)
            .unwrap_or_else(|| a.len().min(b.len())),
    }
}

#[inline(always)]
pub(crate) fn eql<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> bool {
    a.len() == b.len() && common_prefix_length(a, b) == a.len()
}

/// The predicates use `&` and `|`: `&&` and `||` keep LLVM from vectorizing a block.
mod utf16 {
    use bun_paths::PathChar;

    use crate::{DOT, dot_segment_len};

    const LANES: usize = 16;
    const HALF: usize = LANES / 2;

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
    fn first_confirmed(
        start: usize,
        mut found: u32,
        confirm: impl Fn(usize) -> bool,
    ) -> Option<usize> {
        while found != 0 {
            let at = start + found.trailing_zeros() as usize;
            if confirm(at) {
                return Some(at);
            }
            found &= found - 1;
        }
        None
    }

    /// The first index at which `is(a[i], b[i])` and `confirm(i)` hold.
    #[inline(always)]
    pub(super) fn first_pair<A: Copy, B: Copy>(
        a: &[A],
        b: &[B],
        is: impl Fn(A, B) -> bool + Copy,
        confirm: impl Fn(usize) -> bool + Copy,
    ) -> Option<usize> {
        let len = a.len().min(b.len());
        let (a, b) = (&a[..len], &b[..len]);
        if let (Some(a_end), Some(b_end)) = (a.last_chunk::<LANES>(), b.last_chunk::<LANES>()) {
            let (a, b) = (a.as_chunks::<LANES>().0, b.as_chunks::<LANES>().0);
            for index in 0..a.len() {
                let found = bits(&a[index], &b[index], is);
                if let Some(at) = first_confirmed(index * LANES, found, confirm) {
                    return Some(at);
                }
            }
            return first_confirmed(len - LANES, bits(a_end, b_end, is), confirm);
        }
        let found = if let (Some(a_start), Some(b_start), Some(a_end), Some(b_end)) = (
            a.first_chunk::<HALF>(),
            b.first_chunk::<HALF>(),
            a.last_chunk::<HALF>(),
            b.last_chunk::<HALF>(),
        ) {
            bits(a_start, b_start, is) | (bits(a_end, b_end, is) << (len - HALF))
        } else {
            let mut found = 0;
            for at in 0..len {
                found |= u32::from(is(a[at], b[at])) << at;
            }
            found
        };
        first_confirmed(0, found, confirm)
    }

    #[inline(always)]
    pub(super) fn first(text: &[u16], is: impl Fn(u16) -> bool + Copy) -> Option<usize> {
        first_pair(text, text, |unit, _| is(unit), |_| true)
    }

    #[inline(always)]
    pub(super) fn mask(text: &[u16], is: impl Fn(u16) -> bool + Copy) -> u64 {
        debug_assert!(text.len() <= super::BLOCK);
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

    /// Also stops where `is_stop` holds, except at the last unit.
    #[inline(always)]
    pub(super) fn index_of_untidy_sep<const SEPARATOR: u8>(
        path: &[u16],
        is_stop: impl Fn(u16) -> bool + Copy,
    ) -> Option<usize> {
        let next = path.get(1..)?;
        first_pair(
            path,
            next,
            |unit, next| {
                is_stop(unit)
                    | (unit.eq_ascii(SEPARATOR) & (next.eq_ascii(SEPARATOR) | next.eq_ascii(DOT)))
            },
            |at| {
                is_stop(path[at])
                    || !next[at].eq_ascii(DOT)
                    || dot_segment_len::<u16, SEPARATOR>(&next[at..]) != 0
            },
        )
    }

    #[inline(always)]
    pub(super) fn last(text: &[u16], is: impl Fn(u16) -> bool + Copy) -> Option<usize> {
        let is_pair = |unit, _| is(unit);
        let mut rest = text;
        while let Some((before, block)) = rest.split_last_chunk::<LANES>() {
            if let Some(at) = bits(block, block, is_pair).checked_ilog2() {
                return Some(before.len() + at as usize);
            }
            rest = before;
        }
        let found = if let Some(start) = text.first_chunk::<LANES>() {
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
