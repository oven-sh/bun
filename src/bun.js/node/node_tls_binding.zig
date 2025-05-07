const std = @import("std");

const bun = @import("bun");
const JSC = bun.JSC;

pub fn getDefaultMinTLSVersion(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = globalThis; // autofix
    _ = callframe; // autofix

    if (bun.tls.min_tls_version) |version| {
        return JSC.JSValue.jsNumberFromDouble(version);
    }

    return JSC.JSValue.jsNull();
}

pub fn getDefaultMaxTLSVersion(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = globalThis; // autofix
    _ = callframe; // autofix

    if (bun.tls.max_tls_version) |version| {
        return JSC.JSValue.jsNumberFromDouble(version);
    }

    return JSC.JSValue.jsNull();
}
