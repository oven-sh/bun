//! Operations that ask the CPU: before anything is known, with words that are not true, and while the answer changes.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;
use bun_simd::target::*;
use std::hint::black_box;

fn model(x: u64, mask: u64) -> [u64; 2] {
    let places = || (0..64).filter(|i| mask >> i & 1 == 1).enumerate();
    [places().map(|(k, i)| (x >> k & 1) << i).sum(), places().map(|(k, i)| (x >> i & 1) << k).sum()]
}
#[kernel(neon)]
fn one(x: u64, mask: u64, deposit: bool) -> u64 {
    if deposit { deposit_bits(x, mask) } else { extract_bits(x, mask) }
}
#[kernel(icelake, avx2 + fast_pdep, sse4 + bmi + fast_pdep, neon + fast_pdep, sve2, default)]
fn listed(x: u64, mask: u64, change: fn()) -> ([u64; 2], [u64; 2], u64) {
    change();
    let v = u64x8::splat(x);
    let found = u32x16::iota(x as u32).is_in(u32x16::iota(x as u32 + 9).to_array()).to_bitmask();
    ([deposit_bits(x, mask), extract_bits(x, mask)], [v.deposit_bits(mask)[7], v.extract_bits(mask)[0]], found)
}

#[test]
fn all() {
    let mut state = 1u64;
    let mut random = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state ^ state >> 29
    };
    let (all, word) = (cpu(), if cfg!(target_arch = "aarch64") { "fast_pdep" } else { "fast_zmm" });
    let all = all.without("fast_gather");
    let mut cpus = vec![cpu(), all, all.with(word), Target::Portable.with(word), all.without(word)];
    cpus.extend(cpu_features().filter(|_| !cfg!(miri)).map(|it| all.with(word).without(it.0)));
    for round in 0..if cfg!(miri) { 3 } else { 200 } {
        let (x, mask) = (random() & !(1 << 31), [0, !0, 1 << 63].get(round).copied().unwrap_or(random()));
        let want = model(x, mask);
        for deposit in [true, false] {
            reset_cpu();
            let got = [0; 2].map(|_| one(black_box(x), black_box(mask), deposit));
            assert_eq!(got, [want[!deposit as usize]; 2]);
        }
        for &it in &cpus {
            for change in [|| (), reset_cpu, || assert!(set_cpu(Target::Portable))] {
                set_cpu(it);
                assert_eq!(listed(black_box(x), black_box(mask), change), (want, want, 0xfe00), "{it:?}");
            }
        }
    }
}
