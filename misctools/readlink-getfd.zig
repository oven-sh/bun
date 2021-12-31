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
    var allocator = &fixed_buffer.allocator;

    var args = std.mem.span(try std.process.argsAlloc(allocator));

    const to_resolve = args[args.len - 1];
    const cwd = try std.process.getCwdAlloc(allocator);
    var path: []u8 = undefined;
    var out_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    var j: usize = 0;
    while (j < 100000) : (j += 1) {
        var parts = [1][]const u8{std.mem.span(to_resolve)};
        var joined_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var joined = path_handler.joinAbsStringBuf(
            cwd,
            &joined_buf,
            &parts,
            .loose,
        );
        joined_buf[joined.len] = 0;
        const joined_z: [:0]const u8 = joined_buf[0..joined.len :0];

        var file = std.fs.openFileAbsoluteZ(joined_z, .{ .read = false }) catch |err| {
            switch (err) {
                error.NotDir, error.FileNotFound => {
                    Output.prettyError("<r><red>404 Not Found<r>: <b>\"{s}\"<r>", .{joined_z});
                    Output.flush();
                    std.process.exit(1);
                },
                else => {
                    return err;
                },
            }
        };

        path = try std.os.getFdPath(file.handle, &out_buffer);
        file.close();
    }

    Output.print("{s}", .{path});
}
