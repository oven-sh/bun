//! Port of `src/runtime/socket/socket.zig`.
//!
//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).
//!
//! B-2: full draft (3232 lines, preserved in `socket_body.rs`) depends on
//! `bun_jsc` method surface, `bun_boringssl_sys::{SSL, SSL_CTX}` (bindgen not
//! generated), and `bun_output` macros. Pure-data / low-dependency submodules
//! are wired as they become compilable; the rest remain gated.

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
#[path = "socket_body.rs"]
mod socket_body; // full Phase-A draft of socket.zig
#[cfg(any())]
#[path = "SocketAddress.rs"]
pub mod socket_address;
#[cfg(any())]
#[path = "Handlers.rs"]
pub mod handlers;
#[cfg(any())]
#[path = "Listener.rs"]
pub mod listener;
#[cfg(any())]
#[path = "UpgradedDuplex.rs"]
pub mod upgraded_duplex;
#[cfg(any())]
#[path = "WindowsNamedPipe.rs"]
pub mod windows_named_pipe;
#[cfg(any())]
#[path = "WindowsNamedPipeContext.rs"]
pub mod windows_named_pipe_context;
#[cfg(any())]
#[path = "ssl_wrapper.rs"]
pub mod ssl_wrapper;
#[cfg(any())]
#[path = "tls_socket_functions.rs"]
mod tls_socket_functions;
#[cfg(any())]
#[path = "udp_socket.rs"]
pub mod udp_socket_draft;
#[cfg(any())]
#[path = "uws_dispatch.rs"]
pub mod uws_dispatch;
#[cfg(any())]
#[path = "uws_handlers.rs"]
pub mod uws_handlers;
#[cfg(any())]
#[path = "uws_jsc.rs"]
pub mod uws_jsc;

// ─── real type surface (B-2 struct/state un-gate) ────────────────────────────
// Method bodies (Handlers::from_js, Listener::listen/reload, the
// `bun_uws::NewSocketHandler` configure dance, tls_socket_functions) remain in
// the gated drafts above — they need:
//   TODO(b2-blocked): bun_jsc::{JSGlobalObject method surface, Strong, host_fn}
//   TODO(b2-blocked): bun_boringssl_sys::{SSL, SSL_CTX} bindgen
//   TODO(b2-blocked): bun_output::{declare_scope, scoped_log}
//   TODO(b2-blocked): bun_c_ares (SocketAddress pton/ntop)

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_aio::KeepAlive;
use bun_str::String as BunString;
use bun_sys::Fd;
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::jsc::{JSGlobalObject, JSValue};

// `bun_jsc::Strong` is unavailable; the crate-local shim is `Strong<T>`. The
// socket structs store the non-generic `Strong.Optional` form.
type Strong = crate::jsc::Strong;

/// Unified socket mode replacing the old `is_server: bool` + TLSMode pair.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum SocketMode {
    /// Default — TLS client or non-TLS socket.
    #[default]
    Client,
    /// Listener-owned server. TLS (if any) configured at the listener level.
    Server,
    /// Duplex upgraded to TLS server role. Not listener-owned —
    /// `mark_inactive` uses the client lifecycle path.
    DuplexServer,
}
impl SocketMode {
    /// True for any mode that acts as a TLS server (ALPN, handshake direction).
    /// Both `Server` and `DuplexServer` present as server to peers.
    #[inline]
    pub fn is_server(self) -> bool {
        matches!(self, SocketMode::Server | SocketMode::DuplexServer)
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum BinaryType {
    #[default]
    Buffer,
    ArrayBuffer,
    Uint8Array,
}

// ── Handlers ─────────────────────────────────────────────────────────────────
// Bare `JSValue` heap fields are sound here: Zig keeps them alive via JSC
// `protect()`/`unprotect()` (GC roots), not stack scanning.
pub struct Handlers {
    pub on_open: JSValue,
    pub on_close: JSValue,
    pub on_data: JSValue,
    pub on_writable: JSValue,
    pub on_timeout: JSValue,
    pub on_connect_error: JSValue,
    pub on_end: JSValue,
    pub on_error: JSValue,
    pub on_handshake: JSValue,

    pub binary_type: BinaryType,

    // TODO(port): lifetime — JSC_BORROW; raw ptr until bun_jsc lands the real
    // `&'static VirtualMachine` borrow.
    pub vm: *mut c_void,
    pub global_object: *const JSGlobalObject,
    pub active_connections: u32,
    pub mode: SocketMode,
    pub promise: Strong,
}

// ── Listener ─────────────────────────────────────────────────────────────────
pub enum ListenerType {
    Uws(*mut uws_sys::ListenSocket),
    NamedPipe(Box<WindowsNamedPipeListeningContext>),
    None,
}
impl Default for ListenerType {
    fn default() -> Self {
        ListenerType::None
    }
}

#[derive(Clone)]
pub enum UnixOrHost {
    Unix(Box<[u8]>),
    Host { host: Box<[u8]>, port: u16 },
    Fd(Fd),
}

pub struct Listener {
    pub handlers: Handlers,
    pub listener: ListenerType,
    pub poll_ref: KeepAlive,
    pub connection: UnixOrHost,
    pub group: uws::SocketGroup,
    /// `SSL_CTX*` for accepted sockets. One owned ref; `SSL_CTX_free` on close.
    // TODO(b2-blocked): bun_boringssl_sys::SSL_CTX — typed once bindgen lands.
    pub secure_ctx: Option<NonNull<c_void>>,
    pub ssl: bool,
    pub protos: Option<Box<[u8]>>,
    pub strong_data: Strong,
    pub strong_self: Strong,
}

pub struct WindowsNamedPipeListeningContext {
    // TODO(b2-blocked): full fields in Listener.rs draft (uv_pipe_t handle,
    // backlog vec, …). Opaque body until libuv types are reachable on POSIX
    // builds; only ever used behind `Box<_>` so layout here is irrelevant.
    _priv: (),
}

// ── SocketAddress ────────────────────────────────────────────────────────────
// `inet` types defined locally (libc-backed) so the `sockaddr` union and `AF`
// enum are real on POSIX without depending on `bun_c_ares` / `bun_sys::posix`
// re-exports that don't exist yet.
pub mod inet {
    #![allow(non_camel_case_types)]
    pub type in_port_t = u16;
    pub type socklen_t = u32;
    #[cfg(unix)]
    pub const AF_INET: u16 = libc::AF_INET as u16;
    #[cfg(unix)]
    pub const AF_INET6: u16 = libc::AF_INET6 as u16;
    #[cfg(not(unix))]
    pub const AF_INET: u16 = 2;
    #[cfg(not(unix))]
    pub const AF_INET6: u16 = 23;
    pub const IN6ADDR_ANY_INIT: [u8; 16] = [0; 16];
    pub const INET6_ADDRSTRLEN: usize = 46;

    // PORT NOTE: hand-rolling the layout is wrong on Darwin/BSD where the
    // header is `{len: u8, family: u8}`, not `{family: u16}`. Use libc's
    // platform-correct definitions on POSIX.
    #[cfg(unix)]
    pub use libc::{sa_family_t, sockaddr_in, sockaddr_in6};

    #[cfg(not(unix))]
    pub type sa_family_t = u16;
    #[cfg(not(unix))]
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in {
        pub sin_family: sa_family_t,
        pub sin_port: in_port_t,
        pub sin_addr: u32,
        pub sin_zero: [u8; 8],
    }
    #[cfg(not(unix))]
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in6 {
        pub sin6_family: sa_family_t,
        pub sin6_port: in_port_t,
        pub sin6_flowinfo: u32,
        pub sin6_addr: [u8; 16],
        pub sin6_scope_id: u32,
    }
}

#[repr(u16)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AF {
    INET = inet::AF_INET,
    INET6 = inet::AF_INET6,
}
impl AF {
    #[inline]
    pub fn int(self) -> inet::sa_family_t {
        self as inet::sa_family_t
    }
}

/// Replaces `sockaddr_storage` (128 B) — 28 B is enough for in/in6.
#[allow(non_camel_case_types)]
#[repr(C)]
pub union sockaddr {
    pub sin: inet::sockaddr_in,
    pub sin6: inet::sockaddr_in6,
}
impl sockaddr {
    // PORT NOTE: `LOOPBACK_V4`/`ANY_V6` cannot be `const` initializers over
    // `libc::sockaddr_in*` (BSD has an extra `sin_len` field and `in_addr` is
    // a struct, not a `u32`). Functions returning a zeroed-then-patched value
    // are portable.
    #[inline]
    pub fn loopback_v4() -> sockaddr {
        // SAFETY: all-zero is a valid representation for sockaddr_in on every
        // supported platform.
        let mut s: sockaddr = unsafe { core::mem::zeroed() };
        // SAFETY: writing to the `sin` variant; `sin_family` is at the same
        // logical position on every platform.
        unsafe {
            s.sin.sin_family = inet::AF_INET as inet::sa_family_t;
            // 127.0.0.1 in network byte order.
            *(&mut s.sin.sin_addr as *mut _ as *mut u32) = u32::from_ne_bytes([127, 0, 0, 1]);
        }
        s
    }
    #[inline]
    pub fn any_v6() -> sockaddr {
        // SAFETY: all-zero is a valid representation for sockaddr_in6.
        let mut s: sockaddr = unsafe { core::mem::zeroed() };
        // SAFETY: writing to the `sin6` variant.
        unsafe { s.sin6.sin6_family = inet::AF_INET6 as inet::sa_family_t };
        s
    }
    #[inline]
    pub fn family(&self) -> AF {
        // SAFETY: `sin_family`/`sin6_family` are at the same offset in both
        // variants (the BSD `sin_len` byte precedes both identically).
        match unsafe { self.sin.sin_family } as u16 {
            v if v == inet::AF_INET => AF::INET,
            _ => AF::INET6,
        }
    }
}

pub struct SocketAddress {
    pub _addr: sockaddr,
    /// Cached presentation string. `.Dead` ≈ null; `.Empty` for default v4/v6.
    pub _presentation: BunString,
}
impl SocketAddress {
    #[inline]
    pub fn family(&self) -> AF {
        self._addr.family()
    }
    #[inline]
    pub fn port(&self) -> u16 {
        // SAFETY: `sin_port`/`sin6_port` are at the same offset in both variants.
        u16::from_be(unsafe { self._addr.sin.sin_port })
    }
}

// ── NewSocket / TCPSocket / TLSSocket ────────────────────────────────────────
// Heavy `bun_uws::NewSocketHandler<SSL>` user. The state machine (`SocketKind`
// + connect/upgrade transitions) lives in `socket_body.rs`; the struct shape
// is real so `Handlers::mark_inactive` / `Listener` can `@fieldParentPtr`.
pub struct NewSocket<const SSL: bool> {
    pub socket: uws::NewSocketHandler<SSL>,
    pub handlers: *mut Handlers,
    pub this_value: JSValue,
    pub poll_ref: KeepAlive,
    pub flags: SocketFlags,
}
pub type TCPSocket = NewSocket<false>;
pub type TLSSocket = NewSocket<true>;

bitflags::bitflags! {
    #[derive(Copy, Clone)]
    pub struct SocketFlags: u16 {
        const IS_ACTIVE            = 1 << 0;
        const FINALIZING           = 1 << 1;
        const AUTHORIZED           = 1 << 2;
        const HANDSHAKE_COMPLETE   = 1 << 3;
        const EMPTY_PACKET_PENDING = 1 << 4;
        const END_AFTER_FLUSH      = 1 << 5;
        const OWNED_PROTOS         = 1 << 6;
        const IS_PAUSED            = 1 << 7;
        const ALLOW_HALF_OPEN      = 1 << 8;
        const BYPASS_TLS           = 1 << 9;
    }
}
impl Default for SocketFlags {
    fn default() -> Self {
        // Zig: `owned_protos: bool = true`.
        SocketFlags::OWNED_PROTOS
    }
}

pub struct SocketConfig(());
pub mod udp_socket {
    pub struct UDPSocket(());
}

#[cfg(not(windows))]
pub type WindowsNamedPipeContext = ();

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/socket.zig
//   confidence: medium (B-2 struct/state un-gate)
//   notes:      Listener/Handlers/SocketAddress/sockaddr/AF/NewSocket real;
//               method bodies + tls_socket_functions gated on bun_jsc /
//               bun_boringssl_sys / bun_output / bun_c_ares.
// ──────────────────────────────────────────────────────────────────────────
