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
#[path = "SSLConfig.rs"]
pub mod ssl_config;
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
type Strong = crate::jsc::Strong<JSValue>;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum SocketMode {
    #[default]
    Client,
    Server,
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
    pub type sa_family_t = u16;
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

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in {
        pub family: sa_family_t,
        pub port: in_port_t,
        pub addr: u32,
        pub zero: [u8; 8],
    }
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in6 {
        pub family: sa_family_t,
        pub port: in_port_t,
        pub flowinfo: u32,
        pub addr: [u8; 16],
        pub scope_id: u32,
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
    pub const LOOPBACK_V4: sockaddr = sockaddr {
        sin: inet::sockaddr_in {
            family: inet::AF_INET,
            port: 0,
            addr: u32::from_ne_bytes([127, 0, 0, 1]),
            zero: [0; 8],
        },
    };
    pub const ANY_V6: sockaddr = sockaddr {
        sin6: inet::sockaddr_in6 {
            family: inet::AF_INET6,
            port: 0,
            flowinfo: 0,
            addr: inet::IN6ADDR_ANY_INIT,
            scope_id: 0,
        },
    };
    #[inline]
    pub fn family(&self) -> AF {
        // SAFETY: family is at the same offset in both variants
        match unsafe { self.sin.family } {
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
        // SAFETY: port is at the same offset in both variants
        u16::from_be(unsafe { self._addr.sin.port })
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
    #[derive(Copy, Clone, Default)]
    pub struct SocketFlags: u16 {
        const IS_ACTIVE              = 1 << 0;
        const FINALIZING             = 1 << 1;
        const AUTHORIZED             = 1 << 2;
        const HANDSHAKE_COMPLETE     = 1 << 3;
        const ALLOW_HALF_OPEN        = 1 << 4;
        const END_EMITTED            = 1 << 5;
        const CLOSE_EMITTED          = 1 << 6;
        const CONNECT_EMITTED        = 1 << 7;
        const OWNS_CONTEXT           = 1 << 8;
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
