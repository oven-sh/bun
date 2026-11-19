//! Temporary: variants, to be timed on the machines of CI.
#![allow(dead_code, unreachable_patterns, unused_imports, unreachable_pub)]
use bun_simd::{Out, SharedU8};

mod a1;
#[cfg(target_arch = "aarch64")]
mod c1;
#[cfg(target_arch = "aarch64")]
mod c10;
#[cfg(target_arch = "aarch64")]
mod c11;
#[cfg(target_arch = "aarch64")]
mod c12;
#[cfg(target_arch = "aarch64")]
mod c13;
#[cfg(target_arch = "aarch64")]
mod c14;
#[cfg(target_arch = "aarch64")]
mod c15;
#[cfg(target_arch = "aarch64")]
mod c16;
#[cfg(target_arch = "aarch64")]
mod c17;
#[cfg(target_arch = "aarch64")]
mod c18;
#[cfg(target_arch = "aarch64")]
mod c2;
#[cfg(target_arch = "aarch64")]
mod c3;
#[cfg(target_arch = "aarch64")]
mod c4;
#[cfg(target_arch = "aarch64")]
mod c5;
#[cfg(target_arch = "aarch64")]
mod c6;
#[cfg(target_arch = "aarch64")]
mod c7;
#[cfg(target_arch = "aarch64")]
mod c8;
#[cfg(target_arch = "aarch64")]
mod c9;

#[inline]
pub fn variant(seed: u32, bytes: &[SharedU8]) -> u32 {
    match seed >> 24 {
        #[cfg(target_arch = "aarch64")]
        1 => c1::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        2 => c2::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        3 => c3::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        4 => c4::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        5 => c5::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        6 => c6::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        7 => c7::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        8 => c8::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        9 => c9::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        10 => c10::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        11 => c11::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        12 => c12::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        13 => c13::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        14 => c14::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        15 => c15::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        16 => c16::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        17 => c17::crc32_shared(seed, bytes),
        #[cfg(target_arch = "aarch64")]
        18 => c18::crc32_shared(seed, bytes),
        30 => crate::adler32_shared(1, bytes),
        31 => a1::adler32_shared(1, bytes),
        _ => crate::crc32_shared(seed, bytes),
    }
}

#[inline]
pub fn copying_variant(mut seed: u32, from: &[u8], to: Out<'_, u8>) -> u32 {
    match seed >> 24 {
        40 => crate::copy_and_adler32(&mut seed, from, to),
        41 => a1::copy_and_adler32(&mut seed, from, to),
        #[cfg(target_arch = "aarch64")]
        52 => c2::copy_and_crc32(&mut seed, from, to),
        #[cfg(target_arch = "aarch64")]
        53 => c3::copy_and_crc32(&mut seed, from, to),
        #[cfg(target_arch = "aarch64")]
        54 => c4::copy_and_crc32(&mut seed, from, to),
        #[cfg(target_arch = "aarch64")]
        55 => c5::copy_and_crc32(&mut seed, from, to),
        #[cfg(target_arch = "aarch64")]
        56 => c6::copy_and_crc32(&mut seed, from, to),
        #[cfg(target_arch = "aarch64")]
        57 => c7::copy_and_crc32(&mut seed, from, to),
        #[cfg(target_arch = "aarch64")]
        58 => c8::copy_and_crc32(&mut seed, from, to),
        _ => crate::copy_and_crc32(&mut seed, from, to),
    };
    seed
}
