pub const HTTPRequestBody = union(enum) {
    bytes: []const u8,
    sendfile: SendFile,
    stream: struct {
        buffer: ?*ThreadSafeStreamBuffer,
        ended: bool,

        pub fn detach(this: *@This()) void {
            if (this.buffer) |buffer| {
                this.buffer = null;
                buffer.deref();
            }
        }
    },

    pub fn isStream(this: *const HTTPRequestBody) bool {
        return this.* == .stream;
    }

    pub fn deinit(this: *HTTPRequestBody) void {
        switch (this.*) {
            .sendfile, .bytes => {},
            .stream => |*stream| stream.detach(),
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

const SendFile = @import("./SendFile.zig");
const ThreadSafeStreamBuffer = @import("./ThreadSafeStreamBuffer.zig");
const std = @import("std");
