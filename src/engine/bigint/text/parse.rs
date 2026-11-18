use bun_engine_text::{CodeUnit, Text, with_text};
use bun_engine_unicode::is_str_white_space;

use super::powers::Halving;
use super::radix::{CHUNKS, log2_rounded_down};
use super::{bit_groups, decimal};
use crate::digits::{self, Multiplier};
use crate::{Error, Fill, Filled, MAX_BITS, New, Poll, Scratch, SmallBigInt, Work};

/// The radices that integer literals are written in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LiteralRadix {
    Binary = 2,
    Octal = 8,
    Decimal = 10,
    Hexadecimal = 16,
}

impl LiteralRadix {
    /// A longer text is too big whatever its value is.
    const fn max_characters(self) -> usize {
        match self {
            LiteralRadix::Binary => MAX_BITS,
            LiteralRadix::Octal => MAX_BITS / 3,
            LiteralRadix::Decimal => (MAX_BITS as u64 * 32 / 107) as usize,
            LiteralRadix::Hexadecimal => MAX_BITS / 4,
        }
    }

    const fn max_small_characters(self) -> usize {
        match self {
            LiteralRadix::Binary => 128,
            LiteralRadix::Octal => 42,
            LiteralRadix::Decimal => 38,
            LiteralRadix::Hexadecimal => 32,
        }
    }

    fn max_bits(self, characters: usize) -> usize {
        const BITS_PER_DECIMAL_DIGIT: u64 = (log2_rounded_down(10) >> 8) + 1;
        match self {
            LiteralRadix::Decimal => {
                ((characters as u64 * BITS_PER_DECIMAL_DIGIT) >> 32) as usize + 1
            }
            _ => characters * (self as u32).ilog2() as usize,
        }
    }
}

/// StringToBigInt of ECMA-262. [`Error::InvalidText`], here or from [`Fill::fill`], is its `undefined`.
#[inline]
pub fn from_string(text: Text<'_>) -> Result<New<impl Fill + '_>, Error> {
    with_text!(text, |units| string_integer_literal(units))
}

/// `characters` have no sign, prefix, suffix or separators.
#[inline]
pub fn from_literal(
    characters: Text<'_>,
    radix: LiteralRadix,
    is_negative: bool,
) -> Result<New<impl Fill + '_>, Error> {
    with_text!(characters, |units| literal(units, radix, is_negative))
}

fn string_integer_literal<T: CodeUnit>(mut units: &[T]) -> Result<New<Literal<'_>>, Error> {
    while let [first, rest @ ..] = units
        && is_str_white_space(first.to_u32())
    {
        units = rest;
    }
    while let [rest @ .., last] = units
        && is_str_white_space(last.to_u32())
    {
        units = rest;
    }
    if let [zero, prefix, rest @ ..] = units
        && zero.is(b'0')
    {
        match u8::try_from(prefix.to_u16() | 0x20) {
            Ok(b'b') => return literal(rest, LiteralRadix::Binary, false),
            Ok(b'o') => return literal(rest, LiteralRadix::Octal, false),
            Ok(b'x') => return literal(rest, LiteralRadix::Hexadecimal, false),
            _ => {}
        }
    }
    match units {
        [] => Ok(New::Small(SmallBigInt::ZERO)),
        [sign, rest @ ..] if sign.is(b'-') => literal(rest, LiteralRadix::Decimal, true),
        [sign, rest @ ..] if sign.is(b'+') => literal(rest, LiteralRadix::Decimal, false),
        _ => literal(units, LiteralRadix::Decimal, false),
    }
}

#[inline]
fn literal<T: CodeUnit>(
    mut units: &[T],
    radix: LiteralRadix,
    is_negative: bool,
) -> Result<New<Literal<'_>>, Error> {
    if units.is_empty() {
        return Err(Error::InvalidText);
    }
    while let [first, rest @ ..] = units
        && first.is(b'0')
    {
        units = rest;
    }
    if units.len() <= radix.max_small_characters() {
        return Ok(New::Small(SmallBigInt::new(
            is_negative,
            read_small(units, radix)?,
        )));
    }
    if units.len() > radix.max_characters() {
        return Err(Error::TooBig);
    }
    if units[0].digit_value(radix as u32).is_none() {
        return Err(Error::InvalidText);
    }
    Ok(New::Large(Literal {
        characters: T::text(units),
        radix,
        is_negative,
    }))
}

#[inline(always)]
fn read_small<T: CodeUnit>(units: &[T], radix: LiteralRadix) -> Result<u128, Error> {
    if radix != LiteralRadix::Decimal {
        let mut value = [0; 2];
        bit_groups::read(&mut value, units, (radix as u32).ilog2())?;
        return Ok(digits::join(value[0], value[1]));
    }
    let (high, low) = units.split_at(units.len().saturating_sub(decimal::CHUNK_LENGTH));
    match (decimal::read_chunk(high), decimal::read_chunk(low)) {
        (Some(high), Some(low)) => {
            Ok(u128::from(high) * u128::from(CHUNKS[10].power) + u128::from(low))
        }
        _ => Err(Error::InvalidText),
    }
}

struct Literal<'a> {
    /// The first is not zero.
    characters: Text<'a>,
    radix: LiteralRadix,
    is_negative: bool,
}

impl Fill for Literal<'_> {
    #[inline]
    fn digit_count(&self) -> usize {
        self.radix.max_bits(self.characters.len()).div_ceil(64)
    }

    fn fill(self, out: &mut [u64], poll: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.digit_count()];
        with_text!(self.characters, |units| match self.radix {
            LiteralRadix::Decimal => read_decimal(out, units, &mut Work::new(poll)),
            radix => bit_groups::read(out, units, (radix as u32).ilog2()),
        })?;
        Filled::whole_or_one_less(self.is_negative, out)
    }
}

fn read_decimal<T: CodeUnit>(
    out: &mut [u64],
    units: &[T],
    work: &mut Work<'_>,
) -> Result<(), Error> {
    const MAX_WHOLE_LENGTH: usize = 104;
    const MAX_PIECE_LENGTH: usize = 56;
    let chunks = units.len().div_ceil(decimal::CHUNK_LENGTH);
    if chunks <= MAX_WHOLE_LENGTH {
        return read_piece(out, units);
    }
    let halving = Halving::new(chunks, MAX_PIECE_LENGTH);
    let mut scratch = Scratch::<u64, 256>::new();
    let (pieces, product) = scratch
        .filled(0, 2 * halving.length(), work)?
        .split_at_mut(halving.length());
    let texts = units.rchunks(halving.piece_length * decimal::CHUNK_LENGTH);
    for (piece, text) in pieces.chunks_exact_mut(halving.piece_length).zip(texts) {
        work.spend(piece.len() * piece.len())?;
        read_piece(piece, text)?;
    }
    let mut scratch = Scratch::<u64, 128>::new();
    for power in halving.powers(CHUNKS[10].power, &mut scratch, work)? {
        let uses = pieces.len() / (2 * power.half);
        let mut by_power = Multiplier::new(power.digits, power.half, uses, work)?;
        for number in pieces.chunks_exact_mut(2 * power.half) {
            let high = digits::trim(&number[power.half..]);
            if !high.is_empty() {
                let product = &mut product[..high.len() + power.digits.len()];
                by_power.multiply(product, high, work)?;
                number[power.half..].fill(0);
                digits::add_assign(&mut number[power.zeros..], product);
            }
        }
    }
    out.copy_from_slice(&pieces[..out.len()]);
    Ok(())
}

/// The value fits in `out`.
fn read_piece<T: CodeUnit>(out: &mut [u64], units: &[T]) -> Result<(), Error> {
    let (first, chunks) = units.as_rchunks::<{ decimal::CHUNK_LENGTH }>();
    out[0] = decimal::read_chunk(first).ok_or(Error::InvalidText)?;
    let mut length = 1;
    for chunk in chunks {
        let value = decimal::read_chunk(chunk).ok_or(Error::InvalidText)?;
        let top = digits::multiply_assign_digit(&mut out[..length], CHUNKS[10].power, value);
        if top != 0 {
            out[length] = top;
            length += 1;
        }
    }
    out[length..].fill(0);
    Ok(())
}
