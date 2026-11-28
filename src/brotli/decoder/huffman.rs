//! Tables that decode a prefix code: one for the first bits, followed by smaller ones for the rest of longer codes.

use super::Stop;
use super::bit_reader::Bits;
use crate::format::{MAX_CODE_LENGTH, reverse_byte};
use crate::{DecodeError, memory};
use bun_highway::brotli_decoder::{
    Command, ContextParts, Distance, Root, Symbol, SymbolLists, SymbolTree,
};
use bun_highway::with_avx2;

/// How much longer than `length` the last code is that it takes to fill the space of `space` codes of that length.
fn more_bits_to_fill(code: &SymbolLists, mut space: usize, length: u32) -> u32 {
    let mut more = 0;
    for longer in length + 1..=MAX_CODE_LENGTH as u32 {
        if space == 0 {
            break;
        }
        space = (2 * space).saturating_sub(code.of_length(longer).len());
        more += 1;
    }
    more
}

pub(super) trait Entry: Copy + Default {
    /// How many entries have to exist from where a tree starts. Zero if links go far, so that all roots can come first.
    const REACH: usize;

    /// To a table for `bits` more bits, which starts at `table` after the root.
    fn link(table: usize, bits: u32) -> Self;
}

const NARROW_SIZE: usize = 1 << Root::Bits8.bits();

/// A table for codes with `a` to `b` more bits has `2^b` entries for `2^a + b - a` codes or more, and the next one has `b` bits or more.
const MAX_EXCESS: usize = (1 << MAX_MORE_BITS) - (1 << 1) - (MAX_MORE_BITS - 1);
const MAX_MORE_BITS: usize = MAX_CODE_LENGTH - Root::Bits8.bits() as usize;

/// The trees of a meta-block.
#[derive(Default)]
pub(super) struct Forest<E> {
    /// Keeps its length from one meta-block to the next, so that it is not zeroed again.
    entries: Vec<E>,
    used: usize,
    /// Growing goes straight there, so that the trees only move once.
    max_len: usize,
    len: usize,
    root_bits: u32,
    /// Unless the roots come first.
    starts: Vec<u32>,
}

impl<E: Entry> Forest<E> {
    pub(super) fn clear(&mut self) {
        (self.used, self.len) = (0, 0);
        self.starts.clear();
    }

    pub(super) fn size_in_bytes(&self) -> usize {
        self.entries.capacity() * size_of::<E>()
    }

    pub(super) fn len(&self) -> usize {
        self.len
    }

    pub(super) fn try_reserve(
        &mut self,
        trees: usize,
        alphabet_size: u32,
        root: Root,
    ) -> Result<(), Stop> {
        const USUAL_FOR_LONG_CODES: usize = 64;
        let for_roots = self.used + (trees << root.bits()) + E::REACH;
        self.max_len = for_roots + trees * (MAX_EXCESS + alphabet_size as usize);
        let usual_len = for_roots + trees * USUAL_FOR_LONG_CODES + MAX_EXCESS;
        let more = usual_len.saturating_sub(self.entries.len());
        if E::REACH == 0 {
            (self.used, self.root_bits) = (for_roots, root.bits());
        }
        (self.starts.try_reserve(trees.min(E::REACH)))
            .and_then(|()| self.entries.try_reserve_exact(more))
            .map_err(|_| DecodeError::AllocTreeGroups.into())
    }

    pub(super) fn entries(&self) -> &[E] {
        &self.entries
    }

    #[inline(always)]
    pub(super) fn start(&self, index: usize) -> Result<usize, Stop> {
        if E::REACH == 0 && index < self.len {
            return Ok(index << self.root_bits);
        }
        Ok(*self.starts.get(index).ok_or(Stop::UNREACHABLE)? as usize)
    }

    /// And those after it.
    #[inline(always)]
    pub(super) fn entries_of(&self, index: usize) -> Result<&[E], Stop> {
        (self.entries.get(self.start(index)?..)).ok_or(Stop::UNREACHABLE)
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
        with_avx2(
            #[inline(always)]
            || self.push_here(code, root, entry_for),
        )
    }

    #[inline(always)]
    fn push_here(
        &mut self,
        code: &SymbolLists,
        root: Root,
        entry_for: impl Fn(u32, u32) -> E,
    ) -> Result<(), Stop> {
        let (mut start, root_bits) = (self.len << root.bits(), root.bits());
        if E::REACH != 0 {
            if self.starts.len() == self.starts.capacity() {
                self.try_reserve(4, 0, root)?;
            }
            start = self.used;
            self.starts.push(start as u32);
            self.used += 1 << root_bits;
        }
        self.len += 1;
        let reach = self.range_mut(start, E::REACH.max(1 << root_bits))?;
        let narrow = reach.first_chunk_mut::<NARROW_SIZE>();
        let narrow = narrow.ok_or(Stop::UNREACHABLE)?;
        let mut next_code = COMPLETE;
        match code.only_symbol() {
            Some(only) => narrow.fill(entry_for(only, 0)),
            None => next_code = fill_root(narrow, code, &entry_for),
        }
        for length in Root::Bits8.bits() + 1..=root_bits {
            let filled = 1 << (length - 1);
            reach.copy_within(..filled, filled);
            for symbol in code.of_length(length) {
                let slot = reach.get_mut(reverse(next_code));
                *slot.ok_or(Stop::UNREACHABLE)? = entry_for(symbol, length);
                next_code += COMPLETE >> length;
            }
        }
        if next_code == COMPLETE {
            return Ok(());
        }

        let long_codes =
            (root_bits + 1..=MAX_CODE_LENGTH as u32).map(|length| code.of_length(length).len());
        let (mut table, mut table_end) = (0, self.used - start);
        let tree = self.range_mut(start, table_end + long_codes.sum::<usize>() + MAX_EXCESS)?;
        for length in root_bits + 1..=MAX_CODE_LENGTH as u32 {
            let step: usize = 1 << (length - root_bits);
            let mut symbols = code.of_length(length);
            while let Some(symbol) = symbols.next() {
                let in_table = reverse(next_code) >> root_bits;
                if in_table == 0 {
                    let mut bits = length - root_bits;
                    if let Some(space) = (step - 1).checked_sub(symbols.len()) {
                        bits += more_bits_to_fill(code, space, length);
                    }
                    (table, table_end) = (table_end, table_end + (1 << bits));
                    let slot = tree.get_mut(reverse(next_code));
                    *slot.ok_or(Stop::UNREACHABLE)? = E::link(table - (1 << root_bits), bits);
                }
                let entry = entry_for(symbol, length);
                let mut at = table + in_table;
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
fn fill_root<E: Copy>(
    root: &mut [E; NARROW_SIZE],
    code: &SymbolLists,
    entry_for: impl Fn(u32, u32) -> E,
) -> u32 {
    let mut next_code = 0;
    // Copying what was just written has to wait for it, which takes longer than writing a few entries again.
    let mut add = |root: &mut [E; NARROW_SIZE], length: u32, copies: usize| {
        for symbol in code.of_length(length) {
            let (entry, at) = (entry_for(symbol, length), reverse_byte(next_code as u8));
            for copy in 0..copies {
                root[(usize::from(at) + (copy << length)) % NARROW_SIZE] = entry;
            }
            next_code += NARROW_SIZE as u32 >> length;
        }
    };
    add(root, 1, 8);
    add(root, 2, 4);
    add(root, 3, 2);
    add(root, 4, 1);
    quadruple::<E, 16>(root);
    add(root, 5, 2);
    add(root, 6, 1);
    quadruple::<E, 64>(root);
    add(root, 7, 2);
    add(root, 8, 1);
    next_code << 8
}

#[inline(always)]
fn quadruple<E: Copy, const N: usize>(entries: &mut [E; NARROW_SIZE]) {
    if let [first, a, b, c, ..] = entries.as_chunks_mut::<N>().0 {
        for (((&first, a), b), c) in first.iter().zip(a).zip(b).zip(c) {
            (*a, *b, *c) = (first, first, first);
        }
    }
}

/// The low 16 bits.
#[inline(always)]
fn reverse(code: u32) -> usize {
    usize::from(reverse_byte((code >> 8) as u8)) | (usize::from(reverse_byte(code as u8)) << 8)
}

impl Entry for Symbol {
    const REACH: usize = Self::REACH;

    fn link(table: usize, bits: u32) -> Self {
        Self::link(table, bits)
    }
}

impl Entry for Command {
    const REACH: usize = 0;

    fn link(table: usize, bits: u32) -> Self {
        Self::link(table, bits)
    }
}

impl Entry for Distance {
    const REACH: usize = 0;

    fn link(table: usize, bits: u32) -> Self {
        Self::link(table, bits)
    }
}

#[inline(always)]
pub(super) fn peek_symbol(tree: &SymbolTree, root: Root, bits: u64) -> Symbol {
    Symbol::in_root(tree, root, bits).resolve(tree, root, bits)
}

/// From a tree that is not for literals.
#[inline(always)]
pub(super) fn read_symbol(tree: &SymbolTree, bits: &mut Bits) -> Result<u32, Stop> {
    let symbol = peek_symbol(tree, Root::Bits8, bits.peek());
    bits.skip(symbol.length())?;
    Ok(symbol.value())
}

impl Forest<Symbol> {
    /// The trees that are `indexes` after `first`.
    #[inline(always)]
    pub(super) fn look_up<'a>(
        &'a self,
        first: usize,
        indexes: &[u8],
        trees: &mut [&'a SymbolTree],
    ) -> Option<()> {
        let (starts, entries) = (self.starts.get(first..)?, &*self.entries);
        for (tree, &index) in trees.iter_mut().zip(indexes) {
            let start = *starts.get(usize::from(index))? as usize;
            *tree = entries.get(start..start + Symbol::REACH)?.as_array()?;
        }
        Some(())
    }

    pub(super) fn pop(&mut self) {
        self.used = self.starts.pop().map_or(0, |start| start as usize);
        self.len = self.starts.len();
    }

    #[inline(always)]
    pub(super) fn tree(&self, index: usize) -> Result<&SymbolTree, Stop> {
        let start = self.start(index)?;
        let entries = self.entries.get(start..start + Symbol::REACH);
        entries.and_then(<[_]>::as_array).ok_or(Stop::UNREACHABLE)
    }

    pub(super) fn push_symbols(&mut self, code: &SymbolLists) -> Result<(), Stop> {
        self.push_here(code, Root::Bits8, Symbol::new)
    }

    pub(super) fn push_literals(
        &mut self,
        code: &SymbolLists,
        root: Root,
        parts: &ContextParts,
    ) -> Result<(), Stop> {
        let usual = code.usual_length();
        self.push(code, root, |symbol, length| {
            Symbol::for_literal(symbol as u8, length, length == usual, parts)
        })
    }
}
