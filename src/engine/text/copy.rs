//! Copies of units. Each function writes all of its target, and panics unless that is as long as the source.

use core::mem::MaybeUninit;

use bun_highway::text as kernels;

use crate::block::{
    BLOCK, Positions, QUARTER, Units, block, block_mut, singles, unordered_quarters,
};
use crate::{CodeUnit, Text};

/// Up to here a call takes longer than the copy.
const SHORT_COPY: usize = 32;
const SHORT_CONVERSION: usize = 128;

/// Maps `source` to `target` unless a unit passes `stop`. Returns whether one does; then `target` has gaps.
#[inline(always)]
pub(crate) fn map_unless<S: Copy, T>(
    target: &mut [MaybeUninit<T>],
    source: &[S],
    map: impl Fn(S) -> T + Copy,
    stop: impl Fn(S) -> bool + Copy,
) -> bool {
    let length = source.len();
    assert!(target.len() == length);
    let stopping = Units(source, stop);
    macro_rules! blocks {
        ($($at:expr),*) => {{
            let starts = [$($at),*];
            let stops = stopping.any_in(starts);
            map_parts::<S, T, BLOCK, _>(target, source, starts, map);
            stops
        }};
    }
    if length < QUARTER {
        length > 0 && {
            let stops = stopping.any_gathered::<1, _>(singles(length));
            map_parts::<S, T, 1, _>(target, source, singles(length), map);
            stops
        }
    } else if length <= BLOCK {
        let starts = unordered_quarters(length);
        let stops = stopping.any_gathered::<QUARTER, _>(starts);
        map_parts::<S, T, QUARTER, _>(target, source, starts, map);
        stops
    } else if length <= 2 * BLOCK {
        blocks!(0, length - BLOCK)
    } else {
        let last = length - 2 * BLOCK;
        let mut at = 0;
        while at + 2 * BLOCK < last {
            if stopping.window::<{ 2 * BLOCK }>(at).any_in([0, BLOCK]) {
                return true;
            }
            let target = block_mut::<_, { 2 * BLOCK }>(target, at);
            map_parts::<S, T, BLOCK, _>(
                target,
                block::<_, { 2 * BLOCK }>(source, at),
                [0, BLOCK],
                map,
            );
            at += 2 * BLOCK;
        }
        blocks!(at, at + BLOCK, last, last + BLOCK)
    }
}

#[inline(always)]
fn map_parts<S: Copy, T, const SIZE: usize, const PARTS: usize>(
    target: &mut [MaybeUninit<T>],
    source: &[S],
    starts: [usize; PARTS],
    map: impl Fn(S) -> T,
) {
    for at in starts {
        let (to, from) = (
            block_mut::<_, SIZE>(target, at),
            block::<_, SIZE>(source, at),
        );
        for lane in 0..SIZE {
            to[lane].write(map(from[lane]));
        }
    }
}

#[inline(always)]
pub(crate) fn map<S: Copy, T>(
    target: &mut [MaybeUninit<T>],
    source: &[S],
    map: impl Fn(S) -> T + Copy,
) {
    map_unless(target, source, map, |_| false);
}

#[inline(always)]
pub(crate) fn copy<T: Copy>(target: &mut [MaybeUninit<T>], source: &[T]) {
    if source.len() <= SHORT_COPY {
        map(target, source, |unit| unit);
    } else {
        target.write_copy_of_slice(source);
    }
}

#[inline(always)]
pub(crate) fn widen(target: &mut [MaybeUninit<u16>], source: &[u8]) {
    if source.len() <= SHORT_CONVERSION {
        map(target, source, u16::from);
    } else {
        kernels::widen(source, target);
    }
}

/// Keeps the low byte of each unit.
#[inline(always)]
pub(crate) fn narrow(target: &mut [MaybeUninit<u8>], source: &[u16]) {
    if source.len() <= SHORT_CONVERSION {
        map(target, source, |unit| unit as u8);
    } else {
        kernels::narrow(source, target);
    }
}

impl Text<'_> {
    /// Writes all of `target`, which is as long as the text. Of a unit that is too wide, the low byte is kept.
    #[inline(always)]
    pub fn copy_to<T: CodeUnit>(self, target: &mut [MaybeUninit<T>]) {
        match self {
            Text::Latin1(characters) => T::copy_from_latin1(target, characters),
            Text::Utf16(units) => T::copy_from_utf16(target, units),
        }
    }
}

/// Fills `target` with `pattern` again and again, the last time as far as it goes. `pattern` is not empty.
#[inline(always)]
pub(crate) fn fill<T: CodeUnit>(target: &mut [MaybeUninit<T>], pattern: Text<'_>) {
    if pattern.len() == 1 && target.len() <= SHORT_COPY {
        let units = [T::from_u16_truncating(pattern.at(0)); SHORT_COPY];
        return copy(target, &units[..target.len()]);
    }
    fill_long(target, pattern);
}

#[inline(never)]
fn fill_long<T: CodeUnit>(target: &mut [MaybeUninit<T>], pattern: Text<'_>) {
    if pattern.len() == 1 {
        target.write_filled(T::from_u16_truncating(pattern.at(0)));
        return;
    }
    let mut filled = pattern.len().min(target.len());
    pattern.slice(0..filled).copy_to(&mut target[..filled]);
    while filled < target.len() {
        let (written, rest) = target.split_at_mut(filled);
        let count = filled.min(rest.len());
        // SAFETY: just written.
        copy(&mut rest[..count], unsafe {
            written[..count].assume_init_ref()
        });
        filled += count;
    }
}
