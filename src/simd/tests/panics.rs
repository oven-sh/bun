//! Each check of values in src/ fails once, with its own message. misfits.rs has those of types.
#![allow(dead_code, unreachable_pub)]
#![cfg(panic = "unwind")]
#![forbid(unsafe_code)]
use bun_simd::{mem::*, target::*, text::*, *};
use core::sync::atomic::AtomicU8;
use core::{cell::Cell, mem::MaybeUninit, ops::Bound};
#[path = "framework/on.rs"]
mod on;
use on::*;

#[inline(never)]
fn expect(message: &str, code: &str, f: &mut dyn FnMut()) {
    thread_local! { static FILE: Cell<bool> = const { Cell::new(false) }; }
    static HOOK: std::sync::Once = std::sync::Once::new();
    HOOK.call_once(|| {
        let print = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |it| {
            FILE.set(it.location().unwrap().file() == std::panic::Location::caller().file());
            print(it)
        }))
    });
    let Err(error) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) else { panic!("no panic: {code}") };
    let got =
        error.downcast_ref::<&str>().map(|it| it.to_string()).or(error.downcast_ref::<String>().cloned()).unwrap();
    assert!(got.contains(message), "{code}: {got}");
    assert!(FILE.get() || message.is_empty(), "{code}: the place is not that of the caller");
}
macro_rules! panics { ($($message:literal: $($e:expr),+;)*) => { $($(expect($message, stringify!($e), &mut || { let _ = $e; });)+)* }; }
macro_rules! d {
    ($s:ident $t:ident $w:ident) => {
        $s.of::<$t, $w>()
    };
}
macro_rules! v {
    ($s:ident $t:ident $w:ident) => {
        $s.of::<$t, $w>().zero()
    };
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn on_target() {
    let s: S = bun_simd::prelude::isa();
    let (bytes, wide) = (v!(s u8 B64), v!(s u32 B16));
    panics! {
        "": wide.swizzle_groups([0, 2]), wide.concat_swizzle_groups(wide, [0, 4]), v!(s u16 B16).swizzle_groups([0, 2]), v!(s u16 B16).concat_swizzle_groups(v!(s u16 B16), [0, 4]),
            bytes.swizzle(|_| 64), bytes.concat_swizzle(bytes, |_| 128), wide.swizzle(|_| 4), wide.concat_swizzle(wide, |_| 8),
            bytes.as_u128s().swizzle(|_| 4), bytes.as_u128s().swizzle(|_| usize::MAX / 2 + 1), bytes.as_u128s().concat_swizzle(bytes, |_| 8), bytes.as_u128s().concat_swizzle(bytes, |_| usize::MAX / 2 + 1);
    }
}

#[test]
fn checks_that_depend_on_the_target() {
    Target::ALL.iter().for_each(|&it| _ = on_target::to(it));
}

#[test]
fn values_that_dont_fit() {
    let s = Portable::new();
    let (d, v, bytes) = (d!(s u16 B16), v!(s u16 B16), v!(s u8 B16));
    let shared = [const { AtomicU8::new(0) }; 63];
    macro_rules! out {
        ($out:ident, $e:expr) => {{
            let mut room = [MaybeUninit::uninit(); 12];
            let mut $out = Output::<u16>::new(&mut room);
            let _ = $e;
        }};
    }
    panics! {
        "too few keys": Simd::aes_encrypt([bytes], &[[0; 16]][..]), Simd::aes_decrypt([bytes], &[][..]);
        "more than eight": ByteClasses::new(&[0..=0, 17..=17, 34..=34, 51..=51, 68..=68, 85..=85, 102..=102, 119..=119, 136..=136]);
        "": d.load_at(&[0; 7], 0), d.load_at(&[0; 9], 2), d.load_at(&[0; 9], usize::MAX), v.store_at(&mut [0; 7], 0), v.store_at(&mut [0; 9], 2),
            v.store_at(&mut [0; 9], usize::MAX), d.over(&[0u16; 65]).bitmask(|v| v.cast_signed().is_negative()),
            d.over(&[0u16; 3]).selected(&[7u64]).map_into(&mut [0; 2], |v| v), d.over(&[0u16; 2]).expand_into(&mut [0; 3], &[7u64], 0),
            d.over(&[0u16; 3]).zip(&[0u16; 4]).map_into(&mut [0; 2], |(a, _)| a), d.over(&[0u16; 3]).unzip_into((&mut [0; 3], &mut [0; 2]), |v| (v, v)), d.over(&[0u16; 3]).filter_map_into((&mut [0; 3], &mut [0; 2]), |v| (v.simd_eq(0), (v, v))), d.over(&[0u16; 17]).filter_map_into(&mut [0; 16], |v| (v.simd_eq(0), v)), d!(s f32 B16).over(&[0.0; 5]).mat_vec_relaxed(&[0.0; 2], &mut [0.0; 3]),
            d.over(&[0u16; 9][..]).map_into(&mut [0; 8][..], |v| v), v.compress_store_exact(&mut [0; 7], d.mask_splat(true)),
            d!(s u8 B64).load(&shared[..]), d!(s u8 B32).load_at(&shared[..], 32), d!(s u8 B16).load_at(&shared[..], 48), d!(s u8 B8).load_at(&shared[..], 56),
            v!(s u8 B64).store_at(&mut &shared[..], 0), v!(s u8 B32).store_at(&mut &shared[..], 32), bytes.store_at(&mut &shared[..], 48),
            v!(s u8 B8).store_at(&mut &shared[..], 56), bytes.store_partial_at(&mut &shared[..], 64),
            out!(out, out.push_at(v, 1)), out!(out, { out.push(v); out.push(v) }), out!(out, out.push((v, v))), out!(out, { out.push(v); out.push(v.first_n(5)) }), out!(out, { out.push(v); out.push(v.first_n(usize::MAX)) }),
            out!(out, drop(out.limit(13))), out!(out, out.limit(0).push_one(1)), out!(out, out.limit(7).push(v)), out!(out, out.streams::<2, _>(7, |_| ())), out!(out, out.streams::<2, _>(1, |[a, _]| a.push_one(1))),
            out!(out, out.streams::<2, _>(1, |[a, b]| { a.push_one(1); b.push_one(1); core::mem::swap(a, b) })),
            out!(out, out.part(0..13)), out!(out, out.part(core::ops::Range { start: 2, end: 1 })), out!(out, out.part(..).write(1, [0])),
            out!(out, out.part(..).write(13, [0; 0])), out!(out, out.part(..).write(0, [0; 13])), out!(out, out.part(0..1).write(0, [0; 2]));
    }
}

#[test]
fn more_that_dont_fit() {
    let s = Portable::new();
    let (d, v, wide, large) = (d!(s u16 B16), v!(s u16 B16), v!(s u32 B16), [0u8; 300]);
    panics! {
        "": d!(s u32 B16).gather_interleaved::<3, _>(&[0; 2], wide), d!(s u32 B16).gather_interleaved::<1, _>(&[0; 0], wide), d!(s u32 B16).gather_bytes(&[0; 3], wide);
        "another class": ByteClasses::EMPTY.with(3, ByteSet::of(b"a")).with(1, ByteSet::of(b"b"));
        "too few bits for this class": ByteClasses::EMPTY.with(1, ByteSet::of(b"aR"));
        "": v / core::hint::black_box(0), v.cast_signed() % core::hint::black_box(0);
        "": v.simd_eq(0).test(8), v.simd_eq(0).set(8, true),
            Rows::new(&[0; 20], 4, 4, 5).at(0, 0, 1, 6), Output::new(&mut [MaybeUninit::uninit(); 7]).push(v), d!(s f32 B16).over(&[0.0; 5]).mat_vec(&[0.0; 2], &mut [0.0; 3]), d!(s f32 B16).over(&[0.0; 7]).mat_vec(&[0.0; 2], &mut [0.0; 3]),
            d.over(&[0u16; 9]).scan_into(&mut [0; 8], |v| v), d.over_mut(&mut [0; 3]).select_nth(3), d.over_mut(&mut []).select_nth(0), Rows::new(&[0; 20], 4, 4, 5).at(0, 0, 5, 1), u16::values::<3>(&[0; 2]),
            Rows::new(&[0; 20], u32::MAX as usize, 1, u32::MAX as usize),
            [0u8; 3].part((Bound::Excluded(usize::MAX), Bound::Unbounded)), [0u8; 3].part(..=usize::MAX),
            baseline().over(&large).zip(&large).stream_into(&mut [0; 299], |(a, _)| a),
            d.over(&[0u16; 9]).filter_into(&mut Output::new(&mut [MaybeUninit::uninit(); 8]), |v| v.simd_eq(0)),
            d.over(&[0u16; 9]).filter_into(&mut [0; 8], |v| v.simd_eq(0)),
            d.over(&[0u16; 3]).filter_into(&mut [MaybeUninit::uninit(); 2][..], |v| v.simd_eq(0)),
            d.over(&[0u16; 9]).filter_into(&mut &[const { Cell::new(0) }; 8][..], |v| v.simd_eq(0)),
            [0u8; 3].part(..).write(2, [0; 2]), Ascii::from_bytes(b"abc").unwrap().to_vec()[..].part(..).write(2, [0u8; 2]);
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn lanes(i: usize) {
    let s: S = bun_simd::prelude::isa();
    panics! { "": v!(s u8 B16).lane_dyn(16 * i), v!(s u8 B64).lane_dyn(64 * i), v!(s u32 B64).lane_dyn(16 * i), v!(s u64 B64).lane_dyn(usize::MAX / 8 * i + 1); }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn gaps() {
    let s: S = bun_simd::prelude::isa();
    let (v, mut room) = (v!(s u16 B16), [MaybeUninit::uninit(); 12]);
    let mut out = Output::<u16>::new(&mut room);
    panics! {
        "": v.store_partial_at(&mut out, 13), v.store_partial_at(&mut out, 1), v.store_partial_at(&mut out.part(2..), 0),
            s.over(&[0u16; 4]).map_into(&mut out.part(1..5), |v| v), out.extend_from_back::<S>(0, 1).unwrap(), out.extend_from_back::<S>(1, 1).unwrap(),
            { out.push_one(1); out.extend_from_back::<S>(1, 12).unwrap() };
    }
    let (mut words, mut text) = ([MaybeUninit::uninit(); 12], [MaybeUninit::uninit(); 12]);
    let (mut words, mut text) = (Output::<u32>::new(&mut words), Output::<Ascii>::new(&mut text));
    panics! { "": v!(s u32 B64).store_partial_at(&mut words, 1), v!(s u8 B16).store_partial_at(&mut text, 13), v!(s u8 B16).store_partial_at(&mut text, 1); }
}

#[test]
fn lanes_and_values_that_are_not_there() {
    Target::ALL.iter().for_each(|&it| _ = (lanes::to(it, std::hint::black_box(1)), gaps::to(it)));
}

#[test]
fn a_few_bytes_too_many() {
    for n in [1, 3, 4, 16, 17] {
        let bytes = std::hint::black_box(vec![1u8; n]);
        panics! { "the `Output` is": Output::overwrite(&mut vec![0u8; n - 1]).push(&bytes); }
    }
}

#[test]
#[should_panic = "divide by zero"]
fn by_zero() {
    let s = Portable::new();
    let _ = v!(s u32 B16) / core::hint::black_box(0);
}

#[test]
#[should_panic = "divide by zero"]
fn by_zero_64() {
    let s = Portable::new();
    let _ = v!(s i64 B16) / core::hint::black_box(0);
}

#[test]
fn no_divisor() {
    assert!(math::Divisor::new(0u8).is_none() && math::Divisor::new(0i64).is_none());
}

#[test]
fn slices_that_are_too_short() {
    let s = Portable::new();
    panics! { "too short": d!(s u8 B8).load(&[0; 7]), d!(s u8 B16).load(&[0; 15]), v!(s u8 B8).store(&mut [0; 7][..]), v!(s u8 B16).store(&mut [0; 15][..]); }
}
