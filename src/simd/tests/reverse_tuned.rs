//! Both forms of the long loop.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![cfg(target_arch = "x86_64")]
use bun_simd::prelude::*;
use bun_simd::target::{Targets, reset_cpu, set_cpu};

#[kernel(targets = Targets::ALL)]
fn reverses(a: &mut [u32], b: &mut [f32]) {
    u32x8::over_mut(a).reverse();
    over_mut(b).reverse()
}

#[test]
fn with_and_without_the_word() {
    for (target, on) in reverses::targets().flat_map(|it| [(it, false), (it, true)]) {
        assert!(set_cpu(if on { target.with("fast_compress_store") } else { target }));
        for (from, to) in (0..9).flat_map(|from| (120..330).map(move |to| (from, to))) {
            let (mut a, mut b): ([u32; 330], [f32; 330]) =
                (core::array::from_fn(|i| i as _), core::array::from_fn(|i| i as _));
            let (mut x, mut y) = (a, b);
            x[from..to].reverse();
            y[from..to].reverse();
            reverses::to(target, &mut a[from..to], &mut b[from..to]).unwrap();
            assert_eq!((a, b), (x, y), "{target:?} {from} {to}");
        }
        reset_cpu();
    }
}
