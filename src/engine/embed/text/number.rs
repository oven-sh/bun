//! Numbers to text and back.

use bun_engine_number::{
    JsonNumber, NUMBER_TEXT_CAPACITY, Radix, Surroundings, parse_integer, parse_json_number,
    write_f64,
};
use bun_engine_text::with_text;

use super::abi::RawText;

#[unsafe(no_mangle)]
extern "C" fn engine_number_write_shortest(
    number: f64,
    out: &mut [u8; NUMBER_TEXT_CAPACITY],
) -> usize {
    write_f64(number, out)
}

/// `length` is zero if the text does not start with a number.
#[unsafe(no_mangle)]
extern "C" fn engine_number_parse_json(text: RawText<'_>, length: &mut usize) -> f64 {
    let number;
    (number, *length) = match with_text!(text.text(), |units| parse_json_number(units)) {
        Ok((JsonNumber::Int32(number), length)) => (number.into(), length),
        Ok((JsonNumber::Double(number), length)) => (number, length),
        Err(_) => (0.0, 0),
    };
    number
}

#[unsafe(no_mangle)]
extern "C" fn engine_number_parse_integer(
    text: RawText<'_>,
    radix: u8,
    surroundings: Surroundings,
    is_signed: bool,
    bits: &mut u64,
) -> bool {
    let Ok(radix) = Radix::new(radix.into()) else {
        return false;
    };
    let parsed = if is_signed {
        parse_integer(text.text(), radix, surroundings).map(i64::cast_unsigned)
    } else {
        parse_integer(text.text(), radix, surroundings)
    };
    parsed.map(|it| *bits = it).is_some()
}
