#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{target::*, *};
use framework::*;

fn product(m: &Model, i: usize, add: Option<i128>) -> i128 {
    let (bits, min) = (m.t.bits() - 1, m.t.min());
    let product = (m.a[i] * m.b[i] + (1 << (bits - 1))) >> bits;
    if m.a[i] == min && m.b[i] == min { ANY } else { (product + add.unwrap_or(0)).clamp(min, -min - 1) }
}

#[test]
fn round_demote_to() {
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn check() {
        let s: S = bun_simd::prelude::isa();
        let v = s.of::<f32, B32>().from_array([0.5, 1.5, -2.5, 254.7, 32767.6, -1e20, 1e20, f32::INFINITY]);
        assert_eq!(v.round_cast_relaxed::<i16>().to_array()[..], [0, 2, -2, 255, 32767, -32768, 32767, 32767]);
        assert_eq!(v.round_cast_relaxed::<u16>().to_array()[..], [0, 2, 0, 255, 32768, 0, 65535, 65535]);
        assert_eq!(v.round_cast_relaxed::<u8>().to_array()[..], [0, 2, 0, 255, 255, 0, 255, 255]);
        assert_eq!(v.round_cast_relaxed::<i8>().to_array()[..], [0, 2, -2, 127, 127, -128, 127, 127]);
        assert_eq!(v.split()[1].round_cast_relaxed::<u8>().to_array()[..], [255, 0, 255, 255]);
    }
    Target::ALL.iter().for_each(|&target| _ = check::to(target));
}

#[test]
fn three_of_four() {
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn check<T: Int, W: Width>(types: core::marker::PhantomData<(T, W)>) {
        let s: S = bun_simd::prelude::isa();
        let (d, _) = (s.of::<T, W>(), types);
        let from: Vec<T> =
            (0..d.lanes() / 4 * 3).map(|i| T::from_usize(((i + 1) * 0x0101_0101) ^ 0x8040_2010)).collect();
        let (v, mut to) = (d.load_3_of_4(&from), vec![T::default(); from.len()]);
        for i in 0..d.lanes() {
            assert_eq!(v[i], if i % 4 == 3 { T::default() } else { from[i / 4 * 3 + i % 4] });
        }
        (!v).store_3_of_4(&mut to);
        assert!(to.iter().zip(&from).all(|(&a, &b)| a == !b));
    }
    macro_rules! all { ($($t:ident)*) => {$(for &target in Target::ALL {
        check::to::<$t, B16>(target, Default::default());
        check::to::<$t, B32>(target, Default::default());
        check::to::<$t, B64>(target, Default::default());
    })*}; }
    all!(u8 i16 u32);
}

cases! {
    mul_fixed_point_15_add [i16] 0..=64, |d, a, b, c, _| a.mul_q15_add_relaxed(b, c) => |m| m.each(|i| product(m, i, Some(m.c[i])));
    mul_high_doubled [i16] 0..=64, |d, a, b, _, _| a.mul_high_doubled_relaxed(b >> 1) => |m| m.map2(|x, y| (x * (y >> 1)) >> 15);
    mul_high_doubled32 [i32] 0..=64, |d, a, b, _, _| a.mul_high_doubled_relaxed(b >> 1) => |m| m.map2(|x, y| (x * (y >> 1)) >> 31);
    mul_fixed_point_31 [i32] 0..=64, |d, a, b, _, _| a.mul_q31_relaxed(b) => |m| m.each(|i| product(m, i, None));
    mul_fixed_point_31_add [i32] 0..=64, |d, a, b, c, _| a.mul_q31_add_relaxed(b, c) => |m| m.each(|i| product(m, i, Some(m.c[i])));
}
