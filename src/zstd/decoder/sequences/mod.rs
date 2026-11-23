//! The sequences section of a compressed block.

mod copies;
mod reader;
mod tables;

use core::hint::cold_path;

use bun_highway::with_bmi2;

use crate::array::At;
use crate::bits::{BackwardBits, Width};
use crate::bounded::Bounded;
use crate::destination::{Destination, Loan, OVERSHOOT};
use crate::error::{Error, Result};
use crate::literals::LITERALS_PADDING;
use copies::{Buffers, LOAN_MAX, REPEATS, Slot, repeat_offset};
use reader::{Reader, Sequence};
use tables::LENGTH_ROWS;

pub(crate) use tables::{PREDEFINED_TABLES, SequenceTables};

const AHEAD_MAX: usize = 8;
/// One more is read before the first turns out to need care, and then the last of the block.
const PENDING_MAX: usize = AHEAD_MAX + 2;
const BATCH: usize = 64;
/// The slots for them are only cleared once.
const FEW_SEQUENCES: usize = 28;

/// Matches that are no further back are likely to be in some cache.
const CACHED_LEN: u64 = 16 << 20;

/// What lasts longer than a block.
#[derive(Default)]
pub(crate) struct SequenceState {
    pub(crate) repeat_offsets: [u32; REPEATS],
    few_slots: Option<[Slot; REPEATS + FEW_SEQUENCES + 1]>,
}

struct Queue<'a> {
    slots: &'a mut [Slot],
    /// From where it goes back to the first slot.
    batch: usize,
    /// Where the [`REPEATS`] slots before the next to run start.
    start: usize,
    /// Read and yet to run.
    pending: usize,
    /// Less than the padding may follow them.
    literal_count: usize,
}

/// Reads a sequence and runs the one `AHEAD` before it, which hides wrong guesses and far loads, until either needs care.
#[inline(always)]
fn read_and_run<const AHEAD: usize>(
    reader: &mut Reader<'_>,
    queue: &mut Queue<'_>,
    literals: &[u8],
    detached: &[u8],
    out: &mut [u8],
) -> Result<()> {
    const { assert!(1 <= AHEAD && AHEAD <= AHEAD_MAX) };
    let buffers = Buffers::new(literals, detached, out);
    let mut buffers = buffers.ok_or(Error::Internal)?;
    debug_assert!(reader.are_tables_together);
    let (tables, src) = ([reader.tables[0]; 3], reader.bits.src);
    let mut states = reader.states;
    let mut position = reader.bits.position as u32;
    let mut container = reader.bits.container;
    let mut spare_bits = reader.bits.available.minus(states.total_bits(tables));
    let mut read_position = if AHEAD > 1 { queue.end_position()? } else { 0 };

    while spare_bits >= 0 && queue.pending == AHEAD {
        queue.rewind_if_through()?;
        let count = reader
            .quick_count(position as usize)
            .min(queue.batch.minus(queue.start));
        if count == 0 {
            break;
        }
        let slots = queue.slots.get_mut(queue.start..);
        let slots = slots.and_then(|slots| slots.get_mut(..count.plus(REPEATS + AHEAD)));
        let mut slots = slots.ok_or(Error::Internal)?;
        let first_address = slots.as_ptr().addr();

        while let [third, second, first, current, later @ ..] = slots
            && let Some(later) = later.first_chunk_mut::<AHEAD>()
        {
            let (literal_row, offset_row, match_row) = states.rows(tables);
            let mut bits = container.wrapping_shr(spare_bits as u32);
            let mut last = |width: Width| {
                let value = bits & !(u64::MAX << width as u32);
                bits >>= width as u32;
                value
            };
            states.offset = (offset_row
                .next
                .wrapping_add(last(offset_row.state_bits) as u8))
            .into();
            states.match_len =
                (usize::from(match_row.next) + last(match_row.state_bits) as usize) % LENGTH_ROWS;
            states.literal_len = (usize::from(literal_row.next)
                + last(literal_row.state_bits) as usize)
                % LENGTH_ROWS;
            let used_bytes = (spare_bits as u32 ^ 63) / 8;
            spare_bits =
                (spare_bits | BackwardBits::IN_REFILL as isize) - states.total_bits(tables);
            let read = later.at_mut(AHEAD - 1);
            read.literal_len = (literal_row.base).wrapping_add(last(literal_row.extra_bits) as u16);
            read.match_len = (match_row.base).wrapping_add(last(match_row.extra_bits) as u16);
            read.offset = (offset_row.base as u32).wrapping_add(last(offset_row.extra_bits) as u32);
            if AHEAD > 1 {
                read_position = read_position.wrapping_add(read.literal_len.into());
                buffers.prefetch(read_position, read.offset);
                read_position = read_position.wrapping_add(read.match_len.into());
            }
            position = position.wrapping_sub(used_bytes);
            let refill = src.get(position as usize..position as usize + 8);
            let Some(refill) = refill.and_then(<[u8]>::as_array) else {
                cold_path();
                return Err(Error::CorruptionDetected);
            };
            container = u64::from_le_bytes(*refill);
            // Here, or the compiler moves what leads up to it behind the copies.
            if spare_bits < 0 {
                cold_path();
                break;
            }

            let Some(()) = buffers.run([third, second, first], current, later.at_mut(0)) else {
                break;
            };
            slots = slots.get_mut(1..).unwrap_or_default();
        }

        let done = slots.as_ptr().addr().minus(first_address) / size_of::<Slot>();
        let is_ahead = usize::from(done < count);
        queue.start = queue.start.plus(done);
        queue.pending = queue.pending.plus(is_ahead);
        reader.left = reader.left.minus(done + is_ahead);
    }

    reader.states = states;
    reader.bits.position = position as usize;
    reader.bits.container = container;
    reader.bits.available = spare_bits.plus(states.total_bits(tables));
    Ok(())
}

impl Queue<'_> {
    /// For the first sequence of the block.
    #[inline(always)]
    fn reset(
        &mut self,
        repeat_offsets: [u32; REPEATS],
        literal_count: usize,
        destination: &Destination<'_, '_>,
    ) -> Result<()> {
        let [third, second, first, next] = self.slots.first_chunk_mut().ok_or(Error::Internal)?;
        [first.offset, second.offset, third.offset] = repeat_offsets;
        (next.position, next.literal_position) = (destination.position() as u32, 0);
        (self.start, self.pending, self.literal_count) = (0, 0, literal_count);
        Ok(())
    }

    #[inline(always)]
    fn rewind_if_through(&mut self) -> Result<()> {
        if self.start < self.batch {
            return Ok(());
        }
        let kept = self.slots.get(self.start..).and_then(<[Slot]>::first_chunk);
        let kept: [Slot; REPEATS + PENDING_MAX] = *kept.ok_or(Error::Internal)?;
        *self.slots.first_chunk_mut().ok_or(Error::Internal)? = kept;
        self.start = 0;
        Ok(())
    }

    fn next(&self) -> Result<&Slot> {
        self.slots.get(self.start + REPEATS).ok_or(Error::Internal)
    }

    /// Where the output is once all that are pending have run.
    #[inline(always)]
    fn end_position(&self) -> Result<u32> {
        let pending = self
            .slots
            .iter()
            .skip(self.start + REPEATS)
            .take(self.pending);
        let lens = pending.map(|it| u32::from(it.literal_len) + u32::from(it.match_len));
        Ok((self.next()?.position).wrapping_add(lens.fold(0, u32::plus)))
    }

    /// Puts the next sequence in a slot, or in `large` if it does not fit.
    #[inline(always)]
    fn read(&mut self, reader: &mut Reader<'_>, large: &mut Option<Sequence>) -> Result<()> {
        let sequence = reader.next();
        let lens = (
            sequence.literal_len.try_into(),
            sequence.match_len.try_into(),
        );
        let ((Ok(literal_len), Ok(match_len)), -2..) = (lens, sequence.offset as i32) else {
            *large = Some(sequence);
            return Ok(());
        };
        self.rewind_if_through()?;
        let slot = self.slots.get_mut(self.start + REPEATS + self.pending);
        let slot = slot.ok_or(Error::Internal)?;
        (slot.offset, slot.literal_len, slot.match_len) = (sequence.offset, literal_len, match_len);
        self.pending += 1;
        Ok(())
    }

    /// Returns whether it got to where `kept` are left before one needed care.
    #[inline(never)]
    fn run_pending_quickly(
        &mut self,
        kept: usize,
        literals: &[u8],
        detached: &[u8],
        out: &mut [u8],
    ) -> bool {
        let Some(mut buffers) = Buffers::new(literals, detached, out) else {
            return false;
        };
        let mut slots = self.slots.get_mut(self.start..).unwrap_or_default();
        let mut pending = self.pending;
        while pending > kept
            && let [third, second, first, current, following, ..] = slots
            // An earlier attempt may have left an offset of 32 bits.
            && current.offset as i32 >= -2
            && let Some(()) = buffers.run([third, second, first], current, following)
        {
            slots = slots.get_mut(1..).unwrap_or_default();
            pending -= 1;
        }
        self.start += self.pending - pending;
        self.pending = pending;
        pending <= kept
    }

    fn run_pending_carefully(
        &mut self,
        literals: &[u8],
        destination: &mut Destination<'_, '_>,
    ) -> Result<()> {
        let slot = self.next()?;
        let sequence = Sequence {
            literal_len: slot.literal_len.into(),
            match_len: slot.match_len.into(),
            offset: slot.offset,
        };
        self.pending -= 1;
        self.run_carefully(&sequence, literals, destination)
    }

    /// In the place of the next slot.
    fn run_carefully(
        &mut self,
        sequence: &Sequence,
        literals: &[u8],
        destination: &mut Destination<'_, '_>,
    ) -> Result<()> {
        self.rewind_if_through()?;
        let slots = self
            .slots
            .get_mut(self.start..)
            .and_then(<[Slot]>::first_chunk_mut);
        let [third, second, first, current, following] = slots.ok_or(Error::Internal)?;
        let (literal_len, match_len) = (sequence.literal_len as usize, sequence.match_len as usize);
        let (start, literal_start) = (current.position as usize, current.literal_position as usize);
        let end = start + literal_len + match_len;
        destination.check_block_len(end - destination.position())?;
        if literal_start + literal_len > self.literal_count {
            return Err(Error::CorruptionDetected);
        }
        current.offset = match sequence.offset as i32 {
            code @ -2..=0 => repeat_offset(code, literal_len, [third, second, first])
                .ok_or(Error::CorruptionDetected)?,
            _ => sequence.offset,
        };
        let literals = literals.get(literal_start..literal_start + literal_len);
        let (len, offset) = (start - destination.position(), current.offset as usize);
        destination.write(len, literals.ok_or(Error::Internal)?, offset, match_len)?;
        following.position = end as u32;
        following.literal_position = (literal_start + literal_len) as u32;
        self.start += 1;
        Ok(())
    }

    /// Returns whether `literals` lack padding, and the last as many are all that is left. They count from 0 then.
    fn move_to_last_literals(&mut self, literals: &[u8]) -> Result<bool> {
        let lacks_padding = literals.len() < self.literal_count + LITERALS_PADDING;
        let before = self.literal_count.wrapping_sub(LITERALS_PADDING) as u32;
        let next = (self.slots.get_mut(self.start + REPEATS)).ok_or(Error::Internal)?;
        let can_move = lacks_padding && next.literal_position >= before;
        if can_move {
            next.literal_position -= before;
            self.literal_count = LITERALS_PADDING;
        }
        Ok(can_move)
    }

    /// For when the output cannot take the overshoot any more.
    fn run_rest_carefully(
        &mut self,
        reader: &mut Reader<'_>,
        large: Option<Sequence>,
        literals: &[u8],
        destination: &mut Destination<'_, '_>,
    ) -> Result<()> {
        while self.pending != 0 {
            self.run_pending_carefully(literals, destination)?;
        }
        if let Some(large) = large {
            self.run_carefully(&large, literals, destination)?;
        }
        while reader.left != 0 {
            self.run_carefully(&reader.next(), literals, destination)?;
        }
        Ok(())
    }

    /// That does not depend on how far ahead the reader was. It has zeros in front of the stream.
    #[cold]
    fn find_first_error(
        &mut self,
        tables: [&SequenceTables; 3],
        stream: &[u8],
        count: usize,
        literals: &[u8],
        destination: &mut Destination<'_, '_>,
    ) -> Result<()> {
        let (bits, mut padded_start) = (BackwardBits::new(stream, 0)?, [0; _]);
        bits.pad_start(&mut padded_start);
        let mut reader = Reader::new(tables, bits, &padded_start, count);
        while reader.left != 0 && reader.bits.left() >= 0 {
            reader.move_to_padded_start();
            self.run_carefully(&reader.next(), literals, destination)?;
        }
        Ok(())
    }

    fn run_all<const AHEAD: usize>(
        &mut self,
        reader: &mut Reader<'_>,
        [mut literals, last_literals]: [&[u8]; 2],
        destination: &mut Destination<'_, '_>,
    ) -> Result<()> {
        /// For as much, `memcpy()` is quicker, and needs no room that was cleared.
        const LONG_LEN: usize = 2 << 10;

        let (block_len, position) = (reader.bits.src.len(), destination.position());
        // Too large for a slot. It waits for those that are pending.
        let mut large = None;
        // Where the last long one ends. More may follow, which need no loan.
        let mut long_end = 0;
        loop {
            reader.move_to_padded_start();
            let is_quick = loop {
                let is_quick = self.pending >= AHEAD && large.is_none() && reader.is_quick();
                if is_quick || large.is_some() || reader.left == 0 || self.pending == PENDING_MAX {
                    break is_quick;
                }
                self.read(reader, &mut large)?;
            };
            if self.pending == 0 {
                let Some(large) = large.take() else {
                    return Ok(());
                };
                self.run_carefully(&large, literals, destination)?;
                long_end = self.next()?.position as usize - position;
                continue;
            }
            let next = self.next()?;
            let next_len = usize::from(next.literal_len) + usize::from(next.match_len);
            let len = next.position as usize - position + next_len;
            let literal_end = next.literal_position as usize + usize::from(next.literal_len);
            if next_len >= LONG_LEN {
                self.run_pending_carefully(literals, destination)?;
                long_end = len;
                continue;
            }
            if literal_end + LITERALS_PADDING > literals.len() {
                if self.move_to_last_literals(literals)? {
                    literals = last_literals;
                } else {
                    self.run_pending_carefully(literals, destination)?;
                }
                continue;
            }
            let Loan { detached, out } =
                destination.lend(len, LOAN_MAX.min(len - long_end + 4 * block_len))?;

            if position + len + OVERSHOOT > out.len() {
                if !destination.grows() {
                    return self.run_rest_carefully(reader, large, literals, destination);
                }
                self.run_pending_carefully(literals, destination)?;
                continue;
            }

            let kept = if is_quick { AHEAD } else { 0 };
            if self.pending > kept && !self.run_pending_quickly(kept, literals, detached, out) {
                self.run_pending_carefully(literals, destination)?;
            } else if is_quick {
                let left = reader.left;
                with_bmi2(
                    #[inline(always)]
                    || read_and_run::<AHEAD>(reader, self, literals, detached, out),
                )?;
                debug_assert!(reader.left < left);
                if reader.left == 1 {
                    self.read(reader, &mut large)?;
                    self.run_pending_quickly(0, literals, detached, out);
                }
            }
        }
    }
}

/// Runs the `count` sequences in `src[start..]`. Returns how many bytes they wrote, and how many literals they took.
pub(crate) fn run_sequences(
    tables: [&SequenceTables; 3],
    src: &[u8],
    start: usize,
    count: usize,
    (literals, literal_count): (&[u8], usize),
    state: &mut SequenceState,
    destination: &mut Destination<'_, '_>,
) -> Result<(usize, usize)> {
    let bits = BackwardBits::new(src, start)?;
    let mut padded_start = [0; _];
    if !bits.is_padded() {
        bits.pad_start(&mut padded_start);
    }
    let mut reader = Reader::new(tables, bits, &padded_start, count);
    let mut many_slots;
    let (slots, batch): (&mut [Slot], _) = if count <= FEW_SEQUENCES {
        let few_slots = (state.few_slots).get_or_insert_with(|| [Slot::default(); _]);
        (few_slots, count + 1)
    } else {
        many_slots = [Slot::default(); BATCH + 2 * PENDING_MAX + REPEATS];
        (&mut many_slots, BATCH)
    };
    let mut queue = Queue {
        slots,
        batch,
        start: 0,
        pending: 0,
        literal_count: 0,
    };
    queue.reset(state.repeat_offsets, literal_count, destination)?;

    debug_assert!(literals.len() <= literal_count + LITERALS_PADDING);
    let mut last_literals = [[0; LITERALS_PADDING]; 2];
    if literals.len() < literal_count + LITERALS_PADDING {
        let last = literals.get(..literal_count).and_then(<[u8]>::last_chunk);
        last_literals[0] = *last.ok_or(Error::Internal)?;
    }
    let both = [literals, last_literals.as_flattened()];

    let result =
        if count > BATCH && destination.reach() > CACHED_LEN && tables[1].has_many_far_offsets() {
            queue.run_all::<AHEAD_MAX>(&mut reader, both, destination)
        } else {
            queue.run_all::<1>(&mut reader, both, destination)
        };
    match result {
        Ok(()) if reader.bits.left() == 0 => {}
        Ok(()) if reader.bits.left() > 0 => return Err(Error::CorruptionDetected),
        Ok(()) | Err(Error::CorruptionDetected | Error::DstSizeTooSmall) => {
            let stream = src.get(start..).ok_or(Error::Internal)?;
            queue.reset(state.repeat_offsets, literal_count, destination)?;
            queue.find_first_error(tables, stream, count, literals, destination)?;
            return Err(Error::CorruptionDetected);
        }
        Err(error) => return Err(error),
    }
    let slots = queue
        .slots
        .get(queue.start..)
        .and_then(<[Slot]>::first_chunk);
    let [third, second, first, next] = slots.ok_or(Error::Internal)?;
    state.repeat_offsets = [first.offset, second.offset, third.offset];
    Ok((
        next.position as usize - destination.position(),
        next.literal_position as usize + (literal_count - queue.literal_count),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::Header;
    use crate::output::Output;

    #[test]
    fn an_offset_is_repeated_once_however_often_it_is_tried() -> Result<()> {
        let Header::Frame(frame) = Header::read(b"\x28\xb5\x2f\xfd\x00\x00")? else {
            return Err(Error::Internal);
        };
        let mut room = [0; 64];
        for first in [100, i32::MAX as u32, 1 << 31, u32::MAX - 3] {
            let slot = |offset| Slot {
                offset,
                literal_len: 1,
                match_len: 3,
                ..Slot::default()
            };
            let mut slots = [7, first, 5, -1i32 as u32, 0].map(slot);
            let mut queue = Queue {
                slots: &mut slots,
                batch: 2,
                start: 0,
                pending: 1,
                literal_count: 1,
            };
            for _ in 0..2 {
                assert!(!queue.run_pending_quickly(0, &[0; 33], &[], &mut room));
            }
            let mut out = Output::slice(&mut room);
            let mut destination = Destination::new(&mut out, &frame, 0, &[], 64);
            let result = queue.run_pending_carefully(&[0; 33], &mut destination);
            assert_eq!(result, Err(Error::CorruptionDetected));
            assert_eq!(slots.map(|it| it.offset), [7, 7, 5, first, 0]);
        }
        Ok(())
    }

    #[test]
    fn the_last_literals_get_padding() -> Result<()> {
        let Header::Frame(frame) = Header::read(b"\x28\xb5\x2f\xfd\x00\x00")? else {
            return Err(Error::Internal);
        };
        let mut room = [0; 64];
        let mut out = Output::resume_slice(&mut room, 8);
        let mut destination = Destination::new(&mut out, &frame, 8, &[], 56);
        let mut slots = [Slot::default(); 8];
        let mut queue = Queue {
            slots: &mut slots,
            batch: 3,
            start: 0,
            pending: 0,
            literal_count: 0,
        };
        queue.reset([1, 4, 8], 300, &destination)?;
        (queue.slots.iter_mut()).for_each(|it| it.literal_position = 290);
        // Two that take no literals.
        let (bits, mut padded_start) = (BackwardBits::new(&[0, 0, 0, 0, 1], 0)?, [0; _]);
        bits.pad_start(&mut padded_start);
        let mut reader = Reader::new([&PREDEFINED_TABLES; 3], bits, &padded_start, 2);
        queue.run_all::<1>(&mut reader, [&[0; 301], &[0; 64]], &mut destination)?;
        assert_eq!(
            (queue.literal_count, queue.next()?.literal_position),
            (32, 22)
        );
        Ok(())
    }
}
