const Export = @This();

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

pub fn onIOWriterChunk(this: *Export, _: usize, e: ?jsc.SystemError) Yield {
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

        var keys = std.array_list.Managed(Entry).init(arena.allocator());
        var iter = this.bltn().export_env.iterator();
        while (iter.next()) |entry| {
            keys.append(.{
                .key = entry.key_ptr.*,
                .value = entry.value_ptr.*,
            }) catch |err| bun.handleOom(err);
        }

        std.mem.sort(Entry, keys.items[0..], {}, Entry.compare);

        const len = brk: {
            var len: usize = 0;
            for (keys.items) |entry| {
                len += std.fmt.count("{s}={s}\n", .{ entry.key.slice(), entry.value.slice() });
            }
            break :brk len;
        };
        var buf = bun.handleOom(arena.allocator().alloc(u8, len));
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

    // TODO: It would be nice to not have to duplicate the arguments here. Can
    // we make `Builtin.args` mutable so that we can take it out of the argv?
    for (args) |arg_raw| {
        const arg_sentinel = arg_raw[0..std.mem.len(arg_raw) :0];
        const arg = arg_sentinel[0..arg_sentinel.len];
        if (arg.len == 0) continue;

        const eqsign_idx = std.mem.indexOfScalar(u8, arg, '=') orelse {
            if (!shell.isValidVarName(arg)) {
                const buf = this.bltn().fmtErrorArena(.@"export", "`{s}`: not a valid identifier", .{arg});
                return this.writeOutput(.stderr, "{s}\n", .{buf});
            }

            const label_env_str = EnvStr.dupeRefCounted(arg);
            defer label_env_str.deref();
            this.bltn().parentCmd().base.shell.assignVar(this.bltn().parentCmd().base.interpreter, label_env_str, EnvStr.initSlice(""), .exported);
            continue;
        };

        const label = arg[0..eqsign_idx];
        const value = arg_sentinel[eqsign_idx + 1 .. :0];

        const label_env_str = EnvStr.dupeRefCounted(label);
        const value_env_str = EnvStr.dupeRefCounted(value);
        defer label_env_str.deref();
        defer value_env_str.deref();

        this.bltn().parentCmd().base.shell.assignVar(this.bltn().parentCmd().base.interpreter, label_env_str, value_env_str, .exported);
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
const debug = bun.Output.scoped(.ShellExport, .hidden);
const log = debug;

const std = @import("std");

const interpreter = @import("../interpreter.zig");
const EnvStr = interpreter.EnvStr;
const Interpreter = interpreter.Interpreter;

const Builtin = Interpreter.Builtin;
const BuiltinIO = Interpreter.Builtin.BuiltinIO;

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;

const shell = bun.shell;
const ExitCode = shell.ExitCode;
const Yield = bun.shell.Yield;
