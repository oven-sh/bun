const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const NetworkThread = @import("root").bun.http.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../which.zig");
const Async = bun.Async;
// const IPC = @import("../bun.js/ipc.zig");
const uws = bun.uws;

const PosixSpawn = bun.spawn;

const util = @import("./util.zig");

pub const Stdio = util.Stdio;
const FileSink = JSC.WebCore.FileSink;
// pub const ShellSubprocess = NewShellSubprocess(.js);
// pub const ShellSubprocessMini = NewShellSubprocess(.mini);

const StdioResult = if (Environment.isWindows) bun.spawn.WindowsSpawnResult.StdioResult else ?bun.FileDescriptor;

const BufferedOutput = struct {};
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

    // stdin: *Writable = undefined,
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

        pub fn init(stdio: Stdio, event_loop: *JSC.EventLoop, process: *ShellSubprocess, result: StdioResult, allocator: std.mem.Allocator, max_size: u32, is_sync: bool) Readable {
            _ = allocator; // autofix
            _ = max_size; // autofix
            _ = is_sync; // autofix
            assertStdioResult(result);

            if (Environment.isWindows) {
                return switch (stdio) {
                    .inherit => Readable{ .inherit = {} },
                    .ignore => Readable{ .ignore = {} },
                    .path => Readable{ .ignore = {} },
                    .fd => |fd| Readable{ .fd = fd },
                    .memfd => Readable{ .ignore = {} },
                    .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result, false) },
                    .array_buffer, .blob => Output.panic("TODO: implement ArrayBuffer & Blob support in Stdio readable", .{}),
                    .capture => Readable{ .pipe = PipeReader.create(event_loop, process, result, true) },
                };
            }

            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .path => Readable{ .ignore = {} },
                .fd => Readable{ .fd = result.? },
                .memfd => Readable{ .memfd = stdio.memfd },
                .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result, false) },
                .array_buffer, .blob => Output.panic("TODO: implement ArrayBuffer & Blob support in Stdio readable", .{}),
                .capture => Readable{ .pipe = PipeReader.create(event_loop, process, result, true) },
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
                    defer pipe.deinit();
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

    pub const StaticPipeWriter = JSC.Subprocess.NewStaticPipeWriter(Subprocess);

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
    pub fn unref(this: *@This(), comptime deactivate_poll_ref: bool) void {
        _ = deactivate_poll_ref; // autofix
        // const vm = this.globalThis.bunVM();

        this.process.disableKeepingEventLoopAlive();
        // if (!this.hasCalledGetter(.stdin)) {
        // this.stdin.unref();
        // }

        // if (!this.hasCalledGetter(.stdout)) {
        this.stdout.unref();
        // }

        // if (!this.hasCalledGetter(.stderr)) {
        this.stdout.unref();
        // }
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
            .stdin => {},
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
        spawn_args_: SpawnArgs,
        out: **@This(),
    ) bun.shell.Result(void) {
        if (comptime true) @panic("TODO");

        if (comptime Environment.isWindows) {
            return .{ .err = .{ .todo = bun.default_allocator.dupe("spawn() is not yet implemented on Windows") catch bun.outOfMemory() } };
        }
        var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        var spawn_args = spawn_args_;

        _ = switch (spawnMaybeSyncImpl(
            .{
                .is_sync = false,
            },
            event_loop,
            arena.allocator(),
            &spawn_args,
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
        out_subproc: **@This(),
    ) bun.shell.Result(*@This()) {
        if (comptime true) {
            @panic("TODO");
        }
        const is_sync = config.is_sync;

        if (!spawn_args.override_env and spawn_args.env_array.items.len == 0) {
            // spawn_args.env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
            spawn_args.env_array.items = event_loop.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
            spawn_args.env_array.capacity = spawn_args.env_array.items.len;
        }

        var spawn_options = bun.spawn.SpawnOptions{
            .cwd = spawn_args.cwd,
            .stdin = spawn_args.stdio[0].asSpawnOption(),
            .stdout = spawn_args.stdio[1].asSpawnOption(),
            .stderr = spawn_args.stdio[2].asSpawnOption(),
        };

        spawn_args.argv.append(allocator, null) catch {
            return .{ .err = .{ .custom = bun.default_allocator.dupe("out of memory") catch bun.outOfMemory() } };
        };

        spawn_args.env_array.append(allocator, null) catch {
            return .{ .err = .{ .custom = bun.default_allocator.dupe("out of memory") catch bun.outOfMemory() } };
        };

        const spawn_result = switch (bun.spawn.spawnProcess(
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
            // .stdin = Subprocess.Writable.init(subprocess, spawn_args.stdio[0], spawn_result.stdin, globalThis_) catch bun.outOfMemory(),
            // Readable initialization functions won't touch the subrpocess pointer so it's okay to hand it to them even though it technically has undefined memory at the point of Readble initialization
            // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
            .stdout = Subprocess.Readable.init(subprocess, .stdout, spawn_args.stdio[1], spawn_result.stdout, event_loop.allocator(), Subprocess.default_max_buffer_size),
            .stderr = Subprocess.Readable.init(subprocess, .stderr, spawn_args.stdio[2], spawn_result.stderr, event_loop.allocator(), Subprocess.default_max_buffer_size),
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
            switch (subprocess.process.watch(event_loop)) {
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

        if (subprocess.stdin == .buffered_input) {
            subprocess.stdin.buffered_input.remain = switch (subprocess.stdin.buffered_input.source) {
                .blob => subprocess.stdin.buffered_input.source.blob.slice(),
                .array_buffer => |array_buffer| array_buffer.slice(),
            };
            subprocess.stdin.buffered_input.writeIfPossible(is_sync);
        }

        if (subprocess.stdout == .pipe and subprocess.stdout.pipe == .buffer) {
            log("stdout readall", .{});
            if (comptime is_sync) {
                subprocess.stdout.pipe.buffer.readAll();
            } else if (!spawn_args.lazy) {
                subprocess.stdout.pipe.buffer.readAll();
            }
        }

        if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
            log("stderr readall", .{});
            if (comptime is_sync) {
                subprocess.stderr.pipe.buffer.readAll();
            } else if (!spawn_args.lazy) {
                subprocess.stderr.pipe.buffer.readAll();
            }
        }
        log("returning", .{});

        return .{ .result = subprocess };
    }

    pub fn wait(this: *@This(), sync: bool) void {
        return this.process.waitPosix(sync);
    }

    pub fn onProcessExit(this: *@This(), _: *Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
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

    const os = std.os;
};

const WaiterThread = bun.spawn.WaiterThread;

// pub const

pub const PipeReader = struct {
    reader: IOReader = undefined,
    process: *ShellSubprocess,
    event_loop: *JSC.EventLoop = undefined,
    state: union(enum) {
        pending: void,
        done: []u8,
        err: bun.sys.Error,
    } = .{ .pending = {} },
    stdio_result: StdioResult,
    captured_writer: CapturedWriter = .{},
    out_type: bun.shell.subproc.ShellSubprocess.OutKind,

    const CapturedWriter = struct {
        dead: bool = true,
        writer: IOWriter = .{},
        written: usize = 0,
        err: ?bun.sys.Error = null,

        pub const IOWriter = bun.io.BufferedWriter(
            CapturedWriter,
            onWrite,
            onError,
            onClose,
            getBuffer,
            null,
            CapturedWriter.isDone,
        );

        pub const Poll = IOWriter;

        pub fn getBuffer(this: *CapturedWriter) []const u8 {
            const p = this.parent();
            if (this.written >= p.reader.buffer().items.len) return "";
            return p.reader.buffer().items[this.written..];
        }

        pub fn parent(this: *CapturedWriter) *PipeReader {
            return @fieldParentPtr(PipeReader, "captured_writer", this);
        }

        pub fn isDone(this: *CapturedWriter, just_written: usize) bool {
            if (this.dead) return true;
            const p = this.parent();
            if (p.state == .pending) return false;
            return this.written + just_written >= p.reader.buffer().items.len;
        }

        pub fn onWrite(this: *CapturedWriter, amount: usize, done: bool) void {
            _ = done;
            this.written += amount;
        }

        pub fn onError(this: *CapturedWriter, err: bun.sys.Error) void {
            this.err = err;
        }

        pub fn onClose(this: *CapturedWriter) void {
            this.parent().onCapturedWriterDone();
        }
    };

    pub const IOReader = bun.io.BufferedReader;
    pub const Poll = IOReader;

    pub fn isDone(this: *PipeReader) bool {
        if (this.state == .pending) return false;
        return this.captured_writer.isDone(0);
    }

    pub fn onCapturedWriterDone(this: *PipeReader) void {
        this.signalDoneToCmd();
    }

    pub fn create(this: *PipeReader, event_loop: *JSC.EventLoop, process: *ShellSubprocess, result: StdioResult, comptime capture: bool) void {
        this.* = .{
            .process = process,
            .reader = IOReader.init(@This()),
            .event_loop = event_loop,
            .stdio_result = result,
        };

        if (capture) this.captured_writer.dead = false;

        if (Environment.isWindows) {
            this.reader.source = .{ .pipe = this.stdio_result.buffer };
        }
        this.reader.setParent(this);
        return;
    }

    pub fn readAll(this: *PipeReader) void {
        if (this.state == .pending)
            this.reader.read();
    }

    pub fn start(this: *PipeReader, process: *ShellSubprocess, event_loop: *JSC.EventLoop) JSC.Maybe(void) {
        this.ref();
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
                    const poll = this.reader.handle.poll;
                    poll.flags.insert(.nonblocking);
                    poll.flags.insert(.socket);
                }

                return .{ .result = {} };
            },
        }
    }

    pub const toJS = toReadableStream;

    pub fn onReaderDone(this: *PipeReader) void {
        const owned = this.toOwnedSlice();
        this.state = .{ .done = owned };
        this.signalDoneToCmd();
        this.process = null;
        this.process.onCloseIO(this.kind(this.process));
        this.deref();
    }

    pub fn signalDoneToCmd(
        this: *PipeReader,
    ) void {
        if (!this.isDone()) return;
        log("signalDoneToCmd ({x}: {s}) isDone={any}", .{ @intFromPtr(this), @tagName(this.out_type), this.isDone() });
        if (this.process.cmd_parent) |cmd| {
            if (this.captured_writer.err) |e| {
                if (this.state != .err) {
                    this.state = .{ .err = e };
                }
            }
            cmd.bufferedOutputClose(this.out_type);
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
        return this.reader.buffer().items[0..];
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
        if (this.state == .done) {
            bun.default_allocator.free(this.state.done);
        }
        this.state = .{ .err = err };
        if (this.process.cmd_parent) |cmd| {
            this.signalDoneToCmd(cmd);
        } else {
            this.process.onCloseIO(this.kind(this.process));
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

    pub fn eventLoop(this: *PipeReader) *JSC.EventLoop {
        return this.event_loop;
    }

    pub fn loop(this: *PipeReader) *uws.Loop {
        return this.event_loop.virtual_machine.uwsLoop();
    }

    fn deinit(this: *PipeReader) void {
        if (comptime Environment.isPosix) {
            std.debug.assert(this.reader.isDone());
        }

        if (comptime Environment.isWindows) {
            std.debug.assert(this.reader.source == null or this.reader.source.?.isClosed());
        }

        if (this.state == .done) {
            bun.default_allocator.free(this.state.done);
        }

        this.reader.deinit();
        // this.destroy();
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
                std.debug.assert(fd != bun.invalid_fd);
            }
        }
    }
}
