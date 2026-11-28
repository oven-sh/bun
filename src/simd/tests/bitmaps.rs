//! Loops over bitmaps, indices, and bits in memory.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{mem::*, target::*, *};
use core::cell::Cell;
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU64;

const FEW: Targets = Targets(&[
    target!(icelake),
    target!(avx512),
    target!(avx2),
    target!(sse4),
    target!(sve2),
    target!(neon),
    target!(wasm),
    target!(portable),
]);
/// All targets would take three times as long to compile.
fn each(mut test: impl FnMut(Target)) {
    static CPU: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = CPU.lock().unwrap_or_else(|it| it.into_inner());
    for &target in FEW.0 {
        if set_cpu(target) {
            test(target)
        }
    }
    reset_cpu()
}
fn random(state: &mut u64) -> u64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    (*state ^ *state >> 29).wrapping_mul(0x9e37_79b9_7f4a_7c15).rotate_left(17)
}
/// Words of all densities.
fn bitmap(words: usize, state: &mut u64) -> Vec<u64> {
    let kind = random(state) % 8;
    let mut word = || match if kind == 7 { random(state) % 7 } else { kind } {
        0 => 0,
        1 => !0,
        2 => random(state),
        3 => random(state) & random(state) & random(state) & random(state),
        4 => random(state) | random(state) | random(state),
        5 => 1 << (random(state) % 64),
        _ => random(state) & random(state),
    };
    (0..words).map(|_| word()).collect()
}
fn has(bits: &[u64], i: usize) -> bool {
    bits.get(i / 64).is_some_and(|it| it >> (i % 64) & 1 != 0)
}
fn cases() -> impl Iterator<Item = (usize, usize, u64)> {
    let rounds = std::env::var("ROUNDS").map_or(if cfg!(miri) { 1 } else { 3 }, |it| it.parse().unwrap());
    let step = if cfg!(miri) { 37 } else { 1 };
    (0..rounds).flat_map(move |round| {
        (0..200usize).chain([255, 256, 257, 320, 511, 700]).step_by(step).map(move |len| {
            let words = (len.div_ceil(64) + [0, 0, 1, 0, 2][(len + round) % 5]).saturating_sub((len % 7 == 3) as usize);
            (len, words, (len * 1000 + round) as u64)
        })
    })
}

#[derive(Debug, PartialEq)]
struct Seen<T> {
    count: usize,
    sum: T,
    min: Option<T>,
    max: Option<T>,
    xor: u64,
    and: u64,
    kept: Vec<T>,
    at: Vec<u16>,
    dot: T,
    spread: Vec<T>,
    nulls: Vec<T>,
    first: Option<usize>,
    last: Option<usize>,
    odd: Vec<u64>,
    indices: Vec<u16>,
}

#[kernel(targets = FEW)]
fn ints<T: Int, W: Width>(x: &[T], y: &[T], bits: &[u64], fill: T) -> Seen<T> {
    let s: S = bun_simd::prelude::isa();
    let all = s.over(x).by::<W>();
    let some: Selected<'_, T, W, S, _> = all.selected(bits);
    let (count, len) = (some.count(), x.len().min(64 * bits.len()));
    let (same, one) = (
        #[inline(always)]
        |v: Simd<T, W, S>| v,
        T::ONE,
    );
    let (mut kept, mut roomy, mut grown, mut cells) = (vec![one; count], vec![one; count + 70], vec![one], x.to_vec());
    let cells = Cell::from_mut(&mut cells[..]).as_slice_of_cells();
    assert_eq!(some.map_into(&mut kept, same), count);
    assert_eq!(some.map_into(&mut roomy, same), count);
    assert_eq!(some.map_into(&mut Output::append(&mut grown, count + x.len() % 3 * 40), same), count);
    assert_eq!(s.over(cells).by::<W>().selected(bits).map_into(&mut &cells[..], same), count);
    assert!(kept == roomy[..count] && kept == grown[1..] && (0..count).all(|i| cells[i].get() == kept[i]));
    let mut at = vec![0; count];
    all.enumerate::<u16>().selected(bits).map_into(
        &mut at,
        #[inline(always)]
        |(i, _)| i,
    );
    let (mut spread, mut room, mut shared) = (vec![one; x.len()], vec![MaybeUninit::uninit(); len], vec![one; len]);
    let more = [&kept[..], y].concat();
    assert_eq!(s.over(&kept).by::<W>().expand_into(&mut spread, bits, fill), count);
    let mut out = Output::new(&mut room);
    assert_eq!(s.over(&more).by::<W>().expand_into(&mut out, bits, fill), count);
    let atomics: Vec<_> = bits.iter().map(|&it| AtomicU64::new(it)).collect();
    s.over(&kept).by::<W>().expand_into(&mut Cell::from_mut(&mut shared[..]).as_slice_of_cells(), &atomics, fill);
    assert!(spread[..len] == *out.into_filled() && spread[..len] == shared);
    let mut nulls = vec![one; len];
    let both = all.zip_bits(bits);
    assert_eq!(both.len(), len);
    both.map_into(
        &mut nulls,
        #[inline(always)]
        |(v, keep)| keep.select(v, fill),
    );
    let mut odd = vec![0; len.div_ceil(64)];
    let is = |(v, keep): (Simd<T, W, S>, MaskOf<T, W, S>)| v.any_bits(one) & keep;
    both.bitmask_into(&mut odd, is);
    let mut counted = 0;
    for ((_, keep), valid) in both.padded() {
        assert_eq!(keep.to_bitmask() & !valid, 0);
        counted += keep.count();
    }
    assert_eq!(counted, count);
    assert_eq!(
        both.pad(one).count(
            #[inline(always)]
            |(_, keep)| keep
        ),
        count
    );
    let (mut indices, mut scanned) = (vec![0; x.len()], vec![0; x.len()]);
    let n = all.enumerate().filter_map_into(
        &mut indices,
        #[inline(always)]
        |(i, v)| (v.any_bits(one), i),
    );
    indices.truncate(n);
    all.zip(x).enumerate::<u16>().pad(one).scan_into(
        &mut scanned,
        #[inline(always)]
        |(i, _)| i,
    );
    assert!(scanned.iter().enumerate().all(|(i, &it)| it as usize == i));
    let add = |a: Simd<T, W, S>, b: Simd<T, W, S>| a + b;
    let and = |a: Simd<T, W, S>, b: Simd<T, W, S>| a & b;
    let xor = |a: Simd<T, W, S>, b: Simd<T, W, S>| a ^ b;
    let full = !s.zero::<T, W>();
    let others = Simd::<T, W, S>::over_all([x, x]).pad(full[0]).zip_bits(&atomics).selected(&atomics).fold(
        full,
        #[inline(always)]
        |a, ([v, w], keep)| a & v & keep.select(w, full),
        and,
    );
    let and = all.pad(full[0]).selected(bits).fold(full, and, and).reduce_and();
    assert!(and == others.reduce_and());
    let mask = !0 >> (64 - T::BITS);
    Seen {
        count,
        sum: some.sum(),
        min: some.min(),
        max: some.max(),
        xor: some.fold(s.zero(), xor, xor).reduce_xor().to_u64() & mask,
        and: and.to_u64() & mask,
        kept,
        at,
        dot: all
            .zip(y)
            .selected(bits)
            .fold(
                s.zero(),
                #[inline(always)]
                |sum, (a, b)| sum + (a ^ b),
                add,
            )
            .reduce_sum(),
        spread,
        nulls,
        first: both.position(is),
        last: both.rposition(is),
        odd,
        indices,
    }
}

macro_rules! ints { ($($name:ident $t:ident $w:ty;)*) => {$(
    #[test]
    fn $name() {
        for (len, words, mut state) in cases() {
            let bits = bitmap(words, &mut state);
            let edge = [$t::MIN, $t::MAX][len % 2];
            let x: Vec<$t> = (0..len).map(|_| if state % 5 == 0 { edge } else { random(&mut state) as $t }).collect();
            let y: Vec<$t> = (0..len.saturating_sub(len % 3)).map(|_| random(&mut state) as $t).collect();
            let at: Vec<usize> = (0..len).filter(|&i| has(&bits, i)).collect();
            let kept: Vec<$t> = at.iter().map(|&i| x[i]).collect();
            let (end, mask) = (len.min(64 * words), !0u64 >> (64 - $t::BITS));
            let odd = |i: &usize| x[*i] & 1 != 0;
            let mut odd_bits = vec![0; end.div_ceil(64)];
            for i in at.iter().filter(|i| odd(i)) {
                odd_bits[i / 64] |= 1 << (i % 64)
            }
            let want = Seen {
                count: at.len(),
                sum: kept.iter().fold(0, |a: $t, &b| a.wrapping_add(b)),
                min: kept.iter().copied().min(),
                max: kept.iter().copied().max(),
                xor: kept.iter().fold(0, |a, &b| a ^ b) as u64 & mask,
                and: kept.iter().fold(!0, |a, &b| a & b) as u64 & mask,
                at: at.iter().map(|&i| i as u16).collect(),
                dot: at.iter().filter(|&&i| i < y.len()).fold(0, |a: $t, &i| a.wrapping_add(x[i] ^ y[i])),
                spread: (0..len).map(|i| if i >= end { 1 } else if has(&bits, i) { x[i] } else { 9 }).collect(),
                nulls: (0..end).map(|i| if has(&bits, i) { x[i] } else { 9 }).collect(),
                first: at.iter().copied().find(odd),
                last: at.iter().copied().rfind(odd),
                odd: odd_bits,
                indices: (0..len).filter(odd).map(|i| i as u16).collect(),
                kept,
            };
            each(|target| assert_eq!(ints::<$t, $w>(&x, &y, &bits, 9), want, "{target:?} {len} {bits:x?}"));
        }
    }
)*}; }
ints! {
    i8_64 i8 B64;
    u16_32 u16 B32;
    i16_8 i16 B8;
    u32_64 u32 B64;
    i32_16 i32 B16;
    i64_128 i64 B128;
}

#[kernel(targets = FEW)]
fn floats<T: Float>(x: &[T], zeroed: &[T], kept: &[T], bits: &[u64]) -> [[Option<T>; 2]; 3] {
    let s: S = bun_simd::prelude::isa();
    let (some, narrow) = (s.over(x).selected(bits), s.over(x).by::<B16>().selected(bits));
    let same = |a: Option<T>, b: Option<T>| format!("{a:?}") == format!("{b:?}");
    assert!(
        same(some.min(), narrow.min()) && same(some.max(), narrow.max()) && same(Some(some.sum()), Some(narrow.sum()))
    );
    [[Some(some.sum()), Some(s.over(zeroed).sum())], [some.min(), s.over(kept).min()], [some.max(), s.over(kept).max()]]
}
macro_rules! floats { ($($name:ident $t:ident;)*) => {$(
    #[test]
    fn $name() {
        let of = |it: f64| <$t as Lane>::from_f64(it);
        for (len, words, mut state) in cases() {
            let bits = bitmap(words, &mut state);
            let special = [0.0, -0.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.1, -7.3];
            let (from, to) = (random(&mut state) % 7, random(&mut state) % 7);
            let x: Vec<$t> = (0..len).map(|_| match random(&mut state) {
                it if from == to => of((it % 2000) as f64 / 7.0 - 100.0),
                it => of(special[(from.min(to) + it % (from.abs_diff(to) + 1)) as usize]),
            }).collect();
            let zeroed: Vec<$t> = (0..len).map(|i| if has(&bits, i) { x[i] } else { of(0.0) }).collect();
            let kept: Vec<$t> = (0..len).filter(|&i| has(&bits, i)).map(|i| x[i]).collect();
            each(|target| {
                for [got, want] in floats(&x, &zeroed, &kept, &bits) {
                    assert_eq!(format!("{got:?}"), format!("{want:?}"), "{target:?} {len} {bits:x?}")
                }
            });
        }
    }
)*}; }
floats! { halves f16; brains bf16; singles f32; doubles f64; }

#[kernel(targets = FEW)]
fn bytes<T: Unsigned, W: Width>(bits: &[u8], from: &[T], or: T) -> (Vec<bool>, Vec<u8>, [Vec<T>; 3]) {
    let s: S = bun_simd::prelude::isa();
    let (m, n) = (s.mask_load_bitmask::<T::Signed, W>(bits), Simd::<T, W, S>::LANES);
    let (mut to, mut room) = (vec![0xa5; n.div_ceil(8) + 1], vec![MaybeUninit::<u8>::uninit(); n.div_ceil(8)]);
    m.store_bitmask(&mut to);
    m.store_bitmask(&mut room);
    let lanes = |v: Simd<T, W, S>| v.to_array().as_ref().to_vec();
    if const { Simd::<T, W, S>::LANES <= 64 } {
        assert!(
            Simd::<T, W, S>::load_expand_or(from, m.to_bitmask(), or) == Simd::<T, W, S>::load_expand_or(from, m, or)
        );
        assert!(Simd::<T, W, S>::load_expand(from, m.to_bitmask()) == Simd::<T, W, S>::load_expand(from, m));
        assert!(
            Simd::<T, W, S>::load_or_default(from).expand_or(m.to_bitmask(), or)
                == Simd::<T, W, S>::load_expand_or(from, m, or)
        );
    }
    assert!(m == MaskOf::<T, W, S>::load_bitmask(bits));
    let others = Simd::<T, W, S>::iota(or);
    (
        (0..n).map(|i| m.test(i)).collect(),
        to,
        [
            lanes(Simd::<T, W, S>::load_expand(from, m)),
            lanes(Simd::<T, W, S>::load_expand_or(from, m, others)),
            lanes(Simd::<T, W, S>::load_or_default(from).expand_or(m, others)),
        ],
    )
}
macro_rules! bytes { ($($name:ident $t:ident: $($w:ident)*;)*) => {$(
    #[test]
    fn $name() {$(
        let n = $w::BYTES / size_of::<$t>();
        for (len, _, mut state) in cases() {
            let bits: Vec<u8> = bitmap(8, &mut state).iter().flat_map(|it| it.to_le_bytes()).take(n.div_ceil(8) + len % 2).collect();
            let from: Vec<$t> = (0..[n, n + 1, len % (n + 1)][len % 3]).map(|_| random(&mut state) as $t).collect();
            let lanes: Vec<bool> = (0..n).map(|i| bits[i / 8] >> (i % 8) & 1 != 0).collect();
            let mut stored = bits[..n.div_ceil(8)].to_vec();
            stored[0] &= (!0u8).unbounded_shr(8u32.saturating_sub(n as u32));
            stored.push(0xa5);
            let spread = |or: &dyn Fn(usize) -> $t| {
                let mut next = from.iter();
                (0..n).map(|i| if lanes[i] { next.next().copied().unwrap_or(0) } else { or(i) }).collect::<Vec<_>>()
            };
            let merged = spread(&|i| (i as $t).wrapping_add(9));
            let want = (lanes.clone(), stored, [spread(&|_| 0), merged.clone(), merged]);
            each(|target| assert_eq!(bytes::<$t, $w>(&bits, &from, 9), want, "{target:?} {n} {bits:x?}"));
        }
    )*}
)*}; }
bytes! {
    bytes_8 u8: B2 B8 B16 B32 B64 B128 B512;
    bytes_16 u16: B2 B8 B16 B32 B64 B128 B256;
    bytes_32 u32: B4 B16 B32 B64 B128 B512;
    bytes_64 u64: B8 B16 B32 B64 B128 B512;
}

#[kernel(targets = FEW)]
fn places<T: Unsigned>(bits: u64, first: T) -> Vec<T> {
    let s: S = bun_simd::prelude::isa();
    let (mut plain, mut grown) = ([T::ZERO; 64], Vec::new());
    let n = s.set_bit_positions(bits, first, &mut plain);
    assert_eq!(s.set_bit_positions(bits, first, &mut Output::append(&mut grown, 64)), n);
    assert!(plain[..n] == grown);
    grown
}
macro_rules! places { ($($t:ident)*) => {
    #[test]
    fn positions() {$(
        for (_, _, mut state) in cases() {
            let (bits, first) = (bitmap(1, &mut state)[0], [$t::MAX - 30, random(&mut state) as $t][state as usize % 2]);
            let want: Vec<$t> = (0..64).filter(|i| bits >> i & 1 != 0).map(|i| first.wrapping_add(i)).collect();
            each(|target| assert_eq!(places(bits, first), want, "{target:?} {bits:x}"));
        }
    )*}
}; }
places!(u8 u16 u32 u64);

#[kernel(targets = FEW)]
fn short(which: usize, n: usize) {
    let s: S = bun_simd::prelude::isa();
    let (x, mut to) = ([1u32; 200], [0u32; 200]);
    match which {
        0 => drop(s.over(&x).selected(&[!0u64; 4]).map_into(&mut to[..n], |v| v)),
        1 => drop(s.over(&x).selected(&[1u64; 4]).map_into(&mut to[..n % 4], |v| v)),
        2 => drop(s.over(&x[..n]).expand_into(&mut to, &[!0u64; 4], 0)),
        3 => drop(s.over(&x[..n % 4]).expand_into(&mut to, &[1u64; 4], 0)),
        4 => s.mask_splat::<i8, B64>(true).store_bitmask(&mut [0u8; 8][..n % 8]),
        _ => drop(s.mask_load_bitmask::<i8, B64>(&[0; 8][..n % 8])),
    }
}
#[test]
#[cfg(panic = "unwind")]
fn too_short() {
    each(|target| {
        for which in 0..6 {
            for n in [0, 3, 63, 64, 127, 199] {
                assert!(std::panic::catch_unwind(|| short(which, n)).is_err(), "{target:?} {which} {n}");
            }
        }
    });
}

#[test]
fn by_type() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        assert_eq!(mask16x16::load_bitmask(&[1, 2]).to_bitmask(), 0x201);
        assert_eq!(u32x4::load_expand_or(&[1], 0b10, 5), [5, 1, 5, 5]);
    }
    on::<bun_simd::target::Baseline>()
}
