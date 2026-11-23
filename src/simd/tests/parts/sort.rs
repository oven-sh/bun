use bun_simd::{target::*, *};

fn check<T: Lane>(make: fn(u64) -> T, bits: fn(T) -> u64, order: fn(&T, &T) -> std::cmp::Ordering) {
    let mut state = 1u64;
    let mut random = move || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state ^ state >> 29
    };
    for &target in Target::ALL {
        for len in (0..600).chain([1000, 4097, 30_000]) {
            let mask = [!0, 0, 1, 15, 1023, !0 << 60 | 1 << 31 | 1 << 15 | 3][len % 6];
            let mut values: Vec<T> =
                (0..len).map(|_| make(random() & mask ^ if len % 12 < 6 { 0 } else { !0 })).collect();
            match len % 7 {
                0 => values.sort_by(order),
                1 => values.sort_by(|a, b| order(b, a)),
                2 => values.sort_by_key(|&it| bits(it)),
                _ => {}
            }
            let mut expected = values.clone();
            expected.sort_by(order);
            if sorts::to(target, &mut values).is_some() {
                assert!(values.iter().zip(&expected).all(|(&a, &b)| bits(a) == bits(b)), "{target:?} {len}");
            }
        }
    }
}

/// Few inputs, each of a shape that takes another way.
fn shapes<T: Lane>(make: fn(u64) -> T, bits: fn(T) -> u64, order: fn(&T, &T) -> std::cmp::Ordering) {
    let mut state = 1u64;
    let mut random = move || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state ^ state >> 29
    };
    let ends = [0, 0x7f, 0x80, 0x7fff, 0x8000, 0x7fff_ffff, 0x8000_0000, !0 >> 1, 1 << 63, !0].map(make);
    let (least, greatest) = (ends.into_iter().min_by(order).unwrap(), ends.into_iter().max_by(order).unwrap());
    let mut all: Vec<Vec<T>> = (0..36)
        .chain([47, 63, 64, 65, 100, 128, 129, 200, 256, 257, 300, 700])
        .map(|len| (0..len).map(|_| make(random())).collect())
        .collect();
    for often in [least, greatest, make(1 << 63 | 1 << 31)] {
        all.push((0..1200).map(|_| if random() % 8 < 6 { often } else { make(random()) }).collect());
    }
    // Each second value is in order.
    all.push((0..600).map(|i| make(((i ^ 1) as u64 * 127) / 600)).collect());
    all.push((0..600).map(|i| make((((600 - i) ^ 1) as u64 * 127) / 602)).collect());
    // All vectors are the same, but their lanes are not.
    for (n, len) in [4, 8, 16, 32].into_iter().flat_map(|n| [(n, 17 * n), (n, 21 * n)]) {
        all.push((0..len).map(|i| make(if i % n < n / 2 { 1 } else { 9 })).collect());
        all.push((0..len).map(|i| make(if i % n < n - 1 { 1 } else { 9 })).collect());
        all.push((0..len).map(|i| make(if i % n == 1 { 1 } else { 9 })).collect());
    }
    for values in all {
        let (mut expected, mut room) = (values.clone(), vec![least; values.len() + 64]);
        expected.sort_by(order);
        let aligned = room.as_ptr().addr().wrapping_neg() % 64 / size_of::<T>();
        let room = &mut room[aligned..][..values.len()];
        for &target in Target::ALL {
            room.copy_from_slice(&values);
            if sorts::to(target, room).is_some() {
                assert!(room.iter().zip(&expected).all(|(&a, &b)| bits(a) == bits(b)), "{target:?} {}", values.len());
            }
        }
    }
}

macro_rules! both { ($t:ident, $($a:expr),*) => { mod $t {
    #[test] fn lengths() { super::check::<$t>($($a),*) }
    #[test] fn shapes() { super::shapes::<$t>($($a),*) }
} }; }
macro_rules! ints { ($($t:ident)*) => {$( both!($t, |it| it as $t, |it| it as u64, Ord::cmp); )*}; }

#[bun_simd::kernel(targets = bun_simd::target::Targets::ALL)]
fn sorts<T: bun_simd::Lane>(values: &mut [T]) {
    bun_simd::prelude::over_mut(values).sort()
}
