//! Masks and comparisons.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

cases! {
    within all 0..=64, |d, a, b, c, _| a.within(b..=c) => |m| m.mask(|i| {
        let (x, first, last) = (m.a[i], m.b[i], m.c[i]);
        if let F(_) = m.t { m.t.float(x) >= m.t.float(first) && m.t.float(x) <= m.t.float(last) } else { first <= x && x <= last }
    });
    within_numbers int 0..=64, |d, a, b, c, _| [a.within(b[0]..=c[0]), a.within(T::from_i64(9)..=T::from_i64(2)), a.within(T::from_i64(-9)..=T::from_i64(2))]
        => |m| [(m.b[0], m.c[0]), (9, 2), (if let I(_) = m.t { -9 } else { 3 }, 2)].map(|(first, last)| m.mask(|i| first <= m.a[i] && m.a[i] <= last)).concat();
    equal all 0..=64, |d, a, b, _, _| [a == b, a != b, a == a] => |m| {
        let all = |y: &[i128]| (0..m.n).all(|i| m.t.eq(m.a[i], y[i])) as i128;
        vec![all(&m.b), 1 - all(&m.b), all(&m.a)]
    };
    equal_masks sizes 0..=64, |d, a, b, _, _| { let (a, b) = (a.cast_signed().is_negative(), b.cast_signed().is_negative()); [a == b, a == a] }
        => |m| vec![(m.ma == m.mb) as _, 1];
    select_numbers all 0..=64, |d, a, b, _, _| {
        let mask = a.cast_signed().is_negative();
        [mask.select(b, T::ZERO), mask.select(T::ZERO, b), mask.select(b, -d.zero()), mask.select(T::ZERO, T::ZERO)]
    } => |m| {
        let minus_zero = if let F(_) = m.t { m.t.of(-0.0) } else { 0 };
        [m.each(|i| if m.ma[i] { m.b[i] } else { 0 }), m.each(|i| if m.ma[i] { 0 } else { m.b[i] }), m.each(|i| if m.ma[i] { m.b[i] } else { minus_zero }), m.each(|_| 0)].concat()
    };
    select_ones int 0..=64, |d, a, b, _, _| {
        let (mask, ones) = (a.cast_signed().is_negative(), T::from_i64(-1));
        [mask.select(b, ones), mask.select(ones, b), mask.select(ones, T::ONE), mask.select(T::ZERO, ones), mask.select(ones, ones), mask.select(b, T::MAX), mask.select(ones, T::ZERO), mask.select(T::ONE, T::ZERO)]
    } => |m| {
        let (ones, max) = (m.t.wrap(-1), m.t.max());
        let of = |yes: Option<i128>, no: Option<i128>| m.each(|i| if m.ma[i] { yes } else { no }.unwrap_or(m.b[i]));
        [of(None, Some(ones)), of(Some(ones), None), of(Some(ones), Some(1)), of(Some(0), Some(ones)), of(Some(ones), Some(ones)), of(None, Some(max)), of(Some(ones), Some(0)), of(Some(1), Some(0))].concat()
    };
    select_by_order int 0..=64, |d, a, b, c, _| [a.simd_lt(b).select(a, b), a.simd_gt(b).select(a, b), a.simd_le(b).select(b, a), a.simd_lt(T::ONE).select(a, T::ONE), a.simd_gt(b).select(c + a, c)]
        => |m| [m.map2(i128::min), m.map2(i128::max), m.map2(i128::max), m.map1(|x| x.min(1)), m.each(|i| m.c[i] + if m.a[i] > m.b[i] { m.a[i] } else { 0 })].concat();
    each_of_many int 16..=64, |d, a, b, c, _| (Simd::reduce_each([a, b], |x, y| x + y).to_vec(), Simd::reduce_each([a, b, c, !a, !b, a ^ c, b ^ c], |x, y| x.simd_min(y)).to_vec())
        => |m| { let (not, xor) = (|v: &Lanes| v.iter().map(|x| m.t.wrap(!x)).collect::<Lanes>(), |v: &Lanes| m.each(|i| m.t.wrap(v[i] ^ m.c[i])));
            [m.a.iter().sum(), m.b.iter().sum()].into_iter().chain([&m.a, &m.b, &m.c, &not(&m.a), &not(&m.b), &xor(&m.a), &xor(&m.b)].map(|it| *it.iter().min().unwrap())).collect() };
    test sizes 0..=64, |d, a, _, _, io| a.cast_signed().is_negative().test(io.up_to(d.lanes() - 1)) => |m| vec![m.ma[m.io.up_to(m.n - 1)] as _];
    shift_fill sizes 0..=64, |d, a, _, _, _| {
        let a = a.cast_signed().is_negative();
        [a.shift_elements_left::<1>(true), a.shift_elements_right::<1>(true)]
    } => |m| [m.mask(|i| i + 1 == m.n || m.ma[i + 1]), m.mask(|i| i == 0 || m.ma[i - 1])].concat();
    concat sizes 0..=32, |d, a, b, _, _| a.cast_signed().is_negative().concat(b.cast_signed().is_negative())
        => |m| [m.mask(|i| m.ma[i]), m.mask(|i| m.mb[i])].concat();
}

#[test]
fn of_one_size() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        let m: mask32x4<S> = f32x4::from([1.0, -1.0, 2.0, -2.0]).simd_lt(0.0) & u32x4::iota(0).simd_ne(3);
        assert_eq!(m.select(i32x4::splat(-7), 0), [0, -7, 0, 0]);
        assert_eq!(m.cast::<i8>().to_bitmask(), 0b10);
        assert!(
            m == MaskOf::<u32, B16, S>::from_bitmask(2)
                && m.isa().mask_splat::<i32, B16>(true) == mask32x4::splat(true)
        );
        assert!(mask8x32::repeat_bitmask(1) == m.isa().mask_repeat_bitmask::<i8, B32>(1));
        assert_eq!(mask16xN::first_n(3).count(), 3);
        assert_eq!(u8x16::splat(0), 0);
    }
    on::<bun_simd::target::Baseline>()
}
