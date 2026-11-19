//! Chooses between literals and matches on the way through the input, for levels 1 to 9.

use crate::block::{Frequencies, Sequence, Stream};
use crate::block_splitter::{
    MIN_BLOCK_LEN, OBSERVATIONS_PER_CHECK, Observations, SOFT_MAX_BLOCK_LEN, max_block_end,
    may_split, observations, should_split,
};
use crate::format::{MAX_MATCH_LEN, MIN_MATCH_LEN};
use crate::hash_chains::{self, HashChains, MAX_OFFSET_OF_3};
use crate::hash_table::HashTable;
use crate::window::{Bytes, MatchFinder, Window, reach};
use crate::{Result, hash_lists, wrapped_mut};
use core::hint::cold_path;

#[derive(Clone, Copy)]
pub(crate) struct Effort {
    /// How many nodes a search looks at.
    pub(crate) max_depth: usize,
    /// A match that is this long ends the search.
    pub(crate) nice_len: usize,
}

/// The fewer different literals there are, the less they cost, and the longer a match has to be to beat them.
pub(crate) fn min_match_len(used_literals: usize, max_depth: usize) -> usize {
    let min_len = match used_literals {
        ..6 => 9,
        6..8 => 8,
        8..10 => 7,
        10..16 => 6,
        16..45 => 5,
        45..80 => 4,
        _ => return MIN_MATCH_LEN,
    };
    min_len.min(match max_depth {
        ..10 => 5,
        10..16 => 7,
        _ => 9,
    })
}

pub(crate) fn initial_min_match_len(data: &[u8], max_depth: usize) -> usize {
    // The static code has a good chance here, and it has no cheap literals.
    if data.len() < 512 {
        return MIN_MATCH_LEN;
    }
    let mut used = [0u8; 256];
    for &byte in data.iter().take(4096) {
        *wrapped_mut(&mut used, byte.into()) = 1;
    }
    min_match_len(used.iter().map(|&used| usize::from(used)).sum(), max_depth)
}

fn updated_min_match_len(frequencies: &Frequencies, max_depth: usize) -> usize {
    let literals = frequencies.literals();
    let cutoff = literals.iter().sum::<u32>() >> 10;
    let used = literals.iter().filter(|&&frequency| frequency > cutoff);
    min_match_len(used.count(), max_depth)
}

/// The nodes that a parser handles in one go.
struct Span<'a> {
    window: &'a Bytes,
    input_end: usize,
    /// The lesser of the two below. No search starts here or later, unless a match is being deferred.
    stop: usize,
    /// Where [`compress`] has something to do, however many symbols it takes.
    last_stop: usize,
    /// Where the symbols until the next check run out, if all that follow are literals.
    symbols_end: usize,
    /// Wraps around if it is before the window.
    after_match: usize,
    frequencies: &'a mut Frequencies,
    sequences: core::slice::IterMut<'a, Sequence>,
}

impl Span<'_> {
    #[inline(always)]
    fn choose_literal(&mut self, node: usize) {
        self.frequencies.add_literal(reach(self.window, node)[0]);
    }

    #[inline(always)]
    fn choose_match(&mut self, node: usize, len: usize, offset: usize) {
        let literals = node.wrapping_sub(self.after_match);
        let sequence = Sequence::new(literals, len, offset, self.frequencies);
        if let Some(to) = self.sequences.next() {
            *to = sequence;
        }
        self.after_match = node + len;
        self.symbols_end += len - 1;
        self.stop = self.symbols_end.min(self.last_stop);
    }
}

#[derive(Clone, Copy)]
struct Limits {
    soft_max_block_len: usize,
    max_sequences: usize,
    /// `None` if blocks are not split and matches have no minimum length.
    max_depth: Option<usize>,
    updates_min_len: bool,
}

/// `parse` takes the first node and the length of the shortest match. It returns the node after the last.
#[inline(always)]
fn compress<F: MatchFinder>(
    mut window: Window<'_>,
    mut finder: F,
    sequences: &mut Vec<Sequence>,
    stream: &mut Stream<'_, '_>,
    limits: Limits,
    parse: impl Fn(&mut F, &mut Span<'_>, usize, usize) -> usize,
) -> Result<()> {
    let input = window.input();
    let most_sequences = limits.max_sequences.min(input.len() / MIN_MATCH_LEN);
    sequences.try_reserve_exact(most_sequences.saturating_sub(sequences.len()))?;
    let mut position = 0;
    while position < input.len() {
        let start = position;
        let max_end = max_block_end(start, input.len(), limits.soft_max_block_len);
        let mut frequencies = Frequencies::EMPTY;
        let (mut sequence_count, mut after_match) = (0, start);
        let (mut unchecked, mut checked) = (0, Observations::default());
        let mut min_len = limits.max_depth.map_or(0, |max_depth| {
            initial_min_match_len(input.get(start..max_end).unwrap_or_default(), max_depth)
        });
        let mut next_update = start + 10000;

        loop {
            let mut last_stop = window.advance(position, &mut finder).min(max_end);
            if let (Some(max_depth), true) = (limits.max_depth, limits.updates_min_len) {
                if position >= next_update {
                    min_len = updated_min_match_len(&frequencies, max_depth);
                    next_update += position - start;
                }
                last_stop = last_stop.min(next_update);
            }
            let mut symbols = OBSERVATIONS_PER_CHECK.min(limits.max_sequences - sequence_count);
            if unchecked < OBSERVATIONS_PER_CHECK {
                symbols = symbols.min(OBSERVATIONS_PER_CHECK - unchecked);
            } else if position < start + MIN_BLOCK_LEN {
                last_stop = last_stop.min(start + MIN_BLOCK_LEN);
            }
            let room = most_sequences.min(sequence_count + symbols);
            if sequences.len() < room {
                sequences.resize(room, Sequence::default());
            }

            let node = window.node_at(position);
            let last_stop = window.node_at(last_stop);
            let unused = sequences.get_mut(sequence_count..).unwrap_or_default();
            let unused_count = unused.len();
            let mut span = Span {
                window: window.bytes(),
                input_end: window.input_end(),
                stop: last_stop.min(node + symbols),
                last_stop,
                symbols_end: node + symbols,
                after_match: node.wrapping_sub(position - after_match),
                frequencies: &mut frequencies,
                sequences: unused.iter_mut(),
            };
            let end = parse(&mut finder, &mut span, node, min_len);
            position = window.position_of(end);
            after_match = position - end.wrapping_sub(span.after_match);
            unchecked += symbols + end - span.symbols_end;
            sequence_count += unused_count - span.sequences.len();

            if position >= max_end || sequence_count >= limits.max_sequences {
                break;
            }
            if limits.max_depth.is_some()
                && unchecked >= OBSERVATIONS_PER_CHECK
                && may_split(position - start, input.len() - position)
            {
                let all = observations(&frequencies);
                let mut new = all;
                new.iter_mut().zip(checked).for_each(|(a, b)| *a -= b);
                if should_split(&checked, &new, position - start) {
                    break;
                }
                (unchecked, checked) = (0, all);
            }
        }
        stream.write_block(
            input.get(start..position).unwrap_or_default(),
            sequences.get(..sequence_count).unwrap_or_default(),
            &frequencies,
            &frequencies.lens(),
            position == input.len(),
        )?;
    }
    Ok(())
}

#[inline(never)]
pub(crate) fn compress_fastest(
    window: Window<'_>,
    storage: &mut hash_lists::Storage,
    sequences: &mut Vec<Sequence>,
    stream: &mut Stream<'_, '_>,
) -> Result<()> {
    let limits = Limits {
        soft_max_block_len: 65535,
        max_sequences: 8192,
        max_depth: None,
        updates_min_len: false,
    };
    let table = HashTable::new(storage, window.input().len())?;
    compress(
        window,
        table,
        sequences,
        stream,
        limits,
        #[inline(always)]
        |table, span, mut node, _| {
            while node < span.stop {
                let max_len = span.input_end - node;
                let (len, offset) = table.longest_match(span.window, node, max_len, 32);
                if len == 0 {
                    span.choose_literal(node);
                    node += 1;
                } else {
                    span.choose_match(node, len, offset);
                    node += len;
                }
            }
            node
        },
    )
}

/// Takes the longest match.
pub(crate) const GREEDY: usize = 0;
/// Defers a match if there is a better one at the next byte.
pub(crate) const LAZY: usize = 1;
/// Defers a match if there is a better one at one of the next two bytes.
pub(crate) const LAZIER: usize = 2;

#[inline(never)]
pub(crate) fn compress_with_chains(
    window: Window<'_>,
    storage: &mut hash_chains::Storage,
    sequences: &mut Vec<Sequence>,
    laziness: usize,
    effort: Effort,
    stream: &mut Stream<'_, '_>,
) -> Result<()> {
    let limits = Limits {
        soft_max_block_len: SOFT_MAX_BLOCK_LEN,
        max_sequences: 50000,
        max_depth: Some(effort.max_depth),
        updates_min_len: laziness != GREEDY,
    };
    let chains = HashChains::new(storage, window.input().len())?;
    compress(
        window,
        chains,
        sequences,
        stream,
        limits,
        |chains, span, node, min_len| {
            let parse = match laziness {
                GREEDY => parse::<GREEDY, false>,
                LAZY if chains.make_shortcuts(node) => parse::<LAZY, true>,
                LAZY => parse::<LAZY, false>,
                _ if chains.make_shortcuts(node) => parse::<LAZIER, true>,
                _ => parse::<LAZIER, false>,
            };
            parse(chains, span, node, min_len, effort)
        },
    )
}

#[inline(never)]
fn parse<const LAZINESS: usize, const TAKES_SHORTCUTS: bool>(
    chains: &mut HashChains<'_>,
    span: &mut Span<'_>,
    mut node: usize,
    min_len: usize,
    Effort {
        max_depth,
        mut nice_len,
    }: Effort,
) -> usize {
    let max_offset_of_shortest = MAX_OFFSET_OF_3 / if LAZINESS == GREEDY { 2 } else { 1 };
    let (window, input_end) = (span.window, span.input_end);
    if min_len == MIN_MATCH_LEN {
        chains.index_3_bytes(window, node);
    }
    let mut visited = 0;
    let (mut max_len, near_end) = (MAX_MATCH_LEN, input_end.saturating_sub(MAX_MATCH_LEN));
    let mut longest_match = #[inline(always)]
    |node: usize, best_len, depth, nice_len: &mut usize| {
        if node > near_end {
            cold_path();
            max_len = input_end - node;
            *nice_len = max_len.min(*nice_len);
        }
        chains.longest_match::<TAKES_SHORTCUTS>(
            window,
            node,
            best_len,
            max_len,
            *nice_len,
            depth,
            &mut visited,
        )
    };
    while node < span.stop {
        let (mut len, mut offset) = longest_match(node, min_len - 1, max_depth, &mut nice_len);
        if len < min_len || (len == MIN_MATCH_LEN && offset > max_offset_of_shortest) {
            span.choose_literal(node);
            node += 1;
            continue;
        }
        'defer: while len < nice_len {
            for (ahead, min_gain) in [(1, 3), (2, 7)].into_iter().take(LAZINESS) {
                let next = node + ahead;
                let (next_len, next_offset) =
                    longest_match(next, len - 1, max_depth >> ahead, &mut nice_len);
                if next_len >= len
                    && 4 * (next_len - len) as u32 + (offset | 1).ilog2()
                        >= (next_offset | 1).ilog2() + min_gain
                {
                    (node..next).for_each(|node| span.choose_literal(node));
                    (node, len, offset) = (next, next_len, next_offset);
                    continue 'defer;
                }
            }
            break;
        }
        span.choose_match(node, len, offset);
        node += len;
    }
    if LAZINESS != GREEDY {
        chains.credit += visited;
    }
    node
}
