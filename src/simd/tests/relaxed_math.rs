//! The limits that the relaxed functions document. ROWS=0..65536 takes all f32.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
mod framework;
use bun_simd::*;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn run<T: Float, W: Width>(which: usize, x: &[T], y: &[T], out: &mut [T]) {
    let s: S = bun_simd::prelude::isa();
    let both = s.over(x).by::<W>().zip(y);
    match which {
        0 => both.map_into(out, |(x, _)| x.exp_relaxed()),
        1 => both.map_into(out, |(x, _)| x.exp2_relaxed()),
        2 => both.map_into(out, |(x, _)| x.ln_relaxed()),
        3 => both.map_into(out, |(x, _)| x.log2_relaxed()),
        _ => both.map_into(out, |(x, y)| x.powf_relaxed(y)),
    }
}

struct Limits {
    least: f64,
    most: f64,
    error: f64,
    rounding: f64,
}

/// As a part of what is allowed.
fn error(which: usize, x: f64, y: f64, got: f64, it: &Limits) -> f64 {
    let exact = [f64::exp(x), f64::exp2(x), f64::ln(x), f64::log2(x), x.powf(y)][which];
    let right = |it: bool| if it { 0.0 } else { 1e9 };
    let allowed = it.error * if which == 4 { 1.0 + (y * x.log2()).abs() } else { 1.0 } + it.rounding;
    let relative = (got - exact).abs() / exact.abs() / allowed;
    match which {
        _ if x.is_nan() => 0.0,
        2 | 3 if x < 0.0 || x == 0.0 && x.is_sign_negative() || x.is_infinite() => 0.0,
        2 | 3 if x < it.least => right(got <= [it.least.ln(), it.least.log2()][which - 2] * (1.0 - allowed)),
        2 | 3 if x == 1.0 => right(got == 0.0),
        3 if exact == exact.round() && it.rounding == 0.0 && x.to_bits() << 12 == 0 => right(got == exact),
        2 | 3 => relative,
        4 if !(x >= it.least && x.is_finite() && y.is_finite()) => 0.0,
        _ if exact > it.most * (1.0 + allowed) => right(got == f64::INFINITY),
        _ if exact > it.most / 2.0 * (1.0 - allowed) && got == f64::INFINITY => 0.0,
        _ if exact < it.least * (1.0 + allowed) => right(
            (0.0..=it.least * (1.0 + 2.0 * allowed)).contains(&got)
                && (got == 0.0
                    || (got - exact).abs() <= it.least * (allowed + it.rounding)
                    || cfg!(all(windows, target_arch = "aarch64"))),
        ),
        _ => relative,
    }
}

fn check<T: Float + Into<f64>, W: Width>(x: &[T], y: &[T], it: &Limits, worst: &mut [f64; 5]) {
    let mut out = x.to_vec();
    for target in framework::targets() {
        for which in 0..5 {
            run::to::<T, W>(target, which, x, y, &mut out).unwrap();
            for i in 0..x.len() {
                let error = error(which, x[i].into(), y[i].into(), out[i].into(), it);
                assert!(
                    error <= 1.0,
                    "function {which} of {:?}, {:?} is {:?} on {target:?}, {} bytes",
                    x[i],
                    y[i],
                    out[i],
                    W::BYTES
                );
                worst[which] = worst[which].max(error);
            }
        }
    }
}

fn values<T: Float>(least: f64, most: f64) -> [Vec<T>; 2] {
    let mut state = 1u64;
    let mut random = move || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (state >> 11) as f64 / (1u64 << 53) as f64
    };
    let mut x = vec![
        0.0,
        1.0,
        0.5,
        2.0,
        least,
        least / 2.0,
        least / 1024.0,
        least * 0.71,
        most,
        most / 2.0,
        f64::INFINITY,
        f64::NAN,
        1e3,
        1e30,
    ];
    for edge in [most.log2(), most.ln(), least.log2(), least.ln()] {
        x.extend((-8..9).map(|i| edge.round() + i as f64 / 4.0).chain([edge]))
    }
    x.extend(x.clone().iter().map(|it| -it));
    let mut pairs: Vec<_> = x.iter().flat_map(|&a| x.iter().map(move |&b| (a, b))).collect();
    for _ in 0..if cfg!(miri) { 10 } else { 3000 } {
        let any = (least.ln() + (most.ln() - least.ln()) * random()).exp();
        pairs.extend([
            (any, 2.2 * random() - 1.1),
            (2.0 * random(), 20.0 * random() - 10.0),
            (1.0 + (random() - 0.5) * 1e-3, 1e3 * random()),
            (most.log2() * 2.2 * (random() - 0.5), 1.0),
        ]);
    }
    [pairs.iter().map(|it| T::from_f64(it.0)).collect(), pairs.iter().map(|it| T::from_f64(it.1)).collect()]
}

macro_rules! lanes { ($($name:ident $t:ty, $bits:literal, $rounding:expr, [$($w:ident)*];)*) => {$(
    #[test]
    fn $name() {
        let it = Limits { least: <$t>::MIN_POSITIVE.into(), most: <$t>::MAX.into(), error: 0.5f64.powi($bits), rounding: $rounding };
        let ([x, y], mut worst) = (values::<$t>(it.least, it.most), [0.0; 5]);
        $(check::<$t, $w>(&x, &y, &it, &mut worst);)*
    }
)*}; }
lanes! {
    single f32, 16, 0.0, [B4 B8 B16 B32 B64 B128];
    double f64, 32, 0.0, [B8 B16 B32 B64 B128];
    half f16, 16, 1.0 / 2048.0, [B2 B16 B64];
    brain bf16, 16, 1.0 / 256.0, [B2 B16 B64];
}

fn rows() -> impl Iterator<Item = Vec<f32>> {
    let rows: Vec<u32> = match std::env::var("ROWS") {
        Ok(it) => {
            let (from, to) = it.split_once("..").unwrap();
            (from.parse().unwrap()..to.parse().unwrap()).collect()
        }
        _ => {
            if cfg!(miri) {
                vec![]
            } else {
                vec![
                    0, 0x35, 0x7f, 0x80, 0x3f35, 0x3f7f, 0x3f80, 0x3fb5, 0x42b1, 0x42ff, 0x7f7f, 0x7f80, 0x7fff,
                    0x807f, 0xc2ae, 0xc2fc, 0xff7f, 0xffff,
                ]
            }
        }
    };
    let all = std::env::var("ROWS").is_ok();
    rows.into_iter().map(move |row| {
        (0..65536)
            .filter(|i| all || i % 13 == 0 || !(64..65472).contains(i))
            .map(|i| f32::from_bits(row << 16 | i))
            .collect()
    })
}

#[test]
fn rows_of_f32() {
    let (it, mut worst) = (
        Limits { least: f32::MIN_POSITIVE as f64, most: f32::MAX as f64, error: 0.5f64.powi(16), rounding: 0.0 },
        [0.0; 5],
    );
    for x in rows() {
        check::<f32, B64>(&x, &vec![1.0 / 2.4; x.len()], &it, &mut worst)
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn narrow<T: Float, U: Float, W: Width>(x: &[T], out: &mut [U]) {
    let s: S = bun_simd::prelude::isa();
    s.over(x).by::<W>().map_into(out, |v| v.cast_relaxed::<U>())
}

#[test]
fn casts_to_floats() {
    let x: Vec<f32> = rows()
        .flatten()
        .chain([1.0, f32::INFINITY, -f32::INFINITY, f32::from_bits(0x3f80_8000), f32::from_bits(0x3f81_8000)])
        .collect();
    let wide: Vec<f64> = x.iter().map(|&it| it as f64 * 1.0000001).collect();
    let (mut brain, mut half, mut single, mut double) =
        (vec![bf16::from_bits(0); x.len()], vec![f16::default(); x.len()], x.clone(), wide.clone());
    for target in framework::targets() {
        macro_rules! widths { ($($w:ident)*) => {$(
            narrow::to::<f32, bf16, $w>(target, &x, &mut brain).unwrap();
            for (&x, got) in x.iter().zip(&brain) {
                assert!(x.is_nan() || got.to_bits() == bf16::from_f32(x).to_bits() || x.is_subnormal() && got.to_f32() == 0.0, "{x:e} is {got:?} on {target:?}, {} bytes", $w::BYTES);
            }
        )*}; }
        widths!(B4 B8 B16 B32 B64 B128 B256);
        narrow::to::<f32, f16, B32>(target, &x, &mut half).unwrap();
        narrow::to::<f64, f32, B32>(target, &wide, &mut single).unwrap();
        narrow::to::<f32, f64, B16>(target, &x, &mut double).unwrap();
        narrow::to::<f64, bf16, B32>(target, &wide, &mut brain).unwrap();
        for i in (0..x.len()).filter(|&i| !x[i].is_nan()) {
            assert_eq!(
                (half[i], single[i], double[i], brain[i]),
                (f16::from_f32(x[i]), wide[i] as f32, x[i] as f64, bf16::from_f64(wide[i])),
                "{target:?}"
            );
        }
    }
}
