#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{math::*, target::*, *};
#[path = "framework/on.rs"]
mod on;
use on::*;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn ints<T: Int>(x: &[T], y: &[T]) {
    let s: S = bun_simd::prelude::isa();
    let (d, n) = (s.native::<T>(), x.len());
    let odd = |it: &T| it.to_u64() & 1 == 1;
    let sum = x.iter().fold(0u64, |a, b| a.wrapping_add(b.to_u64()));
    assert_eq!(d.over(x).sum(), T::from_u64(sum));
    let (min, max) = (x.iter().min().copied(), x.iter().max().copied());
    assert_eq!((d.over(x).min(), d.over(x).max(), d.over(x).min_max()), (min, max, min.zip(max)));
    assert_eq!(d.over(x).position_min(), x.iter().position(|&it| Some(it) == min));
    assert_eq!(d.over(x).position_max(), x.iter().position(|&it| Some(it) == max));
    assert_eq!(
        d.over(x).count(
            #[inline(always)]
            |v| v.simd_eq(T::from_usize(3))
        ),
        x.iter().filter(|&&it| it == T::from_usize(3)).count()
    );
    let kept: Vec<T> = x.iter().copied().filter(odd).collect();
    for room in [kept.len(), n + 64] {
        let mut to = vec![T::default(); room];
        let count = d.over(x).filter_into(&mut to[..], |v| v.all_bits(T::from_usize(1)));
        assert_eq!(to[..count], kept);
    }
    let mut to = x.to_vec();
    let count = d.over_mut(&mut to).retain(|v| v.all_bits(T::from_usize(1)));
    assert_eq!(to[..count], kept);
    let mut to = x.to_vec();
    d.over_mut(&mut to).map(
        #[inline(always)]
        |v| v.all_bits(T::from_usize(1)).select(T::MAX, v),
    );
    assert!(to.iter().zip(x).all(|(a, b)| *a == if odd(b) { T::MAX } else { *b }));
    let both: Vec<T> = x.iter().zip(y).map(|(&a, &b)| !a & b).collect();
    d.over(x).zip(y).map_into(&mut to, |(a, b)| !a & b);
    assert_eq!(to, both);
    let mut to = x.to_vec();
    d.over_mut(&mut to).zip(y).map(|(a, b)| !a & b);
    assert_eq!(to, both);
    d.over_mut(&mut to).fill_with(|i| !i.bitcast());
    assert!(to.iter().enumerate().all(|(i, &it)| it == !T::from_usize(i)));
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn floats<T: Float>(x: &[T], y: &[T])
where
    T: Into<f64>,
{
    let s: S = bun_simd::prelude::isa();
    // Small integers, so that the order of the additions doesn't matter.
    let (d, dot) =
        (s.native::<T>(), |a: &[T], b: &[T]| a.iter().zip(b).map(|(&a, &b)| a.into() * b.into()).sum::<f64>());
    assert_eq!(d.over(x).zip(y).dot_relaxed().into(), dot(x, y));
    assert_eq!(d.over(x).sum().into(), x.iter().map(|&it| it.into()).sum::<f64>());
    assert_eq!(d.over(x).min().map(T::into), x.iter().map(|&it| it.into()).reduce(f64::min));
    for rows in [0, 1, 4, 7] {
        let columns = x.len() / 7;
        let mut to = vec![T::default(); rows];
        d.over(&x[..rows * columns]).mat_vec_relaxed(&y[..columns], &mut to);
        assert!((0..rows).all(|i| to[i].into() == dot(&x[i * columns..][..columns], y)));
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn wide(x: &[u64], y: &[u64]) {
    let s: S = bun_simd::prelude::isa();
    macro_rules! check {
        ($a:ident $b:ident $sum:ident) => {
            let (a, b): (Vec<$a>, Vec<$b>) = x.iter().zip(y).map(|(&a, &b)| (a as $a, b as $b)).unzip();
            let expected = a.iter().zip(&b).fold(0 as $sum, |sum, (&a, &b)| sum.wrapping_add(a as $sum * b as $sum));
            assert_eq!(s.over(&a).zip(&b).dot_wide(), expected);
        };
    }
    check!(u8 u8 u32);
    check!(u8 i8 i32);
    check!(i8 i8 i32);
    check!(i16 i16 i32);
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn random() -> (u64, f64, f32) {
    let mut random = Xoshiro::<S::Native, S>::new(7);
    random.next_u64();
    (random.next_u64()[0], random.next_f64().reduce_max_relaxed(), random.next_f32().reduce_max_relaxed())
}

#[test]
fn all() {
    let mut state = 1u64;
    for &target in Target::ALL {
        for len in 0..300 {
            let [x, y] = [(); 2].map(|_| {
                (0..len)
                    .map(|_| {
                        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                        state ^ state >> 29
                    })
                    .collect::<Vec<u64>>()
            });
            macro_rules! each { ($f:ident, $($t:ident)*; $shift:literal) => {$(
                let [a, b] = [&x, &y].map(|it| it.iter().map(|&it| (it as i64 >> $shift) as $t).collect::<Vec<$t>>());
                $f::to(target, &a, &b);
            )*}; }
            each!(ints, u8 i8 u16 i16 u32 i32 u64 i64; 0);
            each!(floats, f32 f64; 58);
            wide::to(target, &x, &y);
        }
        if let Some((lane, a, b)) = random::to(target) {
            assert!(lane == random().0 && (0.0..1.0).contains(&a) && (0.0..1.0).contains(&b));
        }
    }
}
