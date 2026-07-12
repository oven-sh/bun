//! Consumer-facing handles. Method surface preserved verbatim from
//! consumers/01-api-surface.md §2/§7; internals per api.md §Handle surface
//! (`SocketRef` generational handles replace raw `*mut us_socket_t`).
//! Stale-generation behavior == Detached behavior for every method.

use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

use bun_core::Fd;

use crate::connecting::{self, ConnectingSocket};
use crate::group::{ConnectResult, SocketGroup};
use crate::kind::SocketKind;
use crate::socket::{SocketHeader, us_socket_t};
use crate::tls::SSL;
use crate::tls::context::{SslCtx, ssl_ctx_unref, us_bun_verify_error_t};
use crate::unsafe_core::ext as uext;
use crate::unsafe_core::ffi::duplex;
#[cfg(windows)]
use crate::unsafe_core::ffi::named_pipe;
use crate::unsafe_core::{ffi, slab};
use crate::write::UsIoVec;
use crate::LIBUS_SOCKET_ALLOW_HALF_OPEN;

// ──────────────────────────────────────────────────────────────────────────
// CloseCode
// ──────────────────────────────────────────────────────────────────────────

/// Close semantics selector (`LIBUS_SOCKET_CLOSE_CODE_*`, contract C12).
#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
#[allow(non_camel_case_types)]
pub enum CloseCode {
    /// TLS: send close_notify, defer fd close until peer replies; TCP: FIN.
    normal = 0,
    /// TLS: fast-shutdown; TCP: SO_LINGER{1,0} → RST dropping unflushed
    /// buffer. For `terminate()` / GC abort.
    failure = 1,
    /// TLS: fast-shutdown; TCP: FIN. For `_handle.close()` where JS detaches
    /// immediately but written data must drain.
    fast_shutdown = 2,
}

#[allow(non_upper_case_globals)]
impl CloseCode {
    pub const Normal: CloseCode = CloseCode::normal;
    pub const Failure: CloseCode = CloseCode::failure;
    pub const FastShutdown: CloseCode = CloseCode::fast_shutdown;
}

// ──────────────────────────────────────────────────────────────────────────
// Generational references
// ──────────────────────────────────────────────────────────────────────────

/// 16-byte Copy generational handle to a slab-resident socket header.
/// Every operation validates the generation against the slab slot; a
/// mismatch behaves exactly like `Detached` (no-op / 0 / None). Reading a
/// stale slot is safe: slab memory is never returned to the OS while the
/// loop lives (api.md §Strategy 1-2).
// `gen` is a reserved keyword in edition 2024, hence `generation`.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct SocketRef {
    pub ptr: NonNull<SocketHeader>,
    pub generation: u32,
}

impl SocketRef {
    /// Capture the current generation of a live slab-resident header.
    pub fn from_live(ptr: NonNull<SocketHeader>) -> SocketRef {
        SocketRef {
            ptr,
            generation: slab::generation_of(ptr),
        }
    }

    /// `Some(ptr)` iff the generation still matches (slot not recycled).
    pub(crate) fn resolve(self) -> Option<NonNull<SocketHeader>> {
        (slab::generation_of(self.ptr) == self.generation).then_some(self.ptr)
    }
}

/// Generational handle to an in-flight connect (connecting.rs).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct ConnectingRef {
    pub ptr: NonNull<ConnectingSocket>,
    pub generation: u32,
}

impl ConnectingRef {
    /// Capture the current generation of a live connecting-socket slot.
    pub fn from_live(ptr: NonNull<ConnectingSocket>) -> ConnectingRef {
        ConnectingRef {
            ptr,
            generation: slab::generation_of(ptr),
        }
    }

    pub(crate) fn resolve(self) -> Option<NonNull<ConnectingSocket>> {
        (slab::generation_of(self.ptr) == self.generation).then_some(self.ptr)
    }
}

/// Generation-validated reborrow; `None` == stale == Detached behavior.
/// ONLY for methods that cannot dispatch consumer callbacks: a re-entrant
/// `header_mut` inside a dispatch would invalidate this `&mut` while its
/// frame is live (C17) — dispatch-capable paths go raw via `r.resolve()`.
fn sock<'a>(r: SocketRef) -> Option<&'a mut SocketHeader> {
    r.resolve().map(|p| uext::header_mut(p.as_ptr()))
}

/// Connecting sockets are accessed via `connecting::*_raw` on the resolved
/// pointer — never through `&mut ConnectingSocket` (pending window, C13).
fn conn_ptr(r: ConnectingRef) -> Option<*mut ConnectingSocket> {
    r.resolve().map(NonNull::as_ptr)
}

// ──────────────────────────────────────────────────────────────────────────
// Opaque non-socket transports
// ──────────────────────────────────────────────────────────────────────────

/// Opaque handle implemented in `bun_runtime::socket` (cycle-break shim,
/// consumers/01-api-surface.md §10).
#[repr(C)]
pub struct UpgradedDuplex {
    _opaque: [u8; 0],
}

#[cfg(windows)]
#[repr(C)]
pub struct WindowsNamedPipe {
    _opaque: [u8; 0],
}

// ──────────────────────────────────────────────────────────────────────────
// InternalSocket
// ──────────────────────────────────────────────────────────────────────────

/// State of a single connection. `Copy` — passed by value through the
/// HTTP-client / Bun.Socket state machines.
#[derive(Copy, Clone)]
pub enum InternalSocket {
    Connected(SocketRef),
    Connecting(ConnectingRef),
    Detached,
    UpgradedDuplex(*mut UpgradedDuplex),
    #[cfg(windows)]
    Pipe(*mut WindowsNamedPipe),
    #[cfg(not(windows))]
    Pipe,
}

// Variant + pointer-identity equality; `(Pipe, Pipe)` is deliberately `false`
// on non-Windows (no payload → identity is meaningless), matching the
// original `InternalSocket.eq` semantics.
impl PartialEq for InternalSocket {
    fn eq(&self, other: &Self) -> bool {
        match (*self, *other) {
            (InternalSocket::Connected(a), InternalSocket::Connected(b)) => a == b,
            (InternalSocket::Connecting(a), InternalSocket::Connecting(b)) => a == b,
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
    /// `Some` only for `Connected`.
    #[inline]
    pub fn get(&self) -> Option<SocketRef> {
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

// ──────────────────────────────────────────────────────────────────────────
// NewSocketHandler<IS_SSL>
// ──────────────────────────────────────────────────────────────────────────

/// The const generic only selects `SSL*` vs fd for `get_native_handle`; TLS
/// itself is per-socket (`Transport`).
#[derive(Copy, Clone)]
pub struct NewSocketHandler<const IS_SSL: bool> {
    pub socket: InternalSocket,
}

pub type SocketTCP = NewSocketHandler<false>;
pub type SocketTLS = NewSocketHandler<true>;
pub type SocketTcp = NewSocketHandler<false>;
pub type SocketTls = NewSocketHandler<true>;
pub type SocketHandler<const SSL: bool> = NewSocketHandler<{ SSL }>;

impl<const IS_SSL: bool> NewSocketHandler<IS_SSL> {
    pub const DETACHED: Self = Self {
        socket: InternalSocket::Detached,
    };

    /// Constructor form of [`Self::DETACHED`].
    #[inline]
    pub const fn detached() -> Self {
        Self::DETACHED
    }

    // ── const-generic discriminant casts (debug-asserted) ───────────────────

    #[inline]
    pub const fn assume_ssl(self) -> NewSocketHandler<true> {
        debug_assert!(IS_SSL);
        NewSocketHandler {
            socket: self.socket,
        }
    }
    #[inline]
    pub const fn assume_tcp(self) -> NewSocketHandler<false> {
        debug_assert!(!IS_SSL);
        NewSocketHandler {
            socket: self.socket,
        }
    }
    #[inline]
    pub const fn cast_ssl<const NEW_SSL: bool>(self) -> NewSocketHandler<NEW_SSL> {
        debug_assert!(IS_SSL == NEW_SSL);
        NewSocketHandler {
            socket: self.socket,
        }
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

    // ── io ──────────────────────────────────────────────────────────────────

    /// Raw-TCP write that also reports a fatal send error; non-Connected and
    /// duplex/pipe fall back to the plain write (no fatal signal).
    /// Write paths go raw: TLS writes can dispatch (on_handshake), so no
    /// `&mut SocketHeader` may span the call (C17).
    pub fn write_check_error(&self, data: &[u8]) -> (i32, bool) {
        match self.socket {
            InternalSocket::Connected(r) => match r.resolve() {
                Some(p) => crate::write::write_check_error(p.as_ptr(), data),
                None => (0, false),
            },
            InternalSocket::UpgradedDuplex(d) => (duplex::encode_and_write(d, data), false),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => (named_pipe::encode_and_write(p, data), false),
            _ => (0, false),
        }
    }

    pub fn write(&self, data: &[u8]) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => r
                .resolve()
                .map_or(0, |p| crate::write::write(p.as_ptr(), data)),
            InternalSocket::UpgradedDuplex(d) => duplex::encode_and_write(d, data),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::encode_and_write(p, data),
            _ => 0,
        }
    }

    /// POSIX only; duplex/pipe drop the fd and do a plain write.
    pub fn write_fd(&self, data: &[u8], fd: c_int) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => match r.resolve() {
                #[cfg(not(windows))]
                Some(p) => crate::write::write_fd(p.as_ptr(), data, Fd::from_native(fd)),
                #[cfg(windows)]
                Some(p) => {
                    let _ = (p, fd);
                    unreachable!("write_fd is not implemented on Windows")
                }
                None => 0,
            },
            #[cfg(windows)]
            InternalSocket::Pipe(_) => self.write(data),
            #[cfg(not(windows))]
            InternalSocket::Pipe => self.write(data),
            InternalSocket::UpgradedDuplex(_) => self.write(data),
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
        }
    }

    /// One writev on a real socket; sequential raw writes on duplex/pipe.
    pub fn raw_writev(&self, iov: &[UsIoVec]) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => r
                .resolve()
                .map_or(0, |p| crate::write::raw_writev(p.as_ptr(), iov)),
            InternalSocket::UpgradedDuplex(d) => {
                let mut total: i32 = 0;
                for v in iov {
                    let slice = ffi::iovec_as_slice(v);
                    let w = duplex::raw_write(d, slice);
                    if w > 0 {
                        total += w;
                    }
                    if w < slice.len() as i32 {
                        break;
                    }
                }
                total
            }
            #[cfg(windows)]
            InternalSocket::Pipe(p) => {
                let mut total: i32 = 0;
                for v in iov {
                    let slice = ffi::iovec_as_slice(v);
                    let w = named_pipe::raw_write(p, slice);
                    if w > 0 {
                        total += w;
                    }
                    if w < slice.len() as i32 {
                        break;
                    }
                }
                total
            }
            _ => 0,
        }
    }

    /// Two-buffer write (frame header + payload, no copy); Connected only —
    /// the POSIX writev fast path has no duplex/pipe equivalent.
    /// Raw entry: TLS writes can dispatch (C17).
    pub fn write2(&self, first: &[u8], second: &[u8]) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => r
                .resolve()
                .map_or(0, |p| crate::write::write2(p.as_ptr(), first, second)),
            _ => 0,
        }
    }

    /// Bypass TLS even if `is_tls()`.
    pub fn raw_write(&self, data: &[u8]) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => r
                .resolve()
                .map_or(0, |p| crate::write::raw_write(p.as_ptr(), data)),
            InternalSocket::UpgradedDuplex(d) => duplex::raw_write(d, data),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::raw_write(p, data),
            _ => 0,
        }
    }

    pub fn flush(&self) {
        match self.socket {
            InternalSocket::Connected(r) => {
                if let Some(p) = r.resolve() {
                    crate::write::flush(p.as_ptr());
                }
            }
            InternalSocket::UpgradedDuplex(d) => duplex::flush(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::flush(p),
            _ => {}
        }
    }

    // ── state ───────────────────────────────────────────────────────────────

    pub fn is_closed(&self) -> bool {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).is_none_or(|h| h.is_closed()),
            InternalSocket::Connecting(r) => conn_ptr(r).is_none_or(connecting::is_closed_raw),
            InternalSocket::Detached => true,
            InternalSocket::UpgradedDuplex(d) => duplex::is_closed(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::is_closed(p),
            #[cfg(not(windows))]
            InternalSocket::Pipe => true,
        }
    }

    pub fn is_shutdown(&self) -> bool {
        match self.socket {
            // TLS-aware query (SSL SENT_SHUTDOWN counts) — R3.21.
            InternalSocket::Connected(r) => match r.resolve() {
                Some(p) => crate::socket::is_shut_down_full(p.as_ptr()),
                None => true,
            },
            InternalSocket::Connecting(r) => conn_ptr(r).is_none_or(connecting::is_shutdown_raw),
            InternalSocket::Detached => true,
            InternalSocket::UpgradedDuplex(d) => duplex::is_shutdown(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::is_shutdown(p),
            #[cfg(not(windows))]
            InternalSocket::Pipe => true,
        }
    }

    pub fn is_established(&self) -> bool {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).is_some_and(|h| h.is_established()),
            InternalSocket::UpgradedDuplex(d) => duplex::is_established(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::is_established(p),
            _ => false,
        }
    }

    #[inline]
    pub fn is_closed_or_has_error(&self) -> bool {
        self.is_closed() || self.is_shutdown() || self.get_error() != 0
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        match self.socket {
            InternalSocket::Connected(r) => {
                sock(r).map_or_else(us_bun_verify_error_t::default, |h| h.get_verify_error())
            }
            InternalSocket::UpgradedDuplex(d) => duplex::ssl_error(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::ssl_error(p),
            _ => us_bun_verify_error_t::default(),
        }
    }

    /// errno namespace (distinct from `dns_error`).
    pub fn get_error(&self) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map_or(0, |h| h.get_error()),
            InternalSocket::Connecting(r) => conn_ptr(r).map_or(0, connecting::get_error_raw),
            InternalSocket::Detached => 0,
            InternalSocket::UpgradedDuplex(d) => duplex::ssl_error(d).error_no,
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::ssl_error(p).error_no,
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
        }
    }

    /// Raw getaddrinfo rc for `Connecting`; 0 otherwise.
    pub fn dns_error(&self) -> i32 {
        match self.socket {
            InternalSocket::Connecting(r) => conn_ptr(r).map_or(0, connecting::get_dns_error_raw),
            _ => 0,
        }
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    pub fn close(&self, code: CloseCode) {
        match self.socket {
            InternalSocket::Connected(r) => {
                // Raw entry: on_close / on_handshake re-entry must not see a
                // live `&mut SocketHeader` from this frame (C17).
                if let Some(p) = r.resolve() {
                    crate::socket::socket_close(p.as_ptr(), code, core::ptr::null_mut());
                }
            }
            InternalSocket::Connecting(r) => {
                // Raw entry: the synchronous connecting_error dispatch may
                // re-enter through an aliasing handle (C17).
                if let Some(c) = conn_ptr(r) {
                    connecting::close_raw(c);
                }
            }
            InternalSocket::UpgradedDuplex(d) => duplex::close(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::close(p),
            _ => {}
        }
    }

    pub fn shutdown(&self) {
        match self.socket {
            InternalSocket::Connected(r) => {
                // Raw entry: the TLS shutdown path can fire on_handshake (C17).
                if let Some(p) = r.resolve() {
                    crate::socket::socket_shutdown(p.as_ptr());
                }
            }
            InternalSocket::Connecting(r) => {
                if let Some(c) = conn_ptr(r) {
                    connecting::shutdown_raw(c);
                }
            }
            InternalSocket::UpgradedDuplex(d) => duplex::shutdown(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::shutdown(p),
            _ => {}
        }
    }

    pub fn shutdown_read(&self) {
        match self.socket {
            InternalSocket::Connected(r) => {
                if let Some(h) = sock(r) {
                    h.shutdown_read();
                }
            }
            InternalSocket::Connecting(r) => {
                if let Some(c) = conn_ptr(r) {
                    connecting::shutdown_read_raw(c);
                }
            }
            InternalSocket::UpgradedDuplex(d) => duplex::shutdown_read(d),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::shutdown_read(p),
            _ => {}
        }
    }

    // ── timeouts / options ──────────────────────────────────────────────────

    /// Direct seconds-wheel set; no long-timeout split.
    pub fn timeout(&self, seconds: c_uint) {
        match self.socket {
            InternalSocket::Connected(r) => {
                if let Some(h) = sock(r) {
                    h.set_timeout(seconds);
                }
            }
            InternalSocket::Connecting(r) => {
                if let Some(c) = conn_ptr(r) {
                    connecting::timeout_raw(c, seconds);
                }
            }
            InternalSocket::UpgradedDuplex(d) => duplex::set_timeout(d, seconds),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::set_timeout(p, seconds),
            _ => {}
        }
    }

    /// >240 s splits onto the minute-granularity long-timeout wheel (C9).
    pub fn set_timeout(&self, seconds: c_uint) {
        match self.socket {
            InternalSocket::Connected(r) => {
                if let Some(h) = sock(r) {
                    if seconds > 240 {
                        h.set_timeout(0);
                        h.set_long_timeout(seconds / 60);
                    } else {
                        h.set_timeout(seconds);
                        h.set_long_timeout(0);
                    }
                }
            }
            InternalSocket::Connecting(r) => {
                if let Some(c) = conn_ptr(r) {
                    if seconds > 240 {
                        connecting::timeout_raw(c, 0);
                        connecting::long_timeout_raw(c, seconds / 60);
                    } else {
                        connecting::timeout_raw(c, seconds);
                        connecting::long_timeout_raw(c, 0);
                    }
                }
            }
            InternalSocket::UpgradedDuplex(d) => duplex::set_timeout(d, seconds),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::set_timeout(p, seconds),
            _ => {}
        }
    }

    pub fn set_timeout_minutes(&self, minutes: c_uint) {
        match self.socket {
            InternalSocket::Connected(r) => {
                if let Some(h) = sock(r) {
                    h.set_timeout(0);
                    h.set_long_timeout(minutes);
                }
            }
            InternalSocket::Connecting(r) => {
                if let Some(c) = conn_ptr(r) {
                    connecting::timeout_raw(c, 0);
                    connecting::long_timeout_raw(c, minutes);
                }
            }
            InternalSocket::UpgradedDuplex(d) => duplex::set_timeout(d, minutes * 60),
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::set_timeout(p, minutes * 60),
            _ => {}
        }
    }

    pub fn pause_stream(&self) -> bool {
        match self.socket {
            InternalSocket::Connected(r) => match sock(r) {
                Some(h) => {
                    h.pause();
                    true
                }
                None => true, // stale == Detached behavior (true)
            },
            InternalSocket::Connecting(_) => false,
            InternalSocket::Detached => true,
            // TODO: pause/resume upgraded duplex (parity with the old code).
            InternalSocket::UpgradedDuplex(_) => false,
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::pause_stream(p),
            // Never constructed off-Windows; the old on_socket! macro routed
            // it to the detached default (true).
            #[cfg(not(windows))]
            InternalSocket::Pipe => true,
        }
    }

    pub fn resume_stream(&self) -> bool {
        match self.socket {
            InternalSocket::Connected(r) => match sock(r) {
                Some(h) => {
                    h.resume();
                    true
                }
                None => true,
            },
            InternalSocket::Connecting(_) => false,
            InternalSocket::Detached => true,
            InternalSocket::UpgradedDuplex(_) => false,
            #[cfg(windows)]
            InternalSocket::Pipe(p) => named_pipe::resume_stream(p),
            #[cfg(not(windows))]
            InternalSocket::Pipe => true,
        }
    }

    pub fn set_no_delay(&self, enabled: bool) -> bool {
        match self.socket {
            InternalSocket::Connected(r) => match sock(r) {
                Some(h) => {
                    h.set_nodelay(enabled);
                    true
                }
                None => false,
            },
            _ => false,
        }
    }

    pub fn set_keep_alive(&self, enabled: bool, delay: u32) -> bool {
        match self.socket {
            InternalSocket::Connected(r) => {
                sock(r).is_some_and(|h| h.set_keepalive(enabled, delay) == 0)
            }
            _ => false,
        }
    }

    /// Non-Connected reports -9 (-EBADF, node no-handle fallback).
    pub fn set_tos(&self, tos: i32) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map_or(-9, |h| h.set_tos(tos)),
            _ => -9,
        }
    }

    pub fn get_tos(&self) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map_or(-9, |h| h.get_tos()),
            _ => -9,
        }
    }

    // ── TLS ─────────────────────────────────────────────────────────────────

    /// Non-Connected frees the passed (owned) SSL_CTX ref. Raw entry: resumes
    /// the handshake driver, which dispatches (C17).
    pub fn sni_resolve(&self, ctx: *mut SslCtx, error: bool) {
        match self.socket {
            InternalSocket::Connected(r) => match r.resolve() {
                Some(p) => crate::socket::socket_sni_resolve(p.as_ptr(), ctx, error),
                None => release_ctx(ctx),
            },
            _ => release_ctx(ctx),
        }
    }

    /// Kick TLS open on an already-connected socket (the `us_socket_open`
    /// path). Raw entry: dispatches on_open / on_handshake (C17).
    pub fn start_tls(&self, is_client: bool) {
        if let InternalSocket::Connected(r) = self.socket {
            if let Some(p) = r.resolve() {
                crate::socket::socket_open(p.as_ptr(), is_client, &[]);
            }
        }
    }

    /// Kick the deferred post-adopt handshake (C10 split: adopt → repoint
    /// ext → handshake). Raw entry: SSL_do_handshake dispatches on_handshake
    /// and the ALPN/SNI callbacks (C17).
    pub fn start_tls_handshake(&self) {
        if let InternalSocket::Connected(r) = self.socket {
            if let Some(p) = r.resolve() {
                crate::socket::socket_start_tls_handshake(p.as_ptr());
            }
        }
    }

    /// Feed already-read wire bytes through the TLS decrypt path. Raw entry:
    /// dispatches decrypted on_data / on_handshake (C17).
    pub fn tls_feed(&self, data: &[u8]) {
        if let InternalSocket::Connected(r) = self.socket {
            if let Some(p) = r.resolve() {
                crate::socket::socket_tls_feed(p.as_ptr(), data);
            }
        }
    }

    /// Tee inbound ciphertext to the ssl_raw_tap hook (flag write; no dispatch).
    pub fn set_ssl_raw_tap(&self, enabled: bool) {
        if let InternalSocket::Connected(r) = self.socket {
            if let Some(h) = sock(r) {
                h.set_ssl_raw_tap(enabled);
            }
        }
    }

    /// `None` unless `IS_SSL`.
    pub fn ssl(&self) -> Option<*mut SSL> {
        if !IS_SSL {
            return None;
        }
        self.get_native_handle().map(|h| h.cast())
    }

    /// `SSL*` when `IS_SSL`, fd-as-pointer otherwise.
    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).and_then(|h| h.get_native_handle()),
            // `(void*)-1` for live connecting sockets (R3.24, R6.13).
            InternalSocket::Connecting(r) => conn_ptr(r).map(|_| usize::MAX as *mut c_void),
            InternalSocket::UpgradedDuplex(d) if IS_SSL => {
                let p = duplex::ssl(d);
                if p.is_null() { None } else { Some(p) }
            }
            InternalSocket::UpgradedDuplex(_) => None,
            #[cfg(windows)]
            InternalSocket::Pipe(p) if IS_SSL => {
                let h = named_pipe::ssl(p);
                if h.is_null() { None } else { Some(h) }
            }
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
            InternalSocket::Detached => None,
        }
    }

    // ── identity ────────────────────────────────────────────────────────────

    /// Raw ext pointer (`None` for duplex/pipe/detached). Raw `*mut T` only —
    /// never materializes `&mut T` (validity is the caller's), and derived
    /// without `&mut SocketHeader` so a stored copy survives later header
    /// reborrows (C17).
    pub fn ext<T>(&self) -> Option<*mut T> {
        match self.socket {
            InternalSocket::Connected(r) => r
                .resolve()
                .map(|p| uext::ext_ptr_raw(p.as_ptr()).cast::<T>()),
            InternalSocket::Connecting(r) => {
                conn_ptr(r).map(|c| connecting::ext_place_raw(c).cast::<T>())
            }
            _ => None,
        }
    }

    /// Dispatch tag; `Invalid` for non-Connected/stale handles.
    pub fn kind(&self) -> SocketKind {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map_or(SocketKind::Invalid, |h| h.kind()),
            _ => SocketKind::Invalid,
        }
    }

    /// Re-stamp the dispatch tag in place (accept-path Listener → BunSocket).
    pub fn set_kind(&self, kind: SocketKind) {
        if let InternalSocket::Connected(r) = self.socket {
            if let Some(h) = sock(r) {
                h.set_kind(kind);
            }
        }
    }

    pub fn group(&self) -> Option<*mut SocketGroup> {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map(|h| h.raw_group()),
            InternalSocket::Connecting(r) => conn_ptr(r).map(connecting::group_raw),
            _ => None,
        }
    }

    /// `Fd::INVALID` unless `Connected`.
    pub fn fd(&self) -> Fd {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map_or(Fd::INVALID, |h| h.get_fd()),
            _ => Fd::INVALID,
        }
    }

    pub fn local_port(&self) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map_or(0, |h| h.local_port()),
            _ => 0,
        }
    }

    pub fn remote_port(&self) -> i32 {
        match self.socket {
            InternalSocket::Connected(r) => sock(r).map_or(0, |h| h.remote_port()),
            _ => 0,
        }
    }

    pub fn local_address<'a>(&self, buf: &'a mut [u8]) -> Option<&'a [u8]> {
        match self.socket {
            InternalSocket::Connected(r) => match sock(r) {
                // The Err arm is unreachable in practice (verbatim C quirk:
                // failures yield an empty view) — kept for shape parity.
                Some(h) => match h.local_address(buf) {
                    Ok(v) => Some(v),
                    Err(e) => bun_core::Output::panic(format_args!(
                        "Failed to get socket's local address: {}",
                        e.name()
                    )),
                },
                None => None,
            },
            _ => None,
        }
    }

    pub fn remote_address<'a>(&self, buf: &'a mut [u8]) -> Option<&'a [u8]> {
        match self.socket {
            InternalSocket::Connected(r) => match sock(r) {
                Some(h) => match h.remote_address(buf) {
                    Ok(v) => Some(v),
                    Err(e) => bun_core::Output::panic(format_args!(
                        "Failed to get socket's remote address: {}",
                        e.name()
                    )),
                },
                None => None,
            },
            _ => None,
        }
    }

    /// Sendfile short-write marker; plain-TCP only.
    pub fn mark_needs_more_for_sendfile(&self) {
        const {
            assert!(!IS_SSL, "sendfile path is plain-TCP only");
        }
        if let InternalSocket::Connected(r) = self.socket {
            if let Some(h) = sock(r) {
                h.send_file_needs_more();
            }
        }
    }

    // ── constructors ────────────────────────────────────────────────────────

    #[inline]
    pub fn from(socket: SocketRef) -> Self {
        Self {
            socket: InternalSocket::Connected(socket),
        }
    }
    #[inline]
    pub fn from_connecting(connecting: ConnectingRef) -> Self {
        Self {
            socket: InternalSocket::Connecting(connecting),
        }
    }
    #[inline]
    pub fn from_any(socket: InternalSocket) -> Self {
        Self { socket }
    }
    #[inline]
    pub fn from_duplex(d: *mut UpgradedDuplex) -> Self {
        Self {
            socket: InternalSocket::UpgradedDuplex(d),
        }
    }
    #[cfg(windows)]
    #[inline]
    pub fn from_named_pipe(p: *mut WindowsNamedPipe) -> Self {
        Self {
            socket: InternalSocket::Pipe(p),
        }
    }

    /// Wrap an already-open fd; ext stores `Option<NonNull<This>>` (8-byte
    /// niche layout). C14: owns the fd only on success.
    pub fn from_fd<This>(
        g: &mut SocketGroup,
        k: SocketKind,
        handle: Fd,
        this: *mut This,
        is_ipc: bool,
    ) -> Option<Self> {
        let ext_size = size_of::<Option<NonNull<This>>>() as c_int;
        let raw = g.from_fd(
            k,
            None,
            ext_size,
            handle.native() as crate::LIBUS_SOCKET_DESCRIPTOR,
            is_ipc,
        );
        let nn = NonNull::new(raw)?;
        // Rust kinds: the ext word IS the storage (null-niche pointer bits).
        // Group-vtable (Dynamic) kinds keep a trailing-area pointer there
        // instead — stamping would clobber it and free_socket_ext would later
        // free the caller's pointer as an ExtBlock. They must not come here.
        debug_assert!(!crate::dispatch::uses_group_vtable(k));
        uext::header_mut(raw).ext = this.cast::<c_void>();
        Some(Self {
            socket: InternalSocket::Connected(SocketRef::from_live(nn)),
        })
    }

    /// Connect via a `SocketGroup`, stashing `owner` in the socket ext on
    /// both the fast (resolved) and slow (Connecting) arms. Strips `[v6]`
    /// brackets and NUL-terminates the host.
    pub fn connect_group<Owner>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        raw_host: &[u8],
        port: c_int,
        owner: *mut Owner,
        allow_half_open: bool,
    ) -> Result<Self, ConnectError> {
        let opts: c_int = if allow_half_open {
            LIBUS_SOCKET_ALLOW_HALF_OPEN
        } else {
            0
        };
        // getaddrinfo doesn't understand bracketed IPv6 literals; URL parsing
        // leaves them in (`[::1]`), so strip here like the old connectAnon.
        let host =
            if raw_host.len() > 1 && raw_host[0] == b'[' && raw_host[raw_host.len() - 1] == b']' {
                &raw_host[1..raw_host.len() - 1]
            } else {
                raw_host
            };
        if host.contains(&0) {
            return Err(ConnectError::FailedToOpenSocket);
        }
        // SocketGroup::connect needs a NUL-terminated host.
        let mut stack = [0u8; 256];
        let heap: Vec<u8>;
        let host_z: &core::ffi::CStr = if host.len() < stack.len() {
            stack[..host.len()].copy_from_slice(host);
            stack[host.len()] = 0;
            core::ffi::CStr::from_bytes_with_nul(&stack[..host.len() + 1]).expect("no interior NUL")
        } else {
            heap = {
                let mut v = Vec::with_capacity(host.len() + 1);
                v.extend_from_slice(host);
                v.push(0);
                v
            };
            core::ffi::CStr::from_bytes_with_nul(&heap).expect("no interior NUL")
        };

        let ext_size = size_of::<Option<NonNull<Owner>>>() as c_int;
        match g.connect(kind, ssl_ctx, host_z, port, None, opts, ext_size) {
            ConnectResult::Failed => Err(ConnectError::FailedToOpenSocket),
            ConnectResult::Socket(s) => {
                let nn = NonNull::new(s).ok_or(ConnectError::FailedToOpenSocket)?;
                uext::header_mut(s).ext = owner.cast::<c_void>();
                Ok(Self {
                    socket: InternalSocket::Connected(SocketRef::from_live(nn)),
                })
            }
            ConnectResult::Connecting(cs) => {
                let nn = NonNull::new(cs).ok_or(ConnectError::FailedToOpenSocket)?;
                // Raw store: `cs` is already published to the resolver (C13).
                connecting::set_ext_raw(cs, owner.cast::<c_void>());
                Ok(Self {
                    socket: InternalSocket::Connecting(ConnectingRef::from_live(nn)),
                })
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
        let opts: c_int = if allow_half_open {
            LIBUS_SOCKET_ALLOW_HALF_OPEN
        } else {
            0
        };
        let ext_size = size_of::<Option<NonNull<Owner>>>() as c_int;
        let s = g.connect_unix(kind, ssl_ctx, path, opts, ext_size);
        let nn = NonNull::new(s).ok_or(ConnectError::FailedToOpenSocket)?;
        uext::header_mut(s).ext = owner.cast::<c_void>();
        Ok(Self {
            socket: InternalSocket::Connected(SocketRef::from_live(nn)),
        })
    }

    /// Move an open socket into a new group/kind, stashing `owner` in the ext.
    /// `set_socket_field` writes the resulting handle through the raw
    /// `*mut Owner` (never materialize `&mut Owner` here — callers may hold
    /// one across this call).
    pub fn adopt_group<Owner>(
        tcp: SocketRef,
        g: *mut SocketGroup,
        kind: SocketKind,
        owner: *mut Owner,
        set_socket_field: impl FnOnce(*mut Owner, Self),
    ) -> bool {
        let Some(p) = tcp.resolve() else {
            return false;
        };
        let word = size_of::<*mut c_void>() as i32;
        // In-place: the returned pointer is always the input; the generation
        // is unchanged, so `tcp` stays valid.
        let h = uext::header_mut(p.as_ptr());
        if h.adopt(uext::deref_mut(g), kind, word, word).is_none() {
            return false;
        }
        h.ext = owner.cast::<c_void>();
        set_socket_field(
            owner,
            Self {
                socket: InternalSocket::Connected(tcp),
            },
        );
        true
    }
}

fn release_ctx(ctx: *mut SslCtx) {
    if !ctx.is_null() {
        ssl_ctx_unref(ctx);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ConnectError
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
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

/// TODO(rename): ConnectedSocket.
#[derive(Copy, Clone)]
pub enum AnySocket {
    SocketTcp(SocketTCP),
    SocketTls(SocketTLS),
}

/// Stamp out `AnySocket::$m` as a two-arm forward to `NewSocketHandler<SSL>::$m`.
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
    /// Null for detached/stale/duplex/pipe sockets (the old surface returned
    /// the raw context pointer; a panic here would turn that into an abort).
    #[inline]
    pub fn group(&self) -> *mut SocketGroup {
        match self {
            AnySocket::SocketTcp(s) => s.group(),
            AnySocket::SocketTls(s) => s.group(),
        }
        .unwrap_or(core::ptr::null_mut())
    }

    any_socket_forward! {
        fn is_closed(&self) -> bool;
        fn is_shutdown(&self) -> bool;
        fn is_established(&self) -> bool;
        fn close(&self, code: CloseCode);
        fn write(&self, data: &[u8]) -> i32;
        fn set_timeout(&self, seconds: c_uint);
        fn shutdown(&self);
        fn shutdown_read(&self);
        fn local_port(&self) -> i32;
        fn get_native_handle(&self) -> Option<*mut c_void>;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ListenSocket
// ──────────────────────────────────────────────────────────────────────────

/// A listen socket IS a socket (layout-compatible header-first; same slab).
/// Accept state (`group::ListenerData`) hangs off the header's ext word.
/// Live only while linked into its group's `head_listen_sockets` list —
/// caching a `*mut ListenSocket` across ticks is a documented UAF
/// (cabi-surface.md §1.5).
#[repr(C)]
pub struct ListenSocket {
    s: SocketHeader,
}

impl ListenSocket {
    /// R3.29: never dispatches on_close; memory is freed in the tick postlude.
    pub fn close(&mut self) {
        crate::group::close_listen_socket(self);
    }

    /// Returned slice is a view into `buf`.
    pub fn get_local_address<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        self.s.local_address(buf)
    }

    pub fn get_local_port(&self) -> i32 {
        self.s.local_port()
    }

    pub fn get_socket(&mut self) -> &mut us_socket_t {
        &mut self.s
    }

    pub fn socket<const IS_SSL: bool>(&mut self) -> NewSocketHandler<IS_SSL> {
        NewSocketHandler::from(SocketRef::from_live(NonNull::from(&mut self.s)))
    }

    /// The group accepted sockets link into.
    pub fn group(&mut self) -> &mut SocketGroup {
        uext::deref_mut(self.s.group)
    }

    /// Owner word of the accept state (R7.5 — the C version pointed past the
    /// struct into nothing usable; this one is at least real storage).
    pub fn ext<T>(&mut self) -> &mut T {
        debug_assert!(
            core::mem::size_of::<T>() <= core::mem::size_of::<*mut c_void>()
                && core::mem::align_of::<T>() <= core::mem::align_of::<*mut c_void>(),
            "listener ext type does not fit the 8-byte owner word"
        );
        let ls: *mut Self = self;
        let ld = crate::group::listener_data(ls);
        uext::deref_mut((&raw mut ld.owner_ext).cast::<T>())
    }

    pub fn fd(&self) -> Fd {
        self.s.get_fd()
    }

    /// SNI node; `ssl_ctx` is up_ref'd, dropped on close/remove. `user` is
    /// what `find_server_name_userdata` recovers.
    pub fn add_server_name(
        &mut self,
        hostname: &core::ffi::CStr,
        ssl_ctx: *mut SslCtx,
        user: *mut c_void,
    ) -> bool {
        let ls: *mut Self = self;
        let ld = crate::group::listener_data(ls);
        // No default ctx → no SNI (C returns -1, openssl.c:2459-2460).
        if ld.ssl_ctx.is_null() {
            return false;
        }
        if ld.sni.is_none() {
            ld.sni = Some(Box::new(crate::tls::sni::SniMap::new()));
            // Idempotent across listeners sharing this SSL_CTX — the callback
            // reads the listener off the SSL, not the arg (openssl.c:2463-2467).
            crate::unsafe_core::ffi::register_servername_cb(ld.ssl_ctx);
        }
        // Stash userdata on the SSL_CTX too so per-socket lookup via
        // SSL_get_SSL_CTX works regardless of which ctx the SNI cb selected
        // (openssl.c:2473-2476; stamped even when the add is a duplicate).
        if !ssl_ctx.is_null() {
            crate::tls::context::ctx_set_sni_user(ssl_ctx, user);
        }
        ld.sni
            .as_mut()
            .expect("just inserted")
            .add(hostname, ssl_ctx, user)
    }

    pub fn remove_server_name(&mut self, hostname: &core::ffi::CStr) {
        let ls: *mut Self = self;
        if let Some(sni) = crate::group::listener_data(ls).sni.as_mut() {
            sni.remove(hostname);
        }
    }

    pub fn find_server_name_userdata<T>(
        &mut self,
        hostname: &core::ffi::CStr,
    ) -> Option<NonNull<T>> {
        let ls: *mut Self = self;
        let sni = crate::group::listener_data(ls).sni.as_ref()?;
        NonNull::new(sni.find_userdata(hostname).cast::<T>())
    }

    /// Missing-SNI dynamic resolver registration (cabi-surface.md §4.3).
    pub fn on_server_name(
        &mut self,
        cb: extern "C" fn(*mut ListenSocket, *const core::ffi::c_char, *mut c_int, *mut c_void) -> *mut c_void,
    ) {
        let ls: *mut Self = self;
        let ld = crate::group::listener_data(ls);
        ld.on_server_name = Some(ffi::server_name_cb_from_erased(cb));
        // The dynamic resolver may need to suspend the handshake (async
        // SNICallback); only the early select-certificate callback supports
        // retry, so register it on the default ctx (openssl.c:2515-2526).
        if !ld.ssl_ctx.is_null() {
            crate::unsafe_core::ffi::register_select_cert_cb(ld.ssl_ctx);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ExtSlot
// ──────────────────────────────────────────────────────────────────────────

/// `#[repr(transparent)]` owner-word newtype for `Handler::Ext`. Choosing
/// `type Ext = ExtSlot<T>` asserts the non-re-entrancy contract on the owner;
/// zero-init is `None`.
#[repr(transparent)]
pub struct ExtSlot<T>(Option<NonNull<T>>);

impl<T> ExtSlot<T> {
    /// Recover `&mut T`, or `None` for the created-but-not-yet-stamped window
    /// during connect/accept.
    #[inline(always)]
    pub fn owner_mut(&mut self) -> Option<&mut T> {
        uext::owner_mut(self.0)
    }

    /// Snapshot the raw pointer word without forming a borrow (pre-close reads).
    #[inline(always)]
    pub fn get(&self) -> Option<NonNull<T>> {
        self.0
    }
}
