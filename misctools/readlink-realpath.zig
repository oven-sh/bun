const std = @import("std");

const path_handler = @import("../src/resolver/resolve_path.zig");
const _global = @import("../src/global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;

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
    var out_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var path: []u8 = undefined;

    var j: usize = 0;
    while (j < 1000) : (j += 1) {
        path = try std.os.realpathZ(to_resolve, &out_buffer);
    }

    Output.print("{s}", .{path});
}
