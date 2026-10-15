use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow literal numbers that lose precision.
pub struct NoLossOfPrecision {
    ignore_decimals: bool,
}

const NO_LOSS_OF_PRECISION: Message = Message::new(
    "noLossOfPrecision",
    "This number literal will lose precision at runtime.",
);

/// Whether the integer with these `digits` of `bits_per_digit` bits each is not a double.
fn not_base_ten_loses_precision(digits: &[u8], bits_per_digit: u32) -> bool {
    // The positions of the first and of the last bit that is set, counted from the first bit.
    let (mut first, mut last) = (None, 0);
    let mut at = 0;
    for digit in digits
        .iter()
        .filter_map(|digit| char::from(*digit).to_digit(16))
    {
        if digit != 0 {
            if first.is_none() {
                first = Some(at + bits_per_digit - 1 - digit.ilog2());
            }
            last = at + bits_per_digit - 1 - digit.trailing_zeros();
        }
        at += bits_per_digit;
    }
    first.is_some_and(|first| {
        last - first >= f64::MANTISSA_DIGITS || at - first > f64::MAX_EXP as u32
    })
}

/// oxlint writes `value as u64`, which is `u64::MAX` from 2^64, in the base of the literal, and reports a literal that
/// does not end with these digits: `0x10000000000000000` is reported, `0xFFFFFFFFFFFFFFFFFFFF` is not.
fn not_base_ten_loses_precision_in_oxlint(digits: &[u8], bits_per_digit: u32) -> bool {
    // The integers from here are 2^64 or more as a double.
    const ROUNDS_TO_TWO_POW_64: u128 = 0xFFFF_FFFF_FFFF_FC00;
    let integer = digits
        .iter()
        .filter_map(|digit| char::from(*digit).to_digit(16))
        .fold(0u128, |all, digit| {
            all.saturating_mul(1 << bits_per_digit)
                .saturating_add(u128::from(digit))
        });
    if integer < ROUNDS_TO_TWO_POW_64 {
        let integer = integer as u64;
        return (integer as f64) as u64 != integer;
    }
    let max: &[u8] = match bits_per_digit {
        4 => b"FFFFFFFFFFFFFFFF",
        3 => b"1777777777777777777777",
        _ => &[b'1'; 64],
    };
    !digits
        .iter()
        .rev()
        .filter(|digit| **digit != b'_')
        .map(u8::to_ascii_uppercase)
        .take(max.len())
        .eq(max.iter().rev().copied())
}

/// `value.toPrecision(precision)` of a finite `value > 0`, for a precision from 1 to 100: the digits, and the exponent
/// of the first.
fn to_precision(value: f64, precision: usize) -> (Vec<u8>, i64) {
    let mut buffer = [0; 124];
    let text =
        bun_core::fmt::FormatDouble::to_exponential(&mut buffer, value, Some(precision as u32 - 1));
    let (digits, exponent) = strings::split_once_char(text, b'e').unwrap_or((text, b"0"));
    let exponent = std::str::from_utf8(exponent)
        .ok()
        .and_then(|it| it.parse().ok());
    (
        digits.iter().copied().filter(u8::is_ascii_digit).collect(),
        exponent.unwrap_or(0),
    )
}

fn base_ten_loses_precision(raw: &[u8]) -> bool {
    let (mantissa, exponent) = match strings::index_of_any(raw, b"eE") {
        Some(e) => (&raw[..e], &raw[e + 1..]),
        None => (raw, &[][..]),
    };
    let point = strings::index_of_char_usize(mantissa, b'.');
    let digits = || mantissa.iter().copied().filter(u8::is_ascii_digit);
    let count = digits().count();
    let leading_zeros = digits().take_while(|digit| *digit == b'0').count();
    if leading_zeros == count {
        return false;
    }
    let integer_digits = match point {
        Some(point) => mantissa[..point]
            .iter()
            .filter(|digit| digit.is_ascii_digit())
            .count(),
        None => count,
    };
    // Those of `1.00` are asked for, those of `100` and of `100.` are not.
    let trailing_zeros = match integer_digits == count {
        true => digits().rev().take_while(|digit| *digit == b'0').count(),
        false => 0,
    };
    let precision = count - leading_zeros - trailing_zeros;
    let is_negative = exponent.first() == Some(&b'-');
    let exponent = exponent.iter().filter(|digit| digit.is_ascii_digit());
    let exponent = exponent.fold(0i64, |all, digit| {
        all.saturating_mul(10)
            .saturating_add(i64::from(digit - b'0'))
    });
    let magnitude = (integer_digits as i64 - 1 - leading_zeros as i64)
        .saturating_add(if is_negative { -exponent } else { exponent });
    // Every number with 15 digits that is not next to the limits of a double is told apart from
    // the others by the nearest double.
    if precision <= f64::DIGITS as usize && (-307..=307).contains(&magnitude) {
        return false;
    }
    if precision > 100 {
        return true;
    }
    let text: Vec<u8> = raw.iter().copied().filter(|it| *it != b'_').collect();
    let Some(value) = std::str::from_utf8(&text)
        .ok()
        .and_then(|it| it.parse::<f64>().ok())
    else {
        return false;
    };
    if value == 0.0 || !value.is_finite() {
        return true;
    }
    let (stored, stored_magnitude) = to_precision(value, precision);
    magnitude != stored_magnitude || !digits().skip(leading_zeros).take(precision).eq(stored)
}

/// Whether the number literal `raw` is not the number that it is at run time.
fn loses_precision(raw: &[u8], is_oxlint: bool) -> bool {
    // At most 15 decimal digits, or 13 digits of 4 bits, and no exponent.
    let has_radix = matches!(raw, [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', ..]);
    if raw.len() <= f64::DIGITS as usize
        && (has_radix || strings::index_of_any(raw, b"eE").is_none())
    {
        return false;
    }
    let not_base_ten: fn(&[u8], u32) -> bool = match is_oxlint {
        true => not_base_ten_loses_precision_in_oxlint,
        false => not_base_ten_loses_precision,
    };
    match raw {
        [b'0', b'x' | b'X', digits @ ..] => not_base_ten(digits, 4),
        [b'0', b'o' | b'O', digits @ ..] => not_base_ten(digits, 3),
        [b'0', b'b' | b'B', digits @ ..] => not_base_ten(digits, 1),
        [b'0', digits @ ..]
            if !digits.is_empty() && digits.iter().all(|digit| matches!(digit, b'0'..=b'7')) =>
        {
            not_base_ten(digits, 3)
        }
        _ => base_ten_loses_precision(raw),
    }
}

/// Whether the number has a fractional part at run time. Then the digits that don't fit only round it, as the author expects of
/// `3.14159265358979323846`. An integer such as a 64-bit ID becomes a different integer.
fn is_decimal(raw: &[u8]) -> bool {
    let text: Vec<u8> = raw.iter().copied().filter(|it| *it != b'_').collect();
    let value = std::str::from_utf8(&text)
        .ok()
        .and_then(|it| it.parse::<f64>().ok());
    value.is_some_and(|it| it.is_finite() && it.fract() != 0.0)
}

/// `ignoreDecimals`, which only `bun lint` has.
pub fn ignores_decimals(options: &Options) -> bool {
    options.object(0).bool_or("ignoreDecimals", false)
}

#[inline]
pub fn check<'a, R: Rule>(literal: Literal<'a>, ignore_decimals: bool, cx: &Cx<'a, R>) {
    let raw = literal.text();
    // An exponent takes three characters.
    if raw.len() > 2 && !raw.ends_with(b"n") && loses_precision(raw, cx.language().is_oxlint) {
        report(literal, ignore_decimals, cx);
    }
}

#[cold]
#[inline(never)]
fn report<'a, R: Rule>(literal: Literal<'a>, ignore_decimals: bool, cx: &Cx<'a, R>) {
    if ignore_decimals && is_decimal(literal.text()) {
        return;
    }
    cx.report(literal, NO_LOSS_OF_PRECISION).hint_with(|| {
        let Node::Expr(number) = literal.owner() else {
            return None;
        };
        let value = text::number_to_string(number.as_number()?);
        Some(format!("At runtime it is {}.", bstr::BStr::new(&value)))
    });
}

impl Rule for NoLossOfPrecision {
    const META: Meta = Meta::eslint("no-loss-of-precision", Kind::Problem)
        .recommended()
        .hints();
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(options: &Options) -> Self {
        NoLossOfPrecision {
            ignore_decimals: ignores_decimals(options),
        }
    }

    fn number_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        check(literal, self.ignore_decimals, cx);
    }
}
