const ErrorResponse = @This();

messages: std.ArrayListUnmanaged(FieldMessage) = .{},

pub fn format(formatter: ErrorResponse, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    for (formatter.messages.items) |message| {
        try std.fmt.format(writer, "{}\n", .{message});
    }
}

pub fn deinit(this: *ErrorResponse) void {
    for (this.messages.items) |*message| {
        message.deinit();
    }
    this.messages.deinit(bun.default_allocator);
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    var remaining_bytes = try reader.length();
    if (remaining_bytes < 4) return error.InvalidMessageLength;
    remaining_bytes -|= 4;

    if (remaining_bytes > 0) {
        this.* = .{
            .messages = try FieldMessage.decodeList(Container, reader),
        };
    }
}

pub const decode = DecoderWrap(ErrorResponse, decodeInternal).decode;

pub fn toJS(this: ErrorResponse, globalObject: *JSC.JSGlobalObject) JSValue {
    var b = bun.StringBuilder{};
    defer b.deinit(bun.default_allocator);

    // Pre-calculate capacity to avoid reallocations
    for (this.messages.items) |*msg| {
        b.cap += switch (msg.*) {
            inline else => |m| m.utf8ByteLength(),
        } + 1;
    }
    b.allocate(bun.default_allocator) catch {};

    // Build a more structured error message
    var severity: String = String.dead;
    var code: String = String.dead;
    var message: String = String.dead;
    var detail: String = String.dead;
    var hint: String = String.dead;
    var position: String = String.dead;
    var where: String = String.dead;
    var schema: String = String.dead;
    var table: String = String.dead;
    var column: String = String.dead;
    var datatype: String = String.dead;
    var constraint: String = String.dead;
    var file: String = String.dead;
    var line: String = String.dead;
    var routine: String = String.dead;

    for (this.messages.items) |*msg| {
        switch (msg.*) {
            .severity => |str| severity = str,
            .code => |str| code = str,
            .message => |str| message = str,
            .detail => |str| detail = str,
            .hint => |str| hint = str,
            .position => |str| position = str,
            .where => |str| where = str,
            .schema => |str| schema = str,
            .table => |str| table = str,
            .column => |str| column = str,
            .datatype => |str| datatype = str,
            .constraint => |str| constraint = str,
            .file => |str| file = str,
            .line => |str| line = str,
            .routine => |str| routine = str,
            else => {},
        }
    }

    var needs_newline = false;
    construct_message: {
        if (!message.isEmpty()) {
            _ = b.appendStr(message);
            needs_newline = true;
            break :construct_message;
        }
        if (!detail.isEmpty()) {
            if (needs_newline) {
                _ = b.append("\n");
            } else {
                _ = b.append(" ");
            }
            needs_newline = true;
            _ = b.appendStr(detail);
        }
        if (!hint.isEmpty()) {
            if (needs_newline) {
                _ = b.append("\n");
            } else {
                _ = b.append(" ");
            }
            needs_newline = true;
            _ = b.appendStr(hint);
        }
    }

    const possible_fields = .{
        .{ "detail", detail, void },
        .{ "hint", hint, void },
        .{ "column", column, void },
        .{ "constraint", constraint, void },
        .{ "datatype", datatype, void },
        // in the past this was set to i32 but postgres returns a strings lets keep it compatible
        .{ "errno", code, void },
        .{ "position", position, i32 },
        .{ "schema", schema, void },
        .{ "table", table, void },
        .{ "where", where, void },
    };
    const error_code: JSC.Error =
        // https://www.postgresql.org/docs/8.1/errcodes-appendix.html
        if (code.eqlComptime("42601"))
            .POSTGRES_SYNTAX_ERROR
        else
            .POSTGRES_SERVER_ERROR;
    const err = error_code.fmt(globalObject, "{s}", .{b.allocatedSlice()[0..b.len]});

    inline for (possible_fields) |field| {
        if (!field.@"1".isEmpty()) {
            const value = brk: {
                if (field.@"2" == i32) {
                    if (field.@"1".toInt32()) |val| {
                        break :brk JSC.JSValue.jsNumberFromInt32(val);
                    }
                }

                break :brk field.@"1".toJS(globalObject);
            };

            err.put(globalObject, JSC.ZigString.static(field.@"0"), value);
        }
    }

    return err;
}

const std = @import("std");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const FieldMessage = @import("./FieldMessage.zig").FieldMessage;
const NewReader = @import("./NewReader.zig").NewReader;

const bun = @import("bun");
const String = bun.String;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
