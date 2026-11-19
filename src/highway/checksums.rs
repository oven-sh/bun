//! The CRC-32 of gzip and the Adler-32 of zlib, from src/jsc/bindings/highway_checksums.cpp.

use std::io::BorrowedCursor;

use crate::{SCALAR_CUTOFF, scalar_only};

const _: () = assert!(SCALAR_CUTOFF >= 16);

unsafe extern "C" {
    fn highway_crc32(state: u32, bytes: *const u8, len: usize) -> u64;
    fn highway_copy_and_crc32(state: u32, bytes: *const u8, copy: *mut u8, len: usize) -> u64;
    fn highway_adler32(adler: u32, bytes: *const u8, len: usize) -> u32;
    fn highway_copy_and_adler32(adler: u32, bytes: *const u8, copy: *mut u8, len: usize) -> u32;
}

/// `[n][byte]` is the state after `byte` and `zeros + n` zeros.
const fn crc32_tables(zeros: usize) -> [[u32; 256]; 4] {
    let mut tables = [[0; 256]; 4];
    let mut byte = 0;
    while byte < 256 {
        let mut state = byte as u32;
        let mut bits = 0;
        while bits < 8 * (zeros + 4) {
            state = (state >> 1) ^ if state & 1 == 1 { 0xEDB8_8320 } else { 0 };
            bits += 1;
            if bits % 8 == 0 && bits / 8 > zeros {
                tables[bits / 8 - 1 - zeros][byte] = state;
            }
        }
        byte += 1;
    }
    tables
}

#[inline(always)]
fn look_up(tables: &[[u32; 256]; 4], word: u32) -> u32 {
    let [a, b, c, d] = word.to_le_bytes().map(usize::from);
    tables[3][a] ^ tables[2][b] ^ tables[1][c] ^ tables[0][d]
}

#[inline(always)]
fn crc32_by_words(mut state: u32, bytes: &[u8]) -> u32 {
    static TABLES: [[u32; 256]; 4] = crc32_tables(0);
    let (words, bytes) = bytes.as_chunks();
    for &word in words {
        state = look_up(&TABLES, u32::from_le_bytes(word) ^ state);
    }
    for &byte in bytes {
        state = TABLES[0][usize::from(state as u8 ^ byte)] ^ (state >> 8);
    }
    state
}

/// Every fourth word goes into the same state, so that four do not wait for each other.
fn crc32_by_braids(state: u32, bytes: &[u8]) -> u32 {
    static TABLES: [[u32; 256]; 4] = crc32_tables(12);
    let (blocks, rest) = bytes.as_chunks::<16>();
    let Some((last, blocks)) = blocks.split_last() else {
        return crc32_by_words(state, rest);
    };
    let mut states = [state, 0, 0, 0];
    for block in blocks {
        for (state, &word) in states.iter_mut().zip(block.as_chunks().0) {
            *state = look_up(&TABLES, u32::from_le_bytes(word) ^ *state);
        }
    }
    let words = states.iter().zip(last.as_chunks::<4>().0);
    let state = words.fold(0, |state, (braid, word)| {
        crc32_by_words(state ^ braid, word)
    });
    crc32_by_words(state, rest)
}

/// For a CPU that has no instruction for it.
#[inline(never)]
fn crc32_without_kernel(state: u32, bytes: &[u8]) -> u32 {
    /// A byte can be taken out of a message if it is added to those this far on. https://arxiv.org/abs/2412.16398
    const DISTANCES: [usize; 4] = [145, 183, 211, 300];
    const KEPT: usize = DISTANCES[3].next_multiple_of(16);
    let add_taken = |byte, window: &[u8], at: usize| {
        let taken = DISTANCES.map(|distance| window[at - distance]);
        taken.into_iter().fold(byte, |sum, byte| sum ^ byte)
    };

    let Some((taken, kept)) = bytes
        .split_last_chunk::<KEPT>()
        .filter(|(taken, _)| taken.len() >= KEPT)
    else {
        return crc32_by_braids(state, bytes);
    };
    // What has been taken goes round in the first third. The second repeats it, to be read without going round.
    #[repr(align(16))]
    struct Window([u8; 3 * KEPT]);
    let Window(window) = &mut Window([0; _]);
    window[KEPT - DISTANCES[3]..][..4].copy_from_slice(&state.to_le_bytes());
    let mut end = KEPT;
    for lap in taken.chunks(KEPT) {
        for (at, &byte) in (KEPT..2 * KEPT).zip(lap) {
            let byte = add_taken(byte, window, at);
            (window[at - KEPT], window[at]) = (byte, byte);
        }
        end = KEPT + lap.len();
    }
    window[end..2 * KEPT].fill(0);
    let window = &window[end - KEPT..][..2 * KEPT];
    let kept: [u8; KEPT] = core::array::from_fn(|at| add_taken(kept[at], window, KEPT + at));
    crc32_by_braids(0, &kept)
}

/// From what the kernel returned.
#[inline(always)]
fn finish_crc32(state: u64, crc: u32, bytes: &[u8]) -> u32 {
    if cfg!(target_arch = "x86_64") && state > u64::from(u32::MAX) {
        return !crc32_without_kernel(!crc, bytes);
    }
    !(state as u32)
}

/// It needs 4 bytes on x64, and is slower than a table for as many.
#[inline(always)]
fn is_too_short_for_crc32_kernel(bytes: &[u8]) -> bool {
    cfg!(miri) || (cfg!(target_arch = "x86_64") && bytes.len() <= 4)
}

/// Continues the CRC-32 of gzip and PNG, which is 0 for no bytes.
#[inline]
pub fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    if is_too_short_for_crc32_kernel(bytes) {
        return !crc32_by_words(!crc, bytes);
    }
    // SAFETY: the kernel reads the `len` bytes, which are not too few.
    let state = unsafe { highway_crc32(!crc, bytes.as_ptr(), bytes.len()) };
    finish_crc32(state, crc, bytes)
}

/// `copy.append(bytes)` and `crc32()` of the copy, in one pass where it pays.
#[inline]
pub fn copy_and_crc32(crc: u32, bytes: &[u8], mut copy: BorrowedCursor<'_, u8>) -> u32 {
    copy.with_unfilled_buf(|copy| {
        let mut room = copy.unfilled();
        if is_too_short_for_crc32_kernel(bytes) {
            room.append(bytes);
            return !crc32_by_words(!crc, copy.filled());
        }
        assert!(bytes.len() <= room.capacity());
        // SAFETY: the kernel reads the `len` bytes, which are not too few, and writes all of as many, which have room.
        let state = unsafe {
            let to = room.as_mut().as_mut_ptr().cast();
            let state = highway_copy_and_crc32(!crc, bytes.as_ptr(), to, bytes.len());
            room.advance(bytes.len());
            state
        };
        finish_crc32(state, crc, copy.filled())
    })
}

/// What can be added up without an overflow. The kernel asserts it.
const ADLER32_PIECE: usize = if cfg!(miri) {
    SCALAR_CUTOFF
} else if cfg!(target_arch = "x86_64") {
    65536
} else {
    16384
};

#[inline(always)]
fn adler32_by_bytes(adler: u32, bytes: &[u8]) -> u32 {
    const MODULUS: u32 = 65521;
    let (mut a, mut b) = (adler & 0xFFFF, adler >> 16);
    for &byte in bytes {
        a += u32::from(byte);
        b += a;
    }
    (a % MODULUS) | (b % MODULUS) << 16
}

#[inline(never)]
fn in_pieces(adler: u32, bytes: &[u8], add: impl FnMut(u32, &[u8]) -> u32) -> u32 {
    bytes.chunks(ADLER32_PIECE).fold(adler, add)
}

/// It is worth two calls to have no load cross a cache line.
#[inline(never)]
fn long_adler32(adler: u32, bytes: &[u8]) -> u32 {
    const LINE: usize = 64;
    let (first, rest) = bytes.split_at(bytes.as_ptr().align_offset(LINE).min(bytes.len()));
    let (lines, last) = rest.split_at(rest.len() / LINE * LINE);
    let add = |adler, part| in_pieces(adler, part, adler32);
    [first, lines, last].into_iter().fold(adler, add)
}

/// Continues an Adler-32, which is 1 for no bytes.
#[inline]
pub fn adler32(adler: u32, bytes: &[u8]) -> u32 {
    if bytes.len() > ADLER32_PIECE {
        return long_adler32(adler, bytes);
    }
    if scalar_only(bytes.len()) {
        return adler32_by_bytes(adler, bytes);
    }
    // SAFETY: the kernel reads the `len` bytes, which are not too few.
    unsafe { highway_adler32(adler, bytes.as_ptr(), bytes.len()) }
}

/// `copy.append(bytes)` and `adler32()` of the copy, in one pass where it pays.
#[inline]
pub fn copy_and_adler32(adler: u32, bytes: &[u8], mut copy: BorrowedCursor<'_, u8>) -> u32 {
    if bytes.len() > ADLER32_PIECE {
        return in_pieces(adler, bytes, |adler, piece| {
            copy_and_adler32(adler, piece, copy.reborrow())
        });
    }
    if scalar_only(bytes.len()) {
        return copy.with_unfilled_buf(|copy| {
            copy.unfilled().append(bytes);
            adler32_by_bytes(adler, copy.filled())
        });
    }
    assert!(bytes.len() <= copy.capacity());
    // SAFETY: the kernel reads the `len` bytes, which are not too few, and writes all of as many, which have room.
    unsafe {
        let to = copy.as_mut().as_mut_ptr().cast();
        let adler = highway_copy_and_adler32(adler, bytes.as_ptr(), to, bytes.len());
        copy.advance(bytes.len());
        adler
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_needs_no_kernel() {
        assert_eq!(!crc32_without_kernel(!0, b"123456789"), 0xCBF4_3926);
        let bytes: Vec<u8> = (0..930u32).map(|i| ((i * i) >> 3) as u8).collect();
        let mut by_bits = 0x1234_5678;
        for (len, &byte) in bytes.iter().enumerate() {
            if matches!(len, 0..40 | 607..610 | 623 | 911..914 | 929) {
                assert_eq!(crc32_without_kernel(0x1234_5678, &bytes[..len]), by_bits);
            }
            by_bits = (0..8).fold(by_bits ^ u32::from(byte), |state, _| {
                (state >> 1) ^ (0xEDB8_8320 * (state & 1))
            });
        }
    }
}
