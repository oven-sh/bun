kind: Kind,
stdin: BuiltinIO.Input,
stdout: BuiltinIO.Output,
stderr: BuiltinIO.Output,
exit_code: ?ExitCode = null,

export_env: *EnvMap,
cmd_local_env: *EnvMap,

arena: *bun.ArenaAllocator,
/// The following are allocated with the above arena
args: *const std.ArrayList(?[*:0]const u8),
args_slice: ?[]const [:0]const u8 = null,
cwd: bun.FileDescriptor,

impl: Impl,

pub const Impl = union(Kind) {
    cat: Cat,
    touch: Touch,
    mkdir: Mkdir,
    @"export": Export,
    cd: Cd,
    echo: Echo,
    pwd: Pwd,
    which: Which,
    rm: Rm,
    mv: Mv,
    ls: Ls,
    exit: Exit,
    true: True,
    false: False,
    yes: Yes,
    seq: Seq,
    dirname: Dirname,
    basename: Basename,
    cp: Cp,
};

pub const Result = @import("../result.zig").Result;

// Note: this enum uses @tagName, choose wisely!
pub const Kind = enum {
    cat,
    touch,
    mkdir,
    @"export",
    cd,
    echo,
    pwd,
    which,
    rm,
    mv,
    ls,
    exit,
    true,
    false,
    yes,
    seq,
    dirname,
    basename,
    cp,

    pub const DISABLED_ON_POSIX: []const Kind = &.{ .cat, .cp };

    pub fn parentType(this: Kind) type {
        _ = this;
    }

    pub fn usageString(this: Kind) []const u8 {
        return switch (this) {
            .cat => "usage: cat [-belnstuv] [file ...]\n",
            .touch => "usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n",
            .mkdir => "usage: mkdir [-pv] [-m mode] directory_name ...\n",
            .@"export" => "",
            .cd => "",
            .echo => "",
            .pwd => "",
            .which => "",
            .rm => "usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n",
            .mv => "usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n",
            .ls => "usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n",
            .exit => "usage: exit [n]\n",
            .true => "",
            .false => "",
            .yes => "usage: yes [expletive]\n",
            .seq => "usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n",
            .dirname => "usage: dirname string\n",
            .basename => "usage: basename string\n",
            .cp => "usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n",
        };
    }

    fn forceEnableOnPosix() bool {
        return bun.getRuntimeFeatureFlag("BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS");
    }

    pub fn fromStr(str: []const u8) ?Builtin.Kind {
        const result = std.meta.stringToEnum(Builtin.Kind, str) orelse return null;
        if (bun.Environment.isWindows) return result;
        if (forceEnableOnPosix()) return result;
        inline for (Builtin.Kind.DISABLED_ON_POSIX) |disabled| {
            if (disabled == result) {
                log("{s} builtin disabled on posix for now", .{@tagName(disabled)});
                return null;
            }
        }
        return result;
    }
};

pub const BuiltinIO = struct {
    /// in the case of array buffer we simply need to write to the pointer
    /// in the case of blob, we write to the file descriptor
    pub const Output = union(enum) {
        fd: struct { writer: *IOWriter, captured: ?*bun.ByteList = null },
        /// array list not owned by this type
        buf: std.ArrayList(u8),
        arraybuf: ArrayBuf,
        blob: *Blob,
        ignore,

        const FdOutput = struct {
            writer: *IOWriter,
            captured: ?*bun.ByteList = null,

            // pub fn
        };

        pub fn ref(this: *Output) *Output {
            switch (this.*) {
                .fd => {
                    this.fd.writer.ref();
                },
                .blob => this.blob.ref(),
                else => {},
            }
            return this;
        }

        pub fn deref(this: *Output) void {
            switch (this.*) {
                .fd => {
                    this.fd.writer.deref();
                },
                .blob => this.blob.deref(),
                else => {},
            }
        }

        pub fn needsIO(this: *Output) ?OutputNeedsIOSafeGuard {
            return switch (this.*) {
                .fd => OutputNeedsIOSafeGuard{
                    .__i_know_what_i_am_doing_it_needs_io_yes = 0,
                },
                else => null,
            };
        }

        /// You must check that `.needsIO() == true` before calling this!
        /// e.g.
        ///
        /// ```zig
        /// if (this.stderr.neesdIO()) |safeguard| {
        ///   this.bltn.stderr.enqueueFmtBltn(this, .cd, fmt, args, safeguard);
        /// }
        /// ```
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

        pub fn enqueue(this: *@This(), ptr: anytype, buf: []const u8, _: OutputNeedsIOSafeGuard) void {
            this.fd.writer.enqueue(ptr, this.fd.captured, buf);
        }
    };

    pub const Input = union(enum) {
        fd: *IOReader,
        /// array list not ownedby this type
        buf: std.ArrayList(u8),
        arraybuf: ArrayBuf,
        blob: *Blob,
        ignore,

        pub fn ref(this: *Input) *Input {
            switch (this.*) {
                .fd => {
                    this.fd.ref();
                },
                .blob => this.blob.ref(),
                else => {},
            }
            return this;
        }

        pub fn deref(this: *Input) void {
            switch (this.*) {
                .fd => {
                    this.fd.deref();
                },
                .blob => this.blob.deref(),
                else => {},
            }
        }

        pub fn needsIO(this: *Input) bool {
            return switch (this.*) {
                .fd => true,
                else => false,
            };
        }
    };

    const ArrayBuf = struct {
        buf: JSC.ArrayBuffer.Strong,
        i: u32 = 0,
    };

    const Blob = struct {
        ref_count: usize = 1,
        blob: bun.JSC.WebCore.Blob,
        pub usingnamespace bun.NewRefCounted(Blob, _deinit, null);

        fn _deinit(this: *Blob) void {
            this.blob.deinit();
            bun.destroy(this);
        }
    };
};

pub fn argsSlice(this: *Builtin) []const [*:0]const u8 {
    const args_raw = this.args.items[1..];
    const args_len = std.mem.indexOfScalar(?[*:0]const u8, args_raw, null) orelse @panic("bad");
    if (args_len == 0)
        return &[_][*:0]const u8{};

    const args_ptr = args_raw.ptr;
    return @as([*][*:0]const u8, @ptrCast(args_ptr))[0..args_len];
}

pub inline fn callImpl(this: *Builtin, comptime Ret: type, comptime field: []const u8, args_: anytype) Ret {
    return switch (this.kind) {
        .cat => this.callImplWithType(Cat, Ret, "cat", field, args_),
        .touch => this.callImplWithType(Touch, Ret, "touch", field, args_),
        .mkdir => this.callImplWithType(Mkdir, Ret, "mkdir", field, args_),
        .@"export" => this.callImplWithType(Export, Ret, "export", field, args_),
        .echo => this.callImplWithType(Echo, Ret, "echo", field, args_),
        .cd => this.callImplWithType(Cd, Ret, "cd", field, args_),
        .which => this.callImplWithType(Which, Ret, "which", field, args_),
        .rm => this.callImplWithType(Rm, Ret, "rm", field, args_),
        .pwd => this.callImplWithType(Pwd, Ret, "pwd", field, args_),
        .mv => this.callImplWithType(Mv, Ret, "mv", field, args_),
        .ls => this.callImplWithType(Ls, Ret, "ls", field, args_),
        .exit => this.callImplWithType(Exit, Ret, "exit", field, args_),
        .true => this.callImplWithType(True, Ret, "true", field, args_),
        .false => this.callImplWithType(False, Ret, "false", field, args_),
        .yes => this.callImplWithType(Yes, Ret, "yes", field, args_),
        .seq => this.callImplWithType(Seq, Ret, "seq", field, args_),
        .dirname => this.callImplWithType(Dirname, Ret, "dirname", field, args_),
        .basename => this.callImplWithType(Basename, Ret, "basename", field, args_),
        .cp => this.callImplWithType(Cp, Ret, "cp", field, args_),
    };
}

fn callImplWithType(this: *Builtin, comptime BuiltinImpl: type, comptime Ret: type, comptime union_field: []const u8, comptime field: []const u8, args_: anytype) Ret {
    const self = &@field(this.impl, union_field);
    const args = brk: {
        var args: std.meta.ArgsTuple(@TypeOf(@field(BuiltinImpl, field))) = undefined;
        args[0] = self;

        var i: usize = 1;
        inline for (args_) |a| {
            args[i] = a;
            i += 1;
        }

        break :brk args;
    };
    return @call(.auto, @field(BuiltinImpl, field), args);
}

pub inline fn allocator(this: *Builtin) Allocator {
    return this.parentCmd().base.interpreter.allocator;
}

pub fn init(
    cmd: *Cmd,
    interpreter: *Interpreter,
    kind: Kind,
    arena: *bun.ArenaAllocator,
    node: *const ast.Cmd,
    args: *const std.ArrayList(?[*:0]const u8),
    export_env: *EnvMap,
    cmd_local_env: *EnvMap,
    cwd: bun.FileDescriptor,
    io: *IO,
    comptime in_cmd_subst: bool,
) CoroutineResult {
    const stdin: BuiltinIO.Input = switch (io.stdin) {
        .fd => |fd| .{ .fd = fd.refSelf() },
        .ignore => .ignore,
    };
    const stdout: BuiltinIO.Output = switch (io.stdout) {
        .fd => |val| .{ .fd = .{ .writer = val.writer.refSelf(), .captured = val.captured } },
        .pipe => .{ .buf = std.ArrayList(u8).init(bun.default_allocator) },
        .ignore => .ignore,
    };
    const stderr: BuiltinIO.Output = switch (io.stderr) {
        .fd => |val| .{ .fd = .{ .writer = val.writer.refSelf(), .captured = val.captured } },
        .pipe => .{ .buf = std.ArrayList(u8).init(bun.default_allocator) },
        .ignore => .ignore,
    };

    cmd.exec = .{
        .bltn = Builtin{
            .kind = kind,
            .stdin = stdin,
            .stdout = stdout,
            .stderr = stderr,
            .exit_code = null,
            .arena = arena,
            .args = args,
            .export_env = export_env,
            .cmd_local_env = cmd_local_env,
            .cwd = cwd,
            .impl = undefined,
        },
    };

    switch (kind) {
        .rm => {
            cmd.exec.bltn.impl = .{
                .rm = Rm{
                    .opts = .{},
                },
            };
        },
        .echo => {
            cmd.exec.bltn.impl = .{
                .echo = Echo{
                    .output = std.ArrayList(u8).init(arena.allocator()),
                },
            };
        },
        inline else => |tag| {
            cmd.exec.bltn.impl = @unionInit(Impl, @tagName(tag), .{});
        },
    }

    if (node.redirect_file) |file| brk: {
        if (comptime in_cmd_subst) {
            if (node.redirect.stdin) {
                stdin = .ignore;
            }

            if (node.redirect.stdout) {
                stdout = .ignore;
            }

            if (node.redirect.stderr) {
                stdout = .ignore;
            }

            break :brk;
        }

        switch (file) {
            .atom => {
                if (cmd.redirection_file.items.len == 0) {
                    cmd.writeFailingError("bun: ambiguous redirect: at `{s}`\n", .{@tagName(kind)});
                    return .yield;
                }

                // Regular files are not pollable on linux
                const is_pollable: bool = if (bun.Environment.isLinux) false else true;

                const path = cmd.redirection_file.items[0..cmd.redirection_file.items.len -| 1 :0];
                log("EXPANDED REDIRECT: {s}\n", .{cmd.redirection_file.items[0..]});
                const perm = 0o666;
                const is_nonblocking = false;
                const flags = node.redirect.toFlags();
                const redirfd = switch (ShellSyscall.openat(cmd.base.shell.cwd_fd, path, flags, perm)) {
                    .err => |e| {
                        cmd.writeFailingError("bun: {s}: {s}", .{ e.toShellSystemError().message, path });
                        return .yield;
                    },
                    .result => |f| f,
                };
                if (node.redirect.stdin) {
                    cmd.exec.bltn.stdin.deref();
                    cmd.exec.bltn.stdin = .{ .fd = IOReader.init(redirfd, cmd.base.eventLoop()) };
                }
                if (node.redirect.stdout) {
                    cmd.exec.bltn.stdout.deref();
                    cmd.exec.bltn.stdout = .{ .fd = .{ .writer = IOWriter.init(redirfd, .{ .pollable = is_pollable, .nonblocking = is_nonblocking }, cmd.base.eventLoop()) } };
                }
                if (node.redirect.stderr) {
                    cmd.exec.bltn.stderr.deref();
                    cmd.exec.bltn.stderr = .{ .fd = .{ .writer = IOWriter.init(redirfd, .{ .pollable = is_pollable, .nonblocking = is_nonblocking }, cmd.base.eventLoop()) } };
                }
            },
            .jsbuf => |val| {
                const globalObject = interpreter.event_loop.js.global;
                if (interpreter.jsobjs[file.jsbuf.idx].asArrayBuffer(globalObject)) |buf| {
                    const arraybuf: BuiltinIO.ArrayBuf = .{ .buf = JSC.ArrayBuffer.Strong{
                        .array_buffer = buf,
                        .held = JSC.Strong.create(buf.value, globalObject),
                    }, .i = 0 };

                    if (node.redirect.stdin) {
                        cmd.exec.bltn.stdin.deref();
                        cmd.exec.bltn.stdin = .{ .arraybuf = arraybuf };
                    }

                    if (node.redirect.stdout) {
                        cmd.exec.bltn.stdout.deref();
                        cmd.exec.bltn.stdout = .{ .arraybuf = arraybuf };
                    }

                    if (node.redirect.stderr) {
                        cmd.exec.bltn.stderr.deref();
                        cmd.exec.bltn.stderr = .{ .arraybuf = arraybuf };
                    }
                } else if (interpreter.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Body.Value)) |body| {
                    if ((node.redirect.stdout or node.redirect.stderr) and !(body.* == .Blob and !body.Blob.needsToReadFile())) {
                        // TODO: Locked->stream -> file -> blob conversion via .toBlobIfPossible() except we want to avoid modifying the Response/Request if unnecessary.
                        cmd.base.interpreter.event_loop.js.global.throw("Cannot redirect stdout/stderr to an immutable blob. Expected a file", .{}) catch {};
                        return .yield;
                    }

                    var original_blob = body.use();
                    defer original_blob.deinit();

                    const blob: *BuiltinIO.Blob = bun.new(BuiltinIO.Blob, .{
                        .blob = original_blob.dupe(),
                    });

                    if (node.redirect.stdin) {
                        cmd.exec.bltn.stdin.deref();
                        cmd.exec.bltn.stdin = .{ .blob = blob };
                    }

                    if (node.redirect.stdout) {
                        cmd.exec.bltn.stdout.deref();
                        cmd.exec.bltn.stdout = .{ .blob = blob };
                    }

                    if (node.redirect.stderr) {
                        cmd.exec.bltn.stderr.deref();
                        cmd.exec.bltn.stderr = .{ .blob = blob };
                    }
                } else if (interpreter.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Blob)) |blob| {
                    if ((node.redirect.stdout or node.redirect.stderr) and !blob.needsToReadFile()) {
                        // TODO: Locked->stream -> file -> blob conversion via .toBlobIfPossible() except we want to avoid modifying the Response/Request if unnecessary.
                        cmd.base.interpreter.event_loop.js.global.throw("Cannot redirect stdout/stderr to an immutable blob. Expected a file", .{}) catch {};
                        return .yield;
                    }

                    const theblob: *BuiltinIO.Blob = bun.new(BuiltinIO.Blob, .{ .blob = blob.dupe() });

                    if (node.redirect.stdin) {
                        cmd.exec.bltn.stdin.deref();
                        cmd.exec.bltn.stdin = .{ .blob = theblob };
                    } else if (node.redirect.stdout) {
                        cmd.exec.bltn.stdout.deref();
                        cmd.exec.bltn.stdout = .{ .blob = theblob };
                    } else if (node.redirect.stderr) {
                        cmd.exec.bltn.stderr.deref();
                        cmd.exec.bltn.stderr = .{ .blob = theblob };
                    }
                } else {
                    const jsval = cmd.base.interpreter.jsobjs[val.idx];
                    cmd.base.interpreter.event_loop.js.global.throw("Unknown JS value used in shell: {}", .{jsval.fmtString(globalObject)}) catch {};
                    return .yield;
                }
            },
        }
    } else if (node.redirect.duplicate_out) {
        if (node.redirect.stdout) {
            cmd.exec.bltn.stderr.deref();
            cmd.exec.bltn.stderr = cmd.exec.bltn.stdout.ref().*;
        }

        if (node.redirect.stderr) {
            cmd.exec.bltn.stdout.deref();
            cmd.exec.bltn.stdout = cmd.exec.bltn.stderr.ref().*;
        }
    }

    return .cont;
}

pub inline fn eventLoop(this: *const Builtin) JSC.EventLoopHandle {
    return this.parentCmd().base.eventLoop();
}

pub inline fn throw(this: *const Builtin, err: *const bun.shell.ShellErr) void {
    this.parentCmd().base.throw(err) catch {};
}

pub inline fn parentCmd(this: *const Builtin) *const Cmd {
    const union_ptr: *const Cmd.Exec = @fieldParentPtr("bltn", this);
    return @fieldParentPtr("exec", union_ptr);
}

pub inline fn parentCmdMut(this: *Builtin) *Cmd {
    const union_ptr: *Cmd.Exec = @fieldParentPtr("bltn", this);
    return @fieldParentPtr("exec", union_ptr);
}

pub fn done(this: *Builtin, exit_code: anytype) void {
    const code: ExitCode = switch (@TypeOf(exit_code)) {
        bun.C.E => @intFromEnum(exit_code),
        u1, u8, u16 => exit_code,
        comptime_int => exit_code,
        else => @compileError("Invalid type: " ++ @typeName(@TypeOf(exit_code))),
    };
    this.exit_code = code;

    var cmd = this.parentCmdMut();
    log("builtin done ({s}: exit={d}) cmd to free: ({x})", .{ @tagName(this.kind), code, @intFromPtr(cmd) });
    cmd.exit_code = this.exit_code.?;

    // Aggregate output data if shell state is piped and this cmd is piped
    if (cmd.io.stdout == .pipe and cmd.io.stdout == .pipe and this.stdout == .buf) {
        cmd.base.shell.buffered_stdout().append(bun.default_allocator, this.stdout.buf.items[0..]) catch bun.outOfMemory();
    }
    // Aggregate output data if shell state is piped and this cmd is piped
    if (cmd.io.stderr == .pipe and cmd.io.stderr == .pipe and this.stderr == .buf) {
        cmd.base.shell.buffered_stderr().append(bun.default_allocator, this.stderr.buf.items[0..]) catch bun.outOfMemory();
    }

    cmd.parent.childDone(cmd, this.exit_code.?);
}

pub fn start(this: *Builtin) Maybe(void) {
    switch (this.callImpl(Maybe(void), "start", .{})) {
        .err => |e| return Maybe(void).initErr(e),
        .result => {},
    }

    return Maybe(void).success;
}

pub fn deinit(this: *Builtin) void {
    this.callImpl(void, "deinit", .{});

    // No need to free it because it belongs to the parent cmd
    // _ = Syscall.close(this.cwd);

    this.stdout.deref();
    this.stderr.deref();
    this.stdin.deref();

    // Parent cmd frees this
    // this.arena.deinit();
}

/// If the stdout/stderr is supposed to be captured then get the bytelist associated with that
pub fn stdBufferedBytelist(this: *Builtin, comptime io_kind: @Type(.enum_literal)) ?*bun.ByteList {
    if (comptime io_kind != .stdout and io_kind != .stderr) {
        @compileError("Bad IO" ++ @tagName(io_kind));
    }

    const io: *BuiltinIO = &@field(this, @tagName(io_kind));
    return switch (io.*) {
        .captured => if (comptime io_kind == .stdout) this.parentCmd().base.shell.buffered_stdout() else this.parentCmd().base.shell.buffered_stderr(),
        else => null,
    };
}

pub fn readStdinNoIO(this: *Builtin) []const u8 {
    return switch (this.stdin) {
        .arraybuf => |buf| buf.buf.slice(),
        .buf => |buf| buf.items[0..],
        .blob => |blob| blob.blob.sharedView(),
        else => "",
    };
}

/// **WARNING** You should make sure that stdout/stderr does not need IO (e.g. `.needsIO(.stderr)` is false before caling `.writeNoIO(.stderr, buf)`)
pub fn writeNoIO(this: *Builtin, comptime io_kind: @Type(.enum_literal), buf: []const u8) Maybe(usize) {
    if (comptime io_kind != .stdout and io_kind != .stderr) {
        @compileError("Bad IO" ++ @tagName(io_kind));
    }

    if (buf.len == 0) return Maybe(usize).initResult(0);

    var io: *BuiltinIO.Output = &@field(this, @tagName(io_kind));

    switch (io.*) {
        .fd => @panic("writeNoIO(. " ++ @tagName(io_kind) ++ ", buf) can't write to a file descriptor, did you check that needsIO(." ++ @tagName(io_kind) ++ ") was false?"),
        .buf => {
            log("{s} write to buf len={d} str={s}{s}\n", .{ @tagName(this.kind), buf.len, buf[0..@min(buf.len, 16)], if (buf.len > 16) "..." else "" });
            io.buf.appendSlice(buf) catch bun.outOfMemory();
            return Maybe(usize).initResult(buf.len);
        },
        .arraybuf => {
            if (io.arraybuf.i >= io.arraybuf.buf.array_buffer.byte_len) {
                return Maybe(usize).initErr(Syscall.Error.fromCode(bun.C.E.NOSPC, .write));
            }

            const len = buf.len;
            if (io.arraybuf.i + len > io.arraybuf.buf.array_buffer.byte_len) {
                // std.ArrayList(comptime T: type)
            }
            const write_len = if (io.arraybuf.i + len > io.arraybuf.buf.array_buffer.byte_len)
                io.arraybuf.buf.array_buffer.byte_len - io.arraybuf.i
            else
                len;

            const slice = io.arraybuf.buf.slice()[io.arraybuf.i .. io.arraybuf.i + write_len];
            @memcpy(slice, buf[0..write_len]);
            io.arraybuf.i +|= @truncate(write_len);
            log("{s} write to arraybuf {d}\n", .{ @tagName(this.kind), write_len });
            return Maybe(usize).initResult(write_len);
        },
        .blob, .ignore => return Maybe(usize).initResult(buf.len),
    }
}

/// Error messages formatted to match bash
pub fn taskErrorToString(this: *Builtin, comptime kind: Kind, err: anytype) []const u8 {
    switch (@TypeOf(err)) {
        Syscall.Error => {
            if (err.getErrorCodeTagName()) |entry| {
                _, const sys_errno = entry;
                if (bun.sys.coreutils_error_map.get(sys_errno)) |message| {
                    if (err.path.len > 0) {
                        return this.fmtErrorArena(kind, "{s}: {s}\n", .{ err.path, message });
                    }
                    return this.fmtErrorArena(kind, "{s}\n", .{message});
                }
            }
            return this.fmtErrorArena(kind, "unknown error {d}\n", .{err.errno});
        },
        JSC.SystemError => {
            if (err.path.length() == 0) return this.fmtErrorArena(kind, "{s}\n", .{err.message.byteSlice()});
            return this.fmtErrorArena(kind, "{s}: {s}\n", .{ err.message.byteSlice(), err.path });
        },
        bun.shell.ShellErr => return switch (err) {
            .sys => this.taskErrorToString(kind, err.sys),
            .custom => this.fmtErrorArena(kind, "{s}\n", .{err.custom}),
            .invalid_arguments => this.fmtErrorArena(kind, "{s}\n", .{err.invalid_arguments.val}),
            .todo => this.fmtErrorArena(kind, "{s}\n", .{err.todo}),
        },
        else => @compileError("Bad type: " ++ @typeName(err)),
    }
}

pub fn fmtErrorArena(this: *Builtin, comptime kind: ?Kind, comptime fmt_: []const u8, args: anytype) []u8 {
    const cmd_str = comptime if (kind) |k| @tagName(k) ++ ": " else "";
    const fmt = cmd_str ++ fmt_;
    return std.fmt.allocPrint(this.arena.allocator(), fmt, args) catch bun.outOfMemory();
}

// --- Shell Builtin Commands ---
pub const Cat = @import("./builtin/cat.zig");
pub const Touch = @import("./builtin/touch.zig");
pub const Mkdir = @import("./builtin/mkdir.zig");
pub const Export = @import("./builtin/export.zig");
pub const Cd = @import("./builtin/cd.zig");
pub const Ls = @import("./builtin/ls.zig");
pub const Pwd = @import("./builtin/pwd.zig");
pub const Echo = @import("./builtin/echo.zig");
pub const Which = @import("./builtin/which.zig");
pub const Rm = @import("./builtin/rm.zig");
pub const Exit = @import("./builtin/exit.zig");
pub const True = @import("./builtin/true.zig");
pub const False = @import("./builtin/false.zig");
pub const Yes = @import("./builtin/yes.zig");
pub const Seq = @import("./builtin/seq.zig");
pub const Dirname = @import("./builtin/dirname.zig");
pub const Basename = @import("./builtin/basename.zig");
pub const Cp = @import("./builtin/cp.zig");
pub const Mv = @import("./builtin/mv.zig");
// --- End Shell Builtin Commands ---

const std = @import("std");
const bun = @import("root").bun;

const shell = bun.shell;
const Interpreter = shell.interpret.Interpreter;
const Builtin = Interpreter.Builtin;

const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const ExitCode = shell.interpret.ExitCode;
const EnvMap = shell.interpret.EnvMap;
const log = shell.interpret.log;
const Syscall = bun.sys;
const IOWriter = Interpreter.IOWriter;
const IOReader = Interpreter.IOReader;
const OutputNeedsIOSafeGuard = shell.interpret.OutputNeedsIOSafeGuard;
const Cmd = Interpreter.Cmd;
const ShellSyscall = shell.interpret.ShellSyscall;
const Allocator = std.mem.Allocator;
const ast = shell.AST;
const IO = shell.interpret.IO;
const CoroutineResult = shell.interpret.CoroutineResult;
