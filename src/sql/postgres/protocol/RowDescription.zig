const RowDescription = @This();

fields: []FieldDescription = &[_]FieldDescription{},
pub fn deinit(this: *@This()) void {
    for (this.fields) |*field| {
        field.deinit();
    }

    bun.default_allocator.free(this.fields);
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    var remaining_bytes = try reader.length();
    remaining_bytes -|= 4;

    const field_count: usize = @intCast(@max(try reader.short(), 0));
    var fields = try bun.default_allocator.alloc(
        FieldDescription,
        field_count,
    );
    var remaining = fields;
    errdefer {
        for (fields[0 .. field_count - remaining.len]) |*field| {
            field.deinit();
        }

        bun.default_allocator.free(fields);
    }
    while (remaining.len > 0) {
        try remaining[0].decodeInternal(Container, reader);
        remaining = remaining[1..];
    }
    this.* = .{
        .fields = fields,
    };
}

pub const decode = DecoderWrap(RowDescription, decodeInternal).decode;

const FieldDescription = @import("./FieldDescription.zig");
const bun = @import("bun");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;
