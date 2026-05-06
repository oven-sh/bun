//! This object is a description of an HTML bundle. It is created by importing an
//! HTML file, and can be passed to the `static` option in `Bun.serve`. The build
//! is done lazily (state held in HTMLBundle.Route or DevServer.RouteBundle.HTML).

use core::cell::Cell;
use core::mem;
use std::rc::Rc;

use crate::bake::dev_server::route_bundle;
use bun_http_types::Method::Method;
use bun_logger::Log;
use bun_ptr::{IntrusiveRc, RefCount, RefCounted};
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::server::{AnyServer, StaticRoute};

// `bun.Output.scoped(.HTMLBundle, .hidden)` — wrapped in a sub-module so the
// `pub static HTMLBundle` doesn't leak alongside the `pub struct HTMLBundle`
// re-export from `crate::server`.
mod debug_scope {
    bun_output::declare_scope!(HTMLBundle, hidden);
}

// .classes.ts codegen wires toJS/fromJS/fromJSDirect via #[bun_jsc::JsClass].
// HTMLBundle can be owned by JavaScript as well as any number of Server instances,
// hence the ref count alongside the JS wrapper.
// PORT NOTE (§Pointers): `*mut HTMLBundle` is the m_ctx payload of a
// `.classes.ts` wrapper — FFI rule says intrusive `RefPtr`.
pub struct HTMLBundle {
    ref_count: RefCount<HTMLBundle>,
    // TODO(port): JSC_BORROW field on heap struct — `&'static JSGlobalObject` once bun_jsc is real.
    pub global: *const JSGlobalObject,
    pub path: Box<[u8]>,
}

// `jsc.Codegen.JSHTMLBundle` — hand-expansion of what the `#[bun_jsc::JsClass]`
// derive would emit. Symbol names match generate-classes.ts
// (`${typeName}__fromJS` / `__fromJSDirect` / `__create` / `__getConstructor`).
// Hand-written (rather than `#[bun_jsc::JsClass]`) because HTMLBundle has a
// custom `finalize` that derefs an intrusive refcount instead of Box-dropping.
const _: () = {
    // `*mut HTMLBundle` is opaque to C++ (linked by symbol name only); the
    // pointee's Rust layout is irrelevant to the FFI boundary, but HTMLBundle
    // lacks `#[repr(C)]` so rustc lints anyway.
    #[allow(improper_ctypes)]
    #[cfg(all(windows, target_arch = "x86_64"))]
    unsafe extern "sysv64" {
        #[link_name = "HTMLBundle__fromJS"]
        fn __from_js(value: JSValue) -> *mut HTMLBundle;
        #[link_name = "HTMLBundle__fromJSDirect"]
        fn __from_js_direct(value: JSValue) -> *mut HTMLBundle;
        #[link_name = "HTMLBundle__create"]
        fn __create(global: *mut JSGlobalObject, ptr: *mut HTMLBundle) -> JSValue;
    }
    #[allow(improper_ctypes)]
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    unsafe extern "C" {
        #[link_name = "HTMLBundle__fromJS"]
        fn __from_js(value: JSValue) -> *mut HTMLBundle;
        #[link_name = "HTMLBundle__fromJSDirect"]
        fn __from_js_direct(value: JSValue) -> *mut HTMLBundle;
        #[link_name = "HTMLBundle__create"]
        fn __create(global: *mut JSGlobalObject, ptr: *mut HTMLBundle) -> JSValue;
    }

    impl bun_jsc::JsClass for HTMLBundle {
        fn from_js(value: JSValue) -> Option<*mut Self> {
            // SAFETY: pure FFI downcast; returns null on type mismatch.
            let p = unsafe { __from_js(value) };
            if p.is_null() { None } else { Some(p) }
        }
        fn from_js_direct(value: JSValue) -> Option<*mut Self> {
            // SAFETY: exact-structure FFI downcast; null on miss.
            let p = unsafe { __from_js_direct(value) };
            if p.is_null() { None } else { Some(p) }
        }
        fn to_js(self, global: &JSGlobalObject) -> JSValue {
            let ptr = Box::into_raw(Box::new(self));
            // SAFETY: `global` is live; ownership of `ptr` transfers to the
            // C++ wrapper (deref'd via `HTMLBundleClass__finalize` → `finalize()`).
            unsafe { __create(global.as_ptr(), ptr) }
        }
        // `noConstructor: true` — no `HTMLBundle__getConstructor` export; trait default applies.
    }
};

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
impl RefCounted for HTMLBundle {
    type DestructorCtx = ();
    fn debug_name() -> &'static str {
        "HTMLBundle"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live HTMLBundle; field projection is in-bounds.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: refcount hit zero; allocated via Box (RefPtr::new / init()).
        // `path: Box<[u8]>` auto-drops; dealloc handled by Box::from_raw.
        drop(unsafe { Box::from_raw(this) });
    }
}

// `pub const ref/deref = RefCount.ref/deref` — provided by IntrusiveRc<HTMLBundle>.

impl HTMLBundle {
    /// Initialize an HTMLBundle given a path.
    pub fn init(global: &'static JSGlobalObject, path: &[u8]) -> IntrusiveRc<HTMLBundle> {
        // Zig `try allocator.dupe` was the only fallible op; Box::from aborts on OOM.
        IntrusiveRc::new(HTMLBundle {
            ref_count: RefCount::init(),
            global,
            path: Box::<[u8]>::from(path),
        })
    }

    /// `.classes.ts` finalize: true — runs on mutator thread during lazy sweep.
    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` is the m_ctx payload of the JS wrapper; valid until this returns.
        unsafe { RefCount::<HTMLBundle>::deref(this) };
    }

    // Zig `deinit`: only `allocator.free(this.path)` + `bun.destroy(this)`.
    // `path: Box<[u8]>` auto-drops; dealloc handled by IntrusiveRc — no explicit Drop body.

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)] once codegen attribute lands for this class.
    pub fn get_index(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &this.path)
    }
}

/// Deprecated: use Route instead.
pub type HTMLBundleRoute = Route;

/// An HTMLBundle can be used across multiple server instances, an
/// HTMLBundle.Route can only be used on one server, but is also
/// reference-counted because a server can have multiple instances of the same
/// html file on multiple endpoints.
pub struct Route {
    // PORT NOTE: FFI userdata — *Route is recovered from uws callback
    // userdata (on_aborted, JSBundleCompletionTask backref). §Pointers FFI
    // rule → `bun_ptr::RefPtr<HTMLBundle>` + `impl RefCounted`.
    pub bundle: IntrusiveRc<HTMLBundle>,
    /// One HTMLBundle.Route can be specified multiple times
    ref_count: RefCount<Route>,
    // TODO: attempt to remove the null case. null is only present during server
    // initialization as only a ServerConfig object is present.
    pub server: Cell<Option<AnyServer>>,
    /// When using DevServer, this value is never read or written to.
    pub state: State,
    /// Written and read by DevServer to identify if this route has been
    /// registered with the bundler.
    pub dev_server_id: Option<route_bundle::Index>,
    /// When state == .pending, incomplete responses are stored here.
    // Raw `*mut` because the pointer is handed to uws onAborted callback and
    // compared by identity; allocation/free is via Box::into_raw/from_raw.
    pub pending_responses: Vec<*mut PendingResponse>,

    pub method: RouteMethod,
}

pub enum RouteMethod {
    Any,
    Method(bun_http_types::Method::Set),
}

impl Default for RouteMethod {
    fn default() -> Self {
        RouteMethod::Any
    }
}

impl Route {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += mem::size_of::<Route>();
        cost += self.pending_responses.len() * mem::size_of::<PendingResponse>();
        cost += self.state.memory_cost();
        cost
    }

    pub fn init(html_bundle: *mut HTMLBundle) -> IntrusiveRc<Route> {
        IntrusiveRc::new(Route {
            // SAFETY: caller passes a live HTMLBundle pointer.
            bundle: unsafe { IntrusiveRc::<HTMLBundle>::init_ref(html_bundle) },
            pending_responses: Vec::new(),
            ref_count: RefCount::init(),
            server: Cell::new(None),
            state: State::Pending,
            dev_server_id: None,
            method: RouteMethod::Any,
        })
    }
}

// `bun.ptr.RefCount(Route, "ref_count", Route.deinit, .{ .debug_name = "HTMLBundleRoute" })`
impl RefCounted for Route {
    type DestructorCtx = ();
    fn debug_name() -> &'static str {
        "HTMLBundleRoute"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Route; field projection is in-bounds.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: refcount hit zero; allocated via Box (RefPtr::new / init()).
        // Drop impl asserts pending_responses is empty and frees owned fields.
        drop(unsafe { Box::from_raw(this) });
    }
}

impl Drop for Route {
    fn drop(&mut self) {
        // pending responses keep a ref to the route
        debug_assert!(self.pending_responses.is_empty());
        // `pending_responses` (Vec), `bundle` (IntrusiveRc), `state` (Drop) auto-drop.
        // `bun.destroy(this)` handled by IntrusiveRc dealloc.
    }
}

pub enum State {
    Pending,
    // TODO(b2-blocked): bun_bundler::bundle_v2::JSBundleCompletionTask is gated.
    // Payload is `Option<*mut JSBundleCompletionTask>`; opaque ptr until then.
    Building(Option<*mut ()>),
    Err(Log),
    Html(Rc<StaticRoute>),
}

impl Drop for State {
    fn drop(&mut self) {
        match self {
            State::Err(_log) => {
                // Log drops itself
            }
            State::Building(Some(_c)) => {
                // TODO(b2-blocked): JSBundleCompletionTask.cancelled interior-mutable write +
                // deref. Payload is opaque `*mut ()` until bundle_v2 un-gates.
                todo!("blocked_on: bun_bundler::bundle_v2::JSBundleCompletionTask::cancelled");
            }
            State::Building(None) => {}
            State::Html(_html) => {
                // Rc drop handles deref
            }
            State::Pending => {}
        }
    }
}

impl State {
    pub fn memory_cost(&self) -> usize {
        match self {
            State::Pending => 0,
            State::Building(_) => 0,
            // TODO(b2-blocked): bun_logger::Log::memory_cost.
            State::Err(_log) => 0,
            State::Html(html) => html.memory_cost(),
        }
    }
}

// ─── route-handler bodies (gated) ────────────────────────────────────────────
// on_request / on_any_request / scheduleBundle / onBundleComplete need:
// bun_uws AnyResponse write/on_aborted (cycle-5-B), bun_bundler::bundle_v2,
// bun_jsc JSBundler, IntrusiveRc<Route>.

mod _gated {
    use super::*;
    // Value-namespace import of the scoped logger; `use super::*` already
    // brings in the type-namespace `struct HTMLBundle`, and Rust keeps the
    // two namespaces distinct.
    use super::debug_scope::HTMLBundle;
    use crate::api::js_bundler as JSBundler;
    use bun_bundler::bundle_v2::JSBundleCompletionTask;

    impl Route {
        pub fn on_request(&mut self, req: AnyRequest, resp: AnyResponse) {
            self.on_any_request(req, resp, false);
        }

        pub fn on_head_request(&mut self, req: AnyRequest, resp: AnyResponse) {
            self.on_any_request(req, resp, true);
        }

        fn on_any_request(&mut self, _req: AnyRequest, _resp: AnyResponse, _is_head: bool) {
            // SAFETY: self is a valid IntrusiveRc-managed allocation; keep alive for fn body.
            unsafe { RefCount::<Route>::ref_(self) };
            let _keep_alive =
                scopeguard::guard(self as *mut Route, |p| unsafe { RefCount::<Route>::deref(p) });

            // Body needs: bun_uws::AnyResponse::{end_without_body, write_status, end, on_aborted},
            // bun_uws::AnyRequest::{url, method, set_yield}, AnyServer::{dev_server,
            // get_or_load_plugins} on `crate::server::AnyServer` (only on the private
            // server_body variant), DevServer::respond_for_html_bundle taking `&mut Route`,
            // and StaticRoute::{on_request, on_head_request}. None are available yet.
            todo!("blocked_on: bun_uws::AnyResponse::end_without_body");
        }

        /// Schedule a bundle to be built.
        /// If success, bumps the ref count and returns true;
        fn schedule_bundle(&mut self, _server: AnyServer) -> Result<(), bun_core::Error> {
            // Body needs `crate::server::AnyServer::get_or_load_plugins` (currently only on
            // the private `server_body::AnyServer`), `GetOrStartLoadResult`, and
            // `ServePluginsCallback` re-exports.
            todo!("blocked_on: crate::server::AnyServer::get_or_load_plugins");
        }

        pub fn on_plugins_resolved(
            &mut self,
            _plugins: Option<&JSBundler::Plugin>,
        ) -> Result<(), bun_core::Error> {
            // Body needs `bun_bundler::BundleV2::create_and_schedule_completion_task`,
            // `JSBundler::Config` field surgery against `vm.transpiler.options.transform_options`,
            // and `crate::cli::Command::get()` — none of which are available in tier-D yet.
            let _ = self.schedule_bundle(self.server.get().expect("server set"));
            todo!("blocked_on: bun_bundler::BundleV2::create_and_schedule_completion_task");
        }

        pub fn on_plugins_rejected(&mut self) -> Result<(), bun_core::Error> {
            // TODO(port): narrow error set
            bun_output::scoped_log!(
                HTMLBundle,
                "HTMLBundleRoute(0x{:x}) plugins rejected",
                self as *const _ as usize
            );
            self.state = State::Err(Log::init());
            self.resume_pending_responses();
            Ok(())
        }

        pub fn on_complete(&mut self, _completion_task: &mut JSBundleCompletionTask) {
            // For the build task — matches the ref() taken in on_plugins_resolved.
            // SAFETY: self is IntrusiveRc-managed.
            let _drop_build_ref = scopeguard::guard(self as *mut Route, |p| unsafe {
                RefCount::<Route>::deref(p)
            });

            // Body iterates `completion_task.result` (CompletionResult), builds StaticRoutes
            // from `bundle.output_files`, prints elapsed via `bun_output::print_elapsed`, and
            // calls `server.append_static_route` / `server.reload_static_routes`.
            // JSBundleCompletionTask currently only exposes `jsc_event_loop`; the rest is gated.
            todo!("blocked_on: bun_bundler::bundle_v2::JSBundleCompletionTask::result");
        }

        pub fn resume_pending_responses(&mut self) {
            let pending = mem::take(&mut self.pending_responses);
            for pending_response_ptr in pending {
                // SAFETY: every entry was created via Box::into_raw in on_any_request and
                // is removed exactly once (here, or via on_aborted which removes without freeing).
                let mut pending_response = unsafe { Box::from_raw(pending_response_ptr) };

                let _resp = &pending_response.resp;
                let _method = &pending_response.method;
                if !pending_response.is_response_pending {
                    // Aborted
                    continue;
                }
                pending_response.is_response_pending = false;
                // Body needs bun_uws::AnyResponse::{clear_aborted, write_status,
                // end_without_body} and StaticRoute::{on_head, on}.
                todo!("blocked_on: bun_uws::AnyResponse::clear_aborted");
                // pending_response (Box) drops here → PendingResponse::drop runs.
            }
        }
    }

    impl Drop for PendingResponse {
        fn drop(&mut self) {
            if self.is_response_pending {
                // Body needs bun_uws::AnyResponse::{clear_aborted, clear_on_writable,
                // end_without_body}.
                todo!("blocked_on: bun_uws::AnyResponse::clear_aborted");
            }
            // SAFETY: `route` was a live IntrusiveRc-managed Route when stored;
            // matches the `ref()` taken when this PendingResponse was created.
            unsafe { RefCount::<Route>::deref(self.route as *mut Route) };
            // `bun.destroy(this)` handled by Box::from_raw caller.
        }
    }

    impl PendingResponse {
        pub fn on_aborted(this: *mut PendingResponse, _resp: AnyResponse) {
            // SAFETY: `this` was registered with resp.on_aborted from a live Box::into_raw allocation.
            let this = unsafe { &mut *this };
            debug_assert!(this.is_response_pending == true);
            this.is_response_pending = false;

            // Technically, this could be the final ref count, but we don't want to risk it
            let route_ptr = this.route as *mut Route;
            // SAFETY: this.route is a valid IntrusiveRc-managed allocation.
            unsafe { RefCount::<Route>::ref_(route_ptr) };
            let _keep_route =
                scopeguard::guard(route_ptr, |p| unsafe { RefCount::<Route>::deref(p) });

            // PORT NOTE: reshaped for borrowck — Zig accessed this.route.pending_responses through
            // raw ptr; mutate via raw ptr (single-threaded).
            // SAFETY: single-threaded; Route is alive (we hold a ref); no other &mut alias active.
            let route = unsafe { &mut *route_ptr };
            while let Some(index) = route
                .pending_responses
                .iter()
                .position(|&p| p == this as *mut PendingResponse)
            {
                route.pending_responses.remove(index);
                // SAFETY: matches the ref taken when this entry was pushed in on_any_request.
                unsafe { RefCount::<Route>::deref(route_ptr) };
            }
        }
    }
} // mod _gated

/// Represents an in-flight response before the bundle has finished building.
pub struct PendingResponse {
    method: Method,
    resp: AnyResponse,
    is_response_pending: bool,
    server: Option<AnyServer>,
    // PORT NOTE: LIFETIMES.tsv says SHARED→Rc<Route>, but *Route crosses FFI
    // (uws callbacks, JSBundleCompletionTask backref) — §Pointers FFI rule →
    // RefPtr. Raw ptr because the route owns the Vec containing this
    // PendingResponse; an `IntrusiveRc<Route>` field would form a cycle through
    // `Drop`. The ref is bumped/dropped manually via `RefCount::<Route>` calls.
    route: *const Route,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/HTMLBundle.zig (539 lines)
//   confidence: medium
//   todos:      9
//   notes:      Route/PendingResponse now use IntrusiveRc (overrides LIFETIMES.tsv Arc — *Route crosses FFI). State.html still Rc<StaticRoute>; Phase B reconcile with StaticRoute's intrusive RefCount.
// ──────────────────────────────────────────────────────────────────────────
