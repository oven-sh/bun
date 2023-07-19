const compress = @import("./compress.zig");
pub const bun = @import("./bun.zig");
const std = @import("std");

const Controller = compress.Controller;
const Completion = compress.Completion;
const Ownership = compress.Ownership;
const Error = compress.Error;

pub const CLIFileStreamCompressor = struct {
    input: std.fs.File,
    output: std.fs.File,
    closed: bool = false,

    ready_for_more: bool = false,
    has_more_output: bool = true,

    pub fn controller(this: *CLIFileStreamCompressor) Controller {
        return Controller.init(*CLIFileStreamCompressor, this);
    }

    pub fn onData(this: *CLIFileStreamCompressor, bytes: []const u8, _: Ownership, completion: Completion) void {
        std.debug.assert(!this.closed);
        this.output.writeAll(bytes) catch @panic("failed to write to file");
        if (completion == Completion.last) {
            this.ready_for_more = false;
        }
    }

    pub fn onError(this: *CLIFileStreamCompressor, err: Error) void {
        _ = err;
        std.debug.assert(!this.closed);
        // std.debug.panic("Error: {}\n{}", .{ err.code, err.message });
    }

    pub fn onPull(this: *CLIFileStreamCompressor) void {
        this.ready_for_more = true;
    }

    pub fn init(path: []const u8) !CLIFileStreamCompressor {
        var file = try std.fs.cwd().openFile(path, .{ .mode = .read_write });
        return CLIFileStreamCompressor{ .input = file, .output = std.io.getStdOut() };
    }

    pub fn run(this: *CLIFileStreamCompressor, stream: *compress.Compressor) !void {
        this.ready_for_more = true;
        const ctrl = this.controller();

        while (this.has_more_output) {
            var buffer: [64 * 1024]u8 = undefined;
            var to_read: []const u8 = buffer[0..try this.input.readAll(&buffer)];
            this.has_more_output = to_read.len != 0;
            if (this.has_more_output) {
                stream.write(to_read, ctrl);
            }
        }

        stream.end(ctrl);
    }
};

pub fn main() anyerror!void {
    const path: []const u8 = std.mem.span(std.os.argv[std.os.argv.len - 1]);
    var file_stream = try CLIFileStreamCompressor.init(path);
    var stream: *compress.Compressor = if (bun.strings.endsWith(path, ".br"))
        try compress.Compressor.init(compress.Brotli.Decoder.initWithoutOptions())
    else
        try compress.Compressor.init(compress.Brotli.Encoder.initWithoutOptions());

    try file_stream.run(stream);
}
