//! All loads take cells and shared memory, and all stores uninitialized memory, with the results of plain slices.
#![allow(dead_code, unreachable_pub)]
use bun_simd::{mem::*, target::*, *};
use core::cell::Cell;
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn loads<T: Unsigned, W: Width, E: Readable<T>>(from: &[E], short: usize, seed: &[T], _of: W) -> Vec<T> {
    let s: S = bun_simd::prelude::isa();
    let v = s.load::<T, W>(seed);
    let (mask, mut all) = (v.any_bits(T::from_usize(2)), vec![]);
    let mut put = |v: Simd<T, W, S>| all.extend_from_slice(v.to_array().as_ref());
    put(s.load_padded(&from[..short], seed[0]));
    put(s.load_select(&from[..short], mask, v));
    put(s.load_select_or_default(&from[..short], mask));
    put(s.load_expand(&from[..short], mask));
    put(s.load_block(&from[..16 / size_of::<T>()]));
    let n = Simd::<T, W, S>::LANES;
    for v in s.load_interleaved::<T, W, 2>(&from[..2 * n]) {
        put(v)
    }
    for v in s.load_interleaved::<T, W, 3>(&from[..3 * n]) {
        put(v)
    }
    for v in s.load_interleaved::<T, W, 4>(&from[..4 * n]) {
        put(v)
    }
    if const { size_of::<T>() <= 4 } {
        put(s.load_3_of_4(&from[..n / 4 * 3]))
    }
    put(s.gather_or_default(&from[..short], v));
    put(s.gather_or(&from[..short], v, seed[1]));
    put(s.gather_select(&from[..short], mask, v, seed[1]));
    all
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn stores<T: Unsigned, W: Width, E: Writable<T>>(op: usize, to: &mut [E], seed: &[T], _of: W) -> usize {
    let s: S = bun_simd::prelude::isa();
    let n = Simd::<T, W, S>::LANES;
    let (a, b) = (s.load::<T, W>(seed), s.load::<T, W>(&seed[n..]));
    let mask = a.any_bits(T::from_usize(2));
    match op {
        0 => {
            s.store_interleaved([a, b], to);
            2 * n
        }
        1 => {
            s.store_interleaved([a, b, !a], to);
            3 * n
        }
        2 => {
            s.store_interleaved([a, b, !a, !b], to);
            4 * n
        }
        3 => {
            if const { size_of::<T>() <= 4 } {
                a.store_3_of_4(to)
            }
            4 * n
        }
        4 => {
            a.store_select(to, mask);
            4 * n
        }
        5 => {
            b.scatter(to, a);
            4 * n
        }
        6 => {
            b.scatter_select(to, mask, a);
            4 * n
        }
        7 => {
            let count = a.compress_store_exact(&mut to[..mask.count()], mask);
            assert_eq!(count, mask.count());
            4 * n
        }
        _ => a.compress_store(to, mask),
    }
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn low_bytes<W: Width, E: Readable<u8>, F: Writable<u8>>(from: &[E], to: &mut [F], more: u64, _of: W) -> usize {
    let s: S = bun_simd::prelude::isa();
    let (v, n) = s.load_low_bytes::<u32, W>(from, more);
    assert_eq!(v.store_low_bytes(to, more), n);
    n
}
fn init<T: Copy>(all: &[MaybeUninit<T>]) -> &[T] {
    // SAFETY: all were initialized before the call, which writes values only.
    unsafe { all.assume_init_ref() }
}

macro_rules! all { ($($name:ident $t:ident $n:literal [$($w:ident)*];)*) => {$( #[test] fn $name() {$(
    let n = $w::BYTES / $n;
    for round in 0..if cfg!(miri) { 1 } else { 40 } {
        let values = |k: usize| (0..4 * n + 16).map(|i| ((i * k + round * 31) % 199) as $t).collect::<Vec<_>>();
        let (from, seed) = (values(37), values(53 + round));
        let bytes: Vec<AtomicU8> = from.iter().flat_map(|it| it.to_ne_bytes()).map(AtomicU8::new).collect();
        let cells: Vec<_> = from.iter().copied().map(Cell::new).collect();
        for &target in Target::ALL {
            let short = round * 7 % (n + 3);
            let Some(want) = loads::to(target, &from, short, &seed, $w) else { continue };
            if $n == 4 { assert_eq!(loads::to(target, &cells.iter().map(|it| Cell::new(it.get() as u32)).collect::<Vec<_>>(), short, &seed.iter().map(|&it| it as u32).collect::<Vec<_>>(), B32).unwrap(), want.iter().map(|&it| it as u32).collect::<Vec<_>>()); }
            assert_eq!(loads::to(target, all!(@shared $t $n bytes), short, &seed, $w).unwrap(), want, "{target:?}");
            for op in 0..9 {
                let (mut plain, mut uninit) = (vec![201 as $t; 4 * n + 1], vec![MaybeUninit::new(201 as $t); 4 * n + 1]);
                let count = stores::to(target, op, &mut plain[..4 * n], &seed, $w).unwrap();
                assert_eq!(stores::to(target, op, &mut uninit[..4 * n], &seed, $w), Some(count));
                assert_eq!((&plain[..count], &plain[if op == 8 { n } else { count }..]), (&init(&uninit)[..count], &init(&uninit)[if op == 8 { n } else { count }..]), "{target:?} {op}");
            }
        }
    }
)*} )*};
(@shared u8 $n:literal $b:ident) => { &$b }; (@shared $t:ident $n:literal $b:ident) => { $b.as_chunks::<$n>().0 }; }
all! { of_u8 u8 1 [B16]; of_u16 u16 2 [B64]; of_u32 u32 4 [B32]; of_u64 u64 8 [B128]; }

#[test]
fn bytes() {
    fn at<W: Width + Copy>(w: W) {
        let from: Vec<u8> = (1..=W::BYTES as u8).collect();
        let shared: Vec<_> = from.iter().copied().map(AtomicU8::new).collect();
        for &target in Target::ALL {
            for more in [0, !0, 0x1b1b_e4e4, 0x9c63_7a05] {
                let mut to = vec![MaybeUninit::new(0); W::BYTES];
                let Some(n) = low_bytes::to(target, &shared, &mut to, more, w) else { continue };
                assert_eq!(init(&to)[..n], from[..n], "{target:?}");
            }
        }
    }
    at(B16);
    at(B64);
}
