const AuthSwitchRequest = @This();
header: u8 = 0xfe,
plugin_name: Data = .{ .empty = {} },
plugin_data: Data = .{ .empty = {} },

pub fn deinit(this: *AuthSwitchRequest) void {
    this.plugin_name.deinit();
    this.plugin_data.deinit();
}

pub fn decodeInternal(this: *AuthSwitchRequest, comptime Context: type, reader: NewReader(Context)) !void {
    this.header = try reader.int(u8);
    if (this.header != 0xfe) {
        return error.InvalidAuthSwitchRequest;
    }

    this.plugin_name = try reader.readZ();
    this.plugin_data = try reader.readZ();
}

pub const decode = decoderWrap(AuthSwitchRequest, decodeInternal).decode;

const Data = @import("../../shared/Data.zig").Data;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
