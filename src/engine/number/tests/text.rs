use bun_engine_number::*;
use bun_engine_standalone as _;
use bun_engine_text::Text;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn same(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

fn random_words() -> impl Iterator<Item = u64> {
    let mut state = 0x2545_f491_4f6c_dd1du64;
    core::iter::repeat_with(move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    })
}

#[test]
fn shortest_text() {
    for (value, text) in [
        (0.0, "0"),
        (-0.0, "0"),
        (f64::NAN, "NaN"),
        (-f64::NAN, "NaN"),
        (f64::INFINITY, "Infinity"),
        (f64::NEG_INFINITY, "-Infinity"),
        (1.0, "1"),
        (-1.5, "-1.5"),
        (0.1 + 0.2, "0.30000000000000004"),
        (123456.789, "123456.789"),
        (12345678.5, "12345678.5"),
        (1234567890123456.8, "1234567890123456.8"),
        (9007199254740993.0, "9007199254740992"),
        (123456789012345680000.0, "123456789012345680000"),
        (1e21, "1e+21"),
        (1e23, "1e+23"),
        (0.000001, "0.000001"),
        (-0.0000012345678901234567, "-0.0000012345678901234567"),
        (1e-7, "1e-7"),
        (2.98023223876953125e-8, "2.9802322387695312e-8"),
        (1125899906842624.25, "1125899906842624.2"),
        (1125899906842624.75, "1125899906842624.8"),
        (f64::MAX, "1.7976931348623157e+308"),
        (f64::MIN_POSITIVE, "2.2250738585072014e-308"),
        (2.225073858507201e-308, "2.225073858507201e-308"),
        (5e-324, "5e-324"),
        (1e-323, "1e-323"),
    ] {
        assert_eq!(NumberText::from(value).to_string(), text);
    }
}

#[test]
fn shortest_text_reads_back_and_is_no_longer_than_needed() {
    let powers_of_two = (1..0x7ff).map(|exponent| exponent << 52);
    for bits in powers_of_two.chain(random_words().take(20_000)) {
        let value = f64::from_bits(bits);
        let text = NumberText::from(value);
        assert!(same(string_to_number(text.text()), value), "{text}");
        let significant = |text: &[u8]| {
            let mantissa = text.iter().take_while(|&&character| character != b'e');
            let digits: Vec<u8> = mantissa.copied().filter(u8::is_ascii_digit).collect();
            let is_nonzero = |&digit: &u8| digit > b'0';
            Some(digits.iter().rposition(is_nonzero)? - digits.iter().position(is_nonzero)?)
        };
        assert_eq!(
            significant(&text),
            significant(format!("{value:e}").as_bytes())
        );
    }
}

#[test]
fn shortest_text_of_few_digits_and_of_their_neighbours() {
    for word in random_words().take(20_000) {
        let digits = (word >> 8) % 10u64.pow(1 + (word % 16) as u32);
        let value = digits as f64 / 10f64.powi((word >> 4 & 15) as i32 % 11);
        for value in [value, value.next_up(), -value.next_down()] {
            if (1e-6..1e9).contains(&value.abs()) {
                assert_eq!(NumberText::from(value).to_string(), value.to_string());
            }
        }
    }
}

#[test]
fn integer_text() {
    let limits = (0..20).flat_map(|n| [10u64.pow(n) - 1, 10u64.pow(n), 10u64.pow(n) + 1]);
    let shifted = random_words().map(|word| word >> (word % 64));
    for number in limits
        .chain([u64::MAX, 1 << 63, 1 << 31])
        .chain(shifted.take(2000))
    {
        assert_eq!(NumberText::from(number).to_string(), number.to_string());
        assert_eq!(decimal_length(number), number.to_string().len());
        let signed = (number as i64).wrapping_neg();
        assert_eq!(NumberText::from(signed).to_string(), signed.to_string());
        let (low, signed_low) = (number as u32, number as i32);
        assert_eq!(NumberText::from(low).to_string(), low.to_string());
        assert_eq!(
            NumberText::from(signed_low).to_string(),
            signed_low.to_string()
        );
    }
}

#[test]
fn decimal_prefix() {
    for (text, expected) in [
        ("", None),
        ("-", None),
        (".", None),
        ("+.e1", None),
        ("e5", None),
        (" 1", None),
        ("Infinity", None),
        ("-0", Some((-0.0, 2))),
        ("5.", Some((5.0, 2))),
        ("+.5", Some((0.5, 3))),
        ("1.5x", Some((1.5, 3))),
        ("1e", Some((1.0, 1))),
        ("1.e+", Some((1.0, 2))),
        ("1E+2,", Some((100.0, 4))),
        ("0x10", Some((0.0, 1))),
        ("1_0", Some((1.0, 1))),
        ("0.12345678\u{130}1234567", Some((0.12345678, 10))),
        ("1e99999999999999999999999", Some((f64::INFINITY, 25))),
        ("-1e-99999999999999999999999", Some((-0.0, 27))),
        ("0e99999999999999999999999", Some((0.0, 25))),
    ] {
        let bits = |parsed: Option<(f64, usize)>| parsed.map(|(value, end)| (value.to_bits(), end));
        assert_eq!(bits(parse_decimal_prefix(&wide(text))), bits(expected));
        assert_eq!(bits(parse_decimal_prefix(text.as_bytes())), bits(expected));
    }
}

#[test]
fn decimals_round_to_nearest() {
    let zeros = "0".repeat(1200);
    let smallest_halfway = format!("{:.1074}", 5e-324);
    let mut texts = vec![
        "9007199254740993".to_owned(),
        "9007199254740995".to_owned(),
        format!("9007199254740993.{zeros}"),
        format!("9007199254740993.{zeros}1"),
        format!("9007199254740992.{}", "9".repeat(1200)),
        format!("0.{zeros}1e1201"),
        format!("1{zeros}e-1200"),
        format!("{smallest_halfway}e0"),
        "2.4703282292062327e-324".to_owned(),
        "2.4703282292062328e-324".to_owned(),
        "2.2250738585072011e-308".to_owned(),
        "2.2250738585072012e-308".to_owned(),
        "1.7976931348623158e308".to_owned(),
        "1.7976931348623159e308".to_owned(),
        "1.797693134862315807937289714053034150799e308".to_owned(),
        "1.797693134862315807937289714053034150800e308".to_owned(),
        "1.00000000000000011102230246251565404236316680908203125".to_owned(),
        "1.00000000000000011102230246251565404236316680908203124".to_owned(),
        "1.00000000000000011102230246251565404236316680908203126".to_owned(),
        "1.00000000000000033306690738754696212708950042724609375".to_owned(),
    ];
    texts.extend(random_words().take(5000).map(|word| {
        let exponent = (word % 700) as i32 - 360;
        format!("{}.{}e{exponent}", word >> (word % 61), word << (word % 59))
    }));
    for text in &texts {
        let expected = Some((text.parse().unwrap(), text.len()));
        assert_eq!(parse_decimal_prefix(text.as_bytes()), expected, "{text}");
        assert_eq!(parse_decimal_prefix(&wide(text)), expected, "{text}");
    }
}

#[test]
fn strings_to_numbers() {
    for (text, number, float) in [
        ("", 0.0, f64::NAN),
        (" \t\n\u{a0}\u{feff}\u{2028}\u{3000}", 0.0, f64::NAN),
        ("\u{180e}", f64::NAN, f64::NAN),
        ("\u{2003}12.5\u{2029}", 12.5, 12.5),
        ("12px", f64::NAN, 12.0),
        ("1 2", f64::NAN, 1.0),
        ("-0", -0.0, -0.0),
        ("+Infinity", f64::INFINITY, f64::INFINITY),
        ("-Infinity ", f64::NEG_INFINITY, f64::NEG_INFINITY),
        ("Infinityx", f64::NAN, f64::INFINITY),
        ("infinity", f64::NAN, f64::NAN),
        ("NaN", f64::NAN, f64::NAN),
        ("0XfF", 255.0, 0.0),
        ("0o17", 15.0, 0.0),
        ("0b101 ", 5.0, 0.0),
        ("0x", f64::NAN, 0.0),
        ("0b2", f64::NAN, 0.0),
        ("-0x1", f64::NAN, -0.0),
        ("1_000", f64::NAN, 1.0),
        ("010", 10.0, 10.0),
        ("0x20000000000001", 9007199254740992.0, 0.0),
        ("0x20000000000003", 9007199254740996.0, 0.0),
        ("0x200000000000010000000001", 2f64.powi(93).next_up(), 0.0),
    ] {
        let units = wide(text);
        assert!(
            same(string_to_number(Text::Utf16(&units)), number),
            "{text}"
        );
        assert!(same(parse_float(Text::Utf16(&units)), float), "{text}");
        if text.is_ascii() {
            assert!(same(string_to_number(Text::from_ascii(text)), number));
            assert!(same(parse_float(Text::from_ascii(text)), float));
        }
    }
}

#[test]
fn literals() {
    assert_eq!(decimal_literal_value(b"1.5e3"), 1500.0);
    assert_eq!(decimal_literal_value(b"1_000"), 1000.0);
    assert_eq!(decimal_literal_value(b".0_1"), 0.01);
    assert_eq!(decimal_literal_value(&wide("1_2.3_4E-1_0")), 12.34e-10);
    assert_eq!(
        decimal_literal_value(b"9_007_199_254_740_993.000_000_001"),
        9007199254740994.0
    );
    assert_eq!(radix_literal_value(b"ff_ff", 16), 65535.0);
    assert_eq!(radix_literal_value(b"0777", 8), 511.0);
    assert_eq!(radix_literal_value(&[b'1'; 54], 2), 2f64.powi(54));
    assert_eq!(radix_literal_value(&[b'f'; 256], 16), f64::INFINITY);
}

#[test]
fn json_numbers() {
    use JsonNumber::{Double, Int32};
    for (text, expected) in [
        ("0", Ok((Int32(0), 1))),
        ("-12,", Ok((Int32(-12), 3))),
        ("999999999]", Ok((Int32(999999999), 9))),
        ("2147483648", Ok((Double(2147483648.0), 10))),
        ("01", Ok((Int32(0), 1))),
        ("-0.25e1}", Ok((Double(-2.5), 7))),
        ("1e+", Ok((Double(1.0), 1))),
        ("", Err(JsonNumberError::NoDigits)),
        ("-.5", Err(JsonNumberError::NoDigits)),
        ("+1", Err(JsonNumberError::NoDigits)),
        ("1.", Err(JsonNumberError::NoDigitsAfterPoint)),
        ("1.e5", Err(JsonNumberError::NoDigitsAfterPoint)),
    ] {
        assert_eq!(parse_json_number(text.as_bytes()), expected, "{text}");
        assert_eq!(parse_json_number(&wide(text)), expected, "{text}");
    }
    assert!(matches!(parse_json_number(b"-0"), Ok((Double(zero), 2)) if same(zero, -0.0)));
}

#[test]
fn canonical_numeric_indices() {
    for (text, expected) in [
        ("0", Some(0.0)),
        ("-0", Some(-0.0)),
        ("4294967296", Some(4294967296.0)),
        ("-1.5", Some(-1.5)),
        ("1e+21", Some(1e21)),
        ("-Infinity", Some(f64::NEG_INFINITY)),
        ("NaN", Some(f64::NAN)),
        ("", None),
        ("-", None),
        ("00", None),
        ("+1", None),
        ("1.0", None),
        ("1e21", None),
        ("-NaN", None),
        ("9007199254740993", None),
        ("length", None),
    ] {
        let index = canonical_numeric_index(Text::from_ascii(text));
        assert_eq!(index.is_some(), expected.is_some(), "{text}");
        assert!(index.zip(expected).is_none_or(|(a, b)| same(a, b)));
    }
}

#[test]
fn fixed_exponential_and_precision() {
    let text = |result: Result<&[u8], FormatError>| Text::Latin1(result.unwrap()).to_string();
    let out = &mut [0; FIXED_TEXT_CAPACITY];
    for (value, digits, expected) in [
        (0.0, 0, "0"),
        (-0.0, 2, "0.00"),
        (0.5, 0, "1"),
        (-2.5, 0, "-3"),
        (1.005, 2, "1.00"),
        (1.25, 1, "1.3"),
        (-0.0001, 2, "-0.00"),
        (99.995, 2, "100.00"),
        (999.9996, 3, "1000.000"),
        (0.1, 20, "0.10000000000000000555"),
        (5e-21, 20, "0.00000000000000000000"),
        (9.5e-21, 20, "0.00000000000000000001"),
        (1e20, 2, "100000000000000000000.00"),
        (1000000000000000128.0, 0, "1000000000000000128"),
        (1e21, 2, "1e+21"),
        (f64::NAN, 2, "NaN"),
    ] {
        assert_eq!(text(to_fixed(value, digits, out)), expected);
    }
    for (value, digits, expected) in [
        (0.0, None, "0e+0"),
        (-0.0, Some(2), "0.00e+0"),
        (123456.0, None, "1.23456e+5"),
        (123456.0, Some(2), "1.23e+5"),
        (25.0, Some(0), "3e+1"),
        (-9.995, Some(1), "-1.0e+1"),
        (5e-324, Some(20), "4.94065645841246544177e-324"),
        (f64::MAX, Some(20), "1.79769313486231570815e+308"),
        (f64::INFINITY, Some(-1), "Infinity"),
    ] {
        assert_eq!(text(to_exponential(value, digits, out)), expected);
    }
    for (value, digits, expected) in [
        (0.0, 3, "0.00"),
        (123.456, 4, "123.5"),
        (123.0, 3, "123"),
        (123.0, 2, "1.2e+2"),
        (999.5, 3, "1.00e+3"),
        (0.00000123, 2, "0.0000012"),
        (0.000000123, 2, "1.2e-7"),
        (1e21, 22, "1000000000000000000000"),
        (1.5, 20, "1.5000000000000000000"),
        (f64::NAN, 0, "NaN"),
    ] {
        assert_eq!(text(to_precision(value, digits, out)), expected);
    }
    assert_eq!(
        to_fixed(-999999999999999900000.0, 100, out).unwrap().len(),
        123
    );
    for digits in [-1, 101] {
        assert_eq!(
            to_fixed(f64::NAN, digits, out).err(),
            Some(FormatError::FixedDigits)
        );
        let error = to_exponential(1.0, Some(digits), out).err();
        assert_eq!(error, Some(FormatError::ExponentialDigits));
    }
    for digits in [0, 101] {
        assert_eq!(
            to_precision(1.0, digits, out).err(),
            Some(FormatError::Precision)
        );
    }
}

#[test]
fn fixed_digits_are_those_of_the_exact_value() {
    let out = &mut [0; FIXED_TEXT_CAPACITY];
    for word in random_words().take(3000) {
        // An odd significand this far below one is never a tie at these lengths.
        let value = f64::from_bits(word >> 1 | 1);
        let digits = (word % 40) as usize;
        if value.is_finite() && !(1e-20..1e60).contains(&value) {
            let text =
                Text::Latin1(to_exponential(value, Some(digits as i32), out).unwrap()).to_string();
            let text: String = text.chars().filter(|&character| character != '+').collect();
            assert_eq!(text, format!("{value:.digits$e}"));
        }
        let value = (word >> 11 | 1) as f64 / 2f64.powi(45 + (word % 50) as i32);
        let text = Text::Latin1(to_fixed(value, digits as i32, out).unwrap()).to_string();
        assert_eq!(text, format!("{value:.digits$}"));
    }
}

#[test]
fn radix_text() {
    let out = &mut [0; RADIX_INTEGER_CAPACITY];
    for (value, radix, expected) in [
        (-0.0, 2, "0"),
        (255.0, 16, "ff"),
        (-255.5, 16, "-ff.8"),
        (0.5, 2, "0.1"),
        (0.1, 3, "0.0022002200220022002200220022002201"),
        (0.1, 36, "0.3lllllllllm"),
        (123.456, 36, "3f.gez4w97ry"),
        (1e21, 36, "5v1j4f4ds79m9s"),
        (-1e21, 7, "-5135235413265003022550266"),
        (2f64.powi(63), 32, "8000000000000"),
        (1e-7, 16, "0.000001ad7f29abcaf48"),
        (1.5, 10, "1.5"),
        (f64::NAN, 5, "NaN"),
        (f64::NEG_INFINITY, 5, "-Infinity"),
    ] {
        with_radix_text(value, Radix::new(radix).unwrap(), |text| {
            assert_eq!(Text::Latin1(text), Text::from_ascii(expected));
        });
    }
    for (value, length) in [(-f64::MAX, 1025), (-5e-324, 1077)] {
        assert_eq!(with_radix_text(value, Radix::BINARY, <[u8]>::len), length);
    }
    assert_eq!(integer_to_radix(i64::MIN, Radix::BINARY, out).len(), 65);
    for (word, radix) in random_words().zip((2..=36).cycle()).take(2000) {
        let number = word as i64 >> (word % 64);
        let text = integer_to_radix(number, Radix::new(radix).unwrap(), out);
        let text = Text::Latin1(text).to_string();
        assert_eq!(i64::from_str_radix(&text, radix as u32), Ok(number));
    }
    assert_eq!(Radix::new(1), Err(FormatError::Radix));
    assert_eq!(Radix::new(37), Err(FormatError::Radix));
}

#[test]
fn integers_from_strings() {
    for (text, radix, expected) in [
        ("", 0, f64::NAN),
        ("\u{2003} 42px", 0, 42.0),
        ("-0", 10, -0.0),
        ("+-1", 10, f64::NAN),
        ("0x1F", 0, 31.0),
        ("-0X1f", 16, -31.0),
        ("0x1f", 10, 0.0),
        ("0x", 16, f64::NAN),
        ("0b1", 0, 0.0),
        ("1e3", 0, 1.0),
        ("Zz", 36, 1295.0),
        ("12", 2, 1.0),
        ("1", 1, f64::NAN),
        ("1", 37, f64::NAN),
        ("1", -10, f64::NAN),
        ("9007199254740993", 10, 9007199254740992.0),
        ("90071992547409930001", 10, 90071992547409930001.0),
        (
            "123456789012345678901234567890.5",
            10,
            123456789012345678901234567890.0,
        ),
        ("20000000000001001", 16, 2f64.powi(65).next_up()),
    ] {
        assert!(
            same(parse_int(Text::Utf16(&wide(text)), radix), expected),
            "{text}"
        );
    }
    assert_eq!(parse_int_of_number(-0.0).map(f64::to_bits), Some(0));
    assert_eq!(parse_int_of_number(-1.9), Some(-1.0));
    assert_eq!(parse_int_of_number(0.000001), Some(0.0));
    for value in [1e-7, -0.5, 1e21, f64::NAN] {
        assert_eq!(parse_int_of_number(value), None);
    }
}

#[test]
fn bounded_integers() {
    use Surroundings::*;
    let decimal = |text, surroundings| -> Option<i16> {
        parse_integer(Text::from_ascii(text), Radix::DECIMAL, surroundings)
    };
    assert_eq!(decimal("-32768", Nothing), Some(i16::MIN));
    assert_eq!(decimal("+32767", Nothing), Some(i16::MAX));
    assert_eq!(decimal("32768", Nothing), None);
    assert_eq!(decimal("99999999999999999999999", Nothing), None);
    assert_eq!(decimal(" 1", Nothing), None);
    assert_eq!(decimal("\t1\u{b} ", WhiteSpace), Some(1));
    assert_eq!(decimal("1x", WhiteSpace), None);
    assert_eq!(decimal(" 1x", WhiteSpaceBeforeAnythingAfter), Some(1));
    assert_eq!(decimal("-", WhiteSpaceBeforeAnythingAfter), None);
    let octal =
        |text| parse_integer::<u32>(Text::from_ascii(text), Radix::new(8).unwrap(), Nothing);
    assert_eq!(octal("0777"), Some(0o777));
    assert_eq!(octal("-0"), None);
    assert_eq!(octal("8"), None);
}
