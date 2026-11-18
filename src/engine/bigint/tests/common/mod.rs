use bun_engine_bigint::*;
use bun_engine_standalone as _;
use bun_engine_text::Text;

pub(crate) fn try_parse(text: &str) -> Result<BigInt, Error> {
    from_string(Text::Latin1(text.as_bytes()))?.into_owned(&mut || false)
}

/// Takes a sign in front of a radix prefix too.
pub(crate) fn big(text: &str) -> BigInt {
    match text.strip_prefix('-') {
        Some(magnitude) => apply("-", &big("0"), &big(magnitude)),
        None => try_parse(text).unwrap(),
    }
}

pub(crate) fn try_apply(operator: &str, x: &BigInt, y: &BigInt) -> Result<BigInt, Error> {
    try_apply_with(operator, x, y, &DivisorCache::default(), &mut || false)
}

pub(crate) fn try_apply_with(
    operator: &str,
    x: &BigInt,
    y: &BigInt,
    cache: &DivisorCache,
    poll: Poll<'_>,
) -> Result<BigInt, Error> {
    let (x, y) = (x.as_ref(), y.as_ref());
    match operator {
        "+" => add(x, y).into_owned(x, y, poll),
        "-" => subtract(x, y).into_owned(x, y, poll),
        "*" => multiply(x, y)?.into_owned(x, y, poll),
        "/" => divide(x, y, cache)?.into_owned(x, y, poll),
        "%" => remainder(x, y, cache)?.into_owned(x, y, poll),
        "**" => exponentiate(x, y)?.into_owned(x, y, poll),
        "<<" => left_shift(x, y)?.into_owned(x, y, poll),
        ">>" => signed_right_shift(x, y)?.into_owned(x, y, poll),
        "&" => bitwise_and(x, y).into_owned(x, y, poll),
        "|" => bitwise_or(x, y).into_owned(x, y, poll),
        "^" => bitwise_xor(x, y).into_owned(x, y, poll),
        _ => unreachable!(),
    }
}

pub(crate) fn apply(operator: &str, x: &BigInt, y: &BigInt) -> BigInt {
    try_apply(operator, x, y).unwrap()
}
