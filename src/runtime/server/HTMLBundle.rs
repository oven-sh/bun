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
use bun_core::strings;
use bun_http::Headers;
use bun_http_types::Method::Method;
use bun_jsc::JsCell;
use bun_jsc::bun_string_jsc;
use bun_ptr::{RefCount, RefPtr, ThisPtr};
use bun_uws::{AnyRequest, AnyResponse};

use crate::api::js_bundle_completion_task::JSBundleCompletionTask;
use crate::api::js_bundler::js_bundler::{self as JSBundler, Config as JSBundlerConfig};
use crate::api::output_file_jsc::OutputFileJsc as _;
use crate::bake::dev_server::route_bundle;
use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::server::server_config::MethodOptional;
use crate::server::{AnyRoute, AnyServer, GetOrStartLoadResult, ServePluginsCallback, StaticRoute};
use crate::webcore::AnyBlob;

// Scoped debug logger — wrapped in a sub-module so the
// `pub static HTMLBundle` doesn't leak alongside the `pub struct HTMLBundle`
// re-export from `crate::server`.
mod debug_scope {
    bun_output::declare_scope!(HTMLBundle, hidden);
}
use debug_scope::HTMLBundle as debug;

// .classes.ts codegen wires toJS/fromJS/fromJSDirect via #[bun_jsc::JsClass].
// HTMLBundle can be owned by JavaScript as well as any number of Server instances,
// hence the ref count alongside the JS wrapper.
#[derive(bun_ptr::RefCounted)]
#[ref_count(debug_name = "HTMLBundle")]
pub struct HTMLBundle {
    ref_count: RefCount<HTMLBundle>,
    pub global: bun_ptr::BackRef<JSGlobalObject>,
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
            // HTMLBundle is *only* constructed via `init()` → `RefPtr::new`
            // (heap-boxed, intrusive-refcounted) and wrapped via the inherent
            // `HTMLBundle::to_js(RefPtr<Self>, …)` below, which
            // wraps the *existing* `*HTMLBundle` allocation; re-boxing a
            // by-value `self` here would split the allocation from its refcount
            // and make `finalize`'s `deref` target the wrong heap block. No
            // code path holds an owned by-value `HTMLBundle`, so this trait
            // method is genuinely unreachable.
            unreachable!("HTMLBundle::to_js: use the inherent RefPtr<Self> overload")
        }
        // `noConstructor: true` — no `HTMLBundle__getConstructor` export; trait default applies.
    }

    impl HTMLBundle {
        /// `jsc.Codegen.JSHTMLBundle.toJS` — the JS wrapper takes over `this`'
        /// ref (released in `finalize`).
        pub fn to_js(this: RefPtr<HTMLBundle>, global: &JSGlobalObject) -> JSValue {
            __create(global.as_mut_ptr(), this.into_raw())
        }
    }
};

impl HTMLBundle {
    /// Initialize an HTMLBundle given a path.
    pub(crate) fn init(global: &JSGlobalObject, path: &[u8]) -> RefPtr<HTMLBundle> {
        RefPtr::new(HTMLBundle {
            ref_count: RefCount::init(),
            global: bun_ptr::BackRef::new(global),
            path: Box::<[u8]>::from(path),
        })
    }

    pub(crate) fn get_index(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::create_utf8_for_js(global, &this.path)
    }

    /// For `Route::on_complete` and the dev server's `finalize_bundle`, when a build has no page for the file.
    pub(crate) fn no_html_page_log(&self) -> Log {
        let mut log = Log::init();
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "Bundling {} did not produce an html page for it. A plugin may have resolved it to another file or loaded it as something other than html.",
                bun_core::fmt::quote(&self.path)
            ),
        );
        log
    }
}

/// Deprecated: use Route instead.
pub(crate) type HTMLBundleRoute = Route;

/// An HTMLBundle can be used across multiple server instances, an
/// HTMLBundle.Route can only be used on one server, but is also
/// reference-counted because a server can have multiple instances of the same
/// html file on multiple endpoints.
// R-2 (host-fn re-entrancy): every uws/event-loop-reachable method takes
// `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell`
// (non-Copy). A `Route` is re-entered from uws callbacks and the
// `JSBundleCompletionTask` while a prior `&Route` may still be on the
// stack — `&mut self` would alias (UB); `&self` + `UnsafeCell` is sound.
#[derive(bun_ptr::RefCounted)]
#[ref_count(debug_name = "HTMLBundleRoute")]
pub struct Route {
    pub(crate) bundle: RefPtr<HTMLBundle>,
    /// One HTMLBundle.Route can be specified multiple times
    ref_count: RefCount<Route>,
    // TODO: attempt to remove the null case. null is only present during server
    // initialization as only a ServerConfig object is present.
    pub(crate) server: Cell<Option<AnyServer>>,
    /// When using DevServer, this value is never read or written to.
    pub(crate) state: JsCell<State>,
    /// Written and read by DevServer to identify if this route has been
    /// registered with the bundler.
    pub(crate) dev_server_id: Cell<Option<route_bundle::Index>>,
    /// When state == .pending, incomplete responses are stored here.
    pending_responses: JsCell<Vec<PendingResponse>>,
}

pub enum State {
    Pending,
    /// The server's plugins are loading, or the `JSBundleCompletionTask` (which
    /// holds a ref on this route until it delivers the result) is running. In
    /// either case the route holds a pending request on `Route::server`
    /// (`schedule_bundle`).
    Building,
    Err(Log),
    Html(RefPtr<StaticRoute>),
}

impl State {
    fn memory_cost(&self) -> usize {
        match self {
            State::Pending => 0,
            State::Building => 0,
            State::Err(log) => log.memory_cost(),
            State::Html(html) => html.memory_cost(),
        }
    }
}

impl Route {
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += mem::size_of::<Route>();
        cost += self.pending_responses.get().len() * mem::size_of::<PendingResponse>();
        cost += self.state.get().memory_cost();
        cost
    }

    /// Takes its own ref on `html_bundle`.
    pub(crate) fn init(html_bundle: ThisPtr<HTMLBundle>) -> RefPtr<Route> {
        RefPtr::new(Route {
            bundle: RefPtr::from_this(html_bundle),
            pending_responses: JsCell::new(Vec::new()),
            ref_count: RefCount::init(),
            server: Cell::new(None),
            state: JsCell::new(State::Pending),
            dev_server_id: Cell::new(None),
        })
    }

    pub(crate) fn on_request(this: ThisPtr<Self>, req: AnyRequest, resp: AnyResponse) {
        Self::on_any_request(this, req, resp, false);
    }

    pub(crate) fn on_head_request(this: ThisPtr<Self>, req: AnyRequest, resp: AnyResponse) {
        Self::on_any_request(this, req, resp, true);
    }

    fn on_any_request(this: ThisPtr<Self>, mut req: AnyRequest, resp: AnyResponse, is_head: bool) {
        let _guard = RefPtr::from_this(this);
        let route: &Route = &this;

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
            if matches!(route.state.get(), State::Html(_) | State::Err(_)) {
                route.state.set(State::Pending);
            }
        }

        // One re-dispatch
        // after `Pending` schedules the bundle.
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
                    bun_core::handle_oom(Self::schedule_bundle(this, server));
                    continue;
                }
                State::Building => {
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
                    let pending = PendingResponse {
                        method,
                        resp,
                        _route: RefPtr::from_this(this),
                        is_response_pending: Cell::new(true),
                    };
                    route.pending_responses.with_mut(|v| v.push(pending));
                    resp.on_aborted_this(Self::on_pending_response_aborted, this);
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
                    // TODO: use the code from DevServer.rs to render the error
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
                        StaticRoute::on_head_request(html.this_ptr(), req, resp);
                    } else {
                        StaticRoute::on_request(html.this_ptr(), req, resp);
                    }
                }
            }
            break;
        }
    }

    /// Schedule a bundle to be built.
    ///
    /// Entering `State::Building` counts as a pending request on the server:
    /// the plugin load and the build finish on later event-loop turns and call
    /// back into it (`on_plugins_resolved`, `on_complete`), so its
    /// `deinit_if_we_can` must not free it before then. Nothing else holds it
    /// on the route's behalf; the clients waiting in `pending_responses` only
    /// count as connections and can disconnect at any time. `finish_building`
    /// releases the pending request when the route leaves `State::Building`.
    fn schedule_bundle(this: ThisPtr<Self>, mut server: AnyServer) -> Result<(), crate::Error> {
        match server.get_or_load_plugins(ServePluginsCallback::HtmlBundleRoute(this)) {
            GetOrStartLoadResult::Err => {
                this.state.set(State::Err(Log::init()));
            }
            GetOrStartLoadResult::Ready(plugins) => {
                let plugins = plugins.map(NonNull::from);
                server.on_pending_request();
                Self::on_plugins_resolved(this, plugins)?;
            }
            GetOrStartLoadResult::Pending => {
                server.on_pending_request();
                this.state.set(State::Building);
            }
        }
        Ok(())
    }

    /// Leaves `State::Building`: answers the requests that arrived while the
    /// route was building, then releases the pending request `schedule_bundle`
    /// took on the server. The release comes last because it runs the server's
    /// idle pass (`deinit_if_we_can`), which schedules the server's deinit when
    /// this build was the only thing still keeping a stopped server alive.
    fn finish_building(&self) {
        debug_assert!(matches!(self.state.get(), State::Err(_) | State::Html(_)));
        self.resume_pending_responses();
        self.server.get().expect("server set").on_request_complete();
    }

    /// Production keeps the reason to itself, see `resume_pending_responses`.
    fn set_build_error(&self, server: AnyServer, log: Log) {
        if server.config().is_development() {
            // `Log::print` takes the process-global writer as a `*mut io::Writer` through `IntoLogWrite`.
            let writer: *mut bun_core::io::Writer = bun_output::error_writer_buffered();
            let _ = log.print(writer);
            bun_output::flush();
        }
        self.state.set(State::Err(log));
    }

    pub(crate) fn on_plugins_resolved(
        this: ThisPtr<Self>,
        plugins: Option<NonNull<JSBundler::Plugin>>,
    ) -> Result<(), crate::Error> {
        let global = this.bundle.global.get();
        let server = this.server.get().expect("server set");
        let development = server.config().development;
        let vm = global.bun_vm().as_mut();

        let mut config = JSBundlerConfig::default();
        // `Config` owns its fields and
        // drops on early-return.
        config.entry_points.insert(&this.bundle.path)?;
        // An import attribute or a bunfig `[loader]` entry may have made this html. `ext` is `""` without one.
        config.loaders = Some(bun_options_types::schema::api::LoaderMap {
            extensions: vec![Box::from(
                bun_paths::fs::PathName::init(&this.bundle.path).ext,
            )],
            loaders: vec![bun_options_types::schema::api::Loader::html],
        });
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

        // Mirrors `bake::add_import_meta_defines` (the HMR dev server's key
        // list; keep the two in sync) so `import.meta.env.*` folds to constants
        // instead of reaching the browser as a property access that throws.
        let (dev_bool, prod_bool, mode_str): (&[u8], &[u8], &[u8]) = if is_development {
            (b"true", b"false", b"\"development\"")
        } else {
            (b"false", b"true", b"\"production\"")
        };
        config.define.put(b"import.meta.env.DEV", dev_bool)?;
        config.define.put(b"import.meta.env.PROD", prod_bool)?;
        config.define.put(b"import.meta.env.MODE", mode_str)?;
        config.define.put(b"import.meta.env.SSR", b"false")?;
        config.define.put(b"import.meta.env.STATIC", b"false")?;

        // `serve_define` is applied last so it wins on a conflicting key.
        for define in [&cli.args.define, &cli.args.serve_define]
            .into_iter()
            .flatten()
        {
            debug_assert_eq!(define.keys.len(), define.values.len());
            // `StringMap` exposes only put/insert (no bulk re-index);
            // profile if hot.
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
        // Production defaults to no sourcemaps so original sources are not served publicly.
        config.source_map = if let Some(mode) = cli.args.serve_sourcemap {
            bundler_options::SourceMapOption::from_api(Some(mode))
        } else if is_development {
            bundler_options::SourceMapOption::Linked
        } else {
            bundler_options::SourceMapOption::None
        };

        let mut completion_task = JSBundleCompletionTask::new(config, plugins, global);
        completion_task.started_at_ns = bun_core::util::Timespec::now_allow_mocked_time().ns();
        // While we're building, ensure this doesn't get freed.
        completion_task.html_build_task = Some(RefPtr::from_this(this));
        this.state.set(State::Building);
        completion_task.schedule();
        Ok(())
    }

    pub(crate) fn on_plugins_rejected(&self) -> Result<(), crate::Error> {
        bun_output::scoped_log!(
            debug,
            "HTMLBundleRoute(0x{:x}) plugins rejected",
            std::ptr::from_ref(self) as usize
        );
        self.state.set(State::Err(Log::init()));
        self.finish_building();
        Ok(())
    }

    /// Called by the build task, which holds a ref on this route across the call.
    pub(crate) fn on_complete(&self, completion_task: &mut JSBundleCompletionTask) {
        // Still allocated, even if it has been stopped and its JS wrapper
        // collected since: the route holds a pending request on it until
        // `finish_building` (see `schedule_bundle`).
        let server = self.server.get().expect("server set");

        match &mut completion_task.result {
            BundleV2Result::Err(err) => {
                if bun_core::Environment::ENABLE_LOGS {
                    bun_output::scoped_log!(debug, "onComplete: err - {}", err);
                }
                let mut log = Log::init();
                completion_task.log.clone_to_with_recycled(&mut log, true);
                self.set_build_error(server, log);
            }
            BundleV2Result::Value(bundle) => 'bundle: {
                if bun_core::Environment::ENABLE_LOGS {
                    bun_output::scoped_log!(debug, "onComplete: success");
                }
                // Find the HTML entry point and create static routes
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

                // A plugin can resolve or load the entry point as something other than html.
                let Some(html_index) = output_files.iter().position(|output_file| {
                    output_file.output_kind == bundler_options::OutputKind::EntryPoint
                        && output_file.loader == Loader::Html
                }) else {
                    self.set_build_error(server, self.bundle.no_html_page_log());
                    break 'bundle;
                };

                // The HTML entry point is registered after the loop: `clone()`
                // needs it by `&mut` before it is shared. Static routes are keyed
                // by `dest_path`, so registration order is immaterial.
                let mut this_html_route: Option<(StaticRoute, Box<[u8]>)> = None;

                // Create static routes for each output file
                // Index loop because the SourceMap branch reads a sibling entry.
                for i in 0..output_files.len() {
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
                    let is_html = output_files[i].loader == Loader::Html;
                    // Source maps don't carry a precomputed chunk hash; hash
                    // their bytes so every served file gets a unique ETag.
                    let hash = match output_files[i].hash.value {
                        0 => bun_core::hash::xxhash64(0, blob.slice()),
                        h => h,
                    };
                    let mut hashbuf: bun_http_types::ETag::FormatBuffer = [0; 40];
                    headers.append(b"ETag", bun_http_types::ETag::format(hash, &mut hashbuf));
                    if !server.config().is_development() {
                        // Non-HTML outputs are served at content-hashed paths, so they
                        // can be cached forever. HTML must be revalidated each request.
                        headers.append(
                            b"Cache-Control",
                            if is_html {
                                b"no-cache"
                            } else {
                                b"public, max-age=31536000, immutable"
                            },
                        );
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

                    let static_route = StaticRoute::new(blob, headers, Some(server), 200);

                    let mut route_path: &[u8] = &output_files[i].dest_path;
                    // The route path gets cloned inside of appendStaticRoute.
                    if strings::has_prefix(route_path, b"./")
                        || strings::has_prefix(route_path, b".\\")
                    {
                        route_path = &route_path[1..];
                    }

                    if i == html_index {
                        this_html_route = Some((static_route, Box::<[u8]>::from(route_path)));
                        continue;
                    }

                    bun_core::handle_oom(server.append_static_route(
                        route_path,
                        AnyRoute::Static(RefPtr::new(static_route)),
                        MethodOptional::Any,
                    ));
                }

                let (mut html_route, html_route_path) =
                    this_html_route.expect("the loop above visited html_index");
                let html_route_clone = html_route.clone(global_this);
                bun_core::handle_oom(server.append_static_route(
                    &html_route_path,
                    AnyRoute::Static(RefPtr::new(html_route)),
                    MethodOptional::Any,
                ));
                self.state.set(State::Html(html_route_clone));

                if !bun_core::handle_oom(server.reload_static_routes()) {
                    // Server has shutdown, so it won't receive any new requests
                    // TODO: handle this case
                }
            }
            BundleV2Result::Pending => unreachable!(),
        }

        self.finish_building();
    }

    fn resume_pending_responses(&self) {
        // R-2: `JsCell::replace` moves the Vec out so the per-response loop
        // (which writes responses and may run uws callbacks) holds no borrow
        // into `self.pending_responses`.
        let pending = self.pending_responses.replace(Vec::new());
        for pending_response in pending {
            let resp = pending_response.resp;
            let method = pending_response.method;
            if !pending_response.is_response_pending.get() {
                // Aborted
                continue;
            }
            pending_response.is_response_pending.set(false);
            resp.clear_aborted();

            match self.state.get() {
                State::Html(html) => {
                    if method == Method::HEAD {
                        StaticRoute::on_head(html.this_ptr(), resp);
                    } else {
                        StaticRoute::on(html.this_ptr(), resp);
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
                        // TODO: use the code from DevServer.rs to render the error
                    } else {
                        // To protect privacy, do not show errors to end users in production.
                        // TODO: Show a generic error page.
                    }
                    // This runs from a JS event-loop task, not a uWS handler,
                    // so `end_without_body(true)` alone cannot close the
                    // socket; write Content-Length so the client has framing.
                    resp.write_status(b"500 Build Failed");
                    resp.write_header_int(b"Content-Length", 0);
                    resp.end_without_body(true);
                }
                _ => {
                    resp.write_header_int(b"Content-Length", 0);
                    resp.end_without_body(true);
                }
            }
        }
    }
}

impl Drop for Route {
    fn drop(&mut self) {
        // pending responses keep a ref to the route
        debug_assert!(self.pending_responses.get().is_empty());
    }
}

/// Represents an in-flight response before the bundle has finished building.
pub struct PendingResponse {
    method: Method,
    resp: AnyResponse,
    is_response_pending: Cell<bool>,
    /// Keeps the route alive while this response waits on it.
    _route: RefPtr<Route>,
}

impl Drop for PendingResponse {
    fn drop(&mut self) {
        if self.is_response_pending.get() {
            self.resp.clear_aborted();
            self.resp.clear_on_writable();
            self.resp.end_without_body(true);
        }
    }
}

impl Route {
    /// uws onAborted for a response waiting in `pending_responses`.
    fn on_pending_response_aborted(this: ThisPtr<Self>, resp: AnyResponse) {
        // Technically, this could be the final ref count, but we don't want to risk it
        let _guard = RefPtr::from_this(this);

        // R-2: scope the `&mut Vec` to the find+remove only — dropping the
        // removed entry releases a route ref and must not overlap a live
        // `with_mut` borrow.
        let removed = this.pending_responses.with_mut(|v| {
            v.iter()
                .position(|p| p.resp == resp)
                .map(|index| v.remove(index))
        });
        if let Some(pending_response) = removed {
            debug_assert!(pending_response.is_response_pending.get());
            pending_response.is_response_pending.set(false);
            drop(pending_response);
        }
    }
}
