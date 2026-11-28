//! The names that come from std::simd and the scalar types.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn single(m: &Model, f: fn(f32) -> f32, g: fn(f64) -> f64) -> Lanes {
    m.map1(|x| {
        m.t.quiet(if m.t == F(32) {
            f(f32::from_bits(x as u32)).to_bits() as i128
        } else {
            g(f64::from_bits(x as u64)).to_bits() as i128
        })
    })
}
fn class(m: &Model, f: fn(f32) -> bool, g: fn(f64) -> bool) -> Lanes {
    m.mask(|i| if m.t == F(32) { f(f32::from_bits(m.a[i] as u32)) } else { g(f64::from_bits(m.a[i] as u64)) })
}

cases! {
    round float 0..=64, |d, a, _, _, _| [a.round(), a.fract()] => |m| [single(m, f32::round, f64::round), single(m, f32::fract, f64::fract)].concat();
    angles float 0..=64, |d, a, _, _, _| [a.to_degrees(), a.to_radians()]
        => |m| [single(m, f32::to_degrees, f64::to_degrees), single(m, f32::to_radians, f64::to_radians)].concat();
    classes float 0..=64, |d, a, _, _, _| [a.is_normal(), a.is_subnormal()]
        => |m| [class(m, f32::is_normal, f64::is_normal), class(m, f32::is_subnormal, f64::is_subnormal)].concat();
    signum signed 0..=64, |d, a, _, _, _| a.signum() => |m| if let F(_) = m.t { single(m, f32::signum, f64::signum) } else { m.map1(i128::signum) };
    ones int 0..=64, |d, a, _, _, _| [a.count_zeros(), a.leading_ones(), a.trailing_ones()] => |m| [
        m.map1(|x| m.t.unsigned(!x).count_ones() as _),
        m.map1(|x| (m.t.unsigned(!x).leading_zeros() - (128 - m.t.bits())) as _),
        m.map1(|x| m.t.unsigned(x).trailing_ones() as _),
    ].concat();
    as_slices all 0..=64, |d, a, b, _, io| { let mut a = a; let i = io.up_to(d.lanes() - 1); a.as_mut()[i] = b.as_ref()[i]; (a, b.as_ref().len()) }
        => |m| [m.each(|i| if i == m.io.up_to(m.n - 1) { m.b[i] } else { m.a[i] }), vec![m.n as _]].concat();
    zip_any_all sizes 0..=64, |d, _, _, _, io| {
        let all = io.slice::<T>();
        let (x, y) = all.split_at(io.up_to(all.len()));
        [d.over(x).zip(y).any(#[inline(always)] |(a, b)| a.simd_eq(b)), d.over(x).zip(y).all(#[inline(always)] |(a, b)| a.simd_ne(b)),
            d.over(x).zip(x).all(#[inline(always)] |(a, b)| a.simd_eq(b))]
    } => |m| {
        let all = m.slice();
        let (x, y) = all.split_at(m.io.up_to(all.len()));
        let any = x.iter().zip(y).any(|(&a, &b)| m.t.eq(a, b)) as i128;
        vec![any, 1 - any, x.iter().all(|&a| !m.t.is_nan(a)) as _]
    };
}

#[test]
fn ties_and_limits() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        let bits = |v: f32x8<S>| v.to_bits().to_array();
        let x = [0.5, -0.5, 1.5, 2.5, 0.5f32.next_down(), -0.0, 8388607.5, -8388609.0];
        let v = f32x8::from(x);
        assert_eq!(bits(v.round()), x.map(|x| x.round().to_bits()));
        assert_eq!(bits(v.round_ties_even()), x.map(|x| x.round_ties_even().to_bits()));
        assert_eq!(bits(v.floor()), x.map(|x| x.floor().to_bits()));
        assert_eq!(bits(v.ceil()), x.map(|x| x.ceil().to_bits()));
        assert_eq!(bits(v.trunc()), x.map(|x| x.trunc().to_bits()));
        let set: std::collections::HashSet<_> = [u8x4::splat(1), u8x4::splat(2), u8x4::splat(1)].into();
        assert_eq!(set.len(), 2);
    }
    on::<bun_simd::target::Baseline>()
}
