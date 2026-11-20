//! The kernels of the zstd encoder, against plain loops.
#![forbid(unsafe_code)]
#[expect(dead_code)]
mod common;
use bun_simd::{Target, limit_to_with};
use bun_simd_kernels::zstd::{are_quicker_for, count_bytes, write_codes};
use common::{random, sample, targets};
use core::array::from_fn;

fn has_kernels(target: Target) -> bool {
    matches!(target, Target::Avx512Icl | Target::Portable64)
}

#[test]
fn which_targets_run_them() {
    for target in targets() {
        let mut out = [7; 300];
        let written = write_codes(&[0; 100], &[1; 256], &mut out);
        assert_eq!(written.is_some(), has_kernels(target));
        assert!(has_kernels(target) || out == [7; 300]);
        assert_eq!(count_bytes(&[0; 100]).is_some(), has_kernels(target));

        let is_for_tests = target == Target::Portable64;
        assert_eq!([0, usize::MAX].map(are_quicker_for), [is_for_tests; 2]);
        limit_to_with(target, ["avx512bf16"]);
        let has_bf16 = || bun_simd::detected().names().any(|it| it == "avx512bf16");
        let is_late = target == Target::Avx512Icl && has_bf16();
        let want = [is_for_tests, is_for_tests || is_late];
        assert_eq!([4095, 4096].map(are_quicker_for), want);
    }
}

#[test]
fn counts() {
    const BATCH: usize = 3968;
    let mut below = random();
    let around = [128, 65, 64, 63, 7, 1].map(|by| -by);
    let around = around.into_iter().chain([0, 1, 7, 63, 64, 65, 127]);
    let around = |len: usize| around.clone().map(move |by| len.strict_add_signed(by));
    let seams = [256, BATCH, 3 * BATCH].into_iter().flat_map(around);
    let lens = Vec::from_iter((0..128).chain(seams).chain([4 * BATCH]));
    let longest = if cfg!(miri) { BATCH + 127 } else { 4 * BATCH };
    for kind in sample(0..9, 9) {
        let byte = |_| match kind {
            0..4 => 64 * kind + below(64),
            4..7 => [0, 64, 255][kind - 4],
            7 => below(256),
            _ if below(100) == 0 => below(256),
            _ => 64 + below(64),
        };
        let bytes = Vec::from_iter((0..longest).map(byte).map(|it| it as u8));
        for &len in sample(&lens, 51) {
            let (bytes, mut want) = (&bytes[bytes.len() - len..], [0; 256]);
            bytes.iter().for_each(|&it| want[usize::from(it)] += 1);
            for target in targets().filter(|&it| has_kernels(it)) {
                assert_eq!(count_bytes(bytes), Some(want), "{target:?} {kind} {len}");
            }
        }
    }
}

type Stream = (Vec<u8>, u64, u64);

/// Also returns how much was written before the last 64.
fn write_slowly(symbols: &[u8], codes: &[u16; 256]) -> (Stream, usize) {
    let (mut bytes, mut bits, mut bit_count, mut before_last) = (Vec::new(), 0, 0, 0);
    for (at, &symbol) in symbols.iter().enumerate().rev() {
        if at == 63 {
            before_last = bytes.len();
        }
        let code = u64::from(codes[usize::from(symbol)]);
        bits |= code >> (16 - code % 16) << bit_count;
        bit_count += code % 16;
        while bit_count >= 8 {
            bytes.push(bits as u8);
            (bits, bit_count) = (bits >> 8, bit_count - 8);
        }
    }
    ((bytes, bits, bit_count), before_last)
}

fn write(symbols: &[u8], codes: &[u16; 256], room: usize) -> Option<Stream> {
    let mut out = vec![0x55; room];
    let written = write_codes(symbols, codes, &mut out)?;
    Some((out[..written.len].to_vec(), written.bits, written.bit_count))
}

#[test]
fn codes() {
    let mut below = random();
    let all_lens: [Vec<u16>; _] = [
        vec![1, 1],
        Vec::from_iter((1..=12).chain([12])),
        vec![8; 256],
        Vec::from_iter((1..=5).chain([12; 128])),
        [&[2, 2, 2, 3][..], &[10; 4], &[11; 248]].concat(),
    ];
    for lens in sample(&all_lens, 4) {
        // All over the table, whose other entries mean nothing.
        let used = Vec::from_iter((0..lens.len()).map(|i| (i * 37 + 200) as u8));
        let mut codes = from_fn(|_| below(1 << 16) as u16);
        for (&symbol, &len) in used.iter().zip(lens) {
            codes[usize::from(symbol)] = (below(1 << 16) as u16) << (16 - len) | len;
        }
        for kind in sample(0..3, 3) {
            let pick = |_| match kind {
                0 => used[below(used.len())],
                1 if below(4) == 0 => used[below(used.len())],
                1 => used[0],
                _ => used[used.len() - 1],
            };
            let picked = Vec::from_iter((0..700).map(pick));
            let counts = (0..72).chain([127, 128, 129, 191, 192, 193, 700]);
            for count in sample(counts, 37) {
                let symbols = &picked[picked.len() - count..];
                let (want, before_last) = write_slowly(symbols, &codes);
                for target in targets().filter(|&it| has_kernels(it)) {
                    let got = write(symbols, &codes, before_last + 128);
                    assert_eq!(got.as_ref(), Some(&want), "{target:?} {lens:?} {count}");
                    let got = write(symbols, &codes, before_last + 127);
                    assert_eq!(got.is_some(), count == 0, "{target:?} {lens:?} {count}");
                }
            }
        }
    }
}

#[test]
fn what_is_no_code() {
    let mut below = random();
    let symbols = Vec::from_iter((0..150).map(|_| below(256) as u8));
    for kind in 0..4 {
        let codes = from_fn(|_| [0xFFFF, 0, 13 + below(3), below(1 << 16)][kind] as u16);
        for room in sample(0..400, 399) {
            let each = targets().filter(|&it| has_kernels(it));
            let each = Vec::from_iter(each.map(|_| write(&symbols, &codes, room)));
            assert!(each.iter().all(|it| *it == each[0]), "{kind} {room}");
        }
    }
}
