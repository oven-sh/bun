//! Shared type definitions for the uSockets port.
//!
//! Mirrors `packages/bun-usockets/src/libusockets.h`, `internal/internal.h`,
//! `internal/loop_data.h` and `internal/networking/bsd.h`. Every `#[repr(C)]`
//! struct here is field-for-field layout-identical to its C counterpart so the
//! exported `us_*` ABI is unchanged.

use core::ffi::{c_char, c_int, c_longlong, c_uint, c_void};

pub use crate::eventing::{us_loop_t, us_poll_t, us_timer_t};

// ── libc / winsock glue ─────────────────────────────────────────────────────
#[cfg(windows)]
pub use bun_windows_sys::ws2_32::{addrinfo, sockaddr_storage};
#[cfg(not(windows))]
pub use libc::{addrinfo, sockaddr_storage, socklen_t};
#[cfg(windows)]
pub type socklen_t = c_int;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/// 512 KiB shared receive buffer.
pub const LIBUS_RECV_BUFFER_LENGTH: usize = 524288;
/// 16 KiB shared send buffer for UDP packet metadata.
pub const LIBUS_SEND_BUFFER_LENGTH: usize = 1 << 14;
/// Timeout granularity in seconds.
pub const LIBUS_TIMEOUT_GRANULARITY: u32 = 4;
/// 32-byte padding at both ends of the receive buffer.
pub const LIBUS_RECV_BUFFER_PADDING: usize = 32;
/// Guaranteed alignment of the trailing `ext` area of every handle.
pub const LIBUS_EXT_ALIGNMENT: usize = 16;
/// Capacity of the ready-poll array on epoll/kqueue backends.
pub const LIBUS_MAX_READY_POLLS: usize = 1024;
/// Do not allow client-initiated TLS renegotiation by default.
pub const ALLOW_SERVER_RENEGOTIATION: c_int = 0;

pub const LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN: c_int = 0;
pub const LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET: c_int = 1;
pub const LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN: c_int = 2;

// listen / connect option flags (C `enum us_socket_options_t`)
pub const LIBUS_LISTEN_DEFAULT: c_int = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: c_int = 1;
pub const LIBUS_SOCKET_ALLOW_HALF_OPEN: c_int = 2;
pub const LIBUS_LISTEN_REUSE_PORT: c_int = 4;
pub const LIBUS_SOCKET_IPV6_ONLY: c_int = 8;
pub const LIBUS_LISTEN_REUSE_ADDR: c_int = 16;
pub const LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE: c_int = 32;
pub const LIBUS_LISTEN_DEFER_ACCEPT: c_int = 64;

// Poll kind + polling direction — the 5-bit `poll_type` packed into `us_poll_t`.
pub const POLL_TYPE_SOCKET: c_int = 0;
pub const POLL_TYPE_SOCKET_SHUT_DOWN: c_int = 1;
pub const POLL_TYPE_SEMI_SOCKET: c_int = 2;
pub const POLL_TYPE_CALLBACK: c_int = 3;
pub const POLL_TYPE_UDP: c_int = 4;
pub const POLL_TYPE_POLLING_OUT: c_int = 8;
pub const POLL_TYPE_POLLING_IN: c_int = 16;

pub const POLL_TYPE_BITSIZE: u32 = 5;
pub const POLL_TYPE_KIND_MASK: c_int = 0b111;
pub const POLL_TYPE_POLLING_MASK: c_int = 0b11000;
pub const POLL_TYPE_MASK: c_int = POLL_TYPE_KIND_MASK | POLL_TYPE_POLLING_MASK;

/// `enum create_bun_socket_error_t`.
pub const CREATE_BUN_SOCKET_ERROR_NONE: c_int = 0;
pub const CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE: c_int = 1;
pub const CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE: c_int = 2;
pub const CREATE_BUN_SOCKET_ERROR_INVALID_CA: c_int = 3;
pub const CREATE_BUN_SOCKET_ERROR_INVALID_CIPHERS: c_int = 4;

// ═══════════════════════════════════════════════════════════════════════════
// Primitive typedefs
// ═══════════════════════════════════════════════════════════════════════════

/// `LIBUS_SOCKET_DESCRIPTOR` — `int` on POSIX, `SOCKET` (`uintptr`) on Windows.
#[cfg(not(windows))]
pub type LIBUS_SOCKET_DESCRIPTOR = c_int;
#[cfg(windows)]
pub type LIBUS_SOCKET_DESCRIPTOR = usize;

/// `zig_mutex_t` — layout-only placeholder for `bun_threading::ReleaseImpl`.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
pub type zig_mutex_t = u32;
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub type zig_mutex_t = libc::os_unfair_lock;
#[cfg(windows)]
pub type zig_mutex_t = *mut c_void;

// ═══════════════════════════════════════════════════════════════════════════
// Small public structs
// ═══════════════════════════════════════════════════════════════════════════

/// `struct us_bun_verify_error_t` — TLS handshake verification result.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_bun_verify_error_t {
    pub error_no: c_int,
    pub code: *const c_char,
    pub reason: *const c_char,
}
impl Default for us_bun_verify_error_t {
    fn default() -> Self {
        Self {
            error_no: 0,
            code: core::ptr::null(),
            reason: core::ptr::null(),
        }
    }
}

/// `struct us_cert_string_t` — pointer/length pair for a DER/PEM buffer.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_cert_string_t {
    pub str: *const c_char,
    pub len: usize,
}

/// `struct us_iovec_t` — layout-compatible with POSIX `struct iovec`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_iovec_t {
    pub iov_base: *mut c_void,
    pub iov_len: usize,
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_socket_flags` — 1-byte packed bitfield
// ═══════════════════════════════════════════════════════════════════════════

#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct us_socket_flags(pub u8);

impl us_socket_flags {
    pub const IS_PAUSED: u8 = 1 << 0;
    pub const ALLOW_HALF_OPEN: u8 = 1 << 1;
    pub const LOW_PRIO_STATE_MASK: u8 = 0b0000_1100;
    pub const LOW_PRIO_STATE_SHIFT: u8 = 2;
    pub const IS_IPC: u8 = 1 << 4;
    pub const IS_CLOSED: u8 = 1 << 5;
    pub const ADOPTED: u8 = 1 << 6;
    pub const LAST_WRITE_FAILED: u8 = 1 << 7;

    #[inline]
    pub const fn is_paused(self) -> bool {
        self.0 & Self::IS_PAUSED != 0
    }
    #[inline]
    pub fn set_is_paused(&mut self, v: bool) {
        self.set_bit(Self::IS_PAUSED, v)
    }
    #[inline]
    pub const fn allow_half_open(self) -> bool {
        self.0 & Self::ALLOW_HALF_OPEN != 0
    }
    #[inline]
    pub fn set_allow_half_open(&mut self, v: bool) {
        self.set_bit(Self::ALLOW_HALF_OPEN, v)
    }
    #[inline]
    pub const fn low_prio_state(self) -> u8 {
        (self.0 & Self::LOW_PRIO_STATE_MASK) >> Self::LOW_PRIO_STATE_SHIFT
    }
    #[inline]
    pub fn set_low_prio_state(&mut self, v: u8) {
        self.0 = (self.0 & !Self::LOW_PRIO_STATE_MASK)
            | ((v << Self::LOW_PRIO_STATE_SHIFT) & Self::LOW_PRIO_STATE_MASK);
    }
    #[inline]
    pub const fn is_ipc(self) -> bool {
        self.0 & Self::IS_IPC != 0
    }
    #[inline]
    pub fn set_is_ipc(&mut self, v: bool) {
        self.set_bit(Self::IS_IPC, v)
    }
    #[inline]
    pub const fn is_closed(self) -> bool {
        self.0 & Self::IS_CLOSED != 0
    }
    #[inline]
    pub fn set_is_closed(&mut self, v: bool) {
        self.set_bit(Self::IS_CLOSED, v)
    }
    #[inline]
    pub const fn adopted(self) -> bool {
        self.0 & Self::ADOPTED != 0
    }
    #[inline]
    pub fn set_adopted(&mut self, v: bool) {
        self.set_bit(Self::ADOPTED, v)
    }
    #[inline]
    pub const fn last_write_failed(self) -> bool {
        self.0 & Self::LAST_WRITE_FAILED != 0
    }
    #[inline]
    pub fn set_last_write_failed(&mut self, v: bool) {
        self.set_bit(Self::LAST_WRITE_FAILED, v)
    }

    #[inline]
    fn set_bit(&mut self, mask: u8, v: bool) {
        if v { self.0 |= mask } else { self.0 &= !mask }
    }
}
#[cfg(not(windows))]
const _: () = assert!(core::mem::size_of::<us_socket_flags>() == 1);

// ═══════════════════════════════════════════════════════════════════════════
// `us_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

/// Mirrors `struct us_socket_t` (`internal.h`). The 11-bit SSL state lives in
/// the `ssl_bits` word; accessors below use the same bit positions as clang's
/// bitfield packing (LSB-first).
#[repr(C, align(16))]
pub struct us_socket_t {
    pub p: us_poll_t,
    pub timeout: u8,
    pub long_timeout: u8,
    pub flags: us_socket_flags,
    pub kind: u8,
    pub ssl_bits: u16,
    pub ssl_pending_close_code: u8,
    pub group: *mut us_socket_group_t,
    pub ssl: *mut bun_boringssl_sys::SSL,
    pub prev: *mut us_socket_t,
    pub next: *mut us_socket_t,
    pub connect_next: *mut us_socket_t,
    pub connect_state: *mut us_connecting_socket_t,
}

impl us_socket_t {
    const SSL_HANDSHAKE_STATE_MASK: u16 = 0b0000_0000_0000_0011;
    const SSL_WRITE_WANTS_READ: u16 = 1 << 2;
    const SSL_READ_WANTS_WRITE: u16 = 1 << 3;
    const SSL_FATAL_ERROR: u16 = 1 << 4;
    const SSL_IS_SERVER: u16 = 1 << 5;
    const SSL_RAW_TAP: u16 = 1 << 6;
    const SSL_SHUTDOWN_AFTER_SPILL: u16 = 1 << 7;
    const SSL_CLOSE_AFTER_SPILL: u16 = 1 << 8;
    const SSL_IN_USE: u16 = 1 << 9;
    const SSL_PENDING_DETACH: u16 = 1 << 10;

    #[inline]
    pub const fn ssl_handshake_state(&self) -> u8 {
        (self.ssl_bits & Self::SSL_HANDSHAKE_STATE_MASK) as u8
    }
    #[inline]
    pub fn set_ssl_handshake_state(&mut self, v: u8) {
        self.ssl_bits = (self.ssl_bits & !Self::SSL_HANDSHAKE_STATE_MASK)
            | (v as u16 & Self::SSL_HANDSHAKE_STATE_MASK);
    }
    #[inline]
    pub const fn ssl_write_wants_read(&self) -> bool {
        self.ssl_bits & Self::SSL_WRITE_WANTS_READ != 0
    }
    #[inline]
    pub fn set_ssl_write_wants_read(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_WRITE_WANTS_READ, v)
    }
    #[inline]
    pub const fn ssl_read_wants_write(&self) -> bool {
        self.ssl_bits & Self::SSL_READ_WANTS_WRITE != 0
    }
    #[inline]
    pub fn set_ssl_read_wants_write(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_READ_WANTS_WRITE, v)
    }
    #[inline]
    pub const fn ssl_fatal_error(&self) -> bool {
        self.ssl_bits & Self::SSL_FATAL_ERROR != 0
    }
    #[inline]
    pub fn set_ssl_fatal_error(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_FATAL_ERROR, v)
    }
    #[inline]
    pub const fn ssl_is_server(&self) -> bool {
        self.ssl_bits & Self::SSL_IS_SERVER != 0
    }
    #[inline]
    pub fn set_ssl_is_server(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_IS_SERVER, v)
    }
    #[inline]
    pub const fn ssl_raw_tap(&self) -> bool {
        self.ssl_bits & Self::SSL_RAW_TAP != 0
    }
    #[inline]
    pub fn set_ssl_raw_tap(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_RAW_TAP, v)
    }
    #[inline]
    pub const fn ssl_shutdown_after_spill(&self) -> bool {
        self.ssl_bits & Self::SSL_SHUTDOWN_AFTER_SPILL != 0
    }
    #[inline]
    pub fn set_ssl_shutdown_after_spill(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_SHUTDOWN_AFTER_SPILL, v)
    }
    #[inline]
    pub const fn ssl_close_after_spill(&self) -> bool {
        self.ssl_bits & Self::SSL_CLOSE_AFTER_SPILL != 0
    }
    #[inline]
    pub fn set_ssl_close_after_spill(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_CLOSE_AFTER_SPILL, v)
    }
    #[inline]
    pub const fn ssl_in_use(&self) -> bool {
        self.ssl_bits & Self::SSL_IN_USE != 0
    }
    #[inline]
    pub fn set_ssl_in_use(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_IN_USE, v)
    }
    #[inline]
    pub const fn ssl_pending_detach(&self) -> bool {
        self.ssl_bits & Self::SSL_PENDING_DETACH != 0
    }
    #[inline]
    pub fn set_ssl_pending_detach(&mut self, v: bool) {
        self.set_ssl_bit(Self::SSL_PENDING_DETACH, v)
    }

    #[inline]
    fn set_ssl_bit(&mut self, mask: u16, v: bool) {
        if v {
            self.ssl_bits |= mask
        } else {
            self.ssl_bits &= !mask
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_connecting_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C, align(16))]
pub struct us_connecting_socket_t {
    pub addrinfo_req: *mut addrinfo_request,
    pub group: *mut us_socket_group_t,
    pub loop_: *mut us_loop_t,
    pub ssl_ctx: *mut bun_boringssl_sys::SSL_CTX,
    pub next: *mut us_connecting_socket_t,
    pub connecting_head: *mut us_socket_t,
    pub options: c_int,
    pub socket_ext_size: c_int,
    /// closed:1, shutdown:1, shutdown_read:1, pending_resolve_callback:1, error_is_dns:1 (LSB-first).
    pub bits: u8,
    pub timeout: u8,
    pub long_timeout: u8,
    pub kind: u8,
    pub port: u16,
    pub error: c_int,
    pub addrinfo_head: *mut addrinfo,
    pub next_pending: *mut us_connecting_socket_t,
    pub prev_pending: *mut us_connecting_socket_t,
}

impl us_connecting_socket_t {
    pub const CLOSED: u8 = 1 << 0;
    pub const SHUTDOWN: u8 = 1 << 1;
    pub const SHUTDOWN_READ: u8 = 1 << 2;
    pub const PENDING_RESOLVE_CALLBACK: u8 = 1 << 3;
    pub const ERROR_IS_DNS: u8 = 1 << 4;

    #[inline]
    pub const fn closed(&self) -> bool {
        self.bits & Self::CLOSED != 0
    }
    #[inline]
    pub fn set_closed(&mut self, v: bool) {
        self.set_bit(Self::CLOSED, v)
    }
    #[inline]
    pub const fn shutdown(&self) -> bool {
        self.bits & Self::SHUTDOWN != 0
    }
    #[inline]
    pub fn set_shutdown(&mut self, v: bool) {
        self.set_bit(Self::SHUTDOWN, v)
    }
    #[inline]
    pub const fn shutdown_read(&self) -> bool {
        self.bits & Self::SHUTDOWN_READ != 0
    }
    #[inline]
    pub fn set_shutdown_read(&mut self, v: bool) {
        self.set_bit(Self::SHUTDOWN_READ, v)
    }
    #[inline]
    pub const fn pending_resolve_callback(&self) -> bool {
        self.bits & Self::PENDING_RESOLVE_CALLBACK != 0
    }
    #[inline]
    pub fn set_pending_resolve_callback(&mut self, v: bool) {
        self.set_bit(Self::PENDING_RESOLVE_CALLBACK, v)
    }
    #[inline]
    pub const fn error_is_dns(&self) -> bool {
        self.bits & Self::ERROR_IS_DNS != 0
    }
    #[inline]
    pub fn set_error_is_dns(&mut self, v: bool) {
        self.set_bit(Self::ERROR_IS_DNS, v)
    }

    #[inline]
    fn set_bit(&mut self, mask: u8, v: bool) {
        if v {
            self.bits |= mask
        } else {
            self.bits &= !mask
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_udp_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C, align(16))]
pub struct us_udp_socket_t {
    pub p: us_poll_t,
    pub on_data: Option<unsafe extern "C" fn(*mut us_udp_socket_t, *mut c_void, c_int)>,
    pub on_drain: Option<unsafe extern "C" fn(*mut us_udp_socket_t)>,
    pub on_close: Option<unsafe extern "C" fn(*mut us_udp_socket_t)>,
    pub on_recv_error: Option<unsafe extern "C" fn(*mut us_udp_socket_t, c_int)>,
    pub user: *mut c_void,
    pub loop_: *mut us_loop_t,
    pub port: u16,
    /// closed:1, connected:1 (LSB-first).
    pub bits: u16,
    pub next: *mut us_udp_socket_t,
}

impl us_udp_socket_t {
    pub const CLOSED: u16 = 1 << 0;
    pub const CONNECTED: u16 = 1 << 1;

    #[inline]
    pub const fn closed(&self) -> bool {
        self.bits & Self::CLOSED != 0
    }
    #[inline]
    pub fn set_closed(&mut self, v: bool) {
        if v {
            self.bits |= Self::CLOSED
        } else {
            self.bits &= !Self::CLOSED
        }
    }
    #[inline]
    pub const fn connected(&self) -> bool {
        self.bits & Self::CONNECTED != 0
    }
    #[inline]
    pub fn set_connected(&mut self, v: bool) {
        if v {
            self.bits |= Self::CONNECTED
        } else {
            self.bits &= !Self::CONNECTED
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_internal_callback_t`
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C, align(16))]
pub struct us_internal_callback_t {
    pub p: us_poll_t,
    pub loop_: *mut us_loop_t,
    pub cb_expects_the_loop: c_int,
    pub leave_poll_ready: c_int,
    pub cb: Option<unsafe extern "C" fn(*mut us_internal_callback_t)>,
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub port: u32, // mach_port_t
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub machport_buf: *mut c_void,
    #[cfg(windows)]
    pub has_added_timer_to_event_loop: c_uint,
}

/// `struct us_internal_async` — opaque handle from `us_internal_create_async`.
pub type us_internal_async = us_internal_callback_t;

// ═══════════════════════════════════════════════════════════════════════════
// `us_listen_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

pub type us_on_server_name_cb = Option<
    unsafe extern "C" fn(
        *mut us_listen_socket_t,
        *const c_char,
        *mut c_int,
        *mut us_socket_t,
    ) -> *mut bun_boringssl_sys::SSL_CTX,
>;

#[repr(C, align(16))]
pub struct us_listen_socket_t {
    pub s: us_socket_t,
    pub accept_group: *mut us_socket_group_t,
    pub next: *mut us_listen_socket_t,
    pub ssl_ctx: *mut bun_boringssl_sys::SSL_CTX,
    pub sni: *mut c_void,
    pub on_server_name: us_on_server_name_cb,
    pub socket_ext_size: c_uint,
    pub accept_kind: u8,
    pub deferred_accept: u8,
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_socket_vtable_t` / `us_socket_group_t`
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_socket_vtable_t {
    pub on_open: Option<
        unsafe extern "C" fn(*mut us_socket_t, c_int, *mut c_char, c_int) -> *mut us_socket_t,
    >,
    pub on_data:
        Option<unsafe extern "C" fn(*mut us_socket_t, *mut c_char, c_int) -> *mut us_socket_t>,
    pub on_fd: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_writable: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_close:
        Option<unsafe extern "C" fn(*mut us_socket_t, c_int, *mut c_void) -> *mut us_socket_t>,
    pub on_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_long_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_end: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_connect_error: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_connecting_error: Option<
        unsafe extern "C" fn(*mut us_connecting_socket_t, c_int) -> *mut us_connecting_socket_t,
    >,
    pub on_handshake:
        Option<unsafe extern "C" fn(*mut us_socket_t, c_int, us_bun_verify_error_t, *mut c_void)>,
}

#[repr(C)]
pub struct us_socket_group_t {
    pub loop_: *mut us_loop_t,
    pub vtable: *const us_socket_vtable_t,
    pub ext: *mut c_void,
    pub head_sockets: *mut us_socket_t,
    pub head_connecting_sockets: *mut us_connecting_socket_t,
    pub head_listen_sockets: *mut us_listen_socket_t,
    pub iterator: *mut us_socket_t,
    pub prev: *mut us_socket_group_t,
    pub next: *mut us_socket_group_t,
    pub global_tick: u32,
    pub low_prio_count: u16,
    pub timestamp: u8,
    pub long_timestamp: u8,
    pub linked: u8,
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_internal_loop_data_t`
// ═══════════════════════════════════════════════════════════════════════════

/// Opaque QUIC context list head (defined in quic.rs).
#[repr(C)]
pub struct us_quic_socket_context_s {
    _p: [u8; 0],
}

#[repr(C)]
pub struct us_internal_loop_data_t {
    #[cfg(windows)]
    pub sweep_timer: *mut us_timer_t,
    #[cfg(not(windows))]
    pub sweep_next_tick_ns: c_longlong,
    pub sweep_timer_count: c_int,
    pub wakeup_async: *mut us_internal_async,
    pub head: *mut us_socket_group_t,
    pub quic_head: *mut us_quic_socket_context_s,
    pub quic_next_tick_us: c_longlong,
    #[cfg(windows)]
    pub quic_timer: *mut us_timer_t,
    pub iterator: *mut us_socket_group_t,
    pub recv_buf: *mut c_char,
    pub send_buf: *mut c_char,
    pub ssl_data: *mut c_void,
    pub pre_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    pub post_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    pub closed_udp_head: *mut us_udp_socket_t,
    pub closed_head: *mut us_socket_t,
    pub low_prio_head: *mut us_socket_t,
    pub low_prio_budget: c_int,
    pub dns_ready_head: *mut us_connecting_socket_t,
    pub closed_connecting_head: *mut us_connecting_socket_t,
    pub mutex: zig_mutex_t,
    pub parent_ptr: *mut c_void,
    pub parent_tag: c_char,
    pub iteration_nr: usize,
    pub jsc_vm: *mut c_void,
    pub tick_depth: c_int,
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_bun_socket_context_options_t`
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_bun_socket_context_options_t {
    pub key_file_name: *const c_char,
    pub cert_file_name: *const c_char,
    pub passphrase: *const c_char,
    pub dh_params_file_name: *const c_char,
    pub ca_file_name: *const c_char,
    pub ssl_ciphers: *const c_char,
    pub ssl_prefer_low_memory_usage: c_int,
    pub key: *const *const c_char,
    pub key_count: c_uint,
    pub cert: *const *const c_char,
    pub cert_count: c_uint,
    pub ca: *const *const c_char,
    pub ca_count: c_uint,
    pub secure_options: c_uint,
    pub ssl_min_version: c_int,
    pub ssl_max_version: c_int,
    pub reject_unauthorized: c_int,
    pub request_cert: c_int,
    pub client_renegotiation_limit: c_uint,
    pub client_renegotiation_window: c_uint,
}

// ═══════════════════════════════════════════════════════════════════════════
// Networking (`bsd.h`)
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct bsd_addr_t {
    pub mem: sockaddr_storage,
    pub len: socklen_t,
    pub ip: *mut c_char,
    pub ip_length: c_int,
    pub port: c_int,
}

// ═══════════════════════════════════════════════════════════════════════════
// DNS (addrinfo) glue — defined out-of-library (`Bun__addrinfo_*`)
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct addrinfo_request {
    _p: [u8; 0],
}

#[repr(C)]
pub struct addrinfo_result_entry {
    pub info: addrinfo,
    pub _storage: sockaddr_storage,
}

#[repr(C)]
pub struct addrinfo_result {
    pub entries: *mut addrinfo_result_entry,
    pub error: c_int,
}

// ═══════════════════════════════════════════════════════════════════════════
// Externs provided by the Bun runtime / dispatch layer
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    pub fn Bun__panic(msg: *const c_char, len: usize) -> !;
    pub fn Bun__outOfMemory() -> !;
    pub fn Bun__lock(m: *mut zig_mutex_t);
    pub fn Bun__unlock(m: *mut zig_mutex_t);

    pub fn Bun__addrinfo_get(
        loop_: *mut us_loop_t,
        host: *const c_char,
        port: u16,
        ptr: *mut *mut addrinfo_request,
    ) -> c_int;
    pub fn Bun__addrinfo_set(
        ptr: *mut addrinfo_request,
        socket: *mut us_connecting_socket_t,
    ) -> c_int;
    pub fn Bun__addrinfo_cancel(
        ptr: *mut addrinfo_request,
        socket: *mut us_connecting_socket_t,
    ) -> c_int;
    pub fn Bun__addrinfo_freeRequest(addrinfo_req: *mut addrinfo_request, error: c_int);
    pub fn Bun__addrinfo_getRequestResult(
        addrinfo_req: *mut addrinfo_request,
    ) -> *mut addrinfo_result;

    pub fn us_dispatch_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut c_char,
        ip_length: c_int,
    ) -> *mut us_socket_t;
    pub fn us_dispatch_data(
        s: *mut us_socket_t,
        data: *mut c_char,
        length: c_int,
    ) -> *mut us_socket_t;
    pub fn us_dispatch_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t;
    pub fn us_dispatch_writable(s: *mut us_socket_t) -> *mut us_socket_t;
    pub fn us_dispatch_close(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t;
    pub fn us_dispatch_timeout(s: *mut us_socket_t) -> *mut us_socket_t;
    pub fn us_dispatch_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t;
    pub fn us_dispatch_end(s: *mut us_socket_t) -> *mut us_socket_t;
    pub fn us_dispatch_connect_error(s: *mut us_socket_t, code: c_int) -> *mut us_socket_t;
    pub fn us_dispatch_connecting_error(
        c: *mut us_connecting_socket_t,
        code: c_int,
    ) -> *mut us_connecting_socket_t;
    pub fn us_dispatch_handshake(s: *mut us_socket_t, success: c_int, err: us_bun_verify_error_t);
    pub fn us_dispatch_session(s: *mut us_socket_t, data: *const u8, length: c_int);
    pub fn us_dispatch_keylog(s: *mut us_socket_t, data: *const u8, length: c_int);
    pub fn us_dispatch_ssl_raw_tap(
        s: *mut us_socket_t,
        data: *mut c_char,
        length: c_int,
    ) -> *mut us_socket_t;

    pub fn us_internal_raw_root_certs(out: *mut *mut us_cert_string_t) -> c_int;
}

// ═══════════════════════════════════════════════════════════════════════════
// Allocation helpers — match C's `us_malloc` / `us_calloc` / `us_realloc` / `us_free`
// ═══════════════════════════════════════════════════════════════════════════

#[inline]
pub unsafe fn us_malloc(n: usize) -> *mut c_void {
    // SAFETY: libc malloc is sound for any `n`; caller owns the returned block.
    unsafe { libc::malloc(n) }
}
#[inline]
pub unsafe fn us_calloc(n: usize, size: usize) -> *mut c_void {
    // SAFETY: libc calloc is sound for any `n`/`size`; caller owns the block.
    unsafe { libc::calloc(n, size) }
}
#[inline]
pub unsafe fn us_realloc(p: *mut c_void, n: usize) -> *mut c_void {
    // SAFETY: caller guarantees `p` was returned by `us_malloc`/`us_calloc` or is null.
    unsafe { libc::realloc(p, n) }
}
#[inline]
pub unsafe fn us_free(p: *mut c_void) {
    // SAFETY: caller guarantees `p` was returned by `us_malloc`/`us_calloc`/`us_realloc` or is null.
    unsafe { libc::free(p) }
}

/// Pointer to the trailing ext area (the bytes immediately after the struct).
#[inline]
pub unsafe fn ext_of<T>(p: *mut T) -> *mut c_void {
    // SAFETY: caller guarantees `p` points to a handle allocated with trailing ext storage.
    unsafe { p.add(1).cast() }
}
