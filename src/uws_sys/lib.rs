#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! Low-level FFI bindings for uSockets / uWebSockets as used by Bun.
//!
//! B-2: un-gated module bodies. Each `*.rs` file is mapped to a snake_case
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
/// Field is named `error_no` (mirrors the Zig `error_no`) so the Node-compat
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
    // Upper-case aliases for callers that ported the Zig screaming-snake names
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
// real module body isn't needed. See `bun_core::opaque_extern!` doc for the
// `UnsafeCell<[u8;0]>` / `!Freeze` rationale; with UnsafeCell the reference is
// ABI-identical to a non-null pointer, which lets us declare value-typed shims
// as `safe fn` and drop per-call-site `unsafe { }`.
bun_core::opaque_extern!(
    pub us_loop_t, pub us_socket_context_t, pub us_udp_socket_t, pub us_udp_packet_buffer_t,
    pub UpgradedDuplex, pub WindowsNamedPipe,
);

// ── UpgradedDuplex (cycle-break shim) ────────────────────────────────────────
// The full `UpgradedDuplex` lives in `bun_runtime::socket` (T6); `socket.rs`
// here dispatches to it from the low-tier `InternalSocket` enum. To avoid an
// upward dep, the opaque handle gets thin inherent methods that forward to
// `extern "C"` symbols which the runtime crate exports with `#[no_mangle]`.
// This is the same link-time-dispatch pattern as other `*_sys` crates use for
// their C backends — only here the "backend" is Rust in a higher tier.
// PORT NOTE: signatures mirror `src/runtime/socket/UpgradedDuplex.rs`.
// SAFETY (safe fn): `UpgradedDuplex` is an `opaque_extern!` ZST handle (`!Freeze`
// via `UnsafeCell`), so `&`/`&mut` carry no `readonly`/`noalias` and are
// ABI-identical to non-null `*const`/`*mut`. Shims taking only the handle +
// scalars are `safe fn`; the two `(ptr,len)` slice writers stay `unsafe fn`.
unsafe extern "C" {
    safe fn UpgradedDuplex__ssl_error(this: &UpgradedDuplex) -> us_bun_verify_error_t;
    safe fn UpgradedDuplex__is_established(this: &UpgradedDuplex) -> bool;
    safe fn UpgradedDuplex__is_closed(this: &UpgradedDuplex) -> bool;
    safe fn UpgradedDuplex__is_shutdown(this: &UpgradedDuplex) -> bool;
    safe fn UpgradedDuplex__ssl(this: &UpgradedDuplex) -> *mut bun_boringssl_sys::SSL;
    safe fn UpgradedDuplex__set_timeout(this: &mut UpgradedDuplex, seconds: core::ffi::c_uint);
    safe fn UpgradedDuplex__flush(this: &mut UpgradedDuplex);
    fn UpgradedDuplex__encode_and_write(
        this: *mut UpgradedDuplex,
        ptr: *const u8,
        len: usize,
    ) -> i32;
    fn UpgradedDuplex__raw_write(this: *mut UpgradedDuplex, ptr: *const u8, len: usize) -> i32;
    safe fn UpgradedDuplex__shutdown(this: &mut UpgradedDuplex);
    safe fn UpgradedDuplex__shutdown_read(this: &mut UpgradedDuplex);
    safe fn UpgradedDuplex__close(this: &mut UpgradedDuplex);
}
impl UpgradedDuplex {
    #[inline]
    pub fn ssl_error(&self) -> us_bun_verify_error_t {
        UpgradedDuplex__ssl_error(self)
    }
    #[inline]
    pub fn is_established(&self) -> bool {
        UpgradedDuplex__is_established(self)
    }
    #[inline]
    pub fn is_closed(&self) -> bool {
        UpgradedDuplex__is_closed(self)
    }
    #[inline]
    pub fn is_shutdown(&self) -> bool {
        UpgradedDuplex__is_shutdown(self)
    }
    #[inline]
    pub fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        let p = UpgradedDuplex__ssl(self);
        if p.is_null() { None } else { Some(p) }
    }
    #[inline]
    pub fn set_timeout(&mut self, seconds: core::ffi::c_uint) {
        UpgradedDuplex__set_timeout(self, seconds)
    }
    #[inline]
    pub fn flush(&mut self) {
        UpgradedDuplex__flush(self)
    }
    #[inline]
    pub fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        unsafe { UpgradedDuplex__encode_and_write(self, data.as_ptr(), data.len()) }
    }
    #[inline]
    pub fn raw_write(&mut self, data: &[u8]) -> i32 {
        unsafe { UpgradedDuplex__raw_write(self, data.as_ptr(), data.len()) }
    }
    #[inline]
    pub fn shutdown(&mut self) {
        UpgradedDuplex__shutdown(self)
    }
    #[inline]
    pub fn shutdown_read(&mut self) {
        UpgradedDuplex__shutdown_read(self)
    }
    #[inline]
    pub fn close(&mut self) {
        UpgradedDuplex__close(self)
    }
}

// ── WindowsNamedPipe (cycle-break shim) ─────────────────────────────────────
// Same link-time-dispatch as `UpgradedDuplex` above: the real
// `WindowsNamedPipe` lives in `bun_runtime::socket`; this opaque handle
// forwards to `extern "C"` symbols that the runtime crate exports with
// `#[no_mangle]`. Surface mirrors `src/jsc/api/bun/socket.zig WindowsNamedPipe`.
#[cfg(windows)]
unsafe extern "C" {
    safe fn WindowsNamedPipe__ssl_error(this: &WindowsNamedPipe) -> us_bun_verify_error_t;
    safe fn WindowsNamedPipe__is_established(this: &WindowsNamedPipe) -> bool;
    safe fn WindowsNamedPipe__is_closed(this: &WindowsNamedPipe) -> bool;
    safe fn WindowsNamedPipe__is_shutdown(this: &WindowsNamedPipe) -> bool;
    safe fn WindowsNamedPipe__ssl(this: &WindowsNamedPipe) -> *mut bun_boringssl_sys::SSL;
    safe fn WindowsNamedPipe__set_timeout(this: &mut WindowsNamedPipe, seconds: core::ffi::c_uint);
    safe fn WindowsNamedPipe__flush(this: &mut WindowsNamedPipe);
    fn WindowsNamedPipe__encode_and_write(
        this: *mut WindowsNamedPipe,
        ptr: *const u8,
        len: usize,
    ) -> i32;
    fn WindowsNamedPipe__raw_write(this: *mut WindowsNamedPipe, ptr: *const u8, len: usize) -> i32;
    safe fn WindowsNamedPipe__shutdown(this: &mut WindowsNamedPipe);
    safe fn WindowsNamedPipe__shutdown_read(this: &mut WindowsNamedPipe);
    safe fn WindowsNamedPipe__close(this: &mut WindowsNamedPipe);
    safe fn WindowsNamedPipe__pause_stream(this: &mut WindowsNamedPipe) -> bool;
    safe fn WindowsNamedPipe__resume_stream(this: &mut WindowsNamedPipe) -> bool;
}
#[cfg(windows)]
impl WindowsNamedPipe {
    #[inline]
    pub fn ssl_error(&self) -> us_bun_verify_error_t {
        WindowsNamedPipe__ssl_error(self)
    }
    #[inline]
    pub fn is_established(&self) -> bool {
        WindowsNamedPipe__is_established(self)
    }
    #[inline]
    pub fn is_closed(&self) -> bool {
        WindowsNamedPipe__is_closed(self)
    }
    #[inline]
    pub fn is_shutdown(&self) -> bool {
        WindowsNamedPipe__is_shutdown(self)
    }
    #[inline]
    pub fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        let p = WindowsNamedPipe__ssl(self);
        if p.is_null() { None } else { Some(p) }
    }
    #[inline]
    pub fn set_timeout(&mut self, seconds: core::ffi::c_uint) {
        WindowsNamedPipe__set_timeout(self, seconds)
    }
    #[inline]
    pub fn flush(&mut self) {
        WindowsNamedPipe__flush(self)
    }
    #[inline]
    pub fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        unsafe { WindowsNamedPipe__encode_and_write(self, data.as_ptr(), data.len()) }
    }
    #[inline]
    pub fn raw_write(&mut self, data: &[u8]) -> i32 {
        unsafe { WindowsNamedPipe__raw_write(self, data.as_ptr(), data.len()) }
    }
    #[inline]
    pub fn shutdown(&mut self) {
        WindowsNamedPipe__shutdown(self)
    }
    #[inline]
    pub fn shutdown_read(&mut self) {
        WindowsNamedPipe__shutdown_read(self)
    }
    #[inline]
    pub fn close(&mut self) {
        WindowsNamedPipe__close(self)
    }
    #[inline]
    pub fn pause_stream(&mut self) -> bool {
        WindowsNamedPipe__pause_stream(self)
    }
    #[inline]
    pub fn resume_stream(&mut self) -> bool {
        WindowsNamedPipe__resume_stream(self)
    }
}

// ───────────────────────────── module map ────────────────────────────────────
// Snake-case names are what `bun_uws` imports; `#[path]` points at the
// PascalCase Phase-A drafts kept on disk.

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
pub use us_socket::{CloseCode, us_socket_stream_buffer_t, us_socket_t};
pub use web_socket::{AnyWebSocket, RawWebSocket, WebSocketBehavior};

/// Zig `NewApp(ssl)` / `NewApp(ssl).Response` aliases.
pub type NewApp<const SSL: bool> = app::App<SSL>;
pub type NewAppResponse<const SSL: bool> = response::Response<SSL>;
pub type Socket = us_socket::us_socket_t;
pub type SocketContext = us_socket_context_t;
