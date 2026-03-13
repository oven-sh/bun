const AuthSwitchRequest = @This();
header: u8 = 0xfe,
plugin_name: Data = .{ .empty = {} },
plugin_data: Data = .{ .empty = {} },
packet_size: u24,

pub fn deinit(this: *AuthSwitchRequest) void {
    this.plugin_name.deinit();
    this.plugin_data.deinit();
}

pub fn decodeInternal(this: *AuthSwitchRequest, comptime Context: type, reader: NewReader(Context)) !void {
    this.header = try reader.int(u8);
    if (this.header != 0xfe) {
        return error.InvalidAuthSwitchRequest;
    }

    const remaining = try reader.read(this.packet_size - 1);
    const remaining_slice = remaining.slice();
    bun.assert(remaining == .temporary);

    if (bun.strings.indexOfChar(remaining_slice, 0)) |zero| {
        // EOF String
        this.plugin_name = .{
            .temporary = remaining_slice[0..zero],
        };
        // End Of The Packet String
        this.plugin_data = .{
            .temporary = remaining_slice[zero + 1 ..],
        };
        return;
    }
    return error.InvalidAuthSwitchRequest;
}

pub const decode = decoderWrap(AuthSwitchRequest, decodeInternal).decode;

const bun = @import("bun");
const Data = @import("../../shared/Data.zig").Data;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
