//! All stores and loops write to the little-endian bytes of lanes, at any address, what they write to plain slices.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{mem::*, target::*, *};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

/// Returns how many values count. With `true`, those after them stay as they were.
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn stores<T: Lane, W: Width, E: Writable<T>>(op: usize, to: &mut [E], x: &[T], _of: W) -> (usize, bool) {
    let s: S = bun_simd::prelude::isa();
    let (n, len) = (Simd::<T, W, S>::LANES, to.len());
    let (a, b) = (s.load::<T, W>(x), s.load::<T, W>(&x[n..]));
    let keeps = |v: Simd<T, W, S>| v.simd_lt(x[1]);
    let turn = |v: Simd<T, W, S>| (!v.cast_unsigned()).bitcast::<T>();
    let (mask, from, at) = (keeps(a), &x[..len], a.cast_unsigned() & T::Unsigned::from_usize(31));
    let all = s.over(from).by::<W>();
    match op {
        0 => a.store_partial(to),
        1 => s.store_interleaved_partial([a, b], to),
        2 => s.store_interleaved_partial([a, b, turn(a)], to),
        3 => s.store_interleaved_partial([a, b, turn(a), turn(b)], to),
        4 => s.store_interleaved_partial([a, b, turn(a), turn(b), a], to),
        5 => b.scatter(to, at),
        6 => b.scatter_select(to, mask, at),
        7 => all.map_into(to, turn),
        8 => all.zip(&x[1..]).map_into(
            to,
            #[inline(always)]
            |(a, b)| keeps(a).select(a, b),
        ),
        9 => return (all.filter_into(to, keeps), false),
        10 => return (all.map_until(to, keeps, turn), false),
        11 => all.stream_into(to, turn),
        12 => a.store_partial_at(to, len / 2),
        13 => s.over(&x[..len / 2]).by::<W>().zip(x).map_into(
            to,
            #[inline(always)]
            |(a, b)| [turn(a), b],
        ),
        14 => {
            return (
                all.zip(x).filter_map_into(
                    to,
                    #[inline(always)]
                    |(a, b)| (keeps(a), turn(b)),
                ),
                false,
            );
        }
        15 if len <= n => s.load_short::<T, W>(from).store_short(to),
        16 if len >= mask.count() => _ = a.compress_store_exact(to, mask),
        _ if len < n => {}
        17 => a.store(to),
        18 => a.store_last(to),
        19 => a.store_at(to, len - n),
        20 => a.store_select(to, mask),
        21 => return (a.compress_store(to, mask), false),
        22 if const { size_of::<T>() <= 4 } => live(a, to),
        23 if len >= 2 * n => s.store_interleaved([a, b], to),
        24 if len >= 3 * n => s.store_interleaved([a, b, turn(a)], to),
        25 if len >= 4 * n => s.store_interleaved([a, b, turn(a), turn(b)], to),
        26 if len >= 5 * n => s.store_interleaved([a, b, turn(a), turn(b), b], to),
        _ => {}
    }
    (len, true)
}
#[inline(always)]
fn live<S: Isa, T: Lane, W: Width>(v: Simd<T, W, S>, to: &mut [impl Writable<T>]) {
    if const { W::BYTES >= 16 } {
        v.store_3_of_4(to)
    }
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn copies<T: Lane, E: Readable<T>, G: Sink<T>>(from: &[E], mut to: G) {
    let s: S = bun_simd::prelude::isa();
    s.over(from).map_into(
        &mut to,
        #[inline(always)]
        |v| v,
    )
}

macro_rules! all { ($($name:ident $t:ident $u:ident $n:literal [$($w:ident)*];)*) => {$( #[test] fn $name() {
    let little = |all: &[$t]| bitcast_slice::<$u>(all).iter().flat_map(|it| it.to_le_bytes()).collect::<Vec<_>>();
    let values = |k: usize, len: usize| (0..len).map(|i| (i * k % 199 * 0x0103_0507 >> 2) as $u).collect::<Vec<_>>();
    $(
        let n = $w::BYTES / $n;
        let lens = (0..6 * n + 2).chain([40 * n + 1, 300]).filter(|&it| !cfg!(miri) || it == n / 2 + 1 || it == 5 * n + 1);
        for (len, op) in lens.flat_map(|len| (0..27).map(move |op| (len, op))) {
            let (x, before) = (values(37 + len, len.max(2 * n) + 1), values(11, len));
            let x = bitcast_slice::<$t>(&x);
            for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
                let mut plain = bitcast_slice::<$t>(&before).to_vec();
                let skip = (len + op) % 5;
                let mut bytes = [vec![0xa5; skip], little(&plain), vec![0xa5; 3]].concat();
                let Some(want) = stores::to(target, op, &mut plain, x, $w) else { continue };
                assert_eq!(stores::to(target, op, bytes[skip..][..len * $n].as_chunks_mut::<$n>().0, x, $w), Some(want), "{target:?} {op} {len}");
                assert_eq!(bytes[skip..][..want.0 * $n], little(&plain[..want.0]), "{target:?} {op} {len}");
                assert!(bytes[..skip].iter().chain(&bytes[skip + len * $n..]).all(|&it| it == 0xa5), "{target:?} {op} {len}");
            }
        }
    )*
    for (len, &target) in (0..if cfg!(miri) { 3 } else { 150 }).flat_map(|len| Target::ALL.iter().map(move |it| (len, it))) {
        let x = values(41, len);
        let bytes = [vec![0], little(bitcast_slice(&x))].concat();
        let shared: Vec<_> = (0..len * $n).map(|_| AtomicU8::new(0)).collect();
        let mut back = vec![$u::default(); len];
        let Some(()) = copies::to::<$t, _, _>(target, bytes[1..].as_chunks::<$n>().0, shared.as_chunks::<$n>().0) else { continue };
        copies::to::<$t, _, _>(target, shared.as_chunks::<$n>().0, bitcast_slice_mut::<$t>(&mut back));
        assert!(back == x && shared.iter().map(|it| it.load(Relaxed)).eq(as_bytes(&x).iter().copied()), "{target:?} {len}");
    }
} )*}; }
all! {
    of_i8 i8 u8 1 [B16]; of_u16 u16 u16 2 [B8 B64]; of_f16 f16 u16 2 [B16]; of_bf16 bf16 u16 2 [B32];
    of_u32 u32 u32 4 [B32 B128]; of_f32 f32 u32 4 [B16]; of_u64 u64 u64 8 [B64];
}
