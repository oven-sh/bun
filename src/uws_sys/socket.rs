//! High-level socket wrapper over `us_socket_t` / `ConnectingSocket` /
//! `UpgradedDuplex` / `WindowsNamedPipe`. The `const IS_SSL` parameter is
//! kept so callers can pick `*BoringSSL.SSL` vs `fd` for `get_native_handle`
//! and `fd()`, but it is NOT forwarded to C — TLS is per-socket there.
//!
//! Callback wiring (`configure`/`unsafeConfigure`/`wrapTLS`) and
//! per-connection `SocketContext` creation (`connect*`/`adoptPtr`) are gone:
//! see `SocketGroup`, `SocketKind`, `vtable.rs`, `dispatch.rs`.

use core::ffi::{c_int, c_uint, c_void};
use core::mem::size_of;

use bun_boringssl_sys::SSL;
use bun_core::ZStr;
use bun_core::Fd;

use crate::{
    us_bun_verify_error_t, us_socket_t, ConnectingSocket, SocketGroup, SocketKind, SslCtx,
    UpgradedDuplex, LIBUS_SOCKET_ALLOW_HALF_OPEN,
};
#[cfg(windows)]
use crate::WindowsNamedPipe;

bun_core::declare_scope!(uws, visible);

// ──────────────────────────────────────────────────────────────────────────
// NewSocketHandler<IS_SSL>
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): lifetime — `InternalSocket` carries `&'a mut UpgradedDuplex` /
// `&'a mut WindowsNamedPipe` per LIFETIMES.tsv (BORROW_PARAM), which forces a
// lifetime on this wrapper and prevents `Copy`. The Zig passes `ThisSocket` by
// value pervasively; Phase B may need to demote those two payloads to raw
// `*mut` to restore `Copy` semantics.
pub struct NewSocketHandler<'a, const IS_SSL: bool> {
    pub socket: InternalSocket<'a>,
}

pub type SocketTcp<'a> = NewSocketHandler<'a, false>;
pub type SocketTls<'a> = NewSocketHandler<'a, true>;

/// Reborrow the `*mut us_socket_t` payload of `InternalSocket::Connected` as
/// `&mut`. `us_socket_t` is `#[repr(C)] UnsafeCell<[u8; 0]>` — zero-sized,
/// align-1, no `noalias` — so the only validity requirement is non-null, which
/// uSockets guarantees for every pointer it stores in `Connected`/`Connecting`.
/// Centralizing the deref here keeps the proof local instead of repeating
/// `unsafe { (**s) }` at ~50 match arms.
#[inline(always)]
fn sock<'b>(p: *mut us_socket_t) -> &'b mut us_socket_t {
    debug_assert!(!p.is_null());
    // SAFETY: see fn doc — opaque ZST + UnsafeCell, uSockets-guaranteed non-null.
    unsafe { &mut *p }
}
/// As [`sock`] but for the `Connecting` payload.
#[inline(always)]
fn conn<'b>(p: *mut ConnectingSocket) -> &'b mut ConnectingSocket {
    debug_assert!(!p.is_null());
    // SAFETY: see [`sock`] doc — `ConnectingSocket` is the same opaque-ZST shape.
    unsafe { &mut *p }
}

impl<'a, const IS_SSL: bool> NewSocketHandler<'a, IS_SSL> {
    pub const DETACHED: Self = Self { socket: InternalSocket::Detached };

    pub fn set_no_delay(&self, enabled: bool) -> bool {
        self.socket.set_no_delay(enabled)
    }

    pub fn set_keep_alive(&self, enabled: bool, delay: u32) -> bool {
        self.socket.set_keep_alive(enabled, delay)
    }

    pub fn pause_stream(&mut self) -> bool {
        self.socket.pause_resume(true)
    }

    pub fn resume_stream(&mut self) -> bool {
        self.socket.pause_resume(false)
    }

    pub fn detach(&mut self) {
        self.socket.detach();
    }

    pub fn is_detached(&self) -> bool {
        self.socket.is_detached()
    }

    pub fn is_named_pipe(&self) -> bool {
        self.socket.is_named_pipe()
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        match &self.socket {
            InternalSocket::Connected(socket) => sock(*socket).get_verify_error(),
            InternalSocket::UpgradedDuplex(socket) => socket.ssl_error(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.ssl_error(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => us_bun_verify_error_t::default(),
            InternalSocket::Connecting(_) | InternalSocket::Detached => {
                us_bun_verify_error_t::default()
            }
        }
    }

    pub fn is_established(&self) -> bool {
        match &self.socket {
            InternalSocket::Connected(socket) => sock(*socket).is_established(),
            InternalSocket::UpgradedDuplex(socket) => socket.is_established(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.is_established(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => false,
            InternalSocket::Connecting(_) | InternalSocket::Detached => false,
        }
    }

    pub fn timeout(&mut self, seconds: c_uint) {
        match &mut self.socket {
            InternalSocket::UpgradedDuplex(socket) => socket.set_timeout(seconds),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.set_timeout(seconds),
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Connected(socket) => sock(*socket).set_timeout(seconds),
            InternalSocket::Connecting(socket) => conn(*socket).timeout(seconds),
            InternalSocket::Detached => {}
        }
    }

    pub fn set_timeout(&mut self, seconds: c_uint) {
        match &mut self.socket {
            InternalSocket::Connected(socket) => {
                if seconds > 240 {
                    sock(*socket).set_timeout(0);
                    sock(*socket).set_long_timeout(seconds / 60);
                } else {
                    sock(*socket).set_timeout(seconds);
                    sock(*socket).set_long_timeout(0);
                }
            }
            InternalSocket::Connecting(socket) => {
                if seconds > 240 {
                    conn(*socket).timeout(0);
                    conn(*socket).long_timeout(seconds / 60);
                } else {
                    conn(*socket).timeout(seconds);
                    conn(*socket).long_timeout(0);
                }
            }
            InternalSocket::Detached => {}
            InternalSocket::UpgradedDuplex(socket) => socket.set_timeout(seconds),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.set_timeout(seconds),
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
        }
    }

    pub fn set_timeout_minutes(&mut self, minutes: c_uint) {
        match &mut self.socket {
            InternalSocket::Connected(socket) => {
                sock(*socket).set_timeout(0);
                sock(*socket).set_long_timeout(minutes);
            }
            InternalSocket::Connecting(socket) => {
                conn(*socket).timeout(0);
                conn(*socket).long_timeout(minutes);
            }
            InternalSocket::Detached => {}
            InternalSocket::UpgradedDuplex(socket) => socket.set_timeout(minutes * 60),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.set_timeout(minutes * 60),
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
        }
    }

    pub fn start_tls(&self, is_client: bool) {
        if let Some(socket) = self.socket.get() {
            sock(socket).open(is_client, None);
        }
    }

    pub fn ssl(&self) -> Option<*mut SSL> {
        if IS_SSL {
            if let Some(handle) = self.get_native_handle() {
                return Some(handle.cast::<SSL>());
            }
            return None;
        }
        None
    }

    // TODO(port): Zig returns `?*NativeSocketHandleType(is_ssl)` (= `*SSL` when
    // IS_SSL, `*anyopaque` otherwise). Rust const generics cannot dispatch the
    // return type on a `const bool`, so we return `*mut c_void` unconditionally
    // and let `ssl()` cast.
    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        let raw: Option<*mut c_void> = match &self.socket {
            InternalSocket::Connected(socket) => sock(*socket).get_native_handle(),
            InternalSocket::Connecting(socket) => Some(conn(*socket).get_native_handle()),
            InternalSocket::Detached => None,
            InternalSocket::UpgradedDuplex(socket) => {
                if IS_SSL {
                    Some(socket.ssl()?.cast::<SSL>().cast::<c_void>())
                } else {
                    None
                }
            }
            #[cfg(windows)]
            InternalSocket::Pipe(socket) => {
                if IS_SSL {
                    Some((socket.ssl()? as *mut SSL).cast::<c_void>())
                } else {
                    None
                }
            }
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
        };
        raw
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        let Some(socket) = self.socket.get() else {
            return Fd::INVALID;
        };
        // Same fd regardless of TLS — read it directly off the poll.
        sock(socket).get_fd()
    }

    pub fn mark_needs_more_for_sendfile(&self) {
        // Zig: `if (comptime is_ssl) @compileError(...)`.
        const { assert!(!IS_SSL, "SSL sockets do not support sendfile yet") };
        let Some(socket) = self.socket.get() else { return };
        sock(socket).send_file_needs_more();
    }

    pub fn ext<ContextType>(&self) -> Option<*mut ContextType> {
        match &self.socket {
            InternalSocket::Connected(s) => Some(sock(*s).ext::<ContextType>()),
            InternalSocket::Connecting(s) => Some(conn(*s).ext::<ContextType>()),
            InternalSocket::Detached
            | InternalSocket::UpgradedDuplex(_) => None,
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
        }
    }

    /// Group this socket is linked into. None for non-uSockets transports.
    pub fn group(&self) -> Option<*mut SocketGroup> {
        match &self.socket {
            InternalSocket::Connected(socket) => Some(sock(*socket).group()),
            InternalSocket::Connecting(socket) => Some(conn(*socket).group()),
            InternalSocket::Detached
            | InternalSocket::UpgradedDuplex(_) => None,
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
        }
    }

    pub fn flush(&mut self) {
        match &mut self.socket {
            InternalSocket::UpgradedDuplex(socket) => socket.flush(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.flush(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Connected(socket) => sock(*socket).flush(),
            InternalSocket::Connecting(_) | InternalSocket::Detached => {}
        }
    }

    pub fn write(&mut self, data: &[u8]) -> i32 {
        match &mut self.socket {
            InternalSocket::UpgradedDuplex(socket) => socket.encode_and_write(data),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.encode_and_write(data),
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
            InternalSocket::Connected(socket) => sock(*socket).write(data),
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
        }
    }

    pub fn write_fd(&mut self, data: &[u8], file_descriptor: Fd) -> i32 {
        // PORT NOTE: reshaped for borrowck — duplex/pipe arms call self.write(),
        // which re-borrows `self` while `&mut self.socket` is held by the match.
        #[cfg(windows)]
        if matches!(self.socket, InternalSocket::UpgradedDuplex(_) | InternalSocket::Pipe(_)) {
            return self.write(data);
        }
        #[cfg(not(windows))]
        if matches!(self.socket, InternalSocket::UpgradedDuplex(_) | InternalSocket::Pipe) {
            return self.write(data);
        }
        match &mut self.socket {
            InternalSocket::Connected(socket) => sock(*socket).write_fd(data, file_descriptor),
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
            _ => unreachable!(), // handled above
        }
    }

    pub fn raw_write(&mut self, data: &[u8]) -> i32 {
        match &mut self.socket {
            InternalSocket::Connected(socket) => sock(*socket).raw_write(data),
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
            InternalSocket::UpgradedDuplex(socket) => socket.raw_write(data),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.raw_write(data),
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
        }
    }

    pub fn shutdown(&mut self) {
        match &mut self.socket {
            InternalSocket::Connected(socket) => sock(*socket).shutdown(),
            InternalSocket::Connecting(socket) => {
                bun_core::scoped_log!(uws, "us_connecting_socket_shutdown({})", *socket as usize);
                conn(*socket).shutdown();
            }
            InternalSocket::Detached => {}
            InternalSocket::UpgradedDuplex(socket) => socket.shutdown(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.shutdown(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
        }
    }

    pub fn shutdown_read(&mut self) {
        match &mut self.socket {
            InternalSocket::Connected(socket) => sock(*socket).shutdown_read(),
            InternalSocket::Connecting(socket) => {
                bun_core::scoped_log!(uws, "us_connecting_socket_shutdown_read({})", *socket as usize);
                conn(*socket).shutdown_read();
            }
            InternalSocket::UpgradedDuplex(socket) => socket.shutdown_read(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.shutdown_read(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Detached => {}
        }
    }

    pub fn is_shutdown(&self) -> bool {
        match &self.socket {
            InternalSocket::Connected(socket) => sock(*socket).is_shutdown(),
            InternalSocket::Connecting(socket) => {
                bun_core::scoped_log!(uws, "us_connecting_socket_is_shut_down({})", *socket as usize);
                conn(*socket).is_shutdown()
            }
            InternalSocket::UpgradedDuplex(socket) => socket.is_shutdown(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.is_shutdown(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => false,
            InternalSocket::Detached => true,
        }
    }

    pub fn is_closed_or_has_error(&self) -> bool {
        if self.is_closed() || self.is_shutdown() {
            return true;
        }
        self.get_error() != 0
    }

    pub fn get_error(&self) -> i32 {
        match &self.socket {
            InternalSocket::Connected(socket) => {
                bun_core::scoped_log!(uws, "us_socket_get_error({})", *socket as usize);
                sock(*socket).get_error()
            }
            InternalSocket::Connecting(socket) => {
                bun_core::scoped_log!(uws, "us_connecting_socket_get_error({})", *socket as usize);
                conn(*socket).get_error()
            }
            InternalSocket::Detached => 0,
            InternalSocket::UpgradedDuplex(socket) => socket.ssl_error().error_no,
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.ssl_error().error_no,
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.socket.is_closed()
    }

    pub fn close(&mut self, code: crate::CloseCode) {
        self.socket.close(code)
    }

    pub fn local_port(&self) -> i32 {
        match &self.socket {
            InternalSocket::Connected(socket) => sock(*socket).local_port(),
            #[cfg(windows)]
            InternalSocket::Pipe(_) => 0,
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
            InternalSocket::UpgradedDuplex(_)
            | InternalSocket::Connecting(_)
            | InternalSocket::Detached => 0,
        }
    }

    pub fn remote_port(&self) -> i32 {
        match &self.socket {
            InternalSocket::Connected(socket) => sock(*socket).remote_port(),
            #[cfg(windows)]
            InternalSocket::Pipe(_) => 0,
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
            InternalSocket::UpgradedDuplex(_)
            | InternalSocket::Connecting(_)
            | InternalSocket::Detached => 0,
        }
    }

    pub fn remote_address<'b>(&self, buf: &'b mut [u8]) -> Option<&'b [u8]> {
        match &self.socket {
            InternalSocket::Connected(s) => match sock(*s).remote_address(buf) {
                Ok(v) => Some(v),
                Err(e) => bun_core::Output::panic(
                    format_args!("Failed to get socket's remote address: {}", e.name()),
                ),
            },
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
            InternalSocket::UpgradedDuplex(_)
            | InternalSocket::Connecting(_)
            | InternalSocket::Detached => None,
        }
    }

    pub fn local_address<'b>(&self, buf: &'b mut [u8]) -> Option<&'b [u8]> {
        match &self.socket {
            InternalSocket::Connected(s) => match sock(*s).local_address(buf) {
                Ok(v) => Some(v),
                Err(e) => bun_core::Output::panic(
                    format_args!("Failed to get socket's local address: {}", e.name()),
                ),
            },
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
            InternalSocket::UpgradedDuplex(_)
            | InternalSocket::Connecting(_)
            | InternalSocket::Detached => None,
        }
    }

    pub fn from_duplex(duplex: &'a mut UpgradedDuplex) -> Self {
        Self { socket: InternalSocket::UpgradedDuplex(duplex) }
    }

    #[cfg(windows)]
    pub fn from_named_pipe(pipe: &'a mut WindowsNamedPipe) -> Self {
        Self { socket: InternalSocket::Pipe(pipe) }
    }
    // Non-windows: Zig used `@compileError("WindowsNamedPipe is only available on Windows")`
    // — we simply don't define the fn on non-windows.

    /// Wrap an already-open fd. Ext stores `*This`; the socket is linked
    /// into `g` with kind `k`.
    // TODO(port): `comptime socket_field_name: ?[]const u8` + `@field(this, field)`
    // is comptime reflection. We accept an optional setter closure in its place.
    pub fn from_fd<This>(
        g: &mut SocketGroup,
        k: SocketKind,
        handle: Fd,
        this: *mut This,
        set_socket_field: Option<impl FnOnce(&mut This, Self)>,
        is_ipc: bool,
    ) -> Option<Self> {
        // `LIBUS_SOCKET_DESCRIPTOR` is `c_int` on POSIX, `SOCKET` (`usize`) on
        // Windows. Do NOT route through `Fd::native()` on Windows — that calls
        // `uv_get_osfhandle` for kind=uv fds and yields a *file* HANDLE, which
        // is not interchangeable with a winsock SOCKET. The caller must supply
        // a system-kind (raw SOCKET) fd here.
        #[cfg(windows)] let fd_raw = match handle.decode_windows() {
            // System-kind: raw SOCKET stored verbatim — reinterpret as
            // LIBUS_SOCKET_DESCRIPTOR (= SOCKET = usize) without going through
            // `.native()`, which would otherwise call `uv_get_osfhandle` for
            // the Uv arm and yield a *file* HANDLE (wrong kernel table).
            bun_core::DecodeWindows::Windows(h) => h as crate::LIBUS_SOCKET_DESCRIPTOR,
            bun_core::DecodeWindows::Uv(_) => {
                debug_assert!(false, "Socket::from_fd requires a system-kind (raw SOCKET) Fd on Windows");
                return None;
            }
        };
        #[cfg(not(windows))] let fd_raw = handle.native();
        // Zig `?*This` is null-niche optimized (8 bytes); the dispatch
        // trampolines read the ext slot as `Option<NonNull<_>>`, so size and
        // write must match that layout — NOT `Option<*mut This>` (16 bytes).
        let raw = g.from_fd(
            k,
            None,
            size_of::<Option<core::ptr::NonNull<This>>>() as c_int,
            fd_raw,
            is_ipc,
        );
        if raw.is_null() {
            return None;
        }

        // SAFETY: ext storage is sized for `?*This` and `raw` is live.
        unsafe { *(*raw).ext::<Option<core::ptr::NonNull<This>>>() = core::ptr::NonNull::new(this) };
        if let Some(set) = set_socket_field {
            // PORT NOTE: reshaped for borrowck — `Self` holds `&'a mut` (BORROW_PARAM)
            // so it isn't `Clone`; rebuild the `Connected(raw)` variant instead.
            // SAFETY: caller guarantees `this` is a valid unique pointer.
            set(unsafe { &mut *this }, Self { socket: InternalSocket::Connected(raw) });
        }
        Some(Self { socket: InternalSocket::Connected(raw) })
    }

    /// Connect via a `SocketGroup` and stash `owner` in the socket ext.
    /// Replaces the deleted `connectAnon`/`connectPtr`.
    pub fn connect_group<Owner, P>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        raw_host: &[u8],
        port: P,
        owner: *mut Owner,
        allow_half_open: bool,
    ) -> Result<Self, ConnectError>
    where
        P: TryInto<c_int>,
        <P as TryInto<c_int>>::Error: core::fmt::Debug,
    {
        let opts: c_int = if allow_half_open { LIBUS_SOCKET_ALLOW_HALF_OPEN } else { 0 };
        // getaddrinfo doesn't understand bracketed IPv6 literals; URL
        // parsing leaves them in (`[::1]`), so strip here like the old
        // connectAnon did.
        let host = if raw_host.len() > 1
            && raw_host[0] == b'['
            && raw_host[raw_host.len() - 1] == b']'
        {
            &raw_host[1..raw_host.len() - 1]
        } else {
            raw_host
        };
        // SocketGroup.connect needs a NUL-terminated host.
        let mut stack = [0u8; 256];
        let heap: Vec<u8>;
        let host_z: &ZStr = if host.len() < stack.len() {
            stack[..host.len()].copy_from_slice(host);
            stack[host.len()] = 0;
            // SAFETY: stack[host.len()] == 0 written above
            ZStr::from_buf(&stack[..], host.len())
        } else {
            heap = {
                let mut v = Vec::with_capacity(host.len() + 1);
                v.extend_from_slice(host);
                v.push(0);
                v
            };
            // SAFETY: heap[host.len()] == 0 written above
            ZStr::from_buf(&heap[..], host.len())
        };

        // PERF(port): @intCast — profile in Phase B
        let port: c_int = port.try_into().expect("infallible: size matches");

        // Zig `?*Owner` is null-niche optimized (8 bytes); the dispatch
        // trampolines read the ext slot as `Option<NonNull<_>>`, so size and
        // write must match that layout — NOT `Option<*mut Owner>` (16 bytes,
        // discriminant-first), which would hand the trampoline `1` instead of
        // the owner pointer.
        match g.connect(
            kind,
            ssl_ctx,
            // SAFETY: `host_z` is NUL-terminated by construction above.
            unsafe { bun_core::ffi::cstr(host_z.as_ptr()) },
            port,
            opts,
            size_of::<Option<core::ptr::NonNull<Owner>>>() as c_int,
        ) {
            crate::ConnectResult::Failed => Err(ConnectError::FailedToOpenSocket),
            crate::ConnectResult::Socket(s) => {
                // SAFETY: ext storage is sized for `?*Owner` and `s` is live.
                unsafe {
                    *(*s).ext::<Option<core::ptr::NonNull<Owner>>>() =
                        core::ptr::NonNull::new(owner)
                };
                Ok(Self { socket: InternalSocket::Connected(s) })
            }
            crate::ConnectResult::Connecting(cs) => {
                // SAFETY: ext storage is sized for `?*Owner` and `cs` is live.
                unsafe {
                    *(*cs).ext::<Option<core::ptr::NonNull<Owner>>>() =
                        core::ptr::NonNull::new(owner)
                };
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
        let s = g.connect_unix(
            kind,
            ssl_ctx,
            path,
            opts,
            size_of::<Option<core::ptr::NonNull<Owner>>>() as c_int,
        );
        if s.is_null() {
            return Err(ConnectError::FailedToOpenSocket);
        }
        // SAFETY: ext storage is sized for `?*Owner` and `s` is live.
        unsafe {
            *(*s).ext::<Option<core::ptr::NonNull<Owner>>>() = core::ptr::NonNull::new(owner)
        };
        Ok(Self { socket: InternalSocket::Connected(s) })
    }

    /// Move an open socket into a new group/kind, stashing `owner` in the
    /// ext. Replaces `Socket.adoptPtr`.
    // TODO(port): `comptime field: []const u8` + `@field(owner, field)` is
    // comptime reflection. We accept a setter closure in its place.
    pub fn adopt_group<Owner>(
        tcp: *mut us_socket_t,
        g: &mut SocketGroup,
        kind: SocketKind,
        owner: *mut Owner,
        set_socket_field: impl FnOnce(&mut Owner, Self),
    ) -> bool {
        // SAFETY: `tcp` is a live socket the caller is moving into `g`.
        let Some(new_s) = (unsafe {
            (*tcp).adopt(g, kind, size_of::<*mut c_void>() as i32, size_of::<*mut c_void>() as i32)
        }) else {
            return false;
        };
        let new_s = new_s.as_ptr();
        // SAFETY: ext storage is sized for `*anyopaque` and `new_s` is live.
        unsafe { *(*new_s).ext::<*mut c_void>() = owner.cast::<c_void>() };
        // SAFETY: caller guarantees `owner` is a valid unique pointer.
        set_socket_field(unsafe { &mut *owner }, Self { socket: InternalSocket::Connected(new_s) });
        true
    }

    pub fn from(socket: *mut us_socket_t) -> Self {
        Self { socket: InternalSocket::Connected(socket) }
    }

    pub fn from_connecting(connecting: *mut ConnectingSocket) -> Self {
        Self { socket: InternalSocket::Connecting(connecting) }
    }

    pub fn from_any(socket: InternalSocket<'a>) -> Self {
        Self { socket }
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ConnectError {
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
}
impl From<ConnectError> for bun_core::Error {
    fn from(e: ConnectError) -> Self {
        bun_core::err!("FailedToOpenSocket")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// InternalSocket
// ──────────────────────────────────────────────────────────────────────────

pub enum InternalSocket<'a> {
    Connected(*mut us_socket_t),
    Connecting(*mut ConnectingSocket),
    Detached,
    UpgradedDuplex(&'a mut UpgradedDuplex),
    #[cfg(windows)]
    Pipe(&'a mut WindowsNamedPipe),
    #[cfg(not(windows))]
    Pipe,
}

impl<'a> InternalSocket<'a> {
    pub fn pause_resume(&mut self, pause: bool) -> bool {
        match self {
            InternalSocket::Detached => true,
            InternalSocket::Connected(socket) => {
                if pause {
                    sock(*socket).pause();
                } else {
                    sock(*socket).resume();
                }
                true
            }
            InternalSocket::Connecting(_) => false,
            InternalSocket::UpgradedDuplex(_) => false, // TODO: pause/resume upgraded duplex
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => {
                if pause { pipe.pause_stream() } else { pipe.resume_stream() }
            }
            #[cfg(not(windows))]
            InternalSocket::Pipe => false,
        }
    }

    pub fn is_detached(&self) -> bool {
        matches!(self, InternalSocket::Detached)
    }

    pub fn is_named_pipe(&self) -> bool {
        #[cfg(windows)]
        return matches!(self, InternalSocket::Pipe(_));
        #[cfg(not(windows))]
        return matches!(self, InternalSocket::Pipe);
    }

    pub fn detach(&mut self) {
        *self = InternalSocket::Detached;
    }

    pub fn set_no_delay(&self, enabled: bool) -> bool {
        match self {
            #[cfg(windows)]
            InternalSocket::Pipe(_) => false,
            #[cfg(not(windows))]
            InternalSocket::Pipe => false,
            InternalSocket::UpgradedDuplex(_)
            | InternalSocket::Connecting(_)
            | InternalSocket::Detached => false,
            InternalSocket::Connected(socket) => {
                sock(*socket).set_nodelay(enabled);
                true
            }
        }
    }

    pub fn set_keep_alive(&self, enabled: bool, delay: u32) -> bool {
        match self {
            #[cfg(windows)]
            InternalSocket::Pipe(_) => false,
            #[cfg(not(windows))]
            InternalSocket::Pipe => false,
            InternalSocket::UpgradedDuplex(_)
            | InternalSocket::Connecting(_)
            | InternalSocket::Detached => false,
            InternalSocket::Connected(socket) => {
                (sock(*socket).set_keepalive(enabled, delay)) == 0
            }
        }
    }

    pub fn close(&mut self, code: crate::CloseCode) {
        match self {
            InternalSocket::Detached => {}
            InternalSocket::Connected(socket) => sock(*socket).close(code),
            InternalSocket::Connecting(socket) => conn(*socket).close(),
            InternalSocket::UpgradedDuplex(socket) => socket.close(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.close(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
        }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            InternalSocket::Connected(socket) => sock(*socket).is_closed(),
            InternalSocket::Connecting(socket) => conn(*socket).is_closed(),
            InternalSocket::Detached => true,
            InternalSocket::UpgradedDuplex(socket) => socket.is_closed(),
            #[cfg(windows)]
            InternalSocket::Pipe(pipe) => pipe.is_closed(),
            #[cfg(not(windows))]
            InternalSocket::Pipe => true,
        }
    }

    pub fn get(&self) -> Option<*mut us_socket_t> {
        match self {
            InternalSocket::Connected(s) => Some(*s),
            InternalSocket::Connecting(_)
            | InternalSocket::Detached
            | InternalSocket::UpgradedDuplex(_) => None,
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
        }
    }

    pub fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (InternalSocket::Connected(a), InternalSocket::Connected(b)) => *a == *b,
            (InternalSocket::Connecting(a), InternalSocket::Connecting(b)) => *a == *b,
            (InternalSocket::Detached, InternalSocket::Detached) => true,
            (InternalSocket::UpgradedDuplex(a), InternalSocket::UpgradedDuplex(b)) => {
                core::ptr::eq(*a, *b)
            }
            #[cfg(windows)]
            (InternalSocket::Pipe(a), InternalSocket::Pipe(b)) => core::ptr::eq(*a, *b),
            #[cfg(not(windows))]
            (InternalSocket::Pipe, InternalSocket::Pipe) => false,
            _ => false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AnySocket
// ──────────────────────────────────────────────────────────────────────────

/// TODO: rename to ConnectedSocket
pub enum AnySocket<'a> {
    SocketTcp(SocketTcp<'a>),
    SocketTls(SocketTls<'a>),
}

impl<'a> AnySocket<'a> {
    pub fn set_timeout(&mut self, seconds: c_uint) {
        match self {
            AnySocket::SocketTcp(s) => s.set_timeout(seconds),
            AnySocket::SocketTls(s) => s.set_timeout(seconds),
        }
    }

    pub fn shutdown(&mut self) {
        match self {
            AnySocket::SocketTcp(sock) => sock.shutdown(),
            AnySocket::SocketTls(sock) => sock.shutdown(),
        }
    }

    pub fn shutdown_read(&mut self) {
        match self {
            AnySocket::SocketTcp(sock) => sock.shutdown_read(),
            AnySocket::SocketTls(sock) => sock.shutdown_read(),
        }
    }

    pub fn is_shutdown(&self) -> bool {
        match self {
            AnySocket::SocketTcp(s) => s.is_shutdown(),
            AnySocket::SocketTls(s) => s.is_shutdown(),
        }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            AnySocket::SocketTcp(s) => s.is_closed(),
            AnySocket::SocketTls(s) => s.is_closed(),
        }
    }

    pub fn close(&mut self) {
        match self {
            AnySocket::SocketTcp(s) => s.close(crate::CloseCode::normal),
            AnySocket::SocketTls(s) => s.close(crate::CloseCode::normal),
        }
    }

    pub fn terminate(&mut self) {
        match self {
            AnySocket::SocketTcp(s) => s.close(crate::CloseCode::failure),
            AnySocket::SocketTls(s) => s.close(crate::CloseCode::failure),
        }
    }

    pub fn write(&mut self, data: &[u8]) -> i32 {
        match self {
            AnySocket::SocketTcp(sock) => sock.write(data),
            AnySocket::SocketTls(sock) => sock.write(data),
        }
    }

    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        match self.socket() {
            InternalSocket::Connected(s) => sock(*s).get_native_handle(),
            _ => None,
        }
    }

    pub fn local_port(&self) -> i32 {
        match self {
            AnySocket::SocketTcp(sock) => sock.local_port(),
            AnySocket::SocketTls(sock) => sock.local_port(),
        }
    }

    pub fn is_ssl(&self) -> bool {
        match self {
            AnySocket::SocketTcp(_) => false,
            AnySocket::SocketTls(_) => true,
        }
    }

    pub fn socket(&self) -> &InternalSocket<'a> {
        match self {
            AnySocket::SocketTcp(s) => &s.socket,
            AnySocket::SocketTls(s) => &s.socket,
        }
    }

    pub fn ext<ContextType>(&self) -> Option<*mut ContextType> {
        match self {
            AnySocket::SocketTcp(s) => s.ext::<ContextType>(),
            AnySocket::SocketTls(s) => s.ext::<ContextType>(),
        }
    }

    pub fn group(&self) -> *mut SocketGroup {
        // Zig had `@setRuntimeSafety(true)` — Rust always panics on `.unwrap()`.
        match self {
            AnySocket::SocketTcp(sock) => sock.group(),
            AnySocket::SocketTls(sock) => sock.group(),
        }
        .unwrap()
    }
}

// TODO(port): NativeSocketHandleType(ssl) — Zig type-level fn, see comment on
// `get_native_handle`. Kept here as a marker; Phase B may turn this into an
// associated type on a trait keyed by `IS_SSL`.
#[allow(dead_code)]
fn native_socket_handle_type<const SSL_: bool>() {}

// ported from: src/uws_sys/socket.zig
