use crate::work::try_with_capacity;
use crate::{BigIntRef, Error, Fill, New, Outcome, Poll};

/// An integer that owns its digits, for code that has no heap to put them in.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct BigInt {
    is_negative: bool,
    digits: Vec<u64>,
}

impl BigInt {
    pub fn copy_of(value: BigIntRef<'_>) -> Result<BigInt, Error> {
        let mut digits = try_with_capacity(value.digits.len())?;
        digits.extend_from_slice(value.digits);
        Ok(BigInt {
            is_negative: value.is_negative,
            digits,
        })
    }

    #[inline]
    pub fn as_ref(&self) -> BigIntRef<'_> {
        BigIntRef::new(self.is_negative, &self.digits)
    }
}

impl<F: Fill> New<F> {
    pub fn into_owned(self, poll: Poll<'_>) -> Result<BigInt, Error> {
        match self {
            New::Small(value) => BigInt::copy_of(value.as_ref()),
            New::Large(fill) => {
                let mut digits = try_with_capacity(fill.digit_count())?;
                digits.resize(fill.digit_count(), u64::MAX / 3);
                let filled = fill.fill(&mut digits, poll)?;
                digits.truncate(filled.length as usize);
                Ok(BigInt {
                    is_negative: filled.is_negative,
                    digits,
                })
            }
        }
    }
}

impl<F: Fill> Outcome<F> {
    /// `first` and `second` are the operands that this came from.
    pub fn into_owned(
        self,
        first: BigIntRef<'_>,
        second: BigIntRef<'_>,
        poll: Poll<'_>,
    ) -> Result<BigInt, Error> {
        match self {
            Outcome::First => BigInt::copy_of(first),
            Outcome::Second => BigInt::copy_of(second),
            Outcome::New(new) => new.into_owned(poll),
        }
    }
}
