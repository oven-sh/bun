pub const to = 17;
pub const from = [_]short{17};

pub fn toJS(
    globalObject: *JSC.JSGlobalObject,
    value: *Data,
) AnyPostgresError!JSValue {
    defer value.deinit();

    // var slice = value.slice()[@min(1, value.len)..];
    // _ = slice;
    return JSValue.createBuffer(globalObject, value.slice(), null);
}

// @sortImports

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../Data.zig").Data;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
