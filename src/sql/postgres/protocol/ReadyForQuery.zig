const ReadyForQuery = @This();

status: TransactionStatusIndicator = .I,
pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    const length = try reader.length();
    bun.assert(length >= 4);

    const status = try reader.int(u8);
    this.* = .{
        .status = @enumFromInt(status),
    };
}

pub const decode = DecoderWrap(ReadyForQuery, decodeInternal).decode;

const bun = @import("bun");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;
const TransactionStatusIndicator = @import("./TransactionStatusIndicator.zig").TransactionStatusIndicator;
