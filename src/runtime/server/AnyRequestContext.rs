//! A generic wrapper for the HTTP(s) Server `RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.

use core::ffi::{c_uint, c_void};

use bun_uws as uws;

use crate::webcore::CookieMap;

pub use super::request_context::AdditionalOnAbortCallback;
use super::request_context::RequestContext;
use super::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};

// The six monomorphizations of `NewRequestContext` (ssl × debug × h3).
// In Zig these are nested as `HTTPServer.RequestContext` etc.
type HttpCtx = RequestContext<HTTPServer, false, false, false>;
type HttpsCtx = RequestContext<HTTPSServer, true, false, false>;
type DebugHttpCtx = RequestContext<DebugHTTPServer, false, true, false>;
type DebugHttpsCtx = RequestContext<DebugHTTPSServer, true, true, false>;
type HttpsH3Ctx = RequestContext<HTTPSServer, true, false, true>;
type DebugHttpsH3Ctx = RequestContext<DebugHTTPSServer, true, true, true>;

// PORT NOTE (§Dispatch): Zig used `bun.ptr.TaggedPointerUnion(...)`. The
// `bun_ptr::impl_tagged_ptr_union!` macro hits the orphan rule from outside
// `bun_ptr`, so per §Dispatch store `(tag: u8, ptr: *mut ())` as two fields.
// PERF(port): was TaggedPointerUnion pack — 8→16 bytes. AnyRequestContext is
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
    pub fn init<T: CtxKind>(request_ctx: *const T) -> Self {
        Self {
            tag: T::TAG,
            ptr: request_ctx as *mut (),
        }
    }
}

/// Dispatch `$body` to the concrete RequestContext type behind the tagged
/// pointer. The pointer types only differ in their comptime parameters
/// (ssl/debug/http3), so every method body is identical — this collapses what
/// used to be six hand-written switch arms per accessor.
///
/// Mirrors Zig's `inline fn dispatch(..., comptime cb: anytype, args)` which
/// `inline for`s over `Pointer.type_map`. Rust closures cannot be generic over
/// `T`, so a macro is the closest structural equivalent.
// TODO(port): if Phase B gives all six ctx types a shared `RequestContextLike`
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
                #[allow(unused)]
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
}

// ─── dispatch arms calling gated RequestContext methods ──────────────────────
// set_timeout / set_cookies / set_timeout_handler / get_remote_socket_info /
// on_abort / ref_ / deref / set_signal_aborted forward to RequestContext
// methods that live in `_gated_state_machine`. Un-gate alongside.
// TODO(b2-blocked): RequestContext state-machine bodies.

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
            if T::IS_H3 {
                // H3 populates url/headers eagerly
                return;
            }
            // PORT NOTE: `ctx.req` is `Option<*mut Req<SSL,H3>>` where
            // `Req<_,_> = c_void` (erased handle). For non-H3 the underlying
            // type is always `uws::Request`, so the cast is purely nominal.
            ctx.req = Some(req.cast::<c_void>());
        })
    }

    pub fn get_request(self) -> Option<*mut uws::Request> {
        dispatch!(self, None, |T, ctx| {
            if T::IS_H3 {
                // url/headers already on the Request
                return None;
            }
            ctx.req.map(|p| p.cast::<uws::Request>())
        })
    }

    pub fn on_abort(self, response: uws::AnyResponse) {
        dispatch!(self, (), |T, ctx| {
            // PORT NOTE: Zig does a checked downcast of the `AnyResponse` arm
            // to `*T.Resp` before forwarding. The Rust `RequestContext::on_abort`
            // takes `uws::AnyResponse` directly (and re-checks H3 internally),
            // so forward the enum as-is — the per-variant assert is redundant.
            T::on_abort(core::ptr::from_mut::<T>(ctx), response);
        })
    }

    pub fn ref_(self) {
        dispatch!(self, (), |_T, ctx| ctx.ref_())
    }

    pub fn set_signal_aborted(self, reason: crate::server::jsc::CommonAbortReason) {
        dispatch!(self, (), |_T, ctx| ctx.set_signal_aborted(reason))
    }

    pub fn dev_server(self) -> Option<&'static crate::bake::DevServer::DevServer> {
        // SAFETY: server backref outlives any AnyRequestContext (held only for
        // the duration of a request callback). `self` is a by-value tagged
        // pointer, so there is no input lifetime to tie the borrow to.
        dispatch!(self, None, |_T, ctx| ctx
            .dev_server()
            .map(|r| unsafe { bun_ptr::detach_lifetime_ref(r) }))
    }

    /// Mutable access to the attached DevServer. Zig passed `*DevServer`
    /// freely; the Rust accessor above hands out `&` only. The `Box` slot
    /// inside `NewServer` has a stable address, so deriving `&mut` here is
    /// sound as long as the caller upholds the usual single-writer rule on the
    /// JS thread.
    pub fn dev_server_mut(self) -> Option<*mut crate::bake::DevServer::DevServer> {
        dispatch!(self, None, |_T, ctx| {
            // SAFETY: server backref outlives this context; `dev_server` is a
            // `Box` field never moved while requests are in flight.
            let server = ctx.server?.as_ptr();
            let ds = unsafe { (*server).dev_server.as_deref_mut()? };
            Some(core::ptr::from_mut(ds))
        })
    }

    pub fn deref(self) {
        dispatch!(self, (), |_T, ctx| ctx.deref())
    }
}

// ported from: src/runtime/server/AnyRequestContext.zig
