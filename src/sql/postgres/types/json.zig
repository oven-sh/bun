pub const to = 114;
pub const from = [_]short{ 114, 3802 };

pub fn toJS(
    globalObject: *jsc.JSGlobalObject,
    value: *Data,
) AnyPostgresError!JSValue {
    defer value.deinit();
    var str = bun.String.borrowUTF8(value.slice());
    defer str.deref();
    const parse_result = JSValue.parse(str.toJS(globalObject), globalObject);
    if (parse_result.AnyPostgresError()) {
        return globalObject.throwValue(parse_result);
    }

    return parse_result;
}

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../../shared/Data.zig").Data;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
