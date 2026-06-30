#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    // *_sys FFI bindings: every fn body is `unsafe { ffi_call(args) }`; the
    // safety contract is documented at each body and identical whether the
    // wrapper is `unsafe fn` or not.
    clippy::not_unsafe_ptr_arg_deref
)]
#![warn(unused_must_use)]
//! Low-level FFI bindings for uSockets / uWebSockets as used by Bun.
//!
//! Each `*.rs` file is mapped to a snake_case
//! module name (the names downstream `bun_uws` expects). Crate-root re-exports
//! flatten the common handle types.

// ───────────────────────── crate-root FFI primitives ─────────────────────────

/// `LIBUS_SOCKET_DESCRIPTOR` — `int` on POSIX, `SOCKET` (`uintptr`) on Windows.
#[cfg(not(windows))]
pub type LIBUS_SOCKET_DESCRIPTOR = core::ffi::c_int;
#[cfg(windows)]
pub type LIBUS_SOCKET_DESCRIPTOR = usize;

/// `enum us_socket_options_t` — listen / connect option flags.
pub const LIBUS_LISTEN_DEFAULT: core::ffi::c_int = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: core::ffi::c_int = 1;
pub const LIBUS_SOCKET_ALLOW_HALF_OPEN: core::ffi::c_int = 2;
pub const LIBUS_LISTEN_REUSE_PORT: core::ffi::c_int = 4;
pub const LIBUS_SOCKET_IPV6_ONLY: core::ffi::c_int = 8;
pub const LIBUS_LISTEN_REUSE_ADDR: core::ffi::c_int = 16;
pub const LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE: core::ffi::c_int = 32;

/// BoringSSL `SSL_CTX` (alias so callers don't need a direct boringssl dep).
pub type SslCtx = bun_boringssl_sys::SSL_CTX;

/// `struct us_bun_verify_error_t` — TLS handshake verification result.
///
/// Field is named `error_no` so the Node-compat
/// `verifyError`/`authorizationError` paths read naturally; the C struct's
/// first member is `int error` and the layout is identical.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_bun_verify_error_t {
    pub error_no: core::ffi::c_int,
    pub code: *const core::ffi::c_char,
    pub reason: *const core::ffi::c_char,
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
impl us_bun_verify_error_t {
    /// Borrow the BoringSSL verify-error `code` as a `CStr`, or `None` if null.
    ///
    /// uSockets populates `code`/`reason` from BoringSSL's static error-string
    /// table (`X509_verify_cert_error_string` and friends), so the pointee is
    /// `'static` in practice; the borrow is conservatively tied to `&self` so
    /// the accessor is sound even if a future caller heap-allocates the struct.
    #[inline]
    pub fn code(&self) -> Option<&core::ffi::CStr> {
        if self.code.is_null() {
            return None;
        }
        // SAFETY: uSockets guarantees a non-null `code` is a valid
        // NUL-terminated C string that outlives this struct (it points into
        // BoringSSL's static error table). Lifetime narrowed to `&self`.
        Some(unsafe { core::ffi::CStr::from_ptr(self.code) })
    }

    /// Borrow the BoringSSL verify-error `reason` as a `CStr`, or `None` if null.
    /// See [`Self::code`] for the safety argument.
    #[inline]
    pub fn reason(&self) -> Option<&core::ffi::CStr> {
        if self.reason.is_null() {
            return None;
        }
        // SAFETY: same invariant as `code()` — non-null `reason` is a valid
        // NUL-terminated C string from BoringSSL's static error table.
        Some(unsafe { core::ffi::CStr::from_ptr(self.reason) })
    }

    /// `code` as a byte slice (no NUL), or `b""` if null. Convenience for the
    /// dominant `BunString::clone_utf8(..)` / `ZigString::from_utf8(..)` shape.
    #[inline]
    pub fn code_bytes(&self) -> &[u8] {
        self.code().map_or(b"", core::ffi::CStr::to_bytes)
    }

    /// `reason` as a byte slice (no NUL), or `b""` if null.
    #[inline]
    pub fn reason_bytes(&self) -> &[u8] {
        self.reason().map_or(b"", core::ffi::CStr::to_bytes)
    }
}

/// `enum create_bun_socket_error_t` — out-param from `us_ssl_ctx_from_options`.
#[repr(C)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum create_bun_socket_error_t {
    none = 0,
    load_ca_file,
    invalid_ca_file,
    invalid_ca,
    invalid_ciphers,
}

impl create_bun_socket_error_t {
    pub fn message(self) -> Option<&'static [u8]> {
        match self {
            Self::none => None,
            Self::load_ca_file => Some(b"Failed to load CA file"),
            Self::invalid_ca_file => Some(b"Invalid CA file"),
            Self::invalid_ca => Some(b"Invalid CA"),
            Self::invalid_ciphers => Some(b"Invalid ciphers"),
        }
    }
}

/// WebSocket frame opcode (`uWS::OpCode`).
///
/// Spec is `enum(i32) { ..., _ }` — non-exhaustive, so any `i32` from C++ is a
/// valid bit pattern. This type crosses the FFI boundary *into* Rust via
/// `uws_websocket_message_handler`, so it must not be an exhaustive
/// `#[repr(i32)]` enum (an out-of-range discriminant would be instant UB).
#[repr(transparent)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub struct Opcode(pub i32);

impl Opcode {
    pub const Continuation: Opcode = Opcode(0);
    pub const Text: Opcode = Opcode(1);
    pub const Binary: Opcode = Opcode(2);
    pub const Close: Opcode = Opcode(8);
    pub const Ping: Opcode = Opcode(9);
    pub const Pong: Opcode = Opcode(10);
    // Upper-case aliases for callers that use the screaming-snake names
    // (`uWS::OpCode::TEXT` etc.). Same bit values; both spellings are accepted
    // so the merge of `bun_uws::Opcode` into this type doesn't ripple.
    pub const CONTINUATION: Opcode = Opcode(0);
    pub const TEXT: Opcode = Opcode(1);
    pub const BINARY: Opcode = Opcode(2);
    pub const CLOSE: Opcode = Opcode(8);
    pub const PING: Opcode = Opcode(9);
    pub const PONG: Opcode = Opcode(10);
}

/// `uWS::WebSocket::SendStatus`.
#[repr(u32)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum SendStatus {
    Backpressure = 0,
    Success = 1,
    Dropped = 2,
}

/// `bun.timespec` — `us_loop_run_bun_tick` takes `*const timespec`.
pub use bun_core::Timespec;

// Opaque FFI handles (Nomicon pattern) — what higher tiers reach for when the
// real module body isn't needed. See `bun_opaque::opaque_ffi!` doc for the
// `UnsafeCell<[u8;0]>` / `!Freeze` rationale; with UnsafeCell the reference is
// ABI-identical to a non-null pointer, which lets us declare value-typed shims
// as `safe fn` and drop per-call-site `unsafe { }`.
bun_opaque::opaque_ffi!(
    pub us_loop_t, pub us_socket_context_t, pub us_udp_socket_t, pub us_udp_packet_buffer_t,
);

/// Method table for runtime-tier duplex transports (TLS-over-JS-duplex and
/// Windows named pipes). The concrete types live in `bun_runtime::socket`; they
/// provide a `'static` table + owner pointer instead of link-time symbols.
pub struct DuplexVTable {
    pub ssl_error: unsafe fn(*mut ()) -> us_bun_verify_error_t,
    pub is_established: unsafe fn(*mut ()) -> bool,
    pub is_closed: unsafe fn(*mut ()) -> bool,
    pub is_shutdown: unsafe fn(*mut ()) -> bool,
    pub ssl: unsafe fn(*mut ()) -> *mut bun_boringssl_sys::SSL,
    pub set_timeout: unsafe fn(*mut (), core::ffi::c_uint),
    pub flush: unsafe fn(*mut ()),
    pub encode_and_write: unsafe fn(*mut (), *const u8, usize) -> i32,
    pub raw_write: unsafe fn(*mut (), *const u8, usize) -> i32,
    pub shutdown: unsafe fn(*mut ()),
    pub shutdown_read: unsafe fn(*mut ()),
    pub close: unsafe fn(*mut ()),
    /// Named-pipe only; `None` for `UpgradedDuplex`.
    pub pause_stream: Option<unsafe fn(*mut ()) -> bool>,
    pub resume_stream: Option<unsafe fn(*mut ()) -> bool>,
}

/// Type-erased handle to a runtime-tier duplex transport: the owner pointer
/// plus its [`DuplexVTable`]. Equality is pointer identity only.
#[derive(Copy, Clone)]
pub struct DuplexHandle {
    pub ptr: core::ptr::NonNull<()>,
    pub vtable: &'static DuplexVTable,
}

impl PartialEq for DuplexHandle {
    fn eq(&self, o: &Self) -> bool {
        self.ptr == o.ptr
    }
}

impl DuplexHandle {
    #[inline]
    pub fn ssl_error(&self) -> us_bun_verify_error_t {
        // SAFETY: `ptr` is the live owner the vtable was built for.
        unsafe { (self.vtable.ssl_error)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn is_established(&self) -> bool {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.is_established)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn is_closed(&self) -> bool {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.is_closed)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn is_shutdown(&self) -> bool {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.is_shutdown)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        // SAFETY: see `ssl_error`.
        let p = unsafe { (self.vtable.ssl)(self.ptr.as_ptr()) };
        if p.is_null() { None } else { Some(p) }
    }
    #[inline]
    pub fn set_timeout(&self, seconds: core::ffi::c_uint) {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.set_timeout)(self.ptr.as_ptr(), seconds) }
    }
    #[inline]
    pub fn flush(&self) {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.flush)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn encode_and_write(&self, data: &[u8]) -> i32 {
        // SAFETY: see `ssl_error`; `(data.as_ptr(), data.len())` is a valid
        // readable region borrowed for the call's duration.
        unsafe { (self.vtable.encode_and_write)(self.ptr.as_ptr(), data.as_ptr(), data.len()) }
    }
    #[inline]
    pub fn raw_write(&self, data: &[u8]) -> i32 {
        // SAFETY: see `encode_and_write`.
        unsafe { (self.vtable.raw_write)(self.ptr.as_ptr(), data.as_ptr(), data.len()) }
    }
    #[inline]
    pub fn shutdown(&self) {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.shutdown)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn shutdown_read(&self) {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.shutdown_read)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn close(&self) {
        // SAFETY: see `ssl_error`.
        unsafe { (self.vtable.close)(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn pause_stream(&self) -> bool {
        let Some(f) = self.vtable.pause_stream else {
            unreachable!("duplex has no pause_stream")
        };
        // SAFETY: see `ssl_error`.
        unsafe { f(self.ptr.as_ptr()) }
    }
    #[inline]
    pub fn resume_stream(&self) -> bool {
        let Some(f) = self.vtable.resume_stream else {
            unreachable!("duplex has no resume_stream")
        };
        // SAFETY: see `ssl_error`.
        unsafe { f(self.ptr.as_ptr()) }
    }
}

// ───────────────────────────── module map ────────────────────────────────────
// Snake-case names are what `bun_uws` imports; `#[path]` points at the
// PascalCase source files on disk.

#[path = "App.rs"]
pub mod app;
#[path = "BodyReaderMixin.rs"]
pub mod body_reader_mixin;
#[path = "ConnectingSocket.rs"]
pub mod connecting_socket;
#[path = "h3.rs"]
pub mod h3;
#[path = "InternalLoopData.rs"]
pub mod internal_loop_data;
#[path = "ListenSocket.rs"]
pub mod listen_socket;
#[path = "Loop.rs"]
pub mod loop_;
#[path = "quic.rs"]
pub mod quic;
#[path = "Request.rs"]
pub mod request;
#[path = "Response.rs"]
pub mod response;
#[path = "SocketContext.rs"]
pub mod socket_context;
#[path = "SocketGroup.rs"]
pub mod socket_group;
#[path = "SocketKind.rs"]
pub mod socket_kind;
#[path = "thunk.rs"]
pub mod thunk;
#[path = "Timer.rs"]
pub mod timer;
#[path = "udp.rs"]
pub mod udp;
#[path = "us_socket_t.rs"]
pub mod us_socket;
#[path = "vtable.rs"]
pub mod vtable;
#[path = "WebSocket.rs"]
pub mod web_socket;

#[path = "socket.rs"]
pub mod socket;

#[cfg(socket_fault_injection)]
pub mod fault_inject {
    use core::ffi::c_int;

    pub const RECV: c_int = 0;
    pub const SEND: c_int = 1;
    pub const WRITEV: c_int = 2;
    pub const SENDMSG: c_int = 3;
    pub const RECVMSG: c_int = 4;
    pub const CONNECT: c_int = 5;
    pub const ACCEPT: c_int = 6;
    pub const SOCKET: c_int = 7;
    pub const CLOSE: c_int = 8;
    pub const SHUTDOWN: c_int = 9;
    /// Not a syscall: the per-loop TLS plaintext buffer allocation in
    /// `us_internal_init_loop_ssl_data`.
    pub const SSL_LOOP_BUFFER: c_int = 10;

    pub const ACTION_NONE: c_int = 0;
    pub const ACTION_ERRNO: c_int = 1;
    pub const ACTION_SHORT: c_int = 2;
    pub const ACTION_ZERO: c_int = 3;

    #[repr(C)]
    pub struct UsFaultRule {
        pub action: c_int,
        pub errno_value: c_int,
        pub clamp_bytes: c_int,
        pub after_n_calls: c_int,
        pub repeat: c_int,
        pub target_fd: c_int,
    }

    unsafe extern "C" {
        pub fn us_fault_set(syscall: c_int, rule: *const UsFaultRule);
        pub safe fn us_fault_clear(syscall: c_int);
        pub safe fn us_fault_clear_all();
    }
}
pub use socket::{
    AnySocket, ConnectError, InternalSocket, NewSocketHandler, SocketHandler, SocketTCP, SocketTLS,
    SocketTcp, SocketTls,
};

// ───────────────────────────── re-exports ────────────────────────────────────

pub use internal_loop_data::InternalLoopData;
#[cfg(windows)]
pub use loop_::WindowsLoop;
pub use loop_::{Loop, PosixLoop};
pub use socket_kind::SocketKind;
pub use timer::Timer;
#[cfg(not(windows))]
pub type WindowsLoop = loop_::PosixLoop; // unified on non-Windows
pub use app::uws_app_t;
pub use body_reader_mixin::BodyReaderMixin;
pub use connecting_socket::ConnectingSocket;
pub use listen_socket::ListenSocket;
pub use request::{AnyRequest, Request};
pub use response::c::uws_res;
pub use response::{AnyResponse, SocketAddress, WebSocketUpgradeContext};
pub use socket_context::BunSocketContextOptions;
pub use socket_group::ConnectResult;
pub use socket_group::SocketGroup;
pub use us_socket::{CloseCode, UsIoVec, us_socket_stream_buffer_t, us_socket_t};
pub use web_socket::{AnyWebSocket, RawWebSocket, WebSocketBehavior};

pub use app::App;
pub use response::Response;
pub type Socket = us_socket::us_socket_t;
pub type SocketContext = us_socket_context_t;
