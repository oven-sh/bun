//! The CRC-32 of gzip and the Adler-32 of zlib, derived from libdeflate (LICENSE.md).

use bun_simd::target::Baseline;
use std::io::BorrowedCursor;

mod adler32;
mod crc32;
mod crc32_tables;
mod input;
#[cfg(test)]
mod tests;

/// A call does not pay for fewer bytes, and the kernels of Adler-32 load as many.
pub(crate) const SCALAR_CUTOFF: usize = 16;

/// A table is faster for so few, unless there is an instruction.
#[inline(always)]
fn is_too_short_for_crc32_kernel(bytes: &[u8]) -> bool {
    cfg!(target_arch = "x86_64") && bytes.len() <= 4
}

/// Continues the CRC-32 of gzip and PNG, which is 0 for no bytes.
pub fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    if is_too_short_for_crc32_kernel(bytes) {
        return !crc32_tables::crc32_by_words(!crc, bytes);
    }
    if bun_simd::has!(Baseline: crc) && bytes.len() < crc32::BY_INSTRUCTION {
        return crc32::update::baseline(crc, bytes);
    }
    crc32::update(crc, bytes)
}

/// `copy.append(bytes)` and `crc32()` of the copy, in one pass where it pays.
#[inline]
pub fn copy_and_crc32(crc: u32, bytes: &[u8], mut copy: BorrowedCursor<'_, u8>) -> u32 {
    if is_too_short_for_crc32_kernel(bytes) {
        return copy.with_unfilled_buf(|copy| {
            copy.unfilled().append(bytes);
            !crc32_tables::crc32_by_words(!crc, copy.filled())
        });
    }
    crc32::copy_and_update(crc, bytes.iter(), copy)
}

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
    bytes.chunks(adler32::PIECE).fold(adler, add)
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
pub fn adler32(adler: u32, bytes: &[u8]) -> u32 {
    if bytes.len() > adler32::PIECE {
        return long_adler32(adler, bytes);
    }
    if bytes.len() < SCALAR_CUTOFF {
        return adler32_by_bytes(adler, bytes);
    }
    adler32::adler32(adler, bytes)
}

/// `copy.append(bytes)` and `adler32()` of the copy, in one pass where it pays.
#[inline]
pub fn copy_and_adler32(adler: u32, bytes: &[u8], mut copy: BorrowedCursor<'_, u8>) -> u32 {
    if bytes.len() > adler32::PIECE {
        return in_pieces(adler, bytes, |adler, piece| {
            copy_and_adler32(adler, piece, copy.reborrow())
        });
    }
    if bytes.len() < SCALAR_CUTOFF {
        return copy.with_unfilled_buf(|copy| {
            copy.unfilled().append(bytes);
            adler32_by_bytes(adler, copy.filled())
        });
    }
    adler32::copy_and_adler32(adler, bytes.iter(), copy)
}
