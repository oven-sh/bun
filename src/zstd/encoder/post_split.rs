//! Splits a block where tables of their own make both parts smaller.

use core::ops::Range;

use bun_zstd_decoder::format::BLOCK_HEADER_LEN;
use bun_zstd_decoder::{Error, Output, Result};

use crate::block::{self, BlockWriter, Content};
use crate::entropy::{LiteralsPlan, count_len};
use crate::parameters::Tuning;
use crate::sequences::{
    OffsetValue, Repeats, Sequence, Sequences, count_codes, literals_len, matches_len,
};

const SPLITS_MAX: usize = 196;
const SEQUENCES_MIN: usize = 300;

struct Part {
    sequences: Range<usize>,
    literals: Range<usize>,
}

struct Splitter<'a> {
    writer: &'a mut BlockWriter,
    sequences: &'a [Sequence],
    literals: &'a [u8],
    tuning: &'a Tuning,
    /// The sequences that start a part, but for the first one.
    splits: [u16; SPLITS_MAX],
    count: usize,
}

impl Splitter<'_> {
    /// `None` if its tables cannot be described.
    fn estimated_len(&mut self, part: &Part) -> Result<Option<usize>> {
        let literals = self.literals.get(part.literals.clone());
        let sequences = self.sequences.get(part.sequences.clone());
        let (literals, sequences) = literals.zip(sequences).ok_or(Error::Internal)?;
        let counts = count_codes(sequences);
        let entropy = &mut self.writer.entropy;
        let Some(literals_plan) = entropy.literals.plan(literals, self.tuning)? else {
            return Ok(None);
        };
        let codes_plan = entropy
            .codes
            .plan(sequences, &counts, self.tuning.strategy)?;
        let headers_len = BLOCK_HEADER_LEN + count_len(sequences.len()) + 1;
        let overhead = LiteralsPlan::overhead(literals.len());
        Ok(Some(
            headers_len
                + literals_plan.estimated_len(literals.len(), overhead)
                + entropy.codes.estimated_len(&codes_plan, &counts),
        ))
    }

    /// `len` is the estimate for `whole`.
    fn split(&mut self, whole: &Part, len: usize) -> Result<()> {
        if whole.sequences.len() < SEQUENCES_MIN {
            return Ok(());
        }
        let middle = whole.sequences.start.midpoint(whole.sequences.end);
        let first = whole.sequences.start..middle;
        let before_middle = self.sequences.get(first.clone()).ok_or(Error::Internal)?;
        let literals_middle = whole.literals.start + literals_len(before_middle);
        let first = Part {
            sequences: first,
            literals: whole.literals.start..literals_middle,
        };
        let second = Part {
            sequences: middle..whole.sequences.end,
            literals: literals_middle..whole.literals.end,
        };
        if let Some(first_len) = self.estimated_len(&first)?
            && let Some(second_len) = self.estimated_len(&second)?
            && first_len + second_len < len
        {
            self.split(&first, first_len)?;
            if let Some(split) = self.splits.get_mut(self.count) {
                *split = middle as u16;
                self.count += 1;
                self.split(&second, second_len)?;
            }
        }
        Ok(())
    }
}

/// A part that ends up uncompressed does not change the recent offsets of a decoder the way the search counted on.
fn replace_lost_repeats(sequences: &mut [Sequence], decoder: &mut Repeats, search: &mut Repeats) {
    for sequence in sequences {
        let (found, has_literals) = (sequence.offset(), sequence.literal_len() != 0);
        let offset = search.resolve(found, has_literals);
        if decoder.resolve(found, has_literals) != offset {
            sequence.set_offset(OffsetValue::new(offset));
        }
        *decoder = decoder.after(sequence.offset(), has_literals);
        *search = search.after(found, has_literals);
    }
}

/// `repeats` are the recent offsets after `all`.
#[inline(never)]
pub(crate) fn write(
    writer: &mut BlockWriter,
    bytes: &[u8],
    all: &mut Sequences,
    repeats: Repeats,
    tuning: &Tuning,
    is_last: bool,
    out: &mut Output<'_>,
) -> Result<()> {
    let whole = Part {
        sequences: 0..all.list.len(),
        literals: 0..all.literals().len(),
    };
    let mut splitter = Splitter {
        writer,
        sequences: &all.list,
        literals: all.literals(),
        tuning,
        splits: [0; SPLITS_MAX],
        count: 0,
    };
    if whole.sequences.len() >= SEQUENCES_MIN
        && let Some(len) = splitter.estimated_len(&whole)?
    {
        splitter.split(&whole, len)?;
    }
    let Splitter { splits, count, .. } = splitter;
    if count == 0 {
        let content = Content {
            bytes,
            sequences: &all.list,
            literals: all.literals(),
            counts: &all.counts,
            repeats,
        };
        return writer.write(&content, tuning, is_last, out);
    }

    let (written_before, repeats_before) = (out.written(), writer.repeats);
    let splits = splits.get(..count).ok_or(Error::Internal)?;
    // Half of the margin of `worst_case_len()` is for what follows.
    let len_max = BLOCK_HEADER_LEN + bytes.len() + (bytes.len() >> 9);
    match write_parts(writer, bytes, all, splits, tuning, is_last, out) {
        Ok(()) if out.written() - written_before <= len_max => Ok(()),
        Ok(()) | Err(Error::DstSizeTooSmall) => {
            out.rewind(written_before);
            writer.entropy.forget();
            writer.repeats = repeats_before;
            block::write_raw(bytes, is_last, out)
        }
        error => error,
    }
}

fn write_parts(
    writer: &mut BlockWriter,
    mut bytes: &[u8],
    all: &mut Sequences,
    splits: &[u16],
    tuning: &Tuning,
    is_last: bool,
    out: &mut Output<'_>,
) -> Result<()> {
    let mut search_repeats = writer.repeats;
    let (list, mut literals) = all.split_mut();
    let mut start = 0;
    let ends = splits.iter().map(|&split| usize::from(split));
    for end in ends.chain([list.len()]) {
        let is_last_part = end == list.len();
        let sequences = list.get_mut(start..end).ok_or(Error::Internal)?;
        let (literals_len, len) = if is_last_part {
            (literals.len(), bytes.len())
        } else {
            let literals_len = literals_len(sequences);
            (literals_len, literals_len + matches_len(sequences))
        };
        let mut repeats = writer.repeats;
        replace_lost_repeats(sequences, &mut repeats, &mut search_repeats);
        let content = Content {
            bytes: bytes.split_off(..len).ok_or(Error::Internal)?,
            sequences,
            literals: literals.split_off(..literals_len).ok_or(Error::Internal)?,
            counts: &count_codes(sequences),
            repeats,
        };
        writer.write(&content, tuning, is_last && is_last_part, out)?;
        start = end;
    }
    Ok(())
}

#[test]
fn records_no_more_splits_than_there_is_room_for() -> Result<()> {
    use crate::parameters::{Purpose, Request};

    // Four quarters that have little in common
    let mut all = Sequences::new();
    all.clear_for(1 << 17, 4)?;
    for index in 0..800 {
        let quarter = index / 200;
        let offset = OffsetValue::new((50 << (3 * quarter)) + index);
        all.push(1 + quarter, offset, 10 + 5 * quarter + index % 2);
    }
    all.finish(&[0; 16400], 16400)?;
    let whole = Part {
        sequences: 0..all.list.len(),
        literals: 0..all.literals().len(),
    };
    let tuning = Request::new(16).tuning(None, Purpose::Frame { dictionary_len: 0 });
    for (room, expected) in [(4, [200, 400, 600, 0]), (1, [200, 0, 0, 0])] {
        let mut splitter = Splitter {
            writer: &mut BlockWriter::new(),
            sequences: &all.list,
            literals: all.literals(),
            tuning: &tuning,
            splits: [0; SPLITS_MAX],
            count: SPLITS_MAX - room,
        };
        splitter.split(&whole, usize::MAX)?;
        let recorded = splitter.splits.into_iter().skip(SPLITS_MAX - room);
        assert!(recorded.eq(expected.into_iter().take(room)));
    }
    Ok(())
}

#[test]
fn parts_that_take_too_much_are_given_up() -> Result<()> {
    use bun_zstd_decoder::XxHash64;
    use bun_zstd_decoder::format::CodeKind;

    use crate::entropy::Reuse;
    use crate::parameters::{Purpose, Request};

    let tuning = Request::new(19).tuning(None, Purpose::Frame { dictionary_len: 0 });
    // The parts add 41 bytes.
    for (len, room, is_given_up) in [
        (19455, 20000, true),
        (19456, 20000, false),
        (19456, 19496, true),
    ] {
        // Sixteen parts that have little in common. Only the first one gets smaller.
        let mut all = Sequences::new();
        all.clear_for(1 << 17, 3)?;
        for index in 0..4800 {
            let part = index / 300;
            let code = match part {
                0 => 22 + index % 2,
                _ => 24 + part % 8,
            };
            all.push(part / 8, OffsetValue::new((1 << code) + index), 3);
        }
        let noise = |it: u32| XxHash64::hash(&it.to_le_bytes()) as u8;
        let bytes: Vec<_> = (0..len).map(noise).collect();
        all.finish(&bytes, 16800)?;

        let (mut writer, mut room) = (BlockWriter::new(), vec![0; room]);
        let (repeats, mut out) = (Repeats::INITIAL, Output::slice(&mut room));
        write(
            &mut writer,
            &bytes,
            &mut all,
            repeats,
            &tuning,
            true,
            &mut out,
        )?;
        let added = out.written() - bytes.len();
        drop(out);
        assert_eq!(added, if is_given_up { BLOCK_HEADER_LEN } else { 41 });
        let content = room.split_at(BLOCK_HEADER_LEN).1;
        assert_eq!(content.starts_with(&bytes), is_given_up);
        assert_eq!(writer.repeats == repeats, is_given_up);
        let reuse = *writer.entropy.codes.reuse_mut(CodeKind::Offset);
        assert_eq!(reuse == Reuse::Never, is_given_up);
    }
    Ok(())
}
