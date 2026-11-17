//! The kernels of `bun_zlib`, from src/jsc/bindings/highway_zlib.cpp.

use core::cell::Cell;

unsafe extern "C" {
    fn highway_repeat(from: *const Cell<u8>, to: *const Cell<u8>, period: usize, len: usize);
    fn highway_subtract_saturating(values: *mut [u16; 64], groups: usize, amount: u16);
}

#[inline]
pub fn subtract_saturating(values: &mut [[u16; 64]], amount: u16) {
    // SAFETY: the kernel reads and writes so many groups.
    unsafe { highway_subtract_saturating(values.as_mut_ptr(), values.len(), amount) }
}

pub const MATCH_SPAN: usize = 320;

/// Writes the first `period` bytes of `from`, 1 to 31, again and again: `len` bytes, and up to 31 more.
#[inline(always)]
pub fn repeat(
    from: &[Cell<u8>; MATCH_SPAN],
    to: &[Cell<u8>; MATCH_SPAN],
    period: usize,
    len: usize,
) {
    let (period, len) = (period.clamp(1, 31), len.min(MATCH_SPAN - 31));
    // SAFETY: the kernel reads 32 bytes and writes `len + 31` at most, or 32. Cells are not shared between threads.
    unsafe { highway_repeat(from.as_ptr(), to.as_ptr(), period, len) }
}
