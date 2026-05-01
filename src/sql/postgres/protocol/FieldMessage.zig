pub const FieldMessage = union(FieldType) {
    severity: String,
    localized_severity: String,
    code: String,
    message: String,
    detail: String,
    hint: String,
    position: String,
    internal_position: String,
    internal: String,
    where: String,
    schema: String,
    table: String,
    column: String,
    datatype: String,
    constraint: String,
    file: String,
    line: String,
    routine: String,

    pub fn format(this: FieldMessage, writer: *std.Io.Writer) !void {
        switch (this) {
            inline else => |str| {
                try writer.print("{f}", .{str});
            },
        }
    }

    pub fn deinit(this: *FieldMessage) void {
        switch (this.*) {
            inline else => |*message| {
                message.deref();
            },
        }
    }

    pub fn decodeList(comptime Context: type, reader: NewReader(Context)) !std.ArrayListUnmanaged(FieldMessage) {
        var messages = std.ArrayListUnmanaged(FieldMessage){};
        while (true) {
            const field_int = try reader.int(u8);
            if (field_int == 0) break;
            const field: FieldType = @enumFromInt(field_int);

            var message = try reader.readZ();
            defer message.deinit();
            if (message.slice().len == 0) break;

            try messages.append(bun.default_allocator, FieldMessage.init(field, message.slice()) catch continue);
        }

        return messages;
    }

    pub fn init(tag: FieldType, message: []const u8) !FieldMessage {
        return switch (tag) {
            .severity => FieldMessage{ .severity = String.cloneUTF8(message) },
            // Ignore this one for now.
            // .localized_severity => FieldMessage{ .localized_severity = String.createUTF8(message) },
            .code => FieldMessage{ .code = String.cloneUTF8(message) },
            .message => FieldMessage{ .message = String.cloneUTF8(message) },
            .detail => FieldMessage{ .detail = String.cloneUTF8(message) },
            .hint => FieldMessage{ .hint = String.cloneUTF8(message) },
            .position => FieldMessage{ .position = String.cloneUTF8(message) },
            .internal_position => FieldMessage{ .internal_position = String.cloneUTF8(message) },
            .internal => FieldMessage{ .internal = String.cloneUTF8(message) },
            .where => FieldMessage{ .where = String.cloneUTF8(message) },
            .schema => FieldMessage{ .schema = String.cloneUTF8(message) },
            .table => FieldMessage{ .table = String.cloneUTF8(message) },
            .column => FieldMessage{ .column = String.cloneUTF8(message) },
            .datatype => FieldMessage{ .datatype = String.cloneUTF8(message) },
            .constraint => FieldMessage{ .constraint = String.cloneUTF8(message) },
            .file => FieldMessage{ .file = String.cloneUTF8(message) },
            .line => FieldMessage{ .line = String.cloneUTF8(message) },
            .routine => FieldMessage{ .routine = String.cloneUTF8(message) },
            else => error.UnknownFieldType,
        };
    }
};

const std = @import("std");
const FieldType = @import("./FieldType.zig").FieldType;
const NewReader = @import("./NewReader.zig").NewReader;

const bun = @import("bun");
const String = bun.String;
