use crate::{Error, MAX_LENGTH, Poll, SmallBigInt, digits};

/// What an operation comes to before anything is allocated for it.
pub enum Outcome<F> {
    /// The first operand, as it is.
    First,
    /// The second operand, as it is.
    Second,
    New(New<F>),
}

/// A value that has no storage yet.
pub enum New<F> {
    Small(SmallBigInt),
    Large(F),
}

/// The rest of an operation, to be done in storage of the caller.
pub trait Fill {
    /// Whether the result can be zero, or shorter than [`digit_count`](Self::digit_count) by more than one digit.
    const CAN_FALL_SHORT: bool = false;

    /// At most `MAX_LENGTH + 1`.
    fn digit_count(&self) -> usize;

    /// `out` has `digit_count()` digits of any value. After an error it holds nothing of use.
    fn fill(self, out: &mut [u64], poll: Poll<'_>) -> Result<Filled, Error>;
}

/// The result is the first `length` digits that were filled.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Filled {
    pub length: u32,
    pub is_negative: bool,
}

impl<F> Outcome<F> {
    pub(crate) const ZERO: Outcome<F> = Outcome::New(New::Small(SmallBigInt::ZERO));

    #[inline(always)]
    pub(crate) fn small(is_negative: bool, magnitude: u128) -> Outcome<F> {
        Outcome::New(New::Small(SmallBigInt::new(is_negative, magnitude)))
    }

    #[inline(always)]
    pub(crate) fn large(fill: F) -> Outcome<F> {
        Outcome::New(New::Large(fill))
    }
}

impl Filled {
    /// `out` is within the limit and has no leading zero.
    #[inline(always)]
    pub(crate) fn whole(is_negative: bool, out: &[u64]) -> Filled {
        debug_assert!(out.len() <= MAX_LENGTH && out.last().is_some_and(|&top| top != 0));
        Filled {
            length: out.len() as u32,
            is_negative,
        }
    }

    /// Only the top digit of `out` can be zero.
    #[inline(always)]
    pub(crate) fn whole_or_one_less(is_negative: bool, out: &[u64]) -> Result<Filled, Error> {
        let length = out.len() - usize::from(out.last() == Some(&0));
        if length > MAX_LENGTH {
            return Err(Error::TooBig);
        }
        Ok(Filled::whole(is_negative, &out[..length]))
    }

    /// `out` is within the limit.
    #[inline(always)]
    pub(crate) fn trimmed(is_negative: bool, out: &[u64]) -> Filled {
        let length = digits::trim(out).len();
        debug_assert!(length <= MAX_LENGTH);
        Filled {
            length: length as u32,
            is_negative: is_negative && length != 0,
        }
    }
}
