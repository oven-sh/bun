//! IPC wire mode — stays at this tier so `VirtualMachine::pending_ipc` is
//! typed; the IPC machinery lives in `bun_runtime::ipc`.

use crate::{JSGlobalObject, JSValue, JsResult};

/// Mode of Inter-Process Communication.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Mode {
    /// Uses SerializedScriptValue to send data. Only valid for bun <--> bun communication.
    /// The first packet sent here is a version packet so that the version of the other end is known.
    Advanced,
    /// Uses JSON messages, one message per line.
    /// This must match the behavior of node.js, and supports bun <--> node.js/etc communication.
    Json,
}

bun_core::comptime_string_map! {
    static MODE_MAP: Mode = {
        b"advanced" => Mode::Advanced,
        b"json" => Mode::Json,
    };
}

impl Mode {
    pub fn from_string(s: &[u8]) -> Option<Mode> {
        MODE_MAP.get(s).copied()
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Mode>> {
        use crate::ComptimeStringMapExt as _;
        if !value.is_string() {
            return Ok(None);
        }
        MODE_MAP.from_js(global, value)
    }
}
