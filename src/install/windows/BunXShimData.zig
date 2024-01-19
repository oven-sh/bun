//! Windows '.bunx' files follow this format:
//!
//! [WSTR:bin path][u16'"'][u16' '](shebang?)[flags:u8]
//!
//! if shebang:
//! [WSTR:shebang][u32:program_part_b_len][u32:arg_part_b_len]
//!
const std = @import("std");

const root = @import("root");

const indexOfScalar = std.mem.indexOfScalar;
const lastIndexOfScalar = std.mem.lastIndexOfScalar;
const calcUtf16LeLen = std.unicode.calcUtf16LeLen;
const utf8ToUtf16Le = std.unicode.utf8ToUtf16Le;

/// Relative to node_modules. Do not include slash
bin_path: []const u16,
/// Information found within the target file's shebang
shebang: ?Shebang,

const Flags = packed struct(u16) {
    is_node_or_bun: bool,
    has_shebang: bool,

    unused: u14 = 0,
};

fn wU8(comptime s: []const u8) []const u8 {
    const str = std.unicode.utf8ToUtf16LeStringLiteral(s);
    return @alignCast(std.mem.sliceAsBytes(str));
}

const Shebang = struct {
    program: []const u8,
    args: []const u8,
    is_bun: bool,
    program_utf16_len: u32,
    args_utf16_len: u32,

    const BunExtensions = std.ComptimeStringMap(void, .{
        .{ wU8(".js"), {} },
        .{ wU8(".mjs"), {} },
        .{ wU8(".cjs"), {} },
        .{ wU8(".jsx"), {} },
        .{ wU8(".ts"), {} },
        .{ wU8(".cts"), {} },
        .{ wU8(".mts"), {} },
        .{ wU8(".tsx"), {} },
        .{ wU8(".sh"), {} },
    });

    fn basenameW(path: []const u16) []const u16 {
        if (path.len == 0)
            return &[_]u16{};

        var end_index: usize = path.len - 1;
        while (true) {
            const byte = path[end_index];
            if (byte == '/' or byte == '\\') {
                if (end_index == 0)
                    return &[_]u16{};
                end_index -= 1;
                continue;
            }
            if (byte == ':' and end_index == 1) {
                return &[_]u16{};
            }
            break;
        }

        var start_index: usize = end_index;
        end_index += 1;
        while (path[start_index] != '/' and path[start_index] != '\\' and
            !(path[start_index] == ':' and start_index == 1))
        {
            if (start_index == 0)
                return path[0..end_index];
            start_index -= 1;
        }

        return path[start_index + 1 .. end_index];
    }

    /// std.fs.path.extension but utf16
    pub fn extensionW(path: []const u16) []const u16 {
        const filename = basenameW(path);
        const index = lastIndexOfScalar(u16, filename, '.') orelse return path[path.len..];
        if (index == 0) return path[path.len..];
        return filename[index..];
    }

    pub fn parseFromBinPath(bin_path: []const u16) ?Shebang {
        if (BunExtensions.has(@alignCast(std.mem.sliceAsBytes(extensionW(bin_path))))) {
            return .{
                .program = "bun",
                .args = "",
                .program_utf16_len = comptime calcUtf16LeLen("bun") catch unreachable,
                .args_utf16_len = 0,
                .is_bun = true,
            };
        }
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
                    const eol = if (indexOfScalar(u8, contents[i + 1 ..], '\n')) |eol|
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
                .program_utf16_len = @intCast(calcUtf16LeLen(contents[2..i]) catch return error.InvalidUtf8),
                .args_utf16_len = 0,
                .is_bun = false,
            };
        };

        if (std.mem.eql(u8, program, "/usr/bin/env")) {
            if (indexOfScalar(u8, args, ' ')) |space| {
                return .{
                    .program = args[0..space],
                    .args = args[space + 1 ..],
                    .program_utf16_len = @intCast(calcUtf16LeLen(args[0..space]) catch return error.InvalidUtf8),
                    .args_utf16_len = @intCast(calcUtf16LeLen(args[space + 1 ..]) catch return error.InvalidUtf8),
                    .is_bun = std.mem.eql(u8, args[0..space], "bun") or std.mem.eql(u8, args[0..space], "node"),
                };
            }
            return .{
                .program = args,
                .args = "",
                .program_utf16_len = @intCast(calcUtf16LeLen(args) catch return error.InvalidUtf8),
                .args_utf16_len = 0,
                .is_bun = std.mem.eql(u8, args, "bun") or std.mem.eql(u8, args, "node"),
            };
        }

        return .{
            .program = program,
            .args = args,
            .program_utf16_len = @intCast(calcUtf16LeLen(program) catch return error.InvalidUtf8),
            .args_utf16_len = @intCast(calcUtf16LeLen(args) catch return error.InvalidUtf8),
            .is_bun = false,
        };
    }

    pub fn encodedLength(shebang: Shebang) usize {
        return (shebang.program_utf16_len + " ".len + shebang.args_utf16_len) * @sizeOf(u16) +
            @sizeOf(u32) * 2;
    }
};

pub fn encodedLength(options: @This()) usize {
    const l = ((options.bin_path.len + "\" ".len) * @sizeOf(u16)) +
        @sizeOf(Flags) +
        if (options.shebang) |s| s.encodedLength() else 0;
    std.debug.assert(l % 2 == 0);
    return l;
}

/// The buffer must be exactly the correct length given by encodedLength
pub fn encodeInto(options: @This(), buf: []u8) !void {
    std.debug.assert(buf.len == options.encodedLength());
    std.debug.assert(options.bin_path[0] != '/');

    var wbuf = @as([*]u16, @alignCast(@ptrCast(&buf[0])))[0 .. buf.len / 2];

    @memcpy(wbuf[0..options.bin_path.len], options.bin_path);
    wbuf = wbuf[options.bin_path.len..];

    wbuf[0] = '"';
    wbuf[1] = ' ';
    wbuf = wbuf[2..];

    const is_node_or_bun = if (options.shebang) |s| s.is_bun else false;
    const flags = Flags{
        .has_shebang = !is_node_or_bun and options.shebang != null,
        .is_node_or_bun = true,
    };

    if (options.shebang) |s| {
        {
            const encoded = std.unicode.utf8ToUtf16Le(
                wbuf[0..s.program_utf16_len],
                s.program,
            ) catch return error.InvalidUtf8;
            std.debug.assert(encoded == s.program_utf16_len);
            wbuf = wbuf[s.program_utf16_len..];
        }
        wbuf[0] = ' ';
        wbuf = wbuf[1..];
        {
            const encoded = std.unicode.utf8ToUtf16Le(
                wbuf[0..s.args_utf16_len],
                s.args,
            ) catch return error.InvalidUtf8;
            std.debug.assert(encoded == s.args_utf16_len);
            wbuf = wbuf[s.args_utf16_len..];
        }

        @as(*align(1) u32, @ptrCast(&wbuf[0])).* = s.program_utf16_len * 2;
        @as(*align(1) u32, @ptrCast(&wbuf[2])).* = s.args_utf16_len * 2;
        wbuf = wbuf[4..];
    }

    @as(*align(1) Flags, @ptrCast(&wbuf[0])).* = flags;
    wbuf = wbuf[@sizeOf(Flags) / @sizeOf(u16) ..];

    if (@import("builtin").mode == .Debug) {
        if (wbuf.len != 0) std.debug.panic("wbuf.len != 0, got {d}", .{wbuf.len});
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
    if (shebang) |s| {
        std.log.info("shebang.program: '{s}'", .{s.program});
        std.log.info("shebang.args: '{s}'", .{s.args});
    }

    const alloc = try std.heap.page_allocator.alloc(u8, encodedLength(opts));

    std.log.info("allocation is {d} bytes", .{alloc.len});

    try opts.encodeInto(alloc);
    {
        const file = try std.fs.cwd().createFile("bun_shim.bunx", .{});
        defer file.close();

        try file.writeAll(alloc);
    }

    std.log.info("ok", .{});
    return 0;
}
