#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{math::*, target::*, *};
use framework::*;

/// Sums of `k` adjacent values.
fn sums(m: &Model, k: usize, f: impl Fn(usize) -> i128) -> Lanes {
    m.each(f).chunks(k).map(|it| it.iter().sum()).collect()
}
fn dot(m: &Model, b: Ty) -> Lanes {
    let (b, c) = (m.view(1, b), m.view(2, I(32)));
    sums(m, 4, |i| m.a[i] * b[i]).iter().zip(c).map(|(x, y)| x + y).collect()
}
fn clmul(m: &Model, lane: usize) -> Lanes {
    m.blocks(|a, b, j| {
        (0..64).fold(0u128, |all, bit| all ^ ((b[lane] >> bit & 1) as u128 * ((a[lane] as u128) << bit))) as i128
            >> (64 * j)
    })
}
fn crc(polynomial: u64, crc: u64, data: u64, bits: u32) -> i128 {
    let mut crc = crc as u32;
    for byte in &data.to_le_bytes()[..bits as usize / 8] {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 == 1 { crc >> 1 ^ polynomial as u32 } else { crc >> 1 }
        }
    }
    crc as _
}

cases! {
    sums_of_2 [u8 u16 u32 i8 i16 i32] 2 * LANE..=64, |d, a, _, _, _| a.sum_groups::<<T as Int>::Wide>() => |m| sums(m, 2, |i| m.a[i]);
    sums_of_4 [u8] 4..=64, |d, a, _, _, _| a.sum_groups::<u32>() => |m| sums(m, 4, |i| m.a[i]);
    sums_of_8 [u8] 8..=64, |d, a, _, _, _| a.sum_groups::<u64>() => |m| sums(m, 8, |i| m.a[i]);
    sums_of_8_abs_diff [u8] 8..=64, |d, a, b, _, _| a.abs_diff_sum::<u64>(b) => |m| sums(m, 8, |i| (m.a[i] - m.b[i]).abs());
    sat_widen_mul_pairwise_add [u8] 0..=64, |d, a, b, _, _| a.saturating_dot(b.bitcast())
        => |m| sums(m, 2, |i| m.a[i] * I(8).wrap(m.b[i])).into_iter().map(|x| I(16).clamp(x)).collect();
    sum_of_mul_quad_accumulate [u8 i8] 4..=64, |d, a, b, c, _| a.dot_add::<<<T as Int>::Wide as Int>::Wide>(b, c.bitcast()) => |m| dot(m, m.t);
    sum_of_mul_quad_accumulate_i8 [u8] 4..=64, |d, a, b, c, _| a.dot_add::<i32>(b.bitcast(), c.bitcast())
        => |m| dot(m, I(8));
    widen_mul_pairwise_add [i16] 4..=64, |d, a, b, _, _| a.dot::<i32>(b) => |m| sums(m, 2, |i| m.a[i] * m.b[i]);
    mul_fixed_point_15 [i16] 0..=64, |d, a, b, _, _| a.mul_q15_relaxed(b)
        => |m| m.map2(|x, y| if x == -32768 && y == x { ANY } else { (x * y + 0x4000) >> 15 });
    mul_high [i16 u16] 0..=64, |d, a, b, _, _| a.mul_high(b) => |m| m.map2(|x, y| (x * y) >> 16);
    mul_even [i32 u32] 8..=64, |d, a, b, _, _| a.widening_mul_even(b) => |m| sums(m, 2, |i| if i % 2 == 0 { m.a[i] * m.b[i] } else { 0 });
    clmul_lower [u64] 0..=64, |d, a, b, _, _| a.carryless_mul_even(b) => |m| clmul(m, 0);
    clmul_upper [u64] 16..=64, |d, a, b, _, _| a.carryless_mul_odd(b) => |m| clmul(m, 1);
    widen_mul_accumulate [u8 u16 u32 i8 i16 i32] 2 * LANE + 1 / LANE * 2..=64, |d, a, b, c, _|
        a.widening_mul_add(b, [c.bitcast(), (!c).bitcast()]) => |m| {
            let c = m.view(2, m.t.wide());
            m.each(|i| m.a[i] * m.b[i] + if i < m.n / 2 { c[i] } else { !c[i - m.n / 2] })
        };
    widen_mul [u16 u32 u64 i16 i32 i64] 4..=64, |d, _, _, _, io| {
        let half = d.repartition::<<T as Int>::Narrow>().half();
        io.load(half, 0).cast_mul::<T>(io.load(half, 1)).resize::<W>()
    } => |m| m.each(|i| m.view(0, m.t.narrow())[i] * m.view(1, m.t.narrow())[i]);
    reorder_widen_mul_accumulate [i16] 4..=64, |d, a, b, c, _| {
        let mut sums = PairSums::default();
        sums.mul_add(a, b);
        sums.mul_add(c, b);
        sums.total()
    } => |m| sums(m, 2, |i| (m.a[i] + m.c[i]) * m.b[i]);
    zip [u8 u16 u32 i8 i16 i32] 2 * LANE..=64, |d, a, b, _, _| [a.in_blocks().interleave(b)[0].bitcast::<<T as Int>::Wide>(), a.in_blocks().interleave(b)[1].bitcast::<<T as Int>::Wide>()] => |m| [0, m.block / 2].map(|from| {
        (0..m.n / 2).map(|i| {
            let at = i / (m.block / 2) * m.block + from + i % (m.block / 2);
            m.t.unsigned(m.a[at]) | m.b[at] << m.t.bits()
        }).collect::<Lanes>()
    }).concat();
    crc32 [u64] 16..=16, |d, a, _, _, io| {
        let (s, crc, data) = (d.isa(), io.n as u32, a[0]);
        [s.crc32(crc, data as u8), s.crc32(crc, data as u16), s.crc32(crc, data as u32), s.crc32(crc, data),
            s.crc32c(crc, data as u8), s.crc32c(crc, data as u16), s.crc32c(crc, data as u32), s.crc32c(crc, data)]
    } => |m| [0xedb88320, 0x82f63b78].map(|p| [8, 16, 32, 64].map(|bits| crc(p, m.io.n, m.a[0] as u64, bits))).concat();
}

#[test]
fn target_has() {
    assert!(!Target::Portable.has("avx2") && !Target::ALL.iter().any(|t| t.has("avx2") && t.has("neon")));
    assert!(Target::ALL.iter().all(|t| t.features().iter().all(|f| t.has(f))));
}
