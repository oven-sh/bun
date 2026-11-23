//! The most common operations, for Miri. It also passes in all others.
#![allow(dead_code, unreachable_pub)]
#![allow(clippy::eq_op, clippy::precedence)]
use bun_simd::{generic::*, target::Portable};

fn check<T: Int, W: Width>() {
    let s = Portable::new();
    let n = Simd::<T, W, Portable>::LANES;
    let a: Vec<T> = (0..n).map(|i| T::from_i64((i * 37 % 11) as _)).collect();
    let b: Vec<T> = (0..n).map(|i| T::from_i64((i * 5 % 7) as _)).collect();
    let (x, y): (Simd<T, W, _>, Simd<T, W, _>) = (s.load(&a), s.load(&b));
    let bits = |f: fn(&T, &T) -> bool| (0..n).fold(0, |all, i| all | (f(&a[i], &b[i]) as u64) << i);
    let (eq, ne, lt, le) = (x.simd_eq(y), x.simd_ne(y), x.simd_lt(y), x.simd_le(y));
    assert_eq!([eq, ne, lt, le].map(|m| m.to_bitmask()), [bits(T::eq), bits(T::ne), bits(T::lt), bits(T::le)]);
    assert_eq!([eq | lt, ne & le, eq ^ le].map(|m| m.to_bitmask()), [bits(T::le), bits(T::lt), bits(T::lt)]);
    assert_eq!(lt.to_simd::<T>(), lt.select(!(x ^ x), x ^ x));
    assert_eq!(s.mask_from_bitmask::<T::Signed, W>(bits(T::lt)).select(x, y), x.simd_min(y));
    let mut out = vec![T::of::<0>(); n];
    ((x + y - y) * T::of::<1>() & (x | y)).saturating_add(y).saturating_sub(y).store(&mut out);
    assert_eq!(out, a);
    assert_eq!(x.bitcast::<u8>().bitcast::<T>(), x);
    if cfg!(panic = "abort") {
        return;
    }
    assert!(
        cfg!(not(panic = "unwind"))
            || std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.load::<T, W>(&a[1..]))).is_err()
    );
    assert!(
        cfg!(not(panic = "unwind"))
            || std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| x.store(&mut out[1..]))).is_err()
    );
}

#[test]
fn all_shapes() {
    macro_rules! all { ($($t:ty)*) => { $(check::<$t, B8>(); check::<$t, B16>(); check::<$t, B32>(); check::<$t, B64>();)* }; }
    all!(u8 i8 u16 i16 u32 i32 u64 i64);
}

#[test]
fn floats() {
    let v = f32x8::<Portable>::load(&[1.0, -2.0, 3.0, -0.0, 5.0, f32::NAN, 7.0, 8.0]);
    assert_eq!(
        (v.simd_eq(v).to_bitmask(), v.simd_lt(0.0).to_bitmask(), v.simd_ne(v).to_simd::<f32>().to_bits()[5]),
        (0b1101_1111, 0b10, !0)
    );
    assert_eq!(v.simd_le(3.0).select(v * 2.0 + 1.0 - v, 0.0), [2.0, -1.0, 4.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
}
