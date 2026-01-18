/// Shared implementation for PostgreSQL COPY response messages.
/// Used by CopyInResponse, CopyOutResponse, and CopyBothResponse which
/// share identical structure and decoding logic.
const CopyResponse = @This();

#overall_format: u8 = 0,
#column_format_codes: []u16 = &[_]u16{},

/// Returns the overall format code (0 = text, 1 = binary)
pub fn overall_format(this: *const CopyResponse) u8 {
    return this.#overall_format;
}

/// Returns the per-column format codes
pub fn column_format_codes(this: *const CopyResponse) []const u16 {
    return this.#column_format_codes;
}

pub fn deinit(this: *CopyResponse) void {
    if (this.#column_format_codes.len > 0) {
        bun.default_allocator.free(this.#column_format_codes);
        this.#column_format_codes = &[_]u16{};
    }
}

pub fn decodeInternal(this: *CopyResponse, comptime Container: type, reader: NewReader(Container)) !void {
    this.* = .{
        .#overall_format = 0,
        .#column_format_codes = &[_]u16{},
    };

    const length_value = try reader.length();
    const payload_len: usize = if (length_value > 4) @intCast(length_value - 4) else 0;
    const min_header: usize = 1 + 2; // overall_format (u8) + column_count (i16)
    if (payload_len < min_header) return error.InvalidMessage;

    const format_value = try reader.int(u8);
    const raw_column_count = try reader.short();
    const column_count: usize = @intCast(@max(raw_column_count, 0));

    const max_columns = (payload_len - min_header) / 2; // each format code is int16
    if (column_count > max_columns) return error.InvalidMessage;

    const format_codes = try bun.default_allocator.alloc(u16, column_count);
    errdefer bun.default_allocator.free(format_codes);

    for (format_codes) |*format_code| {
        const raw = try reader.short();
        format_code.* = if (raw < 0) 0 else @intCast(raw);
    }

    this.* = .{
        .#overall_format = format_value,
        .#column_format_codes = format_codes,
    };
}

pub const decode = DecoderWrap(CopyResponse, decodeInternal).decode;

const bun = @import("bun");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;
