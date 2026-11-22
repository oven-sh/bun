//! Tables that decode a prefix code: one for the first bits, followed by smaller ones for the rest of longer codes.

use super::Stop;
use super::bit_reader::Bits;
use crate::context::ContextLut;
use crate::format::{COMMAND_SYMBOLS, MAX_CODE_LENGTH, reverse_byte};
use crate::{DecodeError, memory};
use std::collections::TryReserveError;

const LENGTHS: usize = MAX_CODE_LENGTH + 1;

/// The symbols of a code, in one list for each length. The one for no length does not matter.
pub(super) struct SymbolLists {
    /// For each symbol, the next one. The first ones are at the end.
    next: Box<[u16; Self::SIZE]>,
    last: [u16; LENGTHS],
    counts: [u16; LENGTHS],
}

#[allow(clippy::indexing_slicing)] // Reduced to the size of the tables.
impl SymbolLists {
    const SIZE: usize = (COMMAND_SYMBOLS + LENGTHS).next_power_of_two();
    const HEADS: usize = Self::SIZE - LENGTHS;

    pub(super) fn new() -> Result<Self, Stop> {
        Ok(Self {
            next: memory::zeroed_array().map_err(|_| DecodeError::AllocTreeGroups)?,
            last: [0; _],
            counts: [0; _],
        })
    }

    pub(super) fn clear(&mut self) {
        self.last = core::array::from_fn(|length| (Self::HEADS + length) as u16);
        self.counts = [0; _];
    }

    /// Of more than one symbol.
    pub(super) fn clear_for_runs(&mut self, alphabet_size: u32) {
        self.clear();
        for (next, successor) in self.next.iter_mut().zip(1..alphabet_size as u16) {
            *next = successor;
        }
    }

    /// Symbols come in ascending order. `count` is not zero.
    #[inline(always)]
    pub(super) fn push_run(&mut self, length: u32, first: u32, count: u32) {
        let length = length as usize % LENGTHS;
        let last = core::mem::replace(&mut self.last[length], (first + count - 1) as u16);
        self.next[usize::from(last) % Self::SIZE] = first as u16;
        self.counts[length] += count as u16;
    }

    /// How much longer than `length` the last code is that it takes to fill the space of `space` codes of that length.
    fn more_bits_to_fill(&self, mut space: usize, length: u32) -> u32 {
        let mut more = 0;
        for &count in self.counts.iter().skip(length as usize + 1) {
            if space == 0 {
                break;
            }
            space = (2 * space).saturating_sub(usize::from(count));
            more += 1;
        }
        more
    }

    /// The code for it is incomplete with one bit, and needs none.
    fn only_symbol(&self) -> Option<u32> {
        let is_alone = self.counts[1] == 1 && self.counts[2..] == [0; LENGTHS - 2];
        self.of_length(1).next().filter(|_| is_alone)
    }

    #[inline(always)]
    fn of_length(&self, length: usize) -> impl ExactSizeIterator<Item = u32> {
        let mut at = (Self::HEADS + length) as u16;
        (0..self.counts[length % LENGTHS]).map(move |_| {
            at = self.next[usize::from(at) % Self::SIZE];
            u32::from(at)
        })
    }
}

pub(super) trait Entry: Copy + Default {
    /// How many entries have to exist from where a tree starts.
    const REACH: usize;

    /// To a table for `bits` more bits, which starts at `table` in a forest. The tree starts at `tree`.
    fn link(tree: usize, table: usize, bits: u32) -> Self;
}

/// The mask for the bits that the first table of a tree is for. The compiler knows the range of these.
#[derive(Clone, Copy)]
#[repr(u32)]
pub(super) enum Root {
    Narrow = 0xFF,
    Wide = 0x1FF,
}

impl Root {
    #[inline(always)]
    pub(super) const fn bits(self) -> u32 {
        (self as u32).bit_width()
    }
}

const NARROW_SIZE: usize = 1 << Root::Narrow.bits();

/// A table for codes with `a` to `b` more bits has `2^b` entries for `2^a + b - a` codes or more, and the next one has `b` bits or more.
const MAX_EXCESS: usize = (1 << MAX_MORE_BITS) - (1 << 1) - (MAX_MORE_BITS - 1);
const MAX_MORE_BITS: usize = MAX_CODE_LENGTH - Root::Narrow.bits() as usize;

/// The trees of a meta-block.
#[derive(Default)]
pub(super) struct Forest<E> {
    /// Keeps its length from one meta-block to the next, so that it is not zeroed again.
    entries: Vec<E>,
    used: usize,
    /// Growing goes straight there, so that the trees only move once.
    max_len: usize,
    starts: Vec<u32>,
}

impl<E: Entry> Forest<E> {
    pub(super) fn clear(&mut self) {
        self.used = 0;
        self.starts.clear();
    }

    pub(super) fn len(&self) -> usize {
        self.starts.len()
    }

    pub(super) fn pop(&mut self) {
        self.used = self.starts.pop().map_or(0, |start| start as usize);
    }

    /// For trees whose alphabets have `symbols` symbols in all.
    pub(super) fn try_reserve(
        &mut self,
        trees: usize,
        symbols: usize,
        root: Root,
    ) -> Result<(), TryReserveError> {
        const USUAL_FOR_LONG_CODES: usize = 64;
        self.starts.try_reserve(trees)?;
        let for_roots = self.used + (trees << root.bits()) + E::REACH;
        self.max_len = for_roots + trees * MAX_EXCESS + symbols;
        let usual_len = for_roots + trees * USUAL_FOR_LONG_CODES;
        (self.entries).try_reserve_exact(usual_len.saturating_sub(self.entries.len()))
    }

    /// `N` is no more than [`Entry::REACH`].
    #[inline(always)]
    pub(super) fn tree<const N: usize>(&self, index: usize) -> Result<&[E; N], Stop> {
        let start = *self.starts.get(index).ok_or(Stop::UNREACHABLE)? as usize;
        let entries = self.entries.get(start..start + N);
        entries.and_then(<[E]>::as_array).ok_or(Stop::UNREACHABLE)
    }

    #[inline(always)]
    fn range_mut(&mut self, start: usize, size: usize) -> Result<&mut [E], Stop> {
        if start + size > self.entries.len() {
            self.extend_to(start + size)?;
        }
        (self.entries.get_mut(start..start + size)).ok_or(Stop::UNREACHABLE)
    }

    #[cold]
    fn extend_to(&mut self, len: usize) -> Result<(), Stop> {
        if len > self.entries.capacity() {
            (self.entries)
                .try_reserve_exact(len.max(self.max_len) - self.entries.len())
                .map_err(|_| DecodeError::AllocTreeGroups)?;
        }
        memory::resize(&mut self.entries, len, E::default());
        Ok(())
    }

    /// Adds the tree of a complete code.
    #[inline(always)]
    pub(super) fn push(
        &mut self,
        code: &SymbolLists,
        root: Root,
        entry_for: impl Fn(u32, u32) -> E,
    ) -> Result<(), Stop> {
        if self.starts.len() == self.starts.capacity() {
            (self.try_reserve(4, 0, root)).map_err(|_| DecodeError::AllocTreeGroups)?;
        }
        let (start, root_bits) = (self.used, root.bits());
        self.starts.push(start as u32);
        self.used += 1 << root_bits;
        let reach = self.range_mut(start, E::REACH)?;
        let narrow = reach.first_chunk_mut::<NARROW_SIZE>();
        let narrow = narrow.ok_or(Stop::UNREACHABLE)?;
        let mut next_code = COMPLETE;
        match code.only_symbol() {
            Some(only) => narrow.fill(entry_for(only, 0)),
            None => next_code = fill_root(narrow, |length| code.of_length(length), &entry_for),
        }
        if let Root::Wide = root {
            reach.copy_within(..NARROW_SIZE, NARROW_SIZE);
            for symbol in code.of_length(root_bits as usize) {
                let slot = reach.get_mut(reverse(next_code));
                *slot.ok_or(Stop::UNREACHABLE)? = entry_for(symbol, root_bits);
                next_code += COMPLETE >> root_bits;
            }
        }
        if next_code == COMPLETE {
            return Ok(());
        }

        let long_counts = code.counts.iter().skip(root_bits as usize + 1);
        let max_size = (1 << root_bits) + usize::from(long_counts.sum::<u16>()) + MAX_EXCESS;
        let tree = self.range_mut(start, max_size)?;
        let (mut table, mut table_end) = (0, 1 << root_bits);
        for length in root_bits + 1..=MAX_CODE_LENGTH as u32 {
            let step: usize = 1 << (length - root_bits);
            let mut symbols = code.of_length(length as usize);
            while let Some(symbol) = symbols.next() {
                let in_table = reverse_byte((next_code << (root_bits - 8)) as u8);
                if in_table == 0 {
                    let mut bits = length - root_bits;
                    if let Some(space) = (step - 1).checked_sub(symbols.len()) {
                        bits += code.more_bits_to_fill(space, length);
                    }
                    (table, table_end) = (table_end, table_end + (1 << bits));
                    let slot = tree.get_mut(reverse(next_code));
                    *slot.ok_or(Stop::UNREACHABLE)? = E::link(start, start + table, bits);
                }
                let entry = entry_for(symbol, length);
                let mut at = table + usize::from(in_table);
                loop {
                    *tree.get_mut(at).ok_or(Stop::UNREACHABLE)? = entry;
                    at += step;
                    if at >= table_end {
                        break;
                    }
                }
                next_code += COMPLETE >> length;
            }
        }
        self.used = start + table_end;
        Ok(())
    }
}

/// What comes after the last code.
const COMPLETE: u32 = 1 << u16::BITS;

/// Returns the next code, in the high bits of 16.
#[inline(always)]
#[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
pub(super) fn fill_root<E: Copy, I: Iterator<Item = u32>, const SIZE: usize>(
    root: &mut [E; SIZE],
    symbols_of_length: impl Fn(usize) -> I,
    entry_for: impl Fn(u32, u32) -> E,
) -> u32 {
    /// Copying what was just written has to wait for it, which takes longer than writing a few entries again.
    const FIRST_BITS: u32 = 4;
    let mut next_code = 0;
    for length in 1..=FIRST_BITS {
        for symbol in symbols_of_length(length as usize) {
            let entry = entry_for(symbol, length);
            for copy in 0..1 << (FIRST_BITS - length) {
                root[(reverse(next_code) + (copy << length)) % SIZE] = entry;
            }
            next_code += COMPLETE >> length;
        }
    }
    for length in FIRST_BITS + 1..=SIZE.ilog2() {
        let filled = 1 << (length - 1);
        root.copy_within(..filled, filled);
        for symbol in symbols_of_length(length as usize) {
            root[reverse(next_code) % SIZE] = entry_for(symbol, length);
            next_code += COMPLETE >> length;
        }
    }
    next_code
}

/// The low 16 bits.
#[inline(always)]
fn reverse(code: u32) -> usize {
    usize::from(reverse_byte((code >> 8) as u8)) | (usize::from(reverse_byte(code as u8)) << 8)
}

/// A value, and below it the length of the code. Then, for a literal, [`ContextLut::parts`].
#[derive(Clone, Copy, Default)]
pub(super) struct Symbol(u32);

impl Symbol {
    /// What a shift of a `u64` looks at.
    const LENGTH_BITS: u32 = 6;

    #[inline(always)]
    fn new(value: u32, length: u32) -> Self {
        Self((value << Self::LENGTH_BITS) | length)
    }

    #[inline(always)]
    fn value(self) -> u32 {
        self.0 >> Self::LENGTH_BITS
    }

    /// The value and the length in a tree of literals, where each is a byte of the entry.
    #[inline(always)]
    pub(super) fn literal(self) -> (u8, u32) {
        let [length, literal, ..] = self.0.to_le_bytes();
        (literal, u32::from(length))
    }

    #[inline(always)]
    pub(super) fn context_parts(self) -> [u32; 2] {
        [self.0 >> 24, (self.0 >> 16) & 0xFF]
    }

    #[inline(always)]
    fn length(self) -> u32 {
        self.0 % (1 << Self::LENGTH_BITS)
    }

    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
    pub(super) fn in_root(tree: &SymbolTree, root: Root, bits: u64) -> Self {
        tree[(bits as u32 & root as u32) as usize]
    }

    /// Follows the link, if that is what `bits` led to in the root.
    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
    pub(super) fn resolve(self, tree: &SymbolTree, root: Root, bits: u64) -> Self {
        let Some(more_bits) = self.length().checked_sub(LENGTHS as u32) else {
            return self;
        };
        let rest = (bits as u32 >> root.bits()) & ((1 << more_bits) - 1);
        tree[(self.value() + rest) as usize % Self::REACH]
    }
}

impl Entry for Symbol {
    /// As far as a link goes, which is more than the tree for up to 272 symbols needs.
    const REACH: usize = 1 << (u16::BITS - Self::LENGTH_BITS);

    fn link(tree: usize, table: usize, bits: u32) -> Self {
        Self::new((table - tree) as u32, LENGTHS as u32 + bits)
    }
}

pub(super) type SymbolTree = [Symbol; Symbol::REACH];

#[inline(always)]
pub(super) fn peek_symbol(tree: &SymbolTree, root: Root, bits: u64) -> Symbol {
    Symbol::in_root(tree, root, bits).resolve(tree, root, bits)
}

/// From a tree that is not for literals.
#[inline(always)]
pub(super) fn read_symbol(tree: &SymbolTree, bits: &mut Bits) -> Result<u32, Stop> {
    let symbol = peek_symbol(tree, Root::Narrow, bits.peek());
    bits.skip(symbol.length())?;
    Ok(symbol.value())
}

impl Forest<Symbol> {
    pub(super) fn push_symbols(&mut self, code: &SymbolLists) -> Result<(), Stop> {
        self.push(code, Root::Narrow, Symbol::new)
    }

    pub(super) fn push_literals(
        &mut self,
        code: &SymbolLists,
        root: Root,
        lut: &ContextLut,
    ) -> Result<(), Stop> {
        self.push(code, root, |symbol, length| {
            let [last, second_last] = lut.parts(symbol as u8);
            Symbol(u32::from_le_bytes([
                length as u8,
                symbol as u8,
                second_last,
                last,
            ]))
        })
    }
}

/// A symbol that has extra bits. What the small and the large numbers mean depends on the alphabet.
#[derive(Clone, Copy, Default)]
#[repr(align(8))]
pub(super) struct Ranges([u8; 8]);

#[allow(clippy::trivially_copy_pass_by_ref)] // Loading a field from the table is faster than extracting it.
impl Ranges {
    const LINK: u32 = 0x80;

    const fn from_fields(bytes: [u8; 4], large: u32) -> Self {
        Self((((large as u64) << 32) | u32::from_le_bytes(bytes) as u64).to_le_bytes())
    }

    #[inline(always)]
    pub(super) const fn new(extra_bits: u32, small: [u8; 2], large: u32) -> Self {
        Self::from_fields([extra_bits as u8, 0, small[0], small[1]], large)
    }

    /// Adds `length` to the first of the small numbers, too.
    #[inline(always)]
    pub(super) fn with_code_length(self, length: u32) -> Self {
        Self((u64::from_le_bytes(self.0) + u64::from(length * 0x01_0101)).to_le_bytes())
    }

    /// With the extra bits.
    #[inline(always)]
    pub(super) fn total_length(&self) -> u32 {
        u32::from(self.0[0])
    }

    #[inline(always)]
    pub(super) fn code_length(&self) -> u32 {
        u32::from(self.0[1])
    }

    #[inline(always)]
    pub(super) fn small(&self) -> [u32; 2] {
        [self.0[2], self.0[3]].map(u32::from)
    }

    #[inline(always)]
    pub(super) fn large(&self) -> u32 {
        let [.., a, b, c, d] = self.0;
        u32::from_le_bytes([a, b, c, d])
    }

    #[inline(always)]
    pub(super) fn halves_of_large(&self) -> [u32; 2] {
        let [.., a, b, c, d] = self.0;
        [
            u32::from(u16::from_le_bytes([a, b])),
            u32::from(u16::from_le_bytes([c, d])),
        ]
    }

    /// `self` is from a narrow root, and `entries` are those of its forest.
    #[inline(always)]
    pub(super) fn resolve<'a>(&'a self, entries: &'a [Self], bits: u64) -> Option<&'a Self> {
        if self.total_length() != Self::LINK {
            return Some(self);
        }
        let mask = (1 << (self.code_length() % u32::BITS)) - 1;
        entries.get((self.large() + ((bits >> Root::Narrow.bits()) as u32 & mask)) as usize)
    }
}

impl Entry for Ranges {
    const REACH: usize = NARROW_SIZE;

    fn link(_tree: usize, table: usize, bits: u32) -> Self {
        Self::from_fields([Self::LINK as u8, bits as u8, 0, 0], table as u32)
    }
}

pub(super) type RangesRoot = [Ranges; NARROW_SIZE];

impl Forest<Ranges> {
    pub(super) fn entries(&self) -> &[Ranges] {
        &self.entries
    }
}
