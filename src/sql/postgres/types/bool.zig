pub const to = 16;
pub const from = [_]short{16};

pub fn toJS(
    _: *JSC.JSGlobalObject,
    value: bool,
) AnyPostgresError!JSValue {
    return JSValue.jsBoolean(value);
}

// @sortImports

const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const int_types = @import("./int_types.zig");
const short = int_types.short;
