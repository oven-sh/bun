const ResultSetHeader = @This();
field_count: u64 = 0,

pub fn decodeInternal(this: *ResultSetHeader, comptime Context: type, reader: NewReader(Context)) !void {
    // Field count (length encoded integer)
    this.field_count = try reader.encodedLenInt();
}

pub const decode = decoderWrap(ResultSetHeader, decodeInternal).decode;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
