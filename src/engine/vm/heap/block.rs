use core::cell::Cell;
use core::ops::Range;

use bun_alloc::page_size;
use bun_engine_platform::asan;

use super::directory::Directory;
use super::marks::{Bits, Marks, WORDS_PER_BLOCK};
use super::stack::prefetch;
use super::{CellAttributes, Destruction, Heap, JsCell, virtual_memory};
use crate::{JsString, options};

pub const BLOCK_SIZE: usize = 16 * 1024;
pub const ATOM_SIZE: usize = 16;
const ATOMS_PER_BLOCK: usize = BLOCK_SIZE / ATOM_SIZE;
/// The same on every target, and so are the size classes.
const HEADER_ATOMS: usize = 4;
const _: () = assert!(size_of::<Block>() <= HEADER_ATOMS * ATOM_SIZE);
pub const PAYLOAD_SIZE: usize = BLOCK_SIZE - HEADER_ATOMS * ATOM_SIZE;
const RECIPROCAL_SHIFT: u32 = 20;

/// What is stamped with another version than the heap's is stale, so nothing has to visit every block to clear it.
pub(super) type Version = u32;
const NULL_VERSION: Version = 0;
pub(super) const FIRST_VERSION: Version = 1;

pub(super) fn next_version(version: Version) -> Version {
    version.checked_add(1).unwrap_or(FIRST_VERSION)
}

#[inline(always)]
fn for_each_set_bit(bits: &Bits, mut visit: impl FnMut(usize)) {
    for (index, &word) in bits.iter().enumerate() {
        let mut rest = word;
        while rest != 0 {
            visit(index * 64 + rest.trailing_zeros() as usize);
            rest &= rest - 1;
        }
    }
}

/// From that one on. The number of atoms if there is none.
#[inline(always)]
fn first_set_bit(from: usize, word_at: impl Fn(usize) -> u64) -> usize {
    let mut mask = u64::MAX << (from % 64);
    for index in from / 64..WORDS_PER_BLOCK {
        let word = word_at(index) & mask;
        if word != 0 {
            return index * 64 + word.trailing_zeros() as usize;
        }
        mask = u64::MAX;
    }
    ATOMS_PER_BLOCK
}

/// The header of an aligned run of memory that is cut into cells of one size.
#[repr(C)]
pub struct Block {
    heap: *const Heap,
    directory: *const Directory,
    pub(super) attributes: CellAttributes,
    atoms_per_cell: u32,
    first_atom: u32,
    reciprocal: u32,
    pub(super) index: Cell<u32>,
    /// The cells from this offset on have never been allocated, and their memory has not been touched.
    virgin_offset: Cell<u32>,
    /// Current: every cell has been allocated or has survived since the last collection.
    allocated_version: Cell<Version>,
    /// The white cells from this offset on are hidden from markers.
    hidden_offset: Cell<u16>,
    is_being_filled: Cell<bool>,
    /// For `Destruction::OnRequest`.
    is_destruction_requested: Cell<bool>,
    /// A bit for each page that has been given back to the system. No live cell is in it.
    discarded_pages: Cell<u8>,
}

impl Block {
    pub const OFFSET_OF_HEAP: usize = core::mem::offset_of!(Block, heap);

    /// # Safety
    /// `memory` is an unused block. `directory` and its heap outlive it.
    pub(super) unsafe fn initialize(memory: usize, directory: &Directory) -> &'static Block {
        let atoms_per_cell = directory.cell_size() / ATOM_SIZE;
        let cells = PAYLOAD_SIZE / directory.cell_size();
        let first_atom = ATOMS_PER_BLOCK - cells * atoms_per_cell;
        let block = core::ptr::with_exposed_provenance_mut::<Block>(memory);
        // SAFETY: the caller's.
        unsafe {
            block.write(Block {
                heap: directory.heap(),
                directory,
                attributes: directory.attributes(),
                atoms_per_cell: atoms_per_cell as u32,
                first_atom: first_atom as u32,
                reciprocal: (1u32 << RECIPROCAL_SHIFT).div_ceil(atoms_per_cell as u32),
                index: Cell::new(0),
                virgin_offset: Cell::new((first_atom * ATOM_SIZE) as u32),
                allocated_version: Cell::new(NULL_VERSION),
                hidden_offset: Cell::new(BLOCK_SIZE as u16),
                is_being_filled: Cell::new(false),
                is_destruction_requested: Cell::new(false),
                discarded_pages: Cell::new(0),
            });
            &*block
        }
    }

    /// # Safety
    /// `address` is inside a block.
    #[inline(always)]
    pub(super) unsafe fn containing(address: usize) -> &'static Block {
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(address & !(BLOCK_SIZE - 1)) }
    }

    #[inline(always)]
    pub(super) fn address(&self) -> usize {
        core::ptr::from_ref(self).addr()
    }

    #[inline(always)]
    pub(super) fn heap(&self) -> &Heap {
        // SAFETY: outlives the block.
        unsafe { &*self.heap }
    }

    #[inline(always)]
    pub(super) fn directory(&self) -> &Directory {
        // SAFETY: outlives the block.
        unsafe { &*self.directory }
    }

    #[inline(always)]
    pub(super) fn cell_size(&self) -> usize {
        self.atoms_per_cell as usize * ATOM_SIZE
    }

    #[inline(always)]
    pub(super) fn atom_of(address: usize) -> usize {
        address % BLOCK_SIZE / ATOM_SIZE
    }

    fn first_cell(&self) -> usize {
        self.address() + self.first_atom as usize * ATOM_SIZE
    }

    pub(super) fn end(&self) -> usize {
        self.address() + BLOCK_SIZE
    }

    /// The start of the cell that an address of this block is in.
    #[inline(always)]
    pub(super) fn cell_containing(&self, address: usize) -> Option<usize> {
        let atom = (Self::atom_of(address) as u32).checked_sub(self.first_atom)?;
        let index = (atom * self.reciprocal) >> RECIPROCAL_SHIFT;
        let first_atom = self.first_atom + index * self.atoms_per_cell;
        Some(self.address() + first_atom as usize * ATOM_SIZE)
    }

    /// Whether the cell survived the last collection or was allocated since. The block is not being allocated from.
    pub(super) fn is_live(&self, cell: usize) -> bool {
        debug_assert!(!self.is_being_filled.get());
        if self.is_allocated() {
            return true;
        }
        match self.directory().has_stopped_in(self) {
            true => !self.directory().was_free(cell),
            false => self.heap().last_marks().contains(cell),
        }
    }

    pub(super) fn is_allocated(&self) -> bool {
        self.allocated_version.get() == self.heap().allocation_version.get()
    }

    pub(super) fn is_being_filled(&self) -> bool {
        self.is_being_filled.get()
    }

    /// The block does not consist of live cells only.
    pub(super) fn live_bits(&self) -> Bits {
        debug_assert!(!self.is_allocated());
        match self.directory().has_stopped_in(self) {
            true => self.directory().cells_in_use(self),
            false => self.heap().last_marks().of_block(self.address()),
        }
    }

    /// As for `is_live`.
    pub(super) fn for_each_live_cell(&self, mut visit: impl FnMut(usize)) {
        debug_assert!(!self.is_being_filled.get());
        if self.is_allocated() {
            let cells = (self.first_cell()..self.end()).step_by(self.cell_size());
            return cells.for_each(visit);
        }
        for_each_set_bit(&self.live_bits(), |atom| {
            visit(self.address() + atom * ATOM_SIZE);
        });
    }

    /// Those that are marked when it starts.
    pub(super) fn for_each_marked_cell(&self, marks: Marks, mut visit: impl FnMut(usize)) {
        for_each_set_bit(&marks.of_block(self.address()), |atom| {
            visit(self.address() + atom * ATOM_SIZE);
        });
    }

    pub(super) fn for_each_cell_among(&self, cells: &Bits, mut visit: impl FnMut(usize)) {
        for_each_set_bit(cells, |atom| visit(self.address() + atom * ATOM_SIZE));
    }

    #[inline(always)]
    pub(super) fn is_hidden_if_white(&self, cell: usize) -> bool {
        cell % BLOCK_SIZE >= usize::from(self.hidden_offset.get())
    }

    /// The address is in the block or at its end.
    pub(super) fn set_hidden_from(&self, address: usize) {
        self.hidden_offset.set((address - self.address()) as u16);
    }

    #[inline]
    pub(super) fn prefetch_for_allocation(&self, last_marks: Marks) {
        prefetch(self.address());
        last_marks.prefetch_block(self.address());
    }

    /// The first run of cells from `address` on that have a bit in `free`. The address is in the block or at its end.
    #[inline(always)]
    pub(super) fn run_from(
        &self,
        address: usize,
        free: &[Cell<u64>; WORDS_PER_BLOCK],
        all: &Bits,
    ) -> Option<Range<usize>> {
        let from = (address - self.address()) / ATOM_SIZE;
        let first = first_set_bit(from, |index| free[index].get());
        let end = first_set_bit(first, |index| all[index] & !free[index].get());
        let address_of = |atom| self.address() + atom * ATOM_SIZE;
        (first != end).then(|| address_of(first)..address_of(end))
    }

    /// A bit for each cell.
    pub(super) fn all_cells(&self) -> Bits {
        let mut cells = Bits::default();
        for atom in
            (self.first_atom as usize..ATOMS_PER_BLOCK).step_by(self.atoms_per_cell as usize)
        {
            cells[atom / 64] |= 1 << (atom % 64);
        }
        cells
    }

    /// A bit for each atom before the address, which is in the block or at its end.
    pub(super) fn atoms_before(&self, address: usize) -> Bits {
        let count = (address - self.address()) / ATOM_SIZE;
        core::array::from_fn(|index| match count.saturating_sub(index * 64) {
            64.. => u64::MAX,
            rest => (1 << rest) - 1,
        })
    }

    /// In the order of their addresses.
    #[inline(always)]
    fn for_each_dead_run(&self, live: &Bits, mut visit: impl FnMut(usize, usize)) {
        let (mut start, cell_size) = (self.first_cell(), self.cell_size());
        for_each_set_bit(live, |atom| {
            let cell = self.address() + atom * ATOM_SIZE;
            if cell != start {
                visit(start, cell);
            }
            start = cell + cell_size;
        });
        if start != self.end() {
            visit(start, self.end());
        }
    }

    /// Whether this is the first request since the block was last empty.
    #[inline(always)]
    pub(super) fn request_destruction(&self) -> bool {
        !self.is_destruction_requested.replace(true)
    }

    pub(super) fn is_destruction_requested(&self) -> bool {
        self.is_destruction_requested.get()
    }

    /// # Safety
    /// On the thread of the heap, which is in the sweeping state.
    pub(super) unsafe fn destroy_dead_cells(&self) {
        debug_assert!(!self.is_being_filled.get());
        let live = self.live_bits();
        // SAFETY: the caller's. Each is how the cells of such a block are destroyed.
        unsafe {
            match (self.attributes.destruction, self.attributes.destroy) {
                (_, None) => {}
                (Destruction::ByFunction, Some(destroy)) => {
                    self.destroy_with(&live, |cell| destroy(cell), |_| {});
                }
                (Destruction::OfStrings | Destruction::OnRequest, _) => self.destroy_with(
                    &live,
                    |cell| cell.cast::<JsString>().drop_in_place(),
                    |cell| {
                        prefetch(
                            cell.byte_add(JsString::OFFSET_OF_FIBER)
                                .cast::<usize>()
                                .read(),
                        )
                    },
                ),
            }
        }
        if live == Bits::default() {
            self.virgin_offset.set(self.first_atom * ATOM_SIZE as u32);
            self.is_destruction_requested.set(false);
        }
    }

    /// `prepare` gets a cell, which may be alive or destroyed, some time before its turn comes.
    ///
    /// # Safety
    /// As for `destroy_dead_cells`.
    #[inline(always)]
    unsafe fn destroy_with(
        &self,
        live: &Bits,
        destroy: impl Fn(*mut JsCell),
        prepare: impl Fn(*const JsCell),
    ) {
        const LOOKAHEAD: usize = 8;
        let touched_end = self.address() + self.virgin_offset.get() as usize;
        let (cell_size, discarded) = (self.cell_size(), self.discarded_pages.get());
        unpoison(self.first_cell(), self.end());
        self.for_each_dead_run(live, |from, to| {
            for cell in (from..to.min(touched_end)).step_by(cell_size) {
                if discarded != 0 && discarded >> (cell % BLOCK_SIZE / page_size()) & 1 != 0 {
                    continue;
                }
                let ahead = cell + LOOKAHEAD * cell_size;
                if ahead < touched_end && discarded == 0 {
                    prepare(core::ptr::with_exposed_provenance(ahead));
                }
                let header = core::ptr::with_exposed_provenance_mut::<u32>(cell);
                // SAFETY: a dead cell whose header is not zapped has not been destroyed.
                unsafe {
                    if *header != 0 {
                        destroy(header.cast());
                        *header = 0;
                    }
                }
            }
        });
    }

    /// # Safety
    /// On the thread of the heap, and the dead cells that need it have been destroyed.
    #[inline]
    pub(super) unsafe fn will_be_filled(&self) {
        self.reuse_discarded_pages();
        if options().scribble_free_cells || cfg!(bun_asan) {
            // SAFETY: the caller's.
            unsafe { self.scribble_on_dead_cells() };
        }
        self.is_being_filled.set(true);
    }

    /// # Safety
    /// As above.
    #[cold]
    pub(super) unsafe fn scribble_on_dead_cells(&self) {
        self.reuse_discarded_pages();
        self.for_each_dead_run(&self.live_bits(), |from, to| {
            // SAFETY: the caller's.
            unsafe { scribble(from, to, self.cell_size()) };
            poison(from, to);
        });
    }

    /// Gives the pages that have no live cell back to the system.
    ///
    /// # Safety
    /// As for `will_be_filled`.
    pub(super) unsafe fn discard_unused_pages(&self) {
        let page = page_size();
        self.for_each_dead_run(&self.live_bits(), |from, to| {
            let (first, end) = (from.next_multiple_of(page), to / page * page);
            if first >= end {
                return;
            }
            let (count, shift) = ((end - first) / page, first % BLOCK_SIZE / page);
            let pages = ((1 << count) - 1) << shift;
            if self.discarded_pages.get() & pages != pages {
                // SAFETY: whole pages of dead cells.
                unsafe { virtual_memory::discard(first, end - first) };
                self.discarded_pages.update(|discarded| discarded | pages);
            }
        });
    }

    #[inline]
    pub(super) fn reuse_discarded_pages(&self) {
        let discarded = self.discarded_pages.take();
        if discarded == 0 {
            return;
        }
        let page = page_size();
        for index in (0..BLOCK_SIZE / page).filter(|index| discarded >> index & 1 != 0) {
            // SAFETY: discarded above.
            unsafe { virtual_memory::reuse(self.address() + index * page, page) };
        }
    }

    pub(super) fn did_fill(&self) {
        self.is_being_filled.set(false);
        self.virgin_offset.set(BLOCK_SIZE as u32);
        (self.allocated_version).set(self.heap().allocation_version.get());
    }

    /// `position` is where the next cell would have been allocated.
    pub(super) fn did_stop_allocating(&self, position: usize) {
        self.is_being_filled.set(false);
        let offset = (position - self.address()) as u32;
        self.virgin_offset.update(|it| it.max(offset));
    }

    /// Before the versions start over.
    pub(super) fn forget_version(&self) {
        self.allocated_version.set(NULL_VERSION);
    }
}

/// Has the address sanitizer report whoever gets at free cells.
#[inline(always)]
fn poison(from: usize, to: usize) {
    asan::poison(core::ptr::without_provenance(from), to - from);
}

#[inline(always)]
pub(super) fn unpoison(from: usize, to: usize) {
    asan::unpoison(core::ptr::without_provenance(from), to - from);
}

/// The headers stay zapped.
///
/// # Safety
/// The range consists of free cells of that size.
#[cold]
unsafe fn scribble(from: usize, to: usize, cell_size: usize) {
    const POISON: u64 = 0xbadb_eef0;
    unpoison(from, to);
    for cell in (from..to).step_by(cell_size) {
        let words = core::ptr::with_exposed_provenance_mut::<u64>(cell);
        // SAFETY: the caller's.
        unsafe {
            words.write(0);
            (1..cell_size / 8).for_each(|index| words.add(index).write(POISON));
        }
    }
}
