#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
include!("parts/sort.rs");
ints!(u64 i64);
both!(f64, f64::from_bits, f64::to_bits, f64::total_cmp);

/// The crate sorts short runs of these as floats.
fn edges<T: Lane>(make: fn(u64) -> T, bits: fn(T) -> u64, order: fn(&T, &T) -> std::cmp::Ordering) {
    let near = |it: u64| (-2..=2).map(move |by| it.wrapping_add_signed(by));
    let all: Vec<u64> = [0, 1 << 63]
        .into_iter()
        .flat_map(|it: u64| (-5..=5).flat_map(move |k| near(it.wrapping_add_signed(k << 52))))
        .collect();
    for (i, j) in (0..all.len()).flat_map(|i| (0..all.len()).map(move |j| (i, j))) {
        let len = [5, 8, 9, 16, 23, 32, 41, 64][(i + j / 3) % 8];
        let mut values: Vec<T> =
            (0..len).map(|k| make(all[i].wrapping_add_signed(k as i64 * 5 % 3 - (k % 2) as i64))).collect();
        values[1 + (i * 7 + j) % (len - 1)] = make(all[j]);
        let mut expected = values.clone();
        expected.sort_by(order);
        for &target in Target::ALL {
            let mut it = values.clone();
            if sorts::to(target, &mut it).is_some() {
                assert!(it.iter().zip(&expected).all(|(&a, &b)| bits(a) == bits(b)), "{target:?} {values:x?}");
            }
        }
    }
}
#[test]
fn at_the_edges() {
    edges::<u64>(|it| it, |it| it, Ord::cmp);
    edges::<i64>(|it| it as i64, |it| it as u64, Ord::cmp);
    edges::<f64>(f64::from_bits, f64::to_bits, f64::total_cmp);
}
