use core::cell::Cell;

use crate::VirtualMachineRef as VirtualMachine;
use crate::debugger::{AgentSlot, EnabledAgent};
use bun_core::ffi::FfiSlice;
use bun_core::{String as BunString, StringView};

pub struct HTTPServerAgent {
    pub agent: AgentSlot<InspectorHTTPServerAgent>,

    /// This becomes the "server ID" field.
    pub next_server_id: Cell<ServerId>,
}

impl Default for HTTPServerAgent {
    fn default() -> Self {
        Self {
            agent: AgentSlot::default(),
            next_server_id: Cell::new(ServerId::init(0)),
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
pub struct Route<'a> {
    pub route_id: RouteId,
    pub path: StringView<'a>,
    pub r#type: RouteType,
    pub script_line: i32,
    /// Unused; always empty (kept for the C++ layout).
    pub param_names: FfiSlice<'a, BunString>,
    pub file_path: StringView<'a>,
    pub script_id: StringView<'a>,
    pub script_url: StringView<'a>,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum RouteType {
    Default = 1,
    Api = 2,
    Html = 3,
    Static = 4,
}

impl Default for Route<'_> {
    fn default() -> Self {
        Self {
            route_id: 0,
            path: StringView::EMPTY,
            r#type: RouteType::Default,
            script_line: -1,
            param_names: FfiSlice::new(&[]),
            file_path: StringView::EMPTY,
            script_id: StringView::EMPTY,
            script_url: StringView::EMPTY,
        }
    }
}

// #endregion

// #region C++ agent reference type

bun_opaque::sealed_handle! {
    /// Opaque handle to the C++ `InspectorHTTPServerAgent`.
    pub struct InspectorHTTPServerAgent;
}

// `Bun__HTTPServerAgent__notifyServer{Started,Stopped,RoutesUpdated}` are
// `[[ZIG_EXPORT(nothrow)]]` — declared once in `crate::cpp::raw` (cppbind),
// called below with explicit casts to the codegen's opaque param types.
impl InspectorHTTPServerAgent {
    pub fn notify_server_started(
        &self,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        address: &BunString,
        start_time: f64,
        server_instance: usize,
    ) {
        // SAFETY: C++ never reads through the last argument.
        unsafe {
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerStarted(
                self.as_mut_ptr().cast(),
                server_id.get() as _,
                hot_reload_id as _,
                address,
                start_time,
                core::ptr::without_provenance_mut(server_instance),
            );
        }
    }

    pub fn notify_server_stopped(&self, server_id: ServerId, timestamp: f64) {
        // SAFETY: `self` is the live agent; remaining args are by-value scalars.
        unsafe {
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerStopped(
                self.as_mut_ptr().cast(),
                server_id.get() as _,
                timestamp,
            );
        }
    }

    pub fn notify_server_routes_updated(
        &self,
        server_id: ServerId,
        hot_reload_id: HotReloadId,
        routes: &[Route<'_>],
    ) {
        // SAFETY: C++ only reads `routes`, during the call.
        unsafe {
            crate::cpp::raw::Bun__HTTPServerAgent__notifyServerRoutesUpdated(
                self.as_mut_ptr().cast(),
                server_id.get() as _,
                hot_reload_id as _,
                routes.as_ptr().cast_mut().cast(),
                routes.len(),
            );
        }
    }
}

// #endregion

// #region C++ entry points

#[unsafe(no_mangle)]
extern "C" fn Bun__HTTPServerAgent__setEnabled(
    agent: Option<EnabledAgent<InspectorHTTPServerAgent>>,
) {
    if let Some(debugger) = VirtualMachine::get().debugger.get() {
        debugger.http_server_agent.agent.set(agent);
    }
}

// #endregion

// Typedefs from HTTPServer.json
pub type ServerId = crate::debugger::DebuggerId;
pub type RouteId = i32;
pub type HotReloadId = i32;
