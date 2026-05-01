const CopyInResponse = @This();

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    _ = reader;
    _ = this;
    bun.Output.panic("TODO: not implemented {s}", .{bun.meta.typeBaseName(@typeName(@This()))});
}

pub const decode = DecoderWrap(CopyInResponse, decodeInternal).decode;

const bun = @import("bun");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;
