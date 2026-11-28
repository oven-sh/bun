//! The sequences section of a compressed block.

mod tables;

use bun_highway::unzstd::{CHUNK, Reader, Sequence, Sequences};

use crate::bits::bits_below_mark;
use crate::destination::{Destination, OVERSHOOT};
use crate::error::{Error, Result};
use crate::format::CodeKind;
use crate::literals::LITERALS_PADDING;

pub(crate) use bun_highway::unzstd::Tables as SequenceTables;
pub(crate) use tables::{predefined_tables, read_rle_table, read_table};

const _: () = assert!(CHUNK == OVERSHOOT && CHUNK == LITERALS_PADDING);
const _: () = assert!(CodeKind::Offset as usize == 1 && CodeKind::MatchLength as usize == 2);

/// Up to so many are not worth more than one at a time.
const FEW_SEQUENCES: usize = 4;

/// At `positions` in the literals and on the tape. Returns those behind it. `padded` starts with `literals`.
#[inline(always)]
fn run_one(
    sequence: &Sequence,
    (literal_start, start): (usize, usize),
    [padded, literals]: [&[u8]; 2],
    destination: &mut Destination<'_, '_>,
) -> Result<(usize, usize)> {
    /// For as much, `memcpy()` is quicker.
    const LONG_LEN: usize = 2 << 10;

    let (literal_len, match_len) = (sequence.literal_len as usize, sequence.match_len as usize);
    let (before, len) = (start - destination.position(), literal_len + match_len);
    destination.check_block_len(before + len)?;
    let ends = (literal_start + literal_len, start + len);
    let literals = literals.get(literal_start..ends.0);
    let literals = literals.filter(|_| sequence.offset != 0);
    let literals = literals.ok_or(Error::CorruptionDetected)?;
    if len < LONG_LEN {
        let padded = padded.get(literal_start..).ok_or(Error::Internal)?;
        let (detached, tape) = destination.tape(before + len, 0)?;
        if tape.write(start, sequence, padded, detached) {
            return Ok(ends);
        }
    }
    destination.write(before, literals, sequence.offset as usize, match_len)?;
    Ok(ends)
}

/// Until the source is used up.
fn run_one_by_one(
    reader: &mut Reader<'_>,
    literals: [&[u8]; 2],
    destination: &mut Destination<'_, '_>,
) -> Result<(usize, usize)> {
    let mut positions = (0, destination.position());
    while reader.bits_left() >= 0
        && let Some(sequence) = reader.next()
    {
        positions = run_one(&sequence, positions, literals, destination)?;
    }
    Ok(positions)
}

#[inline(always)]
fn run_all(
    sequences: &mut Sequences<'_>,
    [padded, literals]: [&[u8]; 2],
    mut likely_len: usize,
    destination: &mut Destination<'_, '_>,
) -> Result<(usize, usize)> {
    let (mut last_literals, mut before_last) = ([[0; LITERALS_PADDING]; 2], usize::MAX);
    if padded.len() < literals.len() + LITERALS_PADDING {
        last_literals[0] = *literals.last_chunk().ok_or(Error::Internal)?;
        before_last = literals.len() - LITERALS_PADDING;
    }
    loop {
        let (literal_position, position) = sequences.positions();
        let rest = if literal_position < before_last {
            (padded, 0)
        } else {
            (last_literals.as_flattened(), before_last)
        };
        let (len, end) = (position - destination.position(), destination.end());
        let (detached, tape) = destination.tape(len, core::mem::take(&mut likely_len))?;
        let unread = sequences.unread();
        sequences.run(rest, detached, tape, end);
        let was_in_vain = sequences.is_idle() && unread - sequences.unread() < FEW_SEQUENCES;
        for _ in 0..if was_in_vain { 8 } else { 1 } {
            let positions = sequences.positions();
            let Some(sequence) = sequences.take() else {
                return Ok(positions);
            };
            run_one(&sequence, positions, [padded, literals], destination)?;
        }
    }
}

/// Runs the `count` sequences in `src[start..]`. Returns how many bytes they wrote, and how many literals they took.
pub(crate) fn run_sequences(
    tables: [&SequenceTables; 3],
    (src, start): (&[u8], usize),
    count: usize,
    (padded, literal_count): (&[u8], usize),
    repeat_offsets: &mut [u32; 3],
    destination: &mut Destination<'_, '_>,
) -> Result<(usize, usize)> {
    debug_assert!(padded.len() <= literal_count + LITERALS_PADDING);
    let literals = [padded, padded.get(..literal_count).ok_or(Error::Internal)?];
    let (end, position) = (bits_below_mark(src, start)?, destination.position());
    let mut reader = Reader::new(tables, (src, end), count, *repeat_offsets);
    let result = if count <= FEW_SEQUENCES {
        run_one_by_one(&mut reader, literals, destination)
    } else {
        let match_len =
            (count > 128 && destination.has_to_guess()).then(|| tables[2].usual_match_len());
        let likely_len = literal_count + count * match_len.unwrap_or(16) * 9 / 8;
        let mut sequences = Sequences::new(reader, position);
        let result =
            destination.with_overshoot(|it| run_all(&mut sequences, literals, likely_len, it));
        reader = sequences.into_reader();
        result
    };
    match (result, reader.bits_left() - 8 * start as isize) {
        (Ok((used_literals, end)), 0) => {
            *repeat_offsets = reader.repeats();
            Ok((end - position, used_literals))
        }
        (Ok(_), 1..) => Err(Error::CorruptionDetected),
        // The error does not depend on what is in front of the stream.
        (Ok(_) | Err(Error::CorruptionDetected | Error::DstSizeTooSmall), _) => {
            let stream = (src.get(start..).ok_or(Error::Internal)?, end - 8 * start);
            let mut reader = Reader::new(tables, stream, count, *repeat_offsets);
            run_one_by_one(&mut reader, literals, destination)?;
            Err(Error::CorruptionDetected)
        }
        (Err(error), _) => Err(error),
    }
}
