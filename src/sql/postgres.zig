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
    binding.put(globalObject, ZigString.static("setCopyTimeout"), jsc.JSFunction.create(globalObject, "setCopyTimeout", __pg_setCopyTimeout, 2, .{}));
    binding.put(globalObject, ZigString.static("setMaxCopyBufferSize"), jsc.JSFunction.create(globalObject, "setMaxCopyBufferSize", __pg_setMaxCopyBufferSize, 2, .{}));

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

    // Validate connection state
    if (connection.status != .connected) {
        return globalObject.throw("Cannot send COPY done: connection is {s}. The connection must be open to complete the COPY operation.", .{@tagName(connection.status)});
    }
    if (connection.copy_state != .copy_in_progress) {
        return globalObject.throw("Cannot send COPY done: not in COPY FROM STDIN mode (current state: {s}). You must be in an active COPY FROM STDIN operation.", .{@tagName(connection.copy_state)});
    }

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
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("setCopyStreamingMode first argument must be a PostgresSQLConnection", .{});
    };

    const enable_arg = callframe.argument(1);
    const enable = enable_arg.toBoolean();

    connection.copy_streaming_mode = enable;

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

    const ms_i32 = ms_value.toInt32();
    const ms_u32: u32 = if (ms_i32 < 0) 0 else @intCast(ms_i32);
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

    const size_i32 = bytes_value.toInt32();
    const size_u: usize = if (size_i32 <= 0) 0 else @intCast(size_i32);
    connection.max_copy_buffer_size = size_u;

    // Note: if currently accumulating (non-streaming COPY TO), existing buffered data may exceed the new limit.
    // Guards on append and completion will enforce the limit going forward.

    return .js_undefined;
}
fn __pg_awaitWritable(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    // Arg0: PostgresSQLConnection, Arg1: optional callback invoked when socket becomes writable
    const connection_value = callframe.argument(0);
    const connection: *PostgresSQLConnection = connection_value.as(PostgresSQLConnection) orelse {
        return globalObject.throw("awaitWritable first argument must be a PostgresSQLConnection", .{});
    };
    _ = connection;

    // No-op here: writable notifications are dispatched via the global TS-installed handler.

    return .js_undefined;
}

pub const PostgresSQLConnection = @import("./postgres/PostgresSQLConnection.zig");
pub const PostgresSQLContext = @import("./postgres/PostgresSQLContext.zig");
pub const PostgresSQLQuery = @import("./postgres/PostgresSQLQuery.zig");
pub const protocol = @import("./postgres/PostgresProtocol.zig");
pub const types = @import("./postgres/PostgresTypes.zig");

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
