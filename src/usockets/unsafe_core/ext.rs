//! Kind-tag-checked ext downcast — the single funnel (`downcast_raw`, plus
//! the reference-forming `downcast` wrapper) for typed `us_socket_t::ext<T>()`
//! / handler trampoline access (docs/design.md §Crate layout). Storage class is
//! decided by `dispatch::uses_group_vtable`:
//! group-vtable kinds (uWS/Dynamic) use the slab slot's INLINE ext area,
//! contiguous after the header and sized by the family-max ext size at
//! creation; static-kind Rust sockets store ext IN the 8-byte word.

use core::marker::PhantomData;
use core::ptr::NonNull;

use crate::socket::SocketHeader;
use crate::unsafe_core::slab;

/// Per-use ext access token handed to `Handler` callbacks. Holds only a raw
/// pointer derived from the header's raw chain — every deref is a reborrow
/// scoped to a single `with` call, so C17-legal synchronous re-entry
/// (close/write/adopt from inside a callback, which reborrows the header via
/// `header_mut` and re-downcasts ext in nested dispatch) never overlaps a
/// live `&mut` to the same storage.
pub struct ExtMut<'a, T> {
    ptr: NonNull<T>,
    _frame: PhantomData<&'a mut T>,
}

impl<T> ExtMut<'_, T> {
    pub(crate) fn new(ptr: NonNull<T>) -> Self {
        Self {
            ptr,
            _frame: PhantomData,
        }
    }

    /// Run `f` on the ext under a borrow scoped to `f` alone. Invariant: `f`
    /// must not re-enter dispatch on the same socket — re-entrant calls
    /// (close/adopt/write) are legal only outside `with` (C17).
    pub fn with<R>(&mut self, f: impl FnOnce(&mut T) -> R) -> R {
        // SAFETY: `ptr` is live ext storage for the whole callback frame
        // (deferred free, C6); exclusive during `f` per the invariant above.
        f(unsafe { self.ptr.as_mut() })
    }

    /// Raw storage pointer, for identity checks / unsafe_core-side plumbing.
    pub fn as_ptr(&self) -> NonNull<T> {
        self.ptr
    }
}

/// Compute the typed ext storage pointer. Kind-checked, mirroring
/// `socket::alloc`'s storage rule: group-vtable kinds (uWS/Dynamic) use the
/// slot's inline ext area (fixed header+1 projection, LIBUS_EXT_ALIGNMENT-
/// aligned); static-kind Rust sockets use the header word itself (so `T`
/// must fit a pointer word — the vtable generator const-asserts this per
/// handler). Forms NO reference: callers reborrow per use (`ExtMut::with`)
/// so re-entrant dispatch never aliases a live `&mut`.
///
/// # Safety
/// `s` must be a live slab-resident header whose ext storage was sized for
/// `T` at creation (only debug size/align asserts back this up).
pub(crate) unsafe fn downcast_raw<T>(s: *mut SocketHeader) -> NonNull<T> {
    // SAFETY: caller guarantees `s` is a live slab-resident header.
    let kind = unsafe { (*s).kind };
    debug_assert!(
        !matches!(kind, crate::kind::SocketKind::Invalid),
        "ext read on kind=invalid socket"
    );
    let storage: *mut T = if crate::dispatch::uses_group_vtable(kind) {
        debug_assert!(
            core::mem::align_of::<T>() <= crate::LIBUS_EXT_ALIGNMENT,
            "inline ext area type over-aligned"
        );
        // SAFETY: `s` is a live slab slot (caller contract).
        let nn = unsafe { NonNull::new_unchecked(s) };
        debug_assert!(
            core::mem::size_of::<T>() <= slab::inline_ext_capacity_of(nn) as usize,
            "typed ext read exceeds the slot's inline ext capacity"
        );
        match slab::inline_ext_of(nn) {
            Some(area) => area.as_ptr().cast::<T>(),
            // Capacity-0 slot (e.g. a group-vtable connect attempt whose ext
            // word was copied from the connecting socket): the word is the
            // area pointer, matching the pre-inline storage rule.
            None => {
                // SAFETY: caller guarantees `s` is live; plain field read.
                let area = unsafe { (*s).ext };
                debug_assert!(
                    !area.is_null(),
                    "typed ext read on a group-vtable socket created with socket_ext_size 0"
                );
                area.cast::<T>()
            }
        }
    } else {
        debug_assert!(
            core::mem::size_of::<T>() <= core::mem::size_of::<*mut core::ffi::c_void>()
                && core::mem::align_of::<T>() <= core::mem::align_of::<*mut core::ffi::c_void>(),
            "Rust-kind ext type does not fit the 8-byte ext word"
        );
        // SAFETY: caller guarantees `s` is a live header; this is a raw place
        // projection to the ext word, no reference is formed.
        unsafe { &raw mut (*s).ext }.cast::<T>()
    };
    // SAFETY: the word branch is a field address of a non-null header; the
    // area branch is the creation-time allocation (debug-asserted non-null).
    unsafe { NonNull::new_unchecked(storage) }
}

/// Reference-forming wrapper over [`downcast_raw`] — the funnel for
/// `us_socket_t::ext<T>()`-style typed access outside the trampolines.
///
/// # Safety
/// [`downcast_raw`]'s contract, plus: the returned borrow must not outlive
/// the current callback frame nor overlap another `&mut` to the same ext.
pub unsafe fn downcast<'a, T>(s: *mut SocketHeader) -> &'a mut T {
    // SAFETY: forwarded caller contract; exclusivity per the doc above.
    unsafe { downcast_raw::<T>(s).as_mut() }
}

/// Deref an owner-word snapshot; `None` (created-but-not-yet-stamped window)
/// is a no-op. Funnel for `handle::ExtSlot::owner_mut` — the invariant that
/// the stamped owner is live and unaliased is ExtSlot's non-re-entrancy
/// contract.
pub(crate) fn owner_mut<'a, T>(slot: Option<NonNull<T>>) -> Option<&'a mut T> {
    // SAFETY: the consumer stamped a live owner into the slot and ExtSlot's
    // contract forbids an overlapping `&mut T` while the borrow lives.
    slot.map(|mut p| unsafe { p.as_mut() })
}

/// Reborrow a live slab-resident header (slab memory never unmapped while
/// the loop lives, docs/design.md §Strategy 2); the borrow ends before any re-entrant
/// `&mut` to the same slot (C17). The reborrow covers the `ext` word — sound
/// because trampolines never hold an ext borrow across a handler call: every
/// ext deref is a per-use `ExtMut::with` scope over `downcast_raw`'s pointer.
pub(crate) fn header_mut<'a>(s: *mut SocketHeader) -> &'a mut SocketHeader {
    debug_assert!(!s.is_null());
    // SAFETY: per the invariant above — slab slots are never freed mid-tick.
    unsafe { &mut *s }
}

/// Reborrow non-header crate-reachable storage (embedded `SocketGroup`,
/// `Loop`, connecting slab slot, leaked listener box) for the current call
/// frame. Invariant: `p` is non-null and live, and the borrow ends before any
/// re-entrant call that derives another `&mut` to the same object (C17).
pub(crate) fn deref_mut<'a, T>(p: *mut T) -> &'a mut T {
    debug_assert!(!p.is_null());
    // SAFETY: per the invariant above — same contract as `header_mut`.
    unsafe { &mut *p }
}

/// Inline ext pointer for a freshly allocated group-vtable socket slot, or
/// null when the slot's class carries no ext bytes. `socket::alloc` stamps
/// this into the header's `ext` word (docs/design.md §Strategy 3, inline form).
pub(crate) fn inline_ext_ptr(s: *mut SocketHeader) -> *mut core::ffi::c_void {
    debug_assert!(!s.is_null());
    // SAFETY: `s` is a live slab slot (only called on just-allocated slots).
    let nn = unsafe { NonNull::new_unchecked(s) };
    slab::inline_ext_of(nn).map_or(core::ptr::null_mut(), |p| p.as_ptr().cast())
}

/// Reclaim + drop a `Box<T>` previously leaked via `Box::into_raw` /
/// `bun_core::heap::into_raw`. Invariant: dropped exactly once, unborrowed.
pub(crate) fn drop_box<T>(p: *mut T) {
    debug_assert!(!p.is_null());
    // SAFETY: per the invariant above; same allocator (Box).
    drop(unsafe { Box::from_raw(p) });
}

/// `(ptr, len)` → `&[u8]`; null/0 → empty (trampoline input lowering).
///
/// # Safety
/// When non-null, `ptr` must be valid for `len` bytes for the duration of
/// the borrow.
pub(crate) unsafe fn c_slice<'a>(ptr: *mut u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        return &[];
    }
    // SAFETY: caller guarantees `ptr[0..len]` is readable.
    unsafe { core::slice::from_raw_parts(ptr, len) }
}

/// Mutable variant of [`c_slice`] (recv_buf views handed to Protocol v2
/// `on_data`, writable for in-place unmasking).
///
/// # Safety
/// When non-null, `ptr` must be valid for `len` bytes of exclusive access for
/// the duration of the borrow.
pub(crate) unsafe fn c_slice_mut<'a>(ptr: *mut u8, len: usize) -> &'a mut [u8] {
    if ptr.is_null() || len == 0 {
        return &mut [];
    }
    // SAFETY: caller guarantees `ptr[0..len]` is exclusively writable.
    unsafe { core::slice::from_raw_parts_mut(ptr, len) }
}

/// Raw ext storage pointer (same rule as [`downcast_raw`] / `SocketHeader::
/// ext_ptr`): group-vtable kinds get the slot's inline ext area (fixed
/// header+1 projection; capacity-0 slots fall back to the ext word's value),
/// static Rust kinds project the 8-byte ext word itself. Forms NO `&mut
/// SocketHeader`, so the pointer survives later header reborrows (C17 —
/// consumers hold it across dispatch).
pub(crate) fn ext_ptr_raw(s: *mut SocketHeader) -> *mut u8 {
    debug_assert!(!s.is_null());
    // SAFETY: live slab-resident header (slab mappings never unmapped while
    // the loop lives); raw place projections only, no reference formed.
    unsafe {
        if crate::dispatch::uses_group_vtable((*s).kind) {
            match slab::inline_ext_of(NonNull::new_unchecked(s)) {
                Some(area) => area.as_ptr(),
                None => (*s).ext.cast(),
            }
        } else {
            (&raw mut (*s).ext).cast()
        }
    }
}
