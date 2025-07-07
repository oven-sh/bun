const CopyOutResponse = @This();
pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    _ = reader;
    _ = this;
    bun.Output.panic("TODO: not implemented {s}", .{bun.meta.typeBaseName(@typeName(@This()))});
}

pub const decode = DecoderWrap(CopyOutResponse, decodeInternal).decode;

// @sortImports
const std = @import("std");
const bun = @import("bun");
const NewReader = @import("./NewReader.zig").NewReader;
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
