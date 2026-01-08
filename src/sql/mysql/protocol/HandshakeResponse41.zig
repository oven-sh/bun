// Client authentication response
const HandshakeResponse41 = @This();
capability_flags: Capabilities,
max_packet_size: u32 = 0xFFFFFF, // 16MB default
character_set: CharacterSet = CharacterSet.default,
username: Data,
auth_response: Data,
database: Data,
auth_plugin_name: Data,
connect_attrs: bun.StringHashMapUnmanaged([]const u8) = .{},
sequence_id: u8,

pub fn deinit(this: *HandshakeResponse41) void {
    this.username.deinit();
    this.auth_response.deinit();
    this.database.deinit();
    this.auth_plugin_name.deinit();

    var it = this.connect_attrs.iterator();
    while (it.next()) |entry| {
        bun.default_allocator.free(entry.key_ptr.*);
        bun.default_allocator.free(entry.value_ptr.*);
    }
    this.connect_attrs.deinit(bun.default_allocator);
}

pub fn writeInternal(this: *HandshakeResponse41, comptime Context: type, writer: NewWriter(Context)) !void {
    var packet = try writer.start(this.sequence_id);

    this.capability_flags.CLIENT_CONNECT_ATTRS = this.connect_attrs.count() > 0;

    // Write client capabilities flags (4 bytes)
    const caps = this.capability_flags.toInt();
    try writer.int4(caps);
    debug("Client capabilities: [{f}] 0x{x:0>8} sequence_id: {d}", .{ this.capability_flags, caps, this.sequence_id });

    // Write max packet size (4 bytes)
    try writer.int4(this.max_packet_size);

    // Write character set (1 byte)
    try writer.int1(@intFromEnum(this.character_set));

    // Write 23 bytes of padding
    try writer.write(&[_]u8{0} ** 23);

    // Write username (null terminated)
    try writer.writeZ(this.username.slice());

    // Write auth response based on capabilities
    const auth_data = this.auth_response.slice();
    if (this.capability_flags.CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA) {
        try writer.writeLengthEncodedString(auth_data);
    } else if (this.capability_flags.CLIENT_SECURE_CONNECTION) {
        try writer.int1(@intCast(auth_data.len));
        try writer.write(auth_data);
    } else {
        try writer.writeZ(auth_data);
    }

    // Write database name if requested
    if (this.capability_flags.CLIENT_CONNECT_WITH_DB and this.database.slice().len > 0) {
        try writer.writeZ(this.database.slice());
    }

    // Write auth plugin name if supported
    if (this.capability_flags.CLIENT_PLUGIN_AUTH) {
        try writer.writeZ(this.auth_plugin_name.slice());
    }

    // Write connect attributes if enabled
    if (this.capability_flags.CLIENT_CONNECT_ATTRS) {
        var total_length: usize = 0;
        var it = this.connect_attrs.iterator();
        while (it.next()) |entry| {
            total_length += encodeLengthInt(entry.key_ptr.len).len;
            total_length += entry.key_ptr.len;
            total_length += encodeLengthInt(entry.value_ptr.len).len;
            total_length += entry.value_ptr.len;
        }

        try writer.writeLengthEncodedInt(total_length);

        it = this.connect_attrs.iterator();
        while (it.next()) |entry| {
            try writer.writeLengthEncodedString(entry.key_ptr.*);
            try writer.writeLengthEncodedString(entry.value_ptr.*);
        }
    }

    if (this.capability_flags.CLIENT_ZSTD_COMPRESSION_ALGORITHM) {
        // try writer.writeInt(u8, this.zstd_compression_algorithm);
        bun.assertf(false, "zstd compression algorithm is not supported", .{});
    }

    try packet.end();
}

pub const write = writeWrap(HandshakeResponse41, writeInternal).write;

const debug = bun.Output.scoped(.MySQLConnection, .hidden);

const Capabilities = @import("../Capabilities.zig");
const bun = @import("bun");
const CharacterSet = @import("./CharacterSet.zig").CharacterSet;
const Data = @import("../../shared/Data.zig").Data;
const encodeLengthInt = @import("./EncodeInt.zig").encodeLengthInt;

const NewWriter = @import("./NewWriter.zig").NewWriter;
const writeWrap = @import("./NewWriter.zig").writeWrap;
