//! High-level socket wrapper over `us_socket_t` / `ConnectingSocket` /
//! `UpgradedDuplex` / `WindowsNamedPipe`.
//!
//! THIS IS THE ONE CANONICAL PORT of `src/uws_sys/socket.zig`. `bun_uws`
//! re-exports everything here; do NOT add a parallel `InternalSocket` /
//! `NewSocketHandler` in `bun_uws` again — the Phase-A "thin placeholder"
//! that grew full bodies there has been deleted.
//!
//! Shape: `InternalSocket` is a `Copy` tagged raw pointer (Zig passed
//! `ThisSocket` by value through the entire HTTP-client state machine), all
//! `NewSocketHandler` methods take `&self`, and the `#[cfg(windows)]` Pipe
//! split is owned exactly once by the `on_socket!` macro below.

use core::ffi::{c_int, c_uint, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_core::{Fd, ZStr};

#[cfg(windows)]
use crate::WindowsNamedPipe;
use crate::{
    CloseCode, ConnectResult, ConnectingSocket, LIBUS_SOCKET_ALLOW_HALF_OPEN,
    LIBUS_SOCKET_DESCRIPTOR, SocketGroup, SocketKind, SslCtx, UpgradedDuplex, us_bun_verify_error_t,
    us_socket_t,
};

bun_core::declare_scope!(uws, visible);

// ──────────────────────────────────────────────────────────────────────────
// CloseCode PascalCase aliases
// ──────────────────────────────────────────────────────────────────────────
// `bun_uws_sys::CloseCode` (us_socket_t.rs) keeps the Zig snake-case variant
// names (`normal`/`failure`/`fast_shutdown`). The deleted `bun_uws::CloseKind`
// duplicate used PascalCase. Expose both spellings via associated consts so
// every existing call site (`CloseCode::Normal`, `CloseKind::Failure`, …)
// resolves against the one canonical `#[repr(i32)]` enum.
#[allow(non_upper_case_globals)]
impl CloseCode {
    pub const Normal: CloseCode = CloseCode::normal;
    pub const Failure: CloseCode = CloseCode::failure;
    pub const FastShutdown: CloseCode = CloseCode::fast_shutdown;
}

// ──────────────────────────────────────────────────────────────────────────
// InternalSocket
// ──────────────────────────────────────────────────────────────────────────

/// State of a single connection. `Copy` — Zig passed `ThisSocket` by value
/// through the entire HTTP-client / Bun.Socket state machines, so the handle
/// is a trivially-copyable tagged pointer. The `UpgradedDuplex` / `Pipe`
/// payloads are raw `*mut` (NOT `&mut`): they are stored in long-lived
/// `Cell<NewSocketHandler>` fields and re-borrowed per call via the opaque
/// deref helpers below.
#[derive(Copy, Clone)]
pub enum InternalSocket {
    Connected(*mut us_socket_t),
    Connecting(*mut ConnectingSocket),
    Detached,
    UpgradedDuplex(*mut UpgradedDuplex),
    #[cfg(windows)]
    Pipe(*mut WindowsNamedPipe),
    #[cfg(not(windows))]
    Pipe,
}

// Zig `InternalSocket.eq` — variant + pointer-identity equality.
// PORT NOTE: Zig's `.pipe` arm returns `false` even for `(pipe, pipe)` on
// non-Windows (the variant carries no payload there, so identity is
// meaningless). Mirrored exactly so debug-asserts that compare sockets behave
// identically to the Zig build.
impl PartialEq for InternalSocket {
    fn eq(&self, other: &Self) -> bool {
        match (*self, *other) {
            (InternalSocket::Connected(a), InternalSocket::Connected(b)) => core::ptr::eq(a, b),
            (InternalSocket::Connecting(a), InternalSocket::Connecting(b)) => core::ptr::eq(a, b),
            (InternalSocket::Detached, InternalSocket::Detached) => true,
            (InternalSocket::UpgradedDuplex(a), InternalSocket::UpgradedDuplex(b)) => {
                core::ptr::eq(a, b)
            }
            #[cfg(windows)]
            (InternalSocket::Pipe(a), InternalSocket::Pipe(b)) => core::ptr::eq(a, b),
            #[cfg(not(windows))]
            (InternalSocket::Pipe, InternalSocket::Pipe) => false,
            _ => false,
        }
    }
}

impl InternalSocket {
    /// Zig `InternalSocket.get()` — `Some` only for `.connected`.
    #[inline]
    pub fn get(&self) -> Option<*mut us_socket_t> {
        match *self {
            InternalSocket::Connected(s) => Some(s),
            _ => None,
        }
    }
    #[inline]
    pub fn is_detached(&self) -> bool {
        matches!(self, InternalSocket::Detached)
    }
    #[inline]
    pub fn is_named_pipe(&self) -> bool {
        #[cfg(windows)]
        return matches!(self, InternalSocket::Pipe(_));
        #[cfg(not(windows))]
        return matches!(self, InternalSocket::Pipe);
    }
}

// ── Safe deref helpers for `InternalSocket` payloads ────────────────────────
// All four payload types are `#[repr(C)] UnsafeCell<[u8; 0]>` opaque ZSTs
// (`opaque_ffi!` / `opaque_extern!`): zero-sized, align-1, no `noalias` /
// `readonly`. Materializing `&mut T` from `*mut T` therefore has exactly one
// validity requirement — non-null — which uSockets guarantees for every
// pointer it stores in `Connected` / `Connecting` / `UpgradedDuplex` / `Pipe`.
// Centralizing the deref keeps the proof local instead of repeating
// `unsafe { &mut *s }` at ~50 match arms.

/// Reborrow the `InternalSocket::Connected` payload.
#[inline(always)]
fn sock<'a>(p: *mut us_socket_t) -> &'a mut us_socket_t {
    bun_opaque::opaque_deref_mut(p)
}
/// Reborrow the `InternalSocket::Connecting` payload.
#[inline(always)]
fn conn<'a>(p: *mut ConnectingSocket) -> &'a mut ConnectingSocket {
    bun_opaque::opaque_deref_mut(p)
}
/// Reborrow the `InternalSocket::UpgradedDuplex` payload (cycle-break shim).
#[inline(always)]
fn duplex<'a>(p: *mut UpgradedDuplex) -> &'a mut UpgradedDuplex {
    bun_opaque::opaque_deref_mut(p)
}
/// Reborrow the `InternalSocket::Pipe` payload (Windows only).
#[cfg(windows)]
#[inline(always)]
fn pipe<'a>(p: *mut WindowsNamedPipe) -> &'a mut WindowsNamedPipe {
    bun_opaque::opaque_deref_mut(p)
}

/// Five-arm `match self.socket` with the `#[cfg(windows)]` Pipe split owned
/// exactly once. Each arm binds the deref'd opaque (`$s` / `$c` / `$d` / `$p`)
/// so method bodies are one-liners and the per-arm `#[cfg]` noise lives here.
///
/// Arms not supplied default to: `connecting`/`detached` → `$det` expr;
/// `pipe` → `$det` on non-Windows (no payload), supplied body on Windows.
macro_rules! on_socket {
    (
        $sock:expr;
        connected $s:ident => $conn:expr,
        connecting $c:ident => $cing:expr,
        detached => $det:expr,
        duplex $d:ident => $dup:expr,
        pipe $p:ident => $pip:expr $(,)?
    ) => {
        match $sock {
            InternalSocket::Connected(__s) => { let $s = sock(__s); $conn }
            InternalSocket::Connecting(__c) => { let $c = conn(__c); $cing }
            InternalSocket::Detached => $det,
            InternalSocket::UpgradedDuplex(__d) => { let $d = duplex(__d); $dup }
            #[cfg(windows)]
            InternalSocket::Pipe(__p) => { let $p = pipe(__p); $pip }
            #[cfg(not(windows))]
            InternalSocket::Pipe => $det,
        }
    };
    // Short form: connecting/detached/pipe-absent collapse to one default.
    (
        $sock:expr;
        connected $s:ident => $conn:expr,
        duplex $d:ident => $dup:expr,
        pipe $p:ident => $pip:expr,
        else => $det:expr $(,)?
    ) => {
        on_socket!($sock;
            connected $s => $conn,
            connecting _c => { let _ = _c; $det },
            detached => $det,
            duplex $d => $dup,
            pipe $p => $pip,
        )
    };
}

// ──────────────────────────────────────────────────────────────────────────
// NewSocketHandler<IS_SSL>
// ──────────────────────────────────────────────────────────────────────────

/// Zig `NewSocketHandler(comptime is_ssl: bool)`. The const generic only
/// selects `*SSL` vs fd for `get_native_handle`; it is NOT forwarded to C —
/// TLS is per-socket there.
#[derive(Copy, Clone)]
pub struct NewSocketHandler<const IS_SSL: bool> {
    pub socket: InternalSocket,
}

pub type SocketTCP = NewSocketHandler<false>;
pub type SocketTLS = NewSocketHandler<true>;
/// snake-case aliases (match `AnySocket` variant names).
pub type SocketTcp = NewSocketHandler<false>;
pub type SocketTls = NewSocketHandler<true>;
/// Alias used by `http`, `ipc`, `websocket_client` — same type, less ceremony.
pub type SocketHandler<const SSL: bool> = NewSocketHandler<SSL>;

impl<const IS_SSL: bool> NewSocketHandler<IS_SSL> {
    pub const DETACHED: Self = Self {
        socket: InternalSocket::Detached,
    };

    /// Zig `pub const detached` — lower-case constructor form.
    #[inline]
    pub const fn detached() -> Self {
        Self::DETACHED
    }

    // ── const-generic discriminant casts ────────────────────────────────────
    // Layout is identical (single `InternalSocket` field — the bool only gates
    // `get_native_handle`); these are safe field moves with a matching debug
    // assert that the caller passed the right arm.
    #[inline]
    pub const fn assume_ssl(self) -> NewSocketHandler<true> {
        debug_assert!(IS_SSL);
        NewSocketHandler { socket: self.socket }
    }
    #[inline]
    pub const fn assume_tcp(self) -> NewSocketHandler<false> {
        debug_assert!(!IS_SSL);
        NewSocketHandler { socket: self.socket }
    }
    /// Generic counterpart of [`Self::assume_ssl`]/[`Self::assume_tcp`] for
    /// callers inside an `if IS_SSL { ... }` arm widening a concrete handle
    /// back to the surrounding `NewSocketHandler<IS_SSL>`.
    #[inline]
    pub const fn cast_ssl<const NEW_SSL: bool>(self) -> NewSocketHandler<NEW_SSL> {
        debug_assert!(IS_SSL == NEW_SSL);
        NewSocketHandler { socket: self.socket }
    }

    #[inline]
    pub fn detach(&mut self) {
        self.socket = InternalSocket::Detached;
    }
    #[inline]
    pub fn is_detached(&self) -> bool {
        self.socket.is_detached()
    }
    #[inline]
    pub fn is_named_pipe(&self) -> bool {
        self.socket.is_named_pipe()
    }

    // ── state queries ───────────────────────────────────────────────────────

    pub fn is_closed(&self) -> bool {
        on_socket!(self.socket;
            connected s => s.is_closed(),
            connecting c => c.is_closed(),
            detached => true,
            duplex d => d.is_closed(),
            pipe p => p.is_closed(),
        )
    }

    pub fn is_shutdown(&self) -> bool {
        on_socket!(self.socket;
            connected s => s.is_shutdown(),
            connecting c => c.is_shutdown(),
            detached => true,
            duplex d => d.is_shutdown(),
            pipe p => p.is_shutdown(),
        )
    }

    pub fn is_established(&self) -> bool {
        on_socket!(self.socket;
            connected s => s.is_established(),
            duplex d => d.is_established(),
            pipe p => p.is_established(),
            else => false,
        )
    }

    #[inline]
    pub fn is_closed_or_has_error(&self) -> bool {
        self.is_closed() || self.is_shutdown() || self.get_error() != 0
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        on_socket!(self.socket;
            connected s => s.get_verify_error(),
            duplex d => d.ssl_error(),
            pipe p => p.ssl_error(),
            else => us_bun_verify_error_t::default(),
        )
    }

    pub fn get_error(&self) -> i32 {
        on_socket!(self.socket;
            connected s => s.get_error(),
            connecting c => c.get_error(),
            detached => 0,
            duplex d => d.ssl_error().error_no,
            pipe p => p.ssl_error().error_no,
        )
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    pub fn close(&self, code: CloseCode) {
        on_socket!(self.socket;
            connected s => s.close(code),
            connecting c => c.close(),
            detached => {},
            duplex d => d.close(),
            pipe p => p.close(),
        )
    }

    pub fn shutdown(&self) {
        on_socket!(self.socket;
            connected s => s.shutdown(),
            connecting c => c.shutdown(),
            detached => {},
            duplex d => d.shutdown(),
            pipe p => p.shutdown(),
        )
    }

    pub fn shutdown_read(&self) {
        on_socket!(self.socket;
            connected s => s.shutdown_read(),
            connecting c => c.shutdown_read(),
            detached => {},
            duplex d => d.shutdown_read(),
            pipe p => p.shutdown_read(),
        )
    }

    // ── I/O ─────────────────────────────────────────────────────────────────

    pub fn write(&self, data: &[u8]) -> i32 {
        on_socket!(self.socket;
            connected s => s.write(data),
            duplex d => d.encode_and_write(data),
            pipe p => p.encode_and_write(data),
            else => 0,
        )
    }

    /// Write `data` and pass `file_descriptor` over the socket via SCM_RIGHTS.
    /// POSIX-only — Windows IPC fd passing goes through libuv pipes instead.
    ///
    /// LAYERING: takes the raw POSIX fd (`c_int`) rather than `bun_sys::Fd` —
    /// `bun_uws_sys` sits below `bun_sys`; callers extract `.native()` at the
    /// boundary.
    #[cfg(not(windows))]
    pub fn write_fd(&self, data: &[u8], file_descriptor: c_int) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) => sock(s).write_fd(data, Fd::from_native(file_descriptor)),
            // Mirror Zig `socket.writeFd`: duplex/pipe fall back to a plain
            // write (the fd is silently dropped).
            InternalSocket::UpgradedDuplex(_) | InternalSocket::Pipe => self.write(data),
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
        }
    }

    /// Bypass TLS — raw bytes to the fd even on a TLS socket.
    pub fn raw_write(&self, data: &[u8]) -> i32 {
        on_socket!(self.socket;
            connected s => s.raw_write(data),
            duplex d => d.raw_write(data),
            pipe p => p.raw_write(data),
            else => 0,
        )
    }

    pub fn flush(&self) {
        on_socket!(self.socket;
            connected s => s.flush(),
            duplex d => d.flush(),
            pipe p => p.flush(),
            else => {},
        )
    }

    // ── timeouts ────────────────────────────────────────────────────────────

    /// Direct seconds timeout (no long-timeout split). Mirrors Zig `timeout`.
    pub fn timeout(&self, seconds: c_uint) {
        on_socket!(self.socket;
            connected s => s.set_timeout(seconds),
            connecting c => c.timeout(seconds),
            detached => {},
            duplex d => d.set_timeout(seconds),
            pipe p => p.set_timeout(seconds),
        )
    }

    /// Splits >240s onto the minute-granularity long-timeout wheel.
    pub fn set_timeout(&self, seconds: c_uint) {
        on_socket!(self.socket;
            connected s => if seconds > 240 {
                s.set_timeout(0);
                s.set_long_timeout(seconds / 60);
            } else {
                s.set_timeout(seconds);
                s.set_long_timeout(0);
            },
            connecting c => if seconds > 240 {
                c.timeout(0);
                c.long_timeout(seconds / 60);
            } else {
                c.timeout(seconds);
                c.long_timeout(0);
            },
            detached => {},
            duplex d => d.set_timeout(seconds),
            pipe p => p.set_timeout(seconds),
        )
    }

    pub fn set_timeout_minutes(&self, minutes: c_uint) {
        on_socket!(self.socket;
            connected s => { s.set_timeout(0); s.set_long_timeout(minutes); },
            connecting c => { c.timeout(0); c.long_timeout(minutes); },
            detached => {},
            duplex d => d.set_timeout(minutes * 60),
            pipe p => p.set_timeout(minutes * 60),
        )
    }

    // ── flow control / sockopts ─────────────────────────────────────────────

    pub fn pause_stream(&self) -> bool {
        on_socket!(self.socket;
            connected s => { s.pause(); true },
            connecting _c => false,
            detached => true,
            duplex _d => false, // TODO: pause/resume upgraded duplex
            pipe p => p.pause_stream(),
        )
    }

    pub fn resume_stream(&self) -> bool {
        on_socket!(self.socket;
            connected s => { s.resume(); true },
            connecting _c => false,
            detached => true,
            duplex _d => false, // TODO: pause/resume upgraded duplex
            pipe p => p.resume_stream(),
        )
    }

    pub fn set_no_delay(&self, enabled: bool) -> bool {
        match self.socket {
            InternalSocket::Connected(s) => {
                sock(s).set_nodelay(enabled);
                true
            }
            _ => false,
        }
    }

    pub fn set_keep_alive(&self, enabled: bool, delay: u32) -> bool {
        match self.socket {
            InternalSocket::Connected(s) => sock(s).set_keepalive(enabled, delay) == 0,
            _ => false,
        }
    }

    // ── TLS ─────────────────────────────────────────────────────────────────

    /// Kick TLS open (ClientHello / accept) on an already-connected socket.
    pub fn start_tls(&self, is_client: bool) {
        if let InternalSocket::Connected(s) = self.socket {
            sock(s).open(is_client, None);
        }
    }

    /// `SSL*` if this is a TLS socket, else `None`.
    #[inline]
    pub fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        if !IS_SSL {
            return None;
        }
        self.get_native_handle().map(|h| h.cast())
    }

    /// `*SSL` when `IS_SSL`, raw fd-as-ptr otherwise. Type-erased to
    /// `*mut c_void` here because const-generic type dispatch
    /// (`NativeSocketHandleType(is_ssl)`) is unsupported in stable Rust;
    /// callers `cast()` immediately anyway.
    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        match self.socket {
            InternalSocket::Connected(s) => sock(s).get_native_handle(),
            InternalSocket::Connecting(s) => {
                let h = conn(s).get_native_handle();
                if h.is_null() { None } else { Some(h) }
            }
            InternalSocket::UpgradedDuplex(s) if IS_SSL => duplex(s).ssl().map(|p| p.cast()),
            InternalSocket::UpgradedDuplex(_) => None,
            #[cfg(windows)]
            InternalSocket::Pipe(s) if IS_SSL => pipe(s).ssl().map(|p| p.cast()),
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
            InternalSocket::Detached => None,
        }
    }

    // ── ext / group / fd ────────────────────────────────────────────────────

    /// Typed ext storage. `None` for non-uSockets transports.
    pub fn ext<T>(&self) -> Option<*mut T> {
        match self.socket {
            // Raw `*mut T` only — do NOT route through `ext::<T>()` (which
            // materializes `&mut T` and would assert validity invariants).
            InternalSocket::Connected(s) => Some(sock(s).ext_ptr().cast::<T>()),
            InternalSocket::Connecting(s) => Some(
                crate::connecting_socket::us_connecting_socket_ext(conn(s)).cast::<T>(),
            ),
            _ => None,
        }
    }

    /// Group this socket is linked into. `None` for non-uSockets transports.
    pub fn group(&self) -> Option<*mut SocketGroup> {
        match self.socket {
            InternalSocket::Connected(s) => Some(sock(s).group() as *mut SocketGroup),
            InternalSocket::Connecting(s) => Some(conn(s).group()),
            _ => None,
        }
    }

    /// Underlying fd. Same fd regardless of TLS — read directly off the poll.
    #[inline]
    pub fn fd(&self) -> Fd {
        match self.socket {
            InternalSocket::Connected(s) => sock(s).get_fd(),
            _ => Fd::INVALID,
        }
    }

    pub fn local_port(&self) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) => sock(s).local_port(),
            _ => 0,
        }
    }

    pub fn remote_port(&self) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) => sock(s).remote_port(),
            _ => 0,
        }
    }

    pub fn local_address<'b>(&self, buf: &'b mut [u8]) -> Option<&'b [u8]> {
        match self.socket {
            InternalSocket::Connected(s) => match sock(s).local_address(buf) {
                Ok(v) => Some(v),
                Err(e) => bun_core::Output::panic(format_args!(
                    "Failed to get socket's local address: {}",
                    e.name()
                )),
            },
            _ => None,
        }
    }

    pub fn remote_address<'b>(&self, buf: &'b mut [u8]) -> Option<&'b [u8]> {
        match self.socket {
            InternalSocket::Connected(s) => match sock(s).remote_address(buf) {
                Ok(v) => Some(v),
                Err(e) => bun_core::Output::panic(format_args!(
                    "Failed to get socket's remote address: {}",
                    e.name()
                )),
            },
            _ => None,
        }
    }

    pub fn mark_needs_more_for_sendfile(&self) {
        // Zig: `if (comptime is_ssl) @compileError(...)` — keep as a const assert.
        const { assert!(!IS_SSL, "SSL sockets do not support sendfile yet") };
        if let InternalSocket::Connected(s) = self.socket {
            sock(s).send_file_needs_more();
        }
    }

    // ── constructors ────────────────────────────────────────────────────────

    #[inline]
    pub fn from(socket: *mut us_socket_t) -> Self {
        Self { socket: InternalSocket::Connected(socket) }
    }
    #[inline]
    pub fn from_connecting(connecting: *mut ConnectingSocket) -> Self {
        Self { socket: InternalSocket::Connecting(connecting) }
    }
    #[inline]
    pub fn from_any(socket: InternalSocket) -> Self {
        Self { socket }
    }
    #[inline]
    pub fn from_duplex(d: *mut UpgradedDuplex) -> Self {
        Self { socket: InternalSocket::UpgradedDuplex(d) }
    }
    #[cfg(windows)]
    #[inline]
    pub fn from_named_pipe(p: *mut WindowsNamedPipe) -> Self {
        Self { socket: InternalSocket::Pipe(p) }
    }

    /// Wrap an already-open fd. Ext stores `*mut This`; the socket is linked
    /// into `g` with kind `k`. Port of `NewSocketHandler.fromFd`.
    pub fn from_fd<This>(
        g: &mut SocketGroup,
        k: SocketKind,
        handle: Fd,
        this: *mut This,
        is_ipc: bool,
    ) -> Option<Self> {
        // Zig `?*This` is null-niche optimized (8 bytes); the dispatch
        // trampolines read the ext slot as `Option<NonNull<_>>`, so size and
        // write must match that layout — NOT `Option<*mut This>` (16 bytes).
        let ext_size = size_of::<Option<NonNull<This>>>() as c_int;
        let raw = g.from_fd(k, None, ext_size, handle.native() as LIBUS_SOCKET_DESCRIPTOR, is_ipc);
        if raw.is_null() {
            return None;
        }
        // ext storage was sized for `?*This` above; `raw` is a freshly-created
        // live socket. `ext::<T>()` is sound here because we immediately
        // overwrite the slot, never reading the prior (zeroed) bit pattern.
        *sock(raw).ext::<Option<NonNull<This>>>() = NonNull::new(this);
        Some(Self { socket: InternalSocket::Connected(raw) })
    }

    /// Connect via a `SocketGroup` and stash `owner` in the socket ext.
    /// Replaces the deleted `connectAnon`/`connectPtr`.
    pub fn connect_group<Owner>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        raw_host: &[u8],
        port: c_int,
        owner: *mut Owner,
        allow_half_open: bool,
    ) -> Result<Self, ConnectError> {
        let opts: c_int = if allow_half_open { LIBUS_SOCKET_ALLOW_HALF_OPEN } else { 0 };
        // getaddrinfo doesn't understand bracketed IPv6 literals; URL parsing
        // leaves them in (`[::1]`), so strip here like the old connectAnon did.
        let host =
            if raw_host.len() > 1 && raw_host[0] == b'[' && raw_host[raw_host.len() - 1] == b']' {
                &raw_host[1..raw_host.len() - 1]
            } else {
                raw_host
            };
        // SocketGroup.connect needs a NUL-terminated host.
        let mut stack = [0u8; 256];
        let heap: Vec<u8>;
        let host_z: &core::ffi::CStr = if host.len() < stack.len() {
            stack[..host.len()].copy_from_slice(host);
            stack[host.len()] = 0;
            ZStr::from_buf(&stack, host.len()).as_cstr()
        } else {
            heap = {
                let mut v = Vec::with_capacity(host.len() + 1);
                v.extend_from_slice(host);
                v.push(0);
                v
            };
            ZStr::from_slice_with_nul(&heap).as_cstr()
        };

        // Zig `?*Owner` is null-niche optimized (8 bytes); the dispatch
        // trampolines read the ext slot as `Option<NonNull<_>>`, so size and
        // write must match that layout — NOT `Option<*mut Owner>` (16 bytes,
        // discriminant-first), which would hand the trampoline `1` instead of
        // the owner pointer.
        let ext_size = size_of::<Option<NonNull<Owner>>>() as c_int;
        match g.connect(kind, ssl_ctx, host_z, port, opts, ext_size) {
            ConnectResult::Failed => Err(ConnectError::FailedToOpenSocket),
            ConnectResult::Socket(s) => {
                *sock(s).ext::<Option<NonNull<Owner>>>() = NonNull::new(owner);
                Ok(Self { socket: InternalSocket::Connected(s) })
            }
            ConnectResult::Connecting(cs) => {
                *conn(cs).ext::<Option<NonNull<Owner>>>() = NonNull::new(owner);
                Ok(Self { socket: InternalSocket::Connecting(cs) })
            }
        }
    }

    pub fn connect_unix_group<Owner>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        path: &[u8],
        owner: *mut Owner,
        allow_half_open: bool,
    ) -> Result<Self, ConnectError> {
        let opts: c_int = if allow_half_open { LIBUS_SOCKET_ALLOW_HALF_OPEN } else { 0 };
        // Zig `?*Owner` — see connect_group above for layout rationale.
        let ext_size = size_of::<Option<NonNull<Owner>>>() as c_int;
        let s = g.connect_unix(kind, ssl_ctx, path, opts, ext_size);
        if s.is_null() {
            return Err(ConnectError::FailedToOpenSocket);
        }
        *sock(s).ext::<Option<NonNull<Owner>>>() = NonNull::new(owner);
        Ok(Self { socket: InternalSocket::Connected(s) })
    }

    /// Move an open socket into a new group/kind, stashing `owner` in the ext.
    /// Replaces `Socket.adoptPtr`.
    ///
    /// `set_socket_field` replaces Zig's `comptime field: []const u8` +
    /// `@field(owner, field)` reflection — the closure writes the resulting
    /// `Self` into the owner's socket field via the raw `*mut Owner` (passing
    /// `&mut Owner` here would alias any live `&mut` the caller already holds).
    pub fn adopt_group<Owner>(
        tcp: *mut us_socket_t,
        g: *mut SocketGroup,
        kind: SocketKind,
        owner: *mut Owner,
        set_socket_field: impl FnOnce(*mut Owner, Self),
    ) -> bool {
        // SAFETY: `tcp` and `g` are non-null FFI handles; ext sizes are word-sized.
        let new_s = unsafe {
            sock_c::us_socket_adopt(
                tcp,
                g,
                kind as u8,
                size_of::<*mut c_void>() as i32,
                size_of::<*mut c_void>() as i32,
            )
        };
        if new_s.is_null() {
            return false;
        }
        *sock(new_s).ext::<*mut c_void>() = owner.cast::<c_void>();
        // Forward the raw pointer — do NOT materialize `&mut *owner` here:
        // callers (e.g. websocket_client) hold a live `&mut Owner` across this
        // call, so creating a second one would be aliased UB. The closure
        // performs the field write through the raw pointer itself.
        set_socket_field(owner, Self { socket: InternalSocket::Connected(new_s) });
        true
    }
}

/// Residual raw FFI: `adopt` takes a raw `*mut SocketGroup` from a caller
/// that already holds it as raw, and `SocketGroup` is a sized `#[repr(C)]`
/// mirror (not an opaque ZST), so `opaque_deref_mut` can't help.
mod sock_c {
    use super::{SocketGroup, us_socket_t};
    unsafe extern "C" {
        pub(super) fn us_socket_adopt(
            s: *mut us_socket_t,
            group: *mut SocketGroup,
            kind: u8,
            old_ext_size: i32,
            ext_size: i32,
        ) -> *mut us_socket_t;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ConnectError
// ──────────────────────────────────────────────────────────────────────────

#[derive(strum::IntoStaticStr, Debug)]
pub enum ConnectError {
    FailedToOpenSocket,
}
impl From<ConnectError> for bun_core::Error {
    fn from(_: ConnectError) -> Self {
        bun_core::err!("FailedToOpenSocket")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AnySocket
// ──────────────────────────────────────────────────────────────────────────

/// TODO: rename to ConnectedSocket
#[derive(Copy, Clone)]
pub enum AnySocket {
    SocketTcp(SocketTCP),
    SocketTls(SocketTLS),
}

/// Stamp out `AnySocket::$m` as a two-arm forward to `NewSocketHandler<SSL>::$m`.
/// Mirrors Zig `switch (this) { inline else => |s| s.$m(...) }` (socket.zig:532-628).
macro_rules! any_socket_forward {
    ($( fn $name:ident(&self $(, $arg:ident : $ty:ty)* ) $(-> $ret:ty)? ; )*) => {$(
        #[inline]
        pub fn $name(&self $(, $arg: $ty)*) $(-> $ret)? {
            match self {
                AnySocket::SocketTcp(s) => s.$name($($arg),*),
                AnySocket::SocketTls(s) => s.$name($($arg),*),
            }
        }
    )*};
}

impl AnySocket {
    #[inline]
    pub fn is_ssl(&self) -> bool {
        matches!(self, AnySocket::SocketTls(_))
    }
    #[inline]
    pub fn socket(&self) -> &InternalSocket {
        match self {
            AnySocket::SocketTcp(s) => &s.socket,
            AnySocket::SocketTls(s) => &s.socket,
        }
    }
    #[inline]
    pub fn ext<T>(&self) -> Option<*mut T> {
        match self {
            AnySocket::SocketTcp(s) => s.ext::<T>(),
            AnySocket::SocketTls(s) => s.ext::<T>(),
        }
    }
    #[inline]
    pub fn terminate(&self) {
        self.close(CloseCode::failure)
    }
    #[inline]
    pub fn group(&self) -> *mut SocketGroup {
        // Zig had `@setRuntimeSafety(true)` — Rust always panics on `.unwrap()`.
        match self {
            AnySocket::SocketTcp(s) => s.group(),
            AnySocket::SocketTls(s) => s.group(),
        }
        .unwrap()
    }

    any_socket_forward! {
        fn is_closed(&self) -> bool;
        fn is_shutdown(&self) -> bool;
        fn close(&self, code: CloseCode);
        fn write(&self, data: &[u8]) -> i32;
        fn set_timeout(&self, seconds: c_uint);
        fn shutdown(&self);
        fn shutdown_read(&self);
        fn local_port(&self) -> i32;
        fn get_native_handle(&self) -> Option<*mut c_void>;
    }
}

// ported from: src/uws_sys/socket.zig
