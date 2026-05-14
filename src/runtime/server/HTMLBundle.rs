//! This object is a description of an HTML bundle. It is created by importing an
//! HTML file, and can be passed to the `static` option in `Bun.serve`. The build
//! is done lazily (state held in HTMLBundle.Route or DevServer.RouteBundle.HTML).

use core::cell::Cell;
use core::mem;
use core::ptr::NonNull;

use bun_ast::Loader;
use bun_ast::Log;
use bun_bundler::bundle_v2::BundleV2Result;
use bun_bundler::options::{self as bundler_options, LoaderExt as _};
use bun_bundler::output_file::Value as OutputFileValue;
use bun_core::strings;
use bun_http::Headers;
use bun_http_types::Method::Method;
use bun_jsc::JsCell;
use bun_ptr::{AsCtxPtr, IntrusiveRc, RefCount, RefCounted};
use bun_uws::{AnyRequest, AnyResponse};

use crate::api::js_bundle_completion_task::{
    JSBundleCompletionTask, create_and_schedule_completion_task,
};
use crate::api::js_bundler::js_bundler::{self as JSBundler, Config as JSBundlerConfig};
use crate::api::output_file_jsc::OutputFileJsc as _;
use crate::bake::dev_server::route_bundle;
use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::server::server_config::MethodOptional;
use crate::server::{AnyRoute, AnyServer, GetOrStartLoadResult, ServePluginsCallback, StaticRoute};
use crate::webcore::AnyBlob;

// `bun.Output.scoped(.HTMLBundle, .hidden)` — wrapped in a sub-module so the
// `pub static HTMLBundle` doesn't leak alongside the `pub struct HTMLBundle`
// re-export from `crate::server`.
mod debug_scope {
    bun_output::declare_scope!(HTMLBundle, hidden);
}
use debug_scope::HTMLBundle as debug;

// .classes.ts codegen wires toJS/fromJS/fromJSDirect via #[bun_jsc::JsClass].
// HTMLBundle can be owned by JavaScript as well as any number of Server instances,
// hence the ref count alongside the JS wrapper.
// PORT NOTE (§Pointers): `*mut HTMLBundle` is the m_ctx payload of a
// `.classes.ts` wrapper — FFI rule says intrusive `RefPtr`.
// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
#[derive(bun_ptr::RefCounted)]
#[ref_count(debug_name = "HTMLBundle")]
pub struct HTMLBundle {
    ref_count: RefCount<HTMLBundle>,
    // JSC_BORROW field on heap struct.
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
    // `safe fn` to match `generated_classes.rs` / the `#[bun_jsc::JsClass]`
    // macro (avoids `clashing_extern_declarations`).
    bun_jsc::jsc_abi_extern! {
        #[allow(improper_ctypes)]
        {
            #[link_name = "HTMLBundle__fromJS"]
            safe fn __from_js(value: JSValue) -> *mut HTMLBundle;
            #[link_name = "HTMLBundle__fromJSDirect"]
            safe fn __from_js_direct(value: JSValue) -> *mut HTMLBundle;
            #[link_name = "HTMLBundle__create"]
            safe fn __create(global: *mut JSGlobalObject, ptr: *mut HTMLBundle) -> JSValue;
        }
    }

    impl bun_jsc::JsClass for HTMLBundle {
        fn from_js(value: JSValue) -> Option<*mut Self> {
            let p = __from_js(value);
            if p.is_null() { None } else { Some(p) }
        }
        fn from_js_direct(value: JSValue) -> Option<*mut Self> {
            let p = __from_js_direct(value);
            if p.is_null() { None } else { Some(p) }
        }
        fn to_js(self, _global: &JSGlobalObject) -> JSValue {
            // HTMLBundle is *only* constructed via `init()` → `IntrusiveRc::new`
            // (heap-boxed, intrusive-refcounted) and wrapped via the inherent
            // `HTMLBundle::to_js(*mut Self, …)` below. The Zig codegen `toJS`
            // wraps the *existing* `*HTMLBundle` allocation; re-boxing a
            // by-value `self` here would split the allocation from its refcount
            // and make `finalize`'s `deref` target the wrong heap block. No
            // code path holds an owned by-value `HTMLBundle`, so this trait
            // method is genuinely unreachable.
            unreachable!("HTMLBundle::to_js: use the inherent *mut Self overload")
        }
        // `noConstructor: true` — no `HTMLBundle__getConstructor` export; trait default applies.
    }

    impl HTMLBundle {
        /// `jsc.Codegen.JSHTMLBundle.toJS` — wraps an existing intrusive-
        /// refcounted allocation. The JS wrapper takes one ref (released in
        /// `finalize`), so callers must have already accounted for that ref.
        pub fn to_js(this: *mut HTMLBundle, global: &JSGlobalObject) -> JSValue {
            // `this` is a live `IntrusiveRc::new`-boxed allocation; ownership
            // of one ref transfers to the C++ wrapper (deref'd via
            // `HTMLBundleClass__finalize` → `finalize()`).
            __create(global.as_mut_ptr(), this)
        }
    }
};

impl HTMLBundle {
    /// Initialize an HTMLBundle given a path.
    pub fn init(global: &JSGlobalObject, path: &[u8]) -> IntrusiveRc<HTMLBundle> {
        // Zig `try allocator.dupe` was the only fallible op; Box::from aborts on OOM.
        IntrusiveRc::new(HTMLBundle {
            ref_count: RefCount::init(),
            global,
            path: Box::<[u8]>::from(path),
        })
    }

    /// `.classes.ts` finalize: true — runs on mutator thread during lazy sweep.
    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
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
// R-2 (host-fn re-entrancy): every uws/event-loop-reachable method takes
// `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell`
// (non-Copy). `*mut Route` is recovered from uws userdata and the
// `JSBundleCompletionTask` backref while a prior `&Route` may still be on the
// stack — `&mut self` would alias (UB); `&self` + `UnsafeCell` is sound.
// `bun.ptr.RefCount(Route, "ref_count", Route.deinit, .{ .debug_name = "HTMLBundleRoute" })`
#[derive(bun_ptr::RefCounted)]
#[ref_count(debug_name = "HTMLBundleRoute")]
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
    pub state: JsCell<State>,
    /// Written and read by DevServer to identify if this route has been
    /// registered with the bundler.
    pub dev_server_id: Cell<Option<route_bundle::Index>>,
    /// When state == .pending, incomplete responses are stored here.
    // Raw `*mut` because the pointer is handed to uws onAborted callback and
    // compared by identity; allocation/free is via heap::alloc/from_raw.
    pub pending_responses: JsCell<Vec<*mut PendingResponse>>,

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

pub enum State {
    Pending,
    Building(Option<*mut JSBundleCompletionTask>),
    Err(Log),
    /// Intrusive-refcounted; freed via `StaticRoute::deref_` in `State::deinit`.
    Html(*mut StaticRoute),
}

// PORT NOTE: Zig's `State.deinit` is *only* invoked from `Route.deinit` and the
// dev-mode reset in `onAnyRequest`; ordinary `this.state = ...` overwrites in
// `onComplete`/`onPluginsResolved`/etc. do NOT run it. Mapping it to `impl Drop`
// would fire on every assignment — in particular `on_complete`'s
// `self.state = State::Err/Html` would spuriously cancel and double-deref the
// completion task (whose matching deref is the caller's `defer this.deref()` in
// `JSBundleCompletionTask.onComplete`). So `deinit` stays an explicit method.
impl State {
    pub fn deinit(&mut self) {
        match mem::replace(self, State::Pending) {
            State::Err(_log) => {
                // Log drops itself
            }
            State::Building(Some(c)) => {
                // SAFETY: `c` was produced by `create_and_schedule_completion_task`
                // (heap::alloc, refcount ≥ 1) and we hold one of those refs.
                unsafe {
                    (*c).cancelled = true;
                    RefCount::<JSBundleCompletionTask>::deref(c);
                }
            }
            State::Building(None) => {}
            State::Html(html) => {
                // SAFETY: `html` was produced by `StaticRoute::clone` (heap::alloc,
                // refcount == 1) or via `ref_()`; this drops our ref.
                unsafe { StaticRoute::deref_(html) };
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
            State::Err(log) => log.memory_cost(),
            // SAFETY: `*html` is a live intrusive-refcounted allocation while held.
            State::Html(html) => unsafe { (**html).memory_cost() },
        }
    }
}

impl Route {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += mem::size_of::<Route>();
        cost += self.pending_responses.get().len() * mem::size_of::<PendingResponse>();
        cost += self.state.get().memory_cost();
        cost
    }

    pub fn init(html_bundle: *mut HTMLBundle) -> IntrusiveRc<Route> {
        IntrusiveRc::new(Route {
            // SAFETY: caller passes a live HTMLBundle pointer.
            bundle: unsafe { IntrusiveRc::<HTMLBundle>::init_ref(html_bundle) },
            pending_responses: JsCell::new(Vec::new()),
            ref_count: RefCount::init(),
            server: Cell::new(None),
            state: JsCell::new(State::Pending),
            dev_server_id: Cell::new(None),
            method: RouteMethod::Any,
        })
    }

    pub fn on_request(this: *mut Self, req: AnyRequest, resp: AnyResponse) {
        Self::on_any_request(this, req, resp, false);
    }

    pub fn on_head_request(this: *mut Self, req: AnyRequest, resp: AnyResponse) {
        Self::on_any_request(this, req, resp, true);
    }

    fn on_any_request(this: *mut Self, mut req: AnyRequest, resp: AnyResponse, is_head: bool) {
        // SAFETY: `this` is a live IntrusiveRc-managed allocation; `ScopedRef`
        // bumps the count and derefs on every exit path.
        let _keep_alive = unsafe { bun_ptr::ScopedRef::new(this) };
        // SAFETY: held alive by `_keep_alive`; single-threaded (uws JS-thread
        // callback). R-2: deref as shared (`&*`) — every method below takes
        // `&self`; mutation goes through `Cell`/`JsCell`.
        let route = unsafe { &*this };

        let Some(server) = route.server.get() else {
            resp.end_without_body(true);
            return;
        };

        if server.config().is_development() {
            if let Some(dev) = server.dev_server_mut() {
                // DevServer's HMR path is *uws.Request-typed; H3 isn't routed
                // there (no h3_app on plain-HTTP debug servers in practice),
                // but stay defensive.
                match req {
                    AnyRequest::H1(h1) => {
                        // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
                        // R-2: pass the raw `this` (not `route: &Route`) so
                        // DevServer's `*mut Route` userdata path doesn't alias
                        // a live shared borrow.
                        bun_core::handle_oom(dev.respond_for_html_bundle(
                            this,
                            bun_opaque::opaque_deref_mut(h1),
                            resp,
                        ));
                    }
                    AnyRequest::H3(_) => {
                        resp.write_status(b"503 Service Unavailable");
                        resp.end(b"DevServer HMR is HTTP/1.1 only", true);
                    }
                }
                return;
            }

            // Simpler development workflow which rebundles on every request.
            // R-2: swap the state out *before* running its destructor so no
            // `&mut State` borrow into `route.state` is live across the
            // `StaticRoute::deref_` / `JSBundleCompletionTask::deref` calls.
            if matches!(route.state.get(), State::Html(_) | State::Err(_)) {
                route.state.replace(State::Pending).deinit();
            }
        }

        // Zig `state: switch (this.state) { ... continue :state this.state; }` — one re-dispatch
        // after `.pending` schedules the bundle.
        loop {
            match route.state.get() {
                State::Pending => {
                    if bun_core::Environment::ENABLE_LOGS {
                        bun_output::scoped_log!(
                            debug,
                            "onRequest: {} - pending",
                            bstr::BStr::new(req.url())
                        );
                    }
                    // TODO(dezig-oom): verify route.schedule_bundle is fallible
                    bun_core::handle_oom(route.schedule_bundle(server));
                    continue;
                }
                State::Building(_) => {
                    if bun_core::Environment::ENABLE_LOGS {
                        bun_output::scoped_log!(
                            debug,
                            "onRequest: {} - building",
                            bstr::BStr::new(req.url())
                        );
                    }

                    // create the PendingResponse, add it to the list
                    let Some(method) = Method::which(req.method()) else {
                        resp.write_status(b"405 Method Not Allowed");
                        resp.end_without_body(true);
                        return;
                    };
                    let pending = bun_core::heap::into_raw(Box::new(PendingResponse {
                        method,
                        resp,
                        server: route.server.get(),
                        route: this,
                        is_response_pending: true,
                    }));

                    route.pending_responses.with_mut(|v| v.push(pending));

                    // SAFETY: `this` is a live IntrusiveRc-managed allocation;
                    // matched by the deref in `PendingResponse` drop / on_aborted.
                    unsafe { RefCount::<Route>::ref_(this) };
                    resp.on_aborted(PendingResponse::on_aborted, pending);
                    req.set_yield(false);
                }
                State::Err(_log) => {
                    if bun_core::Environment::ENABLE_LOGS {
                        bun_output::scoped_log!(
                            debug,
                            "onRequest: {} - err",
                            bstr::BStr::new(req.url())
                        );
                    }
                    // TODO: use the code from DevServer.zig to render the error
                    resp.end_without_body(true);
                }
                State::Html(html) => {
                    if bun_core::Environment::ENABLE_LOGS {
                        bun_output::scoped_log!(
                            debug,
                            "onRequest: {} - html",
                            bstr::BStr::new(req.url())
                        );
                    }
                    if is_head {
                        // SAFETY: `*html` is a live intrusive-refcounted allocation.
                        unsafe { StaticRoute::on_head_request(*html, req, resp) };
                    } else {
                        // SAFETY: see above.
                        unsafe { StaticRoute::on_request(*html, req, resp) };
                    }
                }
            }
            break;
        }
    }

    /// Schedule a bundle to be built.
    /// If success, bumps the ref count and returns true;
    fn schedule_bundle(&self, server: AnyServer) -> Result<(), bun_core::Error> {
        match server.get_or_load_plugins(ServePluginsCallback::HtmlBundleRoute(self.as_ctx_ptr())) {
            GetOrStartLoadResult::Err => {
                self.state.set(State::Err(Log::init()));
            }
            GetOrStartLoadResult::Ready(plugins) => {
                self.on_plugins_resolved(plugins.map(NonNull::from))?;
            }
            GetOrStartLoadResult::Pending => {
                self.state.set(State::Building(None));
            }
        }
        Ok(())
    }

    pub fn on_plugins_resolved(
        &self,
        plugins: Option<NonNull<JSBundler::Plugin>>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST — safe `*const → &` deref.
        let global = bun_opaque::opaque_deref(self.bundle.global);
        let server = self.server.get().expect("server set");
        let development = server.config().development;
        // SAFETY: `bun_vm()` returns the live `*mut VirtualMachine` for a Bun-owned
        // global; single-threaded JS thread, no other &mut alias active.
        let vm = global.bun_vm().as_mut();

        let mut config = JSBundlerConfig::default();
        // PORT NOTE: `errdefer config.deinit(allocator)` — `Config` owns its fields and
        // drops on early-return.
        config.entry_points.insert(&self.bundle.path)?;
        let xform = &vm.transpiler.options.transform_options;
        if let Some(public_path) = xform.serve_public_path.as_deref() {
            if !public_path.is_empty() {
                config.public_path.append_slice(public_path)?;
            } else {
                config.public_path.append_char(b'/')?;
            }
        } else {
            config.public_path.append_char(b'/')?;
        }

        if xform.serve_env_behavior != bun_options_types::schema::api::DotEnvBehavior::_none {
            config.env_behavior = xform.serve_env_behavior;
            if config.env_behavior == bun_options_types::schema::api::DotEnvBehavior::Prefix {
                config
                    .env_prefix
                    .append_slice(xform.serve_env_prefix.as_deref().unwrap_or(b""))?;
            }
        }

        if xform.serve_splitting {
            config.code_splitting = xform.serve_splitting;
        }

        config.target = bun_ast::Target::Browser;
        let is_development = development.is_development();

        let cli = crate::cli::Command::get();
        if let Some(minify_identifiers) = cli.args.serve_minify_identifiers {
            config.minify.identifiers = minify_identifiers;
        } else if !is_development {
            config.minify.identifiers = true;
        }

        if let Some(minify_whitespace) = cli.args.serve_minify_whitespace {
            config.minify.whitespace = minify_whitespace;
        } else if !is_development {
            config.minify.whitespace = true;
        }

        if let Some(minify_syntax) = cli.args.serve_minify_syntax {
            config.minify.syntax = minify_syntax;
        } else if !is_development {
            config.minify.syntax = true;
        }

        if let Some(define) = &cli.args.serve_define {
            debug_assert_eq!(define.keys.len(), define.values.len());
            // PORT NOTE: Zig bulk-set `entries.len` + `@memcpy` + `reIndex` against
            // `StringArrayHashMap`; Rust `StringMap` exposes only put/insert. Same
            // result, slightly more hash work.
            // PERF(port): was bulk reIndex — profile in Phase B.
            for (k, v) in define.keys.iter().zip(define.values.iter()) {
                config.define.put(k, v)?;
            }
        }

        if !is_development {
            config
                .define
                .put(b"process.env.NODE_ENV", b"\"production\"")?;
            config.jsx.development = false;
        } else {
            config.force_node_env = bundler_options::ForceNodeEnv::Development;
            config.jsx.development = true;
        }
        config.source_map = bundler_options::SourceMapOption::Linked;

        let completion_task =
            create_and_schedule_completion_task(config, plugins, global, vm.event_loop())?;
        // SAFETY: `completion_task` is the freshly-boxed allocation (refcount==1); sole owner.
        unsafe {
            (*completion_task).started_at_ns =
                bun_core::util::Timespec::now_allow_mocked_time().ns();
            (*completion_task).html_build_task = Some(self.as_ctx_ptr());
        }
        self.state.set(State::Building(Some(completion_task)));

        // While we're building, ensure this doesn't get freed.
        // SAFETY: `self` is a live IntrusiveRc-managed allocation; matched by the
        // deref at the top of `on_complete`. `RefCount` is `Cell`-backed so the
        // `*const → *mut` cast carries sufficient (UnsafeCell) provenance.
        unsafe { RefCount::<Route>::ref_(self.as_ctx_ptr()) };
        Ok(())
    }

    pub fn on_plugins_rejected(&self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_output::scoped_log!(
            debug,
            "HTMLBundleRoute(0x{:x}) plugins rejected",
            std::ptr::from_ref(self) as usize
        );
        self.state.set(State::Err(Log::init()));
        self.resume_pending_responses();
        Ok(())
    }

    pub fn on_complete(&self, completion_task: &mut JSBundleCompletionTask) {
        // For the build task — matches the ref() taken in on_plugins_resolved.
        // SAFETY: self is IntrusiveRc-managed; `adopt` consumes the prior +1 on Drop.
        let _drop_build_ref = unsafe { bun_ptr::ScopedRef::<Route>::adopt(self.as_ctx_ptr()) };

        match &mut completion_task.result {
            BundleV2Result::Err(err) => {
                if bun_core::Environment::ENABLE_LOGS {
                    bun_output::scoped_log!(debug, "onComplete: err - {}", err);
                }
                let mut log = Log::init();
                completion_task.log.clone_to_with_recycled(&mut log, true);
                // PORT NOTE: reshaped for borrowck — Zig wrote
                // `this.state = .{ .err = ... }` then mutated `this.state.err`.
                if let Some(server) = self.server.get() {
                    if server.config().is_development() {
                        // `Output.errorWriterBuffered()` → process-global writer;
                        // `Log::print` accepts it via the `*mut io::Writer`
                        // `IntoLogWrite` adapter and dispatches on
                        // `enable_ansi_colors_stderr` internally.
                        let writer: *mut bun_core::io::Writer = bun_output::error_writer_buffered();
                        let _ = log.print(writer);
                        bun_output::flush();
                    }
                }
                self.state.set(State::Err(log));
            }
            BundleV2Result::Value(bundle) => {
                if bun_core::Environment::ENABLE_LOGS {
                    bun_output::scoped_log!(debug, "onComplete: success");
                }
                // Find the HTML entry point and create static routes
                let Some(server) = self.server.get() else {
                    return;
                };
                // S008: `JSGlobalObject` is an `opaque_ffi!` ZST — safe `*const → &` deref.
                let global_this = bun_opaque::opaque_deref(server.global_this());
                let output_files = &mut bundle.output_files;

                if server.config().is_development() {
                    let now = bun_core::util::Timespec::now_allow_mocked_time().ns();
                    let duration = now.saturating_sub(completion_task.started_at_ns);
                    let duration_f64 = duration as f64 / 1_000_000_000.0;

                    bun_output::print_elapsed(duration_f64);
                    let mut byte_length: u64 = 0;
                    for output_file in output_files.iter() {
                        byte_length += output_file.size_without_sourcemap as u64;
                    }

                    bun_output::pretty_errorln!(
                        " <green>bundle<r> {} <d>{:.2} KB<r>",
                        bstr::BStr::new(bun_paths::basename(&self.bundle.path)),
                        byte_length as f64 / 1000.0
                    );
                    bun_output::flush();
                }

                // PORT NOTE: reshaped for borrowck — Zig appended every route in
                // iteration order then mutably called `html_route.clone()` through
                // a raw ptr aliasing the route table. `AnyRoute::Static` carries
                // an intrusive `*mut StaticRoute` here; defer appending the HTML
                // entry-point until after cloning so we retain the sole owner for
                // the `clone()` mutable borrow. Static routes are keyed by
                // `dest_path`, so registration order is immaterial.
                let mut this_html_route: Option<(core::ptr::NonNull<StaticRoute>, Box<[u8]>)> =
                    None;

                // Create static routes for each output file
                // PORT NOTE: index loop because the SourceMap branch reads a sibling entry.
                for i in 0..output_files.len() {
                    // TODO(dezig-oom): verify OutputFile::to_blob is fallible
                    let blob =
                        AnyBlob::Blob(bun_core::handle_oom(output_files[i].to_blob(global_this)));
                    let mut headers = Headers::default();
                    let fallback_mime;
                    let content_type: &[u8] = match &blob {
                        AnyBlob::Blob(b) => match b.content_type_or_mime_type() {
                            Some(ct) => ct,
                            None => {
                                debug_assert!(false); // should be populated by `output_file.to_blob`
                                fallback_mime = output_files[i].loader.to_mime_type(&[]);
                                &fallback_mime.value
                            }
                        },
                        _ => unreachable!(),
                    };
                    headers.append(b"Content-Type", content_type);
                    // Do not apply etags to html.
                    if output_files[i].loader != Loader::Html
                        && matches!(output_files[i].value, OutputFileValue::Buffer { .. })
                    {
                        let mut hashbuf = [0u8; 64];
                        let n = {
                            use std::io::Write as _;
                            let mut cursor = std::io::Cursor::new(&mut hashbuf[..]);
                            // `bufPrint(&buf, "{f}", .{hexIntLower(hash)}) catch unreachable`
                            write!(
                                cursor,
                                "{}",
                                bun_core::fmt::hex_int_lower::<16>(output_files[i].hash)
                            )
                            .expect("64 bytes fits 16 hex digits");
                            cursor.position() as usize
                        };
                        headers.append(b"ETag", &hashbuf[..n]);
                        if !server.config().is_development()
                            && output_files[i].output_kind == bundler_options::OutputKind::Chunk
                        {
                            headers.append(b"Cache-Control", b"public, max-age=31536000");
                        }
                    }

                    // Add a SourceMap header if we have a source map index
                    // and it's in development mode.
                    if server.config().is_development()
                        && output_files[i].source_map_index != u32::MAX
                    {
                        let mut route_path: &[u8] =
                            &output_files[output_files[i].source_map_index as usize].dest_path;
                        if strings::has_prefix(route_path, b"./")
                            || strings::has_prefix(route_path, b".\\")
                        {
                            route_path = &route_path[1..];
                        }
                        headers.append(b"SourceMap", route_path);
                    }

                    let cached_blob_size = blob.size() as u64;
                    let static_route = bun_core::heap::into_raw_nn(Box::new(StaticRoute {
                        ref_count: Cell::new(1),
                        blob,
                        server: Cell::new(Some(server)),
                        status_code: 200,
                        headers,
                        cached_blob_size,
                        has_content_disposition: false,
                    }));

                    let mut route_path: &[u8] = &output_files[i].dest_path;
                    // The route path gets cloned inside of appendStaticRoute.
                    if strings::has_prefix(route_path, b"./")
                        || strings::has_prefix(route_path, b".\\")
                    {
                        route_path = &route_path[1..];
                    }

                    if this_html_route.is_none()
                        && output_files[i].output_kind == bundler_options::OutputKind::EntryPoint
                        && output_files[i].loader == Loader::Html
                    {
                        // Defer registration so we retain unique ownership for `clone()`.
                        this_html_route = Some((static_route, Box::<[u8]>::from(route_path)));
                        continue;
                    }

                    // TODO(dezig-oom): verify server.append_static_route is fallible
                    bun_core::handle_oom(server.append_static_route(
                        route_path,
                        AnyRoute::Static(static_route),
                        MethodOptional::Any,
                    ));
                }

                let (html_route, html_route_path) = this_html_route.unwrap_or_else(|| {
                    panic!("Internal assertion failure: HTML entry point not found in HTMLBundle.")
                });
                // SAFETY: html_route is a fresh heap::alloc with ref_count=1;
                // sole owner before registration.
                // TODO(dezig-oom): verify StaticRoute::clone is fallible
                let html_route_clone =
                    bun_core::handle_oom(unsafe { &mut *html_route.as_ptr() }.clone(global_this));
                // TODO(dezig-oom): verify server.append_static_route is fallible
                bun_core::handle_oom(server.append_static_route(
                    &html_route_path,
                    AnyRoute::Static(html_route),
                    MethodOptional::Any,
                ));
                self.state.set(State::Html(html_route_clone));

                // TODO(dezig-oom): verify server.reload_static_routes is fallible
                if !bun_core::handle_oom(server.reload_static_routes()) {
                    // Server has shutdown, so it won't receive any new requests
                    // TODO: handle this case
                }
            }
            BundleV2Result::Pending => unreachable!(),
        }

        // Handle pending responses
        self.resume_pending_responses();
    }

    pub fn resume_pending_responses(&self) {
        // R-2: `JsCell::replace` moves the Vec out so the per-response loop
        // (which writes responses and may run uws callbacks) holds no borrow
        // into `self.pending_responses`.
        let pending = self.pending_responses.replace(Vec::new());
        for pending_response_ptr in pending {
            // SAFETY: every entry was created via heap::alloc in on_any_request and
            // is removed exactly once (here, or via on_aborted which removes without freeing).
            let pending_response = unsafe { &mut *pending_response_ptr };
            // `defer pending_response.deinit()` — heap::take + Drop at scope end.
            let _drop = scopeguard::guard(pending_response_ptr, |p| {
                // SAFETY: see above; reconstitutes the Box and runs `Drop`.
                drop(unsafe { bun_core::heap::take(p) });
            });

            let resp = pending_response.resp;
            let method = pending_response.method;
            if !pending_response.is_response_pending {
                // Aborted
                continue;
            }
            pending_response.is_response_pending = false;
            resp.clear_aborted();

            match self.state.get() {
                State::Html(html) => {
                    if method == Method::HEAD {
                        // SAFETY: `*html` is a live intrusive-refcounted allocation.
                        unsafe { StaticRoute::on_head(*html, resp) };
                    } else {
                        // SAFETY: see above.
                        unsafe { StaticRoute::on(*html, resp) };
                    }
                }
                State::Err(_log) => {
                    if self
                        .server
                        .get()
                        .expect("server set")
                        .config()
                        .is_development()
                    {
                        // TODO: use the code from DevServer.zig to render the error
                    } else {
                        // To protect privacy, do not show errors to end users in production.
                        // TODO: Show a generic error page.
                    }
                    resp.write_status(b"500 Build Failed");
                    resp.end_without_body(false);
                }
                _ => {
                    resp.end_without_body(false);
                }
            }
        }
    }
}

impl Drop for Route {
    fn drop(&mut self) {
        // pending responses keep a ref to the route
        debug_assert!(self.pending_responses.get().is_empty());
        // `pending_responses` (Vec) and `bundle` (IntrusiveRc) auto-drop.
        // `state` has no `Drop` glue for the intrusive-pointer variants — release
        // them explicitly (mirrors Zig `Route.deinit` calling `this.state.deinit()`).
        // `with_mut` is fine here — refcount==0 so no other `&Route` exists.
        self.state.with_mut(|s| s.deinit());
        // `bun.destroy(this)` handled by IntrusiveRc dealloc.
    }
}

/// Represents an in-flight response before the bundle has finished building.
pub struct PendingResponse {
    method: Method,
    resp: AnyResponse,
    is_response_pending: bool,
    server: Option<AnyServer>,
    // Raw ptr because the route owns the Vec containing this
    // PendingResponse; an `IntrusiveRc<Route>` field would form a cycle through
    // `Drop`. The ref is bumped/dropped manually via `RefCount::<Route>` calls.
    route: *mut Route,
}

impl Drop for PendingResponse {
    fn drop(&mut self) {
        if self.is_response_pending {
            self.resp.clear_aborted();
            self.resp.clear_on_writable();
            self.resp.end_without_body(true);
        }
        // SAFETY: `route` was a live IntrusiveRc-managed Route when stored;
        // matches the `ref()` taken when this PendingResponse was created.
        unsafe { RefCount::<Route>::deref(self.route) };
        // `bun.destroy(this)` handled by heap::take caller.
    }
}

impl PendingResponse {
    pub fn on_aborted(this: *mut PendingResponse, _resp: AnyResponse) {
        // SAFETY: `this` was registered with resp.on_aborted from a live heap::alloc allocation.
        let this_ref = unsafe { &mut *this };
        debug_assert!(this_ref.is_response_pending);
        this_ref.is_response_pending = false;

        // Technically, this could be the final ref count, but we don't want to risk it
        let route_ptr = this_ref.route;
        // SAFETY: this.route is a valid IntrusiveRc-managed allocation;
        // `ScopedRef` bumps the count and derefs on every exit path.
        let _keep_route = unsafe { bun_ptr::ScopedRef::new(route_ptr) };

        // PORT NOTE: reshaped for borrowck — Zig accessed this.route.pending_responses through
        // raw ptr; mutate via raw ptr (single-threaded).
        // SAFETY: single-threaded; Route is alive (we hold a ref). R-2: deref as
        // shared (`&*`); `pending_responses` is `JsCell`-wrapped.
        let route = unsafe { &*route_ptr };
        // R-2: scope the `&mut Vec` to the find+remove only — `RefCount::deref`
        // can run `Route::drop` (which `get()`s `pending_responses`) and must
        // not overlap a live `with_mut` borrow.
        let removed = route.pending_responses.with_mut(|v| {
            if let Some(index) = v.iter().position(|&p| p == this) {
                v.remove(index);
                true
            } else {
                false
            }
        });
        if removed {
            // SAFETY: matches `heap::into_raw` in on_any_request; Drop releases the route ref taken there.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }
}

// ported from: src/runtime/server/HTMLBundle.zig
