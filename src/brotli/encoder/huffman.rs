//! Builds prefix codes, and describes them in the stream (RFC 7932 section 3).

use core::hint::select_unpredictable;

use super::bit_writer::{BitWriter, Bits, Room};
use super::matching::put_bytes;
use super::symbol_set::SymbolSet;
use crate::format::{
    Alphabet, CODE_LENGTH_CODE_LENGTH_CODES, CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES,
    COMMAND_SYMBOLS, INITIAL_REPEATED_CODE_LENGTH, MAX_CODE_LENGTH, MAX_CODE_LENGTH_CODE_LENGTH,
    REPEAT_PREVIOUS_CODE_LENGTH, REPEAT_ZERO_CODE_LENGTH, repeat_extra_bits,
};
use crate::memory::{self, Result};

/// The bits that stand for a symbol.
#[derive(Clone, Copy)]
pub(super) struct Code {
    /// The length in the low 8 bits.
    packed: u32,
}

impl Code {
    pub(super) const EMPTY: Self = Self { packed: 0 };

    #[inline(always)]
    pub(super) const fn length(self) -> u32 {
        self.packed % 256
    }

    #[inline(always)]
    pub(super) const fn bits(self) -> Bits {
        Bits::new(self.length(), (self.packed >> 8) as u64)
    }

    /// Without a branch.
    #[inline(always)]
    pub(super) fn only_if(self, condition: bool) -> Self {
        select_unpredictable(condition, self, Self::EMPTY)
    }
}

type CountByLength = [u32; MAX_CODE_LENGTH + 1];

/// Hands out the codes of a canonical code, to the symbols in ascending order.
struct NextCodes([u16; MAX_CODE_LENGTH + 1]);

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
    const fn take(&mut self, length: u8) -> Code {
        let next = &mut self.0[length as usize % (MAX_CODE_LENGTH + 1)];
        let bits = next.reverse_bits() >> (16 - length);
        *next = next.wrapping_add(1);
        Code {
            packed: ((bits as u32) << 8) | length as u32,
        }
    }
}

/// The canonical code for `lengths`. Leaves the symbols without a length alone.
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
            codes[i] = next.take(lengths[i]);
        }
        i += 1;
    }
}

/// How many symbols [`write_symbols`] looks at after the ones it writes.
pub(super) const SYMBOL_SLACK: usize = 3;

/// Writes `before`, and then all symbols but the last [`SYMBOL_SLACK`].
#[inline(always)]
pub(super) fn write_symbols<T: Copy>(
    room: &mut Room<'_>,
    mut before: Bits,
    mut padded: &[T],
    code_of: impl Fn(T) -> Code,
) {
    while let [a, b, c, rest @ ..] = padded
        && rest.len() > 3
    {
        let [a, b, c] = [a, b, c].map(|&symbol| code_of(symbol).bits());
        room.write_bits(before);
        (before, padded) = (a.then(b).then(c), rest);
    }
    // Most of the time there are few, and how many is hard to predict, so up to three take the same path.
    if let [a, b, c, rest @ ..] = padded {
        let [a, b, c] = [(a, 0), (b, 1), (c, 2)]
            .map(|(&symbol, i)| code_of(symbol).only_if(i < rest.len()).bits());
        room.write_both(before, a.then(b).then(c));
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
        SymbolSet::run_ends(&self.padded[..=self.symbols.next_multiple_of(16)])
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

/// Symbols of the alphabet of code lengths, with their extra bits above them.
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
            let token = repeat_symbol | (extra << Self::SYMBOL_BITS);
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

    /// The symbols after the alphabet have no code.
    fn write(&mut self, codes: &[Code; Self::SYMBOLS], writer: &mut BitWriter) {
        static EXTRA_BITS: [u8; Tokens::SYMBOLS] = {
            let mut bits = [0; _];
            let (previous, zero) = (REPEAT_PREVIOUS_CODE_LENGTH, REPEAT_ZERO_CODE_LENGTH);
            bits[previous as usize] = repeat_extra_bits(previous as u32) as u8;
            bits[zero as usize] = repeat_extra_bits(zero as u32) as u8;
            bits
        };
        let count = self.count;
        // Fills up the last group of four.
        self.push_single(CODE_LENGTH_CODES as u8, 0);
        let mut room = writer.with_room(count);
        for tokens in self.padded[..count + 3].as_chunks::<4>().0 {
            let [a, b, c, d] = tokens.map(|token| {
                let symbol = usize::from(token) % Self::SYMBOLS;
                let extra = u64::from(token >> Self::SYMBOL_BITS);
                let extra = Bits::new(u32::from(EXTRA_BITS[symbol]), extra);
                codes[symbol].bits().then(extra)
            });
            room.write_bits(a.then(b).then(c.then(d)));
        }
    }
}

/// In bytes: one for the length of each symbol, and the code for the lengths.
pub(super) const fn max_description_size(alphabet: Alphabet) -> usize {
    alphabet.size as usize + 10
}

pub(super) struct TreeBuilder {
    /// Leaves, then parents. High 32 bits: the count, later the parent, then the depth. Low 16 bits: `!symbol`.
    nodes: Vec<u64>,
}

impl TreeBuilder {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            nodes: memory::empty(2 * COMMAND_SYMBOLS + 1)?,
        })
    }

    /// Sets the lengths of the symbols that `histogram` has, and leaves the others alone.
    pub(super) fn set_lengths(&mut self, histogram: &[u32], limit: usize, lengths: &mut [u8]) {
        let used = SymbolSet::matching(histogram, |count| count != 0);
        self.set_lengths_with(histogram, &used, limit, Ties::HigherSymbolFirst, lengths);
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
        let mut min_count = 1;
        let counts = loop {
            self.nodes.clear();
            self.nodes.resize(2 * leaf_count + 1, u64::MAX);
            let (leaves, parents) = self.nodes.split_at_mut(leaf_count + 1);
            let unsorted = &mut leaves[..leaf_count];
            for (leaf, symbol) in unsorted.iter_mut().rev().zip(used) {
                let count = histogram[symbol].max(min_count);
                *leaf = (u64::from(count) << 32) | u64::from(!(symbol as u16));
            }
            match ties {
                Ties::HigherSymbolFirst => unsorted.sort_unstable(),
                Ties::Unordered => shell_sort(unsorted),
            }
            merge(leaves, parents);
            if let Some(counts) = count_leaves_by_depth(&mut parents[..leaf_count - 1], limit) {
                break counts;
            }
            min_count *= 2;
        };
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
            write_single_symbol(first[0], symbol_bits, codes, writer);
            return true;
        }
        let counts = self.set_lengths_with(histogram, &used, limit, ties, &mut lengths.padded);
        let mut next = NextCodes::new(&counts);
        for symbol in &used {
            codes[symbol] = next.take(lengths.padded[symbol]);
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
            let mut codes = [Code::EMPTY; _];
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
        let mut tokens = tokenize(lengths);
        let histogram = tokens.histogram();
        let used = SymbolSet::matching(&histogram, |count| count != 0);
        let mut token_lengths = [0; CODE_LENGTH_CODES];
        let (limit, ties) = (MAX_CODE_LENGTH_CODE_LENGTH, Ties::HigherSymbolFirst);
        let counts = self.set_lengths_with(&histogram, &used, limit, ties, &mut token_lengths);
        write_token_lengths(used.len(), &token_lengths, writer);
        let mut token_codes = [Code::EMPTY; _];
        if used.len() > 1 {
            let mut next = NextCodes::new(&counts);
            for symbol in &used {
                token_codes[symbol] = next.take(token_lengths[symbol]);
            }
        }
        tokens.write(&token_codes, writer);
    }
}

fn shell_sort(leaves: &mut [u64]) {
    let gaps: &[usize] = match leaves.len() {
        ..13 => &[1],
        13..57 => &[23, 10, 4, 1],
        _ => &[132, 57, 23, 10, 4, 1],
    };
    for &gap in gaps {
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

/// `leaves` are sorted, and `u64::MAX` ends them and fills `parents`, which end up with the index of their own parent.
#[inline(always)]
fn merge(leaves: &[u64], parents: &mut [u64]) {
    let (mut next_leaf, mut next_parent) = (0, 0);
    for index in 0..parents.len() - 1 {
        let mut count = 0;
        for _ in 0..2 {
            let (leaf, parent) = (leaves[next_leaf] >> 32, parents[next_parent] >> 32);
            if leaf <= parent {
                count += leaf;
                next_leaf += 1;
            } else {
                count += parent;
                parents[next_parent] = (index as u64) << 32;
                next_parent += 1;
            }
        }
        parents[index] = count << 32;
    }
}

/// `None` if a leaf is deeper than `limit`. A leaf is not deeper than those before it.
#[inline(always)]
fn count_leaves_by_depth(parents: &mut [u64], limit: usize) -> Option<CountByLength> {
    let mut counts = [0; _];
    counts[1] = 2;
    if let Some(root) = parents.last_mut() {
        *root = 0;
    }
    for index in (0..parents.len().saturating_sub(1)).rev() {
        let depth = (parents[(parents[index] >> 32) as usize] >> 32) + 1;
        parents[index] = depth << 32;
        if depth as usize >= limit {
            return None;
        }
        counts[depth as usize] -= 1;
        counts[depth as usize + 1] += 2;
    }
    Some(counts)
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

fn write_single_symbol(
    symbol: usize,
    symbol_bits: u32,
    codes: &mut [Code],
    writer: &mut BitWriter,
) {
    writer.write(4, 1);
    writer.write(symbol_bits, symbol as u64);
    codes[symbol] = Code::EMPTY;
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
    const STREAK_LIMIT: usize = 1240;
    let nonzeros = counts.iter().filter(|&&count| count != 0).count();
    if nonzeros < 16 {
        return;
    }
    let length = without_trailing_zeros(counts).len();
    let counts = &mut counts[..length];
    if length - nonzeros < 6 && counts.iter().any(|count| (1..4).contains(count)) {
        for i in 1..length - 1 {
            if counts[i - 1] != 0 && counts[i] == 0 && counts[i + 1] != 0 {
                counts[i] = 1;
            }
        }
    }
    if nonzeros < 28 {
        return;
    }

    let mut in_good_run = [false; COMMAND_SYMBOLS];
    let mut start = 0;
    for run in counts.chunk_by(|a, b| a == b) {
        if run.len() >= if run[0] == 0 { 5 } else { 7 } {
            in_good_run[start..start + run.len()].fill(true);
        }
        start += run.len();
    }

    // 24.8 fixed point.
    let fixed = |count: u32| count.wrapping_mul(256);
    let average_of_three = |counts: &[u32], i: usize| {
        (fixed(counts[i] + counts[i + 1] + counts[i + 2]) / 3 + 420) as usize
    };
    let mut stride = 0;
    let mut limit = average_of_three(counts, 0);
    let mut sum = 0;
    for i in 0..=length {
        if i == length
            || in_good_run[i]
            || (i != 0 && in_good_run[i - 1])
            || (fixed(counts[i]) as usize + STREAK_LIMIT).wrapping_sub(limit) >= 2 * STREAK_LIMIT
        {
            if stride >= 4 {
                let average = if sum == 0 {
                    0
                } else {
                    ((sum + stride / 2) / stride).max(1)
                };
                counts[i - stride..i].fill(average as u32);
            }
            stride = 0;
            sum = 0;
            if i + 2 < length {
                limit = average_of_three(counts, i);
            }
        }
        stride += 1;
        if let Some(&count) = counts.get(i) {
            sum += count as usize;
            if stride >= 4 {
                limit = (256 * sum + stride / 2) / stride;
            }
            if stride == 4 {
                limit += 120;
            }
        }
    }
}
