const std = @import("std");

const path_handler = @import("../src/resolver/resolve_path.zig");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

// zig build-exe -Doptimize=ReleaseFast --main-pkg-path ../ ./readlink-getfd.zig
pub fn main() anyerror!void {
    var stdout_ = std.io.getStdOut();
    var stderr_ = std.io.getStdErr();
    var output_source = Output.Source.init(stdout_, stderr_);
    Output.Source.set(&output_source);
    defer Output.flush();

    var args_buffer: [8192 * 2]u8 = undefined;
    var fixed_buffer = std.heap.FixedBufferAllocator.init(&args_buffer);
    var allocator = fixed_buffer.allocator();

    var args = std.mem.bytesAsSlice([]u8, try std.process.argsAlloc(allocator));

    const to_resolve = args[args.len - 1];
    const cwd = try bun.getcwdAlloc(allocator);
    var path: []u8 = undefined;
    var out_buffer: bun.PathBuffer = undefined;

    var j: usize = 0;
    while (j < 1000) : (j += 1) {
        var parts = [1][]const u8{to_resolve};
        var joined_buf: bun.PathBuffer = undefined;
        var joined = path_handler.joinAbsStringBuf(
            cwd,
            &joined_buf,
            &parts,
            .loose,
        );
        joined_buf[joined.len] = 0;
        const os = std.posix;
        const joined_z: [:0]const u8 = joined_buf[0..joined.len :0];
        const O_PATH = if (@hasDecl(bun.O, "PATH")) bun.O.PATH else 0;

        var file = std.posix.openZ(joined_z, O_PATH | bun.O.CLOEXEC, 0) catch |err| {
            switch (err) {
                error.NotDir, error.FileNotFound => {
                    Output.prettyError("<r><red>404 Not Found<r>: <b>\"{s}\"<r>", .{joined_z});
                    Global.exit(1);
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
