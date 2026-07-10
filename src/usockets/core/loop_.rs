//! Loop, LoopData, LoopTick<'a>, timer sweep, free_closed, low-prio queue.
//!
//! `LoopData` is the safe-field mirror of `us_internal_loop_data_t`: every
//! mutable field is `Cell<>` so a re-entrant callback holding `&LoopData` may
//! mutate any of it (close a socket, relink a group, bump `iteration_nr`)
//! without taking `&mut`. `#[repr(C)]` keeps it layout-identical to the C
//! struct so the `extern "C"` shims can cast freely; `IntrusiveList<T>` and
//! `Cell<Option<NonNull<T>>>` are each pointer-sized and occupy the same slot
//! as the raw `*mut T` they replace.
//!
//! `Loop` stays the per-backend `us_loop_t` for now — it is opaque to C++ and
//! every backend places `data` at offset 0, so `&*loop_.cast::<LoopData>()` is
//! the sole unsafe step `LoopTick` needs.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_longlong, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

#[cfg(windows)]
use crate::types::us_timer_t;
use crate::types::{
    LIBUS_RECV_BUFFER_LENGTH, LIBUS_RECV_BUFFER_PADDING, us_connecting_socket_t, us_internal_async,
    us_internal_loop_data_t, us_quic_socket_context_s, us_udp_socket_t, zig_mutex_t,
};

use super::group::SocketGroup;
use super::list::IntrusiveList;
use super::socket::SocketHeader;

// ═══════════════════════════════════════════════════════════════════════════
// Loop — opaque to C++; per-backend `us_loop_t` with `data` at offset 0.
// ═══════════════════════════════════════════════════════════════════════════

pub use crate::eventing::us_loop_t as Loop;

/// `extern "C" fn(*mut us_loop_t)` — the `pre_cb`/`post_cb`/wakeup shape.
pub type LoopCb = unsafe extern "C" fn(*mut Loop);

/// Total allocation backing `recv_buf`: payload plus 32-byte guard at each end.
pub const RECV_BUF_LEN: usize = LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2;

// ═══════════════════════════════════════════════════════════════════════════
// LoopData — `us_internal_loop_data_t` with interior-mutable fields
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct LoopData {
    #[cfg(windows)]
    pub(crate) sweep_timer: Cell<Option<NonNull<us_timer_t>>>,
    /// Monotonic-ns deadline of the next sweep, or `-1` for disarmed. Folded
    /// into the poll-wait timeout on POSIX instead of a kernel timer.
    #[cfg(not(windows))]
    pub(crate) sweep_next_tick_ns: Cell<c_longlong>,
    pub(crate) sweep_timer_count: Cell<c_int>,
    pub(crate) wakeup_async: Cell<Option<NonNull<us_internal_async>>>,
    /// All `SocketGroup`s on this loop; sweep/close-all walk this.
    pub(crate) head: IntrusiveList<SocketGroup>,
    pub(crate) quic_head: Cell<Option<NonNull<us_quic_socket_context_s>>>,
    pub(crate) quic_next_tick_us: Cell<c_longlong>,
    #[cfg(windows)]
    pub(crate) quic_timer: Cell<Option<NonNull<us_timer_t>>>,
    /// External sweep cursor for [`head`]; `us_internal_loop_unlink_group`
    /// advances it when the node it points at is unlinked mid-sweep.
    pub(crate) iterator: Cell<Option<NonNull<SocketGroup>>>,
    pub(crate) recv_buf: Cell<*mut u8>,
    pub(crate) send_buf: Cell<*mut u8>,
    pub(crate) ssl_data: Cell<*mut c_void>,
    pub(crate) pre_cb: Cell<Option<LoopCb>>,
    pub(crate) post_cb: Cell<Option<LoopCb>>,
    pub(crate) closed_udp_head: Cell<Option<NonNull<us_udp_socket_t>>>,
    /// Sockets closed this tick; freed by `free_closed` at the outermost tick.
    pub(crate) closed_head: IntrusiveList<SocketHeader>,
    /// Back-pressured sockets deferred to the next pre-tick budget.
    pub(crate) low_prio_head: IntrusiveList<SocketHeader>,
    pub(crate) low_prio_budget: Cell<c_int>,
    pub(crate) dns_ready_head: Cell<Option<NonNull<us_connecting_socket_t>>>,
    pub(crate) closed_connecting_head: Cell<Option<NonNull<us_connecting_socket_t>>>,
    /// Guards `dns_ready_head` — the only field written off the loop thread.
    pub(crate) mutex: Cell<zig_mutex_t>,
    pub(crate) parent_ptr: Cell<*mut c_void>,
    pub(crate) parent_tag: Cell<c_char>,
    pub(crate) iteration_nr: Cell<usize>,
    pub(crate) jsc_vm: Cell<*mut c_void>,
    /// Reentrancy depth of `us_loop_run_bun_tick`; `free_closed` only runs at 1.
    pub(crate) tick_depth: Cell<c_int>,
}

/// `Cell<T>` is `repr(transparent)`, `Option<NonNull<T>>`/`Option<fn>` are
/// pointer-niche, and `IntrusiveList<T>` is a single pointer-sized `Cell` — so
/// every field occupies the exact slot of its C counterpart.
const _: () = {
    assert!(core::mem::size_of::<LoopData>() == core::mem::size_of::<us_internal_loop_data_t>());
    assert!(core::mem::align_of::<LoopData>() == core::mem::align_of::<us_internal_loop_data_t>());
};

// ═══════════════════════════════════════════════════════════════════════════
// LoopTick<'a> — shared borrow of the loop for one dispatch tick
// ═══════════════════════════════════════════════════════════════════════════

/// Copyable handle to the running loop, valid for the lifetime `'a` of a single
/// poll-dispatch tick. All accessors return `&'a` into interior-mutable state,
/// so callers may freely re-enter (close sockets, relink groups) while holding
/// one — the aliasing model is `&Cell`, never `&mut`.
#[derive(Clone, Copy)]
pub struct LoopTick<'a> {
    pub loop_: NonNull<Loop>,
    _marker: PhantomData<&'a ()>,
}

impl<'a> LoopTick<'a> {
    /// Bind a tick to `loop_`.
    ///
    /// # Safety
    /// `loop_` must be live and its `data` initialised for all of `'a`, and the
    /// call must be on the loop's own thread.
    #[inline]
    pub unsafe fn new(loop_: NonNull<Loop>) -> Self {
        Self {
            loop_,
            _marker: PhantomData,
        }
    }

    /// The per-loop state block. Every backend's `us_loop_t` places `data` at
    /// offset 0 and `LoopData` is layout-identical to it, so this is a cast.
    #[inline]
    pub fn data(self) -> &'a LoopData {
        // SAFETY: `new`'s contract guarantees `loop_` is live for `'a`; `data`
        // is the first field of every `us_loop_t` variant and the const-assert
        // above proves `LoopData` has the C layout.
        unsafe { self.loop_.cast::<LoopData>().as_ref() }
    }

    /// The loop-shared receive buffer (payload + both 32-byte pads) as an
    /// interior-mutable byte array. Dispatch writes into it via `.as_ptr()`
    /// and hands a sub-slice to `on_data`.
    #[inline]
    pub fn recv_buf(self) -> &'a Cell<[u8; RECV_BUF_LEN]> {
        // SAFETY: `recv_buf` is a `RECV_BUF_LEN`-byte libc allocation installed
        // by `us_internal_loop_data_init` (OOM aborts there) and freed only in
        // `us_internal_loop_data_free`, which cannot run while a `LoopTick`
        // exists. `Cell` is `repr(transparent)` over `[u8; N]`.
        unsafe {
            &*self
                .data()
                .recv_buf
                .get()
                .cast::<Cell<[u8; RECV_BUF_LEN]>>()
        }
    }

    /// Raw `*mut us_loop_t` for calling into the still-`extern "C"` helpers.
    #[inline]
    pub fn as_ptr(self) -> *mut Loop {
        self.loop_.as_ptr()
    }
}
