//! reduce_each
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;

#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;
    #[kernel]
    pub fn each<T: Lane, W: Width, const K: usize>(from: &[T], _of: W, _k: [(); K]) -> [[T; K]; 2] {
        let rows: [Simd<T, W, S>; K] = array::from_fn(|k| Simd::load(&from[k * Simd::<T, W, S>::LANES..]));
        let other = if T::IS_FLOAT {
            Simd::reduce_each(rows, |a, b| a - b)
        } else {
            Simd::reduce_each(rows, |a, b| a.simd_max(b))
        };
        [Simd::reduce_each(rows, |a, b| a + b), other]
    }
}
use simd::each;

fn tree<T: Lane>(row: &[T], join: impl Fn(T, T) -> T) -> T {
    let mut row = row.to_vec();
    while size_of_val(&row[..]) > 16 {
        let (lower, upper) = row.split_at(row.len() / 2);
        row = lower.iter().zip(upper).map(|(&a, &b)| join(a, b)).collect();
    }
    while row.len() > 1 {
        row = row.chunks(2).map(|it| join(it[0], it[1])).collect();
    }
    row[0]
}
macro_rules! cases { ($($name:ident: $($t:ty, $make:expr, $add:expr, $ordered:expr, $([$w:ident $($k:literal)*])*;)*,)*) => {$( #[test] fn $name() { $($($(
    let n = $w::BYTES / size_of::<$t>();
    for seed in 0..if cfg!(miri) { 1 } else { 20u64 } {
        let from: Vec<$t> = (0..$k * n as u64).map(|i| ($make)((i + 1000 * seed + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 7)).collect();
        let rows = || from.chunks(n);
        let expected: [Vec<$t>; 2] = [rows().map(|it| tree(it, $add)).collect(), rows().map(|it| tree(it, $ordered)).collect()];
        for target in Target::combinations() {
            let Some(got) = each::to(target, &from, $w, [(); $k]) else { continue };
            assert!((0..2).all(|i| got[i][..] == expected[i][..]), "{target:?} {} {}: {got:?} {expected:?}", $w::BYTES, $k);
        }
    }
)*)*)* } )*}; }
cases! {
    bytes: u8, |x| x as u8, u8::wrapping_add, |a, b| a.max(b), [B2 3] [B8 16] [B16 5] [B32 2] [B64 11];,
    words: i16, |x| x as i16, i16::wrapping_add, |a, b| a.max(b), [B2 2] [B4 4] [B16 16] [B32 8] [B64 1];,
    ints: u32, |x| x as u32, u32::wrapping_add, |a, b| a.max(b), [B16 4] [B32 8] [B64 2];
        i64, |x| x as i64, i64::wrapping_add, |a, b| a.max(b), [B16 7] [B32 4] [B128 16] [B512 3];,
    floats: f32, |x| (x % 100003) as f32 / 7.0, |a, b| a + b, |a, b| a - b, [B8 3] [B16 1 2 8] [B32 4 16] [B64 4 16] [B128 4];
        f64, |x| (x % 100003) as f64 / 7.0, |a, b| a + b, |a, b| a - b, [B8 2] [B16 2] [B32 3] [B64 8];,
    halves: bf16, |x| bf16::from_f32((x % 1003) as f32), |a: bf16, b: bf16| bf16::from_f32(a.to_f32() + b.to_f32()), |a: bf16, b: bf16| bf16::from_f32(a.to_f32() - b.to_f32()), [B16 4] [B32 16];,
}
