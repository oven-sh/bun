//! Non-cryptographic hash functions for `Bun.hash` (`HashObject`).
//!
//! JS-visible output is bit-identical to the reference implementation of each
//! algorithm.
//!
//! Surface exposed by `src/runtime/api/HashObject.rs`:
//!
//! | JS name        | Rust entry point                              | seed → output |
//! |----------------|-----------------------------------------------|---------------|
//! | `adler32`      | [`adler32`] (no seed)                         | — → u32       |
//! | `crc32`        | [`crc32`]                                     | u32 → u32     |
//! | `cityHash32`   | [`CityHash32::hash`] (no seed)                | — → u32       |
//! | `cityHash64`   | [`CityHash64::hash_with_seed`]                | u64 → u64     |
//! | `xxHash32`     | [`XxHash32::hash`]                            | u32 → u32     |
//! | `xxHash64`     | [`XxHash64::hash`]                            | u64 → u64     |
//! | `xxHash3`      | [`xxhash3_64`]                                | u64 → u64     |
//! | `murmur32v2`   | [`Murmur2_32::hash_with_seed`]                | u32 → u32     |
//! | `murmur32v3`   | [`Murmur3_32::hash_with_seed`]                | u32 → u32     |
//! | `murmur64v2`   | [`Murmur2_64::hash_with_seed`]                | u64 → u64     |
//! | `rapidhash`    | [`RapidHash::hash`]                           | u64 → u64     |
//!
//! `wyhash` lives in `bun_wyhash`.

#![allow(clippy::many_single_char_names)]
#![deny(unsafe_code)]
#![feature(core_io_borrowed_buf)]
pub mod checksums;
pub mod cityhash;
mod ffi;
pub mod murmur;
pub mod rapidhash;
pub mod xxhash;
mod xxhash3;

pub use checksums::crc32;
pub use cityhash::{CityHash32, CityHash64};
pub use murmur::{Murmur2_32, Murmur2_64, Murmur3_32};
pub use rapidhash::RapidHash;
pub use xxhash::{XxHash32, XxHash64, XxHash64Streaming};
pub use xxhash3::xxhash3_64;

/// zlib's Adler-32 of `bytes`.
#[inline(always)]
pub fn adler32(bytes: &[u8]) -> u32 {
    use checksums::SCALAR_CUTOFF;
    if bytes.len() < SCALAR_CUTOFF {
        // Neither sum reaches the modulus.
        const { assert!(128 * SCALAR_CUTOFF * SCALAR_CUTOFF < 65521) };
        let (mut low, mut high) = (1, 0);
        for &byte in bytes {
            low += u32::from(byte);
            high += low;
        }
        return (high << 16) | low;
    }
    checksums::adler32(1, bytes)
}

#[cfg(test)]
pub(crate) mod verify {
    //! SMHasher verification routine.
    //!
    //! Fill `buf[i] = i`; hash each prefix with `seed = 256 - i`; concat the
    //! little-endian bytes; hash the concat with `seed = 0`; truncate to u32.

    pub(crate) fn smhasher_32(hash: impl Fn(&[u8], u32) -> u32) -> u32 {
        let mut buf = [0u8; 256];
        let mut buf_all = [0u8; 256 * 4];
        for i in 0..256u32 {
            buf[i as usize] = i as u8;
            let h = hash(&buf[..i as usize], 256 - i);
            buf_all[i as usize * 4..i as usize * 4 + 4].copy_from_slice(&h.to_le_bytes());
        }
        hash(&buf_all, 0)
    }

    pub(crate) fn smhasher_64(hash: impl Fn(&[u8], u64) -> u64) -> u32 {
        let mut buf = [0u8; 256];
        let mut buf_all = [0u8; 256 * 8];
        for i in 0..256u64 {
            buf[i as usize] = i as u8;
            let h = hash(&buf[..i as usize], 256 - i);
            buf_all[i as usize * 8..i as usize * 8 + 8].copy_from_slice(&h.to_le_bytes());
        }
        hash(&buf_all, 0) as u32 // @truncate
    }
}
