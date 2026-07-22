//! SocketGroup (#[repr(C)], embedded by value in C++), lazy loop link/unlink.
//!
//! Safe-core port of the group bookkeeping in `context.rs`. All mutable state
//! is `Cell`-wrapped so callbacks fired from a timer sweep may re-enter and
//! close/adopt sockets while the caller holds only `&SocketGroup`.

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::{align_of, offset_of, size_of};
use core::ptr::{self, NonNull};

use crate::core::connecting::ConnectingSocket;
use crate::core::list::{IntrusiveList, Linked, ListLinks, Sweep};
use crate::core::listen::ListenSocket;
use crate::core::loop_::Loop;
use crate::core::socket::SocketHeader;
use crate::types::{us_socket_group_t, us_socket_vtable_t};

// Loop-side bookkeeping still lives behind `extern "C"` in `loop_core.rs`;
// called through these shims until `core::loop_` grows safe equivalents.
unsafe extern "C" {
    fn us_internal_loop_link_group(loop_: *mut Loop, group: *mut us_socket_group_t);
    fn us_internal_loop_unlink_group(loop_: *mut Loop, group: *mut us_socket_group_t);
    fn us_internal_enable_sweep_timer(loop_: *mut Loop);
    fn us_internal_disable_sweep_timer(loop_: *mut Loop);
}

/// `us_socket_group_t` — the set of open / connecting / listening sockets that
/// share a dispatch vtable and sweep-timer bucket.
///
/// **ABI-locked**: C++ (`HttpContext`, `WebSocketContext`) embeds this struct
/// *by value*, so field order, size and alignment must match
/// `packages/bun-usockets/src/libusockets.h` exactly. The const-assert block
/// below enforces this.
#[repr(C)]
pub struct SocketGroup {
    pub(crate) loop_: Cell<Option<NonNull<Loop>>>,
    pub(crate) vtable: Cell<*const us_socket_vtable_t>,
    pub(crate) ext: Cell<*mut c_void>,
    pub(crate) sockets: IntrusiveList<SocketHeader>,
    pub(crate) connecting: IntrusiveList<ConnectingSocket>,
    pub(crate) listeners: IntrusiveList<ListenSocket>,
    /// External sweep cursor for [`Self::sweep_sockets`]; advanced by
    /// [`Self::unlink_socket`] so closing a socket mid-sweep never strands it.
    pub(crate) iterator: Cell<Option<NonNull<SocketHeader>>>,
    pub(crate) links: ListLinks<SocketGroup>,
    pub(crate) global_tick: Cell<u32>,
    /// Sockets parked in `loop.data.low_prio_head` with `s.group == self`.
    /// They are *not* in [`Self::sockets`] while queued; `close_all`/`deinit`
    /// must account for them separately.
    pub(crate) low_prio_count: Cell<u16>,
    pub(crate) timestamp: Cell<u8>,
    pub(crate) long_timestamp: Cell<u8>,
    pub(crate) linked: Cell<u8>,
}

// SAFETY: `links` is a `ListLinks<Self>` embedded in every `SocketGroup` and
// used by exactly one list (`Loop::groups`); it lives as long as `*p`.
unsafe impl Linked for SocketGroup {
    #[inline]
    fn links(p: NonNull<Self>) -> NonNull<ListLinks<Self>> {
        // SAFETY: field projection into live `*p`.
        unsafe { NonNull::new_unchecked(ptr::addr_of_mut!((*p.as_ptr()).links)) }
    }
}

impl SocketGroup {
    /// Build a fresh, unlinked, empty group.
    #[inline]
    pub const fn new(
        loop_: NonNull<Loop>,
        vtable: *const us_socket_vtable_t,
        ext: *mut c_void,
    ) -> Self {
        Self {
            loop_: Cell::new(Some(loop_)),
            vtable: Cell::new(vtable),
            ext: Cell::new(ext),
            sockets: IntrusiveList::new(),
            connecting: IntrusiveList::new(),
            listeners: IntrusiveList::new(),
            iterator: Cell::new(None),
            links: ListLinks::new(),
            global_tick: Cell::new(0),
            low_prio_count: Cell::new(0),
            timestamp: Cell::new(0),
            long_timestamp: Cell::new(0),
            linked: Cell::new(0),
        }
    }

    /// Write a fresh group into possibly-uninitialised embedding storage.
    /// Does **not** link into the loop — that happens lazily on first socket.
    ///
    /// # Safety
    /// `this` must be valid for a write of `size_of::<Self>()` bytes and
    /// suitably aligned. The old contents are overwritten without being read.
    #[inline]
    pub unsafe fn init(
        this: NonNull<Self>,
        loop_: NonNull<Loop>,
        vtable: *const us_socket_vtable_t,
        ext: *mut c_void,
    ) {
        // SAFETY: caller contract above.
        unsafe { this.as_ptr().write(Self::new(loop_, vtable, ext)) };
    }

    /// Unlink from the loop and assert every list is drained. The owner is
    /// about to free the embedding storage; any surviving socket with
    /// `s.group == self` would be a UAF the caller must `close_all()` first.
    pub fn deinit(&self) {
        debug_assert!(self.sockets.is_empty());
        debug_assert!(self.connecting.is_empty());
        debug_assert!(self.listeners.is_empty());
        debug_assert_eq!(self.low_prio_count.get(), 0);
        debug_assert!(self.iterator.get().is_none());
        if self.linked.get() != 0 {
            // SAFETY: `loop_` outlives every group it links; `self` is live.
            unsafe { us_internal_loop_unlink_group(self.loop_().as_ptr(), self.as_c_ptr()) };
            self.linked.set(0);
        }
    }

    /// `*mut us_socket_group_t` view of `self` for the `extern "C"` shims.
    /// Sound because the ABI const-assert below proves layout identity.
    #[inline(always)]
    fn as_c_ptr(&self) -> *mut us_socket_group_t {
        NonNull::from(self).as_ptr().cast()
    }

    /// The owning loop. Set once in [`Self::init`], never cleared while live.
    #[inline]
    pub fn loop_(&self) -> NonNull<Loop> {
        debug_assert!(self.loop_.get().is_some());
        // SAFETY: invariant established by `init`; see debug_assert above.
        unsafe { self.loop_.get().unwrap_unchecked() }
    }

    #[inline]
    pub fn ext(&self) -> *mut c_void {
        self.ext.get()
    }

    #[inline]
    pub fn vtable(&self) -> *const us_socket_vtable_t {
        self.vtable.get()
    }

    /// True when no socket (open, connecting, listening, or parked low-prio)
    /// references this group.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.sockets.is_empty()
            && self.connecting.is_empty()
            && self.listeners.is_empty()
            && self.low_prio_count.get() == 0
    }

    /// Lazily link into the loop's group list on first membership.
    #[inline]
    fn touched(&self) {
        if self.linked.get() == 0 {
            // SAFETY: `loop_` outlives every group it links; `self` is live.
            unsafe { us_internal_loop_link_group(self.loop_().as_ptr(), self.as_c_ptr()) };
            self.linked.set(1);
        }
    }

    /// Drop out of the loop's group list once the last member is gone, so an
    /// idle embedded group costs nothing per tick.
    #[inline]
    pub fn maybe_unlink_from_loop(&self) {
        if self.linked.get() != 0 && self.is_empty() {
            // SAFETY: `loop_` outlives every group it links; `self` is live.
            unsafe { us_internal_loop_unlink_group(self.loop_().as_ptr(), self.as_c_ptr()) };
            self.linked.set(0);
        }
    }

    /// Push `s` onto the open-socket list, point its group back-reference at
    /// `self`, and ensure the group is linked into the loop's sweep.
    pub fn link_socket(&self, s: NonNull<SocketHeader>) {
        // SAFETY: `s` is live for the call; `group` is a `Cell` so shared write is sound.
        unsafe { s.as_ref() }.group.set(Some(NonNull::from(self)));
        self.sockets.push_front(s);
        self.touched();
        // SAFETY: `loop_` outlives every group it links.
        unsafe { us_internal_enable_sweep_timer(self.loop_().as_ptr()) };
    }

    /// Remove `s` from the open-socket list, keeping any in-flight sweep
    /// cursor valid, and lazily unlink the group from the loop if now empty.
    pub fn unlink_socket(&self, s: NonNull<SocketHeader>) {
        self.sockets.advance_cursor(&self.iterator, s);
        self.sockets.remove(s);
        // SAFETY: `loop_` outlives every group it links.
        unsafe { us_internal_disable_sweep_timer(self.loop_().as_ptr()) };
        self.maybe_unlink_from_loop();
    }

    /// Removal-tolerant iteration over [`Self::sockets`] using
    /// [`Self::iterator`] as the external cursor. Closing the yielded socket
    /// (or any other) during dispatch is safe: [`Self::unlink_socket`] advances
    /// the cursor before removal.
    #[inline]
    pub fn sweep_sockets(&self) -> Sweep<'_, SocketHeader> {
        self.sockets.iter(&self.iterator)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ABI lock: `SocketGroup` ≡ `struct us_socket_group_t` (libusockets.h:270).
// C++ embeds this by value, so any drift is an immediate layout bug.
// ───────────────────────────────────────────────────────────────────────────
const _: () = {
    let p = size_of::<*mut ()>();
    // 9 pointer-width fields + u32 + u16 + 3×u8, rounded to pointer alignment.
    let raw = 9 * p + 4 + 2 + 1 + 1 + 1;
    let c_sizeof = raw.next_multiple_of(p);
    assert!(size_of::<SocketGroup>() == c_sizeof);
    assert!(size_of::<SocketGroup>() == size_of::<us_socket_group_t>());
    assert!(align_of::<SocketGroup>() == align_of::<us_socket_group_t>());
    assert!(align_of::<SocketGroup>() == p);
    // Fields C++ dereferences directly (`->loop`, `->head_sockets`).
    assert!(offset_of!(SocketGroup, loop_) == 0);
    assert!(offset_of!(SocketGroup, sockets) == 3 * p);
    assert!(offset_of!(SocketGroup, links) == 7 * p);
    assert!(offset_of!(SocketGroup, global_tick) == 9 * p);
};
