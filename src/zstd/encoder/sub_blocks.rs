//! Writes a block as several that share their tables and come close to a given compressed length.

use bun_zstd_decoder::format::{BLOCK_HEADER_LEN, BlockType, Encoding, MIN_MATCH};
use bun_zstd_decoder::{Error, Output, Result};

use crate::block::{self, BlockWriter, Content};
use crate::bytes::is_one_byte_repeated;
use crate::entropy::{Changes, CodesPlan, LiteralsPlan};
use crate::parameters::Tuning;
use crate::sequences::{Sequence, literals_len, matches_len};
use crate::worst_case_len;

/// Costs are in 1/256 of a byte.
const BYTE: usize = 256;

struct Budget {
    per_block: usize,
    per_literal: usize,
    per_sequence: usize,
}

impl Budget {
    /// How many of `sequences` go into the next block.
    fn sequence_count(&self, sequences: &[Sequence], is_first: bool) -> usize {
        let mut cost = if is_first { 120 * BYTE } else { 0 };
        let mut len = 0;
        for (index, sequence) in sequences.iter().enumerate() {
            // The lowest 16 bits do for an estimate.
            let literal_len = usize::from(sequence.literal_len() as u16);
            cost += literal_len * self.per_literal + self.per_sequence;
            len += literal_len + usize::from(sequence.match_base() as u16) + MIN_MATCH as usize;
            if cost > self.per_block && (index == 0 || cost < len * BYTE) {
                return index.max(1);
            }
        }
        sequences.len()
    }
}

struct SubBlocks<'a, 'out> {
    writer: &'a BlockWriter,
    literals_plan: LiteralsPlan,
    codes_plan: CodesPlan,
    /// What is not yet written.
    left: Content<'a>,
    needs_literal_table: bool,
    needs_code_tables: bool,
    out: &'a mut Output<'out>,
}

impl SubBlocks<'_, '_> {
    /// Leaves them for the next block if they do not get smaller.
    fn write(&mut self, count: usize, literals_len: usize, is_last: bool) -> Result<()> {
        let mut left = self.left;
        let sequences = left.sequences.split_off(..count).ok_or(Error::Internal)?;
        let literals = left.literals.split_off(..literals_len);
        let literals = literals.ok_or(Error::Internal)?;
        let len = literals_len + matches_len(sequences);
        left.bytes = left.bytes.get(len..).ok_or(Error::Internal)?;

        let entropy = &self.writer.entropy;
        // More than an attempt can take.
        let (header, out) = block::room_for_block(self.out, 4 * worst_case_len(len) + 256)?;
        let Some((literals_len, has_literal_table)) = entropy.literals.write_part(
            &self.literals_plan,
            literals,
            self.needs_literal_table,
            out,
        )?
        else {
            return Ok(());
        };
        let Some((codes_len, has_code_tables)) = entropy.codes.write_part(
            &self.codes_plan,
            sequences,
            self.needs_code_tables,
            out.get_mut(literals_len..).ok_or(Error::Internal)?,
        )?
        else {
            return Ok(());
        };

        let content_len = literals_len + codes_len;
        if BLOCK_HEADER_LEN + content_len < len {
            *header = block::header(BlockType::Compressed, content_len, is_last);
            self.out.commit(BLOCK_HEADER_LEN + content_len);
            self.left = left;
            self.needs_literal_table &= !has_literal_table;
            self.needs_code_tables &= !has_code_tables;
        }
        Ok(())
    }
}

/// False if one uncompressed block is better.
fn try_write(
    writer: &mut BlockWriter,
    content: &Content<'_>,
    tuning: &Tuning,
    target_len: usize,
    is_last: bool,
    out: &mut Output<'_>,
) -> Result<bool> {
    let written_before = out.written();
    let Some(literals_plan) = writer.entropy.literals.plan(content.literals, tuning)? else {
        return Ok(false);
    };
    let codes_plan =
        writer
            .entropy
            .codes
            .plan(content.sequences, content.counts, tuning.strategy)?;
    let has_new_literal_table = literals_plan.encoding == Encoding::Compressed;
    let mut blocks = SubBlocks {
        writer,
        literals_plan,
        codes_plan,
        left: *content,
        needs_literal_table: has_new_literal_table,
        needs_code_tables: true,
        out,
    };

    if !content.sequences.is_empty() {
        const SECTION_HEADER_LEN: usize = 3;
        let literal_count = content.literals.len();
        let for_literals = blocks
            .literals_plan
            .estimated_len(literal_count, SECTION_HEADER_LEN);
        let for_codes = writer
            .entropy
            .codes
            .estimated_len(&blocks.codes_plan, content.counts);
        let for_rest = for_codes + SECTION_HEADER_LEN + BLOCK_HEADER_LEN;
        let total = for_literals + for_rest;
        if total > content.bytes.len() {
            return Ok(false);
        }
        let block_count = ((total + target_len / 2) / target_len).max(1);
        let budget = Budget {
            per_block: total * BYTE / block_count,
            per_literal: (for_literals * BYTE)
                .checked_div(literal_count)
                .unwrap_or(BYTE),
            per_sequence: for_rest * BYTE / content.sequences.len(),
        };
        for index in 0..block_count - 1 {
            let left = blocks.left.sequences;
            let count = budget.sequence_count(left, index == 0);
            if count == left.len() {
                break;
            }
            let literals_len = literals_len(left.get(..count).unwrap_or_default());
            blocks.write(count, literals_len, false)?;
        }
    }
    let Content {
        sequences,
        literals,
        ..
    } = blocks.left;
    blocks.write(sequences.len(), literals.len(), is_last)?;

    if blocks.needs_code_tables && blocks.codes_plan.has_descriptions() {
        return Ok(false);
    }
    let mut repeats = content.repeats;
    if !blocks.left.bytes.is_empty() {
        block::write_raw(blocks.left.bytes, is_last, blocks.out)?;
        if !blocks.left.sequences.is_empty() {
            let kept = content.sequences.len() - blocks.left.sequences.len();
            let kept = content.sequences.iter().take(kept);
            repeats = kept.fold(writer.repeats, |repeats, it| {
                repeats.after(it.offset(), it.literal_len() != 0)
            });
        }
    }

    let (len, written) = (content.bytes.len(), blocks.out.written() - written_before);
    if written >= tuning.strategy.worth_it_below(len) + BLOCK_HEADER_LEN {
        return Ok(false);
    }
    let changes = Changes {
        has_new_literal_table: has_new_literal_table && !blocks.needs_literal_table,
        codes: Some(blocks.codes_plan.choice()),
    };
    writer.accept(changes, repeats);
    Ok(true)
}

#[inline(never)]
pub(crate) fn write(
    writer: &mut BlockWriter,
    content: &Content<'_>,
    tuning: &Tuning,
    target_len: usize,
    is_last: bool,
    out: &mut Output<'_>,
) -> Result<()> {
    let written_before = out.written();
    if !writer.is_at_start
        && content.sequences.len() < 4
        && content.literals.len() < 10
        && is_one_byte_repeated(content.bytes)
    {
        block::write_repeated(content.bytes, is_last, out)
    } else {
        match try_write(writer, content, tuning, target_len, is_last, out) {
            Ok(false) | Err(Error::DstSizeTooSmall) => {
                out.rewind(written_before);
                block::write_raw(content.bytes, is_last, out)
            }
            result => result.map(drop),
        }
    }
}
