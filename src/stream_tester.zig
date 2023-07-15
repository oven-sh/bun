const compress = @import("./compress.zig");
pub const bun = @import("./bun.zig");
const std = @import("std");

pub fn main() anyerror!void {
    const path: []const u8 = std.mem.span(std.os.argv[std.os.argv.len - 1]);
    var file_stream = try compress.CLIFileStreamCompressor.init(path);
    var stream: *compress.Compressor = if (bun.strings.endsWith(path, ".br"))
        try compress.Compressor.init(compress.Brotli.Decoder.initWithoutOptions())
    else
        try compress.Compressor.init(compress.Brotli.Encoder.initWithoutOptions());

    try file_stream.run(stream);
}
