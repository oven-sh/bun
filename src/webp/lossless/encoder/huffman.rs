//! Prefix codes: how they are made from a histogram, and how they are stored.

use core::ops::Range;

use super::bit_writer::BitWriter;
use super::matches::common_len;
use crate::array::At;
use crate::error::Result;
use crate::lossless::{
    CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, DEFAULT_CODE_LENGTH, LITERAL_CODES, MAX_CODE_LENGTH,
};
use crate::slice::{InBounds, known};
use crate::vec;

const MAX_CODE_LENGTH_CODE_LENGTH: usize = 7;
const REPEAT_PREVIOUS: u8 = 16;
const REPEAT_ZERO: u8 = 17;
const REPEAT_ZERO_OFTEN: u8 = 18;

/// The code of a symbol: its length, and below that its bits, the first one lowest.
#[derive(Clone, Copy)]
pub(super) struct Word(pub(super) u32);

impl Word {
    #[inline(always)]
    pub(super) const fn bits(self) -> u32 {
        self.0 & 0xffff
    }

    #[inline(always)]
    pub(super) const fn len(self) -> u32 {
        self.0 >> 16
    }

    #[inline(always)]
    pub(super) fn write(self, extra: u32, extra_len: u32, writer: &mut BitWriter) {
        let bits = u64::from(extra) << self.len() | u64::from(self.bits());
        writer.put(bits, self.len() + extra_len);
    }
}

/// One code length, or several.
#[derive(Clone, Copy)]
struct Token {
    symbol: u8,
    extra: u8,
}

impl Token {
    const fn extra_len(self) -> u32 {
        match self.symbol {
            REPEAT_PREVIOUS => 2,
            REPEAT_ZERO => 3,
            REPEAT_ZERO_OFTEN => 7,
            _ => 0,
        }
    }

    const fn is_for_zeros(self) -> bool {
        matches!(self.symbol, 0 | REPEAT_ZERO | REPEAT_ZERO_OFTEN)
    }
}

#[derive(Clone, Copy, Default)]
struct Node {
    count: u32,
    /// Its index, and once the tree stands its depth.
    parent: u16,
}

/// A symbol that gets a code.
#[derive(Clone, Copy)]
struct Leaf {
    symbol: u16,
    len: u8,
}

/// Room to work in.
pub(super) struct Builder {
    /// In the order of the symbols.
    leaves: Vec<Leaf>,
    /// The count, above the index of the leaf with its bits inverted, so that the higher symbol comes first among equals.
    by_count: Vec<u64>,
    leaf_parents: Vec<u16>,
    inner_nodes: Vec<Node>,
    tokens: Vec<Token>,
}

impl Builder {
    pub(super) fn new(max_alphabet_len: usize) -> Result<Self> {
        Ok(Self {
            leaves: vec::with_room(max_alphabet_len)?,
            by_count: vec::with_room(max_alphabet_len)?,
            leaf_parents: vec::with_room(max_alphabet_len)?,
            inner_nodes: vec::with_room(max_alphabet_len)?,
            tokens: vec::with_room(max_alphabet_len)?,
        })
    }

    /// Makes the code for an alphabet, and stores it. Returns how many bits the symbols take.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L643
    pub(super) fn write_code(
        &mut self,
        counts_then_words: &mut [u32],
        writer: &mut BitWriter,
    ) -> u64 {
        let alphabet_len = counts_then_words.len();
        self.set_leaves(counts_then_words, MAX_CODE_LENGTH);
        let bits = self.set_words(counts_then_words);
        writer.make_room(1 + 4 + 3 * CODE_LENGTH_CODES + 1 + 3 + 16 + (7 + 7) * alphabet_len);
        let is_short = |leaf: Leaf| usize::from(leaf.symbol) < LITERAL_CODES;
        match *self.leaves {
            [] => write_simple_code(0, None, writer),
            [only] if is_short(only) => write_simple_code(only.symbol, None, writer),
            [first, second] if is_short(second) => {
                write_simple_code(first.symbol, Some(second.symbol), writer);
            }
            _ => self.write_normal_code(alphabet_len, writer),
        }
        bits
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L575
    fn write_normal_code(&mut self, alphabet_len: usize, writer: &mut BitWriter) {
        self.set_tokens(alphabet_len);
        let mut counts_then_words = [0; CODE_LENGTH_CODES];
        for token in &self.tokens {
            *counts_then_words.at_mut(token.symbol.into()) += 1;
        }
        self.set_leaves(&counts_then_words, MAX_CODE_LENGTH_CODE_LENGTH);
        let mut lengths = [0; CODE_LENGTH_CODES];
        for leaf in &self.leaves {
            *lengths.at_mut(leaf.symbol.into()) = leaf.len;
        }

        writer.put_flag(false);
        let lengths = CODE_LENGTH_CODE_ORDER.map(|symbol| *lengths.at(symbol.into()));
        let needed = lengths.iter().rposition(|&len| len > 0);
        let stored = needed.map_or(0, |last| last + 1).max(4);
        writer.put(stored as u64 - 4, 4);
        for &len in lengths.iter().take(stored) {
            writer.put(len.into(), 3);
        }

        self.set_words(&mut counts_then_words);
        let word = |token: &Token| Word(*counts_then_words.at(token.symbol.into()));
        let trailing = self.tokens.iter().rev().take_while(|it| it.is_for_zeros());
        let (trailing, trailing_bits) = trailing.fold((0, 0), |(count, bits), token| {
            let len = word(token).len() + token.extra_len();
            (count + 1, bits + len)
        });
        let trimmed = self.tokens.len() - trailing;
        let is_trimmed = trailing_bits > 12;
        writer.put_flag(is_trimmed);
        if is_trimmed {
            let stored = trimmed.saturating_sub(2) as u64;
            let more_bit_pairs = (stored | 1).ilog2() / 2;
            writer.put(more_bit_pairs.into(), 3);
            writer.put(stored, 2 + 2 * more_bit_pairs);
            self.tokens.truncate(trimmed);
        }
        for token in &self.tokens {
            word(token).write(token.extra.into(), token.extra_len(), writer);
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/huffman_encode_utils.c#L328
    fn set_tokens(&mut self, alphabet_len: usize) {
        self.tokens.clear();
        let mut previous = DEFAULT_CODE_LENGTH;
        let mut push_run = |len: u8, mut left: usize| {
            if len != 0 && len != previous {
                self.tokens.push(Token {
                    symbol: len,
                    extra: 0,
                });
                previous = len;
                left -= 1;
            }
            while left > 0 {
                let (symbol, min, max) = match (len, left) {
                    (_, ..3) => (len, 1, 1),
                    (0, ..11) => (REPEAT_ZERO, 3, 10),
                    (0, _) => (REPEAT_ZERO_OFTEN, 11, 138),
                    _ => (REPEAT_PREVIOUS, 3, 6),
                };
                let repeats = left.min(max);
                let extra = (repeats - min) as u8;
                self.tokens.push(Token { symbol, extra });
                left -= repeats;
            }
        };
        let mut end = 0;
        let continues = |a: &Leaf, b: &Leaf| a.symbol + 1 == b.symbol && a.len == b.len;
        let runs = self.leaves.chunk_by(continues);
        for (first, others) in runs.filter_map(<[_]>::split_first) {
            let (start, len) = (usize::from(first.symbol), 1 + others.len());
            push_run(0, start - end);
            push_run(first.len, len);
            end = start + len;
        }
        push_run(0, alphabet_len - end);
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/huffman_encode_utils.c#L167
    fn set_leaves(&mut self, counts: &[u32], max_len: usize) {
        self.leaves.clear();
        self.by_count.clear();
        for_each_evened_out(counts, |symbol, count| {
            let index = self.leaves.len() as u16;
            self.by_count
                .push(u64::from(count) << 16 | u64::from(!index));
            let symbol = symbol as u16;
            self.leaves.push(Leaf { symbol, len: 0 });
        });

        // The rarest symbols are taken to be less and less rare until the tree is flat enough.
        let mut min_count = 1;
        loop {
            self.by_count.sort_unstable();
            self.build_tree();
            let deepest = self.inner_nodes.first().map_or(0, |node| node.parent);
            if usize::from(deepest) < max_len {
                break;
            }
            min_count *= 2;
            for leaf in &mut self.by_count {
                *leaf = (*leaf).max(min_count << 16 | *leaf & 0xffff);
            }
        }
        for (&leaf, &parent) in self.by_count.iter().zip(&self.leaf_parents) {
            let depth = self.inner_nodes.get(usize::from(parent));
            let len = depth.map_or(0, |node| node.parent as u8) + 1;
            self.leaves
                .update((!(leaf as u16)).into(), |leaf| leaf.len = len);
        }
    }

    /// Returns how many bits the symbols take. One that is alone takes none at all.
    fn set_words(&self, counts_then_words: &mut [u32]) -> u64 {
        if self.leaves.len() <= 1 {
            counts_then_words.fill(0);
            return 0;
        }
        let mut next = [0u16; MAX_CODE_LENGTH];
        for leaf in &self.leaves {
            *next.at_mut(usize::from(leaf.len) - 1) += 1;
        }
        let mut first = 0u32;
        for next in &mut next {
            first *= 2;
            first += u32::from(core::mem::replace(next, first as u16));
        }
        let mut total = 0;
        for &Leaf { symbol, len } in &self.leaves {
            let next = next.at_mut(usize::from(len) - 1);
            let word = u32::from(len) << 16 | u32::from(next.reverse_bits() >> (16 - len));
            let count = counts_then_words.update(symbol.into(), |it| core::mem::replace(it, word));
            total += u64::from(count) * u64::from(len);
            *next += 1;
        }
        total
    }

    /// Joins the two rarest nodes over and over. Among equals leaves go first, then the older inner nodes.
    fn build_tree(&mut self) {
        self.inner_nodes.clear();
        self.leaf_parents.clear();
        let leaves = self.by_count.iter().map(|leaf| (leaf >> 16) as u32);
        let mut leaves = leaves.peekable();
        let mut first_orphan = 0;
        for parent in 0..self.leaves.len().saturating_sub(1) as u16 {
            let mut count = 0;
            for _ in 0..2 {
                if let Some(orphan) = self.inner_nodes.get_mut(first_orphan)
                    && leaves.peek().is_none_or(|&leaf| leaf > orphan.count)
                {
                    count += orphan.count;
                    orphan.parent = parent;
                    first_orphan += 1;
                } else {
                    count += known(leaves.next()).unwrap_or(0);
                    self.leaf_parents.push(parent);
                }
            }
            self.inner_nodes.push(Node { count, parent: 0 });
        }
        // A symbol that is alone.
        self.leaf_parents.extend(leaves.map(|_| 0));

        // The root is last, and has 0.
        for index in (0..first_orphan).rev() {
            let parent = self.inner_nodes.value(index).parent;
            let depth = self.inner_nodes.value(parent.into()).parent + 1;
            self.inner_nodes.update(index, |node| node.parent = depth);
        }
    }
}

/// Calls `found` with each symbol and its count, unless that is zero, after making counts that are close to each other
/// equal, so that more code lengths repeat.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/huffman_encode_utils.c#L33
fn for_each_evened_out(counts: &[u32], mut found: impl FnMut(usize, u32)) {
    let used = counts.iter().rposition(|&count| count != 0);
    let counts = counts.part(..used.map_or(0, |last| last + 1));
    let average = |sum: u32, len: usize| (sum + len as u32 / 2) / (len as u32).max(1);
    let mut finish = |symbols: Range<usize>, sum: u32| {
        if symbols.len() >= 4 && sum > 0 {
            let count = average(sum, symbols.len()).max(1);
            symbols.for_each(|symbol| found(symbol, count));
        } else if sum > 0 {
            let counts = counts.iter().zip(0..symbols.end).skip(symbols.start);
            let used = counts.filter(|&(&count, _)| count != 0);
            used.for_each(|(&count, symbol)| found(symbol, count));
        }
    };
    let (mut start, mut sum) = (0, 0);
    let mut typical = counts.first().copied().unwrap_or(0);
    let mut follows_long_run = false;
    let mut at = 0;
    while let Some(from_run @ &[count, ref after @ ..]) = counts.get(at..) {
        let run = 1 + common_len(from_run, after);
        if run >= if count == 0 { 5 } else { 7 } {
            finish(start..at, sum);
            (start, sum) = (at, count * run as u32);
            at += run;
            follows_long_run = true;
            continue;
        }
        for _ in 0..run {
            if follows_long_run || count.abs_diff(typical) >= 4 {
                finish(start..at, sum);
                (start, sum) = (at, 0);
                typical = match counts.get(at..).and_then(<[_]>::first_chunk::<4>) {
                    Some(four) => average(four.iter().sum(), 4),
                    None => count,
                };
                follows_long_run = false;
            }
            at += 1;
            sum += count;
            if at - start >= 4 {
                typical = average(sum, at - start);
            }
        }
    }
    finish(start..at, sum);
}

fn write_simple_code(first: u16, second: Option<u16>, writer: &mut BitWriter) {
    writer.put_flag(true);
    writer.put_flag(second.is_some());
    writer.put_flag(first > 1);
    writer.put(first.into(), if first > 1 { 8 } else { 1 });
    if let Some(second) = second {
        writer.put(second.into(), 8);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_have_more_than_16_bits_and_all_symbols_have_room() -> Result<()> {
        let (mut builder, mut writer) = (Builder::new(5)?, BitWriter::default());
        let counts = &mut [70_000, 40_000, 20_000, 20_000, 20_000];
        assert_eq!(
            builder.write_code(counts, &mut writer),
            70_000 + 3 * 100_000
        );
        let rooms = [
            builder.leaves.capacity(),
            builder.by_count.capacity(),
            builder.leaf_parents.capacity(),
            builder.inner_nodes.capacity(),
            builder.tokens.capacity(),
        ];
        assert_eq!(rooms, [5; 5]);
        Ok(())
    }
}
