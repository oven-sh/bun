use core::ffi::CStr;
use std::ffi::CString;
use std::io::Write as _;

use bun_collections::{BabyList, StringHashMap};
use bun_str::strings;
use bun_uws_sys as uws;
use bun_wyhash::Wyhash;

use bun_http_types::Method as http_method;
pub use http_method::{Method, Optional as MethodOptional};
// TODO(port): confirm crate path for bun.URL (internal URL parser, not jsc::URL)
use bun_url::URL;

use crate::server::jsc::{JSGlobalObject, JSPropertyIterator, JSValue, JsError, JsResult, Strong};
use super::web_socket_server_context::WebSocketServerContext;
use super::{AnyRoute, AnyServer};
use crate::node::crypto::JSValueCryptoExt as _; // with_async_context_if_needed
use bun_core::fmt as bun_fmt;

// `pub const SSLConfig = @import("../socket/SSLConfig.zig");`
pub use crate::socket::ssl_config::SSLConfig;

pub struct ServerConfig {
    pub address: Address,
    pub idle_timeout: u8, // TODO: should we match websocket default idleTimeout of 120?
    pub has_idle_timeout: bool,
    // TODO: use webkit URL parser instead of bun's
    // PORT NOTE: Zig URL borrows into base_uri; URL<'static> + empty default
    // until OwnedURL or self-referential reshape lands (see Phase-A todo below).
    pub base_url: URL<'static>,
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

/// Parse `bytes` into a `URL<'static>` by erasing the borrow lifetime.
///
/// # Safety
/// The returned `URL` borrows directly into `bytes`. Caller must guarantee the
/// backing allocation (ServerConfig::base_uri's heap buffer) outlives every
/// read of the returned URL's fields, and that `base_url` is reset to
/// `URL::default()` *before* `base_uri` is freed or reassigned. This mirrors
/// the self-referential `base_url -> base_uri` layout from ServerConfig.zig
/// until an owned-URL reshape lands (see PORT NOTE on the struct fields).
#[inline]
unsafe fn parse_base_url_static(bytes: &[u8]) -> URL<'static> {
    let extended: &'static [u8] =
        unsafe { core::slice::from_raw_parts(bytes.as_ptr(), bytes.len()) };
    URL::parse(extended)
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
    Specific(Method),
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
    pub method: MethodOptional,
}

impl StaticRouteEntry {
    pub fn memory_cost(&self) -> usize {
        self.path.len() + self.route.memory_cost()
    }

    // clone(): Rc-based AnyRoute makes the Zig clone() a plain `Clone` derive
    // once AnyRoute impls it. Kept gated until AnyRoute::ref_ semantics settle.
    // TODO(port): impl Clone for StaticRouteEntry via Rc::clone on route.

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

/// Local shim: `@tagName(method)` — `bun_http::Method` has no `From<Method> for &str`
/// upstream yet (blocked_on: bun_http_types::Method as_str).
pub(crate) fn method_as_str(m: Method) -> &'static str {
    match m {
        Method::ACL => "ACL",
        Method::BIND => "BIND",
        Method::CHECKOUT => "CHECKOUT",
        Method::CONNECT => "CONNECT",
        Method::COPY => "COPY",
        Method::DELETE => "DELETE",
        Method::GET => "GET",
        Method::HEAD => "HEAD",
        Method::LINK => "LINK",
        Method::LOCK => "LOCK",
        Method::M_SEARCH => "M-SEARCH",
        Method::MERGE => "MERGE",
        Method::MKACTIVITY => "MKACTIVITY",
        Method::MKADDRESSBOOK => "MKADDRESSBOOK",
        Method::MKCALENDAR => "MKCALENDAR",
        Method::MKCOL => "MKCOL",
        Method::MOVE => "MOVE",
        Method::NOTIFY => "NOTIFY",
        Method::OPTIONS => "OPTIONS",
        Method::PATCH => "PATCH",
        Method::POST => "POST",
        Method::PROPFIND => "PROPFIND",
        Method::PROPPATCH => "PROPPATCH",
        Method::PURGE => "PURGE",
        Method::PUT => "PUT",
        Method::QUERY => "QUERY",
        Method::REBIND => "REBIND",
        Method::REPORT => "REPORT",
        Method::SEARCH => "SEARCH",
        Method::SOURCE => "SOURCE",
        Method::SUBSCRIBE => "SUBSCRIBE",
        Method::TRACE => "TRACE",
        Method::UNBIND => "UNBIND",
        Method::UNLINK => "UNLINK",
        Method::UNLOCK => "UNLOCK",
        Method::UNSUBSCRIBE => "UNSUBSCRIBE",
    }
}

impl ServerConfig {
    // TODO(b2-blocked): bun_wyhash::Wyhash (std seed-0 flavor not yet ported;
    // only Wyhash11 exists) + http_method::Set iterator. Body preserved.

    fn normalize_static_routes_list(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        fn hash(route: &StaticRouteEntry) -> u64 {
            let mut hasher = Wyhash::init(0);
            match &route.method {
                MethodOptional::Any => hasher.update(b"ANY"),
                MethodOptional::Method(set) => {
                    let mut iter = set.iter();
                    while let Some(method) = iter.next() {
                        hasher.update(method_as_str(method).as_bytes());
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

     // gated alongside normalize_static_routes_list (its only callee).
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
    unsafe { &*entry }.set_server(server);

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
        let route: &T = unsafe { &*(user_data as *const T) };
        let req: &mut uws::Request = unsafe { &mut *req };
        let resp: &mut uws::NewAppResponse<SSL> =
            unsafe { &mut *uws::NewAppResponse::<SSL>::cast_res(resp) };
        if SSL {
            // SAFETY: SSL == true ⇒ NewAppResponse<SSL> is NewAppResponse<true>;
            // both are `#[repr(C)]` opaques over the same `uws_res`.
            let resp: &mut uws::NewAppResponse<true> =
                unsafe { &mut *(resp as *mut _ as *mut uws::NewAppResponse<true>) };
            route.on_request(RequestUnion::H1(req), ResponseUnion::Ssl(resp));
        } else {
            // SAFETY: SSL == false ⇒ NewAppResponse<SSL> is NewAppResponse<false>.
            let resp: &mut uws::NewAppResponse<false> =
                unsafe { &mut *(resp as *mut _ as *mut uws::NewAppResponse<false>) };
            route.on_request(RequestUnion::H1(req), ResponseUnion::Tcp(resp));
        }
    }

    extern "C" fn head<const SSL: bool, T: StaticRouteLike<SSL>>(
        resp: *mut uws::uws_res,
        req: *mut uws::Request,
        user_data: *mut core::ffi::c_void,
    ) {
        // SAFETY: see `handler` above.
        let route: &T = unsafe { &*(user_data as *const T) };
        let req: &mut uws::Request = unsafe { &mut *req };
        let resp: &mut uws::NewAppResponse<SSL> =
            unsafe { &mut *uws::NewAppResponse::<SSL>::cast_res(resp) };
        if SSL {
            // SAFETY: see `handler` above.
            let resp: &mut uws::NewAppResponse<true> =
                unsafe { &mut *(resp as *mut _ as *mut uws::NewAppResponse<true>) };
            route.on_head_request(RequestUnion::H1(req), ResponseUnion::Ssl(resp));
        } else {
            // SAFETY: see `handler` above.
            let resp: &mut uws::NewAppResponse<false> =
                unsafe { &mut *(resp as *mut _ as *mut uws::NewAppResponse<false>) };
            route.on_head_request(RequestUnion::H1(req), ResponseUnion::Tcp(resp));
        }
    }

    let user_data = entry as *mut core::ffi::c_void;
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
    unsafe { &*entry }.set_server(server);

    fn handler<T: StaticRouteLike<false>>(
        route: &mut T,
        req: &mut uws::h3::Request,
        resp: &mut uws::h3::Response,
    ) {
        route.on_request(RequestUnion::H3(req), ResponseUnion::H3(resp));
    }
    fn head<T: StaticRouteLike<false>>(
        route: &mut T,
        req: &mut uws::h3::Request,
        resp: &mut uws::h3::Response,
    ) {
        route.on_head_request(RequestUnion::H3(req), ResponseUnion::H3(resp));
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

// TODO(port): helper trait introduced to express `comptime T: type` constraint from Zig.
// Phase B: replace with the real trait bound on AnyRoute-like types.
pub trait StaticRouteLike<const SSL: bool>: 'static {
    fn set_server(&self, server: AnyServer);
    fn on_request(&self, req: RequestUnion<'_>, resp: ResponseUnion<'_>);
    fn on_head_request(&self, req: RequestUnion<'_>, resp: ResponseUnion<'_>);
}

// TODO(port): these unions mirror the anon struct literals `.{ .h1 = req }` / `.{ .SSL = resp }`.
pub enum RequestUnion<'a> {
    H1(&'a mut bun_uws_sys::Request),
    H3(&'a mut bun_uws_sys::h3::Request),
}
pub enum ResponseUnion<'a> {
    Ssl(&'a mut bun_uws_sys::NewAppResponse<true>),
    Tcp(&'a mut bun_uws_sys::NewAppResponse<false>),
    H3(&'a mut bun_uws_sys::h3::Response),
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

// Local extension shim for `JSValue::get_boolean_strict` (upstream copy in
// `crate::node::fs` is `pub(super)` and not reachable here).
trait JSValueBooleanStrictExt {
    fn get_boolean_strict(
        self,
        global: &JSGlobalObject,
        name: &'static str,
    ) -> JsResult<Option<bool>>;
}
impl JSValueBooleanStrictExt for JSValue {
    fn get_boolean_strict(
        self,
        global: &JSGlobalObject,
        name: &'static str,
    ) -> JsResult<Option<bool>> {
        match self.get(global, name)? {
            Some(v) if v.is_boolean() => Ok(Some(v.to_boolean())),
            Some(v) if v.is_undefined_or_null() => Ok(None),
            Some(_) => Err(global.throw_invalid_arguments(format_args!(
                "Expected '{}' to be a boolean",
                name
            ))),
            None => Ok(None),
        }
    }
}

/// `AnyRoute::fromJS` — parse via `server_body::AnyRoute::from_js` then
/// convert to the `crate::server::AnyRoute` (mod.rs) enum that
/// `StaticRouteEntry` stores. The two enums are nominally distinct (Phase-A
/// duplication) but variant-isomorphic; this is the bridge until they unify.
#[inline]
fn any_route_from_js(
    global: &JSGlobalObject,
    path: &[u8],
    argument: JSValue,
    init_ctx: &mut super::server_body::ServerInitContext,
) -> JsResult<Option<AnyRoute>> {
    use super::server_body::AnyRoute as BodyAnyRoute;
    Ok(BodyAnyRoute::from_js(global, path, argument, init_ctx)?.map(|r| match r {
        BodyAnyRoute::Static(rc) => AnyRoute::Static(rc),
        BodyAnyRoute::File(rc) => AnyRoute::File(rc),
        // RefPtr<Route> → *const Route: transfer the strong ref into the raw
        // pointer via `into_raw()`. `AnyRoute::deref_` (mod.rs) decrements via
        // the intrusive refcount, so the count stays balanced.
        BodyAnyRoute::Html(refptr) => AnyRoute::Html(refptr.into_raw() as *const _),
        BodyAnyRoute::FrameworkRouter(idx) => AnyRoute::FrameworkRouter(idx.get()),
    }))
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
            return Err(global.throw_todo(
                "Route parameter names cannot start with a number.\n\n\
                 If you run into this, please file an issue and we will add support for it.",
            ));
        }

        let entry = bun_core::handle_oom(duped_route_names.get_or_put(route_name));
        if entry.found_existing {
            return Err(global.throw_todo(
                "Support for duplicate route parameter names is not yet implemented.\n\n\
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
    // SAFETY: returned slices borrow into `arena`, which is moved into
    // `UserOptions` and outlives every reader (self-referential pattern; see
    // `bake_body::arena_dupe_z`). `'static` is a lie that Phase B threads to
    // `'bump`.
    #[inline]
    unsafe fn erase<'a, T: ?Sized>(r: &'a T) -> &'static T {
        core::mem::transmute::<&'a T, &'static T>(r)
    }
    let dupe = |bytes: &[u8]| -> &'static [u8] {
        // SAFETY: see `erase` doc above.
        unsafe { erase(arena.alloc_slice_copy(bytes)) }
    };
    let dupe_slice_of = |v: &[std::borrow::Cow<'static, [u8]>]| -> &'static [&'static [u8]] {
        let inner: Vec<&'static [u8]> = v.iter().map(|c| dupe(c.as_ref())).collect();
        // SAFETY: see `erase` doc above.
        unsafe { erase(arena.alloc_slice_copy(&inner)) }
    };

    bb::FileSystemRouterType {
        root: dupe(src.root.as_ref()),
        prefix: dupe(src.prefix.as_ref()),
        entry_server: dupe(src.entry_server.as_ref()),
        entry_client: src.entry_client.as_deref().map(|b| dupe(b)),
        ignore_underscores: src.ignore_underscores,
        ignore_dirs: dupe_slice_of(&src.ignore_dirs),
        extensions: dupe_slice_of(&src.extensions),
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
        // SAFETY: `vm.transpiler.env` is the long-lived dotenv loader owned by the VM.
        let env = unsafe { &*vm.transpiler.env };

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
                        if let Ok(_port) = bun_string::immutable::parse_int::<u16>(port, 10) {
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
            return Err(global.throw_invalid_arguments("Bun.serve expects an object"));
        };

        if !arg.is_object() {
            return Err(global.throw_invalid_arguments("Bun.serve expects an object"));
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
                return Err(global.throw_invalid_arguments(
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
                ));
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

            let mut init_ctx_ = super::server_body::ServerInitContext {
                // TODO(port): Zig used std.heap.ArenaAllocator here; ServerInitContext
                // dropped its `arena` field in the Rust port (bake owns it instead).
                dedupe_html_bundle_map: Default::default(),
                framework_router_list: Vec::new(),
                js_string_allocations: crate::bake::StringRefList::EMPTY,
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
                // PORT NOTE: `to_owned_slice_returning_all_ascii` not yet on
                // `bun_str::String`; split into `to_owned_slice()` + `is_all_ascii`.
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
                        let method_name = bun_str::String::static_(method_as_str(method));
                        if let Some(function) =
                            value.get_own(global, &method_name)?
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
                                any_route_from_js(global, &path, function, &mut *init_ctx)?
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

                let Some(route) = any_route_from_js(global, &path, value, &mut *init_ctx)? else {
                    return Err(global.throw_invalid_arguments(
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
                    ));
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
                    use bun_schema::api::DotEnvBehavior;

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
                    let resolver =
                        unsafe { &mut (*global.bun_vm()).transpiler.resolver };
                    let framework = bb::Framework::auto(&arena, resolver, router_types)
                        .map_err(|e| {
                            global.throw_error(e, "Framework::auto")
                        })?;

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
                                .map(|p| {
                                    bb::arena_dupe_z(&user_options.arena, p)
                                        .as_bytes()
                                });
                            user_options.bundler_options.client.env =
                                DotEnvBehavior::prefix;
                        }
                        DotEnvBehavior::load_all => {
                            user_options.bundler_options.client.env =
                                DotEnvBehavior::load_all;
                        }
                        DotEnvBehavior::disable => {
                            user_options.bundler_options.client.env =
                                DotEnvBehavior::disable;
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
                        return Err(global.throw_invalid_arguments(
                            "FrameworkRouter is currently only supported when `development: true`",
                        ));
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
                    return Err(global.throw_invalid_arguments(
                        "Bun.serve expects idleTimeout to be an integer",
                    ));
                }
                args.has_idle_timeout = true;

                let idle_timeout: u64 = u64::try_from(value.to_int64().max(0)).unwrap();
                if idle_timeout > 255 {
                    return Err(global.throw_invalid_arguments(
                        "Bun.serve expects idleTimeout to be 255 or less",
                    ));
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
                    .throw_invalid_arguments("Expected websocket to be an object"));
            }

            // errdefer ssl_config.deinit() — drops with args on error
            args.websocket = Some(super::web_socket_server_context::on_create(global, websocket_object)?);
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
            if !unix_str.slice().is_empty() {
                if has_hostname {
                    return Err(global
                        .throw_invalid_arguments("Cannot specify both hostname and unix"));
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
                        return Err(global
                            .throw_invalid_arguments("'app' + HTML loader not supported."));
                    }

                    if args.development == DevelopmentOption::Production {
                        return Err(global.throw_invalid_arguments(
                            "TODO: 'development: false' in serve options with 'app'. For now, use `bun build --app` or set 'development: true'",
                        ));
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

        if let Some(on_error) = arg.get_truthy(global, "error")? {
            if !on_error.is_callable() {
                return Err(global.throw_invalid_arguments("Expected error to be a function"));
            }
            let on_error_snapshot = on_error.with_async_context_if_needed(global);
            args.on_error = Some(Strong::create(on_error_snapshot, global));
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(on_request_) = arg.get_truthy(global, "onNodeHTTPRequest")? {
            if !on_request_.is_callable() {
                return Err(global.throw_invalid_arguments(
                    "Expected onNodeHTTPRequest to be a function",
                ));
            }
            let on_request = on_request_.with_async_context_if_needed(global);
            args.on_node_http_request = Some(Strong::create(on_request, global));
        }

        if let Some(on_request_) = arg.get_truthy(global, "fetch")? {
            if !on_request_.is_callable() {
                return Err(global.throw_invalid_arguments("Expected fetch() to be a function"));
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
            return Err(global.throw_invalid_arguments(
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
            ));
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
                            if ssl_config
                                .server_name
                                .as_deref()
                                .map(|s| s.to_bytes())
                                .unwrap_or(b"")
                                .is_empty()
                            {
                                drop(ssl_config);
                                return Err(global.throw_invalid_arguments(
                                    "SNI tls object must have a serverName",
                                ));
                            }
                            if args.sni.is_none() {
                                args.sni = Some(bun_core::handle_oom(BabyList::init_capacity(
                                    (value_iter.len - 1) as usize,
                                )));
                            }

                            bun_core::handle_oom(
                                args.sni.as_mut().unwrap().append(ssl_config),
                            );
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
                return Err(global
                    .throw_invalid_arguments("HTTP/3 requires 'tls' to be set"));
            }
        } else if !args.h1 {
            return Err(global
                .throw_invalid_arguments("Cannot disable h1 without enabling h3"));
        }
        if !args.h1 && matches!(args.address, Address::Unix(_)) {
            return Err(global.throw_invalid_arguments(
                "Cannot disable h1 with a unix socket — HTTP/3 over AF_UNIX is not supported",
            ));
        }

        // ---- base_uri / base_url normalization ----
        if !args.base_uri.is_empty() {
            // SAFETY: base_url borrows into base_uri's heap allocation; we reset
            // base_url to default before every base_uri reassignment below.
            args.base_url = unsafe { parse_base_url_static(&args.base_uri) };
            if args.base_url.hostname.is_empty() {
                args.base_url = URL::default();
                args.base_uri = Box::default();
                return Err(global.throw_invalid_arguments("baseURI must have a hostname"));
            }

            if !strings::is_all_ascii(&args.base_uri) {
                args.base_url = URL::default();
                args.base_uri = Box::default();
                return Err(global.throw_invalid_arguments(
                    "Unicode baseURI must already be encoded for now.\nnew URL(baseuRI).toString() should do the trick.",
                ));
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
                // original base_uri kept alive via mem::replace below until reparse completes
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
                // Zig: `const original_base_uri = args.base_uri; defer free(original_base_uri);`
                // Keep the previous allocation alive across the reparse — `hostname`
                // / `pathname` above (and args.base_url's fields) still borrow into it.
                let prev_base_uri =
                    core::mem::replace(&mut args.base_uri, buf.into_boxed_slice());
                // SAFETY: see parse_base_url_static; new base_uri now owns the bytes.
                args.base_url = unsafe { parse_base_url_static(&args.base_uri) };
                drop(prev_base_uri);
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
                return Err(global.throw_invalid_arguments(
                    "Unicode hostnames must already be encoded for now.\nnew URL(input).hostname should do the trick.",
                ));
            }

            // SAFETY: base_url borrows into base_uri's heap allocation; reset on error below.
            args.base_url = unsafe { parse_base_url_static(&args.base_uri) };
        }

        // I don't think there's a case where this can happen
        // but let's check anyway, just in case
        if args.base_url.hostname.is_empty() {
            args.base_url = URL::default();
            args.base_uri = Box::default();
            return Err(global.throw_invalid_arguments("baseURI must have a hostname"));
        }

        if !args.base_url.username.is_empty() || !args.base_url.password.is_empty() {
            args.base_url = URL::default();
            args.base_uri = Box::default();
            return Err(global
                .throw_invalid_arguments("baseURI can't have a username or password"));
        }

        // PORT NOTE: deferred assertion from top of fn
        if !args.development.is_hmr_enabled() {
            debug_assert!(args.bake.is_none());
        }

        Ok(args)
    }
}
} // mod _gated_from_js

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/ServerConfig.zig (1127 lines)
//   confidence: medium
//   todos:      17
//   notes:      apply_static_route handler shims need real trait; URL/base_uri borrow into Box<[u8]> needs self-referential fix in Phase B; clone_for_reloading_static_routes resets more of self than Zig (see TODO).
// ──────────────────────────────────────────────────────────────────────────
