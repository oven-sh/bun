//! Columns, and the tails of interleaved values.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{mem::*, target::*, *};
use core::cell::Cell;
use core::mem::MaybeUninit;

#[derive(Debug, PartialEq, Default)]
pub struct Seen {
    first: Option<usize>,
    last: Option<usize>,
    all: Vec<usize>,
    count: usize,
    counts: [usize; 2],
    bits: Vec<u64>,
    any: [bool; 2],
    xor: u64,
    exact: Vec<u64>,
    padded: Vec<u64>,
    mapped: Vec<u64>,
    twice: Vec<u64>,
}

#[inline(always)]
fn see<T: Unsigned, W: Width, S: Isa, I: Items<T, W, S>>(
    s: S,
    all: Columns<T, W, S, I>,
    low: T,
    of: impl Fn(I::Item) -> Simd<T, W, S>,
) -> Seen {
    let (len, n) = (all.len(), Simd::<T, W, S>::LANES);
    let is = |it| (of(it) & low).simd_eq(T::ZERO);
    let wide = |values: &[T]| values.iter().map(|it| it.to_u64()).collect::<Vec<_>>();
    let mut seen = Seen {
        first: all.position(is),
        last: all.rposition(is),
        count: all.count(is),
        counts: all.counts(
            #[inline(always)]
            |it| [is(it), !is(it)],
        ),
        any: [all.any(is), all.all(is)],
        ..Seen::default()
    };
    seen.xor = all
        .fold(
            s.zero::<T, W>(),
            #[inline(always)]
            |a, it| a ^ of(it),
            #[inline(always)]
            |a, b| a ^ b,
        )
        .reduce_xor()
        .to_u64();
    let (whole, rest) = all.exact();
    assert_eq!((whole.len(), rest.len(), all.is_empty()), (len / n, len % n, len == 0));
    for it in whole {
        seen.exact.extend(wide(of(it).to_array().as_ref()))
    }
    let mut left = vec![T::ZERO; rest.len()];
    rest.map_into(&mut left, &of);
    seen.exact.extend(wide(&left));
    if const { Simd::<T, W, S>::LANES <= 64 } {
        seen.all = all.positions(is).collect();
        seen.bits = vec![7; len.div_ceil(64) + 1];
        all.bitmask_into(&mut seen.bits, is);
        assert_eq!(seen.bits.pop(), Some(7));
        assert_eq!(all.padded().len(), len.div_ceil(n));
        for (it, valid) in all.padded() {
            let lanes = wide(of(it).to_array().as_ref());
            let (counts, zeros) = lanes.split_at(valid.count_ones() as usize);
            assert!(valid & valid.wrapping_add(1) == 0 && zeros.iter().all(|&it| it == 0));
            seen.padded.extend(counts);
        }
    }
    let mut to = vec![T::ONE; len + 1];
    all.map_into(&mut to, &of);
    assert!(to.pop() == Some(T::ONE));
    seen.mapped = wide(&to);
    let three = |it| {
        let v = of(it);
        [v, !v, v + T::ONE]
    };
    let (mut plain, mut grown, mut room, mut cells) =
        (vec![T::ONE; 3 * len + 1], vec![T::ONE], vec![MaybeUninit::uninit(); 3 * len], vec![T::ONE; 3 * len]);
    all.map_into(&mut plain, three);
    all.map_into(&mut Output::append(&mut grown, 3 * len), three);
    let mut out = Output::new(&mut room);
    all.map_into(&mut out, three);
    all.map_into(&mut Cell::from_mut(&mut cells[..]).as_slice_of_cells(), three);
    assert!(plain.pop() == Some(T::ONE) && plain == grown[1..] && plain == out.into_filled() && plain == cells);
    seen.twice = wide(&plain);
    let (mut one, mut many, mut streamed) = (vec![T::ONE; len + 1], vec![T::ONE], vec![T::ONE; len + 1]);
    all.unzip_into(
        (&mut one, &mut Output::append(&mut many, 3 * len)),
        #[inline(always)]
        |it| (of(it), three(it)),
    );
    all.stream_into(&mut streamed, &of);
    assert!(one == streamed && one.pop() == Some(T::ONE) && one == to && many == grown);
    let kept: Vec<T> = to.iter().copied().filter(|&it| (it.to_u64() & low.to_u64()) == 0).collect();
    let (mut exact, mut roomy, mut out) = (vec![T::ONE; kept.len()], vec![T::ONE; len + n], vec![T::ONE]);
    assert_eq!(
        all.filter_map_into(
            &mut exact,
            #[inline(always)]
            |it| (is(it), of(it))
        ),
        kept.len()
    );
    let count = all.filter_map_into(
        (&mut roomy, &mut Output::append(&mut out, len + len % 3 * n)),
        #[inline(always)]
        |it| (is(it), (of(it), !of(it))),
    );
    assert!(
        count == kept.len()
            && exact == kept
            && roomy[..count] == kept
            && out.len() == count + 1
            && (0..count).all(|i| out[i + 1].to_u64() ^ kept[i].to_u64() == !0 >> (64 - T::BITS))
    );
    let [mut a, mut b, mut c] = [(); 3].map(|_| vec![T::ONE; len + 1]);
    all.unzip_into([&mut a, &mut b, &mut c], three);
    assert!((0..=len).all(|i| [a[i], b[i], c[i]] == *plain.get(3 * i..3 * i + 3).unwrap_or(&[T::ONE; 3])));
    seen
}
fn model<T: Unsigned>(values: Vec<u64>, low: u64, lanes: usize) -> Seen {
    let (is, max) = (|it: &u64| it & low == 0, !0 >> (64 - T::BITS));
    let count = values.iter().filter(|it| is(it)).count();
    let some = |it: Vec<u64>| if lanes <= 64 { it } else { vec![] };
    Seen {
        first: values.iter().position(is),
        last: values.iter().rposition(is),
        count,
        counts: [count, values.len() - count],
        all: (0..values.len()).filter(|&i| lanes <= 64 && is(&values[i])).collect(),
        bits: some(values.chunks(64).map(|it| it.iter().rev().fold(0, |a, b| a << 1 | is(b) as u64)).collect()),
        any: [count > 0, count == values.len()],
        xor: values.iter().fold(0, |a, b| a ^ b),
        exact: values.clone(),
        padded: some(values.clone()),
        twice: values.iter().flat_map(|&v| [v, !v & max, v.wrapping_add(1) & max]).collect(),
        mapped: values,
    }
}

#[bun_simd::simd]
mod k {
    use super::{Seen, see};
    use bun_simd::prelude::*;
    macro_rules! ops { ($($name:ident |$all:ident, $x:ident, $y:ident, $z:ident| $columns:expr, |$item:pat_param| $of:expr;)*) => {$(
        #[kernel]
        pub fn $name<T: Unsigned, W: Width, E: Readable<T>>($x: &[E], $y: &[E], $z: &[E], low: T, _of: W) -> Seen {
            let ($all, _) = (Simd::<T, W, S>::over($x), ($y, $z));
            see(isa(), $columns, low, #[inline(always)] |$item| $of)
        }
    )*}; }
    #[simd]
    ops! {
        slices |_all, x, y, z| Simd::<T, W, S>::over_all([x, y, z]), |[a, b, c]| a ^ (b + b) ^ c << 2;
        zips |all, x, y, z| all.zip(y).zip(z), |((a, b), c)| a ^ (b + b) ^ c << 2;
        windows |all, x, y, z| all.windows(), |[a, b, c]| a ^ (b + b) ^ c << 2;
        threes |all, x, y, z| all.interleaved(), |[a, b, c]| a ^ (b + b) ^ c << 2;
        twos |all, x, y, z| all.interleaved().zip(y), |([a, b], c)| a ^ (b + b) ^ c << 2;
        fours |all, x, y, z| all.interleaved(), |[a, b, c, d]| a ^ (b + b) ^ c << 2 ^ d << 3;
    }
}
fn values<T: Lane>(n: usize, seed: u64) -> Vec<T> {
    (0..n as u64)
        .map(|i| T::from_u64((((i + seed).wrapping_mul(0x9e37_79b9_7f4a_7c15) % 0xffff_fffb) >> 7) % 61))
        .collect()
}
fn lengths() -> impl Iterator<Item = usize> {
    (0..if cfg!(miri) { 12 } else { 280 }).chain([777, 1025, 9000, 20001].into_iter().filter(|_| !cfg!(miri)))
}

fn columns<T: Unsigned, W: Width>(op: usize, run: impl Fn(Target, &[T], &[T], &[T], T) -> Option<Seen>) {
    for n in lengths() {
        for low in [0, 1, 31, 127] {
            let (x, y, z) =
                (values::<T>(n + n % 3, n as u64), values::<T>(n + n % 2, 5000), values::<T>(n + n % 5 / 2, 9999));
            let f = |a: &T, b: &T, c: &T| (a.to_u64() ^ (2 * b.to_u64()) ^ c.to_u64() << 2) & !0 >> (64 - T::BITS);
            let want = model::<T>(
                match op {
                    0 | 1 => x.iter().zip(&y).zip(&z).map(|((a, b), c)| f(a, b, c)).collect(),
                    2 => x.windows(3).map(|it| f(&it[0], &it[1], &it[2])).collect(),
                    3 => x.chunks_exact(3).map(|it| f(&it[0], &it[1], &it[2])).collect(),
                    4 => x.chunks_exact(2).zip(&y).map(|(it, c)| f(&it[0], &it[1], c)).collect(),
                    _ => x
                        .chunks_exact(4)
                        .map(|it| (f(&it[0], &it[1], &it[2]) ^ it[3].to_u64() << 3) & !0 >> (64 - T::BITS))
                        .collect(),
                },
                low,
                W::BYTES / size_of::<T>(),
            );
            for target in k::slices::targets() {
                assert_eq!(run(target, &x, &y, &z, T::from_u64(low)).unwrap(), want, "{target:?} {op} {n} {low}");
            }
        }
    }
}
fn cells<T: Copy>(of: &[T]) -> Vec<Cell<T>> {
    of.iter().map(|&it| Cell::new(it)).collect()
}
macro_rules! tests { ($($test:ident $t:ident $w:ident [$($op:literal $name:ident)*] [$($other:literal $shared:ident)*];)*) => {$(
    #[test]
    fn $test() {
        $(columns::<$t, $w>($op, |target, x, y, z, low| k::$name::to(target, x, y, z, low, $w));)*
        $(columns::<$t, $w>($other, |target, x, y, z, low| k::$shared::to(target, &cells(x), &cells(y), &cells(z), low, $w));)*
    }
)*}; }
tests! {
    u8_16 u8 B16 [0 slices 3 threes] [2 windows];
    u8_64 u8 B64 [1 zips 2 windows 5 fours] [3 threes];
    u8_128 u8 B128 [4 twos] [];
    u16_8 u16 B8 [2 windows 4 twos] [];
    u32_32 u32 B32 [0 slices 3 threes] [1 zips];
    u64_64 u64 B64 [1 zips 5 fours] [];
}

type Two = (Option<usize>, Vec<usize>, usize, Vec<u64>, Vec<u64>, [usize; 2], Vec<u32>, usize);
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn two(x: &[u8], y: &[u32]) -> Two {
    let s: S = bun_simd::prelude::isa();
    let both = s.over(x).by::<B16>().zip_scaled(y);
    let is = |(a, b): (Simd<u8, B16, S>, Simd<u32, B64, S>)| a.simd_eq(b.cast::<u8>());
    let (mut bits, mut own, mut sums) = (Vec::new(), vec![0; x.len().div_ceil(64)], Vec::new());
    both.bitmask_into(&mut Output::append(&mut bits, x.len().div_ceil(64)), is);
    s.over(x).bitmask_into(
        &mut own,
        #[inline(always)]
        |v| v.any_bits(1),
    );
    for ((a, b), valid) in both.padded() {
        sums.extend(&(a.cast::<u32>() + b).to_array()[..valid.count_ones() as usize])
    }
    let (whole, rest) = both.exact();
    assert_eq!(
        16 * whole.len()
            + rest.count(
                #[inline(always)]
                |(a, _)| a.simd_eq(a)
            ),
        x.len().min(y.len())
    );
    let third = s.over(x).by::<B16>().windows::<1>().zip_scaled(y).count(
        #[inline(always)]
        |([a], b)| is((a, b)),
    );
    (
        both.rposition(is),
        both.positions(is).collect(),
        both.count(is),
        bits,
        own,
        s.over(x).counts(
            #[inline(always)]
            |v| [v.simd_eq(3), v.simd_gt(9)],
        ),
        sums,
        third,
    )
}
#[test]
fn zip_and_over() {
    for n in lengths() {
        let (x, y) = (values::<u8>(n + n % 3, n as u64), values::<u32>(n + n % 2, 77));
        let at: Vec<_> = (0..x.len().min(y.len())).filter(|&i| x[i] as u32 == y[i]).collect();
        let mut bits = vec![0; x.len().min(y.len()).div_ceil(64)];
        for &i in &at {
            bits[i / 64] |= 1 << (i % 64)
        }
        let own = x.chunks(64).map(|it| it.iter().rev().fold(0, |a, b| a << 1 | (b & 1) as u64)).collect();
        let counts = [x.iter().filter(|&&it| it == 3).count(), x.iter().filter(|&&it| it > 9).count()];
        let want = (
            at.last().copied(),
            at.clone(),
            at.len(),
            bits,
            own,
            counts,
            x.iter().zip(&y).map(|(&a, b)| a as u32 + b).collect(),
            at.len(),
        );
        for &target in Target::ALL {
            if let Some(got) = two::to(target, &x, &y) {
                assert_eq!(got, want, "{target:?} {n}")
            }
        }
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn pairs(x: &[u16], y: &[i16]) -> Seen {
    let s: S = bun_simd::prelude::isa();
    see(
        s,
        s.over(x).zip(y),
        7,
        #[inline(always)]
        |(a, b)| a ^ b.cast_unsigned() << 1,
    )
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn shorter(x: &mut [u16], y: &[i16], in_order: bool) -> (i32, f32) {
    let s: S = bun_simd::prelude::isa();
    let floats: Vec<f32> = x.iter().map(|&it| (it % 8) as f32).collect();
    let dots = (s.over(bitcast_slice::<i16>(x)).zip(y).dot_wide(), s.over(&floats).zip(&vec![2.0; y.len()]).dot());
    let both = s.over_mut(x).zip(y);
    if in_order {
        both.scan(
            #[inline(always)]
            |(a, b)| a ^ b.cast_unsigned(),
        )
    } else {
        both.map(
            #[inline(always)]
            |(a, b)| a ^ b.cast_unsigned(),
        )
    }
    dots
}
#[test]
fn up_to_the_shorter() {
    for n in lengths() {
        for (more_x, more_y) in [(0, 0), (1, 0), (0, 1), (70, 0), (0, 70)] {
            let (x, y) = (values::<u16>(n + more_x, 5), values::<u16>(n + more_y, 6));
            let dots = (
                (0..n).fold(0i32, |a, i| a.wrapping_add(x[i] as i16 as i32 * y[i] as i16 as i32)),
                (0..n).map(|i| (x[i] % 8 * 2) as f32).sum(),
            );
            let mapped: Vec<u16> = (0..x.len()).map(|i| if i < n { x[i] ^ y[i] } else { x[i] }).collect();
            for target in pairs::targets() {
                let lanes = lanes::to(target).unwrap();
                assert_eq!(
                    pairs::to(target, &x, bitcast_slice(&y)).unwrap(),
                    model::<u16>((0..n).map(|i| (x[i] ^ y[i] << 1) as u64).collect(), 7, lanes),
                    "{target:?} {n}"
                );
                for in_order in [false, true] {
                    let mut got = x.clone();
                    assert_eq!(
                        (shorter::to(target, &mut got, bitcast_slice(&y), in_order), &got),
                        (Some(dots), &mapped),
                        "{target:?} {n}"
                    );
                }
            }
        }
    }
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn lanes() -> usize {
    S::Native::BYTES / 2
}

#[inline(always)]
fn named<S: Isa, R, O>(s: S, x: &[u16], to: impl Sinks<R, O, S>, f: impl FnMut(Simd<u16, S::Native, S>) -> O) {
    s.over(x).unzip_into(to, f)
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn outputs(x: &[u16]) {
    let s: S = bun_simd::prelude::isa();
    let (len, mut calls) = (x.len(), 0);
    let (mut a, mut b, mut c, mut d, mut e, mut f) = (
        vec![7u8; len + 1],
        vec![7u32; len + 1],
        vec![7u32; len.div_ceil(2) + 1],
        vec![7u8; 2 * len + 1],
        vec![7u16; 2 * len + 1],
        vec![7f32; len + 1],
    );
    s.over(x).unzip_into(
        (&mut a, &mut b, &mut c, &mut d, &mut e, &mut f),
        #[inline(always)]
        |v| {
            calls += 1;
            (v.cast(), v.cast(), v.sum_groups(), v.bitcast(), [v, !v], v.cast())
        },
    );
    assert_eq!(
        (calls, a.pop(), b.pop(), c.pop(), d.pop(), e.pop(), f.pop()),
        (len.div_ceil(S::Native::BYTES / 2), Some(7), Some(7), Some(7), Some(7), Some(7), Some(7.0))
    );
    assert!((0..len).all(|i| a[i] == x[i] as u8
        && b[i] == x[i] as u32
        && d[2 * i..][..2] == x[i].to_le_bytes()
        && e[2 * i..][..2] == [x[i], !x[i]]
        && f[i] == x[i] as f32));
    assert!(c.iter().zip(x.chunks(2)).all(|(a, b)| *a == b.iter().map(|&it| it as u32).sum()));
    let mut five = [(); 5].map(|_| vec![7; len + 1]);
    let [p, q, r, t, u] = &mut five;
    s.over(x).unzip_into(
        [p, q, r, t, u],
        #[inline(always)]
        |v| {
            array::from_fn(
                #[inline(always)]
                |k| v + k as u16,
            )
        },
    );
    assert!(
        five.iter().enumerate().all(|(k, it)| it[len] == 7 && (0..len).all(|i| it[i] == x[i].wrapping_add(k as u16)))
    );
    let [p, q, r, t, _] = &mut five;
    named(
        s,
        x,
        (p, q, r, t),
        #[inline(always)]
        |v| (v, !v, v, !v),
    );
    assert!((0..len).all(|i| [five[0][i], five[1][i], five[2][i], five[3][i]] == [x[i], !x[i], x[i], !x[i]]));
    let mut many = [(); 16].map(|_| vec![7; len + 1]);
    s.over(x).unzip_into(
        many.each_mut(),
        #[inline(always)]
        |v| {
            array::from_fn(
                #[inline(always)]
                |k| v ^ k as u16,
            )
        },
    );
    assert!(many.iter().enumerate().all(|(k, it)| it[len] == 7 && (0..len).all(|i| it[i] == x[i] ^ k as u16)));
    let (mut fewer, mut more) = (vec![7u32; len / 2 + 1], vec![7u8; 4 * len + 1]);
    s.over(x).zip(x).map_into(
        &mut fewer,
        #[inline(always)]
        |(a, _)| a.sum_groups(),
    );
    s.over(x).map_into(
        &mut more,
        #[inline(always)]
        |v| [v.bitcast(), (!v).bitcast()],
    );
    assert!(
        fewer.pop() == Some(7)
            && fewer == c[..len / 2]
            && more.pop() == Some(7)
            && (0..2 * len).all(|i| more[2 * i..][..2] == [d[i], !d[i]])
    );
    let mut pairs = vec![7; 2 * len + 1];
    s.over(x).map_into(
        &mut pairs,
        #[inline(always)]
        |v| [v, !v],
    );
    assert!(pairs.pop() == Some(7) && pairs == e);
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn together(x: &mut [u16], y: &mut [u16], z: &[u16]) {
    let s: S = bun_simd::prelude::isa();
    let both = [as_cells(x), as_cells(y)];
    s.over_all::<u16, S::Native, 2, _>(both).zip(z).unzip_into(
        both,
        #[inline(always)]
        |([x, y], z)| [y ^ z, x + 1],
    );
}
#[test]
fn several_in_place() {
    for n in lengths() {
        for target in together::targets() {
            let (x, y, z) = (values::<u16>(n + 1, 1), values::<u16>(n + 2, 2), values::<u16>(n, 3));
            let (mut a, mut b) = (x.clone(), y.clone());
            together::to(target, &mut a, &mut b, &z).unwrap();
            assert!(
                (0..n).all(|i| a[i] == y[i] ^ z[i] && b[i] == x[i] + 1) && a[n..] == x[n..] && b[n..] == y[n..],
                "{target:?} {n}"
            );
        }
    }
}
#[test]
fn several_outputs() {
    for n in lengths() {
        for target in outputs::targets() {
            outputs::to(target, &values::<u16>(n, 9)).unwrap()
        }
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn compact(x: &mut [u16], y: &mut [u16], wide: &mut [f32], narrow: &mut [u8]) -> [usize; 2] {
    let s: S = bun_simd::prelude::isa();
    let (mut x, mut y) = (Cell::from_mut(x).as_slice_of_cells(), Cell::from_mut(y).as_slice_of_cells());
    let n = s.over(x).filter_map_into(
        (wide, narrow),
        #[inline(always)]
        |v| (v.simd_gt(30), (v.cast(), v.cast())),
    );
    [
        n,
        s.over_all::<u16, S::Native, 2, _>([x, y]).filter_map_into(
            [&mut y, &mut x],
            #[inline(always)]
            |[a, b]| (a.simd_gt(30), [a, b]),
        ),
    ]
}
#[test]
fn filters_in_place() {
    for n in lengths() {
        for target in compact::targets() {
            let (x, y) = (values::<u16>(n, 4), values::<u16>(n, 8));
            let at: Vec<_> = (0..n).filter(|&i| x[i] > 30).collect();
            let (mut a, mut b, mut wide, mut narrow) = (x.clone(), y.clone(), vec![0.0; at.len()], vec![0; n]);
            assert_eq!(
                compact::to(target, &mut a, &mut b, &mut wide, &mut narrow),
                Some([at.len(); 2]),
                "{target:?} {n}"
            );
            assert!(
                at.iter()
                    .enumerate()
                    .all(|(k, &i)| (a[k], b[k], wide[k], narrow[k]) == (y[i], x[i], x[i] as f32, x[i] as u8)),
                "{target:?} {n}"
            );
        }
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn pads(x: &[u16], y: &[u16]) {
    let s: S = bun_simd::prelude::isa();
    let (n, len, zero) = (S::Native::BYTES / 2, x.len(), s.zero::<u32, S::Native>());
    let total = |it: &[u16]| it.iter().map(|&it| it as u32).sum::<u32>();
    let left = |len: usize| (len.next_multiple_of(n) - len) as u32;
    let add = |a: Simd<u32, S::Native, S>, b| a + b;
    macro_rules! sum {
        ($all:expr, |$it:pat_param| $of:expr) => {{
            let (mut seen, mut to) = (zero, vec![0; $all.len()]);
            $all.scan_into(
                &mut to,
                #[inline(always)]
                |$it| {
                    let v: Simd<u16, S::Native, S> = $of;
                    seen += v.sum_groups();
                    v
                },
            );
            let sum = $all
                .fold(
                    zero,
                    #[inline(always)]
                    |a, $it| a + $of.sum_groups(),
                    add,
                )
                .reduce_sum();
            assert!(
                seen.reduce_sum() == sum
                    && $all
                        .padded()
                        .fold(
                            zero,
                            #[inline(always)]
                            |a, ($it, _)| a + $of.sum_groups()
                        )
                        .reduce_sum()
                        == sum
            );
            sum
        }};
    }
    assert_eq!(sum!(s.over(x).pad(9), |v| v), total(x) + 9 * left(len));
    assert_eq!(sum!(s.over(x).pad(1).pad(9), |v| v), total(x) + 9 * left(len));
    assert_eq!(sum!(s.over(x).pad(9).zip(y), |(a, b)| a + b), total(x) + total(y) + 9 * left(len));
    assert_eq!(sum!(s.over(x).zip(y).pad(9), |(a, b)| a + b), total(x) + total(y) + 9 * left(len));
    assert_eq!(
        sum!(s.over_all::<u16, S::Native, 2, _>([x, y]).pad(9), |[a, b]| a + b),
        total(x) + total(y) + 18 * left(len)
    );
    assert_eq!(
        sum!(s.over(x).interleaved::<3>().pad(9), |[a, b, c]| a + b + c),
        total(&x[..len / 3 * 3]) + 27 * left(len / 3)
    );
    let (all, mut to) = (s.over(x).pad(9), vec![0; len]);
    all.map_into(
        &mut to,
        #[inline(always)]
        |v| v,
    );
    assert!(
        to == x
            && all.count(
                #[inline(always)]
                |v| v.simd_eq(9)
            ) == x.iter().filter(|&&it| it == 9).count()
            && all.position(
                #[inline(always)]
                |v| v.simd_eq(9)
            ) == x.iter().position(|&it| it == 9)
    );
}
#[test]
fn other_padding() {
    for n in lengths() {
        for target in pads::targets() {
            pads::to(target, &values::<u16>(n, 2), &values::<u16>(n, 3)).unwrap()
        }
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn ahead(x: &mut [u16]) {
    let s: S = bun_simd::prelude::isa();
    let mut cells = Cell::from_mut(x).as_slice_of_cells();
    s.over(cells).windows().map_into(
        &mut cells,
        #[inline(always)]
        |[a, _, c]| a.simd_max(c),
    );
}
#[test]
fn in_place() {
    for n in lengths() {
        for &target in Target::ALL {
            let x = values::<u16>(n, 3);
            let mut got = x.clone();
            if ahead::to(target, &mut got).is_none() {
                continue;
            }
            assert!((0..n).all(|i| got[i] == if i + 2 < n { x[i].max(x[i + 2]) } else { x[i] }), "{target:?} {n}");
        }
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn tails<T: Lane, W: Width, const K: usize>(
    from: &[T],
    to: &mut [T],
    room: &mut [MaybeUninit<T>],
    _of: W,
    _k: [(); K],
) -> Vec<T> {
    let s: S = bun_simd::prelude::isa();
    let all = s.load_interleaved_or_default::<T, W, K>(from);
    s.store_interleaved_partial(all, to);
    s.store_interleaved_partial(all, room);
    all.iter().flat_map(|v| v.to_array().as_ref().to_vec()).collect()
}
fn tail<T: Unsigned, W: Width + Copy, const K: usize>(w: W) {
    let n = W::BYTES / size_of::<T>();
    // At all places of a page.
    let (page, mut out) =
        (values::<T>(8192 / size_of::<T>() + K * n + 2, 1), vec![T::MAX; 8192 / size_of::<T>() + K * n + 3]);
    for len in 0..K * n + 2 {
        for at in (0..8192 / size_of::<T>()).step_by(if cfg!(miri) { 2000 } else { 37 }) {
            for &target in Target::ALL {
                let (from, fits) = (&page[at..][..len], len.min(K * n));
                let mut room = vec![MaybeUninit::uninit(); len];
                let Some(got) = tails::to(target, from, &mut out[at + 1..][..len], &mut room, w, [(); K]) else {
                    continue;
                };
                assert!(
                    (0..K * n).all(|i| got[i % K * n + i / K] == if i < len { from[i] } else { T::ZERO }),
                    "{target:?} {len} {at}"
                );
                assert!(
                    out[at] == T::MAX && out[at + 1..][..fits] == from[..fits] && out[at + 1 + fits] == T::MAX,
                    "{target:?} {len} {at}"
                );
                out[at + 1..][..fits].fill(T::MAX);
            }
        }
    }
}
#[test]
fn tails_2() {
    tail::<u8, _, 2>(B64);
    tail::<u32, _, 2>(B16);
    tail::<u16, _, 2>(B4)
}
#[test]
fn tails_3() {
    tail::<u8, _, 3>(B16);
    tail::<u8, _, 3>(B32);
    tail::<u8, _, 3>(B64);
    tail::<u32, _, 3>(B32);
    tail::<u64, _, 3>(B256);
    tail::<u16, _, 3>(B8)
}
#[test]
fn tails_4() {
    tail::<u8, _, 4>(B32);
    tail::<u16, _, 4>(B64);
    tail::<u32, _, 4>(B64);
    tail::<u64, _, 4>(B16)
}

#[test]
fn mapped_is_a_name() {
    fn is<O: bun_simd::Mapped<u8, bun_simd::target::Portable>>() {}
    let _ = is::<bun_simd::prelude::u8x16<bun_simd::target::Portable>>;
}

#[test]
fn sinks_is_a_name() {
    use bun_simd::prelude::u8x16;
    fn is<T: bun_simd::Sinks<u8, [u8x16<bun_simd::target::Portable>; 2], bun_simd::target::Portable>>() {}
    let _ = is::<[&mut [u8]; 2]>;
}
