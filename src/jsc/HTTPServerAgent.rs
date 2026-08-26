use core::ffi::c_void;
use core::ptr::NonNull;

use crate::VirtualMachineRef as VirtualMachine;
use bun_core::String as BunString;

pub struct HTTPServerAgent {
    /// Underlying C++ agent. Set to null when not enabled.
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
    // #region Events
    //
    // `notify_server_started` / `notify_server_stopped` /
    // `notify_server_routes_updated` reach into `AnyServer` and
    // `ServerConfig::RouteDeclaration`, which live in `bun_runtime` (forward
    // dep), so they are defined there (`runtime/server/mod.rs`).

    // #endregion
}

// #region Types

#[repr(C)]
pub struct Route {
    pub route_id: RouteId,
    pub path: BunString,
    pub r#type: RouteType,
    pub script_line: i32,
    /// Unused; always null/0 (kept for the C++ layout).
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

// #endregion

// #region C++ agent reference type

bun_opaque::opaque_ffi! {
    /// Opaque handle to the C++ `InspectorHTTPServerAgent`.
    pub struct InspectorHTTPServerAgent;
}

// `Bun__HTTPServerAgent__notifyServer{Started,Stopped,RoutesUpdated}` are
// `[[ZIG_EXPORT(nothrow)]]` — declared once in `crate::cpp::raw` (cppbind),
// called below with explicit casts to the codegen's opaque param types.
impl InspectorHTTPServerAgent {
    /// # Safety
    /// `server_instance` is forwarded to C++ as an opaque token; caller must
    /// ensure it remains valid for the duration of the FFI call.
    pub unsafe fn notify_server_started(
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

// #region C++ entry points

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__HTTPServerAgent__setEnabled(agent: *mut InspectorHTTPServerAgent) {
    // SAFETY: VM singleton is process-lifetime.
    let vm = VirtualMachine::get().as_mut();
    if let Some(debugger) = &mut vm.debugger {
        debugger.http_server_agent.agent = NonNull::new(agent);
    }
}

// #endregion

// Typedefs from HTTPServer.json
pub type ServerId = crate::debugger::DebuggerId;
pub type RouteId = i32;
pub type HotReloadId = i32;
