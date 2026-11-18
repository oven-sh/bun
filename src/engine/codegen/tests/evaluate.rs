//! Operations on constants against the arithmetic of the host.

mod support;

use bun_engine_asm::{Cond, FloatCond, Rounding, Sign, Size};
use bun_engine_codegen::ir::Type::{F32, F64, I32, I64};
use bun_engine_codegen::ir::{Binary, Checked, Unary, evaluate};
use support::random::Random;

fn integers() -> Vec<u64> {
    let mut random = Random::new(1);
    let powers = (0..64).map(|bit| 1u64 << bit);
    let around = powers.flat_map(|power| [power, power - 1, power + 1, power.wrapping_neg()]);
    let some = around
        .step_by(3)
        .chain([0, 1, 7, u64::MAX, 1 << 31, 1 << 63]);
    let narrow = [u32::MAX.into(), i32::MAX as u64, i64::MAX as u64];
    (some.chain(narrow))
        .chain((0..40).map(|_| random.next() >> random.below(64)))
        .collect()
}

fn doubles() -> Vec<f64> {
    let mut random = Random::new(2);
    let edges = [
        8, 24, 31, 32, 53, 63, 64, 127, 128, -14, -24, -126, -149, -1074,
    ];
    let around = edges.into_iter().flat_map(|exponent| {
        let power = 2f64.powi(exponent);
        let single = f64::from((power as f32).next_down());
        [
            power,
            power.next_up(),
            power.next_down(),
            single,
            power - 0.5,
        ]
    });
    let halves = (0..8).map(|count| f64::from(count) / 2.0);
    let special = [
        f64::INFINITY,
        f64::NAN,
        f64::from_bits(0x7ff0_0000_0000_0001),
        65519.99,
        65520.0,
    ];
    let some = (0..30).flat_map(|_| {
        let bits = random.next();
        [f64::from_bits(bits), f32::from_bits(bits as u32).into()]
    });
    let magnitudes = around.chain(halves).chain(special).chain(some);
    magnitudes.flat_map(|value| [value, -value]).collect()
}

fn singles() -> Vec<f32> {
    let converted = doubles().into_iter().map(|value| value as f32);
    converted.chain([f32::from_bits(0x7f80_0001)]).collect()
}

macro_rules! integer_tests {
    ($name:ident, $ty:ident, $signed:ty, $unsigned:ty, $wide_signed:ty, $wide_unsigned:ty) => {
        #[test]
        fn $name() {
            let bits = |value: $signed| value as $unsigned as u64;
            let width = <$signed>::BITS;
            for a in integers() {
                let (a, ua) = (a as $signed, a as $unsigned);
                let unary = |op| evaluate::unary(op, $ty, $ty, bits(a)).unwrap();
                assert_eq!(unary(Unary::Neg), bits(a.wrapping_neg()));
                assert_eq!(unary(Unary::CountLeadingZeros), a.leading_zeros().into());
                assert_eq!(unary(Unary::CountTrailingZeros), a.trailing_zeros().into());
                assert_eq!(unary(Unary::CountOnes), a.count_ones().into());
                assert_eq!(
                    unary(Unary::SwapBytes($ty.width().size())),
                    bits(a.swap_bytes())
                );
                assert_eq!(
                    unary(Unary::SwapBytes(Size::S16)),
                    (a as u16).swap_bytes().into()
                );
                assert_eq!(
                    unary(Unary::SwapBytes(Size::S32)),
                    (a as u32).swap_bytes().into()
                );
                assert_eq!(unary(Unary::SignExtend(Size::S8)), bits((a as i8).into()));
                assert_eq!(unary(Unary::SignExtend(Size::S16)), bits((a as i16).into()));
                let to_float =
                    |sign, to| evaluate::unary(Unary::IntToFloat(sign), $ty, to, bits(a));
                assert_eq!(
                    to_float(Sign::Signed, F32),
                    Some((a as f32).to_bits().into())
                );
                assert_eq!(
                    to_float(Sign::Unsigned, F32),
                    Some((ua as f32).to_bits().into())
                );
                assert_eq!(to_float(Sign::Signed, F64), Some((a as f64).to_bits()));
                assert_eq!(to_float(Sign::Unsigned, F64), Some((ua as f64).to_bits()));

                for b in integers() {
                    let (b, ub) = (b as $signed, b as $unsigned);
                    let amount = b as u32;
                    let high = (<$wide_signed>::from(a) * <$wide_signed>::from(b)) >> width;
                    let unsigned_high =
                        (<$wide_unsigned>::from(ua) * <$wide_unsigned>::from(ub)) >> width;
                    let total =
                        |f: fn($signed, $signed) -> $signed| Some(if b == 0 { 0 } else { f(a, b) });
                    for (op, expected) in [
                        (Binary::Add, Some(a.wrapping_add(b))),
                        (Binary::Sub, Some(a.wrapping_sub(b))),
                        (Binary::Mul, Some(a.wrapping_mul(b))),
                        (Binary::Div, a.checked_div(b)),
                        (Binary::Rem, a.checked_rem(b)),
                        (
                            Binary::UnsignedDiv,
                            ua.checked_div(ub).map(|q| q as $signed),
                        ),
                        (
                            Binary::UnsignedRem,
                            ua.checked_rem(ub).map(|r| r as $signed),
                        ),
                        (Binary::TotalDiv, total(<$signed>::wrapping_div)),
                        (Binary::TotalRem, total(<$signed>::wrapping_rem)),
                        (Binary::MulHigh(Sign::Signed), Some(high as $signed)),
                        (
                            Binary::MulHigh(Sign::Unsigned),
                            Some(unsigned_high as $signed),
                        ),
                        (Binary::And, Some(a & b)),
                        (Binary::Or, Some(a | b)),
                        (Binary::Xor, Some(a ^ b)),
                    ] {
                        let actual = evaluate::binary(op, $ty, bits(a), bits(b));
                        assert_eq!(actual, expected.map(bits), "{op:?} {a} {b}");
                    }
                    for (op, expected) in [
                        (Binary::Shl, a.wrapping_shl(amount)),
                        (Binary::Shr, ua.wrapping_shr(amount) as $signed),
                        (Binary::Sar, a.wrapping_shr(amount)),
                        (Binary::RotateLeft, a.rotate_left(amount)),
                        (Binary::RotateRight, a.rotate_right(amount)),
                    ] {
                        let actual = evaluate::binary(op, $ty, bits(a), amount.into());
                        assert_eq!(actual, Some(bits(expected)), "{op:?} {a} {amount}");
                    }
                    for (op, expected) in [
                        (Checked::Add, a.checked_add(b)),
                        (Checked::Sub, a.checked_sub(b)),
                        (Checked::Mul, a.checked_mul(b)),
                    ] {
                        assert_eq!(
                            evaluate::checked(op, $ty, bits(a), bits(b)),
                            expected.map(bits)
                        );
                    }
                    let expected = [
                        a == b,
                        a != b,
                        a < b,
                        a >= b,
                        a <= b,
                        a > b,
                        ua < ub,
                        ua >= ub,
                        ua <= ub,
                        ua > ub,
                    ];
                    for (cond, expected) in Cond::ALL.into_iter().zip(expected) {
                        assert_eq!(evaluate::compare(cond, $ty, bits(a), bits(b)), expected);
                        assert_eq!(
                            evaluate::compare(cond.commuted(), $ty, bits(b), bits(a)),
                            expected
                        );
                    }
                }
            }
        }
    };
}

integer_tests!(integers_of_32_bits, I32, i32, u32, i64, u64);
integer_tests!(integers_of_64_bits, I64, i64, u64, i128, u128);

#[test]
fn integers_change_width() {
    for a in integers() {
        let narrow = u64::from(a as u32);
        let widen = |sign| evaluate::unary(Unary::Widen(sign), I32, I64, narrow);
        assert_eq!(widen(Sign::Signed), Some(i64::from(a as i32) as u64));
        assert_eq!(widen(Sign::Unsigned), Some(narrow));
        assert_eq!(evaluate::unary(Unary::Wrap, I64, I32, a), Some(narrow));
    }
}

macro_rules! float_tests {
    ($name:ident, $ty:ident, $float:ty, $values:ident) => {
        #[test]
        fn $name() {
            let bits = |value: $float| u64::from(value.to_bits());
            let (sign, quiet) = (bits(-0.0), bits(<$float>::NAN));
            let assert_arithmetic =
                |actual: Option<u64>, expected: $float, operands: [$float; 2]| {
                    let actual = actual.unwrap();
                    let is_canonical =
                        |value: &$float| !value.is_nan() || bits(*value) & !sign == quiet;
                    if !expected.is_nan() {
                        assert_eq!(actual, bits(expected), "{operands:?}");
                    } else if operands.iter().all(is_canonical) {
                        assert_eq!(actual & !sign, quiet);
                    } else {
                        assert_eq!(actual & quiet, quiet);
                    }
                };
            for a in $values() {
                let unary = |op| evaluate::unary(op, $ty, $ty, bits(a));
                assert_eq!(unary(Unary::Neg), Some(bits(a) ^ sign));
                assert_eq!(unary(Unary::Abs), Some(bits(a) & !sign));
                for (op, expected) in [
                    (Unary::Sqrt, a.sqrt()),
                    (Unary::Round(Rounding::Down), a.floor()),
                    (Unary::Round(Rounding::Up), a.ceil()),
                    (Unary::Round(Rounding::TowardZero), a.trunc()),
                    (Unary::Round(Rounding::Nearest), a.round_ties_even()),
                ] {
                    assert_arithmetic(unary(op), expected, [a, a]);
                }
                let exact = a as i128;
                for (sign, to, saturated, fits) in [
                    (
                        Sign::Signed,
                        I32,
                        u64::from(a as i32 as u32),
                        i32::try_from(exact).is_ok(),
                    ),
                    (
                        Sign::Unsigned,
                        I32,
                        u64::from(a as u32),
                        u32::try_from(exact).is_ok(),
                    ),
                    (
                        Sign::Signed,
                        I64,
                        a as i64 as u64,
                        i64::try_from(exact).is_ok(),
                    ),
                    (Sign::Unsigned, I64, a as u64, u64::try_from(exact).is_ok()),
                ] {
                    let convert = |op| evaluate::unary(op, $ty, to, bits(a));
                    assert_eq!(convert(Unary::FloatToIntSaturating(sign)), Some(saturated));
                    let expected = (fits && !a.is_nan()).then_some(saturated);
                    assert_eq!(
                        convert(Unary::FloatToInt(sign)),
                        expected,
                        "{a} {sign:?} {to:?}"
                    );
                }

                for b in $values() {
                    let binary = |op| evaluate::binary(op, $ty, bits(a), bits(b));
                    let has_nan = a.is_nan() || b.is_nan();
                    let (least, greatest) = match a.total_cmp(&b) {
                        _ if has_nan => (<$float>::NAN, <$float>::NAN),
                        std::cmp::Ordering::Greater => (b, a),
                        _ => (a, b),
                    };
                    for (op, expected) in [
                        (Binary::Add, a + b),
                        (Binary::Sub, a - b),
                        (Binary::Mul, a * b),
                        (Binary::Div, a / b),
                        (Binary::Min, least),
                        (Binary::Max, greatest),
                    ] {
                        assert_arithmetic(binary(op), expected, [a, b]);
                    }
                    assert_eq!(
                        binary(Binary::CopySign),
                        Some(bits(a) & !sign | bits(b) & sign)
                    );
                    let ordered = [
                        a == b,
                        a != b && !has_nan,
                        a < b,
                        a <= b,
                        a > b,
                        a >= b,
                        !has_nan,
                    ];
                    for (pair, expected) in FloatCond::ALL.as_chunks::<2>().0.iter().zip(ordered) {
                        let compare =
                            |cond, a, b| evaluate::float_compare(cond, $ty, bits(a), bits(b));
                        assert_eq!(pair.map(|cond| compare(cond, a, b)), [expected, !expected]);
                        assert_eq!(compare(pair[0].commuted(), b, a), expected);
                        assert_eq!(compare(pair[1].commuted(), b, a), !expected);
                    }
                }
            }
        }
    };
}

float_tests!(floats_of_32_bits, F32, f32, singles);
float_tests!(floats_of_64_bits, F64, f64, doubles);

#[test]
fn floats_change_width() {
    for a in doubles() {
        let demoted = evaluate::unary(Unary::Demote, F64, F32, a.to_bits()).unwrap();
        let canonical = evaluate::unary(Unary::CanonicalizeNan, F64, F64, a.to_bits()).unwrap();
        if a.is_nan() {
            assert_eq!(demoted & 0x7fc0_0000, 0x7fc0_0000);
            assert_eq!(canonical, evaluate::CANONICAL_NAN);
        } else {
            assert_eq!(demoted, (a as f32).to_bits().into());
            assert_eq!(canonical, a.to_bits());
        }
    }
    for a in singles() {
        let promoted = evaluate::unary(Unary::Promote, F32, F64, a.to_bits().into()).unwrap();
        if a.is_nan() {
            assert_eq!(promoted & evaluate::CANONICAL_NAN, evaluate::CANONICAL_NAN);
        } else {
            assert_eq!(promoted, f64::from(a).to_bits());
        }
    }
}

#[test]
fn doubles_wrap_to_32_bits() {
    for a in doubles() {
        // From 2^84 up the low 32 bits are zero.
        let expected = if a.abs() < 2f64.powi(100) {
            a as i128 as u32
        } else {
            0
        };
        let actual = evaluate::unary(Unary::FloatToInt32Modular, F64, I32, a.to_bits());
        assert_eq!(actual, Some(expected.into()), "{a}");
    }
}

fn from_half(bits: u64) -> f64 {
    f64::from_bits(evaluate::unary(Unary::HalfBitsToFloat, I32, F64, bits).unwrap())
}

fn to_half(value: f64) -> u64 {
    evaluate::unary(Unary::FloatToHalfBits, F64, I32, value.to_bits()).unwrap()
}

#[test]
fn halves_have_their_known_values() {
    for (bits, value) in [
        (0x0001, 2f64.powi(-24)),
        (0x03ff, 1023.0 * 2f64.powi(-24)),
        (0x0400, 2f64.powi(-14)),
        (0x3555, 0.333_251_953_125),
        (0x3c00, 1.0),
        (0x7bff, 65504.0),
        (0x7c00, f64::INFINITY),
        (0xc000, -2.0),
    ] {
        assert_eq!(from_half(bits), value);
        assert_eq!(from_half(bits | 0xabcd_0000), value);
    }
    assert!(from_half(0x7c01).is_nan() && from_half(0xfe00).is_nan());
    assert_eq!(to_half(f64::NAN) & 0x7fff, 0x7e00);
}

#[test]
fn doubles_round_to_the_nearest_half_and_ties_to_the_even_one() {
    const LARGEST: u64 = 0x7bff;
    for bits in 0..=LARGEST {
        let low = from_half(bits);
        let high = if bits == LARGEST {
            65536.0
        } else {
            from_half(bits + 1)
        };
        let middle = (low + high) / 2.0;
        for sign in [0, 0x8000] {
            let signed = |value: f64| if sign == 0 { value } else { -value };
            assert_eq!(to_half(signed(low)), sign | bits);
            assert_eq!(to_half(signed(middle.next_down())), sign | bits);
            assert_eq!(to_half(signed(middle)), sign | bits.next_multiple_of(2));
            assert_eq!(to_half(signed(middle.next_up())), sign | (bits + 1));
        }
    }
}
