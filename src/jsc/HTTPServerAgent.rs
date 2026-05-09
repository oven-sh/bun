use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_string::String as BunString;
use crate::VirtualMachineRef as VirtualMachine;

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
    //
    // PORT NOTE (phase-d): `notify_server_started` / `notify_server_stopped` /
    // `notify_server_routes_updated` reach into `bun_jsc::api::AnyServer` and
    // `ServerConfig::RouteDeclaration`, which live in `bun_runtime` (forward
    // dep). The C++ side only needs `Bun__HTTPServerAgent__setEnabled` for
    // linkage; the per-event notifiers are called from Rust → C++ (FFI decls
    // below) and are wired from `bun_runtime` once that tier un-gates. The
    // event-body Zig ports are preserved in HTTPServerAgent.zig and will land
    // when `AnyServer` is reachable.

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
            path: BunString::EMPTY,
            r#type: RouteType::Default,
            script_line: -1,
            param_names: core::ptr::null_mut(),
            param_names_len: 0,
            file_path: BunString::EMPTY,
            script_id: BunString::EMPTY,
            script_url: BunString::EMPTY,
        }
    }
}

impl Route {
    pub fn params(&self) -> &[BunString] {
        // SAFETY: param_names points to param_names_len contiguous BunString
        // values (or is `(null, 0)`, which `ffi::slice` tolerates).
        unsafe { bun_core::ffi::slice(self.param_names, self.param_names_len) }
    }
}

impl Drop for Route {
    fn drop(&mut self) {
        if !self.param_names.is_null() {
            // SAFETY: param_names was allocated via the global (mimalloc) allocator as a
            // contiguous [BunString; param_names_len]. Reconstructing the Box drops each
            // element (deref) and frees the backing storage.
            let slice = core::ptr::slice_from_raw_parts_mut(self.param_names, self.param_names_len);
            drop(unsafe { bun_core::heap::take(slice) });
            self.param_names = core::ptr::null_mut();
            self.param_names_len = 0;
        }
        // path, file_path, script_id, script_url are dropped (deref'd) automatically via
        // bun_string::String's Drop impl.
    }
}

// #endregion

// #region C++ agent reference type for Zig

/// Opaque handle to the C++ `InspectorHTTPServerAgent`.
#[repr(C)]
pub struct InspectorHTTPServerAgent {
    _p: core::cell::UnsafeCell<[u8; 0]>,
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

    // `Bun__HTTPServerAgent__notifyServer{Started,Stopped,RoutesUpdated}` are
    // `[[ZIG_EXPORT(nothrow)]]` — declared once in `crate::cpp::raw` (cppbind),
    // called below with explicit casts to the codegen's opaque param types.
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
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerStarted(
                agent.cast(),
                server_id.0 as _,
                hot_reload_id as _,
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
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerStopped(
                agent.cast(),
                server_id.0 as _,
                timestamp,
            );
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
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerRoutesUpdated(
                agent.cast(),
                server_id.0 as _,
                hot_reload_id as _,
                routes.as_mut_ptr().cast(),
                routes.len(),
            );
        }
    }
}

// #endregion

// #region Zig -> C++

#[unsafe(no_mangle)]
pub extern "C" fn Bun__HTTPServerAgent__setEnabled(agent: *mut InspectorHTTPServerAgent) {
    // SAFETY: VM singleton is process-lifetime.
    let vm = VirtualMachine::get().as_mut();
    if let Some(debugger) = &mut vm.debugger {
        debugger.http_server_agent.agent = NonNull::new(agent);
    }
}

// #endregion

// Typedefs from HTTPServer.json
pub type ServerId = crate::debugger::DebuggerId;
pub type RequestId = i32;
pub type RouteId = i32;
pub type HotReloadId = i32;
pub type HTTPMethod = bun_http::Method;

// ported from: src/jsc/HTTPServerAgent.zig
