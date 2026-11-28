#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{mem::*, *};
use framework::*;

cases! {
    masked_load_or sizes 0..=64, |d, a, b, _, io| {
        let from = &io.slice::<T>()[..io.up_to(d.lanes() + 1)];
        [d.load_select_or_default(from, b.cast_signed().is_negative()), d.load_select(from, b.cast_signed().is_negative(), a), d.load_expand(from, b.cast_signed().is_negative())]
    } => |m| {
        let at = |i: usize| *m.slice()[..m.io.up_to(m.n + 1)].get(i).unwrap_or(&0);
        [m.each(|i| if m.mb[i] { at(i) } else { 0 }), m.each(|i| if m.mb[i] && i < m.io.up_to(m.n + 1) { at(i) } else { m.a[i] }),
         m.each(|i| if m.mb[i] { at(m.mb[..i].iter().filter(|&&it| it).count()) } else { 0 })].concat()
    };
    insert_into_upper [i16 u32 i64 f32 f64] 2 * LANE..=64, |d, _, b, _, io| d.from_halves([b.split()[0], d.half().load(&io.slice::<T>())])
        => |m| [&m.b[..m.n / 2], &m.a[..m.n / 2]].concat();
    load_dup sizes 2 * LANE..=64, |d, _, _, _, io| {
        let all = Aligned(*io.slice::<T>().first_chunk::<16>().unwrap());
        [d.repeat(all.first_chunk::<1>().unwrap()), d.repeat(all.first_chunk::<2>().unwrap())]
    } => |m| [m.each(|_| m.a[0]), m.each(|i| m.a[i % 2])].concat();
    gather sizes 0..=64, |d, a, b, c, io| {
        let (table, at) = (&io.slice::<T>()[..20], b.cast_unsigned() & d.to_unsigned().splat(Lane::from_usize(31)));
        [d.gather_select(table, c.cast_signed().is_negative(), at, a), d.gather_select(table, c.cast_signed().is_negative(), at, d.zero())]
    } => |m| [1, 0].map(|keep| m.each(|i| *m.slice()[..20].get(m.b[i] as usize & 31).filter(|_| m.mc[i]).unwrap_or(&(m.a[i] * keep)))).concat();
    gather_by_other_size [u32] 8..=32, |d, _, b, _, io|
        (d.rebind::<u8>().gather_or_default(&io.slice::<u8>()[..20], b & 31u32), d.rebind::<f64>().gather_or_default(&io.slice::<f64>()[..20], b & 31u32))
        => |m| [U(8), F(64)].map(|t| m.each(|i| *t.lanes(&m.io.bytes)[..20].get(m.b[i] as usize & 31).unwrap_or(&0))).concat();
    gather_from_many [u32] 8..=64, |d, _, b, _, io| d.rebind::<u8>().gather_or_default(&io.slice::<u8>()[..20], b & 31u32)
        => |m| m.each(|i| *U(8).lanes(&m.io.bytes)[..20].get(m.b[i] as usize & 31).unwrap_or(&0));
    gather_by_wider [u8 i16] 16 * LANE..=32 * LANE, |d, a, b, c, io| {
        let (table, at) = (&io.slice::<T>()[..20], b.cast_unsigned() & d.to_unsigned().splat(Lane::from_usize(31)));
        [d.gather_select(table, c.cast_signed().is_negative(), at.cast::<u32>(), a), d.gather_or(table, at.cast::<u64>(), a)]
    } => |m| [true, false].map(|mask| m.each(|i| *m.slice()[..20].get(m.b[i] as usize & 31).filter(|_| !mask || m.mc[i]).unwrap_or(&m.a[i]))).concat();
    gather_from_tables_for_all_indices [u32] 8..=64, |d, a, b, c, _| {
        static TABLE: [u32; 65536] = { let (mut all, mut i) = ([0; 65536], 0); while i < 65536 { all[i] = i as u32 * 3 + 1; i += 1; } all };
        let mask = c.cast_signed().is_negative();
        [d.gather_select(&TABLE[..256], mask, b.cast::<u8>(), a), d.gather_select(&TABLE, mask, b.cast::<u16>(), a), d.gather_or_default(&TABLE[..255], b.cast::<u8>())]
    } => |m| [m.each(|i| if m.mc[i] { (m.b[i] & 255) * 3 + 1 } else { m.a[i] }), m.each(|i| if m.mc[i] { (m.b[i] & 65535) * 3 + 1 } else { m.a[i] }),
        m.each(|i| if m.b[i] & 255 < 255 { (m.b[i] & 255) * 3 + 1 } else { 0 })].concat();
    gather_interleaved sizes 0..=64, |d, _, b, _, io| {
        let (table, at) = (&io.slice::<T>()[..4 + io.up_to(16)], b.cast_unsigned().cast::<u32>());
        let at = at.any_bits(64u32).select(at, at & 31u32);
        (d.gather_interleaved::<2, _>(table, at), (d.gather_interleaved::<3, _>(table, at), d.gather_interleaved::<4, _>(table, at)))
    } => |m| {
        let (all, len) = (m.slice(), 4 + m.io.up_to(16));
        let at = |i: usize| { let it = m.b[i] as u64 & (!0 >> (64 - m.t.bits())); let it = it as u32; (if it & 64 != 0 { it } else { it & 31 }) as usize };
        [2, 3, 4].into_iter().flat_map(|n| (0..n).map(move |k| (n, k))).flat_map(|(n, k)| m.each(|i| all[at(i).min(len - n) + k])).collect()
    };
    gather_windows [u32] 4..=64, |d, a, b, _, io| {
        let (all, at) = (io.slice::<u8>(), a.simd_gt(b).select(a & 31u32, a));
        let from = &all[..io.up_to(30)];
        macro_rules! lanes { ($($k:literal)*) => { match const { W::BYTES / LANE } {
            $($k => [at.gather_windows::<_, 1, $k>(from).map_or(vec![], |it| it.map(|it| *it).concat()), at.gather_windows::<_, 5, $k>(from).map_or(vec![], |it| it.map(|it| *it).concat())].concat(),)*
            _ => unreachable!(),
        } }; }
        lanes!(1 2 4 8 16 32 64 128)
    } => |m| {
        let all = U(8).lanes(&m.io.bytes);
        let from = &all[..m.io.up_to(30)];
        let at = |i: usize| (if m.a[i] > m.b[i] { m.a[i] & 31 } else { m.a[i] }) as usize;
        [1, 5].into_iter().filter(|&n| n <= from.len()).flat_map(|n| (0..m.n).flat_map(move |i| from[at(i).min(from.len() - n)..][..n].to_vec())).collect()
    };
    masked_scatter sizes 0..=64, |d, a, b, c, io| {
        let mut all = io.slice::<T>();
        a.scatter_select(&mut all[..20], c.cast_signed().is_negative(), b.cast_unsigned() & d.to_unsigned().splat(Lane::from_usize(31)));
        all
    } => |m| {
        let mut all = m.slice();
        for i in (0..m.n).filter(|&i| m.mc[i] && m.b[i] & 31 < 20) { all[m.b[i] as usize & 31] = m.a[i] }
        all
    };
    truncate_store [u16 i32 u64] 4..=64, |d, a, _, _, _| { let mut to = vec![0; d.lanes()]; a.cast::<<T as Int>::Narrow>().store(&mut to); to } => |m| m.a.clone();
}
