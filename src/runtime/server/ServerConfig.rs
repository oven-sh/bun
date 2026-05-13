use std::io::Write as _;

use bun_core::ZBox;

use bun_collections::{StringHashMap, VecExt};
use bun_core::strings;
use bun_uws_sys as uws;
use bun_wyhash::Wyhash;

use bun_http_types::Method as http_method;
use bun_url::URL;
pub use http_method::{Method, Optional as MethodOptional};

use super::server_body::ServerInitContext;
use super::web_socket_server_context::WebSocketServerContext;
use super::{AnyRoute, AnyServer};
use crate::server::jsc::{JSGlobalObject, JSPropertyIterator, JSValue, JsError, JsResult, Strong};
use bun_core::fmt as bun_fmt;

// `pub const SSLConfig = @import("../socket/SSLConfig.zig");`
pub use crate::socket::ssl_config::SSLConfig;
use crate::socket::ssl_config::SSLConfigFromJs;

pub struct ServerConfig {
    pub address: Address,
    pub idle_timeout: u8, // TODO: should we match websocket default idleTimeout of 120?
    pub has_idle_timeout: bool,
    // TODO: use webkit URL parser instead of bun's
    // PORT NOTE: Zig stores `base_url: URL` borrowing into `base_uri: []const u8`
    // (self-referential). Rust keeps only the owned buffer; callers parse on
    // demand via [`ServerConfig::base_url`] so the borrow lifetime is tied to
    // `&self` instead of erased to `'static` (PORTING.md §Forbidden — lifetime
    // extension).
    pub base_uri: Box<[u8]>,

    pub ssl_config: Option<SSLConfig>,
    // TODO(port): verify Vec<SSLConfig> drops elements; Zig looped + deinit each.
    pub sni: Option<Vec<SSLConfig>>,
    pub max_request_body_size: usize,
    pub development: DevelopmentOption,
    pub broadcast_console_log_from_browser_to_server_for_bake: bool,

    /// Enable automatic workspace folders for Chrome DevTools
    /// https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
    /// https://github.com/ChromeDevTools/vite-plugin-devtools-json/blob/76080b04422b36230d4b7a674b90d6df296cbff5/src/index.ts#L60-L77
    ///
    /// If HMR is not enabled, then this field is ignored.
    pub enable_chrome_devtools_automatic_workspace_folders: bool,

    pub on_error: Option<Strong>,
    pub on_request: Option<Strong>,
    pub on_node_http_request: Option<Strong>,

    pub websocket: Option<WebSocketServerContext>,

    pub reuse_port: bool,
    pub id: Box<[u8]>,
    pub allow_hot: bool,
    pub ipv6_only: bool,
    pub h3: bool,
    pub h1: bool,

    pub is_node_http: bool,
    pub had_routes_object: bool,

    pub static_routes: Vec<StaticRouteEntry>,
    pub negative_routes: Vec<ZBox>,
    pub user_routes_to_build: Vec<UserRouteBuilder>,

    pub bake: Option<crate::bake::UserOptions>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            address: Address::default(),
            idle_timeout: 10,
            has_idle_timeout: false,
            base_uri: Box::default(),
            ssl_config: None,
            sni: None,
            max_request_body_size: 1024 * 1024 * 128,
            development: DevelopmentOption::Development,
            broadcast_console_log_from_browser_to_server_for_bake: false,
            enable_chrome_devtools_automatic_workspace_folders: true,
            on_error: None,
            on_request: None,
            on_node_http_request: None,
            websocket: None,
            reuse_port: false,
            id: Box::default(),
            allow_hot: true,
            ipv6_only: false,
            h3: false,
            h1: true,
            is_node_http: false,
            had_routes_object: false,
            static_routes: Vec::new(),
            negative_routes: Vec::new(),
            user_routes_to_build: Vec::new(),
            bake: None,
        }
    }
}

pub enum Address {
    Tcp {
        port: u16,
        hostname: Option<ZBox>,
    },
    /// Zig `[:0]const u8` — leading NUL is valid (Linux abstract sockets).
    Unix(ZBox),
}

impl Default for Address {
    fn default() -> Self {
        Address::Tcp {
            port: 0,
            hostname: None,
        }
    }
}

// PORT NOTE: Zig `address.deinit(allocator)` freed hostname/unix and reset to .tcp{}.
// In Rust, ZBox frees on Drop; resetting is `*self = Address::default()`.

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DevelopmentOption {
    Development,
    Production,
    DevelopmentWithoutHmr,
}

impl DevelopmentOption {
    pub fn is_hmr_enabled(self) -> bool {
        self == DevelopmentOption::Development
    }

    pub fn is_development(self) -> bool {
        self == DevelopmentOption::Development || self == DevelopmentOption::DevelopmentWithoutHmr
    }
}

impl ServerConfig {
    pub fn is_development(&self) -> bool {
        self.development.is_development()
    }

    /// Parsed view over [`Self::base_uri`]. Replaces the Zig `base_url: URL`
    /// field, which borrowed self-referentially into `base_uri`.
    // PERF(port): re-parses on each call. The only out-of-module reader takes
    // `href` (== `base_uri`) directly; in-module reads happen once in `from_js`.
    #[inline]
    pub fn base_url(&self) -> URL<'_> {
        URL::parse(&self.base_uri)
    }

    pub fn memory_cost(&self) -> usize {
        // ignore size_of::<ServerConfig>(), assume already included.
        let mut cost: usize = 0;
        for entry in self.static_routes.iter() {
            cost += entry.memory_cost();
        }
        cost += self.id.len();
        cost += self.base_uri.len();
        for route in self.negative_routes.iter() {
            cost += route.as_bytes().len();
        }

        cost
    }
}

// We need to be able to apply the route to multiple Apps even when there is only one RouteList.
pub struct RouteDeclaration {
    pub path: ZBox,
    pub method: RouteMethod,
}

pub enum RouteMethod {
    Any,
    Specific(Method),
}

impl Default for RouteDeclaration {
    fn default() -> Self {
        Self {
            path: ZBox::default(),
            method: RouteMethod::Any,
        }
    }
}

// PORT NOTE: Zig `RouteDeclaration.deinit` only freed `path`; ZBox drops automatically.

// TODO: rename to StaticRoute.Entry
pub struct StaticRouteEntry {
    pub path: Box<[u8]>,
    pub route: AnyRoute,
    pub method: MethodOptional,
}

impl StaticRouteEntry {
    pub fn memory_cost(&self) -> usize {
        self.path.len() + self.route.memory_cost()
    }

    /// Zig `isLessThan` — strict-weak ordering for `std.mem.sort`
    /// (descending by path). Kept for API parity with the spec; the Rust
    /// `sort_by` callsite uses `strings::order` directly so it can return
    /// `Ordering::Equal` (Rust 1.81+ panics on a comparator that never does).
    pub fn is_less_than(_: (), this: &StaticRouteEntry, other: &StaticRouteEntry) -> bool {
        strings::cmp_strings_desc(&(), &this.path, &other.path)
    }
}

impl Drop for StaticRouteEntry {
    fn drop(&mut self) {
        // path: Box<[u8]> drops automatically
        self.route.deref_();
    }
}

impl ServerConfig {
    fn normalize_static_routes_list(&mut self) -> Result<(), bun_core::Error> {
        fn hash(route: &StaticRouteEntry) -> u64 {
            let mut hasher = Wyhash::init(0);
            match &route.method {
                MethodOptional::Any => hasher.update(b"ANY"),
                MethodOptional::Method(set) => {
                    for method in set.iter() {
                        hasher.update(method.as_str().as_bytes());
                    }
                }
            }
            hasher.update(&route.path);
            hasher.final_()
        }

        let mut static_routes_dedupe_list: Vec<u64> = Vec::with_capacity(self.static_routes.len());

        // Iterate through the list of static routes backwards
        // Later ones added override earlier ones
        let list = &mut self.static_routes;
        if !list.is_empty() {
            let mut index = list.len() - 1;
            loop {
                let route = &list[index];
                let h = hash(route);
                if static_routes_dedupe_list.contains(&h) {
                    let _item = list.remove(index);
                    // _item drops here (deinit)
                } else {
                    static_routes_dedupe_list.push(h);
                }

                if index == 0 {
                    break;
                }
                index -= 1;
            }
        }

        // sort the cloned static routes by name for determinism
        // PORT NOTE: Zig `std.mem.sort` takes a strict-weak `lessThan(a,b)` and
        // tolerates `false`/`false` for equal elements; Rust `sort_by` requires
        // a total `Ordering`. `is_less_than` ≡ `strings::order(a,b) == Greater`
        // (descending by path), so the 3-way equivalent is `order(b, a)`.
        list.sort_by(|a, b| strings::order(&b.path, &a.path));

        Ok(())
    }

    pub fn clone_for_reloading_static_routes(&mut self) -> Result<ServerConfig, bun_core::Error> {
        // Zig: `var that = this.*` (bitwise copy) then nulls ONLY {ssl_config,
        // sni, address, websocket, bake} on `this`, leaving `this` aliasing
        // every other heap field with `that`. The sole caller is
        // `self.config = self.config.clone_for_reloading_static_routes()?;`, so
        // the residual `self` is overwritten by `that` on success without
        // running `deinit`, and the aliasing is benign.
        //
        // Rust cannot alias owned Vec/Box/Strong; instead move every owning
        // field into `that` and leave the Copy scalars in place on `self` —
        // matching Zig's observable post-state for `self` (idle_timeout,
        // development, reuse_port, h1/h3, etc. retained; resources gone) and
        // ensuring the assignment-drop of the residual `self` is a no-op.
        let mut that = ServerConfig {
            address: core::mem::take(&mut self.address),
            idle_timeout: self.idle_timeout,
            has_idle_timeout: self.has_idle_timeout,
            base_uri: core::mem::take(&mut self.base_uri),
            ssl_config: self.ssl_config.take(),
            sni: self.sni.take(),
            max_request_body_size: self.max_request_body_size,
            development: self.development,
            broadcast_console_log_from_browser_to_server_for_bake: self
                .broadcast_console_log_from_browser_to_server_for_bake,
            enable_chrome_devtools_automatic_workspace_folders: self
                .enable_chrome_devtools_automatic_workspace_folders,
            on_error: self.on_error.take(),
            on_request: self.on_request.take(),
            on_node_http_request: self.on_node_http_request.take(),
            websocket: self.websocket.take(),
            reuse_port: self.reuse_port,
            id: core::mem::take(&mut self.id),
            allow_hot: self.allow_hot,
            ipv6_only: self.ipv6_only,
            h3: self.h3,
            h1: self.h1,
            is_node_http: self.is_node_http,
            had_routes_object: self.had_routes_object,
            static_routes: core::mem::take(&mut self.static_routes),
            negative_routes: core::mem::take(&mut self.negative_routes),
            user_routes_to_build: core::mem::take(&mut self.user_routes_to_build),
            bake: self.bake.take(),
        };

        that.normalize_static_routes_list()?;

        Ok(that)
    }

    pub fn append_static_route(
        &mut self,
        path: &[u8],
        route: AnyRoute,
        method: MethodOptional,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.static_routes.push(StaticRouteEntry {
            path: Box::<[u8]>::from(path),
            route,
            method,
        });
        Ok(())
    }
}

// PORT NOTE: Zig `applyStaticRoute` used comptime closures over (ssl, T) passed
// as C-style fn pointers to uws app.head/any/method. Rust monomorphizes free
// `extern "C"` fns per `<SSL, T>` and registers them via the raw
// `c::uws_method_handler` overload — equivalent to the Zig `handler_wrap` struct.

pub fn apply_static_route<const SSL: bool, T>(
    server: AnyServer,
    app: &mut uws::NewApp<SSL>,
    entry: *mut T,
    path: &[u8],
    method: http_method::Optional,
) where
    T: StaticRouteLike<SSL>,
{
    // SAFETY: caller passes a live route pointer for the lifetime of the app.
    unsafe { T::set_server(entry, server) };

    // Trampolines: uWS hands us an opaque `uws_res*`, a live `Request*`, and the
    // user_data pointer (= `entry`). Cast back to the typed `Response<SSL>` /
    // `T` and dispatch into the trait. Monomorphized per `<SSL, T>`.
    extern "C" fn handler<const SSL: bool, T: StaticRouteLike<SSL>>(
        resp: *mut uws::uws_res,
        req: *mut uws::Request,
        user_data: *mut core::ffi::c_void,
    ) {
        // SAFETY: uWS invokes this with non-null `resp`/`req` for the duration
        // of the callback; `user_data` is the `entry` pointer registered below,
        // kept alive by the route table for the lifetime of the app.
        let route = user_data.cast::<T>();
        let resp = uws::NewAppResponse::<SSL>::cast_res(resp);
        // `Response<SSL>` is a `#[repr(C)]` opaque over `uws_res`; pointer cast
        // selects the matching `AnyResponse` variant for the comptime SSL flag.
        let any_resp = if SSL {
            bun_uws_sys::AnyResponse::SSL(resp.cast())
        } else {
            bun_uws_sys::AnyResponse::TCP(resp.cast())
        };
        unsafe { T::on_request(route, bun_uws_sys::AnyRequest::H1(req), any_resp) };
    }

    extern "C" fn head<const SSL: bool, T: StaticRouteLike<SSL>>(
        resp: *mut uws::uws_res,
        req: *mut uws::Request,
        user_data: *mut core::ffi::c_void,
    ) {
        // SAFETY: see `handler` above.
        let route = user_data.cast::<T>();
        let resp = uws::NewAppResponse::<SSL>::cast_res(resp);
        let any_resp = if SSL {
            bun_uws_sys::AnyResponse::SSL(resp.cast())
        } else {
            bun_uws_sys::AnyResponse::TCP(resp.cast())
        };
        unsafe { T::on_head_request(route, bun_uws_sys::AnyRequest::H1(req), any_resp) };
    }

    let user_data = entry.cast::<core::ffi::c_void>();
    app.head(path, Some(head::<SSL, T>), user_data);
    match method {
        http_method::Optional::Any => {
            app.any(path, Some(handler::<SSL, T>), user_data);
        }
        http_method::Optional::Method(m) => {
            let mut iter = m.iter();
            while let Some(method_) = iter.next() {
                app.method(method_, path, Some(handler::<SSL, T>), user_data);
            }
        }
    }
}

pub fn apply_static_route_h3<T>(
    server: AnyServer,
    app: &mut uws::h3::App,
    entry: *mut T,
    path: &[u8],
    method: http_method::Optional,
) where
    T: StaticRouteLike<false>,
{
    // SAFETY: caller passes a live route pointer for the lifetime of the app.
    unsafe { T::set_server(entry, server) };

    fn handler<T: StaticRouteLike<false>>(
        route: &mut T,
        req: &mut uws::h3::Request,
        resp: &mut uws::h3::Response,
    ) {
        // SAFETY: `route` is the `entry` userdata kept alive by the route table.
        unsafe {
            T::on_request(
                route,
                bun_uws_sys::AnyRequest::H3(req),
                bun_uws_sys::AnyResponse::H3(resp),
            )
        };
    }
    fn head<T: StaticRouteLike<false>>(
        route: &mut T,
        req: &mut uws::h3::Request,
        resp: &mut uws::h3::Response,
    ) {
        // SAFETY: see `handler` above.
        unsafe {
            T::on_head_request(
                route,
                bun_uws_sys::AnyRequest::H3(req),
                bun_uws_sys::AnyResponse::H3(resp),
            )
        };
    }

    app.head(path, entry, head::<T>);
    match method {
        http_method::Optional::Any => app.any(path, entry, handler::<T>),
        http_method::Optional::Method(m) => {
            let mut iter = m.iter();
            while let Some(method_) = iter.next() {
                app.method(method_, path, entry, handler::<T>);
            }
        }
    }
}

/// Per-route trait that `apply_static_route{,_h3}` monomorphizes over —
/// expresses Zig's `comptime T: type` (`StaticRoute`/`FileRoute`/`HTMLBundle.Route`).
/// Receivers are raw `*mut Self` because the route is registered as the uWS
/// userdata pointer and the inherent impls (`StaticRoute::on_request` etc.) need
/// `*mut` to mutate state and stash `self` into onAborted callbacks.
pub trait StaticRouteLike<const SSL: bool>: 'static {
    /// SAFETY: `this` is a live route pointer for the lifetime of the app.
    unsafe fn set_server(this: *mut Self, server: AnyServer);
    /// SAFETY: `this` is a live route pointer; `req`/`resp` carry FFI handles
    /// valid for the duration of the uWS callback.
    unsafe fn on_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    );
    /// SAFETY: see `on_request`.
    unsafe fn on_head_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    );
}

// PORT NOTE (layering): the Phase-A `RequestUnion`/`ResponseUnion` placeholders
// were duplicates of `bun_uws_sys::AnyRequest`/`AnyResponse` (which already
// model Zig's `.{ .h1 = req }` / `.{ .SSL = resp }`). Re-export the real types
// so any straggler reference resolves to the canonical opaque.
pub use bun_uws_sys::AnyRequest as RequestUnion;
pub use bun_uws_sys::AnyResponse as ResponseUnion;

impl<const SSL: bool> StaticRouteLike<SSL> for super::StaticRoute {
    unsafe fn set_server(this: *mut Self, server: AnyServer) {
        // SAFETY: caller guarantees `this` is live; `server` is a Cell so &mut
        // is not required.
        unsafe { (*this).server.set(Some(server)) };
    }
    unsafe fn on_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    ) {
        // SAFETY: forwarded to the inherent impl with the same contract.
        unsafe { Self::on_request(this, req, resp) }
    }
    unsafe fn on_head_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    ) {
        // SAFETY: forwarded to the inherent impl with the same contract.
        unsafe { Self::on_head_request(this, req, resp) }
    }
}

impl<const SSL: bool> StaticRouteLike<SSL> for super::FileRoute {
    unsafe fn set_server(this: *mut Self, server: AnyServer) {
        // SAFETY: caller guarantees `this` is live.
        unsafe { (*this).set_server(Some(server)) };
    }
    unsafe fn on_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    ) {
        Self::on_request(this, req, resp)
    }
    unsafe fn on_head_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    ) {
        Self::on_head_request(this, req, resp)
    }
}

impl<const SSL: bool> StaticRouteLike<SSL> for super::html_bundle::Route {
    unsafe fn set_server(this: *mut Self, server: AnyServer) {
        // SAFETY: caller guarantees `this` is live.
        unsafe { (*this).server.set(Some(server)) };
    }
    unsafe fn on_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    ) {
        Self::on_request(this, req, resp)
    }
    unsafe fn on_head_request(
        this: *mut Self,
        req: bun_uws_sys::AnyRequest,
        resp: bun_uws_sys::AnyResponse,
    ) {
        Self::on_head_request(this, req, resp)
    }
}

impl ServerConfig {
    pub fn compute_id(&self) -> Vec<u8> {
        let mut arraylist: Vec<u8> = Vec::new();

        let _ = arraylist.write_all(b"[http]-");
        match &self.address {
            Address::Tcp { port, hostname } => {
                if let Some(host) = hostname {
                    let _ = write!(
                        &mut arraylist,
                        "tcp:{}:{}",
                        bstr::BStr::new(host.as_bytes()),
                        port
                    );
                } else {
                    let _ = write!(&mut arraylist, "tcp:localhost:{}", port);
                }
            }
            Address::Unix(addr) => {
                let _ = write!(&mut arraylist, "unix:{}", bstr::BStr::new(addr.as_bytes()));
            }
        }

        arraylist
    }

    pub fn get_usockets_options(&self) -> i32 {
        // Unlike Node.js, we set exclusive port in case reuse port is not set
        let mut out: i32 = if self.reuse_port {
            bun_uws_sys::LIBUS_LISTEN_REUSE_PORT | bun_uws_sys::LIBUS_LISTEN_REUSE_ADDR
        } else {
            bun_uws_sys::LIBUS_LISTEN_EXCLUSIVE_PORT
        };

        if self.ipv6_only {
            out |= bun_uws_sys::LIBUS_SOCKET_IPV6_ONLY;
        }

        out
    }
}

// ─── from_js + JS-side parsing ───────────────────────────────────────────────

fn validate_route_name(global: &JSGlobalObject, path: &[u8]) -> JsResult<()> {
    // Already validated by the caller
    debug_assert!(!path.is_empty() && path[0] == b'/');

    // For now, we don't support params that start with a number.
    // Mostly because it makes the params object more complicated to implement and it's easier to cut scope this way for now.
    let mut remaining = path;
    let mut duped_route_names: StringHashMap<()> = StringHashMap::new();
    while let Some(index) = strings::index_of_char(remaining, b':') {
        remaining = &remaining[(index + 1) as usize..];
        let end = strings::index_of_char(remaining, b'/')
            .map(|i| i as usize)
            .unwrap_or(remaining.len());
        let route_name = &remaining[..end];
        if !route_name.is_empty() && route_name[0].is_ascii_digit() {
            return Err(global.throw_todo(
                b"Route parameter names cannot start with a number.\n\n\
                  If you run into this, please file an issue and we will add support for it.",
            ));
        }

        let entry = bun_core::handle_oom(duped_route_names.get_or_put(route_name));
        if entry.found_existing {
            return Err(global.throw_todo(
                b"Support for duplicate route parameter names is not yet implemented.\n\n\
                  If you run into this, please file an issue and we will add support for it.",
            ));
        }

        remaining = &remaining[end..];
    }
    Ok(())
}

fn get_routes_object(global: &JSGlobalObject, arg: JSValue) -> JsResult<Option<JSValue>> {
    for key in ["routes", "static"] {
        if let Some(routes) = arg.get(global, key)? {
            // https://github.com/oven-sh/bun/issues/17568
            if routes.is_array() {
                return Ok(None);
            }
            return Ok(Some(routes));
        }
    }
    Ok(None)
}

/// Bridge `crate::bake::FileSystemRouterType` (Cow-backed, populated by
/// `server_body::AnyRoute::from_js`) into `bake_body::FileSystemRouterType`
/// (`&'static [u8]`-backed, consumed by `Framework::auto`). Both mirror Zig's
/// single `bake.Framework.FileSystemRouterType`; the duplication is a Phase-A
/// layering wart and this conversion stands in for an arena-dupe until the two
/// structs unify. All bytes are duped into `arena` so the resulting `&'static`
/// slices live as long as `UserOptions.arena`.
fn convert_file_system_router_type(
    arena: &bun_alloc::Arena,
    src: crate::bake::FileSystemRouterType,
) -> crate::bake::bake_body::FileSystemRouterType {
    use crate::bake::bake_body as bb;
    // PORT NOTE: `bb::arena_erase` is the single sanctioned `'bump → 'static`
    // erasure for the `UserOptions.arena` self-referential pattern; bake_body's
    // own `Framework::from_js` / `resolve` use it identically. Phase B threads
    // a real `'bump` through `bb::Framework`/`bb::FileSystemRouterType` and
    // removes this together with `arena_erase`.
    fn dupe(arena: &bun_alloc::Arena, bytes: &[u8]) -> &'static [u8] {
        bb::arena_erase(arena.alloc_slice_copy(bytes))
    }
    fn dupe_slice_of(
        arena: &bun_alloc::Arena,
        v: &[std::borrow::Cow<'static, [u8]>],
    ) -> &'static [&'static [u8]] {
        let inner: Vec<&'static [u8]> = v.iter().map(|c| dupe(arena, c.as_ref())).collect();
        bb::arena_erase(arena.alloc_slice_copy(&inner))
    }

    bb::FileSystemRouterType {
        root: dupe(arena, src.root.as_ref()),
        prefix: dupe(arena, src.prefix.as_ref()),
        entry_server: dupe(arena, src.entry_server.as_ref()),
        entry_client: src.entry_client.as_deref().map(|b| dupe(arena, b)),
        ignore_underscores: src.ignore_underscores,
        ignore_dirs: dupe_slice_of(arena, &src.ignore_dirs),
        extensions: dupe_slice_of(arena, &src.extensions),
        style: src.style,
        allow_layouts: src.allow_layouts,
    }
}

impl ServerConfig {
    pub fn from_js(
        global: &JSGlobalObject,
        arguments: &mut bun_jsc::call_frame::ArgumentsSlice,
        opts: FromJSOptions,
    ) -> JsResult<ServerConfig> {
        let vm = arguments.vm;
        let env = vm.env_loader();

        let mut args = ServerConfig {
            address: Address::Tcp {
                port: 3000,
                hostname: None,
            },
            development: if let Some(hmr) = vm.transpiler.options.transform_options.serve_hmr {
                if !hmr {
                    DevelopmentOption::DevelopmentWithoutHmr
                } else {
                    DevelopmentOption::Development
                }
            } else {
                DevelopmentOption::Development
            },

            // If this is a node:cluster child, let's default to SO_REUSEPORT.
            // That way you don't have to remember to set reusePort: true in Bun.serve() when using node:cluster.
            reuse_port: env.get(b"NODE_UNIQUE_ID").is_some(),
            ..ServerConfig::default()
        };
        let mut has_hostname = false;

        // PORT NOTE: Zig `defer { if !hmr { assert(bake == null) } }` — moved to end of fn.

        if env.get(b"NODE_ENV").unwrap_or(b"") == b"production" {
            args.development = DevelopmentOption::Production;
        }

        if arguments.vm.transpiler.options.production {
            args.development = DevelopmentOption::Production;
        }

        // Set tcp port from env / options
        {
            let port = 'brk: {
                const PORT_ENV: [&[u8]; 3] = [b"BUN_PORT", b"PORT", b"NODE_PORT"];

                for port_env in PORT_ENV {
                    if let Some(port) = env.get(port_env) {
                        // TODO(port): std.fmt.parseInt(u16, port, 10) — using helper
                        if let Ok(_port) = bun_core::immutable::parse_int::<u16>(port, 10) {
                            break 'brk _port;
                        }
                    }
                }

                if let Some(port) = arguments.vm.transpiler.options.transform_options.port {
                    break 'brk port;
                }

                match &args.address {
                    Address::Tcp { port, .. } => *port,
                    _ => unreachable!(),
                }
            };
            if let Address::Tcp { port: p, .. } = &mut args.address {
                *p = port;
            }
        }
        let mut port = match &args.address {
            Address::Tcp { port, .. } => *port,
            _ => unreachable!(),
        };

        if let Some(origin) = &arguments.vm.transpiler.options.transform_options.origin {
            // Zig: dupeZ — but base_uri is []const u8; the NUL is incidental.
            args.base_uri = Box::<[u8]>::from(origin.as_ref());
        }

        // PORT NOTE: Zig `defer { if global.hasException() { ssl_config.deinit() } }` —
        // SSLConfig drops automatically when `args` drops on error path.

        let Some(arg) = arguments.next() else {
            return Err(global.throw_invalid_arguments(format_args!("Bun.serve expects an object")));
        };

        if !arg.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Bun.serve expects an object")));
        }

        // "development" impacts other settings like bake.
        if let Some(dev) = arg.get(global, "development")? {
            if dev.is_object() {
                if let Some(hmr) = dev.get_boolean_strict(global, "hmr")? {
                    args.development = if !hmr {
                        DevelopmentOption::DevelopmentWithoutHmr
                    } else {
                        DevelopmentOption::Development
                    };
                } else {
                    args.development = DevelopmentOption::Development;
                }

                if let Some(console) = dev.get_boolean_strict(global, "console")? {
                    args.broadcast_console_log_from_browser_to_server_for_bake = console;
                }

                if let Some(v) =
                    dev.get_boolean_strict(global, "chromeDevToolsAutomaticWorkspaceFolders")?
                {
                    args.enable_chrome_devtools_automatic_workspace_folders = v;
                }
            } else {
                args.development = if dev.to_boolean() {
                    DevelopmentOption::Development
                } else {
                    DevelopmentOption::Production
                };
            }
            args.reuse_port = args.development == DevelopmentOption::Production;
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(static_) = get_routes_object(global, arg)? {
            let Some(static_obj) = static_.get_object() else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Bun.serve() expects 'routes' to be an object shaped like:\n\n\
                     \x20 {{\n\
                     \x20   \"/path\": {{\n\
                     \x20     GET: (req) => new Response(\"Hello\"),\n\
                     \x20     POST: (req) => new Response(\"Hello\"),\n\
                     \x20   }},\n\
                     \x20   \"/path2/:param\": new Response(\"Hello\"),\n\
                     \x20   \"/path3/:param1/:param2\": (req) => new Response(\"Hello\")\n\
                     \x20 }}\n\n\
                     Learn more at https://bun.com/docs/api/http",
                )));
            };
            args.had_routes_object = true;

            // PORT NOTE: in Zig the iterator options are a comptime struct; the
            // Rust port carries them as a runtime arg to `init()`.
            // SAFETY: `get_object()` returned Some, so the pointer is a live JSObject.
            let static_obj: &bun_jsc::JSObject = unsafe { &*static_obj };
            let mut iter = JSPropertyIterator::init(
                global,
                static_obj,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: true,
                    include_value: true,
                    ..Default::default()
                },
            )?;
            // iter drops at scope end

            let mut init_ctx_ = ServerInitContext {
                // PORT NOTE: Zig threaded a `std.heap.ArenaAllocator` here; the
                // Rust `ServerInitContext` dropped that field — bake owns the
                // arena instead (created below and moved into `UserOptions`).
                dedupe_html_bundle_map: Default::default(),
                framework_router_list: Vec::new(),
                js_string_allocations: crate::bake::StringRefList::EMPTY,
                user_routes: &mut args.static_routes,
                global,
            };
            let init_ctx = &mut init_ctx_;
            // errdefer { init_ctx.arena.deinit(); init_ctx.framework_router_list.deinit(); }
            // — arena/Vec are owned locals; drop on `?` automatically. Ownership
            // transfers to args.bake on the success path via mem::take below.
            // (dedupe_html_bundle_map is unused on the success path; drops at scope end.)

            // errdefer { for static_routes |r| r.deinit(); clearAndFree() }
            // — Vec<StaticRouteEntry> drops elements (which deref route) automatically on error.

            while let Some(key) = iter.next()? {
                // PORT NOTE: `to_owned_slice_returning_all_ascii` not yet on
                // `bun_core::String`; split into `to_owned_slice()` + `is_all_ascii`.
                let path_vec = key.to_owned_slice();
                let is_ascii = strings::is_all_ascii(&path_vec);
                let path: Box<[u8]> = path_vec.into_boxed_slice();
                // errdefer free(path) — Box drops on error

                let value: JSValue = iter.value;

                if value.is_undefined() {
                    continue;
                }

                if path.is_empty() || path[0] != b'/' {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Invalid route {}. Path must start with '/'",
                        bun_fmt::quote(&path),
                    )));
                }

                if !is_ascii {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Invalid route {}. Please encode all non-ASCII characters in the path.",
                        bun_fmt::quote(&path),
                    )));
                }

                if value == JSValue::FALSE {
                    // Zig: `dupeZ(u8, path)` — appends a sentinel NUL without
                    // rejecting interior NULs (which already passed `is_all_ascii`).
                    let duped = ZBox::from_bytes(&*path);
                    args.negative_routes.push(duped);
                    continue;
                }

                if value.is_callable() {
                    validate_route_name(global, &path)?;
                    args.user_routes_to_build.push(UserRouteBuilder {
                        route: RouteDeclaration {
                            path: ZBox::from_bytes(&*path),
                            method: RouteMethod::Any,
                        },
                        callback: Strong::create(
                            value.with_async_context_if_needed(global),
                            global,
                        ),
                    });
                    continue;
                } else if value.is_object() {
                    const METHODS: [Method; 9] = [
                        Method::CONNECT,
                        Method::DELETE,
                        Method::GET,
                        Method::HEAD,
                        Method::OPTIONS,
                        Method::PATCH,
                        Method::POST,
                        Method::PUT,
                        Method::TRACE,
                    ];
                    let mut found = false;
                    for method in METHODS {
                        let method_name = bun_core::String::static_(method.as_str());
                        if let Some(function) = value.get_own(global, &method_name)? {
                            if !found {
                                validate_route_name(global, &path)?;
                            }
                            found = true;

                            if function.is_callable() {
                                args.user_routes_to_build.push(UserRouteBuilder {
                                    route: RouteDeclaration {
                                        path: ZBox::from_bytes(&*path),
                                        method: RouteMethod::Specific(method),
                                    },
                                    callback: Strong::create(
                                        function.with_async_context_if_needed(global),
                                        global,
                                    ),
                                });
                            } else if let Some(html_route) =
                                AnyRoute::from_js(global, &path, function, &mut *init_ctx)?
                            {
                                let mut method_set = http_method::Set::empty();
                                method_set.insert(method);

                                init_ctx.user_routes.push(StaticRouteEntry {
                                    path: Box::<[u8]>::from(&*path),
                                    route: html_route,
                                    method: http_method::Optional::Method(method_set),
                                });
                            }
                        }
                    }

                    if found {
                        continue;
                    }
                }

                let Some(route) = AnyRoute::from_js(global, &path, value, &mut *init_ctx)? else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "'routes' expects a Record<string, Response | HTMLBundle | {{[method: string]: (req: BunRequest) => Response|Promise<Response>}}>\n\n\
                         To bundle frontend apps on-demand with Bun.serve(), import HTML files.\n\n\
                         Example:\n\n\
                         ```js\n\
                         import {{ serve }} from \"bun\";\n\
                         import app from \"./app.html\";\n\n\
                         serve({{\n\
                         \x20 routes: {{\n\
                         \x20   \"/index.json\": Response.json({{ message: \"Hello World\" }}),\n\
                         \x20   \"/app\": app,\n\
                         \x20   \"/path/:param\": (req) => {{\n\
                         \x20     const param = req.params.param;\n\
                         \x20     return Response.json({{ message: `Hello ${{param}}` }});\n\
                         \x20   }},\n\
                         \x20   \"/path\": {{\n\
                         \x20     GET(req) {{\n\
                         \x20       return Response.json({{ message: \"Hello World\" }});\n\
                         \x20     }},\n\
                         \x20     POST(req) {{\n\
                         \x20       return Response.json({{ message: \"Hello World\" }});\n\
                         \x20     }},\n\
                         \x20   }},\n\
                         \x20 }},\n\n\
                         \x20 fetch(request) {{\n\
                         \x20   return new Response(\"fallback response\");\n\
                         \x20 }},\n\
                         }});\n\
                         ```\n\n\
                         See https://bun.com/docs/api/http for more information.",
                    )));
                };
                init_ctx.user_routes.push(StaticRouteEntry {
                    path,
                    route,
                    method: http_method::Optional::Any,
                });
            }

            // When HTML bundles are provided, ensure DevServer options are ready
            // The presence of these options causes Bun.serve to initialize things.
            if !init_ctx.dedupe_html_bundle_map.is_empty()
                || !init_ctx.framework_router_list.is_empty()
            {
                if args.development.is_hmr_enabled() {
                    use crate::bake::bake_body as bb;
                    use bun_options_types::schema::api::DotEnvBehavior;

                    // PORT NOTE: Zig threaded `init_ctx.arena` from
                    // `ServerInitContext`; the Rust `ServerInitContext` dropped
                    // that field, so the arena is created here and moved into
                    // `UserOptions` (same lifetime: lives until `args.bake`
                    // is dropped).
                    let arena = bun_alloc::Arena::new();

                    let root = bb::arena_dupe_z(
                        &arena,
                        bun_paths::fs::FileSystem::instance().top_level_dir(),
                    );

                    // Convert `crate::bake::FileSystemRouterType` (Cow-backed)
                    // into `bake_body::FileSystemRouterType` (`&'static` slices)
                    // by duping every string into the arena. Phase-A type
                    // duplication; remove once the two structs unify.
                    let router_types: Vec<bb::FileSystemRouterType> =
                        core::mem::take(&mut init_ctx.framework_router_list)
                            .into_iter()
                            .map(|t| convert_file_system_router_type(&arena, t))
                            .collect();

                    // SAFETY: `bun_vm()` returns the live VM for this global;
                    // we need `&mut Resolver` for `Framework::auto`.
                    let resolver = &mut global.bun_vm().as_mut().transpiler.resolver;
                    let framework = bb::Framework::auto(&arena, resolver, router_types)
                        .map_err(|e| global.throw_error(e, "Framework::auto"))?;

                    let mut user_options = crate::bake::UserOptions {
                        arena,
                        allocations: core::mem::replace(
                            &mut init_ctx.js_string_allocations,
                            crate::bake::StringRefList::EMPTY,
                        ),
                        root,
                        framework,
                        bundler_options: bb::SplitBundlerOptions::default(),
                    };

                    let o = &vm.transpiler.options.transform_options;

                    match o.serve_env_behavior {
                        DotEnvBehavior::prefix => {
                            // PORT NOTE: `serve_env_prefix` is `Option<Box<[u8]>>`
                            // owned by the long-lived `transform_options`; dupe
                            // into the arena so the `&'static [u8]` field is
                            // backed by `UserOptions.arena`.
                            user_options.bundler_options.client.env_prefix = o
                                .serve_env_prefix
                                .as_deref()
                                .map(|p| bb::arena_dupe_z(&user_options.arena, p).as_bytes());
                            user_options.bundler_options.client.env = DotEnvBehavior::prefix;
                        }
                        DotEnvBehavior::load_all => {
                            user_options.bundler_options.client.env = DotEnvBehavior::load_all;
                        }
                        DotEnvBehavior::disable => {
                            user_options.bundler_options.client.env = DotEnvBehavior::disable;
                        }
                        _ => {}
                    }

                    if let Some(define) = &o.serve_define {
                        user_options.bundler_options.client.define = define.clone();
                        user_options.bundler_options.server.define = define.clone();
                        user_options.bundler_options.ssr.define = define.clone();
                    }

                    args.bake = Some(user_options);
                } else {
                    if !init_ctx.framework_router_list.is_empty() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "FrameworkRouter is currently only supported when `development: true`",
                        )));
                    }
                    // init_ctx.arena drops at scope end
                }
            } else {
                // TODO(port): Zig asserted arena was empty (state.end_index == 0 && first == null).
                // bumpalo has no equivalent; skip assertion.
                // init_ctx.arena drops at scope end
            }
        }

        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(value) = arg.get(global, "idleTimeout")? {
            if !value.is_undefined_or_null() {
                if !value.is_any_int() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Bun.serve expects idleTimeout to be an integer",
                    )));
                }
                args.has_idle_timeout = true;

                let idle_timeout: u64 = u64::try_from(value.to_int64().max(0)).expect("int cast");
                if idle_timeout > 255 {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Bun.serve expects idleTimeout to be 255 or less",
                    )));
                }

                args.idle_timeout = idle_timeout as u8;
            }
        }

        let websocket_object = if let Some(v) = arg.get_truthy(global, "webSocket")? {
            Some(v)
        } else {
            arg.get_truthy(global, "websocket")?
        };
        if let Some(websocket_object) = websocket_object {
            if !websocket_object.is_object() {
                // ssl_config drops with args
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected websocket to be an object")));
            }

            // errdefer ssl_config.deinit() — drops with args on error
            args.websocket = Some(super::web_socket_server_context::on_create(
                global,
                websocket_object,
            )?);
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(port_) = arg.get_truthy(global, "port")? {
            let p = u16::try_from(
                (port_.coerce::<i32>(global)?)
                    .max(0)
                    .min(i32::from(u16::MAX)),
            )
            .unwrap();
            if let Address::Tcp { port: tp, .. } = &mut args.address {
                *tp = p;
            }
            port = p;
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(base_uri) = arg.get_truthy(global, "baseURI")? {
            let sliced = base_uri.to_slice(global)?;

            if !sliced.slice().is_empty() {
                // sliced drops at scope end
                args.base_uri = Box::<[u8]>::from(sliced.slice());
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        let host = if let Some(h) = arg.get_stringish(global, "hostname")? {
            Some(h)
        } else {
            arg.get_stringish(global, "host")?
        };
        if let Some(host) = host {
            // host derefs on drop
            let host_str = host.to_utf8();

            if !host_str.slice().is_empty() {
                // Zig: `dupeZ(u8, host_str.slice())` — does not reject interior
                // NUL; the C `bind()` consumer will simply truncate at it.
                let hostname = ZBox::from_bytes(host_str.slice());
                if let Address::Tcp { hostname: h, .. } = &mut args.address {
                    *h = Some(hostname);
                }
                has_hostname = true;
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(unix) = arg.get_stringish(global, "unix")? {
            let unix_str = unix.to_utf8();
            if !unix_str.slice().is_empty() {
                if has_hostname {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Cannot specify both hostname and unix",
                    )));
                }

                args.address = Address::Unix(bun_core::ZBox::from_bytes(unix_str.slice()));
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(id) = arg.get(global, "id")? {
            if id.is_undefined_or_null() {
                args.allow_hot = false;
            } else {
                let id_str = id.to_slice(global)?;
                if !id_str.slice().is_empty() {
                    args.id = Box::<[u8]>::from(id_str.slice());
                } else {
                    args.allow_hot = false;
                }
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if opts.allow_bake_config {
            'brk: {
                if let Some(bake_args_js) = arg.get_truthy(global, "app")? {
                    if !bun_core::FeatureFlags::bake() {
                        break 'brk;
                    }
                    if args.bake.is_some() {
                        // "app" is likely to be removed in favor of the HTML loader.
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'app' + HTML loader not supported.",
                        )));
                    }

                    if args.development == DevelopmentOption::Production {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "TODO: 'development: false' in serve options with 'app'. For now, use `bun build --app` or set 'development: true'",
                        )));
                    }

                    args.bake = Some(crate::bake::UserOptions::from_js(bake_args_js, global)?);
                }
            }
        }

        if let Some(dev) = arg.get(global, "reusePort")? {
            args.reuse_port = dev.to_boolean();
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(dev) = arg.get(global, "ipv6Only")? {
            args.ipv6_only = dev.to_boolean();
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(v) = arg.get(global, "http3")? {
            args.h3 = v.to_boolean();
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(v) = arg.get(global, "http1")? {
            args.h1 = v.to_boolean();
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(max_request_body_size) = arg.get_truthy(global, "maxRequestBodySize")? {
            if max_request_body_size.is_number() {
                args.max_request_body_size = u64::try_from(max_request_body_size.to_int64().max(0))
                    .expect("int cast") as usize;
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(on_error) = arg.get_truthy(global, "error")? {
            if !on_error.is_callable() {
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected error to be a function"))
                );
            }
            let on_error_snapshot = on_error.with_async_context_if_needed(global);
            args.on_error = Some(Strong::create(on_error_snapshot, global));
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(on_request_) = arg.get_truthy(global, "onNodeHTTPRequest")? {
            if !on_request_.is_callable() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected onNodeHTTPRequest to be a function",
                )));
            }
            let on_request = on_request_.with_async_context_if_needed(global);
            args.on_node_http_request = Some(Strong::create(on_request, global));
        }

        if let Some(on_request_) = arg.get_truthy(global, "fetch")? {
            if !on_request_.is_callable() {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected fetch() to be a function")));
            }
            let on_request = on_request_.with_async_context_if_needed(global);
            args.on_request = Some(Strong::create(on_request, global));
        } else if args.bake.is_none()
            && args.on_node_http_request.is_none()
            && ((args.static_routes.len() + args.user_routes_to_build.len()) == 0
                && !opts.has_user_routes)
            && opts.is_fetch_required
        {
            if global.has_exception() {
                return Err(JsError::Thrown);
            }
            return Err(global.throw_invalid_arguments(format_args!(
                "Bun.serve() needs either:\n\n\
                 \x20 - A routes object:\n\
                 \x20    routes: {{\n\
                 \x20      \"/path\": {{\n\
                 \x20        GET: (req) => new Response(\"Hello\")\n\
                 \x20      }}\n\
                 \x20    }}\n\n\
                 \x20 - Or a fetch handler:\n\
                 \x20    fetch: (req) => {{\n\
                 \x20      return new Response(\"Hello\")\n\
                 \x20    }}\n\n\
                 Learn more at https://bun.com/docs/api/http",
            )));
        } else {
            if global.has_exception() {
                return Err(JsError::Thrown);
            }
        }

        if let Some(tls) = arg.get_truthy(global, "tls")? {
            if tls.is_falsey() {
                args.ssl_config = None;
            } else if tls.js_type().is_array() {
                let mut value_iter = tls.array_iterator(global)?;
                if value_iter.len == 0 {
                    // Empty TLS array means no TLS - this is valid
                } else {
                    while let Some(item) = value_iter.next()? {
                        let ssl_config = match SSLConfig::from_js(vm, global, item)? {
                            Some(c) => c,
                            None => {
                                if global.has_exception() {
                                    return Err(JsError::Thrown);
                                }
                                // Backwards-compatibility; we ignored empty tls objects.
                                continue;
                            }
                        };

                        if args.ssl_config.is_none() {
                            args.ssl_config = Some(ssl_config);
                        } else {
                            // Zig: `ssl_config.server_name[0] == 0` (empty C string)
                            if ssl_config.server_name_bytes().unwrap_or(b"").is_empty() {
                                drop(ssl_config);
                                return Err(global.throw_invalid_arguments(format_args!(
                                    "SNI tls object must have a serverName",
                                )));
                            }
                            if args.sni.is_none() {
                                args.sni = Some(Vec::with_capacity((value_iter.len - 1) as usize));
                            }

                            args.sni.as_mut().unwrap().push(ssl_config);
                        }
                    }
                }
            } else {
                if let Some(ssl_config) = SSLConfig::from_js(vm, global, tls)? {
                    args.ssl_config = Some(ssl_config);
                }
                if global.has_exception() {
                    return Err(JsError::Thrown);
                }
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        // @compatibility Bun v0.x - v0.2.1
        // this used to be top-level, now it's "tls" object
        if args.ssl_config.is_none() {
            if let Some(ssl_config) = SSLConfig::from_js(vm, global, arg)? {
                args.ssl_config = Some(ssl_config);
            }
            if global.has_exception() {
                return Err(JsError::Thrown);
            }
        }

        if args.h3 {
            if args.ssl_config.is_none() {
                return Err(
                    global.throw_invalid_arguments(format_args!("HTTP/3 requires 'tls' to be set"))
                );
            }
        } else if !args.h1 {
            return Err(global.throw_invalid_arguments(format_args!(
                "Cannot disable http1 without enabling http3"
            )));
        }
        if !args.h1 && matches!(args.address, Address::Unix(_)) {
            return Err(global.throw_invalid_arguments(format_args!(
                "Cannot disable http1 with a unix socket — HTTP/3 over AF_UNIX is not supported",
            )));
        }

        // ---- base_uri / base_url normalization ----
        if !args.base_uri.is_empty() {
            let base_url = URL::parse(&args.base_uri);
            if base_url.hostname.is_empty() {
                args.base_uri = Box::default();
                return Err(
                    global.throw_invalid_arguments(format_args!("baseURI must have a hostname"))
                );
            }

            if !strings::is_all_ascii(&args.base_uri) {
                args.base_uri = Box::default();
                return Err(global.throw_invalid_arguments(format_args!(
                    "Unicode baseURI must already be encoded for now.\nnew URL(baseuRI).toString() should do the trick.",
                )));
            }

            if base_url.protocol.is_empty() {
                let protocol: &[u8] = if args.ssl_config.is_some() {
                    b"https"
                } else {
                    b"http"
                };
                let hostname = base_url.hostname;
                let needs_brackets: bool =
                    strings::is_ipv6_address(hostname) && hostname[0] != b'[';
                let pathname = strings::trim_leading_char(base_url.pathname, b'/');
                let mut buf: Vec<u8> = Vec::new();
                if needs_brackets {
                    if (port == 80 && args.ssl_config.is_none())
                        || (port == 443 && args.ssl_config.is_some())
                    {
                        let _ = write!(
                            &mut buf,
                            "{}://[{}]/{}",
                            bstr::BStr::new(protocol),
                            bstr::BStr::new(hostname),
                            bstr::BStr::new(pathname)
                        );
                    } else {
                        let _ = write!(
                            &mut buf,
                            "{}://[{}]:{}/{}",
                            bstr::BStr::new(protocol),
                            bstr::BStr::new(hostname),
                            port,
                            bstr::BStr::new(pathname)
                        );
                    }
                } else {
                    if (port == 80 && args.ssl_config.is_none())
                        || (port == 443 && args.ssl_config.is_some())
                    {
                        let _ = write!(
                            &mut buf,
                            "{}://{}/{}",
                            bstr::BStr::new(protocol),
                            bstr::BStr::new(hostname),
                            bstr::BStr::new(pathname)
                        );
                    } else {
                        let _ = write!(
                            &mut buf,
                            "{}://{}:{}/{}",
                            bstr::BStr::new(protocol),
                            bstr::BStr::new(hostname),
                            port,
                            bstr::BStr::new(pathname)
                        );
                    }
                }
                // Zig: `const original_base_uri = args.base_uri; defer free(original_base_uri);`
                // `base_url` (and so `hostname`/`pathname`) borrow into the
                // original allocation; drop the borrow before reassigning.
                drop(base_url);
                args.base_uri = buf.into_boxed_slice();
            }
        } else {
            let hostname: &[u8] = if has_hostname {
                match &args.address {
                    Address::Tcp { hostname, .. } => hostname.as_ref().unwrap().as_bytes(),
                    _ => unreachable!(),
                }
            } else {
                b"0.0.0.0"
            };

            let needs_brackets: bool = strings::is_ipv6_address(hostname) && hostname[0] != b'[';

            let protocol: &[u8] = if args.ssl_config.is_some() {
                b"https"
            } else {
                b"http"
            };
            let mut buf: Vec<u8> = Vec::new();
            if needs_brackets {
                if (port == 80 && args.ssl_config.is_none())
                    || (port == 443 && args.ssl_config.is_some())
                {
                    let _ = write!(
                        &mut buf,
                        "{}://[{}]/",
                        bstr::BStr::new(protocol),
                        bstr::BStr::new(hostname)
                    );
                } else {
                    let _ = write!(
                        &mut buf,
                        "{}://[{}]:{}/",
                        bstr::BStr::new(protocol),
                        bstr::BStr::new(hostname),
                        port
                    );
                }
            } else {
                if (port == 80 && args.ssl_config.is_none())
                    || (port == 443 && args.ssl_config.is_some())
                {
                    let _ = write!(
                        &mut buf,
                        "{}://{}/",
                        bstr::BStr::new(protocol),
                        bstr::BStr::new(hostname)
                    );
                } else {
                    let _ = write!(
                        &mut buf,
                        "{}://{}:{}/",
                        bstr::BStr::new(protocol),
                        bstr::BStr::new(hostname),
                        port
                    );
                }
            }
            args.base_uri = buf.into_boxed_slice();

            if !strings::is_all_ascii(hostname) {
                args.base_uri = Box::default();
                return Err(global.throw_invalid_arguments(format_args!(
                    "Unicode hostnames must already be encoded for now.\nnew URL(input).hostname should do the trick.",
                )));
            }
        }

        // I don't think there's a case where this can happen
        // but let's check anyway, just in case
        let base_url = URL::parse(&args.base_uri);
        if base_url.hostname.is_empty() {
            args.base_uri = Box::default();
            return Err(
                global.throw_invalid_arguments(format_args!("baseURI must have a hostname"))
            );
        }

        if !base_url.username.is_empty() || !base_url.password.is_empty() {
            args.base_uri = Box::default();
            return Err(global.throw_invalid_arguments(format_args!(
                "baseURI can't have a username or password",
            )));
        }

        // PORT NOTE: deferred assertion from top of fn
        if !args.development.is_hmr_enabled() {
            debug_assert!(args.bake.is_none());
        }

        Ok(args)
    }
}

#[derive(Clone, Copy)]
pub struct FromJSOptions {
    pub allow_bake_config: bool,
    pub is_fetch_required: bool,
    pub has_user_routes: bool,
}

impl Default for FromJSOptions {
    fn default() -> Self {
        Self {
            allow_bake_config: true,
            is_fetch_required: true,
            has_user_routes: false,
        }
    }
}

pub struct UserRouteBuilder {
    pub route: RouteDeclaration,
    pub callback: Strong, // jsc.Strong.Optional
}

// ported from: src/runtime/server/ServerConfig.zig
