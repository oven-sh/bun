//! Where blocks come from. Those of shapes are in one range, so that 32 bits tell where a shape is.

use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use bun_engine_platform::asan;
use bun_threading::Guarded;

use super::block::{ATOM_SIZE, BLOCK_SIZE};
use super::{marks, virtual_memory};
use crate::{ShapeId, options};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum BlockSource {
    General,
    Shapes,
}

#[unsafe(export_name = "engine_shape_base")]
static SHAPE_BASE: AtomicUsize = AtomicUsize::new(0);
static FIRST_SHAPE_ID: AtomicU32 = AtomicU32::new(0);
static USED_SHAPE_IDS: AtomicUsize = AtomicUsize::new(0);

const ID_COUNT: usize = 1 << 32;
/// What looks like an id on the stack keeps a shape alive. So ids start far from small numbers, flags and text, and
/// their last bits are not those of an aligned address.
const FIRST_OFFSET: usize = 0x9000_0000;
const LAST_BITS_OF_ID: usize = ShapeId::LAST_BITS as usize;
const _: () = assert!(ShapeId::LAST_BITS & ShapeId::NUKED_BIT == 0);
const _: () = assert!((ShapeId::LAST_BITS_MASK as usize) < ATOM_SIZE);
const COMMIT_SIZE: usize = 1 << 20;

/// In bytes from the first block.
struct ShapeRange {
    size: usize,
    committed: usize,
    next: usize,
    free: Vec<usize>,
}

static SHAPE_RANGE: Guarded<ShapeRange> = Guarded::new(ShapeRange {
    size: 0,
    committed: 0,
    next: 0,
    free: Vec::new(),
});

/// The address that the id of a shape is an offset from.
#[inline(always)]
pub fn shape_base() -> usize {
    // SAFETY: written once, before the thread that reads it has a heap.
    unsafe { *SHAPE_BASE.as_ptr() }
}

/// What may be the id of a shape, nuked or not.
#[derive(Clone, Copy)]
pub(super) struct ShapeIds {
    first: u32,
    used: usize,
}

impl ShapeIds {
    pub(super) fn so_far() -> ShapeIds {
        ShapeIds {
            first: FIRST_SHAPE_ID.load(Ordering::Relaxed),
            used: USED_SHAPE_IDS.load(Ordering::Relaxed),
        }
    }

    #[inline(always)]
    pub(super) fn contains(self, bits: u32) -> bool {
        let offset = bits.wrapping_sub(self.first) as usize;
        offset < self.used && offset % ATOM_SIZE <= ShapeId::NUKED_BIT as usize
    }
}

pub(super) fn initialize() {
    const SMALLEST: usize = 1 << 24;
    const ROOM_ABOVE_FIRST: usize = ID_COUNT - FIRST_OFFSET;
    let mut range = SHAPE_RANGE.lock();
    if range.size != 0 {
        return;
    }
    let mut size = match options().shape_range_kilobytes.saturating_mul(1024) {
        bytes @ 1..=ROOM_ABOVE_FIRST => bytes.next_multiple_of(COMMIT_SIZE),
        _ => ID_COUNT,
    };
    let start = loop {
        match virtual_memory::reserve(size + BLOCK_SIZE) {
            Some(address) => break address.next_multiple_of(BLOCK_SIZE),
            None if size > SMALLEST => size = (size / 4).next_multiple_of(COMMIT_SIZE),
            None => bun_alloc::out_of_memory(),
        }
    };
    // Where there is room for all ids, the low ones come last.
    let (offset_zero, first_offset) = if size == ID_COUNT {
        (start, FIRST_OFFSET)
    } else {
        let first_offset = FIRST_OFFSET.min(start - BLOCK_SIZE);
        (start - first_offset, first_offset)
    };
    SHAPE_BASE.store(offset_zero - LAST_BITS_OF_ID, Ordering::Relaxed);
    FIRST_SHAPE_ID.store((first_offset + LAST_BITS_OF_ID) as u32, Ordering::Relaxed);
    range.size = size;
}

impl BlockSource {
    pub(super) fn allocate(self) -> Option<usize> {
        let block = match self {
            BlockSource::General => warm::take().or_else(general::allocate),
            BlockSource::Shapes => allocate_for_shapes(),
        }?;
        if marks::try_retain(block) {
            return Some(block);
        }
        // SAFETY: not handed out.
        unsafe { self.free_memory(block) };
        None
    }

    /// # Safety
    /// The block came from `allocate` of the same source, and nothing uses it any more.
    pub(super) unsafe fn free(self, block: usize) {
        marks::release(block);
        // SAFETY: the caller's.
        unsafe { self.free_memory(block) }
    }

    unsafe fn free_memory(self, block: usize) {
        match self {
            // SAFETY: the caller's.
            BlockSource::General => unsafe { general::free(block) },
            BlockSource::Shapes => {
                if BLOCK_SIZE.is_multiple_of(bun_alloc::page_size()) {
                    // SAFETY: whole pages, and the caller's.
                    unsafe { virtual_memory::discard(block, BLOCK_SIZE) };
                }
                SHAPE_RANGE.lock().free.push(block);
            }
        }
    }
}

fn allocate_for_shapes() -> Option<usize> {
    let mut range = SHAPE_RANGE.lock();
    if let Some(block) = range.free.pop() {
        // SAFETY: discarded by `free`.
        unsafe { virtual_memory::reuse(block, BLOCK_SIZE) };
        return Some(block);
    }
    let id = (FIRST_SHAPE_ID.load(Ordering::Relaxed) as usize + range.next) % ID_COUNT;
    let block = shape_base() + id;
    if range.next == range.committed {
        // SAFETY: inside the reservation, past what is in use.
        if range.next == range.size || !unsafe { virtual_memory::commit(block, COMMIT_SIZE) } {
            return None;
        }
        asan::register_root_region(core::ptr::without_provenance(block), COMMIT_SIZE);
        range.committed += COMMIT_SIZE;
    }
    range.next += BLOCK_SIZE;
    USED_SHAPE_IDS.store(range.next, Ordering::Relaxed);
    Some(block)
}

/// The allocator of the sanitizer pads a block to several times its size, and keeps what is freed resident.
#[cfg(bun_asan)]
mod general {
    use std::collections::VecDeque;

    use bun_threading::Guarded;

    use super::{BLOCK_SIZE, asan, virtual_memory};

    const CHUNK_SIZE: usize = 8 << 20;
    /// So many freed blocks wait, poisoned, before one is used again.
    const QUARANTINE: usize = 4096;

    struct Blocks {
        unused: core::ops::Range<usize>,
        freed: VecDeque<usize>,
    }

    static BLOCKS: Guarded<Blocks> = Guarded::new(Blocks {
        unused: 0..0,
        freed: VecDeque::new(),
    });

    pub(super) fn allocate() -> Option<usize> {
        let mut blocks = BLOCKS.lock();
        if blocks.freed.len() > QUARANTINE
            && let Some(block) = blocks.freed.pop_front()
        {
            asan::unpoison(core::ptr::without_provenance(block), BLOCK_SIZE);
            // SAFETY: discarded by `free`.
            unsafe { virtual_memory::reuse(block, BLOCK_SIZE) };
            return Some(block);
        }
        if blocks.unused.is_empty() {
            let chunk =
                virtual_memory::reserve(CHUNK_SIZE + BLOCK_SIZE)?.next_multiple_of(BLOCK_SIZE);
            // SAFETY: inside the reservation.
            if !unsafe { virtual_memory::commit(chunk, CHUNK_SIZE) } {
                return None;
            }
            asan::register_root_region(core::ptr::without_provenance(chunk), CHUNK_SIZE);
            blocks.unused = chunk..chunk + CHUNK_SIZE;
        }
        let block = blocks.unused.start;
        blocks.unused.start += BLOCK_SIZE;
        Some(block)
    }

    pub(super) unsafe fn free(block: usize) {
        // SAFETY: whole pages, and the caller's.
        unsafe { virtual_memory::discard(block, BLOCK_SIZE) };
        asan::poison(core::ptr::without_provenance(block), BLOCK_SIZE);
        BLOCKS.lock().freed.push_back(block);
    }
}

#[cfg(not(bun_asan))]
mod general {
    use core::alloc::Layout;

    use super::BLOCK_SIZE;

    const LAYOUT: Layout = match Layout::from_size_align(BLOCK_SIZE, BLOCK_SIZE) {
        Ok(layout) => layout,
        Err(_) => unreachable!(),
    };

    pub(super) fn allocate() -> Option<usize> {
        // SAFETY: the size is not zero.
        let memory = unsafe { std::alloc::alloc(LAYOUT) };
        (!memory.is_null()).then(|| memory.expose_provenance())
    }

    pub(super) unsafe fn free(block: usize) {
        // SAFETY: the caller's.
        unsafe { std::alloc::dealloc(core::ptr::with_exposed_provenance_mut(block), LAYOUT) }
    }
}

/// The first store to a page is slow. While a heap grows, another thread gets that over with.
mod warm {
    use bun_threading::{Condition, Guarded};

    use super::{BLOCK_SIZE, general};
    use crate::options;

    const DEPTH: usize = 32;
    /// A short program is not worth a thread.
    const REQUESTS_BEFORE_START: usize = 64;
    const IDLE_NANOSECONDS: u64 = 10_000_000_000;

    struct Supply {
        blocks: Vec<usize>,
        requests: usize,
        has_thread: bool,
        is_asleep: bool,
    }

    static SUPPLY: Guarded<Supply> = Guarded::new(Supply {
        blocks: Vec::new(),
        requests: 0,
        has_thread: false,
        is_asleep: false,
    });
    static RUNS_LOW: Condition = Condition::new();

    pub(super) fn take() -> Option<usize> {
        if !options().use_warm_blocks || options().force_mini_vm_mode {
            return None;
        }
        let mut supply = SUPPLY.lock();
        supply.requests += 1;
        let block = supply.blocks.pop();
        if !supply.has_thread {
            if supply.requests >= REQUESTS_BEFORE_START {
                const STACK_SIZE: usize = 256 << 10;
                let thread = std::thread::Builder::new().name("HeapWarmUp".into());
                supply.has_thread = thread.stack_size(STACK_SIZE).spawn(run).is_ok();
                supply.requests = 0;
            }
        } else if supply.is_asleep && supply.blocks.len() < DEPTH / 2 {
            supply.is_asleep = false;
            drop(supply);
            RUNS_LOW.signal();
        }
        block
    }

    fn run() {
        let mut supply = SUPPLY.lock();
        loop {
            if supply.blocks.len() < DEPTH {
                drop(supply);
                let block = general::allocate().inspect(|&block| touch(block));
                supply = SUPPLY.lock();
                supply.blocks.extend(block);
                if block.is_some() {
                    continue;
                }
            }
            (supply.is_asleep, supply.requests) = (true, 0);
            let result = RUNS_LOW.timed_wait_guarded(&mut supply, IDLE_NANOSECONDS);
            if result.is_err() && supply.requests == 0 {
                break;
            }
            supply.is_asleep = false;
        }
        (supply.has_thread, supply.is_asleep) = (false, false);
        for block in core::mem::take(&mut supply.blocks) {
            // SAFETY: never handed out.
            unsafe { general::free(block) };
        }
    }

    fn touch(block: usize) {
        for address in (block..block + BLOCK_SIZE).step_by(bun_alloc::page_size()) {
            // SAFETY: inside a block that nothing else has.
            unsafe { core::ptr::with_exposed_provenance_mut::<u8>(address).write_volatile(0) };
        }
    }
}
