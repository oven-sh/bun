//! Between digits and characters.

mod bit_groups;
mod decimal;
mod format;
mod parse;
mod powers;
mod radix;

pub use parse::{LiteralRadix, from_literal, from_string};

use bun_engine_text::CodeUnit;

const CHARACTERS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// `byte` in each of eight places.
const fn repeated(byte: u8) -> u64 {
    u64::from_le_bytes([byte; 8])
}

/// Eight characters, the first in the low byte. One that does not fit becomes 0xff.
#[inline(always)]
fn packed<T: CodeUnit>(units: &[T; 8]) -> u64 {
    u64::from_le_bytes(units.map(|unit| unit.to_u16().min(0xff) as u8))
}
