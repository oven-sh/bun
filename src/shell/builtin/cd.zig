//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd ~username` will put the user in the home directory of the specified user
//! - `cd -` will put the user in the previous directory

const Cd = @This();

state: union(enum) {
    idle,
    waiting_write_stderr,
    done,
    err: Syscall.Error,
} = .idle,

fn writeStderrNonBlocking(this: *Cd, comptime fmt: []const u8, args: anytype) Yield {
    this.state = .waiting_write_stderr;
    if (this.bltn().stderr.needsIO()) |safeguard| {
        return this.bltn().stderr.enqueueFmtBltn(this, .cd, fmt, args, safeguard);
    }
    const buf = this.bltn().fmtErrorArena(.cd, fmt, args);
    _ = this.bltn().writeNoIO(.stderr, buf);
    this.state = .done;
    return this.bltn().done(1);
}

pub fn start(this: *Cd) Yield {
    const args = this.bltn().argsSlice();
    if (args.len > 1) {
        return this.writeStderrNonBlocking("too many arguments\n", .{});
    }

    if (args.len == 1) {
        const first_arg = args[0][0..std.mem.len(args[0]) :0];
        switch (first_arg[0]) {
            '-' => {
                switch (this.bltn().parentCmd().base.shell.changePrevCwd(this.bltn().parentCmd().base.interpreter)) {
                    .result => {},
                    .err => |err| {
                        return this.handleChangeCwdErr(
                            err,
                            this.bltn().parentCmd().base.shell.prevCwdZ(),
                        );
                    },
                }
            },
            '~' => {
                const homedir = this.bltn().parentCmd().base.shell.getHomedir();
                homedir.deref();
                switch (this.bltn().parentCmd().base.shell.changeCwd(this.bltn().parentCmd().base.interpreter, homedir.slice())) {
                    .result => {},
                    .err => |err| return this.handleChangeCwdErr(err, homedir.slice()),
                }
            },
            else => {
                switch (this.bltn().parentCmd().base.shell.changeCwd(this.bltn().parentCmd().base.interpreter, first_arg)) {
                    .result => {},
                    .err => |err| return this.handleChangeCwdErr(err, first_arg),
                }
            },
        }
    }

    return this.bltn().done(0);
}

fn handleChangeCwdErr(this: *Cd, err: Syscall.Error, new_cwd_: []const u8) Yield {
    const errno: usize = @intCast(err.errno);

    switch (errno) {
        @as(usize, @intFromEnum(Syscall.E.NOTDIR)) => {
            if (this.bltn().stderr.needsIO() == null) {
                const buf = this.bltn().fmtErrorArena(.cd, "not a directory: {s}\n", .{new_cwd_});
                _ = this.bltn().writeNoIO(.stderr, buf);
                this.state = .done;
                return this.bltn().done(1);
            }

            return this.writeStderrNonBlocking("not a directory: {s}\n", .{new_cwd_});
        },
        @as(usize, @intFromEnum(Syscall.E.NOENT)) => {
            if (this.bltn().stderr.needsIO() == null) {
                const buf = this.bltn().fmtErrorArena(.cd, "not a directory: {s}\n", .{new_cwd_});
                _ = this.bltn().writeNoIO(.stderr, buf);
                this.state = .done;
                return this.bltn().done(1);
            }

            return this.writeStderrNonBlocking("not a directory: {s}\n", .{new_cwd_});
        },
        else => return .failed,
    }
}

pub fn onIOWriterChunk(this: *Cd, _: usize, e: ?jsc.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_write_stderr);
    }

    if (e != null) {
        defer e.?.deref();
        return this.bltn().done(e.?.getErrno());
    }

    this.state = .done;
    return this.bltn().done(1);
}

pub inline fn bltn(this: *Cd) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("cd", this));
    return @fieldParentPtr("impl", impl);
}

pub fn deinit(this: *Cd) void {
    log("({s}) deinit", .{@tagName(.cd)});
    _ = this;
}

// --
const log = bun.Output.scoped(.Cd, .hidden);

const interpreter = @import("../interpreter.zig");
const std = @import("std");

const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const bun = @import("bun");
const Syscall = bun.sys;
const assert = bun.assert;
const jsc = bun.jsc;

const shell = bun.shell;
const Yield = bun.shell.Yield;
