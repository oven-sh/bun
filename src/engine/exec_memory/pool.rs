//! The one reservation that holds all generated code.
//!
//! It is divided into regions within which every jump reaches. A region starts with room for veneers, which lead to
//! whatever is out of reach.

use core::ops::Range;
use core::ptr;
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::collections::BTreeMap;
use std::sync::OnceLock;

use bun_engine_asm::patch::{self, VENEER_SIZE};
use bun_threading::Guarded;
use smallvec::SmallVec;

use crate::free_space::FreeSpace;
use crate::instruction_cache;
use crate::pages::{self, Purpose};

const MIB: usize = 1 << 20;
const REGION_SIZE: usize = if cfg!(target_arch = "x86_64") {
    1024 * MIB
} else {
    128 * MIB
};
const REGION_COUNT: usize = if cfg!(target_arch = "x86_64") { 1 } else { 4 };
const POOL_SIZE: usize = REGION_SIZE * REGION_COUNT;
const VENEER_AREA_SIZE: usize = 4 * MIB;
const COMMIT_STEP: usize = 256 << 10;
pub(crate) const GRANULE: usize = 16;
const GRANULES_PER_WORD: usize = u64::BITS as usize;
const STARTS_SIZE: usize = POOL_SIZE / GRANULE / 8;

const _: () = assert!(REGION_SIZE - 4 <= patch::REACH);

/// Pages that are made accessible from the lowest up, and stay so.
struct Committed {
    end: usize,
}

impl Committed {
    fn extend_to(&mut self, end: usize) -> bool {
        if end <= self.end {
            return true;
        }
        let size = (end - self.end).next_multiple_of(COMMIT_STEP);
        // SAFETY: every area starts and ends at a multiple of the step from the start of the reservation.
        let done = unsafe { pages::commit(self.end, size, Purpose::Code) };
        if done {
            self.end += size;
        }
        done
    }
}

struct Region {
    code: Committed,
    veneers: Committed,
    next_veneer: usize,
    free_veneers: Vec<usize>,
    /// For targets outside the pool. These are never freed.
    shared_veneers: BTreeMap<usize, usize>,
}

pub(crate) struct State {
    free: FreeSpace,
    regions: [Region; REGION_COUNT],
    /// By the block that jumps through them: target and veneer.
    owned_veneers: BTreeMap<usize, SmallVec<[(usize, usize); 2]>>,
    /// By block: where in its code a routine has a frame of its own. Sorted.
    pub(crate) frames_of_routines: BTreeMap<usize, Box<[Range<u32>]>>,
}

pub(crate) struct Pool {
    start: usize,
    /// A bit for each granule at which a block starts.
    starts: &'static [AtomicU64],
    pub(crate) state: Guarded<State>,
}

static POOL: OnceLock<Option<Pool>> = OnceLock::new();
/// Zero until there is a pool. For those that cannot wait for `POOL`.
static POOL_START: AtomicUsize = AtomicUsize::new(0);
/// Changes under the lock.
static BYTES_IN_USE: AtomicUsize = AtomicUsize::new(0);
pub(crate) static CAPACITY: AtomicUsize = AtomicUsize::new(Pool::MAX_CAPACITY);

pub(crate) fn pool() -> Option<&'static Pool> {
    POOL.get_or_init(Pool::reserve).as_ref()
}

pub(crate) fn pool_containing(address: usize) -> Option<&'static Pool> {
    if contains(address) {
        POOL.get()?.as_ref()
    } else {
        None
    }
}

/// Whether the system lets this process generate code.
pub fn is_available() -> bool {
    pool().is_some()
}

/// Whether the address is in the memory for generated code. Takes no lock.
#[inline]
pub fn contains(address: usize) -> bool {
    let start = POOL_START.load(Ordering::Acquire);
    start != 0 && address.wrapping_sub(start) < POOL_SIZE
}

/// The addresses for which `contains` holds.
pub fn address_range() -> core::ops::Range<usize> {
    match POOL_START.load(Ordering::Acquire) {
        0 => 0..0,
        start => start..start + POOL_SIZE,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Usage {
    pub bytes_in_use: usize,
    pub capacity: usize,
}

pub fn usage() -> Usage {
    Usage {
        bytes_in_use: BYTES_IN_USE.load(Ordering::Relaxed),
        capacity: CAPACITY.load(Ordering::Relaxed),
    }
}

/// Code takes up no more than that.
pub fn limit_capacity(bytes: usize) {
    CAPACITY.fetch_min(bytes, Ordering::Relaxed);
}

/// # Safety
/// The range is in committed pages of the pool, and no thread runs or reads it.
pub(crate) unsafe fn write(address: usize, bytes: &[u8]) {
    pages::with_writable_code(|| {
        // SAFETY: the caller's.
        unsafe {
            ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                ptr::with_exposed_provenance_mut(address),
                bytes.len(),
            )
        };
    });
    instruction_cache::flush(address, bytes.len());
}

impl Pool {
    pub(crate) const MAX_CAPACITY: usize = POOL_SIZE - REGION_COUNT * VENEER_AREA_SIZE;

    fn reserve() -> Option<Self> {
        let start = pages::reserve(POOL_SIZE, Purpose::Code)?;
        let mut free = FreeSpace::default();
        let mut regions: [Region; REGION_COUNT] = core::array::from_fn(|index| {
            let (veneers, code) = (index * REGION_SIZE, index * REGION_SIZE + VENEER_AREA_SIZE);
            free.free((code / GRANULE) as u32..((veneers + REGION_SIZE) / GRANULE) as u32);
            Region {
                code: Committed { end: start + code },
                veneers: Committed {
                    end: start + veneers,
                },
                next_veneer: start + veneers,
                free_veneers: Vec::new(),
                shared_veneers: BTreeMap::new(),
            }
        });
        let [first, ..] = &mut regions;
        let is_executable = first.code.extend_to(first.code.end + 1);
        let starts = is_executable
            .then(|| pages::reserve(STARTS_SIZE, Purpose::Data))
            .flatten();
        // SAFETY: the whole of the reservation that was just made.
        let Some(starts) =
            starts.filter(|&starts| unsafe { pages::commit(starts, STARTS_SIZE, Purpose::Data) })
        else {
            // SAFETY: nothing refers to it yet.
            unsafe { pages::unreserve(start, POOL_SIZE) };
            return None;
        };
        // SAFETY: the pages are aligned, filled with zeros, never unmapped and reached through this slice only.
        let starts = unsafe {
            core::slice::from_raw_parts(ptr::with_exposed_provenance(starts), STARTS_SIZE / 8)
        };
        let state = State {
            free,
            regions,
            owned_veneers: BTreeMap::new(),
            frames_of_routines: BTreeMap::new(),
        };
        POOL_START.store(start, Ordering::Release);
        Some(Self {
            start,
            starts,
            state: Guarded::new(state),
        })
    }

    fn granule(&self, address: usize) -> usize {
        (address - self.start) / GRANULE
    }

    fn region<'a>(&self, state: &'a mut State, address: usize) -> &'a mut Region {
        &mut state.regions[(address - self.start) / REGION_SIZE]
    }

    /// A block of `size` bytes, a multiple of the granule, whose second granule is aligned.
    pub(crate) fn allocate(
        &self,
        state: &mut State,
        size: usize,
        alignment: usize,
        limit: usize,
    ) -> Option<usize> {
        if BYTES_IN_USE.load(Ordering::Relaxed) + size > limit {
            return None;
        }
        let granules = (size / GRANULE) as u32;
        let first = state
            .free
            .allocate(granules, (alignment / GRANULE) as u32, 1)?;
        let block = self.start + first as usize * GRANULE;
        if !self.region(state, block).code.extend_to(block + size) {
            state.free.free(first..first + granules);
            return None;
        }
        BYTES_IN_USE.fetch_add(size, Ordering::Relaxed);
        Some(block)
    }

    /// From now on `block_at_or_before` finds the block.
    pub(crate) fn publish(&self, block: usize) {
        let granule = self.granule(block);
        self.starts[granule / GRANULES_PER_WORD]
            .fetch_or(1 << (granule % GRANULES_PER_WORD), Ordering::Release);
    }

    /// # Safety
    /// The block was allocated, and no thread runs it or will.
    pub(crate) unsafe fn free(&self, state: &mut State, block: Range<usize>) {
        let granule = self.granule(block.start);
        self.starts[granule / GRANULES_PER_WORD]
            .fetch_and(!(1 << (granule % GRANULES_PER_WORD)), Ordering::Release);
        for (_, veneer) in state.owned_veneers.remove(&block.start).unwrap_or_default() {
            self.region(state, veneer).free_veneers.push(veneer);
        }
        state.frames_of_routines.remove(&block.start);
        if cfg!(debug_assertions) {
            const FAULTS: u8 = if cfg!(target_arch = "x86_64") {
                0xcc
            } else {
                0
            };
            // SAFETY: the caller's.
            unsafe { write(block.start, &vec![FAULTS; block.len()]) };
        }
        BYTES_IN_USE.fetch_sub(block.len(), Ordering::Relaxed);
        let free = state
            .free
            .free(granule as u32..self.granule(block.end) as u32);
        let page = bun_alloc::page_size();
        let address = |granule: u32| self.start + granule as usize * GRANULE;
        let first = address(free.start)
            .next_multiple_of(page)
            .max(block.start / page * page);
        let end = (address(free.end) / page * page).min(block.end.next_multiple_of(page));
        if first < end {
            // SAFETY: the pages overlap a block, so they are committed, and nothing in them is allocated.
            unsafe { pages::discard(first, end - first) };
        }
    }

    pub(crate) fn block_at_or_before(&self, address: usize) -> Option<usize> {
        let granule = self.granule(address);
        let mut index = granule / GRANULES_PER_WORD;
        let mut word = self.starts[index].load(Ordering::Acquire)
            & u64::MAX >> (63 - granule % GRANULES_PER_WORD);
        while word == 0 {
            index = index.checked_sub(1)?;
            word = self.starts[index].load(Ordering::Acquire);
        }
        Some(self.start + (index * GRANULES_PER_WORD + word.ilog2() as usize) * GRANULE)
    }

    pub(crate) fn is_committed_code(&self, state: &State, address: usize) -> bool {
        let offset = address - self.start;
        offset % REGION_SIZE >= VENEER_AREA_SIZE
            && address < state.regions[offset / REGION_SIZE].code.end
    }

    pub(crate) fn is_veneer(&self, address: usize) -> bool {
        contains(address) && (address - self.start) % REGION_SIZE < VENEER_AREA_SIZE
    }

    /// An address within reach of `block` from which control goes on to `target`.
    pub(crate) fn veneer(&self, state: &mut State, block: usize, target: usize) -> Option<usize> {
        let is_shared = !contains(target);
        let existing = if is_shared {
            self.region(state, block)
                .shared_veneers
                .get(&target)
                .copied()
        } else {
            let owned = state
                .owned_veneers
                .get(&block)
                .map_or(&[][..], |owned| owned);
            owned
                .iter()
                .find(|&&(known, _)| known == target)
                .map(|&(_, veneer)| veneer)
        };
        if existing.is_some() {
            return existing;
        }
        let region_start = self.start + (block - self.start) / REGION_SIZE * REGION_SIZE;
        let region = self.region(state, block);
        let veneer = match region.free_veneers.pop() {
            Some(veneer) => veneer,
            None => {
                let (veneer, end) = (region.next_veneer, region.next_veneer + VENEER_SIZE);
                if end > region_start + VENEER_AREA_SIZE || !region.veneers.extend_to(end) {
                    return None;
                }
                region.next_veneer = end;
                veneer
            }
        };
        // SAFETY: committed, and either new or freed with the only block that jumped to it.
        unsafe { write(veneer, &patch::veneer(target)) };
        if is_shared {
            region.shared_veneers.insert(target, veneer);
        } else {
            state
                .owned_veneers
                .entry(block)
                .or_default()
                .push((target, veneer));
        }
        Some(veneer)
    }
}
