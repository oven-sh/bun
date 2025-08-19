// OK Packet
const OKPacket = @This();
header: u8 = 0x00,
affected_rows: u64 = 0,
last_insert_id: u64 = 0,
status_flags: StatusFlags = .{},
warnings: u16 = 0,
info: Data = .{ .empty = {} },
session_state_changes: Data = .{ .empty = {} },

pub fn deinit(this: *OKPacket) void {
    this.info.deinit();
    this.session_state_changes.deinit();
}

pub fn decodeInternal(this: *OKPacket, comptime Context: type, reader: NewReader(Context)) !void {
    this.header = try reader.int(u8);
    if (this.header != 0x00 and this.header != 0xfe) {
        return error.InvalidOKPacket;
    }

    // Affected rows (length encoded integer)
    this.affected_rows = try reader.encodeLenInt();

    // Last insert ID (length encoded integer)
    this.last_insert_id = try reader.encodeLenInt();

    // Status flags
    this.status_flags = StatusFlags.fromInt(try reader.int(u16));

    // Warnings
    this.warnings = try reader.int(u16);

    // Info (EOF-terminated string)
    if (reader.peek().len > 0) {
        this.info = try reader.readZ();
    }
}

pub const decode = decoderWrap(OKPacket, decodeInternal).decode;

const std = @import("std");
const bun = @import("bun");
const Data = @import("../../shared/Data.zig").Data;
const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
const StatusFlags = @import("../StatusFlags.zig").StatusFlags;
