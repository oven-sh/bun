const ResultSetHeader = @This();
field_count: u64 = 0,
extra: ?u64 = null,

pub fn decodeInternal(this: *ResultSetHeader, comptime Context: type, reader: NewReader(Context)) !void {
    // Field count (length encoded integer)
    if (decodeLengthInt(reader.peek())) |result| {
        this.field_count = result.value;
        reader.skip(result.bytes_read);
    } else {
        return error.InvalidResultSetHeader;
    }

    // Extra (length encoded integer, optional)
    if (reader.peek().len > 0) {
        if (decodeLengthInt(reader.peek())) |result| {
            this.extra = result.value;
            reader.skip(result.bytes_read);
        }
    }
}

pub const decode = decoderWrap(ResultSetHeader, decodeInternal).decode;

const std = @import("std");
const bun = @import("bun");
const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
