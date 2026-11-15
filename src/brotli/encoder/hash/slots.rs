//! Tables of positions, which are zero at first.

use core::hint::select_unpredictable;

use crate::memory::{self, Result};

pub(in crate::encoder) trait Slots {
    const SIZE: usize;

    fn get(&self, index: usize) -> u32;

    fn set(&mut self, index: usize, position: usize);

    /// See [`Hasher::clear`](super::Hasher::clear).
    fn clear(&mut self) {}
}

pub(in crate::encoder) struct Dense<const SIZE: usize>(Box<[u32; SIZE]>);

impl<const SIZE: usize> Dense<SIZE> {
    pub(in crate::encoder) fn new() -> Result<Self> {
        memory::zeroed_array().map(Self)
    }
}

impl<const SIZE: usize> Slots for Dense<SIZE> {
    const SIZE: usize = SIZE;

    #[inline(always)]
    fn get(&self, index: usize) -> u32 {
        self.0[index % SIZE]
    }

    #[inline(always)]
    fn set(&mut self, index: usize, position: usize) {
        self.0[index % SIZE] = position as u32;
    }

    fn clear(&mut self) {
        self.0.fill(0);
    }
}

const PAGE_SIZE: usize = 8;

/// For a small input, which takes less time to compress than a dense table takes to clear.
pub(in crate::encoder) struct Paged<const PAGES: usize> {
    /// A page that stands for those that are not in use, the numbers of the pages, and then the pages.
    entries: Vec<u16>,
    next_page: u16,
}

impl<const PAGES: usize> Paged<PAGES> {
    pub(in crate::encoder) fn new(input_size: usize) -> Result<Self> {
        let first_page = 1 + PAGES / PAGE_SIZE;
        let pages = first_page + PAGES.min(input_size);
        Ok(Self {
            entries: memory::zeroed(pages * PAGE_SIZE)?,
            next_page: first_page as u16,
        })
    }

    #[inline(always)]
    fn page_number_at(index: usize) -> usize {
        PAGE_SIZE + index / PAGE_SIZE % PAGES
    }
}

impl<const PAGES: usize> Slots for Paged<PAGES> {
    const SIZE: usize = PAGES * PAGE_SIZE;

    #[inline(always)]
    fn get(&self, index: usize) -> u32 {
        let page = self.entries[Self::page_number_at(index)];
        u32::from(self.entries[usize::from(page) * PAGE_SIZE + index % PAGE_SIZE])
    }

    #[inline(always)]
    fn set(&mut self, index: usize, position: usize) {
        let page = &mut self.entries[Self::page_number_at(index)];
        let is_new = *page == 0;
        *page = select_unpredictable(is_new, self.next_page, *page);
        self.next_page += u16::from(is_new);
        let at = usize::from(*page) * PAGE_SIZE + index % PAGE_SIZE;
        self.entries[at] = position as u16;
    }
}
