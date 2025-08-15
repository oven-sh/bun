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

pub fn toJS(this: ErrorResponse, globalObject: *jsc.JSGlobalObject) JSError!JSValue {
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
    var internalPosition: String = String.dead;
    var internal: String = String.dead;
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
            .internal_position => |str| internalPosition = str,
            .internal => |str| internal = str,
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

    const bun_ns = (try globalObject.toJSValue().get(globalObject, "Bun")).?;
    const sql_constructor = (try bun_ns.get(globalObject, "SQL")).?;
    const pg_error_constructor = (try sql_constructor.get(globalObject, "PostgresError")).?;

    const options = JSValue.createEmptyObject(globalObject, 0);
    options.put(globalObject, jsc.ZigString.static("code"), code.toJS(globalObject));
    options.put(globalObject, jsc.ZigString.static("detail"), detail.toJS(globalObject));
    options.put(globalObject, jsc.ZigString.static("hint"), hint.toJS(globalObject));
    options.put(globalObject, jsc.ZigString.static("severity"), severity.toJS(globalObject));

    if (!position.isEmpty()) options.put(globalObject, jsc.ZigString.static("position"), position.toJS(globalObject));
    if (!internalPosition.isEmpty()) options.put(globalObject, jsc.ZigString.static("internalPosition"), internalPosition.toJS(globalObject));
    if (!internal.isEmpty()) options.put(globalObject, jsc.ZigString.static("internalQuery"), internal.toJS(globalObject));
    if (!where.isEmpty()) options.put(globalObject, jsc.ZigString.static("where"), where.toJS(globalObject));
    if (!schema.isEmpty()) options.put(globalObject, jsc.ZigString.static("schema"), schema.toJS(globalObject));
    if (!table.isEmpty()) options.put(globalObject, jsc.ZigString.static("table"), table.toJS(globalObject));
    if (!column.isEmpty()) options.put(globalObject, jsc.ZigString.static("column"), column.toJS(globalObject));
    if (!datatype.isEmpty()) options.put(globalObject, jsc.ZigString.static("dataType"), datatype.toJS(globalObject));
    if (!constraint.isEmpty()) options.put(globalObject, jsc.ZigString.static("constraint"), constraint.toJS(globalObject));
    if (!file.isEmpty()) options.put(globalObject, jsc.ZigString.static("file"), file.toJS(globalObject));
    if (!line.isEmpty()) options.put(globalObject, jsc.ZigString.static("line"), line.toJS(globalObject));
    if (!routine.isEmpty()) options.put(globalObject, jsc.ZigString.static("routine"), routine.toJS(globalObject));

    const args = [_]JSValue{
        jsc.ZigString.init(b.allocatedSlice()[0..b.len]).toJS(globalObject),
        options,
    };

    return pg_error_constructor.call(globalObject, .js_undefined, &args) catch unreachable;
}

const std = @import("std");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const FieldMessage = @import("./FieldMessage.zig").FieldMessage;
const NewReader = @import("./NewReader.zig").NewReader;

const bun = @import("bun");
const String = bun.String;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSError = bun.JSError;
