use crate::{BigIntRef, Error, Fill, Filled, MAX_BITS, Outcome, Poll, digits};

#[inline(always)]
pub fn left_shift<'a>(
    x: BigIntRef<'a>,
    y: BigIntRef<'a>,
) -> Result<Outcome<impl Fill + 'a>, Error> {
    shift(x, y.digits, !y.is_negative)
}

#[inline(always)]
pub fn signed_right_shift<'a>(
    x: BigIntRef<'a>,
    y: BigIntRef<'a>,
) -> Result<Outcome<impl Fill + 'a>, Error> {
    shift(x, y.digits, y.is_negative)
}

#[inline(always)]
fn shift<'a>(x: BigIntRef<'a>, amount: &[u64], is_left: bool) -> Result<Outcome<Shift<'a>>, Error> {
    let amount = match *amount {
        [] => return Ok(Outcome::First),
        [amount] => amount,
        _ => u64::MAX,
    };
    if x.is_zero() {
        return Ok(Outcome::First);
    }
    if is_left {
        shift_left(x, amount)
    } else {
        Ok(shift_right(x, amount))
    }
}

#[inline(always)]
fn shift_left(x: BigIntRef<'_>, amount: u64) -> Result<Outcome<Shift<'_>>, Error> {
    if let (&[digit], ..64) = (x.digits, amount) {
        return Ok(Outcome::small(x.is_negative, u128::from(digit) << amount));
    }
    let bits = amount.saturating_add(digits::bit_length(x.digits) as u64);
    if let (Some(magnitude), ..=128) = (digits::to_u128(x.digits), bits) {
        return Ok(Outcome::small(x.is_negative, magnitude << amount));
    }
    if bits > MAX_BITS as u64 {
        return Err(Error::TooBig);
    }
    Ok(Outcome::large(Shift {
        length: (bits as usize).div_ceil(64),
        x,
        amount: amount as usize,
        kind: Kind::Left,
    }))
}

/// Rounds towards negative infinity.
#[inline(always)]
fn shift_right(x: BigIntRef<'_>, amount: u64) -> Outcome<Shift<'_>> {
    if let (&[digit], ..64) = (x.digits, amount) {
        let kept = digit >> amount;
        let rounds = x.is_negative && kept << amount != digit;
        return Outcome::small(x.is_negative, u128::from(kept + u64::from(rounds)));
    }
    let Some(bits @ 1..) = (digits::bit_length(x.digits) as u64).checked_sub(amount) else {
        return Outcome::small(true, u128::from(x.is_negative));
    };
    let (bits, amount) = (bits as usize, amount as usize);
    let (dropped, kept) = x.digits.split_at(amount / 64);
    let rounds = x.is_negative && drops_a_one(dropped, kept[0], amount % 64);
    if bits < 128 {
        let digit = |index| digits::digit_or_zero(kept, index);
        let low = digit(1).funnel_shr(digit(0), (amount % 64) as u32);
        let high = digit(2).funnel_shr(digit(1), (amount % 64) as u32);
        return Outcome::small(x.is_negative, digits::join(low, high) + u128::from(rounds));
    }
    let can_carry = rounds && bits % 64 == 0 && digits::top_bits(kept) == u64::MAX;
    Outcome::large(Shift {
        length: bits.div_ceil(64) + usize::from(can_carry),
        x,
        amount,
        kind: if rounds {
            Kind::RightAwayFromZero
        } else {
            Kind::Right
        },
    })
}

#[inline]
fn drops_a_one(dropped: &[u64], next: u64, bits: usize) -> bool {
    next & ((1 << bits) - 1) != 0 || dropped.iter().any(|&digit| digit != 0)
}

#[derive(PartialEq, Eq)]
enum Kind {
    Left,
    Right,
    RightAwayFromZero,
}

struct Shift<'a> {
    length: usize,
    x: BigIntRef<'a>,
    amount: usize,
    kind: Kind,
}

impl Fill for Shift<'_> {
    #[inline(always)]
    fn digit_count(&self) -> usize {
        self.length
    }

    #[inline(always)]
    fn fill(self, out: &mut [u64], _: Poll<'_>) -> Result<Filled, Error> {
        let out = &mut out[..self.length];
        match self.kind {
            Kind::Left => digits::shift_left(out, self.x.digits, self.amount),
            Kind::Right => digits::shift_right(out, self.x.digits, self.amount),
            Kind::RightAwayFromZero => {
                out[self.length - 1] = 0;
                let kept = self.x.digits.len() - self.amount / 64;
                let low = &mut out[..self.length.min(kept)];
                digits::shift_right(low, self.x.digits, self.amount);
                digits::increment(out);
                return Filled::whole_or_one_less(true, out);
            }
        }
        Ok(Filled::whole(self.x.is_negative, out))
    }
}
