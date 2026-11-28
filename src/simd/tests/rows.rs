#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{math::*, mem::*, target::*, *};
use std::panic::catch_unwind;

#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs unwinding")]
fn rows() {
    let mut values: Vec<u32> = (0..100).collect();
    let rows = Rows::new(&values[3..], 10, 4, 5);
    assert_eq!((rows.at(1, 2, 3, 2).width(), rows.at(1, 2, 3, 2).height()), (3, 2));
    assert_eq!(rows.row(4), [43, 44, 45, 46]);
    assert_eq!(rows.at(1, 2, 3, 3).row(2), [44, 45, 46]);
    assert_eq!(Rows::new(&values, 1, 4, 97).row(96), [96, 97, 98, 99]);
    assert!(catch_unwind(|| rows.row(5)).is_err());
    assert!(catch_unwind(|| rows.at(1, 0, 4, 1)).is_err());
    assert!(catch_unwind(|| rows.at(usize::MAX, 0, 2, 1)).is_err());
    assert!(catch_unwind(|| rows.at(0, 5, 2, 0).row(0)).is_err());
    assert!(catch_unwind(|| Rows::new(&values, 10, 11, 10)).is_err());
    assert!(catch_unwind(|| Rows::new(&values, usize::MAX, 2, 2)).is_err());
    #[cfg(target_pointer_width = "64")]
    assert!(catch_unwind(|| Rows::new(&values, 1 << 32, 1, 1 << 32 | 1)).is_err());
    let mut rows = RowsMut::new(&mut values, 10, 10, 10);
    assert_eq!((rows.at(8, 7, 2, 3).width(), rows.at(8, 7, 2, 3).height()), (2, 3));
    rows.at(8, 7, 2, 3).row(2).fill(0);
    assert_eq!(rows.rows().row(9)[6..], [96, 97, 0, 0]);
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn differences<W: Width>(a: &[u8], b: &[u8]) -> u32 {
    let s: S = bun_simd::prelude::isa();
    let mut sum = AbsDiffSums::<W, S>::new();
    for (a, b) in s.over(a).by::<W>().exact().0.zip(s.over(b).by::<W>().exact().0).take(32) {
        sum.add_abs_diff(a, b);
    }
    sum.reduce_sum()
}

#[test]
fn abs_diff_sums() {
    let mixed = |by: usize| (0..2048).map(|i| ((i * by) >> 3) as u8).collect::<Vec<_>>();
    for (a, b) in [(vec![255; 2048], vec![0; 2048]), (mixed(1237), mixed(7919))] {
        for &target in Target::ALL {
            macro_rules! at { ($($w:ident)*) => {$(
                let all = a.iter().zip(&b).take(32 * $w::BYTES).map(|(a, b)| a.abs_diff(*b) as u32).sum();
                assert!(differences::to::<$w>(target, &a, &b).is_none_or(|sum| sum == all), "{target:?} {}", $w::BYTES);
            )*}; }
            at!(B2 B4 B8 B16 B32 B64);
        }
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn dot<W: Width>(a: &[i16; 32], b: &[i16; 32], sum: &mut [i32; 16]) {
    let s: S = bun_simd::prelude::isa();
    s.load::<i16, W>(a).dot_add_relaxed(s.load::<i16, W>(b), s.load::<i32, W>(sum)).store(sum)
}

#[test]
fn widen_mul_pairwise_accumulate() {
    let (a, b) = (std::array::from_fn(|i| (i * 12377) as i16), std::array::from_fn(|i| (i * 7919) as i16 >> 1));
    for &target in Target::ALL {
        macro_rules! at { ($($w:ident)*) => {$(
            let mut sum = std::array::from_fn(|i| i as i32 * 1000 - 5000);
            if dot::to::<$w>(target, &a, &b, &mut sum).is_some() {
                for i in 0..$w::BYTES / 4 {
                    assert_eq!(sum[i], i as i32 * 1000 - 5000 + a[2 * i] as i32 * b[2 * i] as i32 + a[2 * i + 1] as i32 * b[2 * i + 1] as i32);
                }
            }
        )*}; }
        at!(B4 B8 B16 B32 B64);
    }
}
