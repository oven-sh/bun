//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd ~username` will put the user in the home directory of the specified user
//! - `cd -` will put the user in the previous directory
state: union(enum) {
    idle,
    waiting_write_stderr,
    done,
    err: Syscall.Error,
} = .idle,

fn writeStderrNonBlocking(this: *Cd, comptime fmt: []const u8, args: anytype) void {
    this.state = .waiting_write_stderr;
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.bltn().stderr.enqueueFmtBltn(this, .cd, fmt, args, safeguard);
    } else {
        const buf = this.bltn().fmtErrorArena(.cd, fmt, args);
        _ = this.bltn().writeNoIO(.stderr, buf);
        this.state = .done;
        this.bltn().done(1);
    }
}

pub fn start(this: *Cd) Maybe(void) {
    const args = this.bltn().argsSlice();
    if (args.len > 1) {
        this.writeStderrNonBlocking("too many arguments\n", .{});
        // yield execution
        return Maybe(void).success;
    }

    if (args.len == 1) {
        const first_arg = args[0][0..std.mem.len(args[0]) :0];
        switch (first_arg[0]) {
            '-' => {
                switch (this.bltn().parentCmd().base.shell.changePrevCwd(this.bltn().parentCmd().base.interpreter)) {
                    .result => {},
                    .err => |err| {
                        return this.handleChangeCwdErr(err, this.bltn().parentCmd().base.shell.prevCwdZ());
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

    this.bltn().done(0);
    return Maybe(void).success;
}

fn handleChangeCwdErr(this: *Cd, err: Syscall.Error, new_cwd_: []const u8) Maybe(void) {
    const errno: usize = @intCast(err.errno);

    switch (errno) {
        @as(usize, @intFromEnum(Syscall.E.NOTDIR)) => {
            if (this.bltn().stderr.needsIO() == null) {
                const buf = this.bltn().fmtErrorArena(.cd, "not a directory: {s}\n", .{new_cwd_});
                _ = this.bltn().writeNoIO(.stderr, buf);
                this.state = .done;
                this.bltn().done(1);
                // yield execution
                return Maybe(void).success;
            }

            this.writeStderrNonBlocking("not a directory: {s}\n", .{new_cwd_});
            return Maybe(void).success;
        },
        @as(usize, @intFromEnum(Syscall.E.NOENT)) => {
            if (this.bltn().stderr.needsIO() == null) {
                const buf = this.bltn().fmtErrorArena(.cd, "not a directory: {s}\n", .{new_cwd_});
                _ = this.bltn().writeNoIO(.stderr, buf);
                this.state = .done;
                this.bltn().done(1);
                // yield execution
                return Maybe(void).success;
            }

            this.writeStderrNonBlocking("not a directory: {s}\n", .{new_cwd_});
            return Maybe(void).success;
        },
        else => return Maybe(void).success,
    }
}

pub fn onIOWriterChunk(this: *Cd, _: usize, e: ?JSC.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_write_stderr);
    }

    if (e != null) {
        defer e.?.deref();
        this.bltn().done(e.?.getErrno());
        return;
    }

    this.state = .done;
    this.bltn().done(1);
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
const log = bun.Output.scoped(.Cd, true);
const bun = @import("bun");
const shell = bun.shell;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Cd = @This();
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");

const Syscall = bun.sys;
const assert = bun.assert;
