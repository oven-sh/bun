//! Rust side of the `BunFrontendDevServer` inspector domain
//! (`src/jsc/bindings/InspectorBunFrontendDevServerAgent.cpp`).
//!
//! The agent's per-VM state is stored in the `Debugger`'s type-erased
//! [`ErasedAgentSlot`] (`bun_jsc` cannot name dev-server types — forward
//! dep); this module owns the slot's interpretation: `slot.agent` is the C++
//! `Inspector::InspectorBunFrontendDevServerAgent*` pushed by
//! `Bun__InspectorBunFrontendDevServerAgent__setEnabled`, `slot.sequence` is
//! `next_inspector_connection_id`.

use bun_core::String as BunString;
use bun_jsc::debugger::{DebuggerId, ErasedAgentSlot};
use bun_jsc::virtual_machine::VirtualMachine;

bun_opaque::opaque_ffi! {
    /// Opaque C++ `InspectorBunFrontendDevServerAgent` handle.
    pub struct InspectorBunFrontendDevServerAgentHandle;
}

/// `BunFrontendDevServerAgent` — view over the `Debugger`'s erased agent
/// slot. The two high-tier types involved (`DevServer.RouteBundle.Index` in
/// `notifyClientNavigated`, `DevServer.ConsoleLogKind` in `notifyConsoleLog`)
/// reduce to `i32` / `u8` at the C++ FFI boundary, so callers resolve them
/// before calling.
///
/// Both slot fields are `Copy` `Cell`s, so every method takes `&self` —
/// callers reach this through a shared `&Debugger` borrow.
#[repr(transparent)]
pub struct BunFrontendDevServerAgent(ErasedAgentSlot);

impl BunFrontendDevServerAgent {
    /// Reinterpret the `Debugger`'s erased slot as this agent. Sound because
    /// `Self` is `#[repr(transparent)]` over [`ErasedAgentSlot`] and this
    /// module is the slot's sole owner.
    pub fn from_slot(slot: &ErasedAgentSlot) -> &Self {
        // SAFETY: `#[repr(transparent)]` guarantees identical layout.
        unsafe { &*core::ptr::from_ref(slot).cast::<Self>() }
    }

    /// `nextConnectionID` — wrapping post-increment.
    pub fn next_connection_id(&self) -> i32 {
        self.0.post_increment_sequence()
    }

    #[inline]
    pub fn is_enabled(&self) -> bool {
        !self.0.agent_ptr().is_null()
    }

    /// `&mut Handle` accessor for the FFI shims. The pointer is set by the
    /// C++ inspector backend (`frontend_dev_server_agent_set_enabled`) and
    /// stays live while the agent is enabled. Returns `None` when disabled.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn handle_mut(&self) -> Option<&mut InspectorBunFrontendDevServerAgentHandle> {
        let handle = self.0.agent_ptr();
        if handle.is_null() {
            return None;
        }
        // `opaque_mut` is the audited safe `*mut → &mut` for opaque ZST
        // handles (zero-byte deref; see `bun_opaque::opaque_deref_mut`).
        Some(InspectorBunFrontendDevServerAgentHandle::opaque_mut(
            handle.cast(),
        ))
    }

    pub fn notify_client_connected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyClientConnected(
                handle,
                dev_server_id.get(),
                connection_id,
            )
        }
    }

    pub fn notify_client_disconnected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
                handle,
                dev_server_id.get(),
                connection_id,
            )
        }
    }

    pub fn notify_bundle_start(&self, dev_server_id: DebuggerId, trigger_files: &mut [BunString]) {
        if let Some(handle) = self.handle_mut() {
            // SAFETY: `trigger_files` is a valid contiguous slice for the call;
            // `(ptr, len)` pair derived from it.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyBundleStart(
                    handle,
                    dev_server_id.get(),
                    trigger_files.as_mut_ptr(),
                    trigger_files.len(),
                )
            }
        }
    }

    pub fn notify_bundle_complete(&self, dev_server_id: DebuggerId, duration_ms: f64) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyBundleComplete(
                handle,
                dev_server_id.get(),
                duration_ms,
            )
        }
    }

    pub fn notify_bundle_failed(
        &self,
        dev_server_id: DebuggerId,
        build_errors_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyBundleFailed(
                handle,
                dev_server_id.get(),
                build_errors_payload_base64,
            )
        }
    }

    /// `notifyClientNavigated`. `route_bundle_id` is the pre-resolved
    /// `DevServer.RouteBundle.Index` (`-1` for `None`) — caller does
    /// `rbi.map(|i| i.get() as i32).unwrap_or(-1)`.
    pub fn notify_client_navigated(
        &self,
        dev_server_id: DebuggerId,
        connection_id: i32,
        url: &mut BunString,
        route_bundle_id: i32,
    ) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyClientNavigated(
                handle,
                dev_server_id.get(),
                connection_id,
                url,
                route_bundle_id,
            )
        }
    }

    /// `notifyConsoleLog`. `kind` is `DevServer.ConsoleLogKind as u8` (`b'l'`
    /// / `b'e'`) — caller does `kind as u8`.
    pub fn notify_console_log(&self, dev_server_id: DebuggerId, kind: u8, data: &mut BunString) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyConsoleLog(
                handle,
                dev_server_id.get(),
                kind,
                data,
            )
        }
    }
}

// HOST_EXPORT(Bun__InspectorBunFrontendDevServerAgent__setEnabled, c)
pub fn frontend_dev_server_agent_set_enabled(agent: *mut InspectorBunFrontendDevServerAgentHandle) {
    // `VirtualMachine::get()` is valid here: the C++ inspector agent invokes
    // this on the JS thread, after the VM is initialized.
    if let Some(dbg) = VirtualMachine::get().debugger.as_deref() {
        dbg.extension_agent.set_agent_ptr(agent.cast());
    }
}

mod ffi {
    use super::{BunString, InspectorBunFrontendDevServerAgentHandle};
    // SAFETY (safe fn): `InspectorBunFrontendDevServerAgentHandle` is an
    // `opaque_ffi!` ZST handle (`!Freeze` via `UnsafeCell`); `BunString` is a
    // `#[repr(C)]` in-param the C++ side reads/consumes in-place. `&mut T` is
    // ABI-identical to a non-null `*mut T`. `notifyBundleStart` keeps a raw
    // `(ptr, len)` pair (slice not FFI-safe) and stays `unsafe`.
    unsafe extern "C" {
        pub(super) safe fn InspectorBunFrontendDevServerAgent__notifyClientConnected(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub(super) safe fn InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub(super) fn InspectorBunFrontendDevServerAgent__notifyBundleStart(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            trigger_files: *mut BunString,
            trigger_files_len: usize,
        );
        pub(super) safe fn InspectorBunFrontendDevServerAgent__notifyBundleComplete(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            duration_ms: f64,
        );
        pub(super) safe fn InspectorBunFrontendDevServerAgent__notifyBundleFailed(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            build_errors_payload_base64: &mut BunString,
        );
        pub(super) safe fn InspectorBunFrontendDevServerAgent__notifyClientNavigated(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
            url: &mut BunString,
            route_bundle_id: i32,
        );
        pub(super) safe fn InspectorBunFrontendDevServerAgent__notifyConsoleLog(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            kind: u8,
            data: &mut BunString,
        );
    }
}
