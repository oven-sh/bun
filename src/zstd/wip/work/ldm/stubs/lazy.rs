//! `zstd_lazy.c`: the `greedy`, `lazy`, `lazy2` and `btlazy2` strategies.

use super::internal::{BlockSrc, DictMode, MatchState, Prefix, SeqStore, Strategy};
use crate::common::ZSTD_REP_NUM;
use crate::error::{ErrorCode, Result};

/// `ZSTD_insertAndFindFirstIndex`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the hash
/// chains. Returns the index of the first candidate for `ip`.
pub(crate) fn insert_and_find_first_index(
    _ms: &mut MatchState,
    _prefix: Prefix<'_>,
    _ip: usize,
) -> Result<u32> {
    Err(ErrorCode::Generic)
}

/// `ZSTD_row_update`: the same, in the rows of the row-based match finder.
pub(crate) fn row_update(_ms: &mut MatchState, _prefix: Prefix<'_>, _ip: usize) -> Result<()> {
    Err(ErrorCode::Generic)
}

/// `ZSTD_compressBlock_greedy`, `ZSTD_compressBlock_lazy2_dictMatchState_row` and all the others of the file:
/// `strategy` is one of the four, and `use_row` is false for `btlazy2`.
pub(crate) fn compress_block_lazy(
    _ms: &mut MatchState,
    _seq_store: &mut SeqStore,
    _rep: &mut [u32; ZSTD_REP_NUM],
    _src: &BlockSrc<'_>,
    _strategy: Strategy,
    _use_row: bool,
    _dict_mode: DictMode,
) -> Result<usize> {
    Err(ErrorCode::Generic)
}
