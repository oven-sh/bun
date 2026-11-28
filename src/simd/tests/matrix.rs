#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn mat_mul(m: &Model, b: Ty) -> Lanes {
    let (b, c) = (m.view(1, b), m.view(2, I(32)));
    (0..m.n / 4)
        .map(|i| c[i] + (0..8).map(|k| m.a[i / 2 * 8 + k] * b[i / 4 * 16 + i % 2 * 8 + k]).sum::<i128>())
        .collect()
}
fn dot(m: &Model, unspecified: impl Fn(i128, i128) -> bool) -> Lanes {
    let (b, c) = (m.view(1, I(8)), m.view(2, I(32)));
    let quad = |i: usize| (4 * i..4 * i + 4).map(|k| (m.a[k], b[k]));
    (0..m.n / 4)
        .map(|i| {
            if quad(i).any(|(x, y)| unspecified(x, y)) { ANY } else { c[i] + quad(i).map(|(x, y)| x * y).sum::<i128>() }
        })
        .collect()
}
fn small(m: &Model, most: i128, count: usize) -> Lanes {
    let c = m.view(2, U(8 * count as u32));
    let pair = |k: usize| m.a[k] * m.b[k].min(most) + m.a[k + 1] * m.b[k + 1].min(most);
    let pairs = |i: usize| (count * i..count * (i + 1)).step_by(2).map(pair);
    (0..m.n / count).map(|i| if pairs(i).any(|it| it >= 32768) { ANY } else { c[i] + pairs(i).sum::<i128>() }).collect()
}

cases! {
    interleave4 [u8 u16 u32 u64 f32] 2 * LANE..=64, |d, a, b, c, io| a.interleave4(b, c, io.load(d, 3)) => |m| {
        let all = [m.view(0, m.t), m.view(1, m.t), m.view(2, m.t), m.view(3, m.t)];
        (0..4 * m.n).map(|i| all[i % 4][i / 4]).collect()
    };
    mat_mul_accumulate [u8 i8] 16..=64, |d, a, b, c, _| a.mat_mul_add::<<<T as Int>::Wide as Int>::Wide>(b, c.bitcast()) => |m| mat_mul(m, m.t);
    mat_mul_accumulate_i8 [u8] 16..=64, |d, a, b, c, _| a.mat_mul_add::<i32>(b.bitcast(), c.bitcast()) => |m| mat_mul(m, I(8));
    u7 [u8] 4..=64, |d, a, b, c, _| (a & 127).dot_add_relaxed::<i32>(b.bitcast(), c.bitcast()) => |m| {
        let (b, c) = (m.view(1, I(8)), m.view(2, I(32)));
        (0..m.n / 4).map(|i| c[i] + (4 * i..4 * i + 4).map(|k| (m.a[k] & 127) * b[k]).sum::<i128>()).collect()
    };
    small_64_u16 [u8] 2..=64, |d, a, b, c, _| a.dot_add_relaxed::<u16>(b.simd_min(64), c.bitcast()) => |m| small(m, 64, 2);
    small_127_u16 [u8] 2..=64, |d, a, b, c, _| a.dot_add_relaxed::<u16>(b.simd_min(127), c.bitcast()) => |m| small(m, 127, 2);
    small_64_u32 [u8] 4..=64, |d, a, b, c, _| a.dot_add_relaxed::<u32>(b.simd_min(64), c.bitcast()) => |m| small(m, 64, 4);
    small_127_u32 [u8] 4..=64, |d, a, b, c, _| a.dot_add_relaxed::<u32>(b.simd_min(127), c.bitcast()) => |m| small(m, 127, 4);
    small_known [u8] 4..=64, |d, a, _, c, _| a.dot_add_relaxed::<u32>(64, c.bitcast()) - c.bitcast() => |m| m.a.chunks(4).map(|it| 64 * it.iter().sum::<i128>()).collect();
    dot_bf16 [u16] 4..=64, |d, a, b, c, _| (a & 0xc3f0 | 0x4000).bitcast::<bf16>().dot_add_relaxed((b & 0xc3f0 | 0x4000).bitcast::<bf16>(), (c.bitcast::<u32>() & 0xc1ff_0000u32 | 0x4000_0000).bitcast()) => |m| {
        let f = |x: i128| f32::from_bits((x as u32 & 0xc3f0 | 0x4000) << 16) as f64;
        let c = m.view(2, U(32));
        let exact = |i: usize| f32::from_bits(c[i] as u32 & 0xc1ff_0000 | 0x4000_0000) as f64 + (2 * i..2 * i + 2).map(|k| f(m.a[k]) * f(m.b[k])).sum::<f64>();
        (0..m.n / 2).map(|i| if exact(i).abs() < 1e4 && f(m.a[2 * i]).abs().max(f(m.a[2 * i + 1]).abs()) < 16.0 { F(32).of(exact(i)) } else { ANY }).collect()
    };
    symmetric [i8] 4..=64, |d, a, b, c, _| a.dot_add_relaxed(b, c.bitcast()) => |m| dot(m, |_, y| y == -128);
}
