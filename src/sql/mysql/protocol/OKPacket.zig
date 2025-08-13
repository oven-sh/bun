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
    if (this.header != 0x00) {
        return error.InvalidOKPacket;
    }

    // Affected rows (length encoded integer)
    if (decodeLengthInt(reader.peek())) |result| {
        this.affected_rows = result.value;
        reader.skip(result.bytes_read);
    } else {
        return error.InvalidOKPacket;
    }

    // Last insert ID (length encoded integer)
    if (decodeLengthInt(reader.peek())) |result| {
        this.last_insert_id = result.value;
        reader.skip(result.bytes_read);
    } else {
        return error.InvalidOKPacket;
    }

    // Status flags
    this.status_flags = StatusFlags.fromInt(try reader.int(u16));

    // Warnings
    this.warnings = try reader.int(u16);

    // Info (EOF-terminated string)
    if (reader.peek().len > 0) {
        this.info = try reader.readZ();
    }

    // Session state changes if SESSION_TRACK_STATE_CHANGE is set
    if (this.status_flags.SERVER_SESSION_STATE_CHANGED) {
        if (decodeLengthInt(reader.peek())) |result| {
            const state_data = try reader.read(@intCast(result.value));
            this.session_state_changes = state_data;
            reader.skip(result.bytes_read);
        }
    }
}

pub const decode = decoderWrap(OKPacket, decodeInternal).decode;

const std = @import("std");
const bun = @import("bun");
const Data = @import("./Data.zig").Data;
const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
const StatusFlags = @import("../StatusFlags.zig").StatusFlags;
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
