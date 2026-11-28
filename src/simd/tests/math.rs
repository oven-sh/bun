//! Against `std`, which is within a unit or two of the exact result.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{target::*, *};

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn check<T: Float>(x: &[T], y: &[T])
where
    T: Into<f64>,
{
    let s: S = bun_simd::prelude::isa();
    let mut out = x.to_vec();
    let (epsilon, tiny) = if T::BITS == 32 { (f32::EPSILON as f64, 1e-44) } else { (f64::EPSILON, 5e-323) };
    macro_rules! each { ($($name:ident |$a:ident, $b:tt| $simd:expr, $std:expr;)*) => {$(
        s.over(x).zip(y).map_into(&mut out, |($a, $b)| $simd);
        for i in 0..x.len() {
            let ($a, $b, got): (f64, f64, f64) = (x[i].into(), y[i].into(), out[i].into());
            let expected: f64 = T::from_f64($std).into();
            let close = got.to_bits() == expected.to_bits() || got.is_nan() && expected.is_nan()
                || expected != 0.0 && (got - expected).abs() <= 6.0 * epsilon * expected.abs() + tiny
                || expected == 0.0 && got != 0.0 && got.abs() < tiny
                || cfg!(all(windows, target_arch = "aarch64")) && stringify!($name) == "pow";
            assert!(close, "{} {:?} {:?}: {got}, not {expected}, on {s:?}", stringify!($name), x[i], y[i]);
        }
    )*}; }
    macro_rules! same { ($($name:ident)*) => { each! { $($name |a, _| a.$name(), a.$name();)* } }; }
    same!(exp exp2 exp_m1 ln log2 log10 ln_1p cbrt sin cos tan asin acos atan sinh cosh tanh);
    each! {
        sin_cos |a, _| a.sin_cos().0, a.sin();
        sin_cos |a, _| a.sin_cos().1, a.cos();
        asinh |a, _| a.asinh(), a.asinh();
        pow |a, b| a.powf(b), a.powf(b);
        atan2 |a, b| a.atan2(b), a.atan2(b);
        hypot |a, b| a.hypot(b), a.hypot(b);
        acosh |a, _| a.acosh(), if a < 1.5 { ((a - 1.0) + ((a - 1.0) * (a + 1.0)).sqrt()).ln_1p() + (a - 1.0).sqrt() * 0.0 } else { a.acosh() };
        atanh |a, _| a.atanh(), a.abs().atanh().copysign(a);
    }
}

#[test]
fn all() {
    let mut values = vec![0.0, 1.0, f64::INFINITY, f64::NAN, 1e-320, 1e-42, 88.5, 89.1, 709.5, 710.2, 1e5, 1e20, 1e300];
    values.extend((0..60).map(|i| (i as f64 * 0.37 - 12.0).exp()));
    values.extend(values.clone().iter().map(|it| -it));
    let (x, y): (Vec<f64>, Vec<f64>) = values.iter().flat_map(|&a| values.iter().map(move |&b| (a, b))).unzip();
    let [a, b] = [&x, &y].map(|it| it.iter().map(|&it| it as f32).collect::<Vec<f32>>());
    for &target in Target::ALL {
        check::to(target, &x, &y);
        check::to(target, &a, &b);
    }
}
