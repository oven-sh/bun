printing: bool = false,

const Entry = struct {
    key: EnvStr,
    value: EnvStr,

    pub fn compare(context: void, this: @This(), other: @This()) bool {
        return bun.strings.cmpStringsAsc(context, this.key.slice(), other.key.slice());
    }
};

pub fn writeOutput(this: *Export, comptime io_kind: @Type(.enum_literal), comptime fmt: []const u8, args: anytype) Yield {
    if (this.bltn().stdout.needsIO()) |safeguard| {
        var output: *BuiltinIO.Output = &@field(this.bltn(), @tagName(io_kind));
        this.printing = true;
        return output.enqueueFmtBltn(this, .@"export", fmt, args, safeguard);
    }

    const buf = this.bltn().fmtErrorArena(.@"export", fmt, args);
    _ = this.bltn().writeNoIO(io_kind, buf);
    return this.bltn().done(0);
}

pub fn onIOWriterChunk(this: *Export, _: usize, e: ?JSC.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.printing);
    }

    const exit_code: ExitCode = if (e != null) brk: {
        defer e.?.deref();
        break :brk @intFromEnum(e.?.getErrno());
    } else 0;

    return this.bltn().done(exit_code);
}

pub fn start(this: *Export) Yield {
    const args = this.bltn().argsSlice();

    // Calling `export` with no arguments prints all exported variables lexigraphically ordered
    if (args.len == 0) {
        var arena = this.bltn().arena;

        var keys = std.ArrayList(Entry).init(arena.allocator());
        var iter = this.bltn().export_env.iterator();
        while (iter.next()) |entry| {
            keys.append(.{
                .key = entry.key_ptr.*,
                .value = entry.value_ptr.*,
            }) catch bun.outOfMemory();
        }

        std.mem.sort(Entry, keys.items[0..], {}, Entry.compare);

        const len = brk: {
            var len: usize = 0;
            for (keys.items) |entry| {
                len += std.fmt.count("{s}={s}\n", .{ entry.key.slice(), entry.value.slice() });
            }
            break :brk len;
        };
        var buf = arena.allocator().alloc(u8, len) catch bun.outOfMemory();
        {
            var i: usize = 0;
            for (keys.items) |entry| {
                const written_slice = std.fmt.bufPrint(buf[i..], "{s}={s}\n", .{ entry.key.slice(), entry.value.slice() }) catch @panic("This should not happen");
                i += written_slice.len;
            }
        }

        if (this.bltn().stdout.needsIO()) |safeguard| {
            this.printing = true;
            return this.bltn().stdout.enqueue(this, buf, safeguard);
        }

        _ = this.bltn().writeNoIO(.stdout, buf);
        return this.bltn().done(0);
    }

    for (args) |arg_raw| {
        const arg_sentinel = arg_raw[0..std.mem.len(arg_raw) :0];
        const arg = arg_sentinel[0..arg_sentinel.len];
        if (arg.len == 0) continue;

        const eqsign_idx = std.mem.indexOfScalar(u8, arg, '=') orelse {
            if (!shell.isValidVarName(arg)) {
                const buf = this.bltn().fmtErrorArena(.@"export", "`{s}`: not a valid identifier", .{arg});
                return this.writeOutput(.stderr, "{s}\n", .{buf});
            }
            this.bltn().parentCmd().base.shell.assignVar(this.bltn().parentCmd().base.interpreter, EnvStr.initSlice(arg), EnvStr.initSlice(""), .exported);
            continue;
        };

        const label = arg[0..eqsign_idx];
        const value = arg_sentinel[eqsign_idx + 1 .. :0];
        this.bltn().parentCmd().base.shell.assignVar(this.bltn().parentCmd().base.interpreter, EnvStr.initSlice(label), EnvStr.initSlice(value), .exported);
    }

    return this.bltn().done(0);
}

pub fn deinit(this: *Export) void {
    log("({s}) deinit", .{@tagName(.@"export")});
    _ = this;
}

pub inline fn bltn(this: *Export) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("export", this));
    return @fieldParentPtr("impl", impl);
}

// --
const debug = bun.Output.scoped(.ShellExport, true);
const bun = @import("bun");
const Yield = bun.shell.Yield;
const shell = bun.shell;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const ExitCode = shell.ExitCode;
const Export = @This();
const JSC = bun.JSC;
const std = @import("std");
const log = debug;
const EnvStr = interpreter.EnvStr;
const BuiltinIO = Interpreter.Builtin.BuiltinIO;
const assert = bun.assert;
