//! Shared memory and `Output`, on all targets. Under Miri this is an exhaustive check of small sizes.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{mem::*, target::*, *};
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicBool, AtomicU8, Ordering::Relaxed};
use std::panic::{AssertUnwindSafe, catch_unwind};

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn copy<T: Lane, W: Width, F: Readable<T>, G: Sink<T>>(from: &[F], mut to: G, _of: (T, W)) {
    let s: S = bun_simd::prelude::isa();
    let mut at = 0;
    while from.len() - at >= Simd::<T, W, S>::LANES {
        s.load_at::<T, W>(from, at).store_at(&mut to, at);
        at += Simd::<T, W, S>::LANES;
    }
    let rest = s.load_or_default::<T, W>(&from[at..]);
    assert!(
        (rest.cast_unsigned().simd_ne(s.zero::<T::Unsigned, W>())
            & !s.mask_first_n::<<T::Unsigned as bun_simd::Lane>::Signed, W>(from.len() - at))
        .none()
    );
    rest.store_partial_at(&mut to, at);
}

fn atomics(n: usize, first: u8) -> Vec<AtomicU8> {
    (0..n).map(|i| AtomicU8::new(first.wrapping_add(i as u8) | 1)).collect()
}
fn values(all: &[AtomicU8]) -> Vec<u8> {
    all.iter().map(|it| it.load(Relaxed)).collect()
}

macro_rules! copies { ($($t:ident $n:literal [$($w:ident)*])*) => {$($(
    for &target in Target::ALL {
        for len in 0..=if cfg!(miri) { $w::BYTES / $n + 1 } else { 3 * $w::BYTES / $n } {
            let (from, to) = (atomics(len * $n + 9, 3), atomics(len * $n + 9, 100));
            let mut expected = values(&to);
            expected[3..][..len * $n].copy_from_slice(&values(&from)[1..][..len * $n]);
            let (a, b) = (from[1..][..len * $n].as_chunks::<$n>().0, to[3..][..len * $n].as_chunks::<$n>().0);
            if copy::to(target, a, b, (0 as $t, $w)).is_some() {
                assert_eq!(values(&to), expected, "{target:?} {len}");
            }
        }
    }
)*)*}; }

#[test]
fn shared_lanes() {
    copies!(i8 1 [B2 B4 B8 B16 B32 B64] u16 2 [B2 B4 B8 B16 B32 B64] f32 4 [B4 B8 B16 B32 B64] u64 8 [B8 B16 B32 B64]);
}

#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs threads or unwinding")]
fn shared_arrays() {
    fn one<const N: usize>() {
        let (from, to) = (atomics(N + 2, 1), atomics(N + 2, 50));
        let read: [u8; N] = AtomicU8::values(&from[1..]);
        assert_eq!(read[..], values(&from)[1..][..N]);
        (&to[..]).part(..).write(1, read);
        assert_eq!(values(&to), [&[51], &read[..], &[(51 + N as u8) | 1]].concat());
        assert!(catch_unwind(|| AtomicU8::values::<N>(&from[3..])).is_err());
    }
    one::<1>();
    one::<2>();
    one::<3>();
    one::<4>();
    one::<7>();
    one::<8>();
    one::<15>();
    one::<16>();
    one::<33>();
}

/// Each byte that is read is one that was written.
#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs threads or unwinding")]
fn races() {
    let (shared, stop) = (atomics(200, 0), AtomicBool::new(false));
    shared.iter().for_each(|it| it.store(1, Relaxed));
    std::thread::scope(|scope| {
        scope.spawn(|| {
            while !stop.load(Relaxed) {
                copy(&[0xfe; 199][..], &shared[1..], (0u8, B64));
                shared.iter().for_each(|it| it.store(1, Relaxed));
            }
        });
        for round in 0..if cfg!(miri) { 3 } else { 20000 } {
            let mut seen = [1; 200];
            copy(&shared[round % 7..], &mut seen[round % 7..], (0u8, B32));
            assert!(seen.iter().all(|&it| it == 1 || it == 0xfe));
        }
        stop.store(true, Relaxed);
    });
}

const STEPS: usize = 12;

/// Does the same to both. A step that the model can't take has to panic.
fn step(op: usize, out: &mut Output<'_, u8>, model: &mut Vec<u8>, x: u8) {
    let v = Portable::new().from::<u8, B2>([x, x + 1]);
    let (room, len) = (out.room(), out.len());
    let other = Box::leak(Box::new([MaybeUninit::new(0); 2]));
    let (fits, action): (bool, Box<dyn FnOnce(&mut Output<'_, u8>)>) = match op {
        0 => (room >= 1, Box::new(|out| out.push_one(x))),
        1 => (room >= 2, Box::new(|out| out.push(v))),
        2 => (room >= 1, Box::new(|out| out.push(v.first_n(1)))),
        3 => (room >= 2, Box::new(|out| out.push(v.first_n(9)))),
        4 => (len >= 1 && room >= 1, Box::new(|out| out.push_at(v, len.wrapping_sub(1)))),
        5 => (false, Box::new(|out| out.push_at(v, len + 1))),
        6 => (true, Box::new(|out| out.truncate(len / 2))),
        7 => (true, Box::new(|out| out.truncate(len + 1))),
        8 => (
            room >= 2,
            Box::new(|out| {
                out.streams(1, |[a, b]| {
                    b.push_one(x + 1);
                    a.push_one(x)
                })
            }),
        ),
        9 => (false, Box::new(|out| out.streams(1, |[_, b]| b.push_one(x)))),
        10 => (
            false,
            Box::new(|out| {
                out.streams(1, |[a, b]| {
                    a.push_one(x);
                    b.push_one(x);
                    b.truncate(0);
                    a.truncate(1);
                    core::mem::swap(a, b);
                    a.push_one(x)
                })
            }),
        ),
        _ => (
            room >= 2,
            Box::new(|out| {
                let it = &mut out.limit(2);
                **it = Output::new(other);
                it.push(v)
            }),
        ),
    };
    assert_eq!(catch_unwind(AssertUnwindSafe(|| action(out))).is_ok(), fits, "{op}");
    match op {
        _ if !fits => {}
        0 | 2 => model.push(x),
        4 => {
            model.pop();
            model.extend([x, x + 1])
        }
        6 => model.truncate(len / 2),
        7 | 11 => {}
        _ => model.extend([x, x + 1]),
    }
    assert_eq!(out.filled(), &model[..]);
}

#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs threads or unwinding")]
fn all_sequences() {
    std::panic::set_hook(Box::new(|_| {}));
    let depth = if cfg!(miri) {
        2
    } else if cfg!(target_arch = "x86_64") {
        4
    } else {
        3
    };
    for capacity in 0..=5 {
        for sequence in 0..STEPS.pow(depth) {
            let (mut vec, mut model) = (vec![7], vec![]);
            {
                let out = &mut Output::append(&mut vec, capacity);
                for i in 0..depth {
                    step(sequence / STEPS.pow(i) % STEPS, out, &mut model, 10 * (i as u8 + 1));
                }
            }
            assert_eq!(vec[1..], model);
        }
    }
    let mut vec = vec![1u8];
    assert!(
        catch_unwind(AssertUnwindSafe(|| {
            let out = &mut Output::append(&mut vec, 4);
            out.push_one(2);
            panic!()
        }))
        .is_err()
    );
    assert_eq!(vec, [1, 2]);
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn compress<T: Lane, W: Width>(from: &[T], bits: u64, out: &mut Output<'_, T>, _of: W) {
    let s: S = bun_simd::prelude::isa();
    out.push(s.load::<T, W>(from).selected(bits));
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn indices(bits: u64, out: &mut Output<'_, u32>) {
    let s: S = bun_simd::prelude::isa();
    let len = out.len();
    let count = s.set_bit_positions(bits, 5, out);
    assert_eq!(out.len(), len + count);
}

#[test]
fn compressed() {
    macro_rules! one { ($($t:ident [$($w:ident)*])*) => {$($(
        let from: Vec<$t> = (0..$w::BYTES / size_of::<$t>()).map(|i| i as $t + 1 as $t).collect();
        for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
            for round in 0..if cfg!(miri) { 2u64 } else { 300 } {
                let bits = round.wrapping_mul(0x9e37_79b9_7f4a_7c15) | round.wrapping_mul(0xd1b5_4a32_d192_ed03) >> 7;
                let mut memory = [MaybeUninit::uninit(); 65];
                let mut out = Output::new(&mut memory[..from.len() + 1]);
                out.push_one(0 as $t);
                compress::to(target, &from, bits, &mut out, $w);
                let kept: Vec<_> = from.iter().enumerate().filter(|(i, _)| bits >> i & 1 != 0).map(|it| *it.1).collect();
                assert_eq!(out.into_filled()[1..], kept);
                let mut all = vec![9];
                indices::to(target, bits, &mut Output::append(&mut all, 64));
                assert!(all[1..].iter().copied().eq((0..64).filter(|i| bits >> i & 1 != 0).map(|i| i + 5)));
            }
        }
    )*)*}; }
    one!(u8 [B4 B16 B32 B64] i16 [B8 B32 B64] u32 [B16 B64] f64 [B8 B32 B64]);
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn ends(bytes: &[AtomicU8]) -> [Option<usize>; 2] {
    let s: S = bun_simd::prelude::isa();
    [s.over(bytes).position(|v| v.simd_eq(1)), s.over(bytes).rposition(|v| v.simd_eq(1))]
}

/// Loads that overlap can see two values of one byte. What is found is still the byte that changes.
#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs threads or unwinding")]
fn searches_in_races() {
    let (bytes, done) = ([0; 300].map(AtomicU8::new), AtomicBool::new(false));
    std::thread::scope(|scope| {
        scope.spawn(|| {
            while !done.load(Relaxed) {
                bytes[150].fetch_xor(1, Relaxed);
            }
        });
        let wrong = Target::ALL.iter().find_map(|&target| {
            (1..if cfg!(miri) { 9 } else { 140 }).flat_map(|len| (0..len).map(move |at| (len, at))).find_map(
                |(len, at)| {
                    let rounds = if cfg!(miri) {
                        2
                    } else if len < 32 {
                        200
                    } else {
                        2
                    };
                    (0..rounds)
                        .filter_map(|_| ends::to(target, &bytes[150 - at..][..len]))
                        .flatten()
                        .flatten()
                        .find(|&it| it != at)
                        .map(|it| (target, len, at, it))
                },
            )
        });
        done.store(true, Relaxed);
        assert_eq!(wrong, None);
    });
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn ends_by<T: Int, W: Width, E: Readable<T>>(values: &[E], of: T, _by: W) -> [Option<usize>; 2] {
    let s: S = bun_simd::prelude::isa();
    let all = s.over(values).by::<W>();
    [all.position(|v| v.simd_eq(of)), all.rposition(|v| v.simd_eq(of))]
}

/// Groups of vectors are loaded from one address.
#[test]
fn long_searches() {
    macro_rules! one { ($($t:ident $n:literal [$($w:ident)*])*) => {$($(
        let bytes = atomics(800, 0);
        bytes.iter().for_each(|it| it.store(0, Relaxed));
        for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
            for (skip, len) in [(0, 640), (3, 704), (40, 352), (61, 200)].into_iter().take(if cfg!(miri) { 1 } else { 4 }) {
                let len = if cfg!(miri) { len.min(5 * $w::BYTES) } else { len };
                let values: &[Shared<$n>] = bytes[skip..][..len].as_chunks().0;
                assert_eq!(ends_by::to(target, values, !0 as $t, $w), Some([None; 2]));
                for at in (0..values.len()).skip(if cfg!(miri) { values.len() / 2 } else { 0 }).step_by(if cfg!(miri) { 640 } else { 1 }) {
                    values[at].iter().for_each(|it| it.store(255, Relaxed));
                    assert_eq!(ends_by::to(target, values, !0 as $t, $w), Some([Some(at); 2]));
                    if $n == 1 {
                        assert_eq!(ends_by::to(target, values.as_flattened(), 255u8, $w), Some([Some(at); 2]));
                    }
                    values[at].iter().for_each(|it| it.store(0, Relaxed));
                }
            }
        }
    )*)*}; }
    one!(i8 1 [B4 B8 B16 B32 B64 B128 B256] u16 2 [B16 B32 B64] u32 4 [B32 B64] u64 8 [B16 B32 B64 B128]);
}
