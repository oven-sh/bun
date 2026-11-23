//! `bun_simd::generic`: the methods of the token make what the functions of the type make.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::generic::*;

#[inline(always)]
fn same<T: Lane, W: Width, S: Isa>(s: S, from: &[T], x: T) {
    let (n, at, m) = (
        Simd::<T, W, S>::LANES,
        s.iota::<T::Unsigned, W>(Lane::ONE),
        s.mask_from_bitmask::<T::Signed, W>(0x5555_5555_5555_5555),
    );
    macro_rules! same { ($($name:ident($($a:expr),*);)*) => { $(assert!(Simd::<T, W, S>::$name($($a),*) == s.$name::<T, W>($($a),*), stringify!($name));)* }; }
    same! {
        splat(x); zero(); iota(x); from_fn(|i| from[2 * i]); from_array(Simd::<T, W, S>::load(from).to_array()); from(Simd::<T, W, S>::load(from));
        load(from); load_at(from, 3); load_last(from); load_bytes(&[1u8; 64]); load_or(&from[..n / 2], x); load_or_default(&from[..n / 2]);
        load_padded(&from[..n / 2], x); load_select(from, m, x); load_select_or_default(from, m); load_expand(from, m);
    }
    assert!(Simd::<T, W, S>::sign_bit().cast_unsigned() == s.sign_bit::<T, W>().cast_unsigned());
    assert!(
        Simd::<T, W, S>::gather_or_default(from, at) == Simd::<T, W, S>::load(&from[1..])
            && Simd::<T, W, S>::gather_or(&from[..0], at, x) == x
    );
    assert!(Simd::<T, W, S>::load_interleaved::<3>(from) == s.load_interleaved::<T, W, 3>(from));
    assert_eq!(Simd::<T, W, S>::over(from).position(|it| it.simd_eq(from[70])), Some(70));
    let mut copy = from.to_vec();
    Simd::<T, W, S>::over_mut(&mut copy).map(|_| Simd::<T, W, S>::splat(x));
    assert!(copy.iter().all(|&it| it == x));
    type M<T, W, S> = MaskOf<T, W, S>;
    assert_eq!(
        [
            M::<T, W, S>::splat(true).count(),
            M::<T, W, S>::first_n(1).count(),
            M::<T, W, S>::from_bitmask(1).count(),
            M::<T, W, S>::repeat_bitmask(0).count()
        ],
        [n, 1, 1, 0]
    );
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn all() {
    let s: S = bun_simd::prelude::isa();
    macro_rules! lanes { ($($t:ident $native:ident $fixed:ident $mask:ident $fixed_mask:ident)*) => {$(
        let from: Vec<$t> = (0..200).map(|it| it as $t).collect();
        same::<$t, B8, S>(s, &from, 3 as $t);
        same::<$t, B64, S>(s, &from, 3 as $t);
        let (a, b): ($native<S>, SimdN<$t, S>) = ($native::<S>::load(&from), SimdN::<_, S>::load(&from));
        let (m, n): ($mask<S>, MaskN<$t, S>) = (a.simd_eq(b), $mask::<S>::splat(true));
        assert!(m == n && $native::<S>::LANES * size_of::<$t>() == S::Native::BYTES);
        let m: $fixed_mask<S> = $fixed::<S>::load(&from).simd_lt(2 as $t);
        assert!(m == $fixed_mask::<S>::first_n(2));
    )*}; }
    lanes!(u8 u8xN u8x16 mask8xN mask8x16 i16 i16xN i16x4 mask16xN mask16x4 f32 f32xN f32x16 mask32xN mask32x16 u64 u64xN u64x4 mask64xN mask64x4);
}

#[test]
fn on_makes_the_same() {
    Target::ALL.iter().for_each(|&it| _ = all::to(it));
    let _: (Baseline, Targets) = (baseline(), Targets::DEFAULT);
}

#[test]
fn aliases_are_what_they_say() {
    macro_rules! all { ($($t:ident $native:ident $native_mask:ident: $($w:ident $v:ident $m:ident),*;)*) => {
        fn check<S: Isa>(s: S) {$(
            let _: ($native<S>, $native_mask<S>) = (s.zero::<$t, S::Native>(), s.mask_splat::<<$t as bun_simd::Lane>::Signed, S::Native>(true));
            $(let _: ($v<S>, $m<S>) = (s.zero::<$t, $w>(), s.mask_splat::<<$t as bun_simd::Lane>::Signed, $w>(true));
            assert!(stringify!($v).ends_with(&format!("x{}", $v::<S>::LANES)) && stringify!($m).ends_with(&format!("x{}", $m::<S>::LANES)));)*
        )*}
    }; }
    all! {
        u8 u8xN mask8xN: B2 u8x2 mask8x2, B4 u8x4 mask8x4, B8 u8x8 mask8x8, B16 u8x16 mask8x16, B32 u8x32 mask8x32, B64 u8x64 mask8x64;
        i8 i8xN mask8xN: B2 i8x2 mask8x2, B4 i8x4 mask8x4, B8 i8x8 mask8x8, B16 i8x16 mask8x16, B32 i8x32 mask8x32, B64 i8x64 mask8x64;
        u16 u16xN mask16xN: B2 u16x1 mask16x1, B4 u16x2 mask16x2, B8 u16x4 mask16x4, B16 u16x8 mask16x8, B32 u16x16 mask16x16, B64 u16x32 mask16x32;
        i16 i16xN mask16xN: B2 i16x1 mask16x1, B4 i16x2 mask16x2, B8 i16x4 mask16x4, B16 i16x8 mask16x8, B32 i16x16 mask16x16, B64 i16x32 mask16x32;
        u32 u32xN mask32xN: B4 u32x1 mask32x1, B8 u32x2 mask32x2, B16 u32x4 mask32x4, B32 u32x8 mask32x8, B64 u32x16 mask32x16;
        i32 i32xN mask32xN: B4 i32x1 mask32x1, B8 i32x2 mask32x2, B16 i32x4 mask32x4, B32 i32x8 mask32x8, B64 i32x16 mask32x16;
        f32 f32xN mask32xN: B4 f32x1 mask32x1, B8 f32x2 mask32x2, B16 f32x4 mask32x4, B32 f32x8 mask32x8, B64 f32x16 mask32x16;
        u64 u64xN mask64xN: B8 u64x1 mask64x1, B16 u64x2 mask64x2, B32 u64x4 mask64x4, B64 u64x8 mask64x8;
        i64 i64xN mask64xN: B8 i64x1 mask64x1, B16 i64x2 mask64x2, B32 i64x4 mask64x4, B64 i64x8 mask64x8;
        f64 f64xN mask64xN: B8 f64x1 mask64x1, B16 f64x2 mask64x2, B32 f64x4 mask64x4, B64 f64x8 mask64x8;
    }
    check(baseline());
}
