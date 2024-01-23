const std = @import("std");

const Shebang = @import("./BinLinkingShim.zig");

pub fn main() !u8 {
    const argv = try std.process.argsAlloc(std.heap.page_allocator);
    defer std.heap.page_allocator.free(argv);

    if (argv.len == 1) {
        std.log.info("usage: <relative bin path> [shebang to parse]", .{});
        return 1;
    }

    const buf = try std.heap.page_allocator.alloc(u16, 2048);
    defer std.heap.page_allocator.free(buf);

    const bin_path_l = try std.unicode.utf8ToUtf16Le(buf, argv[1]);
    const bin_path = buf[0..bin_path_l];
    const shebang = if (argv.len > 2)
        try Shebang.parse(argv[2], bin_path)
    else
        Shebang.parseFromBinPath(bin_path);

    const opts = @This(){
        .bin_path = bin_path,
        .shebang = shebang,
    };

    std.log.info("bin_path: {s}", .{std.unicode.fmtUtf16le(bin_path)});
    if (shebang) |s| {
        std.log.info("shebang: '{s}'", .{s.launcher});
        std.log.info("shebang.is_bun: '{}'", .{s.is_bun});
        std.log.info("shebang.args_utf16_len: '{d}'", .{s.utf16_len});
    }

    const alloc = try std.heap.page_allocator.alloc(u8, shim.encodedLength(opts));

    std.log.info("allocation is {d} bytes", .{alloc.len});

    try opts.encodeInto(alloc);
    {
        const file = try std.fs.cwd().createFile("bun_shim_impl.bunx", .{});
        defer file.close();

        try file.writeAll(alloc);
    }

    std.log.info("ok", .{});
    return 0;
}
