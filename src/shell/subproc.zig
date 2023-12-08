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

const PosixSpawn = @import("../bun.js/api/bun/spawn.zig").PosixSpawn;

const ShellCmd = @import("./interpreter.zig").Cmd;

const util = @import("../subproc/util.zig");

pub const ShellSubprocess = struct {
    const log = Output.scoped(.SHELL_SUBPROC, false);
    pub const default_max_buffer_size = 1024 * 1024 * 4;

    cmd_parent: ?*ShellCmd = null,
    pid: std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: if (Environment.isLinux) bun.FileDescriptor else u0 = std.math.maxInt(if (Environment.isLinux) bun.FileDescriptor else u0),

    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    poll: Poll = Poll{ .poll_ref = null },

    // on_exit_callback: JSC.Strong = .{},

    exit_code: ?u8 = null,
    signal_code: ?SignalCode = null,
    waitpid_err: ?bun.sys.Error = null,

    globalThis: *JSC.JSGlobalObject,
    // observable_getters: std.enums.EnumSet(enum {
    //     stdin,
    //     stdout,
    //     stderr,
    // }) = .{},
    closed: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
    }) = .{},
    this_jsvalue: JSC.JSValue = .zero,

    // ipc_mode: IPCMode,
    // ipc_callback: JSC.Strong = .{},
    // ipc: IPC.IPCData,
    flags: Flags = .{},

    // pub const IPCMode = enum {
    //     none,
    //     bun,
    //     // json,
    // };

    pub const OutKind = util.OutKind;
    pub const Writable = util.Writable;
    // pub const Readable = util.Readable;
    pub const Stdio = util.Stdio;

    pub const BufferedInput = util.BufferedInput;
    // pub const BufferedOutput = util.BufferedOutput;

    pub const Flags = util.Flags;
    pub const SignalCode = bun.SignalCode;
    pub const Poll = util.Poll;
    pub const WaitThreadPoll = util.WaitThreadPoll;

    pub const Readable =
        union(enum) {
        fd: bun.FileDescriptor,

        pipe: Pipe,
        inherit: void,
        ignore: void,
        closed: void,

        pub fn ref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    if (this.pipe == .buffer) {
                        if (this.pipe.buffer.fifo.poll_ref) |poll| {
                            poll.enableKeepingProcessAlive(JSC.VirtualMachine.get());
                        }
                    }
                },
                else => {},
            }
        }

        pub fn unref(this: *Readable) void {
            switch (this.*) {
                .pipe => {
                    if (this.pipe == .buffer) {
                        if (this.pipe.buffer.fifo.poll_ref) |poll| {
                            poll.disableKeepingProcessAlive(JSC.VirtualMachine.get());
                        }
                    }
                },
                else => {},
            }
        }

        pub const Pipe = union(enum) {
            stream: JSC.WebCore.ReadableStream,
            buffer: BufferedOutput,

            pub fn finish(this: *@This()) void {
                if (this.* == .stream and this.stream.ptr == .File) {
                    this.stream.ptr.File.finish();
                }
            }

            pub fn done(this: *@This()) void {
                if (this.* == .stream) {
                    if (this.stream.ptr == .File) this.stream.ptr.File.setSignal(JSC.WebCore.Signal{});
                    this.stream.done();
                    return;
                }

                this.buffer.close();
            }

            pub fn toJS(this: *@This(), readable: *Readable, globalThis: *JSC.JSGlobalObject, exited: bool) JSValue {
                if (this.* != .stream) {
                    const stream = this.buffer.toReadableStream(globalThis, exited);
                    this.* = .{ .stream = stream };
                }

                if (this.stream.ptr == .File) {
                    this.stream.ptr.File.setSignal(JSC.WebCore.Signal.init(readable));
                }

                return this.stream.toJS();
            }
        };

        pub fn init(subproc: *ShellSubprocess, kind: OutKind, stdio: Stdio, fd: i32, allocator: std.mem.Allocator, max_size: u32) Readable {
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    break :brk .{
                        .pipe = .{
                            .buffer = BufferedOutput.initWithAllocator(subproc, kind, allocator, fd, max_size),
                        },
                    };
                },
                .path => Readable{ .ignore = {} },
                .blob, .fd => Readable{ .fd = @as(bun.FileDescriptor, @intCast(fd)) },
                .array_buffer => Readable{
                    .pipe = .{
                        .buffer = if (stdio.array_buffer.from_jsc) BufferedOutput.initWithArrayBuffer(subproc, kind, fd, stdio.array_buffer.buf.slice()) else BufferedOutput.initWithSlice(subproc, kind, fd, stdio.array_buffer.buf.slice()),
                    },
                },
            };
        }

        pub fn onClose(this: *Readable, _: ?bun.sys.Error) void {
            this.* = .closed;
        }

        pub fn onReady(_: *Readable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}

        pub fn onStart(_: *Readable) void {}

        pub fn close(this: *Readable) void {
            log("READABLE close", .{});
            switch (this.*) {
                .fd => |fd| {
                    _ = bun.sys.close(fd);
                },
                .pipe => {
                    this.pipe.done();
                },
                else => {},
            }
        }

        pub fn finalize(this: *Readable) void {
            log("Readable::finalize", .{});
            switch (this.*) {
                .fd => |fd| {
                    _ = bun.sys.close(fd);
                },
                .pipe => {
                    if (this.pipe == .stream and this.pipe.stream.ptr == .File) {
                        this.close();
                        return;
                    }

                    this.pipe.buffer.close();
                },
                else => {},
            }
        }

        pub fn toJS(this: *Readable, globalThis: *JSC.JSGlobalObject, exited: bool) JSValue {
            switch (this.*) {
                .fd => |fd| {
                    return JSValue.jsNumber(fd);
                },
                .pipe => {
                    return this.pipe.toJS(this, globalThis, exited);
                },
                else => {
                    return JSValue.jsUndefined();
                },
            }
        }

        pub fn toSlice(this: *Readable) ?[]const u8 {
            switch (this.*) {
                .fd => return null,
                .pipe => {
                    this.pipe.buffer.fifo.close_on_empty_read = true;
                    this.pipe.buffer.readAll();

                    var bytes = this.pipe.buffer.internal_buffer.slice();
                    // this.pipe.buffer.internal_buffer = .{};

                    if (bytes.len > 0) {
                        return bytes;
                    }

                    return "";
                },
                else => {
                    return null;
                },
            }
        }

        pub fn toBufferedValue(this: *Readable, globalThis: *JSC.JSGlobalObject) JSValue {
            switch (this.*) {
                .fd => |fd| {
                    return JSValue.jsNumber(fd);
                },
                .pipe => {
                    this.pipe.buffer.fifo.close_on_empty_read = true;
                    this.pipe.buffer.readAll();

                    var bytes = this.pipe.buffer.internal_buffer.slice();
                    this.pipe.buffer.internal_buffer = .{};

                    if (bytes.len > 0) {
                        // Return a Buffer so that they can do .toString() on it
                        return JSC.JSValue.createBuffer(globalThis, bytes, bun.default_allocator);
                    }

                    return JSC.JSValue.createBuffer(globalThis, &.{}, bun.default_allocator);
                },
                else => {
                    return JSValue.jsUndefined();
                },
            }
        }
    };

    pub const BufferedOutput = struct {
        fifo: JSC.WebCore.FIFO = undefined,
        internal_buffer: bun.ByteList = .{},
        auto_sizer: ?JSC.WebCore.AutoSizer = null,
        subproc: *ShellSubprocess,
        out_type: OutKind,
        /// Sometimes the `internal_buffer` may be filled with memory from JSC,
        /// for example an array buffer. In that case we shouldn't dealloc
        /// memory and let the GC do it.
        from_jsc: bool = false,
        status: Status = .{
            .pending = {},
        },
        recall_readall: bool = true,

        pub const Status = union(enum) {
            pending: void,
            done: void,
            err: bun.sys.Error,
        };

        pub fn init(subproc: *ShellSubprocess, out_type: OutKind, fd: bun.FileDescriptor) BufferedOutput {
            return BufferedOutput{
                .out_type = out_type,
                .subproc = subproc,
                .internal_buffer = .{},
                .fifo = JSC.WebCore.FIFO{
                    .fd = fd,
                },
            };
        }

        pub fn initWithArrayBuffer(subproc: *ShellSubprocess, out_type: OutKind, fd: bun.FileDescriptor, slice: []u8) BufferedOutput {
            var out = BufferedOutput.initWithSlice(subproc, out_type, fd, slice);
            out.from_jsc = true;
            return out;
        }

        pub fn initWithSlice(subproc: *ShellSubprocess, out_type: OutKind, fd: bun.FileDescriptor, slice: []u8) BufferedOutput {
            return BufferedOutput{
                // fixed capacity
                .internal_buffer = bun.ByteList.initWithBuffer(slice),
                .auto_sizer = null,
                .subproc = subproc,
                .fifo = JSC.WebCore.FIFO{
                    .fd = fd,
                },
                .out_type = out_type,
            };
        }

        pub fn initWithAllocator(subproc: *ShellSubprocess, out_type: OutKind, allocator: std.mem.Allocator, fd: bun.FileDescriptor, max_size: u32) BufferedOutput {
            var this = init(subproc, out_type, fd);
            this.auto_sizer = .{
                .max = max_size,
                .allocator = allocator,
                .buffer = &this.internal_buffer,
            };
            return this;
        }

        pub fn closeFifoSignalCmd(this: *BufferedOutput) void {
            // `this.fifo.close()` will be called from the parent
            // this.fifo.close();
            if (this.subproc.cmd_parent) |cmd| {
                cmd.bufferedOutputClose(this.out_type);
            }
        }

        /// This is called after it is read (it's confusing because "on read" could
        /// be interpreted as present or past tense)
        pub fn onRead(this: *BufferedOutput, result: JSC.WebCore.StreamResult) void {
            log("ON READ {s} result={s}", .{ @tagName(this.out_type), @tagName(result) });
            defer {
                if (this.recall_readall and this.recall_readall) {
                    this.readAll();
                }
                if (this.status == .err or this.status == .done) {
                    this.closeFifoSignalCmd();
                }
            }
            switch (result) {
                .pending => {
                    this.watch();
                    return;
                },
                .err => |err| {
                    if (err == .Error) {
                        this.status = .{ .err = err.Error };
                    } else {
                        this.status = .{ .err = bun.sys.Error.fromCode(.CANCELED, .read) };
                    }
                    // this.fifo.close();
                    // this.closeFifoSignalCmd();
                    return;
                },
                .done => {
                    this.status = .{ .done = {} };
                    // this.fifo.close();
                    // this.closeFifoSignalCmd();
                    return;
                },
                else => {
                    const slice = result.slice();
                    log("buffered output ({s}) onRead: {s}", .{ @tagName(this.out_type), slice });
                    this.internal_buffer.len += @as(u32, @truncate(slice.len));
                    if (slice.len > 0)
                        std.debug.assert(this.internal_buffer.contains(slice));

                    if (result.isDone() or (slice.len == 0 and this.fifo.poll_ref != null and this.fifo.poll_ref.?.isHUP())) {
                        this.status = .{ .done = {} };
                        // this.fifo.close();
                        // this.closeFifoSignalCmd();
                    }
                },
            }
        }

        pub fn readAll(this: *BufferedOutput) void {
            if (this.auto_sizer) |auto_sizer| {
                while (@as(usize, this.internal_buffer.len) < auto_sizer.max and this.status == .pending) {
                    var stack_buffer: [8096]u8 = undefined;
                    var stack_buf: []u8 = stack_buffer[0..];
                    var buf_to_use = stack_buf;
                    var available = this.internal_buffer.available();
                    if (available.len >= stack_buf.len) {
                        buf_to_use = available;
                    }

                    const result = this.fifo.read(buf_to_use, this.fifo.to_read);

                    switch (result) {
                        .pending => {
                            this.watch();
                            return;
                        },
                        .err => |err| {
                            this.status = .{ .err = err };
                            // this.fifo.close();
                            this.closeFifoSignalCmd();
                            this.recall_readall = false;

                            return;
                        },
                        .done => {
                            this.status = .{ .done = {} };
                            // this.fifo.close();
                            this.closeFifoSignalCmd();
                            this.recall_readall = false;
                            return;
                        },
                        .read => |slice| {
                            log("buffered output ({s}) readAll (autosizer): {s}", .{ @tagName(this.out_type), slice });
                            if (slice.ptr == stack_buf.ptr) {
                                this.internal_buffer.append(auto_sizer.allocator, slice) catch @panic("out of memory");
                            } else {
                                this.internal_buffer.len += @as(u32, @truncate(slice.len));
                            }

                            if (slice.len < buf_to_use.len) {
                                this.watch();
                                return;
                            }
                        },
                    }
                }
            } else {
                while (this.internal_buffer.len < this.internal_buffer.cap and this.status == .pending) {
                    log("we in this loop i think", .{});
                    var buf_to_use = this.internal_buffer.available();

                    const result = this.fifo.read(buf_to_use, this.fifo.to_read);

                    log("Result tag: {s}", .{@tagName(result)});

                    switch (result) {
                        .pending => {
                            this.watch();
                            return;
                        },
                        .err => |err| {
                            this.status = .{ .err = err };
                            // this.fifo.close();
                            this.closeFifoSignalCmd();
                            this.recall_readall = false;

                            return;
                        },
                        .done => {
                            this.status = .{ .done = {} };
                            // this.fifo.close();
                            this.closeFifoSignalCmd();
                            this.recall_readall = false;
                            return;
                        },
                        .read => |slice| {
                            log("buffered output ({s}) readAll (autosizer): {s}", .{ @tagName(this.out_type), slice });
                            this.internal_buffer.len += @as(u32, @truncate(slice.len));

                            if (slice.len < buf_to_use.len) {
                                this.watch();
                                return;
                            }
                        },
                    }
                }
            }
        }

        pub fn watch(this: *BufferedOutput) void {
            std.debug.assert(this.fifo.fd != bun.invalid_fd);

            this.fifo.pending.set(BufferedOutput, this, onRead);
            if (!this.fifo.isWatching()) this.fifo.watch(this.fifo.fd);
            return;
        }

        pub fn toBlob(this: *BufferedOutput, globalThis: *JSC.JSGlobalObject) JSC.WebCore.Blob {
            const blob = JSC.WebCore.Blob.init(this.internal_buffer.slice(), bun.default_allocator, globalThis);
            this.internal_buffer = bun.ByteList.init("");
            return blob;
        }

        pub fn toReadableStream(this: *BufferedOutput, globalThis: *JSC.JSGlobalObject, exited: bool) JSC.WebCore.ReadableStream {
            if (exited) {
                // exited + received EOF => no more read()
                if (this.fifo.isClosed()) {
                    // also no data at all
                    if (this.internal_buffer.len == 0) {
                        if (this.internal_buffer.cap > 0) {
                            if (this.auto_sizer) |auto_sizer| {
                                this.internal_buffer.deinitWithAllocator(auto_sizer.allocator);
                            }
                        }
                        // so we return an empty stream
                        return JSC.WebCore.ReadableStream.fromJS(
                            JSC.WebCore.ReadableStream.empty(globalThis),
                            globalThis,
                        ).?;
                    }

                    return JSC.WebCore.ReadableStream.fromJS(
                        JSC.WebCore.ReadableStream.fromBlob(
                            globalThis,
                            &this.toBlob(globalThis),
                            0,
                        ),
                        globalThis,
                    ).?;
                }
            }

            {
                const internal_buffer = this.internal_buffer;
                this.internal_buffer = bun.ByteList.init("");

                // There could still be data waiting to be read in the pipe
                // so we need to create a new stream that will read from the
                // pipe and then return the blob.
                const result = JSC.WebCore.ReadableStream.fromJS(
                    JSC.WebCore.ReadableStream.fromFIFO(
                        globalThis,
                        &this.fifo,
                        internal_buffer,
                    ),
                    globalThis,
                ).?;
                this.fifo.fd = bun.invalid_fd;
                this.fifo.poll_ref = null;
                return result;
            }
        }

        pub fn close(this: *BufferedOutput) void {
            log("BufferedOutput close", .{});
            switch (this.status) {
                .done => {},
                .pending => {
                    this.fifo.close();
                    this.status = .{ .done = {} };
                },
                .err => {},
            }

            if (this.internal_buffer.cap > 0 and !this.from_jsc) {
                this.internal_buffer.listManaged(bun.default_allocator).deinit();
                this.internal_buffer = .{};
            }
        }
    };

    pub fn hasExited(this: *const ShellSubprocess) bool {
        return this.exit_code != null or this.waitpid_err != null or this.signal_code != null;
    }

    pub fn ref(this: *ShellSubprocess) void {
        var vm = this.globalThis.bunVM();

        switch (this.poll) {
            .poll_ref => if (this.poll.poll_ref) |poll| {
                poll.ref(vm);
            },
            .wait_thread => |*wait_thread| {
                wait_thread.poll_ref.ref(vm);
            },
        }

        // if (!this.hasCalledGetter(.stdin)) {
        this.stdin.ref();
        // }

        // if (!this.hasCalledGetter(.stdout)) {
        this.stdout.ref();
        // }

        // if (!this.hasCalledGetter(.stderr)) {
        this.stderr.ref();
        // }
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn unref(this: *ShellSubprocess, comptime deactivate_poll_ref: bool) void {
        var vm = this.globalThis.bunVM();

        switch (this.poll) {
            .poll_ref => if (this.poll.poll_ref) |poll| {
                if (deactivate_poll_ref) {
                    poll.onEnded(vm);
                } else {
                    poll.unref(vm);
                }
            },
            .wait_thread => |*wait_thread| {
                wait_thread.poll_ref.unref(vm);
            },
        }
        // if (!this.hasCalledGetter(.stdin)) {
        this.stdin.unref();
        // }

        // if (!this.hasCalledGetter(.stdout)) {
        this.stdout.unref();
        // }

        // if (!this.hasCalledGetter(.stderr)) {
        this.stdout.unref();
        // }
    }

    pub fn hasKilled(this: *const ShellSubprocess) bool {
        return this.exit_code != null or this.signal_code != null;
    }

    pub fn tryKill(this: *ShellSubprocess, sig: i32) JSC.Node.Maybe(void) {
        if (this.hasExited()) {
            return .{ .result = {} };
        }

        send_signal: {
            if (comptime Environment.isLinux) {
                // if these are the same, it means the pidfd is invalid.
                if (!WaiterThread.shouldUseWaiterThread()) {
                    // should this be handled differently?
                    // this effectively shouldn't happen
                    if (this.pidfd == bun.invalid_fd) {
                        return .{ .result = {} };
                    }

                    // first appeared in Linux 5.1
                    const rc = std.os.linux.pidfd_send_signal(this.pidfd, @as(u8, @intCast(sig)), null, 0);

                    if (rc != 0) {
                        const errno = std.os.linux.getErrno(rc);

                        // if the process was already killed don't throw
                        if (errno != .SRCH and errno != .NOSYS)
                            return .{ .err = bun.sys.Error.fromCode(errno, .kill) };
                    } else {
                        break :send_signal;
                    }
                }
            }

            const err = std.c.kill(this.pid, sig);
            if (err != 0) {
                const errno = bun.C.getErrno(err);

                // if the process was already killed don't throw
                if (errno != .SRCH)
                    return .{ .err = bun.sys.Error.fromCode(errno, .kill) };
            }
        }

        return .{ .result = {} };
    }

    // fn hasCalledGetter(this: *Subprocess, comptime getter: @Type(.EnumLiteral)) bool {
    //     return this.observable_getters.contains(getter);
    // }

    fn closeProcess(this: *ShellSubprocess) void {
        if (comptime !Environment.isLinux) {
            return;
        }

        const pidfd = this.pidfd;

        this.pidfd = bun.invalid_fd;

        if (pidfd != bun.invalid_fd) {
            _ = std.os.close(pidfd);
        }
    }

    pub fn disconnect(this: *ShellSubprocess) void {
        _ = this;
        // if (this.ipc_mode == .none) return;
        // this.ipc.socket.close(0, null);
        // this.ipc_mode = .none;
    }

    pub fn closeIO(this: *ShellSubprocess, comptime io: @Type(.EnumLiteral)) void {
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
    pub fn finalizeSync(this: *ShellSubprocess) void {
        this.closeProcess();

        this.closeIO(.stdin);
        this.closeIO(.stdout);
        this.closeIO(.stderr);

        // this.exit_promise.deinit();
        // Deinitialization of the shell state is handled by the shell state machine
        // this.on_exit_callback.deinit();
    }

    pub fn deinit(this: *ShellSubprocess) void {
        //     std.debug.assert(!this.hasPendingActivity());
        this.finalizeSync();
        log("Deinit", .{});
        bun.default_allocator.destroy(this);
    }

    // pub fn finalize(this: *Subprocess) callconv(.C) void {
    //     std.debug.assert(!this.hasPendingActivity());
    //     this.finalizeSync();
    //     log("Finalize", .{});
    //     bun.default_allocator.destroy(this);
    // }

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
            .{ .ignore = {} },
            .{ .pipe = null },
            .{ .inherit = {} },
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

        pub fn default(arena: *bun.ArenaAllocator, jsc_vm: *JSC.VirtualMachine, comptime is_sync: bool) SpawnArgs {
            var out: SpawnArgs = .{
                .arena = arena,

                .override_env = false,
                .env_array = .{
                    .items = &.{},
                    .capacity = 0,
                },
                .cwd = jsc_vm.bundler.fs.top_level_dir,
                .stdio = .{
                    .{ .ignore = {} },
                    .{ .pipe = null },
                    .{ .inherit = {} },
                },
                .lazy = false,
                .PATH = jsc_vm.bundler.env.get("PATH") orelse "",
                .argv = undefined,
                .detached = false,
                // .ipc_mode = IPCMode.none,
                // .ipc_callback = .zero,
            };

            if (comptime is_sync) {
                out.stdio[1] = .{ .pipe = null };
                out.stdio[2] = .{ .pipe = null };
            }
            return out;
        }

        pub fn fillEnvFromProcess(this: *SpawnArgs, globalThis: *JSGlobalObject) bool {
            var env_iter = EnvMapIter.init(globalThis.bunVM().bundler.env.map, this.arena.allocator());
            return this.fillEnv(globalThis, &env_iter, false);
        }

        /// `object_iter` should be a some type with the following fields:
        /// - `next() bool`
        pub fn fillEnv(
            this: *SpawnArgs,
            globalThis: *JSGlobalObject,
            object_iter: anytype,
            comptime disable_path_lookup_for_arv0: bool,
        ) bool {
            var allocator = this.arena.allocator();
            this.override_env = true;
            this.env_array.ensureTotalCapacityPrecise(allocator, object_iter.len()) catch {
                globalThis.throw("out of memory", .{});
                return false;
            };

            if (disable_path_lookup_for_arv0) {
                // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                this.PATH = "";
            }

            while (object_iter.next() catch {
                globalThis.throwOutOfMemory();
                return false;
            }) |entry| {
                var value = entry.value;

                var line = std.fmt.allocPrintZ(allocator, "{}={}", .{ entry.key, value }) catch {
                    globalThis.throw("out of memory", .{});
                    return false;
                };

                if (entry.key.eqlComptime("PATH")) {
                    this.PATH = bun.asByteSlice(line["PATH=".len..]);
                }

                this.env_array.append(allocator, line) catch {
                    globalThis.throw("out of memory", .{});
                    return false;
                };
            }

            return true;
        }
    };

    pub const WatchFd = if (Environment.isLinux) std.os.fd_t else i32;

    pub fn spawnAsync(
        globalThis: *JSC.JSGlobalObject,
        spawn_args_: SpawnArgs,
    ) !?*ShellSubprocess {
        if (comptime Environment.isWindows) {
            globalThis.throwTODO("spawn() is not yet implemented on Windows");
            return null;
        }
        var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        var spawn_args = spawn_args_;

        var out_err: ?JSValue = null;
        var out_watchfd: if (Environment.isLinux) ?std.os.fd_t else ?i32 = null;
        var subprocess = util.spawnMaybeSyncImpl(
            .{
                .SpawnArgs = SpawnArgs,
                .Subprocess = ShellSubprocess,
                .WaiterThread = WaiterThread,
                .is_sync = false,
                .is_js = false,
            },
            globalThis,
            arena.allocator(),
            &out_watchfd,
            &out_err,
            &spawn_args,
        ) orelse
            {
            if (out_err) |err| {
                var str = err.getZigString(globalThis);
                std.debug.print("THE STR: {s}\n", .{str});
                globalThis.throwValue(err);
            }
            return null;
        };

        return subprocess;
    }

    pub fn spawnSync(
        globalThis: *JSC.JSGlobalObject,
        spawn_args_: SpawnArgs,
    ) !?*ShellSubprocess {
        if (comptime Environment.isWindows) {
            globalThis.throwTODO("spawn() is not yet implemented on Windows");
            return null;
        }
        var is_sync = true;
        var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var jsc_vm = globalThis.bunVM();

        var spawn_args = spawn_args_;

        var out_err: ?JSValue = null;
        var out_watchfd: if (Environment.isLinux) ?std.os.fd_t else ?i32 = null;
        var subprocess = util.spawnMaybeSyncImpl(
            .{
                .SpawnArgs = SpawnArgs,
                .Subprocess = ShellSubprocess,
                .WaiterThread = WaiterThread,
                .is_sync = true,
                .is_js = false,
            },
            globalThis,
            arena.allocator(),
            &out_watchfd,
            &out_err,
            &spawn_args,
        ) orelse
            {
            if (out_err) |err| {
                globalThis.throwValue(err);
            }
            return null;
        };

        const out = subprocess.this_jsvalue;

        if (comptime !is_sync) {
            return out;
        }

        if (subprocess.stdin == .buffered_input) {
            while (subprocess.stdin.buffered_input.remain.len > 0) {
                subprocess.stdin.buffered_input.writeIfPossible(true);
            }
        }
        subprocess.closeIO(.stdin);

        const watchfd = out_watchfd orelse {
            globalThis.throw("watchfd is null", .{});
            return null;
        };

        if (!WaiterThread.shouldUseWaiterThread()) {
            var poll = Async.FilePoll.init(jsc_vm, watchfd, .{}, ShellSubprocess, subprocess);
            subprocess.poll = .{ .poll_ref = poll };
            switch (subprocess.poll.poll_ref.?.register(
                jsc_vm.event_loop_handle.?,
                .process,
                true,
            )) {
                .result => {
                    subprocess.poll.poll_ref.?.enableKeepingProcessAlive(jsc_vm);
                },
                .err => |err| {
                    if (err.getErrno() != .SRCH) {
                        @panic("This shouldn't happen");
                    }

                    // process has already exited
                    // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                    subprocess.onExitNotification();
                },
            }
        } else {
            WaiterThread.append(subprocess);
        }

        while (!subprocess.hasExited()) {
            if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
                subprocess.stderr.pipe.buffer.readAll();
            }

            if (subprocess.stdout == .pipe and subprocess.stdout.pipe == .buffer) {
                subprocess.stdout.pipe.buffer.readAll();
            }

            jsc_vm.tick();
            jsc_vm.eventLoop().autoTick();
        }

        return subprocess;
    }

    pub fn onExitNotificationTask(this: *ShellSubprocess) void {
        var vm = this.globalThis.bunVM();
        const is_sync = this.flags.is_sync;

        defer {
            if (!is_sync)
                vm.drainMicrotasks();
        }
        this.wait(false);
    }

    pub fn onExitNotification(
        this: *ShellSubprocess,
    ) void {
        std.debug.assert(this.flags.is_sync);

        this.wait(this.flags.is_sync);
    }

    pub fn wait(this: *ShellSubprocess, sync: bool) void {
        return this.onWaitPid(sync, PosixSpawn.waitpid(this.pid, if (sync) 0 else std.os.W.NOHANG));
    }

    pub fn watch(this: *ShellSubprocess) JSC.Maybe(void) {
        if (WaiterThread.shouldUseWaiterThread()) {
            WaiterThread.append(this);
            return JSC.Maybe(void){ .result = {} };
        }

        if (this.poll.poll_ref) |poll| {
            const registration = poll.register(
                this.globalThis.bunVM().event_loop_handle.?,
                .process,
                true,
            );

            return registration;
        } else {
            @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
        }
    }

    pub fn onWaitPid(this: *ShellSubprocess, sync: bool, waitpid_result_: JSC.Maybe(PosixSpawn.WaitPidResult)) void {
        if (Environment.isWindows) {
            @panic("windows doesnt support subprocess yet. haha");
        }
        // defer if (sync) this.updateHasPendingActivity();

        const pid = this.pid;

        var waitpid_result = waitpid_result_;

        while (true) {
            switch (waitpid_result) {
                .err => |err| {
                    this.waitpid_err = err;
                },
                .result => |result| {
                    if (result.pid == pid) {
                        if (std.os.W.IFEXITED(result.status)) {
                            this.exit_code = @as(u8, @truncate(std.os.W.EXITSTATUS(result.status)));
                        }

                        // True if the process terminated due to receipt of a signal.
                        if (std.os.W.IFSIGNALED(result.status)) {
                            this.signal_code = @as(SignalCode, @enumFromInt(@as(u8, @truncate(std.os.W.TERMSIG(result.status)))));
                        } else if (
                        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html
                        // True if the process has not terminated, but has stopped and can
                        // be restarted.  This macro can be true only if the wait call spec-ified specified
                        // ified the WUNTRACED option or if the child process is being
                        // traced (see ptrace(2)).
                        std.os.W.IFSTOPPED(result.status)) {
                            this.signal_code = @as(SignalCode, @enumFromInt(@as(u8, @truncate(std.os.W.STOPSIG(result.status)))));
                        }
                    }

                    if (!this.hasExited()) {
                        switch (this.watch()) {
                            .result => {},
                            .err => |err| {
                                if (comptime Environment.isMac) {
                                    if (err.getErrno() == .SRCH) {
                                        waitpid_result = PosixSpawn.waitpid(pid, if (sync) 0 else std.os.W.NOHANG);
                                        continue;
                                    }
                                }
                            },
                        }
                    }
                },
            }
            break;
        }

        if (!sync and this.hasExited()) {
            var vm = this.globalThis.bunVM();

            // prevent duplicate notifications
            switch (this.poll) {
                .poll_ref => |poll_| {
                    if (poll_) |poll| {
                        this.poll.poll_ref = null;
                        poll.deinitWithVM(vm);
                    }
                },
                .wait_thread => {
                    this.poll.wait_thread.poll_ref.deactivate(vm.event_loop_handle.?);
                },
            }

            this.onExit(this.globalThis);
        }
    }

    fn runOnExit(this: *ShellSubprocess, globalThis: *JSC.JSGlobalObject) void {
        log("run on exit {d}", .{this.pid});
        _ = globalThis;
        const waitpid_error = this.waitpid_err;
        _ = waitpid_error;
        this.waitpid_err = null;

        // FIXME remove when we get rid of old shell interpreter
        if (this.cmd_parent) |cmd| {
            if (cmd.exit_code == null) {
                // defer this.shell_state = null;
                cmd.onExit(this.exit_code.?);
                // FIXME handle waitpid_error here like below
            }
        }

        // if (this.on_exit_callback.trySwap()) |callback| {
        //     const waitpid_value: JSValue =
        //         if (waitpid_error) |err|
        //         err.toJSC(globalThis)
        //     else
        //         JSC.JSValue.jsUndefined();

        //     const this_value = if (this_jsvalue.isEmptyOrUndefinedOrNull()) JSC.JSValue.jsUndefined() else this_jsvalue;
        //     this_value.ensureStillAlive();

        //     const args = [_]JSValue{
        //         this_value,
        //         this.getExitCode(globalThis),
        //         this.getSignalCode(globalThis),
        //         waitpid_value,
        //     };

        //     const result = callback.callWithThis(
        //         globalThis,
        //         this_value,
        //         &args,
        //     );

        //     if (result.isAnyError()) {
        //         globalThis.bunVM().onUnhandledError(globalThis, result);
        //     }
        // }
    }

    fn onExit(
        this: *ShellSubprocess,
        globalThis: *JSC.JSGlobalObject,
    ) void {
        log("onExit({d}) = {d}, \"{s}\"", .{ this.pid, if (this.exit_code) |e| @as(i32, @intCast(e)) else -1, if (this.signal_code) |code| @tagName(code) else "" });
        // defer this.updateHasPendingActivity();

        if (this.hasExited()) {
            {
                this.flags.waiting_for_onexit = true;

                const Holder = struct {
                    process: *ShellSubprocess,
                    task: JSC.AnyTask,

                    pub fn unref(self: *@This()) void {
                        // this calls disableKeepingProcessAlive on pool_ref and stdin, stdout, stderr
                        self.process.flags.waiting_for_onexit = false;
                        self.process.unref(true);
                        // self.process.updateHasPendingActivity();
                        bun.default_allocator.destroy(self);
                    }
                };

                var holder = bun.default_allocator.create(Holder) catch @panic("OOM");

                holder.* = .{
                    .process = this,
                    .task = JSC.AnyTask.New(Holder, Holder.unref).init(holder),
                };

                this.globalThis.bunVM().enqueueTask(JSC.Task.init(&holder.task));
            }

            this.runOnExit(globalThis);
        }
    }

    const os = std.os;
    fn destroyPipe(pipe: [2]os.fd_t) void {
        os.close(pipe[0]);
        if (pipe[0] != pipe[1]) os.close(pipe[1]);
    }

    pub fn extractStdioBlob(
        globalThis: *JSC.JSGlobalObject,
        blob: JSC.WebCore.AnyBlob,
        i: u32,
        stdio_array: []Stdio,
    ) bool {
        return util.extractStdioBlob(globalThis, blob, i, stdio_array);
    }

    pub const WaiterThread = util.NewWaiterThread(ShellSubprocess, false);
};
