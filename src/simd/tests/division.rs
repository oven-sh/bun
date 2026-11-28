//! The division of small integers goes by estimates of reciprocals: all pairs of bytes, and the hard pairs of the others.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{target::*, *};

macro_rules! check { ($($name:ident $t:ident;)*) => {$(
    #[bun_simd::kernel(targets = bun_simd::target::Targets::ALL)]
    #[allow(non_snake_case)]
    fn $name<'a>((numerators, divisors): (&'a [$t], &'a [$t])) {
        let s: S = bun_simd::prelude::isa();
        for (a, b) in numerators.chunks(Simd::<$t, S::Native, S>::LANES).zip(divisors.chunks(Simd::<$t, S::Native, S>::LANES)) {
            let got = (s.load_or_default::<$t, S::Native>(a) / s.load_or::<$t, S::Native>(b, 1)).to_array();
            for i in 0..a.len() {
                let want = if b[i] == 0 { 0 } else { a[i].wrapping_div(b[i]) };
                assert_eq!(got.as_ref()[i], want, "{} / {} on {:?}", a[i], b[i], S::TARGET);
            }
        }
    }
)*}; }
check! { U8 u8; I8 i8; U16 u16; I16 i16; U32 u32; I32 i32; U64 u64; I64 i64; }

macro_rules! run {
    ($name:ident $t:ident, $pairs:expr) => {{
        let (a, b): (Vec<$t>, Vec<$t>) = $pairs.map(|(a, b)| (a as $t, b as $t)).unzip();
        for &target in Target::ALL {
            $name::to(target, (&a, &b));
        }
    }};
}

/// Multiples of each divisor, and their neighbors.
fn near_multiples(divisors: impl Iterator<Item = u64>, max: u64) -> impl Iterator<Item = (u64, u64)> {
    divisors.filter(|&b| b != 0).flat_map(move |b| {
        let most = max / b;
        [1, 2, 3, most / 3, most / 2, most.saturating_sub(1), most].into_iter().flat_map(move |q| {
            let a = q.wrapping_mul(b);
            [(a.wrapping_sub(1), b), (a, b), (a.wrapping_add(1), b), (a.wrapping_neg(), b), (a, b.wrapping_neg())]
        })
    })
}

#[test]
#[cfg_attr(miri, ignore)]
fn bytes() {
    run!(U8 u8, (0..1u64 << 16).map(|i| (i, i >> 8)));
    run!(I8 i8, (0..1u64 << 16).map(|i| (i, i >> 8)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn wider() {
    run!(U16 u16, near_multiples(0..1 << 16, 0xffff));
    run!(I16 i16, near_multiples(0..1 << 15, 0x8000));
    let divisors = |bits| {
        (0..bits).flat_map(|k| {
            (0..40u64).flat_map(move |i| {
                [(1 << k) + i, (1u64 << k).wrapping_sub(i), 0x9e37_79b9_7f4a_7c15u64.wrapping_mul(i + 1) >> (63 - k)]
            })
        })
    };
    run!(U32 u32, near_multiples(divisors(32), u32::MAX as u64));
    run!(I32 i32, near_multiples(divisors(31), 1 << 31));
    run!(U64 u64, near_multiples(divisors(64), u64::MAX));
    run!(I64 i64, near_multiples(divisors(63), 1 << 63));
}

macro_rules! by_number { ($($name:ident $t:ident;)*) => {$(
    #[bun_simd::kernel(targets = bun_simd::target::Targets::ALL)]
    #[allow(non_snake_case)]
    fn $name<'a>((values, by, to, form): (&'a [$t], $t, &'a mut [$t], usize)) {
        use bun_simd::prelude::*;
        let n = Simd::<$t, S::Native, S>::LANES;
        match form {
            0 => over(values).map_into(to, |v| v / by),
            1 => {
                for (from, to) in values.chunks_exact(n).zip(to.chunks_exact_mut(n)) {
                    (Simd::<$t, S::Native, S>::load(from) / by).store(to);
                }
            }
            2 => over(values).by::<B64>().map_into(to, |v| v / by),
            3 => over(values).map_into(to, |v| (v - v % by) / by),
            4 => over(values).map_into(to, |v| if by != 0 { v / by } else { v }),
            _ => {
                let by = Divisor::new(by).unwrap();
                over(values).map_into(to, |v| v / by);
            }
        }
    }
)*
    /// Several forms of loops.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn by_a_number_in_loops() {$(
        let near = |i: u32| [-2i8, -1, 0, 1, 2].map(|k| (1 as $t).wrapping_shl(i).wrapping_add(k as $t));
        for by in (0..$t::BITS).flat_map(near).flat_map(|it| [it, it.wrapping_neg(), it.wrapping_mul(11)]).filter(|&it| it != 0).step_by(if cfg!(bun_simd_unoptimized) { 11 } else { 1 }) {
            let most = $t::MAX / by * by;
            let edges = [0, 1, $t::MIN, $t::MAX, most, most.wrapping_sub(1), by, by.wrapping_sub(1), by.wrapping_neg()];
            let others = (1..).map(|i: u64| (i.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (i % 57)) as $t);
            let values: Vec<$t> = edges.into_iter().chain(others).take(704).collect();
            let want: Vec<$t> = values.iter().map(|it| it.wrapping_div(by)).collect();
            for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
                for form in 0..6 {
                    let mut got = vec![77; 704];
                    $name::to(target, (&values, by, &mut got, form));
                    assert_eq!(got, want, "{by} {form} {target:?}");
                }
            }
        }
    )*}
    /// It panics before the first store.
    #[test]
    #[cfg(panic = "unwind")]
    #[cfg_attr(miri, ignore)]
    fn by_zero_in_loops() {$(
        for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
            for form in 0..4 {
                let mut to = [77; 320];
                let run = std::panic::AssertUnwindSafe(|| $name::to(target, (&[5; 320], 0, &mut to, form)));
                let said = std::panic::catch_unwind(run).unwrap_err();
                assert_eq!(said.downcast_ref(), Some(&"attempt to divide by zero"), "{form} {target:?}");
                assert_eq!(to, [77; 320]);
            }
            $name::to(target, (&[], 0, &mut [], 1));
            let mut to = [77; 320];
            $name::to(target, (&[5; 320], 0, &mut to, 4));
            assert_eq!(to, [5; 320]);
        }
    )*}
}; }
by_number! { ByU8 u8; ByI8 i8; ByU16 u16; ByI16 i16; ByU32 u32; ByI32 i32; ByU64 u64; ByI64 i64; }
