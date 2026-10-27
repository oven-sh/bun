//! `zstd_double_fast.c`: the `dfast` strategy, which looks up a table of long hashes and a table of short ones.

use super::internal::{
    BlockSrc, DictTableLoadMethod, MatchState, Prefix, SeqStore, TableFillPurpose,
};
use crate::common::ZSTD_REP_NUM;
use crate::error::{ErrorCode, Result};

/// `ZSTD_fillDoubleHashTable`: indexes the segment from `ms.next_to_update` up to the position `end`.
pub(crate) fn fill_double_hash_table(
    _ms: &mut MatchState,
    _prefix: Prefix<'_>,
    _end: usize,
    _dtlm: DictTableLoadMethod,
    _tfp: TableFillPurpose,
) -> Result<()> {
    Err(ErrorCode::Generic)
}

/// `ZSTD_compressBlock_doubleFast`
pub(crate) fn compress_block_double_fast(
    _ms: &mut MatchState,
    _seq_store: &mut SeqStore,
    _rep: &mut [u32; ZSTD_REP_NUM],
    _src: &BlockSrc<'_>,
) -> Result<usize> {
    Err(ErrorCode::Generic)
}

/// `ZSTD_compressBlock_doubleFast_dictMatchState`
pub(crate) fn compress_block_double_fast_dict_match_state(
    _ms: &mut MatchState,
    _seq_store: &mut SeqStore,
    _rep: &mut [u32; ZSTD_REP_NUM],
    _src: &BlockSrc<'_>,
) -> Result<usize> {
    Err(ErrorCode::Generic)
}

/// `ZSTD_compressBlock_doubleFast_extDict`
pub(crate) fn compress_block_double_fast_ext_dict(
    _ms: &mut MatchState,
    _seq_store: &mut SeqStore,
    _rep: &mut [u32; ZSTD_REP_NUM],
    _src: &BlockSrc<'_>,
) -> Result<usize> {
    Err(ErrorCode::Generic)
}
