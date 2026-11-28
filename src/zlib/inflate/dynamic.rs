//! The codes that a dynamic block starts with.

use core::cell::Cell;

use bun_alloc::AllocError;
use bun_deflate::format::{
    END_OF_BLOCK, FIRST_LENGTH_SYMBOL, MAX_PRECODE_LEN, PRECODE_ORDER, PRECODE_SYMBOLS,
};
use bun_deflate::lanes::{Block, Lanes, Lengths};

use super::bits::BitReader;
use super::codes::Codes;
use super::tables::{Coded, FIXED, Tables};
use crate::error::{Damage, Error, Result};
use crate::format::{
    DISTANCE_SYMBOLS, LITERAL_LENGTH_SYMBOLS, REPEAT_FEW_ZEROS, REPEAT_MANY_ZEROS, REPEAT_PREVIOUS,
};

/// How many lengths there are of each code.
#[derive(Clone, Copy)]
pub(super) struct Counts {
    literal_lengths: u16,
    distances: u8,
    code_lengths: u8,
}

impl Counts {
    pub(super) const BITS: u32 = 5 + 5 + 4;

    pub(super) fn new(bits: u64) -> Result<Self, Damage> {
        let counts = Self {
            literal_lengths: FIRST_LENGTH_SYMBOL as u16 + bits as u16 % 32,
            distances: 1 + (bits >> 5) as u8 % 32,
            code_lengths: 4 + (bits >> 10) as u8 % 16,
        };
        if usize::from(counts.literal_lengths) > LITERAL_LENGTH_SYMBOLS
            || usize::from(counts.distances) > DISTANCE_SYMBOLS
        {
            return Err(Damage::TooManySymbols);
        }
        Ok(counts)
    }

    pub(super) fn code_length_bits(self) -> u32 {
        3 * u32::from(self.code_lengths)
    }
}

/// So long a code for the rarest symbol tells of a block for which better tables pay off.
const LONG_BLOCK_END_BITS: usize = 10;
/// A shorter one will do behind a long block, if there is input for another.
const NEXT_LONG_BLOCK_END_BITS: usize = 7;
const LONG_BLOCK_OUTPUT: usize = 8192;
const LONG_BLOCK_INPUT: usize = 1024;
const MIN_LANES_INPUT: usize = 256;

#[derive(Default)]
pub(super) struct DynamicCodes {
    tables: Option<Box<Tables>>,
    /// The lengths that have been read, but for the zeros.
    coded: Vec<Coded>,
    read: u16,
    last: u8,
    /// How many bytes have been decoded since tables were last built, if ever.
    decoded: Option<usize>,
    /// Only during a call.
    lanes: Lanes,
    block: Block,
    /// Of the block that the last call left off in.
    lengths: Option<Box<Lengths>>,
    is_in_lanes: bool,
}

std::thread_local! {
    /// From the last stream that was done with them.
    static SPARE: Cell<Option<(Box<Tables>, Vec<Coded>)>> = const { Cell::new(None) };
}

/// What this thread keeps for the next stream, up to 225 KiB with that of `bun_deflate`.
pub fn free_spare_memory() {
    _ = SPARE.try_with(Cell::take);
    bun_deflate::free_spare_memory();
}

impl Drop for DynamicCodes {
    #[inline]
    fn drop(&mut self) {
        self.free_memory();
    }
}

impl DynamicCodes {
    /// Outside of a dynamic block.
    #[inline]
    pub(super) fn free_memory(&mut self) {
        self.lengths = None;
        self.free_tables();
    }

    #[inline]
    fn free_tables(&mut self) {
        // It is allocated first.
        if self.coded.capacity() != 0 {
            let memory = self
                .tables
                .take()
                .zip(Some(core::mem::take(&mut self.coded)));
            _ = SPARE.try_with(|spare| spare.set(memory));
        }
    }

    /// For this block and the next.
    pub(super) fn avoid_lanes(&mut self) {
        self.block.give_up(2);
    }

    /// What is left in this call.
    #[inline]
    pub(super) fn set_room(&mut self, room: usize) {
        self.block.set_room(room);
    }

    #[inline]
    pub(super) fn takes_turns(&self) -> bool {
        self.block.takes_turns()
    }

    #[inline]
    pub(super) fn end_call(&mut self, read: usize) {
        self.block.advance(read);
        self.lanes = Lanes::default();
    }

    /// At the end of a call, in a block.
    #[inline]
    pub(super) fn pause(&mut self, fixed: bool) -> Result<()> {
        if self.is_in_lanes
            && !fixed
            && let Some(lengths) = self.lanes.lengths(&self.block)
        {
            match &mut self.lengths {
                Some(kept) => **kept = *lengths,
                None => self.lengths = Some(Box::try_new(*lengths).map_err(|_| AllocError)?),
            }
            self.free_tables();
        }
        Ok(())
    }

    /// `input_len` bytes are there to be decoded.
    #[inline(always)]
    pub(super) fn codes(&mut self, fixed: bool, input_len: usize) -> Result<Codes<'_>> {
        if self.is_in_lanes && self.stay_in_lanes(fixed, input_len)? {
            return Ok(Codes::Lanes(&mut self.lanes, &mut self.block));
        }
        let tables = if fixed {
            Some(&FIXED)
        } else {
            self.tables.as_deref()
        };
        tables.map(Codes::Tables).ok_or(Error::Internal)
    }

    fn stay_in_lanes(&mut self, fixed: bool, input_len: usize) -> Result<bool> {
        let lengths = self.lengths.as_deref().filter(|_| !fixed);
        let stays =
            !self.block.is_given_up() && self.lanes.resume(&mut self.block, lengths, input_len);
        if !stays && !fixed {
            self.build_tables_late(input_len)?;
        }
        self.is_in_lanes = stays;
        Ok(stays)
    }

    #[cold]
    fn build_tables_late(&mut self, input_len: usize) -> Result<()> {
        self.allocate()?;
        let lengths = self.lanes.lengths(&self.block).or(self.lengths.as_deref());
        let lengths = lengths.ok_or(Error::Internal)?;
        let counts = Counts {
            literal_lengths: lengths.litlens,
            distances: lengths.distances,
            code_lengths: 0,
        };
        let all = (0..lengths.litlens + u16::from(lengths.distances)).zip(lengths.all);
        self.coded.clear();
        let coded = all.filter(|&(_, bits)| bits != 0);
        self.coded
            .extend(coded.map(|(symbol, bits)| Coded::new(symbol, bits)));
        self.lengths = None;
        self.build_tables(counts, input_len)
    }

    #[inline(always)]
    pub(super) fn start_fixed(&mut self) {
        self.is_in_lanes = false;
    }

    /// Whether it goes on in lanes. See `Lanes::start_static()`.
    #[inline(always)]
    pub(super) fn continue_fixed(&mut self, is_last: bool, sample: [usize; 3]) -> bool {
        self.is_in_lanes =
            self.is_in_lanes || self.lanes.start_static(&mut self.block, is_last, sample);
        self.is_in_lanes
    }

    /// Takes all of the header or nothing.
    #[inline(always)]
    pub(super) fn start_in_lanes(&mut self, bits: &mut BitReader<'_>) -> bool {
        self.is_in_lanes = false;
        if bits.rest.len() >= MIN_LANES_INPUT
            && let Some(end) =
                self.lanes
                    .start_dynamic(&mut self.block, bits.input, bits.position())
        {
            bits.seek(end);
            self.is_in_lanes = true;
        }
        self.is_in_lanes
    }

    pub(super) fn likely_output_len(&mut self, input_len: usize) -> usize {
        self.lanes.likely_output_len(input_len)
    }

    fn allocate(&mut self) -> Result<()> {
        if self.tables.is_none() {
            if let Ok(Some((tables, coded))) = SPARE.try_with(Cell::take) {
                (self.tables, self.coded) = (Some(tables), coded);
                return Ok(());
            }
            self.coded
                .try_reserve_exact(LITERAL_LENGTH_SYMBOLS + DISTANCE_SYMBOLS)?;
            self.tables = Some(Box::try_new(Tables::EMPTY).map_err(|_| AllocError)?);
        }
        Ok(())
    }

    pub(super) fn add_decoded(&mut self, len: usize) {
        self.decoded = self.decoded.map(|decoded| decoded.saturating_add(len));
    }

    /// `lengths` has three bits for each code length symbol, in the order of the stream.
    pub(super) fn start(&mut self, lengths: u64) -> Result<()> {
        #[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
        const SHIFTS: [u8; PRECODE_SYMBOLS] = {
            let mut shifts = [0; _];
            let mut rank = 0;
            while rank < PRECODE_SYMBOLS {
                shifts[PRECODE_ORDER[rank] as usize] = 3 * rank as u8;
                rank += 1;
            }
            shifts
        };
        self.lengths = None;
        self.allocate()?;
        let tables = self.tables.as_deref_mut().ok_or(Error::Internal)?;
        self.coded.clear();
        for (symbol, shift) in (0..).zip(SHIFTS) {
            let bits = (lengths >> shift) as u8 % 8;
            if bits != 0 {
                self.coded.push(Coded::new(symbol, bits));
            }
        }
        let is_valid = tables.build_code_length(&self.coded);
        self.coded.clear();
        (self.read, self.last) = (0, 0);
        Ok(is_valid.then_some(()).ok_or(Damage::CodeLengthsSet)?)
    }

    /// Whether all have been read.
    pub(super) fn read_lengths(
        &mut self,
        bits: &mut BitReader<'_>,
        counts: Counts,
    ) -> Result<bool> {
        const MAX_BITS: u32 = MAX_PRECODE_LEN + REPEAT_MANY_ZEROS.extra_bits;
        let tables = self.tables.as_deref().ok_or(Error::Internal)?;
        let total = counts.literal_lengths + u16::from(counts.distances);
        let (mut read, mut last) = (self.read, self.last);
        while read < total {
            if bits.count < MAX_BITS {
                bits.refill();
            }
            let entry = tables.code_length(bits.buffer);
            let symbol = entry.first_literal();
            if symbol < REPEAT_PREVIOUS.symbol {
                if entry.bits() > bits.count {
                    break;
                }
                bits.skip(entry.bits());
                if symbol != 0 {
                    self.coded.push(Coded::new(read, symbol));
                }
                (read, last) = (read + 1, symbol);
                continue;
            }
            let repeat = match symbol - REPEAT_PREVIOUS.symbol {
                0 => REPEAT_PREVIOUS,
                1 => REPEAT_FEW_ZEROS,
                _ => REPEAT_MANY_ZEROS,
            };
            if entry.bits() + repeat.extra_bits > bits.count {
                break;
            }
            bits.skip(entry.bits());
            let end = read + (repeat.min + bits.peek(repeat.extra_bits) as u32) as u16;
            bits.skip(repeat.extra_bits);
            let repeats_previous = symbol == REPEAT_PREVIOUS.symbol;
            if (repeats_previous && read == 0) || end > total {
                return Err(Damage::BitLengthRepeat.into());
            }
            if !repeats_previous {
                last = 0;
            } else if last != 0 {
                self.coded
                    .extend((read..end).map(|symbol| Coded::new(symbol, last)));
            }
            read = end;
        }
        (self.read, self.last) = (read, last);
        Ok(read == total)
    }

    /// `input_len` bytes are there to be decoded.
    pub(super) fn build_tables(&mut self, counts: Counts, input_len: usize) -> Result<()> {
        let tables = self.tables.as_deref_mut().ok_or(Error::Internal)?;
        let below = |symbol: u16| self.coded.partition_point(|it| it.symbol() < symbol);
        let end_of_block = self.coded.get(below(END_OF_BLOCK as u16));
        let end_of_block = end_of_block
            .filter(|it| usize::from(it.symbol()) == END_OF_BLOCK)
            .ok_or(Damage::MissingEndOfBlock)?;
        let (literal_lengths, distances) = self.coded.split_at(below(counts.literal_lengths));
        let was_long = self
            .decoded
            .replace(0)
            .is_none_or(|it| it >= LONG_BLOCK_OUTPUT);
        let long_end_bits = if was_long && input_len >= LONG_BLOCK_INPUT {
            NEXT_LONG_BLOCK_END_BITS
        } else {
            LONG_BLOCK_END_BITS
        };
        let is_long = end_of_block.bits() >= long_end_bits;
        if !tables.build_literal_length(literal_lengths, is_long) {
            return Err(Damage::LiteralLengthsSet.into());
        }
        if !tables.build_distance(distances, counts.literal_lengths) {
            return Err(Damage::DistancesSet.into());
        }
        Ok(())
    }
}
