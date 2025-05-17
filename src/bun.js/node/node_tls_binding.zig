const std = @import("std");

const bun = @import("bun");
const JSC = bun.JSC;

pub fn getDefaultMinTLSVersionFromCLIFlag(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (bun.tls.min_tls_version_from_cli_flag) |version| {
        return JSC.JSValue.jsNumber(version);
    }

    return JSC.JSValue.jsNull();
}

pub fn getDefaultMaxTLSVersionFromCLIFlag(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (bun.tls.max_tls_version_from_cli_flag) |version| {
        return JSC.JSValue.jsNumber(version);
    }

    return JSC.JSValue.jsNull();
}
