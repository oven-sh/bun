#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
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
pub const LIBUS_LISTEN_REUSE_ADDR: core::ffi::c_int = 4;
pub const LIBUS_LISTEN_REUSE_PORT: core::ffi::c_int = 8;
pub const LIBUS_SOCKET_IPV6_ONLY: core::ffi::c_int = 16;
pub const LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE: core::ffi::c_int = 32;
pub const LIBUS_SKIP_REUSE_PORT_BEHAVIOR: core::ffi::c_int = 64;

/// BoringSSL `SSL_CTX` (alias so callers don't need a direct boringssl dep).
pub type SslCtx = bun_boringssl_sys::SSL_CTX;

/// `struct us_bun_verify_error_t` — TLS handshake verification result.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_bun_verify_error_t {
    pub error: core::ffi::c_int,
    pub code: *const core::ffi::c_char,
    pub reason: *const core::ffi::c_char,
}
impl Default for us_bun_verify_error_t {
    fn default() -> Self {
        Self { error: 0, code: core::ptr::null(), reason: core::ptr::null() }
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

/// WebSocket frame opcode (`uWS::OpCode`).
#[repr(i32)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum Opcode {
    Continuation = 0,
    Text = 1,
    Binary = 2,
    Close = 8,
    Ping = 9,
    Pong = 10,
}

/// `uWS::WebSocket::SendStatus`.
#[repr(i32)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum SendStatus {
    Backpressure = 0,
    Success = 1,
    Dropped = 2,
}

/// `bun.timespec` mirror — `us_loop_run_bun_tick` takes `*const timespec`.
/// Kept local so this crate doesn't depend on a higher tier for the layout.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Timespec {
    pub sec: i64,
    pub nsec: i64,
}

// Opaque FFI handles (Nomicon pattern) — what higher tiers reach for when the
// real module body isn't needed.
macro_rules! opaque {
    ($($name:ident),+ $(,)?) => {$(
        #[repr(C)] pub struct $name { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
    )+};
}
opaque!(
    us_loop_t, us_socket_context_t, us_udp_socket_t, us_udp_packet_buffer_t,
    UpgradedDuplex, WindowsNamedPipe,
);

// ───────────────────────────── module map ────────────────────────────────────
// Snake-case names are what `bun_uws` imports; `#[path]` points at the
// PascalCase Phase-A drafts kept on disk.

#[path = "SocketKind.rs"]       pub mod socket_kind;
#[path = "Timer.rs"]            pub mod timer;
#[path = "udp.rs"]              pub mod udp;
#[path = "InternalLoopData.rs"] pub mod internal_loop_data;
#[path = "Loop.rs"]             pub mod loop_;
#[path = "ConnectingSocket.rs"] pub mod connecting_socket;
#[path = "SocketGroup.rs"]      pub mod socket_group;
#[path = "us_socket_t.rs"]      pub mod us_socket;
#[path = "ListenSocket.rs"]     pub mod listen_socket;
#[path = "SocketContext.rs"]    pub mod socket_context;
#[path = "vtable.rs"]           pub mod vtable;
#[path = "Request.rs"]          pub mod request;
#[path = "Response.rs"]         pub mod response;
#[path = "h3.rs"]               pub mod h3;
#[path = "WebSocket.rs"]        pub mod web_socket;
#[path = "App.rs"]              pub mod app;
#[path = "BodyReaderMixin.rs"]  pub mod body_reader_mixin;
#[path = "quic.rs"]             pub mod quic;

// TODO(b2-blocked): `socket.rs` (NewSocketHandler / InternalSocket / AnySocket)
// dispatches to `UpgradedDuplex` / `WindowsNamedPipe` instance methods that
// live in higher-tier crates. Stubbed here so downstream `bun_uws` paths
// resolve; bodies un-gate once those wrappers move down.
#[cfg(any())]
#[path = "socket.rs"]
pub mod socket;
#[cfg(not(any()))]
pub mod socket {
    use crate::{us_socket_t, ConnectingSocket, UpgradedDuplex};
    pub enum InternalSocket<'a> {
        Connected(*mut us_socket_t),
        Connecting(*mut ConnectingSocket),
        UpgradedDuplex(&'a mut UpgradedDuplex),
        #[cfg(windows)]
        Pipe(&'a mut crate::WindowsNamedPipe),
        #[cfg(not(windows))]
        Pipe,
        Detached,
    }
    pub struct NewSocketHandler<'a, const IS_SSL: bool> {
        pub socket: InternalSocket<'a>,
    }
    pub type SocketTCP<'a> = NewSocketHandler<'a, false>;
    pub type SocketTLS<'a> = NewSocketHandler<'a, true>;
    pub type SocketTcp<'a> = NewSocketHandler<'a, false>;
    pub type SocketTls<'a> = NewSocketHandler<'a, true>;
    pub enum AnySocket<'a> {
        Tcp(SocketTCP<'a>),
        Tls(SocketTLS<'a>),
    }
}

// ───────────────────────────── re-exports ────────────────────────────────────

pub use socket_kind::SocketKind;
pub use timer::Timer;
pub use internal_loop_data::InternalLoopData;
pub use loop_::{Loop, PosixLoop};
#[cfg(windows)]
pub use loop_::WindowsLoop;
#[cfg(not(windows))]
pub type WindowsLoop = loop_::PosixLoop; // unified on non-Windows
pub use connecting_socket::ConnectingSocket;
pub use socket_group::SocketGroup;
pub use us_socket::{us_socket_t, us_socket_stream_buffer_t, CloseCode};
pub use listen_socket::ListenSocket;
pub use socket_context::BunSocketContextOptions;
pub use request::{Request, AnyRequest};
pub use response::{AnyResponse, SocketAddress, WebSocketUpgradeContext};
pub use response::c::uws_res;
pub use web_socket::{RawWebSocket, AnyWebSocket, WebSocketBehavior};
pub use app::uws_app_t;
pub use body_reader_mixin::BodyReaderMixin;
pub use socket_group::ConnectResult;

/// Zig `NewApp(ssl)` / `NewApp(ssl).Response` aliases.
pub type NewApp<const SSL: bool> = app::App<SSL>;
pub type NewAppResponse<const SSL: bool> = response::Response<SSL>;
pub type Socket = us_socket::us_socket_t;
pub type SocketContext = us_socket_context_t;
pub type SocketHandler = socket_group::VTable;
