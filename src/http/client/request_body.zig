const bun = @import("root").bun;
const std = @import("std");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const Sendfile = @import("./sendfile.zig").Sendfile;
pub const HTTPRequestBody = union(enum) {
    bytes: []const u8,
    sendfile: Sendfile,
    stream: struct {
        buffer: bun.io.StreamBuffer,
        ended: bool,
        has_backpressure: bool = false,

        pub fn hasEnded(this: *@This()) bool {
            return this.ended and this.buffer.isEmpty();
        }
    },

    pub fn isStream(this: *const HTTPRequestBody) bool {
        return this.* == .stream;
    }

    pub fn deinit(this: *HTTPRequestBody) void {
        switch (this.*) {
            .sendfile, .bytes => {},
            .stream => |*stream| stream.buffer.deinit(),
        }
    }
    pub fn len(this: *const HTTPRequestBody) usize {
        return switch (this.*) {
            .bytes => this.bytes.len,
            .sendfile => this.sendfile.content_size,
            // unknow amounts
            .stream => std.math.maxInt(usize),
        };
    }
};
