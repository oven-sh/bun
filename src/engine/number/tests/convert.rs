use bun_engine_number::*;
use bun_engine_standalone as _;

#[test]
fn int32() {
    for (value, expected) in [
        (0.0, 0),
        (-0.9, 0),
        (f64::NAN, 0),
        (f64::INFINITY, 0),
        (f64::MIN, 0),
        (-1.5, -1),
        (2147483648.0, i32::MIN),
        (-2147483649.0, i32::MAX),
        (4294967295.9, -1),
        (2251799813685249.5, 1),
        (-9007199254740991.0, 1),
        (1e20, 1661992960),
        (-1e20, -1661992960),
        (2f64.powi(84) - 2f64.powi(31), i32::MIN),
    ] {
        assert_eq!(to_int32(value), expected, "{value}");
        assert_eq!(to_uint32(value), expected as u32, "{value}");
    }
}

#[test]
fn exact_conversions() {
    assert_eq!(exact_int32(0.0), Some(0));
    assert_eq!(exact_int32(-2147483648.0), Some(i32::MIN));
    assert_eq!(exact_int32(2147483647.0), Some(i32::MAX));
    for value in [-0.0, 0.5, 2147483648.0, 4294967296.0, 1e300, f64::NAN] {
        assert_eq!(exact_int32(value), None, "{value}");
    }
}

#[test]
fn other_widths() {
    assert_eq!(to_int64(-1.5), -1);
    assert_eq!(to_int64(2f64.powi(63)), i64::MIN);
    assert_eq!(to_uint64(1e20), 7766279631452241920);
    assert_eq!(to_uint64(f64::NEG_INFINITY), 0);
    for (value, expected) in [
        (f64::NAN, 0),
        (-1.0, 0),
        (0.5, 0),
        (1.5, 2),
        (2.5, 2),
        (254.5, 254),
        (254.50001, 255),
        (f64::INFINITY, 255),
    ] {
        assert_eq!(to_uint8_clamp(value), expected);
    }
}

#[test]
fn integers_lengths_and_indices() {
    assert_eq!(to_integer_or_infinity(f64::NAN), 0.0);
    assert!(!is_negative_zero(to_integer_or_infinity(-0.5)));
    assert_eq!(to_integer_or_infinity(f64::INFINITY), f64::INFINITY);
    assert_eq!(to_length(-1.0), 0);
    assert_eq!(to_length(f64::INFINITY), (1 << 53) - 1);
    assert_eq!(to_index(-0.9), Ok(0));
    assert_eq!(to_index(-1.0), Err(IndexError::Negative));
    assert_eq!(to_index(MAX_SAFE_INTEGER), Ok((1 << 53) - 1));
    assert_eq!(to_index(MAX_SAFE_INTEGER + 1.0), Err(IndexError::TooLarge));
    for (value, relative) in [
        (f64::NAN, 0),
        (-0.9, 0),
        (-3.5, 7),
        (f64::NEG_INFINITY, 0),
        (10.0, 10),
        (f64::INFINITY, 10),
    ] {
        assert_eq!(to_relative_index(value, 10), relative);
    }
    assert_eq!(exact_int52(-2f64.powi(51)), Some(-1 << 51));
    assert_eq!(exact_int52(2f64.powi(51) - 1.0), Some((1 << 51) - 1));
    for value in [2f64.powi(51), -0.0, 0.5, f64::NAN, f64::INFINITY] {
        assert_eq!(exact_int52(value), None);
    }
    assert!(is_integer(1e300) && !is_integer(f64::INFINITY) && !is_integer(0.5));
    assert!(is_safe_integer(-MAX_SAFE_INTEGER) && !is_safe_integer(MAX_SAFE_INTEGER + 1.0));
}

#[test]
fn float16_rounds_once() {
    for bits in (0..0x7c00).chain(0x8000..0xfc00) {
        let value = float16_to_f64(bits);
        let next = match float16_to_f64(bits + 1) {
            infinite if infinite.is_infinite() => 65536f64.copysign(infinite),
            finite => finite,
        };
        let halfway = f64::midpoint(value, next).to_bits();
        assert_eq!(float16_from_f64(value), bits);
        assert_eq!(float16_from_f64(f64::from_bits(halfway - 1)), bits);
        assert_eq!(float16_from_f64(f64::from_bits(halfway)), bits + bits % 2);
        assert_eq!(float16_from_f64(f64::from_bits(halfway + 1)), bits + 1);
    }
    assert_eq!(float16_to_f64(1), 2f64.powi(-24));
    assert_eq!(float16_to_f64(0x3c00), 1.0);
    assert_eq!(float16_to_f64(0xfbff), -65504.0);
    assert_eq!(float16_to_f64(0xfc00), f64::NEG_INFINITY);
    assert_eq!(float16_to_f64(0xffff).to_bits(), f64::NAN.to_bits());
    assert_eq!(float16_from_f64(f64::NAN), 0x7e00);
}
