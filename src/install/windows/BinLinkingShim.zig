//! Windows '.bunx' files follow this format:
//!
//! [WSTR:bin_path][u16'"'][u16:0](shebang?)[flags:u16]
//!
//! if shebang:
//! [WSTR:program][u16:0][WSTR:args][u32:bin_path_byte_len][u32:arg_byte_len]
//! - args always ends with a trailing space
//!
const std = @import("std");

const root = @import("root");

const indexOfScalar = std.mem.indexOfScalar;
const lastIndexOfScalar = std.mem.lastIndexOfScalar;
const calcUtf16LeLen = std.unicode.calcUtf16LeLen;
const utf8ToUtf16Le = std.unicode.utf8ToUtf16Le;

fn eqlComptime(a: []const u8, comptime b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

/// Relative to node_modules. Do not include slash
bin_path: []const u16,
/// Information found within the target file's shebang
shebang: ?Shebang,

pub const Flags = packed struct(u16) {
    // the shim doesnt use this right now
    is_node_or_bun: bool,
    // this is for validation that the shim is not corrupt and to detect offset memory reads
    // if this format is ever modified, we will set this flag to false to indicate version 2+
    is_version_1: bool = true,
    // indicates if a shebang is present
    has_shebang: bool,
    // this is for validation that the shim is not corrupt and to detect offset memory reads
    must_be_5474: u13 = 5474,

    pub fn isValid(flags: Flags) bool {
        const mask: u16 = @bitCast(Flags{
            .is_node_or_bun = false,
            .is_version_1 = true,
            .has_shebang = false,
            .must_be_5474 = std.math.maxInt(u13),
        });

        const compare_to: u16 = @bitCast(Flags{
            .is_node_or_bun = false,
            .has_shebang = false,
        });

        return (@as(u16, @bitCast(flags)) & comptime mask) == comptime compare_to;
    }
};

pub const embedded_executable_data = @embedFile("./bun_shim_impl.exe");

fn wU8(comptime s: []const u8) []const u8 {
    const str = std.unicode.utf8ToUtf16LeStringLiteral(s);
    return @alignCast(std.mem.sliceAsBytes(str));
}

pub const Shebang = struct {
    launcher: []const u8,
    utf16_len: u32,
    is_bun: bool,

    pub fn init(launcher: []const u8, is_bun: bool) !Shebang {
        return .{
            .launcher = launcher,
            .utf16_len = @intCast(calcUtf16LeLen(launcher) catch return error.InvalidUtf8),
            .is_bun = is_bun,
        };
    }

    const ExtensionType = enum {
        run_with_bun,
        run_with_cmd,
        run_with_powershell,
    };

    const BunExtensions = std.ComptimeStringMap(ExtensionType, .{
        .{ wU8(".js"), .run_with_bun },
        .{ wU8(".mjs"), .run_with_bun },
        .{ wU8(".cjs"), .run_with_bun },
        .{ wU8(".jsx"), .run_with_bun },
        .{ wU8(".ts"), .run_with_bun },
        .{ wU8(".cts"), .run_with_bun },
        .{ wU8(".mts"), .run_with_bun },
        .{ wU8(".tsx"), .run_with_bun },
        .{ wU8(".sh"), .run_with_bun },
        .{ wU8(".cmd"), .run_with_cmd },
        .{ wU8(".bat"), .run_with_cmd },
        .{ wU8(".ps1"), .run_with_powershell },
    });

    /// std.fs.path.basename but utf16
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
        if (BunExtensions.get(@alignCast(std.mem.sliceAsBytes(extensionW(bin_path))))) |i| {
            return switch (i) {
                .run_with_bun => comptime Shebang.init("bun run", true) catch unreachable,
                .run_with_cmd => comptime Shebang.init("cmd /c", false) catch unreachable,
                .run_with_powershell => comptime Shebang.init("powershell -ExecutionPolicy Bypass -File", false) catch unreachable,
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
        if (contents.len < 3) {
            return parseFromBinPath(bin_path);
        }

        if (contents[0] != '#' or contents[1] != '!') {
            return parseFromBinPath(bin_path);
        }

        const line = line: {
            var line_i = indexOfScalar(u8, contents, '\n') orelse return parseFromBinPath(bin_path);
            if (contents[line_i - 1] == '\r') {
                line_i -= 1;
            }
            break :line contents[2..line_i];
        };

        var tokenizer = std.mem.tokenizeScalar(u8, line, ' ');
        const first = tokenizer.next() orelse return parseFromBinPath(bin_path);
        if (eqlComptime(first, "/usr/bin/env") or eqlComptime(first, "/bin/env")) {
            const rest = tokenizer.rest();
            const program = tokenizer.next() orelse return parseFromBinPath(bin_path);
            const is_bun = eqlComptime(program, "bun") or eqlComptime(program, "node");
            return try Shebang.init(rest, is_bun);
        }

        return try Shebang.init(line, false);
    }

    pub fn encodedLength(shebang: Shebang) usize {
        return (" ".len + shebang.utf16_len) * @sizeOf(u16) +
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

    std.debug.print("{}\n", .{options});

    var wbuf = @as([*]u16, @alignCast(@ptrCast(&buf[0])))[0 .. buf.len / 2];

    @memcpy(wbuf[0..options.bin_path.len], options.bin_path);
    wbuf = wbuf[options.bin_path.len..];

    wbuf[0] = '"';
    wbuf[1] = 0;
    wbuf = wbuf[2..];

    const is_node_or_bun = if (options.shebang) |s| s.is_bun else false;
    const flags = Flags{
        .has_shebang = options.shebang != null,
        .is_node_or_bun = is_node_or_bun,
    };

    if (options.shebang) |s| {
        const encoded = std.unicode.utf8ToUtf16Le(
            wbuf[0..s.utf16_len],
            s.launcher,
        ) catch return error.InvalidUtf8;
        std.debug.assert(encoded == s.utf16_len);
        wbuf = wbuf[s.utf16_len..];

        wbuf[0] = ' ';
        wbuf = wbuf[1..];

        @as(*align(1) u32, @ptrCast(&wbuf[0])).* = @intCast(options.bin_path.len * 2);
        @as(*align(1) u32, @ptrCast(&wbuf[2])).* = (s.utf16_len) * 2 + 2; // include the spaces!
        wbuf = wbuf[(@sizeOf(u32) * 2) / @sizeOf(u16) ..];
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

    const alloc = try std.heap.page_allocator.alloc(u8, encodedLength(opts));

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
