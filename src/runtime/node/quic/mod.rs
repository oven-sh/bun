//! Native implementation of `node:quic` (reference: node/src/quic/*, v26.3.0).

pub mod endpoint;
pub(crate) mod ffi;
pub mod session;
pub mod stream;
pub mod tls;

pub use endpoint::QuicEndpoint;
pub use session::QuicSession;
pub use stream::QuicStream;

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

    pub(crate) fn get(global: &JSGlobalObject, name: &str) -> Option<JSValue> {
        let holder = global
            .bun_vm()
            .as_mut()
            .rare_data()
            .node_quic_callbacks
            .get()?;
        match holder.get(global, name) {
            Ok(Some(value)) if value.is_callable() => Some(value),
            _ => None,
        }
    }
}
