//! Builds prefix codes, and describes them in the stream (RFC 7932 section 3).

use core::hint::select_unpredictable;

use bun_highway::brotli::{LEAF_SLACK, sort_leaves};

use super::bit_writer::{BitWriter, Code};
use super::matching::put_bytes;
use super::symbol_set::SymbolSet;
use crate::format::{
    Alphabet, CODE_LENGTH_CODE_LENGTH_CODES, CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES,
    COMMAND_SYMBOLS, INITIAL_REPEATED_CODE_LENGTH, MAX_CODE_LENGTH, MAX_CODE_LENGTH_CODE_LENGTH,
    REPEAT_PREVIOUS_CODE_LENGTH, REPEAT_ZERO_CODE_LENGTH, repeat_extra_bits, reverse_byte,
};
use crate::memory::{self, Result};

type CountByLength = [u32; MAX_CODE_LENGTH + 1];

/// Hands out the codes of a canonical code, to the symbols in ascending order.
pub(super) struct NextCodes([u16; MAX_CODE_LENGTH + 1]);

impl NextCodes {
    #[inline(always)]
    const fn new(counts: &CountByLength) -> Self {
        let mut next = [0; _];
        let mut length = 2;
        while length <= MAX_CODE_LENGTH {
            next[length] = (next[length - 1] + counts[length - 1] as u16) << 1;
            length += 1;
        }
        Self(next)
    }

    /// `length` is not zero.
    #[inline(always)]
    pub(super) const fn take(&mut self, length: u8) -> Code {
        let next = &mut self.0[length as usize % (MAX_CODE_LENGTH + 1)];
        let [low, high] = next.to_le_bytes();
        *next = next.wrapping_add(1);
        let bits = u16::from_le_bytes([reverse_byte(high), reverse_byte(low)]);
        Code::new(length as u32, (bits as u64) << 48)
    }
}

/// Prepends the canonical code for `lengths`.
pub(super) const fn assign_codes(lengths: &[u8], codes: &mut [Code]) {
    let mut counts = [0; _];
    let mut i = 0;
    while i < lengths.len() {
        if lengths[i] != 0 {
            counts[lengths[i] as usize % counts.len()] += 1;
        }
        i += 1;
    }
    let mut next = NextCodes::new(&counts);
    i = 0;
    while i < lengths.len() {
        if lengths[i] != 0 {
            codes[i].prepend(next.take(lengths[i]));
        }
        i += 1;
    }
}

#[derive(Clone, Copy)]
enum Ties {
    HigherSymbolFirst,
    /// Wherever a Shell sort leaves them.
    Unordered,
}

/// The code lengths of an alphabet, and zeros after them.
pub(super) struct Lengths {
    padded: [u8; COMMAND_SYMBOLS + 1],
    symbols: usize,
}

impl Lengths {
    pub(super) fn zeros(symbols: usize) -> Self {
        Self {
            padded: [0; _],
            symbols,
        }
    }

    pub(super) fn all_mut(&mut self) -> &mut [u8] {
        &mut self.padded[..self.symbols]
    }

    fn run_ends(&self) -> SymbolSet {
        let padded = &self.padded[..=self.symbols.next_multiple_of(16)];
        SymbolSet::matching_next(padded, |length, next| length != next)
    }

    /// The length and how many times it comes, without the zeros at the end.
    #[inline(always)]
    fn runs<'a>(&'a self, ends: &'a SymbolSet) -> impl Iterator<Item = (u8, usize)> {
        let mut start = 0;
        ends.into_iter().map(move |last| {
            let count = last + 1 - core::mem::replace(&mut start, last + 1);
            (self.padded[last], count)
        })
    }
}

/// Symbols of the alphabet of code lengths, with their extra bits at the top.
struct Tokens {
    padded: [u8; COMMAND_SYMBOLS + 8],
    count: usize,
}

impl Tokens {
    const SYMBOL_BITS: u32 = 5;
    const SYMBOLS: usize = 1 << Self::SYMBOL_BITS;

    fn new() -> Self {
        Self {
            padded: [0; _],
            count: 0,
        }
    }

    #[inline(always)]
    fn push_single(&mut self, symbol: u8, times: usize) {
        let (mut at, end) = (self.count, self.count + times);
        loop {
            self.padded[at..at + 8].fill(symbol);
            at += 8;
            if at >= end {
                break;
            }
        }
        self.count = end;
    }

    #[inline(always)]
    fn push_zeros(&mut self, mut repeats: usize) {
        if repeats == 11 {
            self.push_single(0, 1);
            repeats -= 1;
        }
        self.push_run(0, repeats, REPEAT_ZERO_CODE_LENGTH);
    }

    #[inline(always)]
    fn push_run(&mut self, length: u8, repeats: usize, repeat_symbol: u8) {
        let Some(mut left) = repeats.checked_sub(3) else {
            self.push_single(length, repeats);
            return;
        };
        let extra_bits = repeat_extra_bits(u32::from(repeat_symbol));
        let (mut last_first, mut count) = (0u64, 0);
        loop {
            let extra = (left & ((1 << extra_bits) - 1)) as u8;
            let token = repeat_symbol | (extra << (8 - extra_bits));
            (last_first, count) = ((last_first << 8) | u64::from(token), count + 1);
            left >>= extra_bits;
            if left == 0 {
                break;
            }
            left -= 1;
        }
        put_bytes(&mut self.padded, self.count, last_first.to_le_bytes());
        self.count += count;
    }

    fn histogram(&self) -> [u32; Self::SYMBOLS] {
        let mut histogram = [0; _];
        for &token in &self.padded[..self.count] {
            histogram[usize::from(token) % Self::SYMBOLS] += 1;
        }
        histogram
    }

    /// What to prepend the codes to.
    const ROOM: [Code; Self::SYMBOLS] = {
        let mut room = [Code::EMPTY; _];
        let (previous, zero) = (REPEAT_PREVIOUS_CODE_LENGTH, REPEAT_ZERO_CODE_LENGTH);
        room[previous as usize] = Code::new(repeat_extra_bits(previous as u32), 0);
        room[zero as usize] = Code::new(repeat_extra_bits(zero as u32), 0);
        room
    };

    fn write(&self, codes: &[Code; Self::SYMBOLS], writer: &mut BitWriter) {
        writer.write_codes::<6, _>(&self.padded[..self.count], |token| {
            let extra = u64::from(token >> Self::SYMBOL_BITS) << (56 + Self::SYMBOL_BITS);
            codes[usize::from(token) % Self::SYMBOLS].plus(extra)
        });
    }
}

/// In bytes: one for the length of each symbol, and the code for the lengths.
pub(super) const fn max_description_size(alphabet: Alphabet) -> usize {
    alphabet.size as usize + 10
}

pub(super) struct TreeBuilder {
    /// Leaves, then parents, with their counts in the high 32 bits. Low 16 bits of a leaf: `!symbol`.
    nodes: Vec<u64>,
}

impl TreeBuilder {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            nodes: memory::empty(2 * (COMMAND_SYMBOLS + LEAF_SLACK))?,
        })
    }

    /// Sets the lengths of the symbols that `histogram` has, and leaves the others alone.
    pub(super) fn set_lengths(
        &mut self,
        histogram: &[u32],
        limit: usize,
        lengths: &mut [u8],
    ) -> NextCodes {
        let used = SymbolSet::matching(histogram, |count| count != 0);
        let ties = Ties::HigherSymbolFirst;
        NextCodes::new(&self.set_lengths_with(histogram, &used, limit, ties, lengths))
    }

    fn set_lengths_with(
        &mut self,
        histogram: &[u32],
        used: &SymbolSet,
        limit: usize,
        ties: Ties,
        lengths: &mut [u8],
    ) -> CountByLength {
        let leaf_count = used.len();
        self.nodes.clear();
        memory::resize(&mut self.nodes, 2 * (leaf_count + LEAF_SLACK), u64::MAX);
        let (leaves, parents) = self.nodes.split_at_mut(leaf_count + LEAF_SLACK);
        let set_leaves = |leaves: &mut [u64], scratch: &mut [u64], min_count| {
            for (leaf, symbol) in scratch[..leaf_count].iter_mut().rev().zip(used) {
                let count = histogram[symbol].max(min_count);
                *leaf = (u64::from(count) << 32) | u64::from(!(symbol as u16));
            }
            sort(scratch, leaf_count, ties, leaves);
        };
        set_leaves(leaves, parents, 1);
        let mut min_count = 1;
        let counts = loop {
            parents.fill(u64::MAX);
            merge(&leaves[..leaf_count + 2], parents);
            if let Some(counts) = count_leaves_by_depth(&parents[..leaf_count - 1], limit) {
                break counts;
            }
            // The counts stay sorted, and the shape of the tree depends on nothing else.
            min_count *= 2;
            for leaf in &mut leaves[..leaf_count] {
                *leaf = (*leaf).max(u64::from(min_count) << 32);
            }
        };
        if min_count > 1 {
            set_leaves(leaves, parents, min_count);
        }
        let mut leaves = self.nodes[..leaf_count].iter();
        for length in (1..=limit).rev() {
            for &leaf in leaves.by_ref().take(counts[length] as usize) {
                lengths[usize::from(!(leaf as u16))] = length as u8;
            }
        }
        counts
    }

    /// Returns whether the code is simple, and stored already.
    #[inline(always)]
    fn build_and_write_simple(
        &mut self,
        histogram: &[u32],
        Alphabet { size, symbol_bits }: Alphabet,
        (limit, ties): (usize, Ties),
        lengths: &mut Lengths,
        codes: &mut [Code],
        writer: &mut BitWriter,
    ) -> bool {
        let histogram = &histogram[..size as usize];
        let used = SymbolSet::matching(histogram, |count| count != 0);
        let mut first = [0; 4];
        for (slot, symbol) in first.iter_mut().zip(&used) {
            *slot = symbol;
        }
        if used.len() <= 1 {
            write_single_symbol(first[0], symbol_bits, writer);
            return true;
        }
        let counts = self.set_lengths_with(histogram, &used, limit, ties, &mut lengths.padded);
        let mut next = NextCodes::new(&counts);
        for symbol in &used {
            codes[symbol].prepend(next.take(lengths.padded[symbol]));
        }
        let Some(all) = first.get_mut(..used.len()) else {
            return false;
        };
        write_simple(&lengths.padded, all, symbol_bits, writer);
        true
    }

    pub(super) fn build_and_write(
        &mut self,
        histogram: &[u32],
        alphabet: Alphabet,
        codes: &mut [Code],
        writer: &mut BitWriter,
    ) {
        let shape = (MAX_CODE_LENGTH, Ties::HigherSymbolFirst);
        let mut lengths = Lengths::zeros(alphabet.size as usize);
        if !self.build_and_write_simple(histogram, alphabet, shape, &mut lengths, codes, writer) {
            self.write_complex(&lengths, writer);
        }
    }

    /// With a fixed code for the code lengths.
    pub(super) fn build_and_write_fast(
        &mut self,
        histogram: &[u32],
        alphabet: Alphabet,
        codes: &mut [Code],
        writer: &mut BitWriter,
    ) {
        // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/entropy_encode_static.h#L86
        static LENGTH_CODES: [Code; Tokens::SYMBOLS] = {
            let mut codes = Tokens::ROOM;
            assign_codes(
                &[4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 0, 4, 4],
                &mut codes,
            );
            codes
        };
        let shape = (14, Ties::Unordered);
        let mut lengths = Lengths::zeros(alphabet.size as usize);
        if self.build_and_write_simple(histogram, alphabet, shape, &mut lengths, codes, writer) {
            return;
        }
        // How the stream describes `LENGTH_CODES`.
        writer.write(40, 0xFF_5555_5554);
        let mut tokens = Tokens::new();
        let mut previous = INITIAL_REPEATED_CODE_LENGTH;
        for (length, mut repeats) in lengths.runs(&lengths.run_ends()) {
            if length == 0 {
                tokens.push_zeros(repeats);
                continue;
            }
            if previous != length {
                tokens.push_single(length, 1);
                repeats -= 1;
            }
            tokens.push_run(length, repeats, REPEAT_PREVIOUS_CODE_LENGTH);
            previous = length;
        }
        tokens.write(&LENGTH_CODES, writer);
    }

    pub(super) fn write_complex(&mut self, lengths: &Lengths, writer: &mut BitWriter) {
        let tokens = tokenize(lengths);
        let histogram = tokens.histogram();
        let used = SymbolSet::matching(&histogram, |count| count != 0);
        let mut token_lengths = [0; CODE_LENGTH_CODES];
        let (limit, ties) = (MAX_CODE_LENGTH_CODE_LENGTH, Ties::HigherSymbolFirst);
        let counts = self.set_lengths_with(&histogram, &used, limit, ties, &mut token_lengths);
        write_token_lengths(used.len(), &token_lengths, writer);
        let mut token_codes = Tokens::ROOM;
        if used.len() > 1 {
            let mut next = NextCodes::new(&counts);
            for symbol in &used {
                token_codes[symbol].prepend(next.take(token_lengths[symbol]));
            }
        }
        tokens.write(&token_codes, writer);
    }
}

/// The higher symbols come first in `unsorted`.
#[inline(always)]
fn sort(unsorted: &[u64], count: usize, ties: Ties, sorted: &mut [u64]) {
    const MIN_FOR_GAPS: usize = 13;
    /// Without gaps, the kernel compares each leaf with each.
    const MAX_FOR_KERNEL: usize = 128;
    let has_gaps = matches!(ties, Ties::Unordered) && count >= MIN_FOR_GAPS;
    if (has_gaps || count <= MAX_FOR_KERNEL) && sort_leaves(unsorted, count, has_gaps, sorted) {
        return;
    }
    let sorted = &mut sorted[..count];
    sorted.copy_from_slice(&unsorted[..count]);
    if has_gaps {
        shell_sort(sorted);
    } else {
        sorted.sort_unstable();
    }
}

fn shell_sort(leaves: &mut [u64]) {
    for gap in [132, 57, 23, 10, 4, 1] {
        for i in gap..leaves.len() {
            let leaf = leaves[i];
            let mut j = i;
            while let Some(&before) = leaves.get(j.wrapping_sub(gap))
                && leaf | u64::from(u32::MAX) < before
            {
                leaves[j] = before;
                j -= gap;
            }
            leaves[j] = leaf;
        }
    }
}

/// Two `u64::MAX` end the sorted `leaves`, and fill `parents`. Low 32 bits of a parent: how many were merged before.
#[inline(always)]
fn merge(leaves: &[u64], parents: &mut [u64]) {
    let (mut next_leaf, mut next_parent) = (0u32, 0u32);
    for index in 0..leaves.len() - 3 {
        let (leaf, parent) = (next_leaf as usize, next_parent as usize);
        let (Some(&[a, b]), Some(&[c, d])) =
            (leaves.get(leaf..leaf + 2), parents.get(parent..parent + 2))
        else {
            return;
        };
        let [a, b, c, d] = [a, b, c, d].map(|node| (node >> 32) as u32);
        // The lowest two are a leaf and a parent, unless both leaves or both parents are. A leaf wins a tie.
        let more_leaves = i32::from(b <= c) - i32::from(d < a);
        parents[index] = (u64::from(a.min(d) + b.min(c)) << 32) | u64::from(next_parent);
        next_leaf = next_leaf.wrapping_add_signed(1 + more_leaves);
        next_parent = next_parent.wrapping_add_signed(1 - more_leaves);
    }
}

/// `None` if a leaf is deeper than `limit`. The parents of one depth come right before those of the depth above.
#[inline(always)]
fn count_leaves_by_depth(parents: &[u64], limit: usize) -> Option<CountByLength> {
    let mut counts = [0; _];
    let Some(mut first) = parents.len().checked_sub(1) else {
        counts[1] = 1;
        return Some(counts);
    };
    let mut width = 1;
    for count in &mut counts[1..=limit] {
        let first_below = parents[first] as u32 as usize;
        let width_below = (first - first_below) as u32;
        *count = 2 * width - width_below;
        if first == 0 {
            return Some(counts);
        }
        (first, width) = (first_below, width_below);
    }
    None
}

fn tokenize(lengths: &Lengths) -> Tokens {
    let ends = lengths.run_ends();
    let (runs_of_others, runs_of_zeros) = if lengths.symbols > 50 {
        are_runs_worthwhile(lengths.runs(&ends))
    } else {
        (false, false)
    };
    let mut tokens = Tokens::new();
    let mut previous = INITIAL_REPEATED_CODE_LENGTH;
    for (length, mut repeats) in lengths.runs(&ends) {
        if length == 0 {
            if runs_of_zeros {
                tokens.push_zeros(repeats);
            } else {
                tokens.push_single(0, repeats);
            }
            continue;
        }
        if runs_of_others {
            if previous != length {
                tokens.push_single(length, 1);
                repeats -= 1;
            }
            if repeats == 7 {
                tokens.push_single(length, 1);
                repeats -= 1;
            }
            tokens.push_run(length, repeats, REPEAT_PREVIOUS_CODE_LENGTH);
        } else {
            tokens.push_single(length, repeats);
        }
        previous = length;
    }
    tokens
}

fn without_trailing_zeros<T: Default + PartialEq>(mut values: &[T]) -> &[T] {
    while let [rest @ .., last] = values
        && *last == T::default()
    {
        values = rest;
    }
    values
}

fn write_single_symbol(symbol: usize, symbol_bits: u32, writer: &mut BitWriter) {
    writer.write(4, 1);
    writer.write(symbol_bits, symbol as u64);
}

fn write_simple(lengths: &[u8], symbols: &mut [usize], symbol_bits: u32, writer: &mut BitWriter) {
    writer.write(2, 1);
    writer.write(2, symbols.len() as u64 - 1);
    for i in 0..symbols.len() {
        for j in i + 1..symbols.len() {
            if lengths[symbols[j]] < lengths[symbols[i]] {
                symbols.swap(i, j);
            }
        }
    }
    for &symbol in &*symbols {
        writer.write(symbol_bits, symbol as u64);
    }
    if symbols.len() == 4 {
        writer.write(1, u64::from(lengths[symbols[0]] == 1));
    }
}

fn write_token_lengths(used: usize, lengths: &[u8; CODE_LENGTH_CODES], writer: &mut BitWriter) {
    let ordered = CODE_LENGTH_CODE_ORDER.map(|symbol| lengths[usize::from(symbol)]);
    let skipped = match ordered {
        [0, 0, 0, ..] => 3,
        [0, 0, ..] => 2,
        _ => 0,
    };
    let stored = if used > 1 {
        without_trailing_zeros(&ordered)
    } else {
        &ordered
    };
    writer.write(2, skipped as u64);
    for &length in stored.iter().skip(skipped) {
        let (count, bits) = CODE_LENGTH_CODE_LENGTH_CODES[usize::from(length)];
        writer.write(u32::from(count), u64::from(bits));
    }
}

/// For the lengths other than zero, and for zero.
fn are_runs_worthwhile(runs: impl Iterator<Item = (u8, usize)>) -> (bool, bool) {
    let (mut gain_of_others, mut gain_of_zeros) = (0, 0);
    for (length, repeats) in runs {
        let gain = repeats.saturating_sub(2);
        gain_of_others += if length != 0 && repeats >= 4 { gain } else { 0 };
        gain_of_zeros += if length == 0 { gain } else { 0 };
    }
    (gain_of_others > 2, gain_of_zeros > 2)
}

/// Changes `counts` so that the lengths of their code have more runs.
pub(super) fn smooth_counts(counts: &mut [u32]) {
    // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/entropy_encode.c#L241
    const STREAK_LIMIT: u64 = 1240;
    let mut used = SymbolSet::matching(counts, |count| count != 0);
    let nonzeros = used.len();
    if nonzeros < 16 {
        return;
    }
    let length = used.end();
    if length - nonzeros < 6 && counts.iter().any(|count| (1..4).contains(count)) {
        for i in 1..length - 1 {
            if counts[i - 1] != 0 && counts[i] == 0 && counts[i + 1] != 0 {
                counts[i] = 1;
            }
        }
        used = SymbolSet::matching(counts, |count| count != 0);
    }
    if nonzeros < 28 {
        return;
    }

    let flatten = |stride: &mut [u32], sum: u64| {
        let length = stride.len() as u32;
        let average = (sum as u32 + length / 2) / length;
        stride.fill(average.max(u32::from(sum != 0)));
    };
    // 24.8 fixed point.
    let fixed = |count: u32| count.wrapping_mul(256);
    let average_of_three = |counts: &[u32], i: usize| match counts.get(i..i + 3) {
        Some(&[a, b, c]) => u64::from(fixed(a + b + c) / 3 + 420),
        _ => 0,
    };
    let (mut stride, mut sum, mut end) = (0, 0, 0);
    let mut first_limit = average_of_three(counts, 0);
    for i in &used.outside_long_runs(counts) {
        let count = counts[i];
        // The limit is the whole part of this fraction. Comparing with it takes no division.
        let (dividend, divisor) = select_unpredictable(
            stride < 4,
            (first_limit, 1),
            (
                256 * sum + stride / 2 + if stride == 4 { 4 * 120 } else { 0 },
                stride,
            ),
        );
        let lowest = u64::from(fixed(count)).wrapping_sub(STREAK_LIMIT - 1);
        let is_far =
            dividend.wrapping_sub(lowest.wrapping_mul(divisor)) >= 2 * STREAK_LIMIT * divisor;
        if is_far | (i != end) {
            if stride >= 4 {
                flatten(&mut counts[end - stride as usize..end], sum);
            }
            (stride, sum, first_limit) = (0, 0, average_of_three(counts, i));
        }
        (stride, sum, end) = (stride + 1, sum + u64::from(count), i + 1);
    }
    if stride >= 4 {
        flatten(&mut counts[end - stride as usize..end], sum);
    }
}
