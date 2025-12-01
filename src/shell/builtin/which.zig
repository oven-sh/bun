//! 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
//!
//! N args => returns absolute path of each separated by newline, if any path is not found, exit code becomes 1, but continues execution until all args are processed

const Which = @This();

state: union(enum) {
    idle,
    one_arg,
    multi_args: struct {
        args_slice: []const [*:0]const u8,
        arg_idx: usize,
        had_not_found: bool = false,
        state: union(enum) {
            none,
            waiting_write,
        },
    },
    done,
    err: jsc.SystemError,
} = .idle,

pub fn start(this: *Which) Yield {
    const args = this.bltn().argsSlice();
    if (args.len == 0) {
        if (this.bltn().stdout.needsIO()) |safeguard| {
            this.state = .one_arg;
            return this.bltn().stdout.enqueue(this, "\n", safeguard);
        }
        _ = this.bltn().writeNoIO(.stdout, "\n");
        return this.bltn().done(1);
    }

    if (this.bltn().stdout.needsIO() == null) {
        const path_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(path_buf);
        const PATH = this.bltn().parentCmd().base.shell.export_env.get(EnvStr.initSlice("PATH")) orelse EnvStr.initSlice("");
        var had_not_found = false;
        for (args) |arg_raw| {
            const arg = arg_raw[0..std.mem.len(arg_raw)];
            const resolved = which(path_buf, PATH.slice(), this.bltn().parentCmd().base.shell.cwdZ(), arg) orelse {
                had_not_found = true;
                const buf = this.bltn().fmtErrorArena(.which, "{s} not found\n", .{arg});
                _ = this.bltn().writeNoIO(.stdout, buf);
                continue;
            };

            _ = this.bltn().writeNoIO(.stdout, resolved);
        }
        return this.bltn().done(@intFromBool(had_not_found));
    }

    this.state = .{
        .multi_args = .{
            .args_slice = args,
            .arg_idx = 0,
            .state = .none,
        },
    };
    return this.next();
}

pub fn next(this: *Which) Yield {
    var multiargs = &this.state.multi_args;
    if (multiargs.arg_idx >= multiargs.args_slice.len) {
        // Done
        return this.bltn().done(@intFromBool(multiargs.had_not_found));
    }

    const arg_raw = multiargs.args_slice[multiargs.arg_idx];
    const arg = arg_raw[0..std.mem.len(arg_raw)];

    const path_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(path_buf);
    const PATH = this.bltn().parentCmd().base.shell.export_env.get(EnvStr.initSlice("PATH")) orelse EnvStr.initSlice("");

    const resolved = which(path_buf, PATH.slice(), this.bltn().parentCmd().base.shell.cwdZ(), arg) orelse {
        multiargs.had_not_found = true;
        if (this.bltn().stdout.needsIO()) |safeguard| {
            multiargs.state = .waiting_write;
            return this.bltn().stdout.enqueueFmtBltn(this, null, "{s} not found\n", .{arg}, safeguard);
        }

        const buf = this.bltn().fmtErrorArena(null, "{s} not found\n", .{arg});
        _ = this.bltn().writeNoIO(.stdout, buf);
        return this.argComplete();
    };

    if (this.bltn().stdout.needsIO()) |safeguard| {
        multiargs.state = .waiting_write;
        return this.bltn().stdout.enqueueFmtBltn(this, null, "{s}\n", .{resolved}, safeguard);
    }

    const buf = this.bltn().fmtErrorArena(null, "{s}\n", .{resolved});
    _ = this.bltn().writeNoIO(.stdout, buf);
    return this.argComplete();
}

fn argComplete(this: *Which) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .multi_args and this.state.multi_args.state == .waiting_write);
    }

    this.state.multi_args.arg_idx += 1;
    this.state.multi_args.state = .none;
    return this.next();
}

pub fn onIOWriterChunk(this: *Which, _: usize, e: ?jsc.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .one_arg or
            (this.state == .multi_args and this.state.multi_args.state == .waiting_write));
    }

    if (e != null) {
        this.state = .{ .err = e.? };
        return this.bltn().done(e.?.getErrno());
    }

    if (this.state == .one_arg) {
        // Calling which with on arguments returns exit code 1
        return this.bltn().done(1);
    }

    return this.argComplete();
}

pub fn deinit(this: *Which) void {
    log("({s}) deinit", .{@tagName(.which)});
    _ = this;
}

pub inline fn bltn(this: *Which) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("which", this));
    return @fieldParentPtr("impl", impl);
}

// --
const log = bun.Output.scoped(.which, .hidden);

const std = @import("std");

const interpreter = @import("../interpreter.zig");
const EnvStr = interpreter.EnvStr;

const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;
const which = bun.which;

const shell = bun.shell;
const Yield = bun.shell.Yield;
