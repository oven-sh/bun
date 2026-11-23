#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(unused_variables, unused_imports)]
#![allow(clippy::unnecessary_mut_passed)]
include!("framework/over.rs");

fn in_order<T: Float>(values: impl Iterator<Item = T>) -> T {
    let all: Vec<T> = values.collect();
    let (a, b) = all.split_at(if size_of_val(&all[..]) >= 4096 { all.len() / 128 * 64 } else { 0 });
    part_in_order(a.iter().copied()) + part_in_order(b.iter().copied())
}
fn part_in_order<T: Float>(values: impl Iterator<Item = T>) -> T {
    let mut sums = vec![T::default(); 128 / size_of::<T>()];
    let mut n = sums.len();
    for (i, it) in values.enumerate() {
        sums[i % n] = sums[i % n] + it
    }
    while n > 1 {
        n /= 2;
        for i in 0..n {
            sums[i] = sums[i] + sums[n + i]
        }
    }
    sums[0]
}

#[kernel]
fn floats<T: Float, W: Width>(x: &[T], y: &[T], _width: W)
where
    T: Into<f64>,
{
    let s: S = bun_simd::prelude::isa();
    let bits = |it: T| {
        let it: f64 = it.into();
        if it.is_nan() { u64::MAX } else { it.to_bits() }
    };
    let over = s.over(x).by::<W>();
    assert_eq!(bits(over.sum()), bits(in_order(x.iter().copied())));
    let dot = |a: &[T], b: &[T]| in_order(a.iter().zip(b).map(|(&a, &b)| a * b));
    assert_eq!(bits(over.zip(y).dot()), bits(dot(x, y)));
    let (columns, mut to) = (x.len() / 5, [T::default(); 5]);
    s.over(&x[..5 * columns]).by::<W>().mat_vec(&y[..columns], &mut to);
    assert!((0..5).all(|i| bits(to[i]) == bits(dot(&x[i * columns..][..columns], &y[..columns]))));
    let numbers = || x.iter().map(|&it| it.into()).filter(|it: &f64| !it.is_nan());
    let or_nan = |it: Option<f64>| x.first().map(|_| it.map_or(u64::MAX, f64::to_bits));
    let (min, max) = (numbers().min_by(f64::total_cmp), numbers().max_by(f64::total_cmp));
    assert_eq!((over.min().map(bits), over.max().map(bits)), (or_nan(min), or_nan(max)));
    assert_eq!(over.min_max().map(|(a, b)| (bits(a), bits(b))), or_nan(min).zip(or_nan(max)));
    let at = |it: Option<f64>| x.first().map(|_| x.iter().position(|&v| Some(v.into()) == it).unwrap_or(0));
    assert_eq!((over.position_min(), over.position_max()), (at(min), at(max)));
    if numbers().count() == x.len() {
        assert_eq!((over.min_relaxed().map(T::into), over.max_relaxed().map(T::into)), (min, max));
    }
    let small: Vec<T> = (0..x.len()).map(|i| T::from_usize(i % 7)).collect();
    let small = (s.over(&small).by::<W>(), &small[..]);
    assert!(small.0.sum_relaxed() == small.0.sum() && small.0.zip(small.1).dot_relaxed() == small.0.zip(small.1).dot());
    let mut relaxed = [T::default(); 1];
    small.0.mat_vec_relaxed(small.1, &mut relaxed);
    assert!(relaxed[0] == small.0.zip(small.1).dot());
}

#[kernel]
fn half_sums(x: &[bf16]) -> (bf16, bf16) {
    let s: S = bun_simd::prelude::isa();
    (s.over(x).sum(), s.over(x).zip(x).dot())
}

#[test]
fn each_value_of_16_bits_counts() {
    for (len, at) in (1..150).chain([2047, 2048, 2200]).flat_map(|len| (0..len).map(move |at| (len, at))) {
        let mut x = vec![bf16::default(); len];
        x[at] = bf16::from_f32(3.0);
        on_each(|| assert_eq!(half_sums(&x), (bf16::from_f32(3.0), bf16::from_f32(9.0))));
    }
}

#[test]
fn floating_point() {
    fn of<T: Float + Into<f64>, W: Width>(width: W) {
        const SPECIAL: [f64; 6] = [f64::NAN, 0.0, -0.0, f64::INFINITY, f64::NEG_INFINITY, 1.5];
        for (len, mode) in (0..100).chain([257, 1000]).flat_map(|len| (0..8).map(move |mode| (len, mode))) {
            let value = |r: u64| match mode {
                0 => r as f64 / 3.0 - 1e8,
                1 => SPECIAL[r as usize % 6],
                2 => SPECIAL[r as usize % 3],
                3 => SPECIAL[0],
                4 => [f64::NAN, f64::INFINITY][r as usize % 2],
                5 => [f64::NAN, f64::NEG_INFINITY][(r % 50 == 0) as usize],
                6 => [1.0, 0.0, -0.0][(r % 40 == 0) as usize + (r % 80 == 0) as usize],
                _ => [-1.0, -0.0, 0.0][(r % 40 == 0) as usize + (r % 80 == 0) as usize],
            };
            let make = |seed| -> Vec<T> { random(len, seed).map(|it| T::from_f64(value(it))).collect() };
            let (x, y) = (make(len as u64), make(!(len as u64)));
            on_each(|| floats(&x, &y, width));
        }
    }
    of::<f32, _>(B16);
    of::<f64, _>(B32);
}

#[kernel]
fn sums<T: Float>(x: &[T], y: &[T], bits: &[u64]) -> [T; 5] {
    let s: S = bun_simd::prelude::isa();
    let x = s.over(x);
    [x.sum(), x.selected(bits).sum(), x.zip(y).dot(), x.sum_relaxed(), x.zip(y).dot_relaxed()]
}

#[test]
fn long_sums_at_each_address() {
    fn of<T: Float + Into<f64>>(tiny: f64) {
        let edges = [1024, 2048, 4096, 4608, 5120].map(|it| it / size_of::<T>());
        for (len, zeros) in edges.iter().flat_map(|it| it - 2..it + 70).flat_map(|len| [(len, false), (len, true)]) {
            let value = |it: u64, or| T::from_f64(if zeros { or } else { (it % 99999) as f64 / 7.0 - 7000.0 });
            let make = |seed, or| -> Vec<T> { random(len, seed).map(|it| value(it, or)).collect() };
            let (x, y, bits) = (make(1, -tiny), make(2, tiny), vec![!0; len.div_ceil(64)]);
            let want = [in_order(x.iter().copied()), in_order(x.iter().zip(&y).map(|(&a, &b)| a * b))];
            let show = |all: &[T]| all.iter().map(|&it| it.into().to_bits()).collect::<Vec<_>>();
            on_each(|| {
                let first = sums(&x, &y, &bits);
                assert_eq!(show(&first[..3]), show(&[want[0], want[0], want[1]]), "{len}");
                let off = |got: T, want: T, most: f64| (got.into() - want.into()).abs() <= most;
                assert!(off(first[3], want[0], 1.0) && off(first[4], want[1], 1e4), "{len}");
                for at in 0..64 / size_of::<T>() {
                    let moved = [&vec![T::from_f64(f64::NAN); at][..], &x, &[T::from_f64(f64::NAN); 16]].concat();
                    assert_eq!(show(&sums(&moved[at..][..len], &y, &bits)), show(&first), "{len} {at}");
                }
            });
        }
    }
    of::<f32>(1e-30);
    of::<f64>(1e-200);
}

#[kernel]
fn reverse<T: Lane>(x: &mut [T]) {
    let s: S = bun_simd::prelude::isa();
    s.over_mut(x).reverse()
}

#[test]
fn reversed_at_each_address() {
    fn of<T: Lane>() {
        let all: Vec<T> = (0..1400).map(|i| T::from_usize(i % 251)).collect();
        for (len, at) in (0..1300 / size_of::<T>()).flat_map(|len| (0..5).map(move |at| (len, (len * 5 + at) % 64))) {
            let mut want = all.clone();
            want[at..at + len].reverse();
            on_each(|| {
                let mut got = all.clone();
                reverse(&mut got[at..at + len]);
                assert!(got == want, "{len} {at}");
            });
        }
    }
    of::<u8>();
    of::<u16>();
    of::<f32>();
    of::<u64>();
}

#[kernel]
fn bytes<W: Width>(x: &[u8], set: &[u8], _width: W) {
    let s: S = bun_simd::prelude::isa();
    let (over, any) = (s.over(x).by::<W>(), ByteSet::of(set));
    let want = x.iter().position(|it| set.contains(it));
    assert_eq!((over.position(|v| any.contains(v)), over.position_of_any(set)), (want, want));
    if const { W::BYTES >= 16 } {
        let block: [u8; 16] = core::array::from_fn(|i| set[i % set.len()] | 1);
        let want = x.iter().position(|it| block.contains(it));
        assert_eq!(over.position(|v| v.is_in(block)), want);
        assert_eq!(over.position(|v| v.in_blocks().is_in(s.repeat(&block))), want);
        let want = x.iter().position(|it| block.contains(&(it | 1)));
        assert_eq!(over.position(|v| (v | 1).is_in_relaxed(block)), want);
        assert_eq!(over.position(|v| (v | 1).in_blocks().is_in_relaxed(s.repeat(&block))), want);
    }
    if W::BYTES >= 4 {
        let signed: Vec<i8> = x.iter().map(|&it| it as i8).collect();
        let wide: Vec<i16> = signed.iter().map(|&it| it as i16 * 200).collect();
        assert_eq!(over.zip(x).dot_wide(), x.iter().map(|&it| it as u32 * it as u32).sum());
        assert_eq!(over.zip(&signed).dot_wide(), x.iter().map(|&it| it as i32 * it as i8 as i32).sum());
        assert_eq!(
            s.over(&signed).by::<W>().zip(&signed).dot_wide(),
            signed.iter().map(|&it| it as i32 * it as i32).sum()
        );
        let want = wide.iter().fold(0i32, |sum, &it| sum.wrapping_add(it as i32 * it as i32));
        assert_eq!(s.over(&wide).by::<W>().zip(&wide).dot_wide(), want);
    }
}

#[test]
fn sets() {
    for len in 0..200 {
        let (x, set): (Vec<u8>, Vec<u8>) = (
            random(len, len as u64).map(|it| it as u8).collect(),
            random(1 + len % 23, 7).map(|it| it as u8).collect(),
        );
        on_each(|| {
            bytes(&x, &set, B8);
            bytes(&x, &set, B32)
        });
    }
}

#[bun_simd::simd]
mod stamped {
    use bun_simd::prelude::*;
    use core::sync::atomic::AtomicU8;

    #[kernel]
    pub fn inferred(shared: &[AtomicU8]) -> [Option<usize>; 6] {
        let (array, mut vec) = ([1u16, 2, 3], vec![1.0f32, 2.0]);
        over_mut(&mut vec).map(|v| v + 1.0);
        let mut wide = [0u32; 3];
        u16x4::over(&array).zip_scaled(b"abc").map_into(&mut wide, |(a, _)| a.cast::<u32>());
        u32x4::over_mut(&mut wide).map(|v| v + 1);
        let mut kept = [0; 2];
        [
            over(&array).position(|v| v.simd_eq(2)),
            over(&vec).position(|v| v.simd_eq(3.0)),
            over(b"xyz").rposition(|v| v.simd_eq(b'z')),
            over(shared).position(|v| v.simd_eq(5)),
            over(&mut wide).position(|v| v.simd_eq(4)),
            Some(over(&wide).filter_into(&mut kept, |v| v.simd_gt(2))),
        ]
    }
}

#[test]
fn types_are_inferred() {
    assert_eq!(stamped::inferred(&[4, 5].map(AtomicU8::new)), [1, 1, 2, 1, 2, 2].map(Some));
}

/// A closure that changes its mind gets an index in the slice.
#[test]
fn fickle_closures() {
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn find<T: Int, W: Width>(values: &[T], look: usize, _of: W) -> [Option<usize>; 3] {
        let s: S = bun_simd::prelude::isa();
        let looks = core::cell::Cell::new(0);
        let once = |v: Simd<T, W, S>| if looks.replace(looks.get() + 1) == look { v.simd_eq(v) } else { v.simd_ne(v) };
        let first = s.over(values).by::<W>().position(once);
        looks.set(0);
        let last = s.over(values).by::<W>().rposition(once);
        looks.set(0);
        [first, last, s.over(values).by::<W>().zip(values).position(|(v, _)| once(v))]
    }
    let (bytes, words, quads) = ([1u8; 400], [1u16; 400], [1u64; 400]);
    for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
        for len in 0..400 {
            for look in 0..24 {
                let all = [
                    find::to(target, &bytes[..len], look, B16),
                    find::to(target, &bytes[..len], look, B32),
                    find::to(target, &bytes[..len], look, B64),
                    find::to(target, &words[..len], look, B8),
                    find::to(target, &words[..len], look, B16),
                    find::to(target, &words[..len], look, B32),
                    find::to(target, &quads[..len], look, B16),
                    find::to(target, &quads[..len], look, B32),
                    find::to(target, &quads[..len], look, B128),
                ];
                assert!(
                    all.iter().flatten().flatten().flatten().all(|&at| at < len),
                    "{all:?} of {len} at look {look} on {target:?}"
                );
            }
        }
    }
}

#[test]
fn filters_of_more_than_64_lanes() {
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn kept<T: Int, W: Width>(values: &[T], one: T, _of: W) -> bool {
        let s: S = bun_simd::prelude::isa();
        let (want, odd): (Vec<T>, _) =
            (values.iter().copied().filter(|&it| it & one == one).collect(), |v: Simd<T, W, S>| v.all_bits(one));
        let (mut to, mut copy, mut grown) = (vec![one; want.len()], values.to_vec(), vec![]);
        let counts = [
            s.over(values).by::<W>().filter_into(&mut to, odd),
            s.over_mut(&mut copy).by::<W>().retain(odd),
            s.over(values).by::<W>().filter_into(&mut Output::append(&mut grown, values.len()), odd),
        ];
        let mut cells = vec![one; want.len()];
        let into_cells =
            s.over(values).by::<W>().filter_into(&mut Cell::from_mut(&mut cells[..]).as_slice_of_cells(), odd);
        counts == [want.len(); 3]
            && into_cells == want.len()
            && to == want
            && copy[..want.len()] == want
            && grown == want
            && cells == want
    }
    for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
        for len in (0..300).chain([1000, 1279, 1280, 3000]) {
            let (bytes, words): (Vec<_>, Vec<_>) = random(len, len as u64).map(|it| (it as u8, it as u16)).unzip();
            assert_eq!(
                [
                    kept::to(target, &bytes, 1, B128),
                    kept::to(target, &bytes, 1, B256),
                    kept::to(target, &words, 1, B256)
                ],
                [Some(true); 3],
                "{len} on {target:?}"
            );
        }
    }
}
