use bun_engine_number::Random;
use bun_engine_number::math::*;
use bun_engine_standalone as _;

const INFINITY: f64 = f64::INFINITY;
const NAN: f64 = f64::NAN;

#[track_caller]
fn assert_same(actual: f64, expected: f64) {
    let is_same = actual.to_bits() == expected.to_bits() || (actual.is_nan() && expected.is_nan());
    assert!(is_same, "{actual:e} is not {expected:e}");
}

#[test]
fn powers() {
    for (base, exponent, expected) in [
        (NAN, 0.0, 1.0),
        (NAN, -0.0, 1.0),
        (1.0, NAN, NAN),
        (1.0, INFINITY, NAN),
        (-1.0, -INFINITY, NAN),
        (-0.0, 0.5, 0.0),
        (-0.0, -0.5, INFINITY),
        (-INFINITY, 0.5, INFINITY),
        (-INFINITY, -0.5, 0.0),
        (-4.0, 0.5, NAN),
        (4.0, -0.5, 0.5),
        (-0.0, 3.0, -0.0),
        (-0.0, -3.0, -INFINITY),
        (-2.0, 3.0, -8.0),
        (2.0, 1000.0, 2f64.powi(1000)),
        (2.0, -1074.0, 5e-324),
        (10.0, 308.0, 1.0000000000000006e308),
        (-8.0, 1.0 / 3.0, NAN),
    ] {
        assert_same(pow(base, exponent), expected);
    }
}

#[test]
fn remainders() {
    for (dividend, divisor, expected) in [
        (5.5, 2.0, 1.5),
        (-5.5, -2.0, -1.5),
        (-4.0, 2.0, -0.0),
        (-0.0, 1.0, -0.0),
        (1.0, INFINITY, 1.0),
        (INFINITY, 1.0, NAN),
        (INFINITY, INFINITY, NAN),
        (1.0, 0.0, NAN),
        (NAN, 1.0, NAN),
        (1.0, NAN, NAN),
        (1e308, 3.0, 2.0),
        (1.5e-323, 1e-323, 5e-324),
    ] {
        assert_same(remainder(dividend, divisor), expected);
    }
    let mut random = Random::new(1);
    for _ in 0..20_000 {
        let divisor = f64::from_bits(random.next_u64());
        let multiple = divisor * (random.next_u64() >> (random.next_u32() % 64)) as f64;
        for dividend in [multiple.next_down(), multiple, multiple.next_up()] {
            assert_same(remainder(dividend, divisor), dividend % divisor);
        }
    }
}

#[test]
fn rounding_signs_and_extremes() {
    for (value, expected) in [
        (-0.5, -0.0),
        (-0.50001, -1.0),
        (0.49999999999999994, 0.0),
        (2.5, 3.0),
        (-2.5, -2.0),
        (4503599627370497.0, 4503599627370497.0),
        (NAN, NAN),
    ] {
        assert_same(round(value), expected);
    }
    for (value, expected) in [(-0.0, -0.0), (-3.0, -1.0), (INFINITY, 1.0), (NAN, NAN)] {
        assert_same(sign(value), expected);
    }
    for (a, b, larger, smaller) in [
        (0.0, -0.0, 0.0, -0.0),
        (1.0, NAN, NAN, NAN),
        (1.0, -INFINITY, 1.0, -INFINITY),
    ] {
        assert_same(max(a, b), larger);
        assert_same(max(b, a), larger);
        assert_same(min(a, b), smaller);
        assert_same(min(b, a), smaller);
    }
    assert_same(fround(1.337), 1.3370000123977661);
    assert_same(f16round(1.337), 1.3369140625);
    assert_same(atan2(-INFINITY, -INFINITY), -2.356194490192345);
    for (value, expected) in [(-0.0, -0.0), (-1.0, -INFINITY), (1.5, NAN), (1e-10, 1e-10)] {
        assert_same(atanh(value), expected);
    }
    assert!((atanh(-0.5) + 0.5493061443340548).abs() < 3e-16);
}

#[test]
fn hypotenuses() {
    let many = |values: &[f64]| {
        let mut hypot = Hypot::default();
        values.iter().for_each(|&value| hypot.add(value));
        hypot.result()
    };
    assert_same(hypot(3.0, -4.0), 5.0);
    assert_same(hypot(NAN, -INFINITY), INFINITY);
    assert_same(hypot3(0.0, -0.0, 0.0), 0.0);
    assert_same(hypot3(NAN, 0.0, 0.0), NAN);
    assert_same(hypot3(NAN, 0.0, -INFINITY), INFINITY);
    assert_same(
        hypot3(2f64.powi(1000), 2f64.powi(1001), 2f64.powi(1001)),
        3.0 * 2f64.powi(1000),
    );
    assert_same(many(&[1.0, -1.0, 1.0, 1.0]), 2.0);
    assert_same(many(&[0.0, -0.0, 0.0, 0.0]), 0.0);
    assert_same(many(&[NAN, 1.0, INFINITY, 1.0]), INFINITY);
    assert_same(many(&[NAN, 1.0, 1.0, 1.0]), NAN);
}

#[test]
fn precise_sums() {
    let sum = |terms: &mut dyn Iterator<Item = f64>| {
        let mut sum = PreciseSum::default();
        terms.for_each(|term| sum.add(term));
        sum.result()
    };
    let half_unit = f64::EPSILON / 2.0;
    let cases: [(&[f64], f64); 14] = [
        (&[], -0.0),
        (&[-0.0, -0.0], -0.0),
        (&[-0.0, 0.0], 0.0),
        (&[-1.0, 1.0], 0.0),
        (&[0.1, 0.2, 0.3], 0.6),
        (&[1e308, 1e308, -1e308], 1e308),
        (&[1e30, 0.1, -1e30], 0.1),
        (&[1.0, half_unit], 1.0),
        (&[-1.0, -half_unit, -5e-324], -1.0 - f64::EPSILON),
        (&[f64::MAX, 2f64.powi(970)], INFINITY),
        (&[f64::MAX, 2f64.powi(970), -5e-324], f64::MAX),
        (&[f64::MIN_POSITIVE, -5e-324], 2.225073858507201e-308),
        (&[INFINITY, 1.0, -INFINITY], NAN),
        (&[-INFINITY, f64::MAX, f64::MAX], -INFINITY),
    ];
    for (terms, expected) in cases {
        assert_same(sum(&mut terms.iter().copied()), expected);
        assert_same(PreciseSum::of(terms), expected);
    }
    let mut random = Random::new(1);
    for (length, spread) in [
        (3, 30),
        (255, 40),
        (256, 1),
        (257, 36),
        (5000, 38),
        (5000, 60),
    ] {
        let mut term = || f64::from_bits(random.next_u64() | 0x3ff << 52);
        let terms: Vec<f64> = (0..length)
            .map(|index| term() % 2.0 / 2f64.powi(index % spread))
            .filter(|term| term.is_finite())
            .collect();
        assert_same(PreciseSum::of(&terms), sum(&mut terms.iter().copied()));
    }
    let many = |term| core::iter::repeat_n(term, 10_000);
    assert_same(sum(&mut many(-0.1)), -1000.0);
    let mut cancelling = many(f64::MAX).chain([5e-324]).chain(many(-f64::MAX));
    assert_same(sum(&mut cancelling), 5e-324);
}

#[test]
fn random_numbers() {
    let mut random = Random::new(0);
    assert_eq!(random.seed(), 0);
    assert_eq!(random.next_u64(), Random::new(1).next_u64());
    let mut random = Random::new(42);
    let values = [random.next_f64(), random.next_f64(), random.next_f64()];
    assert_eq!(
        values,
        [
            3.911585177984733e-8,
            0.32812503913465796,
            0.6562500393869173
        ]
    );
}
