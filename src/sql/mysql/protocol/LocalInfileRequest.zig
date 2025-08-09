const LocalInfileRequest = @This();
filename: Data = .{ .empty = {} },

pub fn deinit(this: *LocalInfileRequest) void {
    this.filename.deinit();
}

pub fn decodeInternal(this: *LocalInfileRequest, comptime Context: type, reader: NewReader(Context)) !void {
    this.filename = try reader.readZ();
}

pub const decode = decoderWrap(LocalInfileRequest, decodeInternal).decode;

const std = @import("std");
const bun = @import("bun");
const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
const Data = @import("./Data.zig").Data;
