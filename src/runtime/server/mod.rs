//! Port of src/runtime/server/server.zig

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem;
use core::ptr::NonNull;
use std::io::Write as _;
use std::rc::Rc;

use bun_aio::{KeepAlive, Loop as AsyncLoop};
use bun_alloc::AllocError;
use bun_boringssl as boringssl;
use bun_collections::{HashMap, TaggedPtrUnion};
use bun_core::{self as core_, analytics, fmt as bun_fmt, Global, Output};
use bun_http::{self as http, Method, MimeType};
use bun_jsc::{
    self as jsc, host_fn, ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSValue, JsError,
    JsRef, JsResult, Node, Strong, SystemError, VirtualMachine, ZigString,
};
use bun_jsc::WebCore::{self, AbortSignal, Blob, Body, CookieMap, Fetch, FetchHeaders, Request, Response};
use bun_jsc::Debugger::{AsyncTaskTracker, DebuggerId};
use bun_jsc::API::{JSBundler, SocketAddress};
use bun_logger as logger;
use bun_paths as paths;
use bun_ptr::{IntrusiveRc, RefPtr};
use bun_str::{self as bstr, strings, String as BunString, ZStr};
use bun_sys as sys;
use bun_url::URL;
use bun_uws::{self as uws, AnyResponse, AnyWebSocket, Opcode, ResponseKind, WebSocketUpgradeContext};
use bun_bake::{self as bake, DevServer, FrameworkRouter};
use bun_fs::FileSystem;
use bun_runtime::standalone_module_graph::StandaloneModuleGraph;
use bun_uuid::UUID;
use bun_wyhash::hash;
use bstr::BStr;

bun_output::declare_scope!(Server, visible);
bun_output::declare_scope!(RequestContext, visible);

macro_rules! httplog {
    ($($arg:tt)*) => { bun_output::scoped_log!(Server, $($arg)*) };
}
macro_rules! ctx_log {
    ($($arg:tt)*) => { bun_output::scoped_log!(RequestContext, $($arg)*) };
}

// ─── Re-exports ──────────────────────────────────────────────────────────────
pub use super::web_socket_server_context::WebSocketServerContext;
pub use super::http_status_text::HTTPStatusText;
pub use super::html_bundle::{self as html_bundle, HTMLBundle};
// TODO: rename to StaticBlobRoute? the html bundle is sometimes a static route
pub use super::static_route::StaticRoute;
pub use super::file_route::FileRoute;
pub use super::file_response_stream::FileResponseStream;
pub use super::range_request::RangeRequest;
pub use super::server_config::{self as server_config, ServerConfig};
pub use super::server_web_socket::ServerWebSocket;
pub use super::node_http_response::NodeHTTPResponse;
pub use super::any_request_context::AnyRequestContext;
pub use super::request_context::NewRequestContext;

// ─── write_status ────────────────────────────────────────────────────────────
pub fn write_status<const SSL: bool>(resp_ptr: Option<&mut uws::NewApp<SSL>::Response>, status: u16) {
    if let Some(resp) = resp_ptr {
        if let Some(text) = HTTPStatusText::get(status) {
            resp.write_status(text);
        } else {
            let mut status_text_buf = [0u8; 48];
            let mut cursor = &mut status_text_buf[..];
            write!(cursor, "{} HM", status).expect("unreachable");
            let written = 48 - cursor.len();
            resp.write_status(&status_text_buf[..written]);
        }
    }
}

// ─── AnyRoute ────────────────────────────────────────────────────────────────
pub enum AnyRoute {
    /// Serve a static file
    /// "/robots.txt": new Response(...),
    Static(Rc<StaticRoute>),
    /// Serve a file from disk
    File(Rc<FileRoute>),
    /// Bundle an HTML import
    /// import html from "./index.html";
    /// "/": html,
    Html(RefPtr<html_bundle::Route>),
    /// Use file system routing.
    /// "/*": {
    ///   "dir": import.meta.resolve("./pages"),
    ///   "style": "nextjs-pages",
    /// }
    FrameworkRouter(bake::FrameworkRouter::TypeIndex),
}

impl AnyRoute {
    pub fn memory_cost(&self) -> usize {
        match self {
            AnyRoute::Static(static_route) => static_route.memory_cost(),
            AnyRoute::File(file_route) => file_route.memory_cost(),
            AnyRoute::Html(html_bundle_route) => html_bundle_route.data.memory_cost(),
            AnyRoute::FrameworkRouter(_) => mem::size_of::<bake::Framework::FileSystemRouterType>(),
        }
    }

    pub fn set_server(&self, server: Option<AnyServer>) {
        match self {
            AnyRoute::Static(static_route) => static_route.server.set(server),
            AnyRoute::File(file_route) => file_route.server.set(server),
            AnyRoute::Html(html_bundle_route) => html_bundle_route.server.set(server),
            AnyRoute::FrameworkRouter(_) => {} // DevServer contains .server field
        }
    }

    pub fn deref_(&self) {
        // TODO(port): intrusive ref-counting; Rc<> handles Static/File via Drop, but
        // these are intrusive in Zig (StaticRoute.ref/deref). Keep manual calls for now.
        match self {
            AnyRoute::Static(static_route) => static_route.deref(),
            AnyRoute::File(file_route) => file_route.deref(),
            AnyRoute::Html(html_bundle_route) => html_bundle_route.deref(),
            AnyRoute::FrameworkRouter(_) => {} // not reference counted
        }
    }

    pub fn ref_(&self) {
        match self {
            AnyRoute::Static(static_route) => static_route.ref_(),
            AnyRoute::File(file_route) => file_route.ref_(),
            AnyRoute::Html(html_bundle_route) => html_bundle_route.ref_(),
            AnyRoute::FrameworkRouter(_) => {} // not reference counted
        }
    }

    fn bundled_html_manifest_item_from_js(
        argument: JSValue,
        index_path: &[u8],
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if !argument.is_object() {
            return Ok(None);
        }

        let Some(path_js) = argument.get(init_ctx.global, b"path")? else { return Ok(None); };
        let mut path_string = BunString::from_js(path_js, init_ctx.global)?;
        let _path_string_guard = scopeguard::guard((), |_| path_string.deref());
        let mut path = Node::PathOrFileDescriptor::Path(
            Node::PathLike::from_bun_string(init_ctx.global, &mut path_string, false)?,
        );
        // path is dropped at scope end

        // Construct the route by stripping paths above the root.
        //
        //    "./index-abc.js" -> "/index-abc.js"
        //    "../index-abc.js" -> "/index-abc.js"
        //    "/index-abc.js" -> "/index-abc.js"
        //    "index-abc.js" -> "/index-abc.js"
        //
        let path_slice = path.path().slice();
        let cwd: &[u8] = if StandaloneModuleGraph::is_bun_standalone_file_path(path_slice) {
            StandaloneModuleGraph::target_base_public_path(bun_core::Environment::OS, b"root/")
        } else {
            FileSystem::instance().top_level_dir
        };

        let abs_path = FileSystem::instance().abs(&[path_slice]);
        let mut relative_path = FileSystem::instance().relative(cwd, abs_path);

        if relative_path.starts_with(b"./") {
            relative_path = &relative_path[2..];
        } else if relative_path.starts_with(b"../") {
            while relative_path.starts_with(b"../") {
                relative_path = &relative_path[3..];
            }
        }
        let is_index_route = path.path().slice() == index_path;
        let mut builder: Vec<u8> = Vec::new();
        if !relative_path.starts_with(b"/") {
            builder.push(b'/');
        }
        builder.extend_from_slice(relative_path);

        let Some(headers_js) = argument.get(init_ctx.global, b"headers")? else { return Ok(None); };
        let fetch_headers = FetchHeaders::create_from_js(init_ctx.global, headers_js)?;
        let _fh_guard = scopeguard::guard(fetch_headers.as_ref(), |fh| {
            if let Some(h) = fh { h.deref(); }
        });
        if init_ctx.global.has_exception() {
            return Err(JsError::Thrown);
        }

        let route = Self::from_options(init_ctx.global, fetch_headers.as_deref(), &mut path)?;

        if is_index_route {
            return Ok(Some(route));
        }

        let mut methods = http::Method::Optional { method: http::Method::Set::init_empty() };
        methods.insert(Method::GET);
        methods.insert(Method::HEAD);

        init_ctx.user_routes.push(server_config::StaticRouteEntry {
            path: builder.into_boxed_slice(),
            route,
            method: methods,
        });
        Ok(None)
    }

    /// This is the JS representation of an HTMLImportManifest
    ///
    /// See ./src/bundler/HTMLImportManifest.zig
    fn bundled_html_manifest_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if !argument.is_object() {
            return Ok(None);
        }

        let Some(index) = argument.get_optional::<ZigString::Slice>(init_ctx.global, b"index")? else {
            return Ok(None);
        };

        let Some(files) = argument.get_array(init_ctx.global, b"files")? else {
            return Ok(None);
        };
        let mut iter = files.array_iterator(init_ctx.global)?;
        let mut html_route: Option<AnyRoute> = None;
        while let Some(file_entry) = iter.next()? {
            if let Some(item) = Self::bundled_html_manifest_item_from_js(file_entry, index.slice(), init_ctx)? {
                html_route = Some(item);
            }
        }

        Ok(html_route)
    }

    pub fn from_options(
        global: &JSGlobalObject,
        headers: Option<&FetchHeaders>,
        path: &mut Node::PathOrFileDescriptor,
    ) -> JsResult<AnyRoute> {
        // The file/static route doesn't ref it.
        let blob = Blob::find_or_create_file_from_path(path, global, false);

        if blob.needs_to_read_file() {
            // Throw a more helpful error upfront if the file does not exist.
            //
            // In production, you do NOT want to find out that all the assets
            // are 404'ing when the user goes to the route. You want to find
            // that out immediately so that the health check on startup fails
            // and the process exits with a non-zero status code.
            if let Some(store) = blob.store() {
                if let Some(store_path) = store.get_path() {
                    match sys::exists_at_type(sys::Fd::cwd(), store_path) {
                        Ok(file_type) => {
                            if file_type == sys::FileType::Directory {
                                return global.throw_invalid_arguments(
                                    format_args!(
                                        "Bundled file {} cannot be a directory. You may want to configure --asset-naming or `naming` when bundling.",
                                        bun_fmt::quote(store_path)
                                    ),
                                );
                            }
                        }
                        Err(_) => {
                            return global.throw_invalid_arguments(
                                format_args!(
                                    "Bundled file {} not found. You may want to configure --asset-naming or `naming` when bundling.",
                                    bun_fmt::quote(store_path)
                                ),
                            );
                        }
                    }
                }
            }

            return Ok(AnyRoute::File(FileRoute::init_from_blob(
                blob,
                FileRoute::Options { server: None, headers },
            )));
        }

        Ok(AnyRoute::Static(StaticRoute::init_from_any_blob(
            &Blob::Any::Blob(blob),
            StaticRoute::Options { server: None, headers },
        )))
    }

    pub fn html_route_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if let Some(html_bundle) = argument.as_::<HTMLBundle>() {
            let entry = init_ctx.dedupe_html_bundle_map.entry(html_bundle as *const _);
            // PERF(port): was bun.handleOom — Rust HashMap aborts on OOM
            return Ok(Some(match entry {
                bun_collections::Entry::Vacant(v) => {
                    let route = html_bundle::Route::init(html_bundle);
                    v.insert(route.clone());
                    AnyRoute::Html(route)
                }
                bun_collections::Entry::Occupied(o) => AnyRoute::Html(o.get().dupe_ref()),
            }));
        }

        if let Some(html_route) = Self::bundled_html_manifest_from_js(argument, init_ctx)? {
            return Ok(Some(html_route));
        }

        Ok(None)
    }

    pub fn from_js(
        global: &JSGlobalObject,
        path: &[u8],
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if let Some(html_route) = AnyRoute::html_route_from_js(argument, init_ctx)? {
            return Ok(Some(html_route));
        }

        if argument.is_object() {
            if let Some(dir) = argument.get_optional::<BunString::Slice>(global, b"dir")? {
                let alloc = &mut init_ctx.js_string_allocations;
                let relative_root = alloc.track(dir);

                let style: FrameworkRouter::Style = if let Some(style_js) = argument.get(global, b"style")? {
                    FrameworkRouter::Style::from_js(style_js, global)?
                } else {
                    FrameworkRouter::Style::NextjsPages
                };
                let style_guard = scopeguard::guard(style, |mut s| s.deinit());

                if !strings::ends_with(path, b"/*") {
                    return global.throw_invalid_arguments(
                        format_args!("To mount a directory, make sure the path ends in `/*`"),
                    );
                }

                init_ctx.framework_router_list.push(bake::Framework::FileSystemRouterType {
                    root: relative_root,
                    style: scopeguard::ScopeGuard::into_inner(style_guard),
                    // trim the /*
                    prefix: if path.len() == 2 { b"/" } else { &path[0..path.len() - 2] },
                    // TODO: customizable framework option.
                    entry_client: b"bun-framework-react/client.tsx",
                    entry_server: b"bun-framework-react/server.tsx",
                    ignore_underscores: true,
                    ignore_dirs: &[b"node_modules", b".git"],
                    extensions: &[b".tsx", b".jsx"],
                    allow_layouts: true,
                });

                // TODO(port): @typeInfo(FrameworkRouter.Type.Index).@"enum".tag_type — use the index newtype's MAX
                let limit = FrameworkRouter::TypeIndex::MAX as usize;
                if init_ctx.framework_router_list.len() > limit {
                    return global.throw_invalid_arguments(
                        format_args!("Too many framework routers. Maximum is {}.", limit),
                    );
                }
                return Ok(Some(AnyRoute::FrameworkRouter(FrameworkRouter::TypeIndex::init(
                    u32::try_from(init_ctx.framework_router_list.len() - 1).unwrap(),
                ))));
            }
        }

        if let Some(file_route) = FileRoute::from_js(global, argument)? {
            return Ok(Some(AnyRoute::File(file_route)));
        }
        match StaticRoute::from_js(global, argument)? {
            Some(s) => Ok(Some(AnyRoute::Static(s))),
            None => Ok(None),
        }
    }
}

pub struct ServerInitContext<'a> {
    // TODO(port): arena removed in non-AST crate; if needed for bulk-free, reintroduce bumpalo
    pub dedupe_html_bundle_map: HashMap<*const HTMLBundle, RefPtr<html_bundle::Route>>,
    pub js_string_allocations: bake::StringRefList,
    pub global: &'a JSGlobalObject,
    pub framework_router_list: Vec<bake::Framework::FileSystemRouterType>,
    pub user_routes: &'a mut Vec<server_config::StaticRouteEntry>,
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
/// State machine to handle loading plugins asynchronously. This structure is not thread-safe.
pub struct ServePlugins {
    state: ServePluginsState,
    ref_count: core::cell::Cell<u32>,
}

// TODO(port): Reference count is incremented while there are other objects waiting on plugin loads.
// Maps to bun_ptr::IntrusiveRc<ServePlugins> — *ServePlugins crosses FFI as promise context ptr.

pub enum ServePluginsState {
    Unqueued(Box<[Box<[u8]>]>),
    Pending {
        /// Promise may be empty if the plugin load finishes synchronously.
        plugin: Box<JSBundler::Plugin>,
        promise: jsc::JSPromise::Strong,
        html_bundle_routes: Vec<*mut html_bundle::Route>,
        // TODO(port): lifetime — borrowed from callback param, no cleanup
        dev_server: Option<NonNull<DevServer>>,
    },
    Loaded(Box<JSBundler::Plugin>),
    /// Error information is not stored as it is already reported.
    Err,
}

pub enum GetOrStartLoadResult<'a> {
    /// None = no plugins, used by server implementation
    Ready(Option<&'a JSBundler::Plugin>),
    Pending,
    Err,
}

pub enum ServePluginsCallback<'a> {
    HtmlBundleRoute(&'a html_bundle::Route),
    DevServer(&'a DevServer),
}

impl ServePlugins {
    pub fn init(plugins: Box<[Box<[u8]>]>) -> *mut ServePlugins {
        Box::into_raw(Box::new(ServePlugins {
            ref_count: core::cell::Cell::new(1),
            state: ServePluginsState::Unqueued(plugins),
        }))
    }

    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    pub fn deref_(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: intrusive refcount hit zero; this was Box::into_raw'd in init()
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }

    pub fn get_or_start_load(
        &mut self,
        global: &JSGlobalObject,
        cb: ServePluginsCallback<'_>,
    ) -> JsResult<GetOrStartLoadResult<'_>> {
        loop {
            match &mut self.state {
                ServePluginsState::Unqueued(_) => {
                    self.load_and_resolve_plugins(global)?;
                    // could jump to any branch if synchronously resolved
                    continue;
                }
                ServePluginsState::Pending { html_bundle_routes, dev_server, .. } => {
                    match cb {
                        ServePluginsCallback::HtmlBundleRoute(route) => {
                            route.ref_();
                            html_bundle_routes.push(route as *const _ as *mut _);
                        }
                        ServePluginsCallback::DevServer(server) => {
                            debug_assert!(
                                dev_server.is_none()
                                    || dev_server.map(|p| p.as_ptr() as *const _) == Some(server as *const _)
                            ); // one dev server per server
                            *dev_server = Some(NonNull::from(server));
                        }
                    }
                    return Ok(GetOrStartLoadResult::Pending);
                }
                ServePluginsState::Loaded(plugins) => {
                    return Ok(GetOrStartLoadResult::Ready(Some(plugins)));
                }
                ServePluginsState::Err => return Ok(GetOrStartLoadResult::Err),
            }
        }
    }

    fn load_and_resolve_plugins(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        debug_assert!(matches!(self.state, ServePluginsState::Unqueued(_)));
        let ServePluginsState::Unqueued(plugin_list) = &self.state else { unreachable!() };
        let plugin_list: Vec<_> = plugin_list.iter().collect(); // borrow before state mutation
        // PORT NOTE: reshaped for borrowck — clone the slice refs so we can mutate self.state below
        let bunfig_folder = paths::dirname(
            global.bun_vm().transpiler.options.bunfig_path,
            paths::Platform::Auto,
        );

        self.ref_();
        let _deref_guard = scopeguard::guard((), |_| self.deref_());

        let plugin = JSBundler::Plugin::create(global, bun_bundler::options::Target::Browser);
        // PERF(port): was stack-fallback alloc
        let mut bunstring_array: Vec<BunString> = Vec::with_capacity(plugin_list.len());
        for raw_plugin in &plugin_list {
            bunstring_array.push(BunString::init(raw_plugin));
        }
        let plugin_js_array = BunString::to_js_array(global, &bunstring_array)?;
        let bunfig_folder_bunstr = BunString::create_utf8_for_js(global, bunfig_folder)?;

        self.state = ServePluginsState::Pending {
            promise: jsc::JSPromise::Strong::init(global),
            plugin,
            html_bundle_routes: Vec::new(),
            dev_server: None,
        };

        global.bun_vm().event_loop().enter();
        let result = jsc::from_js_host_call(global, || unsafe {
            JSBundlerPlugin__loadAndResolvePluginsForServe(
                match &self.state {
                    ServePluginsState::Pending { plugin, .. } => &**plugin,
                    _ => unreachable!(),
                },
                plugin_js_array,
                bunfig_folder_bunstr,
            )
        })?;
        global.bun_vm().event_loop().exit();

        // handle the case where js synchronously throws an error
        if let Some(e) = global.try_take_exception() {
            self.handle_on_reject(global, e);
            return Ok(());
        }

        if !result.is_empty_or_undefined_or_null() {
            // handle the case where js returns a promise
            if let Some(promise) = result.as_any_promise() {
                match promise.status() {
                    // promise not fulfilled yet
                    jsc::PromiseStatus::Pending => {
                        self.ref_();
                        let promise_value = promise.as_value();
                        if let ServePluginsState::Pending { promise, .. } = &mut self.state {
                            promise.strong.set(global, promise_value);
                        }
                        promise_value.then(global, self as *mut Self, on_resolve_impl, on_reject_impl)?;
                        return Ok(());
                    }
                    jsc::PromiseStatus::Fulfilled => {
                        self.handle_on_resolve();
                        return Ok(());
                    }
                    jsc::PromiseStatus::Rejected => {
                        let value = promise.result(global.vm());
                        self.handle_on_reject(global, value);
                        return Ok(());
                    }
                }
            }

            if let Some(e) = result.to_error() {
                self.handle_on_reject(global, e);
            } else {
                self.handle_on_resolve();
            }
        }
        Ok(())
    }

    pub fn handle_on_resolve(&mut self) {
        debug_assert!(matches!(self.state, ServePluginsState::Pending { .. }));
        let ServePluginsState::Pending { plugin, dev_server, html_bundle_routes, mut promise } =
            mem::replace(&mut self.state, ServePluginsState::Err)
        else {
            unreachable!()
        };
        promise.deinit();

        self.state = ServePluginsState::Loaded(plugin);
        let plugin_ref = match &self.state {
            ServePluginsState::Loaded(p) => &**p,
            _ => unreachable!(),
        };

        for route in html_bundle_routes {
            // SAFETY: route was ref'd when stored
            let route = unsafe { &mut *route };
            route.on_plugins_resolved(plugin_ref); // bun.handleOom — aborts on OOM
            route.deref_();
        }
        if let Some(server) = dev_server {
            // SAFETY: dev_server outlives plugin load
            unsafe { server.as_ref() }.on_plugins_resolved(plugin_ref);
        }
    }

    pub fn handle_on_reject(&mut self, global: &JSGlobalObject, err: JSValue) {
        debug_assert!(matches!(self.state, ServePluginsState::Pending { .. }));
        let ServePluginsState::Pending { plugin, dev_server, html_bundle_routes, mut promise } =
            mem::replace(&mut self.state, ServePluginsState::Err)
        else {
            unreachable!()
        };
        drop(plugin); // pending.plugin.deinit()
        promise.deinit();

        self.state = ServePluginsState::Err;

        for route in html_bundle_routes {
            // SAFETY: route was ref'd when stored
            let route = unsafe { &mut *route };
            route.on_plugins_rejected();
            route.deref_();
        }
        if let Some(server) = dev_server {
            // SAFETY: dev_server outlives plugin load
            unsafe { server.as_ref() }.on_plugins_rejected();
        }

        Output::err_generic(format_args!("Failed to load plugins for Bun.serve:"));
        global.bun_vm().run_error_handler(err, None);
    }
}

impl Drop for ServePlugins {
    fn drop(&mut self) {
        match &self.state {
            ServePluginsState::Unqueued(_) => {}
            ServePluginsState::Pending { .. } => debug_assert!(false), // should have one ref while pending!
            ServePluginsState::Loaded(_) => {} // Box<Plugin> drops
            ServePluginsState::Err => {}
        }
    }
}

#[bun_jsc::host_fn]
pub fn on_resolve_impl(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onResolve");

    let [plugins_result, plugins_js] = callframe.arguments_as_array::<2>();
    let plugins = plugins_js.as_promise_ptr::<ServePlugins>();
    let _guard = scopeguard::guard((), |_| unsafe { (*plugins).deref_() });
    plugins_result.ensure_still_alive();

    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_resolve();

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn on_reject_impl(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onReject");

    let [error_js, plugin_js] = callframe.arguments_as_array::<2>();
    let plugins = plugin_js.as_promise_ptr::<ServePlugins>();
    let _guard = scopeguard::guard((), |_| unsafe { (*plugins).deref_() });
    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_reject(global, error_js);

    Ok(JSValue::UNDEFINED)
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn JSBundlerPlugin__loadAndResolvePluginsForServe(
        plugin: *const JSBundler::Plugin,
        plugins: JSValue,
        bunfig_folder: JSValue,
    ) -> JSValue;
}

// Exported as BunServe__onResolvePlugins / BunServe__onRejectPlugins
// TODO(port): @export — the #[bun_jsc::host_fn] macro emits the C-ABI shim; export under these names
#[unsafe(no_mangle)]
pub extern "C" fn BunServe__onResolvePlugins() {
    // TODO(port): proc-macro — re-export the host_fn shim of on_resolve_impl
}
#[unsafe(no_mangle)]
pub extern "C" fn BunServe__onRejectPlugins() {
    // TODO(port): proc-macro — re-export the host_fn shim of on_reject_impl
}

// ─── PluginsResult ───────────────────────────────────────────────────────────
pub enum PluginsResult<'a> {
    Pending,
    Found(Option<&'a JSBundler::Plugin>),
    Err,
}

// ─── NewServer ───────────────────────────────────────────────────────────────
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Protocol { Http, Https }
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum DevelopmentKind { Debug, Production }

bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    pub struct ServerFlags: u8 {
        const DEINIT_SCHEDULED = 1 << 0;
        const TERMINATED = 1 << 1;
        const HAS_HANDLED_ALL_CLOSED_PROMISE = 1 << 2;
    }
}

/// `fn NewServer(protocol_enum, development_kind) type` — Zig type-generator.
/// SSL = (protocol == .https), DEBUG = (development_kind == .debug).
/// HAS_H3 = SSL.
pub struct NewServer<const SSL: bool, const DEBUG: bool> {
    pub app: Option<*mut uws::NewApp<SSL>>,
    pub listener: Option<*mut uws::NewApp<SSL>::ListenSocket>,
    // TODO(port): conditional field — `if (has_h3) ?*H3.App else void`. Kept as Option; never set when !SSL.
    pub h3_app: Option<*mut uws::H3::App>,
    pub h3_listener: Option<*mut uws::H3::ListenSocket>,
    /// Cached `h3=":<port>"; ma=86400` value for Alt-Svc on H1 responses;
    /// formatted once in onH3Listen so renderMetadata doesn't reformat.
    pub h3_alt_svc: Box<ZStr>, // empty when !SSL
    pub js_value: JsRef,
    /// Potentially null before listen() is called, and once .destroy() is called.
    pub vm: &'static VirtualMachine,
    pub global_this: *const JSGlobalObject,
    pub base_url_string_for_joining: Box<[u8]>,
    pub config: ServerConfig,
    pub pending_requests: usize,
    pub request_pool_allocator: &'static RequestContextStackAllocator<SSL, DEBUG, false>,
    // TODO(port): conditional field
    pub h3_request_pool_allocator: &'static RequestContextStackAllocator<SSL, DEBUG, true>,
    pub all_closed_promise: jsc::JSPromise::Strong,

    pub listen_callback: jsc::AnyTask,
    // allocator field dropped — global mimalloc
    pub poll_ref: KeepAlive,

    pub flags: ServerFlags,

    pub plugins: Option<Rc<ServePlugins>>,

    pub dev_server: Option<Box<DevServer>>,

    /// These associate a route to the index in RouteList.cpp.
    /// User routes may get applied multiple times due to SNI.
    /// So we have to store it.
    pub user_routes: Vec<UserRoute<SSL, DEBUG>>,

    pub on_clienterror: Strong,

    pub inspector_server_id: DebuggerId,
}

// TODO(port): RequestContextStackAllocator is defined in RequestContext.zig; placeholder generic
pub type RequestContextStackAllocator<const SSL: bool, const DEBUG: bool, const H3: bool> =
    <NewRequestContext<SSL, DEBUG, NewServer<SSL, DEBUG>, H3> as super::request_context::HasPool>::Pool;

pub struct UserRoute<const SSL: bool, const DEBUG: bool> {
    pub id: u32,
    pub server: *const NewServer<SSL, DEBUG>,
    pub route: server_config::RouteDeclaration,
}

impl<const SSL: bool, const DEBUG: bool> Drop for UserRoute<SSL, DEBUG> {
    fn drop(&mut self) {
        self.route.deinit();
    }
}

pub enum CreateJsRequest { Yes, No, Bake }

pub struct PreparedRequestFor<'a, Ctx> {
    pub js_request: JSValue,
    pub request_object: &'a mut Request,
    pub ctx: &'a mut Ctx,
}

impl<'a, Ctx: super::request_context::RequestCtx> PreparedRequestFor<'a, Ctx> {
    /// This is used by DevServer for deferring calling the JS handler
    /// to until the bundle is actually ready.
    pub fn save(
        self,
        global: &JSGlobalObject,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
    ) -> SavedRequest {
        // TODO(port): if Ctx::IS_H3 { compile_error!("PreparedRequest.save is HTTP/1-only") }
        // By saving a request, all information from `req` must be
        // copied since the provided uws.Request will be re-used for
        // future requests (stack allocated).
        self.ctx.to_async(req, self.request_object);

        SavedRequest {
            js_request: Strong::create(self.js_request, global),
            request: self.request_object,
            ctx: AnyRequestContext::init(self.ctx),
            response: uws::AnyResponse::init(resp),
        }
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    pub const SSL_ENABLED: bool = SSL;
    pub const DEBUG_MODE: bool = DEBUG;
    const HAS_H3: bool = SSL;

    pub type App = uws::NewApp<SSL>;
    pub type RequestContext = NewRequestContext<SSL, DEBUG, Self, false>;
    pub type H3RequestContext = NewRequestContext<SSL, DEBUG, Self, true>;
    pub type PreparedRequest<'a> = PreparedRequestFor<'a, Self::RequestContext>;

    // TODO(port): codegen — `js` is selected from JSDebugHTTPServer/JSHTTPServer/JSDebugHTTPSServer/JSHTTPSServer
    // The from_js/to_js/to_js_direct fns are provided by #[bun_jsc::JsClass] codegen.

    // TODO(port): host_fn.wrapInstanceMethod — these become #[bun_jsc::host_fn(method)] attributes
    // on the underlying fns. doStop -> stop_from_js, dispose -> dispose_from_js, doUpgrade -> on_upgrade,
    // doPublish -> publish, doReload -> on_reload, doFetch -> on_fetch, doRequestIP -> request_ip,
    // doTimeout -> timeout

    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub fn get_or_load_plugins(&mut self, callback: ServePluginsCallback<'_>) -> GetOrStartLoadResult<'_> {
        if let Some(p) = &mut self.plugins {
            // SAFETY: globalThis outlives the server
            let global = unsafe { &*self.global_this };
            return match Rc::get_mut(p)
                .expect("TODO(port): IntrusiveRc")
                .get_or_start_load(global, callback)
            {
                Ok(r) => r,
                Err(JsError::Thrown) | Err(JsError::Terminated) => {
                    panic!("unhandled exception from ServePlugins.getStartOrLoad")
                }
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            };
        }
        // no plugins
        GetOrStartLoadResult::Ready(None)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_subscriber_count(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1);
        if arguments.len() < 1 {
            return global.throw_not_enough_arguments("subscriberCount", 1, 0);
        }

        if arguments.ptr[0].is_empty_or_undefined_or_null() {
            return global.throw_invalid_arguments(
                format_args!("subscriberCount requires a topic name as a string"),
            );
        }

        let topic = arguments.ptr[0].to_slice(global)?;

        if topic.len() == 0 {
            return Ok(JSValue::js_number(0));
        }

        // SAFETY: app is set when subscriberCount can be called
        Ok(JSValue::js_number(unsafe { &*self.app.unwrap() }.num_subscribers(topic.slice())))
    }

    #[bun_jsc::host_fn(constructor)]
    pub fn constructor(global: &JSGlobalObject, _: &CallFrame) -> JsResult<*mut Self> {
        global.throw2(format_args!("Server() is not a constructor"))
    }

    pub fn js_value_assert_alive(&self) -> JSValue {
        debug_assert!(self.js_value.is_not_empty());
        self.js_value.try_get().unwrap()
    }

    pub fn request_ip(&self, request: &Request) -> JsResult<JSValue> {
        if matches!(self.config.address, server_config::Address::Unix(_)) {
            return Ok(JSValue::NULL);
        }
        let Some(info) = request.request_context.get_remote_socket_info() else {
            return Ok(JSValue::NULL);
        };
        SocketAddress::create_dto(
            unsafe { &*self.global_this },
            info.ip,
            i32::try_from(info.port).unwrap(),
            info.is_ipv6,
        )
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
            + self.base_url_string_for_joining.len()
            + self.config.memory_cost()
            + self.dev_server.as_ref().map_or(0, |dev| dev.memory_cost())
    }

    #[bun_jsc::host_fn(method)]
    pub fn timeout(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        if arguments.len() < 2 || arguments[0].is_empty_or_undefined_or_null() {
            return global.throw_not_enough_arguments("timeout", 2, arguments.len());
        }

        let seconds = arguments[1];

        if matches!(self.config.address, server_config::Address::Unix(_)) {
            return Ok(JSValue::NULL);
        }

        if !seconds.is_number() {
            return unsafe { &*self.global_this }.throw(format_args!("timeout() requires a number"));
        }
        let value = seconds.to::<c_uint>();

        if let Some(request) = arguments[0].as_::<Request>() {
            let _ = request.request_context.set_timeout(value);
        } else if let Some(response) = arguments[0].as_::<NodeHTTPResponse>() {
            response.set_timeout((value % 255) as u8);
        } else {
            return unsafe { &*self.global_this }
                .throw_invalid_arguments(format_args!("timeout() requires a Request object"));
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn set_idle_timeout(&mut self, seconds: c_uint) {
        self.config.idle_timeout = seconds.min(255) as u8;
    }

    pub fn set_flags(&mut self, require_host_header: bool, use_strict_method_validation: bool) {
        if let Some(app) = self.app {
            // SAFETY: FFI handle
            unsafe { &*app }.set_flags(require_host_header, use_strict_method_validation);
        }
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        if let Some(app) = self.app {
            // SAFETY: FFI handle
            unsafe { &*app }.set_max_http_header_size(max_header_size);
        }
    }

    pub fn append_static_route(
        &mut self,
        path: &[u8],
        route: AnyRoute,
        method: http::Method::Optional,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.config.append_static_route(path, route, method)
    }

    pub fn publish(
        &mut self,
        global: &JSGlobalObject,
        topic: ZigString,
        message_value: JSValue,
        compress_value: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if self.config.websocket.is_none() {
            return Ok(JSValue::js_number(0));
        }

        let app = self.app.unwrap();

        if topic.len() == 0 {
            httplog!("publish() topic invalid");
            return global.throw(format_args!("publish requires a topic string"));
        }

        let topic_slice = topic.to_slice();
        if topic_slice.len() == 0 {
            return global.throw(format_args!("publish requires a non-empty topic"));
        }

        // https://github.com/ziglang/zig/issues/24563
        let compress_js = compress_value.unwrap_or(JSValue::TRUE);
        let compress = compress_js.to_boolean();

        if let Some(buffer) = message_value.as_array_buffer(global) {
            return Ok(JSValue::js_number(
                // if 0, return 0
                // else return number of bytes sent
                (AnyWebSocket::publish_with_options(SSL, app, topic_slice.slice(), buffer.slice(), Opcode::Binary, compress) as i32)
                    * (buffer.len() as u32 as u16 as u32 as i32), // @truncate(u31) then widen
                // TODO(port): the Zig is `@intCast(@as(u31, @truncate(buffer.len)))` — use (buffer.len() as u32 & 0x7FFF_FFFF) as i32
            ));
        }

        {
            let mut js_string = message_value.to_js_string(global)?;
            let view = js_string.view(global);
            let slice = view.to_slice();
            let _keep = jsc::EnsureStillAlive(js_string);

            let buffer = slice.slice();
            return Ok(JSValue::js_number(
                // if 0, return 0
                // else return number of bytes sent
                (AnyWebSocket::publish_with_options(SSL, app, topic_slice.slice(), buffer, Opcode::Text, compress) as i32)
                    * ((buffer.len() as u32 & 0x7FFF_FFFF) as i32),
            ));
        }
    }

    pub fn on_upgrade(
        &mut self,
        global: &JSGlobalObject,
        object: JSValue,
        optional: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if self.config.websocket.is_none() {
            return global.throw_invalid_arguments(format_args!(
                "To enable websocket support, set the \"websocket\" object in Bun.serve({{}})"
            ));
        }

        if self.flags.contains(ServerFlags::TERMINATED) {
            return Ok(JSValue::FALSE);
        }

        if let Some(node_http_response) = object.as_::<NodeHTTPResponse>() {
            if node_http_response.flags.ended || node_http_response.flags.socket_closed {
                return Ok(JSValue::FALSE);
            }

            let mut data_value = JSValue::ZERO;

            // if we converted a HeadersInit to a Headers object, we need to free it
            let mut fetch_headers_to_deref: Option<&FetchHeaders> = None;
            let _fh_guard = scopeguard::guard((), |_| {
                if let Some(fh) = fetch_headers_to_deref { fh.deref(); }
            });

            let mut sec_websocket_protocol = ZigString::EMPTY;
            let mut sec_websocket_extensions = ZigString::EMPTY;

            // Owned backing storage for the above when they come from options.headers.
            // fastGet returns a ZigString that borrows from the header map entry's
            // StringImpl, which fastRemove then frees — so we must copy the bytes
            // before removing the entry.
            let mut sec_websocket_protocol_owned = ZigString::Slice::empty();
            let mut sec_websocket_extensions_owned = ZigString::Slice::empty();

            if let Some(opts) = optional {
                'getter: {
                    if opts.is_empty_or_undefined_or_null() {
                        break 'getter;
                    }

                    if !opts.is_object() {
                        return global.throw_invalid_arguments(format_args!("upgrade options must be an object"));
                    }

                    if let Some(headers_value) = opts.fast_get(global, jsc::CommonProperty::Data)? {
                        data_value = headers_value;
                    }

                    if global.has_exception() {
                        return Err(JsError::Thrown);
                    }

                    if let Some(headers_value) = opts.fast_get(global, jsc::CommonProperty::Headers)? {
                        if headers_value.is_empty_or_undefined_or_null() {
                            break 'getter;
                        }

                        let fetch_headers_to_use: &FetchHeaders = match headers_value.as_::<FetchHeaders>() {
                            Some(h) => h,
                            None => 'brk: {
                                if headers_value.is_object() {
                                    if let Some(fetch_headers) = FetchHeaders::create_from_js(global, headers_value)? {
                                        fetch_headers_to_deref = Some(fetch_headers);
                                        break 'brk fetch_headers;
                                    }
                                }
                                if !global.has_exception() {
                                    return global.throw_invalid_arguments(format_args!(
                                        "upgrade options.headers must be a Headers or an object"
                                    ));
                                }
                                return Err(JsError::Thrown);
                            }
                        };

                        if global.has_exception() {
                            return Err(JsError::Thrown);
                        }

                        if let Some(protocol) = fetch_headers_to_use.fast_get(FetchHeaders::Key::SecWebSocketProtocol) {
                            // Clone before fastRemove frees the backing StringImpl.
                            sec_websocket_protocol_owned = protocol.to_slice_clone();
                            sec_websocket_protocol = sec_websocket_protocol_owned.to_zig_string();
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use.fast_remove(FetchHeaders::Key::SecWebSocketProtocol);
                        }

                        if let Some(extensions) = fetch_headers_to_use.fast_get(FetchHeaders::Key::SecWebSocketExtensions) {
                            // Clone before fastRemove frees the backing StringImpl.
                            sec_websocket_extensions_owned = extensions.to_slice_clone();
                            sec_websocket_extensions = sec_websocket_extensions_owned.to_zig_string();
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use.fast_remove(FetchHeaders::Key::SecWebSocketExtensions);
                        }
                        if let Some(raw_response) = node_http_response.raw_response {
                            // we must write the status first so that 200 OK isn't written
                            raw_response.write_status(b"101 Switching Protocols");
                            fetch_headers_to_use.to_uws_response(ResponseKind::from(SSL, false), raw_response.socket());
                        }
                    }

                    if global.has_exception() {
                        return Err(JsError::Thrown);
                    }
                }
            }
            return Ok(JSValue::from(node_http_response.upgrade(
                data_value,
                sec_websocket_protocol,
                sec_websocket_extensions,
            )));
        }

        let Some(request) = object.as_::<Request>() else {
            return global.throw_invalid_arguments(format_args!("upgrade requires a Request object"));
        };

        let Some(upgrader) = request.request_context.get::<Self::RequestContext>() else {
            return Ok(JSValue::FALSE);
        };

        if upgrader.is_aborted_or_ended() {
            return Ok(JSValue::FALSE);
        }

        if upgrader.upgrade_context.is_none()
            || (upgrader.upgrade_context.map(|p| p as usize) == Some(usize::MAX))
        {
            return Ok(JSValue::FALSE);
        }

        let resp = upgrader.resp.unwrap();
        let ctx = upgrader.upgrade_context.unwrap();

        // Keep the upgrader alive across option getters below, which run
        // arbitrary user JS. A re-entrant server.upgrade(req) from a getter
        // would otherwise be able to deref this context out from under us.
        upgrader.ref_();
        let _upgrader_guard = scopeguard::guard((), |_| upgrader.deref_());

        let mut sec_websocket_key_str = ZigString::EMPTY;
        let mut sec_websocket_protocol = ZigString::EMPTY;
        let mut sec_websocket_extensions = ZigString::EMPTY;

        // Owned backing storage for sec_websocket_key/protocol/extensions.
        //
        // fastGet on request.headers returns a ZigString that borrows from the header map
        // entry's StringImpl. Before we use these values we call opts.data / opts.headers
        // getters, which run arbitrary user JS — that JS can mutate request.headers
        // (set/delete Sec-WebSocket-*), freeing the StringImpl out from under the borrowed
        // slice. Clone into owned storage so the bytes stay valid across the getter calls
        // below and the later resp.upgrade().
        //
        // The options.headers path reuses the protocol/extensions slots (and frees the
        // previous clone first) since fastRemove there would likewise free the backing
        // StringImpl.
        let mut sec_websocket_key_owned = ZigString::Slice::empty();
        let mut sec_websocket_protocol_owned = ZigString::Slice::empty();
        let mut sec_websocket_extensions_owned = ZigString::Slice::empty();

        if let Some(head) = request.get_fetch_headers() {
            if let Some(key) = head.fast_get(FetchHeaders::Key::SecWebSocketKey) {
                sec_websocket_key_owned = key.to_slice_clone();
                sec_websocket_key_str = sec_websocket_key_owned.to_zig_string();
            }
            if let Some(protocol) = head.fast_get(FetchHeaders::Key::SecWebSocketProtocol) {
                sec_websocket_protocol_owned = protocol.to_slice_clone();
                sec_websocket_protocol = sec_websocket_protocol_owned.to_zig_string();
            }
            if let Some(extensions) = head.fast_get(FetchHeaders::Key::SecWebSocketExtensions) {
                sec_websocket_extensions_owned = extensions.to_slice_clone();
                sec_websocket_extensions = sec_websocket_extensions_owned.to_zig_string();
            }
        }

        if let Some(req) = upgrader.req {
            if sec_websocket_key_str.len() == 0 {
                sec_websocket_key_str = ZigString::init(req.header(b"sec-websocket-key").unwrap_or(b""));
            }
            if sec_websocket_protocol.len() == 0 {
                sec_websocket_protocol = ZigString::init(req.header(b"sec-websocket-protocol").unwrap_or(b""));
            }
            if sec_websocket_extensions.len() == 0 {
                sec_websocket_extensions = ZigString::init(req.header(b"sec-websocket-extensions").unwrap_or(b""));
            }
        }

        if sec_websocket_key_str.len() == 0 {
            return Ok(JSValue::FALSE);
        }

        if sec_websocket_protocol.len() > 0 {
            sec_websocket_protocol.mark_utf8();
        }
        if sec_websocket_extensions.len() > 0 {
            sec_websocket_extensions.mark_utf8();
        }

        let mut data_value = JSValue::ZERO;

        // if we converted a HeadersInit to a Headers object, we need to free it
        let mut fetch_headers_to_deref: Option<&FetchHeaders> = None;
        let _fh_guard = scopeguard::guard((), |_| {
            if let Some(fh) = fetch_headers_to_deref { fh.deref(); }
        });

        let mut fetch_headers_to_use: Option<&FetchHeaders> = None;

        if let Some(opts) = optional {
            'getter: {
                if opts.is_empty_or_undefined_or_null() {
                    break 'getter;
                }

                if !opts.is_object() {
                    return global.throw_invalid_arguments(format_args!("upgrade options must be an object"));
                }

                if let Some(headers_value) = opts.fast_get(global, jsc::CommonProperty::Data)? {
                    data_value = headers_value;
                }

                if global.has_exception() {
                    return Err(JsError::Thrown);
                }

                if let Some(headers_value) = opts.fast_get(global, jsc::CommonProperty::Headers)? {
                    if headers_value.is_empty_or_undefined_or_null() {
                        break 'getter;
                    }

                    fetch_headers_to_use = match headers_value.as_::<FetchHeaders>() {
                        Some(h) => Some(h),
                        None => 'brk: {
                            if headers_value.is_object() {
                                if let Some(fetch_headers) = FetchHeaders::create_from_js(global, headers_value)? {
                                    fetch_headers_to_deref = Some(fetch_headers);
                                    break 'brk Some(fetch_headers);
                                }
                            }
                            if !global.has_exception() {
                                return global.throw_invalid_arguments(format_args!(
                                    "upgrade options.headers must be a Headers or an object"
                                ));
                            }
                            return Err(JsError::Thrown);
                        }
                    };

                    if global.has_exception() {
                        return Err(JsError::Thrown);
                    }

                    let h = fetch_headers_to_use.unwrap();
                    if let Some(protocol) = h.fast_get(FetchHeaders::Key::SecWebSocketProtocol) {
                        // Clone before fastRemove frees the backing StringImpl.
                        drop(mem::take(&mut sec_websocket_protocol_owned));
                        sec_websocket_protocol_owned = protocol.to_slice_clone();
                        sec_websocket_protocol = sec_websocket_protocol_owned.to_zig_string();
                        // Remove from headers so it's not written twice (once here and once by upgrade())
                        h.fast_remove(FetchHeaders::Key::SecWebSocketProtocol);
                    }

                    if let Some(extensions) = h.fast_get(FetchHeaders::Key::SecWebSocketExtensions) {
                        // Clone before fastRemove frees the backing StringImpl.
                        drop(mem::take(&mut sec_websocket_extensions_owned));
                        sec_websocket_extensions_owned = extensions.to_slice_clone();
                        sec_websocket_extensions = sec_websocket_extensions_owned.to_zig_string();
                        // Remove from headers so it's not written twice (once here and once by upgrade())
                        h.fast_remove(FetchHeaders::Key::SecWebSocketExtensions);
                    }
                }

                if global.has_exception() {
                    return Err(JsError::Thrown);
                }
            }
        }

        // Option getters above may have run arbitrary JS, including a
        // re-entrant server.upgrade(req) on this same request. If that
        // happened the upgrade has already been consumed and the cached
        // `resp`/`ctx` locals now point at a socket that has been turned
        // into a WebSocket — using them again would be UB.
        if upgrader.is_aborted_or_ended() || upgrader.did_upgrade_web_socket() {
            return Ok(JSValue::FALSE);
        }

        let mut cookies_to_write: Option<&CookieMap> = None;
        if let Some(cookies) = upgrader.cookies.take() {
            cookies_to_write = Some(cookies);
        }
        let _cookies_guard = scopeguard::guard((), |_| {
            if let Some(c) = cookies_to_write { c.deref(); }
        });

        // Write status, custom headers, and cookies in one place
        if fetch_headers_to_use.is_some() || cookies_to_write.is_some() {
            // we must write the status first so that 200 OK isn't written
            resp.write_status(b"101 Switching Protocols");

            if let Some(headers) = fetch_headers_to_use {
                headers.to_uws_response(ResponseKind::from(SSL, false), resp);
            }

            if let Some(cookies) = cookies_to_write {
                cookies.write(global, ResponseKind::from(SSL, false), resp as *mut _ as *mut c_void)?;
            }
        }

        // --- After this point, do not throw an exception
        // See https://github.com/oven-sh/bun/issues/1339

        // obviously invalid pointer marks it as used
        upgrader.upgrade_context = Some(usize::MAX as *mut WebSocketUpgradeContext);
        let signal = upgrader.signal.take();
        upgrader.resp = None;
        request.request_context = AnyRequestContext::NULL;
        upgrader.request_weakref.deref_();

        data_value.ensure_still_alive();
        let ws = ServerWebSocket::init(&mut self.config.websocket.as_mut().unwrap().handler, data_value, signal);
        data_value.ensure_still_alive();

        let sec_websocket_protocol_str = sec_websocket_protocol.to_slice();
        let sec_websocket_extensions_str = sec_websocket_extensions.to_slice();

        resp.clear_aborted();
        resp.clear_on_data();
        resp.clear_on_writable();
        resp.clear_timeout();

        upgrader.deref_();

        let _ = resp.upgrade::<ServerWebSocket>(
            ws,
            sec_websocket_key_str.slice(),
            sec_websocket_protocol_str.slice(),
            sec_websocket_extensions_str.slice(),
            ctx,
        );

        Ok(JSValue::TRUE)
    }

    pub fn on_reload_from_zig(&mut self, new_config: &mut ServerConfig, global: &JSGlobalObject) {
        httplog!("onReload");

        // SAFETY: app is set when reload is called
        unsafe { &*self.app.unwrap() }.clear_routes();
        if Self::HAS_H3 {
            if let Some(h3a) = self.h3_app { unsafe { &*h3a }.clear_routes(); }
        }

        // only reload those two, but ignore if they're not specified.
        if self.config.on_request != new_config.on_request
            && (!new_config.on_request.is_empty() && !new_config.on_request.is_undefined())
        {
            self.config.on_request.unprotect();
            self.config.on_request = new_config.on_request;
        }
        if self.config.on_node_http_request != new_config.on_node_http_request {
            self.config.on_node_http_request.unprotect();
            self.config.on_node_http_request = new_config.on_node_http_request;
        }
        if self.config.on_error != new_config.on_error
            && (!new_config.on_error.is_empty() && !new_config.on_error.is_undefined())
        {
            self.config.on_error.unprotect();
            self.config.on_error = new_config.on_error;
        }

        if let Some(ws) = &mut new_config.websocket {
            ws.handler.flags.ssl = SSL;
            if !ws.handler.on_message.is_empty() || !ws.handler.on_open.is_empty() {
                if let Some(old_ws) = &self.config.websocket {
                    old_ws.unprotect();
                }
                ws.global_object = global as *const _;
                self.config.websocket = Some(ws.clone());
                // TODO(port): Zig assigns `ws.*` (move). Phase B: make WebSocketServerContext movable.
            } else {
                // We don't replace the existing websocket config here, but
                // the new one was already protected in WebSocketServerContext.onCreate.
                // Unprotect the discarded handlers so they don't leak.
                ws.unprotect();
            }
        }

        // These get re-applied when we set the static routes again.
        if let Some(dev_server) = &mut self.dev_server {
            // Prevent a use-after-free in the hash table keys.
            dev_server.html_router.clear();
            dev_server.html_router.fallback = None;
        }

        let mut static_routes = mem::replace(&mut self.config.static_routes, Vec::new());
        for route in &mut static_routes {
            route.deinit();
        }
        drop(static_routes);
        self.config.static_routes = mem::take(&mut new_config.static_routes);

        for route in &self.config.negative_routes {
            // Box<[u8]> drops automatically
            let _ = route;
        }
        self.config.negative_routes.clear();
        self.config.negative_routes = mem::take(&mut new_config.negative_routes);

        if new_config.had_routes_object {
            for route in &mut self.config.user_routes_to_build {
                route.deinit();
            }
            self.config.user_routes_to_build.clear();
            self.config.user_routes_to_build = mem::take(&mut new_config.user_routes_to_build);
            self.user_routes.clear();
        }

        let route_list_value = self.set_routes();
        if new_config.had_routes_object {
            if let Some(server_js_value) = self.js_value.try_get() {
                if !server_js_value.is_empty() {
                    Self::js_gc_route_list_set(server_js_value, global, route_list_value);
                }
            }
        }

        if self.inspector_server_id.to_optional().unwrap().is_some() {
            if let Some(debugger) = &mut self.vm.debugger {
                debugger.http_server_agent.notify_server_routes_updated(AnyServer::from(self));
            }
        }
    }

    pub fn reload_static_routes(&mut self) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        if self.app.is_none() {
            // Static routes will get cleaned up when the server is stopped
            return Ok(false);
        }
        self.config = self.config.clone_for_reloading_static_routes()?;
        unsafe { &*self.app.unwrap() }.clear_routes();
        if Self::HAS_H3 {
            if let Some(h3a) = self.h3_app { unsafe { &*h3a }.clear_routes(); }
        }
        let route_list_value = self.set_routes();
        if !route_list_value.is_empty() {
            if let Some(server_js_value) = self.js_value.try_get() {
                if !server_js_value.is_empty() {
                    Self::js_gc_route_list_set(server_js_value, unsafe { &*self.global_this }, route_list_value);
                }
            }
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn on_reload(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return global.throw_not_enough_arguments("reload", 1, 0);
        }

        let mut args_slice = jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments);

        let mut new_config = ServerConfig::default();
        ServerConfig::from_js(global, &mut new_config, &mut args_slice, server_config::FromJSOptions {
            allow_bake_config: false,
            is_fetch_required: true,
            has_user_routes: !self.user_routes.is_empty(),
        })?;
        if global.has_exception() {
            new_config.deinit();
            return Err(JsError::Thrown);
        }

        self.on_reload_from_zig(&mut new_config, global);

        Ok(self.js_value.try_get().unwrap_or(JSValue::UNDEFINED))
    }

    #[bun_jsc::host_fn(method)]
    pub fn on_fetch(&mut self, ctx: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if self.config.on_request.is_empty() {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ZigString::init(b"fetch() requires the server to have a fetch handler").to_error_instance(ctx),
            ));
        }

        let arguments = callframe.arguments_old(2).slice();
        if arguments.is_empty() {
            let fetch_error = Fetch::FETCH_ERROR_NO_ARGS;
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ZigString::init(fetch_error).to_error_instance(ctx),
            ));
        }

        let mut headers: Option<&FetchHeaders> = None;
        let mut method = Method::GET;
        let mut args = jsc::CallFrame::ArgumentsSlice::init(ctx.bun_vm(), arguments);

        let first_arg = args.next_eat().unwrap();
        let mut body = Body::Value::Null;
        let mut existing_request: Request;
        // TODO: set Host header
        // TODO: set User-Agent header
        // TODO: unify with fetch() implementation.
        if first_arg.is_string() {
            let url_zig_str = arguments[0].to_slice(ctx)?;
            let temp_url_str = url_zig_str.slice();

            if temp_url_str.is_empty() {
                let fetch_error = Fetch::FETCH_ERROR_BLANK_URL;
                return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ZigString::init(fetch_error).to_error_instance(ctx),
                ));
            }

            let mut url = URL::parse(temp_url_str);

            // Both branches produce a heap-owned buffer that `url.href` borrows.
            // `bun.String.cloneUTF8(url.href)` below makes its own copy, so this
            // buffer must be freed before we leave the block.
            let owned_url_buf: Vec<u8> = if url.hostname.is_empty() {
                strings::append(&self.base_url_string_for_joining, url.pathname)
            } else {
                temp_url_str.to_vec()
            };
            url = URL::parse(&owned_url_buf);

            if arguments.len() >= 2 && arguments[1].is_object() {
                let opts = arguments[1];
                if let Some(method_) = opts.fast_get(ctx, jsc::CommonProperty::Method)? {
                    let slice_ = method_.to_slice(ctx)?;
                    method = Method::which(slice_.slice()).unwrap_or(method);
                }

                if let Some(headers_) = opts.fast_get(ctx, jsc::CommonProperty::Headers)? {
                    if let Some(headers__) = headers_.as_::<FetchHeaders>() {
                        headers = Some(headers__);
                    } else if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_)? {
                        headers = Some(headers__);
                    }
                }

                if let Some(body__) = opts.fast_get(ctx, jsc::CommonProperty::Body)? {
                    match Blob::get(ctx, body__, true, false) {
                        Ok(new_blob) => body = Body::Value::Blob(new_blob),
                        Err(_) => {
                            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                ctx,
                                ZigString::init(b"fetch() received invalid body").to_error_instance(ctx),
                            ));
                        }
                    }
                }
            }

            existing_request = Request::init2(
                BunString::clone_utf8(url.href),
                headers,
                self.vm.init_request_body_value(body),
                method,
            );
        } else if let Some(request_) = first_arg.as_::<Request>() {
            existing_request = Default::default();
            // TODO(port): Request::cloneInto out-param pattern — reshape to return value
            request_.clone_into(&mut existing_request, ctx, false)?;
        } else {
            let fetch_error = Fetch::fetch_type_error_strings_get(jsc::C::js_value_get_type(ctx, first_arg.as_ref()));
            let err = ctx.to_type_error(jsc::ErrorCode::INVALID_ARG_TYPE, format_args!("{}", BStr::new(fetch_error)));
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(ctx, err));
        }

        let request = Request::new_(existing_request);

        debug_assert!(!self.config.on_request.is_empty()); // confirmed above
        let global_this = unsafe { &*self.global_this };
        let response_value = match self.config.on_request.call(
            global_this,
            self.js_value_assert_alive(),
            &[request.to_js(global_this)],
        ) {
            Ok(v) => v,
            Err(err) => global_this.take_exception(err),
        };

        if response_value.is_any_error() {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(ctx, response_value));
        }

        if response_value.is_empty_or_undefined_or_null() {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ZigString::init(b"fetch() returned an empty value").to_error_instance(ctx),
            ));
        }

        if response_value.as_any_promise().is_some() {
            return Ok(response_value);
        }

        if let Some(resp) = response_value.as_::<Response>() {
            resp.set_url(existing_request.url.clone());
        }
        Ok(JSPromise::resolved_promise_value(ctx, response_value))
    }

    #[bun_jsc::host_fn(method)]
    pub fn close_idle_connections(&mut self, _global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        if self.app.is_none() {
            return Ok(JSValue::UNDEFINED);
        }
        unsafe { &*self.app.unwrap() }.close_idle_connections();
        Ok(JSValue::UNDEFINED)
    }

    pub fn stop_from_js(&mut self, abruptly: Option<JSValue>) -> JSValue {
        let rc = self.get_all_closed_promise(unsafe { &*self.global_this });

        if self.has_listener() {
            let abrupt = 'brk: {
                if let Some(val) = abruptly {
                    if val.is_boolean() && val.to_boolean() {
                        break 'brk true;
                    }
                }
                false
            };
            self.stop(abrupt);
        }

        rc
    }

    pub fn dispose_from_js(&mut self) -> JSValue {
        if self.has_listener() {
            self.stop(true);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_port(&self, _: &JSGlobalObject) -> JSValue {
        if matches!(self.config.address, server_config::Address::Unix(_)) {
            return JSValue::UNDEFINED;
        }

        if let Some(listener) = self.listener {
            return JSValue::js_number(unsafe { &*listener }.get_local_port());
        }
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener {
                return JSValue::js_number(unsafe { &*h3l }.get_local_port());
            }
        }
        JSValue::js_number(self.config.address.tcp().port)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_id(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        BunString::create_utf8_for_js(global, &self.config.id)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pending_requests(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number((self.pending_requests as u32 & 0x7FFF_FFFF) as i32)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pending_web_sockets(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number((self.active_sockets_count() as u32 & 0x7FFF_FFFF) as i32)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_address(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.config.address {
            server_config::Address::Unix(unix) => {
                let mut value = BunString::clone_utf8(unix);
                let r = value.to_js(global);
                value.deref();
                Ok(r)
            }
            server_config::Address::Tcp(tcp) => {
                let mut port: u16 = tcp.port;

                if let Some(listener) = self.listener {
                    let listener = unsafe { &*listener };
                    port = u16::try_from(listener.get_local_port()).unwrap();

                    let mut buf = [0u8; 64];
                    let Some(address_bytes) = listener.socket().local_address(&mut buf) else {
                        return Ok(JSValue::NULL);
                    };
                    let addr = match SocketAddress::init(address_bytes, port) {
                        Ok(a) => a,
                        Err(_) => {
                            #[cold] fn cold() {}
                            cold();
                            return Ok(JSValue::NULL);
                        }
                    };
                    return Ok(addr.into_dto(unsafe { &*self.global_this }));
                }
                if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener {
                        let h3l = unsafe { &*h3l };
                        port = u16::try_from(h3l.get_local_port()).unwrap();
                        let mut buf = [0u8; 64];
                        let Some(address_bytes) = h3l.get_local_address(&mut buf) else {
                            return Ok(JSValue::NULL);
                        };
                        let addr = match SocketAddress::init(address_bytes, port) {
                            Ok(a) => a,
                            Err(_) => {
                                #[cold] fn cold() {}
                                cold();
                                return Ok(JSValue::NULL);
                            }
                        };
                        return Ok(addr.into_dto(unsafe { &*self.global_this }));
                    }
                }
                Ok(JSValue::NULL)
            }
        }
    }

    pub fn get_url_as_string(&self) -> Result<BunString, AllocError> {
        let fmt = match &self.config.address {
            server_config::Address::Unix(unix) => 'brk: {
                if unix.len() > 1 && unix[0] == 0 {
                    // abstract domain socket, let's give it an "abstract" URL
                    break 'brk bun_fmt::URLFormatter {
                        proto: bun_fmt::Proto::Abstract,
                        hostname: Some(&unix[1..]),
                        port: None,
                    };
                }
                bun_fmt::URLFormatter {
                    proto: bun_fmt::Proto::Unix,
                    hostname: Some(unix),
                    port: None,
                }
            }
            server_config::Address::Tcp(tcp) => 'blk: {
                let mut port: u16 = tcp.port;
                if let Some(listener) = self.listener {
                    port = u16::try_from(unsafe { &*listener }.get_local_port()).unwrap();
                } else if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener {
                        port = u16::try_from(unsafe { &*h3l }.get_local_port()).unwrap();
                    }
                }
                break 'blk bun_fmt::URLFormatter {
                    proto: if SSL { bun_fmt::Proto::Https } else { bun_fmt::Proto::Http },
                    hostname: tcp.hostname.as_ref().map(|h| bstr::slice_to_nul(h)),
                    port: Some(port),
                };
            }
        };

        let mut buf = Vec::new();
        write!(&mut buf, "{}", fmt).map_err(|_| AllocError)?;
        Ok(BunString::clone_utf8(&buf))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_url(&self, global: &JSGlobalObject) -> Result<JSValue, AllocError> {
        let mut url = self.get_url_as_string()?;
        let r = url.to_js_dom_url(global);
        url.deref();
        Ok(r)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_hostname(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): narrow error set
        match &self.config.address {
            server_config::Address::Unix(_) => return Ok(JSValue::UNDEFINED),
            server_config::Address::Tcp(_) => {}
        }
        {
            if let Some(listener) = self.listener {
                let mut buf = [0u8; 1024];
                if let Some(addr) = unsafe { &*listener }.socket().remote_address(&mut buf[..1024]) {
                    if !addr.is_empty() {
                        return BunString::create_utf8_for_js(global, addr);
                    }
                }
            }
            {
                match &self.config.address {
                    server_config::Address::Tcp(tcp) => {
                        if let Some(hostname) = &tcp.hostname {
                            return BunString::create_utf8_for_js(global, bstr::slice_to_nul(hostname));
                        } else {
                            return Ok(BunString::static_(b"localhost").to_js(global));
                        }
                    }
                    server_config::Address::Unix(_) => unreachable!(),
                }
            }
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_protocol(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let _ = self;
        Ok(BunString::static_(if SSL { b"https" } else { b"http" }).to_js(global))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_development(_this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(DEBUG)
    }

    pub fn on_static_request_complete(&mut self) {
        self.pending_requests -= 1;
        self.deinit_if_we_can();
    }

    pub fn on_request_complete(&mut self) {
        self.vm.event_loop().process_gc_timer();
        self.pending_requests -= 1;
        self.deinit_if_we_can();
    }

    pub fn finalize(this: *mut Self) {
        httplog!("finalize");
        // SAFETY: called from JSC finalizer on mutator thread
        let this = unsafe { &mut *this };
        this.js_value.finalize();
        this.deinit_if_we_can();
    }

    pub fn active_sockets_count(&self) -> u32 {
        let Some(websocket) = &self.config.websocket else { return 0 };
        websocket.handler.active_connections as u32
    }

    pub fn has_active_web_sockets(&self) -> bool {
        self.active_sockets_count() > 0
    }

    /// True while either the TCP listen socket or (h1: false) the QUIC
    /// listen socket is bound. The lifecycle code uses this rather than
    /// `this.listener != null` so an h3-only server is still treated as
    /// running.
    pub fn has_listener(&self) -> bool {
        if self.listener.is_some() { return true; }
        if Self::HAS_H3 && self.h3_listener.is_some() { return true; }
        false
    }

    pub fn get_all_closed_promise(&mut self, global: &JSGlobalObject) -> JSValue {
        if !self.has_listener() && self.pending_requests == 0 {
            return JSPromise::resolved_promise(global, JSValue::UNDEFINED).to_js();
        }
        let prom = &mut self.all_closed_promise;
        if prom.strong.has() {
            return prom.value();
        }
        *prom = jsc::JSPromise::Strong::init(global);
        prom.value()
    }

    pub fn deinit_if_we_can(&mut self) {
        if cfg!(feature = "debug_logs") {
            httplog!(
                "deinitIfWeCan. requests={}, listener={}, websockets={}, has_handled_all_closed_promise={}, all_closed_promise={}, has_js_deinited={}",
                self.pending_requests,
                if self.listener.is_none() { "null" } else { "some" },
                if self.has_active_web_sockets() { "active" } else { "no" },
                self.flags.contains(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE),
                if self.all_closed_promise.strong.has() { "has" } else { "no" },
                self.js_value.is_finalized(),
            );
        }

        let vm = unsafe { &*self.global_this }.bun_vm();

        if self.pending_requests == 0
            && !self.has_listener()
            && !self.has_active_web_sockets()
            && !self.flags.contains(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE)
            && self.all_closed_promise.strong.has()
        {
            httplog!("schedule other promise");

            // use a flag here instead of `this.all_closed_promise.get().isHandled(vm)` to prevent the race condition of this block being called
            // again before the task has run.
            self.flags.insert(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE);

            ServerAllConnectionsClosedTask::schedule(
                ServerAllConnectionsClosedTask {
                    global_object: unsafe { &*self.global_this },
                    // Duplicate the Strong handle so that we can hold two independent strong references to it.
                    promise: jsc::JSPromise::Strong {
                        strong: Strong::create(self.all_closed_promise.value(), unsafe { &*self.global_this }),
                    },
                    tracker: AsyncTaskTracker::init(vm),
                },
                vm,
            );
        }
        if self.pending_requests == 0 && !self.has_listener() && !self.has_active_web_sockets() {
            if let Some(ws) = &mut self.config.websocket {
                ws.handler.app = None;
            }
            self.unref();

            // Detach DevServer. This is needed because there are aggressive
            // tests that check for DevServer memory soundness. This reveals
            // a larger problem, that it seems that some objects like Server
            // should be detachable from their JSValue, so that when the
            // native handle is done, keeping the JS binding doesn't use
            // `this.memoryCost()` bytes.
            if let Some(dev) = self.dev_server.take() {
                if let Some(app) = self.app {
                    unsafe { &*app }.clear_routes();
                }
                drop(dev);
            }

            // Only free the memory if the JS reference has been freed too
            if self.js_value.is_finalized() {
                self.schedule_deinit();
            }
        }
    }

    pub fn stop_listening(&mut self, abrupt: bool) {
        httplog!("stopListening");
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener.take() {
                // Graceful: GOAWAY + drain via the still-open UDP socket;
                // the engine rejects new conns and the timer keeps in-flight
                // streams progressing until deinit. Abrupt: close the fd now.
                if !abrupt {
                    if let Some(h3a) = self.h3_app { unsafe { &*h3a }.close(); }
                } else {
                    unsafe { &*h3l }.close();
                }
            }
        }
        let Some(listener) = self.listener.take() else {
            if Self::HAS_H3 {
                if self.h3_app.is_some() {
                    self.unref();
                    self.notify_inspector_server_stopped();
                    if abrupt {
                        self.flags.insert(ServerFlags::TERMINATED);
                    }
                }
            }
            return;
        };
        self.unref();

        if !SSL {
            self.vm.remove_listening_socket_for_watch_mode(unsafe { &*listener }.socket().fd());
        }

        self.notify_inspector_server_stopped();

        if let server_config::Address::Unix(path) = &self.config.address {
            if !path.is_empty() && path[0] != 0 {
                let _ = sys::unlink(path);
            }
        }

        if !abrupt {
            unsafe { &*listener }.close();
        } else if !self.flags.contains(ServerFlags::TERMINATED) {
            if let Some(ws) = &mut self.config.websocket {
                ws.handler.app = None;
            }
            self.flags.insert(ServerFlags::TERMINATED);
            unsafe { &*self.app.unwrap() }.close();
        }
    }

    pub fn stop(&mut self, abrupt: bool) {
        if self.js_value.is_not_empty() {
            self.js_value.downgrade();
        }
        if self.config.allow_hot && !self.config.id.is_empty() {
            if let Some(hot) = unsafe { &*self.global_this }.bun_vm().hot_map() {
                hot.remove(&self.config.id);
            }
        }

        self.stop_listening(abrupt);
        self.deinit_if_we_can();
    }

    pub fn schedule_deinit(&mut self) {
        if self.flags.contains(ServerFlags::DEINIT_SCHEDULED) {
            httplog!("scheduleDeinit (again)");
            return;
        }
        self.flags.insert(ServerFlags::DEINIT_SCHEDULED);
        httplog!("scheduleDeinit");

        if !self.flags.contains(ServerFlags::TERMINATED) {
            // App.close can cause finalizers to run.
            // scheduleDeinit can be called inside a finalizer.
            // Therefore, we split it into two tasks.
            self.flags.insert(ServerFlags::TERMINATED);
            let task = Box::new(jsc::AnyTask::new::<Self::App>(Self::App::close, self.app.unwrap()));
            self.vm.enqueue_task(jsc::Task::init(Box::into_raw(task)));
        }

        let task = Box::new(jsc::AnyTask::new::<Self>(Self::deinit, self));
        self.vm.enqueue_task(jsc::Task::init(Box::into_raw(task)));
    }

    fn notify_inspector_server_stopped(&mut self) {
        if self.inspector_server_id.to_optional().unwrap().is_some() {
            #[cold] fn cold() {}
            cold();
            if let Some(debugger) = &mut self.vm.debugger {
                cold();
                debugger.http_server_agent.notify_server_stopped(AnyServer::from(self));
                self.inspector_server_id = DebuggerId::init(0);
            }
        }
    }

    pub fn deinit(this: *mut Self) {
        httplog!("deinit");
        // SAFETY: called from scheduled task; this was Box::into_raw'd in init()
        let this = unsafe { &mut *this };

        // This should've already been handled in stopListening
        // However, when the JS VM terminates, it hypothetically might not call stopListening
        this.notify_inspector_server_stopped();

        this.all_closed_promise.deinit();
        // user_routes Drop handles route.deinit()
        this.user_routes.clear();

        this.config.deinit();

        this.on_clienterror.deinit();
        if Self::HAS_H3 {
            if let Some(h3a) = this.h3_app.take() {
                unsafe { uws::H3::App::destroy(h3a) };
            }
        }
        if Self::HAS_H3 && !this.h3_alt_svc.as_bytes().is_empty() {
            // Box<ZStr> drops
        }
        if let Some(app) = this.app.take() {
            unsafe { Self::App::destroy(app) };
        }

        if let Some(dev_server) = this.dev_server.take() {
            drop(dev_server);
        }

        if let Some(plugins) = this.plugins.take() {
            drop(plugins); // Rc deref
        }

        // SAFETY: this was Box::into_raw'd in init()
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn init(config: &mut ServerConfig, global: &JSGlobalObject) -> JsResult<*mut Self> {
        let base_url: Box<[u8]> = strings::trim(config.base_url.href, b"/").into();
        // errdefer free(base_url) — Box drops on Err automatically

        let dev_server = if let Some(bake_options) = &mut config.bake {
            Some(DevServer::init(bake::DevServerInit {
                arena: bake_options.arena.allocator(),
                root: bake_options.root,
                framework: bake_options.framework,
                bundler_options: bake_options.bundler_options,
                vm: global.bun_vm(),
                broadcast_console_log_from_browser_to_server:
                    config.broadcast_console_log_from_browser_to_server_for_bake,
            })?)
        } else {
            None
        };
        // errdefer dev_server.deinit() — Box<DevServer> drops on Err automatically

        let server = Box::into_raw(Box::new(Self {
            global_this: global,
            config: mem::take(config),
            base_url_string_for_joining: base_url,
            vm: VirtualMachine::get(),
            dev_server,
            // defaults:
            app: None,
            listener: None,
            h3_app: None,
            h3_listener: None,
            h3_alt_svc: ZStr::empty_boxed(),
            js_value: JsRef::empty(),
            pending_requests: 0,
            request_pool_allocator: Self::RequestContext::pool_get_or_init(),
            h3_request_pool_allocator: if Self::HAS_H3 {
                Self::H3RequestContext::pool_get_or_init()
            } else {
                // TODO(port): conditional field — placeholder static
                Self::H3RequestContext::pool_get_or_init()
            },
            all_closed_promise: jsc::JSPromise::Strong::default(),
            listen_callback: jsc::AnyTask::default(),
            poll_ref: KeepAlive::default(),
            flags: ServerFlags::default(),
            plugins: None,
            user_routes: Vec::new(),
            on_clienterror: Strong::empty(),
            inspector_server_id: DebuggerId::init(0),
        }));

        // TODO(port): RequestContext.pool is a process-global static; pool_get_or_init() above
        // replaces the `if pool == null { create }` block.

        if SSL {
            analytics::Features::https_server_inc();
        } else {
            analytics::Features::http_server_inc();
        }

        Ok(server)
    }

    #[cold]
    fn on_listen_failed(&mut self) {
        httplog!("onListenFailed");

        let global = unsafe { &*self.global_this };

        let mut error_instance = JSValue::ZERO;
        let mut output_buf = [0u8; 4096];

        if SSL {
            output_buf[0] = 0;
            let mut written: usize = 0;
            let mut ssl_error = unsafe { boringssl::ERR_get_error() };
            while ssl_error != 0 && written < output_buf.len() {
                if written > 0 {
                    output_buf[written] = b'\n';
                    written += 1;
                }

                if let Some(reason_ptr) = unsafe { boringssl::ERR_reason_error_string(ssl_error) } {
                    // SAFETY: BoringSSL returns a NUL-terminated static string
                    let reason = unsafe { core::ffi::CStr::from_ptr(reason_ptr) }.to_bytes();
                    if reason.is_empty() {
                        break;
                    }
                    output_buf[written..written + reason.len()].copy_from_slice(reason);
                    written += reason.len();
                }

                if let Some(reason_ptr) = unsafe { boringssl::ERR_func_error_string(ssl_error) } {
                    let reason = unsafe { core::ffi::CStr::from_ptr(reason_ptr) }.to_bytes();
                    if !reason.is_empty() {
                        output_buf[written..written + 5].copy_from_slice(b" via ");
                        written += 5;
                        output_buf[written..written + reason.len()].copy_from_slice(reason);
                        written += reason.len();
                    }
                }

                if let Some(reason_ptr) = unsafe { boringssl::ERR_lib_error_string(ssl_error) } {
                    let reason = unsafe { core::ffi::CStr::from_ptr(reason_ptr) }.to_bytes();
                    if !reason.is_empty() {
                        output_buf[written] = b' ';
                        written += 1;
                        output_buf[written..written + reason.len()].copy_from_slice(reason);
                        written += reason.len();
                    }
                }

                ssl_error = unsafe { boringssl::ERR_get_error() };
            }

            if written > 0 {
                let message = &output_buf[0..written];
                error_instance = global.create_error_instance(format_args!("OpenSSL {}", BStr::new(message)));
                unsafe { boringssl::ERR_clear_error() };
            }
        }

        if error_instance.is_empty() {
            match &self.config.address {
                server_config::Address::Tcp(tcp) => 'error_set: {
                    #[cfg(target_os = "linux")]
                    {
                        let rc: i32 = -1;
                        let code = sys::get_errno(rc);
                        if code == sys::E::ACCES {
                            let mut cursor = &mut output_buf[..];
                            let msg = match write!(
                                cursor,
                                "permission denied {}:{}",
                                BStr::new(tcp.hostname.as_deref().unwrap_or(b"0.0.0.0")),
                                tcp.port
                            ) {
                                Ok(_) => {
                                    let n = 4096 - cursor.len();
                                    &output_buf[..n]
                                }
                                Err(_) => b"Failed to start server",
                            };
                            error_instance = (SystemError {
                                message: BunString::init(msg),
                                code: BunString::static_(b"EACCES"),
                                syscall: BunString::static_(b"listen"),
                                ..Default::default()
                            })
                            .to_error_instance(global);
                            break 'error_set;
                        }
                    }
                    let mut cursor = &mut output_buf[..];
                    let msg = match write!(cursor, "Failed to start server. Is port {} in use?", tcp.port) {
                        Ok(_) => {
                            let n = 4096 - cursor.len();
                            &output_buf[..n]
                        }
                        Err(_) => b"Failed to start server",
                    };
                    error_instance = (SystemError {
                        message: BunString::init(msg),
                        code: BunString::static_(b"EADDRINUSE"),
                        syscall: BunString::static_(b"listen"),
                        ..Default::default()
                    })
                    .to_error_instance(global);
                }
                server_config::Address::Unix(unix) => match sys::get_errno(-1i32) {
                    sys::E::SUCCESS => {
                        let mut cursor = &mut output_buf[..];
                        let msg = match write!(
                            cursor,
                            "Failed to listen on unix socket {}",
                            bun_fmt::QuotedFormatter { text: unix }
                        ) {
                            Ok(_) => {
                                let n = 4096 - cursor.len();
                                &output_buf[..n]
                            }
                            Err(_) => b"Failed to start server",
                        };
                        error_instance = (SystemError {
                            message: BunString::init(msg),
                            code: BunString::static_(b"EADDRINUSE"),
                            syscall: BunString::static_(b"listen"),
                            ..Default::default()
                        })
                        .to_error_instance(global);
                    }
                    e => {
                        let mut sys_err = sys::Error::from_code(e, sys::Tag::Listen);
                        sys_err.path = unix.clone();
                        error_instance = match sys_err.to_js(global) {
                            Ok(v) => v,
                            Err(_) => return,
                        };
                    }
                },
            }
        }

        error_instance.ensure_still_alive();
        let _ = global.throw_value(error_instance);
    }

    pub fn on_listen(&mut self, socket: Option<*mut uws::NewApp<SSL>::ListenSocket>) {
        let Some(socket) = socket else {
            return self.on_listen_failed();
        };

        self.listener = Some(socket);
        self.vm.event_loop_handle = AsyncLoop::get();
        if !SSL {
            self.vm.add_listening_socket_for_watch_mode(unsafe { &*socket }.socket().fd());
        }
    }

    pub fn h3_alt_svc(&self) -> Option<&[u8]> {
        if !Self::HAS_H3 { return None; }
        if !self.h3_alt_svc.as_bytes().is_empty() {
            Some(self.h3_alt_svc.as_bytes())
        } else {
            None
        }
    }

    pub fn on_h3_listen(&mut self, socket: Option<*mut uws::H3::ListenSocket>) {
        if !Self::HAS_H3 { unreachable!(); }
        self.h3_listener = socket;
        if let Some(s) = socket {
            let mut buf = Vec::new();
            match write!(&mut buf, "h3=\":{}\"; ma=86400", unsafe { &*s }.get_local_port()) {
                Ok(_) => {
                    buf.push(0);
                    // SAFETY: NUL terminator just written
                    self.h3_alt_svc = unsafe { ZStr::from_boxed_with_nul(buf.into_boxed_slice()) };
                }
                Err(_) => self.h3_alt_svc = ZStr::empty_boxed(),
            }
        }
    }

    pub fn on_h3_request(&mut self, req: &mut uws::H3::Request, resp: &mut uws::H3::Response) {
        if !Self::HAS_H3 { unreachable!(); }
        if self.config.on_request.is_empty() {
            return Self::on_h3_404(self, req, resp);
        }
        self.on_request_for::<Self::H3RequestContext>(req, resp);
    }

    pub fn on_h3_user_route_request(
        user_route: &mut UserRoute<SSL, DEBUG>,
        req: &mut uws::H3::Request,
        resp: &mut uws::H3::Response,
    ) {
        if !Self::HAS_H3 { unreachable!(); }
        Self::on_user_route_request_for::<Self::H3RequestContext>(user_route, req, resp);
    }

    pub fn on_h3_404(_this: &mut Self, _req: &mut uws::H3::Request, resp: &mut uws::H3::Response) {
        if !Self::HAS_H3 { unreachable!(); }
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    pub fn ref_(&mut self) {
        if self.poll_ref.is_active() { return; }
        self.poll_ref.ref_(self.vm);
    }

    pub fn unref(&mut self) {
        if !self.poll_ref.is_active() { return; }
        self.poll_ref.unref(self.vm);
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(&mut self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.ref_();
        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(&mut self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.unref();
        Ok(this_value)
    }

    pub fn on_bun_info_request(&mut self, req: &mut uws::Request, resp: &mut <Self::App as uws::AppTrait>::Response) {
        jsc::mark_binding!();
        self.pending_requests += 1;
        let _guard = scopeguard::guard((), |_| self.pending_requests -= 1);
        req.set_yield(false);
        // PERF(port): was stack-fallback alloc

        let buffer_writer = bun_js_parser::printer::BufferWriter::init();
        let mut writer = bun_js_parser::printer::BufferPrinter::init(buffer_writer);
        let source = logger::Source::init_empty_file(b"info.json");
        let _ = bun_js_parser::printer::print_json(
            &mut writer,
            Global::BunInfo::generate(&VirtualMachine::get().transpiler).expect("unreachable"),
            &source,
            bun_js_parser::printer::Options { mangled_props: None },
        );

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", MimeType::JSON.value);
        resp.write_header(b"Cache-Control", b"public, max-age=3600");
        resp.write_header_int(b"Age", 0);
        let buffer = writer.ctx.written;
        resp.end(buffer, false);
    }

    pub fn on_pending_request(&mut self) {
        self.pending_requests += 1;
    }

    pub fn on_node_http_request_with_upgrade_ctx(
        &mut self,
        req: &mut uws::Request,
        resp: &mut <Self::App as uws::AppTrait>::Response,
        upgrade_ctx: Option<&mut WebSocketUpgradeContext>,
    ) {
        self.on_pending_request();
        #[cfg(debug_assertions)]
        self.vm.event_loop().debug.enter();
        let _dbg_guard = scopeguard::guard((), |_| {
            #[cfg(debug_assertions)]
            self.vm.event_loop().debug.exit();
        });
        req.set_yield(false);
        resp.timeout(self.config.idle_timeout);

        let global = unsafe { &*self.global_this };
        let this_object: JSValue = self.js_value.try_get().unwrap_or(JSValue::UNDEFINED);
        let vm = self.vm;

        let mut node_http_response: Option<*mut NodeHTTPResponse> = None;
        let mut is_async = false;
        let _nhr_guard = scopeguard::guard((), |_| {
            if !is_async {
                if let Some(node_response) = node_http_response {
                    unsafe { &*node_response }.deref_();
                }
            }
        });

        let on_node_http_request_fn = if SSL {
            NodeHTTPServer__onRequest_https
        } else {
            NodeHTTPServer__onRequest_http
        };

        let result: JSValue = match jsc::from_js_host_call(global, || unsafe {
            on_node_http_request_fn(
                AnyServer::from(self).ptr.ptr() as usize,
                global,
                this_object,
                self.config.on_node_http_request,
                if let Some(method) = http::Method::find(req.method()) {
                    method.to_js(global)
                } else {
                    JSValue::UNDEFINED
                },
                req,
                resp as *mut _ as *mut c_void,
                upgrade_ctx.map(|c| c as *mut _).unwrap_or(core::ptr::null_mut()),
                &mut node_http_response,
            )
        }) {
            Ok(v) => v,
            Err(_) => global.take_exception(JsError::Thrown),
        };

        enum HTTPResult {
            Rejection(JSValue),
            Exception(JSValue),
            Success,
            Pending(JSValue),
        }
        let mut strong_promise = Strong::empty();
        let mut needs_to_drain = true;

        let _drain_guard = scopeguard::guard((), |_| {
            if needs_to_drain {
                vm.drain_microtasks();
            }
        });
        let _sp_guard = scopeguard::guard((), |_| strong_promise.deinit());
        let http_result: HTTPResult = 'brk: {
            if let Some(err) = result.to_error() {
                break 'brk HTTPResult::Exception(err);
            }

            if let Some(promise) = result.as_any_promise() {
                if promise.status() == jsc::PromiseStatus::Pending {
                    strong_promise.set(global, result);
                    needs_to_drain = false;
                    vm.drain_microtasks();
                }

                match promise.status() {
                    jsc::PromiseStatus::Fulfilled => {
                        global.handle_rejected_promises();
                        break 'brk HTTPResult::Success;
                    }
                    jsc::PromiseStatus::Rejected => {
                        promise.set_handled(global.vm());
                        break 'brk HTTPResult::Rejection(promise.result(global.vm()));
                    }
                    jsc::PromiseStatus::Pending => {
                        global.handle_rejected_promises();
                        if let Some(node_response) = node_http_response {
                            let node_response = unsafe { &mut *node_response };
                            if node_response.flags.request_has_completed
                                || node_response.flags.socket_closed
                                || node_response.flags.upgraded
                            {
                                strong_promise.deinit();
                                break 'brk HTTPResult::Success;
                            }

                            let strong_self = node_response.get_this_value();

                            if strong_self.is_empty_or_undefined_or_null() {
                                strong_promise.deinit();
                                break 'brk HTTPResult::Success;
                            }

                            node_response.promise = mem::replace(&mut strong_promise, Strong::empty());
                            let _ = result.then2(
                                global,
                                strong_self,
                                NodeHTTPResponse::Bun__NodeHTTPRequest__onResolve,
                                NodeHTTPResponse::Bun__NodeHTTPRequest__onReject,
                            ); // TODO: properly propagate exception upwards
                            is_async = true;
                        }

                        break 'brk HTTPResult::Pending(result);
                    }
                }
            }

            HTTPResult::Success
        };

        match &http_result {
            HTTPResult::Exception(err) | HTTPResult::Rejection(err) => {
                let _ = vm.uncaught_exception(global, *err, matches!(http_result, HTTPResult::Rejection(_)));

                if let Some(node_response) = node_http_response {
                    let node_response = unsafe { &mut *node_response };
                    if !node_response.flags.upgraded && node_response.raw_response.is_some() {
                        let raw_response = node_response.raw_response.unwrap();
                        if !node_response.flags.request_has_completed && raw_response.state().is_response_pending() {
                            if raw_response.state().is_http_status_called() {
                                raw_response.write_status(b"500 Internal Server Error");
                                raw_response.end_without_body(true);
                            } else {
                                raw_response.end_stream(true);
                            }
                        }
                    }
                    node_response.on_request_complete();
                }
            }
            HTTPResult::Success => {}
            HTTPResult::Pending(_) => {}
        }

        if let Some(node_response) = node_http_response {
            let node_response = unsafe { &mut *node_response };
            if !node_response.flags.upgraded && node_response.raw_response.is_some() {
                let raw_response = node_response.raw_response.unwrap();
                if !node_response.flags.request_has_completed && raw_response.state().is_response_pending() {
                    node_response.set_on_aborted_handler();
                }
                // If we ended the response without attaching an ondata handler, we discard the body read stream
                else if !matches!(http_result, HTTPResult::Pending(_)) {
                    node_response.maybe_stop_reading_body(vm, node_response.get_this_value());
                }
            }
        }
    }

    pub fn on_node_http_request(&mut self, req: &mut uws::Request, resp: &mut <Self::App as uws::AppTrait>::Response) {
        jsc::mark_binding!();
        self.on_node_http_request_with_upgrade_ctx(req, resp, None);
    }

    pub fn set_using_custom_expect_handler(&mut self, value: bool) {
        unsafe { NodeHTTP_setUsingCustomExpectHandler(SSL, self.app.unwrap() as *mut c_void, value) };
    }
