//! Both forms of the networks for 64 bytes, on each CPU that has such vectors.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![cfg(target_arch = "x86_64")]
use bun_simd::prelude::*;
use bun_simd::target::{reset_cpu, set_cpu};

#[kernel(icelake)]
fn sorts<T: Lane>(values: &mut [T]) {
    over_mut(values).sort()
}

fn check<T: Lane>(make: fn(u32) -> T, order: fn(&T, &T) -> core::cmp::Ordering) {
    let mut state = 1u32;
    for len in (60..520).chain([3000]) {
        let mut next = |_| {
            state = state.wrapping_mul(747796405).wrapping_add(2891336453);
            make((state ^ state >> 15) & [!0, 0x8000_8083][len % 2])
        };
        let mut values: Vec<T> = (0..len).map(&mut next).collect();
        let mut want = values.clone();
        want.sort_by(order);
        sorts(&mut values);
        assert!(values.iter().zip(&want).all(|(a, b)| order(a, b).is_eq()), "{len}");
    }
}

#[test]
fn with_and_without_the_word() {
    for target in [bun_simd::target!(icelake), bun_simd::target!(icelake + full_zmm)] {
        if set_cpu(target) {
            check(|it| it as u8, Ord::cmp);
            check(|it| it as i16, Ord::cmp);
            check(|it| it, Ord::cmp);
            check(f32::from_bits, f32::total_cmp);
        }
    }
    reset_cpu();
}
