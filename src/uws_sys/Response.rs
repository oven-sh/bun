//! Handles to the response of a request. The methods for HTTP/1 are in `http1`.

use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::http1::{OnData, OnWritable};
use crate::thunk;
use crate::thunk::OpaqueHandle;
use crate::{WebSocketUpgradeContext, us_socket_t};
use bun_core::{BoundedArray, Fd};
use bun_ptr::{AnyRefCounted, RefPtr};
use bun_websocket::deflate::Params;

// ─── Forward-declared opaques (cycle-break: were `bun_uws::*`, tier > 0) ───
/// Remote socket address as returned by uWS. The IP text is copied into
/// inline storage at construction.
///
/// Canonical definition moved down from `bun_uws`.
/// Higher tiers (`bun_uws`, `bun_runtime`) re-export this as
/// `pub use bun_uws_sys::SocketAddress;`.
pub struct SocketAddress {
    ip: BoundedArray<u8, 64>,
    pub port: i32,
    pub is_ipv6: bool,
}

impl SocketAddress {
    pub(crate) fn new(ip: &[u8], port: i32, is_ipv6: bool) -> SocketAddress {
        let ip = &ip[..ip.len().min(64)];
        SocketAddress {
            ip: BoundedArray::from_slice(ip).expect("clamped to capacity"),
            port,
            is_ipv6,
        }
    }

    pub fn ip(&self) -> &[u8] {
        self.ip.as_slice()
    }

    pub fn is_loopback(&self) -> bool {
        let ip = self.ip();
        // IPv4 loopback addresses
        if ip.starts_with(b"127.") {
            return true;
        }
        // IPv6 loopback addresses
        if ip.starts_with(b"::ffff:127.") || ip == b"::1" || ip == b"0:0:0:0:0:0:0:1" {
            return true;
        }
        false
    }
}

bun_opaque::opaque_ffi! {
    /// An HTTP/1 connection, and the response that has it.
    pub struct uws_res;
}

/// A [`uws_res`] whose handlers know whether it has TLS.
#[repr(C)]
pub struct Response<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl<const SSL: bool> core::ops::Deref for Response<SSL> {
    type Target = uws_res;

    fn deref(&self) -> &uws_res {
        uws_res::opaque_ref(self._p.get().cast())
    }
}

impl<const SSL: bool> Response<SSL> {
    /// The `AnyResponse` variant for this `SSL` flag.
    #[inline]
    pub(crate) fn res_to_any(res: *mut uws_res) -> AnyResponse {
        if SSL {
            AnyResponse::SSL(res.cast())
        } else {
            AnyResponse::TCP(res.cast())
        }
    }

    /// Register an on-writable callback.
    ///
    /// `H` must be a
    /// zero-sized type (function item or capture-less closure): the trampoline
    /// is monomorphized over `H` and conjures the ZST inside, so the user
    /// handler is baked in with no runtime storage.
    pub(crate) fn on_writable<U, H>(&mut self, _handler: H, user_data: *mut U)
    where
        H: Fn(*mut U, u64, &mut Response<SSL>) -> bool + Copy + 'static,
    {
        let handler: OnWritable = |res, offset, data| {
            let res = Self::as_handle(res.as_mut_ptr().cast());
            data.is_null() || thunk::zst::<H>()(data.cast(), offset, res)
        };
        self.set_on_writable(handler, user_data.cast());
    }

    fn on_event<U, H>(res: &uws_res, user_data: *mut c_void)
    where
        H: Fn(*mut U, &mut Response<SSL>) + Copy + 'static,
    {
        if !user_data.is_null() {
            thunk::zst::<H>()(user_data.cast(), Self::as_handle(res.as_mut_ptr().cast()));
        }
    }

    pub(crate) fn on_aborted<U, H>(&mut self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, &mut Response<SSL>) + Copy + 'static,
    {
        self.set_on_aborted(Self::on_event::<U, H>, optional_data.cast());
    }

    pub fn on_timeout<U, H>(&mut self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, &mut Response<SSL>) + Copy + 'static,
    {
        self.set_on_timeout(Self::on_event::<U, H>, optional_data.cast());
    }

    pub fn on_data<U, H>(&mut self, _handler: H, optional_data: *mut U)
    where
        H: Fn(*mut U, &mut Response<SSL>, &[u8], bool) + Copy + 'static,
    {
        let handler: OnData = |res, chunk, is_last, user_data| {
            if !user_data.is_null() {
                let res = Self::as_handle(res.as_mut_ptr().cast());
                thunk::zst::<H>()(user_data.cast(), res, chunk, is_last);
            }
        };
        self.set_on_data(Some(handler), optional_data.cast());
    }
}

impl uws_res {
    pub fn get_remote_socket_info(&self) -> Option<SocketAddress> {
        // Another socket may have its descriptor.
        if self.is_closed() {
            return None;
        }
        let mut ip_ptr: *const u8 = core::ptr::null();
        let mut port: i32 = 0;
        let mut is_ipv6: bool = false;
        let ip_len = uws_res_get_remote_address_info(self, &mut ip_ptr, &mut port, &mut is_ipv6);
        if ip_len > 0 {
            Some(SocketAddress::new(
                // SAFETY: uws populated ip_ptr/ip_len with bytes valid until the next
                // address lookup on this thread; copied before returning.
                unsafe { bun_core::ffi::slice(ip_ptr, ip_len) },
                port,
                is_ipv6,
            ))
        } else {
            None
        }
    }
}

pub type TCPResponse = Response<false>;
pub type TLSResponse = Response<true>;

// SAFETY: `Response<SSL>` is a `#[repr(C)]` ZST (`UnsafeCell<[u8; 0]>`) with
// align 1; uSockets owns the real bytes.
unsafe impl<const SSL: bool> OpaqueHandle for Response<SSL> {}
// SAFETY: `h3::Response` is a `#[repr(C)]` ZST (`UnsafeCell<[u8; 0]>`) with
// align 1; C++ owns the real bytes.
unsafe impl OpaqueHandle for H3Response {}
// SAFETY: a ZST as above. It stands for the pointer of an `Rc`, and nothing is read through it as `Self`.
unsafe impl OpaqueHandle for H2Response {}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AnyResponse {
    SSL(*mut TLSResponse),
    TCP(*mut TCPResponse),
    H3(*mut H3Response),
    H2(*mut H2Response),
}

// Helper: dispatch to the underlying response, calling the same-named method on each
// variant. The three arms are written out by hand.
//
// The per-variant `*mut → &mut` deref is internalized via `OpaqueHandle`
// (S019): each variant payload is a ZST opaque, so the deref is sound by
// construction and needs no `unsafe` at the dispatch site.
macro_rules! any_dispatch {
    ($self:expr, |$r:ident| $body:expr) => {
        match $self {
            AnyResponse::SSL(_) | AnyResponse::TCP(_) => {
                let $r = uws_res::opaque_ref($self.as_ptr().cast());
                $body
            }
            AnyResponse::H3(ptr) => {
                let $r = H3Response::as_handle(ptr);
                $body
            }
            AnyResponse::H2(ptr) => {
                let $r = H2Response::as_handle(ptr);
                $body
            }
        }
    };
}

/// Stamp one ZST adapter per variant and register it via that variant's `$method`.
/// Each arm is a generic fn *item* monomorphized over `<U, H>`, so it is itself
/// a ZST satisfying the `$method` bound (`Fn(*mut U, …)`).
///
/// Syntax:
///   any_response_register_cb! {
///       self, $method, $opt_data;
///       <U, H: [bounds…]>
///       |u $(, pre: PreTy)* ; r, any $(, post: PostTy)*| -> Ret { body }
///   }
/// - `u` is `*mut U`, never `&mut U`: handlers re-enter code that reaches `U`, and a
///   `noalias` param lets LLVM fold away the ref they hold across that call.
/// - `r` is the typed `&mut {TLS,TCP,H3,H2}Response` param; `any` is the
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
        fn h3<$U, $H: $($bound)*>($u: *mut $U $(, $pre: $pre_ty)*, $r: &mut H3Response $(, $post: $post_ty)*) -> $ret {
            let $any = AnyResponse::H3(std::ptr::from_mut($r));
            $($body)*
        }
        fn h2<$U, $H: $($bound)*>($u: *mut $U $(, $pre: $pre_ty)*, $r: &mut H2Response $(, $post: $post_ty)*) -> $ret {
            let $any = AnyResponse::H2(std::ptr::from_mut($r));
            $($body)*
        }
        match $self {
            AnyResponse::SSL(ptr) => TLSResponse::as_handle(ptr).$method(ssl::<$U, $H>, $opt_data),
            AnyResponse::TCP(ptr) => TCPResponse::as_handle(ptr).$method(tcp::<$U, $H>, $opt_data),
            AnyResponse::H3(ptr) => H3Response::as_handle(ptr).$method(h3::<$U, $H>, $opt_data),
            AnyResponse::H2(ptr) => H2Response::as_handle(ptr).$method(h2::<$U, $H>, $opt_data),
        }
    }};
}

impl AnyResponse {
    pub fn assert_ssl(self) -> *mut TLSResponse {
        match self {
            AnyResponse::SSL(resp) => resp,
            AnyResponse::TCP(_) => panic!("Expected SSL response, got TCP response"),
            AnyResponse::H3(_) | AnyResponse::H2(_) => {
                panic!("Expected SSL response, got a stream response")
            }
        }
    }

    pub fn assert_no_ssl(self) -> *mut TCPResponse {
        match self {
            AnyResponse::SSL(_) => panic!("Expected TCP response, got SSL response"),
            AnyResponse::TCP(resp) => resp,
            AnyResponse::H3(_) | AnyResponse::H2(_) => {
                panic!("Expected TCP response, got a stream response")
            }
        }
    }

    pub fn mark_needs_more(self) {
        any_dispatch!(self, |r| r.mark_needs_more())
    }

    pub fn mark_wrote_content_length_header(self) {
        any_dispatch!(self, |r| r.mark_wrote_content_length_header())
    }

    pub fn mark_wrote_date_header(self) {
        any_dispatch!(self, |r| r.mark_wrote_date_header())
    }

    pub fn write_mark(self) {
        any_dispatch!(self, |r| r.write_mark())
    }

    pub fn end_send_file(self, write_offset: u64, close_connection: bool) {
        any_dispatch!(self, |r| r.end_send_file(write_offset, close_connection))
    }

    /// See `uws_res::close_if_done_and_marked`.
    pub fn close_if_done_and_marked(self) {
        any_dispatch!(self, |r| r.close_if_done_and_marked())
    }

    pub fn socket(self) -> *mut uws_res {
        match self {
            AnyResponse::H3(_) | AnyResponse::H2(_) => {
                panic!("socket() is only available for HTTP/1 responses")
            }
            AnyResponse::SSL(_) | AnyResponse::TCP(_) => self.as_ptr().cast(),
        }
    }

    pub fn http1<'a>(self) -> Option<&'a uws_res> {
        matches!(self, AnyResponse::SSL(_) | AnyResponse::TCP(_))
            .then(|| uws_res::opaque_ref(self.as_ptr().cast()))
    }

    /// The handle with its variant erased, for the C++ shims that take the
    /// response as `void*` next to a `ResponseKind`, and for stores that keep
    /// the kind elsewhere (`HTTPServerWritable::res` recovers the variant from
    /// its const generics).
    #[inline]
    pub fn as_ptr(self) -> *mut c_void {
        match self {
            AnyResponse::SSL(ptr) => ptr.cast::<c_void>(),
            AnyResponse::TCP(ptr) => ptr.cast::<c_void>(),
            AnyResponse::H3(ptr) => ptr.cast::<c_void>(),
            AnyResponse::H2(ptr) => ptr.cast::<c_void>(),
        }
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

    pub fn get_buffered_amount(self) -> u64 {
        any_dispatch!(self, |r| r.get_buffered_amount())
    }

    /// H2 and H3 have no batch tail.
    pub fn has_fully_drained(self) -> bool {
        match self.http1() {
            Some(res) => res.has_fully_drained(),
            None => self.get_buffered_amount() == 0,
        }
    }

    pub fn write_continue(self) {
        any_dispatch!(self, |r| r.write_continue())
    }

    pub fn write_informational(self, data: &[u8]) {
        any_dispatch!(self, |r| r.write_informational(data))
    }

    pub fn state(self) -> State {
        any_dispatch!(self, |r| r.state())
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

    pub fn try_write_body(self, data: &[u8], is_first: bool) -> usize {
        any_dispatch!(self, |r| r.try_write_body(data, is_first))
    }

    pub fn spill_body(self, data: &[u8]) {
        any_dispatch!(self, |r| r.spill_body(data))
    }

    pub fn end(self, data: &[u8], close_connection: bool) {
        any_dispatch!(self, |r| r.end(data, close_connection))
    }

    pub fn should_close_connection(self) -> bool {
        any_dispatch!(self, |r| r.should_close_connection())
    }

    /// See `uws_res::is_closed`; always `false` for HTTP/3 (see `h3::Response::is_closed`).
    pub fn is_closed(self) -> bool {
        any_dispatch!(self, |r| r.is_closed())
    }

    pub fn try_end(self, data: &[u8], total_size: usize, close_connection: bool) -> bool {
        any_dispatch!(self, |r| r.try_end(data, total_size, close_connection))
    }

    /// HTTP/2: widen the stream receive window once the body is wanted.
    pub fn grow_request_window(self) {
        if let AnyResponse::H2(r) = self {
            bun_opaque::opaque_deref_mut(r).grow_request_window();
        }
    }
    pub fn pause(self) {
        any_dispatch!(self, |r| r.pause())
    }

    pub fn resume(self) {
        any_dispatch!(self, |r| r.resume())
    }

    pub fn write_header_int(self, key: &[u8], value: u64) {
        any_dispatch!(self, |r| r.write_header_int(key, value))
    }

    pub fn end_without_body(self, close_connection: bool) {
        any_dispatch!(self, |r| r.end_without_body(close_connection))
    }

    /// HTTP/1 only: the handlers of an HTTP/2 or HTTP/3 stream belong to one response.
    pub fn clear_handlers_of<U>(self, user_data: *mut U) {
        if let Some(res) = self.http1() {
            res.clear_handlers_of(user_data.cast());
        }
    }

    /// HTTP/1 only: an HTTP/2 or HTTP/3 stream has no socket read to finish.
    pub fn close_after_message_if_parsing(self) -> bool {
        (self.http1()).is_some_and(uws_res::close_after_message_if_parsing)
    }

    pub fn force_close(self) {
        match self {
            AnyResponse::SSL(_) | AnyResponse::TCP(_) => {
                us_socket_t::opaque_mut(self.as_ptr().cast()).close(crate::CloseCode::failure);
            }
            AnyResponse::H3(ptr) => H3Response::as_handle(ptr).force_close(),
            AnyResponse::H2(ptr) => H2Response::as_handle(ptr).force_close(),
        }
    }

    pub fn get_fd(self) -> Fd {
        (self.http1()).map_or(Fd::INVALID, |res| res.socket().raw().get_fd())
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

    /// The registrant keeps a ref on `owner` until it clears the handler, which gets a ref of its own.
    pub fn on_aborted_ref<U: AnyRefCounted + 'static, H>(self, _handler: H, owner: &RefPtr<U>)
    where
        H: Fn(RefPtr<U>, AnyResponse) + Copy + 'static,
    {
        self.on_aborted(
            |u: *mut U, any| {
                // SAFETY: `u` is the pointer registered below; the registrant holds a ref on it until the handler is cleared.
                thunk::zst::<H>()(unsafe { RefPtr::init_ref(u) }, any)
            },
            owner.as_ptr(),
        )
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

    /// The trailer section that a `node:http` server received after the body.
    pub fn take_request_trailers(self) -> Vec<u8> {
        (self.http1()).map_or_else(Vec::new, uws_res::take_request_trailers)
    }

    pub fn end_stream(self, close_connection: bool) {
        any_dispatch!(self, |r| r.end_stream(close_connection))
    }

    pub fn corked<F: FnOnce()>(self, f: F) {
        any_dispatch!(self, |r| r.corked(f))
    }

    pub fn run_corked_with_type<U>(self, handler: fn(&U), data: &U) {
        any_dispatch!(self, |r| r.run_corked_with_type(handler, data))
    }

    /// See `uws_res::can_upgrade`.
    pub fn can_upgrade(self) -> bool {
        self.http1().is_some_and(uws_res::can_upgrade)
    }

    /// Returns false if the socket can't be upgraded (see `can_upgrade`). Nothing was written and
    /// the caller still owns `data`.
    pub fn upgrade<D>(
        self,
        data: *mut D,
        sec_web_socket_key: &[u8],
        sec_web_socket_protocol: &[u8],
        sec_web_socket_extensions: &[u8],
        ctx: &WebSocketUpgradeContext,
    ) -> bool {
        // server.upgrade() returns false before reaching here for a stream.
        self.http1().unwrap().upgrade(
            data.cast(),
            sec_web_socket_key,
            sec_web_socket_protocol,
            sec_web_socket_extensions,
            ctx,
        )
    }

    /// See `uws_res::write_handshake`.
    pub fn write_handshake(self, handshake: &[u8]) -> bool {
        (self.http1()).is_some_and(|res| res.write_handshake(handshake))
    }

    /// After `write_handshake` succeeded.
    pub fn become_web_socket<D>(
        self,
        data: *mut D,
        deflate_params: Option<Params>,
        ctx: &WebSocketUpgradeContext,
    ) {
        (self.http1().unwrap()).become_web_socket(data.cast(), deflate_params, ctx)
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
impl From<*mut H2Response> for AnyResponse {
    #[inline]
    fn from(r: *mut H2Response) -> Self {
        AnyResponse::H2(r)
    }
}

pub(crate) type H3Response = crate::h3::Response;
pub(crate) type H2Response = crate::h2::Response;

bitflags::bitflags! {
    /// HttpResponse.h mirrors some.
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct State: u32 {
        const HTTP_STATUS_CALLED               = 1;
        const HTTP_WRITE_CALLED                = 2;
        const HTTP_END_CALLED                  = 4;
        const HTTP_RESPONSE_PENDING            = 8;
        const HTTP_CONNECTION_CLOSE            = 16;
        const HTTP_WROTE_CONTENT_LENGTH_HEADER = 32;
        const HTTP_WROTE_DATE_HEADER           = 64;
        const HTTP_WROTE_TRANSFER_ENCODING_HEADER = 128;
        /// HTTP/1.0
        const HTTP_ANCIENT_REQUEST             = 1 << 8;
        const HTTP_NO_BODY_STATUS              = 1 << 9;
        const HTTP_CLOSE_DELIMITED             = 1 << 10;
        /// The request whose handler runs has to queue its response.
        const HTTP_NODE_PIPELINED_DISPATCH     = 1 << 11;
        const HTTP_NODE_PARSING_STOPPED        = 1 << 12;
        /// Until the responses have drained.
        const HTTP_NODE_READS_PAUSED           = 1 << 13;
        const HTTP_NODE_TUNNEL_AFTER_BODY      = 1 << 14;
        /// With something left to send.
        const HTTP_NODE_RECEIVED_FIN           = 1 << 15;
        const HTTP_NODE_HAS_RESPONSE_TRAILERS  = 1 << 16;
        const HTTP_CLOSE_WHEN_IDLE             = 1 << 17;
        const HTTP_SEND_WHEN_COMPLETE          = 1 << 18;
        const HTTP_NODE_NOTIFY_READ_PARSED     = 1 << 19;
        const HTTP_NODE_CLOSE_AFTER_MESSAGE    = 1 << 20;
        /// Even if the response never ends.
        const HTTP_NODE_CLOSE_AFTER_DRAIN      = 1 << 21;
        /// Before we did.
        const HTTP_NODE_PEER_ENDED             = 1 << 22;
        const HTTP_NODE_HALF_CLOSED            = 1 << 23;
    }
}

impl State {
    /// What outlives a response.
    pub(crate) const OF_CONNECTION: Self = (Self::HTTP_NODE_PARSING_STOPPED)
        .union(Self::HTTP_NODE_READS_PAUSED)
        .union(Self::HTTP_NODE_TUNNEL_AFTER_BODY)
        .union(Self::HTTP_NODE_RECEIVED_FIN)
        .union(Self::HTTP_CLOSE_WHEN_IDLE)
        .union(Self::HTTP_NODE_CLOSE_AFTER_MESSAGE)
        .union(Self::HTTP_NODE_CLOSE_AFTER_DRAIN)
        .union(Self::HTTP_NODE_PEER_ENDED)
        .union(Self::HTTP_NODE_HALF_CLOSED);

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

    #[inline]
    pub fn is_node_received_fin(self) -> bool {
        self.bits() & State::HTTP_NODE_RECEIVED_FIN.bits() != 0
    }

    /// uws closes this socket once the read it is parsing is delivered.
    #[inline]
    pub fn is_node_close_after_message(self) -> bool {
        self.bits() & State::HTTP_NODE_CLOSE_AFTER_MESSAGE.bits() != 0
    }
}

pub enum WriteResult {
    WantMore(usize),
    Backpressure(usize),
}

unsafe extern "C" {
    /// The length of `dest`, or 0.
    safe fn uws_res_get_remote_address_info(
        res: &uws_res,
        dest: &mut *const u8,
        port: &mut i32,
        is_ipv6: &mut bool,
    ) -> usize;
}
