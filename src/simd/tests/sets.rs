#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{math::*, *};
use framework::*;

cases! {
    matches_any int 16..=64, |d, a, b, _, _| [a.in_blocks().is_in(b), (a & 7).in_blocks().is_in(b & 7), (a & 6 | 1).in_blocks().is_in_relaxed(b & 7 | 1)] => |m| [
        m.blocks(|a, b, j| -(b.contains(&a[j]) as i128)), m.blocks(|a, b, j| -(b.iter().any(|it| it & 7 == a[j] & 7) as i128)),
        m.blocks(|a, b, j| -(b.iter().any(|it| it & 6 == a[j] & 6) as i128))].concat();
    count_in int 16..=64, |d, a, b, _, _| [a.in_blocks().count_in(b), (a & 3).in_blocks().count_in(b & 3), (a & 1).count_in((b & 1).resize::<B16>()), d.zero().count_in(0)] => |m| [
        m.blocks(|a, b, j| b.iter().filter(|it| **it == a[j]).count() as i128), m.blocks(|a, b, j| b.iter().filter(|it| *it & 3 == a[j] & 3).count() as i128),
        m.each(|i| m.b[..16 / m.t.size()].iter().filter(|it| *it & 1 == m.a[i] & 1).count() as i128), m.each(|_| 16 / m.t.size() as i128)].concat();
    linear_map [u8] 16..=64, |d, a, _, _, io| {
        let [low, high] = galois_nibbles(io.n as u8, (io.n >> 8) as u8);
        let s = a.isa();
        let both = [LinearMap::new(d.repeat(&low), d.repeat(&high)).of(a), LinearMap::new(s.load::<u8, B16>(&low), s.load(&high)).of(a)];
        both[0].simd_eq(both[1]).select(both[0], !both[0])
    } => |m| m.map1(|x| (0..8).fold((0, x as u8), |(sum, x), i| (sum ^ (x * (m.io.n >> i & 1) as u8), (x << 1) ^ ((x >> 7) * (m.io.n >> 8) as u8))).0 as i128);
    broadcast_last all 0..=64, |d, a, _, _, _| a.splat_last() => |m| m.each(|_| m.a[m.n - 1]);
    bits_if int 0..=64, |d, a, _, _, io| {
        let (all, odd) = (io.slice::<T>().repeat(2), #[inline(always)] |v: Simd<T, _, _>| v.all_bits(1));
        (d.over(&all[..64]).bitmask(odd), d.over(&all[..io.up_to(64)]).bitmask(odd))
    } => |m| {
        let (all, n) = (m.slice().repeat(2), m.io.up_to(64));
        [64, n].map(|n| (0..n).map(|i| (all[i] & 1) << i).sum()).to_vec()
    };
}
