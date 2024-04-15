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
    comptime fmt: string,
    args: anytype,
) !void {
    @setCold(true);
    const err = JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, fmt, args, globalThis);
    globalThis.vm().throwError(globalThis, err);
    return error.InvalidArgument;
}

pub fn throwErrInvalidArgTypeWithMessage(
    globalThis: *JSGlobalObject,
    comptime fmt: string,
    args: anytype,
) !void {
    @setCold(true);
    const err = JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE, fmt, args, globalThis);
    globalThis.vm().throwError(globalThis, err);
    return error.InvalidArgument;
}

pub fn throwErrInvalidArgType(
    globalThis: *JSGlobalObject,
    comptime name_fmt: string,
    name_args: anytype,
    comptime expected_type: []const u8,
    value: JSValue,
) !void {
    @setCold(true);
    const actual_type = getTypeName(globalThis, value);
    try throwErrInvalidArgTypeWithMessage(globalThis, "\"" ++ name_fmt ++ "\" property must be of type {s}, got {s}", name_args ++ .{ expected_type, actual_type });
}

pub fn throwRangeError(
    globalThis: *JSGlobalObject,
    comptime fmt: string,
    args: anytype,
) !void {
    @setCold(true);
    const err = globalThis.createRangeErrorInstanceWithCode(JSC.Node.ErrorCode.ERR_OUT_OF_RANGE, fmt, args);
    globalThis.vm().throwError(globalThis, err);
    return error.InvalidArgument;
}

/// -(2^53 - 1)
pub const NUMBER__MIN_SAFE_INTEGER: i64 = -9007199254740991;
/// (2^53 – 1)
pub const NUMBER__MAX_SAFE_INTEGER: i64 = 9007199254740991;

pub fn validateInteger(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, min_value: ?i64, max_value: ?i64) !i64 {
    const min = min_value orelse NUMBER__MIN_SAFE_INTEGER;
    const max = max_value orelse NUMBER__MAX_SAFE_INTEGER;

    if (!value.isNumber())
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);
    if (!value.isAnyInt()) {
        try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be an integer. Received {s}", name_args ++ .{value});
    }

    const num = value.asInt52();
    if (num < min or num > max) {
        try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {s}", name_args ++ .{ min, max, value });
    }
    return num;
}

pub fn validateInt32(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, min_value: ?i32, max_value: ?i32) !i32 {
    const min = min_value orelse std.math.minInt(i32);
    const max = max_value orelse std.math.maxInt(i32);
    // The defaults for min and max correspond to the limits of 32-bit integers.
    if (!value.isNumber()) {
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);
    }
    if (!value.isInt32()) {
        try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be an integer. Received {s}", name_args ++ .{value});
    }
    const num = value.asInt32();
    if (num < min or num > max) {
        try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {s}", name_args ++ .{ min, max, value });
    }
    return num;
}

pub fn validateUint32(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, greater_than_zero: bool) !u32 {
    if (!value.isNumber()) {
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);
    }
    if (!value.isAnyInt()) {
        try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be an integer. Received {s}", name_args ++ .{value});
    }
    const num: i64 = value.asInt52();
    const min: i64 = if (greater_than_zero) 1 else 0;
    const max: i64 = @intCast(std.math.maxInt(u32));
    if (num < min or num > max) {
        try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {s}", name_args ++ .{ min, max, value });
    }
    return @truncate(num);
}

pub fn validateString(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) !void {
    if (!value.isString())
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "string", value);
}

pub fn validateNumber(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, min: ?f64, max: ?f64) !f64 {
    if (!value.isNumber())
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "number", value);

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
            try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d} and <= {d}. Received {s}", name_args ++ .{ min, max, value });
        } else if (min != null) {
            try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must be >= {d}. Received {s}", name_args ++ .{ max, value });
        } else {
            try throwRangeError(globalThis, "The value of \"" ++ name_fmt ++ "\" is out of range. It must and <= {d}. Received {s}", name_args ++ .{ max, value });
        }
    }
    return num;
}

pub fn validateBoolean(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) !bool {
    if (!value.isBoolean())
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "boolean", value);
    return value.asBoolean();
}

pub const ValidateObjectOptions = packed struct {
    allow_nullable: bool = false,
    allow_array: bool = false,
    allow_function: bool = false,
};

pub fn validateObject(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, comptime options: ValidateObjectOptions) !void {
    if (comptime !options.allow_nullable and !options.allow_array and !options.allow_function) {
        if (value.isNull() or value.jsType().isArray()) {
            try throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }

        if (!value.isObject()) {
            try throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }
    } else {
        if (!options.allow_nullable and value.isNull()) {
            try throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }

        if (!options.allow_array and value.jsType().isArray()) {
            try throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }

        if (!value.isObject() and (!options.allow_function or !value.jsType().isFunction())) {
            try throwErrInvalidArgType(globalThis, name_fmt, name_args, "object", value);
        }
    }
}

pub fn validateArray(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype, comptime min_length: ?i32) !void {
    if (!value.jsType().isArray()) {
        const actual_type = getTypeName(globalThis, value);
        try throwErrInvalidArgTypeWithMessage(globalThis, "\"" ++ name_fmt ++ "\" property must be an instance of Array, got {s}", name_args ++ .{actual_type});
    }
    if (comptime min_length != null) {
        if (value.getLength(globalThis) < min_length) {
            try throwErrInvalidArgValue(globalThis, name_fmt ++ " must be longer than {d}", name_args ++ .{min_length});
        }
    }
}

pub fn validateStringArray(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) !usize {
    try validateArray(globalThis, value, name_fmt, name_args, null);
    var i: usize = 0;
    var iter = value.arrayIterator(globalThis);
    while (iter.next()) |item| {
        if (!item.isString()) {
            try throwErrInvalidArgType(globalThis, name_fmt ++ "[{d}]", name_args ++ .{i}, "string", value);
        }
        i += 1;
    }
    return i;
}

pub fn validateBooleanArray(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) !usize {
    try validateArray(globalThis, value, name_fmt, name_args, null);
    var i: usize = 0;
    var iter = value.arrayIterator(globalThis);
    while (iter.next()) |item| {
        if (!item.isBoolean()) {
            try throwErrInvalidArgType(globalThis, name_fmt ++ "[{d}]", name_args ++ .{i}, "boolean", value);
        }
        i += 1;
    }
    return i;
}

pub fn validateFunction(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) !void {
    if (!value.jsType().isFunction())
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "function", value);
}

pub fn validateUndefined(globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) !void {
    if (!value.isUndefined())
        try throwErrInvalidArgType(globalThis, name_fmt, name_args, "undefined", value);
}

pub fn validateStringEnum(comptime T: type, globalThis: *JSGlobalObject, value: JSValue, comptime name_fmt: string, name_args: anytype) !T {
    const str = value.toBunString(globalThis);
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
    try throwErrInvalidArgTypeWithMessage(globalThis, name_fmt ++ " must be one of: {s}", name_args ++ .{values_info});
    return error.InvalidArgument;
}
