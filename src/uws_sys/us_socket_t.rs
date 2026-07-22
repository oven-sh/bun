use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{self, NonNull};

use bun_core::Fd;

use crate::{LIBUS_SOCKET_DESCRIPTOR, SocketGroup, SocketKind, SslCtx, us_bun_verify_error_t};

bun_core::declare_scope!(uws, visible);

const MAX_I32: usize = i32::MAX as usize;

// Rust bindings for `us_socket_t`.
//
// TLS is per-socket (`s->ssl != NULL` in C); there is no `int ssl` selector.
// Dispatch is by `kind()` — see `SocketKind` and `dispatch.rs`.
//
// Higher-level wrappers (`uws::SocketTCP`/`SocketTLS`) cover named pipes,
// upgraded duplexes, and async DNS.
bun_opaque::opaque_ffi! { pub struct us_socket_t; }

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum CloseCode {
    /// TLS: send close_notify and defer fd close until peer replies. TCP: FIN.
    normal = 0,
    /// TLS: fast-shutdown (no wait). TCP: SO_LINGER{1,0} → RST, dropping any
    /// unflushed send buffer. Only for `terminate()` / GC abort.
    failure = 1,
    /// TLS: fast-shutdown (no wait). TCP: FIN. For `_handle.close()` where
    /// the JS wrapper detaches immediately so `.normal`'s deferral would
    /// orphan the `us_socket_t`, but already-written data must still drain.
    fast_shutdown = 2,
}

/// Layout-compatible with `struct us_iovec_t` in libusockets.h (== POSIX iovec).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct UsIoVec {
    pub base: *const core::ffi::c_void,
    pub len: usize,
}

impl us_socket_t {
    pub fn open(&mut self, is_client: bool, ip_addr: Option<&[u8]>) {
        bun_core::scoped_log!(uws, "us_socket_open({:p}, is_client: {})", self, is_client);
        if let Some(ip) = ip_addr {
            debug_assert!(ip.len() < MAX_I32);
            unsafe {
                // SAFETY: self is a live us_socket_t; ip.ptr valid for ip.len bytes
                let _ = c::us_socket_open(
                    self,
                    is_client as i32,
                    ip.as_ptr(),
                    i32::try_from(ip.len().min(MAX_I32)).expect("int cast"),
                );
            }
        } else {
            unsafe {
                // SAFETY: self is a live us_socket_t
                let _ = c::us_socket_open(self, is_client as i32, ptr::null(), 0);
            }
        }
    }

    pub fn pause(&mut self) {
        bun_core::scoped_log!(uws, "us_socket_pause({:p})", self);
        c::us_socket_pause(self);
    }

    pub fn resume(&mut self) {
        bun_core::scoped_log!(uws, "us_socket_resume({:p})", self);
        c::us_socket_resume(self);
    }

    pub fn close(&mut self, code: CloseCode) {
        bun_core::scoped_log!(
            uws,
            "us_socket_close({:p}, {})",
            self,
            <&'static str>::from(code)
        );
        unsafe {
            // SAFETY: self is a live us_socket_t
            let _ = c::us_socket_close(self, code, ptr::null_mut());
        }
    }

    pub fn shutdown(&mut self) {
        bun_core::scoped_log!(uws, "us_socket_shutdown({:p})", self);
        c::us_socket_shutdown(self);
    }

    pub fn shutdown_read(&mut self) {
        c::us_socket_shutdown_read(self);
    }

    pub fn is_closed(&self) -> bool {
        c::us_socket_is_closed(self) > 0
    }

    /// Write that also reports a fatal (non-would-block) send error so the
    /// node:net path can fail the pending write instead of waiting forever.
    /// The second element is 0 on success, otherwise the positive errno of
    /// the failed `send()` on POSIX, or 1 on Windows (WSA→errno mapping is
    /// not wired up here yet).
    pub fn write_check_error(&self, data: &[u8]) -> (i32, i32) {
        let mut fatal: i32 = 0;
        // SAFETY: `self` is a live `us_socket_t`; `data` is valid for its length
        // (clamped to i32) and `fatal` outlives the call as the out-parameter.
        let written = unsafe {
            c::us_socket_write_check_error(
                self,
                data.as_ptr().cast(),
                i32::try_from(data.len().min(MAX_I32)).expect("int cast"),
                &raw mut fatal,
            )
        };
        (written, fatal)
    }

    pub fn is_shutdown(&self) -> bool {
        c::us_socket_is_shut_down(self) > 0
    }

    pub fn is_tls(&self) -> bool {
        c::us_socket_is_tls(self) > 0
    }

    pub fn local_port(&self) -> i32 {
        c::us_socket_local_port(self)
    }

    pub fn remote_port(&self) -> i32 {
        c::us_socket_remote_port(self)
    }

    /// Returned slice is a view into `buf`.
    pub fn local_address<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], crate::Error> {
        let mut length: i32 = i32::try_from(buf.len().min(MAX_I32)).expect("int cast");
        unsafe {
            // SAFETY: buf.as_mut_ptr() valid for `length` bytes; length is in/out
            c::us_socket_local_address(self, buf.as_mut_ptr(), &raw mut length);
        }
        if length < 0 {
            let errno = bun_errno::get_errno(length);
            debug_assert!(errno != bun_errno::E::SUCCESS);
            return Err(crate::Error::Sys(
                bun_errno::SystemErrno::init(errno as i64).unwrap_or(bun_errno::SystemErrno::EIO),
            ));
        }
        debug_assert!(buf.len() >= length as usize);
        Ok(&buf[..usize::try_from(length).expect("int cast")])
    }

    /// Returned slice is a view into `buf`. On error, `errno` should be set.
    pub fn remote_address<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], crate::Error> {
        let mut length: i32 = i32::try_from(buf.len().min(MAX_I32)).expect("int cast");
        unsafe {
            // SAFETY: buf.as_mut_ptr() valid for `length` bytes; length is in/out
            c::us_socket_remote_address(self, buf.as_mut_ptr(), &raw mut length);
        }
        if length < 0 {
            let errno = bun_errno::get_errno(length);
            debug_assert!(errno != bun_errno::E::SUCCESS);
            return Err(crate::Error::Sys(
                bun_errno::SystemErrno::init(errno as i64).unwrap_or(bun_errno::SystemErrno::EIO),
            ));
        }
        debug_assert!(buf.len() >= length as usize);
        Ok(&buf[..usize::try_from(length).expect("int cast")])
    }

    pub fn set_timeout(&mut self, seconds: u32) {
        c::us_socket_timeout(self, seconds);
    }

    pub fn set_long_timeout(&mut self, minutes: u32) {
        c::us_socket_long_timeout(self, minutes);
    }

    pub fn set_nodelay(&mut self, enabled: bool) {
        c::us_socket_nodelay(self, enabled as c_int);
    }

    pub fn set_keepalive(&mut self, enabled: bool, delay: u32) -> i32 {
        c::us_socket_keepalive(self, enabled as c_int, delay)
    }

    /// Set the IP type-of-service / traffic class. Returns 0 on success or a
    /// negative platform errno.
    pub fn set_tos(&mut self, tos: i32) -> i32 {
        c::us_socket_set_tos(self, tos)
    }

    /// Get the IP type-of-service / traffic class (>= 0) or a negative errno.
    pub fn get_tos(&mut self) -> i32 {
        c::us_socket_get_tos(self)
    }

    /// Resume a handshake suspended by an asynchronous SNICallback. `ctx`
    /// carries an owned SSL_CTX reference that the call consumes (may be
    /// null = fall through to the default context); `error` aborts instead.
    pub fn sni_resolve(&mut self, ctx: *mut SslCtx, error: bool) {
        c::us_socket_sni_resolve(self, ctx, error as c_int);
    }

    /// `SSL*` if TLS, else null. Use `get_fd()` for the descriptor.
    pub fn ssl(&mut self) -> Option<&mut bun_boringssl_sys::SSL> {
        if !self.is_tls() {
            return None;
        }
        unsafe {
            // SAFETY: is_tls() guarantees the native handle is a non-null SSL*
            c::us_socket_get_native_handle(self)
                .cast::<bun_boringssl_sys::SSL>()
                .as_mut()
        }
    }

    /// Node-compat `_handle` shape: `SSL*` for TLS sockets, fd-as-pointer for
    /// plain TCP. Consumers that want one or the other should call `ssl()` /
    /// `get_fd()` directly; this is the round-trip-to-JS form.
    pub fn get_native_handle(&mut self) -> Option<*mut c_void> {
        let p = c::us_socket_get_native_handle(self);
        if p.is_null() { None } else { Some(p) }
    }

    pub fn ext<T>(&mut self) -> &mut T {
        unsafe {
            // SAFETY: us_socket_ext returns LIBUS_EXT_ALIGNMENT-aligned storage
            // sized for T at socket creation; caller picks the same T it stored.
            &mut *c::us_socket_ext(self).cast::<T>()
        }
    }

    /// Type-erased ext storage — `LIBUS_EXT_ALIGNMENT`-aligned bytes
    /// immediately after the C struct. Prefer `ext<T>()`.
    pub fn ext_ptr(&mut self) -> *mut u8 {
        c::us_socket_ext(self).cast::<u8>()
    }

    pub fn group(&mut self) -> &mut SocketGroup {
        unsafe {
            // SAFETY: us_socket_group never returns null for a live socket
            &mut *c::us_socket_group(self)
        }
    }
    #[inline]
    pub fn raw_group(&mut self) -> &mut SocketGroup {
        self.group()
    }

    pub fn kind(&self) -> SocketKind {
        SocketKind::from_u8(c::us_socket_kind(self))
    }

    /// Re-stamp the dispatch kind in place. Used after `Listener.onCreate`
    /// stashes the `NewSocket*` in ext so subsequent events skip the listener
    /// arm and route straight to `BunSocket`.
    pub fn set_kind(&mut self, k: SocketKind) {
        c::us_socket_set_kind(self, k as u8);
    }

    /// Move this socket to a new group/kind, optionally resizing its ext.
    /// Returns the (possibly relocated) socket; `self` is invalid after.
    // TODO: take `self` by value — it is consumed/invalidated; the returned ptr may be a different allocation
    pub fn adopt(
        &mut self,
        g: &mut SocketGroup,
        k: SocketKind,
        old_ext: i32,
        new_ext: i32,
    ) -> Option<NonNull<us_socket_t>> {
        // SAFETY: self and g are live; C may realloc and return a different us_socket_t*
        unsafe { NonNull::new(c::us_socket_adopt(self, g, k as u8, old_ext, new_ext)) }
    }

    /// `adopt` + attach a fresh `SSL*` from `ssl_ctx` (refcounted by the C
    /// side for the socket's lifetime). Does NOT kick the handshake — the
    /// caller must repoint `ext` first (so any dispatch lands in the new
    /// owner) and then call `start_tls_handshake`. Replaces
    /// `us_socket_upgrade_to_tls` / `wrapTLS`.
    // TODO: take `self` by value — it is consumed/invalidated; the returned ptr may be a different allocation
    pub fn adopt_tls(
        &mut self,
        g: &mut SocketGroup,
        k: SocketKind,
        ssl_ctx: &mut SslCtx,
        sni: Option<&core::ffi::CStr>,
        is_client: bool,
        old_ext: i32,
        new_ext: i32,
    ) -> Option<NonNull<us_socket_t>> {
        // SAFETY: self/g/ssl_ctx are live; sni is null or a valid C string; C may
        // realloc and return a different us_socket_t*
        unsafe {
            NonNull::new(c::us_socket_adopt_tls(
                self,
                g,
                k as u8,
                ssl_ctx,
                sni.map_or(ptr::null(), |s| s.as_ptr()),
                is_client as i32,
                old_ext,
                new_ext,
            ))
        }
    }

    /// Send ClientHello. Separate from `adopt_tls` so the ext slot can be
    /// repointed before any handshake/close dispatch can fire.
    pub fn start_tls_handshake(&mut self) {
        c::us_socket_start_tls_handshake(self);
    }

    /// Feed bytes that were already read off the wire (e.g. a ClientHello the
    /// plain-TCP layer consumed before the upgrade) through the same decrypt
    /// path as bytes arriving from the kernel.
    pub fn tls_feed(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        // The C side takes an `int` length: feed in i32-sized chunks instead of
        // truncating the cast (a clamp would silently drop the tail and there is
        // no return value to report a partial feed). Each chunk can re-enter the
        // data dispatch, which may close the socket — stop feeding once it does.
        for chunk in data.chunks(MAX_I32) {
            if self.is_closed() {
                return;
            }
            // SAFETY: `self` is a live TLS `us_socket_t`; `chunk` is valid for its
            // length, which fits in an i32 by construction.
            unsafe {
                c::us_socket_tls_feed(self, chunk.as_ptr().cast(), chunk.len() as i32);
            }
        }
    }

    /// Tee inbound ciphertext to `us_dispatch_ssl_raw_tap` before `SSL_read`
    /// consumes it, so the `[raw, tls]` pair from `upgradeTLS` can surface
    /// encrypted bytes to the original net.Socket `data` listener.
    pub fn set_ssl_raw_tap(&mut self, enabled: bool) {
        c::us_socket_set_ssl_raw_tap(self, enabled as c_int);
    }

    pub fn write(&mut self, data: &[u8]) -> i32 {
        let rc = unsafe {
            // SAFETY: data.as_ptr() valid for data.len() bytes
            c::us_socket_write(
                self,
                data.as_ptr(),
                i32::try_from(data.len().min(MAX_I32)).expect("int cast"),
            )
        };
        bun_core::scoped_log!(uws, "us_socket_write({:p}, {}) = {}", self, data.len(), rc);
        rc
    }

    #[cfg(not(windows))]
    pub fn write_fd(&mut self, data: &[u8], file_descriptor: Fd) -> i32 {
        let rc = unsafe {
            // SAFETY: data.as_ptr() valid for data.len() bytes; fd is a valid native descriptor
            c::us_socket_ipc_write_fd(
                self,
                data.as_ptr(),
                i32::try_from(data.len().min(MAX_I32)).expect("int cast"),
                file_descriptor.native(),
            )
        };
        bun_core::scoped_log!(
            uws,
            "us_socket_ipc_write_fd({:p}, {}, {}) = {}",
            self,
            data.len(),
            file_descriptor.native(),
            rc
        );
        rc
    }
    #[cfg(windows)]
    pub fn write_fd(&mut self, _data: &[u8], _file_descriptor: Fd) -> i32 {
        // A `compile_error!` here would brick the windows build even with no
        // callers (it is evaluated at item definition), so use a runtime trap
        // instead; no current Windows call site.
        unreachable!("us_socket_t::write_fd is not implemented on Windows")
    }

    pub fn write2(&mut self, first: &[u8], second: &[u8]) -> i32 {
        let rc = unsafe {
            // SAFETY: both slices valid for their respective lengths
            c::us_socket_write2(
                self,
                first.as_ptr(),
                first.len(),
                second.as_ptr(),
                second.len(),
            )
        };
        bun_core::scoped_log!(
            uws,
            "us_socket_write2({:p}, {}, {}) = {}",
            self,
            first.len(),
            second.len(),
            rc
        );
        rc
    }

    /// Vectored raw write — all chunks reach the fd in one writev (sequential
    /// sends on platforms without it). Same closed/shutdown gating and
    /// partial-write poll handling as `raw_write`. Plain-TCP only by contract:
    /// raw writes bypass TLS framing.
    pub fn raw_writev(&mut self, iov: &[UsIoVec]) -> i32 {
        bun_core::scoped_log!(uws, "us_socket_raw_writev({:p}, {})", self, iov.len());
        // SAFETY: iov entries reference memory owned by the caller for the
        // duration of this call; the C side only reads them synchronously.
        unsafe {
            c::us_socket_raw_writev(
                self,
                iov.as_ptr(),
                i32::try_from(iov.len()).expect("int cast"),
            )
        }
    }

    /// Bypass TLS — raw bytes to the fd even if `is_tls()`.
    pub fn raw_write(&mut self, data: &[u8]) -> i32 {
        bun_core::scoped_log!(uws, "us_socket_raw_write({:p}, {})", self, data.len());
        unsafe {
            // SAFETY: data.as_ptr() valid for data.len() bytes
            c::us_socket_raw_write(
                self,
                data.as_ptr(),
                i32::try_from(data.len().min(MAX_I32)).expect("int cast"),
            )
        }
    }

    pub fn flush(&mut self) {
        c::us_socket_flush(self);
    }

    pub fn send_file_needs_more(&mut self) {
        c::us_socket_sendfile_needs_more(self);
    }

    pub fn get_fd(&self) -> Fd {
        let raw = c::us_socket_get_fd(self);
        // LIBUS_SOCKET_DESCRIPTOR is `c_int` on POSIX, `SOCKET` (`usize`) on
        // Windows. Tag kind=system explicitly — `from_native` would store raw
        // bits verbatim and mis-tag `INVALID_SOCKET` (~0) as kind=uv.
        #[cfg(windows)]
        {
            Fd::from_system(raw as *mut core::ffi::c_void)
        }
        #[cfg(not(windows))]
        {
            Fd::from_native(raw)
        }
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        c::us_socket_verify_error(self)
    }

    pub fn get_error(&self) -> i32 {
        c::us_socket_get_error(self)
    }

    pub fn is_established(&self) -> bool {
        c::us_socket_is_established(self) > 0
    }
}

/// Raw externs. Private — every operation has a typed method on `us_socket_t`.
mod c {
    use super::*;

    // Every C-side decl takes `us_socket_r` (= `us_socket_t* nonnull_arg`), so
    // mirror that here — passing null is UB and the typed methods above never do.
    // `us_socket_t` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>`, so `&us_socket_t`
    // / `&mut us_socket_t` are ABI-identical to a non-null pointer with no
    // `readonly`/`noalias` attribute. Shims whose only pointer argument is the
    // socket itself (plus value types) are declared `safe fn` so the validity
    // proof lives in the type signature instead of per-call-site `unsafe { }`.
    // Shims that take a (ptr,len) pair, nullable raw, or transfer ownership
    // stay unsafe.
    unsafe extern "C" {
        pub(super) safe fn us_socket_get_native_handle(s: &mut us_socket_t) -> *mut c_void;

        pub(super) safe fn us_socket_local_port(s: &us_socket_t) -> i32;
        pub(super) safe fn us_socket_remote_port(s: &us_socket_t) -> i32;
        pub(super) fn us_socket_remote_address(
            s: *const us_socket_t,
            buf: *mut u8,
            length: *mut i32,
        );
        pub(super) fn us_socket_local_address(
            s: *const us_socket_t,
            buf: *mut u8,
            length: *mut i32,
        );
        pub(super) safe fn us_socket_timeout(s: &mut us_socket_t, seconds: c_uint);
        pub(super) safe fn us_socket_long_timeout(s: &mut us_socket_t, minutes: c_uint);
        pub(super) safe fn us_socket_nodelay(s: &mut us_socket_t, enable: c_int);
        pub(super) safe fn us_socket_set_tos(s: &mut us_socket_t, tos: c_int) -> c_int;
        pub(super) safe fn us_socket_get_tos(s: &mut us_socket_t) -> c_int;
        pub(super) safe fn us_socket_sni_resolve(
            s: &mut us_socket_t,
            ctx: *mut SslCtx,
            error: c_int,
        );
        pub(super) safe fn us_socket_keepalive(
            s: &mut us_socket_t,
            enable: c_int,
            delay: c_uint,
        ) -> c_int;

        pub(super) safe fn us_socket_ext(s: &mut us_socket_t) -> *mut c_void;
        pub(super) safe fn us_socket_group(s: &mut us_socket_t) -> *mut SocketGroup;
        pub(super) safe fn us_socket_kind(s: &us_socket_t) -> u8;
        pub(super) safe fn us_socket_set_kind(s: &mut us_socket_t, kind: u8);
        pub(super) safe fn us_socket_set_ssl_raw_tap(s: &mut us_socket_t, enabled: c_int);
        pub(super) safe fn us_socket_is_tls(s: &us_socket_t) -> i32;

        pub(super) fn us_socket_write(s: *mut us_socket_t, data: *const u8, length: i32) -> i32;
        #[cfg(not(windows))]
        pub(super) fn us_socket_ipc_write_fd(
            s: *mut us_socket_t,
            data: *const u8,
            length: i32,
            fd: i32,
        ) -> i32;
        pub(super) fn us_socket_write2(
            s: *mut us_socket_t,
            header: *const u8,
            len: usize,
            payload: *const u8,
            len2: usize,
        ) -> i32;
        pub(super) fn us_socket_raw_writev(
            s: *mut us_socket_t,
            iov: *const super::UsIoVec,
            count: i32,
        ) -> i32;
        pub(super) fn us_socket_raw_write(s: *mut us_socket_t, data: *const u8, length: i32)
        -> i32;
        pub(super) safe fn us_socket_flush(s: &mut us_socket_t);

        pub(super) fn us_socket_open(
            s: *mut us_socket_t,
            is_client: i32,
            ip: *const u8,
            ip_length: i32,
        ) -> *mut us_socket_t;
        pub(super) safe fn us_socket_pause(s: &mut us_socket_t);
        pub(super) safe fn us_socket_resume(s: &mut us_socket_t);
        pub(super) fn us_socket_close(
            s: *mut us_socket_t,
            code: CloseCode,
            reason: *mut c_void,
        ) -> *mut us_socket_t;
        pub(super) safe fn us_socket_shutdown(s: &mut us_socket_t);
        pub(super) safe fn us_socket_is_closed(s: &us_socket_t) -> i32;
        pub(super) fn us_socket_write_check_error(
            s: &us_socket_t,
            data: *const core::ffi::c_char,
            length: i32,
            fatal_write_error: *mut i32,
        ) -> i32;
        pub(super) safe fn us_socket_shutdown_read(s: &mut us_socket_t);
        pub(super) safe fn us_socket_is_shut_down(s: &us_socket_t) -> i32;
        pub(super) safe fn us_socket_sendfile_needs_more(socket: &mut us_socket_t);
        pub(super) safe fn us_socket_get_fd(s: &us_socket_t) -> LIBUS_SOCKET_DESCRIPTOR;
        pub(super) safe fn us_socket_verify_error(s: &us_socket_t) -> us_bun_verify_error_t;
        pub(super) safe fn us_socket_get_error(s: &us_socket_t) -> c_int;
        pub(super) safe fn us_socket_is_established(s: &us_socket_t) -> i32;

        pub(super) fn us_socket_adopt(
            s: *mut us_socket_t,
            group: *mut SocketGroup,
            kind: u8,
            old_ext_size: i32,
            ext_size: i32,
        ) -> *mut us_socket_t;
        /// ssl_ctx is required (the whole point); sni may be null.
        pub(super) fn us_socket_adopt_tls(
            s: *mut us_socket_t,
            group: *mut SocketGroup,
            kind: u8,
            ssl_ctx: *mut SslCtx,
            sni: *const c_char,
            is_client: i32,
            old_ext_size: i32,
            ext_size: i32,
        ) -> *mut us_socket_t;
        /// Feed already-read bytes through the TLS decrypt path.
        pub(super) fn us_socket_tls_feed(
            s: *mut us_socket_t,
            data: *const c_char,
            length: i32,
        ) -> *mut us_socket_t;
        pub(super) safe fn us_socket_start_tls_handshake(s: &mut us_socket_t);
    }
}

#[repr(C)]
#[derive(Default)]
pub struct us_socket_stream_buffer_t {
    pub total_bytes_written: usize,
}

impl us_socket_stream_buffer_t {
    pub fn wrote(&mut self, written: usize) {
        self.total_bytes_written = self.total_bytes_written.saturating_add(written);
    }
}
// us_socket_buffered_js_write moved to src/runtime/socket/uws_jsc.rs
