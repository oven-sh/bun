use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{self, NonNull};

use bun_sys::Fd;

use crate::{SocketGroup, SocketKind, SslCtx, LIBUS_SOCKET_DESCRIPTOR, us_bun_verify_error_t};

bun_output::declare_scope!(uws, visible);

const MAX_I32: usize = i32::MAX as usize;

/// Rust bindings for `us_socket_t`.
///
/// TLS is per-socket (`s->ssl != NULL` in C); there is no `int ssl` selector.
/// Dispatch is by `kind()` — see `SocketKind` and `dispatch.rs`.
///
/// Higher-level wrappers (`uws::SocketTCP`/`SocketTLS`) cover named pipes,
/// upgraded duplexes, and async DNS.
#[repr(C)]
pub struct us_socket_t {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

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

impl us_socket_t {
    pub fn open(&mut self, is_client: bool, ip_addr: Option<&[u8]>) {
        bun_output::scoped_log!(uws, "us_socket_open({:p}, is_client: {})", self, is_client);
        if let Some(ip) = ip_addr {
            debug_assert!(ip.len() < MAX_I32);
            unsafe {
                // SAFETY: self is a live us_socket_t; ip.ptr valid for ip.len bytes
                let _ = c::us_socket_open(
                    self,
                    is_client as i32,
                    ip.as_ptr(),
                    i32::try_from(ip.len().min(MAX_I32)).unwrap(),
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
        bun_output::scoped_log!(uws, "us_socket_pause({:p})", self);
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_pause(self) };
    }

    pub fn resume(&mut self) {
        bun_output::scoped_log!(uws, "us_socket_resume({:p})", self);
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_resume(self) };
    }

    pub fn close(&mut self, code: CloseCode) {
        bun_output::scoped_log!(uws, "us_socket_close({:p}, {})", self, <&'static str>::from(code));
        unsafe {
            // SAFETY: self is a live us_socket_t
            let _ = c::us_socket_close(self, code, ptr::null_mut());
        }
    }

    pub fn shutdown(&mut self) {
        bun_output::scoped_log!(uws, "us_socket_shutdown({:p})", self);
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_shutdown(self) };
    }

    pub fn shutdown_read(&mut self) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_shutdown_read(self) };
    }

    pub fn is_closed(&self) -> bool {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_is_closed(self as *const _ as *mut _) > 0 }
    }

    pub fn is_shutdown(&self) -> bool {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_is_shut_down(self as *const _ as *mut _) > 0 }
    }

    pub fn is_tls(&self) -> bool {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_is_tls(self as *const _ as *mut _) > 0 }
    }

    pub fn local_port(&self) -> i32 {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_local_port(self as *const _ as *mut _) }
    }

    pub fn remote_port(&self) -> i32 {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_remote_port(self as *const _ as *mut _) }
    }

    /// Returned slice is a view into `buf`.
    // TODO(port): narrow error set
    pub fn local_address<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        let mut length: i32 = i32::try_from(buf.len().min(MAX_I32)).unwrap();
        unsafe {
            // SAFETY: buf.as_mut_ptr() valid for `length` bytes; length is in/out
            c::us_socket_local_address(self as *const _ as *mut _, buf.as_mut_ptr(), &mut length);
        }
        if length < 0 {
            let errno = bun_sys::get_errno(length);
            debug_assert!(errno != bun_sys::Errno::SUCCESS);
            // TODO(port): bun.errnoToZigErr — map errno to bun_core::Error
            return Err(bun_sys::errno_to_err(errno));
        }
        debug_assert!(buf.len() >= length as usize);
        Ok(&buf[..usize::try_from(length).unwrap()])
    }

    /// Returned slice is a view into `buf`. On error, `errno` should be set.
    // TODO(port): narrow error set
    pub fn remote_address<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        let mut length: i32 = i32::try_from(buf.len().min(MAX_I32)).unwrap();
        unsafe {
            // SAFETY: buf.as_mut_ptr() valid for `length` bytes; length is in/out
            c::us_socket_remote_address(self as *const _ as *mut _, buf.as_mut_ptr(), &mut length);
        }
        if length < 0 {
            let errno = bun_sys::get_errno(length);
            debug_assert!(errno != bun_sys::Errno::SUCCESS);
            // TODO(port): bun.errnoToZigErr — map errno to bun_core::Error
            return Err(bun_sys::errno_to_err(errno));
        }
        debug_assert!(buf.len() >= length as usize);
        Ok(&buf[..usize::try_from(length).unwrap()])
    }

    pub fn set_timeout(&mut self, seconds: u32) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_timeout(self, seconds) };
    }

    pub fn set_long_timeout(&mut self, minutes: u32) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_long_timeout(self, minutes) };
    }

    pub fn set_nodelay(&mut self, enabled: bool) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_nodelay(self, enabled as c_int) };
    }

    pub fn set_keepalive(&mut self, enabled: bool, delay: u32) -> i32 {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_keepalive(self, enabled as c_int, delay) }
    }

    /// `SSL*` if TLS, else null. Use `get_fd()` for the descriptor.
    pub fn ssl(&mut self) -> Option<&mut bun_boringssl_sys::SSL> {
        if !self.is_tls() {
            return None;
        }
        unsafe {
            // SAFETY: is_tls() guarantees the native handle is a non-null SSL*
            (c::us_socket_get_native_handle(self) as *mut bun_boringssl_sys::SSL).as_mut()
        }
    }

    /// Node-compat `_handle` shape: `SSL*` for TLS sockets, fd-as-pointer for
    /// plain TCP. Consumers that want one or the other should call `ssl()` /
    /// `get_fd()` directly; this is the round-trip-to-JS form.
    pub fn get_native_handle(&mut self) -> Option<*mut c_void> {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        let p = unsafe { c::us_socket_get_native_handle(self) };
        if p.is_null() { None } else { Some(p) }
    }

    pub fn ext<T>(&mut self) -> &mut T {
        unsafe {
            // SAFETY: us_socket_ext returns LIBUS_EXT_ALIGNMENT-aligned storage
            // sized for T at socket creation; caller picks the same T it stored.
            &mut *(c::us_socket_ext(self) as *mut T)
        }
    }

    /// Type-erased ext storage — `LIBUS_EXT_ALIGNMENT`-aligned bytes
    /// immediately after the C struct. Prefer `ext<T>()`.
    pub fn ext_ptr(&mut self) -> *mut u8 {
        // TODO(port): Rust pointer types do not carry alignment; LIBUS_EXT_ALIGNMENT == 16
        // SAFETY: self is a live us_socket_t; us_socket_ext returns aligned ext storage
        unsafe { c::us_socket_ext(self) as *mut u8 }
    }

    pub fn group(&mut self) -> &mut SocketGroup {
        unsafe {
            // SAFETY: us_socket_group never returns null for a live socket
            &mut *c::us_socket_group(self)
        }
    }
    // Zig: `pub const rawGroup = group;`
    #[inline]
    pub fn raw_group(&mut self) -> &mut SocketGroup {
        self.group()
    }

    pub fn kind(&self) -> SocketKind {
        unsafe {
            // SAFETY: SocketKind is #[repr(u8)] and the C side only stores valid discriminants
            core::mem::transmute::<u8, SocketKind>(c::us_socket_kind(self as *const _ as *mut _))
        }
    }

    /// Re-stamp the dispatch kind in place. Used after `Listener.onCreate`
    /// stashes the `NewSocket*` in ext so subsequent events skip the listener
    /// arm and route straight to `BunSocket`.
    pub fn set_kind(&mut self, k: SocketKind) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_set_kind(self, k as u8) };
    }

    /// Move this socket to a new group/kind, optionally resizing its ext.
    /// Returns the (possibly relocated) socket; `self` is invalid after.
    // TODO(port): lifetime — self is consumed/invalidated; returned ptr may be a different allocation
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
    // TODO(port): lifetime — self is consumed/invalidated; returned ptr may be a different allocation
    pub fn adopt_tls(
        &mut self,
        g: &mut SocketGroup,
        k: SocketKind,
        ssl_ctx: &mut SslCtx,
        sni: Option<&core::ffi::CStr>,
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
                old_ext,
                new_ext,
            ))
        }
    }

    /// Send ClientHello. Separate from `adopt_tls` so the ext slot can be
    /// repointed before any handshake/close dispatch can fire.
    pub fn start_tls_handshake(&mut self) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_start_tls_handshake(self) };
    }

    /// Tee inbound ciphertext to `us_dispatch_ssl_raw_tap` before `SSL_read`
    /// consumes it, so the `[raw, tls]` pair from `upgradeTLS` can surface
    /// encrypted bytes to the original net.Socket `data` listener.
    pub fn set_ssl_raw_tap(&mut self, enabled: bool) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_set_ssl_raw_tap(self, enabled as c_int) };
    }

    pub fn write(&mut self, data: &[u8]) -> i32 {
        let rc = unsafe {
            // SAFETY: data.as_ptr() valid for data.len() bytes
            c::us_socket_write(self, data.as_ptr(), i32::try_from(data.len().min(MAX_I32)).unwrap())
        };
        bun_output::scoped_log!(uws, "us_socket_write({:p}, {}) = {}", self, data.len(), rc);
        rc
    }

    #[cfg(not(windows))]
    pub fn write_fd(&mut self, data: &[u8], file_descriptor: Fd) -> i32 {
        let rc = unsafe {
            // SAFETY: data.as_ptr() valid for data.len() bytes; fd is a valid native descriptor
            c::us_socket_ipc_write_fd(
                self,
                data.as_ptr(),
                i32::try_from(data.len().min(MAX_I32)).unwrap(),
                file_descriptor.native(),
            )
        };
        bun_output::scoped_log!(
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
        compile_error!("TODO: implement write_fd on Windows");
    }

    pub fn write2(&mut self, first: &[u8], second: &[u8]) -> i32 {
        let rc = unsafe {
            // SAFETY: both slices valid for their respective lengths
            c::us_socket_write2(self, first.as_ptr(), first.len(), second.as_ptr(), second.len())
        };
        bun_output::scoped_log!(uws, "us_socket_write2({:p}, {}, {}) = {}", self, first.len(), second.len(), rc);
        rc
    }

    /// Bypass TLS — raw bytes to the fd even if `is_tls()`.
    pub fn raw_write(&mut self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(uws, "us_socket_raw_write({:p}, {})", self, data.len());
        unsafe {
            // SAFETY: data.as_ptr() valid for data.len() bytes
            c::us_socket_raw_write(self, data.as_ptr(), i32::try_from(data.len().min(MAX_I32)).unwrap())
        }
    }

    pub fn flush(&mut self) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_flush(self) };
    }

    pub fn send_file_needs_more(&mut self) {
        // SAFETY: self is a live us_socket_t (us_socket_r is nonnull_arg)
        unsafe { c::us_socket_sendfile_needs_more(self) };
    }

    pub fn get_fd(&self) -> Fd {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        Fd::from_native(unsafe { c::us_socket_get_fd(self as *const _ as *mut _) })
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_verify_error(self as *const _ as *mut _) }
    }

    pub fn get_error(&self) -> i32 {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_get_error(self as *const _ as *mut _) }
    }

    pub fn is_established(&self) -> bool {
        // SAFETY: self is a live us_socket_t; C side does not mutate through this pointer
        unsafe { c::us_socket_is_established(self as *const _ as *mut _) > 0 }
    }
}

/// Raw externs. Private — every operation has a typed method on `us_socket_t`.
mod c {
    use super::*;

    // Every C-side decl takes `us_socket_r` (= `us_socket_t* nonnull_arg`), so
    // mirror that here — passing null is UB and the typed methods above never do.
    unsafe extern "C" {
        pub fn us_socket_get_native_handle(s: *mut us_socket_t) -> *mut c_void;

        pub fn us_socket_local_port(s: *mut us_socket_t) -> i32;
        pub fn us_socket_remote_port(s: *mut us_socket_t) -> i32;
        pub fn us_socket_remote_address(s: *mut us_socket_t, buf: *mut u8, length: *mut i32);
        pub fn us_socket_local_address(s: *mut us_socket_t, buf: *mut u8, length: *mut i32);
        pub fn us_socket_timeout(s: *mut us_socket_t, seconds: c_uint);
        pub fn us_socket_long_timeout(s: *mut us_socket_t, minutes: c_uint);
        pub fn us_socket_nodelay(s: *mut us_socket_t, enable: c_int);
        pub fn us_socket_keepalive(s: *mut us_socket_t, enable: c_int, delay: c_uint) -> c_int;

        pub fn us_socket_ext(s: *mut us_socket_t) -> *mut c_void;
        pub fn us_socket_group(s: *mut us_socket_t) -> *mut SocketGroup;
        pub fn us_socket_kind(s: *mut us_socket_t) -> u8;
        pub fn us_socket_set_kind(s: *mut us_socket_t, kind: u8);
        pub fn us_socket_set_ssl_raw_tap(s: *mut us_socket_t, enabled: c_int);
        pub fn us_socket_is_tls(s: *mut us_socket_t) -> i32;

        pub fn us_socket_write(s: *mut us_socket_t, data: *const u8, length: i32) -> i32;
        pub fn us_socket_ipc_write_fd(s: *mut us_socket_t, data: *const u8, length: i32, fd: i32) -> i32;
        pub fn us_socket_write2(s: *mut us_socket_t, header: *const u8, len: usize, payload: *const u8, len2: usize) -> i32;
        pub fn us_socket_raw_write(s: *mut us_socket_t, data: *const u8, length: i32) -> i32;
        pub fn us_socket_flush(s: *mut us_socket_t);

        pub fn us_socket_open(s: *mut us_socket_t, is_client: i32, ip: *const u8, ip_length: i32) -> *mut us_socket_t;
        pub fn us_socket_pause(s: *mut us_socket_t);
        pub fn us_socket_resume(s: *mut us_socket_t);
        pub fn us_socket_close(s: *mut us_socket_t, code: CloseCode, reason: *mut c_void) -> *mut us_socket_t;
        pub fn us_socket_shutdown(s: *mut us_socket_t);
        pub fn us_socket_is_closed(s: *mut us_socket_t) -> i32;
        pub fn us_socket_shutdown_read(s: *mut us_socket_t);
        pub fn us_socket_is_shut_down(s: *mut us_socket_t) -> i32;
        pub fn us_socket_sendfile_needs_more(socket: *mut us_socket_t);
        pub fn us_socket_get_fd(s: *mut us_socket_t) -> LIBUS_SOCKET_DESCRIPTOR;
        pub fn us_socket_verify_error(s: *mut us_socket_t) -> us_bun_verify_error_t;
        pub fn us_socket_get_error(s: *mut us_socket_t) -> c_int;
        pub fn us_socket_is_established(s: *mut us_socket_t) -> i32;

        pub fn us_socket_adopt(s: *mut us_socket_t, group: *mut SocketGroup, kind: u8, old_ext_size: i32, ext_size: i32) -> *mut us_socket_t;
        /// ssl_ctx is required (the whole point); sni may be null.
        pub fn us_socket_adopt_tls(s: *mut us_socket_t, group: *mut SocketGroup, kind: u8, ssl_ctx: *mut SslCtx, sni: *const c_char, old_ext_size: i32, ext_size: i32) -> *mut us_socket_t;
        pub fn us_socket_start_tls_handshake(s: *mut us_socket_t);
    }
}

#[repr(C)]
pub struct us_socket_stream_buffer_t {
    pub list_ptr: *mut u8,
    pub list_cap: usize,
    pub list_len: usize,
    pub total_bytes_written: usize,
    pub cursor: usize,
}

impl Default for us_socket_stream_buffer_t {
    fn default() -> Self {
        Self {
            list_ptr: ptr::null_mut(),
            list_cap: 0,
            list_len: 0,
            total_bytes_written: 0,
            cursor: 0,
        }
    }
}

impl us_socket_stream_buffer_t {
    // TODO(port): ownership — Zig does not free the previous list_ptr here; matches that.
    pub fn update(&mut self, stream_buffer: bun_io::StreamBuffer) {
        // Decompose the Vec<u8> backing `stream_buffer.list` into raw parts so
        // the C side can read ptr/len/cap directly.
        let mut list = core::mem::ManuallyDrop::new(stream_buffer.list);
        if list.capacity() > 0 {
            self.list_ptr = list.as_mut_ptr();
        } else {
            self.list_ptr = ptr::null_mut();
        }
        self.list_len = list.len();
        self.list_cap = list.capacity();
        self.cursor = stream_buffer.cursor;
    }

    pub fn wrote(&mut self, written: usize) {
        self.total_bytes_written = self.total_bytes_written.saturating_add(written);
    }

    pub fn to_stream_buffer(&self) -> bun_io::StreamBuffer {
        bun_io::StreamBuffer {
            list: if !self.list_ptr.is_null() {
                unsafe {
                    // SAFETY: list_ptr/list_len/list_cap were produced by decomposing a
                    // Vec<u8> in `update`; global allocator (mimalloc) matches.
                    Vec::from_raw_parts(self.list_ptr, self.list_len, self.list_cap)
                }
            } else {
                Vec::new()
            },
            cursor: self.cursor,
        }
    }

    /// Explicit teardown — this struct is `#[repr(C)]` and freed via the
    /// exported `us_socket_free_stream_buffer`, so no `Drop` impl.
    ///
    /// SAFETY: `this` must point to a live `us_socket_stream_buffer_t` whose
    /// `list_ptr`/`list_cap` were produced by `update` (decomposed `Vec<u8>` on
    /// the global mimalloc allocator). Not called more than once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` is non-null and exclusively borrowed
        let this = unsafe { &mut *this };
        if !this.list_ptr.is_null() {
            unsafe {
                // SAFETY: list_ptr/list_cap came from a decomposed Vec<u8> (global mimalloc).
                drop(Vec::from_raw_parts(this.list_ptr, 0, this.list_cap));
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_free_stream_buffer(buffer: *mut us_socket_stream_buffer_t) {
    // SAFETY: caller (C) passes a live us_socket_stream_buffer_t*
    unsafe { us_socket_stream_buffer_t::destroy(buffer) };
}
// us_socket_buffered_js_write moved to src/runtime/socket/uws_jsc.rs

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/us_socket_t.zig (350 lines)
//   confidence: medium-high
//   todos:      6
//   notes:      adopt/adopt_tls return NonNull (self invalidated); errno_to_err mapping & bun_io::StreamBuffer shape need Phase B verification; all unsafe blocks SAFETY-annotated
// ──────────────────────────────────────────────────────────────────────────
