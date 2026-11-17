//! Reading sequences one by one.

use super::tables::{LengthRow, OffsetRow, SequenceTables};
use crate::array::At;
use crate::bits::{BackwardBits, PaddedStart};
use crate::format::CodeKind;

pub(super) struct Sequence {
    pub(super) literal_len: u32,
    pub(super) match_len: u32,
    /// -2, -1 and 0 stand for repeated offsets.
    pub(super) offset: u32,
}

#[derive(Clone, Copy)]
pub(super) struct States {
    pub(super) literal_len: usize,
    pub(super) offset: usize,
    pub(super) match_len: usize,
}

impl States {
    #[inline(always)]
    pub(super) fn rows(self, tables: [&SequenceTables; 3]) -> (&LengthRow, &OffsetRow, &LengthRow) {
        (
            tables[0].literal_lengths.at(self.literal_len),
            tables[1].offsets.at(self.offset),
            tables[2].match_lengths.at(self.match_len),
        )
    }

    /// What the sequence takes, and the way to the next states.
    #[inline(always)]
    pub(super) fn total_bits(self, tables: [&SequenceTables; 3]) -> isize {
        let (literal_len, offset, match_len) = self.rows(tables);
        isize::from(offset.total_bits)
            + isize::from(match_len.total_bits)
            + isize::from(literal_len.total_bits)
    }
}

pub(super) struct Reader<'a> {
    /// By [`CodeKind`]: where its table is.
    pub(super) tables: [&'a SequenceTables; 3],
    pub(super) are_tables_together: bool,
    pub(super) bits: BackwardBits<'a>,
    pub(super) states: States,
    pub(super) left: usize,
    /// For [`BackwardBits::move_to`].
    padded_start: &'a PaddedStart,
}

impl<'a> Reader<'a> {
    pub(super) fn new(
        tables: [&'a SequenceTables; 3],
        mut bits: BackwardBits<'a>,
        padded_start: &'a PaddedStart,
        count: usize,
    ) -> Self {
        let [literal_len, offset, match_len] =
            CodeKind::ALL.map(|kind| bits.read(tables.at(kind as usize).log(kind)) as usize);
        bits.refill();
        Self {
            tables,
            are_tables_together: tables.iter().all(|&it| core::ptr::eq(it, tables[0])),
            bits,
            states: States {
                literal_len,
                offset,
                match_len,
            },
            left: count,
            padded_start,
        }
    }

    #[inline(always)]
    pub(super) fn move_to_padded_start(&mut self) {
        self.bits.move_to(self.padded_start);
    }

    pub(super) fn is_quick(&self) -> bool {
        self.are_tables_together
            && self.quick_count(self.bits.position) != 0
            && self.bits.available >= self.states.total_bits(self.tables)
    }

    /// How many sequences can be read without a look at the start of the source, as long as refills are enough for them.
    #[inline(always)]
    pub(super) fn quick_count(&self, position: usize) -> usize {
        let before_last = self.left.saturating_sub(1);
        if self.bits.is_padded() {
            before_last
        } else {
            before_last.min(position / (BackwardBits::IN_REFILL as usize / 8))
        }
    }

    pub(super) fn next(&mut self) -> Sequence {
        let (literal_row, offset_row, match_row) = self.states.rows(self.tables);
        let bits = &mut self.bits;
        let needs_refill = bits.available < self.states.total_bits(self.tables);
        let offset =
            (offset_row.base as u32).wrapping_add(bits.read(offset_row.extra_bits as u32) as u32);
        let match_len = match_row.full_base() + bits.read(match_row.extra_bits as u32) as u32;
        if needs_refill {
            bits.refill();
        }
        let literal_len = literal_row.full_base() + bits.read(literal_row.extra_bits as u32) as u32;
        self.left -= 1;
        if self.left != 0 {
            let mut next = |base: u16, width| usize::from(base) + bits.read(width as u32) as usize;
            self.states = States {
                literal_len: next(literal_row.next, literal_row.state_bits),
                match_len: next(match_row.next, match_row.state_bits),
                offset: next(offset_row.next.into(), offset_row.state_bits),
            };
            bits.refill();
        }
        Sequence {
            literal_len,
            match_len,
            offset,
        }
    }
}
