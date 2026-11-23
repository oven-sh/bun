//! Interleaved values of more than four vectors, and of one.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;
use core::cell::Cell;

#[bun_simd::simd(icelake, avx512, sve2, default)]
mod simd {
    use bun_simd::prelude::*;
    use core::cell::Cell;
    #[kernel]
    pub fn both<T: Lane, W: Width, const K: usize>(from: &[T], to: &mut [T], _of: W, _k: [(); K]) -> Vec<T> {
        let all = Simd::<T, W, S>::load_interleaved_or_default::<K>(from);
        Simd::store_interleaved_partial(all, to);
        all.iter().flat_map(|v| v.to_array().as_ref().to_vec()).collect()
    }
    #[kernel]
    pub fn cells<T: Lane, W: Width, const K: usize>(from: &[Cell<T>], mut to: &[Cell<T>], _of: W, _k: [(); K]) {
        Simd::<T, W, S>::over(from).interleaved::<K>().map_into(&mut to, |fields| fields);
    }
    #[kernel]
    pub fn mapped<T: Lane, W: Width, const K: usize>(from: &[T], to: &mut [T], last: &mut [T], _of: W, _k: [(); K]) {
        Simd::<T, W, S>::over(from).interleaved::<K>().map_into(to, |mut fields| {
            fields.swap(0, K - 1);
            fields
        });
        Simd::<T, W, S>::over(from).interleaved::<K>().map_into(last, |fields| fields[K - 1]);
    }
    #[kernel]
    pub fn in_place<T: Unsigned, W: Width, const K: usize>(mut both: &[Cell<T>], _of: W, _k: [(); K]) {
        Simd::<T, W, S>::over(both).interleaved::<K>().map_into(&mut both, |mut fields| {
            fields.swap(0, K - 1);
            array::map(fields, |v| !v)
        });
    }
    #[kernel]
    pub fn appended(from: &[u8], to: &mut Vec<u8>) {
        over(from).interleaved::<7>().map_into(&mut Output::append(to, from.len()), |fields| fields);
    }
    /// A record is longer than a block.
    #[kernel]
    pub fn appended_words(from: &[u32], to: &mut Vec<u32>) {
        over(from).interleaved::<5>().map_into(&mut Output::append(to, from.len()), |fields| fields);
    }
}
use simd::*;

#[test]
fn to_an_output() {
    let from: Vec<u8> = (0..1500).map(|i| (i % 251) as u8).collect();
    for len in (0..from.len()).step_by(if cfg!(miri) { 131 } else { 1 }) {
        for target in appended::targets() {
            let mut to = vec![7];
            appended::to(target, &from[..len], &mut to).unwrap();
            assert!(to[0] == 7 && to[1..] == from[..len / 7 * 7], "{target:?} {len}");
        }
    }
}

#[test]
fn words_to_an_output() {
    let from: Vec<u32> = (1..300).collect();
    for len in (0..from.len()).step_by(if cfg!(miri) { 41 } else { 1 }) {
        for target in appended_words::targets() {
            let mut to = vec![7];
            appended_words::to(target, &from[..len], &mut to).unwrap();
            assert!(to[0] == 7 && to[1..] == from[..len / 5 * 5], "{target:?} {len}");
        }
    }
}

fn check<T: Unsigned, W: Width + Copy, const K: usize>(w: W) {
    let n = W::BYTES / size_of::<T>();
    let values: Vec<T> = (0..3 * K * n + 9)
        .map(|i| T::from_u64((i as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 33 >> 1 << 1))
        .collect();
    for len in (0..K * n + 2).step_by(if cfg!(miri) { 29 } else { 1 }).chain([K * n, 2 * K * n, 3 * K * n - 1]) {
        for target in Target::combinations() {
            let (from, fits, mut out) = (&values[len % 7..][..len], len.min(K * n), vec![T::MAX; len + 2]);
            let Some(got) = both::to(target, from, &mut out[1..][..len], w, [(); K]) else { continue };
            assert!(
                (0..K * n).all(|i| got[i % K * n + i / K] == if i < len { from[i] } else { T::ZERO }),
                "{target:?} {K} {len}"
            );
            assert!(
                out[0] == T::MAX && out[1..][..fits] == from[..fits] && out[1 + fits..].iter().all(|&it| it == T::MAX),
                "{target:?} {K} {len}"
            );
        }
    }
}
fn check_cells<T: Unsigned, W: Width + Copy, const K: usize>(w: W) {
    for len in (0..3 * K * W::BYTES / size_of::<T>()).step_by(if cfg!(miri) { 31 } else { 1 }) {
        for target in Target::combinations() {
            let (from, to): (Vec<_>, Vec<_>) =
                ((0..len).map(|i| Cell::new(T::from_usize(i % 251))).collect(), vec![Cell::new(T::MAX); len + 1]);
            if cells::to(target, &from, &to, w, [(); K]).is_none() {
                continue;
            }
            assert!(
                (0..=len).all(|i| to[i].get() == if i < len / K * K { from[i].get() } else { T::MAX }),
                "{target:?} {K} {len}"
            );
        }
    }
}
fn check_mapped<T: Unsigned, W: Width + Copy, const K: usize>(w: W) {
    for n in (0..5 * W::BYTES / size_of::<T>() + 2).step_by(if cfg!(miri) { 5 } else { 1 }) {
        let from: Vec<T> = (0..n * K).map(|i| T::from_usize(i % 251)).collect();
        for target in Target::combinations() {
            let (mut to, mut last) = (vec![T::MAX; n * K + 1], vec![T::MAX; n + 1]);
            if mapped::to(target, &from, &mut to, &mut last, w, [(); K]).is_none() {
                continue;
            }
            let of = |i| {
                if i % K == 0 {
                    i + K - 1
                } else if i % K == K - 1 {
                    i + 1 - K
                } else {
                    i
                }
            };
            assert!((0..n * K).all(|i| to[i] == from[of(i)]) && to[n * K] == T::MAX, "{target:?} {K} {n}");
            let mut both = from.clone();
            in_place::to(target, Cell::from_mut(&mut both[..]).as_slice_of_cells(), w, [(); K]);
            assert!((0..n * K).all(|i| both[i] == !from[of(i)]), "{target:?} {K} {n}");
            assert!((0..n).all(|i| last[i] == from[i * K + K - 1]) && last[n] == T::MAX, "{target:?} {K} {n}");
        }
    }
}
#[test]
fn to_slices() {
    check_mapped::<u8, _, 5>(B32);
    check_mapped::<u16, _, 9>(B64);
    check_mapped::<u32, _, 13>(B32);
    check_mapped::<u32, _, 9>(B64);
    check_mapped::<u32, _, 9>(B16);
    check_mapped::<u32, _, 5>(B32);
    check_mapped::<u32, _, 10>(B32);
    check_mapped::<u32, _, 6>(B64);
    check_mapped::<u32, _, 8>(B16);
    check_mapped::<u32, _, 3>(B16);
    check_mapped::<u8, _, 5>(B16);
    check_mapped::<u64, _, 7>(B32)
}
#[test]
fn of_cells() {
    check_cells::<u8, _, 6>(B32);
    check_cells::<u32, _, 9>(B64);
    check_cells::<u32, _, 10>(B32);
    check_cells::<u8, _, 16>(B128)
}
#[test]
fn records_of_one_value() {
    #[bun_simd::simd]
    fn on() {
        check_mapped::<u8, _, 1>(B16);
        check_mapped::<u8, _, 1>(B64);
        check_mapped::<u32, _, 1>(B32);
        check_mapped::<u64, _, 1>(B128);
        check_cells::<u8, _, 1>(B32);
        check_cells::<u32, _, 1>(B128);
        let from: Vec<u16> = (0..100).collect();
        for len in 0..from.len() {
            let (mut all, mut bytes) = (vec![], vec![[9u8; 2]; len + 1]);
            over(&from[..len]).interleaved::<1>().scan_into(&mut Output::append(&mut all, len), |v| v);
            over(&from[..len]).scan_into(&mut bytes[..], |v| [v]);
            assert!(all == from[..len] && (0..len).all(|i| bytes[i] == from[i].to_le_bytes()) && bytes[len] == [9; 2]);
            let (mut one, mut two) = (vec![7; len + 1], vec![7; len + 1]);
            over(&from[..len]).map_into(&mut one[..], |v| [v + 1]);
            over(&from[..len]).zip(&from[..len]).map_into(&mut two[..], |(a, b)| [a + b]);
            assert!((0..len).all(|i| (one[i], two[i]) == (from[i] + 1, 2 * from[i])) && (one[len], two[len]) == (7, 7));
        }
    }
    on::<bun_simd::target::Baseline>()
}
#[test]
#[should_panic]
fn too_short_to_load_one() {
    #[bun_simd::simd]
    fn on() {
        let _ = u8x16::load_interleaved::<1>(&[0; 15][..]);
    }
    on::<bun_simd::target::Baseline>()
}
#[test]
#[should_panic]
fn too_short_to_store_one() {
    #[bun_simd::simd]
    fn on() {
        u8x16::store_interleaved([u8x16::zero()], &mut [0; 15][..]);
    }
    on::<bun_simd::target::Baseline>()
}
macro_rules! cases { ($($name:ident: $($t:ty, $w:ident [$($k:literal)*];)*,)*) => {$( #[test] fn $name() { $($(check::<$t, _, $k>($w);)*)* } )*}; }
cases! {
    bytes: u8, B16 [5 6 7 8 9 16]; u8, B32 [5 8 11]; u8, B64 [7 8 15 16];,
    narrow: u8, B8 [5 7 8 9]; u8, B4 [5]; u8, B2 [6]; u16, B2 [5]; u16, B8 [7]; u32, B8 [5];,
    words: u16, B16 [5 8 9]; u16, B32 [6 16]; u16, B64 [7 12];,
    wider_lanes: u32, B16 [5 6 7 8 9 14 15]; u32, B32 [6 8 10 11]; u32, B64 [5 6 7 8 10 13 14 16]; u64, B16 [5]; u64, B32 [16]; u64, B64 [9];,
    wide: u8, B128 [8]; u32, B128 [9]; u64, B512 [5];,
    one: u8, B2 [1]; u8, B16 [1]; u8, B64 [1]; u16, B32 [1]; u32, B64 [1]; u64, B16 [1]; u8, B512 [1];,
}

#[test]
#[should_panic]
fn too_short_to_load() {
    #[bun_simd::simd]
    fn on() {
        let _ = u8x16::load_interleaved::<9>(&[0; 143][..]);
    }
    on::<bun_simd::target::Baseline>()
}
#[test]
#[should_panic]
fn too_few_cells_to_load() {
    #[bun_simd::simd]
    fn on() {
        let _ = u8x16::load_interleaved::<9>(&[const { Cell::new(0) }; 143][..]);
    }
    on::<bun_simd::target::Baseline>()
}
#[test]
#[should_panic]
fn too_short_to_store() {
    #[bun_simd::simd]
    fn on() {
        u8x16::store_interleaved([u8x16::zero(); 5], &mut [0; 79][..]);
    }
    on::<bun_simd::target::Baseline>()
}
#[test]
fn whole_vectors() {
    #[bun_simd::simd]
    fn on() {
        fn with<const K: usize>() {
            let (from, mut to): (Vec<u16>, _) = ((0..8 * K as u16).collect(), vec![0; 8 * K]);
            let all = u16x8::load_interleaved::<K>(&from);
            assert!((0..8 * K).all(|i| all[i % K][i / K] == from[i]));
            u16x8::store_interleaved(all, &mut to);
            assert_eq!(to, from);
        }
        with::<1, S>();
        with::<5, S>();
        with::<16, S>();
    }
    on::<bun_simd::target::Baseline>()
}
