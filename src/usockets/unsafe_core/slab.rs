//! Chunked slab with generation counters — the keystone of the ownership
//! model (docs/design.md §Strategy 1): slot addresses are stable for the slab's
//! lifetime (chunk mappings never move or unmap until Drop), freed slots are
//! reused with a generation bump so stale `SocketRef`s resolve to a failed
//! lookup, never a dangling deref. Size classes give group-vtable kinds
//! header-contiguous inline ext bytes (docs/design.md §Ext storage); empty
//! chunks are decommitted with an epoch ABA guard (docs/design.md §Slab reclamation).

use core::marker::PhantomData;
use core::mem::{align_of, size_of};
use core::ptr::{self, NonNull};

/// Slot prelude size AND slot/value/ext alignment (== LIBUS_EXT_ALIGNMENT).
/// Fixed across size classes so `generation` probes ptr−16 with no class info.
pub(crate) const SLOT_META_BYTES: usize = crate::LIBUS_EXT_ALIGNMENT;

/// Minimum chunk mapping size; also the mapping granularity (a 64 KiB
/// multiple is page-aligned on 4 KiB and 16 KiB page systems and matches
/// Windows allocation granularity).
const CHUNK_BYTES_MIN: usize = 64 * 1024;

/// Slots per chunk (docs/design.md §Slab reclamation). Fits `next_free`/`free_head` in u16.
const SLOTS_PER_CHUNK: usize = 256;

/// Generation split (u64; docs/design.md §Slab reclamation): low 32 bits alloc/free counter (bit 0
/// = parity, odd = occupied), high 32 bits per-chunk decommit epoch. The
/// epoch lives authoritatively in the loop-side `ChunkEntry` (never in
/// decommittable memory) and is packed into every generation stamped after
/// a (re)commit, so a handle from decommit cycle N can never validate in
/// cycle N+1; both halves' wrap is unreachable (~2^32 cycles each).
const EPOCH_SHIFT: u32 = 32;
const COUNTER_MASK: u64 = (1 << EPOCH_SHIFT) - 1;

/// Counter increment confined to the low 32 bits: a hot slot's counter wrap
/// stays within its epoch and can never carry into the epoch bits.
const fn bump_counter(g: u64) -> u64 {
    (g & !COUNTER_MASK) | (g.wrapping_add(1) & COUNTER_MASK)
}

/// Free-list terminator for u16 chunk-local slot indices.
const NONE_SLOT: u16 = u16::MAX;

/// Fixed 16-byte slot prelude, immediately BEFORE the value in every size
/// class (layout contract: the value keeps `PollState` first; the generation probe reads
/// this prelude adjacent to the value at a class-independent offset).
#[repr(C)]
struct SlotMeta {
    generation: u64,
    /// Index into `ChunkedSlab::chunks`; valid while the slot is occupied
    /// (stamped on every alloc — `free` routes through it).
    chunk_id: u32,
    /// Intrusive free list (chunk-local slot index); valid while vacant and
    /// the chunk is committed.
    next_free: u16,
    /// Inline ext capacity of this slot's class (bytes past the value
    /// stride); stamped on alloc, read by `inline_ext_of`.
    ext_capacity: u16,
}

const _: () = assert!(size_of::<SlotMeta>() == SLOT_META_BYTES);
const _: () = assert!(align_of::<SlotMeta>() <= SLOT_META_BYTES);

/// Loop-side chunk bookkeeping. Lives in the slab (ordinary heap), NOT in
/// the decommittable mapping — `epoch`/`committed`/`occupied` must survive
/// decommit.
struct ChunkEntry {
    base: NonNull<u8>,
    chunk_bytes: usize,
    slot_size: u32,
    slots: u32,
    ext_capacity: u16,
    class: u32,
    /// Decommit epoch; bumped on every decommit, packed into generation
    /// high bits at the next commit's free-list threading.
    epoch: u32,
    occupied: u32,
    /// Head of the chunk-local vacant list; NONE_SLOT when decommitted or full.
    free_head: u16,
    committed: bool,
    /// Membership flag for the class's `nonfull` stack (avoids duplicates).
    in_nonfull: bool,
}

/// One slot size class: slot = 16-byte meta + value stride + inline ext
/// capacity. Group-vtable kinds pick the class by the family-max ext size
/// passed at listen/context creation; Rust kinds and connecting sockets use
/// capacity 0.
struct SizeClass {
    ext_capacity: u16,
    slot_size: u32,
    slots_per_chunk: u32,
    chunk_bytes: usize,
    /// Committed chunks that may have vacant slots (lazily pruned).
    nonfull: Vec<u32>,
    /// Decommitted (all-vacant) chunks, recommitted lazily on demand.
    empty_decommitted: Vec<u32>,
}

/// Chunked slab. Owner: the `Loop`. Every allocation is released back into
/// the slab by the tick postlude (deferred close) or by `Drop for
/// ChunkedSlab` at loop teardown; chunk mappings are released only by Drop.
pub struct ChunkedSlab<T> {
    classes: Vec<SizeClass>,
    chunks: Vec<ChunkEntry>,
    live: usize,
    /// Decommit hysteresis: the most-recently-emptied chunk stays committed;
    /// emptying another chunk decommits this one (if still empty).
    last_emptied: Option<u32>,
    _marker: PhantomData<T>,
}

/// Value stride inside a slot: `T` rounded up so the inline ext area (and
/// the next slot) stays LIBUS_EXT_ALIGNMENT-aligned.
const fn value_stride<T>() -> usize {
    size_of::<T>().next_multiple_of(SLOT_META_BYTES)
}

/// Slot prelude of the slot holding `value` — a raw place, no reference
/// formed; class-independent (meta is always exactly 16 bytes before the
/// value — layout contract).
fn meta_of<T>(value: NonNull<T>) -> *mut SlotMeta {
    value.as_ptr().cast::<u8>().wrapping_sub(SLOT_META_BYTES).cast()
}

impl<T> ChunkedSlab<T> {
    pub const fn new() -> Self {
        ChunkedSlab {
            classes: Vec::new(),
            chunks: Vec::new(),
            live: 0,
            last_emptied: None,
            _marker: PhantomData,
        }
    }

    pub fn live_count(&self) -> usize {
        self.live
    }

    /// Allocate a slot with no inline ext bytes (Rust kinds' 8-byte header
    /// word IS the ext storage; connecting sockets likewise).
    pub fn alloc(&mut self, value: T) -> (NonNull<T>, u64) {
        self.alloc_with_ext(value, 0)
    }

    /// Allocate from the size class carrying at least `ext_capacity` inline
    /// ext bytes contiguous after the value (zeroed). Returns the stable
    /// value address and the slot's (odd) generation. The address stays
    /// readable — though possibly vacant or decommitted-to-zero — until the
    /// slab is dropped.
    pub fn alloc_with_ext(&mut self, value: T, ext_capacity: usize) -> (NonNull<T>, u64) {
        const {
            assert!(align_of::<T>() <= SLOT_META_BYTES, "slab value over-aligned");
        }
        let ci = self.class_index(ext_capacity.next_multiple_of(SLOT_META_BYTES));
        loop {
            while let Some(&cid) = self.classes[ci].nonfull.last() {
                let e = &mut self.chunks[cid as usize];
                if e.free_head == NONE_SLOT {
                    // Full or decommitted: prune lazily.
                    e.in_nonfull = false;
                    self.classes[ci].nonfull.pop();
                    continue;
                }
                return self.pop_slot(cid, value);
            }
            if let Some(cid) = self.classes[ci].empty_decommitted.pop() {
                self.recommit(cid);
                self.chunks[cid as usize].in_nonfull = true;
                self.classes[ci].nonfull.push(cid);
                continue;
            }
            self.grow(ci);
        }
    }

    /// Take the head vacant slot of committed chunk `cid` (free_head != NONE_SLOT).
    fn pop_slot(&mut self, cid: u32, value: T) -> (NonNull<T>, u64) {
        let e = &mut self.chunks[cid as usize];
        debug_assert!(e.committed);
        let idx = e.free_head;
        // SAFETY: `idx < e.slots` (only in-chunk indices are ever threaded),
        // so every access below stays inside the committed chunk mapping.
        unsafe {
            let slot = e.base.as_ptr().add(idx as usize * e.slot_size as usize);
            let meta = slot.cast::<SlotMeta>();
            e.free_head = (*meta).next_free;
            debug_assert!((*meta).generation & 1 == 0, "allocating a live slot");
            let generation = bump_counter((*meta).generation);
            (*meta).generation = generation;
            (*meta).chunk_id = cid;
            (*meta).ext_capacity = e.ext_capacity;
            let vptr = slot.add(SLOT_META_BYTES).cast::<T>();
            vptr.write(value);
            if e.ext_capacity != 0 {
                // Ext area contract: zeroed at creation (C parity for the
                // former alloc_ext_area).
                ptr::write_bytes(
                    slot.add(SLOT_META_BYTES + value_stride::<T>()),
                    0,
                    e.ext_capacity as usize,
                );
            }
            e.occupied += 1;
            self.live += 1;
            (NonNull::new_unchecked(vptr), generation)
        }
    }

    /// Current generation of the slot holding `ptr` (occupied, vacant, or
    /// decommitted — decommitted pages read as stale-even/zero, which can
    /// never equal an occupied handle's odd generation).
    ///
    /// # Safety
    /// `ptr` must have been returned by `alloc`/`alloc_with_ext` on a slab
    /// that has not been dropped (mappings stay readable while the slab
    /// lives: POSIX decommit is MADV_DONTNEED, Windows is MEM_RESET).
    pub unsafe fn generation(ptr: NonNull<T>) -> u64 {
        // SAFETY: meta precedes the value by SLOT_META_BYTES in every size
        // class; caller guarantees the mapping is alive.
        unsafe { (*meta_of(ptr)).generation }
    }

    /// Drop the value, bump the generation (invalidating every outstanding
    /// handle), and push the slot onto its chunk's free list. A chunk
    /// reaching 0 occupied slots decommits the PREVIOUSLY emptied chunk
    /// (hysteresis — see `note_emptied`).
    ///
    /// # Safety
    /// `ptr` must have been returned by `alloc`/`alloc_with_ext` on this
    /// slab and the slot must currently be occupied (not already freed).
    pub unsafe fn free(&mut self, ptr: NonNull<T>) {
        let meta = meta_of(ptr);
        // SAFETY: caller guarantees `ptr` is an occupied slot of this live
        // slab — occupied slots always sit in committed chunks.
        let (cid, emptied, class) = unsafe {
            let generation = (*meta).generation;
            debug_assert!(generation & 1 == 1, "double free of slab slot");
            // The slot is occupied, so the value is initialized; the caller
            // relinquishes all access, making this the unique access.
            ptr.as_ptr().drop_in_place();
            (*meta).generation = bump_counter(generation);
            let cid = (*meta).chunk_id;
            let e = &mut self.chunks[cid as usize];
            let slot = ptr.as_ptr().cast::<u8>().sub(SLOT_META_BYTES);
            let idx =
                (slot.offset_from(e.base.as_ptr()) as usize / e.slot_size as usize) as u16;
            debug_assert!((idx as u32) < e.slots);
            (*meta).next_free = e.free_head;
            e.free_head = idx;
            e.occupied -= 1;
            (cid, e.occupied == 0, e.class)
        };
        self.live -= 1;
        if !self.chunks[cid as usize].in_nonfull {
            self.chunks[cid as usize].in_nonfull = true;
            self.classes[class as usize].nonfull.push(cid);
        }
        if emptied {
            self.note_emptied(cid);
        }
    }

    /// Hysteresis: keep the most-recently-emptied chunk committed; decommit
    /// the previous one if it is still committed and still empty (avoids
    /// commit thrash on connect/close oscillation at a chunk boundary).
    fn note_emptied(&mut self, cid: u32) {
        if let Some(prev) = self.last_emptied {
            if prev != cid {
                let p = &self.chunks[prev as usize];
                if p.committed && p.occupied == 0 {
                    self.decommit(prev);
                }
            }
        }
        self.last_emptied = Some(cid);
    }

    /// Return an all-vacant chunk's pages to the OS. The range stays
    /// reserved and READABLE (stale probes hit stale-even/zero generations);
    /// the loop-side epoch bump guarantees post-recommit generations can
    /// never collide with pre-decommit handles.
    fn decommit(&mut self, cid: u32) {
        let e = &mut self.chunks[cid as usize];
        debug_assert!(e.committed && e.occupied == 0);
        e.epoch = e.epoch.wrapping_add(1);
        e.committed = false;
        e.free_head = NONE_SLOT;
        os::decommit(e.base, e.chunk_bytes);
        let class = e.class;
        self.classes[class as usize].empty_decommitted.push(cid);
    }

    /// Lazy recommit: re-thread the free list, stamping every slot's
    /// generation with the post-decommit epoch in the high bits.
    fn recommit(&mut self, cid: u32) {
        let e = &mut self.chunks[cid as usize];
        debug_assert!(!e.committed && e.occupied == 0);
        os::recommit(e.base, e.chunk_bytes);
        e.committed = true;
        Self::thread_free_list(e);
    }

    /// Thread all slots of a freshly (re)committed chunk onto its free list
    /// in slot order, stamping generations to `epoch << EPOCH_SHIFT` (even =
    /// vacant; counter restarts each epoch).
    fn thread_free_list(e: &mut ChunkEntry) {
        let base_generation = u64::from(e.epoch) << EPOCH_SHIFT;
        let mut head = NONE_SLOT;
        for i in (0..e.slots).rev() {
            // SAFETY: `i < e.slots`, inside the committed chunk mapping;
            // no external pointer may observe a vacant epoch-fresh slot yet.
            unsafe {
                let meta = e
                    .base
                    .as_ptr()
                    .add(i as usize * e.slot_size as usize)
                    .cast::<SlotMeta>();
                (*meta).generation = base_generation;
                (*meta).next_free = head;
            }
            head = i as u16;
        }
        e.free_head = head;
    }

    /// Map one more chunk for class `ci` and put it in rotation.
    fn grow(&mut self, ci: usize) {
        let class = &self.classes[ci];
        let cid = u32::try_from(self.chunks.len()).expect("chunk table overflow");
        let mut e = ChunkEntry {
            base: os::map(class.chunk_bytes),
            chunk_bytes: class.chunk_bytes,
            slot_size: class.slot_size,
            slots: class.slots_per_chunk,
            ext_capacity: class.ext_capacity,
            class: ci as u32,
            epoch: 0,
            occupied: 0,
            free_head: NONE_SLOT,
            committed: true,
            in_nonfull: true,
        };
        Self::thread_free_list(&mut e);
        self.chunks.push(e);
        self.classes[ci].nonfull.push(cid);
    }

    /// Visit every occupied slot (odd generation parity). `f` must not call
    /// back into this slab — the exclusive borrow spans the whole walk.
    pub fn for_each_occupied(&mut self, mut f: impl FnMut(NonNull<T>)) {
        for e in &self.chunks {
            if e.occupied == 0 {
                continue;
            }
            for i in 0..e.slots {
                // SAFETY: in-bounds slot of a committed chunk (occupied slots
                // only ever live in committed chunks); odd parity == occupied
                // == initialized value.
                unsafe {
                    let slot = e.base.as_ptr().add(i as usize * e.slot_size as usize);
                    if (*slot.cast::<SlotMeta>()).generation & 1 == 1 {
                        f(NonNull::new_unchecked(slot.add(SLOT_META_BYTES).cast::<T>()));
                    }
                }
            }
        }
    }

    /// Find or create the class for `cap` (already rounded to 16) — one per
    /// distinct family-max ext size, ~5 per loop in practice.
    fn class_index(&mut self, cap: usize) -> usize {
        if let Some(i) = self.classes.iter().position(|c| c.ext_capacity as usize == cap) {
            return i;
        }
        // In-tree creation sites pass sizeof() constants; a cap past u16 would
        // silently truncate the stamped capacity, so fail loudly instead.
        assert!(cap <= u16::MAX as usize, "inline ext capacity exceeds size-class limit");
        let slot_size = SLOT_META_BYTES + value_stride::<T>() + cap;
        let chunk_bytes = (slot_size * SLOTS_PER_CHUNK).next_multiple_of(CHUNK_BYTES_MIN);
        self.classes.push(SizeClass {
            ext_capacity: cap as u16,
            slot_size: slot_size as u32,
            slots_per_chunk: SLOTS_PER_CHUNK as u32,
            chunk_bytes,
            nonfull: Vec::new(),
            empty_decommitted: Vec::new(),
        });
        self.classes.len() - 1
    }
}

impl<T> Drop for ChunkedSlab<T> {
    fn drop(&mut self) {
        for e in &self.chunks {
            if e.occupied != 0 {
                for i in 0..e.slots {
                    // SAFETY: in-bounds slot of a committed chunk (occupied
                    // slots only ever live in committed chunks).
                    unsafe {
                        let slot = e.base.as_ptr().add(i as usize * e.slot_size as usize);
                        if (*slot.cast::<SlotMeta>()).generation & 1 == 1 {
                            // Odd parity == occupied == initialized value.
                            slot.add(SLOT_META_BYTES).cast::<T>().drop_in_place();
                        }
                    }
                }
            }
            os::unmap(e.base, e.chunk_bytes);
        }
    }
}

/// Current generation of a slab-allocated pointer (occupied, vacant, or
/// decommitted). Safe wrapper: every `SocketRef`/`ConnectingRef` pointer
/// originates from a live per-loop slab whose chunk mappings stay readable
/// while the loop lives (docs/design.md §Strategy 1-2) — the crate handle invariant.
pub(crate) fn generation_of<T>(ptr: NonNull<T>) -> u64 {
    // SAFETY: slab chunk mappings outlive every handle (see doc above).
    unsafe { ChunkedSlab::generation(ptr) }
}

/// Inline ext area of the slot holding `value`: a fixed header+1 projection
/// (value stride is 16-rounded, so the area is LIBUS_EXT_ALIGNMENT-aligned).
/// `None` when the slot's class carries no ext bytes.
pub(crate) fn inline_ext_of<T>(value: NonNull<T>) -> Option<NonNull<u8>> {
    // SAFETY: `value` is a live occupied slab slot (crate handle invariant);
    // its meta stamped `ext_capacity` on alloc.
    let cap = unsafe { (*meta_of(value)).ext_capacity };
    (cap != 0).then(|| {
        // SAFETY: the slot's class sized the slot for `cap` bytes past the
        // value stride.
        unsafe { NonNull::new_unchecked(value.as_ptr().cast::<u8>().add(value_stride::<T>())) }
    })
}

/// Inline ext capacity (bytes) of the slot holding `value` (0 = no area).
pub(crate) fn inline_ext_capacity_of<T>(value: NonNull<T>) -> u32 {
    // SAFETY: see `inline_ext_of`.
    u32::from(unsafe { (*meta_of(value)).ext_capacity })
}

/// Chunk memory: mmap/VirtualAlloc reservations, decommitted when empty.
/// Invariant relied on crate-wide: a mapped chunk stays READABLE until
/// `unmap`, including after `decommit` — stale handle probes and stale
/// kernel-event udata may still read generations from it.
mod os {
    use core::ptr::NonNull;

    #[cfg(all(unix, not(miri)))]
    pub(super) fn map(bytes: usize) -> NonNull<u8> {
        // SAFETY: plain anonymous private mapping; no fd, offset 0.
        let p = unsafe {
            libc::mmap(
                core::ptr::null_mut(),
                bytes,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_PRIVATE | libc::MAP_ANON,
                -1,
                0,
            )
        };
        let p = if p == libc::MAP_FAILED { core::ptr::null_mut() } else { p };
        bun_core::handle_oom(NonNull::new(p.cast::<u8>()).ok_or(()))
    }

    #[cfg(all(unix, not(miri)))]
    pub(super) fn unmap(base: NonNull<u8>, bytes: usize) {
        // SAFETY: `base`/`bytes` are exactly one live `map` result.
        unsafe { libc::munmap(base.as_ptr().cast(), bytes) };
    }

    #[cfg(all(unix, not(miri)))]
    pub(super) fn decommit(base: NonNull<u8>, bytes: usize) {
        // MADV_DONTNEED (NEVER MADV_FREE — its zero-fill is not guaranteed
        // before reclaim): range stays mapped; later reads fault in zero pages
        // (never odd). Advisory — on failure the chunk simply stays resident.
        // SAFETY: `base`/`bytes` are exactly one live `map` result.
        unsafe { libc::madvise(base.as_ptr().cast(), bytes, libc::MADV_DONTNEED) };
    }

    #[cfg(all(unix, not(miri)))]
    pub(super) fn recommit(_base: NonNull<u8>, _bytes: usize) {
        // POSIX: first touch after MADV_DONTNEED recommits implicitly.
    }

    #[cfg(all(windows, not(miri)))]
    mod win {
        // Windows deliberately uses MEM_RESET, not MEM_DECOMMIT: stale handle
        // probes must stay a plain slot deref and MEM_DECOMMIT pages AV;
        // MEM_RESET stays committed+readable while the OS discards the pages.
        pub(super) const MEM_COMMIT: u32 = 0x1000;
        pub(super) const MEM_RESERVE: u32 = 0x2000;
        pub(super) const MEM_RESET: u32 = 0x8_0000;
        pub(super) const MEM_RELEASE: u32 = 0x8000;
        pub(super) const PAGE_READWRITE: u32 = 0x04;
        unsafe extern "system" {
            pub(super) fn VirtualAlloc(
                addr: *mut core::ffi::c_void,
                size: usize,
                alloc_type: u32,
                protect: u32,
            ) -> *mut core::ffi::c_void;
            pub(super) fn VirtualFree(
                addr: *mut core::ffi::c_void,
                size: usize,
                free_type: u32,
            ) -> i32;
        }
    }

    #[cfg(all(windows, not(miri)))]
    pub(super) fn map(bytes: usize) -> NonNull<u8> {
        // SAFETY: fresh reserve+commit; kernel32 is always linked.
        let p = unsafe {
            win::VirtualAlloc(
                core::ptr::null_mut(),
                bytes,
                win::MEM_RESERVE | win::MEM_COMMIT,
                win::PAGE_READWRITE,
            )
        };
        bun_core::handle_oom(NonNull::new(p.cast::<u8>()).ok_or(()))
    }

    #[cfg(all(windows, not(miri)))]
    pub(super) fn unmap(base: NonNull<u8>, _bytes: usize) {
        // SAFETY: `base` is exactly one live `map` result (MEM_RELEASE
        // requires size 0 and the original base).
        unsafe { win::VirtualFree(base.as_ptr().cast(), 0, win::MEM_RELEASE) };
    }

    #[cfg(all(windows, not(miri)))]
    pub(super) fn decommit(base: NonNull<u8>, bytes: usize) {
        // MEM_RESET: discardable but still committed+readable (see `win`).
        // SAFETY: `base`/`bytes` are exactly one live `map` result.
        unsafe { win::VirtualAlloc(base.as_ptr().cast(), bytes, win::MEM_RESET, win::PAGE_READWRITE) };
    }

    #[cfg(all(windows, not(miri)))]
    pub(super) fn recommit(_base: NonNull<u8>, _bytes: usize) {
        // MEM_RESET pages revert to normal on the next write; the caller
        // re-stamps every slot meta before use.
    }

    // Miri has no mmap: plain 16-aligned heap chunks; decommit zeroes in
    // place, which models the POSIX zero-page read semantics exactly.
    #[cfg(miri)]
    pub(super) fn map(bytes: usize) -> NonNull<u8> {
        let layout = layout(bytes);
        // SAFETY: `bytes >= CHUNK_BYTES_MIN > 0`.
        bun_core::handle_oom(NonNull::new(unsafe { std::alloc::alloc_zeroed(layout) }).ok_or(()))
    }
    #[cfg(miri)]
    pub(super) fn unmap(base: NonNull<u8>, bytes: usize) {
        // SAFETY: `base`/`bytes` are exactly one live `map` result.
        unsafe { std::alloc::dealloc(base.as_ptr(), layout(bytes)) };
    }
    #[cfg(miri)]
    pub(super) fn decommit(base: NonNull<u8>, bytes: usize) {
        // SAFETY: whole-chunk write; every slot in a decommitting chunk is
        // vacant, so no external borrow overlaps.
        unsafe { core::ptr::write_bytes(base.as_ptr(), 0, bytes) };
    }
    #[cfg(miri)]
    pub(super) fn recommit(_base: NonNull<u8>, _bytes: usize) {}
    #[cfg(miri)]
    fn layout(bytes: usize) -> std::alloc::Layout {
        std::alloc::Layout::from_size_align(bytes, super::SLOT_META_BYTES).expect("chunk layout")
    }
}

#[cfg(test)]
impl<T> ChunkedSlab<T> {
    fn chunk_count(&self) -> usize {
        self.chunks.len()
    }
    fn chunk_committed(&self, cid: u32) -> bool {
        self.chunks[cid as usize].committed
    }
    fn chunk_occupied(&self, cid: u32) -> u32 {
        self.chunks[cid as usize].occupied
    }
    fn chunk_base(&self, cid: u32) -> *mut u8 {
        self.chunks[cid as usize].base.as_ptr()
    }
    fn slots_per_chunk(&mut self, ext_capacity: usize) -> usize {
        let ci = self.class_index(ext_capacity.next_multiple_of(SLOT_META_BYTES));
        self.classes[ci].slots_per_chunk as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn alloc_returns_value_and_odd_generation() {
        let mut slab = ChunkedSlab::<u64>::new();
        let (p, g) = slab.alloc(42);
        assert_eq!(g & 1, 1);
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
        let n = slab.slots_per_chunk(0) * 3 + 5;
        let handles: Vec<_> = (0..n).map(|i| (i, slab.alloc(i))).collect();
        for (i, (p, g)) in &handles {
            // SAFETY: all slots still live; growth must not have moved them.
            assert_eq!(unsafe { *p.as_ref() }, *i);
            assert_eq!(unsafe { ChunkedSlab::generation(*p) }, *g);
        }
        assert_eq!(slab.live_count(), n);
        assert_eq!(slab.chunk_count(), 4);
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
        for cycle in 0..5u64 {
            assert_eq!(unsafe { ChunkedSlab::generation(p) } & 1, 1, "occupied must be odd");
            // SAFETY: p is live at the top of each cycle.
            unsafe { slab.free(p) };
            assert_eq!(unsafe { ChunkedSlab::generation(p) } & 1, 0, "vacant must be even");
            // Generation advances by exactly 2 per free+alloc cycle, so every
            // prior handle mismatches forever (until counter wrap).
            let (p2, g2) = slab.alloc(0);
            assert_eq!(p2, p, "LIFO free list must reuse the slot");
            assert_eq!(g2, g0.wrapping_add(2 * (cycle + 1)));
        }
    }

    #[test]
    fn freed_slots_are_reused_before_growing() {
        let mut slab = ChunkedSlab::<usize>::new();
        let n = slab.slots_per_chunk(0);
        let handles: Vec<_> = (0..n).map(|i| slab.alloc(i).0).collect();
        assert_eq!(slab.chunk_count(), 1);
        for &p in &handles {
            // SAFETY: each handle is live and freed exactly once.
            unsafe { slab.free(p) };
        }
        for i in 0..n {
            let (p, _) = slab.alloc(i);
            assert!(handles.contains(&p), "must reuse freed slots, not grow");
        }
        assert_eq!(slab.chunk_count(), 1, "no growth while free slots exist");
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
        let per = slab.slots_per_chunk(0);
        let mut live = Vec::new();
        for round in 0..4usize {
            for i in 0..per {
                live.push(slab.alloc(vec![round as u8; i % 61]).0);
            }
            for _ in 0..per / 2 {
                let p = live.swap_remove(live.len() / 2);
                // SAFETY: p is live (taken from the live set exactly once).
                unsafe { slab.free(p) };
            }
        }
        assert_eq!(slab.live_count(), live.len());
    }

    // ── size classes / inline ext ────────────────────────────────────────

    #[test]
    fn inline_ext_is_contiguous_aligned_and_zeroed() {
        let mut slab = ChunkedSlab::<u64>::new();
        let (p, _) = slab.alloc_with_ext(1, 40); // rounds up to 48
        let ext = inline_ext_of(p).expect("class carries ext bytes");
        assert_eq!(inline_ext_capacity_of(p), 48);
        // Fixed header+1 projection: ext starts at the 16-rounded value end.
        assert_eq!(
            ext.as_ptr() as usize,
            p.as_ptr() as usize + value_stride::<u64>()
        );
        assert_eq!(ext.as_ptr() as usize % SLOT_META_BYTES, 0);
        // SAFETY: 48 in-slot ext bytes, zeroed by alloc.
        let bytes = unsafe { core::slice::from_raw_parts_mut(ext.as_ptr(), 48) };
        assert!(bytes.iter().all(|&b| b == 0));
        bytes.fill(0xab);
        // Reuse re-zeroes: SAFETY: p is live.
        unsafe { slab.free(p) };
        let (p2, _) = slab.alloc_with_ext(2, 40);
        assert_eq!(p2, p, "LIFO reuse within the class");
        // SAFETY: same slot, same capacity.
        let bytes = unsafe { core::slice::from_raw_parts(inline_ext_of(p2).unwrap().as_ptr(), 48) };
        assert!(bytes.iter().all(|&b| b == 0), "ext must be re-zeroed on reuse");
    }

    #[test]
    fn size_classes_are_segregated_and_word_kind_has_no_ext() {
        let mut slab = ChunkedSlab::<u64>::new();
        let (a, _) = slab.alloc(1);
        let (b, _) = slab.alloc_with_ext(2, 64);
        let (c, _) = slab.alloc_with_ext(3, 64);
        assert!(inline_ext_of(a).is_none());
        assert_eq!(inline_ext_capacity_of(a), 0);
        assert_eq!(inline_ext_capacity_of(b), 64);
        assert_eq!(slab.chunk_count(), 2, "one chunk per class");
        // Neighbors in the 64-byte class are one slot stride apart —
        // ext bytes are inside the slot, not shared.
        let stride = (SLOT_META_BYTES + value_stride::<u64>() + 64) as isize;
        // SAFETY: pointer identity arithmetic only.
        assert_eq!(unsafe { c.as_ptr().cast::<u8>().offset_from(b.as_ptr().cast::<u8>()) }, stride);
        assert_eq!(slab.live_count(), 3);
    }

    // ── decommit reclamation ─────────────────────────────────────────────

    /// Fill exactly one chunk of the 0-ext class; returns its handles.
    fn fill_chunk(slab: &mut ChunkedSlab<usize>) -> Vec<NonNull<usize>> {
        let per = slab.slots_per_chunk(0);
        (0..per).map(|i| slab.alloc(i).0).collect()
    }

    fn drain(slab: &mut ChunkedSlab<usize>, handles: &[NonNull<usize>]) {
        for &p in handles {
            // SAFETY: each handle is live and freed exactly once.
            unsafe { slab.free(p) };
        }
    }

    #[test]
    fn decommit_hysteresis_keeps_most_recently_emptied_chunk() {
        let mut slab = ChunkedSlab::<usize>::new();
        let a = fill_chunk(&mut slab);
        let b = fill_chunk(&mut slab);
        let c = fill_chunk(&mut slab);
        assert_eq!(slab.chunk_count(), 3);

        drain(&mut slab, &a);
        // First emptied chunk: kept committed (nothing to trade against).
        assert!(slab.chunk_committed(0));

        drain(&mut slab, &b);
        // Emptying B decommits A; B is the new hysteresis keeper.
        assert!(!slab.chunk_committed(0));
        assert!(slab.chunk_committed(1));

        drain(&mut slab, &c);
        assert!(!slab.chunk_committed(1));
        assert!(slab.chunk_committed(2));
        assert_eq!(slab.live_count(), 0);

        // Connect/close oscillation at the boundary: alloc+free against the
        // kept chunk must not decommit or grow anything.
        for i in 0..4 {
            let (p, _) = slab.alloc(i);
            // SAFETY: p is live.
            unsafe { slab.free(p) };
        }
        assert!(slab.chunk_committed(2));
        assert_eq!(slab.chunk_count(), 3);
    }

    #[test]
    fn stale_handle_is_safe_and_invalid_after_decommit() {
        let mut slab = ChunkedSlab::<usize>::new();
        let a = fill_chunk(&mut slab);
        let stale: Vec<(NonNull<usize>, u64)> =
            a.iter().map(|&p| (p, generation_of(p))).collect();
        let b = fill_chunk(&mut slab);
        drain(&mut slab, &a);
        drain(&mut slab, &b); // decommits chunk A (hysteresis keeps B)
        assert!(!slab.chunk_committed(0));
        for (p, g) in stale {
            // The probe stays a defined read (mapping intact) and can never
            // validate: decommitted pages read even/zero vs the odd handle.
            let now = generation_of(p);
            assert_ne!(now, g);
            assert_eq!(now & 1, 0);
            #[cfg(any(target_os = "linux", miri))]
            assert_eq!(now, 0, "MADV_DONTNEED reads as zero pages");
        }
    }

    #[test]
    fn counter_wrap_stays_within_its_epoch() {
        // A hot slot's counter wrapping at 2^32 must not carry into the
        // epoch bits (the within-epoch half of the ABA guard).
        let g = (7u64 << EPOCH_SHIFT) | COUNTER_MASK;
        let b = bump_counter(g);
        assert_eq!(b >> EPOCH_SHIFT, 7);
        assert_eq!(b & COUNTER_MASK, 0);
        assert_eq!(bump_counter(b), (7u64 << EPOCH_SHIFT) | 1);
    }

    #[test]
    fn epoch_guards_generation_aba_across_decommit_cycles() {
        let mut slab = ChunkedSlab::<usize>::new();
        let a = fill_chunk(&mut slab);
        // Slot 0 of chunk A: first-ever generation is (epoch 0 << 32) | 1.
        let victim = a[0];
        let stale_gen = generation_of(victim);
        assert_eq!(stale_gen, 1);
        let base_a = slab.chunk_base(0);

        let b = fill_chunk(&mut slab);
        drain(&mut slab, &a);
        drain(&mut slab, &b); // decommit A, epoch 0 → 1
        assert!(!slab.chunk_committed(0));

        // Exhaust B, forcing lazy recommit of A; its first alloc reuses
        // slot 0 — the exact ABA address.
        let per = slab.slots_per_chunk(0);
        let mut held = Vec::new();
        let mut reborn = None;
        for i in 0..per + 1 {
            let (p, g) = slab.alloc(i);
            if p == victim {
                reborn = Some(g);
            }
            held.push(p);
        }
        assert!(slab.chunk_committed(0), "recommit is lazy, on demand");
        assert_eq!(slab.chunk_base(0), base_a, "reservation address is stable");
        let reborn = reborn.expect("recommitted chunk must reuse slot 0 first");
        // Same low counter, different epoch: the packed high bits are the
        // only thing separating cycle N from cycle N+1.
        assert_eq!(reborn & COUNTER_MASK, stale_gen & COUNTER_MASK);
        assert_eq!(reborn >> EPOCH_SHIFT, 1);
        assert_ne!(reborn, stale_gen, "cycle-N handle must not validate in cycle N+1");
        assert_ne!(generation_of(victim), stale_gen);
    }

    #[test]
    fn teardown_releases_every_chunk_mapping() {
        // Full-release-at-teardown (docs/design.md §Slab reclamation): create/destroy cycles must not
        // accumulate reservations — Miri's leak check is the oracle for any
        // chunk (committed, decommitted, or holding a live value) not unmapped.
        for _ in 0..8 {
            let mut slab = ChunkedSlab::<usize>::new();
            let a = fill_chunk(&mut slab);
            let b = fill_chunk(&mut slab);
            drain(&mut slab, &a);
            drain(&mut slab, &b); // chunk A decommitted, B kept (hysteresis)
            let _live = slab.alloc(1); // live slot at Drop
            drop(slab);
        }
    }

    #[test]
    fn decommitted_chunk_returns_to_service_with_working_slots() {
        let mut slab = ChunkedSlab::<usize>::new();
        let a = fill_chunk(&mut slab);
        let b = fill_chunk(&mut slab);
        drain(&mut slab, &a);
        drain(&mut slab, &b);
        assert!(!slab.chunk_committed(0));
        // Fill both chunks again end-to-end: values survive, occupancy right.
        let per = slab.slots_per_chunk(0);
        let all: Vec<_> = (0..2 * per).map(|i| (i, slab.alloc(i).0)).collect();
        assert_eq!(slab.chunk_count(), 2, "reuse, don't grow");
        assert_eq!(slab.chunk_occupied(0) + slab.chunk_occupied(1), 2 * per as u32);
        for (i, p) in &all {
            // SAFETY: all slots live.
            assert_eq!(unsafe { *p.as_ref() }, *i);
        }
    }
}
