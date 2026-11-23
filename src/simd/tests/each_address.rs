//! Long loops align their accesses. The results are the same at each address.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{prelude::*, target::*};

#[kernel(targets = Targets::ALL)]
fn columns<T: Unsigned>(x: &[T], y: &[T], to: &mut [T], at: usize) {
    let s: S = isa();
    let (len, same) = (x.len(), |i: &usize| x[*i] == y[*i]);
    let all = Simd::<T, Native<S>, S>::over_all([x, y]);
    let found: Vec<usize> = (0..len).filter(same).collect();
    assert_eq!(all.position(|[a, b]| a.simd_eq(b)), found.first().copied());
    assert_eq!(all.rposition(|[a, b]| a.simd_eq(b)), found.last().copied());
    assert_eq!(all.any(|[a, b]| a.simd_eq(b)), !found.is_empty());
    assert_eq!(all.counts(|[a, b]| [a.simd_eq(b), a.simd_ne(b)]), [found.len(), len - found.len()]);
    assert_eq!(over(x).zip(y).count(|(a, b)| a.simd_ne(b)), len - found.len());
    assert_eq!(all.positions(|[a, b]| a.simd_eq(b)).collect::<Vec<_>>(), found);
    // Pairs stay together.
    let even = len / 2 * 2;
    let pairs = Simd::<T, Native<S>, S>::over_all([&x[..even], y]);
    pairs.map_into(&mut to[at..], |[a, b]| a.swap_pairs() ^ b);
    let mut grown = vec![T::ZERO; at];
    pairs.map_into(&mut Output::append(&mut grown, even), |[a, b]| a.swap_pairs() ^ b);
    assert!((0..even).all(|i| to[at + i].to_u64() == x[i ^ 1].to_u64() ^ y[i].to_u64()) && to[..at + even] == grown);
    assert!(to[at + even..].iter().all(|&it| it == T::ZERO));
    // Little room, and much to read.
    let (mut few, want) = (vec![], x.iter().filter(|&&it| it == T::ONE).count());
    assert_eq!(over(x).filter_into(&mut Output::append(&mut few, want), |v| v.simd_eq(T::ONE)), want);
    assert!(few == vec![T::ONE; want]);
    let (mut got, mut want) = (y.to_vec(), y.to_vec());
    want.dedup();
    let kept = over_mut(&mut got).dedup();
    assert!(got[..kept] == want, "{s:?}");
}

#[kernel(targets = Targets::ALL)]
fn dots(a: &[u8], b: &[i8], c: &[i16]) -> [i32; 4] {
    let (one, two) = (over(a).zip(a).dot_wide() as i32, over(a).zip(b).dot_wide());
    [one, two, over(b).zip(b).dot_wide(), over(c).zip(c).dot_wide()]
}

#[test]
fn of_columns() {
    fn of<T: Unsigned>() {
        let lens = [500, 512, 1023, 1024, 1040, 2048, 2064, 2200].map(|it| it / size_of::<T>());
        for (len, at) in lens.iter().flat_map(|&len| (0..64 / size_of::<T>()).map(move |at| (len, at))) {
            for hit in [0, 1, at, 63, 64, 65, len - 1, len] {
                let x: Vec<T> = (0..at + len).map(|i| T::from_usize(i % 97)).collect();
                let other = |i: usize| {
                    if i >= hit && (i - hit) % 131 == 0 { x[at + i] } else { T::from_usize(100 + i / 3 % 50) }
                };
                let y: Vec<T> = (0..len).map(other).collect();
                for target in columns::targets() {
                    columns::to(target, &x[at..], &y, &mut vec![T::ZERO; at + len + 64], at);
                }
            }
        }
    }
    of::<u8>();
    of::<u16>();
    of::<u32>();
    of::<u64>();
}

#[test]
fn of_dots() {
    let a: Vec<u8> = (0..1400u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    let (b, c): (Vec<i8>, Vec<i16>) = a.iter().rev().map(|&it| (it as i8, it as i8 as i16 * 256)).unzip();
    let dot = |f: &dyn Fn(usize) -> i32, n| (0..n).map(f).fold(0, i32::wrapping_add);
    for (len, at) in
        [255, 256, 511, 512, 513, 1023, 1024, 1100, 1300].iter().flat_map(|&len| (0..64).map(move |at| (len, at)))
    {
        let (a, b, c) = (&a[at..][..len], &b[at..][..len], &c[at..][..len]);
        let want = [
            dot(&|i| a[i] as i32 * a[i] as i32, len),
            dot(&|i| a[i] as i32 * b[i] as i32, len),
            dot(&|i| b[i] as i32 * b[i] as i32, len),
            dot(&|i| c[i] as i32 * c[i] as i32, len),
        ];
        for target in dots::targets() {
            assert!(dots::to(target, a, b, c).is_none_or(|got| got == want), "{target:?} {len} {at}");
        }
    }
}

#[kernel(targets = Targets::ALL)]
fn product<T: Float>(matrix: &[T], x: &[T]) -> [T; 9] {
    let mut to = [T::default(); 9];
    over(matrix).mat_vec_relaxed(x, &mut to);
    to
}

#[test]
fn of_matrices() {
    fn of<T: Float + Into<f64>>(tiny: f64) {
        for (columns, zeros) in [120, 128, 136, 255, 256, 272].iter().flat_map(|&it| [(it, false), (it, true)]) {
            let make = |len: usize, or| {
                (0..len).map(move |i| T::from_f64(if zeros { or } else { (i * 37 % 101) as f64 / 7.0 }))
            };
            let (matrix, x): (Vec<T>, Vec<T>) = (make(9 * columns, tiny).collect(), make(columns, -tiny).collect());
            for target in product::targets() {
                let Some(first) = product::to(target, &matrix, &x) else { continue };
                for (row, got) in matrix.chunks(columns).zip(first) {
                    let want: f64 = row.iter().zip(&x).map(|(&a, &b)| a.into() * b.into()).sum();
                    assert!((got.into() - want).abs() < 0.1);
                }
                for at in 0..64 / size_of::<T>() {
                    let moved = [&vec![T::from_f64(f64::NAN); at][..], &matrix].concat();
                    let bits = |all: [T; 9]| all.map(|it| it.into().to_bits());
                    assert_eq!(
                        product::to(target, &moved[at..], &x).map(bits),
                        Some(bits(first)),
                        "{target:?} {columns} {at}"
                    );
                }
            }
        }
    }
    of::<f32>(1e-30);
    of::<f64>(1e-200);
}
