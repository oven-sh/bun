//! Chunked slab with generation counters — the keystone of the ownership
//! model (api.md §Ownership): addresses are stable for the slab's lifetime
//! (chunks never move or free until Drop), freed slots are reused with a
//! generation bump so stale `SocketRef`s resolve to a failed lookup, never a
//! dangling deref. Standalone and Miri-testable.

use core::cell::{Cell, UnsafeCell};
use core::mem::MaybeUninit;
use core::ptr::NonNull;

/// Slots per chunk. Chunks are boxed arrays whose addresses never change
/// while the slab lives.
const CHUNK_SIZE: usize = 64;

/// One slab slot. `value` is first (repr(C)) so a pointer to the value IS a
/// pointer to the slot — `SocketRef.ptr` round-trips with a cast, no
/// container_of arithmetic.
///
/// Generation parity invariant: even = vacant, odd = occupied. Both `alloc`
/// and `free` bump, so any handle captured before either transition
/// mismatches afterwards (a superset of "free bumps" in api.md — stale refs
/// still die, and parity doubles as the liveness bit for Drop).
#[repr(C)]
struct Slot<T> {
    value: UnsafeCell<MaybeUninit<T>>,
    generation: Cell<u32>,
    /// Intrusive free list; meaningful only while vacant.
    next_free: Cell<Option<NonNull<Slot<T>>>>,
}

/// Chunked slab. Owner: the `Loop`. Every allocation is released back into
/// the slab by the tick postlude (deferred close) or by `Drop for
/// ChunkedSlab` at loop teardown, with the same allocator (Box) that
/// allocated the chunk.
pub struct ChunkedSlab<T> {
    /// Raw chunk bases (each `Box<[Slot<T>; CHUNK_SIZE]>` leaked into a raw
    /// pointer so growing the Vec never moves slot memory and no `&mut` over
    /// a whole chunk is ever formed while external slot pointers live).
    chunks: Vec<NonNull<Slot<T>>>,
    free_head: Option<NonNull<Slot<T>>>,
    live: usize,
}

impl<T> ChunkedSlab<T> {
    pub const fn new() -> Self {
        ChunkedSlab {
            chunks: Vec::new(),
            free_head: None,
            live: 0,
        }
    }

    pub fn live_count(&self) -> usize {
        self.live
    }

    /// Allocate a slot, write `value`, return the stable address and the
    /// slot's (odd) generation. The pointer stays valid — though possibly
    /// vacant — until the slab is dropped.
    pub fn alloc(&mut self, value: T) -> (NonNull<T>, u32) {
        let slot = match self.free_head {
            Some(s) => s,
            None => {
                self.grow();
                self.free_head.expect("grow() populates the free list")
            }
        };
        // SAFETY: `slot` came off the free list, so it is a valid vacant slot
        // inside a live chunk; only shared refs to slots are ever formed.
        let slot_ref: &Slot<T> = unsafe { slot.as_ref() };
        self.free_head = slot_ref.next_free.take();

        debug_assert!(slot_ref.generation.get() % 2 == 0, "allocating a live slot");
        // SAFETY: the slot is vacant (parity even), so no other pointer may
        // read the value; writing MaybeUninit through the UnsafeCell is the
        // unique access.
        unsafe { (*slot_ref.value.get()).write(value) };
        let generation = slot_ref.generation.get().wrapping_add(1);
        slot_ref.generation.set(generation);
        self.live += 1;

        (slot.cast::<T>(), generation)
    }

    /// Current generation of the slot holding `ptr` (occupied or vacant).
    /// Handle validation compares this against the captured generation.
    ///
    /// # Safety
    /// `ptr` must have been returned by `alloc` on a slab that has not been
    /// dropped (vacant slots are fine — slab memory is never returned to the
    /// OS while the slab lives).
    pub unsafe fn generation(ptr: NonNull<T>) -> u32 {
        // SAFETY: `value` is the first field of the repr(C) Slot, so the value
        // pointer IS the slot pointer; caller guarantees the chunk is alive.
        let slot: &Slot<T> = unsafe { ptr.cast::<Slot<T>>().as_ref() };
        slot.generation.get()
    }

    /// Drop the value, bump the generation (invalidating every outstanding
    /// handle), and push the slot onto the free list.
    ///
    /// # Safety
    /// `ptr` must have been returned by `alloc` on this slab and the slot
    /// must currently be occupied (not already freed).
    pub unsafe fn free(&mut self, ptr: NonNull<T>) {
        let slot_ptr = ptr.cast::<Slot<T>>();
        // SAFETY: caller guarantees `ptr` is an occupied slot of this live slab.
        let slot: &Slot<T> = unsafe { slot_ptr.as_ref() };
        debug_assert!(slot.generation.get() % 2 == 1, "double free of slab slot");
        // SAFETY: the slot is occupied, so the value is initialized; the
        // caller relinquishes all access, making this the unique access.
        unsafe { (*slot.value.get()).assume_init_drop() };
        slot.generation.set(slot.generation.get().wrapping_add(1));
        slot.next_free.set(self.free_head);
        self.free_head = Some(slot_ptr);
        self.live -= 1;
    }

    /// Allocate one more chunk and thread its slots onto the free list.
    fn grow(&mut self) {
        let chunk: Box<[Slot<T>; CHUNK_SIZE]> = Box::new(core::array::from_fn(|_| Slot {
            value: UnsafeCell::new(MaybeUninit::uninit()),
            generation: Cell::new(0),
            next_free: Cell::new(None),
        }));
        // Ownership: leaked here, reconstituted exactly once in Drop. All slot
        // pointers derive from this into_raw pointer (provenance covers the
        // whole chunk), never from a `&mut` over the Box.
        let base: *mut Slot<T> = Box::into_raw(chunk).cast::<Slot<T>>();
        let base_nn = NonNull::new(base).expect("Box allocation is non-null");
        // Thread in reverse so allocation order follows slot order.
        for i in (0..CHUNK_SIZE).rev() {
            // SAFETY: `i < CHUNK_SIZE`, so the offset stays inside the chunk.
            let slot_ptr = unsafe { NonNull::new_unchecked(base.add(i)) };
            // SAFETY: freshly allocated chunk; no aliasing access exists yet.
            unsafe { slot_ptr.as_ref() }.next_free.set(self.free_head);
            self.free_head = Some(slot_ptr);
        }
        self.chunks.push(base_nn);
    }
}

impl<T> Drop for ChunkedSlab<T> {
    fn drop(&mut self) {
        for &base in &self.chunks {
            for i in 0..CHUNK_SIZE {
                // SAFETY: every chunk owns CHUNK_SIZE slots; `i` is in bounds.
                let slot: &Slot<T> = unsafe { base.as_ptr().add(i).as_ref().unwrap() };
                if slot.generation.get() % 2 == 1 {
                    // SAFETY: odd parity == occupied == initialized value.
                    unsafe { (*slot.value.get()).assume_init_drop() };
                }
            }
            // SAFETY: `base` was produced by leaking a Box<[Slot<T>; CHUNK_SIZE]>
            // in `grow`; reconstituting it here frees with the same allocator,
            // exactly once.
            drop(unsafe { Box::from_raw(base.as_ptr().cast::<[Slot<T>; CHUNK_SIZE]>()) });
        }
    }
}

/// Current generation of a slab-allocated pointer (occupied or vacant).
/// Safe wrapper: every `SocketRef`/`ConnectingRef` pointer originates from a
/// live per-loop slab whose chunk memory is never returned to the OS while
/// the loop lives (api.md §Strategy 1-2) — the crate-wide handle invariant.
pub(crate) fn generation_of<T>(ptr: NonNull<T>) -> u32 {
    // SAFETY: slab chunk memory outlives every handle (see doc above).
    unsafe { ChunkedSlab::generation(ptr) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn alloc_returns_value_and_odd_generation() {
        let mut slab = ChunkedSlab::<u64>::new();
        let (p, g) = slab.alloc(42);
        assert_eq!(g % 2, 1);
        // SAFETY: freshly allocated, occupied slot.
        assert_eq!(unsafe { *p.as_ref() }, 42);
        assert_eq!(unsafe { ChunkedSlab::generation(p) }, g);
        assert_eq!(slab.live_count(), 1);
    }

    #[test]
    fn free_bumps_generation_and_reuses_address() {
        let mut slab = ChunkedSlab::<u32>::new();
        let (p1, g1) = slab.alloc(1);
        // SAFETY: p1 is live.
        unsafe { slab.free(p1) };
        assert_eq!(unsafe { ChunkedSlab::generation(p1) }, g1.wrapping_add(1));
        // LIFO free list → same address, new generation.
        let (p2, g2) = slab.alloc(2);
        assert_eq!(p1, p2);
        assert_eq!(g2, g1.wrapping_add(2));
        assert_ne!(g1, g2, "stale handle must mismatch after reuse");
        assert_eq!(unsafe { *p2.as_ref() }, 2);
    }

    #[test]
    fn addresses_stable_across_growth() {
        let mut slab = ChunkedSlab::<usize>::new();
        let handles: Vec<_> = (0..CHUNK_SIZE * 3 + 5).map(|i| (i, slab.alloc(i))).collect();
        for (i, (p, g)) in &handles {
            // SAFETY: all slots still live; growth must not have moved them.
            assert_eq!(unsafe { *p.as_ref() }, *i);
            assert_eq!(unsafe { ChunkedSlab::generation(*p) }, *g);
        }
        assert_eq!(slab.live_count(), CHUNK_SIZE * 3 + 5);
    }

    #[test]
    fn drop_runs_destructors_of_live_values_only() {
        let counter = Rc::new(());
        let mut slab = ChunkedSlab::<Rc<()>>::new();
        let (p1, _) = slab.alloc(Rc::clone(&counter));
        let (_p2, _) = slab.alloc(Rc::clone(&counter));
        // SAFETY: p1 is live.
        unsafe { slab.free(p1) };
        assert_eq!(Rc::strong_count(&counter), 2); // freed slot dropped its Rc
        drop(slab);
        assert_eq!(Rc::strong_count(&counter), 1); // live slot dropped at Drop
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic(expected = "double free of slab slot")]
    fn double_free_is_caught_in_debug() {
        let mut slab = ChunkedSlab::<u32>::new();
        let (p, _) = slab.alloc(7);
        // SAFETY: p is live.
        unsafe { slab.free(p) };
        // SAFETY-VIOLATION under test: second free must trip the parity assert.
        unsafe { slab.free(p) };
    }

    #[test]
    fn generation_parity_tracks_liveness() {
        let mut slab = ChunkedSlab::<u8>::new();
        let (p, g0) = slab.alloc(0);
        for cycle in 0..5u32 {
            assert_eq!(unsafe { ChunkedSlab::generation(p) } % 2, 1, "occupied must be odd");
            // SAFETY: p is live at the top of each cycle.
            unsafe { slab.free(p) };
            assert_eq!(unsafe { ChunkedSlab::generation(p) } % 2, 0, "vacant must be even");
            // Generation advances by exactly 2 per free+alloc cycle, so every
            // prior handle mismatches forever (until u32 wrap).
            let (p2, g2) = slab.alloc(0);
            assert_eq!(p2, p, "LIFO free list must reuse the slot");
            assert_eq!(g2, g0.wrapping_add(2 * (cycle + 1)));
        }
    }

    #[test]
    fn freed_slots_are_reused_before_growing() {
        let mut slab = ChunkedSlab::<usize>::new();
        let handles: Vec<_> = (0..CHUNK_SIZE).map(|i| slab.alloc(i).0).collect();
        assert_eq!(slab.chunks.len(), 1);
        for &p in &handles {
            // SAFETY: each handle is live and freed exactly once.
            unsafe { slab.free(p) };
        }
        for i in 0..CHUNK_SIZE {
            let (p, _) = slab.alloc(i);
            assert!(handles.contains(&p), "must reuse freed slots, not grow");
        }
        assert_eq!(slab.chunks.len(), 1, "no growth while free slots exist");
    }

    #[test]
    fn drop_of_fully_vacant_slab_runs_no_destructors() {
        let counter = Rc::new(());
        let mut slab = ChunkedSlab::<Rc<()>>::new();
        let (p, _) = slab.alloc(Rc::clone(&counter));
        // SAFETY: p is live.
        unsafe { slab.free(p) };
        assert_eq!(Rc::strong_count(&counter), 1);
        drop(slab); // must not touch the vacant slot's dropped value
        assert_eq!(Rc::strong_count(&counter), 1);
        drop(ChunkedSlab::<Rc<()>>::new()); // empty slab: no chunks, no-op
    }

    #[test]
    fn stale_generation_mismatches_across_many_reuses() {
        let mut slab = ChunkedSlab::<u16>::new();
        let (p, stale_gen) = slab.alloc(1);
        // SAFETY: p is live.
        unsafe { slab.free(p) };
        for _ in 0..8 {
            let (p2, g2) = slab.alloc(2);
            assert_eq!(p2, p);
            assert_ne!(g2, stale_gen, "stale handle must never validate again");
            assert_ne!(unsafe { ChunkedSlab::generation(p) }, stale_gen);
            // SAFETY: p2 is live.
            unsafe { slab.free(p2) };
            assert_ne!(unsafe { ChunkedSlab::generation(p) }, stale_gen);
        }
    }

    #[test]
    fn interleaved_alloc_free_keeps_live_count_coherent() {
        let mut slab = ChunkedSlab::<Vec<u8>>::new();
        let mut live = Vec::new();
        for round in 0..10usize {
            for i in 0..CHUNK_SIZE {
                live.push(slab.alloc(vec![round as u8; i]).0);
            }
            for _ in 0..CHUNK_SIZE / 2 {
                let p = live.swap_remove(live.len() / 2);
                // SAFETY: p is live (taken from the live set exactly once).
                unsafe { slab.free(p) };
            }
        }
        assert_eq!(slab.live_count(), live.len());
    }
}
