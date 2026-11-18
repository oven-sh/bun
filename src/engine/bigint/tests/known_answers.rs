mod common;

use core::cmp::Ordering::{Equal, Greater, Less};

use bun_engine_bigint::*;
use bun_engine_text::Text;
use common::*;

const ONES_192: &str = "0xffffffffffffffffffffffffffffffffffffffffffffffff";
const TWO_192: &str = "0x1000000000000000000000000000000000000000000000000";

fn negated(text: &str) -> String {
    format!("-{text}")
}

fn show(value: &BigInt, radix: u32) -> String {
    let text = value.as_ref().to_string_ref(radix, &mut || false).unwrap();
    text.to_string()
}

#[test]
fn binary_operators() {
    let (minus_ones, minus_two_192) = (&*negated(ONES_192), &*negated(TWO_192));
    for (x, operator, y, expected) in [
        ("0xffffffffffffffff", "+", "1", "0x10000000000000000"),
        (ONES_192, "+", "1", TWO_192),
        (TWO_192, "+", minus_ones, "1"),
        (ONES_192, "-", TWO_192, "-1"),
        (ONES_192, "-", ONES_192, "0"),
        ("0", "-", ONES_192, minus_ones),
        ("-3", "*", "0", "0"),
        (ONES_192, "*", "-1", minus_ones),
        (
            "0xffffffffffffffffffffffffffffffff",
            "*",
            "0xffffffffffffffffffffffffffffffff",
            "0xfffffffffffffffffffffffffffffffe00000000000000000000000000000001",
        ),
        ("-7", "/", "2", "-3"),
        ("-7", "%", "2", "-1"),
        ("7", "%", "-2", "1"),
        (
            ONES_192,
            "/",
            "0xffffffffffffffffffffffff",
            "0x1000000000000000000000001",
        ),
        (TWO_192, "/", ONES_192, "1"),
        (TWO_192, "%", ONES_192, "1"),
        (minus_two_192, "%", "0x10000000000000000", "0"),
        ("0", "**", "0", "1"),
        ("-1", "**", TWO_192, "1"),
        ("-1", "**", ONES_192, "-1"),
        ("-2", "**", "192", TWO_192),
        ("-3", "**", "81", "-443426488243037769948249630619149892803"),
        (
            "10",
            "**",
            "40",
            "10000000000000000000000000000000000000000",
        ),
        ("1", "<<", "192", TWO_192),
        ("-5", "<<", "-1", "-3"),
        ("-5", ">>", "1", "-3"),
        ("5", ">>", TWO_192, "0"),
        ("-5", ">>", TWO_192, "-1"),
        ("0", "<<", TWO_192, "0"),
        (
            minus_ones,
            ">>",
            "64",
            "-0x100000000000000000000000000000000",
        ),
        (minus_ones, "&", "-2", minus_two_192),
        (minus_two_192, "&", ONES_192, "0"),
        (minus_two_192, "|", ONES_192, "-1"),
        (ONES_192, "^", "-1", minus_two_192),
        (minus_ones, "^", minus_ones, "0"),
    ] {
        let result = apply(operator, &big(x), &big(y));
        assert_eq!(result, big(expected), "{x} {operator} {y}");
    }
}

#[test]
fn unary_operators() {
    for (x, negation, complement, next, previous) in [
        ("0", "0", "-1", "1", "-1"),
        ("-1", "1", "0", "0", "-2"),
        (
            TWO_192,
            &*negated(TWO_192),
            "-0x1000000000000000000000000000000000000000000000001",
            "0x1000000000000000000000000000000000000000000000001",
            ONES_192,
        ),
    ] {
        let x = big(x);
        let x = x.as_ref();
        let results = [
            unary_minus(x).into_owned(x, x, &mut || false),
            bitwise_not(x).into_owned(x, x, &mut || false),
            increment(x).into_owned(x, x, &mut || false),
            decrement(x).into_owned(x, x, &mut || false),
        ];
        let expected = [negation, complement, next, previous].map(|text| Ok(big(text)));
        assert_eq!(results, expected);
    }
}

#[test]
fn errors() {
    for (x, operator, y, expected) in [
        ("0", "/", "0", Error::DivisionByZero),
        (TWO_192, "%", "0", Error::DivisionByZero),
        ("0", "**", "-1", Error::NegativeExponent),
        ("2", "**", "1073741824", Error::TooBig),
        ("2", "**", TWO_192, Error::TooBig),
        ("3", "**", "677455665", Error::TooBig),
        ("1", "<<", "1073741824", Error::TooBig),
        ("1", ">>", "-1073741824", Error::TooBig),
        ("-1", "<<", TWO_192, Error::TooBig),
    ] {
        let result = try_apply(operator, &big(x), &big(y));
        assert_eq!(result, Err(expected), "{x} {operator} {y}");
    }
    let minus_one = big("-1");
    let result = as_uint_n(MAX_BITS as u64 + 1, minus_one.as_ref());
    assert_eq!(result.err(), Some(Error::TooBig));
}

#[test]
fn wrapping_to_a_width() {
    for (bits, x, signed, unsigned) in [
        (0, "-1", "0", "0"),
        (3, "-12", "-4", "4"),
        (3, "25", "1", "1"),
        (64, "-1", "-1", "0xffffffffffffffff"),
        (
            64,
            "0x8000000000000000",
            "-0x8000000000000000",
            "0x8000000000000000",
        ),
        (65, "0x1ffffffffffffffff", "-1", "0x1ffffffffffffffff"),
        (192, ONES_192, "-1", ONES_192),
        (192, "-1", "-1", ONES_192),
        (192, &*negated(TWO_192), "0", "0"),
        (193, &*negated(TWO_192), &*negated(TWO_192), TWO_192),
        ((1 << 53) - 1, ONES_192, ONES_192, ONES_192),
    ] {
        let x = big(x);
        let x = x.as_ref();
        let results = [
            as_int_n(bits, x).into_owned(x, x, &mut || false),
            as_uint_n(bits, x).unwrap().into_owned(x, x, &mut || false),
        ];
        assert_eq!(results, [Ok(big(signed)), Ok(big(unsigned))], "{bits}");
    }
}

#[test]
fn numbers() {
    for (x, nearest, order) in [
        ("0", 0.0, Equal),
        ("9007199254740993", 9007199254740992.0, Greater),
        ("9007199254740995", 9007199254740996.0, Less),
        ("-9007199254740993", -9007199254740992.0, Less),
        ("0x8000000000000000", 9223372036854775808.0, Equal),
        (
            "0x200000000000010000000000000001",
            1.6615349947311452e35,
            Less,
        ),
        (ONES_192, 6.277101735386681e57, Less),
    ] {
        let x = big(x);
        assert_eq!(x.as_ref().to_number(), nearest);
        assert_eq!(x.as_ref().cmp_number(nearest), Some(order));
        let back = from_number(nearest).unwrap().into_owned(&mut || false);
        assert_eq!(x.as_ref().cmp(&back.unwrap().as_ref()), order);
    }
    let two_1024 = apply("<<", &big("1"), &big("1024"));
    let halfway = apply("-", &two_1024, &apply("<<", &big("1"), &big("970")));
    let below = apply("-", &halfway, &big("1"));
    assert_eq!(halfway.as_ref().to_number(), f64::INFINITY);
    assert_eq!(below.as_ref().to_number(), f64::MAX);
    assert_eq!(two_1024.as_ref().cmp_number(f64::INFINITY), Some(Less));
    assert_eq!(two_1024.as_ref().cmp_number(f64::NAN), None);
    assert_eq!(big("1").as_ref().cmp_number(1.5), Some(Less));
    assert_eq!(big("0").as_ref().cmp_number(-0.0), Some(Equal));
    for number in [0.5, -1e-300, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(from_number(number).err(), Some(Error::NotAnInteger));
    }
}

#[test]
fn primitive_integers() {
    let range = |text: &str| {
        let x = big(text);
        let x = x.as_ref();
        (x.to_i64_wrapping(), x.to_i64(), x.to_u64(), x.to_i128())
    };
    assert_eq!(range("-1"), (-1, Some(-1), None, Some(-1)));
    assert_eq!(
        range("-0x8000000000000000"),
        (i64::MIN, Some(i64::MIN), None, Some(-1 << 63))
    );
    assert_eq!(
        range("-0x8000000000000001"),
        (i64::MAX, None, None, Some(-(1 << 63) - 1))
    );
    assert_eq!(
        range("0xffffffffffffffff"),
        (-1, None, Some(u64::MAX), Some((1 << 64) - 1))
    );
    assert_eq!(
        range("-0x80000000000000000000000000000000"),
        (0, None, None, Some(i128::MIN))
    );
    assert_eq!(range("0x80000000000000000000000000000000").3, None);
    assert_eq!(
        SmallBigInt::from(i32::MIN).as_ref(),
        big("-2147483648").as_ref()
    );
    assert_eq!(BigIntRef::from_words(true, &[0, 0]), Ok(big("0").as_ref()));
}

#[test]
fn text() {
    let x = big("-123456789012345678901234567890123456789012345678901234567890");
    for (radix, expected) in [
        (
            10,
            "-123456789012345678901234567890123456789012345678901234567890",
        ),
        (16, "-13aaf504e4bc1e62173f87a4378c37b49c8ccff196ce3f0ad2"),
        (32, "-2elfa174ngf645pvgui3f31nmie8pjvhir73u2mi"),
        (36, "-w8g22aadxdzqcj994778lrfivxob1p0k7954gi"),
    ] {
        assert_eq!(show(&x, radix), expected);
    }
    assert_eq!(show(&big("0"), 2), "0");
    assert_eq!(
        show(&big("10000000000000000000"), 10),
        "10000000000000000000"
    );
    assert_eq!(
        show(&big("0x10000000000000000"), 10),
        "18446744073709551616"
    );

    for (text, expected) in [
        ("", "0"),
        (" \t\n", "0"),
        ("-0", "0"),
        ("+12 ", "12"),
        (" 0B101", "5"),
        ("0o17", "15"),
        ("0XfF", "255"),
        ("000000000000000000000000000000000000000000000000007", "7"),
    ] {
        assert_eq!(try_parse(text), Ok(big(expected)), "{text:?}");
    }
    for text in [
        "-",
        "+ ",
        "- 1",
        "+-1",
        "-0x1",
        "0x",
        "0b ",
        "0x 1",
        "0b2",
        "0o8",
        "1n",
        "1_0",
        "1.0",
        "1e3",
        "12345678901234567890123456789012345678901234567890a",
        "0x123456789012345678901234567890123456789012345678g",
    ] {
        assert_eq!(try_parse(text), Err(Error::InvalidText), "{text:?}");
    }
    let wide = [0xfeff, 0x2d, 0x34, 0x32, 0x2029];
    let parsed = from_string(Text::Utf16(&wide)).unwrap();
    assert_eq!(parsed.into_owned(&mut || false), Ok(big("-42")));
    let not_a_digit = from_string(Text::Utf16(&[0x31, 0x130]));
    assert_eq!(not_a_digit.err(), Some(Error::InvalidText));
    let literal = from_literal(Text::from_ascii("ff"), LiteralRadix::Hexadecimal, true);
    assert_eq!(literal.unwrap().into_owned(&mut || false), Ok(big("-255")));
}

#[test]
fn hash_depends_on_sign_and_on_every_digit() {
    let hashes = ["0", "1", "-1", TWO_192, ONES_192].map(|text| big(text).as_ref().hash());
    for (index, hash) in hashes.iter().enumerate() {
        assert!(*hash != 0 && !hashes[..index].contains(hash));
    }
}

#[test]
fn long_operations_poll() {
    let x = apply("-", &apply("<<", &big("1"), &big("4000000")), &big("12345"));
    let y = apply("+", &apply("<<", &big("1"), &big("2000000")), &big("777"));
    let cache = DivisorCache::default();
    for (x, operator, y) in [
        (&x, "*", &y),
        (&x, "/", &y),
        (&x, "%", &y),
        (&big("3"), "**", &big("4000000")),
    ] {
        let result = try_apply_with(operator, x, y, &cache, &mut || true);
        assert_eq!(result, Err(Error::Interrupted), "{operator}");
    }
    let text = x.as_ref().to_string_ref(10, &mut || true);
    assert_eq!(text.err(), Some(Error::Interrupted));
    let sevens = vec![b'7'; 1_000_000];
    let parsed = from_string(Text::Latin1(&sevens)).unwrap();
    assert_eq!(parsed.into_owned(&mut || true), Err(Error::Interrupted));
}
