//! The number `bf16`, and slices as slices of another type. Miri runs this.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::WithToken;
mod framework;
use bun_simd::{prelude::*, target::baseline};
use framework::*;

#[test]
fn scalar() {
    for bits in (0..=u16::MAX).step_by(if cfg!(miri) { 997 } else { 1 }) {
        let (x, value) = (bf16::from_bits(bits), BF.float(bits as i128));
        assert!(x.to_bits() == bits && (x.to_f64() == value || x.is_nan() && value.is_nan()));
        for lower in [0, 1, 0x7fff, 0x8000, 0x8001, 0xffff] {
            let single = f32::from_bits((bits as u32) << 16 | lower);
            assert!(
                bf16::from_f32(single).to_bits() as i128 == BF.of(single as f64)
                    || single.is_nan() && bf16::from_f32(single).is_nan()
            );
            for double in [single as f64, (single as f64).next_up(), (single as f64).next_down()] {
                assert!(
                    bf16::from_f64(double).to_bits() as i128 == BF.of(double)
                        || double.is_nan() && bf16::from_f64(double).is_nan()
                );
            }
        }
        let y = bf16::from_bits(bits.wrapping_mul(40503));
        let same =
            |got: bf16, want: f64| assert!(got.to_bits() as i128 == BF.of(want) || got.is_nan() && want.is_nan());
        same(x + y, value + y.to_f64());
        same(x - y, value - y.to_f64());
        same(x * y, value * y.to_f64());
        same(x / y, value / y.to_f64());
        same(x % y, value % y.to_f64());
        same(-x, -value);
        assert_eq!(x.partial_cmp(&y), value.partial_cmp(&y.to_f64()));
    }
    assert_eq!(format!("{:?} {} {:e}", bf16::ONE, bf16::EPSILON, bf16::INFINITY), "1.0 0.0078125 inf");
    assert!(
        bf16::NAN.is_nan()
            && bf16::NEG_INFINITY < bf16::MIN
            && f32::from(bf16::MIN_POSITIVE) == f32::MIN_POSITIVE
            && f64::from(bf16::default()) == 0.0
    );
}

#[test]
fn slices() {
    let mut bits = [0x3f80u16, 0x4000];
    mem::bitcast_slice_mut::<bf16>(&mut bits)[1] = bf16::from_f32(-2.0);
    assert_eq!(bits, [0x3f80, 0xc000]);
    assert_eq!(mem::bitcast_slice::<u8>(&[-1i8]), [255]);
    assert_eq!(mem::bitcast_slice::<f64>(&[0u64; 0]), []);
    let mut v = baseline().load::<bf16, B4>(mem::bitcast_slice::<bf16>(&bits));
    (v[0], v.as_mut()[1]) = (v[1], bf16::ONE);
    assert_eq!(v.to_bits(), [0xc000, 0x3f80]);
}

macro_rules! pairs { ($([$($t:ident)*] $all:tt)*) => { $($(pairs!($t $all);)*)* }; ($t:ident [$($u:ident)*]) => {$({
    let mut from: Vec<$t> = (0..9).map(|i| Test::from_bits(!0 / 255 * (i * 29))).collect();
    for at in 0..=9 {
        let bits = |i: usize| Test::to_bits(<$u as Test>::from_bits(!0 / 255 * (i as u64 * 29)));
        assert!(mem::bitcast_slice::<$u>(&from[at..]).iter().map(|&it| Test::to_bits(it)).eq((at..9).map(bits)));
    }
    let (a, b) = from.split_at_mut(4);
    let (a, b) = (mem::bitcast_slice_mut::<$u>(a), mem::bitcast_slice_mut::<$u>(b));
    core::mem::swap(&mut a[3], &mut b[0]);
    assert_eq!(Test::to_bits(from[3]), Test::to_bits(<$t as Test>::from_bits(!0 / 255 * (4 * 29))));
})*}; }
#[test]
fn all_pairs() {
    pairs! { [u8 i8] [u8 i8] [u16 i16 half bf16] [u16 i16 half bf16] [u32 i32 f32] [u32 i32 f32] [u64 i64 f64] [u64 i64 f64] }
}

#[test]
fn memory() {
    #[bun_simd::simd]
    fn on() {
        let all: Vec<bf16> = (0..40).map(|i| bf16::from_f32(i as f32)).collect();
        for n in 0..=32 {
            let (v, mut to) = (bf16x32::load_or_default(&all[..n]), vec![bf16::NAN; n]);
            v.store_partial(&mut to);
            assert_eq!(to, all[..n]);
        }
        over(&all).map_into(&mut [core::mem::MaybeUninit::<bf16>::uninit(); 40][..], |v| v);
        let [a, b, c] = bf16x8::load_interleaved::<3>(&all);
        let mut to = [bf16::NAN; 24];
        bf16x8::store_interleaved([a, b, c], &mut to);
        assert_eq!(to, all[..24]);
        assert_eq!(bf16x4::gather_or_default(&all, u16x4::from([3, 99, 39, 0])).cast::<u8>(), [3, 0, 39, 0]);
        assert_eq!(bf16x8::gather_or_default(&all, u16x8::iota(35)).cast::<u8>(), [35, 36, 37, 38, 39, 0, 0, 0]);
        assert_eq!(bf16x8::load_interleaved::<5>(&all)[4].cast::<u8>(), u8x8::iota(1) * 5 - 1);
        let mut room = [core::mem::MaybeUninit::uninit(); 8];
        let mut out = Output::new(&mut room);
        out.push(a);
        assert_eq!(out.into_filled(), a.to_array());
    }
    on::<bun_simd::target::Baseline>()
}

/// parts/half.rs has these on all targets, for one width.
#[test]
#[cfg_attr(all(miri, target_feature = "f16c"), ignore = "Miri has no vcvtps2ph")]
fn extremes_at_other_widths() {
    // LLVM takes a quarter of an hour for all of these loops in one function.
    #[inline(never)]
    fn apart<R>(f: impl FnOnce() -> R) -> R {
        f()
    }
    fn at<T: Test + Float, W: Width>() {
        for (n, mask) in (1..if cfg!(miri) { 3 } else { 150 }).flat_map(|n| {
            [(n, [0xffff, 0]), (n, [0x7fff, 0]), (n, [0xffff, 0x8000]), (n, [0x8000, 0]), (n, [0xffff, 0x7f80])]
        }) {
            let x: Vec<T> = (0..n)
                .map(|i: u64| T::from_bits((i + n).wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 40 & mask[0] | mask[1]))
                .collect();
            let f = |it: T| T::TY.float(it.to_bits() as i128);
            let numbers = || x.iter().map(|&it| f(it)).filter(|it| !it.is_nan());
            let want =
                [numbers().min_by(f64::total_cmp), numbers().max_by(f64::total_cmp)].map(|it| it.map(f64::to_bits));
            let over = baseline().over(&x).by::<W>();
            let bits = |it: T| Some(f(it)).filter(|it| !it.is_nan()).map(f64::to_bits);
            assert_eq!([apart(|| over.min()), apart(|| over.max())].map(|it| bits(it.unwrap())), want);
            assert_eq!(<[T; 2]>::from(apart(|| over.min_max()).unwrap()).map(bits), want);
            assert_eq!(
                apart(|| over.position_min()),
                Some(x.iter().position(|&it| Some(f(it)) == want[0].map(f64::from_bits)).unwrap_or(0))
            );
        }
    }
    at::<half, B8>();
    at::<half, B64>();
    at::<bf16, B4>();
    at::<bf16, B32>();
}

#[test]
fn bytes() {
    macro_rules! each { ($($t:ident)*) => {$(
        let mut values = [1 as $t, 2 as $t, 3 as $t];
        assert_eq!(mem::as_bytes(&values[1..]), [values[1].to_ne_bytes(), values[2].to_ne_bytes()].concat());
        assert_eq!(mem::as_bytes(&values[3..]), []);
        mem::as_bytes_mut(&mut values[1..2]).copy_from_slice(&(7 as $t).to_ne_bytes());
        assert_eq!(values, [1 as $t, 7 as $t, 3 as $t]);
    )*}; }
    each!(u8 i8 u16 i16 u32 i32 u64 i64 f32 f64);
    assert_eq!(mem::as_bytes(&[bf16::from_f32(1.0)]), 0x3f80u16.to_ne_bytes());
}

#[derive(Copy, Clone, Plain, PartialEq, Debug)]
#[repr(C)]
struct Vertex {
    at: [f32; 3],
    color: Color,
}
#[derive(Copy, Clone, Plain, PartialEq, Debug)]
#[repr(transparent)]
struct Color([u8; 4]);
#[derive(Copy, Clone, mem::Plain)]
#[repr(C, packed)]
struct Header(u8, u32, core::num::Wrapping<u16>);

#[test]
fn records() {
    #[bun_simd::simd]
    fn on() {
        let mut all: Vec<_> =
            (0..37).map(|i| Vertex { at: [i as f32, 1.0, 2.0], color: Color([i, 0, 0, 255]) }).collect();
        let words = as_cells(bitcast_slice_mut::<u32>(&mut all));
        over(words).interleaved().map_into(&mut { words }, |[x, y, z, c]| [y, x, z, !c]);
        assert!(
            (0..37).all(|i| all[i as usize] == Vertex { at: [1.0, i as f32, 2.0], color: Color([!i, 255, 255, 0]) })
        );
        assert_eq!(
            (bitcast_slice::<Color>(&all).len(), as_bytes(&all).len(), bitcast_slice::<[u16; 8]>(&all).len()),
            (148, 592, 37)
        );
        let bytes = [9u8, 1, 0, 0, 0, 0, 7, 7, 5];
        let [Header(a, b, c)] = *bitcast_slice::<Header>(bytes[1..].as_chunks::<7>().0) else { panic!() };
        assert_eq!((a, b, c.0), (1, 0, 0x0707));
        let (mut wide, mut index) = ([1u128 << 64 | 2], [3usize, 4]);
        bitcast_slice_mut::<u64>(&mut wide).reverse();
        bitcast_slice_mut::<isize>(&mut index)[0] = -1;
        assert_eq!((wide, index, bitcast_slice::<i128>(&wide)), ([2 << 64 | 1], [!0, 4], &[2 << 64 | 1][..]));
        let mut room = [core::mem::MaybeUninit::<Vertex>::uninit(); 2];
        let mut out = Output::new(bitcast_slice_mut::<core::mem::MaybeUninit<u32>>(&mut room));
        out.push(u32x8::splat(1));
        assert_eq!(out.into_filled(), [1; 8]);
        assert_eq!(bitcast_slice::<core::num::Saturating<u8>>(&[[0u64; 0]; 9]), []);
    }
    on::<bun_simd::target::Baseline>()
}

#[test]
fn forms_of_the_derive() {
    #[derive(Copy, Clone, bun_simd::mem::Plain)]
    struct Unit;
    #[derive(Copy, Clone, ::bun_simd::prelude::Plain)]
    #[repr(C)]
    struct Named {
        pub a: u8,
        unit: Unit,
    }
    #[derive(Copy, Clone, bun_simd::generic::AsBytes)]
    #[repr(C)]
    struct Nothing {}
    mod inner {
        pub mod mem {
            pub use bun_simd::mem::Plain;
        }
        #[derive(Copy, Clone, self::mem::Plain)]
        pub struct One(pub u8);
    }
    let named = bitcast_slice::<Named>(&[inner::One(7)])[0];
    assert_eq!((named.a, size_of_val(&named.unit), as_bytes(&[Nothing {}]).len()), (7, 0, 0));
}

#[test]
fn read_only() {
    #[bun_simd::simd]
    fn on() {
        #[derive(Copy, Clone, AsBytes)]
        #[repr(u16)]
        enum Kind {
            A = 1,
            B = 300,
        }
        #[derive(Copy, Clone, AsBytes)]
        #[repr(C)]
        struct Mixed(char, [bool; 2], Kind);
        assert_eq!(as_bytes(&[true, false]), [1, 0]);
        assert_eq!(bitcast_slice::<u32>(&['a']), [97]);
        assert_eq!(over(bitcast_slice::<u16>(&[Kind::A, Kind::B])).sum(), 301);
        assert_eq!(bitcast_slice::<[u16; 4]>(&[Mixed('a', [true; 2], Kind::B)])[0][2..], [0x0101, 300]);
    }
    on::<bun_simd::target::Baseline>()
}

#[test]
fn alignment() {
    let mut all = Aligned([0u8; 192]);
    macro_rules! each { ($($t:ty)*) => {$(
        for (at, n) in (0..=64).flat_map(|at| [(at, 0), (at, 1), (at, 2)]) {
            let part = all[at..][..n * size_of::<$t>()].as_chunks_mut::<{ size_of::<$t>() }>().0;
            let fits = n == 0 || at % align_of::<$t>() == 0;
            assert_eq!(try_bitcast_slice::<$t>(part).map(<[_]>::len), fits.then_some(n));
            assert_eq!(try_bitcast_slice_mut::<$t>(part).map(|it| it.fill(Default::default())).is_some(), fits);
        }
    )*}; }
    each!(u8 u16 f32 u64 u128 Aligned<[[u16; 16]; 2]>);
}

/// A vector is its lanes.
#[bun_simd::simd]
mod vectors {
    use bun_simd::prelude::*;
    const fn fits<T: Lane>() {
        macro_rules! each { ($($w:ty),*) => { $(assert!(size_of::<Simd<T, $w, S>>() == <$w>::BYTES);)* }; }
        each!(B16, B32, B64, B128, B256, B512, Native<S>);
    }
    #[simd]
    const FITS1: [(); 6] =
        [fits::<u8, S>(), fits::<u16, S>(), fits::<u32, S>(), fits::<u64, S>(), fits::<f16, S>(), fits::<f32, S>()];
    #[simd]
    const FITS2: [(); 6] =
        [fits::<i8, S>(), fits::<i16, S>(), fits::<i32, S>(), fits::<i64, S>(), fits::<bf16, S>(), fits::<f64, S>()];

    fn bytes<W: Width>(all: &[Simd<u8, W, S>]) -> usize {
        as_bytes(all).len()
    }
    fn capped<W: Width>() -> usize {
        Simd::<u8, Upto<W, S>, S>::splat(1).reduce_sum() as usize
    }

    #[kernel]
    pub fn flat(n: usize) {
        let _ = (S::FITS1, S::FITS2);
        let mut all = vec![u32xN::iota(0); n];
        for (i, it) in bitcast_slice_mut::<u32>(&mut all).iter_mut().enumerate() {
            *it += i as u32;
        }
        assert!(all.iter().enumerate().all(|(i, &v)| v == u32xN::iota(0) * 2 + (i * u32xN::LANES) as u32));
        let wide = [Simd::<bf16, B128, S>::splat(bf16::ONE); 2];
        assert!(bitcast_slice::<bf16>(&wide) == [bf16::ONE; 128] && as_bytes(&all).len() == n * Native::<S>::BYTES);
        macro_rules! each { ($($w:ty),*) => {$(
            let mut two = [Simd::<u16, $w, S>::iota(0); 2];
            bitcast_slice_mut::<u16>(&mut two).reverse();
            assert!(two[0] == Simd::<u16, $w, S>::iota(0).reverse() && as_bytes(&two).len() == 2 * <$w>::BYTES);
        )*}; }
        each!(Upto<B32, S>, Twice<Native<S>>, Twice<Twice<Native<S>>>, Twice<Twice<Twice<Native<S>>>>);
        each!(Pick![S: avx2 => B64, _ => B32], Half<Twice<Upto<B32, S>>>);
        assert_eq!([bytes(&[u8x16::zero(); 3]), bytes(&[u8x64::zero(); 3])], [48, 192]);
        let halves = [Simd::<u8, Half<Native<S>>, S>::zero(); 2];
        assert_eq!(pick! { B16 => halves.len() * 8, _ => as_bytes(&halves).len() }, Native::<S>::BYTES);
        let upto = [capped::<B2, S>(), capped::<B16, S>(), capped::<B32, S>(), capped::<B64, S>(), capped::<B512, S>()];
        assert_eq!(upto, [2, 16, 32, 64, 512].map(|it| Native::<S>::BYTES.min(it)));
    }
}
#[test]
fn of_vectors() {
    for target in vectors::flat::targets() {
        vectors::flat::to(target, 3);
    }
}
