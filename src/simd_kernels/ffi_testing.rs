//! What src/jsc/bindings/simd_strings_testing.cpp calls. It passes no shared memory.
#![allow(unsafe_code)]

use super::ffi::{output, values, with_string};
use super::{blocks, byte_set, level, paths, scanner, search, substring, text, untidy, zstd};

macro_rules! scans {
    ($($export:ident($($byte:ident)?) = |$text:ident| $result:expr;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(text: *const u8, len: usize $(, $byte: u8)?) -> usize {
            // SAFETY: the bytes of a buffer.
            let $text = unsafe { values(text, len) };
            $result.unwrap_or(len)
        }
    )*};
}
scans! {
    bun_simd_count_char(byte) = |it| Some(search::count_char(it, byte));
    bun_simd_count_slashes() = |it| Some(paths::count_slashes(it));
    bun_simd_index_of_not_char(byte) = |it| search::index_of_not_char(it, byte);
    bun_simd_index_of_untidy_slash() = |it| untidy::index_of_untidy_slash(it);
    bun_simd_index_of_untidy_slash_or_non_ascii() = |it| untidy::index_of_untidy_slash_or_non_ascii(it);
    bun_simd_is_level() = |it| Some(usize::from(it == level::detected().as_bytes()));
    bun_simd_last_index_of_slash() = |it| paths::last_index_of_slash(it);
    bun_simd_last_index_of_slash_or_dot() = |it| paths::last_index_of_slash_or_dot(it);
    bun_simd_plain_index_of_char(byte) = |it| text::index_of_char(it, byte);
    bun_simd_plain_last_index_of_char(byte) = |it| text::last_index_of_char(it, byte);
}

macro_rules! pairs {
    ($($export:ident = |$a:ident, $b:ident| $result:expr;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize {
            // SAFETY: the bytes of two buffers.
            let ($a, $b) = unsafe { (values(a, a_len), values(b, b_len)) };
            $result.unwrap_or(a_len)
        }
    )*};
}
pairs! {
    bun_simd_common_prefix_length = |a, b| Some(paths::common_prefix_length(a, b));
    bun_simd_index_of_any_char = |it, chars| text::index_of_any_char(it, chars);
    bun_simd_last_index_of_any_char = |it, chars| text::last_index_of_any_char(it, chars);
}

macro_rules! substrings {
    ($($export:ident($unit:ty) = $search:path;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(a: *const $unit, a_len: usize, b: *const $unit, b_len: usize) -> usize {
            // SAFETY: as many units of two buffers.
            unsafe { with_string(a, a_len, |a| with_string(b, b_len, |b| $search(a, b))) }.unwrap_or(usize::MAX)
        }
    )*};
}
substrings! {
    bun_simd_plain_memmem(u8) = substring::memmem;
    bun_simd_plain_memrmem(u8) = substring::memrmem;
    bun_simd_plain_memmem16(u16) = substring::memmem16;
    bun_simd_plain_memrmem16(u16) = substring::memrmem16;
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_byte_set_prefix_length(
    text: *const u8,
    len: usize,
    &[high, low]: &[[u8; 16]; 2],
) -> usize {
    // SAFETY: the bytes of a buffer.
    let text = unsafe { values(text, len) };
    byte_set::prefix_len(text, &bun_simd::text::ByteClasses { high, low })
}

// These write when they are done with the text, so the two can overlap.

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_line_starts(text: *const u8, len: usize, out: *mut u32) -> usize {
    // SAFETY: the bytes of a buffer.
    let starts = scanner::line_starts(unsafe { values(text, len) });
    let after_newlines = &starts[1..];
    // SAFETY: there is room for a word for each line feed.
    unsafe { output(out, after_newlines.len()) }.write_copy_of_slice(after_newlines);
    after_newlines.len()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_odd_blocks(text: *const u8, len: usize, out: *mut u64) {
    let mut words = Vec::new();
    // SAFETY: the bytes of a buffer.
    scanner::odd_blocks(unsafe { values(text, len) }, &mut words);
    // SAFETY: there is room for a word for each 4096 bytes.
    unsafe { output(out, words.len()) }.write_copy_of_slice(&words);
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_byte_bits(text: *const u8, len: usize, byte: u8, out: *mut u64) {
    let mut words = Vec::new();
    // SAFETY: the bytes of a buffer.
    scanner::byte_bits(unsafe { values(text, len) }, byte, &mut words);
    // SAFETY: there is room for a word for each 64 bytes.
    unsafe { output(out, words.len()) }.write_copy_of_slice(&words);
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_scanner_run_stops(
    text: *const u8,
    len: usize,
    out: *mut u8,
    plane_len: usize,
) {
    let mut planes = [(); 3].map(|()| vec![[0; 8]; len.div_ceil(64)]);
    let [a, b, c] = &mut planes;
    // SAFETY: the bytes of a buffer.
    blocks::scanner_run_stops(unsafe { values(text, len) }, [a, b, c]);
    // SAFETY: there are three planes.
    let out = unsafe { output(out, 3 * plane_len) };
    for (i, plane) in planes.iter().enumerate() {
        let plane = plane.as_flattened();
        out[i * plane_len..][..plane.len()].write_copy_of_slice(plane);
    }
}

#[unsafe(no_mangle)]
extern "C" fn bun_simd_zstd_is_quicker() -> bool {
    zstd::are_quicker()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_zstd_count_bytes(
    bytes: *const u8,
    len: usize,
    counts: *mut [[u32; 64]; 4],
) -> bool {
    // SAFETY: 256 counts, which are aligned.
    let mut copy = unsafe { counts.read() };
    // SAFETY: the bytes of a buffer.
    let is_done = zstd::add_byte_counts(unsafe { values(bytes, len) }, &mut copy);
    // SAFETY: as above.
    unsafe { counts.write(copy) };
    is_done
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_zstd_write_codes(
    symbols: *const u8,
    count: usize,
    codes: &[u16; 256],
    out: *mut u8,
    room: usize,
    written: *mut [u64; 3],
) -> bool {
    let mut bytes = vec![0; room];
    // SAFETY: the bytes of a buffer.
    let Some(it) = zstd::write_codes(unsafe { values(symbols, count) }, codes, &mut bytes) else {
        return false;
    };
    // SAFETY: there is that much room, and there are 3 words, which are aligned.
    unsafe {
        output(out, room).write_copy_of_slice(&bytes);
        written.write([it.len, it.bits, it.bit_count]);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn results_are_passed_on() {
        let pair = |f: unsafe extern "C" fn(_, _, _, _) -> usize, a: &[u8], b: &[u8]| {
            // SAFETY: two slices.
            unsafe { f(a.as_ptr(), a.len(), b.as_ptr(), b.len()) }
        };
        assert_eq!(pair(bun_simd_common_prefix_length, b"abc", b"abde"), 2);
        assert_eq!(pair(bun_simd_index_of_any_char, b"abcd", &b"dcba"[..2]), 2);
        assert_eq!(pair(bun_simd_last_index_of_any_char, b"abcd", b"ca"), 2);
        assert_eq!(pair(bun_simd_index_of_any_char, b"abcd", b"ef"), 4);

        let (text, level) = (b"a\n\n\\".repeat(17), level::detected());
        let (mut starts, mut odd, mut bits) = ([0; 2], [0], [0; 2]);
        // SAFETY: at most the 68 bytes of the text, and the room that each needs.
        unsafe {
            assert_eq!(bun_simd_is_level(level.as_ptr(), level.len()), 1);
            assert_eq!(
                bun_simd_line_starts(text.as_ptr(), 4, starts.as_mut_ptr()),
                2
            );
            bun_simd_odd_blocks(text.as_ptr(), 68, odd.as_mut_ptr());
            bun_simd_byte_bits(text.as_ptr(), 68, b'a', bits.as_mut_ptr());
        }
        assert_eq!((starts, odd, bits), ([2, 3], [3], [!0 / 15, 1]));

        for (len, ends) in [(64, [7; 3]), (65, [0xFE, 0xFF, 0xFE])] {
            let mut planes = [[7u8; 16]; 3];
            // SAFETY: as above.
            unsafe {
                bun_simd_scanner_run_stops(text.as_ptr(), len, planes.as_mut_ptr().cast(), 16)
            };
            assert_eq!(planes.map(|it| it[7]), [0xEE, 0xFF, 0xEE]);
            assert_eq!(planes.map(|it| it[8]), ends);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore = "takes too long")]
    fn results_for_zstd_are_passed_on() {
        let (text, mut counts) = ([2, 0, 2], [[1; 64]; 4]);
        // SAFETY: 3 bytes.
        assert!(unsafe { bun_simd_zstd_count_bytes(text.as_ptr(), 3, &raw mut counts) });
        assert_eq!(counts[0][..4], [2, 1, 3, 1]);

        let (mut out, mut written) = ([7; 128], [0; 3]);
        let mut write = |room| {
            let (codes, out) = (&[0xA003; 256], out.as_mut_ptr());
            // SAFETY: 3 bytes, and at most 128.
            unsafe {
                bun_simd_zstd_write_codes(text.as_ptr(), 3, codes, out, room, &raw mut written)
            }
        };
        assert!(write(128) && !write(127));
        assert_eq!((out[0], out[127], written), (0b0110_1101, 0, [1; 3]));
    }
}
