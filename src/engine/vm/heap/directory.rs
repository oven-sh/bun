use core::cell::{Cell, OnceCell, RefCell};
use core::ops::Range;

use super::allocator::Allocator;
use super::block::{Block, PAYLOAD_SIZE};
use super::block_memory::BlockSource;
use super::policy::MarkedBytes;
use super::{CellAttributes, Destruction, Heap, Scope, marks};

macro_rules! bits {
    ($($(#[$doc:meta])* $name:ident,)*) => {
        /// What is known of 64 blocks, a bit for each.
        #[derive(Clone, Copy, Default)]
        struct Bits {
            $($(#[$doc])* $name: u64,)*
        }

        impl Bits {
            fn clear_all(&mut self, bit: u64) {
                $(self.$name &= !bit;)*
            }
        }
    };
}

bits! {
    present,
    /// No live cell.
    empty,
    /// Enough free cells to be worth a sweep.
    can_allocate,
    /// Allocated from since the last collection.
    eden,
    /// Its cells have to be destroyed when they die.
    destructible,
    /// Some that have died have not been destroyed.
    unswept,
    /// The last full collection has left room for a page without a live cell, and nothing has been done about it.
    sparse,
    /// Some cell was marked when a collection last counted.
    marked,
    /// So many are marked that the rest is not worth a sweep.
    retired,
    /// Was empty when the collection that is under way began, and has been allocated from since.
    late,
    /// The other set of marks has yet to be cleared.
    stale,
}

impl Bits {
    fn may_get_marks(&self, scope: Scope) -> u64 {
        match scope {
            Scope::Full => self.present & !self.empty,
            Scope::Eden => self.eden,
        }
    }
}

fn take_bit(word: &mut u64, bit: u64) -> bool {
    let was_set = *word & bit != 0;
    *word &= !bit;
    was_set
}

fn set_bits(word: u64) -> impl Iterator<Item = usize> {
    let rests = core::iter::successors(Some(word), |rest| Some(rest & rest.wrapping_sub(1)));
    (rests.take_while(|&rest| rest != 0)).map(|rest| rest.trailing_zeros() as usize)
}

#[derive(Default)]
struct Blocks {
    blocks: Vec<Option<&'static Block>>,
    bits: Vec<Bits>,
    /// As of the end of the last collection.
    mark_counts: Vec<u16>,
    free_indices: Vec<u32>,
}

impl Blocks {
    #[inline]
    fn bits_of(&mut self, block: &Block) -> (&mut Bits, u64) {
        let index = block.index.get() as usize;
        (&mut self.bits[index / 64], 1 << (index % 64))
    }

    /// The first block in the words from `cursor` on that `select` has a bit for.
    fn find(&self, cursor: &Cell<usize>, select: impl Fn(&Bits) -> u64) -> Option<&'static Block> {
        while let Some(bits) = self.bits.get(cursor.get()) {
            if let Some(index) = set_bits(select(bits)).next() {
                return self.blocks[cursor.get() * 64 + index];
            }
            cursor.set(cursor.get() + 1);
        }
        None
    }

    /// Whether it is unswept. It is empty.
    fn remove(&mut self, block: &Block) -> bool {
        let (bits, bit) = self.bits_of(block);
        if bits.stale & bit != 0 {
            block.heap().marks().other().clear_block(block.address());
        }
        let is_unswept = bits.unswept & bit != 0;
        bits.clear_all(bit);
        self.blocks[block.index.get() as usize] = None;
        self.free_indices.push(block.index.get());
        is_unswept
    }
}

/// A block that has some, and the first run of them.
pub(super) type FreeCells = (&'static Block, Range<usize>);

/// The blocks of an allocator.
pub(super) struct Directory {
    heap: *const Heap,
    allocator: *const Allocator,
    blocks: RefCell<Blocks>,
    /// The block in the middle of which allocation has stopped, and will go on unless a collection comes first.
    stopped_block: Cell<Option<&'static Block>>,
    /// In that block, or in the one that is being filled when that began.
    free_cells: Cell<marks::Bits>,
    /// In either of them. See `Marks::hide`.
    hidden: Cell<marks::Bits>,
    all_cells: OnceCell<marks::Bits>,
    stale_cursor: Cell<usize>,
    allocation_cursor: Cell<usize>,
    empty_cursor: Cell<usize>,
    swept_empty_cursor: Cell<usize>,
    unswept_cursor: Cell<usize>,
    sparse_cursor: Cell<usize>,
}

impl Directory {
    pub(super) fn new(heap: &Heap, allocator: &Allocator) -> Directory {
        Directory {
            heap,
            allocator,
            blocks: RefCell::default(),
            stopped_block: Cell::new(None),
            free_cells: Cell::default(),
            hidden: Cell::default(),
            all_cells: OnceCell::new(),
            stale_cursor: Cell::new(0),
            allocation_cursor: Cell::new(0),
            empty_cursor: Cell::new(0),
            swept_empty_cursor: Cell::new(0),
            unswept_cursor: Cell::new(0),
            sparse_cursor: Cell::new(0),
        }
    }

    pub(super) fn heap(&self) -> &Heap {
        // SAFETY: the heap owns the allocator, which owns the directory, and neither moves.
        unsafe { &*self.heap }
    }

    pub(super) fn allocator(&self) -> &Allocator {
        // SAFETY: as above.
        unsafe { &*self.allocator }
    }

    pub(super) fn cell_size(&self) -> usize {
        self.allocator().cell_size()
    }

    pub(super) fn attributes(&self) -> CellAttributes {
        self.allocator().attributes
    }

    pub(super) fn did_request_destruction(&self, block: &Block) {
        let mut blocks = self.blocks.borrow_mut();
        let (bits, bit) = blocks.bits_of(block);
        bits.destructible |= bit;
    }

    /// The same for all blocks.
    #[inline(always)]
    fn all_cells(&self, block: &Block) -> &marks::Bits {
        self.all_cells.get_or_init(|| block.all_cells())
    }

    #[inline(always)]
    pub(super) fn free_run_from(&self, block: &Block, address: usize) -> Option<Range<usize>> {
        let free = self.free_cells.as_array_of_cells();
        block.run_from(address, free, self.all_cells(block))
    }

    pub(super) fn was_free(&self, cell: usize) -> bool {
        let atom = Block::atom_of(cell);
        self.free_cells.as_array_of_cells()[atom / 64].get() >> (atom % 64) & 1 != 0
    }

    /// `position` is where the next cell would have been allocated.
    pub(super) fn did_stop_allocating(&self, block: &'static Block, position: usize) {
        if self.free_run_from(block, position).is_none() {
            return self.did_fill(block);
        }
        block.did_stop_allocating(position);
        let (free, passed) = (self.free_cells.get(), block.atoms_before(position));
        (self.free_cells).set(core::array::from_fn(|index| free[index] & !passed[index]));
        assert!(self.stopped_block.replace(Some(block)).is_none());
    }

    pub(super) fn stopped_block(&self) -> Option<&'static Block> {
        self.stopped_block.get()
    }

    #[inline]
    pub(super) fn has_stopped_in(&self, block: &Block) -> bool {
        (self.stopped_block.get()).is_some_and(|stopped| core::ptr::eq(stopped, block))
    }

    /// Of the block in which allocation has stopped.
    pub(super) fn cells_in_use(&self, block: &Block) -> marks::Bits {
        let (all, free) = (self.all_cells(block), self.free_cells.get());
        core::array::from_fn(|index| all[index] & !free[index])
    }

    pub(super) fn resume_allocating(&self) -> Option<FreeCells> {
        let block = self.stopped_block.get()?;
        // SAFETY: swept before it was first allocated from.
        let found = unsafe { self.start_filling(block) };
        self.stopped_block.set(None);
        found
    }

    /// `None` if it is full.
    ///
    /// # Safety
    /// As for `Block::will_be_filled`.
    #[inline(always)]
    unsafe fn start_filling(&self, block: &'static Block) -> Option<FreeCells> {
        let (all, live) = (self.all_cells(block), block.live_bits());
        (self.free_cells).set(core::array::from_fn(|index| all[index] & !live[index]));
        let first_run = self.free_run_from(block, block.address())?;
        // SAFETY: the caller's.
        unsafe { block.will_be_filled() };
        if self.heap().is_marking_concurrently() {
            self.hide_free_cells(block);
            block.set_hidden_from(first_run.start);
        }
        Some((block, first_run))
    }

    #[inline(never)]
    fn hide_free_cells(&self, block: &Block) {
        let (free, hidden) = (self.free_cells.get(), self.hidden.get());
        self.heap().marks().hide(block.address(), &free);
        (self.hidden).set(core::array::from_fn(|index| hidden[index] | free[index]));
    }

    pub(super) fn did_fill(&self, block: &'static Block) {
        block.did_fill();
        if self.heap().is_marking_concurrently() {
            let hidden = (block, self.hidden.take());
            self.heap().blocks_to_reveal.borrow_mut().push(hidden);
        }
    }

    /// Those among `cells`, for the caller to reveal.
    pub(super) fn take_hidden(&self, cells: &marks::Bits) -> marks::Bits {
        let hidden = self.hidden.get();
        (self.hidden).set(core::array::from_fn(|index| hidden[index] & !cells[index]));
        core::array::from_fn(|index| hidden[index] & cells[index])
    }

    fn destroy_dead_cells(&self, block: &Block) {
        let _state = self.heap().enter_destruction();
        // SAFETY: only the thread of the heap sweeps.
        unsafe { block.destroy_dead_cells() }
    }

    /// For a block that stays in the directory.
    fn sweep(&self, block: &Block) {
        self.destroy_dead_cells(block);
        if self.attributes().destruction == Destruction::OnRequest
            && !block.is_destruction_requested()
        {
            let mut blocks = self.blocks.borrow_mut();
            let (bits, bit) = blocks.bits_of(block);
            bits.destructible &= !bit;
        }
    }

    pub(super) fn find_free_cells(&self) -> Option<FreeCells> {
        let candidates = |bits: &Bits| bits.can_allocate | bits.empty;
        loop {
            let mut blocks = self.blocks.borrow_mut();
            let block = blocks.find(&self.allocation_cursor, candidates)?;
            let (bits, bit) = blocks.bits_of(block);
            let is_unswept = take_bit(&mut bits.unswept, bit);
            bits.can_allocate &= !bit;
            if take_bit(&mut bits.empty, bit) && self.heap().is_marking.get() {
                bits.late |= bit;
            }
            bits.sparse &= !bit;
            bits.eden |= bit;
            if let Some(next) = blocks.find(&self.allocation_cursor, candidates) {
                next.prefetch_for_allocation(self.heap().last_marks());
            }
            drop(blocks);
            if is_unswept {
                self.sweep(block);
            }
            // SAFETY: swept.
            if let found @ Some(_) = unsafe { self.start_filling(block) } {
                return found;
            }
            self.did_fill(block);
        }
    }

    /// # Safety
    /// `memory` is an unused block from the source of the allocator.
    pub(super) unsafe fn add_block(&self, memory: usize) -> Option<FreeCells> {
        // SAFETY: the caller's, and the heap frees the block before the directory goes.
        let block = unsafe { Block::initialize(memory, self) };
        let mut blocks = self.blocks.borrow_mut();
        let index = blocks.free_indices.pop().unwrap_or_else(|| {
            blocks.blocks.push(None);
            blocks.mark_counts.push(0);
            let words = blocks.blocks.len().div_ceil(64);
            blocks.bits.resize(words, Bits::default());
            blocks.blocks.len() as u32 - 1
        });
        blocks.blocks[index as usize] = Some(block);
        block.index.set(index);
        let (bits, bit) = blocks.bits_of(block);
        bits.present |= bit;
        bits.eden |= bit;
        if self.heap().is_marking.get() {
            bits.late |= bit;
        }
        if self.attributes().destroys_every_cell() {
            bits.destructible |= bit;
        }
        // SAFETY: nothing is in it.
        unsafe { self.start_filling(block) }
    }

    /// Removes an empty block and returns its memory, in which everything has been destroyed.
    pub(super) fn take_empty_block(&self) -> Option<usize> {
        let mut blocks = self.blocks.borrow_mut();
        let block = blocks.find(&self.empty_cursor, |bits| bits.empty)?;
        let is_unswept = blocks.remove(block);
        drop(blocks);
        if is_unswept {
            self.destroy_dead_cells(block);
        }
        block.reuse_discarded_pages();
        Some(block.address())
    }

    /// The same, but only one in which nothing is left to destroy.
    pub(super) fn take_swept_empty_block(&self) -> Option<usize> {
        let mut blocks = self.blocks.borrow_mut();
        let block = blocks.find(&self.swept_empty_cursor, |bits| bits.empty & !bits.unswept)?;
        blocks.remove(block);
        block.reuse_discarded_pages();
        Some(block.address())
    }

    pub(super) fn clear_marks(&self) {
        let (blocks, marks) = (self.blocks.borrow(), self.heap().marks());
        for (bits, blocks) in blocks.bits.iter().zip(blocks.blocks.chunks(64)) {
            for block in set_bits(bits.marked).filter_map(|index| blocks[index]) {
                marks.clear_block(block.address());
            }
        }
    }

    /// In up to 64 blocks. False if there are none. No full collection is under way.
    pub(super) fn clear_some_stale_marks(&self) -> bool {
        let blocks = &mut *self.blocks.borrow_mut();
        let Some(block) = blocks.find(&self.stale_cursor, |bits| bits.stale) else {
            return false;
        };
        let (word, stale_marks) = (block.index.get() as usize / 64, self.heap().marks().other());
        let stale = core::mem::take(&mut blocks.bits[word].stale);
        for block in set_bits(stale).filter_map(|index| blocks.blocks[word * 64 + index]) {
            stale_marks.clear_block(block.address());
        }
        true
    }

    /// The heap is about to turn to the other set, which is clear.
    pub(super) fn will_swap_marks(&self) {
        for bits in &mut self.blocks.borrow_mut().bits {
            bits.stale = bits.marked;
        }
    }

    /// In place of the end of marking, when nothing is to survive.
    pub(super) fn clear_all_marks(&self) {
        let marks = self.heap().marks();
        for block in self.blocks() {
            marks.clear_block(block.address());
            marks.other().clear_block(block.address());
        }
    }

    pub(super) fn add_blocks_to_count(&self, scope: Scope, addresses: &mut Vec<Cell<usize>>) {
        let blocks = self.blocks.borrow();
        for (bits, blocks) in blocks.bits.iter().zip(blocks.blocks.chunks(64)) {
            let examined = set_bits(bits.may_get_marks(scope)).filter_map(|index| blocks[index]);
            addresses.extend(examined.map(|block| Cell::new(block.address())));
        }
    }

    /// Takes the number of marks of each of those blocks.
    pub(super) fn end_marking(
        &self,
        scope: Scope,
        mark_counts: &mut impl Iterator<Item = usize>,
    ) -> MarkedBytes {
        let cells = (PAYLOAD_SIZE / self.cell_size()) as u16;
        let retire_count = (cells * 9).div_ceil(10);
        let sparse_count = self.max_marks_of_sparse_block(cells);
        let (mut newly_marked, mut late) = (0, 0);
        self.stopped_block.set(None);
        let blocks = &mut *self.blocks.borrow_mut();
        if scope == Scope::Full {
            blocks.mark_counts.fill(0);
        }
        for (bits, counts) in (blocks.bits.iter_mut()).zip(blocks.mark_counts.chunks_mut(64)) {
            let examined = bits.may_get_marks(scope);
            if scope == Scope::Full {
                (bits.sparse, bits.marked, bits.retired) = (0, 0, 0);
            }
            bits.unswept |= examined & bits.destructible;
            for (index, count) in set_bits(examined).zip(&mut *mark_counts) {
                late += count * (bits.late >> index & 1) as usize;
                let count = count as u16;
                newly_marked += usize::from(count - core::mem::replace(&mut counts[index], count));
                let is_sparse = scope == Scope::Full && (1..sparse_count).contains(&count);
                bits.marked |= u64::from(count != 0) << index;
                bits.retired |= u64::from(count >= retire_count) << index;
                bits.sparse |= u64::from(is_sparse) << index;
                bits.unswept &= !(u64::from(count == cells) << index);
            }
            bits.empty = bits.present & !bits.marked;
            bits.can_allocate = bits.marked & !bits.retired;
            (bits.eden, bits.late) = (0, 0);
        }
        for cursor in [
            &self.stale_cursor,
            &self.allocation_cursor,
            &self.empty_cursor,
            &self.swept_empty_cursor,
            &self.unswept_cursor,
            &self.sparse_cursor,
        ] {
            cursor.set(0);
        }
        MarkedBytes {
            total: newly_marked * self.cell_size(),
            late: late * self.cell_size(),
        }
    }

    /// One more than that, and zero if pages of these blocks are not given back.
    fn max_marks_of_sparse_block(&self, cells: u16) -> u16 {
        // Elsewhere, reading a page that has been given back is no fault. A dead shape may still be read.
        if cfg!(windows) || self.allocator().source == BlockSource::Shapes {
            return 0;
        }
        let cells_in_page = bun_alloc::page_size().div_ceil(self.cell_size()) as u16;
        (cells + 1).saturating_sub(cells_in_page)
    }

    /// False if there is nothing to sweep.
    pub(super) fn sweep_next_block(&self) -> bool {
        let mut blocks = self.blocks.borrow_mut();
        let Some(block) = blocks.find(&self.unswept_cursor, |bits| bits.unswept) else {
            return false;
        };
        let (bits, bit) = blocks.bits_of(block);
        bits.unswept &= !bit;
        drop(blocks);
        self.sweep(block);
        let word = block.index.get() as usize / 64;
        self.swept_empty_cursor
            .set(self.swept_empty_cursor.get().min(word));
        true
    }

    /// False if there is none. Nothing is unswept.
    pub(super) fn discard_pages_of_next_sparse_block(&self) -> bool {
        let mut blocks = self.blocks.borrow_mut();
        let Some(block) = blocks.find(&self.sparse_cursor, |bits| bits.sparse) else {
            return false;
        };
        let (bits, bit) = blocks.bits_of(block);
        assert!(bits.unswept & bit == 0);
        bits.sparse &= !bit;
        // SAFETY: swept, and not allocated from since the last collection.
        unsafe { block.discard_unused_pages() };
        true
    }

    /// Nothing is unswept.
    #[cold]
    pub(super) fn scribble_on_dead_cells(&self) {
        for block in self.selected(|bits| bits.present & !bits.eden & !bits.unswept) {
            // SAFETY: swept, and not allocated from since the last collection.
            unsafe { block.scribble_on_dead_cells() };
        }
    }

    /// When marking is about to end.
    #[cold]
    pub(super) fn verify_marks(&self) {
        assert!(self.hidden.get() == marks::Bits::default());
        let heap = self.heap();
        let knows_the_dead = heap.has_swapped_marks.get();
        for block in self.blocks() {
            let candidates = match self.has_stopped_in(block) || knows_the_dead {
                true if !block.is_allocated() => block.live_bits(),
                _ => *self.all_cells(block),
            };
            let marked = heap.marks().of_block(block.address());
            let is_valid = (marked.iter().zip(candidates)).all(|(marked, it)| marked & !it == 0);
            assert!(
                is_valid,
                "a mark for no live cell in {:#x}",
                block.address()
            );
        }
    }

    /// Borrows nothing between two of them.
    fn selected(&self, select: fn(&Bits) -> u64) -> impl Iterator<Item = &'static Block> {
        let words = (0..).map_while(move |word| self.blocks.borrow().bits.get(word).map(select));
        let indices = (words.enumerate())
            .flat_map(|(word, selected)| set_bits(selected).map(move |index| word * 64 + index));
        indices.filter_map(|index| self.blocks.borrow().blocks[index])
    }

    pub(super) fn blocks(&self) -> impl Iterator<Item = &'static Block> {
        self.selected(|bits| bits.present)
    }

    pub(super) fn blocks_in_use(&self) -> impl Iterator<Item = &'static Block> {
        self.selected(|bits| bits.present & !bits.empty)
    }

    /// As of the end of the last collection.
    pub(super) fn mark_count(&self) -> usize {
        let blocks = self.blocks.borrow();
        blocks.mark_counts.iter().map(|&it| usize::from(it)).sum()
    }

    pub(super) fn empty_block_count(&self) -> usize {
        let blocks = self.blocks.borrow();
        let counts = blocks.bits.iter().map(|bits| bits.empty.count_ones());
        counts.sum::<u32>() as usize
    }
}
