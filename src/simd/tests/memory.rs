#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use core::cell::Cell;
use core::mem::MaybeUninit;
use core::sync::atomic::*;
use framework::*;

fn strided(m: &Model, k: usize) -> Lanes {
    (0..k).flat_map(|j| m.each(|i| m.slice()[k * i + j])).collect()
}
fn zipped(m: &Model, k: usize) -> Lanes {
    let all = [m.view(0, m.t), m.view(1, m.t), m.view(2, m.t), m.view(3, m.t)];
    (0..k * m.n).map(|i| all[i % k][i / k]).collect()
}
fn len(m: &Model) -> usize {
    m.io.up_to(m.n + 1)
}

macro_rules! atomic {
    ($d:ident, $a:ident, $io:ident, $atomic:ident) => {{
        let all: Vec<_> = $io.slice::<T>().into_iter().map($atomic::new).collect();
        let v = $d.load_at(&all[..], 3);
        $a.store_at(&mut &all[..], 1);
        (v, all.iter().map(|it| it.load(Ordering::Relaxed)).collect::<Vec<_>>())
    }};
}
fn read_write(m: &Model) -> Lanes {
    let mut all = m.slice();
    let read = all[3..][..m.n].to_vec();
    all[1..][..m.n].copy_from_slice(&m.a);
    [read, all].concat()
}

cases! {
    set all 0..=64, |d, a, _, _, _| [d.zero(), d.splat(a[0]), d.iota(a[0]), d.from_array(a.to_array())]
        => |m| [vec![0; m.n], vec![m.a[0]; m.n], m.each(|i| m.t.add(if let F(_) = m.t { m.t.of(i as _) } else { i as _ }, m.a[0])), m.a.clone()].concat();
    load sizes 0..=64, |d, _, _, _, io| { let all = io.slice::<T>(); [d.load(&all[1..]), d.load_last(&all)] }
        => |m| [&m.slice()[1..][..m.n], &m.slice()[4 * STEP / m.t.size() - m.n..]].concat();
    load_n all 0..=64, |d, _, b, _, io| { let all = io.slice::<T>(); let part = &all[1..][..io.up_to(d.lanes() + 1)]; [d.load_or_default(part), d.load_or(part, b)] }
        => |m| [m.each(|i| if i < len(m) { m.slice()[1 + i] } else { 0 }), m.each(|i| if i < len(m) { m.slice()[1 + i] } else { m.b[i] })].concat();
    load_padded all 0..=64, |d, _, b, _, io| { let all = io.slice::<T>(); d.load_padded(&all[1..][..io.up_to(d.lanes() + 1)], b[0]) }
        => |m| m.each(|i| if i < len(m) { m.slice()[1 + i] } else { m.b[0] });
    store_n all 0..=64, |d, _, b, _, io| { let mut all = io.slice::<T>(); b.store_partial(&mut all[1..][..io.up_to(d.lanes() + 1)]); all }
        => |m| { let (mut all, n) = (m.slice(), len(m).min(m.n)); all[1..][..n].copy_from_slice(&m.b[..n]); all };
    partial_far all 0..=64, |d, _, b, _, io| { let mut all = io.slice::<T>().repeat(2); let part = &mut all[1..][..io.up_to(5 * d.lanes())]; let v = d.load_or_default(part); b.store_partial(part); (v, all) }
        => |m| { let (mut all, n) = (m.slice().repeat(2), m.io.up_to(5 * m.n).min(m.n)); let v = m.each(|i| if i < n { all[1 + i] } else { 0 }); all[1..][..n].copy_from_slice(&m.b[..n]); [v, all].concat() };
    partial_of_long all 0..=64, |d, _, b, _, io| { let (mut all, n) = (io.slice::<T>().repeat(150), 256 * io.up_to(2) + io.up_to(3)); let part = &mut all[1..][..n]; let v = d.mask_first_n(n).select(d.load_or(part, b[0]), b); b.store_partial_at(&mut Cell::from_mut(part).as_slice_of_cells(), 0); (v, all[..d.lanes() + 2].to_vec()) }
        => |m| { let (mut all, n) = (m.slice(), (256 * m.io.up_to(2) + m.io.up_to(3)).min(m.n)); let v = m.each(|i| if i < n { all[1 + i] } else { m.b[i] }); all[1..][..n].copy_from_slice(&m.b[..n]); [&v[..], &all[..m.n + 2]].concat() };
    partial_chunks all 0..=64, |d, _, b, _, io| { let mut all = io.slice::<T>(); for part in all[1..][..io.up_to(3 * d.lanes())].chunks_mut(d.lanes()) { (d.load_or_default(part).bitcast::<u8>() ^ b.bitcast::<u8>()).bitcast::<T>().store_partial(part) } all }
        => |m| { let mut all = m.slice(); (0..m.io.up_to(3 * m.n)).for_each(|i| all[1 + i] = m.t.wrap(all[1 + i] ^ m.b[i % m.n])); all };
    store sizes 0..=64, |d, _, b, c, io| { let mut all = io.slice::<T>(); b.store(&mut all[1..]); c.store_last(&mut all); all }
        => |m| { let mut all = m.slice(); all[1..][..m.n].copy_from_slice(&m.b); all.truncate(all.len() - m.n); [&all[..], &m.c].concat() };
    uninit sizes 0..=64, |d, a, b, c, _| {
        let mut room = [MaybeUninit::<T>::uninit(); 2 * STEP + 2];
        let mut all = { let mut out = bun_simd::mem::Output::new(&mut room); out.push(a); out.into_filled().to_vec() };
        c.store_at(&mut &mut room[..], 3);
        let mut out = bun_simd::mem::Output::new(&mut room);
        out.push(b.to_array().as_ref());
        out.push(c);
        all.extend_from_slice(out.filled());
        all.extend_from_slice(a.to_array().as_ref());
        all
    } => |m| [&m.a[..], &m.b, &m.c, &m.a].concat();
    chunks sizes 0..=64, |d, _, _, _, io| {
        let all = io.slice::<T>();
        let (chunks, rest) = d.over(&all[..io.up_to(all.len())]).exact();
        let mut out = vec![];
        for v in chunks.rev() { out.extend_from_slice(v.to_array().as_ref()) }
        (out, rest.to_vec())
    } => |m| {
        let all = m.slice();
        let chunks = all[..m.io.up_to(all.len())].chunks_exact(m.n);
        [chunks.clone().rev().flatten().copied().collect(), chunks.remainder().to_vec()].concat()
    };
    dup128 sizes 0..=64, |d, _, _, _, io| [d.load_block(&io.slice::<T>()[1..]), d.repeat(&io.load(d.isa().of::<T, B16>(), 1).to_array())]
        => |m| [m.each(|i| m.slice()[1 + i % m.block]), m.each(|i| m.b[i % m.block])].concat();
    load_interleaved2 sizes 0..=64, |d, _, _, _, io| d.load_interleaved::<2>(&io.slice::<T>()) => |m| strided(m, 2);
    load_interleaved3 sizes 0..=64, |d, _, _, _, io| d.load_interleaved::<3>(&io.slice::<T>()) => |m| strided(m, 3);
    load_interleaved4 sizes 0..=64, |d, _, _, _, io| d.load_interleaved::<4>(&io.slice::<T>()) => |m| strided(m, 4);
    store_interleaved2 sizes 0..=64, |d, a, b, _, _| { let mut to = vec![T::default(); 2 * d.lanes()]; a.isa().store_interleaved([a, b], &mut to); to }
        => |m| zipped(m, 2);
    store_interleaved3 sizes 0..=64, |d, a, b, c, _| { let mut to = vec![T::default(); 3 * d.lanes()]; a.isa().store_interleaved([a, b, c], &mut to); to }
        => |m| zipped(m, 3);
    store_interleaved4 sizes 0..=64, |d, a, b, c, io|
        { let mut to = vec![T::default(); 4 * d.lanes()]; a.isa().store_interleaved([a, b, c, io.load(d, 3)], &mut to); to } => |m| zipped(m, 4);
    slices sizes 0..=64, |d, a, _, _, io| { let mut all = io.slice::<T>(); let v = d.load_at(&all[..], 3); a.store_at(&mut &mut all[..], 1); (v, all) }
        => |m| read_write(m);
    cells sizes 0..=64, |d, a, _, _, io| {
        let mut all = io.slice::<T>();
        let mut cells = Cell::from_mut(&mut all[..]).as_slice_of_cells();
        let v = d.load_at(cells, 3);
        a.store_at(&mut cells, 1);
        (v, all)
    } => |m| read_write(m);
    atomic8 [u8] 0..=64, |d, a, _, _, io| atomic!(d, a, io, AtomicU8) => |m| read_write(m);
    atomic16 [u16] 0..=64, |d, a, _, _, io| atomic!(d, a, io, AtomicU16) => |m| read_write(m);
    atomic32 [u32] 0..=64, |d, a, _, _, io| atomic!(d, a, io, AtomicU32) => |m| read_write(m);
}
#[cfg(target_has_atomic = "64")]
cases! { atomic64 [u64] 0..=64, |d, a, _, _, io| atomic!(d, a, io, AtomicU64) => |m| read_write(m); }
