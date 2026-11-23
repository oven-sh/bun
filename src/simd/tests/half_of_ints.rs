//! All integers of 16 bits as `f16` and the reverse, and all quotients of bytes.
#![allow(dead_code, unreachable_pub)]

use bun_simd::{f16, prelude::*};

#[test]
fn all() {
    #[kernel(icelake + fp16, avx2, sve2, neon86, neon82 + fp16, neon)]
    fn check() {
        for first in (0..=u16::MAX).step_by(8) {
            let v = u16x8::iota(first);
            let (unsigned, signed) = (v.cast::<f16>(), v.cast_signed().cast::<f16>());
            let (a, b) = (v.cast::<u8>(), (first >> 8) as u8);
            let (q, r) =
                (a / u8x8::splat(b.max(1)).black_box(), a.cast_signed() / i8x8::splat(b.max(1) as i8).black_box());
            for i in 0..8 {
                assert_eq!(unsigned[i].to_bits(), f16::from_f32(v[i] as f32).to_bits());
                assert_eq!(signed[i].to_bits(), f16::from_f32(v[i] as i16 as f32).to_bits());
                assert_eq!(a.cast::<f16>()[i].to_f32(), a[i] as f32);
                assert_eq!((q[i], r[i]), (a[i] / b.max(1), (a[i] as i8).wrapping_div(b.max(1) as i8)));
            }
        }
    }
    check::targets().for_each(|target| check::to(target).unwrap());
}

#[test]
fn reverse() {
    #[kernel(icelake + fp16, avx2, sve2, neon82 + fp16, neon)]
    fn check<W: Width>() {
        for first in (0..=u16::MAX).step_by(W::BYTES / 2) {
            let v = Simd::<u16, W, S>::iota(first).bitcast::<f16>();
            macro_rules! to { ($($t:ident)*) => {$(
                let all = [v.cast::<$t>(), v.round_cast(), v.cast_relaxed(), v.round_cast_relaxed()];
                for i in 0..W::BYTES / 2 {
                    let (x, near) = (v[i].to_f32(), v[i].to_f32().round_ties_even());
                    let fits = |it: f32| it as $t as f32 == it;
                    assert_eq!([all[0][i], all[1][i]], [x as $t, near as $t], "{x}");
                    assert!(!fits(x.trunc()) || all[2][i] == all[0][i], "{x}");
                    assert!(x.is_nan() || $t::BITS > 8 && !fits(near) || all[3][i] == all[1][i], "{x}");
                }
            )*}; }
            to!(u8 i8 u16 i16 u32 i32);
        }
    }
    for target in check::targets() {
        [check::to::<B8>, check::to::<B16>, check::to::<B32>, check::to::<B64>].iter().for_each(|f| f(target).unwrap());
    }
}
