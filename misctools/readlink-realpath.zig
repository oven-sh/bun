const std = @import("std");

const path_handler = @import("../src/resolver/resolve_path.zig");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

// zig build-exe -Drelease-fast --main-pkg-path ../ ./readlink-getfd.zig
pub fn main() anyerror!void {
    var stdout_ = std.io.getStdOut();
    var stderr_ = std.io.getStdErr();
    var output_source = Output.Source.init(stdout_, stderr_);
    Output.Source.set(&output_source);
    defer Output.flush();

    var args_buffer: [8096 * 2]u8 = undefined;
    var fixed_buffer = std.heap.FixedBufferAllocator.init(&args_buffer);
    var allocator = fixed_buffer.allocator();

    var args = std.mem.span(try std.process.argsAlloc(allocator));

    const to_resolve = args[args.len - 1];
    var out_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
    var path: []u8 = undefined;

    var j: usize = 0;
    while (j < 1000) : (j += 1) {
        path = try std.os.realpathZ(to_resolve, &out_buffer);
    }

    Output.print("{s}", .{path});
}
