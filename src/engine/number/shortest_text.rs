use core::hint::select_unpredictable;

use crate::NUMBER_TEXT_CAPACITY;
use crate::decimal_layout::{Ending, write_decimal, write_exponent, write_exponential};
use crate::digit_words::{split_sixteen_digits, spread_digits, store, to_characters};
use crate::double::{
    FRACTION_MASK, IMPLICIT_BIT, MAX_BIASED_EXPONENT, SIGN_BIT, SIGNIFICAND_BIAS, biased_exponent,
};
use crate::integer_text::write_integer;
use crate::shortest::{Shortest, between_equal_gaps};

type Buffer = [u8; NUMBER_TEXT_CAPACITY];

/// Number::toString of ECMA-262 in radix 10. Returns the length of the text, which starts the buffer.
pub fn write_f64(value: f64, out: &mut Buffer) -> usize {
    let bits = value.to_bits();
    let (biased, significand) = (biased_exponent(bits), bits & FRACTION_MASK | IMPLICIT_BIT);
    let binary_places = (SIGNIFICAND_BIAS as u32).wrapping_sub(biased as u32);
    if binary_places <= significand.trailing_zeros() {
        return write_integer(bits & SIGN_BIT != 0, significand >> binary_places, out);
    }
    if let Some(scaled) = with_few_places(value.abs()) {
        return write_few_places(bits & SIGN_BIT != 0, scaled, out);
    }
    if biased.wrapping_sub(1) < MAX_BIASED_EXPONENT - 1
        && bits & FRACTION_MASK != 0
        && let Some(shortest) =
            between_equal_gaps::<true>(significand, biased as i32 - SIGNIFICAND_BIAS)
    {
        return write_shortest(bits & SIGN_BIT != 0, shortest, out);
    }
    write_uncommon(value, out)
}

/// The value times 10^8, if that is an integer below 10^15 as far as the shortest decimal goes, and the text has no
/// exponent. No two decimals of up to fifteen digits read as the same double, so one that does is the shortest.
#[inline(always)]
fn with_few_places(magnitude: f64) -> Option<u64> {
    const SCALE: f64 = 1e8;
    const ROUNDS: f64 = IMPLICIT_BIT as f64;
    let rounded = magnitude * SCALE + ROUNDS;
    let scaled = rounded.to_bits().wrapping_sub(ROUNDS.to_bits());
    ((100..1_000_000_000_000_000).contains(&scaled) && (rounded - ROUNDS) / SCALE == magnitude)
        .then_some(scaled)
}

#[inline(always)]
fn write_few_places(is_negative: bool, scaled: u64, out: &mut Buffer) -> usize {
    let (whole, fraction) = split_sixteen_digits(scaled);
    let point_at = write_integer(is_negative, whole.into(), out);
    let digits = spread_digits(fraction);
    out[point_at] = b'.';
    store(out, point_at + 1, to_characters(digits));
    let end = point_at + 9 - digits.trailing_zeros() as usize / 8;
    select_unpredictable(fraction == 0, point_at, end)
}

#[cold]
#[inline(never)]
fn write_uncommon(value: f64, out: &mut Buffer) -> usize {
    if let Some(shortest) = Shortest::of(value) {
        return write_shortest(value < 0.0, shortest, out);
    }
    let name: &[u8] = match value {
        0.0 => b"0",
        f64::INFINITY => b"Infinity",
        f64::NEG_INFINITY => b"-Infinity",
        _ => b"NaN",
    };
    out[..name.len()].copy_from_slice(name);
    name.len()
}

/// The digits of `write_f64`, always with an exponent if the value is finite.
pub(crate) fn write_f64_with_exponent(value: f64, out: &mut Buffer) -> usize {
    match Shortest::of(value) {
        Some(shortest) => {
            let (leading, ending, point) = split(shortest);
            write_exponential(out, value < 0.0, leading, ending, point)
        }
        None if value == 0.0 => {
            out[0] = b'0';
            write_exponent(0, out, 1)
        }
        None => write_uncommon(value, out),
    }
}

#[inline(always)]
fn write_shortest(is_negative: bool, shortest: Shortest, out: &mut Buffer) -> usize {
    let (leading, ending, point) = split(shortest);
    write_decimal(out, is_negative, leading, ending, point)
}

/// Sixteen digits from the first nonzero one, the rest, and how many digits precede the decimal point.
#[inline(always)]
fn split(shortest: Shortest) -> (u64, Ending, i32) {
    let is_short = shortest.leading < 1_000_000_000_000_000;
    let leading = select_unpredictable(is_short, shortest.leading * 10, shortest.leading);
    let count = 17 - u8::from(is_short);
    let ending = Ending {
        last: shortest.last,
        is_sixteenth: is_short,
        min_count: select_unpredictable(shortest.needs_last, count, 0),
    };
    (leading, ending, shortest.exponent + i32::from(count))
}
