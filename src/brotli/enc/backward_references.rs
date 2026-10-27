//! Turns the input into commands, greedily with a little lookahead (qualities 2 to 9).

use super::Fallible;
use super::command::Command;
use super::dictionary_hash::{DictionaryHash, dictionary_hash};
use super::hash::{
    DictionaryStats, Hasher, HasherKind, HasherSearchResult, LongestMatchHasher, SCORE_BASE,
    StaticDictionarySearch, lookup_compound_dictionary_match,
};
use super::params::{EncoderParams, MIN_QUALITY_FOR_EXTENSIVE_REFERENCE_SEARCH};
use crate::common::constants::{NUM_DISTANCE_SHORT_CODES, max_backward_limit};
use crate::util::{Bug, Checked};

/// One of the 16 short codes if `distance` is one of, or close to one of, the last distances. Else the distance + 15.
#[inline(always)]
fn compute_distance_code(distance: usize, max_distance: usize, dist_cache: &[i32; 16]) -> usize {
    if distance <= max_distance {
        let distance_plus_3 = distance + 3;
        let offset0 = distance_plus_3.wrapping_sub(dist_cache[0] as usize);
        let offset1 = distance_plus_3.wrapping_sub(dist_cache[1] as usize);
        if distance == dist_cache[0] as usize {
            return 0;
        } else if distance == dist_cache[1] as usize {
            return 1;
        } else if offset0 < 7 {
            return (0x975_0468 >> (4 * offset0)) & 0xF;
        } else if offset1 < 7 {
            return (0xFDB_1ACE >> (4 * offset1)) & 0xF;
        } else if distance == dist_cache[2] as usize {
            return 2;
        } else if distance == dist_cache[3] as usize {
            return 3;
        }
    }
    distance + NUM_DISTANCE_SHORT_CODES as usize - 1
}

/// `COMPOUND` is whether to look in the compound dictionary too.
///
/// Not inlined: next to the code for the other hashers, that for H3 came out 3 % slower.
#[inline(never)]
fn create_backward_references_with<H: LongestMatchHasher, const COMPOUND: bool>(
    num_bytes: usize,
    mut position: usize,
    ring_buffer: &[u8],
    ring_buffer_mask: usize,
    params: &EncoderParams,
    hasher: &mut H,
    dictionary_stats: &mut DictionaryStats,
    dictionary_hash: &'static DictionaryHash,
    dist_cache: &mut [i32; 16],
    last_insert_len: &mut usize,
    commands: &mut Vec<Command>,
    num_literals: &mut usize,
) -> Checked {
    let mut dictionary = StaticDictionarySearch::new(dictionary_stats, dictionary_hash);
    // RFC 7932 section 9.1: the largest distance.
    let max_backward_limit = max_backward_limit(params.lgwin as u32);
    let position_offset = params.stream_offset;

    let mut insert_length = *last_insert_len;
    let pos_end = position + num_bytes;
    let store_end = if num_bytes >= H::STORE_LOOKAHEAD {
        position + num_bytes - H::STORE_LOOKAHEAD + 1
    } else {
        position
    };

    // To go faster through data that looks random.
    let random_heuristics_window_size = params.literal_spree_length_for_sparse_search();
    let mut apply_random_heuristics = position + random_heuristics_window_size;
    let gap = params.dictionary.total_size;

    // What a backward reference has to score to be accepted.
    const MIN_SCORE: usize = SCORE_BASE + 100;

    hasher.prepare_distance_cache(dist_cache);

    while position + H::HASH_TYPE_LENGTH < pos_end {
        let mut max_length = pos_end - position;
        let mut max_distance = position.min(max_backward_limit);
        let mut dictionary_start = (position + position_offset).min(max_backward_limit);
        let mut best = HasherSearchResult {
            len: 0,
            len_code_delta: 0,
            distance: 0,
            score: MIN_SCORE,
        };
        hasher.find_longest_match(
            &mut dictionary,
            ring_buffer,
            ring_buffer_mask,
            dist_cache,
            position,
            max_length,
            max_distance,
            dictionary_start + gap,
            params.dist.max_distance,
            &mut best,
        )?;
        if COMPOUND {
            lookup_compound_dictionary_match(
                &params.dictionary,
                ring_buffer,
                ring_buffer_mask,
                dist_cache,
                position,
                max_length,
                dictionary_start,
                params.dist.max_distance,
                &mut best,
            )?;
        }
        if best.score > MIN_SCORE {
            // Found a match. There may be a better one right after.
            let mut delayed_backward_references_in_row = 0;
            max_length -= 1;
            loop {
                const COST_DIFF_LAZY: usize = 175;
                let mut next = HasherSearchResult {
                    len: if params.quality < MIN_QUALITY_FOR_EXTENSIVE_REFERENCE_SEARCH {
                        (best.len - 1).min(max_length)
                    } else {
                        0
                    },
                    len_code_delta: 0,
                    distance: 0,
                    score: MIN_SCORE,
                };
                max_distance = (position + 1).min(max_backward_limit);
                dictionary_start = (position + 1 + position_offset).min(max_backward_limit);
                hasher.find_longest_match(
                    &mut dictionary,
                    ring_buffer,
                    ring_buffer_mask,
                    dist_cache,
                    position + 1,
                    max_length,
                    max_distance,
                    dictionary_start + gap,
                    params.dist.max_distance,
                    &mut next,
                )?;
                if COMPOUND {
                    lookup_compound_dictionary_match(
                        &params.dictionary,
                        ring_buffer,
                        ring_buffer_mask,
                        dist_cache,
                        position + 1,
                        max_length,
                        dictionary_start,
                        params.dist.max_distance,
                        &mut next,
                    )?;
                }
                if next.score >= best.score + COST_DIFF_LAZY {
                    // Write one literal, and start the match at the next byte.
                    position += 1;
                    insert_length += 1;
                    best = next;
                    delayed_backward_references_in_row += 1;
                    if delayed_backward_references_in_row < 4
                        && position + H::HASH_TYPE_LENGTH < pos_end
                    {
                        max_length -= 1;
                        continue;
                    }
                }
                break;
            }
            apply_random_heuristics = position + 2 * best.len + random_heuristics_window_size;
            dictionary_start = (position + position_offset).min(max_backward_limit);
            let distance_code =
                compute_distance_code(best.distance, dictionary_start + gap, dist_cache);
            if best.distance <= dictionary_start + gap && distance_code > 0 {
                dist_cache[3] = dist_cache[2];
                dist_cache[2] = dist_cache[1];
                dist_cache[1] = dist_cache[0];
                dist_cache[0] = best.distance as i32;
                hasher.prepare_distance_cache(dist_cache);
            }
            commands.push(Command::new(
                &params.dist,
                insert_length,
                best.len,
                best.len_code_delta,
                distance_code,
            ));
            *num_literals += insert_length;
            insert_length = 0;
            // Add the positions of the copy to the table, as far as there are enough bytes left to hash. Not all of
            // them for a run, which would fill the table with the same thing.
            let mut range_start = position + 2;
            let range_end = (position + best.len).min(store_end);
            if best.distance < (best.len >> 2) {
                range_start =
                    range_end.min(range_start.max(position + best.len - (best.distance << 2)));
            }
            hasher.store_range(ring_buffer, ring_buffer_mask, range_start, range_end)?;
            position += best.len;
        } else {
            insert_length += 1;
            position += 1;
            // A lookup that finds nothing is very expensive. After a long time without a match, some are skipped.
            if position > apply_random_heuristics {
                if position > apply_random_heuristics + 4 * random_heuristics_window_size {
                    // It has been so long that the data must be incompressible. Its hashes are not likely to be of use
                    // either, so fewer are stored, which leaves those of compressible data in the table.
                    let margin = (H::STORE_LOOKAHEAD - 1).max(4);
                    let pos_jump = (position + 16).min(pos_end.wrapping_sub(margin));
                    while position < pos_jump {
                        hasher.store(ring_buffer, ring_buffer_mask, position)?;
                        insert_length += 4;
                        position += 4;
                    }
                } else {
                    let margin = (H::STORE_LOOKAHEAD - 1).max(2);
                    let pos_jump = (position + 8).min(pos_end.wrapping_sub(margin));
                    while position < pos_jump {
                        hasher.store(ring_buffer, ring_buffer_mask, position)?;
                        insert_length += 2;
                        position += 2;
                    }
                }
            }
        }
    }
    insert_length += pos_end.wrapping_sub(position);
    *last_insert_len = insert_length;
    Ok(())
}

/// Appends the commands for the `num_bytes` at `position` to `commands`, which has room for one for every 2 bytes.
/// The literals after the last copy are left for the next call, in `last_insert_len`.
pub(crate) fn create_backward_references(
    num_bytes: usize,
    position: usize,
    ring_buffer: &[u8],
    ring_buffer_mask: usize,
    params: &EncoderParams,
    hasher: &mut Hasher,
    dist_cache: &mut [i32; 16],
    last_insert_len: &mut usize,
    commands: &mut Vec<Command>,
    num_literals: &mut usize,
) -> Fallible {
    let dictionary_stats = &mut hasher.dictionary_stats;
    let dictionary_hash = dictionary_hash()?;
    let has_compound_dictionary = !params.dictionary.chunks.is_empty();
    macro_rules! run {
        ($hasher:expr) => {
            run!($hasher, false)
        };
        ($hasher:expr, or_with_compound_dictionary) => {
            if has_compound_dictionary {
                run!($hasher, true)
            } else {
                run!($hasher, false)
            }
        };
        ($hasher:expr, $compound:literal) => {
            create_backward_references_with::<_, $compound>(
                num_bytes,
                position,
                ring_buffer,
                ring_buffer_mask,
                params,
                $hasher,
                dictionary_stats,
                dictionary_hash,
                dist_cache,
                last_insert_len,
                commands,
                num_literals,
            )
            .map_err(Into::into)
        };
    }
    // The hashers of the lowest qualities ignore the compound dictionary.
    match &mut hasher.kind {
        HasherKind::H2(h) => run!(h),
        HasherKind::H3(h) => run!(h),
        HasherKind::H4(h) => run!(h),
        HasherKind::H5(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H6(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H35(h) => run!(h),
        HasherKind::H40(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H41(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H42(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H54(h) => run!(h),
        HasherKind::H55(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H58x16(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H58x32(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H58x16Sparse(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H58x32Sparse(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H65(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H68x16(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H68x32(h) => run!(h, or_with_compound_dictionary),
        HasherKind::H10(_) | HasherKind::NotSetUp => Err(Bug.into()),
    }
}
