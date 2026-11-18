mod support;

use bun_engine_bigint::{BigIntRef, SmallBigInt};
use bun_engine_intl::number_format::*;
use bun_engine_intl::plural_rules::{self, Category, PluralRules};
use bun_engine_intl::{Cache, Error, KeywordValue, Named};
use bun_engine_text::Text;
use support::{Random, describe_error, describe_parts, languages, locales, narrow};

fn digits(requested: RequestedDigits<f64>) -> Result<DigitOptions, Error> {
    StyleOptions::Decimal.resolve_digits(requested, Notation::Standard, Ok)
}

fn currency(code: &str, display: CurrencyDisplay, sign: CurrencySign) -> Options {
    let style = StyleOptions::Currency {
        currency: (Style::Currency.currency(Some(Text::from_ascii(code))))
            .unwrap()
            .unwrap(),
        display,
        sign,
    };
    let requested = RequestedDigits::<f64>::default();
    Options {
        style,
        digits: (style.resolve_digits(requested, Notation::Standard, Ok::<_, Error>)).unwrap(),
        ..Options::default()
    }
}

fn number_format(tag: &str, options: Options) -> NumberFormat {
    let cache = Cache::default();
    NumberFormat::new(&cache, &locales(&cache, tag), None, options).unwrap()
}

fn from_string(text: &str) -> MathematicalValue {
    MathematicalValue::from_string(narrow(text).text()).unwrap()
}

#[test]
fn digit_options_convert_in_order() {
    let mut converted = Vec::new();
    let requested = RequestedDigits {
        minimum_fraction_digits: Some(1.0),
        maximum_fraction_digits: Some(2.9),
        minimum_significant_digits: Some(3.0),
        maximum_significant_digits: Some(4.0),
        rounding_priority: RoundingPriority::LessPrecision,
        ..RequestedDigits::default()
    };
    let resolved = StyleOptions::Percent.resolve_digits(requested, Notation::Standard, |value| {
        converted.push(value);
        Ok::<_, Error>(value)
    });
    assert_eq!(converted, [3.0, 4.0, 1.0, 2.9]);
    let range = |minimum, maximum| DigitRange { minimum, maximum };
    assert_eq!(
        resolved.unwrap().rounding_type,
        RoundingType::LessPrecision {
            fraction: range(1, 2),
            significant: range(3, 4)
        }
    );

    let ignored = digits(RequestedDigits {
        minimum_fraction_digits: Some(f64::NAN),
        maximum_significant_digits: Some(2.0),
        ..RequestedDigits::default()
    });
    assert_eq!(
        ignored.unwrap().rounding_type,
        RoundingType::SignificantDigits(range(1, 2))
    );
}

#[test]
fn invalid_options() {
    let increment = RoundingIncrement::new(25.0).unwrap();
    let errors = [
        MinimumIntegerDigits::new(22.0).err(),
        RoundingIncrement::new(3.0).err(),
        digits(RequestedDigits {
            minimum_significant_digits: Some(3.0),
            maximum_significant_digits: Some(2.0),
            ..RequestedDigits::default()
        })
        .err(),
        digits(RequestedDigits {
            minimum_fraction_digits: Some(3.0),
            maximum_fraction_digits: Some(2.0),
            ..RequestedDigits::default()
        })
        .err(),
        digits(RequestedDigits {
            maximum_significant_digits: Some(2.0),
            rounding_increment: increment,
            ..RequestedDigits::default()
        })
        .err(),
        Style::Currency.currency(None).err(),
        Style::Decimal.currency(Some(Text::from_ascii("U1D"))).err(),
        Style::Unit.unit(None).err(),
        (Style::Unit.unit(Some(Text::from_ascii("bit-per-bit-per-bit")))).err(),
        Grouping::parse(Text::from_ascii("never"), Notation::Standard).err(),
    ];
    assert_eq!(
        errors.map(|error| describe_error(&error.unwrap())),
        [
            "RangeError: minimumIntegerDigits is out of range",
            "RangeError: roundingIncrement must be one of 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000",
            "RangeError: maximumSignificantDigits is out of range",
            "RangeError: Computed minimumFractionDigits is larger than maximumFractionDigits",
            "TypeError: rounding type is not fraction-digits while roundingIncrement is specified",
            "TypeError: currency must be a string",
            "RangeError: currency is not a well-formed currency code",
            "TypeError: unit must be a string",
            "RangeError: unit is not a well-formed unit identifier",
            "RangeError: useGrouping must be either true, false, \"min2\", \"auto\", or \"always\"",
        ]
    );
}

#[test]
fn mathematical_values() {
    let options = Options {
        digits: digits(RequestedDigits {
            maximum_fraction_digits: Some(20.0),
            ..RequestedDigits::default()
        })
        .unwrap(),
        grouping: None,
        ..Options::default()
    };
    let format = number_format("en", options);
    let long_fraction = format!("0.{}1", "0".repeat(1000));
    let shifted = format!("{long_fraction}e1001");
    let above_half = format!("0.{}5{}1", "0".repeat(20), "0".repeat(1000));
    let too_large = format!("0x1{}", "0".repeat(256));
    for (text, expected) in [
        ("", "0"),
        ("\u{a0}-0 ", "-0"),
        ("+.5e1", "5"),
        (
            "12345678901234567890.12345678901234567890",
            "12345678901234567890.1234567890123456789",
        ),
        ("0x10000000000000001", "18446744073709551617"),
        ("0B11", "3"),
        ("-0x1", "NaN"),
        ("1_0", "NaN"),
        ("-Infinity", "-\u{221e}"),
        ("1e309", "\u{221e}"),
        ("-1e-400", "-0"),
        ("0e99999999999999999999", "0"),
        (&long_fraction, "0"),
        (&shifted, "1"),
        (&above_half, "0.00000000000000000001"),
        (&too_large, "\u{221e}"),
    ] {
        let formatted = format.format(&from_string(text)).unwrap();
        assert_eq!(formatted.to_string(), expected, "{text}");
    }

    let integer = SmallBigInt::from(-(10i128.pow(30)) - 1);
    let value = MathematicalValue::from_bigint(integer.as_ref(), &mut || false).unwrap();
    assert_eq!(
        format.format(&value).unwrap().to_string(),
        "-1000000000000000000000000000001"
    );
    let words = vec![1; 60_000];
    let value = MathematicalValue::from_bigint(BigIntRef::new(false, &words), &mut || false);
    assert_eq!(
        describe_error(&format.format(&value.unwrap()).unwrap_err()),
        "TypeError: Failed to format a BigInt."
    );
    assert_eq!(
        format.format(&(-f64::NAN).into()).unwrap().to_string(),
        "NaN"
    );
}

#[test]
fn increments_round_the_shortest_digits() {
    let options = Options {
        digits: digits(RequestedDigits {
            minimum_fraction_digits: Some(1.0),
            rounding_increment: RoundingIncrement::new(2.0).unwrap(),
            ..RequestedDigits::default()
        })
        .unwrap(),
        ..Options::default()
    };
    let format = number_format("en", options);
    for (number, expected) in [
        (0.3, "0.4"),
        (1048812172375619.4, "1,048,812,172,375,619.4"),
    ] {
        assert_eq!(format.format(&number.into()).unwrap().to_string(), expected);
    }
}

#[test]
fn parts() {
    let accounting = currency("USD", CurrencyDisplay::Symbol, CurrencySign::Accounting);
    let format = number_format("en", accounting);
    assert_eq!(
        describe_parts(&format.format_to_parts(&(-1234.5).into()).unwrap()).join(" "),
        "literal:( currency:$ integer:1 group:, integer:234 decimal:. fraction:50 literal:)"
    );
    let range =
        format.format_range_to_parts(&Cache::default(), &(-1.0).into(), &f64::INFINITY.into());
    assert_eq!(
        describe_parts(&range.unwrap())[5..],
        [
            "literal:):startRange",
            "literal: \u{2013} :shared",
            "currency:$:endRange",
            "infinity:\u{221e}:endRange"
        ]
    );
    let yen = currency("JPY", CurrencyDisplay::Code, CurrencySign::Standard);
    let format = number_format("en", yen);
    let range = format.format_range_to_parts(&Cache::default(), &1.0.into(), &2.0.into());
    assert_eq!(
        describe_parts(&range.unwrap()),
        [
            "currency:JPY:shared",
            "literal:\u{a0}:shared",
            "integer:1:startRange",
            "literal:\u{2013}:shared",
            "integer:2:endRange"
        ]
    );
    let same = format.format_range(&Cache::default(), &1.1.into(), &from_string("0.9"));
    assert_eq!(same.unwrap().to_string(), "~JPY\u{a0}1");
    assert!(
        format
            .format_range(&Cache::default(), &f64::NAN.into(), &1.0.into())
            .is_err()
    );
}

#[test]
fn numbering_systems() {
    let cache = Cache::default();
    let resolve = |tag, option: Option<&str>| {
        let option = option.map(|it| KeywordValue::numbering_system(Text::from_ascii(it)).unwrap());
        let requested = locales(&cache, tag);
        let format = NumberFormat::new(&cache, &requested, option.as_ref(), Options::default());
        let format = format.unwrap();
        format!(
            "{} {} {}",
            format.locale().string(),
            format.numbering_system().unwrap().to_string_ref(),
            format.format(&1.0.into()).unwrap()
        )
    };
    assert_eq!(resolve("en-u-nu-thai", None), "en-u-nu-thai thai \u{e51}");
    assert_eq!(
        resolve("en-u-nu-thai", Some("THAI")),
        "en-u-nu-thai thai \u{e51}"
    );
    assert_eq!(resolve("en-u-nu-thai", Some("arab")), "en arab \u{661}");
    assert_eq!(
        resolve("en-u-nu-thai", Some("roman")),
        "en-u-nu-thai thai \u{e51}"
    );
    assert_eq!(resolve("fa-XX-u-nu-native", None), "fa arabext \u{6f1}");
    assert_eq!(resolve("zxx-u-nu-thai", None), "en-US latn 1");
}

#[test]
fn a_format_that_is_used_often_writes_what_its_parts_add_up_to() {
    let mut random = Random(7);
    for language in languages() {
        let mut options = match random.below(3) {
            0 => currency("EUR", CurrencyDisplay::Symbol, CurrencySign::Accounting),
            1 => currency("CHF", CurrencyDisplay::Code, CurrencySign::Standard),
            _ => Options::default(),
        };
        if random.below(4) == 0 {
            options.style = StyleOptions::Percent;
        }
        options.sign_display = SignDisplay::ALL[random.below(5)];
        options.grouping = Grouping::ALL.get(random.below(4)).copied();
        let (minimum, maximum) = (random.below(3) as f64, 2.0 + random.below(4) as f64);
        let mut requested = RequestedDigits {
            minimum_integer_digits: MinimumIntegerDigits::new(1.0 + 2.0 * minimum).unwrap(),
            rounding_mode: RoundingMode::ALL[random.below(9)],
            trailing_zero_display: TrailingZeroDisplay::ALL[random.below(2)],
            ..RequestedDigits::default()
        };
        if random.below(3) == 0 {
            requested.minimum_significant_digits = Some(minimum + 1.0);
            requested.maximum_significant_digits = Some(maximum + 1.0);
        } else {
            requested.minimum_fraction_digits = Some(minimum);
            requested.maximum_fraction_digits = Some(maximum);
        }
        options.digits = digits(requested).unwrap();

        let format = number_format(language, options);
        for round in 0..120 {
            let significand = [5, 25, 995, 99995, random.below(1 << 30)][round % 5] as f64;
            let sign = [1.0, -1.0, 0.0, -0.0][random.below(9) % 4];
            let number = sign * significand * 10f64.powi(random.below(24) as i32 - 9);
            let parts = format.format_to_parts(&number.into()).unwrap();
            let expected: String = parts.iter().map(|it| it.unwrap().1.to_string()).collect();
            let formatted = format.format(&number.into()).unwrap();
            assert_eq!(formatted.to_string(), expected, "{language} {number}");
        }
    }
}

#[test]
fn plural_categories() {
    let cache = Cache::default();
    let rules = |tag, options| PluralRules::new(&cache, &locales(&cache, tag), options).unwrap();
    let russian = rules("ru", plural_rules::Options::default());
    let select = |number: f64| russian.select(&number.into()).unwrap();
    assert_eq!(
        [1.0, -2.0, 2.0, 5.0, 1021.0, 1.5, f64::NAN].map(select),
        [
            Category::One,
            Category::Few,
            Category::Few,
            Category::Many,
            Category::One,
            Category::Other,
            Category::Other
        ]
    );
    assert_eq!(
        russian.select_range(&Cache::default(), &1.0.into(), &2.0.into()),
        Ok(Category::Few)
    );
    let categories: Vec<_> = russian.categories().unwrap().map(Named::as_str).collect();
    assert_eq!(categories, ["one", "few", "many", "other"]);

    let requested = RequestedDigits {
        minimum_fraction_digits: Some(1.0),
        ..RequestedDigits::default()
    };
    let with_fraction = plural_rules::Options {
        digits: plural_rules::resolve_digits(requested, Notation::Standard, Ok::<_, Error>)
            .unwrap(),
        ..Default::default()
    };
    assert_eq!(
        rules("en", with_fraction).select(&1.0.into()),
        Ok(Category::Other)
    );
    let ordinal = plural_rules::Options {
        kind: plural_rules::Type::Ordinal,
        ..Default::default()
    };
    assert_eq!(
        rules("en", ordinal).select(&from_string("23")),
        Ok(Category::Few)
    );
}
