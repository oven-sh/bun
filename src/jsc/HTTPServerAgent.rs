use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_str::String as BunString;

pub struct HTTPServerAgent {
    /// Underlying C++ agent. Set to null when not enabled.
    // TODO(port): lifetime — FFI-owned C++ opaque; raw ptr is correct here
    pub agent: Option<NonNull<InspectorHTTPServerAgent>>,

    /// This becomes the "server ID" field.
    pub next_server_id: ServerId,
}

impl Default for HTTPServerAgent {
    fn default() -> Self {
        Self {
            agent: None,
            next_server_id: ServerId::new(0),
        }
    }
}

impl HTTPServerAgent {
    pub fn is_enabled(&self) -> bool {
        self.agent.is_some()
    }

    // #region Events

    pub fn notify_server_started(&mut self, instance: bun_jsc::api::AnyServer) {
        if let Some(agent) = self.agent {
            self.next_server_id = ServerId::new(self.next_server_id.get() + 1);
            instance.set_inspector_server_id(self.next_server_id);
            let url = instance.get_url_as_string();
            // `defer url.deref()` — handled by bun_str::String Drop

            // SAFETY: agent is non-null (checked above) and points to a live C++ InspectorHTTPServerAgent
            unsafe {
                InspectorHTTPServerAgent::notify_server_started(
                    agent.as_ptr(),
                    self.next_server_id,
                    i32::try_from(instance.vm().hot_reload_counter).unwrap(),
                    &url,
                    bun_core::Timespec::now_allow_mocked_time().ms() as f64,
                    instance.ptr.ptr() as *mut c_void,
                );
            }
        }
    }

    pub fn notify_server_stopped(&self, server: bun_jsc::api::AnyServer) {
        if let Some(agent) = self.agent {
            // SAFETY: agent is non-null and points to a live C++ InspectorHTTPServerAgent
            unsafe {
                InspectorHTTPServerAgent::notify_server_stopped(
                    agent.as_ptr(),
                    server.inspector_server_id(),
                    // TODO(port): std.time.milliTimestamp() equivalent
                    bun_core::time::milli_timestamp() as f64,
                );
            }
        }
    }

    pub fn notify_server_routes_updated(
        &self,
        server: bun_jsc::api::AnyServer,
    ) -> Result<(), bun_alloc::AllocError> {
        // TODO(port): narrow error set — only alloc errors possible; Vec::push aborts on OOM in Rust
        if let Some(agent) = self.agent {
            let config = server.config();
            let mut routes: Vec<Route> = Vec::new();
            // `defer { for routes |*r| r.deinit(); routes.deinit() }` — handled by Vec<Route> Drop + Route Drop

            let mut max_id: u32 = 0;

            // TODO(port): Zig used `switch (server.userRoutes()) { inline else => |user_routes| ... }`
            // to monomorphize over SSL/non-SSL variants. In Rust, expose `user_routes()` returning
            // a uniform slice (or a trait providing iteration) and iterate once.
            for user_route in server.user_routes() {
                let decl: &bun_jsc::api::ServerConfig::RouteDeclaration = &user_route.route;
                max_id = max_id.max(user_route.id);
                routes.push(Route {
                    route_id: i32::try_from(user_route.id).unwrap(),
                    path: BunString::init(&decl.path),
                    r#type: RouteType::Api,
                    // TODO:
                    param_names: core::ptr::null_mut(),
                    param_names_len: 0,
                    script_line: -1,
                    file_path: BunString::empty(),
                    script_id: BunString::empty(),
                    script_url: BunString::empty(),
                });
            }

            for route in config.static_routes.iter() {
                routes.push(Route {
                    route_id: i32::try_from(max_id + 1).unwrap(),
                    path: BunString::init(&route.path),
                    r#type: match &route.route {
                        // TODO(port): exact variant names of ServerConfig static route union
                        bun_jsc::api::ServerConfig::StaticRouteKind::Html(_) => RouteType::Html,
                        bun_jsc::api::ServerConfig::StaticRouteKind::Static(_) => RouteType::Static,
                        _ => RouteType::Default,
                    },
                    script_line: -1,
                    // TODO:
                    param_names: core::ptr::null_mut(),
                    param_names_len: 0,
                    file_path: match &route.route {
                        bun_jsc::api::ServerConfig::StaticRouteKind::Html(html) => {
                            BunString::init(&html.data.bundle.data.path)
                        }
                        _ => BunString::empty(),
                    },
                    script_id: BunString::empty(),
                    script_url: BunString::empty(),
                });
                max_id += 1;
            }

            // SAFETY: agent is non-null and points to a live C++ InspectorHTTPServerAgent
            unsafe {
                InspectorHTTPServerAgent::notify_server_routes_updated(
                    agent.as_ptr(),
                    server.inspector_server_id(),
                    i32::try_from(bun_jsc::VirtualMachine::get().hot_reload_counter).unwrap(),
                    &mut routes,
                );
            }
        }
        Ok(())
    }

    // #endregion
}

// #region Types

#[repr(C)]
pub struct Route {
    pub route_id: RouteId,
    pub path: BunString,
    pub r#type: RouteType,
    pub script_line: i32,
    pub param_names: *mut BunString,
    pub param_names_len: usize,
    pub file_path: BunString,
    pub script_id: BunString,
    pub script_url: BunString,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum RouteType {
    Default = 1,
    Api = 2,
    Html = 3,
    Static = 4,
}

impl Default for Route {
    fn default() -> Self {
        Self {
            route_id: 0,
            path: BunString::empty(),
            r#type: RouteType::Default,
            script_line: -1,
            param_names: core::ptr::null_mut(),
            param_names_len: 0,
            file_path: BunString::empty(),
            script_id: BunString::empty(),
            script_url: BunString::empty(),
        }
    }
}

impl Route {
    pub fn params(&self) -> &[BunString] {
        if self.param_names.is_null() {
            return &[];
        }
        // SAFETY: param_names points to param_names_len contiguous BunString values
        unsafe { core::slice::from_raw_parts(self.param_names, self.param_names_len) }
    }
}

impl Drop for Route {
    fn drop(&mut self) {
        if !self.param_names.is_null() {
            // SAFETY: param_names was allocated via the global (mimalloc) allocator as a
            // contiguous [BunString; param_names_len]. Reconstructing the Box drops each
            // element (deref) and frees the backing storage.
            let slice = core::ptr::slice_from_raw_parts_mut(self.param_names, self.param_names_len);
            drop(unsafe { Box::from_raw(slice) });
            self.param_names = core::ptr::null_mut();
            self.param_names_len = 0;
        }
        // path, file_path, script_id, script_url are dropped (deref'd) automatically via
        // bun_str::String's Drop impl.
    }
}

// #endregion

// #region C++ agent reference type for Zig

/// Opaque handle to the C++ `InspectorHTTPServerAgent`.
#[repr(C)]
pub struct InspectorHTTPServerAgent {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn Bun__HTTPServerAgent__notifyRequestWillBeSent(
        agent: *mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        route_id: RouteId,
        url: *const BunString,
        full_url: *const BunString,
        method: HTTPMethod,
        headers_json: *const BunString,
        params_json: *const BunString,
        has_body: bool,
        timestamp: f64,
    );
    pub fn Bun__HTTPServerAgent__notifyResponseReceived(
        agent: *mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        status_code: i32,
        status_text: *const BunString,
        headers_json: *const BunString,
        has_body: bool,
        timestamp: f64,
    );
    pub fn Bun__HTTPServerAgent__notifyBodyChunkReceived(
        agent: *mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        flags: i32,
        chunk: *const BunString,
        timestamp: f64,
    );
    pub fn Bun__HTTPServerAgent__notifyRequestFinished(
        agent: *mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        timestamp: f64,
        duration: f64,
    );
    pub fn Bun__HTTPServerAgent__notifyRequestHandlerException(
        agent: *mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        message: *const BunString,
        url: *const BunString,
        line: i32,
        timestamp: f64,
    );

    // From bun.cpp namespace (generated C++ bindings)
    fn Bun__HTTPServerAgent__notifyServerStarted(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        address: *const BunString,
        start_time: f64,
        server_instance: *mut c_void,
    );
    fn Bun__HTTPServerAgent__notifyServerStopped(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        timestamp: f64,
    );
    fn Bun__HTTPServerAgent__notifyServerRoutesUpdated(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        routes_ptr: *mut Route,
        routes_len: usize,
    );
}

impl InspectorHTTPServerAgent {
    pub unsafe fn notify_server_started(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        address: &BunString,
        start_time: f64,
        server_instance: *mut c_void,
    ) {
        // SAFETY: caller guarantees `agent` is a valid C++ InspectorHTTPServerAgent
        unsafe {
            Bun__HTTPServerAgent__notifyServerStarted(
                agent,
                server_id,
                hot_reload_id,
                address,
                start_time,
                server_instance,
            );
        }
    }

    pub unsafe fn notify_server_stopped(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        timestamp: f64,
    ) {
        // SAFETY: caller guarantees `agent` is a valid C++ InspectorHTTPServerAgent
        unsafe {
            Bun__HTTPServerAgent__notifyServerStopped(agent, server_id, timestamp);
        }
    }

    pub unsafe fn notify_server_routes_updated(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        routes: &mut [Route],
    ) {
        // SAFETY: caller guarantees `agent` is a valid C++ InspectorHTTPServerAgent
        unsafe {
            Bun__HTTPServerAgent__notifyServerRoutesUpdated(
                agent,
                server_id,
                hot_reload_id,
                routes.as_mut_ptr(),
                routes.len(),
            );
        }
    }
}

// #endregion

// #region Zig -> C++

#[unsafe(no_mangle)]
pub extern "C" fn Bun__HTTPServerAgent__setEnabled(agent: *mut InspectorHTTPServerAgent) {
    if let Some(debugger) = &mut bun_jsc::VirtualMachine::get().debugger {
        debugger.http_server_agent.agent = NonNull::new(agent);
    }
}

// #endregion

// Typedefs from HTTPServer.json
pub type ServerId = bun_jsc::debugger::DebuggerId;
pub type RequestId = i32;
pub type RouteId = i32;
pub type HotReloadId = i32;
pub type HTTPMethod = bun_http::Method;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/HTTPServerAgent.zig (179 lines)
//   confidence: medium
//   todos:      5
//   notes:      `inline else` over server.userRoutes() variants flattened to single iter; AnyServer/ServerConfig paths guessed; std.time.milliTimestamp needs bun_core equiv
// ──────────────────────────────────────────────────────────────────────────
