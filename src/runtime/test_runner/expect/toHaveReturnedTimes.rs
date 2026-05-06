use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;

// Thin shim mirroring `pub const toHaveReturnedTimes = @import("./toHaveReturned.zig").toHaveReturnedTimes;`.
// In the Rust port the implementation lives as an inherent method on `Expect`, which cannot be
// `pub use`-re-exported, so this free function delegates to it to preserve the module-level symbol.
#[inline]
pub fn to_have_returned_times(
    this: &mut Expect,
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    Expect::to_have_returned_times(this, global, callframe)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveReturnedTimes.zig (1 lines)
//   confidence: high
//   todos:      0
//   notes:      thin delegating shim — Expect::to_have_returned_times is an inherent method in
//               toHaveReturned.rs, so it cannot be `pub use`d directly.
// ──────────────────────────────────────────────────────────────────────────
