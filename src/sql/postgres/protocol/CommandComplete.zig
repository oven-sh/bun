const CommandComplete = @This();
command_tag: Data = .{ .empty = {} },

pub fn deinit(this: *@This()) void {
    this.command_tag.deinit();
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    const length = try reader.length();
    bun.assert(length >= 4);

    const tag = try reader.readZ();
    this.* = .{
        .command_tag = tag,
    };
}

pub const decode = DecoderWrap(CommandComplete, decodeInternal).decode;

// @sortImports
const bun = @import("bun");
const Data = @import("../Data.zig").Data;
const NewReader = @import("./NewReader.zig").NewReader;
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
