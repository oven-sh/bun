use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::ptr::NonNull;

#[cfg(windows)]
use crate::Timer;
use crate::{ConnectingSocket, Loop, SocketGroup, udp, us_socket_t};

/// Layout placeholder for the `mutex` field of `us_internal_loop_data_t`.
/// Must match `zig_mutex_t` in `packages/bun-usockets/src/internal/loop_data.h`
/// and `bun_threading::mutex::ReleaseImpl` (which exports `Bun__lock__size`):
///   - Windows: `SRWLOCK` (pointer-sized)
///   - macOS:   `os_unfair_lock` (4-byte u32)
///   - Linux/FreeBSD: futex word (4-byte u32)
/// This crate never locks/unlocks it — C calls `Bun__lock`/`Bun__unlock`
/// (exported from `bun_threading`) on the raw field address.
#[cfg(windows)]
pub(crate) type LoopDataMutex = *mut c_void;
#[cfg(not(windows))]
pub(crate) type LoopDataMutex = u32;

bun_opaque::opaque_ffi! {
    /// Opaque C handle from `us_internal_create_async`.
    pub struct us_internal_async;
}

/// C writes these fields while Rust holds a `&InternalLoopData` (a callback that `us_loop_run`
/// dispatches reaches the loop again), so each is a `Cell`, which has the layout of what it holds.
/// None is `pub`: C follows the pointers, and DNS threads write `dns_ready_head` under `mutex`, so
/// Rust touches neither of those two.
#[repr(C)]
pub struct InternalLoopData {
    #[cfg(windows)]
    sweep_timer: Cell<*mut Timer>,
    #[cfg(not(windows))]
    sweep_next_tick_ns: Cell<i64>,
    sweep_timer_count: Cell<i32>,
    wakeup_async: Cell<*mut us_internal_async>,
    head: Cell<*mut SocketGroup>,
    pub(crate) quic_head: Cell<*mut c_void>,
    quic_next_tick_us: Cell<i64>,
    /// `us_nq_driver_s *` — node:quic's loop driver list.
    pub(crate) nq_head: Cell<*mut c_void>,
    #[cfg(windows)]
    quic_timer: Cell<*mut Timer>,
    iterator: Cell<*mut SocketGroup>,
    recv_buf: Cell<*mut u8>,
    send_buf: Cell<*mut u8>,
    ssl_data: Cell<*mut c_void>,
    pre_cb: Cell<Option<unsafe extern "C" fn(*mut Loop)>>,
    post_cb: Cell<Option<unsafe extern "C" fn(*mut Loop)>>,
    closed_udp_head: Cell<*mut udp::Socket>,
    closed_head: Cell<*mut us_socket_t>,
    low_prio_head: Cell<*mut us_socket_t>,
    low_prio_iterator: Cell<*mut us_socket_t>,
    low_prio_budget: Cell<i32>,
    dns_ready_head: Cell<*mut ConnectingSocket>,
    closed_connecting_head: Cell<*mut ConnectingSocket>,
    /// `bun.Mutex.ReleaseImpl.Type` — must match the C-side `zig_mutex_t`
    /// (`packages/bun-usockets/src/internal/loop_data.h`). `Bun__lock`/`Bun__unlock`
    /// are called on this field by C, and `loop.c` runtime-checks
    /// `Bun__lock__size == sizeof(loop->data.mutex)`. This crate is tier-0 and
    /// cannot name `bun_threading::ReleaseImpl` directly, so use a layout-only
    /// placeholder of the correct size/align per platform.
    mutex: Cell<LoopDataMutex>,
    parent_ptr: Cell<*mut c_void>,
    parent_tag: Cell<c_char>,
    pub(crate) iteration_nr: Cell<u64>,
    /// Erased `JSC::VM*`: this crate cannot name jsc types.
    jsc_vm: Cell<*const c_void>,
    tick_depth: Cell<c_int>,
    num_unresumable_sockets: Cell<c_int>,
    /// `us_internal_unresumable_socket_t *`. Only `loop.c` reads or frees this list.
    unresumable_sockets: Cell<*mut c_void>,
}

impl InternalLoopData {
    pub(crate) fn should_enable_date_header_timer(&self) -> bool {
        self.sweep_timer_count.get() > 0
    }

    /// When the HTTP/3 contexts on this loop next need a tick; `None` if there are none.
    #[inline]
    pub fn quic_next_tick_us(&self) -> Option<i64> {
        if self.quic_head.get().is_null() {
            None
        } else {
            Some(self.quic_next_tick_us.get())
        }
    }

    /// The `JSC::VM*` that a tick of this loop tells when it is about to wait.
    ///
    /// # Safety
    /// Null, or a `JSC::VM` that is live at every tick of the loop until this is set again.
    #[inline]
    pub unsafe fn set_jsc_vm(&self, jsc_vm: *const c_void) {
        self.jsc_vm.set(jsc_vm);
    }

    /// The first group linked into the loop; [`SocketGroup::next`] is the one after a group.
    #[inline]
    pub fn first_group(&self) -> *mut SocketGroup {
        self.head.get()
    }

    /// Starts a walk over the linked groups that survives what a close handler does to them:
    /// unlinking a group moves the walk past it, and one that gets linked goes behind it.
    #[inline]
    pub fn start_group_walk(&self) {
        self.iterator.set(self.head.get());
    }

    /// The next group of the walk. It is linked, so live until a close handler unlinks it.
    #[inline]
    pub fn next_group_of_walk(&self) -> Option<NonNull<SocketGroup>> {
        let group = NonNull::new(self.iterator.get())?;
        // SAFETY: `iterator` is null or a linked group: see `start_group_walk`.
        self.iterator.set(unsafe { group.as_ref() }.next());
        Some(group)
    }

    /// Tag values for `parent_tag`: 1 = `jsc::EventLoop`, 2 = `jsc::MiniEventLoop`.
    /// Low tier stores tag+ptr only; the typed `EventLoopHandle` wrapper
    /// (`get_parent`) lives in the higher-tier crate that can name `bun_jsc`.
    #[inline]
    pub fn set_parent_raw(&self, tag: c_char, ptr: *mut c_void) {
        self.parent_tag.set(tag);
        self.parent_ptr.set(ptr);
    }

    #[inline]
    pub fn get_parent_raw(&self) -> (c_char, *mut c_void) {
        if self.parent_ptr.get().is_null() {
            panic!("Parent loop not set - pointer is null");
        }
        if self.parent_tag.get() == 0 {
            panic!("Parent loop not set - tag is zero");
        }
        (self.parent_tag.get(), self.parent_ptr.get())
    }
}
