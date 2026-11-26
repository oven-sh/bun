//! Turns blocks of input into commands.

use super::command::{Command, Commands, DISTANCE_CODE_OFFSET};
use super::hash::{
    BinaryTree, Buckets, Chains, Dense, ForgetfulChains, Hasher, Linked, MAX_SMALL_INPUT_SIZE,
    MIN_SCORE, Match, Paged, Quick, RecentDistances, Search, Small, TaggedBuckets, WithRolling,
    jump, prefetch,
};
use super::input_block::InputBlock;
use super::params::LARGE_INPUT_SIZE;
use super::prepared_dictionary::PreparedDictionary;
use super::ring_buffer::SLACK;
use super::zopfli;
use crate::format::{MAX_WINDOW_BITS, SHORT_CODE_BASES, SHORT_CODE_DELTAS};
use crate::memory::Result;

type Quick2<S> = Quick<S, 1, 5, true>;
type Quick3<S> = Quick<S, 2, 5, false>;
type Quick4<S> = Quick<S, 4, 5, true>;
type Quick4Large = Quick<Dense<{ 1 << 20 }>, 4, 7, false>;
type Tagged5Large = TaggedBuckets<true, { 1 << 15 }, 16>;
type Tagged6Large = TaggedBuckets<true, { 1 << 15 }, 32>;

pub(super) enum MatchFinder {
    Quick2(Quick2<Dense<{ 1 << 16 }>>),
    Quick2Small(Quick2<Linked>),
    Quick3(Quick3<Dense<{ 1 << 16 }>>),
    Quick3Small(Quick3<Paged<{ 1 << 13 }>>),
    Quick3Rolling(WithRolling<Quick3<Dense<{ 1 << 16 }>>, 4>),
    Quick4(Quick4<Dense<{ 1 << 17 }>>),
    Quick4Small(Quick4<Paged<{ 1 << 14 }>>),
    Quick4Large(Quick4Large),
    Quick4LargeRolling(WithRolling<Quick4Large, 4>),
    Tagged5(TaggedBuckets<false, { 1 << 14 }, 16>),
    Tagged6(TaggedBuckets<false, { 1 << 14 }, 32>),
    Tagged5Large(Tagged5Large),
    Tagged6Large(Tagged6Large),
    Tagged5LargeRolling(WithRolling<Tagged5Large, 1>),
    Tagged6LargeRolling(WithRolling<Tagged6Large, 1>),
    SmallSoFar(Small<{ 1 << 14 }>),
    /// For a single block.
    Small(Small<{ 1 << 15 }>),
    Buckets(Buckets<false>),
    BucketsLarge(Buckets<true>),
    BucketsLargeRolling(WithRolling<Buckets<true>, 1>),
    Chains(Chains),
    ForgetfulChains(ForgetfulChains),
    BinaryTree(BinaryTree),
}

impl MatchFinder {
    /// For quality 2 and above.
    #[inline(never)]
    pub(super) fn new(first: &InputBlock<'_>) -> Result<Self> {
        let params = first.params;
        let quality = params.quality;
        // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/quality.h#L156
        let large_input = params.size_hint >= LARGE_INPUT_SIZE;
        let rolling = params.window_bits > MAX_WINDOW_BITS;
        let recent_count = match quality {
            ..7 => 4,
            7 | 8 => 10,
            _ => 16,
        };
        let max_small_size = match quality {
            ..4 | 10.. => 1 << 11,
            4 => 1 << 12,
            _ => MAX_SMALL_INPUT_SIZE,
        };
        let is_small = first.is_last && first.end() <= max_small_size;
        let bucket_size_bits = quality - 1;
        Ok(match (quality, is_small.then_some(first.end())) {
            (..=2, Some(size)) => Self::Quick2Small(Quick::new(Linked::new(size)?)),
            (..=2, None) => Self::Quick2(Quick::new(Dense::new()?)),
            (3, _) if rolling => Self::Quick3Rolling(WithRolling::new(Quick::new(Dense::new()?))?),
            (3, Some(size)) => Self::Quick3Small(Quick::new(Paged::new(size)?)),
            (3, None) => Self::Quick3(Quick::new(Dense::new()?)),
            (4, _) if large_input && rolling => {
                Self::Quick4LargeRolling(WithRolling::new(Quick::new(Dense::new()?))?)
            }
            (4, _) if large_input => Self::Quick4Large(Quick::new(Dense::new()?)),
            (4, Some(size)) => Self::Quick4Small(Quick::new(Paged::new(size)?)),
            (4, None) => Self::Quick4(Quick::new(Dense::new()?)),
            (10.., size) => Self::BinaryTree(BinaryTree::new(params.window_bits, size)?),
            _ if params.window_bits <= 16 => {
                let max_hops = if quality > 6 { 7 } else { 8 } << (quality - 4);
                if quality < 9 || (first.is_last && first.end() <= ForgetfulChains::BANK_SIZE) {
                    Self::Chains(Chains::new(max_hops, recent_count)?)
                } else {
                    Self::ForgetfulChains(ForgetfulChains::new(max_hops, recent_count)?)
                }
            }
            _ if large_input && params.window_bits >= 19 => match quality {
                5 if rolling => Self::Tagged5LargeRolling(WithRolling::new(TaggedBuckets::new()?)?),
                6 if rolling => Self::Tagged6LargeRolling(WithRolling::new(TaggedBuckets::new()?)?),
                _ if rolling => {
                    Self::BucketsLargeRolling(WithRolling::new(Buckets::new(bucket_size_bits)?)?)
                }
                5 => Self::Tagged5Large(TaggedBuckets::new()?),
                6 => Self::Tagged6Large(TaggedBuckets::new()?),
                _ => Self::BucketsLarge(Buckets::new(bucket_size_bits)?),
            },
            (5 | 6, _) if is_small || first.length < max_small_size => {
                Self::SmallSoFar(Small::new(1 << bucket_size_bits, recent_count)?)
            }
            (5, _) => Self::Tagged5(TaggedBuckets::new()?),
            (6, _) => Self::Tagged6(TaggedBuckets::new()?),
            // Following up to 256 links takes longer than reading a bucket.
            (_, Some(size)) if quality < 9 || size <= MAX_SMALL_INPUT_SIZE / 2 => {
                Self::Small(Small::new(1 << bucket_size_bits, recent_count)?)
            }
            _ => Self::Buckets(Buckets::new(bucket_size_bits)?),
        })
    }

    /// For what follows the first `covered` bytes. `positions_wrapped`: since the previous block.
    #[inline(never)]
    pub(super) fn add_commands(
        &mut self,
        block: &InputBlock<'_>,
        covered: usize,
        positions_wrapped: bool,
        commands: &mut Commands,
    ) -> Result<()> {
        if let Self::SmallSoFar(small) = self
            && block.end() > MAX_SMALL_INPUT_SIZE
        {
            *self = match block.params.quality {
                5 => Self::Tagged5(TaggedBuckets::after(small, block)?),
                _ => Self::Tagged6(TaggedBuckets::after(small, block)?),
            };
        }
        let dictionary = block.dictionary;
        let mut greedy = Greedy {
            block,
            covered,
            skip_after: None,
            positions_wrapped,
            commands,
        };
        // The output depends on which of them search the dictionary.
        match self {
            Self::Quick2(hasher) => greedy.run(hasher, None),
            Self::Quick2Small(hasher) => greedy.run(hasher, None),
            Self::Quick3(hasher) => greedy.run(hasher, None),
            Self::Quick3Small(hasher) => greedy.run(hasher, None),
            Self::Quick3Rolling(hasher) => greedy.run(hasher, None),
            Self::Quick4(hasher) => greedy.run(hasher, None),
            Self::Quick4Small(hasher) => greedy.run(hasher, None),
            Self::Quick4Large(hasher) => greedy.run(hasher, None),
            Self::Quick4LargeRolling(hasher) => greedy.run(hasher, dictionary),
            Self::Tagged5(hasher) => greedy.run(hasher, dictionary),
            Self::Tagged6(hasher) => greedy.run(hasher, dictionary),
            Self::Tagged5Large(hasher) => greedy.run(hasher, dictionary),
            Self::Tagged6Large(hasher) => greedy.run(hasher, dictionary),
            Self::Tagged5LargeRolling(hasher) => greedy.run(hasher, dictionary),
            Self::Tagged6LargeRolling(hasher) => greedy.run(hasher, dictionary),
            Self::SmallSoFar(hasher) => greedy.run(hasher, dictionary),
            Self::Small(hasher) => {
                debug_assert!(block.position == 0 && block.is_last);
                greedy.begin(hasher)?;
                greedy.go_on(hasher, dictionary, |small, position| {
                    Buckets::should_replace(small, position, block.length)
                });
                if greedy.covered < block.length {
                    let mut buckets = Buckets::after(hasher, block, greedy.covered)?;
                    greedy.go_on(&mut buckets, dictionary, never);
                }
                Ok(())
            }
            Self::Buckets(hasher) => greedy.run(hasher, dictionary),
            Self::BucketsLarge(hasher) => greedy.run(hasher, dictionary),
            Self::BucketsLargeRolling(hasher) => greedy.run(hasher, dictionary),
            Self::Chains(hasher) => greedy.run(hasher, dictionary),
            Self::ForgetfulChains(hasher) => greedy.run(hasher, dictionary),
            Self::BinaryTree(tree) => {
                if positions_wrapped {
                    tree.clear();
                }
                tree.begin_block(block)?;
                zopfli::add_commands(tree, &block.without_first(covered), commands)
            }
        }
    }
}

struct Greedy<'a, 'b> {
    block: &'b InputBlock<'a>,
    covered: usize,
    /// As another table left it in this block.
    skip_after: Option<usize>,
    positions_wrapped: bool,
    commands: &'b mut Commands,
}

impl Greedy<'_, '_> {
    fn run<H: Hasher>(
        &mut self,
        hasher: &mut H,
        searched: Option<&PreparedDictionary>,
    ) -> Result<()> {
        self.begin(hasher)?;
        self.go_on(hasher, searched, never);
        Ok(())
    }

    fn begin(&mut self, hasher: &mut impl Hasher) -> Result<()> {
        if self.positions_wrapped {
            hasher.clear();
        }
        let block = self.block;
        hasher.try_reserve(block)?;
        hasher.begin_block(block.window, block.position, block.length);
        self.commands.try_reserve(block.length / 2 + 1)
    }

    /// Up to the end of the block, or to where it `is_enough`.
    fn go_on<H: Hasher>(
        &mut self,
        hasher: &mut H,
        searched: Option<&PreparedDictionary>,
        is_enough: impl Fn(&H, usize) -> bool,
    ) {
        let (end, skip_after) = add_greedily(
            hasher,
            &self.block.without_first(self.covered),
            self.skip_after,
            searched,
            is_enough,
            self.commands,
        );
        (self.covered, self.skip_after) = (end - self.block.position, Some(skip_after));
    }
}

fn never<H>(_: &H, _: usize) -> bool {
    false
}

#[inline(always)]
fn set_recent(recent: &mut RecentDistances, last: [i32; 4], count: usize) {
    let near = |distance: i32| -> [i32; 6] {
        core::array::from_fn(|i| distance + i32::from(SHORT_CODE_DELTAS[4 + i]))
    };
    recent[..4].copy_from_slice(&last);
    if count > 4 {
        recent[4..10].copy_from_slice(&near(last[0]));
        if count > 10 {
            recent[10..].copy_from_slice(&near(last[1]));
        }
    }
}

/// For each difference from -3 to 3, a nibble with the short code that adds it to the last distance number `base`.
const fn codes_near(base: u8) -> usize {
    let (mut nibbles, mut code) = (0, 0);
    while code < SHORT_CODE_BASES.len() {
        if SHORT_CODE_BASES[code] == base {
            nibbles |= code << (4 * (SHORT_CODE_DELTAS[code] + 3));
        }
        code += 1;
    }
    nibbles
}

#[inline(always)]
fn short_code(distance: usize, last: [i32; 4]) -> Option<usize> {
    let [a, b, c, d] = last.map(|distance| distance as usize);
    let near_a = (distance + 3).wrapping_sub(a);
    let near_b = (distance + 3).wrapping_sub(b);
    Some(if distance == a {
        0
    } else if distance == b {
        1
    } else if near_a < 7 {
        (const { codes_near(0) } >> (4 * near_a)) & 0xF
    } else if near_b < 7 {
        (const { codes_near(1) } >> (4 * near_b)) & 0xF
    } else if distance == c {
        2
    } else if distance == d {
        3
    } else {
        return None;
    })
}

#[inline(always)]
fn find<H: Hasher>(
    hasher: &mut H,
    search: &Search<'_>,
    searched_dictionary: Option<&PreparedDictionary>,
    recent: &RecentDistances,
    longer_than: usize,
) -> Match {
    let best = hasher.find(search, recent, longer_than);
    let (Some(dictionary), &[a, b, c, d, ..]) = (searched_dictionary, recent) else {
        return best;
    };
    // Field by field, so that `best` can stay in registers.
    let query = search.block.query_at(search.position);
    let improved = dictionary.improve(&query, [a, b, c, d], Match { ..best });
    Match { ..improved }
}

/// Takes the best match at a position, unless the next position has a much better one. Returns where it stopped, and `skip_after`.
#[inline(never)]
#[cfg_attr(mordant, allow(generic_body_not_generic))] // The locals of the loop, which stay in registers.
fn add_greedily<H: Hasher>(
    hasher: &mut H,
    block: &InputBlock<'_>,
    skip_after: Option<usize>,
    searched: Option<&PreparedDictionary>,
    is_enough: impl Fn(&H, usize) -> bool,
    commands: &mut Commands,
) -> (usize, usize) {
    const LAZY_MARGIN: usize = 175;
    /// From one that the longest jumps follow.
    const SIXTH_SEARCH: usize = 17 * 6;
    let block = *block;
    let store_end = block.store_end(H::LOOKAHEAD);
    let patience = if block.params.quality < 9 { 64 } else { 512 };
    let may_prune = block.is_contiguous() && searched.is_none();
    let mut position = block.position;
    let mut padded = block.padded();
    let mut literals_start = position - commands.pending_literals;
    let mut skip_after = skip_after.unwrap_or(position + patience);
    let mut recent = RecentDistances::default();
    set_recent(&mut recent, commands.last_distances, hasher.recent_count());

    let end = 'block: loop {
        let mut best = loop {
            if padded.len() <= H::LOOKAHEAD + SLACK {
                break 'block block.end();
            }
            let jumps = position >= skip_after;
            prefetch(hasher, padded, if jumps { SIXTH_SEARCH } else { 1 });
            let search = block.search_at(position, padded);
            let best = find(hasher, &search, searched, &recent, 0);
            if best.score != MIN_SCORE {
                break best;
            }
            position += 1;
            padded = &padded[1..];
            if position > skip_after {
                let is_hopeless = position > skip_after + 4 * patience;
                let step = if is_hopeless { 4 } else { 2 };
                (position, padded) = jump(hasher, &block, position, padded, step);
                if is_hopeless && searched.is_none() {
                    (position, padded) = hasher.skip(&block, position, padded, recent[0]);
                }
            }
            if is_enough(hasher, position) {
                break 'block position;
            }
        };

        for _ in 0..4 {
            let after = &padded[1..];
            let to_beat = best.score + LAZY_MARGIN - 1;
            let search = Search {
                to_beat: if may_prune { to_beat } else { 0 },
                ..block.search_at(position + 1, after)
            };
            let next = find(hasher, &search, searched, &recent, best.length - 1);
            if next.score <= to_beat {
                break;
            }
            position += 1;
            padded = after;
            best = next;
            if padded.len() <= H::LOOKAHEAD + SLACK {
                break;
            }
        }
        skip_after = position + 2 * best.length + patience;
        prefetch(hasher, padded, best.length);

        let mut code = best.distance + DISTANCE_CODE_OFFSET;
        if best.distance <= block.max_copy_distance(position) {
            let [a, b, c, d, ..] = recent;
            code = short_code(best.distance, [a, b, c, d]).unwrap_or(code);
            if code > 0 {
                let last = [best.distance as i32, a, b, c];
                set_recent(&mut recent, last, hasher.recent_count());
            }
        }
        let literals = position - literals_start;
        commands.list.push(Command::new(
            &block.params.distance,
            literals,
            best.length,
            best.length + best.omitted,
            code,
        ));
        commands.literal_count += literals;

        let stored_end = best.length.min(store_end.saturating_sub(position));
        let mut stored_start = 2;
        if best.distance < best.length >> 2 {
            stored_start = stored_start.max(best.length - (best.distance << 2));
        }
        if let Some(covered) = padded.get(stored_start..stored_end + SLACK) {
            hasher.store_all(covered, position + stored_start);
        }
        position += best.length;
        padded = &padded[best.length..];
        literals_start = position;
        if is_enough(hasher, position) {
            break position;
        }
    };
    let [a, b, c, d, ..] = recent;
    commands.last_distances = [a, b, c, d];
    commands.pending_literals = end - literals_start;
    (end, skip_after)
}
