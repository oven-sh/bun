#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
#[path = "framework/fma.rs"]
mod fma;
use bun_simd::{math::*, *};
use framework::*;

fn sums(m: &Model, k: usize, f: impl Fn(usize) -> i128) -> Lanes {
    m.each(f).chunks(k).map(|it| it.iter().sum()).collect()
}
fn plus(x: Lanes, y: Lanes) -> Lanes {
    x.iter().zip(y).map(|(x, y)| x + y).collect()
}
/// Two fused steps for each part.
fn complex(m: &Model, conj: bool, add: bool) -> Lanes {
    let (t, (p, tiny)) = (m.t, if m.t == F(32) { (24, -149) } else { (53, -1074) });
    let fma = |x: i128, y: i128, z: i128| t.of(fma::fma(t.float(x), t.float(y), t.float(z), p, tiny));
    let sign = 1i128 << (m.t.bits() - 1);
    m.each(|i| {
        let (re, im, c) = (i & !1, i | 1, if add { m.c[i] } else { sign });
        match (conj, i == re) {
            (false, true) => fma(m.a[re], m.b[re], fma(m.a[im] ^ sign, m.b[im], c)),
            (false, false) => fma(m.a[re], m.b[im], fma(m.a[im], m.b[re], c)),
            (true, true) => fma(m.a[re], m.b[re], fma(m.a[im], m.b[im], c)),
            (true, false) => fma(m.a[im], m.b[re], fma(m.a[re] ^ sign, m.b[im], c)),
        }
    })
}
/// Part `p` of all blocks, added to `c + p`.
fn weighted(m: &Model, parts: usize, f: impl Fn(usize) -> i128) -> Lanes {
    let (c, block) = (m.view(2, I(32)), m.n.min(4 * parts));
    let (each, all) = (block / parts, m.n / parts);
    m.each(|i| f(i % all / each * block + i / all * each + i % each) + c[i % all] + (i / all) as i128)
}
type Wide<T> = <T as Int>::Wide;

cases! {
    complex_mul float 2 * LANE..=64, |d, a, b, c, _|
        [a.complex_mul(b), a.complex_mul_conj(b), a.complex_mul_add(b, c), a.complex_mul_conj_add(b, c)]
        => |m| [complex(m, false, false), complex(m, true, false), complex(m, false, true), complex(m, true, true)].concat();
    dot2 [u8 i8 u16 i16 u32 i32] 2 * LANE..=64, |d, a, b, c, _| [a.dot::<Wide<T>>(b), a.dot_add::<Wide<T>>(b, c.bitcast())]
        => |m| [sums(m, 2, |i| m.a[i] * m.b[i]), plus(sums(m, 2, |i| m.a[i] * m.b[i]), m.view(2, m.t.wide()))].concat();
    dot4 [u8 i8 u16 i16] 4 * LANE..=64, |d, a, b, c, _| [a.dot::<Wide<Wide<T>>>(b), a.dot_add::<Wide<Wide<T>>>(b, c.bitcast())]
        => |m| [sums(m, 4, |i| m.a[i] * m.b[i]), plus(sums(m, 4, |i| m.a[i] * m.b[i]), m.view(2, m.t.wide().wide()))].concat();
    dot_mixed [u8] 4..=64, |d, a, b, c, _| [a.dot::<i32>(b.bitcast()), a.dot_add::<i32>(-3, c.bitcast())]
        => |m| [sums(m, 4, |i| m.a[i] * I(8).wrap(m.b[i])), plus(sums(m, 4, |i| m.a[i] * -3), m.view(2, I(32)))].concat();
    sum_groups2 [u8 i8 u16 i16 u32 i32] 2 * LANE..=64, |d, a, b, _, _| [a.sum_groups::<Wide<T>>(), a.abs_diff_sum(b)]
        => |m| [sums(m, 2, |i| m.a[i]), sums(m, 2, |i| (m.a[i] - m.b[i]).abs())].concat();
    sum_groups1 [u64 i64 f64] 8..=64, |d, a, b, _, _| [a.sum_groups::<T>(), a.abs_diff_sum(b)] => |m| [m.a.clone(), m.num2(|x, y| (x - y).abs(), |x, y| (x - y).abs())].concat();
    sum_groups4 [u8 i8 u16 i16] 4 * LANE..=64, |d, a, b, _, _| [a.sum_groups::<Wide<Wide<T>>>(), a.abs_diff_sum(b)]
        => |m| [sums(m, 4, |i| m.a[i]), sums(m, 4, |i| (m.a[i] - m.b[i]).abs())].concat();
    sum_groups8 [u8 i8] 8..=64, |d, a, b, _, _| [a.sum_groups::<Wide<Wide<Wide<T>>>>(), a.abs_diff_sum(b)]
        => |m| [sums(m, 8, |i| m.a[i]), sums(m, 8, |i| (m.a[i] - m.b[i]).abs())].concat();
    widening_mul [u8 u16 u32 i8 i16 i32] 2 * LANE + 1 / LANE * 2..=64, |d, a, b, c, _|
        [a.widening_mul(b), a.widening_mul_add(b, [c.bitcast(), (!c).bitcast()])] => |m| {
            let c = m.view(2, m.t.wide());
            [m.map2(|x, y| x * y), m.each(|i| m.a[i] * m.b[i] + if i < m.n / 2 { c[i] } else { !c[i - m.n / 2] })].concat()
        };
    weighted_add [i16] 4..=64, |d, a, b, c, _| {
        let (sums, x) = ([c.bitcast(), c.bitcast() + 1], a.in_blocks());
        [x.weighted_add(b, [c, !a], sums), x.weighted_add(b, [c[0], c[1]], sums), x.weighted_add(b, [-3, c[1]], sums), x.weighted_add(b, [i16::MIN; 2], sums), x.weighted_add(7, [0, 1], sums)]
    } => |m| [
        weighted(m, 2, |i| m.a[i] * m.c[i] + m.b[i] * !m.a[i]), weighted(m, 2, |i| m.a[i] * m.c[0] + m.b[i] * m.c[1]), weighted(m, 2, |i| m.a[i] * -3 + m.b[i] * m.c[1]),
        weighted(m, 2, |i| (m.a[i] + m.b[i]) * -32768), weighted(m, 2, |_| 7),
    ].concat();
    weighted_add_bytes [u8] 4..=64, |d, a, b, c, _| {
        let (sums, by) = (array::from_fn(|i| c.bitcast() + i as i32), c.bitcast::<i16>());
        [a.in_blocks().weighted_add(b, [by[0], by[1]], sums), a.in_blocks().weighted_add(b, [i16::MIN, 300], sums)]
    } => |m| { let by = m.view(2, I(16)); [weighted(m, 4, |i| m.a[i] * by[0] + m.b[i] * by[1]), weighted(m, 4, |i| m.a[i] * -32768 + m.b[i] * 300)].concat() };
    cast_mul [u8 u16 u32 i8 i16 i32] 0..=32, |d, a, b, _, _| a.cast_mul::<Wide<T>>(b) => |m| m.map2(|x, y| x * y);
    cast_mul_q15_add [i16] 0..=32, |d, a, b, _, io| a.cast_mul_q15_add(b, io.load(d.isa().of(), 2)) => |m| {
        let c = m.view(2, I(32));
        m.each(|i| I(32).clamp(c[i] + I(32).clamp(2 * m.a[i] * m.b[i])))
    };
    pair_sums [u8 u16 u32 i8 i16 i32] 2 * LANE + 1 / LANE * 2..=64, |d, a, b, c, _| {
        let (mut x, mut y) = (PairSums::default(), PairSums::starting_at(c.bitcast()));
        x.mul_add(a, b);
        y.mul_add(b, b);
        let both = x + y;
        x += y;
        ([both.total(), x.total()], both.reduce_sum())
    } => |m| {
        let total = plus(sums(m, 2, |i| (m.a[i] + m.b[i]) * m.b[i]), m.view(2, m.t.wide()));
        [total.clone(), total.clone(), vec![total.iter().sum()]].concat()
    };
    abs_diff_sums [u8] 8..=64, |d, a, b, c, _| {
        let (mut x, mut y) = (AbsDiffSums::default(), AbsDiffSums::default());
        for _ in 0..16 { x.add_abs_diff(a, b); y.add_abs_diff(c, 0) }
        x += y;
        x.total()
    } => |m| sums(m, 8, |i| 16 * ((m.a[i] - m.b[i]).abs() + m.c[i]));
    abs_diff_sums_reduce [u8] 0..=64, |d, a, b, c, _| {
        let (mut x, mut y) = (AbsDiffSums::default(), AbsDiffSums::default());
        for _ in 0..16 { x.add_abs_diff(a, b); y.add_abs_diff(c, 0) }
        (x + y).reduce_sum()
    } => |m| sums(m, m.n, |i| 16 * ((m.a[i] - m.b[i]).abs() + m.c[i]));
}
