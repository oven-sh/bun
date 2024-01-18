//! Windows '.bunx' files follow this format:
//!
//! [WSTR:bin path][u16'"'][WSTR:shebang][u32:bin_length][flags:u8]
//!
const std = @import("std");

/// Relative to node_modules. Do not include slash
bin_path: []const u16,
/// Information found within the target file's shebang
shebang: ?Shebang,

const Flags = packed struct(u16) {
    is_node_or_bun: bool,
    has_shebang: bool,

    unused: u14 = 0,
};

const Shebang = struct {
    program: []const u8,
    args: []const u8,
    is_bun: bool,
    program_utf16_len: u32,
    args_utf16_len: u32,

    const BunExtensions = std.ComptimeStringMap(void, .{
        .{ ".js", {} },
        .{ ".mjs", {} },
        .{ ".cjs", {} },
        .{ ".jsx", {} },
        .{ ".ts", {} },
        .{ ".cts", {} },
        .{ ".mts", {} },
        .{ ".tsx", {} },
        .{ ".sh", {} },
    });

    pub fn parseFromBinPath(bin_path: []const u16) ?Shebang {
        _ = bin_path;

        // if (BunExtensions.has(std.fs.path.extension(bin_path))) {
        //     return .{
        //         .program = "bun",
        //         .args = null,
        //         .is_bun = true,
        //     };
        // }
        return null;
    }

    /// `32766` is taken from `CreateProcessW` docs. One less to account for the null terminator
    /// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw#parameters
    pub const max_shebang_input_length = (32766) + "#!".len;

    /// Given the start of a file, parse the shebang
    /// Output contains slices that point into the input buffer
    ///
    /// Since a command line cannot be longer than 32766 characters,
    /// this function does not accept inputs longer than `max_shebang_input_length`
    pub fn parse(contents: []const u8, bin_path: []const u16) !?Shebang {
        if (contents.len < 2) {
            return parseFromBinPath(bin_path);
        }

        if (contents[0] != '#' or contents[1] != '!') {
            return parseFromBinPath(bin_path);
        }

        const program, const args = first: {
            var i: usize = 2;
            while (i < contents.len) : (i += 1) {
                if (contents[i] == ' ') {
                    const eol = if (std.mem.indexOfScalar(u8, contents[i + 1 ..], '\n')) |eol|
                        eol + i + 1
                    else
                        contents.len;

                    break :first .{ contents[2..i], contents[i + 1 .. eol] };
                }

                // program only
                if (contents[i] == '\n') {
                    break;
                }

                // if we fall out of ascii range + some other symbols,
                // let's stop early because we are probably hitting binary data
                if (contents[i] < 32 or contents[i] > 126) {
                    return parseFromBinPath(bin_path);
                }

                // give up at potentially corrupt/invalid shebang
                // this is also done because the shim does not allocate too much space
                if (i > 512) {
                    return parseFromBinPath(bin_path);
                }
            }

            // if there are no spaces but only a newline, it is just the program
            return .{
                .program = contents[2..i],
                .args = "",
                .program_utf16_len = @intCast(std.unicode.calcUtf16LeLen(contents[2..i]) catch return error.InvalidUtf8),
                .args_utf16_len = 0,
                .is_bun = false,
            };
        };

        if (std.mem.eql(u8, program, "/usr/bin/env")) {
            if (std.mem.indexOfScalar(u8, args, ' ')) |space| {
                return .{
                    .program = args[0..space],
                    .args = args[space + 1 ..],
                    .program_utf16_len = @intCast(std.unicode.calcUtf16LeLen(args[0..space]) catch return error.InvalidUtf8),
                    .args_utf16_len = @intCast(std.unicode.calcUtf16LeLen(args[space + 1 ..]) catch return error.InvalidUtf8),
                    .is_bun = std.mem.eql(u8, program, "bun") or std.mem.eql(u8, program, "node"),
                };
            }
        }

        return .{
            .program = program,
            .args = args,
            .program_utf16_len = @intCast(std.unicode.calcUtf16LeLen(program) catch return error.InvalidUtf8),
            .args_utf16_len = @intCast(std.unicode.calcUtf16LeLen(args) catch return error.InvalidUtf8),
            .is_bun = false,
        };
    }

    pub fn encodedLength(shebang: Shebang) usize {
        return (shebang.program_utf16_len + shebang.args_utf16_len) + @sizeOf(u32) * 4;
    }
};

pub fn encodedLength(options: @This()) usize {
    return ((options.bin_path.len + "\" ".len) * @sizeOf(u16)) +
        @sizeOf(Flags) +
        if (options.shebang) |s| s.encodedLength() else 0;
}

/// The buffer must be exactly the correct length given by encodedLength
pub fn encodeInto(options: @This(), buf: []u8) !void {
    std.debug.assert(buf.len == options.encodedLength());
    std.debug.assert(options.bin_path[0] != '/');

    const wbuf = @as([*]u16, @alignCast(@ptrCast(&buf[0])))[0 .. buf.len / 2];

    @memcpy(wbuf[0..options.bin_path.len], options.bin_path);

    wbuf[options.bin_path.len] = '"';
    wbuf[options.bin_path.len + 1] = ' ';

    const is_node_or_bun = if (options.shebang) |s| s.is_bun else false;

    const flags = Flags{
        .has_shebang = !is_node_or_bun and options.shebang != null,
        .is_node_or_bun = true,
    };

    if (options.shebang) |s| {
        const s1 = std.unicode.utf8ToUtf16Le(
            wbuf[options.bin_path.len + 2 ..][0..s.args_utf16_len],
            s.args,
        ) catch return error.InvalidUtf8;
        std.debug.assert(s1 == s.args_utf16_len);
        const s2 = std.unicode.utf8ToUtf16Le(
            wbuf[options.bin_path.len + 2 + s.args_utf16_len ..][0..s.program_utf16_len],
            s.program,
        ) catch return error.InvalidUtf8;
        std.debug.assert(s2 == s.program_utf16_len);
        @as(*align(1) u32, @ptrCast(&wbuf[options.bin_path.len + 2 + s.args_utf16_len + s.program_utf16_len])).* = s.args_utf16_len;
        @as(*align(1) u32, @ptrCast(&wbuf[options.bin_path.len + 2 + s.args_utf16_len + s.program_utf16_len + 2])).* = s.program_utf16_len;
    } else {
        @as(*Flags, @ptrCast(&wbuf[options.bin_path.len + 2])).* = flags;
    }
}

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
        null;

    const opts = @This(){
        .bin_path = bin_path,
        .shebang = shebang,
    };

    std.log.info("bin_path: {s}", .{std.unicode.fmtUtf16le(bin_path)});
    std.log.info("shebang: {?}", .{shebang});

    const alloc = try std.heap.page_allocator.alloc(u8, encodedLength(opts));
    try opts.encodeInto(alloc);
    {
        const file = try std.fs.cwd().createFile("shim_impl.bunx", .{});
        defer file.close();

        try file.writeAll(alloc);
    }

    std.log.info("ok", .{});
    return 0;
}
