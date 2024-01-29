//! This struct is used by bun.exe to encode `.bunx` files, to be consumed
//! by the shim 'bun_shim_impl.exe'. The latter exe does not include this code.
//!
//! The format is as follows:
//!
//! [WSTR:bin_path][u16'"'][u16:0](shebang?)[flags:u16]
//!
//! if shebang:
//! [WSTR:program][u16:0][WSTR:args][u32:bin_path_byte_len][u32:arg_byte_len]
//! - args always ends with a trailing space
//!
//! See 'bun_shim_impl.zig' for more details on how this file is consumed.
const std = @import("std");

const bun = @import("root").bun;
const simdutf = bun.simdutf;

const lastIndexOfScalar = std.mem.lastIndexOfScalar;

fn eqlComptime(a: []const u8, comptime b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

/// Relative to node_modules. Do not include slash
bin_path: []const u16,
/// Information found within the target file's shebang
shebang: ?Shebang,

/// Random numbers are chosen for validation purposes
/// These arbitrary numbers will probably not show up in the other fields.
/// This will reveal off-by-one mistakes.
pub const VersionFlag = enum(u13) {
    pub const current = .v2;

    v1 = 5474,
    v2 = 5475,
    _,
};

pub const Flags = packed struct(u16) {
    // this is set if the shebang content is "node" or "bun"
    is_node_or_bun: bool,
    // this is for validation that the shim is not corrupt and to detect offset memory reads
    is_valid: bool = true,
    // indicates if a shebang is present
    has_shebang: bool,

    version_tag: VersionFlag = VersionFlag.current,

    pub fn isValid(flags: Flags) bool {
        const mask: u16 = @bitCast(Flags{
            .is_node_or_bun = false,
            .is_valid = true,
            .has_shebang = false,
            .version_tag = @enumFromInt(std.math.maxInt(u13)),
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
            // TODO(@paperdave): what if this is invalid utf8?
            .utf16_len = @intCast(bun.simdutf.length.utf16.from.utf8(launcher)),
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
    pub fn parse(contents_maybe_overflow: []const u8, bin_path: []const u16) !?Shebang {
        const contents = contents_maybe_overflow[0..@min(contents_maybe_overflow.len, max_shebang_input_length)];

        if (contents.len < 3) {
            return parseFromBinPath(bin_path);
        }

        if (contents[0] != '#' or contents[1] != '!') {
            return parseFromBinPath(bin_path);
        }

        const line = line: {
            var line_i = bun.strings.indexOfCharUsize(contents, '\n') orelse return parseFromBinPath(bin_path);
            std.debug.assert(line_i >= 1);
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
        const encoded = bun.strings.convertUTF8toUTF16InBuffer(
            wbuf[0..s.utf16_len],
            s.launcher,
        );
        std.debug.assert(encoded.len == s.utf16_len);
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

const Decoded = struct {
    bin_path: []const u16,
    flags: Flags,
};

pub fn looseDecode(input: []const u8) ?Decoded {
    if (input.len < @sizeOf(Flags) + 2 * @sizeOf(u32) + 8) {
        return null;
    }
    const flags = @as(*align(1) const Flags, @ptrCast(&input[input.len - @sizeOf(Flags)])).*;
    if (!flags.isValid()) {
        return null;
    }

    const bin_path_u8 = if (flags.has_shebang) bin_path_u8: {
        const bin_path_byte_len = @as(*align(1) const u32, @ptrCast(&input[input.len - @sizeOf(Flags) - 2 * @sizeOf(u32)])).*;
        if (bin_path_byte_len % 2 != 0) {
            return null;
        }
        if (bin_path_byte_len > (input.len - 8)) {
            return null;
        }
        break :bin_path_u8 input[0..bin_path_byte_len];
    } else (
    // path slice is 0..flags-2
        input[0 .. input.len - @sizeOf(Flags)]);

    if (bin_path_u8.len % 2 != 0) {
        return null;
    }

    return .{
        .bin_path = bun.reinterpretSlice(u16, bin_path_u8),
        .flags = flags,
    };
}
