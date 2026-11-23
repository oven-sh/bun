//! The guards that keep an operation from a width that it doesn't fit.
#![allow(dead_code, unreachable_pub)]
#![cfg(not(bun_simd_native = "16"))]
#![forbid(unsafe_code)]
#![allow(clippy::assertions_on_constants)]
use bun_simd::{Isa, prelude::*, target::*};

trait Wide: Width {
    const WIDE: bool = Self::BYTES >= 32;
}
impl<W: Width> Wide for W {}

macro_rules! forms { ($v:ident $yes:ident $($name:ident $body:block)*) => {
    mod unmarked { use super::*; $(#[allow(unused_variables)] pub fn $name<W: Width, S: Isa>($v: Simd<u8, W, S>, $yes: bool) -> u8 $body)* }
    mod marked { use super::*; $(#[simd] #[allow(unused_variables)] pub fn $name<W: Width>($v: Simd<u8, W, S>, $yes: bool) -> u8 $body)* }
    mod known { use super::*; type W = B16; $(#[allow(unused_variables)] pub fn $name($v: Simd<u8, W, Portable>, $yes: bool) -> u8 $body)* }
    #[kernel(targets = Targets::ALL)]
    fn all(yes: bool) {
        let want = if has!(B16) { 0 } else { 16 };
        $(assert_eq!([unmarked::$name(u8xN::iota(0), yes), marked::$name(u8xN::iota(0), yes)], [want; 2], stringify!($name));)*
        $(assert_eq!([unmarked::$name(u8x8::iota(0), yes), marked::$name(u8x32::iota(0), yes)], [0, 16], stringify!($name));)*
    }
    #[test]
    fn without_generics() {
        $(assert_eq!(known::$name(bun_simd::WithToken::iota(Portable::new(), 0), core::hint::black_box(true)), 0, stringify!($name));)*
    }
}; }
forms! { v yes
    block { if const { W::BYTES >= 32 } { v.block::<1>()[0] } else { 0 } }
    twice {
        let a = if const { W::BYTES >= 32 } { v.block::<1>()[0] } else { 0 };
        a & if const { W::BYTES >= 32 } { v.block::<1>()[1] } else { 1 }
    }
    constant { if W::WIDE { v.block::<1>()[0] } else { 0 } }
    constant_twice {
        let a = if W::WIDE { v.block::<1>()[0] } else { 0 };
        a & if W::WIDE { v.block::<1>()[1] } else { 1 }
    }
    chain { if const { W::BYTES == 64 } { v.block::<3>()[0] - 32 } else if const { W::BYTES == 32 } { v.block::<1>()[0] } else { 0 } }
    nested { if W::WIDE { if const { W::BYTES == 64 } { v.block::<2>()[0] / 2 } else { v.block::<1>()[0] } } else { 0 } }
    early { if !W::WIDE { return 0; } v.block::<1>()[0] }
    and { if yes && const { W::BYTES >= 32 } { v.block::<1>()[0] } else { 0 } }
    and_first { if const { W::BYTES >= 32 } && yes { v.block::<1>()[0] } else { 0 } }
    or { if !yes || const { W::BYTES < 32 } { return 0; } v.block::<1>()[0] }
    lazy { 16 * (W::WIDE && v.block::<1>()[0] == 16) as u8 }
    numbers { match W::BYTES { 2 | 4 | 8 | 16 => 0, _ => v.block::<1>()[0] } }
    computed { match const { W::BYTES / 32 } { 0 => 0, _ => v.block::<1>()[0] } }
    arm { match yes { true if const { W::BYTES >= 32 } => v.block::<1>()[0], _ => 0 } }
    repeated { let mut sum = 0; while const { W::BYTES >= 32 } && sum < 16 { sum += v.block::<1>()[0] / 2 } sum }
    left { let mut sum = 0; for _ in 0..2 { if !W::WIDE { break; } sum += v.block::<1>()[0] / 2 } sum }
    asserted { if !yes { assert!(const { W::BYTES == 64 }); return v.block::<3>()[0]; } 16 * W::WIDE as u8 }
    called { if W::WIDE { upper(v) } else { 0 } }
    pointer { (if W::WIDE { upper } else { Simd::reduce_min as fn(_) -> _ })(v) }
}
#[inline(never)]
fn upper<W: Width, S: Isa>(v: Simd<u8, W, S>) -> u8 {
    v.block::<1>()[0]
}

#[simd]
fn sum<W: Width>(v: Simd<u8, W, S>) -> u8 {
    if const { W::BYTES == 2 } {
        return v[0] + v[1];
    }
    let [a, b] = v.split();
    sum(a + b)
}
#[simd(targets = bun_simd::target::Targets::ALL)]
mod words {
    use bun_simd::prelude::*;
    #[only(avx2)]
    fn twin(v: u8xN<S>) -> u8 {
        v.block::<1>()[0]
    }
    fn twin(_: u8xN<S>) -> u8 {
        16
    }
    #[kernel]
    pub fn all() -> [u8; 6] {
        let v = u8xN::iota(0);
        let upper = || v.block::<1>()[0];
        [
            if has!(avx2) { v.block::<1>()[0] } else { 16 },
            if has!(B16) { 16 } else { upper() },
            pick! { B64 => v.block::<2>()[0] / 2, B32 => v.block::<1>()[0], _ => 16 },
            twin(v),
            super::sum(u8x16::splat(1)),
            if cfg!(false) { u8x16::zero().block::<1>()[0] } else { 16 },
        ]
    }
}

#[test]
fn on_all_targets() {
    for &target in Target::ALL {
        all::to(target, core::hint::black_box(true));
        assert!(words::all::to(target).is_none_or(|it| it == [16; 6]));
    }
}

/// With debug information, rustc makes code for the value of a variable in a dead branch.
#[kernel(targets = Targets::ALL)]
fn widest() -> i32 {
    let v = Simd::<i64, bun_simd::B512, S>::splat(i64::MAX);
    v.in_blocks().saturating_narrow::<i32>(v)[127]
}
#[test]
fn dead_branches_of_the_crate() {
    assert!(Target::ALL.iter().all(|&it| widest::to(it).is_none_or(|it| it == i32::MAX)));
}

#[test]
fn numbers() {
    fn top<T: Lane>() -> T {
        if const { size_of::<T>() > 1 } { T::of::<256>() } else { T::of::<255>() }
    }
    assert_eq!((top::<u8>(), top::<i16>(), i8::of::<-128>()), (255, 256, -128));
    assert_eq!((f32::of::<0x100_0000>(), f64::of::<{ i64::MIN }>()), (16777216.0, i64::MIN as f64));
}

#[test]
#[kernel]
fn places_of_wider_vectors() {
    let v = u8xN::iota(0);
    assert_eq!(if has!(B16) { 16 } else { v.cast::<u32>().block::<4>()[0] }, 16);
    if const { Native::<S>::BYTES == 512 } {
        let _ = (v.with_block::<31>(v.block::<31>()), v.as_u128s().splat_lane::<31>());
        let _ = (v.with_lane::<511>(1), v.splat_lane::<511>());
        let _ = (v.shift_elements_left::<512>(1), v.shift_elements_right::<512>(1));
        let _ = (v.simd_eq(0).shift_elements_left::<512>(true), v.simd_eq(0).shift_elements_right::<512>(true));
    }
}
