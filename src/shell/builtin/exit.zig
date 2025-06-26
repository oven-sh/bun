state: enum {
    idle,
    waiting_io,
    err,
    done,
} = .idle,

pub fn start(this: *Exit) Yield {
    const args = this.bltn().argsSlice();
    switch (args.len) {
        0 => {
            return this.bltn().done(0);
        },
        1 => {
            const first_arg = args[0][0..std.mem.len(args[0]) :0];
            const exit_code: ExitCode = std.fmt.parseInt(u8, first_arg, 10) catch |err| switch (err) {
                error.Overflow => @intCast((std.fmt.parseInt(usize, first_arg, 10) catch return this.fail("exit: numeric argument required\n")) % 256),
                error.InvalidCharacter => return this.fail("exit: numeric argument required\n"),
            };
            return this.bltn().done(exit_code);
        },
        else => {
            return this.fail("exit: too many arguments\n");
        },
    }
}

fn fail(this: *Exit, msg: []const u8) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_io;
        return this.bltn().stderr.enqueue(this, msg, safeguard);
    }
    _ = this.bltn().writeNoIO(.stderr, msg);
    return this.bltn().done(1);
}

pub fn next(this: *Exit) Yield {
    switch (this.state) {
        .idle => shell.unreachableState("Exit.next", "idle"),
        .waiting_io => {
            return .suspended;
        },
        .err => {
            return this.bltn().done(1);
        },
        .done => {
            return this.bltn().done(1);
        },
    }
}

pub fn onIOWriterChunk(this: *Exit, _: usize, maybe_e: ?JSC.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_io);
    }
    if (maybe_e) |e| {
        defer e.deref();
        this.state = .err;
        return this.next();
    }
    this.state = .done;
    return this.next();
}

pub fn deinit(this: *Exit) void {
    _ = this;
}

pub inline fn bltn(this: *Exit) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("exit", this));
    return @fieldParentPtr("impl", impl);
}

// --
const bun = @import("bun");
const shell = bun.shell;
const Yield = shell.Yield;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const ExitCode = shell.ExitCode;
const Exit = @This();
const JSC = bun.JSC;
const std = @import("std");

const assert = bun.assert;
