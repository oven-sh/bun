pub const to = 17;
pub const from = [_]short{17};

pub fn toJS(
    globalObject: *jsc.JSGlobalObject,
    value: *Data,
) AnyPostgresError!JSValue {
    defer value.deinit();

    // var slice = value.slice()[@min(1, value.len)..];
    // _ = slice;
    return JSValue.createBuffer(globalObject, value.slice(), null);
}

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../../shared/Data.zig").Data;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
