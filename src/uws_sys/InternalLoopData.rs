use core::ffi::{c_char, c_int, c_void};

use crate::{udp, us_socket_t, ConnectingSocket, Loop, SocketGroup, Timer};

/// Opaque C handle from `us_internal_create_async`.
#[repr(C)]
pub struct us_internal_async {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

#[repr(C)]
pub struct InternalLoopData {
    pub sweep_timer: *mut Timer,
    pub sweep_timer_count: i32,
    pub wakeup_async: *mut us_internal_async,
    pub head: *mut SocketGroup,
    pub quic_head: *mut c_void,
    pub quic_next_tick_us: i64,
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
    // FORWARD_DECL(b0): was `bun_threading::Mutex` (tier 2). `bun.Mutex.ReleaseImpl.Type`
    // C layout must match; verify size/align with static assert in Phase B.
    pub mutex: bun_core::Mutex,
    pub parent_ptr: *mut c_void,
    pub parent_tag: c_char,
    pub iteration_nr: usize,
    // SAFETY: erased `Option<&'static jsc::VM>` — tier-0 crate cannot name jsc types.
    // Higher tier (`bun_runtime`) casts this back when reading.
    pub jsc_vm: *const c_void,
    pub tick_depth: c_int,
}

impl InternalLoopData {
    const LIBUS_RECV_BUFFER_LENGTH: usize = 524288;

    pub fn recv_slice(&mut self) -> &mut [u8] {
        // SAFETY: `recv_buf` is malloc'd by C `us_internal_loop_data_init` with at least
        // LIBUS_RECV_BUFFER_LENGTH bytes and lives as long as the loop.
        unsafe { core::slice::from_raw_parts_mut(self.recv_buf, Self::LIBUS_RECV_BUFFER_LENGTH) }
    }

    pub fn should_enable_date_header_timer(&self) -> bool {
        self.sweep_timer_count > 0
    }

    /// Tag values for `parent_tag`: 1 = `jsc::EventLoop`, 2 = `jsc::MiniEventLoop`.
    /// Low tier stores tag+ptr only; the typed `EventLoopHandle` wrappers
    /// (`set_parent_event_loop` / `get_parent`) live in the higher-tier crate
    /// that can name `bun_jsc` — see `bun_runtime::dispatch` (move-in pass).
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/InternalLoopData.zig (73 lines)
//   confidence: medium
//   todos:      2
//   notes:      #[repr(C)] mirror of C us_internal_loop_data_t; mutex field type and EventLoopHandle variant payload shapes need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
