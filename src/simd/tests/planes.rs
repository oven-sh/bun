#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn planes(m: &Model, count: usize) -> Lanes {
    (0..count).map(|k| m.a.iter().enumerate().map(|(i, x)| (x >> k & 1) << i).sum()).collect()
}
fn joined(m: &Model, count: usize) -> Lanes {
    let planes = m.io.slice::<u64>();
    m.each(|i| (0..count).map(|k| ((planes[k % 32] >> i & 1) as i128) << k).sum())
}
fn words<const K: usize>(io: &Io) -> [u64; K] {
    let all = io.slice::<u64>();
    core::array::from_fn(|k| all[k % 32])
}
fn squares(m: &Model, rows: &[&Lanes]) -> Lanes {
    let (lanes, blocks) = (m.n.min(16 / m.t.size()), (m.n * m.t.size()).div_ceil(16));
    (0..rows.len())
        .flat_map(|r| m.each(|i| rows[r / blocks * blocks + i / lanes][r % blocks * lanes + i % lanes]))
        .collect()
}

const ROWS: usize = if WIDE == 0 { 8 } else { 32 };

cases! {
    transpose_bits [u64] 0..=64, |d, a, _, _, _| a.transpose_bits()
        => |m| m.map1(|x| (0..64).map(|i| (x >> (i % 8 * 8 + i / 8) & 1) << i).sum());
    prefix_sum_in_blocks all 0..=64, |d, a, _, _, _| a.in_blocks().prefix_sum() => |m| {
        let (n, mut v, mut k) = (m.n.min(16 / m.t.size()), m.a.clone(), 1);
        while k < n {
            v = m.each(|i| if i % n >= k { m.t.add(v[i], v[i - k]) } else { m.t.quiet(v[i]) });
            k *= 2;
        }
        v
    };
    transpose_blocks sizes 0..=64, |d, a, b, c, _| Simd::transpose_blocks::<ROWS>(array::from_fn(#[inline(always)] |i| [a, b, c][i * i % 7 % 3]))
        => |m| squares(m, &(0..ROWS).map(|i| [&m.a, &m.b, &m.c][i * i % 7 % 3]).collect::<Vec<_>>());
    transpose_blocks_that_differ [u8 u32] 0..=64, |d, a, b, _, _| Simd::transpose_blocks::<ROWS>(array::from_fn(#[inline(always)] |i| [a, b][i % 2] ^ i as T))
        => |m| squares(m, &(0..ROWS).map(|i| [&m.a, &m.b][i % 2].iter().map(|x| x ^ i as i128).collect()).collect::<Vec<Lanes>>().iter().collect::<Vec<_>>());
    where_ways_change uint 0..=64, |d, a, _, _, io| ((a.bit_planes::<4>(), (a.bit_planes::<6>(), a.bit_planes::<7>())),
        [d.from_bit_planes(words::<4>(io)), d.from_bit_planes(words::<5>(io)), d.from_bit_planes(words::<6>(io))])
        => |m| [[4, 6, 7].map(|k| planes(m, k)).concat(), [4, 5, 6].map(|k| joined(m, k)).concat()].concat();
    planes_of_words [u32] 0..=64, |d, a, _, _, io| ((a.bit_planes::<23>(), a.bit_planes::<32>()), [d.from_bit_planes(words::<23>(io)), d.from_bit_planes(words::<32>(io))])
        => |m| [planes(m, 23), planes(m, 32), joined(m, 23), joined(m, 32)].concat();
    few_planes uint 0..=64, |d, a, _, _, _| (a.bit_planes::<0>(), (a.bit_planes::<1>(), (a.bit_planes::<2>(), (a.bit_planes::<3>(), (a.bit_planes::<5>(), a.bit_planes::<8>())))))
        => |m| [0, 1, 2, 3, 5, 8].map(|k| planes(m, k)).concat();
    many_planes [u16 u32 u64] 0..=64, |d, a, _, _, _| (a.bit_planes::<9>(), a.bit_planes::<16>()) => |m| [planes(m, 9), planes(m, 16)].concat();
    all_planes [u64] 0..=64, |d, a, _, _, _| (a.bit_planes::<33>(), a.bit_planes::<64>()) => |m| [planes(m, 33), planes(m, 64)].concat();
    from_few_planes uint 0..=64, |d, _, _, _, io| [d.from_bit_planes(words::<0>(io)), d.from_bit_planes(words::<1>(io)), d.from_bit_planes(words::<2>(io)),
        d.from_bit_planes(words::<3>(io)), d.from_bit_planes(words::<7>(io)), d.from_bit_planes(words::<8>(io))]
        => |m| [0, 1, 2, 3, 7, 8].map(|k| joined(m, k)).concat();
    from_many_planes [u16 u32 u64] 0..=64, |d, _, _, _, io| [d.from_bit_planes(words::<9>(io)), d.from_bit_planes(words::<16>(io))] => |m| [joined(m, 9), joined(m, 16)].concat();
    from_all_planes [u64] 0..=64, |d, _, _, _, io| [d.from_bit_planes(words::<33>(io)), d.from_bit_planes(words::<64>(io))] => |m| [joined(m, 33), joined(m, 64)].concat();
}
