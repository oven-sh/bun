//! Long tables, for lists with the word for gathers.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{prelude::*, target::*};

#[test]
fn lookup() {
    #[kernel(icelake + fast_gather, avx512 + fast_gather, avx512 + narrow + fast_gather, avx2 + fast_gather)]
    fn check(words: &[u32; 256], wide: &[u64; 256], first: u32) {
        macro_rules! each { ($($v:ident $table:ident [$($n:literal)*];)*) => {$($(
            let (at, table) = ($v::from_fn(|i| (first + 37 * i as u32) as _), $table.first_chunk::<$n>().unwrap());
            let got = at.lookup(table);
            assert!((0..$v::LANES).all(|i| got[i] == table[at[i] as usize % $n]), "{:?} {}", S::TARGET, $n);
        )*)*}; }
        each! { u32x8 words [32 64 256]; u32x16 words [32 64 128 256]; u8x16 words [64 256]; u64x8 wide [16 32 64 128]; u32x8 wide [32 64]; }
    }
    set_cpu(cpu().with("fast_gather"));
    let (words, wide) = (core::array::from_fn(|i| !(i as u32)), core::array::from_fn(|i| !(i as u64) << 20));
    for (target, first) in check::targets().flat_map(|it| (0..600).map(move |first| (it, first))) {
        check::to(target, &words, &wide, first).unwrap();
    }
}
