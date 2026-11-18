//! The mark bits of all heaps: one for each atom of the address space, where there is a cell. In the headers of the
//! blocks they would all compete for the same few lines of the cache. The bits of memory that no heap has are clear.

use core::ops::Range;
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering, fence};

use bun_alloc::page_size;
use bun_threading::Guarded;

use super::block::{ATOM_SIZE, BLOCK_SIZE};
use super::stack::prefetch;
use super::virtual_memory;

const ADDRESS_BITS: u32 = 48;
const REGION_SHIFT: u32 = 30;
const BYTES_PER_WORD_SHIFT: u32 = (ATOM_SIZE * 64).ilog2();
const BYTES_PER_MARK_BYTE: usize = ATOM_SIZE * 8;
const MARKS_SIZE: usize = (1 << REGION_SHIFT) / BYTES_PER_MARK_BYTE;
/// A region has two sets of marks, and then a `PageState` for each page of the first and its twin in the second.
const STATES_SIZE: usize = 1 << 16;
const REGION_COUNT: usize = 1 << (ADDRESS_BITS - REGION_SHIFT);

pub(super) const WORDS_PER_BLOCK: usize = BLOCK_SIZE >> BYTES_PER_WORD_SHIFT;
pub(super) type Bits = [u64; WORDS_PER_BLOCK];

/// For each region, where the marks of address zero would be if those of the region went back that far.
static ORIGINS: [AtomicUsize; REGION_COUNT] = [const { AtomicUsize::new(0) }; REGION_COUNT];

/// One of the two sets. While a full collection that lets scripts run fills one, the other says what is alive.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(super) struct Marks {
    first_word: usize,
}

#[inline(always)]
fn bit(cell: usize) -> u64 {
    1 << (cell / ATOM_SIZE % 64)
}

impl Marks {
    pub(super) fn other(self) -> Marks {
        Marks {
            first_word: self.first_word ^ (MARKS_SIZE / size_of::<u64>()),
        }
    }

    /// `cell` is in a block, or is the start of a precise allocation, that has been retained. So for all that follow.
    #[inline(always)]
    fn word(self, cell: usize) -> &'static AtomicU64 {
        // SAFETY: private to the heap, which passes no other address.
        unsafe {
            let origin = ORIGINS.get_unchecked(cell >> REGION_SHIFT);
            let origin =
                core::ptr::with_exposed_provenance::<AtomicU64>(origin.load(Ordering::Relaxed));
            &*origin.wrapping_add((cell >> BYTES_PER_WORD_SHIFT) + self.first_word)
        }
    }

    #[inline(always)]
    pub(super) fn contains(self, cell: usize) -> bool {
        self.word(cell).load(Ordering::Relaxed) & bit(cell) != 0
    }

    /// If not, whoever marks it sees what this thread has seen.
    #[inline(always)]
    pub(super) fn contains_by_now(self, cell: usize) -> bool {
        self.contains(cell) || self.word(cell).fetch_or(0, Ordering::AcqRel) & bit(cell) != 0
    }

    /// Whether it was not marked.
    #[inline(always)]
    pub(super) fn add(self, cell: usize) -> bool {
        let (word, bit) = (self.word(cell), bit(cell));
        word.load(Ordering::Relaxed) & bit == 0 && word.fetch_or(bit, Ordering::AcqRel) & bit == 0
    }

    /// The same, while no other thread has to do with the marks of the heap. No two heaps share a word.
    #[inline(always)]
    pub(super) fn add_exclusively(self, cell: usize) -> bool {
        let word = self.word(cell);
        let old = word.load(Ordering::Relaxed);
        if old & bit(cell) != 0 {
            return false;
        }
        word.store(old | bit(cell), Ordering::Relaxed);
        true
    }

    /// It has the word to itself.
    pub(super) fn remove_precise(self, cell: usize) {
        self.word(cell).store(0, Ordering::Release);
    }

    #[inline(always)]
    fn words_of_block(self, block: usize) -> &'static [AtomicU64; WORDS_PER_BLOCK] {
        // SAFETY: those of a block follow each other.
        unsafe { &*core::ptr::from_ref(self.word(block)).cast() }
    }

    #[inline(always)]
    pub(super) fn of_block(self, block: usize) -> Bits {
        (self.words_of_block(block).each_ref()).map(|word| word.load(Ordering::Relaxed))
    }

    #[inline(always)]
    pub(super) fn prefetch_block(self, block: usize) {
        let words = self.words_of_block(block);
        prefetch(words[0].as_ptr().addr());
        prefetch(words[WORDS_PER_BLOCK / 2].as_ptr().addr());
    }

    pub(super) fn count_in_block(self, block: usize) -> usize {
        let counts = self.of_block(block).map(u64::count_ones);
        counts.iter().sum::<u32>() as usize
    }

    #[inline(always)]
    pub(super) fn clear_block(self, block: usize) {
        for word in self.words_of_block(block) {
            word.store(0, Ordering::Relaxed);
        }
    }

    /// Markers take free cells for marked from now on, and so leave them alone once they have been allocated.
    pub(super) fn hide(self, block: usize, cells: &Bits) {
        for (word, &cells) in self.words_of_block(block).iter().zip(cells) {
            if cells != 0 {
                word.fetch_or(cells, Ordering::Relaxed);
            }
        }
        fence(Ordering::Release);
    }

    pub(super) fn hide_precise(self, cell: usize) {
        self.add_exclusively(cell);
        fence(Ordering::Release);
    }

    /// Those of the cells for which `contains_by_now` holds.
    pub(super) fn among_by_now(self, block: usize, cells: &Bits) -> Bits {
        let words = self.words_of_block(block);
        core::array::from_fn(|index| match cells[index] {
            0 => 0,
            cells => words[index].fetch_or(0, Ordering::AcqRel) & cells,
        })
    }

    pub(super) fn reveal(self, block: usize, cells: &Bits) {
        for (word, &cells) in self.words_of_block(block).iter().zip(cells) {
            if cells != 0 {
                word.fetch_and(!cells, Ordering::Release);
            }
        }
    }
}

#[repr(C)]
struct PageState {
    users: u16,
    is_backed: bool,
    is_listed: bool,
}

/// For each page that has lost its last user, an address whose mark it has. The lock is that of all `PageState`s.
static IDLE_PAGES: Guarded<Vec<usize>> = Guarded::new(Vec::new());

/// The page that has the mark, and its state.
///
/// # Safety
/// The region has marks, and the lock is held for as long as the state is used.
unsafe fn page_of<'a>(address: usize) -> (usize, &'a mut PageState) {
    let region_start = address >> REGION_SHIFT << REGION_SHIFT;
    let marks = Marks::default().word(region_start).as_ptr().addr();
    let index = (address - region_start) / BYTES_PER_MARK_BYTE / page_size();
    let states = core::ptr::with_exposed_provenance_mut::<PageState>(marks + 2 * MARKS_SIZE);
    // SAFETY: the caller's. They start as zeros.
    (marks + index * page_size(), unsafe {
        &mut *states.add(index)
    })
}

/// Elsewhere memory that has not been touched costs nothing.
const COMMITS_BY_PAGE: bool = cfg!(windows);

#[cold]
fn try_add_region(region: usize) -> bool {
    let size = 2 * MARKS_SIZE + STATES_SIZE;
    let Some(marks) = virtual_memory::reserve(size) else {
        return false;
    };
    let skipped = if COMMITS_BY_PAGE { 2 * MARKS_SIZE } else { 0 };
    // SAFETY: what has just been reserved.
    unsafe {
        if !virtual_memory::commit(marks + skipped, size - skipped) {
            virtual_memory::release(marks, size);
            return false;
        }
    }
    let origin = marks.wrapping_sub(region * MARKS_SIZE);
    assert!(origin != 0);
    ORIGINS[region].store(origin, Ordering::Relaxed);
    true
}

/// Before a block or a precise allocation is used. False if there is no memory.
pub(super) fn try_retain(address: usize) -> bool {
    let _lock = IDLE_PAGES.lock();
    let region = address >> REGION_SHIFT;
    if ORIGINS[region].load(Ordering::Relaxed) == 0 && !try_add_region(region) {
        return false;
    }
    // SAFETY: under the lock, and a page that is not backed has been discarded or has never been used.
    unsafe {
        let (page, state) = page_of(address);
        if !state.is_backed {
            for page in [page, page + MARKS_SIZE] {
                if !COMMITS_BY_PAGE {
                    virtual_memory::reuse(page, page_size());
                } else if !virtual_memory::commit(page, page_size()) {
                    return false;
                }
            }
            state.is_backed = true;
        }
        state.users += 1;
    }
    true
}

/// The marks are clear in both sets.
pub(super) fn release(address: usize) {
    let mut idle_pages = IDLE_PAGES.lock();
    // SAFETY: retained, and under the lock.
    let (_, state) = unsafe { page_of(address) };
    state.users -= 1;
    if state.users == 0 && !core::mem::replace(&mut state.is_listed, true) {
        idle_pages.push(address);
    }
}

pub(super) fn discard_idle_pages() {
    let mut idle_pages = IDLE_PAGES.lock();
    idle_pages.sort_unstable();
    let mut run = 0..0;
    // SAFETY: nothing reads them until they are retained again, and they have only zeros to lose.
    let discard = |run: &Range<usize>| unsafe {
        virtual_memory::discard(run.start, run.len());
        virtual_memory::discard(run.start + MARKS_SIZE, run.len());
    };
    for address in core::mem::take(&mut *idle_pages) {
        // SAFETY: has been retained, and under the lock.
        let (page, state) = unsafe { page_of(address) };
        state.is_listed = false;
        if state.users != 0 {
            continue;
        }
        state.is_backed = false;
        if page != run.end {
            if !run.is_empty() {
                discard(&run);
            }
            run.start = page;
        }
        run.end = page + page_size();
    }
    if !run.is_empty() {
        discard(&run);
    }
}
