//! `zstd_opt.c`: the `btopt`, `btultra` and `btultra2` strategies, which look for the cheapest parse.

use super::internal::{BlockSrc, DictMode, MatchState, Prefix, SeqStore, Strategy};
use crate::common::ZSTD_REP_NUM;
use crate::error::{ErrorCode, Result};

/// `ZSTD_updateTree`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the binary trees.
/// Matches are not compared past the position `iend`.
pub(crate) fn update_tree(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    ip: usize,
    iend: usize,
) -> Result<()> {
    // Test scaffolding only: noDict `ZSTD_updateTree_internal` + `ZSTD_insertBt1`.
    use super::internal::{count, hash_ptr};
    use crate::util::SliceExt;
    let mls = ms.c_params.min_match;
    let target = prefix.index_of(ip);
    let mut idx = ms.next_to_update;
    while idx < target {
        let ip = prefix.pos_of(idx);
        let h = hash_ptr(prefix.buf, ip, ms.c_params.hash_log, mls)?;
        let bt_mask = (1u32 << (ms.c_params.chain_log - 1)) - 1;
        let mut match_index = ms.hash_table.at(h)?;
        let (mut cls, mut cll) = (0usize, 0usize);
        let curr = idx;
        let bt_low = curr.saturating_sub(bt_mask);
        let mut smaller = 2 * (curr & bt_mask) as usize;
        let mut larger = smaller + 1;
        let window_low = ms.get_lowest_match_index(target, ms.c_params.window_log);
        let mut match_end_idx = curr + 8 + 1;
        let mut best_length = 8usize;
        let mut nb_compares = 1u32 << ms.c_params.search_log;
        ms.hash_table.put(h, curr)?;
        let bt = ms.chain_table.as_mut_slice();
        while nb_compares != 0 && match_index >= window_low {
            let next = 2 * (match_index & bt_mask) as usize;
            let mut ml = cls.min(cll);
            let m = prefix.pos_of(match_index);
            ml += count(prefix.buf, ip + ml, prefix.buf, m + ml, iend)?;
            if ml > best_length {
                best_length = ml;
                if ml > (match_end_idx - match_index) as usize {
                    match_end_idx = match_index + ml as u32;
                }
            }
            if ip + ml == iend {
                break;
            }
            if prefix.buf.at(m + ml)? < prefix.buf.at(ip + ml)? {
                bt.put(smaller, match_index)?;
                cls = ml;
                if match_index <= bt_low {
                    smaller = larger;
                    break;
                }
                smaller = next + 1;
                match_index = bt.at(next + 1)?;
            } else {
                bt.put(larger, match_index)?;
                cll = ml;
                if match_index <= bt_low {
                    larger = smaller;
                    break;
                }
                larger = next;
                match_index = bt.at(next)?;
            }
            nb_compares -= 1;
        }
        bt.put(smaller, 0)?;
        bt.put(larger, 0)?;
        let positions = if best_length > 384 {
            192.min(best_length as u32 - 384)
        } else {
            0
        };
        idx += positions.max(match_end_idx - (curr + 8));
    }
    ms.next_to_update = target;
    Ok(())
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
