#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use core::{cell::Cell, mem::MaybeUninit};
use framework::*;

fn kept(m: &Model, keep: impl Fn(usize) -> bool) -> Lanes {
    let mut all: Lanes = (0..m.n).filter(|&i| keep(i)).map(|i| m.a[i]).collect();
    all.resize(m.n, 0);
    all
}
#[inline(always)]
fn like<S: Isa, T: Lane, W: Width>(_: Simd<T, W, S>, v: Simd<T, W, S>) -> Simd<T, W, S> {
    v
}

cases! {
    compress all 0..=64, |d, a, b, _, io| [a.compress(b.cast_signed().is_negative()), a.compress(io.n)]
        => |m| [kept(m, |i| m.mb[i]), kept(m, |i| m.io.n >> i & 1 == 1)].concat();
    index all 0..=64, |d, a, b, _, io| { let (i, mut c) = (io.up_to(d.lanes() - 1), a); c[i] = b[i]; [c, a.with_lane_dyn(i, b[i])] }
        => |m| { let i = m.io.up_to(m.n - 1); let it = m.each(|k| if k == i { m.b[k] } else { m.a[k] }); [it.clone(), it].concat() };
    loads all 0..=64, |d, a, b, _, io| {
        let (s, mut plain, n) = (a.isa(), io.slice::<T>(), io.up_to(d.lanes() + 1));
        let first = [s.load(&plain), s.load_at(&plain, 1), s.load_last(&plain), s.load_or(&plain[..n], b), s.load_or_default(&plain[..n]), s.load_bytes(&io.bytes)];
        let cells = Cell::from_mut(&mut plain[..]).as_slice_of_cells();
        let taken = like(a, s.load_padded(cells, b[0]));
        (first, [s.load(cells), s.load_at(cells, 1), s.load_last(cells), s.load_or(&cells[..n], b), s.load_or_default(&cells[..n]), taken])
    } => |m| {
        let (all, n) = (m.slice(), m.io.up_to(m.n + 1));
        let it = [m.a.clone(), m.each(|i| all[i + 1]), m.each(|i| all[all.len() - m.n + i]), m.each(|i| if i < n { all[i] } else { m.b[i] }),
            m.each(|i| if i < n { all[i] } else { 0 }), m.a.clone()].concat();
        [it.clone(), it].concat()
    };
    short all 0..=64, |d, a, _, _, io| {
        let (mut plain, n) = (io.slice::<T>(), io.up_to(d.lanes() - 1));
        let v = like(a, a.isa().load_short(Cell::from_mut(&mut plain[..n]).as_slice_of_cells()));
        let mut out = vec![T::default(); n + 1];
        v.store_short(&mut out[..n]);
        out
    } => |m| [&m.slice()[..m.io.up_to(m.n - 1)], &[0]].concat();
    stores all 0..=64, |d, a, b, _, io| {
        let (n, lanes) = (io.up_to(d.lanes() + 1), d.lanes());
        let mut all = vec![T::default(); 5 * lanes + 3];
        a.store_at(&mut all, 1);
        b.store_partial_at(&mut all[..lanes + 1 + n], lanes + 1);
        let mut cells = Cell::from_mut(&mut all[2 * lanes + 2..]).as_slice_of_cells();
        b.store_at(&mut cells, 0);
        a.store_partial_at(&mut &cells[..lanes + n], lanes);
        a.store(&mut all[4 * lanes + 3..]);
        all
    } => |m| {
        let (n, part) = (m.io.up_to(m.n + 1), |v: &Lanes, n| (0..=m.n).map(|i| if i < n && i < m.n { v[i] } else { 0 }).collect());
        [vec![0], m.a.clone(), part(&m.b, n), m.b.clone(), part(&m.a, n), m.a.clone()].concat()
    };
    interleaved sizes 4..=64, |d, a, b, c, _| {
        let (s, mut all) = (a.isa(), vec![T::default(); 4 * d.lanes()]);
        s.store_interleaved([a, b], &mut all);
        let two: [_; 2] = s.load_interleaved(&all);
        s.store_interleaved([a, b, c], &mut all);
        let three: [_; 3] = s.load_interleaved(&all);
        s.store_interleaved([a, b, c, a], &mut all);
        let four: [_; 4] = s.load_interleaved(&all);
        ([like(a, two[0]), two[1], three[0], three[1], three[2], four[0], four[1], four[2], four[3]], all)
    } => |m| {
        let all = (0..4 * m.n).map(|i| [&m.a, &m.b, &m.c, &m.a][i % 4][i / 4]).collect();
        [&m.a, &m.b, &m.a, &m.b, &m.c, &m.a, &m.b, &m.c, &m.a, &all].map(|it| it.clone()).concat()
    };
}

#[test]
fn uninit_arrays_and_std() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        let v = u8x8::from(*b"abcdefgh");
        let mut to = [MaybeUninit::uninit(); 12];
        v.store(&mut to);
        v.store_last(&mut to);
        v.store_at(&mut to, 2);
        v.store_partial(&mut to[9..]);
        v.store_short(&mut to[..3]);
        v.bitcast::<u16>().store_bytes(&mut to);
        let (mut array, mut aligned, mut boxed) = ([0; 9], Aligned([0; 9]), vec![0; 9].into_boxed_slice());
        v.store_at(&mut array, 1);
        v.store_at(&mut aligned, 1);
        v.store_at(&mut boxed, 1);
        assert_eq!([&array, &aligned.0, &*boxed], [b"\0abcdefgh"; 3]);
        let mut room = [MaybeUninit::uninit(); 70];
        let mut out = Output::new(&mut room);
        set_bit_positions(0b1010, 5, &mut out);
        out.push(u32x4::iota(1).selected(0b1001));
        out.push(u32x4::iota(1).selected(u32x4::iota(0).simd_eq(1)));
        out.push(u32x4::iota(7).first_n(1));
        out.push((&[9, 9]).first_n(1));
        assert_eq!(out.filled(), [6, 8, 1, 4, 2, 7, 9]);
        let table = [10u32, 11, 12];
        let at = u32x4::from([2, 0, 3, 1]);
        assert_eq!(u32x4::gather_or_default(&table, at).to_array(), [12, 10, 0, 11]);
        assert_eq!(u32x4::gather_or(&table, at, 7).to_array(), [12, 10, 7, 11]);
        assert_eq!(u32x4::gather_select(&table, at.simd_ne(0), at, 7).to_array(), [12, 7, 7, 11]);
        let mut table = [0; 3];
        at.scatter_select(&mut table, at.simd_ne(1), at);
        assert_eq!(table, [0, 0, 2]);
        assert_eq!(u32x4::load_select(&table, at.simd_ne(0), 5).to_array(), [0, 5, 2, 5]);
        assert_eq!(u32x4::load_select_or_default(&[1, 2, 3], at.simd_ne(0)).to_array(), [1, 0, 3, 0]);
        assert_eq!(u32x4::load_expand(&[1, 2, 3], at.simd_ne(0)).to_array(), [1, 0, 2, 3]);
        assert_eq!(u32x8::load_block(&[1, 2, 3, 4, 5]).to_array(), [1, 2, 3, 4, 1, 2, 3, 4]);
        assert_eq!(u32x4::load_padded(&[1], 9).to_array(), [1, 9, 9, 9]);
        assert_eq!(u32x4::load_3_of_4(&[1, 2, 3]).to_array(), [1, 2, 3, 0]);
        let (mut four, mut two) = ([0; 4], [0; 2]);
        at.store_select(&mut four, at.simd_gt(1));
        assert_eq!(four, [2, 0, 3, 0]);
        assert_eq!((at.compress_store(&mut four, 0b1100), at.compress_store_exact(&mut two, at.simd_lt(2))), (2, 2));
        assert_eq!((&four[..2], two, at.compress_relaxed(0b100)[0]), (&[3, 1][..], [0, 1], 3));
    }
    on::<bun_simd::target::Baseline>()
}
