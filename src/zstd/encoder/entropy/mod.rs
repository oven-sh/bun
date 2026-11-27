//! Turns sequences and literals into the two sections of a compressed block.

mod bit_writer;
mod codes;
pub(crate) mod fse;
pub(crate) mod histogram;
mod huffman;
mod literals;

use bun_zstd_decoder::format::Encoding;
use bun_zstd_decoder::{Error, Result};

pub(crate) use codes::{CodeTables, CodesChoice, CodesPlan, count_len, first_symbol};
pub(crate) use literals::{LiteralTables, LiteralsPlan, looks_random};

use crate::block::Content;
use crate::parameters::Tuning;

/// Whether a block can use the table of an earlier one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reuse {
    Never,
    /// If it has all symbols of the block.
    IfComplete,
    Always,
}

pub(crate) struct Entropy {
    pub(crate) literals: LiteralTables,
    pub(crate) codes: CodeTables,
}

/// What a block changes about the tables once it is part of the frame.
#[derive(Clone, Copy)]
pub(crate) struct Changes {
    pub(crate) has_new_literal_table: bool,
    pub(crate) codes: Option<CodesChoice>,
}

impl Entropy {
    pub(crate) const EMPTY: Self = Self {
        literals: LiteralTables::EMPTY,
        codes: CodeTables::EMPTY,
    };

    pub(crate) fn forget(&mut self) {
        self.literals.reuse = Reuse::Never;
        self.codes.accept(CodesChoice::PREDEFINED);
    }

    pub(crate) fn copy_from(&mut self, other: &Self) -> Result<()> {
        self.literals.copy_from(&other.literals)?;
        self.codes.copy_from(&other.codes)
    }

    pub(crate) fn accept(&mut self, changes: Changes) {
        if changes.has_new_literal_table {
            self.literals.accept_candidate();
        }
        if let Some(choice) = changes.codes {
            self.codes.accept(choice);
        }
    }

    /// `None` if it is not worth compressing.
    pub(crate) fn compress(
        &mut self,
        content: &Content<'_>,
        tuning: &Tuning,
        out: &mut [u8],
    ) -> Result<Option<(usize, Changes)>> {
        let worth_it_below = tuning.strategy.worth_it_below(content.bytes.len());
        match self.write_sections(content, tuning, out) {
            Err(Error::DstSizeTooSmall) => Ok(None),
            result => Ok(result?.filter(|&(written, _)| written < worth_it_below)),
        }
    }

    fn write_sections(
        &mut self,
        &Content {
            sequences,
            literals,
            counts,
            ..
        }: &Content<'_>,
        tuning: &Tuning,
        out: &mut [u8],
    ) -> Result<Option<(usize, Changes)>> {
        let literals_per_sequence = literals.len().checked_div(sequences.len());
        // Blocks without any only get here if they do not look random.
        let has_few_matches = literals_per_sequence.is_some_and(|ratio| ratio >= 20);
        let (mut written, encoding) =
            self.literals
                .compress(literals, tuning, has_few_matches, out)?;
        let mut changes = Changes {
            has_new_literal_table: encoding == Encoding::Compressed,
            codes: None,
        };

        let out = out.get_mut(written..).ok_or(Error::Internal)?;
        let count_len = codes::write_count(sequences.len(), out)?;
        written += count_len;
        if sequences.is_empty() {
            return Ok(Some((written, changes)));
        }

        let out = out.get_mut(count_len..).unwrap_or_default();
        let (modes, out) = out.split_first_mut().ok_or(Error::Internal)?;
        let chosen = self.codes.choose(sequences, counts, tuning.strategy, out)?;
        *modes = chosen.choice.modes();
        let out = out.get_mut(chosen.len..).ok_or(Error::Internal)?;
        let stream_len = self.codes.encode(chosen.choice, sequences, out)?;
        if chosen.trips_old_decoders(stream_len) {
            return Ok(None);
        }
        changes.codes = Some(chosen.choice);
        Ok(Some((written + 1 + chosen.len + stream_len, changes)))
    }
}
