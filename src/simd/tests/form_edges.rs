//! The edges of operations that have a form of their own on some targets.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;
use std::hint::black_box;

macro_rules! ints { ($($t:ident $u:ident [$($by:literal)*];)*) => {$(
    #[test]
    fn $t() {
        #[kernel(icelake, avx2, sse4, sve2, neon)]
        fn check<W: Width>() {
            let of = |x: $t| Simd::<$t, W, S>::splat(black_box(x));
            $(for x in [$t::MAX >> $by, $t::MIN >> $by].into_iter().flat_map(|x| [x.wrapping_sub(1), x, x + 1]) {
                let even = (Simd::<$t, W, S>::iota(black_box(0)) & 1) - 1;
                assert_eq!((of(x) & even).saturating_mul(1 << $by), even & x.saturating_mul(1 << $by), "{x} {}", $by);
            })*
            let (lanes, v) = (W::BYTES / size_of::<$t>(), Simd::<$t, W, S>::iota(black_box(1)));
            for at in (0..$t::BITS).flat_map(|k| [1 << k, (1 << k) - 1, 1 << k | 1]).map(|it: $u| it) {
                let by = of(at as $t);
                assert_eq!(v.swizzle_dyn(by.cast_unsigned()), if at < lanes as $u { at as $t + 1 } else { 0 }, "{at}");
                let count = at.min(127) as u32;
                assert_eq!(of(!2).unbounded_shl(by), (!2 as $t).unbounded_shl(count), "{at}");
                assert_eq!(of(!2).unbounded_shr(by), (!2 as $t).unbounded_shr(count), "{at}");
                for x in [$t::MIN, !0, $t::MAX, 7] {
                    assert!(at == 0 || of(x) / by == x / at as $t && of(x) / !by == x.wrapping_div(!at as $t), "{x} {at}");
                }
            }
        }
        for it in check::targets() {
            [check::to::<B8>, check::to::<B16>, check::to::<B64>].iter().for_each(|f| f(it).unwrap());
        }
    }
)*}; }
ints! {
    u8 u8 [1 2 3 4 7]; i8 u8 [1 2 3 4 6]; u16 u16 [1 2 3 4 15]; i16 u16 [1 2 3 4 14];
    u32 u32 [1 5 31]; i32 u32 [1 5 30]; u64 u64 [1 5 63]; i64 u64 [1 5 62];
}

macro_rules! floats { ($($t:ident $v:ident)*) => {$(
    #[test]
    fn $t() {
        #[kernel(icelake, avx2, sse4, sve2, neon)]
        fn check() {
            let of = |x: $t| $v::splat(black_box(x));
            let (mut x, least) = ($t::from_bits(1), $t::MIN_EXP - $t::MANTISSA_DIGITS as i32);
            for e in least..$t::MAX_EXP {
                assert_eq!([of(x).exponent(), of(-(x + x).next_down()).exponent()], [e as $t; 2]);
                x += x;
            }
            assert_eq!([of(0.0).exponent(), of(-x).exponent()], [-x, x]);
            assert!(of($t::NAN).exponent().is_nan().all());
            assert_eq!([of($t::next_down(0.5)).round(), of(0.5).round(), of(-2.5).round()], [0.0, 1.0, -3.0]);
        }
        check::targets().for_each(|it| check::to(it).unwrap());
    }
)*}; }
floats! { f32 f32xN f64 f64xN }
