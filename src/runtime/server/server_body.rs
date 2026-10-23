use core::ffi::{c_int, c_void};
use core::mem;
use core::ptr::NonNull;
use std::io::Write as _;

use crate::api::js_bundler::PluginJscExt as _;
use crate::api::{SocketAddress, js_bundler as JSBundler};
use crate::bake::router as FrameworkRouter;
use crate::bake::{self as bake};
use crate::generated_bindgen::server::ServerProtocol;
use crate::node::types::PathLikeExt as _;
use crate::webcore::BlobExt;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::fetch as Fetch;
use crate::webcore::response::HeadersRef;
use crate::webcore::{AbortSignal, AnyBlob, Blob, FetchHeaders, Request, Response, request};
use ::bstr::BStr;
use bun_collections::HashMap;
use bun_core::{EncodedSlice, String as BunString, Utf8Bytes, strings};
use bun_core::{Output, fmt as bun_fmt};
use bun_http::header_has_token;
use bun_http::{self as http, Method, MimeType};
use bun_http_jsc::method_jsc;
use bun_http_types::Method::OwnedMethod;
use bun_jsc::Debugger::DebuggerId;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope, JsWrapper};
use bun_jsc::uuid::UUID;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, GlobalRef, JSGlobalObject, JSPromise, JSValue, JsError,
    JsResult, Node, StringJsc as _, VirtualMachine,
};
use bun_paths as paths;
use bun_ptr::{AsCtxPtr, RefPtr};
use bun_resolver::fs::FileSystem;
use bun_standalone_graph::StandaloneModuleGraph;
use bun_sys as sys;
use bun_url::URL;
use bun_uws::{self as uws, AnyWebSocket, ResponseKind, WebSocketUpgradeContext};
use bun_uws_sys as uws_sys;
use bun_wyhash::hash;

bun_output::declare_scope!(Server, visible);
bun_output::declare_scope!(RequestContext, visible);

macro_rules! httplog {
    ($($arg:tt)*) => { bun_output::scoped_log!(Server, $($arg)*) };
}
macro_rules! ctx_log {
    ($($arg:tt)*) => { bun_output::scoped_log!(RequestContext, $($arg)*) };
}

use bun_jsc::bun_string_jsc;

// ─── Re-exports ──────────────────────────────────────────────────────────────
pub(super) use super::html_bundle::{self as html_bundle, HTMLBundle};
// TODO: rename to StaticBlobRoute? the html bundle is sometimes a static route
pub(super) use super::any_request_context::AnyRequestContext;
pub(super) use super::file_route::FileRoute;
pub(super) use super::node_http_response::NodeHTTPResponse;
pub(super) use super::request_context::{DeferDeinitFlag, UpgradeState};
pub(super) use super::server_config::{self as server_config, ServerConfig};
pub(super) use super::server_web_socket::ServerWebSocket;
pub(super) use super::static_route::StaticRoute;

/// Answer a request that arrived after `finalize()` set the wrapper's
/// `JsRef` to `Finalized` (idle keep-alive sockets aren't counted in
/// `pending_requests`, so `self` can outlive the wrapper between the
/// finalizer and the next-tick `schedule_deinit`). 503 instead of
/// dispatching into a dead handler shadow. One helper so every dispatch
/// trampoline gets the same guard. H1 closes the connection; H2/H3 end only
/// this stream so sibling streams on the same connection
/// survive — same per-protocol close treatment as the other reject fast
/// paths.
#[inline]
pub(super) fn respond_stopped_503(resp: uws::AnyResponse) {
    resp.write_status(b"503 Service Unavailable");
    resp.end_without_body(matches!(
        resp,
        uws::AnyResponse::SSL(_) | uws::AnyResponse::TCP(_)
    ));
}

/// RFC 6455 §4.1: |Sec-WebSocket-Key| is the base64 encoding of a 16-byte
/// value, i.e. 22 base64 characters followed by `==`.
#[inline]
fn is_valid_sec_websocket_key(key: &[u8]) -> bool {
    key.len() == 24
        && key[22] == b'='
        && key[23] == b'='
        && key[..22]
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
}

// ─── BunInfo (moved from bun_core::Global) ───────────────────────────────────
// `generate()` builds the JSON AST by hand: an `E.Object` with
// `bun_version` (string) + `platform` (nested `E.Object` of `os`/`arch`/
// `version`, enums emitted as `@tagName` strings).
pub(crate) mod BunInfo {
    use bun_analytics::generate_header::generate_platform;
    use bun_analytics::{OperatingSystem, Platform};
    use bun_ast::Loc;
    use bun_ast::e::EString;
    use bun_ast::{E, Expr, G};
    use bun_core::Environment::Architecture;
    use bun_core::Global;

    pub(crate) struct BunInfo {
        pub(crate) bun_version: &'static [u8],
        pub(crate) platform: Platform,
    }

    fn os_tag_name(os: OperatingSystem) -> &'static [u8] {
        match os {
            OperatingSystem::Linux => b"linux",
            OperatingSystem::Macos => b"macos",
            OperatingSystem::Windows => b"windows",
            OperatingSystem::Wsl => b"wsl",
            OperatingSystem::Android => b"android",
            OperatingSystem::Freebsd => b"freebsd",
        }
    }

    fn arch_tag_name(arch: Architecture) -> &'static [u8] {
        match arch {
            Architecture::X64 => b"x64",
            Architecture::Arm64 => b"arm",
            Architecture::Wasm => b"wasm",
        }
    }

    #[inline]
    fn str_expr(s: &[u8]) -> Expr {
        Expr::init(EString::init(s), Loc::EMPTY)
    }

    #[inline]
    fn prop(key: &'static [u8], value: Expr) -> G::Property {
        G::Property {
            key: Some(str_expr(key)),
            value: Some(value),
            ..G::Property::default()
        }
    }

    /// `_transpiler` is an unused witness; expressions allocate from the
    /// global expr `Store` used by `Expr::init`.
    pub(crate) fn generate<B>(_transpiler: B) -> Result<Expr, crate::Error> {
        let info = BunInfo {
            bun_version: Global::package_json_version.as_bytes(),
            platform: generate_platform::for_os(),
        };

        // `JSON.toAST(allocator, BunInfo, info)` — hand-expanded:
        let platform_props = bun_alloc::AstAlloc::vec_from_iter([
            prop(b"os", str_expr(os_tag_name(info.platform.os))),
            prop(
                b"arch",
                str_expr(arch_tag_name(bun_core::Environment::ARCH)),
            ),
            prop(b"version", str_expr(info.platform.version)),
        ]);
        let platform_expr = Expr::init(
            E::Object {
                properties: platform_props,
                is_single_line: false,
                ..E::Object::default()
            },
            Loc::EMPTY,
        );

        let root_props = bun_alloc::AstAlloc::vec_from_iter([
            prop(b"bun_version", str_expr(info.bun_version)),
            prop(b"platform", platform_expr),
        ]);
        Ok(Expr::init(
            E::Object {
                properties: root_props,
                is_single_line: false,
                ..E::Object::default()
            },
            Loc::EMPTY,
        ))
    }
}

// ─── AnyRoute ────────────────────────────────────────────────────────────────
// The enum itself lives in mod.rs; this block adds the JS-facing constructors.
pub(super) use super::AnyRoute;

impl AnyRoute {
    fn bundled_html_manifest_item_from_js(
        argument: JSValue,
        index_path: &[u8],
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if !argument.is_object() {
            return Ok(None);
        }

        let Some(path_js) = argument.get(init_ctx.global, b"path")? else {
            return Ok(None);
        };
        let mut path = Node::PathOrFileDescriptor::Path(Node::PathLike::from_bun_string(
            init_ctx.global,
            BunString::from_js(path_js, init_ctx.global)?,
            false,
        )?);

        // Construct the route by stripping paths above the root.
        //
        //    "./index-abc.js" -> "/index-abc.js"
        //    "../index-abc.js" -> "/index-abc.js"
        //    "/index-abc.js" -> "/index-abc.js"
        //    "index-abc.js" -> "/index-abc.js"
        //
        let path_slice = path.path().slice();
        let cwd: &[u8] = if StandaloneModuleGraph::is_bun_standalone_file_path(path_slice) {
            StandaloneModuleGraph::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes()
        } else {
            FileSystem::instance().top_level_dir()
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

        let Some(headers_js) = argument.get(init_ctx.global, b"headers")? else {
            return Ok(None);
        };
        let fetch_headers = FetchHeaders::create_from_js(init_ctx.global, headers_js)?;
        let _fh_guard = scopeguard::guard(fetch_headers, |fh| {
            // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
            if let Some(h) = fh {
                bun_opaque::opaque_deref_mut(h.as_ptr()).deref();
            }
        });

        // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
        let headers_ref = fetch_headers.map(|p| bun_opaque::opaque_deref(p.as_ptr().cast_const()));
        let route = Self::from_options(init_ctx.global, headers_ref, &mut path)?;

        if is_index_route {
            return Ok(Some(route));
        }

        let mut methods =
            bun_http_types::Method::Optional::Method(bun_http_types::Method::Set::empty());
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
    fn bundled_html_manifest_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if !argument.is_object() {
            return Ok(None);
        }

        let Some(index) = argument.get_optional_slice(init_ctx.global, b"index")? else {
            return Ok(None);
        };

        let Some(files) = argument.get_array(init_ctx.global, b"files")? else {
            return Ok(None);
        };
        let mut iter = files.array_iterator(init_ctx.global)?;
        let mut html_route: Option<AnyRoute> = None;
        while let Some(file_entry) = iter.next()? {
            if let Some(item) =
                Self::bundled_html_manifest_item_from_js(file_entry, index.slice(), init_ctx)?
            {
                html_route = Some(item);
            }
        }

        Ok(html_route)
    }

    pub(crate) fn from_options(
        global: &JSGlobalObject,
        headers: Option<&FetchHeaders>,
        path: &mut Node::PathOrFileDescriptor<'static>,
    ) -> JsResult<AnyRoute> {
        // The file/static route doesn't ref it.
        let blob = <Blob as BlobExt>::find_or_create_file_from_path(path, global, false);

        if blob.needs_to_read_file() {
            // Throw a more helpful error upfront if the file does not exist.
            //
            // In production, you do NOT want to find out that all the assets
            // are 404'ing when the user goes to the route. You want to find
            // that out immediately so that the health check on startup fails
            // and the process exits with a non-zero status code.
            if let Some(store) = blob.store.get().as_deref() {
                if let Some(store_path) = store.get_path() {
                    // NOTE: `sys::exists_at_type` takes `&ZStr`; the store
                    // path is a borrowed byte slice. NUL-terminate into a path
                    // buffer for the syscall.
                    let mut buf = bun_paths::path_buffer_pool::get();
                    let zpath = bun_paths::resolve_path::z(store_path, &mut buf);
                    match sys::exists_at_type(sys::Fd::cwd(), zpath) {
                        Ok(sys::ExistsAtType::Directory) => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "Bundled file {} cannot be a directory. You may want to configure --asset-naming or `naming` when bundling.",
                                bun_fmt::quote(store_path)
                            )));
                        }
                        Ok(sys::ExistsAtType::File) => {}
                        Err(_) => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "Bundled file {} not found. You may want to configure --asset-naming or `naming` when bundling.",
                                bun_fmt::quote(store_path)
                            )));
                        }
                    }
                }
            }

            return Ok(AnyRoute::File(FileRoute::init_from_blob(
                global,
                blob,
                &super::file_route::InitOptions {
                    server: None,
                    status_code: 200,
                    headers,
                },
            )?));
        }

        Ok(AnyRoute::Static(
            StaticRoute::init_from_any_blob_with_headers(
                global,
                AnyBlob::Blob(blob),
                headers,
                200,
            )?,
        ))
    }

    pub(crate) fn html_route_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        use bun_collections::zig_hash_map::MapEntry as StdEntry;
        if let Some(html_bundle) = argument.as_class_this_ptr::<HTMLBundle>() {
            let entry = init_ctx
                .dedupe_html_bundle_map
                .entry(html_bundle.as_ptr().cast_const());
            // HashMap aborts on OOM (repo-wide abort-on-OOM policy).
            return Ok(Some(match entry {
                StdEntry::Vacant(v) => {
                    // The rc=1 `Route::init(..)` is returned to the caller; the
                    // map slot is a non-owning back-reference for deduping later
                    // entries in this same config.
                    let route = html_bundle::Route::init(html_bundle);
                    v.insert(route.this_ptr().into());
                    AnyRoute::Html(route)
                }
                StdEntry::Occupied(o) => AnyRoute::Html(RefPtr::from_this(o.get().this_ptr())),
            }));
        }

        if let Some(html_route) = Self::bundled_html_manifest_from_js(argument, init_ctx)? {
            return Ok(Some(html_route));
        }

        Ok(None)
    }

    pub(crate) fn from_js(
        global: &JSGlobalObject,
        path: &[u8],
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if let Some(html_route) = AnyRoute::html_route_from_js(argument, init_ctx)? {
            return Ok(Some(html_route));
        }

        if argument.is_object() {
            if let Some(dir) = argument.get_optional_slice(global, b"dir")? {
                if !strings::ends_with(path, b"/*") {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "To mount a directory, make sure the path ends in `/*`"
                    )));
                }

                let style_js = argument.get(global, b"style")?;
                if style_js.is_none() {
                    if strings::index_of_char(path, b':').is_some() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Directory routes do not support :parameters; use a fixed prefix ending in `/*`"
                        )));
                    }
                    if strings::contains(path, b"//") {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Directory route paths cannot contain empty segments"
                        )));
                    }
                    // `{ dir }` without `style` serves the directory tree
                    // verbatim; `{ dir, style }` opts into framework routing.
                    let url_prefix: &[u8] = if path.len() == 2 {
                        b"/"
                    } else {
                        &path[..path.len() - 1]
                    };
                    let stat_cache = argument
                        .get_boolean_loose(global, b"statCache")?
                        .unwrap_or(true);
                    let route =
                        super::DirectoryRoute::create(global, &dir, url_prefix, stat_cache)?;
                    return Ok(Some(AnyRoute::Directory(route)));
                }

                let style: FrameworkRouter::Style =
                    FrameworkRouter::Style::from_js(style_js.unwrap(), global)?;
                // Style impls Drop; `?` drops it on the error path.

                // trim the /*
                let prefix = if path.len() == 2 {
                    Utf8Bytes::Borrowed(b"/")
                } else {
                    Utf8Bytes::Owned(path[..path.len() - 2].to_vec())
                };
                init_ctx
                    .framework_router_list
                    .push(bake::FileSystemRouterType {
                        root: dir,
                        style,
                        prefix,
                        // TODO: customizable framework option.
                        entry_client: Some(Utf8Bytes::Borrowed(b"bun-framework-react/client.tsx")),
                        entry_server: Utf8Bytes::Borrowed(b"bun-framework-react/server.tsx"),
                        ignore_underscores: true,
                        ignore_dirs: vec![
                            Utf8Bytes::Borrowed(b"node_modules".as_slice()),
                            Utf8Bytes::Borrowed(b".git".as_slice()),
                        ],
                        extensions: vec![
                            Utf8Bytes::Borrowed(b".tsx".as_slice()),
                            Utf8Bytes::Borrowed(b".jsx".as_slice()),
                        ],
                        allow_layouts: true,
                        client_pages: false,
                        server_exports: Vec::new(),
                    });

                // `@typeInfo(FrameworkRouter.Type.Index).@"enum".tag_type` → the index newtype's backing-int MAX.
                let limit = u8::MAX as usize;
                if init_ctx.framework_router_list.len() > limit {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Too many framework routers. Maximum is {}.",
                        limit
                    )));
                }
                return Ok(Some(AnyRoute::FrameworkRouter));
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

pub(crate) struct ServerInitContext<'a> {
    pub(crate) dedupe_html_bundle_map:
        HashMap<*const HTMLBundle, bun_ptr::BackRef<html_bundle::Route, bun_ptr::Root>>,
    pub global: &'a JSGlobalObject,
    pub(crate) framework_router_list: Vec<bake::FileSystemRouterType>,
    pub(crate) user_routes: &'a mut Vec<server_config::StaticRouteEntry>,
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
/// State machine to handle loading plugins asynchronously. This structure is not thread-safe.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct ServePlugins {
    state: ServePluginsState,
    ref_count: core::cell::Cell<u32>,
}

// Reference count is incremented while there are other objects waiting on plugin loads.
pub(crate) enum ServePluginsState {
    Unqueued(Box<[Box<[u8]>]>),
    Pending {
        /// Promise may be empty if the plugin load finishes synchronously.
        plugin: Box<JSBundler::Plugin>,
        promise: jsc::JSPromiseStrong,
        /// Each holds a ref, released once the route is told the outcome.
        html_bundle_routes: Vec<RefPtr<html_bundle::Route>>,
        /// Server whose DevServer is waiting for the plugins to load.
        dev_server: Option<super::AnyServer>,
    },
    Loaded(Box<JSBundler::Plugin>),
    /// Error information is not stored as it is already reported.
    Err,
}

pub(crate) enum GetOrStartLoadResult<'a> {
    /// None = no plugins, used by server implementation
    Ready(Option<&'a JSBundler::Plugin>),
    Pending,
    Err,
}

#[derive(Clone, Copy)]
pub(crate) enum ServePluginsCallback {
    HtmlBundleRoute(bun_ptr::ThisPtr<html_bundle::Route>),
    /// The calling server's DevServer.
    DevServer,
}

impl ServePlugins {
    pub(crate) fn init(plugins: Box<[Box<[u8]>]>) -> RefPtr<ServePlugins> {
        RefPtr::new(ServePlugins {
            ref_count: core::cell::Cell::new(1),
            state: ServePluginsState::Unqueued(plugins),
        })
    }

    pub(crate) fn get_or_start_load(
        &mut self,
        global: &JSGlobalObject,
        cb: ServePluginsCallback,
        server: super::AnyServer,
    ) -> JsResult<GetOrStartLoadResult<'_>> {
        loop {
            match &mut self.state {
                ServePluginsState::Unqueued(_) => {
                    self.load_and_resolve_plugins(global)?;
                    // could jump to any branch if synchronously resolved
                    continue;
                }
                ServePluginsState::Pending {
                    html_bundle_routes,
                    dev_server,
                    ..
                } => {
                    match cb {
                        ServePluginsCallback::HtmlBundleRoute(route) => {
                            html_bundle_routes.push(RefPtr::from_this(route));
                        }
                        ServePluginsCallback::DevServer => {
                            // one dev server per server
                            debug_assert!(dev_server.is_none_or(|s| s == server));
                            *dev_server = Some(server);
                        }
                    }
                    return Ok(GetOrStartLoadResult::Pending);
                }
                ServePluginsState::Loaded(_) => break,
                ServePluginsState::Err => return Ok(GetOrStartLoadResult::Err),
            }
        }
        // NOTE: split out of the loop so the `Loaded` arm's borrow of
        // `self.state` doesn't conflict with the `Unqueued` arm's `&mut self`.
        match &mut self.state {
            ServePluginsState::Loaded(plugins) => Ok(GetOrStartLoadResult::Ready(Some(plugins))),
            _ => unreachable!(),
        }
    }

    fn load_and_resolve_plugins(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        debug_assert!(matches!(self.state, ServePluginsState::Unqueued(_)));
        let ServePluginsState::Unqueued(plugin_list) = &self.state else {
            unreachable!()
        };
        // NOTE: reshaped for borrowck — clone the slice refs so we can mutate self.state below
        let plugin_list: Vec<_> = plugin_list.iter().collect();
        let bunfig_path: &[u8] = &global.bun_vm().transpiler.options.bunfig_path;
        // With no bunfig.toml, only `bake.config.ts` has plugins: their root is the project.
        let bunfig_folder: &[u8] = if bunfig_path.is_empty() {
            FileSystem::instance().top_level_dir()
        } else {
            bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Auto>(bunfig_path)
        };

        // NOTE: the keep-alive ref/deref pair
        // lives in the caller (`get_or_load_plugins`), which holds the heap-allocated
        // `*mut ServePlugins` directly. Deriving the guard's pointer from `&mut self`
        // here would give it a tag that is invalidated by the writes to `self.state`
        // below (Stacked Borrows), making the eventual `heap::take` in `deref_` UB.

        let plugin = JSBundler::Plugin::create(global, JSBundler::BunPluginTarget::Browser);
        // SAFETY: `Plugin::create` returns a freshly-boxed `*mut Plugin` (single owner).
        let plugin: Box<JSBundler::Plugin> = unsafe { bun_core::heap::take(plugin) };
        let mut bunstring_array: Vec<BunString> = Vec::with_capacity(plugin_list.len());
        for raw_plugin in &plugin_list {
            bunstring_array.push(BunString::from_bytes(raw_plugin));
        }
        let plugin_js_array = bun_string_jsc::to_js_array(global, &bunstring_array)?;
        // `bun bake`: the plugin objects of `bake.config.ts`, after the names of bunfig.toml.
        if let Some(config_plugins) = global.bun_vm().bake_config_plugins.get() {
            let mut iter = config_plugins.array_iterator(global)?;
            while let Some(config_plugin) = iter.next()? {
                plugin_js_array.push(global, config_plugin)?;
            }
        }
        let bunfig_folder_bunstr = bun_string_jsc::create_utf8_for_js(global, bunfig_folder)?;

        self.state = ServePluginsState::Pending {
            promise: jsc::JSPromiseStrong::init(global),
            plugin,
            html_bundle_routes: Vec::new(),
            dev_server: None,
        };

        global.bun_vm().event_loop_mut().enter();
        let result = jsc::host_fn::from_js_host_call(global, || {
            match &self.state {
                ServePluginsState::Pending { plugin, .. } => plugin.as_ref(),
                _ => unreachable!(),
            }
            .load_and_resolve_plugins_for_serve(plugin_js_array, bunfig_folder_bunstr)
        })?;
        global.bun_vm().event_loop_mut().exit();

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
                    jsc::js_promise::Status::Pending => {
                        // The reaction's ref, adopted by `on_resolve_impl`/`on_reject_impl`.
                        self.ref_();
                        let promise_value = promise.as_value();
                        if let ServePluginsState::Pending {
                            promise: pending_promise,
                            ..
                        } = &mut self.state
                        {
                            pending_promise.set(global, promise_value);
                        }
                        promise_value.then(
                            global,
                            std::ptr::from_mut::<Self>(self),
                            __jsc_host_on_resolve_impl,
                            __jsc_host_on_reject_impl,
                        );
                        return Ok(());
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        self.handle_on_resolve();
                        return Ok(());
                    }
                    jsc::js_promise::Status::Rejected => {
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

    pub(crate) fn handle_on_resolve(&mut self) {
        debug_assert!(matches!(self.state, ServePluginsState::Pending { .. }));
        let ServePluginsState::Pending {
            plugin,
            dev_server,
            html_bundle_routes,
            promise,
        } = mem::replace(&mut self.state, ServePluginsState::Err)
        else {
            unreachable!()
        };
        drop(promise); // Drop on JscStrong releases the slot.

        self.state = ServePluginsState::Loaded(plugin);
        let plugin_ref = match &self.state {
            ServePluginsState::Loaded(p) => &**p,
            _ => unreachable!(),
        };

        for route in html_bundle_routes {
            bun_core::handle_oom(html_bundle::Route::on_plugins_resolved(
                route.this_ptr(),
                Some(NonNull::from(plugin_ref)),
            ));
        }
        if let Some(server) = dev_server {
            if let Some(dev) = server.dev_server_mut() {
                bun_core::handle_oom(dev.on_plugins_resolved(Some(
                    std::ptr::from_ref::<JSBundler::Plugin>(plugin_ref).cast_mut(),
                )));
            }
        }
    }

    pub(crate) fn handle_on_reject(&mut self, global: &JSGlobalObject, err: JSValue) {
        debug_assert!(matches!(self.state, ServePluginsState::Pending { .. }));
        let ServePluginsState::Pending {
            plugin,
            dev_server,
            html_bundle_routes,
            promise,
        } = mem::replace(&mut self.state, ServePluginsState::Err)
        else {
            unreachable!()
        };
        drop(plugin); // pending.plugin.deinit()
        drop(promise); // Drop on JscStrong releases the slot.

        for route in html_bundle_routes {
            bun_core::handle_oom(route.on_plugins_rejected());
        }
        if let Some(server) = dev_server {
            if let Some(dev) = server.dev_server_mut() {
                bun_core::handle_oom(dev.on_plugins_rejected());
            }
        }

        Output::err_generic("Failed to load plugins for Bun.serve:", ());
        global.bun_vm().as_mut().run_error_handler(err, None);
    }

    /// Clears the pending `server` before it's freed, so a load that settles later can't call into it.
    pub(crate) fn forget_server(&mut self, server: super::AnyServer) {
        if let ServePluginsState::Pending { dev_server, .. } = &mut self.state {
            if *dev_server == Some(server) {
                *dev_server = None;
            }
        }
    }
}

impl Drop for ServePlugins {
    fn drop(&mut self) {
        match &self.state {
            ServePluginsState::Unqueued(_) => {}
            ServePluginsState::Pending { .. } => debug_assert!(false), // should have one ref while pending!
            ServePluginsState::Loaded(_) => {}                         // Box<Plugin> drops
            ServePluginsState::Err => {}
        }
    }
}

#[bun_jsc::host_fn(export = "BunServe__onResolvePlugins")]
fn on_resolve_impl(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onResolve");

    let [plugins_result, plugins_js] = callframe.arguments_as_array::<2>();
    let plugins = plugins_js.as_promise_ptr::<ServePlugins>();
    // SAFETY: `plugins` was heap-allocated and ref()'d before .then(); this adopts that ref.
    let _guard = unsafe { RefPtr::from_raw(plugins) };
    plugins_result.ensure_still_alive();

    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_resolve();

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "BunServe__onRejectPlugins")]
fn on_reject_impl(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onReject");

    let [error_js, plugin_js] = callframe.arguments_as_array::<2>();
    let plugins = plugin_js.as_promise_ptr::<ServePlugins>();
    // SAFETY: `plugins` was heap-allocated and ref()'d before .then(); this adopts that ref.
    let _guard = unsafe { RefPtr::from_raw(plugins) };
    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_reject(global, error_js);

    Ok(JSValue::UNDEFINED)
}

/// The `options` argument of `server.upgrade(request, options)`. Each property is read once.
struct UpgradeOptions {
    data: JSValue,
    headers: Option<NonNull<FetchHeaders>>,
    /// `Sec-WebSocket-Protocol` from `headers`. An empty value rejects every protocol the
    /// client offered.
    protocol: Option<bun_core::Utf8Bytes<'static>>,
    /// These keep `headers` alive. It points into either the caller's `Headers` object or the
    /// `FetchHeaders` converted from the caller's HeadersInit.
    _headers_object: jsc::EnsureStillAlive,
    _headers_converted: Option<HeadersRef>,
}

impl UpgradeOptions {
    fn from_js(global: &JSGlobalObject, options: JSValue) -> JsResult<Self> {
        let mut this = Self {
            data: JSValue::ZERO,
            headers: None,
            protocol: None,
            _headers_object: jsc::EnsureStillAlive(JSValue::UNDEFINED),
            _headers_converted: None,
        };
        if options.is_undefined_or_null() {
            return Ok(this);
        }
        if !options.is_object() {
            return Err(
                global.throw_invalid_arguments(format_args!("upgrade options must be an object"))
            );
        }
        if let Some(data) = options.fast_get(global, jsc::BuiltinName::Data)? {
            this.data = data;
        }
        let Some(headers_value) = options
            .fast_get(global, jsc::BuiltinName::Headers)?
            .filter(|headers| !headers.is_empty_or_undefined_or_null())
        else {
            return Ok(this);
        };
        if let Some(headers) = FetchHeaders::cast_as_init(headers_value) {
            this.headers = Some(headers);
            this._headers_object = jsc::EnsureStillAlive(headers_value);
        } else if headers_value.is_object() {
            // `None` for an empty HeadersInit.
            this._headers_converted = HeadersRef::create_from_js(global, headers_value)?;
            this.headers = this
                ._headers_converted
                .as_ref()
                .and_then(|headers| NonNull::new(headers.as_ptr()));
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "upgrade options.headers must be a Headers or an object"
            )));
        }
        if let Some(headers) = this.headers()
            && headers.fast_has(jsc::HTTPHeaderName::SecWebSocketProtocol)
        {
            this.protocol = Some(
                headers
                    .fast_get(jsc::HTTPHeaderName::SecWebSocketProtocol)
                    .map_or(bun_core::Utf8Bytes::EMPTY, |protocol| {
                        protocol.to_utf8().into_owned()
                    }),
            );
        }
        Ok(this)
    }

    fn headers<'a>(&self) -> Option<&'a mut FetchHeaders> {
        // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
        self.headers
            .map(|headers| bun_opaque::opaque_deref_mut(headers.as_ptr()))
    }
}

/// Set once the development-mode idle timeout warning was printed, by any server of the process.
static IDLE_TIMEOUT_WARNED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// uWS skips a timeout handler whose user data is null. The handler ignores it.
fn idle_timeout_warning_user_data() -> *mut c_void {
    IDLE_TIMEOUT_WARNED.as_ptr().cast::<c_void>()
}

fn warn_about_idle_timeout_once() {
    if !crate::cli::Command::get().debug.silent
        && !IDLE_TIMEOUT_WARNED.swap(true, core::sync::atomic::Ordering::Relaxed)
    {
        bun_core::warn!(
            "Bun.serve() timed out a request after 10 seconds. Pass `idleTimeout` to configure."
        );
    }
}

// ─── NewServer ───────────────────────────────────────────────────────────────
// ─── NewServer (canonical type lives in mod.rs) ──────────────────────────────
// NOTE (unification): the struct, `UserRoute`,
// `CreateJsRequest`, `PreparedRequest`, `SavedRequest`, `SavedRequestUnion`,
// `ServerAllConnectionsClosedTask`, `AnyServer` and the four type aliases are
// defined once in `super` (mod.rs). This file contributes additional inherent
// methods on the same type — there is no separate Phase-A struct.
pub(super) use super::{
    CreateJsRequest, DetachRequestOnDrop, NewServer, PreparedRequest, ServerRequestContext,
    UserRoute,
};

impl<const SSL: bool, const DEBUG: bool> uws_sys::web_socket::WebSocketUpgradeServer<SSL>
    for NewServer<SSL, DEBUG>
{
    /// `this` is the user data registered with `app.ws(..)`: a `*mut UserRoute<SSL, DEBUG>` for `id == 1`, a `*mut Self` for `id == 0`.
    unsafe fn on_websocket_upgrade(
        this: *mut Self,
        res: *mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws_sys::Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        let (req, resp) = (
            uws::AnyRequest::H1(req),
            super::any_response_from::<SSL>(res),
        );
        if id == 1 {
            // SAFETY: fn contract. No `&Self` was made from the pointer.
            let user_route = unsafe { &*this.cast::<UserRoute<SSL, DEBUG>>() };
            Self::on_user_route_request::<false>(user_route, req, resp, Some(upgrade_ctx));
            return;
        }
        debug_assert!(id == 0);
        // SAFETY: fn contract.
        if unsafe { &*this }.config.get().on_request.is_empty() {
            // Only a handler can call `server.upgrade()`.
            resp.write_status(b"403 Forbidden");
            resp.end_without_body(true);
            return;
        }
        Self::on_request::<false>(this, req, resp, Some(upgrade_ctx));
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    /// Construct the cross-module `super::AnyServer` back-reference. Routes
    /// (StaticRoute/FileRoute/HTMLBundle) store this so they can call back
    /// into `on_pending_request` / `on_request_complete`.
    #[inline]
    fn as_any_server(&self) -> super::AnyServer {
        super::AnyServer::from(std::ptr::from_ref::<Self>(self))
    }

    /// Shared `&JSGlobalObject` accessor (struct stores it as `*const`).
    #[inline(always)]
    fn global(&self) -> GlobalRef {
        // `global_this` is set in `init()`; non-null and valid for the
        // server's lifetime (LIFETIMES.tsv: STATIC).
        GlobalRef::from(bun_opaque::opaque_deref(self.global_this))
    }

    /// `&mut` accessor for the live uws App. Only call from paths where the
    /// server is running (`self.app` set in `listen()`).
    #[inline]
    fn app_mut(&self) -> &mut uws_sys::NewApp<SSL> {
        // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref via
        // const-asserted `bun_opaque::opaque_deref_mut`. `self.app` is `Some`
        // for the lifetime of any JS-reachable `Server` (set in `listen()`,
        // freed in `deinit()` after the JS wrapper is gone).
        bun_opaque::opaque_deref_mut(self.app.get().expect("server not listening"))
    }

    /// Unbounded so `deinit()` (in
    /// the unbounded `impl NewServer` in mod.rs) can call it without naming
    /// the per-transport `RequestContext` bounds.
    pub(super) fn notify_inspector_server_stopped(&self) {
        if self.inspector_server_id.get().get() != 0 {
            bun_core::hint::cold();
            if let Some(debugger) = &self.vm().as_mut().debugger {
                bun_core::hint::cold();
                // NOTE (layering): the `HTTPServerAgent.notifyServerStopped`
                // wrapper lives in
                // `super::http_server_agent` so this crate-tier call doesn't
                // re-declare the C ABI.
                super::http_server_agent::notify_server_stopped(
                    &debugger.http_server_agent,
                    self.as_any_server(),
                );
                // Only clear the id once the agent has been notified, so a
                // call that races a not-yet-attached debugger leaves the id set
                // for a later retry.
                self.inspector_server_id.set(DebuggerId::init(0));
            }
        }
    }

    /// node:http 'clientError'. `callback(socketHandle, errorCode, rawPacket)`.
    pub(crate) fn set_on_client_error(&self, global: &JSGlobalObject, callback: JSValue) {
        let (Some(server_js), Some(app)) = (self.js_value_for_dispatch(), self.app.get()) else {
            return;
        };
        let mut on_clienterror = callback;
        super::wrap_handler_slot(
            &mut on_clienterror,
            server_js,
            global,
            Self::js_gc_on_client_error_set,
        );
        self.on_clienterror.set(on_clienterror);
        extern "C" fn thunk<const SSL: bool, const DEBUG: bool>(
            user_data: *mut c_void,
            _ssl: c_int,
            socket: *mut uws_sys::us_socket_t,
            error_code: u8,
            raw_packet: *mut u8,
            raw_packet_len: c_int,
        ) {
            // SAFETY: `user_data` is the server registered below, which outlives its connections. Shared, because the callback re-enters JS.
            let this = unsafe { &*user_data.cast::<NewServer<SSL, DEBUG>>() };
            let packet: &[u8] = if raw_packet_len > 0 {
                // SAFETY: uWS guarantees `raw_packet` points to `raw_packet_len` readable bytes when `raw_packet_len > 0`.
                unsafe { bun_core::ffi::slice(raw_packet, raw_packet_len as usize) }
            } else {
                &[]
            };
            crate::dispatch::fold(this.on_client_error_callback(
                bun_opaque::opaque_deref_mut(socket),
                error_code,
                packet,
            ));
        }
        bun_opaque::opaque_deref_mut(app)
            .on_client_error(thunk::<SSL, DEBUG>, self.as_ctx_ptr().cast::<c_void>());
    }

    pub(crate) fn on_client_error_callback(
        &self,
        socket: &mut uws::Socket,
        error_code: u8,
        raw_packet: &[u8],
    ) -> JsResult<()> {
        if self.js_value_for_dispatch().is_none() {
            return Ok(());
        }
        let callback = self.on_clienterror.get();
        if callback.is_empty() {
            return Ok(());
        }
        {
            let is_ssl = SSL;
            let global = self.global();
            let node_socket = jsc::from_js_host_call(&global, || {
                Bun__getOrCreateNodeHTTPServerSocket(
                    is_ssl,
                    std::ptr::from_mut(socket).cast::<c_void>(),
                    &global,
                    self.node_socket_config_ptr(),
                )
            })?;
            if node_socket.is_undefined_or_null() {
                return Ok(());
            }

            let error_code_value = JSValue::js_number(error_code as f64);
            let raw_packet_value = ArrayBuffer::create_buffer(&global, raw_packet)?;
            // SAFETY: event_loop() returns a live raw pointer tied to the global.
            let _scope =
                unsafe { jsc::event_loop::EventLoop::enter_scope(global.bun_vm().event_loop()) };
            callback.call(
                &global,
                JSValue::UNDEFINED,
                &[node_socket, error_code_value, raw_packet_value],
            )?;
        }
        Ok(())
    }

    /// node:http: makes the connection's socket handle at TCP accept. node:net's `open` handler emits 'connection'.
    fn on_accept(&self, socket: *mut c_void) -> JsResult<()> {
        if self.js_value_for_dispatch().is_none() {
            return Ok(());
        }
        let global = self.global();
        // SAFETY: event_loop() returns a live raw pointer tied to the global.
        let _scope =
            unsafe { jsc::event_loop::EventLoop::enter_scope(global.bun_vm().event_loop()) };
        jsc::from_js_host_call(&global, || {
            Bun__getOrCreateNodeHTTPServerSocket(
                SSL,
                socket,
                &global,
                self.node_socket_config_ptr(),
            )
        })?;
        Ok(())
    }
}

fn request_ip(config: &ServerConfig, cx: &mut JsScope<'_>, request: &Request) -> JsResult<JSValue> {
    if config.address.is_unix() {
        return Ok(JSValue::NULL);
    }
    let Some(info) = request.request_context.get_remote_socket_info() else {
        return Ok(JSValue::NULL);
    };
    crate::socket::socket_address::SocketAddress::create_dto(
        cx.global(),
        &info.ip,
        u16::try_from(info.port).expect("int cast"),
        info.is_ipv6,
    )
}

fn set_request_timeout<'a>(
    heap: &JsHeap<'a>,
    request: JsLocal<'a>,
    seconds: JsLocal<'a>,
) -> bindgen::Result<'a, ()> {
    let (request, seconds) = (request.to_js(), seconds.to_js());

    if request.is_undefined_or_null() {
        return Err(heap.error_with_code(
            jsc::ErrorCode::MISSING_ARGS,
            format_args!("Not enough arguments to 'timeout'. Expected 2."),
        ));
    }

    if !seconds.is_number() {
        return Err(heap.error(format_args!("timeout() requires a number")));
    }
    let value = seconds.to_u32();

    if let Some(request) = request.as_class_ref::<Request>() {
        let _ = request.request_context.set_timeout(value);
    } else if let Some(response) = request.as_class_ref::<NodeHTTPResponse>() {
        response.set_timeout((value % 255) as u8);
    } else {
        return Err(heap.invalid_arguments(format_args!("timeout() requires a Request object")));
    }

    Ok(())
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub(crate) fn get_or_load_plugins(
        &self,
        callback: ServePluginsCallback,
    ) -> GetOrStartLoadResult<'_> {
        if let Some(p) = self.plugins.get() {
            // Keep `*p` alive across re-entrant JS in `load_and_resolve_plugins`.
            let p = p.clone();
            let global = self.global();
            let server = self.as_any_server();
            // SAFETY: intrusive refcount permits mutation through any owner. No
            // other `&mut ServePlugins` is live on this (single-threaded) JS
            // thread for the call's duration.
            return match unsafe { &mut *p.as_ptr() }.get_or_start_load(&global, callback, server) {
                Ok(r) => r,
                Err(JsError::Thrown | JsError::Terminated) => {
                    panic!("unhandled exception from ServePlugins.getStartOrLoad")
                }
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            };
        }
        // no plugins
        GetOrStartLoadResult::Ready(None)
    }

    pub(crate) fn subscriber_count(
        &self,
        cx: &mut JsScope<'_>,
        topic: JsLocal<'_>,
    ) -> JsResult<u32> {
        let global = cx.global();
        let topic = topic.to_js();

        if topic.is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!(
                "subscriberCount requires a topic name as a string"
            )));
        }

        let topic_view = topic.to_js_string_view(global)?;
        let topic = topic_view.to_utf8();

        if topic.slice().is_empty() {
            return Ok(0);
        }

        Ok(self.app_mut().num_subscribers(topic.slice()))
    }

    pub(crate) fn publish(
        &self,
        cx: &mut JsScope<'_>,
        topic: JsLocal<'_>,
        rest: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        use super::server_web_socket::{Accept, payload_from_js, send_status_to_js};

        let global = cx.global();
        let topic = topic.to_js();
        if topic.is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!("Expected string")));
        }
        let topic_view = topic.to_js_string_view(global)?;
        let topic = topic_view.to_utf8();
        let Some((data, rest)) = rest.split_first() else {
            return Err(global.throw_invalid_arguments(format_args!("Missing argument")));
        };
        let compress = rest
            .first()
            .map_or(JSValue::UNDEFINED, |compress| compress.to_js());
        let compress = compress.is_undefined() || compress.to_boolean();
        let payload = payload_from_js(global, "publish", data.to_js(), Accept::AnyOrNullish)?;
        let bytes = payload.bytes();

        if self.config.get().websocket.is_none() {
            return Ok(JSValue::js_number(0.0));
        }
        if topic.slice().is_empty() {
            return Err(global.throw(format_args!("publish requires a topic string")));
        }
        let Some(app) = self.app.get() else {
            return Ok(JSValue::js_number(0.0));
        };
        let status = AnyWebSocket::publish_with_options(
            SSL,
            app.cast::<c_void>(),
            topic.slice(),
            bytes.slice(),
            payload.opcode(),
            compress,
        );
        Ok(send_status_to_js(status, bytes.len(), "publish"))
    }

    pub(crate) fn request_ip(&self, cx: &mut JsScope<'_>, request: &Request) -> JsResult<JSValue> {
        request_ip(self.config.get(), cx, request)
    }

    pub(crate) fn timeout<'a>(
        &self,
        heap: &JsHeap<'a>,
        request: JsLocal<'a>,
        seconds: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        set_request_timeout(heap, request, seconds)
    }

    pub(crate) fn upgrade(
        &self,
        cx: &mut JsScope<'_>,
        request: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<bool> {
        use bun_core::Utf8Bytes;
        use bun_jsc::HTTPHeaderName;

        let global = cx.global();
        let request = request.to_js();

        if self.config.get().websocket.is_none() {
            return Err(global.throw_invalid_arguments(format_args!(
                "To enable websocket support, set the \"websocket\" object in Bun.serve({{}})"
            )));
        }

        if self.terminated.get() {
            return Ok(false);
        }

        let Some(request_ptr) = <Request as bun_jsc::JsClass>::from_js(request) else {
            return Err(
                global.throw_invalid_arguments(format_args!("upgrade requires a Request object"))
            );
        };
        // SAFETY: from_js returns a live *mut Request (rooted by the caller's
        // argument). Shared, re-derived after each JS re-entry point below; the
        // one field write at the end goes through `request_ptr`.
        let request = unsafe { &*request_ptr };

        if request
            .request_context
            .server_ptr()
            .is_some_and(|owner| !core::ptr::addr_eq(owner, &raw const *self))
        {
            return Err(global.throw_invalid_arguments(format_args!(
                "upgrade() must be called on the same server that received the request"
            )));
        }

        let Some(upgrader_ptr) = request
            .request_context
            .get::<ServerRequestContext<SSL, DEBUG, false>>()
        else {
            return Ok(false);
        };
        // SAFETY: tagged pointer just matched this monomorphization.
        let upgrader = unsafe { &*upgrader_ptr };

        if upgrader.is_aborted_or_ended() {
            return Ok(false);
        }

        let UpgradeState::Pending(upgrade_ctx) = upgrader.upgrade_context.get() else {
            return Ok(false);
        };

        let Some(resp) = upgrader.resp.get() else {
            return Ok(false);
        };

        // Keep the upgrader alive across option getters below, which run
        // arbitrary user JS. A re-entrant server.upgrade(req) from a getter
        // would otherwise be able to deref this context out from under us.
        upgrader.ref_();
        let _upgrader_guard = scopeguard::guard(upgrader_ptr, |p| {
            // SAFETY: `p` is the live `upgrader_ptr` whose refcount was bumped by
            // the `ref_()` above; this guard pairs it with a single `deref()`.
            unsafe { (*p).deref() }
        });

        // Validate the handshake against `request.headers`, never the raw uWS request.
        // Copy the values, because the option getters below can modify the headers.
        let Some(head) = request.get_fetch_headers_unless_empty() else {
            return Ok(false);
        };
        let mut header = |name: HTTPHeaderName| {
            head.fast_get(name)
                .map_or(Utf8Bytes::EMPTY, |value| value.to_utf8().into_owned())
        };
        let upgrade_header = header(HTTPHeaderName::Upgrade);
        let sec_websocket_key = header(HTTPHeaderName::SecWebSocketKey);
        let sec_websocket_version = header(HTTPHeaderName::SecWebSocketVersion);
        let sec_websocket_extensions = header(HTTPHeaderName::SecWebSocketExtensions);
        let offered_protocols = header(HTTPHeaderName::SecWebSocketProtocol);

        // RFC 6455 §4.2.1: a WebSocket handshake needs "websocket" in |Upgrade| and 16
        // base64-encoded bytes in |Sec-WebSocket-Key|. Otherwise fall through so the caller's
        // fetch() can respond. |Connection| isn't checked: it's hop-by-hop, so a proxy may have
        // rewritten it.
        if !header_has_token(&upgrade_header, b"websocket")
            || !is_valid_sec_websocket_key(&sec_websocket_key)
        {
            return Ok(false);
        }
        // RFC 6455 §4.4: an unsupported |Sec-WebSocket-Version| MUST be
        // answered with an HTTP error and a |Sec-WebSocket-Version| header
        // listing the versions the server understands.
        if sec_websocket_version.slice() != b"13" {
            resp.write_status(b"426 Upgrade Required");
            resp.write_header(b"Sec-WebSocket-Version", b"13");
            upgrader.flags.set_has_written_status(true);
            upgrader.end_without_body(true);
            return Ok(false);
        }

        let options = UpgradeOptions::from_js(global, options.to_js())?;
        let sec_websocket_protocol = options.protocol.as_deref().unwrap_or(&offered_protocols);

        // The option getters may have already upgraded, responded to, or closed the request.
        if upgrader.is_aborted_or_ended()
            || !matches!(upgrader.upgrade_context.get(), UpgradeState::Pending(_))
            || !resp.can_upgrade()
        {
            return Ok(false);
        }

        // `CookieMapRef` releases the moved-out ref once `cookies_to_write` drops.
        let mut cookies_to_write = upgrader.cookies.replace(None);

        let mut upgraded: JsResult<bool> = Ok(false);
        // Cork once for the whole 101 response. `HttpResponse::upgrade()` transfers the cork to
        // the WebSocket and then releases it.
        resp.corked(|| {
            if options.headers.is_some() || cookies_to_write.is_some() {
                resp.write_status(b"101 Switching Protocols");
                if let Some(headers) = options.headers() {
                    headers
                        .to_uws_response_for_websocket_upgrade(SSL, resp.socket().cast::<c_void>());
                }
                if let Some(c) = cookies_to_write.as_mut()
                    && let Err(err) = c.write(
                        global,
                        if SSL {
                            ResponseKind::Ssl
                        } else {
                            ResponseKind::Tcp
                        },
                        resp.socket().cast::<c_void>(),
                    )
                {
                    upgraded = Err(err);
                    return;
                }
            }

            // --- After this point, do not throw an exception
            // See https://github.com/oven-sh/bun/issues/1339
            upgrader.upgrade_context.set(UpgradeState::Upgraded);
            let signal = upgrader.signal.take();
            upgrader.resp.set(None);

            // Snapshot the lazy url before detaching (mirrors to_async_without_abort_handler).
            // SAFETY: re-derived after the JS-running option getters above; still
            // the live JsClass payload for `request`.
            let request = unsafe { &*request_ptr };
            if request.ensure_url().is_err() {
                request.url.set(BunString::EMPTY);
            }

            // SAFETY: plain-field detach through the root pointer; the shared
            // borrow above is not used past this point.
            unsafe { (*request_ptr).request_context = AnyRequestContext::NULL };
            upgrader.request_weakref.set(request::WeakRef::EMPTY);

            options.data.ensure_still_alive();
            let ws = ServerWebSocket::init(
                &self.config.get().websocket.as_ref().unwrap().handler,
                options.data,
                signal,
            );
            options.data.ensure_still_alive();

            resp.clear_aborted();
            resp.clear_on_data();
            resp.clear_on_writable();
            resp.clear_timeout();

            // The upgrade detaches the response and disarms onAborted, so neither
            // on_abort nor an end path can reclaim a parked handler promise's
            // claim later. Reclaim it here.
            upgrader.reclaim_promise_cell();
            upgrader.deref();

            if resp
                .upgrade(
                    ws,
                    sec_websocket_key.slice(),
                    sec_websocket_protocol,
                    sec_websocket_extensions.slice(),
                    // S008: `WebSocketUpgradeContext` is an `opaque_ffi!` ZST, safe
                    // deref; `UpgradeState::Pending` documents who keeps it alive.
                    Some(bun_opaque::opaque_deref_mut(upgrade_ctx.as_ptr())),
                )
                .is_null()
            {
                // SAFETY: `ws` is stored inline in its JS wrapper, which it keeps alive. uWS never stored it.
                unsafe { &*ws }.discard_unopened();
                return;
            }
            upgraded = Ok(true);
        });

        upgraded
    }

    /// Swaps the live server's mutable
    /// configuration (handlers, websocket, routes) with `new_config` and
    /// re-registers routes on the uws app(s). Ownership of moved-in fields
    /// transfers to `self.config`; the caller's `new_config` is left in a
    /// valid-but-emptied state and its `Drop` frees whatever was *not* taken.
    /// Any `Some(ws)` is adopted unconditionally, as on the initial serve.
    pub(crate) fn apply_reload(
        &self,
        new_config: &mut ServerConfig,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        httplog!("onReload");

        // Runs before any route is swapped, so a failure leaves the server as it was.
        self.init_dev_server_for_reload(new_config, global)?;

        // SAFETY: `reload` is only reachable while the server is running
        // (`self.app` set in `listen()`).
        self.app_mut().clear_routes();
        for_each_mux_app!(self, |mux| {
            mux.clear_routes();
        });

        // `on_request` / `on_error` keep their previous value when the reload
        // config omits them. The async-context re-wrap is unconditional:
        // `with_async_context_if_needed` is a no-op when no ALS frame is
        // active, so re-wrapping on every reload keeps the captured frame in
        // sync with the call-time context. The wrapper is `this` of the JS call to `reload`, alive even if
        // `js_value` was downgraded after stop(). The slot writes must reach
        // it so the new handlers are GC-rooted.
        let server_js = self.js_value_assert_alive();
        if !new_config.on_request.is_empty_or_undefined_or_null() {
            super::wrap_handler_slot(
                &mut new_config.on_request,
                server_js,
                global,
                Self::js_gc_on_request_set,
            );
            self.config
                .with_mut(|config| config.on_request = new_config.on_request);
        }
        // Swap on any change, *including* clearing to ZERO when the reload
        // config omits the handler, so subsequent `on_websocket_upgrade` /
        // `set_routes` stop routing through the node:http path.
        //
        // Never the other direction: a server that was not created as a
        // node:http server cannot become one through reload(). listen()
        // already sized every future connection's socket ext block for this
        // server's kind (HttpResponseData vs the bigger NodeHttpResponseData)
        // and set_routes would swap the context onto the node:http handler
        // instantiation under those already-sized allocations, so the node
        // request path would construct and index past them.
        if self.config.get().is_node_http_server
            && self.config.get().on_node_http_request != new_config.on_node_http_request
        {
            super::wrap_handler_slot(
                &mut new_config.on_node_http_request,
                server_js,
                global,
                Self::js_gc_on_node_http_request_set,
            );
            self.config.with_mut(|config| {
                config.on_node_http_request = new_config.on_node_http_request;
            });
        }
        if !new_config.on_error.is_empty_or_undefined_or_null() {
            super::wrap_handler_slot(
                &mut new_config.on_error,
                server_js,
                global,
                Self::js_gc_on_error_set,
            );
            self.config
                .with_mut(|config| config.on_error = new_config.on_error);
        }

        if let Some(mut ws) = new_config.websocket.take() {
            ws.handler
                .flags
                .set(super::web_socket_server_context::HandlerFlags::SSL, SSL);
            self.config.with_mut(|config| config.websocket = Some(ws));
            self.write_ws_handler_slots(server_js, global);
        }

        // These get re-applied when we set the static routes again.
        self.dev_server.with_mut(|dev_server| {
            if let Some(dev_server) = dev_server.as_deref_mut() {
                // Prevent a use-after-free in the hash table keys.
                dev_server.html_router.clear();
                dev_server.html_router.fallback = None;
            }
        });

        // The chunk routes of a built HTML route are only in the old list.
        let mut adopted_assets = Vec::new();
        for new_entry in &new_config.static_routes {
            let AnyRoute::Html(new_route) = &new_entry.route else {
                continue;
            };
            for old_entry in &self.config.get().static_routes {
                if let AnyRoute::Html(old_route) = &old_entry.route {
                    adopted_assets.extend(new_route.adopt_assets(old_route));
                }
            }
        }
        for (path, route) in adopted_assets {
            new_config.append_static_route(
                &path,
                AnyRoute::Static(route),
                server_config::MethodOptional::Any,
            );
        }

        // NOTE: `Vec<StaticRouteEntry>` impls `Drop`, so
        // a move-assign frees the old `static_routes`.
        self.config.with_mut(|config| {
            config.static_routes = core::mem::take(&mut new_config.static_routes);
            config.negative_routes = core::mem::take(&mut new_config.negative_routes);
        });

        if new_config.had_routes_object {
            self.config.with_mut(|config| {
                config.user_routes_to_build = core::mem::take(&mut new_config.user_routes_to_build);
            });
            // `UserRoute`'s owned `RouteDeclaration` drops via `Vec::clear`.
            self.user_routes.with_mut(|user_routes| user_routes.clear());
        }

        let route_list_value = self.set_routes();
        if new_config.had_routes_object {
            Self::js_gc_route_list_set(server_js, global, route_list_value);
        }

        if self.inspector_server_id.get().get() != 0 {
            if let Some(debugger) = self.vm().as_mut().debugger.as_deref_mut() {
                bun_core::handle_oom(super::http_server_agent::notify_server_routes_updated(
                    &debugger.http_server_agent,
                    self.as_any_server(),
                ));
            }
        }
        Ok(())
    }

    /// Creates the DevServer when a reload brings the server's first HTML route. `init()` only does it for the first config.
    fn init_dev_server_for_reload(
        &self,
        new_config: &mut ServerConfig,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        // The DevServer is HTTP/1-only. With it, an HTML route answers HTTP/2 and HTTP/3 with a 503.
        if self.dev_server.get().is_some()
            || !self.config.get().development.is_hmr_enabled()
            || self.h2_app.get().is_some()
            || self.h3_app.get().is_some()
            || !self.has_listener()
            || !self
                .config
                .with_mut(|config| config.take_dev_server_options_from(new_config, global))
        {
            return Ok(());
        }
        self.init_dev_server().inspect_err(|_| {
            self.config
                .with_mut(|config| config.drop_dev_server_options());
        })
    }

    pub(crate) fn reload_static_routes(&self) {
        if self.app.get().is_none() {
            // Static routes will get cleaned up when the server is stopped
            return;
        }
        self.config
            .with_mut(|config| config.normalize_static_routes_list());
        self.app_mut().clear_routes();
        for_each_mux_app!(self, |mux| {
            mux.clear_routes();
        });
        let route_list_value = self.set_routes();
        if !route_list_value.is_empty() {
            if let Some(server_js_value) = self.js_value_for_dispatch() {
                Self::js_gc_route_list_set(server_js_value, &self.global(), route_list_value);
            }
        }
    }

    pub(crate) fn reload<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global = cx.global();

        let mut new_config = ServerConfig::from_js(
            global,
            options.to_js(),
            server_config::FromJSOptions {
                allow_bake_config: false,
                previous_fetch: !self.config.get().on_request.is_empty_or_undefined_or_null(),
                previous_routes: !self.user_routes.get().is_empty(),
            },
        )?;

        // `apply_reload` moves `new_config.websocket` into the unscanned
        // `self.config` heap box before `write_ws_handler_slots` roots the 7
        // ws shadows, and each `wrap_handler_slot` call allocates via
        // `with_async_context_if_needed`. Same window as `serve()`; same fix.
        let _handler_pins = super::protect_handler_shadows(&new_config);
        self.apply_reload(&mut new_config, global)?;

        Ok(this_value)
    }

    pub(crate) fn fetch(
        &self,
        cx: &mut JsScope<'_>,
        input: JsLocal<'_>,
        init: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let global = cx.global();

        if self.config.get().on_request.is_empty() {
            return Ok(JSPromise::rejected_promise(
                global,
                global.create_error_instance(format_args!(
                    "fetch() requires the server to have a fetch handler"
                )),
            )
            .to_js());
        }

        let mut headers: Option<HeadersRef> = None;
        let mut method = OwnedMethod::from(Method::GET);

        let input = input.to_js();
        let mut body = BodyValue::Null;
        // TODO: set Host header
        // TODO: set User-Agent header
        // TODO: unify with fetch() implementation.
        let request_arg = input
            .is_object()
            .then(|| input.as_class_ref::<Request>())
            .flatten();
        let url_arg = if input.is_string() {
            Some(input.to_utf8(global)?)
        } else if input.is_object() && request_arg.is_none() {
            // A `URL`, or any other object, is read as its href, like fetch() does.
            let href = <jsc::URL as jsc::URLJsc>::href_from_js(input, global)?;
            (href.tag() != bun_core::Tag::Dead).then(|| href.into_utf8())
        } else {
            None
        };
        let request: *mut Request = if let Some(url_utf8) = url_arg {
            let temp_url_str = url_utf8.slice();

            if temp_url_str.is_empty() {
                return Ok(JSPromise::rejected_promise(
                    global,
                    global.create_error_instance(format_args!(
                        "fetch() URL must not be a blank string."
                    )),
                )
                .to_js());
            }

            let mut url = URL::parse(temp_url_str);

            // The UTF-8 clone of `url.href` below makes its own copy, so the
            // joined buffer only needs to live through this block. The else arm
            // borrows `temp_url_str` (kept alive by `url_utf8`) instead of
            // duping it.
            let owned_url_buf: std::borrow::Cow<'_, [u8]> = if url.hostname.is_empty() {
                std::borrow::Cow::Owned(
                    strings::append(self.base_url_string_for_joining.get(), url.pathname)
                        .into_vec(),
                )
            } else {
                std::borrow::Cow::Borrowed(temp_url_str)
            };
            url = URL::parse(&owned_url_buf);

            let init = init.to_js();
            if init.is_object() {
                if let Some(method_) = init.fast_get(global, jsc::BuiltinName::Method)? {
                    method = method_jsc::request_method_from_js(global, method_)?;
                }

                if let Some(headers_) = init.fast_get(global, jsc::BuiltinName::Headers)? {
                    headers = HeadersRef::from_init_value(global, headers_)?;
                }

                if let Some(body__) = init.fast_get(global, jsc::BuiltinName::Body)? {
                    match Blob::get::<true, false>(global, body__) {
                        Ok(new_blob) => body = BodyValue::Blob(new_blob),
                        Err(err) => {
                            return Ok(JSPromise::rejected_promise_with_caught_exception(
                                global, err,
                            )?
                            .to_js());
                        }
                    }
                }
            }

            Request::new(Request::init2(
                BunString::clone_utf8(url.href),
                headers,
                // Moves `body` into the per-VM hive pool (ref_count = 1).
                crate::webcore::body::hive_alloc(body),
                method,
            ))
        } else if let Some(request_) = request_arg {
            request_.clone(&global.js_thread_of_caller_no_frame())?
        } else {
            let fetch_error = Fetch::fetch_type_error_string(input);
            let err = jsc::ErrorCode::INVALID_ARG_TYPE.fmt(global, format_args!("{}", fetch_error));
            return Ok(JSPromise::rejected_promise(global, err).to_js());
        };

        debug_assert!(!self.config.get().on_request.is_empty()); // confirmed above
        let global_this = self.global();
        let on_request = self.config.get().on_request;
        // SAFETY: `request` was just allocated via `heap::alloc`; its ref
        // transfers to the JS wrapper inside `to_js`.
        let request_value = unsafe { Request::to_js(request, &global_this) };
        let this_value = self.js_value_assert_alive();
        let response_value =
            match on_request.call(&global_this, this_value, &[request_value, this_value]) {
                Ok(v) => v,
                Err(err) => {
                    return Ok(
                        JSPromise::rejected_promise_with_caught_exception(global, err)?.to_js(),
                    );
                }
            };

        if let Some(err) = response_value.to_error() {
            return Ok(JSPromise::rejected_promise(global, err).to_js());
        }

        if response_value.is_empty_or_undefined_or_null() {
            return Ok(JSPromise::rejected_promise(
                global,
                global.create_error_instance(format_args!("fetch() returned an empty value")),
            )
            .to_js());
        }

        if response_value.as_any_promise().is_some() {
            return Ok(response_value);
        }

        if let Some(resp) = <Response as bun_jsc::JsClass>::from_js(response_value) {
            // SAFETY: `from_js` returns a live `*mut Response` (owned by its
            // JS wrapper, which `response_value` keeps alive). `request` is
            // kept alive by `request_value` (its JS wrapper) for the duration
            // of this synchronous frame.
            unsafe { (*resp).set_url((*request).url.get().clone()) };
        }
        Ok(JSPromise::resolved_promise_value(global, response_value))
    }

    pub(crate) fn close_idle_connections(&self, _: &mut JsScope<'_>) -> usize {
        if self.app.get().is_none() || self.phase_held.get() {
            return 0;
        }
        // One sweep, as in Node: busy connections are not marked to close later.
        let closed = self.while_closing(|| self.app_mut().close_idle_connections(false));
        self.apply_phase();
        closed
    }

    pub(crate) fn do_stop(
        &self,
        cx: &mut JsScope<'_>,
        close_active_connections: JsLocal<'_>,
    ) -> JSValue {
        let all_closed = self.get_all_closed_promise(cx.global());
        self.stop_from_js(close_active_connections.to_js() == JSValue::TRUE);
        all_closed
    }

    pub(crate) fn dispose(&self, _: &mut JsScope<'_>) {
        self.stop_from_js(true);
    }

    fn stop_from_js(&self, abrupt: bool) {
        // Under `phase_held`, an outer `stop()` or `closeIdleConnections()` is walking the sockets an abrupt stop would close.
        if self.has_listener() || (abrupt && !self.terminated.get() && !self.phase_held.get()) {
            self.stop(abrupt);
        }
    }

    pub(crate) fn get_port(&self) -> Option<u16> {
        let config_port = match &self.config.get().address {
            server_config::Address::Unix(_) => return None,
            server_config::Address::Tcp { port, .. } => *port,
        };

        if let Some(listener) = self.listener.get() {
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            if let Some(p) = bun_opaque::opaque_deref_mut(listener).get_local_port() {
                return Some(p);
            }
        }
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener.get() {
                // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                if let Some(p) = bun_opaque::opaque_deref_mut(h3l).get_local_port() {
                    return Some(p);
                }
            }
        }
        Some(config_port)
    }

    pub(crate) fn get_id(&self) -> &[u8] {
        &self.config.get().id
    }

    pub(crate) fn get_pending_requests(&self) -> i32 {
        (self.pending_requests.get() & 0x7FFF_FFFF) as i32
    }

    pub(crate) fn get_pending_web_sockets(&self) -> i32 {
        (self.active_websocket_count.get() & 0x7FFF_FFFF) as i32
    }

    pub(crate) fn get_address(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let mut port: u16 = match &self.config.get().address {
            server_config::Address::Unix(unix) => {
                return bun_string_jsc::create_utf8_for_js(cx.global(), unix.as_bytes());
            }
            server_config::Address::Tcp { port, .. } => *port,
        };

        if let Some(listener) = self.listener.get() {
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            let listener = bun_opaque::opaque_deref_mut(listener);
            port = listener.get_local_port().unwrap_or(port);

            let mut buf = [0u8; 64];
            let Some(address_bytes) = listener.socket().local_address(&mut buf) else {
                return Ok(JSValue::NULL);
            };
            let addr = match SocketAddress::init(address_bytes, port) {
                Ok(a) => a,
                Err(_) => {
                    bun_core::hint::cold();
                    return Ok(JSValue::NULL);
                }
            };
            return addr.into_dto(&self.global());
        }
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener.get() {
                // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                let h3l = bun_opaque::opaque_deref_mut(h3l);
                port = h3l.get_local_port().unwrap_or(port);
                let mut buf = [0u8; 64];
                let Some(address_bytes) = h3l.get_local_address(&mut buf) else {
                    return Ok(JSValue::NULL);
                };
                let addr = match SocketAddress::init(address_bytes, port) {
                    Ok(a) => a,
                    Err(_) => {
                        bun_core::hint::cold();
                        return Ok(JSValue::NULL);
                    }
                };
                return addr.into_dto(&self.global());
            }
        }
        Ok(JSValue::NULL)
    }

    pub(crate) fn get_url(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        bun_string_jsc::to_jsdomurl(&self.get_url_as_string(), global)
    }

    pub(crate) fn get_hostname(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let hostname = match &self.config.get().address {
            server_config::Address::Unix(_) => return Ok(JSValue::UNDEFINED),
            server_config::Address::Tcp { hostname, .. } => hostname,
        };
        if let Some(listener) = self.listener.get() {
            let mut buf = [0u8; 1024];
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            if let Some(addr) = bun_opaque::opaque_deref_mut(listener)
                .socket()
                .remote_address(&mut buf[..1024])
            {
                if !addr.is_empty() {
                    return bun_string_jsc::create_utf8_for_js(global, addr);
                }
            }
        }
        if let Some(hostname) = hostname {
            bun_string_jsc::create_utf8_for_js(global, hostname.as_bytes())
        } else {
            BunString::static_("localhost").to_js(global)
        }
    }

    pub(crate) fn get_protocol(&self) -> ServerProtocol {
        if SSL {
            ServerProtocol::Https
        } else {
            ServerProtocol::Http
        }
    }

    pub(crate) fn get_development(&self) -> bool {
        DEBUG
    }

    pub(crate) fn finalize(&self) {
        httplog!("finalize");
        self.js_value.with_mut(|js_value| js_value.finalize());
        debug_assert!(
            self.open_ref.get().is_some() != self.is_drained(),
            "the server refs itself exactly until it is drained"
        );
    }

    pub(crate) fn get_all_closed_promise(&self, global: &JSGlobalObject) -> JSValue {
        if self.is_closed() {
            return JSPromise::resolved_promise(global, JSValue::UNDEFINED).to_js();
        }
        if self.all_closed_promise.get().has_value() {
            return self.all_closed_promise.get().value();
        }
        self.all_closed_promise
            .set(jsc::JSPromiseStrong::init(global));
        self.all_closed_promise.get().value()
    }

    /// Route handler for the HTTP/2 and HTTP/3 apps (`R` = `uws::H2::Response`
    /// or `uws::H3::Response`); both hand us the same decoded-header request.
    pub(super) fn on_mux_request<R>(&self, req: &mut uws::H3::Request, resp: &mut R)
    where
        uws::AnyResponse: From<*mut R>,
    {
        if self.config.get().on_request.is_empty() {
            return Self::on_mux_404(self, req, resp);
        }
        Self::on_request::<true>(
            self.as_ctx_ptr(),
            uws::AnyRequest::H3(req),
            uws::AnyResponse::from(std::ptr::from_mut(resp)),
            None,
        );
    }

    pub(super) fn on_mux_user_route_request<R>(
        user_route: &UserRoute<SSL, DEBUG>,
        req: &mut uws::H3::Request,
        resp: &mut R,
    ) where
        uws::AnyResponse: From<*mut R>,
    {
        Self::on_user_route_request::<true>(
            user_route,
            uws::AnyRequest::H3(req),
            uws::AnyResponse::from(std::ptr::from_mut(resp)),
            None,
        );
    }

    pub(super) fn on_mux_404<R>(_this: &Self, _req: &mut uws::H3::Request, resp: &mut R)
    where
        uws::AnyResponse: From<*mut R>,
    {
        let resp = uws::AnyResponse::from(std::ptr::from_mut(resp));
        resp.write_status(b"404 Not Found");
        resp.end_without_body(false);
    }

    pub(crate) fn do_ref<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.ref_();
        this_value
    }

    pub(crate) fn do_unref<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.unref();
        this_value
    }

    pub(crate) fn on_bun_info_request(
        &self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        jsc::mark_binding!();
        if !self.config.get().address.is_unix()
            && (!bake::is_allowed_host_header(req, Some(&self.config.get().address))
                || !resp
                    .get_remote_socket_info()
                    .is_some_and(|address| address.is_loopback()))
        {
            req.set_yield(true);
            return;
        }
        self.on_pending_request();
        req.set_yield(false);

        let buffer_writer = bun_js_printer::BufferWriter::init();
        let mut writer = bun_js_printer::BufferPrinter::init(buffer_writer);
        let source = bun_ast::Source::init_empty_file(b"info.json");
        let transpiler = &VirtualMachine::VirtualMachine::get().transpiler;
        let _ = bun_js_printer::print_json(
            &mut writer,
            BunInfo::generate(transpiler).expect("unreachable"),
            &source,
            bun_js_printer::PrintJsonOptions {
                mangled_props: None,
                ..Default::default()
            },
        );

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", &MimeType::JSON.value);
        resp.write_header(b"Cache-Control", b"public, max-age=3600");
        resp.write_header_int(b"Age", 0);
        let buffer = writer.ctx.written();
        resp.end(buffer, false);
        self.on_request_complete();
    }

    /// Calls a handler of the `routes` option. `upgrade_ctx`: the request is a WebSocket handshake `server.upgrade()` can accept.
    pub(super) fn on_user_route_request<const MUX: bool>(
        user_route: &UserRoute<SSL, DEBUG>,
        req: uws::AnyRequest,
        resp: uws::AnyResponse,
        upgrade_ctx: Option<&mut WebSocketUpgradeContext>,
    ) {
        let this = user_route.server;
        debug_assert!(!this.is_null());
        // SAFETY: the owning server outlives every route it registered.
        let server = unsafe { &*this };
        let Some(server_js) = server.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };

        let should_deinit_context = core::cell::Cell::new(false);
        let Some(mut prepared) = Self::prepare_js_request_context::<MUX>(
            this,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::No,
            user_route.route.method.specific(),
            upgrade_ctx,
        ) else {
            return;
        };

        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        // The handler and the render of what it returns continue the script that made the server.
        let _context = server.vm().enter_context(server.context.get());
        let global = server.global_this();
        let route_list =
            Self::js_route_list_get_cached(server_js).expect("routeList cached value missing");
        let call_route = if MUX {
            Bun__ServerRouteList__callRouteH3
        } else {
            Bun__ServerRouteList__callRoute
        };
        let response_value = jsc::from_js_host_call(global, || {
            call_route(
                global,
                user_route.id,
                prepared.request_object,
                server_js,
                route_list,
                &mut prepared.js_request,
                req.as_ptr(),
            )
        })
        .unwrap_or_else(|err| global.take_exception(err));

        Self::handle_request(this, &should_deinit_context, &prepared, req, response_value);
    }

    /// Calls the `fetch` handler. `upgrade_ctx` as in [`Self::on_user_route_request`].
    pub(super) fn on_request<const MUX: bool>(
        this: *mut Self,
        req: uws::AnyRequest,
        resp: uws::AnyResponse,
        upgrade_ctx: Option<&mut WebSocketUpgradeContext>,
    ) {
        // SAFETY: `this` is the live server registered as the route's user data.
        let server = unsafe { &*this };
        let Some(server_js) = server.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };

        let should_deinit_context = core::cell::Cell::new(false);
        let Some(prepared) = Self::prepare_js_request_context::<MUX>(
            this,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::Yes,
            None,
            upgrade_ctx,
        ) else {
            return;
        };

        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        // As in `on_user_route_request`.
        let _context = server.vm().enter_context(server.context.get());
        let on_request = server.config.get().on_request;
        debug_assert!(!on_request.is_empty());
        let global = server.global_this();
        let response_value =
            match on_request.call(global, server_js, &[prepared.js_request, server_js]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

        Self::handle_request(this, &should_deinit_context, &prepared, req, response_value);
    }

    /// Hands what the handler returned to the `RequestContext`, then frees it or makes the request asynchronous.
    fn handle_request<const MUX: bool>(
        this: *mut Self,
        should_deinit_context: &core::cell::Cell<bool>,
        prepared: &PreparedRequest<SSL, DEBUG, MUX>,
        req: uws::AnyRequest,
        response_value: JSValue,
    ) {
        // SAFETY: `ctx.request_weakref` keeps `request_object` alive. The uWS request does not outlive this function.
        let _detach_guard = unsafe { DetachRequestOnDrop::new(prepared.request_object) };

        // SAFETY: `ctx` can't be freed while `defer_deinit_until_callback_completes` is set, and `this` is the live server.
        let (ctx, server) = unsafe { (&*prepared.ctx, &*this) };
        ctx.on_response(server, prepared.js_request, response_value);
        prepared.js_request.ensure_still_alive();

        ctx.defer_deinit_until_callback_completes.set(None);

        if should_deinit_context.get() {
            ctx.deinit();
            return;
        }

        if ctx.should_render_missing() {
            ctx.render_missing();
            return;
        }

        // uWS reuses `req` for the next request, so an asynchronous one copies what it needs.
        ctx.to_async(
            req.as_ptr(),
            // SAFETY: live (see above), and no other borrow of the Request is outstanding.
            unsafe { &mut *prepared.request_object },
        );
    }

    fn should_warn_about_idle_timeout(&self) -> bool {
        DEBUG
            && !self.config.get().has_idle_timeout
            && !IDLE_TIMEOUT_WARNED.load(core::sync::atomic::Ordering::Relaxed)
            && !crate::cli::Command::get().debug.silent
    }

    /// Makes the `RequestContext` and the `Request` of a request that JavaScript answers. `None`: it was answered here.
    pub(super) fn prepare_js_request_context<const MUX: bool>(
        this: *mut Self,
        mut req: uws::AnyRequest,
        resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        create_js_request: CreateJsRequest,
        method: Option<http::Method>,
        upgrade_ctx: Option<&mut WebSocketUpgradeContext>,
    ) -> Option<PreparedRequest<SSL, DEBUG, MUX>> {
        debug_assert!(match resp {
            uws::AnyResponse::SSL(_) => SSL && !MUX,
            uws::AnyResponse::TCP(_) => !SSL && !MUX,
            uws::AnyResponse::H2(_) | uws::AnyResponse::H3(_) => MUX,
        });
        jsc::mark_binding!();
        // SAFETY: `this` is the live heap server registered as the callback's user data. `create` stores the raw pointer, not this borrow.
        let server = unsafe { &*this };

        let method = method.or_else(|| http::Method::which(req.method()));

        let request_body_length: Option<usize> =
            if method.unwrap_or(http::Method::OPTIONS).has_request_body() {
                // uWS enforces `maxRequestBodySize` from here on. It has answered 413 if the Content-Length is already over it.
                if !resp.accept_request_body() {
                    return None;
                }
                Some(req.content_length().unwrap_or(0) as usize)
            } else {
                None
            };

        if !MUX {
            // Earlier responses of this read leave before JavaScript runs, and this one is sent when it completes.
            resp.send_corked();
            resp.send_when_complete();
        }

        server.on_pending_request();
        req.set_yield(false);

        if server.should_warn_about_idle_timeout() {
            resp.on_timeout(
                |_: *mut c_void, _| warn_about_idle_timeout_once(),
                idle_timeout_warning_user_data(),
            );
        }

        // SAFETY: the pool is the VM's and outlives the server. `create` initializes the claimed
        // slot, and a panic inside it releases the slot without dropping its contents.
        let ctx_ptr: *mut ServerRequestContext<SSL, DEBUG, MUX> = unsafe {
            let slot = (*server.request_pool_for::<MUX>()).claim();
            ServerRequestContext::<SSL, DEBUG, MUX>::create(
                &mut *slot
                    .addr()
                    .as_ptr()
                    .cast::<core::mem::MaybeUninit<ServerRequestContext<SSL, DEBUG, MUX>>>(),
                this,
                req.as_ptr(),
                resp,
                should_deinit_context,
                method,
            );
            slot.assume_init().as_ptr()
        };
        // SAFETY: initialized by `create`.
        let ctx = unsafe { &*ctx_ptr };
        if let Some(upgrade_ctx) = upgrade_ctx {
            ctx.upgrade_context
                .set(UpgradeState::Pending(NonNull::from(upgrade_ctx)));
        }

        server
            .vm()
            .jsc_vm()
            .deprecated_report_extra_memory(core::mem::size_of::<
                ServerRequestContext<SSL, DEBUG, MUX>,
            >());

        let body_hive = crate::webcore::body::hive_alloc(BodyValue::Null);
        // SAFETY: the slot stays live: `ctx.request_body` and `Request.body` each hold a ref on it.
        let body_value: *mut BodyValue =
            unsafe { core::ptr::addr_of_mut!((*body_hive.as_ptr()).value) };
        ctx.request_body.set(Some(body_hive.clone()));

        let global = server.global_this();
        let _context = server.vm().enter_context(server.context.get());
        let signal = AbortSignal::new(global);
        ctx.signal.set(NonNull::new(signal));
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe deref.
        bun_opaque::opaque_deref_mut(signal).pending_activity_ref();

        // The JS wrapper frees it, or `ctx.request_weakref` does for `CreateJsRequest::No`.
        let request_object_ptr: *mut Request = Request::new(Request::init(
            ctx.method,
            AnyRequestContext::init(ctx_ptr),
            SSL,
            Some(bun_opaque::opaque_deref_mut(signal).ref_()),
            body_hive,
        ));
        // SAFETY: freshly leaked from `heap::into_raw`, so it carries the allocation's provenance.
        ctx.request_weakref
            .set(unsafe { bun_ptr::WeakPtr::<Request>::init_ref(request_object_ptr) });

        // `Request.url` and `.headers` read a `uws::Request` lazily. HTTP/2 and HTTP/3 have none, so both are filled in now.
        if MUX {
            // SAFETY: freshly leaked. What follows takes `&Request`.
            let request_object: &Request = unsafe { &*request_object_ptr };
            // SAFETY: create_from_h3 returns a +1-ref FetchHeaders; adopt into RAII wrapper.
            request_object.set_fetch_headers(Some(unsafe {
                crate::webcore::response::HeadersRef::adopt(FetchHeaders::create_from_h3(
                    req.as_ptr(),
                ))
            }));
            let prefix: Option<Vec<u8>> = req
                .header(b"host")
                .filter(|host| Request::is_valid_host_header(host))
                .map(|host| {
                    let fmt = bun_fmt::HostFormatter {
                        is_https: SSL,
                        host,
                        port: None,
                    };
                    let mut s = Vec::new();
                    let _ = write!(&mut s, "{}://{}", if SSL { "https" } else { "http" }, fmt);
                    s
                });
            let path = req.url();
            if !path.is_empty() && path[0] == b'/' {
                if let Some(mut s) = prefix {
                    s.extend_from_slice(path);
                    // Same WHATWG pass as `Request::ensure_url` for HTTP/1.
                    let href = bun_url::href_from_string(&BunString::from_bytes(&s));
                    request_object.url.set(if href.is_empty() {
                        BunString::clone_utf8(&s)
                    } else if core::ptr::eq(href.byte_slice().as_ptr(), s.as_ptr()) {
                        BunString::clone_latin1(&s[..href.length()])
                    } else {
                        href
                    });
                } else {
                    request_object.url.set(BunString::clone_utf8(path));
                }
            } else {
                request_object.url.set(BunString::clone_utf8(path));
            }
            ctx.req.set(None);
        }

        if DEBUG {
            ctx.flags.set_is_web_browser_navigation(
                req.header(b"sec-fetch-dest")
                    .is_some_and(|fetch_dest| fetch_dest == b"document"),
            );
        }

        if let Some(req_len) = request_body_length {
            ctx.request_body_content_len.set(req_len);
            let is_transfer_encoding = req.has_transfer_encoding();
            ctx.flags.set_is_transfer_encoding(is_transfer_encoding);
            // HTTP/2 and HTTP/3 frame the body by END_STREAM or QUIC FIN, not Content-Length.
            if req_len > 0 || is_transfer_encoding || (MUX && !resp.request_body_ended()) {
                // The buffer is allocated at the first chunk, so a client that lies about the length or aborts wastes no memory.
                // SAFETY: `body_value` is the hive payload initialized above.
                unsafe {
                    *body_value = BodyValue::Locked(crate::webcore::body::PendingValue {
                        task: Some(NonNull::new(ctx_ptr).unwrap().cast::<c_void>()),
                        global: std::ptr::from_ref(global),
                        on_start_buffering: Some(
                            ServerRequestContext::<SSL, DEBUG, MUX>::on_start_buffering_callback,
                        ),
                        on_start_streaming: Some(
                            ServerRequestContext::<SSL, DEBUG, MUX>::on_start_streaming_request_body_callback,
                        ),
                        on_readable_stream_available: Some(
                            ServerRequestContext::<SSL, DEBUG, MUX>::on_request_body_readable_stream_available,
                        ),
                        producer: crate::webcore::streams::SourceHandle::ServerRequestBody(
                            AnyRequestContext::init(ctx_ptr),
                        ),
                        ..Default::default()
                    });
                }
                ctx.flags.set_is_waiting_for_request_body(true);
                // uSockets does not buffer, so the handler is registered before JavaScript runs.
                resp.on_data(
                    ServerRequestContext::<SSL, DEBUG, MUX>::on_buffered_body_chunk,
                    ctx_ptr,
                );
            }
        }

        Some(PreparedRequest {
            js_request: match create_js_request {
                // SAFETY: from `Request::new` above; the wrapper adopts its ref.
                CreateJsRequest::Yes => unsafe { Request::to_js(request_object_ptr, global) },
                CreateJsRequest::Bake => {
                    match Request::to_js_for_bake(request_object_ptr, global) {
                        Ok(v) => v,
                        Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                        Err(_) => return None,
                    }
                }
                CreateJsRequest::No => JSValue::ZERO,
            },
            request_object: request_object_ptr,
            ctx: ctx_ptr,
        })
    }

    // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
    pub(super) fn on_chrome_dev_tools_json_request(
        &self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        if cfg!(debug_assertions) {
            // NOTE: scoped_log! expands each arg twice (ANSI/no-ANSI branches);
            // copy to owned buffers so the two `&req` borrows in the expansion
            // don't overlap with the returned slice lifetimes.
            let m = req.method().to_vec();
            let u = req.url().to_vec();
            httplog!("{} - {}", BStr::new(&m), BStr::new(&u));
        }

        let authorized = 'brk: {
            let Some(dev_server) = self.dev_server.get().as_deref() else {
                break 'brk false;
            };

            // The loopback source-IP check below is not enough on its own: a
            // DNS-rebound origin connects from 127.0.0.1 but presents the
            // attacker's hostname in `Host`. Apply the same Host allowlist as
            // the `/_bun/*` routes before disclosing the project root path.
            if !bake::is_allowed_dev_host(dev_server, req) {
                break 'brk false;
            }

            if resp
                .get_remote_socket_info()
                .is_some_and(|address| address.is_loopback())
            {
                break 'brk true;
            }

            false
        };

        if !authorized {
            req.set_yield(true);
            return;
        }

        // They need a 16 byte uuid. It needs to be somewhat consistent. We don't want to store this field anywhere.

        // So we first use a hash of the main field:
        let first_hash_segment: [u8; 8] = 'brk: {
            let mut buffer = paths::path_buffer_pool::get();
            // No entry module (`bun bake`): the hash of the project root below tells servers apart.
            let main = self.vm().main().unwrap_or_default();
            let len = main.len().min(buffer.len());
            break 'brk hash(strings::copy_lowercase(&main[..len], &mut buffer[..len]))
                .to_ne_bytes();
        };

        // And then we use a hash of their project root directory:
        let second_hash_segment: [u8; 8] = 'brk: {
            let mut buffer = paths::path_buffer_pool::get();
            let root = &self.dev_server.get().as_ref().unwrap().root;
            let len = root.len().min(buffer.len());
            break 'brk hash(strings::copy_lowercase(&root[..len], &mut buffer[..len]))
                .to_ne_bytes();
        };

        // We combine it together to get a 16 byte uuid.
        let mut hash_bytes = [0u8; 16];
        hash_bytes[..8].copy_from_slice(&first_hash_segment);
        hash_bytes[8..].copy_from_slice(&second_hash_segment);
        let uuid = UUID::init_with(&hash_bytes);

        // interface DevToolsJSON {
        //   workspace?: {
        //     root: string,
        //     uuid: string,
        //   }
        // }
        let mut json_string = Vec::new();
        let _ = write!(
            &mut json_string,
            "{{ \"workspace\": {{ \"root\": {}, \"uuid\": \"{}\" }} }}",
            bun_fmt::format_json_string_utf8(
                &self.dev_server.get().as_ref().unwrap().root,
                Default::default()
            ),
            uuid,
        );

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", b"application/json");
        resp.end(&json_string, resp.should_close_connection());
    }

    /// `table` is node:net's handler table for accepted sockets, `protos` is `ALPNProtocols` in wire format, `data` is each handle's first `data`. Called once per listen().
    pub(crate) fn set_node_socket_handlers(
        &self,
        global: &JSGlobalObject,
        table: JSValue,
        protos: Option<Box<[u8]>>,
        data: JSValue,
    ) -> JsResult<()> {
        let (Some(server_js), Some(app)) = (self.js_value_for_dispatch(), self.app.get()) else {
            return Ok(());
        };
        let handlers =
            crate::socket::Handlers::from_js(global, table, crate::socket::SocketMode::Server)?;
        extern "C" fn on_filter<const SSL: bool, const DEBUG: bool>(
            socket: *mut uws_sys::us_socket_t,
            event: i32,
            user_data: *mut c_void,
        ) {
            // `2` is the accept, before a TLS handshake. Plain TCP waits for `1`: uWS counts the connection as idle from there, so a listener's `server.close()` closes it.
            if event == if SSL { 2 } else { 1 } {
                // SAFETY: `user_data` is the server registered below, which outlives its connections. Shared, because the handler re-enters JS.
                let this = unsafe { &*user_data.cast::<NewServer<SSL, DEBUG>>() };
                crate::dispatch::fold(this.on_accept(socket.cast::<c_void>()));
            }
        }
        // Once per native server: `bun --hot` gets here again, and the filter reads the config at call time.
        if self.node_socket_config.get().is_none() {
            bun_opaque::opaque_deref_mut(app)
                .filter(on_filter::<SSL, DEBUG>, self.as_ctx_ptr().cast::<c_void>());
        }
        Self::js_gc_socket_handlers_set(server_js, global, handlers.cell());
        Self::js_gc_socket_data_set(server_js, global, data);
        self.node_socket_config.set(Some(Box::new(
            crate::socket::node_http_socket::AcceptedSocketConfig {
                handlers,
                protos,
                data,
            },
        )));
        Ok(())
    }

    /// Read while a connection's handle is made, and not kept. Null before `set_node_socket_handlers`.
    fn node_socket_config_ptr(&self) -> *const c_void {
        self.node_socket_config
            .get()
            .as_deref()
            .map_or(core::ptr::null(), |config| {
                core::ptr::from_ref(config).cast()
            })
    }

    // `js_gc_route_list_set` / `ptr_to_js` live on the unbounded
    // `impl NewServer` in mod.rs; do not redefine them here.
}

// ─── Externs ─────────────────────────────────────────────────────────────────
// C++-implemented (bindings/BunServer.cpp). Declared here (not `bun_jsc`)
// because the signatures name `bun_runtime` types (`NodeHTTPResponse`,
// `uws::Request`) — moving them down would create a forward dependency.
// Pointee types lack #[repr(C)] but are only passed by pointer.
#[allow(improper_ctypes)]
unsafe extern "C" {
    // NodeHTTPServer__onRequest_{http,https} live in `mod.rs::ffi` (sole user
    // is `on_node_http_request`); duplicate decls here caused
    // clashing_extern_declarations.

    // `&JSGlobalObject` encodes non-null/aligned; `socket` is the opaque live
    // `uws::Socket*` handed to `on_client_error_callback` /
    // `on_accept` by the uws dispatcher. Returns the
    // JSNodeHTTPServerSocket already attached to the raw socket, creating one
    // if the connection has not produced a parsed request yet.
    safe fn Bun__getOrCreateNodeHTTPServerSocket(
        is_ssl: bool,
        socket: *mut c_void,
        global: &JSGlobalObject,
        socket_handlers: *const c_void,
    ) -> JSValue;

    // `&JSGlobalObject` / `&mut JSValue` discharge the deref'd-param
    // preconditions; `request_ptr`/`req` are opaque handles that C++ stores or
    // forwards (module-private — sole callers pass live pointers).
    safe fn Bun__ServerRouteList__callRoute(
        global: &JSGlobalObject,
        index: u32,
        request_ptr: *mut Request,
        server_object: JSValue,
        route_list_object: JSValue,
        request_object: &mut JSValue,
        req: *mut c_void, // *uws.Request
    ) -> JSValue;

    safe fn Bun__ServerRouteList__callRouteH3(
        global: &JSGlobalObject,
        index: u32,
        request_ptr: *mut Request,
        server_object: JSValue,
        route_list_object: JSValue,
        request_object: &mut JSValue,
        req: *mut c_void,
    ) -> JSValue;

    // `global` is the live VM global; `callbacks`/`paths` are the ptr/len of
    // local scratch `Vec`s that C++ reads (and copies) synchronously.
    // Module-private — sole caller (`on_listen` in mod.rs) passes live slices.
    pub(super) safe fn Bun__ServerRouteList__create(
        global: *const JSGlobalObject,
        callbacks: *mut JSValue,
        paths: *mut EncodedSlice,
        paths_length: usize,
    ) -> JSValue;
}
