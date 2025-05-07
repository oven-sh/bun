const std = @import("std");

const bun = @import("bun");
const JSC = bun.JSC;

pub fn getMinTLSVersion(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = callframe; // autofix
    return JSC.JSValue.toString(globalThis, bun.tls.min_tls_version);
}

pub fn getMaxTLSVersion(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = callframe; // autofix
    return JSC.JSValue.toString(globalThis, bun.tls.max_tls_version);
}
