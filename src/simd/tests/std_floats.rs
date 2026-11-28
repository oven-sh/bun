//! The names that come from the floating-point numbers of std.
#![allow(dead_code, unreachable_pub)]
#![allow(clippy::manual_isolate_lowest_one)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn two(m: &Model, f: fn(f32, f32) -> f32, g: fn(f64, f64) -> f64) -> Lanes {
    m.map2(|x, y| {
        if m.t == F(64) {
            m.t.of(g(m.t.float(x), m.t.float(y)))
        } else {
            m.t.of(f(m.t.float(x) as f32, m.t.float(y) as f32) as f64)
        }
    })
}
fn extreme(m: &Model, max: bool) -> Lanes {
    m.map2(|x, y| {
        m.t.quiet(if m.t.is_nan(x) || !m.t.is_nan(y) && m.t.float(x).total_cmp(&m.t.float(y)).is_gt() == max {
            x
        } else {
            y
        })
    })
}
fn next(t: Ty, x: i128, up: bool) -> i128 {
    let (top, value) = (1 << (t.bits() - 1), t.float(x));
    if value.is_nan() || value == if up { f64::INFINITY } else { f64::NEG_INFINITY } {
        x
    } else if value == 0.0 {
        if up { 1 } else { top | 1 }
    } else if (value > 0.0) == up {
        x + 1
    } else {
        x - 1
    }
}

macro_rules! floats { ($($set:ident [$($t:ident)*])*) => {$(mod $set { use super::*; cases! {
    remainders [$($t)*] 0..=64, |d, a, b, _, _| { let mut x = a; x %= b; [a % b, x, a % T::of::<3>(), T::of::<100>() % a.bitcast::<T>(), a.rem_euclid(b), a.rem_euclid(T::of::<-5>())] } => |m| [
        two(m, |x, y| x % y, |x, y| x % y), two(m, |x, y| x % y, |x, y| x % y), two(m, |x, _| x % 3.0, |x, _| x % 3.0), two(m, |x, _| 100.0 % x, |x, _| 100.0 % x),
        two(m, f32::rem_euclid, f64::rem_euclid), two(m, |x, _| x.rem_euclid(-5.0), |x, _| x.rem_euclid(-5.0))].concat();
    by_powers [$($t)*] 0..=64, |d, a, _, _, _| [a % T::of::<1>(), a % T::of::<2>(), a % T::of::<-64>(), a % T::from_f64(0.5), a % T::from_f64(f64::INFINITY), a % T::ZERO, a.rem_euclid(T::of::<4>())] => |m| [
        two(m, |x, _| x % 1.0, |x, _| x % 1.0), two(m, |x, _| x % 2.0, |x, _| x % 2.0), two(m, |x, _| x % -64.0, |x, _| x % -64.0), two(m, |x, _| x % 0.5, |x, _| x % 0.5),
        two(m, |x, _| x % f32::INFINITY, |x, _| x % f64::INFINITY), two(m, |x, _| x % 0.0, |x, _| x % 0.0), two(m, |x, _| x.rem_euclid(4.0), |x, _| x.rem_euclid(4.0))].concat();
    between [$($t)*] 0..=64, |d, a, b, _, _| [a.midpoint(b), a.minimum(b), a.maximum(b), a.midpoint(<T as Lane>::MAX)] => |m| { let max = if m.t == F(16) { 65504.0 } else { m.t.float(if m.t == BF { 0x7f7f } else { 0x7f7f_ffff }) };
        [two(m, f32::midpoint, f64::midpoint), extreme(m, false), extreme(m, true), m.float1(|x| x.midpoint(if m.t == F(64) { f64::MAX } else { max }))].concat() };
    neighbors [$($t)*] 0..=64, |d, a, _, _, _| ([a.next_up(), a.next_down(), Simd::from_bits(a.to_bits())], [a.is_sign_negative(), a.is_sign_positive()])
        => |m| [m.map1(|x| next(m.t, x, true)), m.map1(|x| next(m.t, x, false)), m.a.clone(), m.mask(|i| m.ma[i]), m.mask(|i| !m.ma[i])].concat();
} })*}; }
floats! { wide [f32 f64] narrow [half bf16] }

cases! {
    log float 0..=64, |d, a, b, _, _| [a.log(b) , a.log(T::of::<3>())] .map(|v| v.to_bits()) == [a.ln() / b.ln(), a.ln() / d.splat(T::of::<3>()).ln()].map(|v| v.to_bits()) || a.log(b).is_nan().any() => |_m| vec![1];
}
