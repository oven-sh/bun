//! `zstd_opt.c`: the `btopt`, `btultra` and `btultra2` strategies, which look for the cheapest parse.

use super::internal::{BlockSrc, DictMode, MatchState, Prefix, SeqStore, Strategy};
use crate::common::ZSTD_REP_NUM;
use crate::error::{ErrorCode, Result};

/// `ZSTD_updateTree`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the binary trees.
/// Matches are not compared past the position `iend`.
pub(crate) fn update_tree(
    _ms: &mut MatchState,
    _prefix: Prefix<'_>,
    _ip: usize,
    _iend: usize,
) -> Result<()> {
    Err(ErrorCode::Generic)
}

/// `ZSTD_compressBlock_btopt`, `ZSTD_compressBlock_btultra`, `ZSTD_compressBlock_btultra2` and their `_dictMatchState`
/// and `_extDict` variants. With a dictionary of either kind, `btultra2` is `btultra`.
pub(crate) fn compress_block_opt(
    _ms: &mut MatchState,
    _seq_store: &mut SeqStore,
    _rep: &mut [u32; ZSTD_REP_NUM],
    _src: &BlockSrc<'_>,
    _strategy: Strategy,
    _dict_mode: DictMode,
) -> Result<usize> {
    Err(ErrorCode::Generic)
}
