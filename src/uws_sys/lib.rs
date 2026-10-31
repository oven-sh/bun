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
pub const LIBUS_UDP_LINUX_RECVERR: core::ffi::c_int = 128;
pub const LIBUS_SOCKET_OPEN_PAUSED: core::ffi::c_int = 256;

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
impl us_bun_verify_error_t {
    /// `X509_V_ERR_HOSTNAME_MISMATCH`, from the in-handshake server identity check (`ERR_TLS_CERT_ALTNAME_INVALID`).
    pub const HOSTNAME_MISMATCH: core::ffi::c_int = 62;
    /// `error` of openssl.c's `us_ssl_peer_disconnected_error`. Not an X509 code.
    pub const PEER_DISCONNECTED: core::ffi::c_int = -46;
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
    /// uSockets populates `code` from BoringSSL's static error-string
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
    /// An `EPROTO` reason is a stack buffer of the reporter: copy it before the handshake callback returns.
    #[inline]
    pub fn reason(&self) -> Option<&core::ffi::CStr> {
        if self.reason.is_null() {
            return None;
        }
        // SAFETY: a non-null `reason` is a valid NUL-terminated C string for the duration of the report.
        Some(unsafe { core::ffi::CStr::from_ptr(self.reason) })
    }

    /// `code` as a byte slice (no NUL), or `b""` if null. Convenience for the
    /// dominant `BunString::clone_utf8(..)` / `EncodedSlice::utf8(..)` shape.
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
    invalid_crl,
    invalid_ecdh_curve,
}

impl create_bun_socket_error_t {
    pub fn message(self) -> Option<&'static [u8]> {
        match self {
            Self::none => None,
            Self::load_ca_file => Some(b"Failed to load CA file"),
            Self::invalid_ca_file => Some(b"Invalid CA file"),
            Self::invalid_ca => Some(b"Invalid CA"),
            Self::invalid_ciphers => Some(b"Invalid ciphers"),
            Self::invalid_crl => Some(b"Invalid CRL"),
            Self::invalid_ecdh_curve => Some(b"Failed to set ECDH curve"),
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
    pub const Text: Opcode = Opcode(1);
    pub const Binary: Opcode = Opcode(2);
    pub const Ping: Opcode = Opcode(9);
    pub const Pong: Opcode = Opcode(10);
    // Upper-case aliases for callers that use the screaming-snake names
    // (`uWS::OpCode::TEXT` etc.). Same bit values; both spellings are accepted
    // so the merge of `bun_uws::Opcode` into this type doesn't ripple.
    pub const BINARY: Opcode = Opcode(2);
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

/// openssl.c's functions that need only an `SSL*`: what the TLS engine over a `us_socket_t` and `SSLWrapper` share.
pub mod ssl {
    use super::{SslCtx, us_bun_verify_error_t};
    use bun_boringssl_sys::{SSL, SSL_SESSION};
    use core::ffi::{c_char, c_int, c_uint, c_void};
    unsafe extern "C" {
        /// `SSL_new` and the setup of a client or a server. Never null.
        pub fn us_ssl_new(ctx: *mut SslCtx, is_client: c_int) -> *mut SSL;
        /// `requestCert` / `rejectUnauthorized` as BoringSSL's verify mode.
        pub safe fn us_ssl_set_verify_mode(
            ssl: &SSL,
            request_cert: c_int,
            reject_unauthorized: c_int,
        );
        /// A client refuses a bad server chain during the handshake, before its own certificate goes out.
        pub safe fn us_ssl_set_inline_reject(ssl: &SSL);
        pub safe fn us_ssl_inline_reject_tripped(ssl: &SSL) -> c_int;
        /// `check(owner, ssl)` gives the verify step's `US_IDENTITY_*` verdict. `owner` must outlive `ssl`.
        pub fn us_ssl_set_identity_check(
            ssl: &SSL,
            check: extern "C" fn(*mut c_void, *mut SSL) -> c_int,
            owner: *mut c_void,
        );
        /// 1 when the verify step of this handshake asked the owner for the server's name.
        pub safe fn us_ssl_identity_checked(ssl: &SSL) -> c_int;
        /// The X509 verdict on the peer's chain, as it stands now.
        pub safe fn us_ssl_socket_verify_error_from_ssl(ssl: &SSL) -> us_bun_verify_error_t;
        pub fn us_ssl_protocol_error(reason: *const c_char) -> us_bun_verify_error_t;
        pub safe fn us_ssl_peer_disconnected_error() -> us_bun_verify_error_t;
        /// Formats why the last `SSL_*` call failed into `reason[..length]`, NUL-terminated. 0 when nothing is queued.
        pub fn us_ssl_take_error_reason(reason: *mut c_char, length: usize) -> c_int;
        /// Answers `SSL_ERROR_WANT_RENEGOTIATE` within the context's budget. 0 if refused.
        pub safe fn us_ssl_renegotiate(ssl: &SSL) -> c_int;
        /// The `TLSSocket` that BoringSSL's callbacks on `ssl` report to. Stored verbatim, never dereferenced there.
        pub safe fn us_ssl_set_bun_socket(ssl: &SSL, bun_socket: *mut c_void);
        pub safe fn us_ssl_bun_socket(ssl: &SSL) -> *mut c_void;
        /// Hands what the new-session and keylog callbacks parked to that socket. Runs JS.
        pub safe fn us_ssl_flush_pending_events(ssl: &SSL);
        /// The session the new-session callback delivered last, borrowed. Null if none.
        pub safe fn us_ssl_latest_session(ssl: &SSL) -> *mut SSL_SESSION;
        /// Asks `us_dispatch_server_name` for the context of this SSL's server name.
        pub safe fn us_ssl_on_server_name(ssl: &SSL);
        /// Takes the reference `ctx` carries. 1 if the handshake waited for this answer: drive it again.
        pub fn us_ssl_sni_resolve(ssl: &SSL, ctx: *mut SslCtx, error: c_int) -> c_int;
        /// How many bytes may wait behind the ClientHello of a suspended handshake.
        pub safe fn us_ssl_sni_held_max() -> c_uint;
        /// 1 while an asynchronous SNICallback has the handshake suspended.
        pub safe fn us_ssl_sni_waiting(ssl: &SSL) -> c_int;
        /// 1 once the SNICallback refused the server name.
        pub safe fn us_ssl_sni_refused(ssl: &SSL) -> c_int;
        /// Hands the ALPN protocols of this SSL's ClientHello to `us_dispatch_alpn_offer`.
        pub safe fn us_ssl_on_alpn_offer(ssl: &SSL);
        /// `setKeyCert()` on a server. Returns 0 if `ctx` has no certificate.
        pub fn us_ssl_set_key_cert(
            ssl: *mut SSL,
            ctx: *mut SslCtx,
            sid_ctx: *const u8,
            sid_ctx_length: usize,
        ) -> c_int;
    }
}

pub mod socket_transfer {
    use super::LIBUS_SOCKET_DESCRIPTOR;
    use core::ffi::{c_char, c_int, c_uint, c_void};
    unsafe extern "C" {
        pub safe fn bsd_socket_export_size() -> c_int;
        pub fn bsd_socket_export(
            fd: LIBUS_SOCKET_DESCRIPTOR,
            target_pid: c_uint,
            info_out: *mut c_void,
        ) -> c_int;
        pub fn bsd_socket_import(info: *mut c_void, err: *mut c_int) -> LIBUS_SOCKET_DESCRIPTOR;
        pub safe fn bsd_close_socket(fd: LIBUS_SOCKET_DESCRIPTOR);
        pub fn bsd_create_bound_socket(
            host: *const c_char,
            port: c_int,
            options: c_int,
            out_port: *mut c_int,
            error: *mut c_int,
        ) -> LIBUS_SOCKET_DESCRIPTOR;
        pub fn bsd_create_bound_socket_unix(
            path: *const c_char,
            len: usize,
            error: *mut c_int,
        ) -> LIBUS_SOCKET_DESCRIPTOR;
    }
}

// ───────────────────────────── module map ────────────────────────────────────
// Snake-case names are what `bun_uws` imports; `#[path]` points at the
// PascalCase source files on disk.

pub mod error;
pub use error::{Error, Result};

#[path = "App.rs"]
pub mod app;
#[path = "BodyReaderMixin.rs"]
pub mod body_reader_mixin;
#[path = "ConnectingSocket.rs"]
pub mod connecting_socket;
#[path = "h2.rs"]
pub mod h2;
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
// libuv only — use `bun_event_loop::EventLoopTimer` elsewhere.
#[cfg(windows)]
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
    pub const SHUTDOWN: c_int = 9;
    /// Not a syscall: the per-loop TLS plaintext buffer allocation in
    /// `us_internal_init_loop_ssl_data`.
    pub const SSL_LOOP_BUFFER: c_int = 10;
    /// Not a syscall: poll registration in `us_poll_start_rc`
    /// (`uv_poll_init_socket` on Windows, `EPOLL_CTL_ADD` / `kevent` on
    /// epoll/kqueue).
    pub const POLL_START: c_int = 11;
    /// Not a syscall: the JS `Buffer` allocated for a TLS session/keylog
    /// payload in the `on_session`/`on_keylog` dispatch.
    pub const SESSION_BUFFER: c_int = 12;
    /// Not a syscall: one `SSL_write` call in `us_internal_ssl_writev`.
    pub const SSL_WRITE: c_int = 13;

    pub const ACTION_NONE: c_int = 0;
    pub const ACTION_ERRNO: c_int = 1;
    pub const ACTION_SHORT: c_int = 2;
    pub const ACTION_ZERO: c_int = 3;
    pub const ACTION_EXCESS: c_int = 4;

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
        pub safe fn us_fault_clear_all();
        pub fn us_fault_hit(syscall: c_int, fd: c_int, out: *mut isize, clamp: *mut c_int)
        -> c_int;
    }
}
pub use socket::{
    AnySocket, ConnectError, InternalSocket, NewSocketHandler, SocketHandler, SocketTCP, SocketTLS,
    Transport, TransportHandle,
};

// ───────────────────────────── re-exports ────────────────────────────────────

pub use internal_loop_data::InternalLoopData;
#[cfg(windows)]
pub use loop_::WindowsLoop;
pub use loop_::{Loop, NOW_NS_UNKNOWN};
pub use socket_kind::SocketKind;
#[cfg(windows)]
pub use timer::Timer;

pub use body_reader_mixin::BodyReaderMixin;
pub use connecting_socket::ConnectingSocket;
pub use listen_socket::ListenSocket;
pub use request::{AnyRequest, Request};
pub use response::c::uws_res;
pub use response::{AnyResponse, SocketAddress, WebSocketUpgradeContext};
pub use socket_context::BunSocketContextOptions;
pub use socket_group::ConnectResult;
pub use socket_group::SocketGroup;
pub use us_socket::{CloseCode, QueuedInput, UsIoVec, us_socket_t};
pub use web_socket::{AnyWebSocket, RawWebSocket, WebSocketBehavior};

/// Legacy aliases for `App<SSL>` / `Response<SSL>`.
pub type NewApp<const SSL: bool> = app::App<SSL>;
pub type NewAppResponse<const SSL: bool> = response::Response<SSL>;
pub type Socket = us_socket::us_socket_t;
