//! Each lane against each value, next to lanes that are equal to each other.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{prelude::*, target::*};

#[test]
fn each_place() {
    #[kernel(icelake, icelake + narrow, avx512, avx2, sse4, sve2, neon, wasm)]
    fn of<T: Int, W: Width, const N: usize, const RELAXED: bool>(v: &[T], set: &[T; N]) -> u64 {
        let v = Simd::<T, W, S>::load(v);
        if RELAXED { v.is_in_relaxed(*set) } else { v.is_in(set) }.to_bitmask()
    }
    fn check<T: Int, W: Width, const N: usize, const RELAXED: bool>() {
        let zen = cpu().with("fast_zmm").without("fast_gather");
        let cpus = [zen, zen.without("avx512vp2intersect"), zen.without("fast_zmm")];
        for (target, cpu) in of::targets().flat_map(|it| cpus.map(|cpu| (it, cpu))) {
            set_cpu(cpu);
            for (i, k) in (0..W::BYTES / size_of::<T>()).flat_map(|i| (0..N).map(move |k| (i, k))) {
                let (mut v, mut set) = ([T::of::<1>(); 64], [T::of::<2>(); N]);
                [v[i], set[k]] = [T::from_i64(if RELAXED { 3 } else { 0 }); 2];
                assert_eq!(
                    of::to::<T, W, N, RELAXED>(target, &v, &set),
                    Some(1 << i),
                    "{target:?} {} {N} {k}",
                    W::BYTES
                );
                set[k] = T::of::<2>();
                assert_eq!(of::to::<T, W, N, RELAXED>(target, &v, &set), Some(0), "{target:?} {} {N} {i}", W::BYTES);
            }
        }
        reset_cpu();
    }
    macro_rules! all { ($r:literal: $($t:ident [$($w:ident)*] $n:tt;)*) => {$($( all!($r $t $w $n); )*)*}; ($r:literal $t:ident $w:ident [$($n:literal)*]) => {$( check::<$t, $w, $n, $r>(); )*}; }
    all! { false: u32 [B16 B32 B64 B128] [7 15 16 19 24 31 48 97]; u64 [B16 B32 B64 B128] [7 16 49]; u8 [B16 B64] [3 4 5 7 8 9 13 15 17 31 97]; u16 [B16 B32] [3 4 5 7 9]; }
    all! { true: u32 [B64 B128] [16 17 24 25 40 64 72]; u16 [B32 B64 B128] [7 8 9 12 13 18 19]; }
}
