#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn kept(m: &Model, keep: impl Fn(usize) -> bool) -> Lanes {
    let mut lanes: Lanes = (0..m.n).filter(|&i| keep(i)).map(|i| m.a[i]).collect();
    lanes.resize(m.n, ANY);
    lanes
}

cases! {
    table_lookup_bytes [u8] 0..=64, |d, a, b, _, _| [a.in_blocks().lookup_bytes_relaxed(b), a.in_blocks().lookup_bytes_relaxed(b & d.splat(0x80 | (d.lanes().min(16) - 1) as u8))]
        => |m| [0xff, 0x7f + m.block].map(|bits| m.blocks(|a, b, j| {
            let index = b[j] as usize & bits;
            if index >= 128 { 0 } else { *a.get(index).unwrap_or(&ANY) }
        })).concat();
    table_lookup_lanes sizes 0..=64, |d, a, b, _, _| a.swizzle_dyn_relaxed(b.cast_unsigned() & d.to_unsigned().splat(Lane::from_usize(d.lanes() - 1)))
        => |m| m.each(|i| m.a[m.b[i] as usize % m.n]);
    two_tables_lookup_lanes sizes 0..=64, |d, a, b, c, _|
        a.concat_swizzle_dyn_relaxed(b, c.cast_unsigned() & d.to_unsigned().splat(Lane::from_usize(2 * d.lanes() - 1)))
        => |m| m.each(|i| [&m.a[..], &m.b].concat()[m.c[i] as usize % (2 * m.n)]);
    all_bytes [u8] 0..=64, |_d, a, b, _, _| { let table: [u8; 256] = core::array::from_fn(|i| (i as u8).wrapping_mul(167) ^ b[0]); [a.lookup(&table), a.lookup_relaxed(&table)] }
        => |m| [0, 1].map(|_| m.each(|i| (m.a[i] * 167) & 255 ^ m.b[0])).concat();
    more_than_64_bytes [u8] 0..=64, |_d, a, b, _, _| {
        let table: [u8; 128] = core::array::from_fn(|i| (i as u8).wrapping_mul(167) ^ b[0]);
        [a.lookup(&table), a.lookup_relaxed(&table), a.lookup_relaxed(table.first_chunk::<65>().unwrap()), a.lookup_relaxed(table.first_chunk::<100>().unwrap())]
    } => |m| [(127, 128), (255, 128), (255, 65), (255, 100)].map(|(bits, n)| m.each(|i| if m.a[i] & bits < n { ((m.a[i] & bits) * 167) & 255 ^ m.b[0] } else { ANY })).concat();
    compress sizes 0..=64, |d, a, b, _, io| [a.compress_relaxed(b.cast_signed().is_negative()), a.compress_relaxed(io.n)]
        => |m| [kept(m, |i| m.mb[i]), kept(m, |i| m.io.n >> i & 1 == 1)].concat();
    compress_store sizes 0..=64, |d, a, b, _, io| {
        let (mut x, mut y) = (vec![T::default(); d.lanes()], vec![T::default(); d.lanes()]);
        ([a.compress_store(&mut x, b.cast_signed().is_negative()), a.compress_store(&mut y, io.n)], (x, y))
    } => |m| {
        let (x, y) = (kept(m, |i| m.mb[i]), kept(m, |i| m.io.n >> i & 1 == 1));
        let count = |it: &Lanes| it.iter().filter(|&&x| x != ANY).count() as i128;
        [vec![count(&x), count(&y)], x, y].concat()
    };
    gather_index sizes 0..=64, |d, _, b, _, io| d.gather_or_default(&io.slice::<T>()[..30], b.cast_unsigned())
        => |m| m.each(|i| *m.slice()[..30].get(m.t.unsigned(m.b[i]).min(30) as usize).unwrap_or(&0));
}
