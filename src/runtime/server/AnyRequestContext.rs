//! A generic wrapper for the HTTP(s) Server `RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.

use core::ffi::c_uint;

use bun_collections::TaggedPtrUnion;
use bun_uws as uws;

use crate::webcore::CookieMap;

pub use super::request_context::AdditionalOnAbortCallback;

// TODO(port): these are the six monomorphizations of `NewRequestContext` (ssl × debug × h3).
// In Zig they are nested as `HTTPServer.RequestContext` etc. The Rust shape of
// `NewServer`/`NewRequestContext` (const-generic struct vs. distinct types) is decided when
// `server.zig` / `RequestContext.zig` are ported — adjust these aliases then.
use crate::api::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};
type HttpCtx = <HTTPServer as crate::api::ServerType>::RequestContext;
type HttpsCtx = <HTTPSServer as crate::api::ServerType>::RequestContext;
type DebugHttpCtx = <DebugHTTPServer as crate::api::ServerType>::RequestContext;
type DebugHttpsCtx = <DebugHTTPSServer as crate::api::ServerType>::RequestContext;
type HttpsH3Ctx = <HTTPSServer as crate::api::ServerType>::H3RequestContext;
type DebugHttpsH3Ctx = <DebugHTTPSServer as crate::api::ServerType>::H3RequestContext;

pub type Pointer = TaggedPtrUnion<(
    HttpCtx,
    HttpsCtx,
    DebugHttpCtx,
    DebugHttpsCtx,
    HttpsH3Ctx,
    DebugHttpsH3Ctx,
)>;

#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct AnyRequestContext {
    pub tagged_pointer: Pointer,
}

impl AnyRequestContext {
    pub const NULL: Self = Self { tagged_pointer: Pointer::NULL };

    pub fn init<T>(request_ctx: *mut T) -> Self
    where
        Pointer: From<*mut T>,
    {
        Self { tagged_pointer: Pointer::from(request_ctx) }
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
        if this.tagged_pointer.is_null() {
            return $default;
        }
        macro_rules! arm {
            ($Ty:ty) => {
                if let Some($ctx) = this.tagged_pointer.get_mut::<$Ty>() {
                    type $T = $Ty;
                    #[allow(unused)]
                    let _ = core::marker::PhantomData::<$T>;
                    return $body;
                }
            };
        }
        arm!(HttpCtx);
        arm!(HttpsCtx);
        arm!(DebugHttpCtx);
        arm!(DebugHttpsCtx);
        arm!(HttpsH3Ctx);
        arm!(DebugHttpsH3Ctx);
        unreachable!("Unexpected AnyRequestContext tag");
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

    pub fn get<T>(self) -> Option<*mut T>
    where
        Pointer: bun_collections::TaggedPtrGet<T>,
    {
        // TODO(port): exact `TaggedPtrUnion::get<T>` signature TBD in bun_collections.
        self.tagged_pointer.get::<T>()
    }

    pub fn set_timeout(self, seconds: c_uint) -> bool {
        dispatch!(self, false, |_T, ctx| ctx.set_timeout(seconds))
    }

    pub fn set_cookies(self, cookie_map: Option<&mut CookieMap>) {
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
            ctx.req = Some(req);
        })
    }

    pub fn get_request(self) -> Option<*mut uws::Request> {
        dispatch!(self, None, |T, ctx| {
            if T::IS_H3 {
                // url/headers already on the Request
                return None;
            }
            ctx.req
        })
    }

    pub fn on_abort(self, response: uws::AnyResponse) {
        dispatch!(self, (), |T, ctx| {
            // The AnyResponse arm and T::Resp are created together; assert
            // they agree so a mismatch traps in safe builds instead of being
            // silently pointer-cast.
            // TODO(port): Zig does `switch (r) { inline else => |p| if (@TypeOf(p) == *T.Resp) p else unreachable }`.
            // Model this as a checked downcast on `AnyResponse` once its Rust enum shape lands.
            let resp: &mut T::Resp = response.downcast::<T::Resp>().expect("unreachable");
            ctx.on_abort(resp);
        })
    }

    pub fn ref_(self) {
        dispatch!(self, (), |_T, ctx| ctx.ref_())
    }

    pub fn set_signal_aborted(self, reason: bun_jsc::CommonAbortReason) {
        dispatch!(self, (), |_T, ctx| ctx.set_signal_aborted(reason))
    }

    pub fn dev_server(self) -> Option<&mut crate::bake::DevServer> {
        dispatch!(self, None, |_T, ctx| ctx.dev_server())
    }

    pub fn deref(self) {
        dispatch!(self, (), |_T, ctx| ctx.deref())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/AnyRequestContext.zig (171 lines)
//   confidence: medium
//   todos:      4
//   notes:      dispatch() inline-for over type_map → macro_rules!; six RequestContext monomorphization aliases & TaggedPtrUnion API are placeholders pending server.zig/RequestContext.zig port
// ──────────────────────────────────────────────────────────────────────────
