//! Native implementation of `node:quic` (reference: node/src/quic/*, v26.3.0).

pub(crate) mod endpoint;
pub(crate) mod ffi;
pub(crate) mod session;
pub(crate) mod stream;
pub(crate) mod tls;

pub(crate) use endpoint::QuicEndpoint;
pub(crate) use session::QuicSession;
pub(crate) use stream::QuicStream;

/// Monotonic nanoseconds, mirroring Node's use of `uv_hrtime()` for the
/// `*_AT` stats slots.
pub(crate) fn now_ns() -> u64 {
    bun_core::util::Timespec::now_allow_mocked_time().ns()
}

pub(crate) mod callbacks {
    use bun_jsc::{JSGlobalObject, JSValue};

    /// Node keeps these on the realm's `BindingData`; per-VM storage is Bun's analog.
    pub(crate) fn set(global: &JSGlobalObject, holder: JSValue) {
        global
            .bun_vm()
            .as_mut()
            .rare_data()
            .node_quic_callbacks
            .set(global, holder);
    }

    /// Calls the callback that `setCallbacks()` got under `name`, and reports what it throws as uncaught.
    pub(crate) fn call(global: &JSGlobalObject, name: &str, this: JSValue, args: &[JSValue]) {
        let vm = global.bun_vm().as_mut();
        let Some(holder) = vm.rare_data().node_quic_callbacks.get() else {
            return;
        };
        if let Ok(Some(callback)) = holder.get(global, name) {
            vm.event_loop_ref().run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global,
                this,
                args,
            );
        }
    }
}
