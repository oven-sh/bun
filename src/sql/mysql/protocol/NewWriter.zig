pub fn NewWriterWrap(
    comptime Context: type,
    comptime offsetFn_: (fn (ctx: Context) usize),
    comptime writeFunction_: (fn (ctx: Context, bytes: []const u8) AnyMySQLError.Error!void),
    comptime pwriteFunction_: (fn (ctx: Context, bytes: []const u8, offset: usize) AnyMySQLError.Error!void),
) type {
    return struct {
        wrapped: Context,

        const writeFn = writeFunction_;
        const pwriteFn = pwriteFunction_;
        const offsetFn = offsetFn_;
        pub const Ctx = Context;

        pub const is_wrapped = true;

        pub const WrappedWriter = @This();

        pub inline fn writeLengthEncodedInt(this: @This(), data: u64) AnyMySQLError.Error!void {
            try writeFn(this.wrapped, encodeLengthInt(data).slice());
        }

        pub inline fn writeLengthEncodedString(this: @This(), data: []const u8) AnyMySQLError.Error!void {
            try this.writeLengthEncodedInt(data.len);
            try writeFn(this.wrapped, data);
        }

        pub fn write(this: @This(), data: []const u8) AnyMySQLError.Error!void {
            try writeFn(this.wrapped, data);
        }

        /// Maximum payload size for a single MySQL packet (2^24 - 1 = 16,777,215 bytes)
        pub const MAX_PACKET_PAYLOAD_SIZE: usize = 0xFFFFFF;

        const Packet = struct {
            header: PacketHeader,
            offset: usize,
            ctx: WrappedWriter,

            pub fn end(this: *@This()) AnyMySQLError.Error!void {
                const new_offset = offsetFn(this.ctx.wrapped);
                // Calculate total payload length (excluding initial header)
                const length = new_offset - this.offset - PacketHeader.size;

                if (length <= MAX_PACKET_PAYLOAD_SIZE) {
                    // Normal case: payload fits in a single packet
                    this.header.length = @intCast(length);
                    debug("writing packet header: {d}", .{this.header.length});
                    try pwrite(this.ctx, &this.header.encode(), this.offset);
                } else {
                    // Large payload: needs to be split into multiple packets
                    // MySQL protocol requires splitting payloads > 16MB into multiple packets
                    // Each packet has a 4-byte header (3 bytes length + 1 byte sequence_id)
                    try this.splitLargePacket(length);
                }
            }

            fn splitLargePacket(this: *@This(), total_length: usize) AnyMySQLError.Error!void {
                // For large packets, we need to:
                // 1. Write the first chunk header at the original offset
                // 2. Insert additional headers between subsequent chunks
                //
                // The data is already in the buffer starting at (this.offset + PacketHeader.size)
                // We need to insert (num_extra_packets) additional headers
                const payload_start = this.offset + PacketHeader.size;
                const sequence_id = this.header.sequence_id;

                // Calculate how many additional packets we need
                const num_packets = (total_length + MAX_PACKET_PAYLOAD_SIZE - 1) / MAX_PACKET_PAYLOAD_SIZE;
                const num_extra_headers = num_packets - 1;

                debug("splitting large packet: total_length={d}, num_packets={d}", .{ total_length, num_packets });

                if (num_extra_headers > 0) {
                    // We need to expand the buffer to make room for additional headers
                    // Each extra header is 4 bytes
                    const extra_space = num_extra_headers * PacketHeader.size;
                    var padding: [PacketHeader.size]u8 = undefined;
                    for (0..num_extra_headers) |_| {
                        try writeFn(this.ctx.wrapped, &padding);
                    }

                    // Now we need to shift the data to make room for the headers
                    // We'll do this by reading the current buffer content and rewriting it
                    // with headers inserted at the right places
                    //
                    // Strategy: Work backwards from the end to avoid overwriting data we still need
                    var src_offset = payload_start + total_length; // End of original payload
                    var dst_offset = payload_start + total_length + extra_space; // End of expanded buffer

                    // Calculate chunk sizes for each packet
                    // First (num_packets - 1) packets are MAX_PACKET_PAYLOAD_SIZE
                    // Last packet is the remainder
                    const last_chunk_size = total_length - (num_packets - 1) * MAX_PACKET_PAYLOAD_SIZE;

                    // Process packets from last to first (reverse order to avoid overwriting)
                    var packet_idx = num_packets;
                    while (packet_idx > 0) {
                        packet_idx -= 1;

                        // Calculate chunk size: last packet gets the remainder, others get MAX
                        const chunk_size = if (packet_idx == num_packets - 1)
                            last_chunk_size
                        else
                            MAX_PACKET_PAYLOAD_SIZE;

                        // Move this chunk's data to its new position
                        src_offset -= chunk_size;
                        dst_offset -= chunk_size;

                        if (dst_offset != src_offset) {
                            // Use memmove-style copy (copy via temp buffer to handle overlap)
                            // Since we're working backwards, dst > src, so no overlap issues
                            try this.copyWithinBuffer(src_offset, dst_offset, chunk_size);
                        }

                        // Write header for this packet (skip first packet, handled below)
                        if (packet_idx > 0) {
                            dst_offset -= PacketHeader.size;
                            const header = PacketHeader{
                                .length = @intCast(chunk_size),
                                .sequence_id = sequence_id +% @as(u8, @intCast(packet_idx)),
                            };
                            try pwrite(this.ctx, &header.encode(), dst_offset);
                        }
                    }
                }

                // Write the first packet header at the original position
                // First packet always has MAX_PACKET_PAYLOAD_SIZE bytes (when total > MAX)
                const first_chunk_size: u24 = if (total_length > MAX_PACKET_PAYLOAD_SIZE)
                    MAX_PACKET_PAYLOAD_SIZE
                else
                    @intCast(total_length);
                this.header.length = first_chunk_size;
                debug("writing first packet header: {d}", .{this.header.length});
                try pwrite(this.ctx, &this.header.encode(), this.offset);
            }

            fn copyWithinBuffer(this: *@This(), src_offset: usize, dst_offset: usize, len: usize) AnyMySQLError.Error!void {
                // Copy data within the buffer from src_offset to dst_offset
                // We need to be careful about overlapping regions
                if (src_offset == dst_offset or len == 0) return;

                // Get access to the underlying buffer for copying
                // Use the slice function if available on the context
                if (@hasDecl(Context, "slice")) {
                    const buf = this.ctx.wrapped.slice();
                    // Use memmove-style copy for overlapping regions
                    if (dst_offset > src_offset) {
                        // Copy backwards to handle overlap (dst is after src)
                        std.mem.copyBackwards(u8, buf[dst_offset..][0..len], buf[src_offset..][0..len]);
                    } else {
                        // Copy forwards
                        std.mem.copyForwards(u8, buf[dst_offset..][0..len], buf[src_offset..][0..len]);
                    }
                } else {
                    // Fallback: cannot copy without direct buffer access
                    // This should not happen since Writer has slice()
                    return error.Overflow;
                }
            }
        };

        pub fn start(this: @This(), sequence_id: u8) AnyMySQLError.Error!Packet {
            const o = offsetFn(this.wrapped);
            debug("starting packet: {d}", .{o});
            try this.write(&[_]u8{0} ** PacketHeader.size);
            return .{
                .header = .{ .sequence_id = sequence_id, .length = 0 },
                .offset = o,
                .ctx = this,
            };
        }

        pub fn offset(this: @This()) usize {
            return offsetFn(this.wrapped);
        }

        pub fn pwrite(this: @This(), data: []const u8, i: usize) AnyMySQLError.Error!void {
            try pwriteFn(this.wrapped, data, i);
        }

        pub fn int4(this: @This(), value: MySQLInt32) AnyMySQLError.Error!void {
            try this.write(&std.mem.toBytes(value));
        }

        pub fn int8(this: @This(), value: MySQLInt64) AnyMySQLError.Error!void {
            try this.write(&std.mem.toBytes(value));
        }

        pub fn int1(this: @This(), value: u8) AnyMySQLError.Error!void {
            try this.write(&[_]u8{value});
        }

        pub fn writeZ(this: @This(), value: []const u8) AnyMySQLError.Error!void {
            try this.write(value);
            if (value.len == 0 or value[value.len - 1] != 0)
                try this.write(&[_]u8{0});
        }

        pub fn String(this: @This(), value: bun.String) AnyMySQLError.Error!void {
            if (value.isEmpty()) {
                try this.write(&[_]u8{0});
                return;
            }

            var sliced = value.toUTF8(bun.default_allocator);
            defer sliced.deinit();
            const slice = sliced.slice();

            try this.write(slice);
            if (slice.len == 0 or slice[slice.len - 1] != 0)
                try this.write(&[_]u8{0});
        }
    };
}

pub fn NewWriter(comptime Context: type) type {
    if (@hasDecl(Context, "is_wrapped")) {
        return Context;
    }

    return NewWriterWrap(Context, Context.offset, Context.write, Context.pwrite);
}

pub fn writeWrap(comptime Container: type, comptime writeFn: anytype) type {
    return struct {
        pub fn write(this: *Container, context: anytype) AnyMySQLError.Error!void {
            const Context = @TypeOf(context);
            if (@hasDecl(Context, "is_wrapped")) {
                try writeFn(this, Context, context);
            } else {
                try writeFn(this, Context, .{ .wrapped = context });
            }
        }
    };
}

const debug = bun.Output.scoped(.NewWriter, .hidden);

const AnyMySQLError = @import("./AnyMySQLError.zig");
const PacketHeader = @import("./PacketHeader.zig");
const bun = @import("bun");
const std = @import("std");
const encodeLengthInt = @import("./EncodeInt.zig").encodeLengthInt;

const types = @import("../MySQLTypes.zig");
const MySQLInt32 = types.MySQLInt32;
const MySQLInt64 = types.MySQLInt64;
