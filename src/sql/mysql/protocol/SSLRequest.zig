// https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
// SSLRequest
const SSLRequest = @This();
capability_flags: Capabilities,
max_packet_size: u32 = 0xFFFFFF, // 16MB default
character_set: CharacterSet = CharacterSet.default,
connect_attrs: bun.StringHashMapUnmanaged([]const u8) = .{},

pub fn deinit(this: *SSLRequest) void {
    var it = this.connect_attrs.iterator();
    while (it.next()) |entry| {
        bun.default_allocator.free(entry.key_ptr.*);
        bun.default_allocator.free(entry.value_ptr.*);
    }
    this.connect_attrs.deinit(bun.default_allocator);
}

pub fn writeInternal(this: *SSLRequest, comptime Context: type, writer: NewWriter(Context)) !void {
    var packet = try writer.start(1);

    this.capability_flags.CLIENT_CONNECT_ATTRS = this.connect_attrs.count() > 0;

    // Write client capabilities flags (4 bytes)
    const caps = this.capability_flags.toInt();
    try writer.int4(caps);
    debug("Client capabilities: [{}] 0x{x:0>8}", .{ this.capability_flags, caps });

    // Write max packet size (4 bytes)
    try writer.int4(this.max_packet_size);

    // Write character set (1 byte)
    try writer.int1(@intFromEnum(this.character_set));

    // Write 23 bytes of padding
    try writer.write(&[_]u8{0} ** 23);

    try packet.end();
}

pub const write = writeWrap(SSLRequest, writeInternal).write;

const debug = bun.Output.scoped(.MySQLConnection, .hidden);

const Capabilities = @import("../Capabilities.zig");
const bun = @import("bun");
const CharacterSet = @import("./CharacterSet.zig").CharacterSet;

const NewWriter = @import("./NewWriter.zig").NewWriter;
const writeWrap = @import("./NewWriter.zig").writeWrap;
