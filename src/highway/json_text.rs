//! Steps of a JSON parser over a few characters, from src/jsc/bindings/highway_json_text.cpp.

/// The bytes that a kernel looks at in one step.
pub const BLOCK: usize = 16;

#[derive(Clone, Copy, Default)]
#[repr(C, align(16))]
pub struct Prefix(pub [u8; 2 * BLOCK]);

unsafe extern "C" {
    fn highway_json_starts_with(text: &[u8; 2 * BLOCK], prefix: &Prefix, len: usize) -> bool;
    safe fn highway_json_plain_ascii_length(text: &[u8; BLOCK]) -> u32;
    safe fn highway_json_white_space_length(text: &[u8; BLOCK]) -> u32;
}

/// Whether the first `len` bytes are the same.
///
/// # Safety
/// There are so many.
#[inline(always)]
pub unsafe fn starts_with(text: &[u8; 2 * BLOCK], prefix: &Prefix, len: usize) -> bool {
    debug_assert!(len <= text.len());
    if cfg!(miri) {
        return text[..len] == prefix.0[..len];
    }
    // SAFETY: the caller's.
    unsafe { highway_json_starts_with(text, prefix, len) }
}

#[inline(always)]
fn run(
    text: &[u8; BLOCK],
    kernel: extern "C" fn(&[u8; BLOCK]) -> u32,
    test: impl Fn(u8) -> bool,
) -> u32 {
    let scalar = || text.iter().take_while(|&&byte| test(byte)).count() as u32;
    if cfg!(miri) {
        return scalar();
    }
    let length = kernel(text);
    debug_assert_eq!(length, scalar());
    // SAFETY: the index of a lane, or their number.
    unsafe { core::hint::assert_unchecked(length <= BLOCK as u32) };
    length
}

/// How many bytes at the start are ASCII characters that stand for themselves between quotes.
#[inline(always)]
pub fn plain_ascii_len(text: &[u8; BLOCK]) -> u32 {
    run(text, highway_json_plain_ascii_length, |byte| {
        matches!(byte, 0x20..0x80) && byte != b'"' && byte != b'\\'
    })
}

/// How many bytes at the start are white space.
#[inline(always)]
pub fn white_space_len(text: &[u8; BLOCK]) -> u32 {
    run(text, highway_json_white_space_length, |byte| {
        matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
    })
}
