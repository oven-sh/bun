use core::cell::{Cell, OnceCell};
use core::mem::offset_of;
use core::ops::Range;

use super::block::{BLOCK_SIZE, Block, unpoison};
use super::block_memory::BlockSource;
use super::directory::Directory;
use super::marks::Bits;
use super::{CellAttributes, Heap};

/// Hands out cells of one size and kind. Generated code bumps `start` itself and calls `allocate_slow` at `end`.
#[repr(C)]
pub struct Allocator {
    start: Cell<usize>,
    end: Cell<usize>,
    cell_size: u32,
    /// The bytes of the runs that it has taken from the block.
    taken: Cell<u32>,
    current_block: Cell<Option<&'static Block>>,
    pub(super) attributes: CellAttributes,
    pub(super) source: BlockSource,
    directory: OnceCell<Box<Directory>>,
}

// SAFETY: a part of the collector.
unsafe impl super::GcFree for Allocator {}

impl Allocator {
    pub const OFFSET_OF_START: usize = offset_of!(Allocator, start);
    pub const OFFSET_OF_END: usize = offset_of!(Allocator, end);
    pub const OFFSET_OF_CELL_SIZE: usize = offset_of!(Allocator, cell_size);

    pub(super) const fn new(
        cell_size: usize,
        attributes: CellAttributes,
        source: BlockSource,
    ) -> Allocator {
        Allocator {
            start: Cell::new(0),
            end: Cell::new(0),
            cell_size: cell_size as u32,
            taken: Cell::new(0),
            current_block: Cell::new(None),
            attributes,
            source,
            directory: OnceCell::new(),
        }
    }

    #[inline(always)]
    pub fn cell_size(&self) -> usize {
        self.cell_size as usize
    }

    pub(super) fn directory(&self) -> Option<&Directory> {
        self.directory.get().map(|directory| &**directory)
    }

    /// The address of a new cell, or zero if there is no memory. May collect.
    #[inline(always)]
    pub(crate) fn try_allocate(&self, heap: &Heap) -> usize {
        self.try_allocate_sized(heap, self.cell_size())
    }

    /// # Safety
    /// The cell is initialized, as what the allocator is for, before the next allocation.
    pub unsafe fn try_allocate_uninitialized(&self, heap: &Heap) -> usize {
        self.try_allocate(heap)
    }

    /// `cell_size` is that of the allocator, which the caller may know as a constant.
    #[inline(always)]
    pub(crate) fn try_allocate_sized(&self, heap: &Heap, cell_size: usize) -> usize {
        debug_assert!(cell_size == self.cell_size());
        #[cfg(debug_assertions)]
        {
            crate::direct::will_allocate();
            heap.collect_if_stressed();
        }
        let cell = self.start.get();
        if cell < self.end.get() {
            self.start.set(cell + cell_size);
            return cell;
        }
        self.allocate_slow(heap)
    }

    /// The address of a new cell, if that takes no call. The caller initializes it before the next allocation.
    #[inline(always)]
    pub fn try_bump(&self) -> Option<usize> {
        self.try_bump_sized(self.cell_size())
    }

    #[inline(always)]
    pub(crate) fn try_bump_sized(&self, cell_size: usize) -> Option<usize> {
        debug_assert!(cell_size == self.cell_size());
        #[cfg(debug_assertions)]
        crate::direct::will_allocate();
        let cell = self.start.get();
        (cell < self.end.get()).then(|| {
            self.start.set(cell + cell_size);
            cell
        })
    }

    #[inline(never)]
    pub fn allocate_slow(&self, heap: &Heap) -> usize {
        #[cfg(debug_assertions)]
        heap.collect_if_stressed();
        if !self.has_room() && !self.refill(heap) {
            return 0;
        }
        let cell = self.start.get();
        self.start.set(cell + self.cell_size());
        cell
    }

    /// In the block that it has.
    #[inline(always)]
    fn has_room(&self) -> bool {
        if self.start != self.end {
            return true;
        }
        let Some(block) = self.current_block.get() else {
            return false;
        };
        let run = block.directory().free_run_from(block, self.end.get());
        run.map(|run| self.take(run)).is_some()
    }

    #[inline(always)]
    fn take(&self, Range { start, mut end }: Range<usize>) {
        if cfg!(bun_asan) {
            // The others stay poisoned.
            end = start + self.cell_size();
            unpoison(start, end);
        } else if cfg!(debug_assertions) && crate::options().collect_every_n_allocations != 0 {
            // Code that allocates inline comes by more often.
            let cells = 1 + ((start % BLOCK_SIZE * 40503) >> 12) % 3;
            end = end.min(start + cells * self.cell_size());
        }
        self.start.set(start);
        self.end.set(end);
        self.taken.update(|bytes| bytes + (end - start) as u32);
    }

    #[cold]
    #[inline(never)]
    fn refill(&self, heap: &Heap) -> bool {
        let directory = self.directory.get_or_init(|| {
            heap.register_allocator(self);
            Box::new(Directory::new(heap, self))
        });
        if let Some(block) = self.current_block.take() {
            directory.did_fill(block);
            heap.did_allocate(self.taken.take() as usize);
        }
        heap.will_allocate_slowly();
        let mut found = None;
        if self.current_block.get().is_none() {
            found = heap.find_free_cells(directory);
            if found.is_none()
                && heap.collect_for_lack_of_memory()
                && self.current_block.get().is_none()
            {
                found = heap.find_free_cells(directory);
            }
        }
        let Some((block, first_run)) = found else {
            // What ran at the end of a collection may have allocated.
            return self.current_block.get().is_some() && (self.has_room() || self.refill(heap));
        };
        self.current_block.set(Some(block));
        self.take(first_run);
        true
    }

    /// So that the block knows which of its cells are live.
    pub(super) fn stop_allocating(&self, heap: &Heap) {
        if let Some(block) = self.current_block.take() {
            let (start, end) = (self.start.take(), self.end.take());
            heap.did_allocate(self.taken.take() as usize - (end - start));
            block.directory().did_stop_allocating(block, start);
        }
    }

    /// Of the block in which it is at work, or has been stopped, for the caller to reveal.
    pub(super) fn take_hidden_cells_in_use(&self) -> Option<(&'static Block, Bits)> {
        let directory = self.directory()?;
        let Some(block) = self.current_block.get() else {
            let block = directory.stopped_block()?;
            block.set_hidden_from(block.end());
            return Some((block, directory.take_hidden(&block.live_bits())));
        };
        block.set_hidden_from(self.start.get());
        let passed = block.atoms_before(self.start.get());
        Some((block, directory.take_hidden(&passed)))
    }

    /// Whether `cell`, which is in the block being allocated from, has not been handed out.
    pub(super) fn is_free(&self, block: &Block, cell: usize) -> bool {
        cell >= self.start.get() && block.directory().was_free(cell)
    }
}
