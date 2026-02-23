//! This struct carries around information for a state node's stdin/stdout/stderr.
pub const IO = @This();

stdin: InKind,
stdout: OutKind,
stderr: OutKind,

pub fn format(this: IO, writer: *std.Io.Writer) !void {
    try writer.print("stdin: {f}\nstdout: {f}\nstderr: {f}", .{ this.stdin, this.stdout, this.stderr });
}

pub fn memoryCost(this: *const IO) usize {
    var size: usize = @sizeOf(IO);
    size += this.stdin.memoryCost();
    size += this.stdout.memoryCost();
    size += this.stderr.memoryCost();
    return size;
}

pub fn deinit(this: *IO) void {
    this.stdin.close();
    this.stdout.close();
    this.stderr.close();
}

pub fn copy(this: *IO) IO {
    _ = this.ref();
    return this.*;
}

pub fn ref(this: *IO) *IO {
    _ = this.stdin.ref();
    _ = this.stdout.ref();
    _ = this.stderr.ref();
    return this;
}

pub fn deref(this: *IO) void {
    this.stdin.deref();
    this.stdout.deref();
    this.stderr.deref();
}

pub const InKind = union(enum) {
    fd: *Interpreter.IOReader,
    ignore,

    pub fn format(this: InKind, writer: *std.Io.Writer) !void {
        switch (this) {
            .fd => try writer.print("fd: {f}", .{this.fd.fd}),
            .ignore => try writer.print("ignore", .{}),
        }
    }

    pub fn ref(this: InKind) InKind {
        switch (this) {
            .fd => this.fd.ref(),
            .ignore => {},
        }
        return this;
    }

    pub fn deref(this: InKind) void {
        switch (this) {
            .fd => this.fd.deref(),
            .ignore => {},
        }
    }

    pub fn close(this: InKind) void {
        switch (this) {
            .fd => this.fd.deref(),
            .ignore => {},
        }
    }

    pub fn to_subproc_stdio(this: InKind, stdio: *bun.shell.subproc.Stdio) void {
        switch (this) {
            .fd => {
                stdio.* = .{ .fd = this.fd.fd };
            },
            .ignore => {
                stdio.* = .ignore;
            },
        }
    }

    pub fn memoryCost(this: InKind) usize {
        switch (this) {
            .fd => return this.fd.memoryCost(),
            .ignore => return 0,
        }
    }
};

pub const OutKind = union(enum) {
    /// Write/Read to/from file descriptor
    /// If `captured` is non-null, it will write to std{out,err} and also buffer it.
    /// The pointer points to the `buffered_stdout`/`buffered_stdin` fields
    /// in the Interpreter struct
    fd: struct {
        writer: *Interpreter.IOWriter,
        captured: ?*bun.ByteList = null,
        pub fn memoryCost(this: *const @This()) usize {
            var cost: usize = this.writer.memoryCost();
            if (this.captured) |captured| {
                cost += captured.memoryCost();
            }
            return cost;
        }
    },
    /// Buffers the output (handled in Cmd.BufferedIoClosed.close())
    ///
    /// This is set when the shell is called with `.quiet()`
    pipe,
    /// Discards output
    ignore,

    pub fn memoryCost(this: *const OutKind) usize {
        return switch (this.*) {
            .fd => |*fd| fd.memoryCost(),
            .pipe => 0,
            .ignore => 0,
        };
    }

    // fn dupeForSubshell(this: *ShellExecEnv,
    pub fn format(this: OutKind, writer: *std.Io.Writer) !void {
        switch (this) {
            .fd => try writer.print("fd: {f}", .{this.fd.writer.fd}),
            .pipe => try writer.print("pipe", .{}),
            .ignore => try writer.print("ignore", .{}),
        }
    }

    pub fn ref(this: @This()) @This() {
        switch (this) {
            .fd => {
                this.fd.writer.ref();
            },
            else => {},
        }
        return this;
    }

    pub fn deref(this: @This()) void {
        this.close();
    }

    pub fn enqueueFmtBltn(
        this: *@This(),
        ptr: anytype,
        comptime kind: ?Interpreter.Builtin.Kind,
        comptime fmt_: []const u8,
        args: anytype,
        _: OutputNeedsIOSafeGuard,
    ) void {
        this.fd.writer.enqueueFmtBltn(ptr, this.fd.captured, kind, fmt_, args);
    }

    fn close(this: OutKind) void {
        switch (this) {
            .fd => {
                this.fd.writer.deref();
            },
            else => {},
        }
    }

    fn to_subproc_stdio(this: OutKind, shellio: *?*shell.IOWriter) bun.shell.subproc.Stdio {
        return switch (this) {
            .fd => |val| brk: {
                shellio.* = val.writer.dupeRef();
                break :brk if (val.captured) |cap| .{
                    .capture = .{
                        .buf = cap,
                    },
                } else if (val.writer.fd.get()) |fd| .{
                    // We have a valid fd that hasn't been moved to libuv
                    .fd = fd,
                } else .{
                    // On Windows, the fd might have been moved to libuv
                    // In this case, the subprocess should inherit the stdio
                    // since libuv is already managing it
                    .inherit = {},
                };
            },
            .pipe => .pipe,
            .ignore => .ignore,
        };
    }
};

pub fn to_subproc_stdio(this: IO, stdio: *[3]bun.shell.subproc.Stdio, shellio: *shell.subproc.ShellIO) void {
    this.stdin.to_subproc_stdio(&stdio[0]);
    stdio[stdout_no] = this.stdout.to_subproc_stdio(&shellio.stdout);
    stdio[stderr_no] = this.stderr.to_subproc_stdio(&shellio.stderr);
}

const bun = @import("bun");
const std = @import("std");

const shell = bun.shell;
const Interpreter = bun.shell.Interpreter;

const OutputNeedsIOSafeGuard = bun.shell.interpret.OutputNeedsIOSafeGuard;
const stderr_no = bun.shell.interpret.stderr_no;
const stdout_no = bun.shell.interpret.stdout_no;
