use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;

// Thin shim mirroring `pub const toHaveReturnedTimes = @import("./toHaveReturned.zig").toHaveReturnedTimes;`.
// In the Rust port the implementation lives as an inherent method on `Expect`, which cannot be
// `pub use`-re-exported, so this free function delegates to it to preserve the module-level symbol.
#[inline]
pub fn to_have_returned_times(
    this: &Expect,
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    Expect::to_have_returned_times(this, global, callframe)
}

// ported from: src/test_runner/expect/toHaveReturnedTimes.zig
