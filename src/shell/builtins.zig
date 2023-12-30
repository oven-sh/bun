const bun = @import("root").bun;
const std = @import("std");
const os = std.os;
const builtin = @import("builtin");
const Arena = std.heap.ArenaAllocator;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const JSPromise = bun.JSC.JSPromise;
const JSGlobalObject = bun.JSC.JSGlobalObject;
const which = @import("../which.zig").which;
const Braces = @import("./braces.zig");
const Syscall = @import("../sys.zig");
const Glob = @import("../glob.zig");
const ResolvePath = @import("../resolver/resolve_path.zig");
const DirIterator = @import("../bun.js/node/dir_iterator.zig");
const CodepointIterator = @import("../string_immutable.zig").PackedCodepointIterator;
const isAllAscii = @import("../string_immutable.zig").isAllASCII;
const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const Subprocess = bun.ShellSubprocess;
const TaggedPointer = @import("../tagged_pointer.zig").TaggedPointer;
pub const WorkPoolTask = @import("../work_pool.zig").Task;
pub const WorkPool = @import("../work_pool.zig").WorkPool;
const Maybe = @import("../bun.js/node/types.zig").Maybe;

const Pipe = [2]bun.FileDescriptor;
const shell = @import("./shell.zig");
const Token = shell.Token;
const ShellError = shell.ShellError;
const ast = shell.AST;
const Cmd = shell.eval.Cmd;
const Interpreter = shell.eval.Interpreter;
const IO = shell.eval.IO;
const closefd = shell.eval.closefd;
const log = bun.Output.scoped(.SHELL, false);
const BufferedWriter = shell.eval.BufferedWriter;

pub fn NewBuiltin(comptime EventLoopKind: JSC.EventLoopKind) type {
    const EventLoopRef = switch (EventLoopKind) {
        .js => *JSC.EventLoop,
        .mini => *JSC.MiniEventLoop,
    };
    const event_loop_ref = struct {
        fn get() EventLoopRef {
            return switch (EventLoopKind) {
                .js => JSC.VirtualMachine.get().event_loop,
                .mini => bun.JSC.MiniEventLoop.global,
            };
        }
    };

    const EventLoopTask = switch (EventLoopKind) {
        .js => JSC.ConcurrentTask,
        .mini => JSC.AnyTaskWithExtraContext,
    };

    return struct {
        kind: Kind,
        stdin: BuiltinIO,
        stdout: BuiltinIO,
        stderr: BuiltinIO,
        exit_code: ?u8 = null,

        arena: *bun.ArenaAllocator,
        /// The following are allocated with the above arena
        args: *std.ArrayList(?[*:0]const u8),
        args_slice: ?[]const [:0]const u8 = null,
        export_env: std.StringArrayHashMap([:0]const u8),
        cmd_local_env: std.StringArrayHashMap([:0]const u8),

        impl: union(Kind) {
            @"export": Export,
            cd: Cd,
            echo: Echo,
            pwd: Pwd,
            which: Which,
            rm: Rm,
            mv: Mv,
            ls: Ls,
        },

        const Builtin = @This();
        const Result = @import("../result.zig").Result;

        pub const Kind = enum {
            @"export",
            cd,
            echo,
            pwd,
            which,
            rm,
            mv,
            ls,

            pub fn parentType(this: Kind) type {
                _ = this;
            }

            pub fn usageString(this: Kind) []const u8 {
                return switch (this) {
                    .@"export" => "",
                    .cd => "",
                    .echo => "",
                    .pwd => "",
                    .which => "",
                    .rm => "usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n",
                    .mv => "usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n",
                    .ls => "usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n",
                };
            }

            pub fn asString(this: Kind) []const u8 {
                return switch (this) {
                    .@"export" => "export",
                    .cd => "cd",
                    .echo => "echo",
                    .pwd => "pwd",
                    .which => "which",
                    .rm => "rm",
                    .mv => "mv",
                    .ls => "ls",
                };
            }

            pub fn fromStr(str: []const u8) ?Builtin.Kind {
                const tyinfo = @typeInfo(Builtin.Kind);
                inline for (tyinfo.Enum.fields) |field| {
                    if (bun.strings.eqlComptime(str, field.name)) {
                        return comptime std.meta.stringToEnum(Builtin.Kind, field.name).?;
                    }
                }
                return null;
            }
        };

        /// in the case of array buffer we simply need to write to the pointer
        /// in the case of blob, we write to the file descriptor
        pub const BuiltinIO = union(enum) {
            fd: bun.FileDescriptor,
            buf: std.ArrayList(u8),
            captured: struct {
                out_kind: enum { stdout, stderr },
                bytelist: *bun.ByteList,
            },
            arraybuf: ArrayBuf,
            ignore,

            const ArrayBuf = struct {
                buf: JSC.ArrayBuffer.Strong,
                i: u32 = 0,
            };

            pub fn expectFd(this: *BuiltinIO) bun.FileDescriptor {
                return switch (this.*) {
                    .fd => this.fd,
                    .captured => if (this.captured.out_kind == .stdout) @as(bun.FileDescriptor, bun.STDOUT_FD) else @as(bun.FileDescriptor, bun.STDERR_FD),
                    else => @panic("No fd"),
                };
            }

            pub fn isClosed(this: *BuiltinIO) bool {
                switch (this.*) {
                    .fd => {
                        return this.fd != bun.invalid_fd;
                    },
                    .buf => {
                        return true;
                        // try this.buf.deinit(allocator);
                    },
                    else => return true,
                }
            }

            pub fn deinit(this: *BuiltinIO) void {
                switch (this.*) {
                    .buf => {
                        this.buf.deinit();
                    },
                    else => {},
                }
            }

            pub fn close(this: *BuiltinIO) void {
                switch (this.*) {
                    .fd => {
                        if (this.fd != bun.invalid_fd) {
                            closefd(this.fd);
                            this.fd = bun.invalid_fd;
                        }
                    },
                    .buf => {},
                    else => {},
                }
            }

            pub fn needsIO(this: *BuiltinIO) bool {
                return switch (this.*) {
                    .fd, .captured => true,
                    else => false,
                };
            }
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
                .@"export" => this.callImplWithType(Export, Ret, "export", field, args_),
                .echo => this.callImplWithType(Echo, Ret, "echo", field, args_),
                .cd => this.callImplWithType(Cd, Ret, "cd", field, args_),
                .which => this.callImplWithType(Which, Ret, "which", field, args_),
                .rm => this.callImplWithType(Rm, Ret, "rm", field, args_),
                .pwd => this.callImplWithType(Pwd, Ret, "pwd", field, args_),
                .mv => this.callImplWithType(Mv, Ret, "mv", field, args_),
                .ls => this.callImplWithType(Ls, Ret, "ls", field, args_),
            };
        }

        fn callImplWithType(this: *Builtin, comptime Impl: type, comptime Ret: type, comptime union_field: []const u8, comptime field: []const u8, args_: anytype) Ret {
            const self = &@field(this.impl, union_field);
            const args = brk: {
                var args: std.meta.ArgsTuple(@TypeOf(@field(Impl, field))) = undefined;
                args[0] = self;

                var i: usize = 1;
                inline for (args_) |a| {
                    args[i] = a;
                    i += 1;
                }

                break :brk args;
            };
            return @call(.auto, @field(Impl, field), args);
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
            args: *std.ArrayList(?[*:0]const u8),
            export_env: std.StringArrayHashMap([:0]const u8),
            cmd_local_env: std.StringArrayHashMap([:0]const u8),
            io_: *IO,
            comptime in_cmd_subst: bool,
        ) void {
            const io = io_.*;

            var stdin: Builtin.BuiltinIO = switch (io.stdin) {
                .std => .{ .fd = bun.STDIN_FD },
                .fd => |fd| .{ .fd = fd },
                .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
                .ignore => .ignore,
            };
            var stdout: Builtin.BuiltinIO = switch (io.stdout) {
                .std => if (io.stdout.std.captured) |bytelist| .{ .captured = .{ .out_kind = .stdout, .bytelist = bytelist } } else .{ .fd = bun.STDOUT_FD },
                .fd => |fd| .{ .fd = fd },
                .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
                .ignore => .ignore,
            };
            var stderr: Builtin.BuiltinIO = switch (io.stderr) {
                .std => if (io.stderr.std.captured) |bytelist| .{ .captured = .{ .out_kind = .stderr, .bytelist = bytelist } } else .{ .fd = bun.STDERR_FD },
                .fd => |fd| .{ .fd = fd },
                .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
                .ignore => .ignore,
            };

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
                        // FIXME TODO expand atom
                        // if expands to multiple atoms, throw "ambiguous redirect" error
                        @panic("FIXME TODO redirect builtin");
                    },
                    .jsbuf => {
                        if (interpreter.jsobjs[file.jsbuf.idx].asArrayBuffer(interpreter.global)) |buf| {
                            const builtinio: Builtin.BuiltinIO = .{ .arraybuf = .{ .buf = JSC.ArrayBuffer.Strong{
                                .array_buffer = buf,
                                .held = JSC.Strong.create(buf.value, interpreter.global),
                            }, .i = 0 } };

                            if (node.redirect.stdin) {
                                stdin = builtinio;
                            }

                            if (node.redirect.stdout) {
                                stdout = builtinio;
                            }

                            if (node.redirect.stderr) {
                                stderr = builtinio;
                            }
                        } else if (interpreter.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Blob)) |blob| {
                            _ = blob;
                            @panic("FIXME TODO HANDLE BLOB");
                        } else {
                            @panic("FIXME TODO Unhandled");
                        }
                    },
                }
            }

            cmd.exec = .{ .bltn = Builtin{
                .kind = kind,
                .stdin = stdin,
                .stdout = stdout,
                .stderr = stderr,
                .exit_code = null,
                .arena = arena,
                .args = args,
                .export_env = export_env,
                .cmd_local_env = cmd_local_env,
                .impl = undefined,
            } };

            switch (kind) {
                .@"export" => {
                    cmd.exec.bltn.impl = .{
                        .@"export" = Export{ .bltn = &cmd.exec.bltn },
                    };
                },
                .rm => {
                    cmd.exec.bltn.impl = .{
                        .rm = Rm{
                            .bltn = &cmd.exec.bltn,
                            .opts = .{},
                        },
                    };
                },
                .echo => {
                    cmd.exec.bltn.impl = .{
                        .echo = Echo{
                            .bltn = &cmd.exec.bltn,
                            .output = std.ArrayList(u8).init(arena.allocator()),
                        },
                    };
                },
                .cd => {
                    cmd.exec.bltn.impl = .{
                        .cd = Cd{
                            .bltn = &cmd.exec.bltn,
                        },
                    };
                },
                .which => {
                    cmd.exec.bltn.impl = .{
                        .which = Which{
                            .bltn = &cmd.exec.bltn,
                        },
                    };
                },
                .pwd => {
                    cmd.exec.bltn.impl = .{
                        .pwd = Pwd{ .bltn = &cmd.exec.bltn },
                    };
                },
                .mv => {
                    cmd.exec.bltn.impl = .{
                        .mv = Mv{ .bltn = &cmd.exec.bltn },
                    };
                },
                .ls => {
                    cmd.exec.bltn.impl = .{
                        .ls = Ls{
                            .bltn = &cmd.exec.bltn,
                        },
                    };
                },
            }
        }

        pub inline fn parentCmd(this: *Builtin) *Cmd {
            const union_ptr = @fieldParentPtr(Cmd.Exec, "bltn", this);
            return @fieldParentPtr(Cmd, "exec", union_ptr);
        }

        pub fn done(this: *Builtin, exit_code: u8) void {
            // if (comptime bun.Environment.allow_assert) {
            //     std.debug.assert(this.exit_code != null);
            // }
            this.exit_code = exit_code;

            var cmd = this.parentCmd();
            log("cmd to free: ({x})", .{@intFromPtr(cmd)});
            cmd.exit_code = this.exit_code.?;
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

            this.stdout.deinit();
            this.stderr.deinit();
            this.stdin.deinit();

            // this.arena.deinit();
        }

        // pub fn writeNonBlocking(this: *Builtin, comptime io_kind: @Type(.EnumLiteral), buf: []u8) Maybe(usize) {
        //     if (comptime io_kind != .stdout and io_kind != .stderr) {
        //         @compileError("Bad IO" ++ @tagName(io_kind));
        //     }

        //     var io: *BuiltinIO = &@field(this, @tagName(io_kind));
        //     switch (io.*) {
        //         .buf, .arraybuf => {
        //             return this.writeNoIO(io_kind, buf);
        //         },
        //         .fd => {
        //             return Syscall.write(io.fd, buf);
        //         },
        //     }
        // }

        pub fn ioBytelist(this: *Builtin, comptime io_kind: @Type(.EnumLiteral)) ?*bun.ByteList {
            if (comptime io_kind != .stdout and io_kind != .stderr) {
                @compileError("Bad IO" ++ @tagName(io_kind));
            }

            const io: *BuiltinIO = &@field(this, @tagName(io_kind));
            return switch (io.*) {
                .captured => if (comptime io_kind == .stdout) &this.parentCmd().base.interpreter.buffered_stdout else &this.parentCmd().base.interpreter.buffered_stderr,
                else => null,
            };
        }

        pub fn writeNoIO(this: *Builtin, comptime io_kind: @Type(.EnumLiteral), buf: []const u8) Maybe(usize) {
            if (comptime io_kind != .stdout and io_kind != .stderr) {
                @compileError("Bad IO" ++ @tagName(io_kind));
            }

            var io: *BuiltinIO = &@field(this, @tagName(io_kind));

            switch (io.*) {
                .captured, .fd => @panic("writeNoIO can't write to a file descriptor"),
                .buf => {
                    log("{s} write to buf {d}\n", .{ this.kind.asString(), buf.len });
                    io.buf.appendSlice(buf) catch bun.outOfMemory();
                    return Maybe(usize).initResult(buf.len);
                },
                .arraybuf => {
                    if (io.arraybuf.i >= io.arraybuf.buf.array_buffer.byte_len) {
                        // TODO is it correct to return an error here? is this error the correct one to return?
                        return Maybe(usize).initErr(Syscall.Error.fromCode(bun.C.E.NOSPC, .write));
                    }

                    const len = buf.len;
                    const write_len = if (io.arraybuf.i + len > io.arraybuf.buf.array_buffer.byte_len)
                        io.arraybuf.buf.array_buffer.byte_len - io.arraybuf.i
                    else
                        len;

                    const slice = io.arraybuf.buf.slice()[io.arraybuf.i .. io.arraybuf.i + write_len];
                    @memcpy(slice, buf[0..write_len]);
                    io.arraybuf.i +|= @truncate(write_len);
                    log("{s} write to arraybuf {d}\n", .{ this.kind.asString(), write_len });
                    return Maybe(usize).initResult(write_len);
                },
                .ignore => return Maybe(usize).initResult(buf.len),
            }
        }

        pub fn ioAllClosed(this: *Builtin) bool {
            return this.stdin.isClosed() and this.stdout.isClosed() and this.stderr.isClosed();
        }

        pub fn fmtErrorArena(this: *Builtin, comptime kind: ?Kind, comptime fmt_: []const u8, args: anytype) []u8 {
            const cmd_str = comptime if (kind) |k| k.asString() ++ ": " else "";
            const fmt = cmd_str ++ fmt_;
            return std.fmt.allocPrint(this.arena.allocator(), fmt, args) catch bun.outOfMemory();
        }

        pub const Export = struct {
            bltn: *Builtin,
            print_state: ?struct {
                bufwriter: BufferedWriter,
                err: ?Syscall.Error = null,

                pub fn isDone(this: *@This()) bool {
                    return this.err != null or this.bufwriter.written >= this.bufwriter.remain.len;
                }
            } = null,

            const Entry = struct {
                key: []const u8,
                value: [:0]const u8,

                pub fn compare(context: void, this: @This(), other: @This()) bool {
                    return bun.strings.cmpStringsAsc(context, this.key, other.key);
                }
            };

            pub fn onBufferedWriterDone(this: *Export, e: ?Syscall.Error) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.print_state != null);
                }

                this.print_state.?.err = e;
                const exit_code: u8 = if (e != null) e.?.errno else 0;
                this.bltn.done(exit_code);
            }

            pub fn start(this: *Export) Maybe(void) {
                const args = this.bltn.argsSlice();

                // Calling `export` with no arguments prints all exported variables lexigraphically ordered
                if (args.len == 0) {
                    var arena = this.bltn.arena;

                    var keys = std.ArrayList(Entry).init(arena.allocator());
                    var iter = this.bltn.export_env.iterator();
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
                            len += std.fmt.count("{s}={s}\n", .{ entry.key, entry.value });
                        }
                        break :brk len;
                    };
                    var buf = arena.allocator().alloc(u8, len) catch bun.outOfMemory();
                    {
                        var i: usize = 0;
                        for (keys.items) |entry| {
                            const written_slice = std.fmt.bufPrint(buf[i..], "{s}={s}\n", .{ entry.key, entry.value }) catch @panic("This should not happen");
                            i += written_slice.len;
                        }
                    }

                    if (!this.bltn.stdout.needsIO()) {
                        switch (this.bltn.writeNoIO(.stdout, buf)) {
                            .err => |e| {
                                this.bltn.exit_code = e.errno;
                                return Maybe(void).initErr(e);
                            },
                            .result => |written| {
                                if (comptime bun.Environment.allow_assert) std.debug.assert(written == buf.len);
                            },
                        }
                        this.bltn.done(0);
                        return Maybe(void).success;
                    }

                    if (comptime bun.Environment.allow_assert) {}

                    this.print_state = .{
                        .bufwriter = BufferedWriter{
                            .remain = buf,
                            .fd = this.bltn.stdout.expectFd(),
                            .parent = BufferedWriter.ParentPtr{ .ptr = BufferedWriter.ParentPtr.Repr.init(this) },
                            .bytelist = this.bltn.ioBytelist(.stdout),
                        },
                    };

                    this.print_state.?.bufwriter.writeIfPossible(false);

                    // if (this.print_state.?.isDone()) {
                    //     if (this.print_state.?.bufwriter.err) |e| {
                    //         this.bltn.exit_code = e.errno;
                    //         return Maybe(void).initErr(e);
                    //     }
                    //     this.bltn.exit_code = 0;
                    //     return Maybe(void).success;
                    // }

                    return Maybe(void).success;
                }

                @panic("FIXME TODO set env");
            }

            pub fn deinit(this: *Export) void {
                log("({s}) deinit", .{@tagName(.@"export")});
                _ = this;
            }
        };

        pub const Echo = struct {
            bltn: *Builtin,

            /// Should be allocated with the arena from Builtin
            output: std.ArrayList(u8),

            io_write_state: ?BufferedWriter = null,

            state: union(enum) {
                idle,
                waiting,
                done,
                err: Syscall.Error,
            } = .idle,

            pub fn start(this: *Echo) Maybe(void) {
                const args = this.bltn.argsSlice();

                const args_len = args.len;
                for (args, 0..) |arg, i| {
                    const len = std.mem.len(arg);
                    this.output.appendSlice(arg[0..len]) catch bun.outOfMemory();
                    if (i < args_len - 1) {
                        this.output.append(' ') catch bun.outOfMemory();
                    }
                }

                this.output.append('\n') catch bun.outOfMemory();

                if (!this.bltn.stdout.needsIO()) {
                    switch (this.bltn.writeNoIO(.stdout, this.output.items[0..])) {
                        .err => |e| {
                            this.state.err = e;
                            return Maybe(void).initErr(e);
                        },
                        .result => {},
                    }

                    this.state = .done;
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                this.io_write_state = BufferedWriter{
                    .fd = this.bltn.stdout.expectFd(),
                    .remain = this.output.items[0..],
                    .parent = BufferedWriter.ParentPtr.init(this),
                    .bytelist = this.bltn.ioBytelist(.stdout),
                };
                this.state = .waiting;
                this.io_write_state.?.writeIfPossible(false);
                return Maybe(void).success;
            }

            pub fn onBufferedWriterDone(this: *Echo, e: ?Syscall.Error) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.io_write_state != null and this.state == .waiting);
                }

                if (e != null) {
                    this.state = .{ .err = e.? };
                    this.bltn.done(e.?.errno);
                    return;
                }

                this.state = .done;
                this.bltn.done(0);
            }

            pub fn deinit(this: *Echo) void {
                log("({s}) deinit", .{@tagName(.echo)});
                _ = this;
            }
        };

        /// 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
        /// N args => returns absolute path of each separated by newline, if any path is not found, exit code becomes 1, but continues execution until all args are processed
        pub const Which = struct {
            bltn: *Builtin,

            state: union(enum) {
                idle,
                one_arg: struct {
                    writer: BufferedWriter,
                },
                multi_args: struct {
                    args_slice: []const [*:0]const u8,
                    arg_idx: usize,
                    had_not_found: bool = false,
                    state: union(enum) {
                        none,
                        waiting_write: BufferedWriter,
                    },
                },
                done,
                err: Syscall.Error,
            } = .idle,

            pub fn start(this: *Which) Maybe(void) {
                const args = this.bltn.argsSlice();
                if (args.len == 0) {
                    if (!this.bltn.stdout.needsIO()) {
                        switch (this.bltn.writeNoIO(.stdout, "\n")) {
                            .err => |e| {
                                return Maybe(void).initErr(e);
                            },
                            .result => {},
                        }
                        this.bltn.done(1);
                        return Maybe(void).success;
                    }
                    this.state = .{
                        .one_arg = .{
                            .writer = BufferedWriter{
                                .fd = this.bltn.stdout.expectFd(),
                                .remain = "\n",
                                .parent = BufferedWriter.ParentPtr.init(this),
                                .bytelist = this.bltn.ioBytelist(.stdout),
                            },
                        },
                    };
                    this.state.one_arg.writer.writeIfPossible(false);
                    return Maybe(void).success;
                }

                if (!this.bltn.stdout.needsIO()) {
                    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    const PATH = this.bltn.parentCmd().base.interpreter.export_env.get("PATH") orelse "";
                    var had_not_found = false;
                    for (args) |arg_raw| {
                        const arg = arg_raw[0..std.mem.len(arg_raw)];
                        const resolved = which(&path_buf, PATH, this.bltn.parentCmd().base.interpreter.cwd, arg) orelse {
                            had_not_found = true;
                            const buf = this.bltn.fmtErrorArena(.which, "{s} not found\n", .{arg});
                            switch (this.bltn.writeNoIO(.stdout, buf)) {
                                .err => |e| return Maybe(void).initErr(e),
                                .result => {},
                            }
                            continue;
                        };

                        switch (this.bltn.writeNoIO(.stdout, resolved)) {
                            .err => |e| return Maybe(void).initErr(e),
                            .result => {},
                        }
                    }
                    this.bltn.done(@intFromBool(had_not_found));
                    return Maybe(void).success;
                }

                this.state = .{
                    .multi_args = .{
                        .args_slice = args,
                        .arg_idx = 0,
                        .state = .none,
                    },
                };
                this.next();
                return Maybe(void).success;
            }

            pub fn next(this: *Which) void {
                var multiargs = &this.state.multi_args;
                if (multiargs.arg_idx >= multiargs.args_slice.len) {
                    // Done
                    this.bltn.done(@intFromBool(multiargs.had_not_found));
                    return;
                }

                const arg_raw = multiargs.args_slice[multiargs.arg_idx];
                const arg = arg_raw[0..std.mem.len(arg_raw)];

                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const PATH = this.bltn.parentCmd().base.interpreter.export_env.get("PATH") orelse "";

                const resolved = which(&path_buf, PATH, this.bltn.parentCmd().base.interpreter.cwd, arg) orelse {
                    const buf = this.bltn.fmtErrorArena(null, "{s} not found\n", .{arg});
                    multiargs.had_not_found = true;
                    multiargs.state = .{
                        .waiting_write = BufferedWriter{
                            .fd = this.bltn.stdout.expectFd(),
                            .remain = buf,
                            .parent = BufferedWriter.ParentPtr.init(this),
                            .bytelist = this.bltn.ioBytelist(.stdout),
                        },
                    };
                    multiargs.state.waiting_write.writeIfPossible(false);
                    // yield execution
                    return;
                };

                const buf = this.bltn.fmtErrorArena(null, "{s}\n", .{resolved});
                multiargs.state = .{
                    .waiting_write = BufferedWriter{
                        .fd = this.bltn.stdout.expectFd(),
                        .remain = buf,
                        .parent = BufferedWriter.ParentPtr.init(this),
                        .bytelist = this.bltn.ioBytelist(.stdout),
                    },
                };
                multiargs.state.waiting_write.writeIfPossible(false);
                return;
            }

            fn argComplete(this: *Which) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .multi_args and this.state.multi_args.state == .waiting_write);
                }

                this.state.multi_args.arg_idx += 1;
                this.state.multi_args.state = .none;
                this.next();
            }

            pub fn onBufferedWriterDone(this: *Which, e: ?Syscall.Error) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .one_arg or
                        (this.state == .multi_args and this.state.multi_args.state == .waiting_write));
                }

                if (e != null) {
                    this.state = .{ .err = e.? };
                    this.bltn.done(e.?.errno);
                    return;
                }

                if (this.state == .one_arg) {
                    // Calling which with on arguments returns exit code 1
                    this.bltn.done(1);
                    return;
                }

                this.argComplete();
            }

            pub fn deinit(this: *Which) void {
                log("({s}) deinit", .{@tagName(.which)});
                _ = this;
            }
        };

        /// Some additional behaviour beyond basic `cd <dir>`:
        /// - `cd` by itself or `cd ~` will always put the user in their home directory.
        /// - `cd ~username` will put the user in the home directory of the specified user
        /// - `cd -` will put the user in the previous directory
        pub const Cd = struct {
            bltn: *Builtin,
            state: union(enum) {
                idle,
                waiting_write_stderr: struct {
                    buffered_writer: BufferedWriter,
                },
                done,
                err: Syscall.Error,
            } = .idle,

            fn writeStderrNonBlocking(this: *Cd, buf: []u8) void {
                this.state = .{
                    .waiting_write_stderr = .{
                        .buffered_writer = BufferedWriter{
                            .fd = this.bltn.stderr.expectFd(),
                            .remain = buf,
                            .parent = BufferedWriter.ParentPtr.init(this),
                            .bytelist = this.bltn.ioBytelist(.stderr),
                        },
                    },
                };
                this.state.waiting_write_stderr.buffered_writer.writeIfPossible(false);
            }

            pub fn start(this: *Cd) Maybe(void) {
                const args = this.bltn.argsSlice();
                if (args.len > 1) {
                    const buf = this.bltn.fmtErrorArena(.cd, "too many arguments", .{});
                    this.writeStderrNonBlocking(buf);
                    // yield execution
                    return Maybe(void).success;
                }

                const first_arg = args[0][0..std.mem.len(args[0]) :0];
                switch (first_arg[0]) {
                    '-' => {
                        switch (this.bltn.parentCmd().base.interpreter.changePrevCwd()) {
                            .result => {},
                            .err => |err| {
                                return this.handleChangeCwdErr(err, this.bltn.parentCmd().base.interpreter.prev_cwd);
                            },
                        }
                    },
                    '~' => {
                        const homedir = this.bltn.parentCmd().base.interpreter.getHomedir();
                        switch (this.bltn.parentCmd().base.interpreter.changeCwd(homedir)) {
                            .result => {},
                            .err => |err| return this.handleChangeCwdErr(err, homedir),
                        }
                    },
                    else => {
                        switch (this.bltn.parentCmd().base.interpreter.changeCwd(first_arg)) {
                            .result => {},
                            .err => |err| return this.handleChangeCwdErr(err, first_arg),
                        }
                    },
                }
                this.bltn.done(0);
                return Maybe(void).success;
            }

            fn handleChangeCwdErr(this: *Cd, err: Syscall.Error, new_cwd_: [:0]const u8) Maybe(void) {
                const errno: usize = @intCast(err.errno);

                switch (errno) {
                    @as(usize, @intFromEnum(bun.C.E.NOTDIR)) => {
                        const buf = this.bltn.fmtErrorArena(.cd, "not a directory: {s}", .{new_cwd_});
                        if (!this.bltn.stderr.needsIO()) {
                            switch (this.bltn.writeNoIO(.stderr, buf)) {
                                .err => |e| return Maybe(void).initErr(e),
                                .result => {},
                            }
                            this.state = .done;
                            this.bltn.done(1);
                            // yield execution
                            return Maybe(void).success;
                        }

                        this.writeStderrNonBlocking(buf);
                        return Maybe(void).success;
                    },
                    @as(usize, @intFromEnum(bun.C.E.NOENT)) => {
                        const buf = this.bltn.fmtErrorArena(.cd, "not a directory: {s}", .{new_cwd_});
                        if (!this.bltn.stderr.needsIO()) {
                            switch (this.bltn.writeNoIO(.stderr, buf)) {
                                .err => |e| return Maybe(void).initErr(e),
                                .result => {},
                            }
                            this.state = .done;
                            this.bltn.done(1);
                            // yield execution
                            return Maybe(void).success;
                        }

                        this.writeStderrNonBlocking(buf);
                        return Maybe(void).success;
                    },
                    else => return Maybe(void).success,
                }
            }

            pub fn onBufferedWriterDone(this: *Cd, e: ?Syscall.Error) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .waiting_write_stderr);
                }

                if (e != null) {
                    this.state = .{ .err = e.? };
                    this.bltn.done(e.?.errno);
                    return;
                }

                this.state = .done;
                this.bltn.done(0);
            }

            pub fn deinit(this: *Cd) void {
                log("({s}) deinit", .{@tagName(.cd)});
                _ = this;
            }
        };

        pub const Pwd = struct {
            bltn: *Builtin,
            state: union(enum) {
                idle,
                waiting_io: struct {
                    kind: enum { stdout, stderr },
                    writer: BufferedWriter,
                },
                err: Syscall.Error,
                done,
            } = .idle,

            pub fn start(this: *Pwd) Maybe(void) {
                const args = this.bltn.argsSlice();
                if (args.len > 0) {
                    const msg = "pwd: too many arguments";
                    if (this.bltn.stderr.needsIO()) {
                        this.state = .{
                            .waiting_io = .{
                                .kind = .stderr,
                                .writer = BufferedWriter{
                                    .fd = this.bltn.stderr.expectFd(),
                                    .remain = msg,
                                    .parent = BufferedWriter.ParentPtr.init(this),
                                    .bytelist = this.bltn.ioBytelist(.stderr),
                                },
                            },
                        };
                        this.state.waiting_io.writer.writeIfPossible(false);
                        return Maybe(void).success;
                    }

                    if (this.bltn.writeNoIO(.stderr, msg).asErr()) |e| {
                        return .{ .err = e };
                    }

                    this.bltn.done(1);
                    return Maybe(void).success;
                }

                const prev_cwd = this.bltn.parentCmd().base.interpreter.prev_cwd;
                const buf = this.bltn.fmtErrorArena(null, "{s}\n", .{prev_cwd[0..prev_cwd.len]});
                if (this.bltn.stdout.needsIO()) {
                    this.state = .{
                        .waiting_io = .{
                            .kind = .stdout,
                            .writer = BufferedWriter{
                                .fd = this.bltn.stdout.expectFd(),
                                .remain = buf,
                                .parent = BufferedWriter.ParentPtr.init(this),
                                .bytelist = this.bltn.ioBytelist(.stdout),
                            },
                        },
                    };
                    this.state.waiting_io.writer.writeIfPossible(false);
                    return Maybe(void).success;
                }

                this.state = .done;
                this.bltn.done(0);
                return Maybe(void).success;
            }

            pub fn next(this: *Pwd) void {
                while (!(this.state == .err or this.state == .done)) {
                    switch (this.state) {
                        .waiting_io => return,
                        .idle, .done, .err => unreachable,
                    }
                }

                if (this.state == .done) {
                    this.bltn.done(0);
                    return;
                }

                if (this.state == .err) {
                    this.bltn.done(this.state.err.errno);
                    return;
                }
            }

            pub fn onBufferedWriterDone(this: *Pwd, e: ?Syscall.Error) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .waiting_io);
                }

                if (e != null) {
                    this.state = .{ .err = e.? };
                    this.next();
                    return;
                }

                this.state = .done;

                this.next();
            }

            pub fn deinit(this: *Pwd) void {
                _ = this;
            }
        };

        pub const Ls = struct {
            bltn: *Builtin,
            opts: Opts = .{},

            state: union(enum) {
                idle,
                exec: struct {
                    err: ?Syscall.Error = null,
                    task_count: usize,
                    tasks_done: usize = 0,
                    output_queue: std.DoublyLinkedList(BlockingOutput) = .{},
                },
                waiting_write_err: BufferedWriter,
                done,
            } = .idle,

            const BlockingOutput = struct {
                writer: BufferedWriter,
                arr: std.ArrayList(u8),

                pub fn deinit(this: *BlockingOutput) void {
                    this.arr.deinit();
                }
            };

            pub fn start(this: *Ls) Maybe(void) {
                this.next();
                return Maybe(void).success;
            }

            pub fn writeFailingError(this: *Ls, buf: []const u8, exit_code: u8) Maybe(void) {
                if (this.bltn.stderr.needsIO()) {
                    this.state = .{
                        .waiting_write_err = BufferedWriter{
                            .fd = this.bltn.stderr.expectFd(),
                            .remain = buf,
                            .parent = BufferedWriter.ParentPtr.init(this),
                            .bytelist = this.bltn.ioBytelist(.stderr),
                        },
                    };
                    this.state.waiting_write_err.writeIfPossible(false);
                    return Maybe(void).success;
                }

                if (this.bltn.writeNoIO(.stderr, buf).asErr()) |e| {
                    return .{ .err = e };
                }

                this.bltn.done(exit_code);
                return Maybe(void).success;
            }

            fn next(this: *Ls) void {
                while (!(this.state == .done)) {
                    switch (this.state) {
                        .idle => {
                            // Will be null if called with no args, in which case we just run once with "." directory
                            const paths: ?[]const [*:0]const u8 = switch (this.parseOpts()) {
                                .ok => |paths| paths,
                                .err => |e| {
                                    const buf = switch (e) {
                                        .illegal_option => |opt_str| this.bltn.fmtErrorArena(.ls, "illegal option -- {s}\n", .{opt_str}),
                                        .show_usage => Builtin.Kind.ls.usageString(),
                                    };

                                    _ = this.writeFailingError(buf, 1);
                                    return;
                                },
                            };

                            const task_count = if (paths) |p| p.len else 1;

                            this.state = .{
                                .exec = .{
                                    .task_count = task_count,
                                },
                            };

                            if (paths) |p| {
                                for (p) |path_raw| {
                                    const path = path_raw[0..std.mem.len(path_raw) :0];
                                    var task = ShellLsTask.create(this, this.opts, path, null);
                                    task.schedule();
                                }
                            } else {
                                var task = ShellLsTask.create(this, this.opts, ".", null);
                                task.schedule();
                            }
                        },
                        .exec => {
                            // It's done
                            if (this.state.exec.tasks_done >= this.state.exec.task_count and this.state.exec.output_queue.len == 0) {
                                this.state = .done;
                                this.bltn.done(0);
                                return;
                            }
                            return;
                        },
                        .waiting_write_err => {
                            return;
                        },
                        .done => unreachable,
                    }
                }

                this.bltn.done(0);
                return;
            }

            pub fn deinit(this: *Ls) void {
                _ = this; // autofix
            }

            pub fn queueBlockingOutput(this: *Ls, bo: BlockingOutput) void {
                const node = bun.default_allocator.create(std.DoublyLinkedList(BlockingOutput).Node) catch bun.outOfMemory();
                node.* = .{
                    .data = bo,
                };
                this.state.exec.output_queue.append(node);

                // Need to start it
                if (this.state.exec.output_queue.len == 1) {
                    this.state.exec.output_queue.first.?.data.writer.writeIfPossible(false);
                }
            }

            pub fn onBufferedWriterDone(this: *Ls, e: ?Syscall.Error) void {
                _ = e; // autofix

                if (this.state == .waiting_write_err) {
                    // if (e) |err| return this.bltn.done(1);
                    return this.bltn.done(1);
                }

                var queue = &this.state.exec.output_queue;
                var first = queue.popFirst().?;
                defer {
                    first.data.deinit();
                    bun.default_allocator.destroy(first);
                }
                if (first.next) |next_writer| {
                    next_writer.data.writer.writeIfPossible(false);
                }

                this.next();
            }

            pub fn onAsyncTaskDone(this: *Ls, task: *ShellLsTask) void {
                // TODO check for error, print that (but still want to print task output)
                this.state.exec.tasks_done += 1;
                const output = task.takeOutput();

                if (this.bltn.stdout.needsIO()) {
                    const blocking_output: BlockingOutput = .{
                        .writer = BufferedWriter{
                            .fd = this.bltn.stdout.expectFd(),
                            .remain = output.items[0..],
                            .parent = BufferedWriter.ParentPtr.init(this),
                            .bytelist = this.bltn.ioBytelist(.stdout),
                        },
                        .arr = output,
                    };
                    this.queueBlockingOutput(blocking_output);
                    if (this.state == .done) return;
                    return this.next();
                }

                defer output.deinit();

                if (this.bltn.writeNoIO(.stdout, output.items[0..]).asErr()) |e| {
                    _ = e; // autofix

                    @panic("FIXME uh oh");
                }

                return this.next();
            }

            pub const ShellLsTask = struct {
                const print = bun.Output.scoped(.ShellLsTask, false);
                ls: *Ls,
                opts: Opts,

                is_root: bool = true,
                /// Should be allocated with bun.default_allocator
                path: [:0]const u8 = &[0:0]u8{},
                /// Should use bun.default_allocator
                output: std.ArrayList(u8),
                is_absolute: bool = false,
                err: ?Syscall.Error = null,
                result_kind: enum { file, dir, idk } = .idk,

                event_loop: EventLoopRef,
                concurrent_task: EventLoopTask = .{},
                task: JSC.WorkPoolTask = .{
                    .callback = workPoolCallback,
                },

                pub fn schedule(this: *@This()) void {
                    JSC.WorkPool.schedule(&this.task);
                }

                pub fn create(ls: *Ls, opts: Opts, path: [:0]const u8, event_loop: ?EventLoopRef) *@This() {
                    const task = bun.default_allocator.create(@This()) catch bun.outOfMemory();
                    task.* = @This(){
                        .ls = ls,
                        .opts = opts,
                        .path = bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory(),
                        .output = std.ArrayList(u8).init(bun.default_allocator),
                        // .event_loop = event_loop orelse JSC.VirtualMachine.get().eventLoop(),
                        .event_loop = event_loop orelse event_loop_ref.get(),
                    };
                    return task;
                }

                pub fn enqueue(this: *@This(), path: [:0]const u8) void {
                    const new_path = this.join(
                        bun.default_allocator,
                        &[_][]const u8{
                            this.path[0..this.path.len],
                            path[0..path.len],
                        },
                        this.is_absolute,
                    );

                    var subtask = @This().create(this.ls, this.opts, new_path, this.event_loop);
                    subtask.is_root = false;
                    subtask.schedule();
                }

                inline fn join(this: *@This(), alloc: Allocator, subdir_parts: []const []const u8, is_absolute: bool) [:0]const u8 {
                    _ = this; // autofix
                    if (!is_absolute) {
                        // If relative paths enabled, stdlib join is preferred over
                        // ResolvePath.joinBuf because it doesn't try to normalize the path
                        return std.fs.path.joinZ(alloc, subdir_parts) catch bun.outOfMemory();
                    }

                    const out = alloc.dupeZ(u8, bun.path.join(subdir_parts, .auto)) catch bun.outOfMemory();

                    return out;
                }

                pub fn run(this: *@This()) void {
                    const fd = switch (Syscall.open(this.path, os.O.RDONLY | os.O.DIRECTORY, 0)) {
                        .err => |e| {
                            switch (e.getErrno()) {
                                bun.C.E.NOENT => {
                                    this.err = this.errorWithPath(e, this.path);
                                },
                                bun.C.E.NOTDIR => {
                                    this.result_kind = .file;
                                    this.addEntry(this.path);
                                },
                                else => {
                                    this.err = this.errorWithPath(e, this.path);
                                },
                            }
                            return;
                        },
                        .result => |fd| fd,
                    };

                    defer {
                        _ = Syscall.close(fd);
                    }

                    if (!this.is_root) {
                        const writer = this.output.writer();
                        std.fmt.format(writer, "{s}:\n", .{this.path}) catch bun.outOfMemory();
                    }

                    const dir = std.fs.Dir{ .fd = fd };
                    var iterator = DirIterator.iterate(dir);
                    var entry = iterator.next();

                    while (switch (entry) {
                        .err => |e| {
                            this.err = this.errorWithPath(e, this.path);
                            return;
                        },
                        .result => |ent| ent,
                    }) |current| : (entry = iterator.next()) {
                        this.addEntry(current.name.sliceAssumeZ());
                        if (current.kind == .directory and this.opts.recursive) {
                            this.enqueue(current.name.sliceAssumeZ());
                        }
                    }
                    print("run done", .{});
                }

                fn shouldSkipEntry(this: *@This(), name: [:0]const u8) bool {
                    if (this.opts.show_all) return false;
                    if (this.opts.show_almost_all) {
                        if (comptime bun.Environment.isWindows) {
                            const nameutf16 = @as([*]const u16, @ptrCast(name.ptr))[0 .. name.len / 2];
                            if (bun.strings.eqlComptimeUTF16(nameutf16[0..1], ".") or bun.strings.eqlComptimeUTF16(nameutf16[0..2], "..")) return true;
                        } else {
                            if (bun.strings.eqlComptime(name[0..1], ".") or bun.strings.eqlComptime(name[0..2], "..")) return true;
                        }
                    }
                    return false;
                }

                // TODO more complex output like multi-column
                fn addEntry(this: *@This(), name: [:0]const u8) void {
                    const skip = this.shouldSkipEntry(name);
                    print("Entry: (skip={}) {s} :: {s}", .{ skip, this.path, name });
                    if (skip) return;
                    this.output.ensureUnusedCapacity(name.len + 1) catch bun.outOfMemory();
                    this.output.appendSlice(name) catch bun.outOfMemory();
                    // FIXME TODO non ascii/utf-8
                    this.output.append('\n') catch bun.outOfMemory();
                }

                fn errorWithPath(this: *@This(), err: Syscall.Error, path: [:0]const u8) Syscall.Error {
                    _ = this;
                    return err.withPath(bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory());
                }

                pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
                    var this: *@This() = @fieldParentPtr(@This(), "task", task);
                    this.run();
                    if (comptime EventLoopKind == .js) {
                        this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
                    } else {
                        this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, "runFromMainThreadMini"));
                    }
                }

                pub fn takeOutput(this: *@This()) std.ArrayList(u8) {
                    const ret = this.output;
                    this.output = std.ArrayList(u8).init(bun.default_allocator);
                    return ret;
                }

                pub fn runFromMainThread(this: *@This()) void {
                    print("runFromMainThread", .{});
                    this.ls.onAsyncTaskDone(this);
                }

                pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                    print("runFromMainThread", .{});
                    this.ls.onAsyncTaskDone(this);
                }

                pub fn deinit(this: *@This()) void {
                    print("deinit", .{});
                    bun.default_allocator.free(this.path);
                    this.output.deinit();
                    bun.default_allocator.destroy(this);
                }
            };

            const Opts = struct {
                /// `-a`, `--all`
                /// Do not ignore entries starting with .
                show_all: bool = false,

                /// `-A`, `--almost-all`
                /// Do not list implied . and ..
                show_almost_all: bool = true,

                /// `--author`
                /// With -l, print the author of each file
                show_author: bool = false,

                /// `-b`, `--escape`
                /// Print C-style escapes for nongraphic characters
                escape: bool = false,

                /// `--block-size=SIZE`
                /// With -l, scale sizes by SIZE when printing them; e.g., '--block-size=M'
                block_size: ?usize = null,

                /// `-B`, `--ignore-backups`
                /// Do not list implied entries ending with ~
                ignore_backups: bool = false,

                /// `-c`
                /// Sort by, and show, ctime (time of last change of file status information); affects sorting and display based on options
                use_ctime: bool = false,

                /// `-C`
                /// List entries by columns
                list_by_columns: bool = false,

                /// `--color[=WHEN]`
                /// Color the output; WHEN can be 'always', 'auto', or 'never'
                color: ?[]const u8 = null,

                /// `-d`, `--directory`
                /// List directories themselves, not their contents
                list_directories: bool = false,

                /// `-D`, `--dired`
                /// Generate output designed for Emacs' dired mode
                dired_mode: bool = false,

                /// `-f`
                /// List all entries in directory order
                unsorted: bool = false,

                /// `-F`, `--classify[=WHEN]`
                /// Append indicator (one of */=>@|) to entries; WHEN can be 'always', 'auto', or 'never'
                classify: ?[]const u8 = null,

                /// `--file-type`
                /// Likewise, except do not append '*'
                file_type: bool = false,

                /// `--format=WORD`
                /// Specify format: 'across', 'commas', 'horizontal', 'long', 'single-column', 'verbose', 'vertical'
                format: ?[]const u8 = null,

                /// `--full-time`
                /// Like -l --time-style=full-iso
                full_time: bool = false,

                /// `-g`
                /// Like -l, but do not list owner
                no_owner: bool = false,

                /// `--group-directories-first`
                /// Group directories before files
                group_directories_first: bool = false,

                /// `-G`, `--no-group`
                /// In a long listing, don't print group names
                no_group: bool = false,

                /// `-h`, `--human-readable`
                /// With -l and -s, print sizes like 1K 234M 2G etc.
                human_readable: bool = false,

                /// `--si`
                /// Use powers of 1000 not 1024 for sizes
                si_units: bool = false,

                /// `-H`, `--dereference-command-line`
                /// Follow symbolic links listed on the command line
                dereference_cmd_symlinks: bool = false,

                /// `--dereference-command-line-symlink-to-dir`
                /// Follow each command line symbolic link that points to a directory
                dereference_cmd_dir_symlinks: bool = false,

                /// `--hide=PATTERN`
                /// Do not list entries matching shell PATTERN
                hide_pattern: ?[]const u8 = null,

                /// `--hyperlink[=WHEN]`
                /// Hyperlink file names; WHEN can be 'always', 'auto', or 'never'
                hyperlink: ?[]const u8 = null,

                /// `--indicator-style=WORD`
                /// Append indicator with style to entry names: 'none', 'slash', 'file-type', 'classify'
                indicator_style: ?[]const u8 = null,

                /// `-i`, `--inode`
                /// Print the index number of each file
                show_inode: bool = false,

                /// `-I`, `--ignore=PATTERN`
                /// Do not list entries matching shell PATTERN
                ignore_pattern: ?[]const u8 = null,

                /// `-k`, `--kibibytes`
                /// Default to 1024-byte blocks for file system usage
                kibibytes: bool = false,

                /// `-l`
                /// Use a long listing format
                long_listing: bool = false,

                /// `-L`, `--dereference`
                /// Show information for the file the symbolic link references
                dereference: bool = false,

                /// `-m`
                /// Fill width with a comma separated list of entries
                comma_separated: bool = false,

                /// `-n`, `--numeric-uid-gid`
                /// Like -l, but list numeric user and group IDs
                numeric_uid_gid: bool = false,

                /// `-N`, `--literal`
                /// Print entry names without quoting
                literal: bool = false,

                /// `-o`
                /// Like -l, but do not list group information
                no_group_info: bool = false,

                /// `-p`, `--indicator-style=slash`
                /// Append / indicator to directories
                slash_indicator: bool = false,

                /// `-q`, `--hide-control-chars`
                /// Print ? instead of nongraphic characters
                hide_control_chars: bool = false,

                /// `--show-control-chars`
                /// Show nongraphic characters as-is
                show_control_chars: bool = false,

                /// `-Q`, `--quote-name`
                /// Enclose entry names in double quotes
                quote_name: bool = false,

                /// `--quoting-style=WORD`
                /// Use quoting style for entry names
                quoting_style: ?[]const u8 = null,

                /// `-r`, `--reverse`
                /// Reverse order while sorting
                reverse_order: bool = false,

                /// `-R`, `--recursive`
                /// List subdirectories recursively
                recursive: bool = false,

                /// `-s`, `--size`
                /// Print the allocated size of each file, in blocks
                show_size: bool = false,

                /// `-S`
                /// Sort by file size, largest first
                sort_by_size: bool = false,

                /// `--sort=WORD`
                /// Sort by a specified attribute
                sort_method: ?[]const u8 = null,

                /// `--time=WORD`
                /// Select which timestamp to use for display or sorting
                time_method: ?[]const u8 = null,

                /// `--time-style=TIME_STYLE`
                /// Time/date format with -l
                time_style: ?[]const u8 = null,

                /// `-t`
                /// Sort by time, newest first
                sort_by_time: bool = false,

                /// `-T`, `--tabsize=COLS`
                /// Assume tab stops at each specified number of columns
                tabsize: ?usize = null,

                /// `-u`
                /// Sort by, and show, access time
                use_atime: bool = false,

                /// `-U`
                /// Do not sort; list entries in directory order
                no_sort: bool = false,

                /// `-v`
                /// Natural sort of (version) numbers within text
                natural_sort: bool = false,

                /// `-w`, `--width=COLS`
                /// Set output width to specified number of columns
                output_width: ?usize = null,

                /// `-x`
                /// List entries by lines instead of by columns
                list_by_lines: bool = false,

                /// `-X`
                /// Sort alphabetically by entry extension
                sort_by_extension: bool = false,

                /// `-Z`, `--context`
                /// Print any security context of each file
                show_context: bool = false,

                /// `--zero`
                /// End each output line with NUL, not newline
                end_with_nul: bool = false,

                /// `-1`
                /// List one file per line
                one_file_per_line: bool = false,

                /// `--help`
                /// Display help and exit
                show_help: bool = false,

                /// `--version`
                /// Output version information and exit
                show_version: bool = false,

                /// Custom parse error for invalid options
                const ParseError = union(enum) {
                    illegal_option: []const u8,
                    show_usage,
                };
            };

            pub fn parseOpts(this: *Ls) Result(?[]const [*:0]const u8, Opts.ParseError) {
                return this.parseFlags();
            }

            pub fn parseFlags(this: *Ls) Result(?[]const [*:0]const u8, Opts.ParseError) {
                const args = this.bltn.argsSlice();
                var idx: usize = 0;
                if (args.len == 0) {
                    return .{ .ok = null };
                }

                while (idx < args.len) : (idx += 1) {
                    const flag = args[idx];
                    switch (this.parseFlag(flag[0..std.mem.len(flag)])) {
                        .done => {
                            const filepath_args = args[idx..];
                            return .{ .ok = filepath_args };
                        },
                        .continue_parsing => {},
                        .illegal_option => |opt_str| return .{ .err = .{ .illegal_option = opt_str } },
                    }
                }

                return .{ .err = .show_usage };
            }

            pub fn parseFlag(this: *Ls, flag: []const u8) union(enum) { continue_parsing, done, illegal_option: []const u8 } {
                if (flag.len == 0) return .done;
                if (flag[0] != '-') return .done;

                // FIXME windows
                if (flag.len == 1) return .{ .illegal_option = "-" };

                const small_flags = flag[1..];
                for (small_flags) |char| {
                    switch (char) {
                        'a' => {
                            this.opts.show_all = true;
                        },
                        'A' => {
                            this.opts.show_almost_all = true;
                        },
                        'b' => {
                            this.opts.escape = true;
                        },
                        'B' => {
                            this.opts.ignore_backups = true;
                        },
                        'c' => {
                            this.opts.use_ctime = true;
                        },
                        'C' => {
                            this.opts.list_by_columns = true;
                        },
                        'd' => {
                            this.opts.list_directories = true;
                        },
                        'D' => {
                            this.opts.dired_mode = true;
                        },
                        'f' => {
                            this.opts.unsorted = true;
                        },
                        'F' => {
                            this.opts.classify = "always";
                        },
                        'g' => {
                            this.opts.no_owner = true;
                        },
                        'G' => {
                            this.opts.no_group = true;
                        },
                        'h' => {
                            this.opts.human_readable = true;
                        },
                        'H' => {
                            this.opts.dereference_cmd_symlinks = true;
                        },
                        'i' => {
                            this.opts.show_inode = true;
                        },
                        'I' => {
                            this.opts.ignore_pattern = ""; // This will require additional logic to handle patterns
                        },
                        'k' => {
                            this.opts.kibibytes = true;
                        },
                        'l' => {
                            this.opts.long_listing = true;
                        },
                        'L' => {
                            this.opts.dereference = true;
                        },
                        'm' => {
                            this.opts.comma_separated = true;
                        },
                        'n' => {
                            this.opts.numeric_uid_gid = true;
                        },
                        'N' => {
                            this.opts.literal = true;
                        },
                        'o' => {
                            this.opts.no_group_info = true;
                        },
                        'p' => {
                            this.opts.slash_indicator = true;
                        },
                        'q' => {
                            this.opts.hide_control_chars = true;
                        },
                        'Q' => {
                            this.opts.quote_name = true;
                        },
                        'r' => {
                            this.opts.reverse_order = true;
                        },
                        'R' => {
                            this.opts.recursive = true;
                        },
                        's' => {
                            this.opts.show_size = true;
                        },
                        'S' => {
                            this.opts.sort_by_size = true;
                        },
                        't' => {
                            this.opts.sort_by_time = true;
                        },
                        'T' => {
                            this.opts.tabsize = 8; // Default tab size, needs additional handling for custom sizes
                        },
                        'u' => {
                            this.opts.use_atime = true;
                        },
                        'U' => {
                            this.opts.no_sort = true;
                        },
                        'v' => {
                            this.opts.natural_sort = true;
                        },
                        'w' => {
                            this.opts.output_width = 0; // Default to no limit, needs additional handling for custom widths
                        },
                        'x' => {
                            this.opts.list_by_lines = true;
                        },
                        'X' => {
                            this.opts.sort_by_extension = true;
                        },
                        'Z' => {
                            this.opts.show_context = true;
                        },
                        '1' => {
                            this.opts.one_file_per_line = true;
                        },
                        else => {
                            return .{ .illegal_option = flag[1..2] };
                        },
                    }
                }

                return .continue_parsing;
            }
        };

        pub const Mv = struct {
            bltn: *Builtin,
            opts: Opts = .{},
            args: struct {
                sources: []const [*:0]const u8 = &[_][*:0]const u8{},
                target: [:0]const u8 = &[0:0]u8{},
                target_fd: ?bun.FileDescriptor = null,
            } = .{},
            state: union(enum) {
                idle,
                check_target: struct {
                    task: ShellMvCheckTargetTask,
                    state: union(enum) {
                        running,
                        done,
                    },
                },
                executing: struct {
                    task_count: usize,
                    tasks_done: usize = 0,
                    error_signal: std.atomic.Value(bool),
                    tasks: []ShellMvBatchedTask,
                    err: ?Syscall.Error = null,
                },
                done,
                waiting_write_err: struct {
                    writer: BufferedWriter,
                    exit_code: u8,
                },
                err: Syscall.Error,
            } = .idle,

            pub const ShellMvCheckTargetTask = struct {
                const print = bun.Output.scoped(.MvCheckTargetTask, false);
                mv: *Mv,

                cwd: bun.FileDescriptor,
                target: [:0]const u8,
                result: ?Maybe(?bun.FileDescriptor) = null,

                task: shell.eval.ShellTask(@This(), EventLoopKind, runFromThreadPool, runFromJs, print),

                pub fn runFromThreadPool(this: *@This()) void {
                    const fd = switch (Syscall.openat(this.cwd, this.target, os.O.RDONLY | os.O.DIRECTORY, 0)) {
                        .err => |e| {
                            switch (e.getErrno()) {
                                bun.C.E.NOTDIR => {
                                    this.result = .{ .result = null };
                                },
                                else => {
                                    this.result = .{ .err = e };
                                },
                            }
                            return;
                        },
                        .result => |fd| fd,
                    };
                    this.result = .{ .result = fd };
                }

                pub fn runFromJs(this: *@This()) void {
                    this.mv.checkTargetTaskDone(this);
                }
            };

            pub const ShellMvBatchedTask = struct {
                const BATCH_SIZE = 5;
                const print = bun.Output.scoped(.MvBatchedTask, false);

                mv: *Mv,
                sources: []const [*:0]const u8,
                target: [:0]const u8,
                target_fd: ?bun.FileDescriptor,
                cwd: bun.FileDescriptor,
                error_signal: *std.atomic.Value(bool),

                err: ?Syscall.Error = null,

                task: shell.eval.ShellTask(@This(), EventLoopKind, runFromThreadPool, runFromJs, print),

                pub fn runFromThreadPool(this: *@This()) void {
                    // Moving multiple entries into a directory
                    if (this.sources.len > 1) return this.moveMultipleIntoDir();

                    const src = this.sources[0][0..std.mem.len(this.sources[0]) :0];
                    // Moving entry into directory
                    if (this.target_fd) |fd| {
                        _ = fd;

                        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                        _ = this.moveInDir(src, &buf);
                        return;
                    }

                    switch (Syscall.renameat(this.cwd, src, this.cwd, this.target)) {
                        .err => |e| {
                            this.err = e;
                        },
                        else => {},
                    }
                }

                pub fn moveInDir(this: *@This(), src: [:0]const u8, buf: *[bun.MAX_PATH_BYTES]u8) bool {
                    var fixed_alloc = std.heap.FixedBufferAllocator.init(buf[0..bun.MAX_PATH_BYTES]);

                    const path_in_dir = std.fs.path.joinZ(fixed_alloc.allocator(), &[_][]const u8{
                        "./",
                        ResolvePath.basename(src),
                    }) catch {
                        this.err = Syscall.Error.fromCode(bun.C.E.NAMETOOLONG, .rename);
                        return false;
                    };

                    switch (Syscall.renameat(this.cwd, src, this.target_fd.?, path_in_dir)) {
                        .err => |e| {
                            const target_path = ResolvePath.joinZ(&[_][]const u8{
                                this.target,
                                ResolvePath.basename(src),
                            }, .auto);

                            this.err = e.withPath(bun.default_allocator.dupeZ(u8, target_path[0..]) catch bun.outOfMemory());
                            return false;
                        },
                        else => {},
                    }

                    return true;
                }

                fn moveMultipleIntoDir(this: *@This()) void {
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var fixed_alloc = std.heap.FixedBufferAllocator.init(buf[0..bun.MAX_PATH_BYTES]);

                    for (this.sources) |src_raw| {
                        if (this.error_signal.load(.SeqCst)) return;
                        defer fixed_alloc.reset();

                        const src = src_raw[0..std.mem.len(src_raw) :0];
                        if (!this.moveInDir(src, &buf)) {
                            return;
                        }
                    }
                }

                /// From the man pages of `mv`:
                /// ```txt
                /// As the rename(2) call does not work across file systems, mv uses cp(1) and rm(1) to accomplish the move.  The effect is equivalent to:
                ///     rm -f destination_path && \
                ///     cp -pRP source_file destination && \
                ///     rm -rf source_file
                /// ```
                fn moveAcrossFilesystems(this: *@This(), src: [:0]const u8, dest: [:0]const u8) void {
                    _ = this;
                    _ = src;
                    _ = dest;

                    // TODO
                }

                pub fn runFromJs(this: *@This()) void {
                    this.mv.batchedMoveTaskDone(this);
                }
            };

            pub fn start(this: *Mv) Maybe(void) {
                return this.next();
            }

            pub fn writeFailingError(this: *Mv, buf: []const u8, exit_code: u8) Maybe(void) {
                if (this.bltn.stderr.needsIO()) {
                    this.state = .{
                        .waiting_write_err = .{
                            .writer = BufferedWriter{
                                .fd = this.bltn.stderr.expectFd(),
                                .remain = buf,
                                .parent = BufferedWriter.ParentPtr.init(this),
                                .bytelist = this.bltn.ioBytelist(.stderr),
                            },
                            .exit_code = exit_code,
                        },
                    };
                    this.state.waiting_write_err.writer.writeIfPossible(false);
                    return Maybe(void).success;
                }

                if (this.bltn.writeNoIO(.stderr, buf).asErr()) |e| {
                    return .{ .err = e };
                }

                this.bltn.done(exit_code);
                return Maybe(void).success;
            }

            pub fn next(this: *Mv) Maybe(void) {
                while (!(this.state == .done or this.state == .err)) {
                    switch (this.state) {
                        .idle => {
                            if (this.parseOpts().asErr()) |e| {
                                const buf = switch (e) {
                                    .illegal_option => |opt_str| this.bltn.fmtErrorArena(.mv, "illegal option -- {s}\n", .{opt_str}),
                                    .show_usage => Builtin.Kind.mv.usageString(),
                                };

                                return this.writeFailingError(buf, 1);
                            }
                            this.state = .{
                                .check_target = .{
                                    .task = ShellMvCheckTargetTask{
                                        .mv = this,
                                        .cwd = this.bltn.parentCmd().base.interpreter.cwd_fd,
                                        .target = this.args.target,
                                        .task = .{
                                            .event_loop = JSC.VirtualMachine.get().eventLoop(),
                                        },
                                    },
                                    .state = .running,
                                },
                            };
                            this.state.check_target.task.task.schedule();
                            return Maybe(void).success;
                        },
                        .check_target => {
                            if (this.state.check_target.state == .running) return Maybe(void).success;
                            const check_target = &this.state.check_target;

                            if (comptime bun.Environment.allow_assert) {
                                std.debug.assert(check_target.task.result != null);
                            }

                            const maybe_fd: ?bun.FileDescriptor = switch (check_target.task.result.?) {
                                .err => |e| brk: {
                                    defer bun.default_allocator.free(e.path);
                                    switch (e.getErrno()) {
                                        bun.C.E.NOENT => {
                                            // Means we are renaming entry, not moving to a directory
                                            if (this.args.sources.len == 1) break :brk null;

                                            const buf = this.bltn.fmtErrorArena(.mv, "{s}: No such file or directory\n", .{this.args.target});
                                            return this.writeFailingError(buf, 1);
                                        },
                                        else => {
                                            const sys_err = e.toSystemError();
                                            const buf = this.bltn.fmtErrorArena(.mv, "{s}: {s}\n", .{ sys_err.path.byteSlice(), sys_err.message.byteSlice() });
                                            return this.writeFailingError(buf, 1);
                                        },
                                    }
                                },
                                .result => |maybe_fd| maybe_fd,
                            };

                            // Trying to move multiple files into a file
                            if (maybe_fd == null and this.args.sources.len > 1) {
                                const buf = this.bltn.fmtErrorArena(.mv, "{s} is not a directory\n", .{this.args.target});
                                return this.writeFailingError(buf, 1);
                            }

                            const task_count = brk: {
                                const sources_len: f64 = @floatFromInt(this.args.sources.len);
                                const batch_size: f64 = @floatFromInt(ShellMvBatchedTask.BATCH_SIZE);
                                const task_count: usize = @intFromFloat(@ceil(sources_len / batch_size));
                                break :brk task_count;
                            };

                            this.args.target_fd = maybe_fd;
                            const cwd_fd = this.bltn.parentCmd().base.interpreter.cwd_fd;
                            const tasks = this.bltn.arena.allocator().alloc(ShellMvBatchedTask, task_count) catch bun.outOfMemory();
                            // Initialize tasks
                            {
                                var count = task_count;
                                const count_per_task = this.args.sources.len / ShellMvBatchedTask.BATCH_SIZE;
                                var i: usize = 0;
                                var j: usize = 0;
                                while (i < tasks.len -| 1) : (i += 1) {
                                    j += count_per_task;
                                    const sources = this.args.sources[j .. j + count_per_task];
                                    count -|= count_per_task;
                                    tasks[i] = ShellMvBatchedTask{
                                        .mv = this,
                                        .cwd = cwd_fd,
                                        .target = this.args.target,
                                        .target_fd = this.args.target_fd,
                                        .sources = sources,
                                        // We set this later
                                        .error_signal = undefined,
                                        .task = .{
                                            .event_loop = JSC.VirtualMachine.get().event_loop,
                                        },
                                    };
                                }

                                // Give remainder to last task
                                if (count > 0) {
                                    const sources = this.args.sources[j .. j + count];
                                    tasks[i] = ShellMvBatchedTask{
                                        .mv = this,
                                        .cwd = cwd_fd,
                                        .target = this.args.target,
                                        .target_fd = this.args.target_fd,
                                        .sources = sources,
                                        // We set this later
                                        .error_signal = undefined,
                                        .task = .{
                                            .event_loop = JSC.VirtualMachine.get().event_loop,
                                        },
                                    };
                                }
                            }

                            this.state = .{
                                .executing = .{
                                    .task_count = task_count,
                                    .error_signal = std.atomic.Value(bool).init(false),
                                    .tasks = tasks,
                                },
                            };

                            for (this.state.executing.tasks) |*t| {
                                t.error_signal = &this.state.executing.error_signal;
                                t.task.schedule();
                            }

                            return Maybe(void).success;
                        },
                        .executing => {
                            const exec = &this.state.executing;
                            _ = exec;
                            // if (exec.state == .idle) {
                            //     // 1. Check if target is directory or file
                            // }
                        },
                        .waiting_write_err => {
                            return Maybe(void).success;
                        },
                        .done, .err => unreachable,
                    }
                }

                if (this.state == .done) {
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                this.bltn.done(this.state.err.errno);
                return Maybe(void).success;
            }

            pub fn onBufferedWriterDone(this: *Mv, e: ?Syscall.Error) void {
                switch (this.state) {
                    .waiting_write_err => {
                        if (e != null) {
                            this.state.err = e.?;
                            _ = this.next();
                            return;
                        }
                        this.bltn.done(this.state.waiting_write_err.exit_code);
                        return;
                    },
                    else => @panic("Invalid state"),
                }
            }

            pub fn checkTargetTaskDone(this: *Mv, task: *ShellMvCheckTargetTask) void {
                _ = task;

                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .check_target);
                    std.debug.assert(this.state.check_target.task.result != null);
                }

                this.state.check_target.state = .done;
                _ = this.next();
                return;
            }

            pub fn batchedMoveTaskDone(this: *Mv, task: *ShellMvBatchedTask) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .executing);
                    std.debug.assert(this.state.executing.tasks_done < this.state.executing.task_count);
                }

                var exec = &this.state.executing;

                if (task.err) |err| {
                    exec.error_signal.store(true, .SeqCst);
                    if (exec.err == null) {
                        exec.err = err;
                    } else {
                        bun.default_allocator.free(err.path);
                    }
                }

                exec.tasks_done += 1;
                if (exec.tasks_done >= exec.task_count) {
                    if (exec.err) |err| {
                        const buf = this.bltn.fmtErrorArena(.ls, "{s}\n", .{err.toSystemError().message.byteSlice()});
                        _ = this.writeFailingError(buf, err.errno);
                        return;
                    }
                    this.state = .done;

                    _ = this.next();
                    return;
                }
            }

            pub fn deinit(this: *Mv) void {
                if (this.args.target_fd != null and this.args.target_fd.? != bun.invalid_fd) {
                    _ = Syscall.close(this.args.target_fd.?);
                }
            }

            const Opts = struct {
                /// `-f`
                ///
                /// Do not prompt for confirmation before overwriting the destination path.  (The -f option overrides any previous -i or -n options.)
                force_overwrite: bool = true,
                /// `-h`
                ///
                /// If the target operand is a symbolic link to a directory, do not follow it.  This causes the mv utility to rename the file source to the destination path target rather than moving source into the
                /// directory referenced by target.
                no_dereference: bool = false,
                /// `-i`
                ///
                /// Cause mv to write a prompt to standard error before moving a file that would overwrite an existing file.  If the response from the standard input begins with the character ‘y’ or ‘Y’, the move is
                /// attempted.  (The -i option overrides any previous -f or -n options.)
                interactive_mode: bool = false,
                /// `-n`
                ///
                /// Do not overwrite an existing file.  (The -n option overrides any previous -f or -i options.)
                no_overwrite: bool = false,
                /// `-v`
                ///
                /// Cause mv to be verbose, showing files after they are moved.
                verbose_output: bool = false,

                const ParseError = union(enum) {
                    illegal_option: []const u8,
                    show_usage,
                };
            };

            pub fn parseOpts(this: *Mv) Result(void, Opts.ParseError) {
                const filepath_args = switch (this.parseFlags()) {
                    .ok => |args| args,
                    .err => |e| return .{ .err = e },
                };

                if (filepath_args.len < 2) {
                    return .{ .err = .show_usage };
                }

                this.args.sources = filepath_args[0 .. filepath_args.len - 1];
                this.args.target = filepath_args[filepath_args.len - 1][0..std.mem.len(filepath_args[filepath_args.len - 1]) :0];

                return .ok;
            }

            pub fn parseFlags(this: *Mv) Result([]const [*:0]const u8, Opts.ParseError) {
                const args = this.bltn.argsSlice();
                var idx: usize = 0;
                if (args.len == 0) {
                    return .{ .err = .show_usage };
                }

                while (idx < args.len) : (idx += 1) {
                    const flag = args[idx];
                    switch (this.parseFlag(flag[0..std.mem.len(flag)])) {
                        .done => {
                            const filepath_args = args[idx..];
                            return .{ .ok = filepath_args };
                        },
                        .continue_parsing => {},
                        .illegal_option => |opt_str| return .{ .err = .{ .illegal_option = opt_str } },
                    }
                }

                return .{ .err = .show_usage };
            }

            pub fn parseFlag(this: *Mv, flag: []const u8) union(enum) { continue_parsing, done, illegal_option: []const u8 } {
                if (flag.len == 0) return .done;
                if (flag[0] != '-') return .done;

                const small_flags = flag[1..];
                for (small_flags) |char| {
                    switch (char) {
                        'f' => {
                            this.opts.force_overwrite = true;
                            this.opts.interactive_mode = false;
                            this.opts.no_overwrite = false;
                        },
                        'h' => {
                            this.opts.no_dereference = true;
                        },
                        'i' => {
                            this.opts.interactive_mode = true;
                            this.opts.force_overwrite = false;
                            this.opts.no_overwrite = false;
                        },
                        'n' => {
                            this.opts.no_overwrite = true;
                            this.opts.force_overwrite = false;
                            this.opts.interactive_mode = false;
                        },
                        'v' => {
                            this.opts.verbose_output = true;
                        },
                        else => {
                            return .{ .illegal_option = "-" };
                        },
                    }
                }

                return .continue_parsing;
            }
        };

        pub const Rm = struct {
            bltn: *Builtin,
            opts: Opts,
            state: union(enum) {
                idle,
                parse_opts: struct {
                    args_slice: []const [*:0]const u8,
                    idx: u32 = 0,
                    state: union(enum) {
                        normal,
                        wait_write_err: BufferedWriter,
                    } = .normal,
                },
                exec: struct {
                    // task: RmTask,
                    filepath_args: []const [*:0]const u8,
                    total_tasks: usize,
                    err: ?Syscall.Error = null,
                    lock: std.Thread.Mutex = std.Thread.Mutex{},
                    error_signal: std.atomic.Value(bool) = .{ .raw = false },
                    state: union(enum) {
                        idle,
                        waiting: struct {
                            tasks_done: usize = 0,
                        },
                        waiting_but_errored: struct {
                            tasks_done: usize,
                            error_writer: ?BufferedWriter = null,
                        },

                        pub fn tasksDone(this: *@This()) usize {
                            return switch (this.*) {
                                .idle => 0,
                                .waiting => this.waiting.tasks_done,
                                .waiting_but_errored => this.waiting_but_errored.tasks_done,
                            };
                        }
                    },
                },
                done,
                err: Syscall.Error,
            } = .idle,

            pub const Opts = struct {
                /// `--no-preserve-root` / `--preserve-root`
                ///
                /// If set to false, then allow the recursive removal of the root directory.
                /// Safety feature to prevent accidental deletion of the root directory.
                preserve_root: bool = true,

                /// `-f`, `--force`
                ///
                /// Ignore nonexistent files and arguments, never prompt.
                force: bool = false,

                /// Configures how the user should be prompted on removal of files.
                prompt_behaviour: PromptBehaviour = .never,

                /// `-r`, `-R`, `--recursive`
                ///
                /// Remove directories and their contents recursively.
                recursive: bool = false,

                /// `-v`, `--verbose`
                ///
                /// Explain what is being done (prints which files/dirs are being deleted).
                verbose: bool = false,

                /// `-d`, `--dir`
                ///
                /// Remove empty directories. This option permits you to remove a directory
                /// without specifying `-r`/`-R`/`--recursive`, provided that the directory is
                /// empty.
                remove_empty_dirs: bool = false,

                const PromptBehaviour = union(enum) {
                    /// `--interactive=never`
                    ///
                    /// Default
                    never,

                    /// `-I`, `--interactive=once`
                    ///
                    /// Once before removing more than three files, or when removing recursively.
                    once: struct {
                        removed_count: u32 = 0,
                    },

                    /// `-i`, `--interactive=always`
                    ///
                    /// Prompt before every removal.
                    always,
                };
            };

            pub fn start(this: *Rm) Maybe(void) {
                return this.next();
            }

            pub noinline fn next(this: *Rm) Maybe(void) {
                while (this.state != .done and this.state != .err) {
                    switch (this.state) {
                        .idle => {
                            this.state = .{
                                .parse_opts = .{
                                    .args_slice = this.bltn.argsSlice(),
                                },
                            };
                            continue;
                        },
                        .parse_opts => {
                            var parse_opts = &this.state.parse_opts;
                            switch (parse_opts.state) {
                                .normal => {
                                    // This means there were no arguments or only
                                    // flag arguments meaning no positionals, in
                                    // either case we must print the usage error
                                    // string
                                    if (parse_opts.idx >= parse_opts.args_slice.len) {
                                        const error_string = Builtin.Kind.usageString(.rm);
                                        if (this.bltn.stderr.needsIO()) {
                                            parse_opts.state = .{
                                                .wait_write_err = BufferedWriter{
                                                    .fd = this.bltn.stderr.expectFd(),
                                                    .remain = error_string,
                                                    .parent = BufferedWriter.ParentPtr.init(this),
                                                    .bytelist = this.bltn.ioBytelist(.stderr),
                                                },
                                            };
                                            parse_opts.state.wait_write_err.writeIfPossible(false);
                                            return Maybe(void).success;
                                        }

                                        switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                            .result => {},
                                            .err => |e| return Maybe(void).initErr(e),
                                        }
                                        this.bltn.done(1);
                                        return Maybe(void).success;
                                    }

                                    const idx = parse_opts.idx;

                                    const arg_raw = parse_opts.args_slice[idx];
                                    const arg = arg_raw[0..std.mem.len(arg_raw)];

                                    switch (parseFlag(&this.opts, this.bltn, arg)) {
                                        .continue_parsing => {
                                            parse_opts.idx += 1;
                                            continue;
                                        },
                                        .done => {
                                            if (this.opts.recursive) {
                                                this.opts.remove_empty_dirs = true;
                                            }

                                            if (this.opts.prompt_behaviour != .never) {
                                                const buf = "rm: \"-i\" is not supported yet";
                                                if (this.bltn.stderr.needsIO()) {
                                                    parse_opts.state = .{
                                                        .wait_write_err = BufferedWriter{
                                                            .fd = this.bltn.stderr.expectFd(),
                                                            .remain = buf,
                                                            .parent = BufferedWriter.ParentPtr.init(this),
                                                            .bytelist = this.bltn.ioBytelist(.stderr),
                                                        },
                                                    };
                                                    parse_opts.state.wait_write_err.writeIfPossible(false);
                                                    continue;
                                                }

                                                if (this.bltn.writeNoIO(.stderr, buf).asErr()) |e|
                                                    return Maybe(void).initErr(e);

                                                this.bltn.done(1);
                                                return Maybe(void).success;
                                            }

                                            const filepath_args_start = idx;
                                            const filepath_args = parse_opts.args_slice[filepath_args_start..];

                                            // Check that non of the paths will delete the root
                                            {
                                                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                                                const cwd = switch (Syscall.getcwd(&buf)) {
                                                    .err => |err| {
                                                        return .{ .err = err };
                                                    },
                                                    .result => |cwd| cwd,
                                                };

                                                for (filepath_args) |filepath| {
                                                    const path = filepath[0..std.mem.len(filepath)];
                                                    const resolved_path = if (ResolvePath.Platform.auto.isAbsolute(path)) path else bun.path.join(&[_][]const u8{ cwd, path }, .auto);
                                                    const is_root = if (comptime bun.Environment.isWindows) brk: {
                                                        const disk_designator = std.fs.path.diskDesignator(resolved_path);
                                                        // TODO is this check correct?
                                                        break :brk std.mem.eql(u8, disk_designator, resolved_path);
                                                    } else std.mem.eql(u8, resolved_path, "/");

                                                    if (is_root) {
                                                        const error_string = this.bltn.fmtErrorArena(.rm, "\"{s}\" may not be removed\n", .{resolved_path});
                                                        if (this.bltn.stderr.needsIO()) {
                                                            parse_opts.state = .{
                                                                .wait_write_err = BufferedWriter{
                                                                    .fd = this.bltn.stderr.expectFd(),
                                                                    .remain = error_string,
                                                                    .parent = BufferedWriter.ParentPtr.init(this),
                                                                    .bytelist = this.bltn.ioBytelist(.stderr),
                                                                },
                                                            };
                                                            parse_opts.state.wait_write_err.writeIfPossible(false);
                                                            return Maybe(void).success;
                                                        }

                                                        switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                                            .result => {},
                                                            .err => |e| return Maybe(void).initErr(e),
                                                        }
                                                        this.bltn.done(1);
                                                        return Maybe(void).success;
                                                    }
                                                }
                                            }

                                            const total_tasks = filepath_args.len;
                                            this.state = .{
                                                .exec = .{
                                                    .filepath_args = filepath_args,
                                                    .total_tasks = total_tasks,
                                                    .state = .idle,
                                                },
                                            };
                                            // this.state.exec.task.schedule();
                                            // return Maybe(void).success;
                                            continue;
                                        },
                                        .illegal_option => {
                                            const error_string = "rm: illegal option -- -\n";
                                            if (this.bltn.stderr.needsIO()) {
                                                parse_opts.state = .{
                                                    .wait_write_err = BufferedWriter{
                                                        .fd = this.bltn.stderr.expectFd(),
                                                        .remain = error_string,
                                                        .parent = BufferedWriter.ParentPtr.init(this),
                                                        .bytelist = this.bltn.ioBytelist(.stderr),
                                                    },
                                                };
                                                parse_opts.state.wait_write_err.writeIfPossible(false);
                                                return Maybe(void).success;
                                            }

                                            switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                                .result => {},
                                                .err => |e| return Maybe(void).initErr(e),
                                            }
                                            this.bltn.done(1);
                                            return Maybe(void).success;
                                        },
                                        .illegal_option_with_flag => {
                                            const flag = arg;
                                            const error_string = this.bltn.fmtErrorArena(.rm, "illegal option -- {s}\n", .{flag[1..]});
                                            if (this.bltn.stderr.needsIO()) {
                                                parse_opts.state = .{
                                                    .wait_write_err = BufferedWriter{
                                                        .fd = this.bltn.stderr.expectFd(),
                                                        .remain = error_string,
                                                        .parent = BufferedWriter.ParentPtr.init(this),
                                                        .bytelist = this.bltn.ioBytelist(.stderr),
                                                    },
                                                };
                                                parse_opts.state.wait_write_err.writeIfPossible(false);
                                                return Maybe(void).success;
                                            }

                                            switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                                .result => {},
                                                .err => |e| return Maybe(void).initErr(e),
                                            }
                                            this.bltn.done(1);
                                            return Maybe(void).success;
                                        },
                                    }
                                },
                                .wait_write_err => {
                                    // Errored
                                    if (parse_opts.state.wait_write_err.err) |e| {
                                        this.state = .{ .err = e };
                                        continue;
                                    }

                                    // Done writing
                                    if (this.state.parse_opts.state.wait_write_err.remain.len == 0) {
                                        this.state = .done;
                                        continue;
                                    }

                                    // yield execution to continue writing
                                    return Maybe(void).success;
                                },
                            }
                        },
                        .exec => {
                            // Schedule task
                            if (this.state.exec.state == .idle) {
                                this.state.exec.state = .{ .waiting = .{} };
                                for (this.state.exec.filepath_args) |root_raw| {
                                    const root = root_raw[0..std.mem.len(root_raw)];
                                    const root_path_string = bun.PathString.init(root[0..root.len]);
                                    const is_absolute = ResolvePath.Platform.auto.isAbsolute(root);
                                    var task = ShellRmTask.create(root_path_string, this, &this.state.exec.error_signal, is_absolute);
                                    task.schedule();
                                    // task.
                                }
                            }

                            // do nothing
                            return Maybe(void).success;
                        },
                        .done, .err => unreachable,
                    }
                }

                if (this.state == .done) {
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                if (this.state == .err) {
                    this.bltn.done(this.state.err.errno);
                    return Maybe(void).success;
                }

                return Maybe(void).success;
            }

            pub fn onBufferedWriterDone(this: *Rm, e: ?Syscall.Error) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert((this.state == .parse_opts and this.state.parse_opts.state == .wait_write_err) or
                        (this.state == .exec and
                        this.state.exec.state == .waiting_but_errored and
                        this.state.exec.state.waiting_but_errored.error_writer != null));
                }

                if (this.state == .exec and this.state.exec.state == .waiting_but_errored) {
                    if (this.state.exec.state.tasksDone() >= this.state.exec.total_tasks) {
                        this.state = .{ .err = this.state.exec.err.? };
                        _ = this.next();
                        return;
                    }
                    return;
                }

                if (e != null) {
                    this.state = .{ .err = e.? };
                    this.bltn.done(e.?.errno);
                    return;
                }

                this.bltn.done(1);
                return;
            }

            pub fn writeToStdoutFromAsyncTask(this: *Rm, comptime fmt: []const u8, args: anytype) Maybe(void) {
                const buf = this.rm.bltn.fmtErrorArena(null, fmt, args);
                if (!this.rm.bltn.stdout.needsIO()) {
                    this.state.exec.lock.lock();
                    defer this.state.exec.lock.unlock();
                    return switch (this.rm.bltn.writeNoIO(.stdout, buf)) {
                        .result => Maybe(void).success,
                        .err => |e| Maybe(void).initErr(e),
                    };
                }

                var written: usize = 0;
                while (written < buf.len) : (written += switch (Syscall.write(this.rm.bltn.stdout.fd, buf)) {
                    .err => |e| return Maybe(void).initErr(e),
                    .result => |n| n,
                }) {}

                return Maybe(void).success;
            }

            pub fn deinit(this: *Rm) void {
                _ = this;
            }

            const ParseFlagsResult = enum {
                continue_parsing,
                done,
                illegal_option,
                illegal_option_with_flag,
            };

            fn parseFlag(this: *Opts, bltn: *Builtin, flag: []const u8) ParseFlagsResult {
                _ = bltn;
                if (flag.len == 0) return .done;
                if (flag[0] != '-') return .done;
                if (flag.len > 2 and flag[1] == '-') {
                    if (bun.strings.eqlComptime(flag, "--preserve-root")) {
                        this.preserve_root = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--no-preserve-root")) {
                        this.preserve_root = false;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--recursive")) {
                        this.recursive = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--verbose")) {
                        this.verbose = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--dir")) {
                        this.remove_empty_dirs = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--interactive=never")) {
                        this.prompt_behaviour = .never;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--interactive=once")) {
                        this.prompt_behaviour = .{ .once = .{} };
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--interactive=always")) {
                        this.prompt_behaviour = .always;
                        return .continue_parsing;
                    }

                    // try bltn.write_err(&bltn.stderr, .rm, "illegal option -- -\n", .{});
                    return .illegal_option;
                }

                const small_flags = flag[1..];
                for (small_flags) |char| {
                    switch (char) {
                        'f' => {
                            this.force = true;
                            this.prompt_behaviour = .never;
                        },
                        'r', 'R' => {
                            this.recursive = true;
                        },
                        'v' => {
                            this.verbose = true;
                        },
                        'd' => {
                            this.remove_empty_dirs = true;
                        },
                        'i' => {
                            this.prompt_behaviour = .{ .once = .{} };
                        },
                        'I' => {
                            this.prompt_behaviour = .always;
                        },
                        else => {
                            // try bltn.write_err(&bltn.stderr, .rm, "illegal option -- {s}\n", .{flag[1..]});
                            return .illegal_option_with_flag;
                        },
                    }
                }

                return .continue_parsing;
            }

            /// Error messages formatted to match bash
            fn taskErrorToString(this: *Rm, err: Syscall.Error) []const u8 {
                return switch (err.getErrno()) {
                    bun.C.E.NOENT => this.bltn.fmtErrorArena(.rm, "{s}: No such file or directory\n", .{err.path}),
                    bun.C.E.NAMETOOLONG => this.bltn.fmtErrorArena(.rm, "{s}: File name too long\n", .{err.path}),
                    bun.C.E.ISDIR => this.bltn.fmtErrorArena(.rm, "{s}: is a directory\n", .{err.path}),
                    bun.C.E.NOTEMPTY => this.bltn.fmtErrorArena(.rm, "{s}: Directory not empty\n", .{err.path}),
                    else => err.toSystemError().message.byteSlice(),
                };
            }

            pub fn asyncTaskDone(this: *Rm, task: *ShellRmTask) void {
                var exec = &this.state.exec;
                const tasks_done = switch (exec.state) {
                    .idle => @panic("Invalid state"),
                    .waiting => brk: {
                        exec.state.waiting.tasks_done += 1;
                        const amt = exec.state.waiting.tasks_done;
                        if (task.err) |err| {
                            if (this.state.exec.err == null) {
                                this.state.exec.err = err;
                                const error_string = this.taskErrorToString(err);

                                exec.state = .{
                                    .waiting_but_errored = .{
                                        .tasks_done = amt,
                                    },
                                };

                                if (this.bltn.stderr.needsIO()) {
                                    exec.state.waiting_but_errored.error_writer = BufferedWriter{
                                        .fd = this.bltn.stderr.expectFd(),
                                        .remain = error_string,
                                        .parent = BufferedWriter.ParentPtr.init(this),
                                        .bytelist = this.bltn.ioBytelist(.stderr),
                                    };
                                    exec.state.waiting_but_errored.error_writer.?.writeIfPossible(false);
                                    return;
                                }

                                switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                    .result => {},
                                    .err => {},
                                }
                            } else {
                                this.state.exec.state = .{
                                    .waiting_but_errored = .{
                                        .tasks_done = amt,
                                    },
                                };
                            }
                        }
                        break :brk amt;
                    },
                    .waiting_but_errored => brk: {
                        exec.state.waiting_but_errored.tasks_done += 1;
                        break :brk exec.state.waiting_but_errored.tasks_done;
                    },
                };

                if (tasks_done >= this.state.exec.total_tasks) {
                    if (exec.state == .waiting_but_errored) {
                        if (exec.state.waiting_but_errored.error_writer) |*writer| {
                            if (!writer.isDone()) {
                                // Need to keep waiting
                                return;
                            }
                        }

                        const err = this.state.exec.err.?;
                        this.state = .{
                            .err = err,
                        };
                    }

                    this.state = .done;
                    _ = this.next();
                    return;
                }
            }

            pub const ShellRmTask = struct {
                const print = bun.Output.scoped(.AsyncRmTask, false);

                // const MAX_FDS_OPEN: u8 = 16;

                rm: *Rm,
                opts: Opts,

                root_task: DirTask,
                root_path: bun.PathString = bun.PathString.empty,
                root_is_absolute: bool,

                // fds_opened: u8 = 0,

                error_signal: *std.atomic.Value(bool),
                err_mutex: bun.Lock = bun.Lock.init(),
                err: ?Syscall.Error = null,

                event_loop: EventLoopRef,
                concurrent_task: EventLoopTask = .{},
                task: JSC.WorkPoolTask = .{
                    .callback = workPoolCallback,
                },

                const ParentRmTask = @This();

                pub const DirTask = struct {
                    task_manager: *ParentRmTask,
                    parent_task: ?*DirTask,
                    path: [:0]const u8,
                    subtask_count: std.atomic.Value(usize),
                    need_to_wait: bool = false,
                    kind_hint: EntryKindHint,
                    task: JSC.WorkPoolTask = .{ .callback = runFromThreadPool },

                    const EntryKindHint = enum { idk, dir, file };

                    pub fn runFromThreadPool(task: *JSC.WorkPoolTask) void {
                        var this: *DirTask = @fieldParentPtr(DirTask, "task", task);
                        this.runFromThreadPoolImpl();
                    }

                    fn runFromThreadPoolImpl(this: *DirTask) void {
                        defer this.postRun();

                        switch (this.task_manager.removeEntry(this, ResolvePath.Platform.auto.isAbsolute(this.path[0..this.path.len]))) {
                            .err => |err| {
                                print("DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
                                this.task_manager.err_mutex.lock();
                                defer this.task_manager.err_mutex.unlock();
                                if (this.task_manager.err == null) {
                                    this.task_manager.err = err;
                                    this.task_manager.error_signal.store(true, .SeqCst);
                                } else {
                                    bun.default_allocator.free(err.path);
                                }
                            },
                            .result => {},
                        }
                    }

                    fn handleErr(this: *DirTask, err: Syscall.Error) void {
                        print("DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
                        this.task_manager.err_mutex.lock();
                        defer this.task_manager.err_mutex.unlock();
                        if (this.task_manager.err == null) {
                            this.task_manager.err = err;
                            this.task_manager.error_signal.store(true, .SeqCst);
                        } else {
                            bun.default_allocator.free(err.path);
                        }
                    }

                    pub fn postRun(this: *DirTask) void {

                        // All entries including recursive directories were deleted
                        if (this.need_to_wait) return;

                        if (this.subtask_count.fetchSub(1, .SeqCst) == 1) {
                            defer this.deinit();

                            // If we have a parent and we are the last child
                            if (this.parent_task != null and this.parent_task.?.subtask_count.fetchSub(1, .SeqCst) == 2) {
                                this.parent_task.?.finishAfterWaitingForChildren();
                                return;
                            }

                            // Otherwise we are root task
                            this.task_manager.finishConcurrently();
                        }

                        // Otherwise need to wait
                    }

                    pub fn finishAfterWaitingForChildren(this: *DirTask) void {
                        this.need_to_wait = false;
                        defer this.postRun();
                        if (this.task_manager.error_signal.load(.SeqCst)) {
                            return;
                        }

                        switch (this.task_manager.removeEntryDirAfterChildren(this)) {
                            .err => |e| {
                                print("DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(e.getErrno()), e.path });
                                this.task_manager.err_mutex.lock();
                                defer this.task_manager.err_mutex.unlock();
                                if (this.task_manager.err == null) {
                                    this.task_manager.err = e;
                                } else {
                                    bun.default_allocator.free(e.path);
                                }
                            },
                            .result => {},
                        }
                    }

                    pub fn deinit(this: *DirTask) void {
                        // The root's path string is from Rm's argv so don't deallocate it
                        // And root is field on the struct of the AsyncRmTask so don't deallocate it either
                        if (this.parent_task != null) {
                            bun.default_allocator.free(this.path);
                            bun.default_allocator.destroy(this);
                        }
                    }
                };

                pub fn create(root_path: bun.PathString, rm: *Rm, error_signal: *std.atomic.Value(bool), is_absolute: bool) *ShellRmTask {
                    const task = bun.default_allocator.create(ShellRmTask) catch bun.outOfMemory();
                    task.* = ShellRmTask{
                        .rm = rm,
                        .opts = rm.opts,
                        .root_path = root_path,
                        .root_task = DirTask{
                            .task_manager = task,
                            .parent_task = null,
                            .path = root_path.sliceAssumeZ(),
                            .subtask_count = std.atomic.Value(usize).init(1),
                            .kind_hint = .idk,
                        },
                        // .event_loop = JSC.VirtualMachine.get().event_loop,
                        .event_loop = event_loop_ref.get(),
                        .error_signal = error_signal,
                        .root_is_absolute = is_absolute,
                    };
                    return task;
                }

                pub fn schedule(this: *@This()) void {
                    JSC.WorkPool.schedule(&this.task);
                }

                pub fn enqueue(this: *ShellRmTask, parent_dir: *DirTask, path: [:0]const u8, is_absolute: bool, kind_hint: DirTask.EntryKindHint) void {
                    if (this.error_signal.load(.SeqCst)) {
                        return;
                    }
                    const new_path = this.join(
                        bun.default_allocator,
                        &[_][]const u8{
                            parent_dir.path[0..parent_dir.path.len],
                            path[0..path.len],
                        },
                        is_absolute,
                    );
                    this.enqueueNoJoin(parent_dir, new_path, kind_hint);
                }

                pub fn enqueueNoJoin(this: *ShellRmTask, parent_task: *DirTask, path: [:0]const u8, kind_hint: DirTask.EntryKindHint) void {
                    if (this.error_signal.load(.SeqCst)) {
                        return;
                    }

                    var subtask = bun.default_allocator.create(DirTask) catch bun.outOfMemory();
                    subtask.* = DirTask{
                        .task_manager = this,
                        .path = path,
                        .parent_task = parent_task,
                        .subtask_count = std.atomic.Value(usize).init(1),
                        .kind_hint = kind_hint,
                    };
                    std.debug.assert(parent_task.subtask_count.fetchAdd(1, .Monotonic) > 0);
                    print("enqueue: {s}", .{path});
                    JSC.WorkPool.schedule(&subtask.task);
                }

                pub fn verboseDeleted(this: *@This(), path: [:0]const u8) Maybe(void) {
                    print("deleted: {s}", .{path[0..path.len]});
                    _ = this;
                    return Maybe(void).success;
                }

                pub fn finishConcurrently(this: *ShellRmTask) void {
                    if (comptime EventLoopKind == .js) {
                        this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
                    } else {
                        this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, "runFromMainThreadMini"));
                    }
                }

                pub fn bufJoin(buf: *[bun.MAX_PATH_BYTES]u8, parts: []const []const u8, syscall_tag: Syscall.Tag) Maybe([:0]u8) {
                    var fixed_buf_allocator = std.heap.FixedBufferAllocator.init(buf[0..]);
                    return .{ .result = std.fs.path.joinZ(fixed_buf_allocator.allocator(), parts) catch return Maybe([:0]u8).initErr(Syscall.Error.fromCode(bun.C.E.NAMETOOLONG, syscall_tag)) };
                }

                pub fn removeEntry(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool) Maybe(void) {
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    switch (dir_task.kind_hint) {
                        .idk, .file => return this.removeEntryFile(dir_task, dir_task.path, is_absolute, &buf, false),
                        .dir => return this.removeEntryDir(dir_task, is_absolute, &buf),
                    }
                }

                fn removeEntryDir(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                    if (!(this.opts.recursive or this.opts.remove_empty_dirs)) {
                        return Maybe(void).initErr(Syscall.Error.fromCode(bun.C.E.ISDIR, .TODO).withPath(bun.default_allocator.dupeZ(u8, dir_task.path) catch bun.outOfMemory()));
                    }

                    const path = dir_task.path;
                    const dirfd = bun.toFD(std.fs.cwd().fd);
                    const flags = os.O.DIRECTORY | os.O.RDONLY;
                    const fd = switch (Syscall.openat(dirfd, path, flags, 0)) {
                        .result => |fd| fd,
                        .err => |e| {
                            switch (e.getErrno()) {
                                bun.C.E.NOENT => {
                                    if (this.opts.force) return this.verboseDeleted(path);
                                    return .{ .err = this.errorWithPath(e, path) };
                                },
                                bun.C.E.NOTDIR => {
                                    return this.removeEntryFile(dir_task, dir_task.path, is_absolute, buf, false);
                                },
                                else => return .{ .err = this.errorWithPath(e, path) },
                            }
                        },
                    };
                    defer {
                        _ = Syscall.close(fd);
                    }

                    if (this.error_signal.load(.SeqCst)) {
                        return Maybe(void).success;
                    }

                    var iterator = DirIterator.iterate(.{ .fd = bun.fdcast(fd) });
                    var entry = iterator.next();

                    var i: usize = 0;
                    while (switch (entry) {
                        .err => |err| {
                            return .{ .err = this.errorWithPath(err, path) };
                        },
                        .result => |ent| ent,
                    }) |current| : (entry = iterator.next()) {
                        // TODO this seems bad maybe better to listen to kqueue/epoll event
                        if (fastMod(i, 4) == 0 and this.error_signal.load(.SeqCst)) return Maybe(void).success;

                        defer i += 1;
                        switch (current.kind) {
                            .directory => {
                                this.enqueue(dir_task, current.name.sliceAssumeZ(), is_absolute, .dir);
                            },
                            else => {
                                const name = current.name.sliceAssumeZ();
                                const file_path = switch (ShellRmTask.bufJoin(
                                    buf,
                                    &[_][]const u8{
                                        path[0..path.len],
                                        name[0..name.len],
                                    },
                                    .unlink,
                                )) {
                                    .err => |e| return .{ .err = e },
                                    .result => |p| p,
                                };

                                switch (this.removeEntryFile(dir_task, file_path, is_absolute, buf, true)) {
                                    .err => |e| return .{ .err = this.errorWithPath(e, current.name.sliceAssumeZ()) },
                                    .result => {},
                                }
                            },
                        }
                    }

                    // Need to wait for children to finish
                    if (dir_task.subtask_count.load(.SeqCst) > 1) {
                        dir_task.need_to_wait = true;
                        return Maybe(void).success;
                    }

                    if (this.error_signal.load(.SeqCst)) return Maybe(void).success;

                    switch (Syscall.unlinkatWithFlags(dirfd, path, std.os.AT.REMOVEDIR)) {
                        .result => {
                            switch (this.verboseDeleted(path)) {
                                .err => |e| return .{ .err = e },
                                else => {},
                            }
                            return Maybe(void).success;
                        },
                        .err => |e| {
                            switch (e.getErrno()) {
                                bun.C.E.NOENT => {
                                    if (this.opts.force) {
                                        switch (this.verboseDeleted(path)) {
                                            .err => |e2| return .{ .err = e2 },
                                            else => {},
                                        }
                                        return Maybe(void).success;
                                    }

                                    return .{ .err = this.errorWithPath(e, path) };
                                },
                                else => return .{ .err = e },
                            }
                        },
                    }
                }

                fn removeEntryDirAfterChildren(this: *ShellRmTask, dir_task: *DirTask) Maybe(void) {
                    const dirfd = bun.toFD(std.fs.cwd().fd);
                    var treat_as_dir = true;
                    const fd: bun.FileDescriptor = handle_entry: while (true) {
                        if (treat_as_dir) {
                            switch (Syscall.openat(dirfd, dir_task.path, os.O.DIRECTORY | os.O.RDONLY, 0)) {
                                .err => |e| switch (e.getErrno()) {
                                    bun.C.E.NOENT => {
                                        if (this.opts.force) {
                                            if (this.verboseDeleted(dir_task.path).asErr()) |e2| return .{ .err = e2 };
                                            return Maybe(void).success;
                                        }
                                        return .{ .err = e };
                                    },
                                    bun.C.E.NOTDIR => {
                                        treat_as_dir = false;
                                        continue;
                                    },
                                    else => return .{ .err = e },
                                },
                                .result => |fd| break :handle_entry fd,
                            }
                        } else {
                            if (Syscall.unlinkat(dirfd, dir_task.path).asErr()) |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOENT => {
                                        if (this.opts.force) {
                                            if (this.verboseDeleted(dir_task.path).asErr()) |e2| return .{ .err = e2 };
                                            return Maybe(void).success;
                                        }
                                        return .{ .err = e };
                                    },
                                    bun.C.E.ISDIR => {
                                        treat_as_dir = true;
                                        continue;
                                    },
                                    bun.C.E.PERM => {
                                        // TODO should check if dir
                                        return .{ .err = e };
                                    },
                                    else => return .{ .err = e },
                                }
                            }
                            return Maybe(void).success;
                        }
                    };

                    defer {
                        _ = Syscall.close(fd);
                    }

                    switch (Syscall.unlinkatWithFlags(dirfd, dir_task.path, std.os.AT.REMOVEDIR)) {
                        .result => {
                            switch (this.verboseDeleted(dir_task.path)) {
                                .err => |e| return .{ .err = e },
                                else => {},
                            }
                            return Maybe(void).success;
                        },
                        .err => |e| {
                            switch (e.getErrno()) {
                                bun.C.E.NOENT => {
                                    if (this.opts.force) {
                                        if (this.verboseDeleted(dir_task.path).asErr()) |e2| return .{ .err = e2 };
                                        return Maybe(void).success;
                                    }
                                    return .{ .err = e };
                                },
                                else => return .{ .err = e },
                            }
                        },
                    }
                }

                fn removeEntryFile(
                    this: *ShellRmTask,
                    parent_dir_task: *DirTask,
                    path: [:0]const u8,
                    is_absolute: bool,
                    buf: *[bun.MAX_PATH_BYTES]u8,
                    comptime is_file_in_dir: bool,
                ) Maybe(void) {
                    const dirfd = bun.toFD(std.fs.cwd().fd);
                    switch (Syscall.unlinkatWithFlags(dirfd, path, 0)) {
                        .result => return this.verboseDeleted(path),
                        .err => |e| {
                            switch (e.getErrno()) {
                                bun.C.E.NOENT => {
                                    if (this.opts.force)
                                        return this.verboseDeleted(path);

                                    return .{ .err = this.errorWithPath(e, path) };
                                },
                                bun.C.E.ISDIR => {
                                    if (comptime is_file_in_dir) {
                                        this.enqueueNoJoin(parent_dir_task, path, .dir);
                                        return Maybe(void).success;
                                    }
                                    return this.removeEntryDir(parent_dir_task, is_absolute, buf);
                                },
                                // This might happen if the file is actually a directory
                                bun.C.E.PERM => {
                                    switch (builtin.os.tag) {
                                        // non-Linux POSIX systems return EPERM when trying to delete a directory, so
                                        // we need to handle that case specifically and translate the error
                                        .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris, .illumos => {
                                            // If we are allowed to delete directories then we can call `unlink`.
                                            // If `path` points to a directory, then it is deleted (if empty) or we handle it as a directory
                                            // If it's actually a file, we get an error so we don't need to call `stat` to check that.
                                            if (this.opts.recursive or this.opts.remove_empty_dirs) {
                                                return switch (Syscall.unlinkatWithFlags(dirfd, path, std.os.AT.REMOVEDIR)) {
                                                    // it was empty, we saved a syscall
                                                    .result => return this.verboseDeleted(path),
                                                    .err => |e2| {
                                                        return switch (e2.getErrno()) {
                                                            // not empty, process directory as we would normally
                                                            bun.C.E.NOTEMPTY => {
                                                                this.enqueueNoJoin(parent_dir_task, path, .dir);
                                                                return Maybe(void).success;
                                                            },
                                                            // actually a file, the error is a permissions error
                                                            bun.C.E.NOTDIR => .{ .err = this.errorWithPath(e, path) },
                                                            else => .{ .err = this.errorWithPath(e2, path) },
                                                        };
                                                    },
                                                };
                                            }

                                            // We don't know if it was an actual permissions error or it was a directory so we need to try to delete it as a directory
                                            if (comptime is_file_in_dir) {
                                                this.enqueueNoJoin(parent_dir_task, path, .dir);
                                                return Maybe(void).success;
                                            }
                                            return this.removeEntryDir(parent_dir_task, is_absolute, buf);
                                        },
                                        else => {},
                                    }

                                    return .{ .err = this.errorWithPath(e, path) };
                                },
                                else => return .{ .err = this.errorWithPath(e, path) },
                            }
                        },
                    }
                }

                fn errorWithPath(this: *ShellRmTask, err: Syscall.Error, path: [:0]const u8) Syscall.Error {
                    _ = this;
                    return err.withPath(bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory());
                }

                inline fn join(this: *ShellRmTask, alloc: Allocator, subdir_parts: []const []const u8, is_absolute: bool) [:0]const u8 {
                    _ = this;
                    if (!is_absolute) {
                        // If relative paths enabled, stdlib join is preferred over
                        // ResolvePath.joinBuf because it doesn't try to normalize the path
                        return std.fs.path.joinZ(alloc, subdir_parts) catch bun.outOfMemory();
                    }

                    const out = alloc.dupeZ(u8, bun.path.join(subdir_parts, .auto)) catch bun.outOfMemory();

                    return out;
                }

                pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
                    var this: *ShellRmTask = @fieldParentPtr(ShellRmTask, "task", task);
                    this.root_task.runFromThreadPoolImpl();
                }

                pub fn runFromMainThread(this: *ShellRmTask) void {
                    this.rm.asyncTaskDone(this);
                }

                pub fn runFromMainThreadMini(this: *ShellRmTask) void {
                    this.rm.asyncTaskDone(this);
                }

                pub fn deinit(this: *ShellRmTask) void {
                    bun.default_allocator.destroy(this);
                }
            };
        };
    };
}

inline fn fastMod(val: anytype, comptime rhs: comptime_int) @TypeOf(val) {
    const Value = @typeInfo(@TypeOf(val));
    if (Value != .Int) @compileError("LHS of fastMod should be an int");
    if (Value.Int.signedness != .unsigned) @compileError("LHS of fastMod should be unsigned");
    if (!comptime std.math.isPowerOfTwo(rhs)) @compileError("RHS of fastMod should be power of 2");

    return val & (rhs - 1);
}
