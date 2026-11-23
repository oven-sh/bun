use std::io::BorrowedBuf;

use bun_simd::target::{Target, reset_cpu, set_cpu};

use super::crc32_tables::crc32_without_kernel;
use super::*;

fn crc32_by_bits(crc: u32, byte: u8) -> u32 {
    !(0..8).fold(!crc ^ u32::from(byte), |state, _| {
        (state >> 1) ^ (0xEDB8_8320 * (state & 1))
    })
}

fn sample(len: u32) -> Vec<u8> {
    (0..len).map(|i| ((i * i) >> 3) as u8 ^ 0x5A).collect()
}

#[test]
fn crc32_needs_no_kernel() {
    assert_eq!(!crc32_without_kernel(!0, b"123456789"), 0xCBF4_3926);
    let bytes = sample(930);
    let mut by_bits = 0x1234_5678;
    for (len, &byte) in bytes.iter().enumerate() {
        if matches!(len, 0..40 | 607..610 | 623 | 911..914 | 929) {
            assert_eq!(!crc32_without_kernel(!0x1234_5678, &bytes[..len]), by_bits);
        }
        by_bits = crc32_by_bits(by_bits, byte);
    }
}

/// In one test, as the choice of the target holds for all threads.
#[test]
fn on_all_targets() {
    let tuned = ["icelake + fast_zmm", "neon82 + aes + sha3 + fast_clmul"].map(Target::parse);
    let all = Target::ALL.iter().chain(tuned.iter().flatten());
    for &target in all.filter(|&&it| set_cpu(it)) {
        sum_and_copy(target);
        crate::xxhash::tests::long_xxhash3(target);
        if !cfg!(miri) {
            the_largest_sums_fit(target);
            pieces_start_anywhere(target);
        }
    }
    reset_cpu();
}

fn sum_and_copy(target: Target) {
    let bytes = sample(if cfg!(miri) { 280 } else { 5000 });
    let (mut crc, mut adler) = (0x1234_5678, 0xFFF0_FFF0);
    for (len, &byte) in bytes.iter().enumerate() {
        if !cfg!(miri) || matches!(len, 0..6 | 15..18 | 33 | 127..130 | 279) {
            let bytes = &bytes[..len];
            let mut room = Box::new_uninit_slice(2 * len + len % 2);
            let mut copies = BorrowedBuf::from(&mut room[..]);
            let sums = [
                crc32(0x1234_5678, bytes),
                copy_and_crc32(0x1234_5678, bytes, copies.unfilled()),
                adler32(0xFFF0_FFF0, bytes),
                copy_and_adler32(0xFFF0_FFF0, bytes, copies.unfilled()),
            ];
            let empty = adler32_by_bytes(adler, &[]);
            assert_eq!(sums, [crc, crc, empty, empty], "{target:?} {len}");
            assert!(copies.filled() == bytes.repeat(2), "{target:?} {len}");
            let mut exact = BorrowedBuf::from(&mut room[..len]);
            assert_eq!(copy_and_crc32(0x1234_5678, bytes, exact.unfilled()), crc);
        }
        crc = crc32_by_bits(crc, byte);
        adler = adler32_by_bytes(adler, &[byte]);
    }
}

fn the_largest_sums_fit(target: Target) {
    let bytes = vec![0xFF; 140_000];
    for len in [0, 5552, 5553, 16384, 16385, 65535, 65536, 65537, 140_000] {
        for seed in [1, 0xFFF0_FFF0, u32::MAX] {
            let bytes = &bytes[..len];
            let empty = adler32_by_bytes(seed, &[]);
            let expected = bytes.chunks(1).fold(empty, adler32_by_bytes);
            let mut room = Box::new_uninit_slice(len);
            let mut copy = BorrowedBuf::from(&mut room[..]);
            let sums = [
                adler32(seed, bytes),
                copy_and_adler32(seed, bytes, copy.unfilled()),
            ];
            assert_eq!(sums, [expected; 2], "{target:?} {len} {seed}");
            assert!(copy.filled() == bytes, "{target:?} {len}");
        }
    }
    for len in 0..40 {
        let bytes = &bytes[..len];
        assert_eq!(crate::adler32(bytes), adler32_by_bytes(1, bytes), "{len}");
    }
}

/// The halves of a group have the largest and the smallest bytes.
fn pieces_start_anywhere(target: Target) {
    for half in [64, 128] {
        let byte = |at: usize| [0xFF, at as u8 & 1][at / half % 2];
        let bytes: Vec<u8> = (0..adler32::PIECE + 600).map(byte).collect();
        for start in [0, 1, 63, 64, 128, 200] {
            let first = &bytes[start..][..adler32::PIECE - 1];
            let mut expected = first.chunks(4096).fold(1, adler32_by_bytes);
            for end in start + first.len()..start + first.len() + 330 {
                let bytes = &bytes[start..=end];
                expected = adler32_by_bytes(expected, &bytes[bytes.len() - 1..]);
                let mut room = Box::new_uninit_slice(bytes.len());
                let mut copy = BorrowedBuf::from(&mut room[..]);
                let copied = copy_and_adler32(1, bytes, copy.unfilled());
                let sums = [crate::adler32(bytes), copied];
                assert_eq!(sums, [expected; 2], "{target:?} {start} {end}");
            }
        }
    }
}

#[test]
fn copies_need_room() {
    for len in [3, 20, 100, 700] {
        for copy_and_sum in [copy_and_crc32, copy_and_adler32] {
            let panic = std::panic::catch_unwind(|| {
                let mut room = Box::new_uninit_slice(len - 1);
                let mut copy = BorrowedBuf::from(&mut room[..]);
                copy_and_sum(1, &vec![1; len], copy.unfilled())
            });
            assert!(panic.is_err(), "{len}");
        }
    }
}
