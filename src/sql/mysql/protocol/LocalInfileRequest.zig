const LocalInfileRequest = @This();
filename: Data = .{ .empty = {} },

pub fn deinit(this: *LocalInfileRequest) void {
    this.filename.deinit();
}

pub fn decodeInternal(this: *LocalInfileRequest, comptime Context: type, reader: NewReader(Context)) !void {
    this.filename = try reader.readZ();
}

pub const decode = decoderWrap(LocalInfileRequest, decodeInternal).decode;

const Data = @import("../../shared/Data.zig").Data;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
