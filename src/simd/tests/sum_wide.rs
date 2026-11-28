//! `sum_wide`, at each address.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(dead_code)]
include!("parts/k_loops_b.rs");

fn lengths(n: usize) -> impl Iterator<Item = usize> {
    let near = move |k: usize| (0..5).flat_map(move |i| [0, 1, n / 2, n - 1].map(|j| (k + i) * n + j - 1));
    (0..2 * n + 2).step_by(1 + n / 16).chain([2, 15, 31, 63, 68, 127].into_iter().flat_map(near))
}

macro_rules! wide { ($($name:ident $t:ident $sum:ident;)*) => {$(
    #[test]
    fn $name() {
        #[kernel(targets = SOME)]
        fn sum(x: &[$t]) -> [$sum; 2] {
            let s: S = bun_simd::prelude::isa();
            [s.over(x).sum_wide(), s.over(x).by::<B4>().sum_wide()]
        }
        let mixed = (0..140_000u64).map(|i| (i.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 29) as $t).collect();
        for mut x in [mixed, vec![$t::MIN; 140_000], vec![$t::MAX; 140_000], vec![!0; 140_000]] {
            let long = [2047, 2048, 2049, 4095, 4097, 32767, 32768, 32769, 65535, 65536, 65537, 131072, 139_000];
            for (len, skip) in (0..70).chain(250..260).chain(505..520).chain(lengths(16)).chain(long).flat_map(|len| [(len, 0), (len, 1), (len, 15)]) {
                let x = &aligned(&mut x)[skip..][..len];
                let want = x.iter().map(|&it| it as $sum).sum();
                on_each(|| assert_eq!(sum(x), [want; 2], "{len} {skip}"));
            }
        }
    }
)*}; }
wide! { of_u8 u8 u64; of_i8 i8 i64; of_u16 u16 u64; of_i16 i16 i64; of_u32 u32 u64; of_i32 i32 i64; }
