pub const to = 0;
pub const from = [_]short{ 21, 23, 26, 700, 701 };

pub fn toJS(
    _: *JSC.JSGlobalObject,
    value: anytype,
) AnyPostgresError!JSValue {
    return JSValue.jsNumber(value);
}

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
