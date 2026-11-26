//! Looks for the cheapest way through all matches that there are.

use core::hint::black_box;
use core::ops::RangeInclusive;

use bun_zstd_decoder::Result;
use bun_zstd_decoder::array::{At, allocate, resize};

use super::hash::Hasher;
use super::long_distance::Cursor;
use super::prices::{BIT, LANES, Prices};
use super::tree::{self, Descent, Node, Tree};
use super::{Attached, MatchState, Reach, Search, WORD, prefetch};
use crate::bytes::{likely, u32_at, u64_at};
use crate::parameters::Strategy;
use crate::sequences::{OffsetValue, Repeats, Sequences};
use crate::vec;
use crate::window::{History, WORD_LEN};

/// How far ahead it looks.
const HORIZON: u32 = 1 << 12;
const MAX_PRICE: i32 = 1 << 30;

#[derive(Clone, Copy, Default)]
struct Match {
    offset: OffsetValue,
    len: u32,
}

/// A match, and the literals after it.
#[derive(Clone, Copy, Default)]
struct Stretch {
    offset: OffsetValue,
    match_len: u32,
    literal_len: u32,
}

/// How the cheapest way to a position ends.
#[derive(Clone, Copy, Default)]
struct End {
    stretch: Stretch,
    repeats: Repeats,
}

/// By position. The prices are apart, as several are compared at once.
struct Ways<'a> {
    prices: &'a mut [i32],
    ends: &'a mut [End],
}

impl<'a> Ways<'a> {
    /// How many entries are needed beyond the end of a match.
    const MARGIN: usize = 3 + LANES;

    /// For matches that end at up to `end`. The compiler sees that both have the same length.
    #[inline(always)]
    fn new(prices: &'a mut Vec<i32>, ends: &'a mut Vec<End>, end: u32) -> Option<Self> {
        #[cold]
        #[inline(never)]
        fn lengthen(prices: &mut Vec<i32>, ends: &mut Vec<End>, len: usize) {
            let len = len.min(prices.capacity()).min(ends.capacity());
            resize(prices, len, 0);
            resize(ends, len, End::default());
        }
        let needed = end as usize + Self::MARGIN;
        if prices.len() < needed {
            lengthen(prices, ends, 2 * needed);
        }
        let len = prices.len() as u32 as usize;
        Some(Self {
            prices: prices.get_mut(..len)?,
            ends: ends.get_mut(..len)?,
        })
    }

    #[inline(always)]
    fn price(&self, position: u32) -> Option<i32> {
        likely(self.prices.get(position as usize).copied())
    }

    #[inline(always)]
    fn end(&mut self, position: u32) -> Option<&mut End> {
        likely(self.ends.get_mut(position as usize))
    }

    #[inline(always)]
    fn set(&mut self, position: u32, price: i32, stretch: Stretch) -> Option<()> {
        *likely(self.prices.get_mut(position as usize))? = price;
        self.end(position)?.stretch = stretch;
        Some(())
    }

    /// The recent offsets after a match at `offset` that starts at `position`.
    #[inline(always)]
    fn repeats_after(&mut self, position: u32, offset: OffsetValue) -> Option<Repeats> {
        let End { stretch, repeats } = *self.end(position)?;
        Some(repeats.after(offset, stretch.literal_len != 0))
    }

    /// There is no way to them yet. Also affects some positions after them.
    #[inline(always)]
    fn clear(&mut self, positions: RangeInclusive<u32>) -> Option<()> {
        let mut position = *positions.start() as usize;
        while position <= *positions.end() as usize {
            let lanes = position..position + LANES;
            *likely(self.prices.get_mut(lanes))?.as_mut_array()? = [MAX_PRICE; LANES];
            position += LANES;
        }
        Some(())
    }

    /// Lets the match from `start` take over where it is cheaper, for all lengths from `shortest` on.
    #[inline(always)]
    fn offer(
        &mut self,
        prices: &Prices,
        base_price: i32,
        start: u32,
        shortest: u32,
        found: Match,
    ) -> Option<()> {
        let ending_after = |match_len| Stretch {
            offset: found.offset,
            match_len,
            literal_len: 0,
        };
        let mut len = shortest;
        while len <= found.len
            && let Some(new) = prices.short_match_lens(len)
        {
            let lanes = (start + len) as usize..(start + len) as usize + LANES;
            let old = likely(self.prices.get(lanes))?.as_array::<LANES>()?;
            let mut cheaper = 0u8;
            // Like `equal_bytes()`.
            for lane in 0..LANES {
                cheaper |= u8::from(base_price.wrapping_add(*new.at(lane)) < *old.at(lane)) << lane;
            }
            let mut cheaper = u32::from(cheaper) & !(u32::MAX << (found.len - len + 1).min(31));
            while cheaper != 0 {
                let lane = cheaper.trailing_zeros();
                let price = base_price + new.at(lane as usize % LANES);
                self.set(start + len + lane, price, ending_after(len + lane))?;
                cheaper &= cheaper - 1;
            }
            len += LANES as u32;
        }
        while len <= found.len {
            let price = base_price + prices.match_len(len);
            if price < self.price(start + len)? {
                self.set(start + len, price, ending_after(len))?;
            }
            len += 1;
        }
        Some(())
    }
}

pub(super) struct State {
    prices: Prices,
    /// By length.
    matches: Vec<Match>,
    way_prices: Vec<i32>,
    way_ends: Vec<End>,
}

impl State {
    #[inline(never)]
    pub(super) fn new() -> Result<Box<Self>> {
        allocate(|| Self {
            prices: Prices::EMPTY,
            matches: Vec::new(),
            way_prices: Vec::new(),
            way_ends: Vec::new(),
        })
    }

    pub(super) fn forget(&mut self) {
        self.prices.forget();
    }

    pub(super) fn reserve(&mut self, block_len: usize) -> Result<()> {
        let len = block_len.min(HORIZON as usize) + Ways::MARGIN;
        vec::clear_for(&mut self.matches, len)?;
        vec::make_room(&mut self.way_prices, len)?;
        vec::make_room(&mut self.way_ends, len)
    }
}

pub(super) fn search<const REACH: Reach>(
    state: &mut MatchState,
    search: &Search<'_>,
    attached: &Attached<'_>,
    sequences: &mut Sequences,
    repeats: &mut Repeats,
) -> u32 {
    let mut history = search.history;
    let Some(mut optimal) = state.optimal.take() else {
        return history.start;
    };
    let is_first = optimal.prices.is_empty() && sequences.list.is_empty();
    let mut run = |state: &mut MatchState,
                   history,
                   sequences: &mut Sequences,
                   repeats: &mut Repeats| {
        let search = Search { history, ..*search };
        match state.tuning.strategy {
            Strategy::Optimal => {
                parse::<REACH, false>(state, &mut optimal, &search, attached, sequences, repeats)
            }
            _ => parse::<REACH, true>(state, &mut optimal, &search, attached, sequences, repeats),
        }
    };

    let len = history.block().len();
    if REACH == Reach::Prefix
        && state.tuning.strategy == Strategy::Ultra2
        && is_first
        && history.start == 0
        && len > WORD_LEN
    {
        // Only for the prices. What it put into the tables gets out of reach.
        run(state, history, sequences, &mut { *repeats });
        sequences.list.clear();
        state.window.next += len as u32;
        state.window.raise_start(state.window.next);
        state.next_to_index = state.window.next;
        history.prefix_index = state.window.next;
    }
    let anchor = run(state, history, sequences, repeats);
    state.optimal = Some(optimal);
    anchor
}

#[inline(never)]
fn parse<const REACH: Reach, const IS_ACCURATE: bool>(
    state: &mut MatchState,
    optimal: &mut State,
    search: &Search<'_>,
    attached: &Attached<'_>,
    sequences: &mut Sequences,
    repeats: &mut Repeats,
) -> u32 {
    let (tuning, history) = (state.tuning, &search.history);
    optimal.prices.start_block(history.block(), search.entropy);
    let (min_match, hashed) = (tuning.min_match.min(4), tuning.min_match.min(6));
    let tree = Tree::new(state, hashed);
    let mut finder = Finder {
        history: *history,
        attached: *attached,
        attached_hasher: Hasher::new(hashed, attached.tuning.hash_log),
        hasher3: Hasher::of_3_bytes(tuning.window_log.min(17)),
        next_to_index3: tree.next_to_index,
        tree,
        long_matches: Cursor::new(search.long_matches, history.block().len()),
        min_match,
        min_match_mask: u32::MAX >> (32 - 8 * min_match),
        sufficient_len: tuning.target_length.min(HORIZON - 1),
    };
    let anchor = finder.parse::<REACH, IS_ACCURATE>(optimal, sequences, repeats);
    state.next_to_index = finder.tree.next_to_index;
    // Which the sequences do not add up to.
    anchor.unwrap_or(u32::MAX)
}

struct Finder<'a> {
    history: History<'a>,
    tree: Tree<'a>,
    attached: Attached<'a>,
    attached_hasher: Hasher,
    hasher3: Hasher,
    next_to_index3: u32,
    long_matches: Cursor<'a>,
    /// 3 or 4
    min_match: u32,
    /// For as many bytes.
    min_match_mask: u32,
    /// A longer match is taken right away.
    sufficient_len: u32,
}

#[inline(always)]
fn push(matches: &mut Vec<Match>, offset: OffsetValue, len: u32) {
    _ = matches.push_within_capacity(Match { offset, len });
}

impl Finder<'_> {
    #[inline(always)]
    fn repeat_len<const REACH: Reach>(
        &self,
        history: &History<'_>,
        at: u32,
        value: u32,
        offset: u32,
        lowest: u32,
    ) -> u32 {
        let (current, min_match) = (history.index(at), self.min_match);
        let starts_alike = |other: Option<u32>| {
            other.is_some_and(|other| (other ^ value) & self.min_match_mask == 0)
        };
        let (back, earlier) = (at.wrapping_sub(offset), current.wrapping_sub(offset));
        let is_in_reach = offset.wrapping_sub(1) < current - lowest;
        if back < at {
            if is_in_reach & starts_alike(u32_at(history.prefix, back)) {
                return min_match + history.match_len(at + min_match, back + min_match);
            }
        } else if REACH != Reach::Prefix
            && (REACH == Reach::Attached || is_in_reach)
            && earlier < history.prefix_index
            && starts_alike(u32_at(history.older, history.older_position(earlier)))
        {
            return history.match_len_at_index(at, earlier, min_match);
        }
        0
    }

    /// The last position before `at` with about the same 3 bytes.
    #[inline(always)]
    fn find3(&mut self, history: &History<'_>, at: u32, word: u64) -> Option<u32> {
        #[inline(never)]
        fn fill(table: &mut [u32], hasher: Hasher, bytes: &[u8], first: u32) -> Option<()> {
            // Without a way out, the loop gets unrolled.
            let mask = (table.len() as u32).wrapping_sub(1) as usize;
            let (table, last) = (table.get_mut(..mask + 1)?, bytes.len().checked_sub(4)?);
            for at in 0..last + 1 {
                let word = u32::from_le_bytes(*bytes.get(at..at + 4)?.as_array()?);
                *table.get_mut(hasher.hash(word.into()) & mask)? = first + at as u32;
            }
            Some(())
        }
        let current = history.index(at);
        let first = core::mem::replace(&mut self.next_to_index3, current);
        if first + 1 == current {
            let word = u64_at(history.prefix, at.wrapping_sub(1))?;
            *self.tree.hash3.get_mut(self.hasher3.hash(word))? = first;
        } else if first < current {
            let bytes = history.position(first) as usize..at as usize + 3;
            fill(
                self.tree.hash3,
                self.hasher3,
                history.prefix.get(bytes)?,
                first,
            )?;
        }
        prefetch(self.tree.hash3, self.hasher3.hash(word >> 16));
        self.tree.hash3.get(self.hasher3.hash(word)).copied()
    }

    /// Each match is longer than the one before.
    #[inline(always)]
    fn find_near<const REACH: Reach>(
        &mut self,
        history: &History<'_>,
        at: u32,
        repeats: Repeats,
        has_literals: bool,
        matches: &mut Vec<Match>,
    ) -> Option<()> {
        let current = history.index(at);
        let nodes = self.tree.nodes.checked()?;
        self.tree.prefetch_after(history, nodes, at);
        self.tree.insert_up_to::<REACH>(history, at)?;

        let word = likely(u64_at(history.prefix, at))?;
        if REACH == Reach::Attached {
            tree::prefetch_attached(&self.attached, history, self.attached_hasher, word);
        }
        let left = history.end() - at;
        let lowest = self.tree.bounds.lowest(current);
        let sufficient_len = self.sufficient_len;
        let mut longest = self.min_match - 1;

        let mut is_enough = #[inline(always)]
        |value, offset| {
            let len = self.repeat_len::<REACH>(history, at, word as u32, offset, lowest);
            len > longest && {
                longest = len;
                push(matches, OffsetValue(value), len);
                len > sufficient_len || len == left
            }
        };
        // The compiler does not always unroll a loop.
        let [first, second, third] = repeats.numbered(has_literals);
        if is_enough(1, first) || is_enough(2, second) || is_enough(3, third) {
            return Some(());
        }

        if self.min_match == 3 && longest < 3 {
            let index = self.find3(history, at, word)?;
            // From further away it would cost too much.
            if index >= lowest && current - index < 1 << 18 {
                let len = match REACH {
                    Reach::Older => history.match_len_at_index(at, index, 0),
                    _ => history.match_len(at, history.position(index)),
                };
                if len >= 3 {
                    longest = len;
                    push(matches, OffsetValue::new(current - index), len);
                    if len > sufficient_len || len == left {
                        self.tree.next_to_index = current + 1;
                        return Some(());
                    }
                }
            }
        }

        let root = likely(self.tree.roots.get_mut(self.tree.hasher.hash(word)))?;
        let index = core::mem::replace(root, current);
        let attached_root = match REACH {
            Reach::Attached => *likely(self.attached.hash.get(self.attached_hasher.hash(word)))?,
            _ => 0,
        };
        self.tree.next_to_index = if index >= lowest || tree::is_attached_node(attached_root) {
            self.descend::<REACH>(at, index, lowest, longest, matches, attached_root)?
        } else {
            Descent::new(nodes.get(current)?, at).finish();
            current + 1
        };
        Some(())
    }

    /// Adds the matches in the trees at `index` and `attached_root` that are longer than `longest`. Returns what to index next.
    #[inline(never)]
    fn descend<const REACH: Reach>(
        &self,
        at: u32,
        mut index: u32,
        lowest: u32,
        mut longest: u32,
        matches: &mut Vec<Match>,
        attached_root: u32,
    ) -> Option<u32> {
        let history = self.history.with_prefix_of::<WORD_LEN>()?;
        let nodes = self.tree.nodes.checked()?;
        let (current, left) = (history.index(at), history.end() - at);
        let overwritten = nodes.overwritten(current);
        let spare = Node::default();
        let mut descent = Descent::new(nodes.get(current)?, at);
        let mut matched_end = current + WORD + 1;
        let mut attempts = self.tree.attempts;
        let mut note = #[inline(always)]
        |index: u32, len: u32| {
            if len <= longest {
                return false;
            }
            matched_end = matched_end.max(index + len);
            longest = len;
            push(matches, OffsetValue::new(current - index), len);
            len > HORIZON || len == left
        };

        while attempts > 0 && index >= lowest {
            let node = nodes.get(index)?;
            let (end, is_smaller) = tree::compare::<REACH>(&history, at, index, descent.known);
            if note(index, end - at) {
                attempts = 0;
                break;
            }
            if index <= overwritten {
                descent.step(index, &spare, end, is_smaller);
                break;
            }
            index = descent.step(index, node, end, is_smaller);
            attempts -= 1;
        }
        descent.finish();

        if REACH == Reach::Attached {
            tree::descend_attached(&self.attached, &history, at, attached_root, attempts, note)?;
        }
        Some(matched_end - WORD)
    }

    #[inline(always)]
    fn find<const REACH: Reach>(
        &mut self,
        history: &History<'_>,
        at: u32,
        repeats: Repeats,
        has_literals: bool,
        matches: &mut Vec<Match>,
    ) -> Option<()> {
        matches.clear();
        if history.index(at) >= self.tree.next_to_index {
            self.find_near::<REACH>(history, at, repeats, has_literals, matches)?;
        }
        let long = self.long_matches.at(at - history.start, history.end() - at);
        if let Some((offset, len)) = long
            && len >= self.min_match
            && matches.last().is_none_or(|last| len > last.len)
        {
            push(matches, OffsetValue::new(offset), len);
        }
        Some(())
    }

    /// Returns where the last match ends.
    #[inline(always)]
    fn parse<const REACH: Reach, const IS_ACCURATE: bool>(
        &mut self,
        State {
            prices,
            matches,
            way_prices,
            way_ends,
        }: &mut State,
        sequences: &mut Sequences,
        repeats: &mut Repeats,
    ) -> Option<u32> {
        let mut anchor = self.history.start;
        let Some(history) = self.history.with_prefix_of::<WORD_LEN>() else {
            return Some(anchor);
        };
        let (prefix, limit) = (history.prefix, history.end() - WORD);
        let mut ways = Ways::new(way_prices, way_ends, 0)?;
        let mut at = anchor + u32::from(anchor == 0);
        let mut is_first_match = true;

        'block: while at < limit {
            self.find::<REACH>(&history, at, *repeats, at != anchor, matches)?;
            if matches.is_empty() {
                at += 1;
                continue;
            }
            if core::mem::take(&mut is_first_match) {
                prices.derive::<IS_ACCURATE>();
            }
            // What the literals so far cost is the same for all ways, unlike their number.
            let mut here = Stretch {
                literal_len: at - anchor,
                ..Stretch::default()
            };
            let mut here_repeats = *repeats;
            ways.set(0, prices.literal_len(here.literal_len), here)?;
            ways.end(0)?.repeats = here_repeats;
            let (mut current, mut end) = (0, 0);

            // The last stretch, and where it starts.
            let (last, last_start) = 'forward: loop {
                if let Some(&longest) = matches.last() {
                    let longest_end = current + longest.len;
                    if longest.len > self.sufficient_len
                        || ((longest_end >= HORIZON || at + longest_end >= history.end())
                            && current != 0)
                    {
                        *repeats = ways.repeats_after(current, longest.offset)?;
                        let last = Stretch {
                            offset: longest.offset,
                            match_len: longest.len,
                            literal_len: 0,
                        };
                        break 'forward (last, current);
                    }

                    if longest_end > end {
                        ways = Ways::new(way_prices, way_ends, longest_end)?;
                        ways.clear(end + 1..=longest_end + 1)?;
                        end = longest_end;
                    } else {
                        *ways.prices.get_mut(end as usize + 1)? = MAX_PRICE;
                    }
                    let base_price = ways.price(current)? + prices.literal_len(0);
                    let mut shortest = self.min_match;
                    for &found in matches.iter() {
                        let base_price = base_price + prices.offset::<IS_ACCURATE>(found.offset);
                        if IS_ACCURATE {
                            ways.offer(prices, base_price, current, shortest, found)?;
                        } else {
                            let mut match_len = found.len;
                            while match_len >= shortest {
                                let price = base_price + prices.match_len(match_len);
                                if price >= ways.price(current + match_len)? {
                                    break;
                                }
                                let stretch = Stretch {
                                    offset: found.offset,
                                    match_len,
                                    literal_len: 0,
                                };
                                ways.set(current + match_len, price, stretch)?;
                                match_len -= 1;
                            }
                        }
                        shortest = found.len + 1;
                    }
                }

                // On to the next position that is worth a search.
                loop {
                    if current >= end {
                        if here.match_len == 0 {
                            at += end;
                            continue 'block;
                        }
                        *repeats = here_repeats;
                        break 'forward (here, end - here.match_len - here.literal_len);
                    }
                    let with_literal = ways.price(current)?
                        + prices.literal(*likely(prefix.get((at + current) as usize))?)
                        + prices.one_more_literal(here.literal_len);
                    current += 1;

                    let (mut price, ending_here) =
                        (ways.price(current)?, ways.end(current)?.stretch);
                    if with_literal <= price {
                        here.literal_len += 1;
                        ways.set(current, with_literal, here)?;
                        // The match may still be the better start for the literal after it.
                        if IS_ACCURATE
                            && ending_here.literal_len == 0
                            && price != MAX_PRICE
                            && prices.one_more_literal(0) < 0
                            && let Some(&next) = prefix.get((at + current) as usize)
                        {
                            let next = prices.literal(next);
                            let after_match = price + next + prices.one_more_literal(0);
                            let after_literals =
                                with_literal + next + prices.one_more_literal(here.literal_len);
                            if after_match < after_literals
                                && after_match < ways.price(current + 1)?
                            {
                                let start = current - ending_here.match_len;
                                ways.end(current + 1)?.repeats =
                                    ways.repeats_after(start, ending_here.offset)?;
                                let stretch = Stretch {
                                    literal_len: 1,
                                    ..ending_here
                                };
                                ways.set(current + 1, after_match, stretch)?;
                                end = end.max(current + 1);
                            }
                        }
                        price = with_literal;
                    } else {
                        here = ending_here;
                        here_repeats = if here.literal_len == 0 {
                            ways.repeats_after(current - here.match_len, here.offset)?
                        } else {
                            ways.end(current)?.repeats
                        };
                    }
                    ways.end(current)?.repeats = here_repeats;

                    if at + current <= limit
                        && current != end
                        && (IS_ACCURATE || ways.price(current + 1)? > price + BIT / 2)
                    {
                        break;
                    }
                }
                // Or else the loop above keeps track of all that the search derives from it.
                let (position, has_literals) = (black_box(at + current), here.literal_len != 0);
                self.find::<REACH>(&history, position, here_repeats, has_literals, matches)?;
            };

            // Going back, each match gets the literals in front of it. They are stored in what was passed.
            let stored_end = last_start + 2;
            let (mut stored_start, mut position, mut next) = (stored_end, last_start, last);
            loop {
                let stretch = ways.end(position)?.stretch;
                next.literal_len = stretch.literal_len;
                ways.end(stored_start)?.stretch = next;
                if stretch.match_len == 0 {
                    break;
                }
                (stored_start, next) = (stored_start - 1, stretch);
                position -= stretch.literal_len + stretch.match_len;
            }

            for stored in stored_start..=stored_end {
                let stored = ways.end(stored)?.stretch;
                let start = anchor + stored.literal_len;
                let literals = prefix.get(anchor as usize..start as usize)?;
                prices.add::<IS_ACCURATE>(literals, stored.offset, stored.match_len);
                sequences.push(stored.literal_len, stored.offset, stored.match_len);
                anchor = start + stored.match_len;
            }
            at = anchor;
            prices.update::<IS_ACCURATE>();
        }
        Some(anchor)
    }
}
