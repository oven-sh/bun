pub const to = 16;
pub const from = [_]short{16};

pub fn toJS(
    _: *jsc.JSGlobalObject,
    value: bool,
) AnyPostgresError!JSValue {
    return JSValue.jsBoolean(value);
}

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
