//! A long text is cut in halves, and those again, down to pieces of a few chunks.

use crate::digits::{self, low_zero_count, multiply_assign_digit, trim};
use crate::{Error, Scratch, Work};

#[derive(Clone, Copy)]
pub(super) struct Halving {
    pub(super) levels: u32,
    /// The chunks in a piece. No more digits than that hold its value.
    pub(super) piece_length: usize,
}

impl Halving {
    pub(super) fn new(chunks: usize, max_piece_length: usize) -> Halving {
        let levels = chunks
            .div_ceil(max_piece_length)
            .next_power_of_two()
            .ilog2();
        Halving {
            levels,
            piece_length: chunks.div_ceil(1 << levels),
        }
    }

    /// Of all pieces.
    pub(super) fn length(self) -> usize {
        self.piece_length << self.levels
    }

    /// What one in the high half is worth, from the last level to the first.
    pub(super) fn powers<'a, const N: usize>(
        self,
        chunk_power: u64,
        scratch: &'a mut Scratch<u64, N>,
        work: &mut Work<'_>,
    ) -> Result<impl DoubleEndedIterator<Item = Power<'a>> + use<'a, N>, Error> {
        let (first, mut free) = scratch
            .filled(0, self.length(), work)?
            .split_at_mut(self.piece_length);
        first[0] = chunk_power;
        for length in 1..first.len() {
            first[length] = multiply_assign_digit(&mut first[..length], chunk_power, 0);
        }
        let mut powers = [Power::new(first, 0, self.piece_length); MAX_LEVELS];
        for level in 1..self.levels as usize {
            let previous = powers[level - 1];
            let square;
            (square, free) = free.split_at_mut(2 * previous.digits.len());
            digits::multiply(square, previous.digits, previous.digits, work)?;
            powers[level] = Power::new(square, 2 * previous.zeros, 2 * previous.half);
        }
        Ok(powers.into_iter().take(self.levels as usize))
    }
}

const MAX_LEVELS: usize = 24;

/// `digits * 2^(64 * zeros)`
#[derive(Clone, Copy)]
pub(super) struct Power<'a> {
    pub(super) digits: &'a [u64],
    pub(super) zeros: usize,
    /// The length of the halves that it is for.
    pub(super) half: usize,
}

impl<'a> Power<'a> {
    fn new(digits: &'a [u64], zeros: usize, half: usize) -> Power<'a> {
        let more_zeros = low_zero_count(digits);
        Power {
            digits: trim(&digits[more_zeros..]),
            zeros: zeros + more_zeros,
            half,
        }
    }
}
