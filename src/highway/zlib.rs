//! The kernels of `bun_zlib`, from src/jsc/bindings/highway_zlib.cpp.

use crate::{SCALAR_CUTOFF, scalar_only};

const _: () = assert!(SCALAR_CUTOFF >= 16);

unsafe extern "C" {
    fn highway_crc32(state: u32, bytes: *const u8, len: usize) -> u64;
    fn highway_adler32(adler: u32, bytes: *const u8, len: usize) -> u32;
}

static CRC_TABLE: [u32; 256] = {
    let mut table = [0; 256];
    let mut i = 0;
    while i < 256 {
        let mut crc = i as u32;
        let mut bit = 0;
        while bit < 8 {
            crc = (crc >> 1) ^ if crc & 1 == 1 { 0xEDB8_8320 } else { 0 };
            bit += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
};

/// Continues the CRC-32 of gzip and PNG, which is 0 for no bytes.
#[inline]
pub fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    if !scalar_only(bytes.len()) {
        // SAFETY: the kernel reads the `len` bytes, of which it needs 16.
        let state = unsafe { highway_crc32(!crc, bytes.as_ptr(), bytes.len()) };
        if let Ok(state) = u32::try_from(state) {
            return !state;
        }
    }
    !bytes.iter().fold(!crc, |state, &byte| {
        CRC_TABLE[usize::from(state as u8 ^ byte)] ^ (state >> 8)
    })
}

/// Continues an Adler-32, which is 1 for no bytes.
#[inline]
pub fn adler32(adler: u32, bytes: &[u8]) -> u32 {
    const MODULUS: u32 = 65521;
    if !scalar_only(bytes.len()) {
        // SAFETY: the kernel reads the `len` bytes, of which it needs 16.
        return unsafe { highway_adler32(adler, bytes.as_ptr(), bytes.len()) };
    }
    bytes.chunks(16).fold(adler, |adler, chunk| {
        let (mut a, mut b) = (adler & 0xFFFF, adler >> 16);
        for &byte in chunk {
            a += u32::from(byte);
            b += a;
        }
        (a % MODULUS) | (b % MODULUS) << 16
    })
}
