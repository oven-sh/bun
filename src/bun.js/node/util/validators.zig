const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

pub fn getTypeName(globalObject: *JSGlobalObject, value: JSValue) ZigString {
    var js_type = value.jsType();
    if (js_type.isArray()) {
        return ZigString.static("array").*;
    }
    return value.jsTypeString(globalObject).getZigString(globalObject);
}

pub fn throwErrInvalidArgValue(
    globalThis: *JSGlobalObject,
    comptime fmt: [:0]const u8,
    args: anytype,
) bun.JSError {
    @setCold(true);
    return globalThis.ERR_INVALID_ARG_VALUE(fmt, args).throw();
}

pub fn throwErrInvalidArgTypeWithMessage(
    globalThis: *JSGlobalObject,
    comptime fmt: [:0]const u8,
    args: anytype,
) bun.JSError {
    @setCold(true);
    return globalThis.ERR_INVALID_ARG_TYPE(fmt, args).throw();
}

pub fn throwErrInvalidArgType(
    globalThis: *JSGlobalObject,
    comptime name_fmt: string,
    name_args: anytype,
    comptime expected_type: []const u8,
    value: JSValue,
) bun.JSError {
    @setCold(true);
    const actual_type = getTypeName(globalThis, value);
    return throwErrInvalidArgTypeWithMessage(globalThis, "The \"" ++ name_fmt ++ "\" property must be of type {s}, got {s}", name_args ++ .{ expected_type, actual_type });
}

pub fn throwRangeError(
    globalThis: *JSGlobalObject,
    comptime fmt: [:0]const u8,
    args: anytype,
) bun.JSError {
    @setCold(true);
    return globalThis.ERR_OUT_OF_RANGE(fmt, args).throw();
}

pub fn validateInteger(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, min_value: ?i64, max_value: ?i64) bun.JSError!i64 {
    const min = min_value orelse JSC.MIN_SAFE_INTEGER;
    const max = max_value orelse JSC.MAX_SAFE_INTEGER;

    if (!value.isNumber())
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);
    if (!value.isAnyInt()) {
        return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be an integer. Received {s}", name_args ++ .{value});
    }

    const num = value.asInt52();
    if (num < min or num > max) {
        return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {s}", name_args ++ .{ min, max, value });
    }
    return num;
}

pub fn validateInt32(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, min_value: ?i32, max_value: ?i32) bun.JSError!i32 {
    const min = min_value orelse std.math.minInt(i32);
    const max = max_value orelse std.math.maxInt(i32);
    // The defaults for min and max correspond to the limits of 32-bit integers.
    if (!value.isNumber()) {
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);
    }
    if (!value.isInt32()) {
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
        return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be an integer. Received {}", name_args ++ .{value.toFmt(&formatter)});
    }
    const num = value.asInt32();
    if (num < min or num > max) {
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
        return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {}", name_args ++ .{ min, max, value.toFmt(&formatter) });
    }
    return num;
}

pub fn validateUint32(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, greater_than_zero: bool) bun.JSError!u32 {
    if (!value.isNumber()) {
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);
    }
    if (!value.isAnyInt()) {
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
        return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be an integer. Received {}", name_args ++ .{value.toFmt(&formatter)});
    }
    const num: i64 = value.asInt52();
    const min: i64 = if (greater_than_zero) 1 else 0;
    const max: i64 = @intCast(std.math.maxInt(u32));
    if (num < min or num > max) {
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
        return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {}", name_args ++ .{ min, max, value.toFmt(&formatter) });
    }
    return @truncate(@as(u63, @intCast(num)));
}

pub fn validateString(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) bun.JSError!void {
    if (!value.isString())
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "string", value);
}

pub fn validateNumber(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, min: ?f64, max: ?f64) bun.JSError!f64 {
    if (!value.isNumber())
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);

    const num: f64 = value.asNumber();
    var valid = true;
    if (min) |min_val| {
        if (num < min_val) valid = false;
    }
    if (max) |max_val| {
        if (num > max_val) valid = false;
    }
    if ((min != null or max != null) and std.math.isNan(num)) {
        valid = false;
    }
    if (!valid) {
        if (min != null and max != null) {
            return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {s}", name_args ++ .{ min, max, value });
        } else if (min != null) {
            return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d}. Received {s}", name_args ++ .{ max, value });
        } else {
            return throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must and <= {d}. Received {s}", name_args ++ .{ max, value });
        }
    }
    return num;
}

pub fn validateBoolean(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) bun.JSError!bool {
    if (!value.isBoolean())
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "boolean", value);
    return value.asBoolean();
}

pub const ValidateObjectOptions = packed struct {
    allow_nullable: bool = false,
    allow_array: bool = false,
    allow_function: bool = false,
};

pub fn validateObject(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, comptime options: ValidateObjectOptions) bun.JSError!void {
    if (comptime !options.allow_nullable and !options.allow_array and !options.allow_function) {
        if (value.isNull() or value.jsType().isArray()) {
            return throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }

        if (!value.isObject()) {
            return throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }
    } else {
        if (!options.allow_nullable and value.isNull()) {
            return throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }

        if (!options.allow_array and value.jsType().isArray()) {
            return throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }

        if (!value.isObject() and (!options.allow_function or !value.jsType().isFunction())) {
            return throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }
    }
}

pub fn validateArray(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, comptime min_length: ?i32) bun.JSError!void {
    if (!value.jsType().isArray()) {
        const actual_type = getTypeName(globalThis, value);
        return throwErrInvalidArgTypeWithMessage(globalThis, "The \"" ++ name_fmt ++ "\" property must be an instance of Array, got {s}", name_args ++ .{actual_type});
    }
    if (comptime min_length != null) {
        if (value.getLength(globalThis) < min_length) {
            return throwErrInvalidArgValue(globalThis, name_fmt ++ " must be longer than {d}", name_args ++ .{min_length});
        }
    }
}

pub fn validateStringArray(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) bun.JSError!usize {
    try validateArray(globalThis, value, name_fmt, name_args, null);
    var i: usize = 0;
    var iter = value.arrayIterator(globalThis);
    while (iter.next()) |item| {
        if (!item.isString()) {
            return throwErrInvalidArgType(globalThis, name_fmt ++ "[{d}]", name_args ++ .{i}, "string", value);
        }
        i += 1;
    }
    return i;
}

pub fn validateBooleanArray(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) bun.JSError!usize {
    try validateArray(globalThis, value, name_fmt, name_args, null);
    var i: usize = 0;
    var iter = value.arrayIterator(globalThis);
    while (iter.next()) |item| {
        if (!item.isBoolean()) {
            return throwErrInvalidArgType(globalThis, name_fmt ++ "[{d}]", name_args ++ .{i}, "boolean", value);
        }
        i += 1;
    }
    return i;
}

pub fn validateFunction(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) bun.JSError!JSValue {
    if (!value.jsType().isFunction())
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "function", value);
    return value;
}

pub fn validateUndefined(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) bun.JSError!void {
    if (!value.isUndefined())
        return throwErrInvalidArgType(globalThis, name_fmt, name_args, "undefined", value);
}

pub fn validateStringEnum(comptime T: type, globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) bun.JSError!T {
    const str = try value.toBunString2(globalThis);
    defer str.deref();
    inline for (@typeInfo(T).Enum.fields) |enum_field| {
        if (str.eqlComptime(enum_field.name))
            return @field(T, enum_field.name);
    }

    const values_info = comptime blk: {
        var out: []const u8 = "";
        for (@typeInfo(T).Enum.fields, 0..) |enum_field, i| {
            out = out ++ (if (i > 0) "|" else "") ++ enum_field.name;
        }
        break :blk out;
    };
    return throwErrInvalidArgTypeWithMessage(globalThis, name_fmt ++ " must be one of: {s}", name_args ++ .{values_info});
}
