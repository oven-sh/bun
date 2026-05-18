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

use crate::thunk;
use crate::thunk::OpaqueHandle;
use crate::us_socket_t;
use bun_core::Fd;

// ─── Forward-declared opaques (cycle-break: were `bun_uws::*`, tier > 0) ───
/// Remote socket address as returned by uWS. `ip` borrows uWS-owned memory
/// valid for the lifetime of the response/connection that produced it.
///
/// Canonical definition moved down from `bun_uws`
/// (Zig: `uws.SocketAddress = struct { ip: []const u8, port: i32, is_ipv6: bool }`).
/// Higher tiers (`bun_uws`, `bun_runtime`) re-export this as
/// `pub use bun_uws_sys::SocketAddress;`.
pub struct SocketAddress<'a> {
    pub ip: &'a [u8],
    pub port: i32,
    pub is_ipv6: bool,
}

bun_opaque::opaque_ffi! {
    /// Opaque uWS WebSocket socket handle (forward-decl; concrete type lives in `bun_uws`).
    pub struct Socket;
    /// Opaque per-socket userdata blob (forward-decl; concrete type lives in `bun_uws`).
    pub struct SocketData;
    /// Opaque uWS WebSocket upgrade context (forward-decl; concrete type lives in `bun_uws`).
    pub struct WebSocketUpgradeContext;
}

/// Opaque handle for `uws::Response<SSL>`.
///
/// In Zig this is `pub fn NewResponse(ssl_flag: i32) type { return opaque { ... } }`.
/// Rust models the comptime `ssl_flag` as a `const SSL: bool` parameter on an opaque
/// extern type (Nomicon pattern).
#[repr(C)]
pub struct Response<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
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
        std::ptr::from_mut::<Self>(self).cast::<c::uws_res>()
    }

    /// `&mut uws_res` view of self for `safe fn` shims. Both types are
    /// `#[repr(C)]` opaque ZSTs with `UnsafeCell<[u8; 0]>`, so the cast is a
    /// no-op and the reference is ABI-identical to the non-null pointer the C
    /// shim expects.
    #[inline]
    fn as_raw(&mut self) -> &mut c::uws_res {
        // SAFETY: `Response<SSL>` and `c::uws_res` are layout-identical opaque
        // ZSTs over the same C++ object; the borrow reborrows `&mut self`.
        unsafe { &mut *std::ptr::from_mut::<Self>(self).cast::<c::uws_res>() }
    }

    #[inline]
    pub fn downcast_socket(&mut self) -> *mut us_socket_t {
        std::ptr::from_mut::<Self>(self).cast::<us_socket_t>()
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
        c::uws_res_get_socket_data(Self::ssl_flag(), self.as_raw()).cast()
    }

    pub fn is_connect_request(&mut self) -> bool {
        c::uws_res_is_connect_request(Self::ssl_flag(), self.as_raw())
    }

    pub fn flush_headers(&mut self, flush_immediately: bool) {
        c::uws_res_flush_headers(Self::ssl_flag(), self.as_raw(), flush_immediately)
    }

    pub fn is_corked(&mut self) -> bool {
        c::uws_res_is_corked(Self::ssl_flag(), self.as_raw())
    }

    pub fn state(&self) -> State {
        // SAFETY: `Response<SSL>` and `c::uws_res` are layout-identical opaque
        // ZSTs (both `UnsafeCell<[u8; 0]>`); the reborrow is a no-op cast.
        c::uws_res_state(Self::ssl_flag() as c_int, unsafe {
            &*std::ptr::from_ref::<Self>(self).cast::<c::uws_res>()
        })
    }

    pub fn should_close_connection(&self) -> bool {
        self.state().is_http_connection_close()
    }

    pub fn prepare_for_sendfile(&mut self) {
        c::uws_res_prepare_for_sendfile(Self::ssl_flag(), self.as_raw())
    }

    pub fn uncork(&mut self) {
        c::uws_res_uncork(Self::ssl_flag(), self.as_raw())
    }

    pub fn pause(&mut self) {
        c::uws_res_pause(Self::ssl_flag(), self.as_raw())
    }

    pub fn resume_(&mut self) {
        c::uws_res_resume(Self::ssl_flag(), self.as_raw())
    }

    pub fn write_continue(&mut self) {
        c::uws_res_write_continue(Self::ssl_flag(), self.as_raw())
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
        c::uws_res_end_without_body(Self::ssl_flag(), self.as_raw(), close_connection)
    }

    pub fn end_send_file(&mut self, write_offset: u64, close_connection: bool) {
        c::uws_res_end_sendfile(
            Self::ssl_flag(),
            self.as_raw(),
            write_offset,
            close_connection,
        )
    }

    pub fn timeout(&mut self, seconds: u8) {
        c::uws_res_timeout(Self::ssl_flag(), self.as_raw(), seconds)
    }

    pub fn reset_timeout(&mut self) {
        c::uws_res_reset_timeout(Self::ssl_flag(), self.as_raw())
    }

    pub fn get_buffered_amount(&mut self) -> u64 {
        c::uws_res_get_buffered_amount(Self::ssl_flag(), self.as_raw())
    }

    pub fn write(&mut self, data: &[u8]) -> WriteResult {
        let mut len: usize = data.len();
        // SAFETY: self is a live opaque uws_res handle owned by uWS; FFI call has no extra preconditions.
        match unsafe {
            c::uws_res_write(
                Self::ssl_flag(),
                self.downcast(),
                data.as_ptr(),
                &raw mut len,
            )
        } {
            true => WriteResult::WantMore(len),
            false => WriteResult::Backpressure(len),
        }
    }

    pub fn get_write_offset(&mut self) -> u64 {
        c::uws_res_get_write_offset(Self::ssl_flag(), self.as_raw())
    }

    pub fn override_write_offset<T>(&mut self, offset: T)
    where
        u64: TryFrom<T>,
        <u64 as TryFrom<T>>::Error: core::fmt::Debug,
    {
        c::uws_res_override_write_offset(
            Self::ssl_flag(),
            self.as_raw(),
            u64::try_from(offset).expect("int cast"),
        )
    }

    pub fn has_responded(&mut self) -> bool {
        c::uws_res_has_responded(Self::ssl_flag(), self.as_raw())
    }

    pub fn mark_wrote_content_length_header(&mut self) {
        c::uws_res_mark_wrote_content_length_header(Self::ssl_flag(), self.as_raw())
    }

    pub fn write_mark(&mut self) {
        c::uws_res_write_mark(Self::ssl_flag(), self.as_raw())
    }

    pub fn get_native_handle(&mut self) -> Fd {
        #[cfg(windows)]
        {
            // on windows uSockets exposes SOCKET (uintptr-sized) as a pointer
            // value; tag kind=system via `from_system` (masks bit 63) so
            // `INVALID_SOCKET` (~0) doesn't decode as kind=uv.
            return Fd::from_system(
                c::uws_res_get_native_handle(Self::ssl_flag(), self.as_raw())
                    as *mut core::ffi::c_void,
            );
        }
        #[cfg(not(windows))]
        {
            Fd::from_native(
                c_int::try_from(
                    c::uws_res_get_native_handle(Self::ssl_flag(), self.as_raw()) as usize,
                )
                .unwrap(),
            )
        }
    }

    pub fn get_remote_address_as_text(&mut self) -> Option<&[u8]> {
        let mut buf: *const u8 = core::ptr::null();
        let size = c::uws_res_get_remote_address_as_text(Self::ssl_flag(), self.as_raw(), &mut buf);
        if size > 0 {
            // SAFETY: uws populated `buf` with `size` bytes valid while the response lives.
            Some(unsafe { bun_core::ffi::slice(buf, size) })
        } else {
            None
        }
    }

    pub fn get_remote_socket_info(&mut self) -> Option<SocketAddress<'_>> {
        let mut ip_ptr: *const u8 = core::ptr::null();
        let mut port: i32 = 0;
        let mut is_ipv6: bool = false;
        // This function will fill in the slots and return len.
        // if len is zero it will not fill in the slots so it is ub to
        // return the struct in that case.
        let ip_len =
            c::uws_res_get_remote_address_info(self.as_raw(), &mut ip_ptr, &mut port, &mut is_ipv6);
        if ip_len > 0 {
            // SocketAddress is defined locally (moved down from bun_uws); `ip`
            // borrows uWS-owned memory valid while the response lives.
            Some(SocketAddress {
                // SAFETY: uws populated ip_ptr/ip_len with bytes valid while the response lives.
                ip: unsafe { bun_core::ffi::slice(ip_ptr, ip_len) },
                port,
                is_ipv6,
            })
        } else {
            None
        }
    }

    /// Register an on-writable callback.
    ///
    /// Zig takes `comptime handler` and bakes it into the trampoline at
    /// monomorphization time. Rust models this by requiring `H` to be a
    /// zero-sized type (function item or capture-less closure): the trampoline
    /// is monomorphized over `H` and conjures the ZST inside, so the user
    /// handler is baked in with no runtime storage.
    pub fn on_writable<U, H>(&mut self, _handler: H, user_data: *mut U)
    where
        H: Fn(*mut U, u64, &mut Response<SSL>) -> bool + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn handle<U, H, const SSL: bool>(
            this: *mut c::uws_res,
            amount: u64,
            data: *mut c_void,
        ) -> bool
        where
            H: Fn(*mut U, u64, &mut Response<SSL>) -> bool + Copy + 'static,
        {
            // null user-data is always a no-op.
            if data.is_null() {
                return true;
            }
            // SAFETY: uWS callback contract — `this` is live for the call, `H`
            // is a ZST handler (asserted in `thunk::zst`).
            unsafe {
                thunk::zst::<H>()(
                    data.cast::<U>(),
                    amount,
                    thunk::handle_mut(Response::<SSL>::cast_res(this)),
                )
            }
        }
        c::uws_res_on_writable(
            Self::ssl_flag(),
            self.as_raw(),
            Some(handle::<U, H, SSL>),
            user_data.cast(),
        );
    }

    pub fn clear_on_writable(&mut self) {
        c::uws_res_clear_on_writable(Self::ssl_flag(), self.as_raw())
    }

    #[inline]
    pub fn mark_needs_more(&mut self) {
        if !SSL {
            c::us_socket_mark_needs_more_not_ssl(self.as_raw())
        }
    }

    pub fn on_aborted<U, H>(&mut self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, &mut Response<SSL>) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn handle<U, H, const SSL: bool>(this: *mut c::uws_res, user_data: *mut c_void)
        where
            H: Fn(*mut U, &mut Response<SSL>) + Copy + 'static,
        {
            // null user-data is always a no-op.
            if user_data.is_null() {
                return;
            }
            // SAFETY: uWS callback contract — `this` is live for the call, `H`
            // is a ZST handler (asserted in `thunk::zst`).
            unsafe {
                thunk::zst::<H>()(
                    user_data.cast::<U>(),
                    thunk::handle_mut(Response::<SSL>::cast_res(this)),
                )
            }
        }
        c::uws_res_on_aborted(
            Self::ssl_flag(),
            self.as_raw(),
            Some(handle::<U, H, SSL>),
            optional_data.cast(),
        );
    }

    pub fn clear_aborted(&mut self) {
        c::uws_res_on_aborted(Self::ssl_flag(), self.as_raw(), None, core::ptr::null_mut())
    }

    pub fn on_timeout<U, H>(&mut self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, &mut Response<SSL>) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn handle<U, H, const SSL: bool>(this: *mut c::uws_res, user_data: *mut c_void)
        where
            H: Fn(*mut U, &mut Response<SSL>) + Copy + 'static,
        {
            // null user-data is always a no-op.
            if user_data.is_null() {
                return;
            }
            // SAFETY: uWS callback contract — `this` is live for the call, `H`
            // is a ZST handler (asserted in `thunk::zst`).
            unsafe {
                thunk::zst::<H>()(
                    user_data.cast::<U>(),
                    thunk::handle_mut(Response::<SSL>::cast_res(this)),
                )
            }
        }
        c::uws_res_on_timeout(
            Self::ssl_flag(),
            self.as_raw(),
            Some(handle::<U, H, SSL>),
            optional_data.cast(),
        );
    }

    pub fn clear_timeout(&mut self) {
        c::uws_res_on_timeout(Self::ssl_flag(), self.as_raw(), None, core::ptr::null_mut())
    }

    pub fn clear_on_data(&mut self) {
        c::uws_res_on_data(Self::ssl_flag(), self.as_raw(), None, core::ptr::null_mut())
    }

    pub fn on_data<U, H>(&mut self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, &mut Response<SSL>, &[u8], bool) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn handle<U, H, const SSL: bool>(
            this: *mut c::uws_res,
            chunk_ptr: *const u8,
            len: usize,
            last: bool,
            user_data: *mut c_void,
        ) where
            H: Fn(*mut U, &mut Response<SSL>, &[u8], bool) + Copy + 'static,
        {
            // null user-data is always a no-op.
            if user_data.is_null() {
                return;
            }
            // SAFETY: uWS callback contract — `this` live, `chunk_ptr[..len]`
            // valid for the call, `H` is a ZST handler (asserted in `thunk::zst`).
            unsafe {
                thunk::zst::<H>()(
                    user_data.cast::<U>(),
                    thunk::handle_mut(Response::<SSL>::cast_res(this)),
                    thunk::c_slice(chunk_ptr, len),
                    last,
                )
            }
        }
        c::uws_res_on_data(
            Self::ssl_flag(),
            self.as_raw(),
            Some(handle::<U, H, SSL>),
            optional_data.cast(),
        );
    }

    pub fn end_stream(&mut self, close_connection: bool) {
        c::uws_res_end_stream(Self::ssl_flag(), self.as_raw(), close_connection)
    }

    /// Run `handler` while the response is corked. Zig signature took
    /// `comptime handler: anytype, args_tuple: ArgsTuple(@TypeOf(handler))`;
    /// in Rust callers pass a closure capturing what would have been the args tuple.
    // PORT NOTE: reshaped — `(handler, args_tuple)` collapsed to `FnOnce()`.
    pub fn corked<F: FnOnce()>(&mut self, f: F) {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr op explicitly.
        extern "C" fn handle<F: FnOnce()>(user_data: *mut c_void) {
            // SAFETY: user_data points at a stack `ManuallyDrop<F>` valid for this synchronous call.
            let f = unsafe { core::ptr::read(user_data.cast::<F>()) };
            // PERF(port): was @call(.always_inline)
            f();
        }
        let mut f = core::mem::ManuallyDrop::new(f);
        // cork is synchronous so the stack-allocated closure outlives the FFI call.
        c::uws_res_cork(
            Self::ssl_flag(),
            self.as_raw(),
            (&raw mut *f).cast::<c_void>(),
            handle::<F>,
        );
    }

    pub fn run_corked_with_type<U>(&mut self, handler: fn(*mut U), optional_data: *mut U) {
        // cork is synchronous, so we can stack-allocate the (handler, data) pair
        // and recover it inside the trampoline.
        type Ctx<U> = (fn(*mut U), *mut U);
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr op explicitly.
        extern "C" fn handle<U>(user_data: *mut c_void) {
            // SAFETY: user_data points at a stack Ctx<U> valid for this synchronous call.
            let ctx = unsafe { &*user_data.cast::<Ctx<U>>() };
            // PERF(port): was @call(.always_inline)
            (ctx.0)(ctx.1);
        }
        let mut ctx: Ctx<U> = (handler, optional_data);
        // cork is synchronous so the stack-allocated ctx outlives the FFI call.
        c::uws_res_cork(
            Self::ssl_flag(),
            self.as_raw(),
            (&raw mut ctx).cast::<c_void>(),
            handle::<U>,
        );
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
                ctx.map_or(core::ptr::null_mut(), |c| std::ptr::from_mut(c)),
            )
        }
    }
}

pub type TCPResponse = Response<false>;
pub type TLSResponse = Response<true>;

// SAFETY: `Response<SSL>` is a `#[repr(C)]` ZST (`UnsafeCell<[u8; 0]>`) with
// align 1; C++ owns the real bytes.
unsafe impl<const SSL: bool> OpaqueHandle for Response<SSL> {}
// SAFETY: `h3::Response` is a `#[repr(C)]` ZST (`UnsafeCell<[u8; 0]>`) with
// align 1; C++ owns the real bytes.
unsafe impl OpaqueHandle for H3Response {}

#[derive(Clone, Copy)]
pub enum AnyResponse {
    SSL(*mut TLSResponse),
    TCP(*mut TCPResponse),
    H3(*mut H3Response),
}

// Helper: dispatch to the underlying response, calling the same-named method on each
// variant. The Zig `switch (this) { inline else => |resp| resp.method(args...) }`
// monomorphizes per variant; we write the three arms out by hand.
//
// The per-variant `*mut → &mut` deref is internalized via `OpaqueHandle`
// (S019): each variant payload is a ZST opaque, so the deref is sound by
// construction and needs no `unsafe` at the dispatch site.
macro_rules! any_dispatch {
    ($self:expr, |$r:ident| $body:expr) => {
        match $self {
            AnyResponse::SSL(ptr) => {
                let $r = TLSResponse::as_handle(ptr);
                $body
            }
            AnyResponse::TCP(ptr) => {
                let $r = TCPResponse::as_handle(ptr);
                $body
            }
            AnyResponse::H3(ptr) => {
                let $r = H3Response::as_handle(ptr);
                $body
            }
        }
    };
}

/// Stamp the per-variant ZST adapter triplet and register it via the matching
/// `Response<SSL>` / `H3Response` `$method`. Mirrors Zig's hand-rolled
/// `wrapper` structs in `Response.zig` (`onData`/`onWritable`/`onTimeout`/
/// `onAborted`): each arm is a generic fn *item* monomorphized over `<U, H>`,
/// so it is itself a ZST satisfying both the `Response<SSL>` bound
/// (`Fn(*mut U, …)`) and the `H3Response` bound (`Fn(&mut U, …)`). The H3 arm
/// bridges its `&mut U` to the body's uniform `*mut U` via `ptr::from_mut`.
///
/// Syntax:
///   any_response_register_cb! {
///       self, $method, $opt_data;
///       <U, H: [bounds…]>
///       |u $(, pre: PreTy)* ; r, any $(, post: PostTy)*| -> Ret { body }
///   }
/// - `u` is bound as `*mut U` in the body (H3's `&mut U` is rebound).
/// - `r` is the typed `&mut {TLS,TCP,H3}Response` param; `any` is the
///   `AnyResponse` re-wrap of `r`. Underscore-prefix either if unused.
macro_rules! any_response_register_cb {
    (
        $self:expr, $method:ident, $opt_data:expr;
        <$U:ident, $H:ident : [$($bound:tt)*]>
        |$u:ident $(, $pre:ident : $pre_ty:ty)* ; $r:ident, $any:ident $(, $post:ident : $post_ty:ty)*| -> $ret:ty
        { $($body:tt)* }
    ) => {{
        const { assert!(core::mem::size_of::<$H>() == 0, "handler must be a fn item or capture-less closure") };
        fn ssl<$U, $H: $($bound)*>($u: *mut $U $(, $pre: $pre_ty)*, $r: &mut TLSResponse $(, $post: $post_ty)*) -> $ret {
            let $any = AnyResponse::SSL(std::ptr::from_mut($r));
            $($body)*
        }
        fn tcp<$U, $H: $($bound)*>($u: *mut $U $(, $pre: $pre_ty)*, $r: &mut TCPResponse $(, $post: $post_ty)*) -> $ret {
            let $any = AnyResponse::TCP(std::ptr::from_mut($r));
            $($body)*
        }
        fn h3<$U, $H: $($bound)*>($u: &mut $U $(, $pre: $pre_ty)*, $r: &mut H3Response $(, $post: $post_ty)*) -> $ret {
            let $u = std::ptr::from_mut::<$U>($u);
            let $any = AnyResponse::H3(std::ptr::from_mut($r));
            $($body)*
        }
        match $self {
            AnyResponse::SSL(ptr) => TLSResponse::as_handle(ptr).$method(ssl::<$U, $H>, $opt_data),
            AnyResponse::TCP(ptr) => TCPResponse::as_handle(ptr).$method(tcp::<$U, $H>, $opt_data),
            AnyResponse::H3(ptr) => H3Response::as_handle(ptr).$method(h3::<$U, $H>, $opt_data),
        }
    }};
}

impl AnyResponse {
    pub fn assert_ssl(self) -> *mut TLSResponse {
        match self {
            AnyResponse::SSL(resp) => resp,
            AnyResponse::TCP(_) => panic!("Expected SSL response, got TCP response"),
            AnyResponse::H3(_) => panic!("Expected SSL response, got H3 response"),
        }
    }

    pub fn assert_no_ssl(self) -> *mut TCPResponse {
        match self {
            AnyResponse::SSL(_) => panic!("Expected TCP response, got SSL response"),
            AnyResponse::TCP(resp) => resp,
            AnyResponse::H3(_) => panic!("Expected TCP response, got H3 response"),
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
            AnyResponse::H3(_) => panic!("socket() is not available for HTTP/3 responses"),
            AnyResponse::SSL(ptr) => TLSResponse::as_handle(ptr).downcast(),
            AnyResponse::TCP(ptr) => TCPResponse::as_handle(ptr).downcast(),
        }
    }

    pub fn get_socket_data(self) -> *mut c_void {
        any_dispatch!(self, |r| r.get_socket_data())
    }

    pub fn get_remote_socket_info(self) -> Option<SocketAddress<'static>> {
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

    pub fn on_data<U: 'static, H>(self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, &[u8], bool) + Copy + 'static,
    {
        any_response_register_cb! {
            self, on_data, optional_data;
            <U, H: [Fn(*mut U, &[u8], bool) + Copy + 'static]>
            |u; _r, _any, d: &[u8], l: bool| -> () { thunk::zst::<H>()(u, d, l) }
        }
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
            AnyResponse::SSL(ptr) => {
                // TODO(port): crate::us_socket_t::close signature / CloseCode::Failure
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                us_socket_t::opaque_mut(TLSResponse::as_handle(ptr).downcast_socket())
                    .close(crate::us_socket::CloseCode::failure);
            }
            AnyResponse::TCP(ptr) => {
                us_socket_t::opaque_mut(TCPResponse::as_handle(ptr).downcast_socket())
                    .close(crate::us_socket::CloseCode::failure);
            }
            AnyResponse::H3(ptr) => H3Response::as_handle(ptr).force_close(),
        }
    }

    pub fn get_native_handle(self) -> Fd {
        match self {
            AnyResponse::H3(_) => bun_core::Fd::INVALID,
            AnyResponse::SSL(ptr) => TLSResponse::as_handle(ptr).get_native_handle(),
            AnyResponse::TCP(ptr) => TCPResponse::as_handle(ptr).get_native_handle(),
        }
    }

    pub fn prepare_for_sendfile(self) {
        any_dispatch!(self, |r| r.prepare_for_sendfile())
    }

    pub fn on_writable<U: 'static, H>(self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, u64, AnyResponse) -> bool + Copy + 'static,
    {
        any_response_register_cb! {
            self, on_writable, optional_data;
            <U, H: [Fn(*mut U, u64, AnyResponse) -> bool + Copy + 'static]>
            |u, off: u64; r, any| -> bool { thunk::zst::<H>()(u, off, any) }
        }
    }

    pub fn on_timeout<U: 'static, H>(self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, AnyResponse) + Copy + 'static,
    {
        any_response_register_cb! {
            self, on_timeout, optional_data;
            <U, H: [Fn(*mut U, AnyResponse) + Copy + 'static]>
            |u; r, any| -> () { thunk::zst::<H>()(u, any) }
        }
    }

    pub fn on_aborted<U: 'static, H>(self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, AnyResponse) + Copy + 'static,
    {
        any_response_register_cb! {
            self, on_aborted, optional_data;
            <U, H: [Fn(*mut U, AnyResponse) + Copy + 'static]>
            |u; r, any| -> () { thunk::zst::<H>()(u, any) }
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

    pub fn has_responded(self) -> bool {
        any_dispatch!(self, |r| r.has_responded())
    }

    pub fn reset_timeout(self) {
        any_dispatch!(self, |r| r.reset_timeout())
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
            AnyResponse::SSL(ptr) => TLSResponse::as_handle(ptr).upgrade(
                data,
                sec_web_socket_key,
                sec_web_socket_protocol,
                sec_web_socket_extensions,
                ctx,
            ),
            AnyResponse::TCP(ptr) => TCPResponse::as_handle(ptr).upgrade(
                data,
                sec_web_socket_key,
                sec_web_socket_protocol,
                sec_web_socket_extensions,
                ctx,
            ),
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

pub type H3Response = crate::h3::Response;

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

    bun_opaque::opaque_ffi! {
        /// Opaque `uws_res_t` (the untyped C handle).
        pub struct uws_res;
    }

    // `uws_res` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>`, so `&uws_res` /
    // `&mut uws_res` are ABI-identical to a non-null pointer. Value-typed
    // shims are `safe fn`; (ptr,len), nullable raw, *mut c_void ctx stay
    // unsafe.
    unsafe extern "C" {
        pub safe fn uws_res_mark_wrote_content_length_header(ssl: i32, res: &mut uws_res);
        pub safe fn uws_res_write_mark(ssl: i32, res: &mut uws_res);
        pub safe fn us_socket_mark_needs_more_not_ssl(socket: &mut uws_res);
        pub safe fn uws_res_state(ssl: c_int, res: &uws_res) -> State;
        pub safe fn uws_res_is_connect_request(ssl: i32, res: &mut uws_res) -> bool;
        // Out-params are `&mut` (non-null, valid for write); the C shim only
        // stores into them and returns a length — no read-through precondition.
        pub safe fn uws_res_get_remote_address_info(
            res: &mut uws_res,
            dest: &mut *const u8,
            port: &mut i32,
            is_ipv6: &mut bool,
        ) -> usize;
        pub safe fn uws_res_uncork(ssl: i32, res: &mut uws_res);
        pub fn uws_res_end(
            ssl: i32,
            res: *mut uws_res,
            data: *const u8,
            length: usize,
            close_connection: bool,
        );
        pub safe fn uws_res_flush_headers(ssl: i32, res: &mut uws_res, flush_immediately: bool);
        pub safe fn uws_res_is_corked(ssl: i32, res: &mut uws_res) -> bool;
        pub safe fn uws_res_get_socket_data(ssl: i32, res: &mut uws_res) -> *mut SocketData;
        pub safe fn uws_res_pause(ssl: i32, res: &mut uws_res);
        pub safe fn uws_res_resume(ssl: i32, res: &mut uws_res);
        pub safe fn uws_res_write_continue(ssl: i32, res: &mut uws_res);
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
        pub safe fn uws_res_end_without_body(ssl: i32, res: &mut uws_res, close_connection: bool);
        pub safe fn uws_res_end_sendfile(
            ssl: i32,
            res: &mut uws_res,
            write_offset: u64,
            close_connection: bool,
        );
        pub safe fn uws_res_timeout(ssl: i32, res: &mut uws_res, timeout: u8);
        pub safe fn uws_res_reset_timeout(ssl: i32, res: &mut uws_res);
        pub safe fn uws_res_get_buffered_amount(ssl: i32, res: &mut uws_res) -> u64;
        pub fn uws_res_write(
            ssl: i32,
            res: *mut uws_res,
            data: *const u8,
            length: *mut usize,
        ) -> bool;
        pub safe fn uws_res_get_write_offset(ssl: i32, res: &mut uws_res) -> u64;
        pub safe fn uws_res_override_write_offset(ssl: i32, res: &mut uws_res, offset: u64);
        pub safe fn uws_res_has_responded(ssl: i32, res: &mut uws_res) -> bool;
        // safe: `&mut uws_res` is ABI-identical to a non-null `*mut uws_res`;
        // `handler`/`user_data` are stored opaquely (never dereferenced by the
        // C++ shim itself) — no preconditions on this call.
        pub safe fn uws_res_on_writable(
            ssl: i32,
            res: &mut uws_res,
            handler: Option<unsafe extern "C" fn(*mut uws_res, u64, *mut c_void) -> bool>,
            user_data: *mut c_void,
        );
        pub safe fn uws_res_clear_on_writable(ssl: i32, res: &mut uws_res);
        pub safe fn uws_res_on_aborted(
            ssl: i32,
            res: &mut uws_res,
            handler: Option<unsafe extern "C" fn(*mut uws_res, *mut c_void)>,
            optional_data: *mut c_void,
        );
        pub safe fn uws_res_on_timeout(
            ssl: i32,
            res: &mut uws_res,
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
        pub safe fn uws_res_end_stream(ssl: i32, res: &mut uws_res, close_connection: bool);
        pub safe fn uws_res_prepare_for_sendfile(ssl: i32, res: &mut uws_res);
        pub safe fn uws_res_get_native_handle(ssl: i32, res: &mut uws_res) -> *mut Socket;
        pub safe fn uws_res_get_remote_address_as_text(
            ssl: i32,
            res: &mut uws_res,
            dest: &mut *const u8,
        ) -> usize;
        pub safe fn uws_res_on_data(
            ssl: i32,
            res: &mut uws_res,
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
        // safe: cork is synchronous — `ctx` is passed straight back to
        // `corker` without being dereferenced by the C++ shim itself, so the
        // call has no preconditions beyond the live opaque handle.
        pub safe fn uws_res_cork(
            ssl: i32,
            res: &mut uws_res,
            ctx: *mut c_void,
            corker: unsafe extern "C" fn(*mut c_void),
        );
    }
}

// ported from: src/uws_sys/Response.zig
