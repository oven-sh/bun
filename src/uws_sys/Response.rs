//! Rust wrapper around `uws::Response<bool isSSL>` from µWebSockets.
//!
//! This provides a type-safe Rust interface to the underlying C++ `uws::Response` template.
//! The `SSL` const parameter determines whether this wraps `uws::Response<true>` (SSL/TLS)
//! or `uws::Response<false>` (plain HTTP).
//!
//! The wrapper:
//! - Uses opaque types to hide the C++ implementation details
//! - Provides compile-time SSL/TLS specialization via the `SSL` const parameter
//! - Offers safe casting between Rust and C representations
//! - Maintains zero-cost abstractions over the underlying µWebSockets API

use core::ffi::{c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};

use bun_sys::Fd;
use bun_uws::{Socket, SocketAddress, SocketData, WebSocketUpgradeContext};
use bun_uws_sys::us_socket_t;

/// Opaque handle for `uws::Response<SSL>`.
///
/// In Zig this is `pub fn NewResponse(ssl_flag: i32) type { return opaque { ... } }`.
/// Rust models the comptime `ssl_flag` as a `const SSL: bool` parameter on an opaque
/// extern type (Nomicon pattern).
#[repr(C)]
pub struct Response<const SSL: bool> {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl<const SSL: bool> Response<SSL> {
    #[inline(always)]
    const fn ssl_flag() -> i32 {
        SSL as i32
    }

    #[inline]
    pub fn cast_res(res: *mut c::uws_res) -> *mut Response<SSL> {
        res.cast::<Response<SSL>>()
    }

    #[inline]
    pub fn downcast(&mut self) -> *mut c::uws_res {
        (self as *mut Self).cast::<c::uws_res>()
    }

    #[inline]
    pub fn downcast_socket(&mut self) -> *mut us_socket_t {
        (self as *mut Self).cast::<us_socket_t>()
    }

    pub fn end(&mut self, data: &[u8], close_connection: bool) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_end(
                Self::ssl_flag(),
                self.downcast(),
                data.as_ptr(),
                data.len(),
                close_connection,
            );
        }
    }

    pub fn try_end(&mut self, data: &[u8], total: usize, close_: bool) -> bool {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_try_end(
                Self::ssl_flag(),
                self.downcast(),
                data.as_ptr(),
                data.len(),
                total,
                close_,
            )
        }
    }

    pub fn get_socket_data(&mut self) -> *mut c_void {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_get_socket_data(Self::ssl_flag(), self.downcast()).cast() }
    }

    pub fn is_connect_request(&mut self) -> bool {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_is_connect_request(Self::ssl_flag(), self.downcast()) }
    }

    pub fn flush_headers(&mut self, flush_immediately: bool) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_flush_headers(Self::ssl_flag(), self.downcast(), flush_immediately) }
    }

    pub fn is_corked(&mut self) -> bool {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_is_corked(Self::ssl_flag(), self.downcast()) }
    }

    pub fn state(&self) -> State {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_state(
                Self::ssl_flag() as c_int,
                (self as *const Self).cast::<c::uws_res>(),
            )
        }
    }

    pub fn should_close_connection(&self) -> bool {
        self.state().is_http_connection_close()
    }

    pub fn prepare_for_sendfile(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_prepare_for_sendfile(Self::ssl_flag(), self.downcast()) }
    }

    pub fn uncork(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_uncork(Self::ssl_flag(), self.downcast()) }
    }

    pub fn pause(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_pause(Self::ssl_flag(), self.downcast()) }
    }

    pub fn resume_(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_resume(Self::ssl_flag(), self.downcast()) }
    }

    pub fn write_continue(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_write_continue(Self::ssl_flag(), self.downcast()) }
    }

    pub fn write_status(&mut self, status: &[u8]) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_write_status(
                Self::ssl_flag(),
                self.downcast(),
                status.as_ptr(),
                status.len(),
            )
        }
    }

    pub fn write_header(&mut self, key: &[u8], value: &[u8]) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_write_header(
                Self::ssl_flag(),
                self.downcast(),
                key.as_ptr(),
                key.len(),
                value.as_ptr(),
                value.len(),
            )
        }
    }

    pub fn write_header_int(&mut self, key: &[u8], value: u64) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_write_header_int(
                Self::ssl_flag(),
                self.downcast(),
                key.as_ptr(),
                key.len(),
                value,
            )
        }
    }

    pub fn end_without_body(&mut self, close_connection: bool) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_end_without_body(Self::ssl_flag(), self.downcast(), close_connection) }
    }

    pub fn end_send_file(&mut self, write_offset: u64, close_connection: bool) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_end_sendfile(
                Self::ssl_flag(),
                self.downcast(),
                write_offset,
                close_connection,
            )
        }
    }

    pub fn timeout(&mut self, seconds: u8) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_timeout(Self::ssl_flag(), self.downcast(), seconds) }
    }

    pub fn reset_timeout(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_reset_timeout(Self::ssl_flag(), self.downcast()) }
    }

    pub fn get_buffered_amount(&mut self) -> u64 {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_get_buffered_amount(Self::ssl_flag(), self.downcast()) }
    }

    pub fn write(&mut self, data: &[u8]) -> WriteResult {
        let mut len: usize = data.len();
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        match unsafe { c::uws_res_write(Self::ssl_flag(), self.downcast(), data.as_ptr(), &mut len) }
        {
            true => WriteResult::WantMore(len),
            false => WriteResult::Backpressure(len),
        }
    }

    pub fn get_write_offset(&mut self) -> u64 {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_get_write_offset(Self::ssl_flag(), self.downcast()) }
    }

    pub fn override_write_offset<T>(&mut self, offset: T)
    where
        u64: TryFrom<T>,
        <u64 as TryFrom<T>>::Error: core::fmt::Debug,
    {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_override_write_offset(
                Self::ssl_flag(),
                self.downcast(),
                u64::try_from(offset).unwrap(),
            )
        }
    }

    pub fn has_responded(&mut self) -> bool {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_has_responded(Self::ssl_flag(), self.downcast()) }
    }

    pub fn mark_wrote_content_length_header(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_mark_wrote_content_length_header(Self::ssl_flag(), self.downcast()) }
    }

    pub fn write_mark(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_write_mark(Self::ssl_flag(), self.downcast()) }
    }

    pub fn get_native_handle(&mut self) -> Fd {
        #[cfg(windows)]
        {
            // on windows uSockets exposes SOCKET
            // SAFETY: uws_res_get_native_handle returns the OS SOCKET handle as a pointer.
            return Fd::from_native(unsafe {
                c::uws_res_get_native_handle(Self::ssl_flag(), self.downcast())
            }
            .cast());
        }
        #[cfg(not(windows))]
        {
            // SAFETY: uws_res_get_native_handle returns the fd encoded as a pointer value.
            Fd::from_native(
                c_int::try_from(
                    unsafe { c::uws_res_get_native_handle(Self::ssl_flag(), self.downcast()) }
                        as usize,
                )
                .unwrap(),
            )
        }
    }

    pub fn get_remote_address_as_text(&mut self) -> Option<&[u8]> {
        let mut buf: *const u8 = core::ptr::null();
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        let size = unsafe {
            c::uws_res_get_remote_address_as_text(Self::ssl_flag(), self.downcast(), &mut buf)
        };
        if size > 0 {
            // SAFETY: uws populated `buf` with `size` bytes valid while the response lives.
            Some(unsafe { core::slice::from_raw_parts(buf, size) })
        } else {
            None
        }
    }

    pub fn get_remote_socket_info(&mut self) -> Option<SocketAddress> {
        let mut ip_ptr: *const u8 = core::ptr::null();
        let mut port: i32 = 0;
        let mut is_ipv6: bool = false;
        // This function will fill in the slots and return len.
        // if len is zero it will not fill in the slots so it is ub to
        // return the struct in that case.
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        let ip_len = unsafe {
            c::uws_res_get_remote_address_info(self.downcast(), &mut ip_ptr, &mut port, &mut is_ipv6)
        };
        if ip_len > 0 {
            // TODO(port): SocketAddress field layout — Zig stores `ip: []const u8`
            // (ptr+len into uws-owned memory), `port: i32`, `is_ipv6: bool`. Adjust
            // to whatever bun_uws::SocketAddress exposes in Rust.
            Some(SocketAddress {
                // SAFETY: uws populated ip_ptr/ip_len with bytes valid while the response lives.
                ip: unsafe { core::slice::from_raw_parts(ip_ptr, ip_len) },
                port,
                is_ipv6,
            })
        } else {
            None
        }
    }

    pub fn on_writable<U>(
        &mut self,
        _handler: fn(*mut U, u64, &mut Response<SSL>) -> bool,
        user_data: *mut U,
    ) {
        // TODO(port): Zig takes `comptime handler` and bakes it into the trampoline at
        // monomorphization time. Rust cannot capture a runtime fn pointer in a bare
        // `extern "C"` trampoline without extra storage. Phase B: convert callers to a
        // trait (`trait OnWritable { fn on_writable(&mut self, amount: u64, res: ...) -> bool }`)
        // or generate the trampoline via macro so `handler` is a type-level constant.
        unsafe extern "C" fn handle<U, const SSL: bool>(
            this: *mut c::uws_res,
            amount: u64,
            data: *mut c_void,
        ) -> bool {
            if !data.is_null() {
                // null should always be treated as a no-op, there's no case where it should have any effect.
                // PERF(port): was @call(.always_inline)
                let _ = (this, amount, data.cast::<U>());
                // TODO(port): invoke `handler` here once trait/macro shape lands.
            }
            true
        }
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_on_writable(
                Self::ssl_flag(),
                self.downcast(),
                Some(handle::<U, SSL>),
                user_data.cast(),
            );
        }
    }

    pub fn clear_on_writable(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_clear_on_writable(Self::ssl_flag(), self.downcast()) }
    }

    #[inline]
    pub fn mark_needs_more(&mut self) {
        if !SSL {
            // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
            unsafe { c::us_socket_mark_needs_more_not_ssl(self.downcast()) }
        }
    }

    pub fn on_aborted<U>(
        &mut self,
        _handler: fn(*mut U, &mut Response<SSL>),
        optional_data: *mut U,
    ) {
        // TODO(port): see on_writable — comptime handler monomorphization.
        unsafe extern "C" fn handle<U, const SSL: bool>(
            this: *mut c::uws_res,
            user_data: *mut c_void,
        ) {
            if !user_data.is_null() {
                // null should always be treated as a no-op, there's no case where it should have any effect.
                // PERF(port): was @call(.always_inline)
                let _ = (this, user_data.cast::<U>());
                // TODO(port): invoke `handler` here once trait/macro shape lands.
            }
        }
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_on_aborted(
                Self::ssl_flag(),
                self.downcast(),
                Some(handle::<U, SSL>),
                optional_data.cast(),
            );
        }
    }

    pub fn clear_aborted(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_on_aborted(Self::ssl_flag(), self.downcast(), None, core::ptr::null_mut()) }
    }

    pub fn on_timeout<U>(
        &mut self,
        _handler: fn(*mut U, &mut Response<SSL>),
        optional_data: *mut U,
    ) {
        // TODO(port): see on_writable — comptime handler monomorphization.
        unsafe extern "C" fn handle<U, const SSL: bool>(
            this: *mut c::uws_res,
            user_data: *mut c_void,
        ) {
            if !user_data.is_null() {
                // null should always be treated as a no-op, there's no case where it should have any effect.
                // PERF(port): was @call(.always_inline)
                let _ = (this, user_data.cast::<U>());
                // TODO(port): invoke `handler` here once trait/macro shape lands.
            }
        }
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_on_timeout(
                Self::ssl_flag(),
                self.downcast(),
                Some(handle::<U, SSL>),
                optional_data.cast(),
            );
        }
    }

    pub fn clear_timeout(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_on_timeout(Self::ssl_flag(), self.downcast(), None, core::ptr::null_mut()) }
    }

    pub fn clear_on_data(&mut self) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_on_data(Self::ssl_flag(), self.downcast(), None, core::ptr::null_mut()) }
    }

    pub fn on_data<U>(
        &mut self,
        _handler: fn(*mut U, &mut Response<SSL>, chunk: &[u8], last: bool),
        optional_data: *mut U,
    ) {
        // TODO(port): see on_writable — comptime handler monomorphization.
        unsafe extern "C" fn handle<U, const SSL: bool>(
            this: *mut c::uws_res,
            chunk_ptr: *const u8,
            len: usize,
            last: bool,
            user_data: *mut c_void,
        ) {
            if !user_data.is_null() {
                // null should always be treated as a no-op, there's no case where it should have any effect.
                let _chunk: &[u8] = if len > 0 {
                    // SAFETY: chunk_ptr/len come from uws and are valid for this call.
                    unsafe { core::slice::from_raw_parts(chunk_ptr, len) }
                } else {
                    b""
                };
                // PERF(port): was @call(.always_inline)
                let _ = (this, last, user_data.cast::<U>());
                // TODO(port): invoke `handler` here once trait/macro shape lands.
            }
        }
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_on_data(
                Self::ssl_flag(),
                self.downcast(),
                Some(handle::<U, SSL>),
                optional_data.cast(),
            );
        }
    }

    pub fn end_stream(&mut self, close_connection: bool) {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe { c::uws_res_end_stream(Self::ssl_flag(), self.downcast(), close_connection) }
    }

    /// Run `handler` while the response is corked. Zig signature took
    /// `comptime handler: anytype, args_tuple: ArgsTuple(@TypeOf(handler))`;
    /// in Rust callers pass a closure capturing what would have been the args tuple.
    // PORT NOTE: reshaped — `(handler, args_tuple)` collapsed to `FnOnce()`.
    pub fn corked<F: FnOnce()>(&mut self, f: F) {
        unsafe extern "C" fn handle<F: FnOnce()>(user_data: *mut c_void) {
            // SAFETY: user_data points at a stack `ManuallyDrop<F>` valid for this synchronous call.
            let f = unsafe { core::ptr::read(user_data.cast::<F>()) };
            // PERF(port): was @call(.always_inline)
            f();
        }
        let mut f = core::mem::ManuallyDrop::new(f);
        // SAFETY: self is a live opaque uws_res handle owned by uWS; cork is synchronous so the
        // stack-allocated closure outlives the FFI call.
        unsafe {
            c::uws_res_cork(
                Self::ssl_flag(),
                self.downcast(),
                (&mut *f as *mut F).cast::<c_void>(),
                handle::<F>,
            );
        }
    }

    pub fn run_corked_with_type<U>(&mut self, handler: fn(*mut U), optional_data: *mut U) {
        // cork is synchronous, so we can stack-allocate the (handler, data) pair
        // and recover it inside the trampoline.
        type Ctx<U> = (fn(*mut U), *mut U);
        unsafe extern "C" fn handle<U>(user_data: *mut c_void) {
            // SAFETY: user_data points at a stack Ctx<U> valid for this synchronous call.
            let ctx = unsafe { &*user_data.cast::<Ctx<U>>() };
            // PERF(port): was @call(.always_inline)
            (ctx.0)(ctx.1);
        }
        let mut ctx: Ctx<U> = (handler, optional_data);
        // SAFETY: self is a live opaque uws_res handle owned by uWS; cork is synchronous so the
        // stack-allocated ctx outlives the FFI call.
        unsafe {
            c::uws_res_cork(
                Self::ssl_flag(),
                self.downcast(),
                (&mut ctx as *mut Ctx<U>).cast::<c_void>(),
                handle::<U>,
            );
        }
    }

    pub fn upgrade<D>(
        &mut self,
        data: *mut D,
        sec_web_socket_key: &[u8],
        sec_web_socket_protocol: &[u8],
        sec_web_socket_extensions: &[u8],
        ctx: Option<&mut WebSocketUpgradeContext>,
    ) -> *mut Socket {
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        unsafe {
            c::uws_res_upgrade(
                Self::ssl_flag(),
                self.downcast(),
                data.cast::<c_void>(),
                sec_web_socket_key.as_ptr(),
                sec_web_socket_key.len(),
                sec_web_socket_protocol.as_ptr(),
                sec_web_socket_protocol.len(),
                sec_web_socket_extensions.as_ptr(),
                sec_web_socket_extensions.len(),
                ctx.map_or(core::ptr::null_mut(), |c| c as *mut _),
            )
        }
    }
}

pub type TCPResponse = Response<false>;
pub type TLSResponse = Response<true>;

#[derive(Clone, Copy)]
pub enum AnyResponse {
    SSL(*mut TLSResponse),
    TCP(*mut TCPResponse),
    H3(*mut H3Response),
}

// Helper: dispatch to the underlying response, calling the same-named method on each
// variant. The Zig `switch (this) { inline else => |resp| resp.method(args...) }`
// monomorphizes per variant; we write the three arms out by hand.
macro_rules! any_dispatch {
    ($self:expr, |$r:ident| $body:expr) => {
        match $self {
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                let $r = unsafe { &mut *ptr };
                $body
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                let $r = unsafe { &mut *ptr };
                $body
            }
            AnyResponse::H3(ptr) => {
                // SAFETY: see above.
                let $r = unsafe { &mut *ptr };
                $body
            }
        }
    };
}

impl AnyResponse {
    pub fn assert_ssl(self) -> *mut TLSResponse {
        match self {
            AnyResponse::SSL(resp) => resp,
            AnyResponse::TCP(_) => bun_core::Output::panic("Expected SSL response, got TCP response"),
            AnyResponse::H3(_) => bun_core::Output::panic("Expected SSL response, got H3 response"),
        }
    }

    pub fn assert_no_ssl(self) -> *mut TCPResponse {
        match self {
            AnyResponse::SSL(_) => bun_core::Output::panic("Expected TCP response, got SSL response"),
            AnyResponse::TCP(resp) => resp,
            AnyResponse::H3(_) => bun_core::Output::panic("Expected TCP response, got H3 response"),
        }
    }

    pub fn mark_needs_more(self) {
        any_dispatch!(self, |r| r.mark_needs_more())
    }

    pub fn mark_wrote_content_length_header(self) {
        any_dispatch!(self, |r| r.mark_wrote_content_length_header())
    }

    pub fn write_mark(self) {
        any_dispatch!(self, |r| r.write_mark())
    }

    pub fn end_send_file(self, write_offset: u64, close_connection: bool) {
        any_dispatch!(self, |r| r.end_send_file(write_offset, close_connection))
    }

    pub fn socket(self) -> *mut c::uws_res {
        match self {
            AnyResponse::H3(_) => bun_core::Output::panic("socket() is not available for HTTP/3 responses"),
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { (&mut *ptr).downcast() }
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                unsafe { (&mut *ptr).downcast() }
            }
        }
    }

    pub fn get_socket_data(self) -> *mut c_void {
        any_dispatch!(self, |r| r.get_socket_data())
    }

    pub fn get_remote_socket_info(self) -> Option<SocketAddress> {
        any_dispatch!(self, |r| r.get_remote_socket_info())
    }

    pub fn flush_headers(self, flush_immediately: bool) {
        any_dispatch!(self, |r| r.flush_headers(flush_immediately))
    }

    pub fn is_corked(self) -> bool {
        any_dispatch!(self, |r| r.is_corked())
    }

    pub fn uncork(self) {
        any_dispatch!(self, |r| r.uncork())
    }

    pub fn get_write_offset(self) -> u64 {
        any_dispatch!(self, |r| r.get_write_offset())
    }

    pub fn get_buffered_amount(self) -> u64 {
        any_dispatch!(self, |r| r.get_buffered_amount())
    }

    pub fn write_continue(self) {
        any_dispatch!(self, |r| r.write_continue())
    }

    pub fn state(self) -> State {
        any_dispatch!(self, |r| r.state())
    }

    // Zig: `pub inline fn init(response: anytype) AnyResponse` switching on @TypeOf.
    // Rust models this as `From` impls below; keep `init` as a thin alias for diff parity.
    #[inline]
    pub fn init<T>(response: T) -> AnyResponse
    where
        AnyResponse: From<T>,
    {
        AnyResponse::from(response)
    }

    pub fn timeout(self, seconds: u8) {
        any_dispatch!(self, |r| r.timeout(seconds))
    }

    pub fn on_data<U>(
        self,
        handler: fn(*mut U, &[u8], bool),
        optional_data: *mut U,
    ) {
        // TODO(port): Zig wraps `handler` in per-variant trampolines that drop the
        // `*Response` arg. Same comptime-handler limitation as Response::on_data —
        // Phase B should expose a trait/macro so the trampoline can call `handler`.
        match self {
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { &mut *ptr }.on_data::<U>(
                    // TODO(port): adapter that drops the `&mut Response` arg
                    |_u, _r, _d, _l| {},
                    optional_data,
                )
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_data::<U>(|_u, _r, _d, _l| {}, optional_data)
            }
            AnyResponse::H3(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_data(
                    // TODO(port): H3Response::on_data signature
                    |_u, _r, _d, _l| {},
                    optional_data,
                )
            }
        }
        let _ = handler;
    }

    pub fn write_status(self, status: &[u8]) {
        any_dispatch!(self, |r| r.write_status(status))
    }

    pub fn write_header(self, key: &[u8], value: &[u8]) {
        any_dispatch!(self, |r| r.write_header(key, value))
    }

    pub fn write(self, data: &[u8]) -> WriteResult {
        any_dispatch!(self, |r| r.write(data))
    }

    pub fn end(self, data: &[u8], close_connection: bool) {
        any_dispatch!(self, |r| r.end(data, close_connection))
    }

    pub fn should_close_connection(self) -> bool {
        any_dispatch!(self, |r| r.should_close_connection())
    }

    pub fn try_end(self, data: &[u8], total_size: usize, close_connection: bool) -> bool {
        any_dispatch!(self, |r| r.try_end(data, total_size, close_connection))
    }

    pub fn pause(self) {
        any_dispatch!(self, |r| r.pause())
    }

    pub fn resume_(self) {
        any_dispatch!(self, |r| r.resume_())
    }

    pub fn write_header_int(self, key: &[u8], value: u64) {
        any_dispatch!(self, |r| r.write_header_int(key, value))
    }

    pub fn end_without_body(self, close_connection: bool) {
        any_dispatch!(self, |r| r.end_without_body(close_connection))
    }

    pub fn force_close(self) {
        match self {
            AnyResponse::SSL(ptr) => unsafe {
                // SAFETY: live FFI socket handle.
                // TODO(port): bun_uws_sys::us_socket_t::close signature / CloseCode::Failure
                (&mut *(&mut *ptr).downcast_socket()).close(crate::us_socket_t::CloseCode::Failure);
            },
            AnyResponse::TCP(ptr) => unsafe {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                (&mut *(&mut *ptr).downcast_socket()).close(crate::us_socket_t::CloseCode::Failure);
            },
            AnyResponse::H3(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { (&mut *ptr).force_close() }
            }
        }
    }

    pub fn get_native_handle(self) -> Fd {
        match self {
            AnyResponse::H3(_) => bun_sys::Fd::invalid(),
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { (&mut *ptr).get_native_handle() }
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                unsafe { (&mut *ptr).get_native_handle() }
            }
        }
    }

    pub fn prepare_for_sendfile(self) {
        any_dispatch!(self, |r| r.prepare_for_sendfile())
    }

    pub fn on_writable<U>(
        self,
        handler: fn(*mut U, u64, AnyResponse) -> bool,
        optional_data: *mut U,
    ) {
        // TODO(port): same comptime-handler limitation. Zig generates per-variant
        // adapters that wrap the typed *Response back into AnyResponse before calling
        // `handler`. Phase B trait/macro should generate these.
        let _ = handler;
        match self {
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { &mut *ptr }.on_writable::<U>(|_u, _o, _r| true, optional_data)
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_writable::<U>(|_u, _o, _r| true, optional_data)
            }
            AnyResponse::H3(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_writable(|_u, _o, _r| true, optional_data)
            }
        }
    }

    pub fn on_timeout<U>(
        self,
        handler: fn(*mut U, AnyResponse),
        optional_data: *mut U,
    ) {
        // TODO(port): see on_writable.
        let _ = handler;
        match self {
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { &mut *ptr }.on_timeout::<U>(|_u, _r| {}, optional_data)
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_timeout::<U>(|_u, _r| {}, optional_data)
            }
            AnyResponse::H3(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_timeout(|_u, _r| {}, optional_data)
            }
        }
    }

    pub fn on_aborted<U>(
        self,
        handler: fn(*mut U, AnyResponse),
        optional_data: *mut U,
    ) {
        // TODO(port): see on_writable.
        let _ = handler;
        match self {
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { &mut *ptr }.on_aborted::<U>(|_u, _r| {}, optional_data)
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_aborted::<U>(|_u, _r| {}, optional_data)
            }
            AnyResponse::H3(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.on_aborted(|_u, _r| {}, optional_data)
            }
        }
    }

    pub fn clear_aborted(self) {
        any_dispatch!(self, |r| r.clear_aborted())
    }

    pub fn clear_timeout(self) {
        any_dispatch!(self, |r| r.clear_timeout())
    }

    pub fn clear_on_writable(self) {
        any_dispatch!(self, |r| r.clear_on_writable())
    }

    pub fn clear_on_data(self) {
        any_dispatch!(self, |r| r.clear_on_data())
    }

    pub fn is_connect_request(self) -> bool {
        any_dispatch!(self, |r| r.is_connect_request())
    }

    pub fn end_stream(self, close_connection: bool) {
        any_dispatch!(self, |r| r.end_stream(close_connection))
    }

    pub fn corked<F: FnOnce()>(self, f: F) {
        any_dispatch!(self, |r| r.corked(f))
    }

    pub fn run_corked_with_type<U>(self, handler: fn(*mut U), optional_data: *mut U) {
        any_dispatch!(self, |r| r.run_corked_with_type(handler, optional_data))
    }

    pub fn upgrade<D>(
        self,
        data: *mut D,
        sec_web_socket_key: &[u8],
        sec_web_socket_protocol: &[u8],
        sec_web_socket_extensions: &[u8],
        ctx: Option<&mut WebSocketUpgradeContext>,
    ) -> *mut Socket {
        match self {
            // server.upgrade() returns false before reaching here for H3
            // (request_context.get(RequestContext) is null — the H3 ctx is a
            // different type and upgrade_context is never set).
            AnyResponse::H3(_) => unreachable!(),
            AnyResponse::SSL(ptr) => {
                // SAFETY: AnyResponse stores a live FFI handle; valid while caller holds it.
                unsafe { &mut *ptr }.upgrade(
                    data,
                    sec_web_socket_key,
                    sec_web_socket_protocol,
                    sec_web_socket_extensions,
                    ctx,
                )
            }
            AnyResponse::TCP(ptr) => {
                // SAFETY: see above.
                unsafe { &mut *ptr }.upgrade(
                    data,
                    sec_web_socket_key,
                    sec_web_socket_protocol,
                    sec_web_socket_extensions,
                    ctx,
                )
            }
        }
    }
}

impl From<*mut TLSResponse> for AnyResponse {
    #[inline]
    fn from(r: *mut TLSResponse) -> Self {
        AnyResponse::SSL(r)
    }
}
impl From<*mut TCPResponse> for AnyResponse {
    #[inline]
    fn from(r: *mut TCPResponse) -> Self {
        AnyResponse::TCP(r)
    }
}
impl From<*mut H3Response> for AnyResponse {
    #[inline]
    fn from(r: *mut H3Response) -> Self {
        AnyResponse::H3(r)
    }
}

pub type H3Response = crate::h3::Response::Response;

bitflags::bitflags! {
    /// Non-exhaustive bitset (`enum(u8) { ..., _ }` in Zig) — values may carry
    /// unnamed bit combinations.
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct State: u8 {
        const HTTP_STATUS_CALLED               = 1;
        const HTTP_WRITE_CALLED                = 2;
        const HTTP_END_CALLED                  = 4;
        const HTTP_RESPONSE_PENDING            = 8;
        const HTTP_CONNECTION_CLOSE            = 16;
        const HTTP_WROTE_CONTENT_LENGTH_HEADER = 32;
    }
}

impl State {
    #[inline]
    pub fn is_response_pending(self) -> bool {
        self.bits() & State::HTTP_RESPONSE_PENDING.bits() != 0
    }

    #[inline]
    pub fn has_written_content_length_header(self) -> bool {
        self.bits() & State::HTTP_WROTE_CONTENT_LENGTH_HEADER.bits() != 0
    }

    #[inline]
    pub fn is_http_end_called(self) -> bool {
        self.bits() & State::HTTP_END_CALLED.bits() != 0
    }

    #[inline]
    pub fn is_http_write_called(self) -> bool {
        self.bits() & State::HTTP_WRITE_CALLED.bits() != 0
    }

    #[inline]
    pub fn is_http_status_called(self) -> bool {
        self.bits() & State::HTTP_STATUS_CALLED.bits() != 0
    }

    #[inline]
    pub fn is_http_connection_close(self) -> bool {
        self.bits() & State::HTTP_CONNECTION_CLOSE.bits() != 0
    }
}

pub enum WriteResult {
    WantMore(usize),
    Backpressure(usize),
}

pub use c::uws_res;

#[allow(non_camel_case_types)]
pub mod c {
    use super::*;

    /// Opaque `uws_res_t` (the untyped C handle).
    #[repr(C)]
    pub struct uws_res {
        _p: [u8; 0],
        _m: PhantomData<(*mut u8, PhantomPinned)>,
    }

    unsafe extern "C" {
        pub fn uws_res_mark_wrote_content_length_header(ssl: i32, res: *mut uws_res);
        pub fn uws_res_write_mark(ssl: i32, res: *mut uws_res);
        pub fn us_socket_mark_needs_more_not_ssl(socket: *mut uws_res);
        pub fn uws_res_state(ssl: c_int, res: *const uws_res) -> State;
        pub fn uws_res_is_connect_request(ssl: i32, res: *mut uws_res) -> bool;
        pub fn uws_res_get_remote_address_info(
            res: *mut uws_res,
            dest: *mut *const u8,
            port: *mut i32,
            is_ipv6: *mut bool,
        ) -> usize;
        pub fn uws_res_uncork(ssl: i32, res: *mut uws_res);
        pub fn uws_res_end(
            ssl: i32,
            res: *mut uws_res,
            data: *const u8,
            length: usize,
            close_connection: bool,
        );
        pub fn uws_res_flush_headers(ssl: i32, res: *mut uws_res, flush_immediately: bool);
        pub fn uws_res_is_corked(ssl: i32, res: *mut uws_res) -> bool;
        pub fn uws_res_get_socket_data(ssl: i32, res: *mut uws_res) -> *mut SocketData;
        pub fn uws_res_pause(ssl: i32, res: *mut uws_res);
        pub fn uws_res_resume(ssl: i32, res: *mut uws_res);
        pub fn uws_res_write_continue(ssl: i32, res: *mut uws_res);
        pub fn uws_res_write_status(ssl: i32, res: *mut uws_res, status: *const u8, length: usize);
        pub fn uws_res_write_header(
            ssl: i32,
            res: *mut uws_res,
            key: *const u8,
            key_length: usize,
            value: *const u8,
            value_length: usize,
        );
        pub fn uws_res_write_header_int(
            ssl: i32,
            res: *mut uws_res,
            key: *const u8,
            key_length: usize,
            value: u64,
        );
        pub fn uws_res_end_without_body(ssl: i32, res: *mut uws_res, close_connection: bool);
        pub fn uws_res_end_sendfile(
            ssl: i32,
            res: *mut uws_res,
            write_offset: u64,
            close_connection: bool,
        );
        pub fn uws_res_timeout(ssl: i32, res: *mut uws_res, timeout: u8);
        pub fn uws_res_reset_timeout(ssl: i32, res: *mut uws_res);
        pub fn uws_res_get_buffered_amount(ssl: i32, res: *mut uws_res) -> u64;
        pub fn uws_res_write(ssl: i32, res: *mut uws_res, data: *const u8, length: *mut usize)
            -> bool;
        pub fn uws_res_get_write_offset(ssl: i32, res: *mut uws_res) -> u64;
        pub fn uws_res_override_write_offset(ssl: i32, res: *mut uws_res, offset: u64);
        pub fn uws_res_has_responded(ssl: i32, res: *mut uws_res) -> bool;
        pub fn uws_res_on_writable(
            ssl: i32,
            res: *mut uws_res,
            handler: Option<unsafe extern "C" fn(*mut uws_res, u64, *mut c_void) -> bool>,
            user_data: *mut c_void,
        );
        pub fn uws_res_clear_on_writable(ssl: i32, res: *mut uws_res);
        pub fn uws_res_on_aborted(
            ssl: i32,
            res: *mut uws_res,
            handler: Option<unsafe extern "C" fn(*mut uws_res, *mut c_void)>,
            optional_data: *mut c_void,
        );
        pub fn uws_res_on_timeout(
            ssl: i32,
            res: *mut uws_res,
            handler: Option<unsafe extern "C" fn(*mut uws_res, *mut c_void)>,
            optional_data: *mut c_void,
        );
        pub fn uws_res_try_end(
            ssl: i32,
            res: *mut uws_res,
            data: *const u8,
            length: usize,
            total: usize,
            close: bool,
        ) -> bool;
        pub fn uws_res_end_stream(ssl: i32, res: *mut uws_res, close_connection: bool);
        pub fn uws_res_prepare_for_sendfile(ssl: i32, res: *mut uws_res);
        pub fn uws_res_get_native_handle(ssl: i32, res: *mut uws_res) -> *mut Socket;
        pub fn uws_res_get_remote_address_as_text(
            ssl: i32,
            res: *mut uws_res,
            dest: *mut *const u8,
        ) -> usize;
        pub fn uws_res_on_data(
            ssl: i32,
            res: *mut uws_res,
            handler: Option<
                unsafe extern "C" fn(*mut uws_res, *const u8, usize, bool, *mut c_void),
            >,
            optional_data: *mut c_void,
        );
        pub fn uws_res_upgrade(
            ssl: i32,
            res: *mut uws_res,
            data: *mut c_void,
            sec_web_socket_key: *const u8,
            sec_web_socket_key_length: usize,
            sec_web_socket_protocol: *const u8,
            sec_web_socket_protocol_length: usize,
            sec_web_socket_extensions: *const u8,
            sec_web_socket_extensions_length: usize,
            ws: *mut WebSocketUpgradeContext,
        ) -> *mut Socket;
        pub fn uws_res_cork(
            ssl: i32,
            res: *mut uws_res,
            ctx: *mut c_void,
            corker: unsafe extern "C" fn(*mut c_void),
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/Response.zig (782 lines)
//   confidence: medium
//   todos:      16
//   notes:      async callback registrars (on_writable/on_aborted/on_timeout/on_data) need a trait/macro to bake the handler into the extern "C" trampoline (Zig used `comptime handler`); H3Response method surface assumed to mirror Response<SSL>.
// ──────────────────────────────────────────────────────────────────────────
