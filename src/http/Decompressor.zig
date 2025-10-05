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
                    this.* = .{
                        .zlib = try Zlib.ZlibReaderArrayList.initWithOptionsAndListAllocator(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            bun.http.default_allocator,
                            .{
                                // zlib.MAX_WBITS = 15
                                // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                                // to (de-)compress deflate format with headers we use wbits = 0 (we can detect the first byte using 120)
                                // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                                .windowBits = if (encoding == Encoding.gzip) Zlib.MAX_WBITS | 16 else (if (buffer.len > 1 and buffer[0] == 120) 0 else -Zlib.MAX_WBITS),
                            },
                        ),
                    };
                    return;
                },
                .brotli => {
                    this.* = .{
                        .brotli = try Brotli.BrotliReaderArrayList.newWithOptions(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            .{},
                        ),
                    };
                    return;
                },
                .zstd => {
                    this.* = .{
                        .zstd = try zstd.ZstdReaderArrayList.initWithListAllocator(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            bun.http.default_allocator,
                        ),
                    };
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

const Zlib = @import("../zlib.zig");
const Encoding = @import("./Encoding.zig").Encoding;

const bun = @import("bun");
const Brotli = bun.brotli;
const MutableString = bun.MutableString;
const zstd = bun.zstd;
