#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{math::*, *};
use framework::*;

fn sums(m: &Model, k: usize, f: impl Fn(usize) -> i128) -> Lanes {
    m.each(f).chunks(k).map(|it| it.iter().sum()).collect()
}
/// The products of the lanes `2 * i + odd`.
fn products(m: &Model, odd: usize) -> Lanes {
    let all = (0..m.n / 2).map(|i| m.a[2 * i + odd].wrapping_mul(m.b[2 * i + odd]));
    if m.t.bits() == 64 { all.flat_map(|it| [it & u64::MAX as i128, it >> 64]).collect() } else { all.collect() }
}
fn quad(a: &[i128], b: &[i128]) -> i128 {
    (0..4).map(|k| (a[k] - b[k]).abs()).sum()
}
fn adjacent(m: &Model, a: usize, b: usize) -> Lanes {
    (0..m.n / 2).map(|i| quad(&m.a[a * 4 + i / 8 * 16 + i % 8..], &m.b[b * 4 + i / 8 * 16..])).collect()
}

cases! {
    mul_high_all int 0..=64, |d, a, b, _, _| a.mul_high(b) => |m| m.map2(|x, y| x.wrapping_mul(y) >> m.t.bits());
    mul_even_all int 2 * LANE..=64, |d, a, b, _, _| a.widening_mul_even(b) => |m| products(m, 0);
    mul_odd_all int 2 * LANE..=64, |d, a, b, _, _| a.widening_mul_odd(b) => |m| products(m, 1);
    mul_add52 [u64] 0..=64, |d, a, b, c, _| (a.mul52_low_add(b, c), a.mul52_high_add(b, c)) => |m| {
        let half = |i: usize, shift: u32| m.c[i] + ((m.a[i] % (1 << 52) * (m.b[i] % (1 << 52))) >> shift) % (1 << 52);
        [m.each(|i| half(i, 0)), m.each(|i| half(i, 52))].concat()
    };
    mul_even_odd [u32] 8..=64, |d, a, b, _, _| a.widening_mul_even_odd(b) => |m| (0..m.n / 2).map(|i| m.a[2 * i] * m.b[2 * i + 1]).collect();
    mul_lower_halves [u32] 8..=64, |d, a, b, c, _| (a.widening_mul_even(b) << 32) ^ (a.widening_mul_odd(c) & 0xffff_ffff_u64) ^ (b.widening_mul_even_odd(c) << 40)
        => |m| (0..m.n / 2).map(|i| ((m.a[2 * i] * m.b[2 * i]) << 32 ^ (m.a[2 * i + 1] * m.c[2 * i + 1]) & 0xffff_ffff ^ (m.b[2 * i] * m.c[2 * i + 1]) << 40) & u64::MAX as i128).collect();
    mul_lower_halves_signed [i32] 8..=64, |d, a, b, _, _| a.widening_mul_even(b) << 32 >> 32 => |m| (0..m.n / 2).map(|i| (m.a[2 * i] * m.b[2 * i]) as i32 as i128).collect();
    div_int int 0..=64, |d, a, b, _, _| a / b => |m| m.map2(|x, y| x.checked_div(y).unwrap_or(0));
    rem int 0..=64, |d, a, b, _, _| { let mut v = a; v %= b; v } => |m| m.map2(|x, y| x.checked_rem(y).unwrap_or(x));
    divisor int 0..=64, |d, a, b, _, _| {
        let by = if b[0] == 0 { 1 } else { b[0] };
        [a / Divisor::new(by).unwrap(), a % by]
    } => |m| {
        let by = if m.b[0] == 0 { 1 } else { m.b[0] };
        [m.map1(|x| x / by), m.map1(|x| x % by)].concat()
    };
    pairwise [u8 u16 u32 i8 i16 i32] 2 * LANE..=64, |d, a, b, _, _| a.dot::<<T as Int>::Wide>(b) => |m| sums(m, 2, |i| m.a[i] * m.b[i]);
    reorder [u8 u16 i8 i16] 2 * LANE..=64, |d, a, b, c, _| {
        let mut sums = PairSums::default();
        sums.mul_add(a, b);
        sums.mul_add(c, b);
        sums.total()
    } => |m| sums(m, 2, |i| (m.a[i] + m.c[i]) * m.b[i]);
    quad_16 [u16 i16] 8..=64, |d, a, b, c, _| a.dot_add::<<<T as Int>::Wide as Int>::Wide>(b, c.bitcast())
        => |m| sums(m, 4, |i| m.a[i] * m.b[i]).iter().zip(m.view(2, I(64))).map(|(x, y)| x + y).collect();
    sums_of_4_all [u8 i8 u16 i16] 4 * LANE..=64, |d, a, _, _, _| a.sum_groups::<<<T as Int>::Wide as Int>::Wide>() => |m| sums(m, 4, |i| m.a[i]);
    sums_of_8_i8 [i8] 8..=64, |d, a, b, _, _| (a.sum_groups::<i64>(), a.abs_diff_sum::<i64>(b))
        => |m| [sums(m, 8, |i| m.a[i]), sums(m, 8, |i| (m.a[i] - m.b[i]).abs())].concat();
    sums_of_2_f32 [f32] 8..=64, |d, a, _, _, _| a.sum_groups::<f64>()
        => |m| m.a.chunks(2).map(|it| F(64).of(m.t.float(it[0]) + m.t.float(it[1]))).collect();
    average_all int 0..=64, |d, a, b, _, _| a.midpoint_up(b) => |m| m.map2(|x, y| (x + y + 1) >> 1);
    rounding_shr int 0..=64, |d, a, b, _, _| a.rounding_shr(b & (T::BITS - 1) as T) => |m| m.map2(|x, y| {
        let count = y as u32 % m.t.bits();
        if count == 0 { x } else { ((x >> (count - 1)) + 1) >> 1 }
    });
    rounding_shift_by_0 int 0..=64, |d, a, _, _, _| a.rounding_shr(0) => |m| m.a.clone();
    sat_pairwise [i16] 4..=64, |d, a, b, c, _| a.saturating_dot_add(b, c.bitcast())
        => |m| sums(m, 2, |i| m.a[i] * m.b[i]).iter().zip(m.view(2, I(32))).map(|(x, y)| I(32).clamp(x + y)).collect();
    sat_fixed_point [i32] 4..=64, |d, _, _, c, io| {
        let half = d.repartition::<i16>().half();
        io.load(half, 0).cast_mul_q15_add(io.load(half, 1), c.resize())
    } => |m| m.each(|i| m.t.clamp(m.c[i] + m.t.clamp(2 * m.view(0, I(16))[i] * m.view(1, I(16))[i])));
    adjacent_quads [u8 i8] 16..=64, |d, a, b, _, _| [
        a.in_blocks().sliding_abs_diff_sum::<0, 0>(b), a.in_blocks().sliding_abs_diff_sum::<1, 2>(b),
        a.in_blocks().sliding_abs_diff_sum::<0, 3>(b), a.in_blocks().sliding_abs_diff_sum::<1, 3>(b),
    ] => |m| [adjacent(m, 0, 0), adjacent(m, 1, 2), adjacent(m, 0, 3), adjacent(m, 1, 3)].concat();
    shuffled_quads [u8 i8] 16..=64, |d, a, b, _, _| a.in_blocks().shuffled_abs_diff_sum::<0b01_11_00_10>(b) => |m| {
        let a = m.each(|i| m.a[i / 16 * 16 + [2, 0, 3, 1][i / 4 % 4] * 4 + i % 4]);
        (0..m.n / 2).map(|i| quad(&a[i / 4 * 8 + i % 4..], &m.b[i / 2 * 4..])).collect()
    };
}
