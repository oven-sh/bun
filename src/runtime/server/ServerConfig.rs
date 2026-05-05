use core::ffi::CStr;
use std::ffi::CString;
use std::io::Write as _;

use bun_collections::{BabyList, StringHashMap};
use bun_core::fmt as bun_fmt;
use bun_jsc::{CallFrame, JSGlobalObject, JSPropertyIterator, JSValue, JsError, JsResult, Strong};
use bun_str::strings;
use bun_uws as uws;
use bun_wyhash::Wyhash;

use bun_http::{self as http, Method};
// TODO(port): confirm crate path for bun.URL (internal URL parser, not jsc::URL)
use bun_url::URL;

use super::web_socket_server_context::WebSocketServerContext;
// TODO(port): confirm crate paths for AnyRoute / AnyServer
use bun_runtime::api::server::AnyRoute;
use bun_runtime::server::AnyServer;

// `pub const SSLConfig = @import("../socket/SSLConfig.zig");`
pub use bun_runtime::socket::ssl_config::SSLConfig;

pub struct ServerConfig {
    pub address: Address,
    pub idle_timeout: u8, // TODO: should we match websocket default idleTimeout of 120?
    pub has_idle_timeout: bool,
    // TODO: use webkit URL parser instead of bun's
    pub base_url: URL,
    pub base_uri: Box<[u8]>,

    pub ssl_config: Option<SSLConfig>,
    // TODO(port): verify BabyList<SSLConfig> drops elements; Zig looped + deinit each.
    pub sni: Option<BabyList<SSLConfig>>,
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
    pub negative_routes: Vec<CString>,
    pub user_routes_to_build: Vec<UserRouteBuilder>,

    pub bake: Option<crate::bake::UserOptions>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            address: Address::default(),
            idle_timeout: 10,
            has_idle_timeout: false,
            base_url: URL::default(),
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
    Tcp { port: u16, hostname: Option<CString> },
    Unix(CString),
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
// In Rust, CString frees on Drop; resetting is `*self = Address::default()`.

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

    pub fn memory_cost(&self) -> usize {
        // ignore size_of::<ServerConfig>(), assume already included.
        let mut cost: usize = 0;
        for entry in self.static_routes.iter() {
            cost += entry.memory_cost();
        }
        cost += self.id.len();
        cost += self.base_url.href.len();
        for route in self.negative_routes.iter() {
            cost += route.as_bytes().len();
        }

        cost
    }
}

// We need to be able to apply the route to multiple Apps even when there is only one RouteList.
pub struct RouteDeclaration {
    pub path: CString,
    pub method: RouteMethod,
}

pub enum RouteMethod {
    Any,
    Specific(http::Method),
}

impl Default for RouteDeclaration {
    fn default() -> Self {
        Self {
            path: CString::default(),
            method: RouteMethod::Any,
        }
    }
}

// PORT NOTE: Zig `RouteDeclaration.deinit` only freed `path`; CString drops automatically.

// TODO: rename to StaticRoute.Entry
pub struct StaticRouteEntry {
    pub path: Box<[u8]>,
    pub route: AnyRoute,
    pub method: http::method::Optional,
}

impl StaticRouteEntry {
    pub fn memory_cost(&self) -> usize {
        self.path.len() + self.route.memory_cost()
    }

    /// Clone the path buffer and increment the ref count
    /// This doesn't actually clone the route, it just increments the ref count
    pub fn clone(&self) -> Result<StaticRouteEntry, bun_core::Error> {
        // TODO(port): narrow error set
        self.route.ref_();

        Ok(StaticRouteEntry {
            path: Box::<[u8]>::from(&*self.path),
            route: self.route,
            method: self.method,
        })
    }

    pub fn is_less_than(_: (), this: &StaticRouteEntry, other: &StaticRouteEntry) -> bool {
        strings::cmp_strings_desc((), &this.path, &other.path)
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
        // TODO(port): narrow error set
        fn hash(route: &StaticRouteEntry) -> u64 {
            let mut hasher = Wyhash::init(0);
            match &route.method {
                http::method::Optional::Any => hasher.update(b"ANY"),
                http::method::Optional::Method(set) => {
                    let mut iter = set.iter();
                    while let Some(method) = iter.next() {
                        hasher.update(<&'static str>::from(method).as_bytes());
                    }
                }
            }
            hasher.update(&route.path);
            hasher.final_()
        }

        let mut static_routes_dedupe_list: Vec<u64> = Vec::new();
        static_routes_dedupe_list.reserve(self.static_routes.len());

        // Iterate through the list of static routes backwards
        // Later ones added override earlier ones
        let list = &mut self.static_routes;
        if !list.is_empty() {
            let mut index = list.len() - 1;
            loop {
                let route = &list[index];
                let h = hash(route);
                if static_routes_dedupe_list.iter().any(|&x| x == h) {
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
        list.sort_by(|a, b| {
            if StaticRouteEntry::is_less_than((), a, b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
        // PERF(port): Zig std.mem.sort with isLessThan — verify ordering semantics in Phase B

        Ok(())
    }

    pub fn clone_for_reloading_static_routes(&mut self) -> Result<ServerConfig, bun_core::Error> {
        // TODO(port): narrow error set
        // TODO(port): Zig did `var that = this.*;` (bitwise struct copy) then nulled ONLY
        // {ssl_config, sni, address, websocket, bake} on `this` — leaving `this` and `that`
        // ALIASING static_routes/negative_routes/user_routes_to_build/id/base_uri/base_url
        // and all scalar fields. Rust cannot alias owned Vec/Box, so we mem::take instead:
        // `that` owns everything, `self` is reset to Default. Semantic divergence from Zig:
        //   - self.static_routes / negative_routes / user_routes_to_build → now empty (Zig: aliased)
        //   - self.id / base_uri / base_url → now empty (Zig: aliased)
        //   - self.idle_timeout / max_request_body_size / development / flags → now Default (Zig: retained)
        // Phase B must verify the sole caller (server reload path) discards `self` immediately
        // after this call; if not, reshape to per-field mem::take of the 5 nulled fields.
        let mut that = core::mem::take(self);

        that.normalize_static_routes_list()?;

        Ok(that)
    }

    pub fn append_static_route(
        &mut self,
        path: &[u8],
        route: AnyRoute,
        method: http::method::Optional,
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

// TODO(port): `applyStaticRoute` uses comptime closures over (ssl, T) passed as C-style
// fn pointers to uws app.head/any/method. Rust cannot capture generics in fn pointers
// without monomorphized free fns. Phase B: define a trait `StaticRouteHandler` with
// `on_request` / `on_head_request` and generate the extern shims per (SSL, T).
pub fn apply_static_route<const SSL: bool, T>(
    server: AnyServer,
    app: &mut uws::NewApp<SSL>,
    entry: T,
    path: &[u8],
    method: http::method::Optional,
) where
    T: StaticRouteLike<SSL>,
{
    entry.set_server(server);

    fn handler<const SSL: bool, T: StaticRouteLike<SSL>>(
        route: T,
        req: &mut uws::Request,
        resp: &mut uws::NewAppResponse<SSL>,
    ) {
        route.on_request(
            RequestUnion::H1(req),
            if SSL {
                ResponseUnion::Ssl(resp)
            } else {
                ResponseUnion::Tcp(resp)
            },
        );
    }

    fn head<const SSL: bool, T: StaticRouteLike<SSL>>(
        route: T,
        req: &mut uws::Request,
        resp: &mut uws::NewAppResponse<SSL>,
    ) {
        route.on_head_request(
            RequestUnion::H1(req),
            if SSL {
                ResponseUnion::Ssl(resp)
            } else {
                ResponseUnion::Tcp(resp)
            },
        );
    }

    app.head(path, entry, head::<SSL, T>);
    match method {
        http::method::Optional::Any => {
            app.any(path, entry, handler::<SSL, T>);
        }
        http::method::Optional::Method(m) => {
            let mut iter = m.iter();
            while let Some(method_) = iter.next() {
                app.method(method_, path, entry, handler::<SSL, T>);
            }
        }
    }
}

pub fn apply_static_route_h3<T>(
    server: AnyServer,
    app: &mut uws::h3::App,
    entry: T,
    path: &[u8],
    method: http::method::Optional,
) where
    T: StaticRouteLike<false>,
{
    entry.set_server(server);

    fn handler<T: StaticRouteLike<false>>(
        route: T,
        req: &mut uws::h3::Request,
        resp: &mut uws::h3::Response,
    ) {
        route.on_request(RequestUnion::H3(req), ResponseUnion::H3(resp));
    }
    fn head<T: StaticRouteLike<false>>(
        route: T,
        req: &mut uws::h3::Request,
        resp: &mut uws::h3::Response,
    ) {
        route.on_head_request(RequestUnion::H3(req), ResponseUnion::H3(resp));
    }

    app.head(path, entry, head::<T>);
    match method {
        http::method::Optional::Any => app.any(path, entry, handler::<T>),
        http::method::Optional::Method(m) => {
            let mut iter = m.iter();
            while let Some(method_) = iter.next() {
                app.method(method_, path, entry, handler::<T>);
            }
        }
    }
}

// TODO(port): helper trait introduced to express `comptime T: type` constraint from Zig.
// Phase B: replace with the real trait bound on AnyRoute-like types.
pub trait StaticRouteLike<const SSL: bool>: Copy {
    fn set_server(&self, server: AnyServer);
    fn on_request(&self, req: RequestUnion<'_>, resp: ResponseUnion<'_>);
    fn on_head_request(&self, req: RequestUnion<'_>, resp: ResponseUnion<'_>);
}

// TODO(port): these unions mirror the anon struct literals `.{ .h1 = req }` / `.{ .SSL = resp }`.
// Real types live in bun_runtime::server; replace in Phase B.
pub enum RequestUnion<'a> {
    H1(&'a mut uws::Request),
    H3(&'a mut uws::h3::Request),
}
pub enum ResponseUnion<'a> {
    Ssl(&'a mut uws::NewAppResponse<true>),
    Tcp(&'a mut uws::NewAppResponse<false>),
    H3(&'a mut uws::h3::Response),
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
                        bstr::BStr::new(host.to_bytes()),
                        port
                    );
                } else {
                    let _ = write!(&mut arraylist, "tcp:localhost:{}", port);
                }
            }
            Address::Unix(addr) => {
                let _ = write!(&mut arraylist, "unix:{}", bstr::BStr::new(addr.to_bytes()));
            }
        }

        arraylist
    }

    pub fn get_usockets_options(&self) -> i32 {
        // Unlike Node.js, we set exclusive port in case reuse port is not set
        let mut out: i32 = if self.reuse_port {
            uws::LIBUS_LISTEN_REUSE_PORT | uws::LIBUS_LISTEN_REUSE_ADDR
        } else {
            uws::LIBUS_LISTEN_EXCLUSIVE_PORT
        };

        if self.ipv6_only {
            out |= uws::LIBUS_SOCKET_IPV6_ONLY;
        }

        out
    }
}

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
            return global.throw_todo(
                "Route parameter names cannot start with a number.\n\n\
                 If you run into this, please file an issue and we will add support for it.",
            );
        }

        let entry = duped_route_names.get_or_put(route_name);
        if entry.found_existing {
            return global.throw_todo(
                "Support for duplicate route parameter names is not yet implemented.\n\n\
                 If you run into this, please file an issue and we will add support for it.",
            );
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

impl ServerConfig {
    pub fn from_js(
        global: &JSGlobalObject,
        arguments: &mut bun_jsc::call_frame::ArgumentsSlice,
        opts: FromJSOptions,
    ) -> JsResult<ServerConfig> {
        let vm = arguments.vm;
        let env = &vm.transpiler.env;

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
                        if let Ok(_port) = bun_core::parse_int::<u16>(port, 10) {
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
            return global.throw_invalid_arguments("Bun.serve expects an object", &[]);
        };

        if !arg.is_object() {
            return global.throw_invalid_arguments("Bun.serve expects an object", &[]);
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
                return global.throw_invalid_arguments(
                    "Bun.serve() expects 'routes' to be an object shaped like:\n\n\
                     \x20 {\n\
                     \x20   \"/path\": {\n\
                     \x20     GET: (req) => new Response(\"Hello\"),\n\
                     \x20     POST: (req) => new Response(\"Hello\"),\n\
                     \x20   },\n\
                     \x20   \"/path2/:param\": new Response(\"Hello\"),\n\
                     \x20   \"/path3/:param1/:param2\": (req) => new Response(\"Hello\")\n\
                     \x20 }\n\n\
                     Learn more at https://bun.com/docs/api/http",
                    &[],
                );
            };
            args.had_routes_object = true;

            let mut iter = JSPropertyIterator::init(
                global,
                static_obj,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: true,
                    include_value: true,
                },
            )?;
            // iter drops at scope end

            let mut init_ctx_ = AnyRoute::ServerInitContext {
                // TODO(port): Zig used std.heap.ArenaAllocator here; bake consumes it.
                arena: bun_alloc::Arena::new(),
                dedupe_html_bundle_map: Default::default(),
                framework_router_list: Vec::new(),
                js_string_allocations: Default::default(), // .empty
                user_routes: &mut args.static_routes,
                global,
            };
            let init_ctx = &mut init_ctx_;
            // errdefer { init_ctx.arena.deinit(); init_ctx.framework_router_list.deinit(); }
            // — arena/Vec are owned locals; drop on `?` automatically. Ownership transfers
            // to args.bake on the success path via mem::take below.
            // This list is not used in the success case
            // (dedupe_html_bundle_map drops at scope end)

            let mut framework_router_list: Vec<crate::bake::framework_router::Type> = Vec::new();
            // errdefer framework_router_list.deinit() — Vec drops automatically
            let _ = &mut framework_router_list;
            // TODO(port): `framework_router_list` is declared but unused in Zig too (shadowed by
            // init_ctx.framework_router_list). Kept for diff fidelity; remove in Phase B.

            // errdefer { for static_routes |r| r.deinit(); clearAndFree() }
            // — Vec<StaticRouteEntry> drops elements (which deref route) automatically on error.

            while let Some(key) = iter.next()? {
                let (path, is_ascii) = key.to_owned_slice_returning_all_ascii();
                let path: Box<[u8]> = path;
                // errdefer free(path) — Box drops on error

                let value: JSValue = iter.value;

                if value.is_undefined() {
                    continue;
                }

                if path.is_empty() || path[0] != b'/' {
                    return global.throw_invalid_arguments(
                        "Invalid route {}. Path must start with '/'",
                        &[bun_fmt::quote(&path)],
                    );
                }

                if !is_ascii {
                    return global.throw_invalid_arguments(
                        "Invalid route {}. Please encode all non-ASCII characters in the path.",
                        &[bun_fmt::quote(&path)],
                    );
                }

                if value == JSValue::FALSE {
                    let duped = CString::new(&*path).expect("path has no interior NUL");
                    args.negative_routes.push(duped);
                    continue;
                }

                if value.is_callable() {
                    validate_route_name(global, &path)?;
                    args.user_routes_to_build.push(UserRouteBuilder {
                        route: RouteDeclaration {
                            path: CString::new(&*path).expect("no interior NUL"),
                            method: RouteMethod::Any,
                        },
                        callback: Strong::create(
                            value.with_async_context_if_needed(global),
                            global,
                        ),
                    });
                    continue;
                } else if value.is_object() {
                    const METHODS: [http::Method; 9] = [
                        http::Method::CONNECT,
                        http::Method::DELETE,
                        http::Method::GET,
                        http::Method::HEAD,
                        http::Method::OPTIONS,
                        http::Method::PATCH,
                        http::Method::POST,
                        http::Method::PUT,
                        http::Method::TRACE,
                    ];
                    let mut found = false;
                    for method in METHODS {
                        if let Some(function) =
                            value.get_own(global, <&'static str>::from(method))?
                        {
                            if !found {
                                validate_route_name(global, &path)?;
                            }
                            found = true;

                            if function.is_callable() {
                                args.user_routes_to_build.push(UserRouteBuilder {
                                    route: RouteDeclaration {
                                        path: CString::new(&*path).expect("no interior NUL"),
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
                                let mut method_set = http::method::Set::empty();
                                method_set.insert(method);

                                args.static_routes.push(StaticRouteEntry {
                                    path: Box::<[u8]>::from(&*path),
                                    route: html_route,
                                    method: http::method::Optional::Method(method_set),
                                });
                            }
                        }
                    }

                    if found {
                        continue;
                    }
                }

                let Some(route) = AnyRoute::from_js(global, &path, value, &mut *init_ctx)? else {
                    return global.throw_invalid_arguments(
                        "'routes' expects a Record<string, Response | HTMLBundle | {[method: string]: (req: BunRequest) => Response|Promise<Response>}>\n\n\
                         To bundle frontend apps on-demand with Bun.serve(), import HTML files.\n\n\
                         Example:\n\n\
                         ```js\n\
                         import { serve } from \"bun\";\n\
                         import app from \"./app.html\";\n\n\
                         serve({\n\
                         \x20 routes: {\n\
                         \x20   \"/index.json\": Response.json({ message: \"Hello World\" }),\n\
                         \x20   \"/app\": app,\n\
                         \x20   \"/path/:param\": (req) => {\n\
                         \x20     const param = req.params.param;\n\
                         \x20     return Response.json({ message: `Hello ${param}` });\n\
                         \x20   },\n\
                         \x20   \"/path\": {\n\
                         \x20     GET(req) {\n\
                         \x20       return Response.json({ message: \"Hello World\" });\n\
                         \x20     },\n\
                         \x20     POST(req) {\n\
                         \x20       return Response.json({ message: \"Hello World\" });\n\
                         \x20     },\n\
                         \x20   },\n\
                         \x20 },\n\n\
                         \x20 fetch(request) {\n\
                         \x20   return new Response(\"fallback response\");\n\
                         \x20 },\n\
                         });\n\
                         ```\n\n\
                         See https://bun.com/docs/api/http for more information.",
                        &[],
                    );
                };
                args.static_routes.push(StaticRouteEntry {
                    path,
                    route,
                    method: http::method::Optional::Any,
                });
            }

            // When HTML bundles are provided, ensure DevServer options are ready
            // The presence of these options causes Bun.serve to initialize things.
            if init_ctx.dedupe_html_bundle_map.count() > 0
                || !init_ctx.framework_router_list.is_empty()
            {
                if args.development.is_hmr_enabled() {
                    let root = bun_fs::FileSystem::instance().top_level_dir;
                    let framework = crate::bake::Framework::auto(
                        &init_ctx.arena,
                        &mut global.bun_vm().transpiler.resolver,
                        &init_ctx.framework_router_list,
                    )?;
                    args.bake = Some(crate::bake::UserOptions {
                        // TODO(port): ownership transfer of arena/js_string_allocations into bake
                        arena: core::mem::take(&mut init_ctx.arena),
                        allocations: core::mem::take(&mut init_ctx.js_string_allocations),
                        root,
                        framework,
                        bundler_options: crate::bake::SplitBundlerOptions::empty(),
                    });
                    let bake = args.bake.as_mut().unwrap();

                    let o = &vm.transpiler.options.transform_options;

                    // TODO(port): confirm enum path for serve_env_behavior
                    match o.serve_env_behavior {
                        bun_bundler::options::EnvBehavior::Prefix => {
                            bake.bundler_options.client.env_prefix =
                                vm.transpiler.options.transform_options.serve_env_prefix.clone();
                            bake.bundler_options.client.env =
                                bun_bundler::options::EnvBehavior::Prefix;
                        }
                        bun_bundler::options::EnvBehavior::LoadAll => {
                            bake.bundler_options.client.env =
                                bun_bundler::options::EnvBehavior::LoadAll;
                        }
                        bun_bundler::options::EnvBehavior::Disable => {
                            bake.bundler_options.client.env =
                                bun_bundler::options::EnvBehavior::Disable;
                        }
                        _ => {}
                    }

                    if let Some(define) = &o.serve_define {
                        bake.bundler_options.client.define = define.clone();
                        bake.bundler_options.server.define = define.clone();
                        bake.bundler_options.ssr.define = define.clone();
                    }
                } else {
                    if !init_ctx.framework_router_list.is_empty() {
                        return global.throw_invalid_arguments(
                            "FrameworkRouter is currently only supported when `development: true`",
                            &[],
                        );
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
                    return global.throw_invalid_arguments(
                        "Bun.serve expects idleTimeout to be an integer",
                        &[],
                    );
                }
                args.has_idle_timeout = true;

                let idle_timeout: u64 = u64::try_from(value.to_int64().max(0)).unwrap();
                if idle_timeout > 255 {
                    return global.throw_invalid_arguments(
                        "Bun.serve expects idleTimeout to be 255 or less",
                        &[],
                    );
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
                return global
                    .throw_invalid_arguments("Expected websocket to be an object", &[]);
            }

            // errdefer ssl_config.deinit() — drops with args on error
            args.websocket = Some(WebSocketServerContext::on_create(global, websocket_object)?);
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(port_) = arg.get_truthy(global, "port")? {
            let p = u16::try_from(
                (port_.coerce::<i32>(global)?).max(0).min(i32::from(u16::MAX)),
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

            if sliced.len() > 0 {
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

            if host_str.len() > 0 {
                let hostname =
                    CString::new(host_str.slice()).expect("hostname has no interior NUL");
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
            if unix_str.len() > 0 {
                if has_hostname {
                    return global
                        .throw_invalid_arguments("Cannot specify both hostname and unix", &[]);
                }

                args.address = Address::Unix(
                    CString::new(unix_str.slice()).expect("unix path has no interior NUL"),
                );
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(id) = arg.get(global, "id")? {
            if id.is_undefined_or_null() {
                args.allow_hot = false;
            } else {
                let id_str = id.to_utf8_bytes(global)?;
                if !id_str.is_empty() {
                    args.id = id_str;
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
                        return global
                            .throw_invalid_arguments("'app' + HTML loader not supported.", &[]);
                    }

                    if args.development == DevelopmentOption::Production {
                        return global.throw_invalid_arguments(
                            "TODO: 'development: false' in serve options with 'app'. For now, use `bun build --app` or set 'development: true'",
                            &[],
                        );
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

        if let Some(v) = arg.get(global, "h3")? {
            args.h3 = v.to_boolean();
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(v) = arg.get(global, "h1")? {
            args.h1 = v.to_boolean();
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(max_request_body_size) = arg.get_truthy(global, "maxRequestBodySize")? {
            if max_request_body_size.is_number() {
                args.max_request_body_size =
                    u64::try_from(max_request_body_size.to_int64().max(0)).unwrap() as usize;
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(on_error) = arg.get_truthy_comptime(global, "error")? {
            if !on_error.is_callable() {
                return global.throw_invalid_arguments("Expected error to be a function", &[]);
            }
            let on_error_snapshot = on_error.with_async_context_if_needed(global);
            args.on_error = Some(Strong::create(on_error_snapshot, global));
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(on_request_) = arg.get_truthy(global, "onNodeHTTPRequest")? {
            if !on_request_.is_callable() {
                return global.throw_invalid_arguments(
                    "Expected onNodeHTTPRequest to be a function",
                    &[],
                );
            }
            let on_request = on_request_.with_async_context_if_needed(global);
            args.on_node_http_request = Some(Strong::create(on_request, global));
        }

        if let Some(on_request_) = arg.get_truthy(global, "fetch")? {
            if !on_request_.is_callable() {
                return global.throw_invalid_arguments("Expected fetch() to be a function", &[]);
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
            return global.throw_invalid_arguments(
                "Bun.serve() needs either:\n\n\
                 \x20 - A routes object:\n\
                 \x20    routes: {\n\
                 \x20      \"/path\": {\n\
                 \x20        GET: (req) => new Response(\"Hello\")\n\
                 \x20      }\n\
                 \x20    }\n\n\
                 \x20 - Or a fetch handler:\n\
                 \x20    fetch: (req) => {\n\
                 \x20      return new Response(\"Hello\")\n\
                 \x20    }\n\n\
                 Learn more at https://bun.com/docs/api/http",
                &[],
            );
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
                            if ssl_config
                                .server_name
                                .as_deref()
                                .map(|s| s.as_bytes())
                                .unwrap_or(b"\0")[0]
                                == 0
                            {
                                drop(ssl_config);
                                return global.throw_invalid_arguments(
                                    "SNI tls object must have a serverName",
                                    &[],
                                );
                            }
                            if args.sni.is_none() {
                                args.sni = Some(BabyList::with_capacity(
                                    (value_iter.len - 1) as usize,
                                ));
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
                return global
                    .throw_invalid_arguments("HTTP/3 requires 'tls' to be set", &[]);
            }
        } else if !args.h1 {
            return global
                .throw_invalid_arguments("Cannot disable h1 without enabling h3", &[]);
        }
        if !args.h1 && matches!(args.address, Address::Unix(_)) {
            return global.throw_invalid_arguments(
                "Cannot disable h1 with a unix socket — HTTP/3 over AF_UNIX is not supported",
                &[],
            );
        }

        // ---- base_uri / base_url normalization ----
        if !args.base_uri.is_empty() {
            args.base_url = URL::parse(&args.base_uri);
            if args.base_url.hostname.is_empty() {
                args.base_uri = Box::default();
                return global.throw_invalid_arguments("baseURI must have a hostname", &[]);
            }

            if !strings::is_all_ascii(&args.base_uri) {
                args.base_uri = Box::default();
                return global.throw_invalid_arguments(
                    "Unicode baseURI must already be encoded for now.\nnew URL(baseuRI).toString() should do the trick.",
                    &[],
                );
            }

            if args.base_url.protocol.is_empty() {
                let protocol: &[u8] = if args.ssl_config.is_some() {
                    b"https"
                } else {
                    b"http"
                };
                let hostname = args.base_url.hostname;
                let needs_brackets: bool =
                    strings::is_ipv6_address(hostname) && hostname[0] != b'[';
                // original_base_uri freed when overwritten below (Box drop)
                let pathname = strings::trim_leading_char(args.base_url.pathname, b'/');
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
                args.base_uri = buf.into_boxed_slice();

                args.base_url = URL::parse(&args.base_uri);
            }
        } else {
            let hostname: &[u8] = if has_hostname {
                match &args.address {
                    Address::Tcp { hostname, .. } => hostname.as_ref().unwrap().to_bytes(),
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
                return global.throw_invalid_arguments(
                    "Unicode hostnames must already be encoded for now.\nnew URL(input).hostname should do the trick.",
                    &[],
                );
            }

            args.base_url = URL::parse(&args.base_uri);
        }

        // I don't think there's a case where this can happen
        // but let's check anyway, just in case
        if args.base_url.hostname.is_empty() {
            args.base_uri = Box::default();
            return global.throw_invalid_arguments("baseURI must have a hostname", &[]);
        }

        if !args.base_url.username.is_empty() || !args.base_url.password.is_empty() {
            args.base_uri = Box::default();
            return global
                .throw_invalid_arguments("baseURI can't have a username or password", &[]);
        }

        // PORT NOTE: deferred assertion from top of fn
        if !args.development.is_hmr_enabled() {
            debug_assert!(args.bake.is_none());
        }

        Ok(args)
    }
}

pub struct UserRouteBuilder {
    pub route: RouteDeclaration,
    pub callback: Strong, // jsc.Strong.Optional
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/ServerConfig.zig (1127 lines)
//   confidence: medium
//   todos:      17
//   notes:      apply_static_route handler shims need real trait; URL/base_uri borrow into Box<[u8]> needs self-referential fix in Phase B; clone_for_reloading_static_routes resets more of self than Zig (see TODO).
// ──────────────────────────────────────────────────────────────────────────
