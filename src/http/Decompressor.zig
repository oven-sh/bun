pub const Decompressor = union(enum) {
    zlib: *Zlib.ZlibReaderArrayList,
    brotli: *Brotli.BrotliReaderArrayList,
    zstd: *zstd.ZstdReaderArrayList,
    none: void,

    pub fn deinit(this: *Decompressor) void {
        switch (this.*) {
            inline .brotli, .zlib, .zstd => |that| {
                that.deinit();
                this.* = .{ .none = {} };
            },
            .none => {},
        }
    }

    pub fn updateBuffers(this: *Decompressor, encoding: Encoding, buffer: []const u8, body_out_str: *MutableString) !void {
        if (!encoding.isCompressed()) {
            return;
        }

        if (this.* == .none) {
            switch (encoding) {
                .gzip, .deflate => {
                    const reader = try Zlib.ZlibReaderArrayList.initWithOptionsAndListAllocator(
                        buffer,
                        &body_out_str.list,
                        body_out_str.allocator,
                        bun.http.default_allocator,
                        .{
                            // gzip: MAX_WBITS | 16. zlib-wrapped deflate: 0 (inflate
                            // reads the window from the header). Raw deflate: -MAX_WBITS.
                            .windowBits = if (encoding == Encoding.gzip)
                                Zlib.MAX_WBITS | 16
                            else if (hasZlibHeader(buffer))
                                0
                            else
                                -Zlib.MAX_WBITS,
                        },
                    );
                    this.* = .{ .zlib = reader };
                    return;
                },
                .brotli => {
                    const reader = try Brotli.BrotliReaderArrayList.newWithOptions(
                        buffer,
                        &body_out_str.list,
                        body_out_str.allocator,
                        .{},
                    );
                    this.* = .{ .brotli = reader };
                    return;
                },
                .zstd => {
                    const reader = try zstd.ZstdReaderArrayList.initWithListAllocator(
                        buffer,
                        &body_out_str.list,
                        body_out_str.allocator,
                        bun.http.default_allocator,
                    );
                    this.* = .{ .zstd = reader };
                    return;
                },
                else => @panic("Invalid encoding. This code should not be reachable"),
            }
        }

        switch (this.*) {
            .zlib => |reader| {
                bun.assert(reader.zlib.avail_in == 0);
                reader.zlib.next_in = buffer.ptr;
                reader.zlib.avail_in = @as(u32, @truncate(buffer.len));

                const initial = body_out_str.list.items.len;
                body_out_str.list.expandToCapacity();
                if (body_out_str.list.capacity == initial) {
                    try body_out_str.list.ensureUnusedCapacity(body_out_str.allocator, 4096);
                    body_out_str.list.expandToCapacity();
                }
                reader.list = body_out_str.list;
                reader.zlib.next_out = @ptrCast(&body_out_str.list.items[initial]);
                reader.zlib.avail_out = @as(u32, @truncate(body_out_str.list.capacity - initial));
                // we reset the total out so we can track how much we decompressed this time
                reader.zlib.total_out = @truncate(initial);
            },
            .brotli => |reader| {
                reader.input = buffer;
                reader.total_in = 0;

                const initial = body_out_str.list.items.len;
                reader.list = body_out_str.list;
                reader.total_out = @truncate(initial);
            },
            .zstd => |reader| {
                reader.input = buffer;
                reader.total_in = 0;

                const initial = body_out_str.list.items.len;
                reader.list = body_out_str.list;
                reader.total_out = @truncate(initial);
            },
            else => @panic("Invalid encoding. This code should not be reachable"),
        }
    }

    pub fn readAll(this: *Decompressor, is_done: bool) !void {
        switch (this.*) {
            .zlib => |zlib| try zlib.readAll(is_done),
            .brotli => |brotli| try brotli.readAll(is_done),
            .zstd => |reader| try reader.readAll(is_done),
            .none => {},
        }
    }
};

/// Whether `buffer` starts with an RFC1950 zlib header (zlib-wrapped deflate),
/// as opposed to raw deflate. A valid header is CMF/FLG where CMF has CM=8 in
/// the low nibble and CINFO 0..=7 in the high nibble, and (CMF << 8 | FLG) is a
/// multiple of 31 — covering every window from 256 B to 32 KiB.
fn hasZlibHeader(buffer: []const u8) bool {
    return buffer.len >= 2 and
        (buffer[0] & 0x0f) == 8 and
        (buffer[0] >> 4) <= 7 and
        ((@as(u16, buffer[0]) << 8) | @as(u16, buffer[1])) % 31 == 0;
}

const Zlib = @import("../zlib/zlib.zig");
const Encoding = @import("../http_types/Encoding.zig").Encoding;

const bun = @import("bun");
const Brotli = bun.brotli;
const MutableString = bun.MutableString;
const zstd = bun.zstd;
