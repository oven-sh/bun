// OK Packet
const OKPacket = @This();
header: u8 = 0x00,
affected_rows: u64 = 0,
last_insert_id: u64 = 0,
status_flags: StatusFlags = .{},
warnings: u16 = 0,
info: Data = .{ .empty = {} },
session_state_changes: Data = .{ .empty = {} },
packet_size: u24,

pub fn deinit(this: *OKPacket) void {
    this.info.deinit();
    this.session_state_changes.deinit();
}

pub fn decodeInternal(this: *OKPacket, comptime Context: type, reader: NewReader(Context)) !void {
    var read_size: usize = 5; // header + status flags + warnings
    this.header = try reader.int(u8);
    if (this.header != 0x00 and this.header != 0xfe) {
        return error.InvalidOKPacket;
    }

    // Affected rows (length encoded integer)
    this.affected_rows = try reader.encodedLenIntWithSize(&read_size);

    // Last insert ID (length encoded integer)
    this.last_insert_id = try reader.encodedLenIntWithSize(&read_size);

    // Status flags
    this.status_flags = StatusFlags.fromInt(try reader.int(u16));
    // Warnings
    this.warnings = try reader.int(u16);

    // Info (EOF-terminated string)
    if (reader.peek().len > 0 and this.packet_size > read_size) {
        const remaining = this.packet_size - read_size;
        this.info = try reader.read(@truncate(remaining));
    }
}

pub const decode = decoderWrap(OKPacket, decodeInternal).decode;

const Data = @import("../../shared/Data.zig").Data;

const StatusFlags = @import("../StatusFlags.zig").StatusFlags;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
