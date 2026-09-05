//! A generic wrapper for the HTTP(s) Server `RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.

use core::ffi::{c_uint, c_void};

use bun_uws as uws;

use crate::webcore::CookieMap;

pub use super::request_context::AdditionalOnAbortCallback;
use super::request_context::RequestContext;
use super::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};

// The eight monomorphizations of `NewRequestContext` (ssl × debug × mux),
// where mux = HTTP/2 or HTTP/3 (see `request_context::Req`).
type HttpCtx = RequestContext<HTTPServer, false, false, false>;
type HttpsCtx = RequestContext<HTTPSServer, true, false, false>;
type DebugHttpCtx = RequestContext<DebugHTTPServer, false, true, false>;
type DebugHttpsCtx = RequestContext<DebugHTTPSServer, true, true, false>;
type HttpMuxCtx = RequestContext<HTTPServer, false, false, true>;
type HttpsMuxCtx = RequestContext<HTTPSServer, true, false, true>;
type DebugHttpMuxCtx = RequestContext<DebugHTTPServer, false, true, true>;
type DebugHttpsMuxCtx = RequestContext<DebugHTTPSServer, true, true, true>;

// The `bun_ptr::impl_tagged_ptr_union!` macro hits the orphan rule from
// outside `bun_ptr`, so store `(tag: u8, ptr: *mut ())` as two fields.
// A tagged-pointer pack would be 8 bytes instead of 16. AnyRequestContext is
// stored inside `webcore::Request` (one per in-flight request); if profiling
// flags the extra 8 bytes, move the impl_tagged_ptr_union! invocation into
// `bun_ptr` for these eight types.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CtxTag {
    None = 0,
    Http,
    Https,
    DebugHttp,
    DebugHttps,
    HttpMux,
    HttpsMux,
    DebugHttpMux,
    DebugHttpsMux,
    /// The pointee is the H3 CONNECT stream (`bun_uws_sys::h3::Response`), not
    /// a `RequestContext`: a WebTransport `upgrade` runs before any context
    /// exists, and `requestIP` is the one thing it needs answered. Set and
    /// nulled around the `upgrade` call in `WebTransportSession::decide`, so
    /// the pointer is never held past the frame that owns the stream.
    WebTransportConnect,
}

#[derive(Copy, Clone)]
pub struct AnyRequestContext {
    pub(crate) tag: CtxTag,
    pub ptr: *mut (),
}

impl AnyRequestContext {
    pub(crate) const NULL: Self = Self {
        tag: CtxTag::None,
        ptr: core::ptr::null_mut(),
    };
}

/// Internal: maps each `RequestContext` monomorphization to its tag so
/// `AnyRequestContext::init` is generic over the eight types without `TypeList`.
pub trait CtxKind {
    const TAG: CtxTag;
}

const fn ctx_tag_for(ssl: bool, dbg: bool, mux: bool) -> CtxTag {
    match (ssl, dbg, mux) {
        (false, false, false) => CtxTag::Http,
        (true, false, false) => CtxTag::Https,
        (false, true, false) => CtxTag::DebugHttp,
        (true, true, false) => CtxTag::DebugHttps,
        (false, false, true) => CtxTag::HttpMux,
        (true, false, true) => CtxTag::HttpsMux,
        (false, true, true) => CtxTag::DebugHttpMux,
        (true, true, true) => CtxTag::DebugHttpsMux,
    }
}

// Blanket impl over the const-generic params so any `Ctx: RequestCtx` (which
// is always a `RequestContext<_, SSL, DBG, MUX>`) also satisfies `CtxKind`
// without callers having to spell the eight concrete types.
impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> CtxKind
    for RequestContext<ThisServer, SSL, DBG, MUX>
{
    const TAG: CtxTag = ctx_tag_for(SSL, DBG, MUX);
}

impl AnyRequestContext {
    pub(crate) fn init<T: CtxKind>(request_ctx: *const T) -> Self {
        Self {
            tag: T::TAG,
            ptr: request_ctx as *mut (),
        }
    }

    /// See [`CtxTag::WebTransportConnect`]. The caller owns the detach.
    pub(crate) fn webtransport_connect(res: *mut bun_uws_sys::h3::Response) -> Self {
        Self {
            tag: CtxTag::WebTransportConnect,
            ptr: res.cast::<()>(),
        }
    }
}

/// Dispatch `$body` to the concrete RequestContext type behind the tagged
/// pointer. The pointer types only differ in their const-generic parameters
/// (ssl/debug/mux), so every method body is identical — this collapses what
/// used to be hand-written switch arms per accessor.
///
/// Rust closures cannot be generic over
/// `T`, so a macro is the closest structural equivalent.
macro_rules! dispatch {
    ($self:expr, $default:expr, |$T:ident, $ctx:ident| $body:expr) => {{
        let this = $self;
        macro_rules! arm {
            ($Ty:ty) => {{
                // SAFETY: tag matched; ptr is non-null and live for the
                // duration of the dispatch arm. `RequestContext` is
                // interior-mutable, so a shared reborrow suffices.
                let $ctx = unsafe { &*this.ptr.cast::<$Ty>() };
                type $T = $Ty;
                let _ = core::marker::PhantomData::<$T>;
                $body
            }};
        }
        match this.tag {
            CtxTag::None | CtxTag::WebTransportConnect => $default,
            CtxTag::Http => arm!(HttpCtx),
            CtxTag::Https => arm!(HttpsCtx),
            CtxTag::DebugHttp => arm!(DebugHttpCtx),
            CtxTag::DebugHttps => arm!(DebugHttpsCtx),
            CtxTag::HttpMux => arm!(HttpMuxCtx),
            CtxTag::HttpsMux => arm!(HttpsMuxCtx),
            CtxTag::DebugHttpMux => arm!(DebugHttpMuxCtx),
            CtxTag::DebugHttpsMux => arm!(DebugHttpsMuxCtx),
        }
    }};
    // Raw-pointer variant: hands the typed `*mut T` to `$body` without forming
    // a `&mut` reborrow. Use when the callee may re-enter while an outer frame
    // already holds `&mut Self` (borrow = ptr).
    ($self:expr, $default:expr, ptr |$T:ident, $ptr:ident| $body:expr) => {{
        let this = $self;
        macro_rules! arm {
            ($Ty:ty) => {{
                type $T = $Ty;
                let $ptr = this.ptr.cast::<$T>();
                $body
            }};
        }
        match this.tag {
            CtxTag::None | CtxTag::WebTransportConnect => $default,
            CtxTag::Http => arm!(HttpCtx),
            CtxTag::Https => arm!(HttpsCtx),
            CtxTag::DebugHttp => arm!(DebugHttpCtx),
            CtxTag::DebugHttps => arm!(DebugHttpsCtx),
            CtxTag::HttpMux => arm!(HttpMuxCtx),
            CtxTag::HttpsMux => arm!(HttpsMuxCtx),
            CtxTag::DebugHttpMux => arm!(DebugHttpMuxCtx),
            CtxTag::DebugHttpsMux => arm!(DebugHttpsMuxCtx),
        }
    }};
}

impl AnyRequestContext {
    pub(crate) fn set_additional_on_abort_callback(self, cb: Option<AdditionalOnAbortCallback>) {
        dispatch!(self, (), |_T, ctx| {
            if let Some(old) = ctx.additional_on_abort.replace(cb) {
                debug_assert!(false, "additional_on_abort set twice");
                old.deref();
            }
        })
    }

    pub(crate) fn memory_cost(self) -> usize {
        dispatch!(self, 0, |_T, ctx| ctx.memory_cost())
    }

    pub fn get<T: CtxKind>(self) -> Option<*mut T> {
        if self.tag == T::TAG {
            Some(self.ptr.cast::<T>())
        } else {
            None
        }
    }

    pub(crate) fn set_timeout(self, seconds: c_uint) -> bool {
        dispatch!(self, false, |_T, ctx| ctx.set_timeout(seconds))
    }

    pub(crate) fn set_cookies(self, cookie_map: Option<*mut CookieMap>) {
        dispatch!(self, (), |_T, ctx| ctx.set_cookies(cookie_map))
    }

    pub(crate) fn get_remote_socket_info(self) -> Option<uws::SocketAddress> {
        if self.tag == CtxTag::WebTransportConnect {
            // Live for exactly the `upgrade` call: `decide` nulls this context
            // before its frame returns, so the handle is never read stale.
            let resp = bun_uws_sys::AnyResponse::H3(self.ptr.cast::<bun_uws_sys::h3::Response>());
            let info = resp.get_remote_socket_info()?;
            return Some(uws::SocketAddress {
                ip: info.ip().to_vec().into_boxed_slice(),
                port: info.port,
                is_ipv6: info.is_ipv6,
            });
        }
        dispatch!(self, None, |_T, ctx| ctx.get_remote_socket_info())
    }

    pub(crate) fn detach_request(self) {
        dispatch!(self, (), |_T, ctx| {
            ctx.req.set(None);
        })
    }

    /// Wont actually set anything if `self` is `.none`
    pub(crate) fn set_request(self, req: *mut uws::Request) {
        dispatch!(self, (), |T, ctx| {
            if T::IS_MUX {
                // HTTP/2 and HTTP/3 populate url/headers eagerly
                return;
            }
            // `Req<_,_> = c_void` (erased handle). For non-mux the underlying
            // type is always `uws::Request`, so the cast is purely nominal.
            ctx.req.set(Some(req.cast::<c_void>()));
        })
    }

    pub(crate) fn get_request(self) -> Option<*mut uws::Request> {
        dispatch!(self, None, |T, ctx| {
            if T::IS_MUX {
                // url/headers already on the Request
                return None;
            }
            ctx.req.get().map(|p| p.cast::<uws::Request>())
        })
    }

    pub fn ref_(self) {
        dispatch!(self, (), |_T, ctx| ctx.ref_())
    }

    pub(crate) fn set_signal_aborted(self, reason: crate::server::jsc::CommonAbortReason) {
        dispatch!(self, (), |_T, ctx| ctx.set_signal_aborted(reason))
    }

    pub(crate) fn dev_server(self) -> Option<&'static crate::bake::DevServer::DevServer> {
        dispatch!(self, None, |_T, ctx| ctx.dev_server().map(|r| {
            // SAFETY: the server backref outlives any AnyRequestContext (held only
            // for the duration of a request callback); `self` is a by-value tagged
            // pointer, so there is no input lifetime to tie the borrow to.
            unsafe { bun_ptr::detach_lifetime_ref(r) }
        }))
    }

    /// Mutable access to the attached DevServer. The accessor above hands out
    /// `&` only. The `Box` slot
    /// inside `NewServer` has a stable address, so deriving `&mut` here is
    /// sound as long as the caller upholds the usual single-writer rule on the
    /// JS thread.
    pub(crate) fn dev_server_mut(self) -> Option<*mut crate::bake::DevServer::DevServer> {
        dispatch!(self, None, |_T, ctx| {
            let server = ctx.server.get()?.as_ptr();
            // SAFETY: `ctx.server` is a non-null backref that outlives this context
            // and `dev_server` is a `Box` field never moved while requests are in
            // flight, so dereferencing for exclusive access on the JS thread is sound.
            let ds = unsafe { (*server).dev_server.as_deref_mut()? };
            Some(core::ptr::from_mut(ds))
        })
    }

    pub fn deref(self) {
        dispatch!(self, (), |_T, ctx| ctx.deref())
    }

    pub fn on_request_body_stream_drained(self) {
        dispatch!(
            self,
            (),
            ptr | T,
            ptr | T::on_request_body_stream_drained(ptr)
        )
    }

    pub fn write_chunk(
        self,
        data: &crate::webcore::streams::Result,
    ) -> crate::webcore::streams::Writable {
        dispatch!(
            self,
            crate::webcore::streams::Writable::Done,
            ptr | T,
            ptr | T::write_chunk(ptr, data)
        )
    }

    pub fn end_chunk(self, err: Option<&crate::webcore::streams::StreamError>) {
        dispatch!(self, (), ptr | T, ptr | T::end_chunk(ptr, err))
    }
}
