//! Conversions between numbers and text, and the numeric semantics of the language.

#![forbid(unsafe_code)]
#![feature(float_minimum_maximum)]

mod convert;
mod decimal_layout;
mod decimal_scanner;
mod decimal_to_double;
mod digit_words;
mod double;
mod expansion;
mod fixed_text;
mod float16;
mod format_error;
mod integer_text;
mod json;
mod literal;
pub mod math;
mod number_text;
mod numeric_index;
mod parse_int;
mod parse_integer;
mod powers_of_ten;
mod radix;
mod radix_scanner;
mod radix_text;
mod random;
mod rounded;
mod shortest;
mod shortest_text;
mod sixteen_digits;
mod string_to_number;

pub use convert::{
    IndexError, MAX_SAFE_INTEGER, exact_int32, exact_int52, is_integer, is_negative_zero,
    is_safe_integer, to_index, to_int32, to_int64, to_integer_or_infinity, to_length,
    to_relative_index, to_uint8_clamp, to_uint32, to_uint64,
};
pub use decimal_scanner::parse_decimal_prefix;
pub use fixed_text::{FIXED_TEXT_CAPACITY, to_exponential, to_fixed, to_precision};
pub use float16::{float16_from_f64, float16_to_f64};
pub use format_error::FormatError;
pub use integer_text::{
    INTEGER_TEXT_SLACK, decimal_length, i32_text_length, push_i32, write_i32, write_i64, write_u32,
    write_u64,
};
pub use json::{
    JsonNumber, JsonNumberError, parse_few_json_digits, parse_few_json_places, parse_json_double,
    parse_json_number,
};
pub use literal::{decimal_literal_value, radix_literal_value};
pub use number_text::{NUMBER_TEXT_CAPACITY, NumberText};
pub use numeric_index::canonical_numeric_index;
pub use parse_int::{parse_int, parse_int_of_number};
pub use parse_integer::{Surroundings, parse_integer};
pub use radix::Radix;
pub use radix_text::{RADIX_INTEGER_CAPACITY, integer_to_radix, with_radix_text};
pub use random::Random;
pub use shortest_text::write_f64;
pub use string_to_number::{parse_float, string_to_number};
