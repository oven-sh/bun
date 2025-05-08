const std = @import("std");

const bun = @import("bun");
const JSC = bun.JSC;

pub fn getDefaultMinTLSVersion(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (bun.tls.min_tls_version) |version| {
        return JSC.JSValue.jsNumber(version);
    }

    return JSC.JSValue.jsNull();
}

pub fn getDefaultMaxTLSVersion(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (bun.tls.max_tls_version) |version| {
        return JSC.JSValue.jsNumber(version);
    }

    return JSC.JSValue.jsNull();
}
