const BackendKeyData = @This();

process_id: u32 = 0,
secret_key: u32 = 0,
pub const decode = DecoderWrap(BackendKeyData, decodeInternal).decode;

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    if (!try reader.expectInt(u32, 12)) {
        return error.InvalidBackendKeyData;
    }

    this.* = .{
        .process_id = @bitCast(try reader.int4()),
        .secret_key = @bitCast(try reader.int4()),
    };
}

const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;

const NewReader = @import("./NewReader.zig").NewReader;
