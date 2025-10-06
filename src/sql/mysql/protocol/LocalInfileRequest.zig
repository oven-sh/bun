const LocalInfileRequest = @This();
filename: Data = .{ .empty = {} },
packet_size: u24,
pub fn deinit(this: *LocalInfileRequest) void {
    this.filename.deinit();
}

pub fn decodeInternal(this: *LocalInfileRequest, comptime Context: type, reader: NewReader(Context)) !void {
    const header = try reader.int(u8);
    if (header != 0xFB) {
        return error.InvalidLocalInfileRequest;
    }

    this.filename = try reader.read(this.packet_size - 1);
}

pub const decode = decoderWrap(LocalInfileRequest, decodeInternal).decode;

const Data = @import("../../shared/Data.zig").Data;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
