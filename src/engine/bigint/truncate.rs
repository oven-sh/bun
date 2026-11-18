use crate::bitwise::{TwosComplement, low_bits};
use crate::{BigIntRef, Error, Fill, Filled, MAX_BITS, Outcome, Poll, digits};

/// BigInt.asIntN
#[inline(always)]
pub fn as_int_n(bits: u64, x: BigIntRef<'_>) -> Outcome<impl Fill + '_> {
    if bits == 64 {
        if x.to_i64().is_some() {
            return Outcome::First;
        }
        let wrapped = x.to_i64_wrapping();
        return Outcome::small(wrapped < 0, u128::from(wrapped.unsigned_abs()));
    }
    if (digits::bit_length(x.digits) as u64) < bits || x.is_zero() {
        return Outcome::First;
    }
    if bits == 0 {
        return Outcome::ZERO;
    }
    if bits <= 128 {
        let unused = 128 - bits;
        let wrapped = (low_bits(x) << unused) as i128 >> unused;
        return Outcome::small(wrapped < 0, wrapped.unsigned_abs());
    }
    let sign_bit = bits as usize - 1;
    let is_negative = TwosComplement::new(x).digit(sign_bit / 64) >> (sign_bit % 64) & 1 != 0;
    truncate(bits as usize, x, is_negative)
}

/// BigInt.asUintN
#[inline(always)]
pub fn as_uint_n(bits: u64, x: BigIntRef<'_>) -> Result<Outcome<impl Fill + '_>, Error> {
    if bits == 64 {
        if x.to_u64().is_some() {
            return Ok(Outcome::First);
        }
        return Ok(Outcome::small(false, u128::from(x.to_u64_wrapping())));
    }
    if !x.is_negative && digits::bit_length(x.digits) as u64 <= bits {
        return Ok(Outcome::First);
    }
    if bits <= 128 {
        let mask = u128::MAX.unbounded_shr(128 - bits as u32);
        return Ok(Outcome::small(false, low_bits(x) & mask));
    }
    if bits > MAX_BITS as u64 {
        return Err(Error::TooBig);
    }
    Ok(truncate(bits as usize, x, false))
}

/// The magnitude of the result is that of `x` modulo `2^bits`, negated first if the sign changes.
#[inline(always)]
fn truncate(bits: usize, x: BigIntRef<'_>, is_negative: bool) -> Outcome<Truncation<'_>> {
    let negates = is_negative != x.is_negative;
    let source = TwosComplement::new(BigIntRef::new(negates, x.digits));
    let top = (bits - 1) / 64;
    let (mut length, mut top_mask) = (top + 1, u64::MAX >> (63 - (bits - 1) % 64));
    if source.digit(top) & top_mask == 0 {
        (length, top_mask) = (length_below(&source, top), u64::MAX);
        if length == 0 {
            return Outcome::ZERO;
        }
    }
    Outcome::large(Truncation {
        length,
        top_mask,
        magnitude: x.digits,
        negates,
        is_negative,
    })
}

fn length_below(source: &TwosComplement<'_>, end: usize) -> usize {
    (0..end)
        .rfind(|&index| source.digit(index) != 0)
        .map_or(0, |top| top + 1)
}

struct Truncation<'a> {
    length: usize,
    top_mask: u64,
    magnitude: &'a [u64],
    negates: bool,
    is_negative: bool,
}

impl Fill for Truncation<'_> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.length
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], _: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.length];
        if self.negates {
            negate(out, self.magnitude);
        } else {
            digits::copy(out, self.magnitude);
        }
        out[self.length - 1] &= self.top_mask;
        Ok(Filled::whole(self.is_negative, out))
    }
}

/// `out = -a`, cut to its length.
fn negate(out: &mut [u64], a: &[u64]) {
    let (low, above) = out.split_at_mut(out.len().min(a.len()));
    for (out, &digit) in low.iter_mut().zip(a) {
        *out = !digit;
    }
    above.fill(u64::MAX);
    digits::increment(out);
}
