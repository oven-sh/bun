// Initial handshake packet from server
const HandshakeV10 = @This();
protocol_version: u8 = 10,
server_version: Data = .{ .empty = {} },
connection_id: u32 = 0,
auth_plugin_data_part_1: [8]u8 = undefined,
auth_plugin_data_part_2: []const u8 = &[_]u8{},
capability_flags: Capabilities = .{},
character_set: CharacterSet = CharacterSet.default,
status_flags: StatusFlags = .{},
auth_plugin_name: Data = .{ .empty = {} },

pub fn deinit(this: *HandshakeV10) void {
    this.server_version.deinit();
    this.auth_plugin_name.deinit();
}

pub fn decodeInternal(this: *HandshakeV10, comptime Context: type, reader: NewReader(Context)) !void {
    // Protocol version
    this.protocol_version = try reader.int(u8);
    if (this.protocol_version != 10) {
        return error.UnsupportedProtocolVersion;
    }

    // Server version (null-terminated string)
    this.server_version = try reader.readZ();

    // Connection ID (4 bytes)
    this.connection_id = try reader.int(u32);

    // Auth plugin data part 1 (8 bytes)
    var auth_data = try reader.read(8);
    defer auth_data.deinit();
    @memcpy(&this.auth_plugin_data_part_1, auth_data.slice());

    // Skip filler byte
    _ = try reader.int(u8);

    // Capability flags (lower 2 bytes)
    const capabilities_lower = try reader.int(u16);

    // Character set
    this.character_set = @enumFromInt(try reader.int(u8));

    // Status flags
    this.status_flags = StatusFlags.fromInt(try reader.int(u16));

    // Capability flags (upper 2 bytes)
    const capabilities_upper = try reader.int(u16);
    this.capability_flags = Capabilities.fromInt(@as(u32, capabilities_upper) << 16 | capabilities_lower);

    // Length of auth plugin data
    var auth_plugin_data_len = try reader.int(u8);
    if (auth_plugin_data_len < 21) {
        auth_plugin_data_len = 21;
    }

    // Skip reserved bytes
    reader.skip(10);

    // Auth plugin data part 2
    const remaining_auth_len = @max(13, auth_plugin_data_len - 8);
    var auth_data_2 = try reader.read(remaining_auth_len);
    defer auth_data_2.deinit();
    this.auth_plugin_data_part_2 = try bun.default_allocator.dupe(u8, auth_data_2.slice());

    // Auth plugin name
    if (this.capability_flags.CLIENT_PLUGIN_AUTH) {
        this.auth_plugin_name = try reader.readZ();
    }
}

pub const decode = decoderWrap(HandshakeV10, decodeInternal).decode;

const Capabilities = @import("../Capabilities.zig");
const bun = @import("bun");
const CharacterSet = @import("./CharacterSet.zig").CharacterSet;
const Data = @import("../../shared/Data.zig").Data;
const StatusFlags = @import("../StatusFlags.zig").StatusFlags;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
