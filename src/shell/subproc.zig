const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const NetworkThread = bun.http.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../which.zig");
const Async = bun.Async;
// const IPC = @import("../bun.js/ipc.zig");
const uws = bun.uws;
const sh = bun.shell;

const PosixSpawn = bun.spawn;

const util = @import("./util.zig");

pub const Stdio = util.Stdio;
const FileSink = JSC.WebCore.FileSink;
// pub const ShellSubprocess = NewShellSubprocess(.js);
// pub const ShellSubprocessMini = NewShellSubprocess(.mini);

const StdioResult = if (Environment.isWindows) bun.spawn.WindowsSpawnResult.StdioResult else ?bun.FileDescriptor;

/// Used for captured writer
pub const ShellIO = struct {
    stdout: ?*sh.IOWriter = null,
    stderr: ?*sh.IOWriter = null,

    pub fn ref(this: *@This()) void {
        if (this.stdout) |io| io.ref();
        if (this.stderr) |io| io.ref();
    }

    pub fn deref(this: *@This()) void {
        if (this.stdout) |io| io.deref();
        if (this.stderr) |io| io.deref();
    }
};

const BufferedInput = struct {};

/// TODO Set this to interpreter
const ShellCmd = bun.shell.Interpreter.Cmd;

const log = Output.scoped(.SHELL_SUBPROC, false);

pub const ShellSubprocess = struct {
    const Subprocess = @This();

    pub const default_max_buffer_size = 1024 * 1024 * 4;
    pub const Process = bun.spawn.Process;

    cmd_parent: ?*ShellCmd = null,

    process: *Process,

    stdin: Writable = undefined,
    stdout: Readable = undefined,
    stderr: Readable = undefined,

    event_loop: JSC.EventLoopHandle,

    closed: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
    }) = .{},
    this_jsvalue: JSC.JSValue = .zero,

    flags: Flags = .{},

    pub const OutKind = util.OutKind;

    pub fn onStaticPipeWriterDone(this: *ShellSubprocess) void {
        log("Subproc(0x{x}) onStaticPipeWriterDone(cmd=0x{x}))", .{ @intFromPtr(this), if (this.cmd_parent) |cmd| @intFromPtr(cmd) else 0 });
        if (this.cmd_parent) |cmd| {
            cmd.bufferedInputClose();
        }
    }

    const Writable = union(enum) {
        pipe: *JSC.WebCore.FileSink,
        fd: bun.FileDescriptor,
        buffer: *StaticPipeWriter,
        memfd: bun.FileDescriptor,
        inherit: void,
        ignore: void,

        pub fn hasPendingActivity(this: *const Writable) bool {
            return switch (this.*) {
                // we mark them as .ignore when they are closed, so this must be true
                .pipe => true,
                .buffer => true,
                else => false,
            };
        }

        pub fn ref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(true);
                },
                .buffer => {
                    this.buffer.updateRef(true);
                },
                else => {},
            }
        }

        pub fn unref(this: *Writable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(false);
                },
                .buffer => {
                    this.buffer.updateRef(false);
                },
                else => {},
            }
        }

        // When the stream has closed we need to be notified to prevent a use-after-free
        // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
        pub fn onClose(this: *Writable, _: ?bun.sys.Error) void {
            switch (this.*) {
                .buffer => {
                    this.buffer.deref();
                },
                .pipe => {
                    this.pipe.deref();
                },
                else => {},
            }
            this.* = .{
                .ignore = {},
            };
        }
        pub fn onReady(_: *Writable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}
        pub fn onStart(_: *Writable) void {}

        pub fn init(
            stdio: Stdio,
            event_loop: JSC.EventLoopHandle,
            subprocess: *Subprocess,
            result: StdioResult,
        ) !Writable {
            assertStdioResult(result);

            if (Environment.isWindows) {
                switch (stdio) {
                    .pipe => {
                        if (result == .buffer) {
                            const pipe = JSC.WebCore.FileSink.createWithPipe(event_loop, result.buffer);

                            switch (pipe.writer.startWithCurrentPipe()) {
                                .result => {},
                                .err => |err| {
                                    _ = err; // autofix
                                    pipe.deref();
                                    return error.UnexpectedCreatingStdin;
                                },
                            }

                            // TODO: uncoment this when is ready, commented because was not compiling
                            // subprocess.weak_file_sink_stdin_ptr = pipe;
                            // subprocess.flags.has_stdin_destructor_called = false;

                            return Writable{
                                .pipe = pipe,
                            };
                        }
                        return Writable{ .inherit = {} };
                    },

                    .blob => |blob| {
                        return Writable{
                            .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                        };
                    },
                    .array_buffer => |array_buffer| {
                        return Writable{
                            .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                        };
                    },
                    .fd => |fd| {
                        return Writable{ .fd = fd };
                    },
                    .dup2 => |dup2| {
                        return Writable{ .fd = dup2.to.toFd() };
                    },
                    .inherit => {
                        return Writable{ .inherit = {} };
                    },
                    .memfd, .path, .ignore => {
                        return Writable{ .ignore = {} };
                    },
                    .ipc, .capture => {
                        return Writable{ .ignore = {} };
                    },
                }
            }
            switch (stdio) {
                .dup2 => {
                    // The shell never uses this
                    @panic("Unimplemented stdin dup2");
                },
                .pipe => {
                    // The shell never uses this
                    @panic("Unimplemented stdin pipe");
                },

                .blob => |blob| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                    };
                },
                .array_buffer => |array_buffer| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                    };
                },
                .memfd => |memfd| {
                    assert(memfd != bun.invalid_fd);
                    return Writable{ .memfd = memfd };
                },
                .fd => {
                    return Writable{ .fd = result.? };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .path, .ignore => {
                    return Writable{ .ignore = {} };
                },
                .ipc, .capture => {
                    return Writable{ .ignore = {} };
                },
            }
        }

        pub fn toJS(this: *Writable, globalThis: *JSC.JSGlobalObject, subprocess: *Subprocess) JSValue {
            return switch (this.*) {
                .fd => |fd| JSValue.jsNumber(fd),
                .memfd, .ignore => JSValue.jsUndefined(),
                .buffer, .inherit => JSValue.jsUndefined(),
                .pipe => |pipe| {
                    this.* = .{ .ignore = {} };
                    if (subprocess.process.hasExited() and !subprocess.flags.has_stdin_destructor_called) {
                        pipe.onAttachedProcessExit();
                        return pipe.toJS(globalThis);
                    } else {
                        subprocess.flags.has_stdin_destructor_called = false;
                        subprocess.weak_file_sink_stdin_ptr = pipe;
                        return pipe.toJSWithDestructor(
                            globalThis,
                            JSC.WebCore.SinkDestructor.Ptr.init(subprocess),
                        );
                    }
                },
            };
        }

        pub fn finalize(this: *Writable) void {
            const subprocess: *Subprocess = @fieldParentPtr("stdin", this);
            if (subprocess.this_jsvalue != .zero) {
                if (JSC.Codegen.JSSubprocess.stdinGetCached(subprocess.this_jsvalue)) |existing_value| {
                    JSC.WebCore.FileSink.JSSink.setDestroyCallback(existing_value, 0);
                }
            }

            return switch (this.*) {
                .pipe => |pipe| {
                    pipe.deref();

                    this.* = .{ .ignore = {} };
                },
                .buffer => {
                    this.buffer.updateRef(false);
                    this.buffer.deref();
                },
                .memfd => |fd| {
                    _ = bun.sys.close(fd);
                    this.* = .{ .ignore = {} };
                },
                .ignore => {},
                .fd, .inherit => {},
            };
        }

        pub fn close(this: *Writable) void {
            switch (this.*) {
                .pipe => |pipe| {
                    _ = pipe.end(null);
                },
                inline .memfd, .fd => |fd| {
                    _ = bun.sys.close(fd);
                    this.* = .{ .ignore = {} };
                },
                .buffer => {
                    this.buffer.close();
                },
                .ignore => {},
                .inherit => {},
            }
        }
    };

    pub const Readable = union(enum) {
        fd: bun.FileDescriptor,
        memfd: bun.FileDescriptor,
        pipe: *PipeReader,
        inherit: void,
        ignore: void,
        closed: void,
        buffer: []u8,

        pub fn ref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(true);
                },
                else => {},
            }
        }

        pub fn unref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    this.pipe.updateRef(false);
                },
                else => {},
            }
        }

        pub fn toSlice(this: *Readable) ?[]const u8 {
            switch (this.*) {
                .fd => return null,
                .pipe => {
                    var buf = this.pipe.reader.buffer();
                    this.pipe.buffer.fifo.close_on_empty_read = true;
                    this.pipe.readAll();

                    const bytes = buf.items[0..];
                    // this.pipe.buffer.internal_buffer = .{};

                    if (bytes.len > 0) {
                        return bytes;
                    }

                    return "";
                },
                .buffer => |buf| buf,
                .memfd => @panic("TODO"),
                else => {
                    return null;
                },
            }
        }

        pub fn init(out_type: bun.shell.Subprocess.OutKind, stdio: Stdio, shellio: ?*sh.IOWriter, event_loop: JSC.EventLoopHandle, process: *ShellSubprocess, result: StdioResult, allocator: std.mem.Allocator, max_size: u32, is_sync: bool) Readable {
            _ = allocator; // autofix
            _ = max_size; // autofix
            _ = is_sync; // autofix

            assertStdioResult(result);

            if (Environment.isWindows) {
                return switch (stdio) {
                    .inherit => Readable{ .inherit = {} },
                    .ipc, .dup2, .ignore => Readable{ .ignore = {} },
                    .path => Readable{ .ignore = {} },
                    .fd => |fd| Readable{ .fd = fd },
                    // blobs are immutable, so we should only ever get the case
                    // where the user passed in a Blob with an fd
                    .blob => Readable{ .ignore = {} },
                    .memfd => Readable{ .ignore = {} },
                    .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result, null, out_type) },
                    .array_buffer => {
                        const readable = Readable{ .pipe = PipeReader.create(event_loop, process, result, null, out_type) };
                        readable.pipe.buffered_output = .{
                            .array_buffer = .{ .buf = stdio.array_buffer, .i = 0 },
                        };
                        return readable;
                    },
                    .capture => Readable{ .pipe = PipeReader.create(event_loop, process, result, shellio, out_type) },
                };
            }

            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ipc, .dup2, .ignore => Readable{ .ignore = {} },
                .path => Readable{ .ignore = {} },
                .fd => Readable{ .fd = result.? },
                // blobs are immutable, so we should only ever get the case
                // where the user passed in a Blob with an fd
                .blob => Readable{ .ignore = {} },
                .memfd => Readable{ .memfd = stdio.memfd },
                .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result, null, out_type) },
                .array_buffer => {
                    const readable = Readable{ .pipe = PipeReader.create(event_loop, process, result, null, out_type) };
                    readable.pipe.buffered_output = .{
                        .array_buffer = .{ .buf = stdio.array_buffer, .i = 0 },
                    };
                    return readable;
                },
                .capture => Readable{ .pipe = PipeReader.create(event_loop, process, result, shellio, out_type) },
            };
        }

        pub fn close(this: *Readable) void {
            switch (this.*) {
                inline .memfd, .fd => |fd| {
                    this.* = .{ .closed = {} };
                    _ = bun.sys.close(fd);
                },
                .pipe => {
                    this.pipe.close();
                },
                else => {},
            }
        }

        pub fn finalize(this: *Readable) void {
            switch (this.*) {
                inline .memfd, .fd => |fd| {
                    this.* = .{ .closed = {} };
                    _ = bun.sys.close(fd);
                },
                .pipe => |pipe| {
                    defer pipe.detach();
                    this.* = .{ .closed = {} };
                },
                else => {},
            }
        }
    };

    pub const Flags = packed struct(u3) {
        is_sync: bool = false,
        killed: bool = false,
        waiting_for_onexit: bool = false,
    };
    pub const SignalCode = bun.SignalCode;

    // pub const Pipe = struct {
    //     writer: Writer = Writer{},
    //     parent: *Subprocess,
    //     src: WriterSrc,

    //     writer: ?CapturedBufferedWriter = null,

    //     status: Status = .{
    //         .pending = {},
    //     },
    // };

    pub const StaticPipeWriter = JSC.Subprocess.NewStaticPipeWriter(ShellSubprocess);

    pub fn getIO(this: *Subprocess, comptime out_kind: OutKind) *Readable {
        switch (out_kind) {
            .stdout => return &this.stdout,
            .stderr => return &this.stderr,
        }
    }

    pub fn hasExited(this: *const Subprocess) bool {
        return this.process.hasExited();
    }

    pub fn ref(this: *Subprocess) void {
        this.process.enableKeepingEventLoopAlive();

        // this.stdin.ref();
        // }

        // if (!this.hasCalledGetter(.stdout)) {
        this.stdout.ref();
        // }

        // if (!this.hasCalledGetter(.stderr)) {
        this.stderr.ref();
        // }
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn unref(this: *@This(), comptime _: bool) void {
        this.process.disableKeepingEventLoopAlive();

        this.stdout.unref();

        this.stderr.unref();
    }

    pub fn hasKilled(this: *const @This()) bool {
        return this.process.hasKilled();
    }

    pub fn tryKill(this: *@This(), sig: i32) JSC.Maybe(void) {
        if (this.hasExited()) {
            return .{ .result = {} };
        }

        return this.process.kill(@intCast(sig));
    }

    // fn hasCalledGetter(this: *Subprocess, comptime getter: @Type(.EnumLiteral)) bool {
    //     return this.observable_getters.contains(getter);
    // }

    fn closeProcess(this: *@This()) void {
        this.process.exit_handler = .{};
        this.process.close();
        this.process.deref();
    }

    pub fn disconnect(this: *@This()) void {
        _ = this;
        // if (this.ipc_mode == .none) return;
        // this.ipc.socket.close(0, null);
        // this.ipc_mode = .none;
    }

    pub fn closeIO(this: *@This(), comptime io: @Type(.EnumLiteral)) void {
        if (this.closed.contains(io)) return;
        log("close IO {s}", .{@tagName(io)});
        this.closed.insert(io);

        // If you never referenced stdout/stderr, they won't be garbage collected.
        //
        // That means:
        //   1. We need to stop watching them
        //   2. We need to free the memory
        //   3. We need to halt any pending reads (1)
        // if (!this.hasCalledGetter(io)) {
        @field(this, @tagName(io)).finalize();
        // } else {
        // @field(this, @tagName(io)).close();
        // }
    }

    // This must only be run once per Subprocess
    pub fn finalizeSync(this: *@This()) void {
        this.closeProcess();

        // this.closeIO(.stdin);
        this.closeIO(.stdout);
        this.closeIO(.stderr);
    }

    pub fn onCloseIO(this: *Subprocess, kind: StdioKind) void {
        switch (kind) {
            .stdin => {
                switch (this.stdin) {
                    .pipe => |pipe| {
                        pipe.signal.clear();
                        pipe.deref();
                        this.stdin = .{ .ignore = {} };
                    },
                    .buffer => {
                        this.onStaticPipeWriterDone();
                        this.stdin.buffer.source.detach();
                        this.stdin.buffer.deref();
                        this.stdin = .{ .ignore = {} };
                    },
                    else => {},
                }
            },
            inline .stdout, .stderr => |tag| {
                const out: *Readable = &@field(this, @tagName(tag));
                switch (out.*) {
                    .pipe => |pipe| {
                        if (pipe.state == .done) {
                            out.* = .{ .buffer = pipe.state.done };
                            pipe.state = .{ .done = &.{} };
                        } else {
                            out.* = .{ .ignore = {} };
                        }
                        pipe.deref();
                    },
                    else => {},
                }
            },
        }
    }

    pub fn deinit(this: *@This()) void {
        this.finalizeSync();
        log("Deinit", .{});
        bun.default_allocator.destroy(this);
    }

    pub const SpawnArgs = struct {
        arena: *bun.ArenaAllocator,
        cmd_parent: ?*ShellCmd = null,

        override_env: bool = false,
        env_array: std.ArrayListUnmanaged(?[*:0]const u8) = .{
            .items = &.{},
            .capacity = 0,
        },
        cwd: []const u8,
        stdio: [3]Stdio = .{
            .ignore,
            .pipe,
            .inherit,
        },
        lazy: bool = false,
        PATH: []const u8,
        argv: std.ArrayListUnmanaged(?[*:0]const u8),
        detached: bool,
        // ipc_mode: IPCMode,
        // ipc_callback: JSValue,

        const EnvMapIter = struct {
            map: *bun.DotEnv.Map,
            iter: bun.DotEnv.Map.HashTable.Iterator,
            alloc: Allocator,

            const Entry = struct {
                key: Key,
                value: Value,
            };

            pub const Key = struct {
                val: []const u8,

                pub fn format(self: Key, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                    try writer.writeAll(self.val);
                }

                pub fn eqlComptime(this: Key, comptime str: []const u8) bool {
                    return bun.strings.eqlComptime(this.val, str);
                }
            };

            pub const Value = struct {
                val: [:0]const u8,

                pub fn format(self: Value, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                    try writer.writeAll(self.val);
                }
            };

            pub fn init(map: *bun.DotEnv.Map, alloc: Allocator) EnvMapIter {
                return EnvMapIter{
                    .map = map,
                    .iter = map.iter(),
                    .alloc = alloc,
                };
            }

            pub fn len(this: *const @This()) usize {
                return this.map.map.unmanaged.entries.len;
            }

            pub fn next(this: *@This()) !?@This().Entry {
                const entry = this.iter.next() orelse return null;
                var value = try this.alloc.allocSentinel(u8, entry.value_ptr.value.len, 0);
                @memcpy(value[0..entry.value_ptr.value.len], entry.value_ptr.value);
                value[entry.value_ptr.value.len] = 0;
                return .{
                    .key = .{ .val = entry.key_ptr.* },
                    .value = .{ .val = value },
                };
            }
        };

        pub fn default(arena: *bun.ArenaAllocator, event_loop: JSC.EventLoopHandle, comptime is_sync: bool) SpawnArgs {
            var out: SpawnArgs = .{
                .arena = arena,

                .override_env = false,
                .env_array = .{
                    .items = &.{},
                    .capacity = 0,
                },
                .cwd = event_loop.topLevelDir(),
                .stdio = .{
                    .{ .ignore = {} },
                    .{ .pipe = {} },
                    .inherit,
                },
                .lazy = false,
                .PATH = event_loop.env().get("PATH") orelse "",
                .argv = undefined,
                .detached = false,
                // .ipc_mode = IPCMode.none,
                // .ipc_callback = .zero,
            };

            if (comptime is_sync) {
                out.stdio[1] = .{ .pipe = {} };
                out.stdio[2] = .{ .pipe = {} };
            }
            return out;
        }

        pub fn fillEnvFromProcess(this: *SpawnArgs, globalThis: *JSGlobalObject) void {
            var env_iter = EnvMapIter.init(globalThis.bunVM().bundler.env.map, this.arena.allocator());
            return this.fillEnv(globalThis, &env_iter, false);
        }

        /// `object_iter` should be a some type with the following fields:
        /// - `next() bool`
        pub fn fillEnv(
            this: *SpawnArgs,
            env_iter: *bun.shell.EnvMap.Iterator,
            comptime disable_path_lookup_for_arv0: bool,
        ) void {
            const allocator = this.arena.allocator();
            this.override_env = true;
            this.env_array.ensureTotalCapacityPrecise(allocator, env_iter.len) catch bun.outOfMemory();

            if (disable_path_lookup_for_arv0) {
                // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                this.PATH = "";
            }

            while (env_iter.next()) |entry| {
                const key = entry.key_ptr.*.slice();
                const value = entry.value_ptr.*.slice();

                var line = std.fmt.allocPrintZ(allocator, "{s}={s}", .{ key, value }) catch bun.outOfMemory();

                if (bun.strings.eqlComptime(key, "PATH")) {
                    this.PATH = bun.asByteSlice(line["PATH=".len..]);
                }

                this.env_array.append(allocator, line) catch bun.outOfMemory();
            }
        }
    };

    pub const WatchFd = bun.FileDescriptor;

    pub fn spawnAsync(
        event_loop: JSC.EventLoopHandle,
        shellio: *ShellIO,
        spawn_args_: SpawnArgs,
        out: **@This(),
    ) bun.shell.Result(void) {
        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        var spawn_args = spawn_args_;

        _ = switch (spawnMaybeSyncImpl(
            .{
                .is_sync = false,
            },
            event_loop,
            arena.allocator(),
            &spawn_args,
            shellio,
            out,
        )) {
            .result => |subproc| subproc,
            .err => |err| return .{ .err = err },
        };

        return bun.shell.Result(void).success;
    }

    fn spawnMaybeSyncImpl(
        comptime config: struct {
            is_sync: bool,
        },
        event_loop: JSC.EventLoopHandle,
        allocator: Allocator,
        spawn_args: *SpawnArgs,
        shellio: *ShellIO,
        out_subproc: **@This(),
    ) bun.shell.Result(*@This()) {
        const is_sync = config.is_sync;

        if (!spawn_args.override_env and spawn_args.env_array.items.len == 0) {
            // spawn_args.env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
            spawn_args.env_array.items = event_loop.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
            spawn_args.env_array.capacity = spawn_args.env_array.items.len;
        }

        var should_close_memfd = Environment.isLinux;

        defer {
            if (should_close_memfd) {
                inline for (0..spawn_args.stdio.len) |fd_index| {
                    if (spawn_args.stdio[fd_index] == .memfd) {
                        _ = bun.sys.close(spawn_args.stdio[fd_index].memfd);
                        spawn_args.stdio[fd_index] = .ignore;
                    }
                }
            }
        }

        var spawn_options = bun.spawn.SpawnOptions{
            .cwd = spawn_args.cwd,
            .stdin = switch (spawn_args.stdio[0].asSpawnOption(0)) {
                .result => |opt| opt,
                .err => |e| {
                    return .{ .err = .{
                        .custom = bun.default_allocator.dupe(u8, e.toStr()) catch bun.outOfMemory(),
                    } };
                },
            },
            .stdout = switch (spawn_args.stdio[1].asSpawnOption(1)) {
                .result => |opt| opt,
                .err => |e| {
                    return .{ .err = .{
                        .custom = bun.default_allocator.dupe(u8, e.toStr()) catch bun.outOfMemory(),
                    } };
                },
            },
            .stderr = switch (spawn_args.stdio[2].asSpawnOption(2)) {
                .result => |opt| opt,
                .err => |e| {
                    return .{ .err = .{
                        .custom = bun.default_allocator.dupe(u8, e.toStr()) catch bun.outOfMemory(),
                    } };
                },
            },

            .windows = if (Environment.isWindows) bun.spawn.WindowsSpawnOptions.WindowsOptions{
                .hide_window = true,
                .loop = event_loop,
            } else {},
        };

        spawn_args.argv.append(allocator, null) catch {
            return .{ .err = .{ .custom = bun.default_allocator.dupe(u8, "out of memory") catch bun.outOfMemory() } };
        };

        spawn_args.env_array.append(allocator, null) catch {
            return .{ .err = .{ .custom = bun.default_allocator.dupe(u8, "out of memory") catch bun.outOfMemory() } };
        };

        var spawn_result = switch (bun.spawn.spawnProcess(
            &spawn_options,
            @ptrCast(spawn_args.argv.items.ptr),
            @ptrCast(spawn_args.env_array.items.ptr),
        ) catch |err| {
            return .{ .err = .{ .custom = std.fmt.allocPrint(bun.default_allocator, "Failed to spawn process: {s}", .{@errorName(err)}) catch bun.outOfMemory() } };
        }) {
            .err => |err| return .{ .err = .{ .sys = err.toSystemError() } },
            .result => |result| result,
        };

        var subprocess = event_loop.allocator().create(Subprocess) catch bun.outOfMemory();
        out_subproc.* = subprocess;
        subprocess.* = Subprocess{
            .event_loop = event_loop,
            .process = spawn_result.toProcess(
                event_loop,
                is_sync,
            ),
            .stdin = Subprocess.Writable.init(spawn_args.stdio[0], event_loop, subprocess, spawn_result.stdin) catch bun.outOfMemory(),

            .stdout = Subprocess.Readable.init(.stdout, spawn_args.stdio[1], shellio.stdout, event_loop, subprocess, spawn_result.stdout, event_loop.allocator(), ShellSubprocess.default_max_buffer_size, true),
            .stderr = Subprocess.Readable.init(.stderr, spawn_args.stdio[2], shellio.stderr, event_loop, subprocess, spawn_result.stderr, event_loop.allocator(), ShellSubprocess.default_max_buffer_size, true),

            .flags = .{
                .is_sync = is_sync,
            },
            .cmd_parent = spawn_args.cmd_parent,
        };
        subprocess.process.setExitHandler(subprocess);

        if (subprocess.stdin == .pipe) {
            subprocess.stdin.pipe.signal = JSC.WebCore.Signal.init(&subprocess.stdin);
        }

        var send_exit_notification = false;

        if (comptime !is_sync) {
            switch (subprocess.process.watch()) {
                .result => {},
                .err => {
                    send_exit_notification = true;
                    spawn_args.lazy = false;
                },
            }
        }

        defer {
            if (send_exit_notification) {
                // process has already exited
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.wait(subprocess.flags.is_sync);
            }
        }

        if (subprocess.stdin == .buffer) {
            subprocess.stdin.buffer.start().assert();
        }

        if (subprocess.stdout == .pipe) {
            subprocess.stdout.pipe.start(subprocess, event_loop).assert();
            if ((is_sync or !spawn_args.lazy) and subprocess.stdout == .pipe) {
                subprocess.stdout.pipe.readAll();
            }
        }

        if (subprocess.stderr == .pipe) {
            subprocess.stderr.pipe.start(subprocess, event_loop).assert();

            if ((is_sync or !spawn_args.lazy) and subprocess.stderr == .pipe) {
                subprocess.stderr.pipe.readAll();
            }
        }

        should_close_memfd = false;

        log("returning", .{});

        return .{ .result = subprocess };
    }

    pub fn wait(this: *@This(), sync: bool) void {
        return this.process.wait(sync);
    }

    pub fn onProcessExit(this: *@This(), _: *Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        log("onProcessExit({x}, {any})", .{ @intFromPtr(this), status });
        const exit_code: ?u8 = brk: {
            if (status == .exited) {
                break :brk status.exited.code;
            }

            if (status == .err) {
                // TODO: handle error
            }

            if (status == .signaled) {
                if (status.signalCode()) |code| {
                    break :brk code.toExitCode().?;
                }
            }

            break :brk null;
        };

        if (exit_code) |code| {
            if (this.cmd_parent) |cmd| {
                if (cmd.exit_code == null) {
                    cmd.onExit(code);
                }
            }
        }
    }
};

const WaiterThread = bun.spawn.WaiterThread;

pub const PipeReader = struct {
    reader: IOReader = undefined,
    process: ?*ShellSubprocess = null,
    event_loop: JSC.EventLoopHandle = undefined,
    state: union(enum) {
        pending: void,
        done: []u8,
        err: ?JSC.SystemError,
    } = .{ .pending = {} },
    stdio_result: StdioResult,
    out_type: bun.shell.subproc.ShellSubprocess.OutKind,
    captured_writer: CapturedWriter = .{},
    buffered_output: BufferedOutput = .{ .bytelist = .{} },
    ref_count: u32 = 1,

    const BufferedOutput = union(enum) {
        bytelist: bun.ByteList,
        array_buffer: struct {
            buf: JSC.ArrayBuffer.Strong,
            i: u32 = 0,
        },

        pub inline fn len(this: *BufferedOutput) usize {
            return switch (this.*) {
                .bytelist => this.bytelist.len,
                .array_buffer => this.array_buffer.i,
            };
        }

        pub fn slice(this: *BufferedOutput) []const u8 {
            return switch (this.*) {
                .bytelist => this.bytelist.slice(),
                .array_buffer => this.array_buffer.buf.slice(),
            };
        }

        pub fn append(this: *BufferedOutput, bytes: []const u8) void {
            switch (this.*) {
                .bytelist => {
                    this.bytelist.append(bun.default_allocator, bytes) catch bun.outOfMemory();
                },
                .array_buffer => {
                    const array_buf_slice = this.array_buffer.buf.slice();
                    // TODO: We should probably throw error here?
                    if (this.array_buffer.i >= array_buf_slice.len) return;
                    const length = @min(array_buf_slice.len - this.array_buffer.i, bytes.len);
                    @memcpy(array_buf_slice[this.array_buffer.i .. this.array_buffer.i + length], bytes[0..length]);
                    this.array_buffer.i += @intCast(length);
                },
            }
        }

        pub fn deinit(this: *BufferedOutput) void {
            switch (this.*) {
                .bytelist => {
                    this.bytelist.deinitWithAllocator(bun.default_allocator);
                },
                .array_buffer => {},
            }
        }
    };

    pub usingnamespace bun.NewRefCounted(PipeReader, deinit);

    pub const CapturedWriter = struct {
        dead: bool = true,
        writer: *sh.IOWriter = undefined,
        written: usize = 0,
        err: ?JSC.SystemError = null,

        pub fn doWrite(this: *CapturedWriter, chunk: []const u8) void {
            if (this.dead or this.err != null) return;

            log("CapturedWriter(0x{x}, {s}) doWrite len={d} parent_amount={d}", .{ @intFromPtr(this), @tagName(this.parent().out_type), chunk.len, this.parent().buffered_output.len() });
            this.writer.enqueue(this, null, chunk);
        }

        pub fn getBuffer(this: *CapturedWriter) []const u8 {
            const p = this.parent();
            if (this.written >= p.reader.buffer().items.len) return "";
            return p.reader.buffer().items[this.written..];
        }

        pub fn loop(this: *CapturedWriter) *uws.Loop {
            return this.parent().event_loop.loop();
        }

        pub fn parent(this: *CapturedWriter) *PipeReader {
            return @fieldParentPtr("captured_writer", this);
        }

        pub fn eventLoop(this: *CapturedWriter) JSC.EventLoopHandle {
            return this.parent().eventLoop();
        }

        pub fn isDone(this: *CapturedWriter, just_written: usize) bool {
            log("CapturedWriter(0x{x}, {s}) isDone(has_err={any}, parent_state={s}, written={d}, parent_amount={d})", .{ @intFromPtr(this), @tagName(this.parent().out_type), this.err != null, @tagName(this.parent().state), this.written, this.parent().buffered_output.len() });
            if (this.dead or this.err != null) return true;
            const p = this.parent();
            if (p.state == .pending) return false;
            return this.written + just_written >= this.parent().buffered_output.len();
        }

        pub fn onIOWriterChunk(this: *CapturedWriter, amount: usize, err: ?JSC.SystemError) void {
            log("CapturedWriter({x}, {s}) onWrite({d}, has_err={any}) total_written={d} total_to_write={d}", .{ @intFromPtr(this), @tagName(this.parent().out_type), amount, err != null, this.written + amount, this.parent().buffered_output.len() });
            this.written += amount;
            if (err) |e| {
                log("CapturedWriter(0x{x}, {s}) onWrite errno={d} errmsg={} errfd={} syscall={}", .{ @intFromPtr(this), @tagName(this.parent().out_type), e.errno, e.message, e.fd, e.syscall });
                this.err = e;
                this.parent().trySignalDoneToCmd();
            } else if (this.written >= this.parent().buffered_output.len() and !(this.parent().state == .pending)) {
                this.parent().trySignalDoneToCmd();
            }
        }

        pub fn onError(this: *CapturedWriter, err: bun.sys.Error) void {
            this.err = err;
        }

        pub fn onClose(this: *CapturedWriter) void {
            log("CapturedWriter({x}, {s}) onClose()", .{ @intFromPtr(this), @tagName(this.parent().out_type) });
            this.parent().onCapturedWriterDone();
        }

        pub fn deinit(this: *CapturedWriter) void {
            if (this.err) |e| {
                this.err = null;
                e.deref();
            }
            this.writer.deref();
        }
    };

    pub const IOReader = bun.io.BufferedReader;
    pub const Poll = IOReader;

    pub fn detach(this: *PipeReader) void {
        log("PipeReader(0x{x}, {s}) detach()", .{ @intFromPtr(this), @tagName(this.out_type) });
        this.process = null;
        this.deref();
    }

    pub fn isDone(this: *PipeReader) bool {
        log("PipeReader(0x{x}, {s}) isDone() state={s} captured_writer_done={any}", .{ @intFromPtr(this), @tagName(this.out_type), @tagName(this.state), this.captured_writer.isDone(0) });
        if (this.state == .pending) return false;
        return this.captured_writer.isDone(0);
    }

    pub fn onCapturedWriterDone(this: *PipeReader) void {
        this.trySignalDoneToCmd();
    }

    pub fn create(event_loop: JSC.EventLoopHandle, process: *ShellSubprocess, result: StdioResult, capture: ?*sh.IOWriter, out_type: bun.shell.Subprocess.OutKind) *PipeReader {
        var this: *PipeReader = PipeReader.new(.{
            .process = process,
            .reader = IOReader.init(@This()),
            .event_loop = event_loop,
            .stdio_result = result,
            .out_type = out_type,
        });
        log("PipeReader(0x{x}, {s}) create()", .{ @intFromPtr(this), @tagName(this.out_type) });

        if (capture) |cap| {
            this.captured_writer.writer = cap.refSelf();
            this.captured_writer.dead = false;
        }

        if (Environment.isWindows) {
            this.reader.source =
                switch (result) {
                .buffer => .{ .pipe = this.stdio_result.buffer },
                .buffer_fd => .{ .file = bun.io.Source.openFile(this.stdio_result.buffer_fd) },
                .unavailable => @panic("Shouldn't happen."),
            };
        }
        this.reader.setParent(this);

        return this;
    }

    pub fn readAll(this: *PipeReader) void {
        if (this.state == .pending)
            this.reader.read();
    }

    pub fn start(this: *PipeReader, process: *ShellSubprocess, event_loop: JSC.EventLoopHandle) JSC.Maybe(void) {
        // this.ref();
        this.process = process;
        this.event_loop = event_loop;
        if (Environment.isWindows) {
            return this.reader.startWithCurrentPipe();
        }

        switch (this.reader.start(this.stdio_result.?, true)) {
            .err => |err| {
                return .{ .err = err };
            },
            .result => {
                if (comptime Environment.isPosix) {
                    // TODO: are these flags correct
                    const poll = this.reader.handle.poll;
                    poll.flags.insert(.socket);
                    this.reader.flags.socket = true;
                }

                return .{ .result = {} };
            },
        }
    }

    pub const toJS = toReadableStream;

    pub fn onReadChunk(ptr: *anyopaque, chunk: []const u8, has_more: bun.io.ReadState) bool {
        var this: *PipeReader = @ptrCast(@alignCast(ptr));
        this.buffered_output.append(chunk);
        log("PipeReader(0x{x}, {s}) onReadChunk(chunk_len={d}, has_more={s})", .{ @intFromPtr(this), @tagName(this.out_type), chunk.len, @tagName(has_more) });

        this.captured_writer.doWrite(chunk);

        const should_continue = has_more != .eof;

        if (should_continue) {
            if (bun.Environment.isPosix) this.reader.registerPoll() else switch (this.reader.startWithCurrentPipe()) {
                .err => |e| {
                    Output.panic("TODO: implement error handling in Bun Shell PipeReader.onReadChunk\n{}", .{e});
                },
                else => {},
            }
        }

        return should_continue;
    }

    pub fn onReaderDone(this: *PipeReader) void {
        log("onReaderDone(0x{x}, {s})", .{ @intFromPtr(this), @tagName(this.out_type) });
        const owned = this.toOwnedSlice();
        this.state = .{ .done = owned };
        if (!this.isDone()) return;
        // we need to ref because the process might be done and deref inside signalDoneToCmd and we wanna to keep it alive to check this.process
        this.ref();
        defer this.deref();
        this.trySignalDoneToCmd();

        if (this.process) |process| {
            // this.process = null;
            process.onCloseIO(this.kind(process));
            this.deref();
        }
    }

    pub fn trySignalDoneToCmd(
        this: *PipeReader,
    ) void {
        if (!this.isDone()) return;
        log("signalDoneToCmd ({x}: {s}) isDone={any}", .{ @intFromPtr(this), @tagName(this.out_type), this.isDone() });
        if (bun.Environment.allow_assert) assert(this.process != null);
        if (this.process) |proc| {
            if (proc.cmd_parent) |cmd| {
                if (this.captured_writer.err) |e| {
                    if (this.state != .err) {
                        this.state = .{ .err = e };
                    }
                }
                const e: ?JSC.SystemError = brk: {
                    if (this.state != .err) break :brk null;
                    if (this.state.err) |*e| {
                        e.ref();
                        break :brk e.*;
                    }
                    break :brk null;
                };
                cmd.bufferedOutputClose(this.out_type, e);
            }
        }
    }

    pub fn kind(reader: *const PipeReader, process: *const ShellSubprocess) StdioKind {
        if (process.stdout == .pipe and process.stdout.pipe == reader) {
            return .stdout;
        }

        if (process.stderr == .pipe and process.stderr.pipe == reader) {
            return .stderr;
        }

        @panic("We should be either stdout or stderr");
    }

    pub fn takeBuffer(this: *PipeReader) std.ArrayList(u8) {
        return this.reader.takeBuffer();
    }

    pub fn slice(this: *PipeReader) []const u8 {
        return this.buffered_output.slice();
    }

    pub fn toOwnedSlice(this: *PipeReader) []u8 {
        if (this.state == .done) {
            return this.state.done;
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        const out = this.reader._buffer;
        this.reader._buffer.items = &.{};
        this.reader._buffer.capacity = 0;
        return out.items;
    }

    pub fn updateRef(this: *PipeReader, add: bool) void {
        this.reader.updateRef(add);
    }

    pub fn watch(this: *PipeReader) void {
        if (!this.reader.isDone())
            this.reader.watch();
    }

    pub fn toReadableStream(this: *PipeReader, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        defer this.deinit();

        switch (this.state) {
            .pending => {
                const stream = JSC.WebCore.ReadableStream.fromPipe(globalObject, this, &this.reader);
                this.state = .{ .done = &.{} };
                return stream;
            },
            .done => |bytes| {
                const blob = JSC.WebCore.Blob.init(bytes, bun.default_allocator, globalObject);
                this.state = .{ .done = &.{} };
                return JSC.WebCore.ReadableStream.fromBlob(globalObject, &blob, 0);
            },
            .err => |err| {
                _ = err; // autofix
                const empty = JSC.WebCore.ReadableStream.empty(globalObject);
                JSC.WebCore.ReadableStream.cancel(&JSC.WebCore.ReadableStream.fromJS(empty, globalObject).?, globalObject);
                return empty;
            },
        }
    }

    pub fn toBuffer(this: *PipeReader, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        switch (this.state) {
            .done => |bytes| {
                defer this.state = .{ .done = &.{} };
                return JSC.MarkedArrayBuffer.fromBytes(bytes, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
            },
            else => {
                return JSC.JSValue.undefined;
            },
        }
    }

    pub fn onReaderError(this: *PipeReader, err: bun.sys.Error) void {
        log("PipeReader(0x{x}) onReaderError {}", .{ @intFromPtr(this), err });
        if (this.state == .done) {
            bun.default_allocator.free(this.state.done);
        }
        this.state = .{ .err = err.toSystemError() };
        // we need to ref because the process might be done and deref inside signalDoneToCmd and we wanna to keep it alive to check this.process
        this.ref();
        defer this.deref();
        this.trySignalDoneToCmd();
        if (this.process) |process| {
            // this.process = null;
            process.onCloseIO(this.kind(process));
            this.deref();
        }
    }

    pub fn close(this: *PipeReader) void {
        switch (this.state) {
            .pending => {
                this.reader.close();
            },
            .done => {},
            .err => {},
        }
    }

    pub fn eventLoop(this: *PipeReader) JSC.EventLoopHandle {
        return this.event_loop;
    }

    pub fn loop(this: *PipeReader) *uws.Loop {
        return this.event_loop.loop();
    }

    pub fn deinit(this: *PipeReader) void {
        log("PipeReader(0x{x}, {s}) deinit()", .{ @intFromPtr(this), @tagName(this.out_type) });
        if (comptime Environment.isPosix) {
            assert(this.reader.isDone() or this.state == .err);
        }

        if (comptime Environment.isWindows) {
            assert(this.reader.source == null or this.reader.source.?.isClosed());
        }

        if (this.state == .done) {
            bun.default_allocator.free(this.state.done);
        }

        if (!this.captured_writer.dead) {
            this.captured_writer.deinit();
        }

        if (this.state == .err) {
            if (this.state.err) |e| {
                e.deref();
                this.state.err = null;
            }
        }

        this.buffered_output.deinit();

        this.reader.deinit();
        this.destroy();
    }
};

pub const StdioKind = enum {
    stdin,
    stdout,
    stderr,
};

pub inline fn assertStdioResult(result: StdioResult) void {
    if (comptime Environment.allow_assert) {
        if (Environment.isPosix) {
            if (result) |fd| {
                assert(fd != bun.invalid_fd);
            }
        }
    }
}

const assert = bun.assert;
