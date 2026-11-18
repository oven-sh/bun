use super::block::Block;
use super::precise::{PRECISE_BIT, PreciseAllocation};
use super::{CellAttributes, Heap};

#[derive(Clone, Copy)]
pub(super) enum Container {
    Block(&'static Block),
    Precise(&'static PreciseAllocation),
}

/// `cell` is the start of a cell that has not been freed.
#[inline(always)]
pub(super) fn of(cell: usize) -> Container {
    // SAFETY: private to the heap, which passes only the addresses of cells.
    unsafe {
        if cell & PRECISE_BIT != 0 {
            Container::Precise(PreciseAllocation::of_cell(cell))
        } else {
            Container::Block(Block::containing(cell))
        }
    }
}

impl Container {
    #[inline(always)]
    pub(super) fn heap(self) -> &'static Heap {
        match self {
            Container::Block(block) => block.heap(),
            Container::Precise(allocation) => allocation.heap(),
        }
    }

    #[inline(always)]
    pub(super) fn cell_size(self) -> usize {
        match self {
            Container::Block(block) => block.cell_size(),
            Container::Precise(allocation) => allocation.cell_size(),
        }
    }

    pub(super) fn attributes(self) -> CellAttributes {
        match self {
            Container::Block(block) => block.attributes,
            Container::Precise(allocation) => allocation.attributes,
        }
    }
}
