//! JSC bridges for `sql/postgres/types/Tag.zig`. The `Tag` OID enum and its
//! pure helpers stay in `sql/`; only the `JSValue`/`JSGlobalObject`-touching
//! conversion paths live here.

pub fn toJSTypedArrayType(comptime T: Tag) !JSValue.JSType {
    return comptime switch (T) {
        .int4_array => .Int32Array,
        // .int2_array => .Uint2Array,
        .float4_array => .Float32Array,
        // .float8_array => .Float64Array,
        else => error.UnsupportedArrayType,
    };
}

fn toJSWithType(
    tag: Tag,
    globalObject: *jsc.JSGlobalObject,
    comptime Type: type,
    value: Type,
) AnyPostgresError!JSValue {
    switch (tag) {
        .numeric => {
            return JSValue.jsNumber(value);
        },

        .float4, .float8 => {
            return JSValue.jsNumber(value);
        },

        .json, .jsonb => {
            return json.toJS(globalObject, value);
        },

        .bool => {
            return @"bool".toJS(globalObject, value);
        },

        .timestamp, .timestamptz => {
            return date.toJS(globalObject, value);
        },

        .bytea => {
            return bytea.toJS(globalObject, value);
        },

        .int8 => {
            return JSValue.fromInt64NoTruncate(globalObject, value);
        },

        .int4 => {
            return JSValue.jsNumber(value);
        },

        else => {
            return string.toJS(globalObject, value);
        },
    }
}

pub fn toJS(
    tag: Tag,
    globalObject: *jsc.JSGlobalObject,
    value: anytype,
) AnyPostgresError!JSValue {
    return toJSWithType(tag, globalObject, @TypeOf(value), value);
}

pub fn fromJS(globalObject: *jsc.JSGlobalObject, value: JSValue) bun.JSError!Tag {
    if (value.isEmptyOrUndefinedOrNull()) {
        return Tag.numeric;
    }

    if (value.isCell()) {
        const tag = value.jsType();
        if (tag.isStringLike()) {
            return .text;
        }

        if (tag == .JSDate) {
            return .timestamptz;
        }

        if (tag.isTypedArrayOrArrayBuffer()) {
            if (tag == .Int32Array)
                return .int4_array;

            return .bytea;
        }

        if (tag == .HeapBigInt) {
            return .int8;
        }

        if (tag.isArrayLike()) {
            // We will JSON.stringify anything else.
            return .json;
        }

        // Ban these types:
        if (tag == .NumberObject) {
            return globalObject.ERR(.INVALID_ARG_TYPE, "Number object is ambiguous and cannot be used as a PostgreSQL type", .{}).throw();
        }

        if (tag == .BooleanObject) {
            return globalObject.ERR(.INVALID_ARG_TYPE, "Boolean object is ambiguous and cannot be used as a PostgreSQL type", .{}).throw();
        }

        // It's something internal
        if (!tag.isIndexable()) {
            return globalObject.ERR(.INVALID_ARG_TYPE, "Unknown object is not a valid PostgreSQL type", .{}).throw();
        }

        // We will JSON.stringify anything else.
        if (tag.isObject()) {
            return .json;
        }
    }

    if (value.isInt32()) {
        return .int4;
    }

    if (value.isAnyInt()) {
        const int = value.toInt64();
        if (int >= std.math.minInt(i32) and int <= std.math.maxInt(i32)) {
            return .int4;
        }

        return .int8;
    }

    if (value.isNumber()) {
        return .float8;
    }

    if (value.isBoolean()) {
        return .bool;
    }

    return .numeric;
}

const @"bool" = @import("./bool.zig");

const bun = @import("bun");
const bytea = @import("./bytea.zig");
const date = @import("./date.zig");
const json = @import("./json.zig");
const std = @import("std");
const string = @import("./PostgresString.zig");
const AnyPostgresError = @import("../../../sql/postgres/AnyPostgresError.zig").AnyPostgresError;
const Tag = @import("../../../sql/postgres/types/Tag.zig").Tag;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
