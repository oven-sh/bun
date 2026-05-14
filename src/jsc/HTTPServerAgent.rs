use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use crate::VirtualMachineRef as VirtualMachine;
use bun_core::String as BunString;

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
            next_server_id: ServerId::init(0),
        }
    }
}

impl HTTPServerAgent {
    pub fn is_enabled(&self) -> bool {
        self.agent.is_some()
    }

    /// Safe accessor for the set-once C++ agent handle. `agent` is populated
    /// exactly once via [`Bun__HTTPServerAgent__setEnabled`] and lives for the
    /// debugger's lifetime; `InspectorHTTPServerAgent` is an `opaque_ffi!` ZST
    /// so the `&mut` covers zero bytes (see [`bun_opaque::opaque_deref_mut`]).
    /// Consolidates the per-call-site raw deref into the single audited
    /// `opaque_mut` proof so callers stay safe.
    #[inline]
    pub fn agent_mut(&mut self) -> Option<&mut InspectorHTTPServerAgent> {
        self.agent
            .map(|p| InspectorHTTPServerAgent::opaque_mut(p.as_ptr()))
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
        // bun_core::String's Drop impl.
    }
}

// #endregion

// #region C++ agent reference type for Zig

bun_opaque::opaque_ffi! {
    /// Opaque handle to the C++ `InspectorHTTPServerAgent`.
    pub struct InspectorHTTPServerAgent;
}

// TODO(port): move to jsc_sys
//
// `safe fn`: `InspectorHTTPServerAgent` is an `opaque_ffi!` ZST handle
// (`!Freeze` via `UnsafeCell`); `BunString` is `#[repr(C)]` and read-only
// across the call. `&mut`/`&` are ABI-identical to non-null `*mut`/`*const`.
// Remaining args are by-value scalars / `#[repr(u8)]` enums.
unsafe extern "C" {
    pub safe fn Bun__HTTPServerAgent__notifyRequestWillBeSent(
        agent: &mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        route_id: RouteId,
        url: &BunString,
        full_url: &BunString,
        method: HTTPMethod,
        headers_json: &BunString,
        params_json: &BunString,
        has_body: bool,
        timestamp: f64,
    );
    pub safe fn Bun__HTTPServerAgent__notifyResponseReceived(
        agent: &mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        status_code: i32,
        status_text: &BunString,
        headers_json: &BunString,
        has_body: bool,
        timestamp: f64,
    );
    pub safe fn Bun__HTTPServerAgent__notifyBodyChunkReceived(
        agent: &mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        flags: i32,
        chunk: &BunString,
        timestamp: f64,
    );
    pub safe fn Bun__HTTPServerAgent__notifyRequestFinished(
        agent: &mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        timestamp: f64,
        duration: f64,
    );
    pub safe fn Bun__HTTPServerAgent__notifyRequestHandlerException(
        agent: &mut InspectorHTTPServerAgent,
        request_id: RequestId,
        server_id: ServerId,
        message: &BunString,
        url: &BunString,
        line: i32,
        timestamp: f64,
    );

    // `Bun__HTTPServerAgent__notifyServer{Started,Stopped,RoutesUpdated}` are
    // `[[ZIG_EXPORT(nothrow)]]` — declared once in `crate::cpp::raw` (cppbind),
    // called below with explicit casts to the codegen's opaque param types.
}

impl InspectorHTTPServerAgent {
    pub fn notify_server_started(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        address: &BunString,
        start_time: f64,
        server_instance: *mut c_void,
    ) {
        // `opaque_mut` is the centralised ZST-handle deref proof (panics on
        // null). The C++ side never reads `server_instance` as anything but an
        // opaque token, so passing the raw pointer through is sound.
        let agent = Self::opaque_mut(agent);
        // SAFETY: `[[ZIG_EXPORT(nothrow)]]` C++ shim; `agent` proven non-null
        // above; remaining args are by-value scalars / `&BunString`.
        unsafe {
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerStarted(
                core::ptr::from_mut(agent).cast(),
                server_id.get() as _,
                hot_reload_id as _,
                address,
                start_time,
                server_instance,
            );
        }
    }

    pub fn notify_server_stopped(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        timestamp: f64,
    ) {
        let agent = Self::opaque_mut(agent);
        // SAFETY: `[[ZIG_EXPORT(nothrow)]]` C++ shim; `agent` proven non-null
        // via `opaque_mut`; remaining args are by-value scalars.
        unsafe {
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerStopped(
                core::ptr::from_mut(agent).cast(),
                server_id.get() as _,
                timestamp,
            );
        }
    }

    pub fn notify_server_routes_updated(
        agent: *mut InspectorHTTPServerAgent,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        routes: &mut [Route],
    ) {
        let agent = Self::opaque_mut(agent);
        // SAFETY: `[[ZIG_EXPORT(nothrow)]]` C++ shim; `agent` proven non-null
        // via `opaque_mut`; `routes` is a valid `&mut [Route]` slice.
        unsafe {
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerRoutesUpdated(
                core::ptr::from_mut(agent).cast(),
                server_id.get() as _,
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
