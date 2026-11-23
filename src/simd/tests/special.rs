//! src/simd/math/special.rs against std and the C library.
#![allow(dead_code, unreachable_pub)]
use bun_simd::{target::*, *};

unsafe extern "C" {
    safe fn erf(x: f64) -> f64;
    safe fn erfc(x: f64) -> f64;
    safe fn tgamma(x: f64) -> f64;
    safe fn lgamma_r(x: f64, sign: &mut i32) -> f64;
}

#[bun_simd_macros::rules]
macro_rules! checks { ($($name:ident $t:ident $tiny:literal;)*) => {$(
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn $name(x: &[$t], y: &[$t]) {
        let s: S = bun_simd::prelude::isa();
        let mut out = x.to_vec();
        macro_rules! each { ($$($$ulp:literal |$$a:ident, $$b:tt| $$simd:expr, $$std:expr;)*) => {$$(
            s.over(x).zip(y).map_into(&mut out, |($$a, $$b)| $$simd);
            for i in 0..x.len() {
                let ($$a, $$b, got) = (x[i], y[i], out[i]);
                let want: $t = $$std;
                let close = got.to_bits() == want.to_bits() || got.is_nan() && want.is_nan()
                    || $$ulp > 0 && want != 0.0 && (got - want).abs() <= $$ulp as $t * $t::EPSILON * want.abs() + $tiny
                    || $$ulp > 0 && want == 0.0 && got != 0.0 && got.abs() < $tiny;
                assert!(close, "{} {:?} {:?}: {got}, not {want}, on {s:?}", stringify!($$simd), x[i], y[i]);
            }
        )*}; }
        let by_squaring = |a: $t, n: u32| (0..32 - n.leading_zeros()).fold((1.0, a), |(y, a), i| (if n >> i & 1 == 1 { y * a } else { y }, a * a)).0;
        each! {
            0 |a, b| a % b, a % b;
            0 |a, b| a.rem_euclid(b), a.rem_euclid(b);
            0 |a, b| a.div_euclid(b), a.div_euclid(b);
            0 |a, _| a.powi(0), by_squaring(a, 0);
            0 |a, _| a.powi(1), a;
            0 |a, _| a.powi(13), by_squaring(a, 13);
            0 |a, _| a.powi(-6), 1.0 / by_squaring(a, 6);
            0 |a, _| a.powi(i32::MIN), 1.0 / by_squaring(a, 1 << 31);
        }
        if cfg!(any(miri, windows)) { return; }
        each! {
            4 |a, _| a.erf(), erf(a as f64) as $t;
            6 |a, _| a.erfc(), erfc(a as f64) as $t;
            10 |a, _| a.gamma(), tgamma(a as f64) as $t;
            8 |a, _| a.abs().ln_gamma(), lgamma_r((a as f64).abs(), &mut 0) as $t;
        }
        // C libraries differ here.
        if cfg!(target_vendor = "apple") { return; }
        each! { 8 |a, _| a.ln_gamma().abs() + 1.0, lgamma_r(a as f64, &mut 0).abs() as $t + 1.0; }
    }
)*}; }
checks! { singles f32 1e-44; doubles f64 5e-323; }

fn on_all(x: &[f64], y: &[f64]) {
    let [a, b] = [x, y].map(|it| it.iter().map(|&it| it as f32).collect::<Vec<f32>>());
    for &target in Target::ALL {
        doubles::to(target, x, y);
        singles::to(target, &a, &b);
    }
}

#[test]
fn special_values() {
    let mut values = vec![
        0.0,
        0.5,
        0.75,
        1.0,
        2.0,
        2.5,
        3.0,
        3.5,
        4.0,
        10.0,
        35.04,
        35.05,
        36.5,
        41.5,
        42.5,
        171.6,
        171.7,
        177.5,
        184.5,
        4194304.5,
        8388608.0,
        4503599627370495.5,
        4.0e36,
        4.1e36,
        3.4e38,
        2.5e305,
        2.6e305,
        f64::MAX,
        f64::INFINITY,
        f64::NAN,
        5e-324,
        1e-320,
        1e-45,
        1e-42,
        1e5,
        1e20,
        1e300,
    ];
    values.extend((0..if cfg!(miri) { 0 } else { 40 }).map(|i| (i as f64 * 0.37 - 9.0).exp()));
    values.extend(values.clone().iter().map(|it| -it));
    let (x, y): (Vec<f64>, Vec<f64>) = values.iter().flat_map(|&a| values.iter().map(move |&b| (a, b))).unzip();
    on_all(&x, &y);
}

#[test]
fn random_values() {
    let mut state = 1u64;
    let mut next = move || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state >> 11
    };
    let rounds = std::env::var("ROUNDS").map_or(if cfg!(miri) { 1 } else { 28 }, |it| it.parse().unwrap());
    for round in 0..rounds {
        let mut any = |range: u64| {
            f64::from_bits(next() << 12 >> 12 | (1023 + next() % (2 * range) - range) << 52 | next() << 63)
        };
        let range = [2, 6, 14, 30, 60, 140, 1023][round % 7];
        let (mut x, y): (Vec<f64>, Vec<f64>) = (0..256).map(|_| (any(range), any(range))).unzip();
        // Next to multiples, where the quotient is rounded to an integer.
        if round % 2 == 1 {
            for (x, y) in x.iter_mut().zip(&y) {
                *x = (*x / y).round() * y
            }
        }
        on_all(&x, &y);
        let [a, b] = [&x, &y].map(|it| it.iter().map(|&it| it as f32 as f64).collect::<Vec<f64>>());
        on_all(&a.iter().zip(&b).map(|(a, b)| ((a / b).round() * b) as f32 as f64).collect::<Vec<f64>>(), &b);
    }
}

#[test]
fn small_factorials_are_exact() {
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn gamma(x: &[f32], want: &[f32]) {
        let s: S = bun_simd::prelude::isa();
        let mut out = x.to_vec();
        s.over(x).map_into(&mut out, |v| v.gamma());
        assert_eq!(out, want);
    }
    for &target in Target::ALL {
        gamma::to(target, &[1.0, 2.0, 3.0], &[1.0, 1.0, 2.0]);
    }
}
