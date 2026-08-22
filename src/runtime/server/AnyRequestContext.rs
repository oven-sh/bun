//! A generic wrapper for the HTTP(s) Server `RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.

use core::ffi::{c_uint, c_void};

use bun_uws as uws;

use crate::webcore::CookieMap;

pub use super::request_context::AdditionalOnAbortCallback;
use super::request_context::RequestContext;
use super::{DebugHTTPSServer, DebugHTTPServer, DevServerSlot, HTTPSServer, HTTPServer};

// The six monomorphizations of `NewRequestContext` (ssl × debug × h3).
type HttpCtx = RequestContext<HTTPServer, false, false, false>;
type HttpsCtx = RequestContext<HTTPSServer, true, false, false>;
type DebugHttpCtx = RequestContext<DebugHTTPServer, false, true, false>;
type DebugHttpsCtx = RequestContext<DebugHTTPSServer, true, true, false>;
type HttpsH3Ctx = RequestContext<HTTPSServer, true, false, true>;
type DebugHttpsH3Ctx = RequestContext<DebugHTTPSServer, true, true, true>;

// The `bun_ptr::impl_tagged_ptr_union!` macro hits the orphan rule from
// outside `bun_ptr`, so store `(tag: u8, ptr: *mut ())` as two fields.
// A tagged-pointer pack would be 8 bytes instead of 16. AnyRequestContext is
// stored inside `webcore::Request` (one per in-flight request); if profiling
// flags the extra 8 bytes, move the impl_tagged_ptr_union! invocation into
// `bun_ptr` for these six types.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CtxTag {
    None = 0,
    Http,
    Https,
    DebugHttp,
    DebugHttps,
    HttpsH3,
    DebugHttpsH3,
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
/// `AnyRequestContext::init` is generic over the six types without `TypeList`.
pub trait CtxKind {
    const TAG: CtxTag;
}

const fn ctx_tag_for(ssl: bool, dbg: bool, h3: bool) -> CtxTag {
    match (ssl, dbg, h3) {
        (false, false, false) => CtxTag::Http,
        (true, false, false) => CtxTag::Https,
        (false, true, false) => CtxTag::DebugHttp,
        (true, true, false) => CtxTag::DebugHttps,
        (true, false, true) => CtxTag::HttpsH3,
        (true, true, true) => CtxTag::DebugHttpsH3,
        // H3 requires TLS; (false, _, true) is never instantiated. Map to
        // None so a stray dispatch is a no-op rather than a wild cast.
        (false, _, true) => CtxTag::None,
    }
}

// Blanket impl over the const-generic params so any `Ctx: RequestCtx` (which
// is always a `RequestContext<_, SSL, DBG, H3>`) also satisfies `CtxKind`
// without callers having to spell the six concrete types.
impl<ThisServer, const SSL: bool, const DBG: bool, const H3: bool> CtxKind
    for RequestContext<ThisServer, SSL, DBG, H3>
{
    const TAG: CtxTag = ctx_tag_for(SSL, DBG, H3);
}

impl AnyRequestContext {
    pub(crate) fn init<T: CtxKind>(request_ctx: *const T) -> Self {
        Self {
            tag: T::TAG,
            ptr: request_ctx as *mut (),
        }
    }
}

/// Dispatch `$body` to the concrete RequestContext type behind the tagged
/// pointer. The pointer types only differ in their const-generic parameters
/// (ssl/debug/http3), so every method body is identical — this collapses what
/// used to be six hand-written switch arms per accessor.
///
/// Rust closures cannot be generic over
/// `T`, so a macro is the closest structural equivalent.
// TODO(refactor): if all six ctx types gain a shared `RequestContextLike`
// trait (with `const IS_H3: bool` + `type Resp`), this macro can become a
// method taking `impl FnOnce(&mut dyn RequestContextLike)` for the simple arms.
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
            CtxTag::None => $default,
            CtxTag::Http => arm!(HttpCtx),
            CtxTag::Https => arm!(HttpsCtx),
            CtxTag::DebugHttp => arm!(DebugHttpCtx),
            CtxTag::DebugHttps => arm!(DebugHttpsCtx),
            CtxTag::HttpsH3 => arm!(HttpsH3Ctx),
            CtxTag::DebugHttpsH3 => arm!(DebugHttpsH3Ctx),
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
            CtxTag::None => $default,
            CtxTag::Http => arm!(HttpCtx),
            CtxTag::Https => arm!(HttpsCtx),
            CtxTag::DebugHttp => arm!(DebugHttpCtx),
            CtxTag::DebugHttps => arm!(DebugHttpsCtx),
            CtxTag::HttpsH3 => arm!(HttpsH3Ctx),
            CtxTag::DebugHttpsH3 => arm!(DebugHttpsH3Ctx),
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
            if T::IS_H3 {
                // H3 populates url/headers eagerly
                return;
            }
            // `Req<_,_> = c_void` (erased handle). For non-H3 the underlying
            // type is always `uws::Request`, so the cast is purely nominal.
            ctx.req.set(Some(req.cast::<c_void>()));
        })
    }

    pub(crate) fn get_request(self) -> Option<*mut uws::Request> {
        dispatch!(self, None, |T, ctx| {
            if T::IS_H3 {
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

    /// Erased pointer to the dev server attached to this context's server
    /// (`None` when none is attached or the context is detached). Only the
    /// dev-server module knows the concrete type behind the slot; the typed
    /// `dev_server()`/`dev_server_mut()` views over this accessor are defined
    /// there, next to the slot's `Deref` impls.
    pub(crate) fn dev_server_ptr(self) -> Option<core::ptr::NonNull<()>> {
        dispatch!(self, None, |_T, ctx| {
            let server = ctx.server.get()?.as_ptr();
            // SAFETY: `ctx.server` is a non-null backref that outlives this
            // context; the slot's pointee is a stable heap allocation never
            // moved while requests are in flight.
            unsafe { (*server).dev_server.as_ref().map(DevServerSlot::as_ptr) }
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
