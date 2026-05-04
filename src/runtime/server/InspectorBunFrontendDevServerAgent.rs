use core::marker::{PhantomData, PhantomPinned};

use bun_str::String as BunString;
use bun_jsc::{self as jsc, debugger::DebuggerId};
use bun_bake::dev_server;

/// Opaque C++ handle for the inspector frontend dev-server agent.
#[repr(C)]
pub struct InspectorBunFrontendDevServerAgentHandle {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to <runtime>_sys
mod c {
    use super::{BunString, InspectorBunFrontendDevServerAgentHandle};

    unsafe extern "C" {
        pub fn InspectorBunFrontendDevServerAgent__notifyClientConnected(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleStart(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            trigger_files: *mut BunString,
            trigger_files_len: usize,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleComplete(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            duration_ms: f64,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleFailed(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            build_errors_payload_base64: *mut BunString,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyClientNavigated(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
            url: *mut BunString,
            route_bundle_id: i32,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyClientErrorReported(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            client_error_payload_base64: *mut BunString,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyGraphUpdate(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            visualizer_payload_base64: *mut BunString,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyConsoleLog(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            kind: u8,
            data: *mut BunString,
        );
    }
}

pub struct BunFrontendDevServerAgent {
    pub next_inspector_connection_id: i32,
    pub handle: Option<*mut InspectorBunFrontendDevServerAgentHandle>,
}

impl Default for BunFrontendDevServerAgent {
    fn default() -> Self {
        Self {
            next_inspector_connection_id: 0,
            handle: None,
        }
    }
}

impl BunFrontendDevServerAgent {
    pub fn next_connection_id(&mut self) -> i32 {
        let id = self.next_inspector_connection_id;
        self.next_inspector_connection_id = self.next_inspector_connection_id.wrapping_add(1);
        id
    }

    pub fn is_enabled(&self) -> bool {
        self.handle.is_some()
    }

    pub fn notify_client_connected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer set by Bun__InspectorBunFrontendDevServerAgent__setEnabled.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyClientConnected(
                    handle,
                    dev_server_id.get(),
                    connection_id,
                );
            }
        }
    }

    pub fn notify_client_disconnected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; see notify_client_connected.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
                    handle,
                    dev_server_id.get(),
                    connection_id,
                );
            }
        }
    }

    pub fn notify_bundle_start(&self, dev_server_id: DebuggerId, trigger_files: &mut [BunString]) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; trigger_files outlives the call.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyBundleStart(
                    handle,
                    dev_server_id.get(),
                    trigger_files.as_mut_ptr(),
                    trigger_files.len(),
                );
            }
        }
    }

    pub fn notify_bundle_complete(&self, dev_server_id: DebuggerId, duration_ms: f64) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; see notify_client_connected.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyBundleComplete(
                    handle,
                    dev_server_id.get(),
                    duration_ms,
                );
            }
        }
    }

    pub fn notify_bundle_failed(
        &self,
        dev_server_id: DebuggerId,
        build_errors_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; payload outlives the call.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyBundleFailed(
                    handle,
                    dev_server_id.get(),
                    build_errors_payload_base64,
                );
            }
        }
    }

    pub fn notify_client_navigated(
        &self,
        dev_server_id: DebuggerId,
        connection_id: i32,
        url: &mut BunString,
        // TODO(port): exact path for DevServer.RouteBundle.Index in bun_bake
        route_bundle_id: Option<dev_server::route_bundle::Index>,
    ) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; url outlives the call.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyClientNavigated(
                    handle,
                    dev_server_id.get(),
                    connection_id,
                    url,
                    match route_bundle_id {
                        Some(id) => id.get(),
                        None => -1,
                    },
                );
            }
        }
    }

    pub fn notify_client_error_reported(
        &self,
        dev_server_id: DebuggerId,
        client_error_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; payload outlives the call.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyClientErrorReported(
                    handle,
                    dev_server_id.get(),
                    client_error_payload_base64,
                );
            }
        }
    }

    pub fn notify_graph_update(
        &self,
        dev_server_id: DebuggerId,
        visualizer_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; payload outlives the call.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyGraphUpdate(
                    handle,
                    dev_server_id.get(),
                    visualizer_payload_base64,
                );
            }
        }
    }

    pub fn notify_console_log(
        &self,
        dev_server_id: DebuggerId,
        kind: dev_server::ConsoleLogKind,
        data: &mut BunString,
    ) {
        if let Some(handle) = self.handle {
            // SAFETY: handle is a live C++ agent pointer; data outlives the call.
            unsafe {
                c::InspectorBunFrontendDevServerAgent__notifyConsoleLog(
                    handle,
                    dev_server_id.get(),
                    kind as u8,
                    data,
                );
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__InspectorBunFrontendDevServerAgent__setEnabled(
    agent: *mut InspectorBunFrontendDevServerAgentHandle,
) {
    // TODO(port): VirtualMachine::get() / debugger field shape — verify in Phase B.
    if let Some(debugger) = jsc::VirtualMachine::get().debugger.as_mut() {
        debugger.frontend_dev_server_agent.handle = if agent.is_null() { None } else { Some(agent) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/InspectorBunFrontendDevServerAgent.zig (117 lines)
//   confidence: medium
//   todos:      2
//   notes:      cross-crate paths (bun_bake::dev_server::route_bundle::Index, ConsoleLogKind, jsc::VirtualMachine/debugger) need Phase-B verification; extern fns kept in local `c` mod pending *_sys crate.
// ──────────────────────────────────────────────────────────────────────────
