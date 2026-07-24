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

#[repr(C)]
pub struct InternalLoopData {
    #[cfg(windows)]
    pub sweep_timer: *mut Timer,
    #[cfg(not(windows))]
    pub sweep_next_tick_ns: i64,
    pub sweep_timer_count: i32,
    pub wakeup_async: *mut us_internal_async,
    pub head: *mut SocketGroup,
    pub quic_head: *mut c_void,
    pub quic_next_tick_us: i64,
    #[cfg(windows)]
    pub quic_timer: *mut Timer,
    pub iterator: *mut SocketGroup,
    pub recv_buf: *mut u8,
    pub send_buf: *mut u8,
    pub ssl_data: *mut c_void,
    pub pre_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub post_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub closed_udp_head: *mut udp::Socket,
    pub closed_head: *mut us_socket_t,
    pub low_prio_head: *mut us_socket_t,
    pub low_prio_budget: i32,
    pub dns_ready_head: *mut ConnectingSocket,
    pub closed_connecting_head: *mut ConnectingSocket,
    /// `bun.Mutex.ReleaseImpl.Type` — must match the C-side `zig_mutex_t`
    /// (`packages/bun-usockets/src/internal/loop_data.h`). `Bun__lock`/`Bun__unlock`
    /// are called on this field by C, and `loop.c` runtime-checks
    /// `Bun__lock__size == sizeof(loop->data.mutex)`. This crate is tier-0 and
    /// cannot name `bun_threading::ReleaseImpl` directly, so use a layout-only
    /// placeholder of the correct size/align per platform.
    pub mutex: LoopDataMutex,
    pub parent_ptr: *mut c_void,
    pub parent_tag: c_char,
    pub iteration_nr: u64,
    // SAFETY: erased `Option<&'static jsc::VM>` — tier-0 crate cannot name jsc types.
    // Higher tier (`bun_runtime`) casts this back when reading.
    pub jsc_vm: *const c_void,
    pub tick_depth: c_int,
}

impl InternalLoopData {
    pub fn should_enable_date_header_timer(&self) -> bool {
        self.sweep_timer_count > 0
    }

    /// Tag values for `parent_tag`: 1 = `jsc::EventLoop`, 2 = `jsc::MiniEventLoop`.
    /// Low tier stores tag+ptr only; the typed `EventLoopHandle` wrapper
    /// (`get_parent`) lives in the higher-tier crate that can name `bun_jsc`.
    #[inline]
    pub fn set_parent_raw(&mut self, tag: c_char, ptr: *mut c_void) {
        self.parent_tag = tag;
        self.parent_ptr = ptr;
    }

    #[inline]
    pub fn get_parent_raw(&self) -> (c_char, *mut c_void) {
        if self.parent_ptr.is_null() {
            panic!("Parent loop not set - pointer is null");
        }
        if self.parent_tag == 0 {
            panic!("Parent loop not set - tag is zero");
        }
        (self.parent_tag, self.parent_ptr)
    }
}
