//! Content that precedes each frame, and tables to start with.

use core::ops::Range;

use bun_zstd_decoder::array::At;
use bun_zstd_decoder::format::{
    BLOCK_LEN_MAX, CodeKind, DICTIONARY_MAGIC, LITERAL_LENGTH_TABLE_LOG_MAX,
    MATCH_LENGTH_TABLE_LOG_MAX, MAX_LITERAL_LENGTH_CODE, MAX_MATCH_LENGTH_CODE, MAX_OFFSET_CODE,
    OFFSET_TABLE_LOG_MAX,
};
use bun_zstd_decoder::{Error, Result, read_huffman_weights};

use crate::bytes::{highest_bit, u32_at};
use crate::entropy::fse::Normalized;
use crate::entropy::{Entropy, Reuse};
use crate::matches::{MatchState, Owner};
use crate::parameters::{Purpose, Request};
use crate::sequences::Repeats;
use crate::vec::Shared;
use crate::window::WORD_LEN;

/// Ready for frames to start from.
pub(crate) struct Dictionary {
    bytes: Shared<Vec<u8>>,
    content: Range<usize>,
    pub(crate) id: u32,
    pub(crate) state: MatchState,
    pub(crate) entropy: Entropy,
    pub(crate) repeats: Repeats,
}

fn reuse(has_all_symbols: bool) -> Reuse {
    if has_all_symbols {
        Reuse::Always
    } else {
        Reuse::IfComplete
    }
}

/// Reads what is between the ID and the content, and returns the content.
fn read_tables<'a>(mut bytes: &'a [u8], entropy: &mut Entropy) -> Result<(Repeats, &'a [u8])> {
    let description = read_huffman_weights(bytes).map_err(|_| Error::DictionaryCorrupted)?;
    bytes = bytes.get(description.len..).ok_or(Error::Internal)?;
    let weights = description
        .weights
        .get(..description.symbol_count)
        .ok_or(Error::Internal)?;
    let has_all = weights.len() == 256 && *description.rank_counts.at(0) == 0;
    entropy
        .literals
        .load(weights, description.table_log, reuse(has_all))?;

    let offsets = Normalized::read(&mut bytes, MAX_OFFSET_CODE, OFFSET_TABLE_LOG_MAX)?;
    let match_lengths = Normalized::read(
        &mut bytes,
        MAX_MATCH_LENGTH_CODE,
        MATCH_LENGTH_TABLE_LOG_MAX,
    )?;
    let literal_lengths = Normalized::read(
        &mut bytes,
        MAX_LITERAL_LENGTH_CODE,
        LITERAL_LENGTH_TABLE_LOG_MAX,
    )?;
    let (repeats, content) = bytes
        .split_first_chunk::<12>()
        .ok_or(Error::DictionaryCorrupted)?;
    let repeats = [0, 4, 8].map(|at| u32_at(repeats, at).unwrap_or(0));
    let max_offset = u32::try_from(content.len() + BLOCK_LEN_MAX).unwrap_or(u32::MAX);
    for (kind, counts, max_needed) in [
        (CodeKind::Offset, offsets, highest_bit(max_offset) as usize),
        (CodeKind::MatchLength, match_lengths, MAX_MATCH_LENGTH_CODE),
        (
            CodeKind::LiteralLength,
            literal_lengths,
            MAX_LITERAL_LENGTH_CODE,
        ),
    ] {
        let has_all = (0..=max_needed).all(|symbol| *counts.counts.at(symbol) != 0);
        entropy.codes.load(kind, &counts, reuse(has_all))?;
    }
    Ok((Repeats(repeats), content))
}

impl Dictionary {
    /// Without the magic number, it is all content.
    pub(crate) fn new(bytes: &Shared<Vec<u8>>, request: &Request) -> Result<Self> {
        let tuning = request.tuning(None, Purpose::Dictionary { len: bytes.len() });
        let mut state = MatchState::new(tuning);
        state.reset(tuning, tuning.prefers_rows(), Owner::Dictionary, 0)?;
        let mut entropy = Entropy::EMPTY;

        let has_tables = bytes.len() >= WORD_LEN && u32_at(bytes, 0) == Some(DICTIONARY_MAGIC);
        let (id, repeats, content) = match bytes.get(WORD_LEN..) {
            None => (0, Repeats::INITIAL, &[][..]),
            Some(rest) if has_tables => {
                let (repeats, content) = read_tables(rest, &mut entropy)?;
                (u32_at(bytes, 4).unwrap_or(0), repeats, content)
            }
            Some(_) => (0, Repeats::INITIAL, bytes.as_slice()),
        };
        let content = state.loadable(content);
        let is_in_content = |offset: u32| (1..=content.len()).contains(&(offset as usize));
        if has_tables && !repeats.0.into_iter().all(is_in_content) {
            return Err(Error::DictionaryCorrupted);
        }
        if !content.is_empty() {
            state.load::<{ Owner::Dictionary }>(content, || false);
        }
        Ok(Self {
            content: bytes.len() - content.len()..bytes.len(),
            bytes: Shared::clone(bytes),
            id,
            state,
            entropy,
            repeats,
        })
    }

    pub(crate) fn len(&self) -> usize {
        self.bytes.len()
    }

    /// What the tables index.
    pub(crate) fn content(&self) -> &[u8] {
        self.bytes.get(self.content.clone()).unwrap_or_default()
    }

    /// Whether a frame searches these tables. Copying them only pays off for large inputs.
    pub(crate) fn is_attached_for(&self, input_len: Option<u64>) -> bool {
        const KB_BY_STRATEGY: [u64; 10] = [8, 8, 16, 32, 32, 32, 32, 32, 8, 8];
        let limit = KB_BY_STRATEGY.at(self.state.tuning.strategy as usize) << 10;
        input_len.is_none_or(|len| len <= limit)
    }
}

#[test]
fn tables_are_copied_for_large_inputs() -> Result<()> {
    let bytes = crate::vec::shared(vec![0; 8])?;
    for (strategy, kb) in (1..).zip([8, 16, 32, 32, 32, 32, 32, 8, 8]) {
        let mut request = Request::new(1);
        request.set(107, strategy)?;
        let dictionary = Dictionary::new(&bytes, &request)?;
        let lens = [None, Some(kb << 10), Some((kb << 10) + 1)];
        assert_eq!(
            lens.map(|it| dictionary.is_attached_for(it)),
            [true, true, false]
        );
    }
    Ok(())
}
