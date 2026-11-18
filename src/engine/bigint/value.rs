use crate::{Error, MAX_LENGTH, digits};

/// A borrowed integer: a sign and a magnitude, least significant digit first.
#[derive(Clone, Copy, Debug)]
pub struct BigIntRef<'a> {
    pub(crate) is_negative: bool,
    pub(crate) digits: &'a [u64],
}

impl<'a> BigIntRef<'a> {
    /// `digits` are at most [`MAX_LENGTH`] and have no leading zero. Zero has none and is not negative.
    #[inline(always)]
    pub fn new(is_negative: bool, digits: &'a [u64]) -> BigIntRef<'a> {
        debug_assert!(digits.len() <= MAX_LENGTH);
        debug_assert!(digits.last().map_or(!is_negative, |&top| top != 0));
        BigIntRef {
            is_negative,
            digits,
        }
    }

    /// For digits that come from outside the engine.
    pub fn from_words(is_negative: bool, words: &'a [u64]) -> Result<BigIntRef<'a>, Error> {
        let digits = digits::trim(words);
        if digits.len() > MAX_LENGTH {
            return Err(Error::TooBig);
        }
        Ok(BigIntRef::new(is_negative && !digits.is_empty(), digits))
    }

    #[inline(always)]
    pub fn is_negative(self) -> bool {
        self.is_negative
    }

    #[inline(always)]
    pub fn is_zero(self) -> bool {
        self.digits.is_empty()
    }

    #[inline(always)]
    pub fn digits(self) -> &'a [u64] {
        self.digits
    }
}

/// An integer of at most two digits.
#[derive(Clone, Copy, Debug)]
pub struct SmallBigInt {
    digits: [u64; 2],
    /// Does not count for zero.
    has_minus: bool,
}

impl SmallBigInt {
    pub const ZERO: SmallBigInt = SmallBigInt::new(false, 0);

    /// Zero drops the sign.
    #[inline(always)]
    pub const fn new(is_negative: bool, magnitude: u128) -> SmallBigInt {
        SmallBigInt {
            digits: [magnitude as u64, (magnitude >> 64) as u64],
            has_minus: is_negative,
        }
    }

    #[inline(always)]
    pub fn is_negative(self) -> bool {
        self.has_minus && !self.is_zero()
    }

    #[inline(always)]
    pub fn is_zero(self) -> bool {
        self.digits[0] | self.digits[1] == 0
    }

    /// How many of [`padded_digits`](Self::padded_digits) count.
    #[inline(always)]
    pub fn length(self) -> usize {
        if self.digits[1] != 0 {
            2
        } else {
            usize::from(self.digits[0] != 0)
        }
    }

    #[inline(always)]
    pub fn padded_digits(self) -> [u64; 2] {
        self.digits
    }

    #[inline(always)]
    pub fn as_ref(&self) -> BigIntRef<'_> {
        BigIntRef::new(self.is_negative(), &self.digits[..self.length()])
    }
}

macro_rules! from_integers {
    ($($unsigned:ty),* ; $($signed:ty),*) => {
        $(impl From<$unsigned> for SmallBigInt {
            #[inline(always)]
            fn from(value: $unsigned) -> SmallBigInt {
                SmallBigInt::new(false, u128::from(value))
            }
        })*
        $(impl From<$signed> for SmallBigInt {
            #[inline(always)]
            fn from(value: $signed) -> SmallBigInt {
                SmallBigInt::new(value < 0, u128::from(value.unsigned_abs()))
            }
        })*
    };
}

from_integers!(bool, u32, u64, u128; i32, i64, i128);
