use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};

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

/// Every field is a `Cell`: C writes them while Rust holds a `&Loop`. The private ones are layout
/// only. Other threads write `dns_ready_head` (under `mutex`), so Rust never reads it.
#[repr(C)]
pub struct InternalLoopData {
    #[cfg(windows)]
    sweep_timer: Cell<*mut Timer>,
    #[cfg(not(windows))]
    sweep_next_tick_ns: Cell<i64>,
    sweep_timer_count: Cell<i32>,
    wakeup_async: Cell<*mut us_internal_async>,
    pub head: Cell<*mut SocketGroup>,
    pub quic_head: Cell<*mut c_void>,
    pub quic_next_tick_us: Cell<i64>,
    /// `us_nq_driver_s *` — node:quic's loop driver list.
    pub(crate) nq_head: Cell<*mut c_void>,
    #[cfg(windows)]
    quic_timer: Cell<*mut Timer>,
    pub iterator: Cell<*mut SocketGroup>,
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
    pub(crate) parent_ptr: Cell<*mut c_void>,
    pub(crate) parent_tag: Cell<c_char>,
    pub(crate) iteration_nr: Cell<u64>,
    // SAFETY: erased `Option<&'static jsc::VM>` — tier-0 crate cannot name jsc types.
    // Higher tier (`bun_runtime`) casts this back when reading.
    pub jsc_vm: Cell<*const c_void>,
    tick_depth: Cell<c_int>,
    num_unresumable_sockets: Cell<c_int>,
    /// `us_internal_unresumable_socket_t *`. Only `loop.c` reads or frees this list.
    unresumable_sockets: Cell<*mut c_void>,
}

impl InternalLoopData {
    pub(crate) fn should_enable_date_header_timer(&self) -> bool {
        self.sweep_timer_count.get() > 0
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
        let (tag, ptr) = (self.parent_tag.get(), self.parent_ptr.get());
        if ptr.is_null() {
            panic!("Parent loop not set - pointer is null");
        }
        if tag == 0 {
            panic!("Parent loop not set - tag is zero");
        }
        (tag, ptr)
    }
}
