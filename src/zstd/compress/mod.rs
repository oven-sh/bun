//! `lib/compress`

pub(crate) mod block_entropy;
pub(crate) mod cctx;
pub(crate) mod double_fast;
pub(crate) mod fast;
pub(crate) mod fse;
pub(crate) mod hist;
pub(crate) mod huf;
pub(crate) mod internal;
pub(crate) mod lazy;
pub(crate) mod ldm;
pub(crate) mod literals;
pub(crate) mod mt;
pub(crate) mod opt;
pub(crate) mod params;
pub(crate) mod presplit;
pub(crate) mod sequences;
pub(crate) mod stream;
pub(crate) mod superblock;

use internal::{BlockSrc, DictMode, MatchState, SeqStore, Strategy};

use crate::common::ZSTD_REP_NUM;
use crate::error::Result;

/// `ZSTD_rowMatchFinderSupported`
pub(crate) fn row_match_finder_supported(strategy: Strategy) -> bool {
    strategy >= Strategy::Greedy && strategy <= Strategy::Lazy2
}

/// What `ZSTD_selectBlockCompressor` selects, called: finds the sequences of the block `src` and adds them to
/// `seq_store`. `use_row_match_finder` is whether the row-based match finder is enabled, which only the strategies
/// that support it look at. Returns how many bytes at the end of the block are in no sequence.
pub(crate) fn compress_block(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    strategy: Strategy,
    use_row_match_finder: bool,
    dict_mode: DictMode,
) -> Result<usize> {
    match strategy {
        Strategy::Fast => match dict_mode {
            DictMode::NoDict => fast::compress_block_fast(ms, seq_store, rep, src),
            DictMode::ExtDict => fast::compress_block_fast_ext_dict(ms, seq_store, rep, src),
            DictMode::DictMatchState => {
                fast::compress_block_fast_dict_match_state(ms, seq_store, rep, src)
            }
        },
        Strategy::DFast => match dict_mode {
            DictMode::NoDict => double_fast::compress_block_double_fast(ms, seq_store, rep, src),
            DictMode::ExtDict => {
                double_fast::compress_block_double_fast_ext_dict(ms, seq_store, rep, src)
            }
            DictMode::DictMatchState => {
                double_fast::compress_block_double_fast_dict_match_state(ms, seq_store, rep, src)
            }
        },
        Strategy::Greedy | Strategy::Lazy | Strategy::Lazy2 | Strategy::BtLazy2 => {
            lazy::compress_block_lazy(
                ms,
                seq_store,
                rep,
                src,
                strategy,
                use_row_match_finder && row_match_finder_supported(strategy),
                dict_mode,
            )
        }
        Strategy::BtOpt | Strategy::BtUltra | Strategy::BtUltra2 => {
            opt::compress_block_opt(ms, seq_store, rep, src, strategy, dict_mode)
        }
    }
}
