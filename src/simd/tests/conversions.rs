#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

/// `as`, but integers saturate.
fn convert(from: Ty, to: Ty, x: i128) -> i128 {
    match (from, to) {
        (F(_), F(_)) => to.of(from.float(x)),
        (_, F(32)) => (x as f32).to_bits() as _,
        (_, F(_)) => (x as f64).to_bits() as _,
        (F(_), _) => to.clamp(from.float(x) as i128),
        _ => to.clamp(x),
    }
}
fn from(m: &Model, i: usize, ty: Ty, lanes: usize) -> Lanes {
    m.view(i, ty)[..lanes].iter().map(|&x| convert(ty, m.t, x)).collect()
}
fn to(m: &Model, lanes: &[i128], ty: Ty) -> Lanes {
    lanes.iter().map(|&x| convert(m.t, ty, x)).collect()
}
fn in_range(x: f64) -> i128 {
    if x > -2147483649.0 && x < 2147483648.0 { x as i128 } else { ANY }
}

// The inputs have the type of the case, so that edge values are theirs.
macro_rules! pairs { ($($name:ident $op:ident $from:ident $to:ident $bytes:expr;)*) => { cases! {$(
    $name [$from] $bytes, |d, a, _, _, _| a.$op::<$to>() => |m| to(m, &m.a, <$to>::TY);
)*} }; }

pairs! {
    promote_u8_u16 cast u8 u16 0..=32; promote_u8_i16 cast u8 i16 0..=32; promote_u8_u32 cast u8 u32 0..=16;
    promote_u8_u64 cast u8 u64 0..=8; promote_i8_i16 cast i8 i16 0..=32; promote_i8_i32 cast i8 i32 0..=16;
    promote_u16_u32 cast u16 u32 0..=32; promote_i16_i32 cast i16 i32 0..=32; promote_i16_i64 cast i16 i64 0..=16;
    promote_u32_u64 cast u32 u64 0..=32; promote_i32_i64 cast i32 i64 0..=32; promote_f32_f64 cast f32 f64 0..=32;
    promote_i32_f64 cast i32 f64 0..=32; promote_u32_f64 cast u32 f64 0..=32; promote_u8_f32 cast u8 f32 0..=16;
    promote_f32_i64 cast f32 i64 0..=32;
    demote_i16_u8 saturating_cast i16 u8 4..=64; demote_i16_i8 saturating_cast i16 i8 4..=64; demote_u16_u8 saturating_cast u16 u8 4..=64;
    demote_u16_i8 saturating_cast u16 i8 4..=64; demote_i32_u16 saturating_cast i32 u16 0..=64; demote_i32_i16 saturating_cast i32 i16 0..=64;
    demote_i32_u8 saturating_cast i32 u8 8..=64; demote_i32_i8 saturating_cast i32 i8 8..=64; demote_u32_u16 saturating_cast u32 u16 0..=64;
    demote_u32_u8 saturating_cast u32 u8 8..=64; demote_i64_i32 saturating_cast i64 i32 0..=64; demote_i64_u32 saturating_cast i64 u32 0..=64;
    demote_u64_u32 saturating_cast u64 u32 0..=64; demote_i64_u8 saturating_cast i64 u8 16..=64; demote_f64_f32 saturating_cast f64 f32 0..=64;
    demote_f64_i32 saturating_cast f64 i32 0..=64; demote_i64_f32 saturating_cast i64 f32 0..=64;
}

macro_rules! two { ($($name:ident $from:ident $to:ident;)*) => { cases! {$(
    $name [$from] 0..=64, |d, a, b, _, _| { [a.saturating_narrow::<$to>(b), a.in_blocks().saturating_narrow::<$to>(b), a.wrapping_narrow::<$to>(b)] }
        => |m| {
            let by_block: Lanes = m.a.chunks(m.block).zip(m.b.chunks(m.block)).flat_map(|(a, b)| [a, b].concat()).collect();
            [to(m, &[&m.a[..], &m.b].concat(), <$to>::TY), to(m, &by_block, <$to>::TY), m.a.clone(), m.b.clone()].concat()
        };
)*} }; }
two! {
    demote2_i16_u8 i16 u8; demote2_i16_i8 i16 i8; demote2_u16_u8 u16 u8; demote2_u16_i8 u16 i8; demote2_i32_u16 i32 u16;
    demote2_i32_i16 i32 i16; demote2_u32_u16 u32 u16; demote2_i64_i32 i64 i32; demote2_i64_u32 i64 u32; demote2_u64_u32 u64 u32;
    demote2_u32_i16 u32 i16; demote2_u64_i32 u64 i32;
}

cases! {
    promote_halves [u8 i8 u16 i16 u32 i32] 2 * LANE + 1 / LANE * 2..=64, |d, a, _, _, _|
        { [a.widen::<<T as Int>::Wide>()[0], a.widen::<<T as Int>::Wide>()[1]] } => |m| m.a.clone();
    promote_halves_f32 [f32] 8..=64, |d, a, _, _, _| { [a.widen::<f64>()[0], a.widen::<f64>()[1]] }
        => |m| to(m, &m.a, F(64));
    promote_even_odd [u16 i16 u32 i32 u64 i64] 0..=64, |d, a, _, _, _| [a.bitcast::<<T as Int>::Narrow>().widen_even::<T>(), a.bitcast::<<T as Int>::Narrow>().widen_odd::<T>()]
        => |m| [0, 1].map(|k| m.each(|i| m.view(0, m.t.narrow())[2 * i + k])).concat();
    truncate_to [u8 i16 u32] 0..=32, |d, _, _, _, io| io.load(d.rebind::<<<T as Lane>::Unsigned as Int>::Wide>(), 0).cast::<T>().resize::<W>()
        => |m| m.view(0, U(2 * m.t.bits()))[..m.n].to_vec();
    truncate_u32_u8 [u8] 0..=16, |d, _, _, _, io| io.load(d.rebind::<u32>(), 0).cast::<u8>().resize::<W>() => |m| m.view(0, U(32))[..m.n].to_vec();
    convert_from_float float 0..=64, |d, a, _, _, _| (a.cast::<<T as Lane>::Signed>(), a.cast::<<T as Lane>::Unsigned>())
        => |m| [to(m, &m.a, I(m.t.bits())), to(m, &m.a, U(m.t.bits()))].concat();
    convert_to_float float 0..=64, |d, a, _, _, _| [a.cast_signed().cast::<T>(), a.cast_unsigned().cast::<T>()]
        => |m| [from(m, 0, I(m.t.bits()), m.n), from(m, 0, U(m.t.bits()), m.n)].concat();
    in_range_f32 [f32] 0..=64, |d, a, _, _, _| [a.cast_relaxed::<i32>(), a.round_cast_relaxed::<i32>()]
        => |m| [m.map1(|x| in_range(m.t.float(x))), m.map1(|x| in_range(m.t.float(x).round_ties_even()))].concat();
    in_range_f64 [f64] 0..=64, |d, a, _, _, _| { a.resize::<<W::Half as Width>::Twice>().cast_relaxed::<i32>().resize::<W::Half>() }
        => |m| m.map1(|x| in_range(m.t.float(x)));
    bitcast sizes 8..=64, |d, a, _, _, _| (a.bitcast::<u8>(), a.bitcast::<u64>())
        => |m| [&m.view(0, U(8))[..m.bytes], &m.view(0, U(64))[..m.bytes / 8]].concat();
    resize_bitcast sizes 0..=64, |d, a, _, _, _| (a.bitcast::<u16>().resize::<B2>(), a.bitcast::<u8>().resize::<B32>())
        => |m| [vec![m.view(0, U(16))[0]], (0..32).map(|i| if i < m.bytes { m.view(0, U(8))[i] } else { 0 }).collect()].concat();
    tags [u16] 4..=32, |d, _, _, _, _| [d.half().lanes(), d.twice().lanes(), d.rebind::<u8>().lanes(), d.repartition::<u32>().lanes(),
        d.isa().upto::<u8, B32>().lanes(), d.isa().upto::<u8, B8>().lanes(), d.isa().native::<u8>().lanes()]
        => |m| {
            #[allow(unused)]
            let best = if m.has("avx512f") && !m.target.has_word("narrow") { 64 } else if m.has("avx2") { 32 } else { 16 };
            let full = cfg_select! { bun_simd_native = "16" => 16, bun_simd_native = "32" => 32, bun_simd_native = "64" => 64, _ => best };
            [m.n / 2, m.n * 2, m.n, m.n / 2, full.min(32), 8, full].map(|it| it as i128).to_vec()
        };
}
