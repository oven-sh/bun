#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

/// Like `as`, or unspecified if out of range.
fn int(to: Ty, x: f64, saturate: bool) -> i128 {
    let whole = x as i128;
    if saturate {
        to.clamp(whole)
    } else if x.is_nan() || whole != to.clamp(whole) {
        ANY
    } else {
        whole
    }
}
fn of(m: &Model, to: Ty, saturate: bool, round: fn(f64) -> f64) -> Lanes {
    m.map1(|x| int(to, round(m.t.float(x)), saturate))
}
fn half(x: f16) -> i128 {
    if x.is_nan() { ANY } else { x.to_bits() as i128 }
}
fn brain(bits: i128) -> i128 {
    let x = f32::from_bits(bits as u32);
    let (down, rest) = (bits >> 16, bits & 0xffff);
    if x.is_nan() { ANY } else { down + (rest > 0x8000 || rest == 0x8000 && down & 1 == 1) as i128 }
}

cases! {
    to_int float 0..=64, |d, a, _, _, _| ((a.cast::<<T as Lane>::Signed>(), a.cast::<<T as Lane>::Unsigned>()),
        (a.cast_relaxed::<<T as Lane>::Signed>(), a.cast_relaxed::<<T as Lane>::Unsigned>()))
        => |m| [(I(m.t.bits()), true), (U(m.t.bits()), true), (I(m.t.bits()), false), (U(m.t.bits()), false)].map(|(t, s)| of(m, t, s, |x| x)).concat();
    to_big_int float 0..=64, |d, a, _, _, _| { let a = a * a * a; (a.cast::<<T as Lane>::Signed>(), a.cast::<<T as Lane>::Unsigned>()) } => |m| {
        let cube = |x: i128| m.t.float(m.t.of(m.t.float(m.t.of(m.t.float(x) * m.t.float(x))) * m.t.float(x)));
        [I(m.t.bits()), U(m.t.bits())].map(|t| m.map1(|x| int(t, cube(x), true))).concat()
    };
    to_f64 [i64 u64] 0..=64, |d, a, b, _, _| { [a.cast::<f64>(), b.cast_signed().is_negative().select(a.cast::<f64>(), 0.0)] }
        => |m| [m.map1(|x| F(64).of(x as f64)), m.each(|i| if m.mb[i] { F(64).of(m.a[i] as f64) } else { 0 })].concat();
    rounding [f64] 0..=64, |d, a, _, _, _| [a.round_cast_relaxed::<i64>(), a.ceil().cast_relaxed::<i64>(), a.floor().cast_relaxed::<i64>()]
        => |m| [f64::round_ties_even, f64::ceil, f64::floor].map(|f| of(m, I(64), false, f)).concat();
    f32_to_64_bits [f32] 0..=32, |d, a, _, _, _| {
        let (_i, _u) = (d.twice().repartition::<i64>(), d.twice().repartition::<u64>());
        ((a.cast::<i64>().resize::<W::Twice>(), a.cast::<u64>().resize::<W::Twice>()), (a.resize::<<W::Twice as Width>::Half>().cast_relaxed::<i64>().resize::<W::Twice>(), a.resize::<<W::Twice as Width>::Half>().cast_relaxed::<u64>().resize::<W::Twice>()))
    } => |m| [(I(64), true), (U(64), true), (I(64), false), (U(64), false)].map(|(t, s)| of(m, t, s, |x| x)).concat();
    f64_to_32_bits [f64] 0..=64, |d, a, _, _, _| {
        let (_i, _u) = (d.isa().of::<i32, W>().half(), d.isa().of::<u32, W>().half());
        let same = a.resize::<<W::Half as Width>::Twice>();
        (([a.saturating_cast::<i32>().resize::<W::Half>(), same.cast_relaxed::<i32>().resize::<W::Half>(), same.round_cast::<i32>().resize::<W::Half>()]), [a.saturating_cast::<u32>().resize::<W::Half>(), same.cast_relaxed::<u32>().resize::<W::Half>()])
    } => |m| [of(m, I(32), true, |x| x), of(m, I(32), false, |x| x), of(m, I(32), true, f64::round_ties_even), of(m, U(32), true, |x| x), of(m, U(32), false, |x| x)].concat();
    even_odd_to_f64 [f32 i32 u32] 8..=64, |d, a, _, _, _| [a.widen_even::<f64>(), a.widen_odd::<f64>()]
        => |m| [0, 1].map(|k| (0..m.n / 2).map(|i| F(64).of(m.t.float(m.a[2 * i + k]))).collect::<Lanes>()).concat();
    even_odd_to_signed [u8] 2..=64, |d, a, _, _, _| [a.widen_even::<i16>(), a.widen_odd::<i16>()]
        => |m| [0, 1].map(|k| (0..m.n / 2).map(|i| m.a[2 * i + k]).collect::<Lanes>()).concat();
    f16_to_f32 [u16] 0..=32, |d, a, _, _, _| a.bitcast::<f16>().cast::<f32>().resize::<W::Twice>()
        => |m| m.map1(|x| F(32).of(f16::from_bits(x as u16).to_f64()));
    f16_to_f64 [u16] 0..=16, |d, a, _, _, _| a.bitcast::<f16>().cast::<f64>().resize::<<W::Twice as Width>::Twice>()
        => |m| m.map1(|x| F(64).of(f16::from_bits(x as u16).to_f64()));
    f32_to_f16 [f32] 0..=64, |d, a, b, _, _| {
        let small = (a.bitcast::<u32>() & 0x87ff_ffffu32 | 0x3000_0000u32).bitcast::<f32>();
        let _to = d.isa().of::<u16, W>().half();
        [a.cast::<f16>().to_bits().resize::<W::Half>(), small.cast::<f16>().to_bits().resize::<W::Half>(), b.resize::<<W::Half as Width>::Twice>().cast::<bf16>().to_bits().resize::<W::Half>()]
    } => |m| [m.map1(|x| half(f16::from_f32(f32::from_bits(x as u32)))), m.map1(|x| half(f16::from_f32(f32::from_bits(x as u32 & 0x87ff_ffff | 0x3000_0000)))),
        m.b.iter().map(|&x| brain(x)).collect()].concat();
    f64_to_f16 [f64] 0..=64, |d, a, _, _, _| a.cast::<f16>().to_bits().resize::<<W::Half as Width>::Half>()
        => |m| m.map1(|x| half(f16::from_f64(f64::from_bits(x as u64))));
    bf16_pairs [f32] 0..=64, |d, a, b, _, _| {
        let _to = d.repartition::<u16>();
        ([a.narrow::<bf16>(b).to_bits(), a.narrow_even_odd::<bf16>(b).to_bits()],
         [a.bitcast::<u16>().bitcast::<bf16>().widen_even::<f32>(), a.bitcast::<u16>().bitcast::<bf16>().widen_odd::<f32>(), a.bitcast::<bf16>().split()[0].cast::<f32>().resize::<W>()])
    } => |m| [m.a.iter().chain(&m.b).map(|&x| brain(x)).collect(), m.a.iter().zip(&m.b).flat_map(|(&x, &y)| [brain(x), brain(y)]).collect(),
        m.map1(|x| x << 16 & 0xffff_0000), m.map1(|x| x & 0xffff_0000), m.each(|i| m.view(0, U(16))[i] << 16)].concat();
}
