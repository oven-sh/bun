const std = @import("std");

const path_handler = @import("../src/resolver/resolve_path.zig");
const bun = @import("bun");
const string = []const u8;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = [:0]const u8;
const default_allocator = bun.default_allocator;

const Archive = @import("../src/libarchive/libarchive.zig").Archive;
const Zlib = @import("../src/zlib.zig");

const RecognizedExtensions = std.ComptimeStringMap(void, .{
    .{ ".tgz", void{} },
    .{ ".tar", void{} },
    .{ ".gz", void{} },
});

var buf: [32 * 1024 * 1024]u8 = undefined;

// zig build-exe -Doptimize=ReleaseFast --main-pkg-path ../ ./tgz.zig ../src/deps/zlib/libz.a ../src/deps/libarchive.a -lc -liconv
// zig build-exe -Doptimize=ReleaseFast --main-pkg-path ../ ./tgz.zig ../src/deps/zlib/libz.a ../src/deps/libarchive.a -lc -liconv
pub fn main() anyerror!void {
    var stdout_ = std.io.getStdOut();
    var stderr_ = std.io.getStdErr();
    var output_source = Output.Source.init(stdout_, stderr_);
    Output.Source.set(&output_source);
    defer Output.flush();
    var args = try std.process.argsAlloc(std.heap.c_allocator);
    if (args.len < 2) {
        Output.prettyErrorln("<r><b>usage<r>: tgz ./tar.gz", .{});
        Global.exit(1);
    }

    var tarball_path_buf: bun.PathBuffer = undefined;
    var basename = std.fs.path.basename(bun.asByteSlice(args[args.len - 1]));
    while (RecognizedExtensions.has(std.fs.path.extension(basename))) {
        basename = basename[0 .. basename.len - std.fs.path.extension(basename).len];
    }

    var parts = [_][]const u8{
        bun.asByteSlice(args[args.len - 1]),
    };

    const tarball_path = path_handler.joinAbsStringBuf(try bun.getcwdAlloc(std.heap.c_allocator), &tarball_path_buf, &parts, .auto);
    Output.prettyErrorln("Tarball Path: {s}", .{tarball_path});
    var folder = basename;

    // var dir = try std.fs.cwd().makeOpenPath(folder, .{ .iterate = true });

    var tarball = try std.fs.cwd().openFile(tarball_path, .{ .mode = .read_only });

    var tarball_buf_list = std.ArrayListUnmanaged(u8){};

    var file_size = try tarball.getEndPos();
    var file_buf: []u8 = undefined;
    var file_buf_cap: usize = 0;

    if (file_size < buf.len) {
        file_buf = buf[0..try tarball.readAll(&buf)];
        file_buf_cap = buf.len;
    } else {
        file_buf = try tarball.readToEndAlloc(
            std.heap.c_allocator,
            file_size,
        );
        file_buf_cap = file_buf.len;
    }

    if (std.mem.eql(u8, std.fs.path.extension(tarball_path), ".gz") or std.mem.eql(u8, std.fs.path.extension(tarball_path), ".tgz")) {
        tarball_buf_list = try std.ArrayListUnmanaged(u8).initCapacity(std.heap.c_allocator, 1024);
        var gunzip = try Zlib.ZlibReaderArrayList.init(file_buf, &tarball_buf_list, std.heap.c_allocator);
        try gunzip.readAll();
        gunzip.deinit();
        Output.prettyErrorln("Decompressed {d} -> {d}\n", .{ file_buf.len, tarball_buf_list.items.len });
    } else {
        tarball_buf_list = std.ArrayListUnmanaged(u8){ .capacity = file_buf.len, .items = file_buf };
    }

    _ = try Archive.extractToDisk(
        file_buf,
        folder,
        null,
        void,
        void{},
        .{
            .depth_to_skip = 1,
            .close_handles = false,
        },
    );
}
