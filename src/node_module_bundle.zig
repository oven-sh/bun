const Api = @import("./api/schema.zig").Api;
const std = @import("std");
usingnamespace @import("global.zig");

pub const NodeModuleBundle = struct {
    container: *Api.JavascriptBundleContainer,
    bundle: *Api.JavascriptBundle,
    allocator: *std.mem.Allocator,
    fd: FileDescriptorType = 0,

    pub const magic_bytes = "#!/usr/bin/env speedy\n\n";
    threadlocal var jsbundle_prefix: [magic_bytes.len + 5]u8 = undefined;

    pub fn getCodeEndPosition(stream: anytype, comptime needs_seek: bool) !u32 {
        if (needs_seek) try stream.seekTo(0);

        const read_bytes = try stream.read(&jsbundle_prefix);
        if (read_bytes != jsbundle_prefix.len) {
            return error.JSBundleBadHeaderTooShort;
        }

        return std.mem.readIntNative(u32, jsbundle_prefix[magic_bytes.len .. magic_bytes.len + 4]);
    }

    pub fn loadBundle(allocator: *std.mem.Allocator, stream: anytype) !NodeModuleBundle {
        const end = try getCodeEndPosition(stream);
        try stream.seekTo(end + 1);
        var reader = stream.reader();
        var container = try Api.JavascriptBundleContainer.decode(allocator, reader);
        return NodeModuleBundle{
            .allocator = allocator,
            .container = container,
            .bundle = container.bundle,
            .fd = if (std.meta.trait.hasField("handle")(stream)) stream.handle else 0,
        };
    }

    pub fn printBundle(
        comptime StreamType: type,
        input: StreamType,
        comptime DestinationStreamType: type,
        output: DestinationStreamType,
    ) !void {
        const BufferStreamContext = struct {
            pub fn run(in: StreamType, out: DestinationStreamType, end_at: u32) !void {
                var buf: [4096]u8 = undefined;
                var remain = @intCast(i64, end_at);
                var read_amount: i64 = @intCast(i64, in.read(&buf) catch 0);
                while (remain > 0 and read_amount > 0) {
                    remain -= @intCast(i64, try out.write(buf[0..@intCast(usize, std.math.min(read_amount, remain))]));
                    read_amount = @intCast(i64, in.read(&buf) catch 0);
                }

                _ = try out.write(buf[0..@intCast(usize, remain + 1)]);
            }
        };
        if (isMac) {
            // darwin only allows reading ahead on/off, not specific amount
            _ = std.os.fcntl(input.handle, std.os.F_RDAHEAD, 1) catch 0;
        }
        const end = try getCodeEndPosition(input, false);

        try BufferStreamContext.run(
            input,
            output,
            end,
        );
    }
};
