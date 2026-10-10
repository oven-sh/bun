use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow literal numbers that lose precision.
pub struct NoLossOfPrecision;

const NO_LOSS_OF_PRECISION: Message = Message::new(
    "noLossOfPrecision",
    "This number literal will lose precision at runtime.",
);

/// Whether the integer with these `digits` of `bits_per_digit` bits each is not a double.
fn not_base_ten_loses_precision(digits: &[u8], bits_per_digit: u32) -> bool {
    // The positions of the first and of the last bit that is set, counted from the first bit.
    let (mut first, mut last) = (None, 0);
    let mut at = 0;
    for digit in digits.iter().filter_map(|digit| char::from(*digit).to_digit(16)) {
        if digit != 0 {
            if first.is_none() {
                first = Some(at + bits_per_digit - 1 - digit.ilog2());
            }
            last = at + bits_per_digit - 1 - digit.trailing_zeros();
        }
        at += bits_per_digit;
    }
    first.is_some_and(|first| last - first >= f64::MANTISSA_DIGITS || at - first > f64::MAX_EXP as u32)
}

/// `value.toPrecision(precision)` of a finite `value > 0`, for a precision from 1 to 100: the digits, and the exponent
/// of the first.
fn to_precision(value: f64, precision: usize) -> (Vec<u8>, i64) {
    let mut buffer = [0; 124];
    let text = bun_core::fmt::FormatDouble::to_exponential(&mut buffer, value, Some(precision as u32 - 1));
    let (digits, exponent) = strings::split_once_char(text, b'e').unwrap_or((text, b"0"));
    let exponent = std::str::from_utf8(exponent).ok().and_then(|it| it.parse().ok());
    (digits.iter().copied().filter(u8::is_ascii_digit).collect(), exponent.unwrap_or(0))
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
        Some(point) => mantissa[..point].iter().filter(|digit| digit.is_ascii_digit()).count(),
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
    let exponent = exponent.fold(0i64, |all, digit| all.saturating_mul(10).saturating_add(i64::from(digit - b'0')));
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
    let Some(value) = std::str::from_utf8(&text).ok().and_then(|it| it.parse::<f64>().ok()) else {
        return false;
    };
    if value == 0.0 || !value.is_finite() {
        return true;
    }
    let (stored, stored_magnitude) = to_precision(value, precision);
    magnitude != stored_magnitude || !digits().skip(leading_zeros).take(precision).eq(stored)
}

/// Whether the number literal `raw` is not the number that it is at run time.
fn loses_precision(raw: &[u8]) -> bool {
    // At most 15 decimal digits, or 13 digits of 4 bits, and no exponent.
    let has_radix = matches!(raw, [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', ..]);
    if raw.len() <= f64::DIGITS as usize && (has_radix || strings::index_of_any(raw, b"eE").is_none()) {
        return false;
    }
    match raw {
        [b'0', b'x' | b'X', digits @ ..] => not_base_ten_loses_precision(digits, 4),
        [b'0', b'o' | b'O', digits @ ..] => not_base_ten_loses_precision(digits, 3),
        [b'0', b'b' | b'B', digits @ ..] => not_base_ten_loses_precision(digits, 1),
        [b'0', digits @ ..] if !digits.is_empty() && digits.iter().all(|digit| matches!(digit, b'0'..=b'7')) => {
            not_base_ten_loses_precision(digits, 3)
        }
        _ => base_ten_loses_precision(raw),
    }
}

fn check<R: Rule>(literal: Span, cx: &Cx<'_, R>) {
    if loses_precision(cx.slice(literal)) {
        cx.report(literal, NO_LOSS_OF_PRECISION);
    }
}

fn check_key<'a, R: Rule>(key: Option<Key<'a>>, cx: &Cx<'a, R>) {
    if let Some(key) = key
        && matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
    {
        let literal = key.inner_span(cx.file());
        if !cx.slice(literal).ends_with(b"n") {
            check(literal, cx);
        }
    }
}

/// ESTree has a `Literal` for a number in an expression, in a type and in the name of a property. A rule with this
/// calls what follows, each from its method of the same name.
pub const ON: On = On::new()
    .exprs(&[ExprTag::Number])
    .types(&[TypeTag::NumberLit])
    .members()
    .props()
    .pats(&[PatTag::Object]);

pub fn expr<'a, R: Rule>(e: Expr<'a>, cx: &mut Cx<'a, R>) {
    check(e.span(), cx);
}

pub fn ty<'a, R: Rule>(ty: TypeNode<'a>, cx: &mut Cx<'a, R>) {
    let literal = ty.span();
    match ty.text().starts_with(b"-") {
        true => check(Span::new(skip_trivia(cx.text(), literal.start + 1), literal.end), cx),
        false => check(literal, cx),
    }
}

pub fn member<'a, R: Rule>(member: Member<'a>, cx: &mut Cx<'a, R>) {
    if member.flags().intersects(Flags::LITERAL_NAME | Flags::COMPUTED_NAME) {
        check_key(member.key(), cx);
    }
}

pub fn prop<'a, R: Rule>(property: Prop<'a>, cx: &mut Cx<'a, R>) {
    // A property that is not a method starts with its key.
    let first = cx.text().get(property.span().start as usize);
    if property.kind() != PropKind::Init || matches!(first, Some(b'0'..=b'9' | b'.' | b'[')) {
        check_key(property.key(), cx);
    }
}

pub fn pat<'a, R: Rule>(pattern: Pat<'a>, cx: &mut Cx<'a, R>) {
    if let PatKind::Object(properties) = pattern.kind() {
        for property in properties {
            check_key(property.key(), cx);
        }
    }
}

impl Rule for NoLossOfPrecision {
    const META: Meta = Meta::eslint("no-loss-of-precision", Kind::Problem).recommended();
    const ON: On = ON;
    no_state!();

    fn new(_: &Options) -> Self {
        NoLossOfPrecision
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        expr(e, cx);
    }

    fn ty<'a>(&self, it: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        ty(it, cx);
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        pat(pattern, cx);
    }

    fn member<'a>(&self, it: Member<'a>, cx: &mut Cx<'a, Self>) {
        member(it, cx);
    }

    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        prop(property, cx);
    }
}
