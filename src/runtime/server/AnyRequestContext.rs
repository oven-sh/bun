//! A generic wrapper for the HTTP(s) Server `RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.

use core::ffi::c_uint;

use bun_ptr::ThisPtr;
use bun_uws as uws;

use crate::webcore::CookieMap;

pub use super::request_context::AdditionalOnAbortCallback;
use super::request_context::RequestContext;
use super::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};

// The eight monomorphizations of `NewRequestContext` (ssl × debug × mux),
// where mux = HTTP/2 or HTTP/3 (see `request_context::Req`).
pub(crate) type HttpCtx = RequestContext<HTTPServer, false, false, false>;
pub(crate) type HttpsCtx = RequestContext<HTTPSServer, true, false, false>;
pub(crate) type DebugHttpCtx = RequestContext<DebugHTTPServer, false, true, false>;
pub(crate) type DebugHttpsCtx = RequestContext<DebugHTTPSServer, true, true, false>;
pub(crate) type HttpMuxCtx = RequestContext<HTTPServer, false, false, true>;
pub(crate) type HttpsMuxCtx = RequestContext<HTTPSServer, true, false, true>;
pub(crate) type DebugHttpMuxCtx = RequestContext<DebugHTTPServer, false, true, true>;
pub(crate) type DebugHttpsMuxCtx = RequestContext<DebugHTTPSServer, true, true, true>;

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
}

/// A tagged, non-owning [`ThisPtr`] to one of the eight `RequestContext` types.
/// Every holder is something the context outlives (its `Request`, its body
/// producer/consumer hooks, its response sink, its file stream) or that holds
/// a ref on it (`SavedRequest`).
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

mod sealed {
    pub trait Sealed {}
    impl<S: crate::server::ServerLike + 'static, const SSL: bool, const DBG: bool, const MUX: bool>
        Sealed for super::RequestContext<S, SSL, DBG, MUX>
    {
    }
}

/// Internal: maps each `RequestContext` monomorphization to its tag so
/// `AnyRequestContext::init` is generic over the eight types without `TypeList`.
/// Sealed: `dispatch!` trusts `TAG` to name the type.
pub trait CtxKind: sealed::Sealed {
    const TAG: CtxTag;
}

/// `CtxTag::None` for combinations that are never instantiated (a server
/// whose `(SSL, DEBUG)` differ from the context's), so each tag names exactly
/// one type.
const fn ctx_tag_for(server_ssl: bool, server_dbg: bool, ssl: bool, dbg: bool, mux: bool) -> CtxTag {
    if server_ssl != ssl || server_dbg != dbg {
        return CtxTag::None;
    }
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
impl<ThisServer: super::ServerLike + 'static, const SSL: bool, const DBG: bool, const MUX: bool>
    CtxKind for RequestContext<ThisServer, SSL, DBG, MUX>
{
    const TAG: CtxTag = ctx_tag_for(ThisServer::SSL, ThisServer::DEBUG, SSL, DBG, MUX);
}

impl AnyRequestContext {
    pub(crate) fn init<T: CtxKind>(request_ctx: ThisPtr<T>) -> Self {
        Self {
            tag: T::TAG,
            ptr: request_ctx.as_ptr().cast::<()>(),
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
                type $T = $Ty;
                // SAFETY: tag matched, so `ptr` is the `ThisPtr<$Ty>` `init`
                // recorded; the holder's contract (see the type doc) keeps the
                // context live while this handle is used.
                let $ctx: ThisPtr<$T> = unsafe { ThisPtr::new(this.ptr.cast::<$T>()) };
                $body
            }};
        }
        match this.tag {
            CtxTag::None => $default,
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

    pub fn get<T: CtxKind>(self) -> Option<ThisPtr<T>> {
        if self.tag != CtxTag::None && self.tag == T::TAG {
            // SAFETY: as for `dispatch!` — the tag names `T`.
            Some(unsafe { ThisPtr::new(self.ptr.cast::<T>()) })
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
            ctx.req.set(Some(uws::AnyRequest::H1(req)));
        })
    }

    pub(crate) fn get_request(self) -> Option<*mut uws::Request> {
        dispatch!(self, None, |_T, ctx| match ctx.req.get()? {
            // url/headers already on the Request for H2/H3
            uws::AnyRequest::H1(req) => Some(req),
            uws::AnyRequest::H3(_) => None,
        })
    }

    /// A ref for a holder that stores this handle past the request callback
    /// (`SavedRequest`); paired with [`deref`](Self::deref).
    pub fn ref_(self) {
        dispatch!(self, (), |_T, ctx| ctx.ref_())
    }

    pub(crate) fn set_signal_aborted(self, reason: crate::server::jsc::CommonAbortReason) {
        dispatch!(self, (), |_T, ctx| ctx.set_signal_aborted(reason))
    }

    pub(crate) fn dev_server(self) -> Option<bun_ptr::BackRef<crate::bake::DevServer::DevServer>> {
        dispatch!(self, None, |_T, ctx| ctx.dev_server())
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

    /// Releases the ref [`ref_`](Self::ref_) took.
    pub fn deref(self) {
        dispatch!(self, (), |T, ctx| <T as bun_ptr::CellRefCounted>::deref_nn(
            ctx.into()
        ))
    }

    pub fn on_request_body_stream_drained(self) {
        dispatch!(self, (), |_T, ctx| ctx.on_request_body_stream_drained())
    }

    pub fn write_chunk(
        self,
        data: &crate::webcore::streams::Result,
    ) -> crate::webcore::streams::Writable {
        dispatch!(self, crate::webcore::streams::Writable::Done, |T, ctx| {
            T::write_chunk(ctx, data)
        })
    }

    pub fn end_chunk(self, err: Option<&crate::webcore::streams::StreamError>) {
        dispatch!(self, (), |T, ctx| T::end_chunk(ctx, err))
    }

    /// The response sink's first write: flush status and headers ahead of it.
    pub(crate) fn on_first_stream_write(self) {
        dispatch!(self, (), |_T, ctx| ctx.handle_first_stream_write())
    }

    /// `Body::ReceiveValue::Server`: the pending response body resolved.
    pub(crate) fn render_pending_body_value(self, value: &mut crate::webcore::body::Value) {
        dispatch!(self, (), |T, ctx| T::render_pending_body_value(ctx, value))
    }

    /// `FileResponseStream` finished sending the body, or failed with `err`
    /// (after force-closing the socket).
    pub(crate) fn on_file_stream_complete(
        self,
        resp: uws::AnyResponse,
        err: Option<bun_sys::Error>,
    ) {
        dispatch!(self, (), |T, ctx| T::on_file_stream_complete(
            ctx, resp, err
        ))
    }

    /// The client went away while `FileResponseStream` was sending the body.
    pub(crate) fn on_file_stream_abort(self, resp: uws::AnyResponse) {
        dispatch!(self, (), |T, ctx| T::on_abort(ctx, resp))
    }

    /// `S3::client::stat` for a HEAD response with an S3 body completed.
    pub(crate) fn on_s3_size_resolved(
        self,
        result: crate::webcore::s3::simple_request::S3StatResult<'_>,
    ) {
        dispatch!(self, (), |T, ctx| T::on_s3_size_resolved(ctx, result))
    }
}
