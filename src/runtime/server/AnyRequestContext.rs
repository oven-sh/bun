//! A generic wrapper for the HTTP(s) Server `RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.

use core::ffi::{c_uint, c_void};

use bun_uws as uws;

use crate::webcore::CookieMap;

pub use super::request_context::AdditionalOnAbortCallback;
use super::request_context::RequestContext;
use super::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};
use super::{MUX_H1, MUX_H2, MUX_H3};

// The eight monomorphizations of `NewRequestContext` (ssl × debug × mux).
// H2/H3 are TLS-only, so the non-SSL × {H2,H3} combinations are never
// instantiated and map to `CtxTag::None`.
type HttpCtx = RequestContext<HTTPServer, false, false, { MUX_H1 }>;
type HttpsCtx = RequestContext<HTTPSServer, true, false, { MUX_H1 }>;
type DebugHttpCtx = RequestContext<DebugHTTPServer, false, true, { MUX_H1 }>;
type DebugHttpsCtx = RequestContext<DebugHTTPSServer, true, true, { MUX_H1 }>;
type HttpsH2Ctx = RequestContext<HTTPSServer, true, false, { MUX_H2 }>;
type DebugHttpsH2Ctx = RequestContext<DebugHTTPSServer, true, true, { MUX_H2 }>;
type HttpsH3Ctx = RequestContext<HTTPSServer, true, false, { MUX_H3 }>;
type DebugHttpsH3Ctx = RequestContext<DebugHTTPSServer, true, true, { MUX_H3 }>;

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
    HttpsH2,
    DebugHttpsH2,
}

#[derive(Copy, Clone)]
pub struct AnyRequestContext {
    pub tag: CtxTag,
    pub ptr: *mut (),
}

impl AnyRequestContext {
    pub const NULL: Self = Self {
        tag: CtxTag::None,
        ptr: core::ptr::null_mut(),
    };
}

/// Internal: maps each `RequestContext` monomorphization to its tag so
/// `AnyRequestContext::init` is generic over the six types without `TypeList`.
pub trait CtxKind {
    const TAG: CtxTag;
}

const fn ctx_tag_for(ssl: bool, dbg: bool, mux: u8) -> CtxTag {
    match (ssl, dbg, mux) {
        (false, false, MUX_H1) => CtxTag::Http,
        (true, false, MUX_H1) => CtxTag::Https,
        (false, true, MUX_H1) => CtxTag::DebugHttp,
        (true, true, MUX_H1) => CtxTag::DebugHttps,
        (true, false, MUX_H2) => CtxTag::HttpsH2,
        (true, true, MUX_H2) => CtxTag::DebugHttpsH2,
        (true, false, MUX_H3) => CtxTag::HttpsH3,
        (true, true, MUX_H3) => CtxTag::DebugHttpsH3,
        // H2/H3 require TLS; (false, _, MUX_H2|MUX_H3) is never instantiated.
        // Map to None so a stray dispatch is a no-op rather than a wild cast.
        (false, _, _) => CtxTag::None,
        (true, _, _) => CtxTag::None,
    }
}

// Blanket impl over the const-generic params so any `Ctx: RequestCtx` (which
// is always a `RequestContext<_, SSL, DBG, MUX>`) also satisfies `CtxKind`
// without callers having to spell the concrete types.
impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: u8> CtxKind
    for RequestContext<ThisServer, SSL, DBG, MUX>
{
    const TAG: CtxTag = ctx_tag_for(SSL, DBG, MUX);
}

impl AnyRequestContext {
    pub fn init<T: CtxKind>(request_ctx: *const T) -> Self {
        Self {
            tag: T::TAG,
            ptr: request_ctx as *mut (),
        }
    }
}

/// Dispatch `$body` to the concrete RequestContext type behind the tagged
/// pointer. The pointer types only differ in their const-generic parameters
/// (ssl/debug/mux), so every method body is identical — this collapses what
/// would otherwise be eight hand-written switch arms per accessor.
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
                // SAFETY: tag matched; ptr is non-null and exclusively
                // accessed for the duration of the dispatch arm.
                let $ctx = unsafe { &mut *this.ptr.cast::<$Ty>() };
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
            CtxTag::HttpsH2 => arm!(HttpsH2Ctx),
            CtxTag::DebugHttpsH2 => arm!(DebugHttpsH2Ctx),
        }
    }};
}

impl AnyRequestContext {
    pub fn set_additional_on_abort_callback(self, cb: Option<AdditionalOnAbortCallback>) {
        dispatch!(self, (), |_T, ctx| {
            debug_assert!(ctx.additional_on_abort.is_none());
            ctx.additional_on_abort = cb;
        })
    }

    pub fn memory_cost(self) -> usize {
        dispatch!(self, 0, |_T, ctx| ctx.memory_cost())
    }

    pub fn get<T: CtxKind>(self) -> Option<*mut T> {
        if self.tag == T::TAG {
            Some(self.ptr.cast::<T>())
        } else {
            None
        }
    }

    pub fn set_timeout(self, seconds: c_uint) -> bool {
        dispatch!(self, false, |_T, ctx| ctx.set_timeout(seconds))
    }

    pub fn set_cookies(self, cookie_map: Option<*mut CookieMap>) {
        dispatch!(self, (), |_T, ctx| ctx.set_cookies(cookie_map))
    }

    pub fn enable_timeout_events(self) {
        dispatch!(self, (), |_T, ctx| ctx.set_timeout_handler())
    }

    pub fn get_remote_socket_info(self) -> Option<uws::SocketAddress> {
        dispatch!(self, None, |_T, ctx| ctx.get_remote_socket_info())
    }

    pub fn detach_request(self) {
        dispatch!(self, (), |_T, ctx| {
            ctx.req = None;
        })
    }

    /// Wont actually set anything if `self` is `.none`
    pub fn set_request(self, req: *mut uws::Request) {
        dispatch!(self, (), |T, ctx| {
            if T::IS_MUX {
                // H2/H3 populate url/headers eagerly
                return;
            }
            // `ctx.req` is `Option<*mut Req<SSL,MUX>>` where
            // `Req<_,_> = c_void` (erased handle). For H1 the underlying
            // type is always `uws::Request`, so the cast is purely nominal.
            ctx.req = Some(req.cast::<c_void>());
        })
    }

    pub fn get_request(self) -> Option<*mut uws::Request> {
        dispatch!(self, None, |T, ctx| {
            if T::IS_MUX {
                // url/headers already on the Request
                return None;
            }
            ctx.req.map(|p| p.cast::<uws::Request>())
        })
    }

    pub fn ref_(self) {
        dispatch!(self, (), |_T, ctx| ctx.ref_())
    }

    pub fn set_signal_aborted(self, reason: crate::server::jsc::CommonAbortReason) {
        dispatch!(self, (), |_T, ctx| ctx.set_signal_aborted(reason))
    }

    pub fn dev_server(self) -> Option<&'static crate::bake::DevServer::DevServer> {
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
    pub fn dev_server_mut(self) -> Option<*mut crate::bake::DevServer::DevServer> {
        dispatch!(self, None, |_T, ctx| {
            let server = ctx.server?.as_ptr();
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
}
