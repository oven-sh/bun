const CopyBothResponse = @This();

overall_format: u8 = 0,
column_format_codes: []u16 = &[_]u16{},

pub fn deinit(this: *@This()) void {
    if (this.column_format_codes.len > 0) {
        bun.default_allocator.free(this.column_format_codes);
        this.column_format_codes = &[_]u16{};
    }
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    _ = try reader.length();

    const overall_format = try reader.int(u8);
    const column_count: usize = @intCast(@max(try reader.short(), 0));

    // Free existing allocation if reusing this object
    if (this.column_format_codes.len > 0) {
        bun.default_allocator.free(this.column_format_codes);
        this.column_format_codes = &[_]u16{};
    }

    const column_format_codes = try bun.default_allocator.alloc(u16, column_count);
    errdefer bun.default_allocator.free(column_format_codes);

    for (column_format_codes) |*format_code| {
        format_code.* = @intCast(try reader.short());
    }

    this.* = .{
        .overall_format = overall_format,
        .column_format_codes = column_format_codes,
    };
}

pub const decode = DecoderWrap(CopyBothResponse, decodeInternal).decode;

const bun = @import("bun");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;
