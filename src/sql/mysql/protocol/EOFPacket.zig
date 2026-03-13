const EOFPacket = @This();
header: u8 = 0xfe,
warnings: u16 = 0,
status_flags: StatusFlags = .{},

pub fn decodeInternal(this: *EOFPacket, comptime Context: type, reader: NewReader(Context)) !void {
    this.header = try reader.int(u8);
    if (this.header != 0xfe) {
        return error.InvalidEOFPacket;
    }

    this.warnings = try reader.int(u16);
    this.status_flags = StatusFlags.fromInt(try reader.int(u16));
}

pub const decode = decoderWrap(EOFPacket, decodeInternal).decode;

const StatusFlags = @import("../StatusFlags.zig").StatusFlags;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
