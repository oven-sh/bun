//! Binary NUMERIC (OID 1700) in PostgreSQL's two steps, `numeric_recv` then `get_str_from_var`: https://github.com/postgres/postgres/blob/ab22337434958cb59cdca7cddd0cbd9a27ea4765/src/backend/utils/adt/numeric.c#L1076

use bun_collections::smallvec::SmallVec;

bun_core::declare_scope!(PostgresDataCell, visible);

const NBASE: u16 = 10000;
const DEC_DIGITS: usize = 4;
const NUMERIC_POS: u16 = 0x0000;
const NUMERIC_NEG: u16 = 0x4000;
const NUMERIC_NAN: u16 = 0xC000;
const NUMERIC_PINF: u16 = 0xD000;
const NUMERIC_NINF: u16 = 0xF000;

pub(crate) enum Text<'a> {
    Static(&'static [u8]),
    Printed(&'a [u8]),
}

impl Text<'_> {
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            Text::Static(text) => text,
            Text::Printed(text) => text,
        }
    }
}

/// Holds the printed text of one NUMERIC: on the stack up to 64 characters.
pub(crate) type Buffer = SmallVec<[u8; 64]>;

enum BinaryNumeric<'a> {
    NaN,
    Infinity,
    NegInfinity,
    Zero { dscale: usize },
    Finite(NumericVar<'a>),
}

/// A value that is not zero, as `numeric_recv` stores it: cut to `dscale`, no leading zero word.
struct NumericVar<'a> {
    negative: bool,
    weight: i32,
    dscale: usize,
    digits: &'a [[u8; 2]],
}

#[inline(always)]
fn recv(cell: &[u8]) -> crate::Result<BinaryNumeric<'_>> {
    let Some((header, body)) = cell.split_first_chunk::<8>() else {
        return Err(crate::Error::InvalidBuffer);
    };
    // numeric_recv reads ndigits as uint16 (:1091): a value of 131072 digits has 32768 words.
    let ndigits = usize::from(u16::from_be_bytes([header[0], header[1]]));
    let mut weight = i32::from(i16::from_be_bytes([header[2], header[3]]));
    let sign = u16::from_be_bytes([header[4], header[5]]);
    // numeric_recv rejects a dscale over 0x3FFF (:1109). CrateDB before 6.3.4 sends a negative one, so that reads as 0.
    let dscale = i16::from_be_bytes([header[6], header[7]]).max(0) as usize;
    bun_core::scoped_log!(
        PostgresDataCell,
        "ndigits: {}, weight: {}, sign: {}, dscale: {}",
        ndigits,
        weight,
        sign,
        dscale
    );
    let Some(words) = body.as_chunks::<2>().0.get(..ndigits) else {
        return Err(crate::Error::InvalidBuffer);
    };
    let negative = match sign {
        NUMERIC_POS => false,
        NUMERIC_NEG => true,
        NUMERIC_NAN => return Ok(BinaryNumeric::NaN),
        NUMERIC_PINF => return Ok(BinaryNumeric::Infinity),
        NUMERIC_NINF => return Ok(BinaryNumeric::NegInfinity),
        _ => return Err(crate::Error::InvalidSign),
    };

    // trunc_var (:11911): dscale keeps the first `visible` decimal digits of the words and hides the rest.
    let visible = (weight + 1) * DEC_DIGITS as i32 + dscale as i32;
    let kept = ndigits.min((visible.max(0) as usize).div_ceil(DEC_DIGITS));
    let mut digits = &words[..kept];
    // make_result (:7872) strips leading zero words. A PostgreSQL server sends none, so this is one compare for its datums.
    while let Some(([0, 0], rest)) = digits.split_first() {
        digits = rest;
        weight -= 1;
    }
    // trunc_var (:11959) clears the decimal digits that dscale hides in the last kept word. Alone, that word can become zero.
    if let [last] = digits {
        let shown = visible - DEC_DIGITS as i32 * (kept as i32 - 1);
        let smallest_nonzero: u16 = match shown {
            4.. => 1,
            3 => 10,
            2 => 100,
            _ => 1000,
        };
        if u16::from_be_bytes(*last) < smallest_nonzero {
            digits = &[];
        }
    }
    // make_result (:7883): a value with no digit left has no sign.
    if digits.is_empty() {
        return Ok(BinaryNumeric::Zero { dscale });
    }

    Ok(BinaryNumeric::Finite(NumericVar {
        negative,
        weight,
        dscale,
        digits,
    }))
}

/// The characters `get_str_from_var` prints for the first integer word: no leading zero, always the last digit.
#[inline]
fn first_word_chars(digit: u16) -> usize {
    if digit >= 1000 {
        4
    } else if digit >= 100 {
        3
    } else if digit >= 10 {
        2
    } else {
        1
    }
}

/// The output of `NumericVar::print`. A write past the end is an error, not a panic.
struct Out<'a>(&'a mut [u8]);

impl Out<'_> {
    #[inline(always)]
    fn put<const N: usize>(&mut self, chars: [u8; N]) -> crate::Result<()> {
        let Some((head, rest)) = core::mem::take(&mut self.0).split_first_chunk_mut::<N>() else {
            return Err(crate::Error::InvalidBuffer);
        };
        *head = chars;
        self.0 = rest;
        Ok(())
    }
}

impl NumericVar<'_> {
    /// Word `d`, or zero outside the words. numeric_recv rejects a word over 9999 (:1118): each printed word is checked here.
    #[inline(always)]
    fn word(&self, d: i32) -> crate::Result<u16> {
        // A negative `d` casts to an index that `get` answers with `None`.
        let digit = match self.digits.get(d as usize) {
            Some(word) => u16::from_be_bytes(*word),
            None => 0,
        };
        if digit >= NBASE {
            return Err(crate::Error::InvalidBuffer);
        }
        Ok(digit)
    }

    #[inline(always)]
    fn printed_len(&self) -> usize {
        let integer_chars = if self.weight < 0 {
            1
        } else {
            let first = self
                .digits
                .first()
                .map_or(0, |word| u16::from_be_bytes(*word));
            first_word_chars(first) + DEC_DIGITS * self.weight as usize
        };
        let fraction_chars = if self.dscale > 0 { 1 + self.dscale } else { 0 };
        usize::from(self.negative) + integer_chars + fraction_chars
    }

    /// Port of `get_str_from_var` (:7548). The text fills the `printed_len` characters of `out`.
    fn print(&self, out: &mut [u8]) -> crate::Result<()> {
        let chars = |digit: u16| bun_core::fmt::itoa_padded::<DEC_DIGITS>(u64::from(digit));
        let mut out = Out(out);
        if self.negative {
            out.put(*b"-")?;
        }

        let mut d: i32;
        if self.weight < 0 {
            d = self.weight + 1;
            out.put(*b"0")?;
        } else {
            let first = self.word(0)?;
            let [a, b, c, last] = chars(first);
            match first_word_chars(first) {
                4 => out.put([a, b, c, last])?,
                3 => out.put([b, c, last])?,
                2 => out.put([c, last])?,
                _ => out.put([last])?,
            }
            d = 1;
            while d <= self.weight {
                out.put(chars(self.word(d)?))?;
                d += 1;
            }
        }

        if self.dscale > 0 {
            out.put(*b".")?;
            let mut left = self.dscale;
            while left >= DEC_DIGITS {
                out.put(chars(self.word(d)?))?;
                d += 1;
                left -= DEC_DIGITS;
            }
            if left != 0 {
                let [a, b, c, _] = chars(self.word(d)?);
                match left {
                    3 => out.put([a, b, c])?,
                    2 => out.put([a, b])?,
                    _ => out.put([a])?,
                }
            }
        }

        debug_assert!(out.0.is_empty());
        Ok(())
    }
}

/// `numeric_out(numeric_recv(cell))`: the text a PostgreSQL server prints for the value it receives from `cell`.
#[inline(always)]
pub(crate) fn parse_binary_numeric<'a>(
    cell: &[u8],
    buffer: &'a mut Buffer,
) -> crate::Result<Text<'a>> {
    Ok(match recv(cell)? {
        BinaryNumeric::NaN => Text::Static(b"NaN"),
        BinaryNumeric::Infinity => Text::Static(b"Infinity"),
        BinaryNumeric::NegInfinity => Text::Static(b"-Infinity"),
        BinaryNumeric::Zero { dscale: 0 } => Text::Static(b"0"),
        BinaryNumeric::Zero { dscale } => {
            *buffer = SmallVec::from_elem(b'0', 2 + dscale);
            buffer[1] = b'.';
            Text::Printed(buffer)
        }
        BinaryNumeric::Finite(value) => {
            *buffer = SmallVec::from_elem(0, value.printed_len());
            value.print(buffer)?;
            Text::Printed(buffer)
        }
    })
}
