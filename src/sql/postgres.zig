pub fn createBinding(globalObject: *jsc.JSGlobalObject) JSValue {
    const binding = JSValue.createEmptyObjectWithNullPrototype(globalObject);
    binding.put(globalObject, ZigString.static("PostgresSQLConnection"), PostgresSQLConnection.js.getConstructor(globalObject));
    binding.put(globalObject, ZigString.static("init"), jsc.JSFunction.create(globalObject, "init", PostgresSQLContext.init, 0, .{}));
    binding.put(
        globalObject,
        ZigString.static("createQuery"),
        jsc.JSFunction.create(globalObject, "createQuery", PostgresSQLQuery.call, 6, .{}),
    );

    binding.put(
        globalObject,
        ZigString.static("createConnection"),
        jsc.JSFunction.create(globalObject, "createConnection", PostgresSQLConnection.call, 2, .{}),
    );

    binding.put(globalObject, ZigString.static("sendCopyData"), jsc.JSFunction.create(globalObject, "sendCopyData", __pg_sendCopyData, 2, .{}));
    binding.put(globalObject, ZigString.static("sendCopyDone"), jsc.JSFunction.create(globalObject, "sendCopyDone", __pg_sendCopyDone, 1, .{}));
    binding.put(globalObject, ZigString.static("sendCopyFail"), jsc.JSFunction.create(globalObject, "sendCopyFail", __pg_sendCopyFail, 2, .{}));
    binding.put(globalObject, ZigString.static("awaitWritable"), jsc.JSFunction.create(globalObject, "awaitWritable", __pg_awaitWritable, 2, .{}));
    binding.put(globalObject, ZigString.static("setCopyStreamingMode"), jsc.JSFunction.create(globalObject, "setCopyStreamingMode", __pg_setCopyStreamingMode, 2, .{}));
    binding.put(globalObject, ZigString.static("setCopyChunkHandlerRegistered"), jsc.JSFunction.create(globalObject, "setCopyChunkHandlerRegistered", __pg_setCopyChunkHandlerRegistered, 2, .{}));
    binding.put(globalObject, ZigString.static("setCopyTimeout"), jsc.JSFunction.create(globalObject, "setCopyTimeout", __pg_setCopyTimeout, 2, .{}));
    binding.put(globalObject, ZigString.static("setMaxCopyBufferSize"), jsc.JSFunction.create(globalObject, "setMaxCopyBufferSize", __pg_setMaxCopyBufferSize, 2, .{}));
    binding.put(globalObject, ZigString.static("setMaxCopyBufferSizeUnsafe"), jsc.JSFunction.create(globalObject, "setMaxCopyBufferSizeUnsafe", __pg_setMaxCopyBufferSizeUnsafe, 2, .{}));

    return binding;
}

// Low-level COPY helper wrappers (call with .call(connection, ...))
fn __pg_sendCopyData(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: data
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("sendCopyData first argument must be a PostgresSQLConnection", .{});
    };

    const data_value = callframe.argument(1);
    if (data_value == .zero) {
        return globalObject.throwNotEnoughArguments("sendCopyData", 2, 1);
    }

    try connection.copySendDataFromJSValue(globalObject, data_value);
    return .js_undefined;
}
fn __pg_sendCopyDone(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("sendCopyDone first argument must be a PostgresSQLConnection", .{});
    };
    return connection.sendCopyDone(globalObject, callframe);
}
fn __pg_sendCopyFail(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: message?
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("sendCopyFail first argument must be a PostgresSQLConnection", .{});
    };

    const args = callframe.arguments();
    const message_value: jsc.JSValue = if (args.len > 1) args[1] else .js_undefined;

    try connection.copySendFailFromJSValue(globalObject, message_value);
    return .js_undefined;
}
fn __pg_setCopyStreamingMode(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: enable (boolean)
    // Returns: undefined.
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("setCopyStreamingMode first argument must be a PostgresSQLConnection", .{});
    };

    const enable_arg = callframe.argument(1);
    const enable = enable_arg.toBoolean();

    // Apply the requested mode, but never enable streaming unless a per-connection chunk handler is registered.
    // Otherwise, COPY TO streaming could silently drop data.
    connection.copy_streaming_mode = enable and connection.copy_chunk_handler_registered;

    return .js_undefined;
}

fn __pg_setCopyChunkHandlerRegistered(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: registered (boolean)
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("setCopyChunkHandlerRegistered first argument must be a PostgresSQLConnection", .{});
    };

    const registered_arg = callframe.argument(1);
    const registered = registered_arg.toBoolean();

    connection.copy_chunk_handler_registered = registered;

    return .js_undefined;
}

fn __pg_setCopyTimeout(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: timeout in ms (number; 0 disables COPY timeout)
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("setCopyTimeout first argument must be a PostgresSQLConnection", .{});
    };

    const ms_value = callframe.argument(1);
    if (ms_value == .zero) {
        return globalObject.throwNotEnoughArguments("setCopyTimeout", 2, 1);
    }

    const ms_num = try ms_value.toNumber(globalObject);

    // 0 means disabled. Clamp to u32 max.
    var ms_u32: u32 = 0;
    if (std.math.isFinite(ms_num) and ms_num > 0) {
        const max_u32_f64: f64 = @floatFromInt(std.math.maxInt(u32));
        const clamped_f64: f64 = @min(ms_num, max_u32_f64);
        const ms_u64: u64 = @intFromFloat(clamped_f64);
        ms_u32 = @intCast(ms_u64);
    }

    connection.copy_timeout_ms = ms_u32;

    return .js_undefined;
}

fn __pg_setMaxCopyBufferSize(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: size in bytes (number; 0 disables limit)
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("setMaxCopyBufferSize first argument must be a PostgresSQLConnection", .{});
    };

    const bytes_value = callframe.argument(1);
    if (bytes_value == .zero) {
        return globalObject.throwNotEnoughArguments("setMaxCopyBufferSize", 2, 1);
    }

    // Delegate to the connection method to apply the safety cap.
    return connection.setMaxCopyBufferSize(globalObject, callframe);
}

fn __pg_setMaxCopyBufferSizeUnsafe(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: size in bytes (number; 0 disables limit)
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("setMaxCopyBufferSizeUnsafe first argument must be a PostgresSQLConnection", .{});
    };

    const bytes_value = callframe.argument(1);
    if (bytes_value == .zero) {
        return globalObject.throwNotEnoughArguments("setMaxCopyBufferSizeUnsafe", 2, 1);
    }

    // Delegate to the connection method to apply the hard cap.
    return connection.setMaxCopyBufferSizeUnsafe(globalObject, callframe);
}
fn __pg_awaitWritable(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("awaitWritable first argument must be a PostgresSQLConnection", .{});
    };

    // Delegate to the connection method, which returns a Promise that resolves when the socket becomes writable.
    return connection.awaitWritable(globalObject, callframe);
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;

pub const protocol = @import("./postgres/PostgresProtocol.zig");
pub const PostgresSQLConnection = @import("./postgres/PostgresSQLConnection.zig");
pub const PostgresSQLContext = @import("./postgres/PostgresSQLContext.zig");
pub const PostgresSQLQuery = @import("./postgres/PostgresSQLQuery.zig");
pub const types = @import("./postgres/PostgresTypes.zig");
