#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use core::{cell::Cell, sync::atomic::AtomicU8};
use framework::*;

/// Mostly near the table, and any number if bit 6 is set.
fn index(m: &Model, i: usize) -> usize {
    let it = (m.b[i] as u64 & (!0 >> (64 - m.t.bits()))) as u32;
    (if it & 64 != 0 { it } else { it & 31 }) as usize
}
fn bytes_at(m: &Model, len: usize) -> Lanes {
    let size = m.t.bits() as usize / 8;
    m.each(|i| m.t.lanes(&m.io.bytes[index(m, i).min(len - size)..][..size])[0])
}

cases! {
    one_neighbor sizes 0..=64, |d, _, b, _, io| {
        let (mut all, at) = (io.slice::<T>(), b.cast_unsigned().cast::<u32>());
        let (table, at) = (&mut all[..1 + io.up_to(20)], at.any_bits(64u32).select(at, at & 31u32));
        (d.gather_interleaved::<1, _>(table, at), d.gather_interleaved::<1, _>(Cell::from_mut(table).as_slice_of_cells(), at))
    } => |m| [0, 1].map(|_| m.each(|i| m.slice()[index(m, i).min(m.io.up_to(20))])).concat();
    gather_bytes [u8 i8 u16 i16 u32 f32 u64 f64] 0..=64, |d, _, b, _, io| {
        let (mut all, at) = (io.slice::<u8>(), b.cast_unsigned().cast::<u32>());
        let (from, at) = (&mut all[..size_of::<T>() + io.up_to(30)], at.any_bits(64u32).select(at, at & 31u32));
        let shared: Vec<AtomicU8> = from.iter().map(|&it| AtomicU8::new(it)).collect();
        [d.gather_bytes(from, at), d.gather_bytes(&shared, at), d.gather_bytes(Cell::from_mut(from).as_slice_of_cells(), at)]
    } => |m| [0, 1, 2].map(|_| bytes_at(m, m.t.bits() as usize / 8 + m.io.up_to(30))).concat();
    from_arrays_of_bytes [u16 u32 f32 u64] 2 * LANE..=64, |d, a, b, c, io| {
        let (all, at) = (io.slice::<u8>(), b.cast_unsigned().cast::<u32>());
        let (table, at) = (&all[1..].as_chunks::<{ size_of::<T>() }>().0[..io.up_to(12)], at.any_bits(64u32).select(at, at & 31u32));
        let [clamped] = if table.is_empty() { [a] } else { d.gather_interleaved(table, at) };
        [d.gather_select(table, c.cast_signed().is_negative(), at, a), d.gather_or_default(table, at.cast::<u8>()), d.gather_or(table, at.cast::<u64>(), a), clamped]
    } => |m| {
        let (size, n) = (m.t.bits() as usize / 8, m.io.up_to(12));
        let table = m.t.lanes(&m.io.bytes[1..][..n * size]);
        [m.each(|i| *table.get(index(m, i)).filter(|_| m.mc[i]).unwrap_or(&m.a[i])), m.each(|i| *table.get(index(m, i) & 255).unwrap_or(&0)),
         m.each(|i| *table.get(index(m, i)).unwrap_or(&m.a[i])), m.each(|i| if n == 0 { m.a[i] } else { table[index(m, i).min(n - 1)] })].concat()
    };
    small_lanes_by_any_index [u8 u16] 2 * LANE..=64, |d, a, b, c, io| {
        let (table, at) = (&io.slice::<T>()[..io.up_to(20)], b.cast_unsigned().cast::<u32>());
        let at = at.any_bits(64u32).select(at, at & 31u32);
        [d.gather_select(table, c.cast_signed().is_negative(), at | at << 24 & 0xc000_0000u32, a), d.gather_or(table, at.cast::<u16>(), a), d.gather_or_default(table, at.cast::<u8>())]
    } => |m| {
        let (all, n) = (m.slice(), m.io.up_to(20));
        [m.each(|i| *all[..n].get(index(m, i)).filter(|_| m.mc[i]).unwrap_or(&m.a[i])), m.each(|i| *all[..n].get(index(m, i)).unwrap_or(&m.a[i])),
         m.each(|i| *all[..n].get(index(m, i) & 255).unwrap_or(&0))].concat()
    };
}
