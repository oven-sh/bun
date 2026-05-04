//! `toJS` bridges for the RESP protocol types in `valkey/valkey_protocol.zig`.
//! The protocol parser, `RESPValue` union, and `ValkeyReader` stay in
//! `valkey/`; only the `JSGlobalObject`/`JSValue`-touching conversions live
//! here so `valkey/` is JSC-free.

pub fn valkeyErrorToJS(globalObject: *jsc.JSGlobalObject, message: ?[]const u8, err: protocol.RedisError) jsc.JSValue {
    const error_code: jsc.Error = switch (err) {
        error.ConnectionClosed => .REDIS_CONNECTION_CLOSED,
        error.InvalidResponse => .REDIS_INVALID_RESPONSE,
        error.InvalidBulkString => .REDIS_INVALID_BULK_STRING,
        error.InvalidArray => .REDIS_INVALID_ARRAY,
        error.InvalidInteger => .REDIS_INVALID_INTEGER,
        error.InvalidSimpleString => .REDIS_INVALID_SIMPLE_STRING,
        error.InvalidErrorString => .REDIS_INVALID_ERROR_STRING,
        error.InvalidDouble,
        error.InvalidBoolean,
        error.InvalidNull,
        error.InvalidMap,
        error.InvalidSet,
        error.InvalidBigNumber,
        error.InvalidVerbatimString,
        error.InvalidBlobError,
        error.InvalidAttribute,
        error.InvalidPush,
        => .REDIS_INVALID_RESPONSE,
        error.AuthenticationFailed => .REDIS_AUTHENTICATION_FAILED,
        error.InvalidCommand => .REDIS_INVALID_COMMAND,
        error.InvalidArgument => .REDIS_INVALID_ARGUMENT,
        error.UnsupportedProtocol => .REDIS_INVALID_RESPONSE,
        error.InvalidResponseType => .REDIS_INVALID_RESPONSE_TYPE,
        error.ConnectionTimeout => .REDIS_CONNECTION_TIMEOUT,
        error.IdleTimeout => .REDIS_IDLE_TIMEOUT,
        error.NestingDepthExceeded => .REDIS_INVALID_RESPONSE,
        error.JSError => return globalObject.takeException(error.JSError),
        error.OutOfMemory => globalObject.throwOutOfMemory() catch return globalObject.takeException(error.JSError),
        error.JSTerminated => return globalObject.takeException(error.JSTerminated),
    };

    if (message) |msg| {
        return error_code.fmt(globalObject, "{s}", .{msg});
    }
    return error_code.fmt(globalObject, "Valkey error: {s}", .{@errorName(err)});
}

pub fn respValueToJS(self: *RESPValue, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return respValueToJSWithOptions(self, globalObject, .{});
}

pub const ToJSOptions = struct {
    return_as_buffer: bool = false,
};

fn valkeyStrToJSValue(globalObject: *jsc.JSGlobalObject, str: []const u8, options: *const ToJSOptions) bun.JSError!jsc.JSValue {
    if (options.return_as_buffer) {
        // TODO: handle values > 4.7 GB
        return try jsc.ArrayBuffer.createBuffer(globalObject, str);
    } else {
        return bun.String.createUTF8ForJS(globalObject, str);
    }
}

pub fn respValueToJSWithOptions(self: *RESPValue, globalObject: *jsc.JSGlobalObject, options: ToJSOptions) bun.JSError!jsc.JSValue {
    switch (self.*) {
        .SimpleString => |str| return valkeyStrToJSValue(globalObject, str, &options),
        .Error => |str| return valkeyErrorToJS(globalObject, str, protocol.RedisError.InvalidResponse),
        .Integer => |int| return jsc.JSValue.jsNumber(int),
        .BulkString => |maybe_str| {
            if (maybe_str) |str| {
                return valkeyStrToJSValue(globalObject, str, &options);
            } else {
                return jsc.JSValue.jsNull();
            }
        },
        .Array => |array| {
            var js_array = try jsc.JSValue.createEmptyArray(globalObject, array.len);
            for (array, 0..) |*item, i| {
                const js_item = try respValueToJSWithOptions(item, globalObject, options);
                try js_array.putIndex(globalObject, @intCast(i), js_item);
            }
            return js_array;
        },
        .Null => return jsc.JSValue.jsNull(),
        .Double => |d| return jsc.JSValue.jsNumber(d),
        .Boolean => |b| return jsc.JSValue.jsBoolean(b),
        .BlobError => |str| return valkeyErrorToJS(globalObject, str, protocol.RedisError.InvalidBlobError),
        .VerbatimString => |verbatim| return valkeyStrToJSValue(globalObject, verbatim.content, &options),
        .Map => |entries| {
            var js_obj = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);
            for (entries) |*entry| {
                const js_key = try respValueToJSWithOptions(&entry.key, globalObject, .{});
                var key_str = try js_key.toBunString(globalObject);
                defer key_str.deref();
                const js_value = try respValueToJSWithOptions(&entry.value, globalObject, options);

                try js_obj.putMayBeIndex(globalObject, &key_str, js_value);
            }
            return js_obj;
        },
        .Set => |set| {
            var js_array = try jsc.JSValue.createEmptyArray(globalObject, set.len);
            for (set, 0..) |*item, i| {
                const js_item = try respValueToJSWithOptions(item, globalObject, options);
                try js_array.putIndex(globalObject, @intCast(i), js_item);
            }
            return js_array;
        },
        .Attribute => |attribute| {
            // For now, we just return the value and ignore attributes
            // In the future, we could attach the attributes as a hidden property
            return try respValueToJSWithOptions(attribute.value, globalObject, options);
        },
        .Push => |push| {
            var js_obj = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);

            // Add the push type
            const kind_str = try bun.String.createUTF8ForJS(globalObject, push.kind);
            js_obj.put(globalObject, "type", kind_str);

            // Add the data as an array
            var data_array = try jsc.JSValue.createEmptyArray(globalObject, push.data.len);
            for (push.data, 0..) |*item, i| {
                const js_item = try respValueToJSWithOptions(item, globalObject, options);
                try data_array.putIndex(globalObject, @intCast(i), js_item);
            }
            js_obj.put(globalObject, "data", data_array);

            return js_obj;
        },
        .BigNumber => |str| {
            // Try to parse as number if possible
            if (std.fmt.parseInt(i64, str, 10)) |int| {
                return jsc.JSValue.jsNumber(int);
            } else |_| {
                // If it doesn't fit in an i64, return as string
                return bun.String.createUTF8ForJS(globalObject, str);
            }
        },
    }
}

const std = @import("std");

const protocol = @import("../../valkey/valkey_protocol.zig");
const RESPValue = protocol.RESPValue;

const bun = @import("bun");
const jsc = bun.jsc;
