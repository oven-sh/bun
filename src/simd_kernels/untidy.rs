//! What node:path has to normalize.

use bun_simd::prelude::*;

targets!(Upto<B32>);

/// The first suspect, at `at` plus the position of its bit, that isn't the '/' of a name that starts with a '.'.
#[simd]
fn first_confirmed(path: &[u8], at: usize, mut bits: u64) -> Option<usize> {
    while bits != 0 {
        let suspect = at + bits.trailing_zeros() as usize;
        match path.get(suspect..) {
            Some(&[b'/', b'.', b'.', next, ..]) if next != b'/' => {}
            Some(&[b'/', b'.', next, ..]) if next != b'/' && next != b'.' => {}
            _ => return Some(suspect),
        }
        bits &= bits - 1;
    }
    None
}

/// A '/' with a '/' or a '.' after it. '.' is '/' without its lowest bit.
#[simd]
fn suspects<const NON_ASCII: bool, W: Width>(
    bytes: Simd<u8, W, S>,
    next: Simd<u8, W, S>,
) -> MaskOf<u8, W, S> {
    let slashes = bytes.simd_eq(b'/') & (next | 1).simd_eq(b'/');
    if NON_ASCII {
        slashes | bytes.cast_signed().is_negative()
    } else {
        slashes
    }
}

/// `path` has more bytes than `W`.
#[simd]
fn untidy_slash_by<const NON_ASCII: bool, W: Width>(path: &[u8]) -> Option<usize> {
    assert!(path.len() > W::BYTES);
    // The last block ends with the path, so it may overlap the one before it.
    let last = path.len() - W::BYTES - 1;
    let look = |at: usize| {
        let (bytes, next) = (Simd::load_at(path, at), Simd::load_at(&path[1..], at));
        let found = suspects::<NON_ASCII, W, S>(bytes, next);
        if found.none() {
            return None;
        }
        core::hint::cold_path();
        first_confirmed(path, at, found.to_bitmask())
    };
    let mut at = 0;
    while at < last {
        if let Some(found) = look(at) {
            return Some(found);
        }
        at += W::BYTES;
    }
    if let Some(found) = look(last) {
        return Some(found);
    }
    let end = path.len() - 1;
    (NON_ASCII && !path[end].is_ascii()).then_some(end)
}

/// Up to 32 bytes no target has a wider vector to use.
const SHORT: usize = 32;

#[kernel(Upto<B16>)]
#[inline(never)]
fn short<const NON_ASCII: bool>(path: &[u8]) -> Option<usize> {
    if path.len() > 16 {
        return untidy_slash_by::<NON_ASCII, B16, S>(path);
    }
    let bytes = u8x16::load_or_default(path);
    let found = suspects::<NON_ASCII, B16, S>(bytes, bytes.shift_elements_left::<1>(0));
    if found.any() {
        first_confirmed(path, 0, found.to_bitmask())
    } else {
        None
    }
}

/// With one target only there is no dispatch to keep it out of line.
#[kernel]
#[inline(never)]
fn long<const NON_ASCII: bool>(path: &[u8]) -> Option<usize> {
    untidy_slash_by::<NON_ASCII, Native<S>, S>(path)
}

/// Index of the first `/` of `path` in front of a part that is empty, `.` or `..`. A part ends in front of a `/` or
/// where `path` ends.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_untidy_slash(path: &[u8]) -> Option<usize> {
    if path.len() <= SHORT {
        short::<false>(path)
    } else {
        long::<false>(path)
    }
}

/// Index of the first byte of `path` that is not ASCII or is what [`index_of_untidy_slash`] looks for.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_untidy_slash_or_non_ascii(path: &[u8]) -> Option<usize> {
    if path.len() <= SHORT {
        short::<true>(path)
    } else {
        long::<true>(path)
    }
}
