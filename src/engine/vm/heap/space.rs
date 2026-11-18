use bun_alloc::default_alloc;

use super::allocator::Allocator;
use super::block::{ATOM_SIZE, PAYLOAD_SIZE};
use super::block_memory::BlockSource;
use super::{CellAttributes, Heap, virtual_memory};

/// The largest cell that goes in a block.
pub const LARGE_CUTOFF: usize = PAYLOAD_SIZE / 2 / ATOM_SIZE * ATOM_SIZE;
pub const EXACT_CUTOFF: usize = 128;
const STEP_COUNT: usize = LARGE_CUTOFF / ATOM_SIZE + 1;
const MAX_CLASSES: usize = 40;

/// Every multiple of an atom up to `EXACT_CUTOFF`, then steps of a quarter, each widened to fill the block.
const fn size_classes() -> ([usize; MAX_CLASSES], usize) {
    let mut classes = [0; MAX_CLASSES];
    let (mut count, mut size) = (0, ATOM_SIZE);
    while size <= LARGE_CUTOFF {
        if size > EXACT_CUTOFF {
            let cells = PAYLOAD_SIZE / size;
            size = PAYLOAD_SIZE / cells / ATOM_SIZE * ATOM_SIZE;
        }
        classes[count] = size;
        count += 1;
        size = if size < EXACT_CUTOFF {
            size + ATOM_SIZE
        } else if size < LARGE_CUTOFF && size * 5 / 4 > LARGE_CUTOFF {
            LARGE_CUTOFF
        } else {
            (size * 5 / 4).next_multiple_of(ATOM_SIZE)
        };
    }
    (classes, count)
}

pub const SIZE_CLASS_COUNT: usize = size_classes().1;
const SIZE_CLASSES: [usize; MAX_CLASSES] = size_classes().0;

/// For checking another computation of the classes.
pub const SIZE_CLASS_CHECKSUM: usize = {
    let (mut sum, mut class) = (0, 0);
    while class < SIZE_CLASS_COUNT {
        sum += (class + 1) * SIZE_CLASSES[class];
        class += 1;
    }
    sum
};

/// The class of a size, indexed by the number of atoms that it takes.
pub static SIZE_CLASS_OF_STEP: [u8; STEP_COUNT] = CLASS_OF_STEP;
const CLASS_OF_STEP: [u8; STEP_COUNT] = {
    let mut table = [0; STEP_COUNT];
    let (mut step, mut class) = (0, 0);
    while step < STEP_COUNT {
        if step * ATOM_SIZE > SIZE_CLASSES[class] {
            class += 1;
        }
        table[step] = class as u8;
        step += 1;
    }
    table
};

const _: () = assert!(SIZE_CLASSES[SIZE_CLASS_COUNT - 1] == LARGE_CUTOFF);

/// `size` is at most `LARGE_CUTOFF`.
#[inline(always)]
pub const fn size_class(size: usize) -> usize {
    CLASS_OF_STEP[size.div_ceil(ATOM_SIZE)] as usize
}

/// What an allocation of `size` bytes really gets.
#[inline(always)]
pub const fn optimal_size(size: usize) -> usize {
    if size <= LARGE_CUTOFF {
        SIZE_CLASSES[size_class(size)]
    } else {
        size.next_multiple_of(ATOM_SIZE)
    }
}

/// Cells of one kind and any size.
#[repr(C)]
pub struct Space {
    allocators: [Allocator; SIZE_CLASS_COUNT],
}

impl Space {
    pub(super) fn new(attributes: CellAttributes) -> Space {
        Space {
            allocators: core::array::from_fn(|class| {
                Allocator::new(SIZE_CLASSES[class], attributes, BlockSource::General)
            }),
        }
    }

    pub(super) fn allocators(&self) -> &[Allocator] {
        &self.allocators
    }

    #[inline(always)]
    pub fn allocator_for(&self, size: usize) -> Option<&Allocator> {
        (size <= LARGE_CUTOFF).then(|| &self.allocators[size_class(size)])
    }

    pub const fn offset_of_allocator_for(size: usize) -> usize {
        size_class(size) * size_of::<Allocator>()
    }

    /// # Safety
    /// As for `Allocator::try_allocate_uninitialized`.
    pub unsafe fn try_allocate_uninitialized(&self, heap: &Heap, size: usize) -> usize {
        self.try_allocate(heap, size)
    }

    /// With `size` bytes that are zero.
    ///
    /// # Safety
    /// As above.
    pub unsafe fn try_allocate_zeroed(&self, heap: &Heap, size: usize) -> usize {
        if size > LARGE_CUTOFF {
            return self.try_allocate_large_zeroed(heap, size);
        }
        let address = self.try_allocate(heap, size);
        if address != 0 {
            // SAFETY: a new cell of that size.
            unsafe { core::ptr::with_exposed_provenance_mut::<u8>(address).write_bytes(0, size) };
        }
        address
    }

    /// The address of a new cell, or zero if there is no memory. May collect.
    #[inline(always)]
    pub(crate) fn try_allocate(&self, heap: &Heap, size: usize) -> usize {
        if size <= LARGE_CUTOFF {
            let class = size_class(size);
            self.allocators[class].try_allocate_sized(heap, SIZE_CLASSES[class])
        } else {
            heap.allocate_precisely(size, self.allocators[0].attributes, default_alloc::malloc)
        }
    }

    /// As `Allocator::try_bump`, for a cell of so many atoms. Panics if that is more than `EXACT_CUTOFF`.
    #[inline(always)]
    pub(crate) fn try_bump_atoms(&self, atoms: usize) -> Option<usize> {
        self.allocators[..EXACT_CUTOFF / ATOM_SIZE][atoms - 1].try_bump_sized(atoms * ATOM_SIZE)
    }

    /// As `try_allocate`, of more than `LARGE_CUTOFF` bytes that are zero. Pages that come from the system are not touched.
    pub(crate) fn try_allocate_large_zeroed(&self, heap: &Heap, size: usize) -> usize {
        assert!(size > LARGE_CUTOFF);
        heap.allocate_precisely(
            size,
            self.allocators[0].attributes,
            virtual_memory::allocate_zeroed,
        )
    }
}

/// Cells of one type, which can be enumerated.
#[repr(C)]
pub struct IsoSpace {
    pub allocator: Allocator,
}

impl IsoSpace {
    pub(super) fn new(size: usize, attributes: CellAttributes, source: BlockSource) -> IsoSpace {
        assert!(size <= PAYLOAD_SIZE);
        IsoSpace {
            allocator: Allocator::new(size.next_multiple_of(ATOM_SIZE), attributes, source),
        }
    }
}
