#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{target::*, *};
use framework::*;

fn convert(from: Ty, to: Ty, x: i128, saturate: bool) -> i128 {
    match (from, to) {
        (F(_), F(_)) => to.of(from.float(x)),
        (_, F(32)) => (x as f32).to_bits() as _,
        (_, F(_)) => (x as f64).to_bits() as _,
        (F(_), _) => to.clamp(from.float(x) as i128),
        _ if saturate => to.clamp(x),
        _ => to.wrap(x),
    }
}
fn to(m: &Model, lanes: &[i128], ty: Ty, saturate: bool) -> Lanes {
    lanes.iter().map(|&x| convert(m.t, ty, x, saturate)).collect()
}
fn within(to: Ty, x: f64) -> i128 {
    if x.is_nan() || x as i128 != to.clamp(x as i128) { ANY } else { x as i128 }
}

macro_rules! pairs { ($($name:ident $from:ident $to:ident $bytes:expr;)*) => { cases! {$(
    $name [$from] $bytes, |d, a, _, _, _| [a.cast::<$to>(), a.saturating_cast::<$to>()]
        => |m| [to(m, &m.a, <$to>::TY, false), to(m, &m.a, <$to>::TY, true)].concat();
)*} }; }
pairs! {
    cast_u8_u8 u8 u8 2..=64;
    cast_u8_u16 u8 u16 1..=32;
    cast_u8_u32 u8 u32 1..=16;
    cast_u8_u64 u8 u64 1..=8;
    cast_u8_i8 u8 i8 2..=64;
    cast_u8_i16 u8 i16 1..=32;
    cast_u8_i32 u8 i32 1..=16;
    cast_u8_i64 u8 i64 1..=8;
    cast_u8_f32 u8 f32 1..=16;
    cast_u8_f64 u8 f64 1..=8;
    cast_u16_u8 u16 u8 4..=64;
    cast_u16_u16 u16 u16 2..=64;
    cast_u16_u32 u16 u32 2..=32;
    cast_u16_u64 u16 u64 2..=16;
    cast_u16_i8 u16 i8 4..=64;
    cast_u16_i16 u16 i16 2..=64;
    cast_u16_i32 u16 i32 2..=32;
    cast_u16_i64 u16 i64 2..=16;
    cast_u16_f32 u16 f32 2..=32;
    cast_u16_f64 u16 f64 2..=16;
    cast_u32_u8 u32 u8 8..=64;
    cast_u32_u16 u32 u16 4..=64;
    cast_u32_u32 u32 u32 4..=64;
    cast_u32_u64 u32 u64 4..=32;
    cast_u32_i8 u32 i8 8..=64;
    cast_u32_i16 u32 i16 4..=64;
    cast_u32_i32 u32 i32 4..=64;
    cast_u32_i64 u32 i64 4..=32;
    cast_u32_f32 u32 f32 4..=64;
    cast_u32_f64 u32 f64 4..=32;
    cast_u64_u8 u64 u8 16..=64;
    cast_u64_u16 u64 u16 8..=64;
    cast_u64_u32 u64 u32 8..=64;
    cast_u64_u64 u64 u64 8..=64;
    cast_u64_i8 u64 i8 16..=64;
    cast_u64_i16 u64 i16 8..=64;
    cast_u64_i32 u64 i32 8..=64;
    cast_u64_i64 u64 i64 8..=64;
    cast_u64_f32 u64 f32 8..=64;
    cast_u64_f64 u64 f64 8..=64;
    cast_i8_u8 i8 u8 2..=64;
    cast_i8_u16 i8 u16 1..=32;
    cast_i8_u32 i8 u32 1..=16;
    cast_i8_u64 i8 u64 1..=8;
    cast_i8_i8 i8 i8 2..=64;
    cast_i8_i16 i8 i16 1..=32;
    cast_i8_i32 i8 i32 1..=16;
    cast_i8_i64 i8 i64 1..=8;
    cast_i8_f32 i8 f32 1..=16;
    cast_i8_f64 i8 f64 1..=8;
    cast_i16_u8 i16 u8 4..=64;
    cast_i16_u16 i16 u16 2..=64;
    cast_i16_u32 i16 u32 2..=32;
    cast_i16_u64 i16 u64 2..=16;
    cast_i16_i8 i16 i8 4..=64;
    cast_i16_i16 i16 i16 2..=64;
    cast_i16_i32 i16 i32 2..=32;
    cast_i16_i64 i16 i64 2..=16;
    cast_i16_f32 i16 f32 2..=32;
    cast_i16_f64 i16 f64 2..=16;
    cast_i32_u8 i32 u8 8..=64;
    cast_i32_u16 i32 u16 4..=64;
    cast_i32_u32 i32 u32 4..=64;
    cast_i32_u64 i32 u64 4..=32;
    cast_i32_i8 i32 i8 8..=64;
    cast_i32_i16 i32 i16 4..=64;
    cast_i32_i32 i32 i32 4..=64;
    cast_i32_i64 i32 i64 4..=32;
    cast_i32_f32 i32 f32 4..=64;
    cast_i32_f64 i32 f64 4..=32;
    cast_i64_u8 i64 u8 16..=64;
    cast_i64_u16 i64 u16 8..=64;
    cast_i64_u32 i64 u32 8..=64;
    cast_i64_u64 i64 u64 8..=64;
    cast_i64_i8 i64 i8 16..=64;
    cast_i64_i16 i64 i16 8..=64;
    cast_i64_i32 i64 i32 8..=64;
    cast_i64_i64 i64 i64 8..=64;
    cast_i64_f32 i64 f32 8..=64;
    cast_i64_f64 i64 f64 8..=64;
    cast_f32_u8 f32 u8 8..=64;
    cast_f32_u16 f32 u16 4..=64;
    cast_f32_u32 f32 u32 4..=64;
    cast_f32_u64 f32 u64 4..=32;
    cast_f32_i8 f32 i8 8..=64;
    cast_f32_i16 f32 i16 4..=64;
    cast_f32_i32 f32 i32 4..=64;
    cast_f32_i64 f32 i64 4..=32;
    cast_f32_f32 f32 f32 4..=64;
    cast_f32_f64 f32 f64 4..=32;
    cast_f64_u8 f64 u8 16..=64;
    cast_f64_u16 f64 u16 8..=64;
    cast_f64_u32 f64 u32 8..=64;
    cast_f64_u64 f64 u64 8..=64;
    cast_f64_i8 f64 i8 16..=64;
    cast_f64_i16 f64 i16 8..=64;
    cast_f64_i32 f64 i32 8..=64;
    cast_f64_i64 f64 i64 8..=64;
    cast_f64_f32 f64 f32 8..=64;
    cast_f64_f64 f64 f64 8..=64;
}

macro_rules! rounding { ($($name:ident $from:ident $to:ident $bytes:expr;)*) => { cases! {$(
    $name [$from] $bytes, |d, a, b, _, _| { let big = a * b * b; [a.round_cast::<$to>(), big.round_cast::<$to>(), a.round_cast_relaxed::<$to>(), a.cast_relaxed::<$to>()] }
        => |m| {
            let (t, u) = (m.t, <$to>::TY);
            let big = m.map2(|x, y| t.of(t.float(t.of(t.float(x) * t.float(y))) * t.float(y)));
            let round = |x: i128| t.float(x).round_ties_even();
            [m.map1(|x| u.clamp(round(x) as i128)), big.iter().map(|&x| u.clamp(round(x) as i128)).collect(),
                m.map1(|x| if u.bits() < t.bits().min(32) && !t.is_nan(x) { u.clamp(round(x) as i128) } else { within(u, round(x)) }),
                m.map1(|x| within(u, t.float(x)))].concat()
        };
)*} }; }
rounding! {
    round_f32_u8 f32 u8 8..=64;
    round_f32_u16 f32 u16 4..=64;
    round_f32_u32 f32 u32 4..=64;
    round_f32_u64 f32 u64 4..=32;
    round_f32_i8 f32 i8 8..=64;
    round_f32_i16 f32 i16 4..=64;
    round_f32_i32 f32 i32 4..=64;
    round_f32_i64 f32 i64 4..=32;
    round_f64_u8 f64 u8 16..=64;
    round_f64_u16 f64 u16 8..=64;
    round_f64_u32 f64 u32 8..=64;
    round_f64_u64 f64 u64 8..=64;
    round_f64_i8 f64 i8 16..=64;
    round_f64_i16 f64 i16 8..=64;
    round_f64_i32 f64 i32 8..=64;
    round_f64_i64 f64 i64 8..=64;
}

macro_rules! doubles { ($($name:ident $from:ident $to:ident;)*) => { cases! {$(
    $name [$from] 2 * LANE + 1 / LANE * 2..=64, |d, a, _, _, _| (a.widen::<$to>(), [a.widen_even::<$to>(), a.widen_odd::<$to>()]) => |m| {
        let all = to(m, &m.a, <$to>::TY, false);
        [all.clone(), all.iter().step_by(2).copied().collect(), all[1..].iter().step_by(2).copied().collect()].concat()
    };
)*} }; }
doubles! {
    widen_u8_u16 u8 u16; widen_u8_i16 u8 i16; widen_i8_i16 i8 i16; widen_i8_u16 i8 u16; widen_u16_u32 u16 u32; widen_i16_i32 i16 i32; widen_u16_f32 u16 f32;
    widen_i16_f32 i16 f32; widen_u32_u64 u32 u64; widen_i32_i64 i32 i64; widen_i32_f64 i32 f64; widen_f32_f64 f32 f64; widen_f32_i64 f32 i64;
}

cases! {
    widen_in_blocks [u8 i8 u16 i16 u32 i32] 2 * LANE + 1 / LANE * 2..=64, |d, a, _, _, _| a.in_blocks().widen::<<T as Int>::Wide>()
        => |m| [0, 1].map(|k| m.a.chunks(m.block).flat_map(|it| it[k * m.block / 2..][..m.block / 2].to_vec()).collect::<Lanes>()).concat();
    narrow [u16 i16 u32 i32 u64 i64] 0..=64, |d, a, b, _, _| {
        type N = <T as Int>::Narrow;
        [a.saturating_narrow::<N>(b), a.in_blocks().saturating_narrow::<N>(b), a.wrapping_narrow::<N>(b)]
    } => |m| {
        let by_block: Lanes = m.a.chunks(m.block).zip(m.b.chunks(m.block)).flat_map(|(a, b)| [a, b].concat()).collect();
        [to(m, &[&m.a[..], &m.b].concat(), m.t.narrow(), true), to(m, &by_block, m.t.narrow(), true), m.a.clone(), m.b.clone()].concat()
    };
    split sizes 2 * LANE + 1 / LANE * 2..=64, |d, a, _, _, _| { let [lo, hi] = a.split(); ([lo, hi], d.isa().from_halves::<T, W>([hi, lo])) }
        => |m| [&m.a[..], &m.a[m.n / 2..], &m.a[..m.n / 2]].concat();
    concat sizes 0..=32, |d, a, b, _, _| a.concat(b) => |m| [&m.a[..], &m.b].concat();
    parts sizes 8..=64, |d, a, _, _, io| {
        let (all, mut to) = (io.slice::<T>(), vec![]);
        a.for_each_part(#[inline(always)] |i, part: Simd<T, B8, _>| { to.push(T::from_usize(i)); to.extend(part.to_array()) });
        let (short, whole) = (d.repartition::<T>().isa().of::<T, B8>(), d.isa().from_parts::<T, W, W>(#[inline(always)] |_| a));
        ([d.isa().from_parts::<T, W, B8>(#[inline(always)] |i| short.load(&all[3 * i..])), whole], to)
    } => |m| {
        let (n, index) = (8 / m.t.size(), |i: usize| if let F(_) = m.t { m.t.of(i as f64) } else { i as i128 });
        [m.each(|i| m.slice()[i / n * 3 + i % n]), m.a.clone(), m.a.chunks(n).enumerate().flat_map(|(i, it)| [&[index(i)], it].concat()).collect()].concat()
    };
    resize sizes 0..=64, |d, a, _, _, _| (a.resize::<B8>(), a.resize::<B64>())
        => |m| [8, 64].map(|bytes| (0..bytes / m.t.size()).map(|i| *m.a.get(i).unwrap_or(&0)).collect::<Lanes>()).concat();
    blocks sizes 32..=64, |d, a, b, _, _| (a.block::<1>(), a.with_block::<1>(b.block::<0>()))
        => |m| [m.a[m.block..][..m.block].to_vec(), m.each(|i| if i / m.block == 1 { m.b[i % m.block] } else { m.a[i] })].concat();
    signs all 0..=64, |d, a, _, _, _| (a.cast_signed(), a.cast_unsigned()) => |m| [m.a.clone(), m.a.clone()].concat();
    brain [f32] 0..=64, |d, a, b, _, _| {
        let (a, b) = (a & f32::from_bits(0xbfff_0000), b & f32::from_bits(0xbfff_0000));
        let pairs = a.narrow_even_odd::<bf16>(b).to_bits();
        (([pairs.bitcast::<bf16>().widen_even::<f32>(), pairs.bitcast::<bf16>().widen_odd::<f32>()], a.cast::<bf16>().to_bits().bitcast::<bf16>().cast::<f32>()), a.narrow::<bf16>(b).to_bits())
    } => |m| {
        let (a, b): (Lanes, Lanes) = (m.map1(|x| x & 0xbfff_0000), m.b.iter().map(|x| x & 0xbfff_0000).collect());
        [a.clone(), b.clone(), a.clone(), a.iter().chain(&b).map(|x| x >> 16).collect()].concat()
    };
    ieee [u16] 0..=16, |d, a, _, _, _| { let a = a & 0xbfff; (a.bitcast::<half>().cast::<f32>().cast::<half>().to_bits(), a.bitcast::<half>().cast::<f64>().cast::<half>().to_bits()) }
        => |m| [m.map1(|x| x & 0xbfff), m.map1(|x| x & 0xbfff)].concat();
}

#[test]
fn from_is_lossless() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        let bytes = u8x4::from([1, 2, 200, 255]);
        assert_eq!(i16x4::from(bytes).to_array(), [1, 2, 200, 255]);
        assert_eq!(f32x4::from(bytes).to_array(), [1.0, 2.0, 200.0, 255.0]);
        let wide: u64x4<S> = bytes.into();
        assert_eq!(<[u64; 4]>::from(wide), [1, 2, 200, 255]);
        assert_eq!(f64x2::from(f32x2::from([0.5, -1.0])).to_array(), [0.5, -1.0]);
        assert_eq!(u8x4::from(bytes).to_array(), bytes.to_array());
    }
    on::<bun_simd::target::Baseline>()
}

#[test]
fn constants() {
    fn of<T: Lane>() -> (T, T, T, T, bool, bool) {
        (T::ZERO, T::ONE, T::from_i64(-1), T::from_f64(2.5), T::IS_FLOAT, T::IS_SIGNED)
    }
    assert_eq!(of::<u8>(), (0, 1, 255, 2, false, false));
    assert_eq!(of::<i32>(), (0, 1, -1, 2, false, true));
    assert_eq!(of::<f64>(), (0.0, 1.0, -1.0, 2.5, true, true));
}

/// Needs no bound but `Int`.
#[test]
fn generic() {
    fn twice<S: Isa, T: Int, W: Width>(v: Simd<T, W, S>) -> Simd<T, W, S> {
        let [lo, hi] = v.widen::<T::Wide>();
        let halves = v.bitcast::<T::Wide>().wrapping_narrow::<T>(v.bitcast());
        let _: Simd<f32, Scaled<T, f32, W>, S> = halves.cast();
        (lo + lo).saturating_narrow(hi + hi)
    }
    fn widens<T: Widens<U>, U>() {}
    widens::<u8, i16>();
    assert_eq!(twice(Portable::new().from::<u8, B4>([1, 2, 200, 255])).to_array(), [2, 4, 255, 255]);
}
