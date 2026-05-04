//! This object is a description of an HTML bundle. It is created by importing an
//! HTML file, and can be passed to the `static` option in `Bun.serve`. The build
//! is done lazily (state held in HTMLBundle.Route or DevServer.RouteBundle.HTML).

use core::cell::Cell;
use core::mem;

use bun_alloc::AllocError;
use bun_bake::dev_server::route_bundle;
use bun_bundler::bundle_v2::JSBundleCompletionTask;
use bun_core::{self, Output, fmt as bun_fmt};
use bun_http::Method;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_logger::Log;
use bun_ptr::IntrusiveRc;
use bun_str;
use bun_uws::{AnyRequest, AnyResponse};
use std::sync::Arc;

use super::StaticRoute;
use crate::api::{AnyServer, JSBundler};

bun_output::declare_scope!(HTMLBundle, hidden);

// .classes.ts codegen wires toJS/fromJS/fromJSDirect via this derive.
// HTMLBundle can be owned by JavaScript as well as any number of Server instances,
// hence the intrusive ref count (IntrusiveRc) alongside the JS wrapper.
#[bun_jsc::JsClass]
pub struct HTMLBundle {
    ref_count: Cell<u32>,
    // TODO(port): JSC_BORROW field on heap struct — verify &'static is sound (global outlives bundle)
    global: &'static JSGlobalObject,
    path: Box<[u8]>,
}

// `pub const ref/deref = RefCount.ref/deref` — provided by IntrusiveRc<HTMLBundle>.

impl HTMLBundle {
    /// Initialize an HTMLBundle given a path.
    pub fn init(global: &'static JSGlobalObject, path: &[u8]) -> IntrusiveRc<HTMLBundle> {
        // Zig `try allocator.dupe` was the only fallible op; Box::from aborts on OOM.
        IntrusiveRc::new(HTMLBundle {
            ref_count: Cell::new(1),
            global,
            path: Box::<[u8]>::from(path),
        })
    }

    /// `.classes.ts` finalize: true — runs on mutator thread during lazy sweep.
    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` is the m_ctx payload of the JS wrapper; valid until this returns.
        unsafe { IntrusiveRc::<HTMLBundle>::deref_raw(this) };
    }

    // Zig `deinit`: only `allocator.free(this.path)` + `bun.destroy(this)`.
    // `path: Box<[u8]>` auto-drops; dealloc handled by IntrusiveRc — no explicit Drop body.

    #[bun_jsc::host_fn(getter)]
    pub fn get_index(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_str::String::create_utf8_for_js(global, &this.path)
    }
}

/// Deprecated: use Route instead.
pub type HTMLBundleRoute = Route;

/// An HTMLBundle can be used across multiple server instances, an
/// HTMLBundle.Route can only be used on one server, but is also
/// reference-counted because a server can have multiple instances of the same
/// html file on multiple endpoints.
pub struct Route {
    bundle: IntrusiveRc<HTMLBundle>,
    /// One HTMLBundle.Route can be specified multiple times
    ref_count: Cell<u32>,
    // TODO: attempt to remove the null case. null is only present during server
    // initialization as only a ServerConfig object is present.
    server: Option<AnyServer>,
    /// When using DevServer, this value is never read or written to.
    state: State,
    /// Written and read by DevServer to identify if this route has been
    /// registered with the bundler.
    dev_server_id: route_bundle::IndexOptional,
    /// When state == .pending, incomplete responses are stored here.
    // Raw `*mut` because the pointer is handed to uws onAborted callback and
    // compared by identity; allocation/free is via Box::into_raw/from_raw.
    pending_responses: Vec<*mut PendingResponse>,

    method: RouteMethod,
}

pub enum RouteMethod {
    Any,
    Method(bun_http::method::Set),
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

    pub fn init(html_bundle: &HTMLBundle) -> IntrusiveRc<Route> {
        IntrusiveRc::new(Route {
            // SAFETY: html_bundle is a valid IntrusiveRc-managed allocation
            bundle: unsafe { IntrusiveRc::retain(html_bundle) },
            pending_responses: Vec::new(),
            ref_count: Cell::new(1),
            server: None,
            state: State::Pending,
            dev_server_id: route_bundle::IndexOptional::NONE,
            method: RouteMethod::Any,
        })
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
    Building(Option<Arc<JSBundleCompletionTask>>),
    Err(Log),
    Html(Arc<StaticRoute>),
}

impl Drop for State {
    fn drop(&mut self) {
        match self {
            State::Err(_log) => {
                // Log drops itself
            }
            State::Building(Some(c)) => {
                // TODO(port): Arc<JSBundleCompletionTask>.cancelled needs interior mutability
                c.cancelled = true;
                // Arc drop handles deref
            }
            State::Building(None) => {}
            State::Html(_html) => {
                // Arc drop handles deref
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
            State::Html(html) => html.memory_cost(),
        }
    }
}

impl Route {
    pub fn on_request(&mut self, req: AnyRequest, resp: AnyResponse) {
        self.on_any_request(req, resp, false);
    }

    pub fn on_head_request(&mut self, req: AnyRequest, resp: AnyResponse) {
        self.on_any_request(req, resp, true);
    }

    fn on_any_request(&mut self, req: AnyRequest, resp: AnyResponse, is_head: bool) {
        // SAFETY: self is a valid IntrusiveRc-managed allocation; keep alive for fn body.
        let _keep_alive = unsafe { IntrusiveRc::<Route>::retain(self) };

        let Some(server) = self.server else {
            resp.end_without_body(true);
            return;
        };

        if server.config().is_development() {
            if let Some(dev) = server.dev_server() {
                // DevServer's HMR path is *uws.Request-typed; H3 isn't routed
                // there (no h3_app on plain-HTTP debug servers in practice),
                // but stay defensive.
                match req {
                    AnyRequest::H1(h1) => {
                        dev.respond_for_html_bundle(self, h1, resp);
                    }
                    AnyRequest::H3(_) => {
                        resp.write_status(b"503 Service Unavailable");
                        resp.end(b"DevServer HMR is HTTP/1.1 only", true);
                    }
                }
                return;
            }

            // Simpler development workflow which rebundles on every request.
            if matches!(self.state, State::Html(_)) {
                self.state = State::Pending;
            } else if matches!(self.state, State::Err(_)) {
                self.state = State::Pending;
            }
        }

        // Zig labeled `state: switch` with `continue :state` — re-dispatches after mutation.
        loop {
            match &self.state {
                State::Pending => {
                    bun_output::scoped_log!(
                        HTMLBundle,
                        "onRequest: {} - pending",
                        bstr::BStr::new(req.url())
                    );
                    // Zig: `bun.handleOom(this.scheduleBundle(server))` — handleOom → expr;
                    // remaining errors are alloc-only and abort in Rust.
                    self.schedule_bundle(server);
                    continue;
                }
                State::Building(_) => {
                    bun_output::scoped_log!(
                        HTMLBundle,
                        "onRequest: {} - building",
                        bstr::BStr::new(req.url())
                    );

                    // create the PendingResponse, add it to the list
                    let Some(method) = Method::which(req.method()) else {
                        resp.write_status(b"405 Method Not Allowed");
                        resp.end_without_body(true);
                        return;
                    };
                    let pending = Box::into_raw(Box::new(PendingResponse {
                        method,
                        resp,
                        is_response_pending: true,
                        server: self.server,
                        // SAFETY: self is IntrusiveRc-managed; retain bumps refcount.
                        route: unsafe { IntrusiveRc::<Route>::retain(self) },
                    }));

                    self.pending_responses.push(pending);
                    // PERF(port): was assume_capacity-free append

                    // Zig: `this.ref()` — the `route` field above already took the ref.
                    // TODO(port): verify ref-count parity; Zig bumps once for pending_responses
                    // entry AND once via PendingResponse.route (line 196 + .route=this).
                    // SAFETY: self is IntrusiveRc-managed
                    unsafe { IntrusiveRc::<Route>::ref_raw(self) };

                    resp.on_aborted(PendingResponse::on_aborted, pending);
                    req.set_yield(false);
                    break;
                }
                State::Err(_log) => {
                    bun_output::scoped_log!(
                        HTMLBundle,
                        "onRequest: {} - err",
                        bstr::BStr::new(req.url())
                    );
                    // TODO: use the code from DevServer.zig to render the error
                    resp.end_without_body(true);
                    break;
                }
                State::Html(html) => {
                    bun_output::scoped_log!(
                        HTMLBundle,
                        "onRequest: {} - html",
                        bstr::BStr::new(req.url())
                    );
                    if is_head {
                        html.on_head_request(req, resp);
                    } else {
                        html.on_request(req, resp);
                    }
                    break;
                }
            }
        }
    }

    /// Schedule a bundle to be built.
    /// If success, bumps the ref count and returns true;
    fn schedule_bundle(&mut self, server: AnyServer) -> Result<(), bun_core::Error> {
        match server.get_or_load_plugins(PluginsTarget::HtmlBundleRoute(self)) {
            PluginsResult::Err => self.state = State::Err(Log::init()),
            PluginsResult::Ready(plugins) => {
                self.on_plugins_resolved(plugins)?;
            }
            PluginsResult::Pending => self.state = State::Building(None),
        }
        Ok(())
    }

    pub fn on_plugins_resolved(
        &mut self,
        plugins: Option<&mut JSBundler::Plugin>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let global = self.bundle.global;
        let server = self.server.expect("server set before bundle");
        let development = server.config().development;
        let vm = global.bun_vm();

        let mut config = JSBundler::Config::default();
        // errdefer config.deinit — Config: Drop handles cleanup on `?`
        config.entry_points.insert(&self.bundle.path)?;
        if let Some(public_path) = vm.transpiler.options.transform_options.serve_public_path.as_ref()
        {
            if !public_path.is_empty() {
                config.public_path.append_slice(public_path)?;
            } else {
                config.public_path.append_char(b'/')?;
            }
        } else {
            config.public_path.append_char(b'/')?;
        }

        if vm.transpiler.options.transform_options.serve_env_behavior != EnvBehavior::None {
            config.env_behavior = vm.transpiler.options.transform_options.serve_env_behavior;

            if config.env_behavior == EnvBehavior::Prefix {
                config.env_prefix.append_slice(
                    vm.transpiler
                        .options
                        .transform_options
                        .serve_env_prefix
                        .as_deref()
                        .unwrap_or(b""),
                )?;
            }
        }

        if vm.transpiler.options.transform_options.serve_splitting {
            config.code_splitting = vm.transpiler.options.transform_options.serve_splitting;
        }

        config.target = Target::Browser;
        let is_development = development.is_development();

        if let Some(minify_identifiers) = bun_cli::Command::get().args.serve_minify_identifiers {
            config.minify.identifiers = minify_identifiers;
        } else if !is_development {
            config.minify.identifiers = true;
        }

        if let Some(minify_whitespace) = bun_cli::Command::get().args.serve_minify_whitespace {
            config.minify.whitespace = minify_whitespace;
        } else if !is_development {
            config.minify.whitespace = true;
        }

        if let Some(minify_syntax) = bun_cli::Command::get().args.serve_minify_syntax {
            config.minify.syntax = minify_syntax;
        } else if !is_development {
            config.minify.syntax = true;
        }

        if let Some(define) = bun_cli::Command::get().args.serve_define.as_ref() {
            debug_assert!(define.keys.len() == define.values.len());
            // TODO(port): ArrayHashMap raw entries surgery — Phase B verify API
            config.define.map.ensure_unused_capacity(define.keys.len())?;
            // SAFETY: capacity reserved above; keys/values slots written below before reIndex.
            unsafe {
                config.define.map.set_len(define.keys.len());
            }
            config
                .define
                .map
                .keys_mut()
                .copy_from_slice(&define.keys);
            debug_assert_eq!(config.define.map.values_mut().len(), define.values.len());
            for (to, from) in config
                .define
                .map
                .values_mut()
                .iter_mut()
                .zip(define.values.iter())
            {
                *to = Box::<[u8]>::from(from.as_ref());
            }
            config.define.map.re_index()?;
        }

        if !is_development {
            config
                .define
                .put(b"process.env.NODE_ENV", b"\"production\"");
            config.jsx.development = false;
        } else {
            config.force_node_env = ForceNodeEnv::Development;
            config.jsx.development = true;
        }
        config.source_map = SourceMapMode::Linked;

        let completion_task = bun_bundler::BundleV2::create_and_schedule_completion_task(
            config,
            plugins,
            global,
            vm.event_loop(),
        )?;
        completion_task.started_at_ns =
            bun_core::get_rough_tick_count(TickCountMode::AllowMockedTime).ns();
        completion_task.html_build_task = self;
        // TODO(port): html_build_task is a backref `*Route` — needs raw ptr field on task
        self.state = State::Building(Some(completion_task));

        // While we're building, ensure this doesn't get freed.
        // SAFETY: self is IntrusiveRc-managed
        unsafe { IntrusiveRc::<Route>::ref_raw(self) };
        Ok(())
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

    pub fn on_complete(&mut self, completion_task: &mut JSBundleCompletionTask) {
        // For the build task.
        // SAFETY: self is IntrusiveRc-managed; matches the ref() in on_plugins_resolved.
        let _drop_build_ref =
            scopeguard::guard((), |_| unsafe { IntrusiveRc::<Route>::deref_raw(self) });

        match &completion_task.result {
            BundleResult::Err(err) => {
                bun_output::scoped_log!(HTMLBundle, "onComplete: err - {}", err.name());
                self.state = State::Err(Log::init());
                if let State::Err(log) = &mut self.state {
                    completion_task.log.clone_to_with_recycled(log, true);
                }

                if let Some(server) = self.server {
                    if server.config().is_development() {
                        // PERF(port): was comptime bool dispatch — profile in Phase B
                        let writer = Output::error_writer_buffered();
                        if Output::enable_ansi_colors_stderr() {
                            if let State::Err(log) = &self.state {
                                let _ = log.print_with_enable_ansi_colors::<true>(writer);
                            }
                        } else {
                            if let State::Err(log) = &self.state {
                                let _ = log.print_with_enable_ansi_colors::<false>(writer);
                            }
                        }
                        let _ = writer.flush();
                    }
                }
            }
            BundleResult::Value(bundle) => {
                bun_output::scoped_log!(HTMLBundle, "onComplete: success");
                // Find the HTML entry point and create static routes
                let Some(server) = self.server else {
                    return;
                };
                let global_this = server.global_this();
                let output_files = bundle.output_files.as_slice();

                if server.config().is_development() {
                    let now = bun_core::get_rough_tick_count(TickCountMode::AllowMockedTime).ns();
                    let duration = now - completion_task.started_at_ns;
                    let mut duration_f64: f64 = duration as f64;
                    duration_f64 /= 1_000_000_000.0; // std.time.ns_per_s

                    Output::print_elapsed(duration_f64);
                    let mut byte_length: u64 = 0;
                    for output_file in output_files {
                        byte_length += output_file.size_without_sourcemap;
                    }

                    Output::pretty_errorln(
                        format_args!(
                            " <green>bundle<r> {} <d>{:.2} KB<r>",
                            bstr::BStr::new(bun_paths::basename(&self.bundle.path)),
                            (byte_length as f64) / 1000.0
                        ),
                    );
                    Output::flush();
                }

                let mut this_html_route: Option<*mut StaticRoute> = None;

                // Create static routes for each output file
                for output_file in output_files {
                    let blob = bun_jsc::webcore::blob::Any::Blob(
                        output_file.to_blob(global_this),
                    );
                    let mut headers = bun_http::Headers::default();
                    let content_type = 'brk: {
                        if let Some(ct) = blob.as_blob().content_type_or_mime_type() {
                            break 'brk ct;
                        }
                        // should be populated by `output_file.toBlob`
                        debug_assert!(false);
                        output_file.loader.to_mime_type(&[]).value
                    };
                    headers.append(b"Content-Type", content_type);
                    // Do not apply etags to html.
                    if output_file.loader != Loader::Html
                        && matches!(output_file.value, OutputFileValue::Buffer(_))
                    {
                        let mut hashbuf = [0u8; 64];
                        let etag_str = {
                            use std::io::Write;
                            let mut cursor = &mut hashbuf[..];
                            write!(
                                &mut cursor,
                                "{}",
                                bun_fmt::hex_int_lower(output_file.hash)
                            )
                            .expect("unreachable"); // NoSpaceLeft is impossible for u64 hex in 64 bytes
                            let written = 64 - cursor.len();
                            &hashbuf[..written]
                        };
                        headers.append(b"ETag", etag_str);
                        if !server.config().is_development()
                            && output_file.output_kind == OutputKind::Chunk
                        {
                            headers.append(b"Cache-Control", b"public, max-age=31536000");
                        }
                    }

                    // Add a SourceMap header if we have a source map index
                    // and it's in development mode.
                    if server.config().is_development() {
                        if output_file.source_map_index != u32::MAX {
                            let mut route_path: &[u8] =
                                &output_files[output_file.source_map_index as usize].dest_path;
                            if route_path.starts_with(b"./") || route_path.starts_with(b".\\") {
                                route_path = &route_path[1..];
                            }
                            headers.append(b"SourceMap", route_path);
                        }
                    }

                    // TODO(port): StaticRoute is intrusively ref-counted in Zig; LIFETIMES.tsv
                    // maps `state.html` to Arc<StaticRoute>. Phase B: reconcile.
                    // PORT NOTE: reshaped for borrowck — read size before moving blob.
                    let cached_blob_size = blob.size();
                    let static_route = Box::into_raw(Box::new(StaticRoute {
                        ref_count: Cell::new(1),
                        blob,
                        server: Some(server),
                        status_code: 200,
                        headers,
                        cached_blob_size,
                        ..Default::default()
                    }));

                    if this_html_route.is_none()
                        && output_file.output_kind == OutputKind::EntryPoint
                    {
                        if output_file.loader == Loader::Html {
                            this_html_route = Some(static_route);
                        }
                    }

                    let mut route_path: &[u8] = &output_file.dest_path;

                    // The route path gets cloned inside of appendStaticRoute.
                    if route_path.starts_with(b"./") || route_path.starts_with(b".\\") {
                        route_path = &route_path[1..];
                    }

                    server.append_static_route(
                        route_path,
                        AnyRoute::Static(static_route),
                        MethodFilter::Any,
                    );
                }

                let html_route = this_html_route.unwrap_or_else(|| {
                    panic!("Internal assertion failure: HTML entry point not found in HTMLBundle.")
                });
                // SAFETY: html_route was just allocated above and is a valid StaticRoute
                let html_route_clone = unsafe { (*html_route).clone(global_this) };
                self.state = State::Html(html_route_clone);

                if !server.reload_static_routes() {
                    // Server has shutdown, so it won't receive any new requests
                    // TODO: handle this case
                }
            }
            BundleResult::Pending => unreachable!(),
        }

        // Handle pending responses
        self.resume_pending_responses();
    }

    pub fn resume_pending_responses(&mut self) {
        let pending = mem::take(&mut self.pending_responses);
        for pending_response_ptr in pending {
            // SAFETY: every entry was created via Box::into_raw in on_any_request and
            // is removed exactly once (here, or via on_aborted which removes without freeing).
            let mut pending_response = unsafe { Box::from_raw(pending_response_ptr) };

            let resp = pending_response.resp;
            let method = pending_response.method;
            if !pending_response.is_response_pending {
                // Aborted
                continue;
            }
            pending_response.is_response_pending = false;
            resp.clear_aborted();

            match &self.state {
                State::Html(html) => {
                    if method == Method::HEAD {
                        html.on_head(resp);
                    } else {
                        html.on(resp);
                    }
                }
                State::Err(_log) => {
                    if self.server.expect("server set").config().is_development() {
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
            // pending_response (Box) drops here → PendingResponse::drop runs.
        }
    }
}

/// Represents an in-flight response before the bundle has finished building.
pub struct PendingResponse {
    method: Method,
    resp: AnyResponse,
    is_response_pending: bool,
    server: Option<AnyServer>,
    // PORT NOTE: LIFETIMES.tsv says SHARED→Arc<Route>, but Route is intrusively ref-counted
    // (RefCount mixin) and *Route crosses FFI (uws callbacks, JSBundleCompletionTask backref).
    // Intrusive-refcount + FFI rule overrides → IntrusiveRc.
    route: IntrusiveRc<Route>,
}

impl Drop for PendingResponse {
    fn drop(&mut self) {
        if self.is_response_pending {
            self.resp.clear_aborted();
            self.resp.clear_on_writable();
            self.resp.end_without_body(true);
        }
        // `self.route` (IntrusiveRc) drop handles deref.
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
        // SAFETY: this.route is a valid IntrusiveRc-managed allocation.
        let _keep_route = unsafe { IntrusiveRc::<Route>::retain(&*this.route) };

        // PORT NOTE: reshaped for borrowck — Zig accessed this.route.pending_responses through
        // raw ptr; IntrusiveRc derefs to &Route, so mutate via raw ptr (single-threaded).
        let route_ptr = IntrusiveRc::as_ptr(&this.route);
        // SAFETY: single-threaded; Route is alive (we hold a ref); no other &mut alias active.
        let route = unsafe { &mut *route_ptr };
        while let Some(index) = route
            .pending_responses
            .iter()
            .position(|&p| p == this as *mut PendingResponse)
        {
            route.pending_responses.remove(index);
            // SAFETY: matches the ref taken when this entry was pushed in on_any_request.
            unsafe { IntrusiveRc::<Route>::deref_raw(route) };
        }
    }
}

// TODO(port): these enum/type stubs reference cross-crate types whose exact paths
// Phase B will resolve. Kept local to make control flow readable.
use bun_bundler::options::{Loader, Target};
use bun_bundler::output_file::{OutputFileValue, OutputKind};
use bun_runtime::api::server::{AnyRoute, MethodFilter, PluginsResult, PluginsTarget};
use bun_runtime::api::{EnvBehavior, ForceNodeEnv, SourceMapMode, TickCountMode};
type BundleResult = bun_bundler::bundle_v2::CompletionResult;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/HTMLBundle.zig (539 lines)
//   confidence: medium
//   todos:      9
//   notes:      Route/PendingResponse now use IntrusiveRc (overrides LIFETIMES.tsv Arc — *Route crosses FFI). State.html still Arc<StaticRoute>; Phase B reconcile with StaticRoute's intrusive RefCount.
// ──────────────────────────────────────────────────────────────────────────
