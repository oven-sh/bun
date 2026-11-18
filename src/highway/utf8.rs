//! From UTF-8 to UTF-16, from src/jsc/bindings/highway_utf8.cpp.

use core::mem::MaybeUninit;

/// With so much room to spare, no step is too wide.
pub const SLACK: usize = 64;
/// The room that the narrowest step takes.
pub const LEAST_ROOM: usize = 16;

#[repr(C)]
struct Progress {
    read: usize,
    written: usize,
}

unsafe extern "C" {
    fn highway_utf8_decode(from: *const u8, len: usize, to: *mut u16, room: usize) -> Progress;
}

/// Decodes a start of `source`. Returns how many bytes it has read, and how many units it has initialized at the start
/// of `target`; it may write more. It stops short, between two characters, if [`LEAST_ROOM`] or less is left, and
/// within 18 bytes of an invalid sequence.
#[inline(always)]
pub fn decode(source: &[u8], target: &mut [MaybeUninit<u16>]) -> (usize, usize) {
    if cfg!(miri) {
        return (0, 0);
    }
    // SAFETY: the kernel reads `source` and writes inside `target`.
    let progress = unsafe {
        highway_utf8_decode(
            source.as_ptr(),
            source.len(),
            target.as_mut_ptr().cast(),
            target.len(),
        )
    };
    (progress.read, progress.written)
}
