opts: Opts = .{},
state: union(enum) {
    idle,
    exec_stdin: struct {
        in_done: bool = false,
        chunks_queued: usize = 0,
        chunks_done: usize = 0,
        errno: ExitCode = 0,
    },
    exec_filepath_args: struct {
        args: []const [*:0]const u8,
        idx: usize = 0,
        reader: ?*IOReader = null,
        chunks_queued: usize = 0,
        chunks_done: usize = 0,
        out_done: bool = false,
        in_done: bool = false,

        pub fn deinit(this: *@This()) void {
            if (this.reader) |r| r.deref();
        }
    },
    waiting_write_err,
    done,
} = .idle,

pub fn writeFailingError(this: *Cat, buf: []const u8, exit_code: ExitCode) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_write_err;
        return this.bltn().stderr.enqueue(this, buf, safeguard);
    }

    _ = this.bltn().writeNoIO(.stderr, buf);

    return this.bltn().done(exit_code);
}

pub fn start(this: *Cat) Yield {
    const filepath_args = switch (this.opts.parse(this.bltn().argsSlice())) {
        .ok => |filepath_args| filepath_args,
        .err => |e| {
            const buf = switch (e) {
                .illegal_option => |opt_str| this.bltn().fmtErrorArena(.cat, "illegal option -- {s}\n", .{opt_str}),
                .show_usage => Builtin.Kind.cat.usageString(),
                .unsupported => |unsupported| this.bltn().fmtErrorArena(.cat, "unsupported option, please open a GitHub issue -- {s}\n", .{unsupported}),
            };

            return this.writeFailingError(buf, 1);
        },
    };

    const should_read_from_stdin = filepath_args == null or filepath_args.?.len == 0;

    if (should_read_from_stdin) {
        this.state = .{
            .exec_stdin = .{},
        };
    } else {
        this.state = .{
            .exec_filepath_args = .{
                .args = filepath_args.?,
            },
        };
    }

    return this.next();
}

pub fn next(this: *Cat) Yield {
    switch (this.state) {
        .idle => @panic("Invalid state"),
        .exec_stdin => {
            if (!this.bltn().stdin.needsIO()) {
                this.state.exec_stdin.in_done = true;
                const buf = this.bltn().readStdinNoIO();
                if (this.bltn().stdout.needsIO()) |safeguard| {
                    return this.bltn().stdout.enqueue(this, buf, safeguard);
                }
                _ = this.bltn().writeNoIO(.stdout, buf);
                return this.bltn().done(0);
            }
            this.bltn().stdin.fd.addReader(this);
            return this.bltn().stdin.fd.start();
        },
        .exec_filepath_args => {
            var exec = &this.state.exec_filepath_args;
            if (exec.idx >= exec.args.len) {
                exec.deinit();
                return this.bltn().done(0);
            }

            if (exec.reader) |r| r.deref();

            const arg = std.mem.span(exec.args[exec.idx]);
            exec.idx += 1;
            const dir = this.bltn().parentCmd().base.shell.cwd_fd;
            const fd = switch (ShellSyscall.openat(dir, arg, bun.O.RDONLY, 0)) {
                .result => |fd| fd,
                .err => |e| {
                    const buf = this.bltn().taskErrorToString(.cat, e);
                    defer exec.deinit();
                    return this.writeFailingError(buf, 1);
                },
            };

            const reader = IOReader.init(fd, this.bltn().eventLoop());
            exec.chunks_done = 0;
            exec.chunks_queued = 0;
            exec.reader = reader;
            exec.reader.?.addReader(this);
            return exec.reader.?.start();
        },
        .waiting_write_err => return .failed,
        .done => return this.bltn().done(0),
    }
}

pub fn onIOWriterChunk(this: *Cat, _: usize, err: ?JSC.SystemError) Yield {
    debug("onIOWriterChunk(0x{x}, {s}, had_err={any})", .{ @intFromPtr(this), @tagName(this.state), err != null });
    const errno: ExitCode = if (err) |e| brk: {
        defer e.deref();
        break :brk @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
    } else 0;
    // Writing to stdout errored, cancel everything and write error
    if (err) |e| {
        defer e.deref();
        switch (this.state) {
            .exec_stdin => {
                this.state.exec_stdin.errno = errno;
                // Cancel reader if needed
                if (!this.state.exec_stdin.in_done) {
                    if (this.bltn().stdin.needsIO()) {
                        this.bltn().stdin.fd.removeReader(this);
                    }
                    this.state.exec_stdin.in_done = true;
                }
                return this.bltn().done(e.getErrno());
            },
            .exec_filepath_args => {
                var exec = &this.state.exec_filepath_args;
                if (exec.reader) |r| {
                    r.removeReader(this);
                }
                exec.deinit();
                return this.bltn().done(e.getErrno());
            },
            .waiting_write_err => return this.bltn().done(e.getErrno()),
            else => @panic("Invalid state"),
        }
    }

    switch (this.state) {
        .exec_stdin => {
            this.state.exec_stdin.chunks_done += 1;
            if (this.state.exec_stdin.in_done and (this.state.exec_stdin.chunks_done >= this.state.exec_stdin.chunks_queued)) {
                return this.bltn().done(0);
            }
            // Need to wait for more chunks to be written
            return .suspended;
        },
        .exec_filepath_args => {
            this.state.exec_filepath_args.chunks_done += 1;
            if (this.state.exec_filepath_args.chunks_done >= this.state.exec_filepath_args.chunks_queued) {
                this.state.exec_filepath_args.out_done = true;
            }
            if (this.state.exec_filepath_args.in_done and this.state.exec_filepath_args.out_done) {
                return this.next();
            }
            // Wait for reader to be done
            return .suspended;
        },
        .waiting_write_err => return this.bltn().done(1),
        else => @panic("Invalid state"),
    }
}

pub fn onIOReaderChunk(this: *Cat, chunk: []const u8, remove: *bool) Yield {
    debug("onIOReaderChunk(0x{x}, {s}, chunk_len={d})", .{ @intFromPtr(this), @tagName(this.state), chunk.len });
    remove.* = false;
    switch (this.state) {
        .exec_stdin => {
            if (this.bltn().stdout.needsIO()) |safeguard| {
                this.state.exec_stdin.chunks_queued += 1;
                return this.bltn().stdout.enqueue(this, chunk, safeguard);
            }
            _ = this.bltn().writeNoIO(.stdout, chunk);
            return .done;
        },
        .exec_filepath_args => {
            if (this.bltn().stdout.needsIO()) |safeguard| {
                this.state.exec_filepath_args.chunks_queued += 1;
                return this.bltn().stdout.enqueue(this, chunk, safeguard);
            }
            _ = this.bltn().writeNoIO(.stdout, chunk);
            return .done;
        },
        else => @panic("Invalid state"),
    }
    return .done;
}

pub fn onIOReaderDone(this: *Cat, err: ?JSC.SystemError) Yield {
    const errno: ExitCode = if (err) |e| brk: {
        defer e.deref();
        break :brk @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
    } else 0;
    debug("onIOReaderDone(0x{x}, {s}, errno={d})", .{ @intFromPtr(this), @tagName(this.state), errno });

    switch (this.state) {
        .exec_stdin => {
            this.state.exec_stdin.errno = errno;
            this.state.exec_stdin.in_done = true;
            if (errno != 0) {
                if ((this.state.exec_stdin.chunks_done >= this.state.exec_stdin.chunks_queued) or this.bltn().stdout.needsIO() == null) {
                    return this.bltn().done(errno);
                }
                this.bltn().stdout.fd.writer.cancelChunks(this);
                return .suspended;
            }
            if ((this.state.exec_stdin.chunks_done >= this.state.exec_stdin.chunks_queued) or this.bltn().stdout.needsIO() == null) {
                return this.bltn().done(0);
            }
        },
        .exec_filepath_args => {
            this.state.exec_filepath_args.in_done = true;
            if (errno != 0) {
                if (this.state.exec_filepath_args.out_done or this.bltn().stdout.needsIO() == null) {
                    this.state.exec_filepath_args.deinit();
                    return this.bltn().done(errno);
                }
                this.bltn().stdout.fd.writer.cancelChunks(this);
                return .suspended;
            }
            if (this.state.exec_filepath_args.out_done or (this.state.exec_filepath_args.chunks_done >= this.state.exec_filepath_args.chunks_queued) or this.bltn().stdout.needsIO() == null) {
                return this.next();
            }
        },
        .done, .waiting_write_err, .idle => {},
    }

    return .suspended;
}

pub fn deinit(_: *Cat) void {}

pub inline fn bltn(this: *Cat) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("cat", this));
    return @fieldParentPtr("impl", impl);
}

const Opts = struct {
    /// -b
    ///
    /// Number the non-blank output lines, starting at 1.
    number_nonblank: bool = false,

    /// -e
    ///
    /// Display non-printing characters and display a dollar sign ($) at the end of each line.
    show_ends: bool = false,

    /// -n
    ///
    /// Number the output lines, starting at 1.
    number_all: bool = false,

    /// -s
    ///
    /// Squeeze multiple adjacent empty lines, causing the output to be single spaced.
    squeeze_blank: bool = false,

    /// -t
    ///
    /// Display non-printing characters and display tab characters as ^I at the end of each line.
    show_tabs: bool = false,

    /// -u
    ///
    /// Disable output buffering.
    disable_output_buffering: bool = false,

    /// -v
    ///
    /// Displays non-printing characters so they are visible.
    show_nonprinting: bool = false,

    const Parse = FlagParser(*@This());

    pub fn parse(opts: *Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
        return Parse.parseFlags(opts, args);
    }

    pub fn parseLong(this: *Opts, flag: []const u8) ?ParseFlagResult {
        _ = this; // autofix
        _ = flag;
        return null;
    }

    pub fn parseShort(this: *Opts, char: u8, smallflags: []const u8, i: usize) ?ParseFlagResult {
        _ = this; // autofix
        switch (char) {
            'b' => {
                return .{ .unsupported = unsupportedFlag("-b") };
            },
            'e' => {
                return .{ .unsupported = unsupportedFlag("-e") };
            },
            'n' => {
                return .{ .unsupported = unsupportedFlag("-n") };
            },
            's' => {
                return .{ .unsupported = unsupportedFlag("-s") };
            },
            't' => {
                return .{ .unsupported = unsupportedFlag("-t") };
            },
            'u' => {
                return .{ .unsupported = unsupportedFlag("-u") };
            },
            'v' => {
                return .{ .unsupported = unsupportedFlag("-v") };
            },
            else => {
                return .{ .illegal_option = smallflags[1 + i ..] };
            },
        }

        return null;
    }
};

const debug = bun.Output.scoped(.ShellCat, true);
const bun = @import("bun");
const Yield = bun.shell.Yield;
const shell = bun.shell;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Result = Interpreter.Builtin.Result;
const ParseError = interpreter.ParseError;
const ParseFlagResult = interpreter.ParseFlagResult;
const ExitCode = shell.ExitCode;
const IOReader = shell.IOReader;
const Cat = @This();
const JSC = bun.JSC;
const std = @import("std");
const FlagParser = interpreter.FlagParser;

const ShellSyscall = interpreter.ShellSyscall;
const unsupportedFlag = interpreter.unsupportedFlag;
