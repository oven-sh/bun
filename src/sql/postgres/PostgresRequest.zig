pub fn writeBind(
    name: []const u8,
    cursor_name: bun.String,
    globalObject: *jsc.JSGlobalObject,
    values_array: JSValue,
    columns_value: JSValue,
    parameter_fields: []const int4,
    result_fields: []const protocol.FieldDescription,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
) !void {
    try writer.write("B");
    const length = try writer.length();

    try writer.String(cursor_name);
    try writer.string(name);

    const len: u32 = @truncate(parameter_fields.len);

    // The number of parameter format codes that follow (denoted C
    // below). This can be zero to indicate that there are no
    // parameters or that the parameters all use the default format
    // (text); or one, in which case the specified format code is
    // applied to all parameters; or it can equal the actual number
    // of parameters.
    try writer.short(len);

    var iter = try QueryBindingIterator.init(values_array, columns_value, globalObject);
    for (0..len) |i| {
        const parameter_field = parameter_fields[i];
        const is_custom_type = std.math.maxInt(short) < parameter_field;
        const tag: types.Tag = if (is_custom_type) .text else @enumFromInt(@as(short, @intCast(parameter_field)));

        const force_text = is_custom_type or (tag.isBinaryFormatSupported() and brk: {
            iter.to(@truncate(i));
            if (try iter.next()) |value| {
                break :brk value.isString();
            }
            if (iter.anyFailed()) {
                return error.InvalidQueryBinding;
            }
            break :brk false;
        });

        if (force_text) {
            // If they pass a value as a string, let's avoid attempting to
            // convert it to the binary representation. This minimizes the room
            // for mistakes on our end, such as stripping the timezone
            // differently than what Postgres does when given a timestamp with
            // timezone.
            try writer.short(0);
            continue;
        }

        try writer.short(
            tag.formatCode(),
        );
    }

    // The number of parameter values that follow (possibly zero). This
    // must match the number of parameters needed by the query.
    try writer.short(len);

    debug("Bind: {f} ({d} args)", .{ bun.fmt.quote(name), len });
    iter.to(0);
    var i: usize = 0;
    while (try iter.next()) |value| : (i += 1) {
        const tag: types.Tag = brk: {
            if (i >= len) {
                // parameter in array but not in parameter_fields
                // this is probably a bug a bug in bun lets return .text here so the server will send a error 08P01
                // with will describe better the error saying exactly how many parameters are missing and are expected
                // Example:
                // SQL error: PostgresError: bind message supplies 0 parameters, but prepared statement "PSELECT * FROM test_table WHERE id=$1 .in$0" requires 1
                // errno: "08P01",
                // code: "ERR_POSTGRES_SERVER_ERROR"
                break :brk .text;
            }
            const parameter_field = parameter_fields[i];
            const is_custom_type = std.math.maxInt(short) < parameter_field;
            break :brk if (is_custom_type) .text else @enumFromInt(@as(short, @intCast(parameter_field)));
        };
        if (value.isEmptyOrUndefinedOrNull()) {
            debug("  -> NULL", .{});
            //  As a special case, -1 indicates a
            // NULL parameter value. No value bytes follow in the NULL case.
            try writer.int4(@bitCast(@as(i32, -1)));
            continue;
        }
        if (comptime bun.Environment.enable_logs) {
            debug("  -> {s}", .{tag.tagName() orelse "(unknown)"});
        }

        switch (
        // If they pass a value as a string, let's avoid attempting to
        // convert it to the binary representation. This minimizes the room
        // for mistakes on our end, such as stripping the timezone
        // differently than what Postgres does when given a timestamp with
        // timezone.
        if (tag.isBinaryFormatSupported() and value.isString()) .text else tag) {
            .jsonb, .json => {
                var str = bun.String.empty;
                defer str.deref();
                // Use jsonStringifyFast for SIMD-optimized serialization
                try value.jsonStringifyFast(globalObject, &str);
                const slice = str.toUTF8WithoutRef(bun.default_allocator);
                defer slice.deinit();
                const l = try writer.length();
                try writer.write(slice.slice());
                try l.writeExcludingSelf();
            },
            .bool => {
                const l = try writer.length();
                try writer.write(&[1]u8{@intFromBool(value.toBoolean())});
                try l.writeExcludingSelf();
            },
            .timestamp, .timestamptz => {
                const l = try writer.length();
                try writer.int8(try types.date.fromJS(globalObject, value));
                try l.writeExcludingSelf();
            },
            .bytea => {
                var bytes: []const u8 = "";
                if (value.asArrayBuffer(globalObject)) |buf| {
                    bytes = buf.byteSlice();
                }
                const l = try writer.length();
                debug("    {d} bytes", .{bytes.len});

                try writer.write(bytes);
                try l.writeExcludingSelf();
            },
            .int4 => {
                const l = try writer.length();
                try writer.int4(@bitCast(try value.coerceToInt32(globalObject)));
                try l.writeExcludingSelf();
            },
            .int4_array => {
                const l = try writer.length();
                try writer.int4(@bitCast(try value.coerceToInt32(globalObject)));
                try l.writeExcludingSelf();
            },
            .float8 => {
                const l = try writer.length();
                try writer.f64(@bitCast(try value.toNumber(globalObject)));
                try l.writeExcludingSelf();
            },

            else => {
                const str = try String.fromJS(value, globalObject);
                if (str.tag == .Dead) return error.OutOfMemory;
                defer str.deref();
                const slice = str.toUTF8WithoutRef(bun.default_allocator);
                defer slice.deinit();
                const l = try writer.length();
                try writer.write(slice.slice());
                try l.writeExcludingSelf();
            },
        }
    }

    var any_non_text_fields: bool = false;
    for (result_fields) |field| {
        if (field.typeTag().isBinaryFormatSupported()) {
            any_non_text_fields = true;
            break;
        }
    }

    if (any_non_text_fields) {
        try writer.short(result_fields.len);
        for (result_fields) |field| {
            try writer.short(
                field.typeTag().formatCode(),
            );
        }
    } else {
        try writer.short(0);
    }

    try length.write();
}

pub fn writeQuery(
    query: []const u8,
    name: []const u8,
    params: []const int4,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
) AnyPostgresError!void {
    {
        var q = protocol.Parse{
            .name = name,
            .params = params,
            .query = query,
        };
        try q.writeInternal(Context, writer);
        debug("Parse: {f}", .{bun.fmt.quote(query)});
    }

    {
        var d = protocol.Describe{
            .p = .{
                .prepared_statement = name,
            },
        };
        try d.writeInternal(Context, writer);
        debug("Describe: {f}", .{bun.fmt.quote(name)});
    }
}

pub fn prepareAndQueryWithSignature(
    globalObject: *jsc.JSGlobalObject,
    query: []const u8,
    array_value: JSValue,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
    signature: *Signature,
) AnyPostgresError!void {
    try writeQuery(query, signature.prepared_statement_name, signature.fields, Context, writer);
    try writeBind(signature.prepared_statement_name, bun.String.empty, globalObject, array_value, .zero, &.{}, &.{}, Context, writer);
    var exec = protocol.Execute{
        .p = .{
            .prepared_statement = signature.prepared_statement_name,
        },
    };
    try exec.writeInternal(Context, writer);

    try writer.write(&protocol.Flush);
    try writer.write(&protocol.Sync);
}

pub fn bindAndExecute(
    globalObject: *jsc.JSGlobalObject,
    statement: *PostgresSQLStatement,
    array_value: JSValue,
    columns_value: JSValue,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
) !void {
    try writeBind(statement.signature.prepared_statement_name, bun.String.empty, globalObject, array_value, columns_value, statement.parameters, statement.fields, Context, writer);
    var exec = protocol.Execute{
        .p = .{
            .prepared_statement = statement.signature.prepared_statement_name,
        },
    };
    try exec.writeInternal(Context, writer);

    try writer.write(&protocol.Flush);
    try writer.write(&protocol.Sync);
}

pub fn executeQuery(
    query: []const u8,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
) !void {
    try protocol.writeQuery(query, Context, writer);
    try writer.write(&protocol.Flush);
    try writer.write(&protocol.Sync);
}

pub fn onData(
    connection: *PostgresSQLConnection,
    comptime Context: type,
    reader: protocol.NewReader(Context),
) !void {
    while (true) {
        reader.markMessageStart();
        const c = try reader.int(u8);
        debug("read: {c}", .{c});
        switch (c) {
            'D' => try connection.on(.DataRow, Context, reader),
            'd' => try connection.on(.CopyData, Context, reader),
            'S' => {
                if (connection.tls_status == .message_sent) {
                    bun.debugAssert(connection.tls_status.message_sent == 8);
                    connection.tls_status = .ssl_ok;
                    connection.setupTLS();
                    return;
                }

                try connection.on(.ParameterStatus, Context, reader);
            },
            'Z' => try connection.on(.ReadyForQuery, Context, reader),
            'C' => try connection.on(.CommandComplete, Context, reader),
            '2' => try connection.on(.BindComplete, Context, reader),
            '1' => try connection.on(.ParseComplete, Context, reader),
            't' => try connection.on(.ParameterDescription, Context, reader),
            'T' => try connection.on(.RowDescription, Context, reader),
            'R' => try connection.on(.Authentication, Context, reader),
            'n' => try connection.on(.NoData, Context, reader),
            'K' => try connection.on(.BackendKeyData, Context, reader),
            'E' => try connection.on(.ErrorResponse, Context, reader),
            's' => try connection.on(.PortalSuspended, Context, reader),
            '3' => try connection.on(.CloseComplete, Context, reader),
            'G' => try connection.on(.CopyInResponse, Context, reader),
            'N' => {
                if (connection.tls_status == .message_sent) {
                    connection.tls_status = .ssl_not_available;
                    debug("Server does not support SSL", .{});
                    if (connection.ssl_mode == .require) {
                        connection.fail("Server does not support SSL", error.TLSNotAvailable);
                        return;
                    }
                    continue;
                }

                try connection.on(.NoticeResponse, Context, reader);
            },
            'I' => try connection.on(.EmptyQueryResponse, Context, reader),
            'H' => try connection.on(.CopyOutResponse, Context, reader),
            'c' => try connection.on(.CopyDone, Context, reader),
            'W' => try connection.on(.CopyBothResponse, Context, reader),

            else => {
                debug("Unknown message: {c}", .{c});
                const to_skip = try reader.length() -| 1;
                debug("to_skip: {d}", .{to_skip});
                try reader.skip(@intCast(@max(to_skip, 0)));
            },
        }
    }
}

pub const Queue = bun.LinearFifo(*PostgresSQLQuery, .Dynamic);

const debug = bun.Output.scoped(.Postgres, .visible);

const PostgresSQLConnection = @import("./PostgresSQLConnection.zig");
const PostgresSQLQuery = @import("./PostgresSQLQuery.zig");
const PostgresSQLStatement = @import("./PostgresSQLStatement.zig");
const Signature = @import("./Signature.zig");
const protocol = @import("./PostgresProtocol.zig");
const std = @import("std");
const QueryBindingIterator = @import("../shared/QueryBindingIterator.zig").QueryBindingIterator;

const types = @import("./PostgresTypes.zig");
const AnyPostgresError = @import("./PostgresTypes.zig").AnyPostgresError;
const int4 = types.int4;
const short = types.short;

const bun = @import("bun");
const String = bun.String;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
