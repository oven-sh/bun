//! The block in the making.

use bun_highway::deflate::{
    Bits, Frequencies, MAX_BATCH, MAX_OVERRUN, Sums, Token, count, log2, max_tokens, sum, write,
};
use core::mem::{replace, take};
use std::io::BorrowedCursor;

use super::codes::{FIXED, extra_bits, fixed_bits};
use super::scratch::Scratch;
use crate::Result;
use crate::format::{
    DYNAMIC, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, LITLEN_SYMBOLS, MAX_MATCH_LEN, RESERVED_SYMBOLS,
    STATIC, offset_slot_of,
};

#[derive(Default)]
pub struct Block {
    /// Those of the block, then the latest if they are for the next.
    pub(super) tokens: Vec<Token>,
    len: usize,
    /// Of the block, of short batches, and of the latest batch.
    frequencies: Vec<Frequencies>,
    /// If they are known.
    estimates: [Option<u32>; 2],
    is_counted: bool,
    /// The one before it.
    was_counted: bool,
    pub(super) was_fixed: bool,
}

/// About what the symbols of a block take, in 256ths of a bit.
#[derive(Clone, Copy, Default)]
pub(super) struct Estimate {
    pub(super) literals: u32,
    pub(super) high_bytes: u32,
    pub(super) matches: u32,
    pub(super) shortest_matches: u32,
    pub(super) literal_cost: u32,
    /// Without the extra bits.
    pub(super) match_cost: u32,
    header_cost: u32,
}

impl Estimate {
    pub(super) fn new(frequencies: &Frequencies) -> Self {
        let [literals, lengths, distances] = sum(frequencies);
        let cost = |sums: Sums, all| (sums.symbols * log2(all)).saturating_sub(sums.times_log);
        let either = literals.symbols + lengths.symbols;
        let different = literals.different + lengths.different + distances.different;
        Self {
            literals: literals.symbols,
            high_bytes: frequencies[128..256].iter().sum::<u16>().into(),
            matches: distances.symbols,
            shortest_matches: frequencies[FIRST_LENGTH_SYMBOL].into(),
            literal_cost: cost(literals, either),
            match_cost: cost(lengths, either) + cost(distances, distances.symbols),
            header_cost: 256 * (100 + 4 * different),
        }
    }

    fn cost(self) -> u32 {
        self.literal_cost + self.match_cost + self.header_cost
    }
}

/// So that no symbol is used 32768 times.
const MAX_TOKENS: usize = 16383;

impl Block {
    /// It is full with `len` tokens, each of which is a match or up to two literals. It is clear.
    pub fn try_reserve(&mut self, len: usize, max_input: usize) -> Result<()> {
        let capacity =
            len.min(max_input).min(MAX_TOKENS) + max_tokens(max_input.min(MAX_BATCH + MAX_OVERRUN));
        self.frequencies
            .try_reserve_exact(3 - self.frequencies.len())?;
        self.frequencies.resize(3, [0; _]);
        Ok(self.tokens.try_reserve_exact(capacity.min(MAX_TOKENS))?)
    }

    pub fn clear(&mut self) {
        self.was_fixed = false;
        self.start_empty();
    }

    fn start_empty(&mut self) {
        self.tokens.clear();
        self.len = 0;
        self.was_counted = take(&mut self.is_counted);
        self.estimates = [None; _];
    }

    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }

    /// For `len` more bytes of input.
    pub fn has_room(&self, len: u32) -> bool {
        max_tokens(len as usize) <= self.tokens.capacity().min(MAX_TOKENS) - self.tokens.len()
    }

    /// If it stands for `len` bytes.
    pub fn may_be_stored(&self, len: i64) -> bool {
        len < 3 * self.tokens.len() as i64
    }

    /// In front of what was parsed last.
    pub fn has_ended(&self) -> bool {
        self.len != self.tokens.len()
    }

    /// With the frequencies of this block, or of the one before.
    pub(super) fn room(&mut self) -> Option<(&mut Vec<Token>, &Frequencies)> {
        Some((&mut self.tokens, self.frequencies.first()?))
    }

    pub(super) fn add_longest_matches(&mut self, count: usize, distance: u32) -> Option<()> {
        let token = Token::for_match(MAX_MATCH_LEN as u32, distance);
        self.len += count;
        self.tokens.resize(self.len, token);
        self.estimates[0] = None;
        let frequencies = self.frequencies.first_mut()?;
        if !replace(&mut self.is_counted, true) {
            *frequencies = [0; _];
        }
        frequencies[LITLEN_SYMBOLS - RESERVED_SYMBOLS - 1] += count as u16;
        *frequencies.get_mut(LITLEN_SYMBOLS + offset_slot_of(distance as usize))? += count as u16;
        Some(())
    }

    /// Adds the block before, which was a short batch, to others like it. `None` if it has not been counted.
    pub(super) fn add_up(&mut self, is_first: bool) -> Option<&Frequencies> {
        let [latest, sums] = self.frequencies.first_chunk_mut()?;
        if !self.was_counted {
            return None;
        }
        for (sum, latest) in sums.iter_mut().zip(latest) {
            *sum = if is_first { 0 } else { *sum } + *latest;
        }
        Some(sums)
    }

    /// What has been added to an empty block, which is written next.
    pub(super) fn take_in_all(&mut self) {
        self.is_counted = false;
        self.len = self.tokens.len();
    }

    /// After tokens have been added. Returns the estimate for these.
    pub(super) fn take_in_or_end(&mut self) -> Option<Estimate> {
        let [frequencies, _, added] = self.frequencies.first_chunk_mut()?;
        count(self.tokens.get(self.len..)?, added);
        let latest = Estimate::new(added);
        if !replace(&mut self.is_counted, true) {
            *frequencies = *added;
            self.estimates[0] = Some(latest.cost());
        } else {
            let mut both = *frequencies;
            for (sum, added) in both.iter_mut().zip(&*added) {
                *sum += added;
            }
            let before = self.estimates[0].unwrap_or_else(|| Estimate::new(frequencies).cost());
            let together = Estimate::new(&both).cost();
            if self.len != 0 && before + latest.cost() < together {
                self.estimates[1] = Some(latest.cost());
                return Some(latest);
            }
            *frequencies = both;
            self.estimates[0] = Some(together);
        }
        self.len = self.tokens.len();
        Some(latest)
    }

    /// The shorter way to write it.
    pub fn plan<'a>(&mut self, only_fixed: bool, scratch: &'a mut Scratch) -> Plan<'a> {
        let Some(frequencies) = self.frequencies.first_mut() else {
            return Plan::default();
        };
        self.was_fixed = true;
        if !self.is_counted {
            if only_fixed || self.len < 32 {
                let (bits, dynamic) = (3 + FIXED.bits(&self.tokens) + 7, None);
                let middle = self.tokens.get(self.len / 2..);
                let is_uniform = matches!(middle, Some([a, b, c, ..]) if a == b && b == c);
                if only_fixed || bits < if is_uniform { 140 } else { 280 } {
                    return Plan { bits, dynamic };
                }
            }
            count(&self.tokens, frequencies);
            self.is_counted = true;
        }
        frequencies[END_OF_BLOCK] = 1;
        let extra_bits = 3 + extra_bits(frequencies);
        let fixed = Plan {
            bits: extra_bits + fixed_bits(frequencies),
            dynamic: None,
        };
        let may_header_pay = fixed.bits >= 2000
            || extra_bits + Estimate::new(frequencies).cost() / 256 + 16 <= fixed.bits;
        if only_fixed || !may_header_pay {
            return fixed;
        }
        let bits = extra_bits + scratch.dynamic.make(frequencies);
        if fixed.bits <= bits {
            return fixed;
        }
        self.was_fixed = false;
        Plan {
            bits,
            dynamic: Some(scratch),
        }
    }

    /// `false` if there is no room for it and 8 bytes more.
    pub fn write(
        &self,
        Plan { bits: len, dynamic }: Plan<'_>,
        is_last: bool,
        mut out: BorrowedCursor<'_, u8>,
        bits: &mut Bits,
    ) -> bool {
        if out.capacity() < (bits.count + len as usize) / 8 + 8 {
            return false;
        }
        let kind = if dynamic.is_some() { DYNAMIC } else { STATIC };
        bits.value |= u64::from(kind << 1 | u32::from(is_last)) << bits.count;
        bits.count += 3;
        let codes = match dynamic {
            None => &FIXED,
            Some(Scratch { dynamic, codes, .. }) => {
                out.append(dynamic.start_block(codes, bits));
                codes
            }
        };
        let tokens = self.tokens.get(..self.len).unwrap_or_default();
        write(tokens, codes, out, bits)
    }

    /// When it has been written.
    pub fn start_next(&mut self) {
        if !self.has_ended() {
            return self.start_empty();
        }
        self.tokens.drain(..self.len);
        self.len = self.tokens.len();
        self.frequencies.copy_within(2.., 0);
        self.estimates[0] = self.estimates[1].take();
    }
}

#[derive(Default)]
pub struct Plan<'a> {
    /// Of the whole block.
    pub bits: u32,
    dynamic: Option<&'a mut Scratch>,
}
