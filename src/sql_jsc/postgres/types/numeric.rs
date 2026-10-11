//! Binary NUMERIC (OID 1700), decoded in PostgreSQL's two steps: receive
//! (`numeric_recv`), then print (`get_str_from_var`).
//!
//! The reference for a datum is `numeric_out(numeric_recv(bytes))`: the text
//! a PostgreSQL server prints for the value it receives from these bytes.
//! Line numbers are for src/backend/utils/adt/numeric.c at REL_17_STABLE:
//! https://github.com/postgres/postgres/blob/ab22337434958cb59cdca7cddd0cbd9a27ea4765/src/backend/utils/adt/numeric.c

bun_core::declare_scope!(PostgresDataCell, visible);

const NBASE: u16 = 10000;
/// Decimal digits in one base-`NBASE` word.
const DEC_DIGITS: usize = 4;
const NUMERIC_POS: u16 = 0x0000;
const NUMERIC_NEG: u16 = 0x4000;
const NUMERIC_NAN: u16 = 0xC000;
const NUMERIC_PINF: u16 = 0xD000;
const NUMERIC_NINF: u16 = 0xF000;
const NUMERIC_DSCALE_MAX: usize = 0x3FFF;

/// A binary NUMERIC datum after `numeric_recv`.
pub(crate) enum BinaryNumeric<'a> {
    NaN,
    Infinity,
    NegInfinity,
    /// No digit is left. It prints as "0", or as "0." and `dscale` zeros.
    Zero {
        dscale: usize,
    },
    Finite(NumericVar<'a>),
}

/// A value that is not zero, as `numeric_recv` stores it: cut to `dscale`,
/// with no leading zero word. Only [`recv`] builds one, so the printer never
/// sees a datum as it came off the wire.
pub(crate) struct NumericVar<'a> {
    negative: bool,
    /// Power of `NBASE` of `digits[0]`.
    weight: i32,
    dscale: usize,
    /// Big-endian base-`NBASE` words. The first one is not zero.
    digits: &'a [[u8; 2]],
}

/// `numeric_recv` rejects `d < 0 || d >= NBASE` for every word (:1118), also
/// for the words it never prints: under NaN and Infinity, and past `dscale`.
#[cold]
#[inline(never)]
fn words_in_range(words: &[[u8; 2]]) -> crate::Result<()> {
    for word in words {
        if u16::from_be_bytes(*word) >= NBASE {
            return Err(crate::Error::InvalidBuffer);
        }
    }
    Ok(())
}

/// Port of `numeric_recv` (:1076) with the `trunc_var` (:11911) and
/// `make_result` (:7836) it runs on a finite value.
///
/// A word that stays in the result is range-checked by
/// [`NumericVar::print`], in the loop that formats it.
pub(crate) fn recv(cell: &[u8]) -> crate::Result<BinaryNumeric<'_>> {
    let Some((header, body)) = cell.split_first_chunk::<8>() else {
        return Err(crate::Error::InvalidBuffer);
    };
    // ndigits and dscale are uint16 on the wire (:1091, :1108). A server sends
    // up to 36864 words, which is negative as an int16.
    let ndigits = usize::from(u16::from_be_bytes([header[0], header[1]]));
    let mut weight = i32::from(i16::from_be_bytes([header[2], header[3]]));
    let sign = u16::from_be_bytes([header[4], header[5]]);
    let dscale = usize::from(u16::from_be_bytes([header[6], header[7]]));
    bun_core::scoped_log!(
        PostgresDataCell,
        "ndigits: {}, weight: {}, sign: {}, dscale: {}",
        ndigits,
        weight,
        sign,
        dscale
    );

    // The datum is the header and exactly `ndigits` words. `numeric_recv`
    // stops on a missing word, and its caller rejects bytes that are left.
    if body.len() != ndigits * 2 || dscale > NUMERIC_DSCALE_MAX {
        return Err(crate::Error::InvalidBuffer);
    }
    let (words, _) = body.as_chunks::<2>();

    let negative = match sign {
        NUMERIC_POS => false,
        NUMERIC_NEG => true,
        NUMERIC_NAN | NUMERIC_PINF | NUMERIC_NINF => {
            if ndigits != 0 {
                words_in_range(words)?;
            }
            return Ok(match sign {
                NUMERIC_NAN => BinaryNumeric::NaN,
                NUMERIC_PINF => BinaryNumeric::Infinity,
                _ => BinaryNumeric::NegInfinity,
            });
        }
        _ => return Err(crate::Error::InvalidSign),
    };
    if ndigits == 0 {
        return Ok(BinaryNumeric::Zero { dscale });
    }

    // trunc_var: `dscale` keeps the first `visible` decimal digits of the
    // datum, counted from the start of word 0, and hides the rest.
    let visible = (weight + 1) * DEC_DIGITS as i32 + dscale as i32;
    let kept = if visible <= 0 {
        0
    } else {
        ndigits.min((visible as usize).div_ceil(DEC_DIGITS))
    };
    if kept != ndigits {
        words_in_range(&words[kept..])?;
    }

    // make_result: strip the leading zero words. A server never sends one, so
    // this is one compare for its datums.
    let mut digits = &words[..kept];
    while let Some(([0, 0], rest)) = digits.split_first() {
        digits = rest;
        weight -= 1;
    }
    // trunc_var also clears the low decimal digits that `dscale` hides in the
    // last kept word (:11948). When no other word is left, that can clear the
    // whole value.
    if let [last] = digits {
        let shown = visible - DEC_DIGITS as i32 * (kept as i32 - 1);
        let smallest_shown: u16 = match shown {
            4.. => 1,
            3 => 10,
            2 => 100,
            _ => 1000,
        };
        if u16::from_be_bytes(*last) < smallest_shown {
            digits = &[];
        }
    }
    // make_result: a value with no digit left has weight 0 and sign plus.
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

/// Characters `get_str_from_var` prints for the first integer word: it
/// suppresses the leading decimal zeros and always prints the last digit.
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

/// The output of [`NumericVar::print`], written front to back. A write past
/// the end is an error, not a panic.
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
    /// Word `d`, range-checked as `numeric_recv` does (:1118). A word outside
    /// the datum is zero: a negative `d` casts to an index that `get` answers
    /// with `None`.
    #[inline(always)]
    fn word(&self, d: i32) -> crate::Result<u16> {
        let digit = match self.digits.get(d as usize) {
            Some(word) => u16::from_be_bytes(*word),
            None => 0,
        };
        if digit >= NBASE {
            return Err(crate::Error::InvalidBuffer);
        }
        Ok(digit)
    }

    /// The number of characters [`Self::print`] writes.
    pub(crate) fn printed_len(&self) -> usize {
        let integer_chars = if self.weight < 0 {
            1
        } else {
            let first = self.digits.first().map_or(0, |word| u16::from_be_bytes(*word));
            first_word_chars(first) + DEC_DIGITS * self.weight as usize
        };
        let fraction_chars = if self.dscale > 0 { 1 + self.dscale } else { 0 };
        usize::from(self.negative) + integer_chars + fraction_chars
    }

    /// Port of `get_str_from_var` (:7548). `out` is [`Self::printed_len`]
    /// characters. It is an error when the text does not fill `out` exactly.
    pub(crate) fn print(&self, out: &mut [u8]) -> crate::Result<()> {
        let chars = |digit: u16| bun_core::fmt::itoa_padded::<DEC_DIGITS>(u64::from(digit));
        let mut out = Out(out);
        if self.negative {
            out.put([b'-'])?;
        }

        // Output all digits before the decimal point
        let mut d: i32;
        if self.weight < 0 {
            d = self.weight + 1;
            out.put([b'0'])?;
        } else {
            // In the first digit, suppress extra leading decimal zeroes
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

        // A decimal point and `dscale` digits. The last word is cut short.
        if self.dscale > 0 {
            out.put([b'.'])?;
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

        if !out.0.is_empty() {
            return Err(crate::Error::InvalidBuffer);
        }
        Ok(())
    }
}
