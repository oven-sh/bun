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

/// Even less to clear. As long as a slot is set after each look, it passes no link twice. Indices can have 17 bits.
pub(in crate::encoder) struct Linked {
    /// The last position in any of the slots that have the same low bits.
    heads: Vec<u16>,
    /// For each position, the head that it replaced, and above that its slot, whose lowest bit goes without saying.
    links: Vec<u32>,
}

impl Linked {
    pub(in crate::encoder) fn new(input_size: usize) -> Result<Self> {
        /// The size of the output chunks of `node:zlib`. Only the garbage collector frees those, so the allocator has no warm block next to them.
        const AVOIDED: usize = (16 << 10) / size_of::<u16>();
        let heads = match (8 * input_size).next_power_of_two() {
            AVOIDED => AVOIDED / 2,
            heads => heads,
        };
        Ok(Self {
            heads: memory::zeroed(heads)?,
            links: memory::zeroed(input_size)?,
        })
    }
}

impl Slots for Linked {
    const SIZE: usize = 1 << u16::BITS;

    #[inline(always)]
    fn get(&self, index: usize) -> u32 {
        let mut position = self.heads[index & (self.heads.len() - 1)];
        while position != 0 {
            let link = self.links[usize::from(position)];
            if link >> u16::BITS == index as u32 >> 1 {
                break;
            }
            position = (link as u16).min(position - 1);
        }
        u32::from(position)
    }

    #[inline(always)]
    fn set(&mut self, index: usize, position: usize) {
        let at = index & (self.heads.len() - 1);
        let head = core::mem::replace(&mut self.heads[at], position as u16);
        debug_assert!(usize::from(head) < position.max(1));
        debug_assert!(index >> 1 < Self::SIZE && self.heads.len() > 1);
        self.links[position] = (index as u32 >> 1 << u16::BITS) | u32::from(head);
    }
}
