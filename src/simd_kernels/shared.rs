//! Bytes that another thread can write. What was found can have changed on return.

use super::near::*;
use bun_simd::prelude::*;
use core::sync::atomic::AtomicU8;

/// Starts with two vectors of 32 bytes, which leave as few branches as one of 64.
#[simd]
fn first_by_two(text: &[AtomicU8], needle: u8) -> usize {
    let find = |text: &[AtomicU8]| u8xN::over(text).position(|v| v.simd_eq(needle));
    let bits = |at| u8x32::load_at(text, at).simd_eq(needle).to_bitmask();
    let len = text.len();
    if len < 32 {
        return find(text).unwrap_or(len);
    }
    let second = (len - 32).min(32);
    let bits = bits(0) | bits(second) << second;
    if bits != 0 {
        return bits.trailing_zeros() as usize;
    }
    if len <= 64 {
        return len;
    }
    let seen = (len - 32).min(64);
    find(&text[seen..]).map_or(len, |at| seen + at)
}

/// The length if there is none.
#[kernel(icelake, avx512 + aes + narrow, default)]
pub(crate) fn first(haystack: &[AtomicU8], needle: u8) -> usize {
    if has!(narrow) {
        return first_by_two(haystack, needle);
    }
    // A part of a vector takes long to put together.
    let is_short = !has!(masked) && haystack.len() < u8xN::LANES;
    if is_short && haystack.first().is_none_or(|it| it.value() == needle) {
        return 0;
    }
    first_near(haystack, |v| v.simd_eq(needle))
}

#[kernel]
pub(crate) fn last(haystack: &[AtomicU8], needle: u8, if_none: usize) -> usize {
    if haystack.len() < u8xN::LANES {
        match haystack.last() {
            None => return if_none,
            Some(it) if it.value() == needle => return haystack.len() - 1,
            _ => {}
        }
    }
    last_near(haystack, |v| v.simd_eq(needle)).unwrap_or(if_none)
}

/// A read-only view of bytes that another thread can write.
#[derive(Clone, Copy)]
pub struct SharedBytes<'a>(&'a [AtomicU8]);

impl<'a> SharedBytes<'a> {
    #[inline]
    pub fn new(bytes: &'a [AtomicU8]) -> Self {
        Self(bytes)
    }

    /// The first at `from` or after it.
    pub fn index_of_char(self, from: usize, needle: u8) -> Option<usize> {
        let at = from + first(self.0.get(from..)?, needle);
        (at < self.0.len()).then_some(at)
    }

    /// As [`encode_hex_lower`](crate::encode_hex_lower).
    pub fn encode_hex_lower(self, to: &mut [u8]) {
        super::hex::encode_shared(self.0, to)
    }
}
