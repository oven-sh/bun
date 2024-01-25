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

const util = @import("./util.zig");

pub const Stdio = util.Stdio;

// pub const ShellSubprocess = NewShellSubprocess(.js);
// pub const ShellSubprocessMini = NewShellSubprocess(.mini);

pub const ShellSubprocess = NewShellSubprocess(.js, bun.shell.interpret.Interpreter.Cmd);
pub const ShellSubprocessMini = NewShellSubprocess(.mini, bun.shell.interpret.InterpreterMini.Cmd);

pub fn NewShellSubprocess(comptime EventLoopKind: JSC.EventLoopKind, comptime ShellCmd: type) type {
    const EventLoopRef = switch (EventLoopKind) {
        .js => *JSC.EventLoop,
        .mini => *JSC.MiniEventLoop,
    };
    _ = EventLoopRef; // autofix

    const GlobalRef = switch (EventLoopKind) {
        .js => *JSC.JSGlobalObject,
        .mini => *JSC.MiniEventLoop,
    };

    const FIFO = switch (EventLoopKind) {
        .js => JSC.WebCore.FIFO,
        .mini => JSC.WebCore.FIFOMini,
    };
    const FileSink = switch (EventLoopKind) {
        .js => JSC.WebCore.FileSink,
        .mini => JSC.WebCore.FileSinkMini,
    };

    const Vm = switch (EventLoopKind) {
        .js => *JSC.VirtualMachine,
        .mini => *JSC.MiniEventLoop,
    };

    const get_vm = struct {
        fn get() Vm {
            return switch (EventLoopKind) {
                .js => JSC.VirtualMachine.get(),
                .mini => bun.JSC.MiniEventLoop.global,
            };
        }
    };

    // const ShellCmd = switch (EventLoopKind) {
    //     .js => bun.shell.interpret.Interpreter.Cmd,
    //     .mini => bun.shell.interpret.InterpreterMini.Cmd,
    // };
    // const ShellCmd = bun.shell.interpret.NewInterpreter(EventLoopKind);

    return struct {
        const Subprocess = @This();
        const log = Output.scoped(.SHELL_SUBPROC, false);
        pub const default_max_buffer_size = 1024 * 1024 * 4;

        pub const GlobalHandle = switch (EventLoopKind) {
            .js => bun.shell.GlobalJS,
            .mini => bun.shell.GlobalMini,
        };

        cmd_parent: ?*ShellCmd = null,
        pid: std.os.pid_t,
        // on macOS, this is nothing
        // on linux, it's a pidfd
        pidfd: if (Environment.isLinux) bun.FileDescriptor else u0 = if (Environment.isLinux) bun.invalid_fd else 0,

        stdin: Writable,
        stdout: Readable,
        stderr: Readable,
        poll: Poll = Poll{ .poll_ref = null },

        // on_exit_callback: JSC.Strong = .{},

        exit_code: ?u8 = null,
        signal_code: ?SignalCode = null,
        waitpid_err: ?bun.sys.Error = null,

        globalThis: GlobalRef,
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
        // pub const Stdio = util.Stdio;

        pub const Flags = packed struct(u3) {
            is_sync: bool = false,
            killed: bool = false,
            waiting_for_onexit: bool = false,
        };
        pub const SignalCode = bun.SignalCode;

        pub const Poll = union(enum) {
            poll_ref: ?*Async.FilePoll,
            wait_thread: WaitThreadPoll,
        };

        pub const WaitThreadPoll = struct {
            ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
            poll_ref: Async.KeepAlive = .{},
        };

        pub const Writable = union(enum) {
            pipe: *FileSink,
            pipe_to_readable_stream: struct {
                pipe: *FileSink,
                readable_stream: JSC.WebCore.ReadableStream,
            },
            fd: bun.FileDescriptor,
            buffered_input: BufferedInput,
            inherit: void,
            ignore: void,

            pub fn ref(this: *Writable) void {
                switch (this.*) {
                    .pipe => {
                        if (this.pipe.poll_ref) |poll| {
                            poll.enableKeepingProcessAlive(get_vm.get());
                        }
                    },
                    else => {},
                }
            }

            pub fn unref(this: *Writable) void {
                switch (this.*) {
                    .pipe => {
                        if (this.pipe.poll_ref) |poll| {
                            poll.enableKeepingProcessAlive(get_vm.get());
                        }
                    },
                    else => {},
                }
            }

            // When the stream has closed we need to be notified to prevent a use-after-free
            // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
            pub fn onClose(this: *Writable, _: ?bun.sys.Error) void {
                this.* = .{
                    .ignore = {},
                };
            }
            pub fn onReady(_: *Writable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}
            pub fn onStart(_: *Writable) void {}

            pub fn init(subproc: *Subprocess, stdio: Stdio, fd: bun.FileDescriptor, globalThis: GlobalRef) !Writable {
                switch (stdio) {
                    .pipe => {
                        // var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                        var sink = try GlobalHandle.init(globalThis).allocator().create(FileSink);
                        sink.* = .{
                            .fd = fd,
                            .buffer = bun.ByteList{},
                            .allocator = GlobalHandle.init(globalThis).allocator(),
                            .auto_close = true,
                        };
                        sink.mode = std.os.S.IFIFO;
                        sink.watch(fd);
                        if (stdio == .pipe) {
                            if (stdio.pipe) |readable| {
                                if (comptime EventLoopKind == .mini) @panic("FIXME TODO error gracefully but wait can this even happen");
                                return Writable{
                                    .pipe_to_readable_stream = .{
                                        .pipe = sink,
                                        .readable_stream = readable,
                                    },
                                };
                            }
                        }

                        return Writable{ .pipe = sink };
                    },
                    .array_buffer, .blob => {
                        var buffered_input: BufferedInput = .{ .fd = fd, .source = undefined, .subproc = subproc };
                        switch (stdio) {
                            .array_buffer => |array_buffer| {
                                buffered_input.source = .{ .array_buffer = array_buffer.buf };
                            },
                            .blob => |blob| {
                                buffered_input.source = .{ .blob = blob };
                            },
                            else => unreachable,
                        }
                        return Writable{ .buffered_input = buffered_input };
                    },
                    .fd => {
                        return Writable{ .fd = fd };
                    },
                    .inherit => {
                        return Writable{ .inherit = {} };
                    },
                    .path, .ignore => {
                        return Writable{ .ignore = {} };
                    },
                }
            }

            pub fn toJS(this: Writable, globalThis: *JSC.JSGlobalObject) JSValue {
                return switch (this) {
                    .pipe => |pipe| pipe.toJS(globalThis),
                    .fd => |fd| JSValue.jsNumber(fd),
                    .ignore => JSValue.jsUndefined(),
                    .inherit => JSValue.jsUndefined(),
                    .buffered_input => JSValue.jsUndefined(),
                    .pipe_to_readable_stream => this.pipe_to_readable_stream.readable_stream.value,
                };
            }

            pub fn finalize(this: *Writable) void {
                return switch (this.*) {
                    .pipe => |pipe| {
                        pipe.close();
                    },
                    .pipe_to_readable_stream => |*pipe_to_readable_stream| {
                        _ = pipe_to_readable_stream.pipe.end(null);
                    },
                    .fd => |fd| {
                        _ = bun.sys.close(fd);
                        this.* = .{ .ignore = {} };
                    },
                    .buffered_input => {
                        this.buffered_input.deinit();
                    },
                    .ignore => {},
                    .inherit => {},
                };
            }

            pub fn close(this: *Writable) void {
                return switch (this.*) {
                    .pipe => {},
                    .pipe_to_readable_stream => |*pipe_to_readable_stream| {
                        _ = pipe_to_readable_stream.pipe.end(null);
                    },
                    .fd => |fd| {
                        _ = bun.sys.close(fd);
                        this.* = .{ .ignore = {} };
                    },
                    .buffered_input => {
                        this.buffered_input.deinit();
                    },
                    .ignore => {},
                    .inherit => {},
                };
            }
        };

        pub const Readable = union(enum) {
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
                                poll.enableKeepingProcessAlive(get_vm.get());
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
                                poll.enableKeepingProcessAlive(get_vm.get());
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

            pub fn init(subproc: *Subprocess, comptime kind: OutKind, stdio: Stdio, fd: bun.FileDescriptor, allocator: std.mem.Allocator, max_size: u32) Readable {
                return switch (stdio) {
                    .ignore => Readable{ .ignore = {} },
                    .pipe => {
                        var subproc_readable_ptr = subproc.getIO(kind);
                        subproc_readable_ptr.* = Readable{ .pipe = .{ .buffer = undefined } };
                        BufferedOutput.initWithAllocator(subproc, &subproc_readable_ptr.pipe.buffer, kind, allocator, fd, max_size);
                        return subproc_readable_ptr.*;
                    },
                    .inherit => {
                        // Same as pipe
                        if (stdio.inherit.captured != null) {
                            var subproc_readable_ptr = subproc.getIO(kind);
                            subproc_readable_ptr.* = Readable{ .pipe = .{ .buffer = undefined } };
                            BufferedOutput.initWithAllocator(subproc, &subproc_readable_ptr.pipe.buffer, kind, allocator, fd, max_size);
                            subproc_readable_ptr.pipe.buffer.out = stdio.inherit.captured.?;
                            subproc_readable_ptr.pipe.buffer.writer = BufferedOutput.CapturedBufferedWriter{
                                .src = BufferedOutput.WriterSrc{
                                    .inner = &subproc_readable_ptr.pipe.buffer,
                                },
                                .fd = if (kind == .stdout) bun.STDOUT_FD else bun.STDERR_FD,
                                .parent = .{ .parent = &subproc_readable_ptr.pipe.buffer },
                            };
                            return subproc_readable_ptr.*;
                        }

                        return Readable{ .inherit = {} };
                    },
                    .path => Readable{ .ignore = {} },
                    .blob, .fd => Readable{ .fd = fd },
                    .array_buffer => {
                        var subproc_readable_ptr = subproc.getIO(kind);
                        subproc_readable_ptr.* = Readable{
                            .pipe = .{
                                .buffer = undefined,
                            },
                        };
                        if (stdio.array_buffer.from_jsc) {
                            BufferedOutput.initWithArrayBuffer(subproc, &subproc_readable_ptr.pipe.buffer, kind, fd, stdio.array_buffer.buf);
                        } else {
                            subproc_readable_ptr.pipe.buffer = BufferedOutput.initWithSlice(subproc, kind, fd, stdio.array_buffer.buf.slice());
                        }
                        return subproc_readable_ptr.*;
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

                        const bytes = this.pipe.buffer.internal_buffer.slice();
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

                        const bytes = this.pipe.buffer.internal_buffer.slice();
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
            fifo: FIFO = undefined,
            internal_buffer: bun.ByteList = .{},
            auto_sizer: ?JSC.WebCore.AutoSizer = null,
            subproc: *Subprocess,
            out_type: OutKind,
            /// Sometimes the `internal_buffer` may be filled with memory from JSC,
            /// for example an array buffer. In that case we shouldn't dealloc
            /// memory and let the GC do it.
            from_jsc: bool = false,
            status: Status = .{
                .pending = {},
            },
            recall_readall: bool = true,
            /// Used to allow to write to fd and also capture the data
            writer: ?CapturedBufferedWriter = null,
            out: ?*bun.ByteList = null,

            const WriterSrc = struct {
                inner: *BufferedOutput,

                pub inline fn bufToWrite(this: WriterSrc, written: usize) []const u8 {
                    if (written >= this.inner.internal_buffer.len) return "";
                    return this.inner.internal_buffer.ptr[written..this.inner.internal_buffer.len];
                }

                pub inline fn isDone(this: WriterSrc, written: usize) bool {
                    // need to wait for more input
                    if (this.inner.status != .done and this.inner.status != .err) return false;
                    return written >= this.inner.internal_buffer.len;
                }
            };

            pub const CapturedBufferedWriter = bun.shell.eval.NewBufferedWriter(
                WriterSrc,
                struct {
                    parent: *BufferedOutput,
                    pub inline fn onDone(this: @This(), e: ?bun.sys.Error) void {
                        this.parent.onBufferedWriterDone(e);
                    }
                },
                EventLoopKind,
            );

            pub const Status = union(enum) {
                pending: void,
                done: void,
                err: bun.sys.Error,
            };

            pub fn init(subproc: *Subprocess, out_type: OutKind, fd: bun.FileDescriptor) BufferedOutput {
                return BufferedOutput{
                    .out_type = out_type,
                    .subproc = subproc,
                    .internal_buffer = .{},
                    .fifo = FIFO{
                        .fd = fd,
                    },
                };
            }

            pub fn initWithArrayBuffer(subproc: *Subprocess, out: *BufferedOutput, comptime out_type: OutKind, fd: bun.FileDescriptor, array_buf: JSC.ArrayBuffer.Strong) void {
                out.* = BufferedOutput.initWithSlice(subproc, out_type, fd, array_buf.slice());
                out.from_jsc = true;
                out.fifo.view = array_buf.held;
                out.fifo.buf = out.internal_buffer.ptr[0..out.internal_buffer.cap];
            }

            pub fn initWithSlice(subproc: *Subprocess, comptime out_type: OutKind, fd: bun.FileDescriptor, slice: []u8) BufferedOutput {
                return BufferedOutput{
                    // fixed capacity
                    .internal_buffer = bun.ByteList.initWithBuffer(slice),
                    .auto_sizer = null,
                    .subproc = subproc,
                    .fifo = FIFO{
                        .fd = fd,
                    },
                    .out_type = out_type,
                };
            }

            pub fn initWithAllocator(subproc: *Subprocess, out: *BufferedOutput, comptime out_type: OutKind, allocator: std.mem.Allocator, fd: bun.FileDescriptor, max_size: u32) void {
                out.* = init(subproc, out_type, fd);
                out.auto_sizer = .{
                    .max = max_size,
                    .allocator = allocator,
                    .buffer = &out.internal_buffer,
                };
                out.fifo.auto_sizer = &out.auto_sizer.?;
            }

            pub fn onBufferedWriterDone(this: *BufferedOutput, e: ?bun.sys.Error) void {
                _ = e; // autofix

                defer this.signalDoneToCmd();
                // if (e) |err| {
                //     this.status = .{ .err = err };
                // }
            }

            pub fn isDone(this: *BufferedOutput) bool {
                if (this.status != .done and this.status != .err) return false;
                if (this.writer != null) {
                    return this.writer.?.isDone();
                }
                return true;
            }

            pub fn signalDoneToCmd(this: *BufferedOutput) void {
                log("signalDoneToCmd ({x}: {s}) isDone={any}", .{ @intFromPtr(this), @tagName(this.out_type), this.isDone() });
                // `this.fifo.close()` will be called from the parent
                // this.fifo.close();
                if (!this.isDone()) return;
                if (this.subproc.cmd_parent) |cmd| {
                    if (this.writer != null) {
                        if (this.writer.?.err) |e| {
                            if (this.status != .err) {
                                this.status = .{ .err = e };
                            }
                        }
                    }
                    cmd.bufferedOutputClose(this.out_type);
                }
            }

            /// This is called after it is read (it's confusing because "on read" could
            /// be interpreted as present or past tense)
            pub fn onRead(this: *BufferedOutput, result: JSC.WebCore.StreamResult) void {
                log("ON READ {s} result={s}", .{ @tagName(this.out_type), @tagName(result) });
                defer {
                    if (this.status == .err or this.status == .done) {
                        this.signalDoneToCmd();
                    } else if (this.recall_readall and this.recall_readall) {
                        this.readAll();
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
                        const slice = switch (result) {
                            .into_array => this.fifo.buf[0..result.into_array.len],
                            else => result.slice(),
                        };
                        log("buffered output ({s}) onRead: {s}", .{ @tagName(this.out_type), slice });
                        this.internal_buffer.len += @as(u32, @truncate(slice.len));
                        if (slice.len > 0)
                            std.debug.assert(this.internal_buffer.contains(slice));

                        if (this.writer != null) {
                            this.writer.?.writeIfPossible(false);
                        }

                        this.fifo.buf = this.internal_buffer.ptr[@min(this.internal_buffer.len, this.internal_buffer.cap)..this.internal_buffer.cap];

                        if (result.isDone() or (slice.len == 0 and this.fifo.poll_ref != null and this.fifo.poll_ref.?.isHUP())) {
                            this.status = .{ .done = {} };
                            // this.fifo.close();
                            // this.closeFifoSignalCmd();
                        }
                    },
                }
            }

            pub fn readAll(this: *BufferedOutput) void {
                log("ShellBufferedOutput.readAll doing nothing", .{});
                this.watch();
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

        pub const BufferedInput = struct {
            remain: []const u8 = "",
            subproc: *Subprocess,
            fd: bun.FileDescriptor = bun.invalid_fd,
            poll_ref: ?*Async.FilePoll = null,
            written: usize = 0,

            source: union(enum) {
                blob: JSC.WebCore.AnyBlob,
                array_buffer: JSC.ArrayBuffer.Strong,
            },

            pub const event_loop_kind = EventLoopKind;
            pub usingnamespace JSC.WebCore.NewReadyWatcher(BufferedInput, .writable, onReady);

            pub fn onReady(this: *BufferedInput, _: i64) void {
                if (this.fd == bun.invalid_fd) {
                    return;
                }

                this.write();
            }

            pub fn writeIfPossible(this: *BufferedInput, comptime is_sync: bool) void {
                if (comptime !is_sync) {

                    // we ask, "Is it possible to write right now?"
                    // we do this rather than epoll or kqueue()
                    // because we don't want to block the thread waiting for the write
                    switch (bun.isWritable(this.fd)) {
                        .ready => {
                            if (this.poll_ref) |poll| {
                                poll.flags.insert(.writable);
                                poll.flags.insert(.fifo);
                                std.debug.assert(poll.flags.contains(.poll_writable));
                            }
                        },
                        .hup => {
                            this.deinit();
                            return;
                        },
                        .not_ready => {
                            if (!this.isWatching()) this.watch(this.fd);
                            return;
                        },
                    }
                }

                this.writeAllowBlocking(is_sync);
            }

            pub fn write(this: *BufferedInput) void {
                this.writeAllowBlocking(false);
            }

            pub fn writeAllowBlocking(this: *BufferedInput, allow_blocking: bool) void {
                var to_write = this.remain;

                if (to_write.len == 0) {
                    // we are done!
                    this.closeFDIfOpen();
                    return;
                }

                if (comptime bun.Environment.allow_assert) {
                    // bun.assertNonBlocking(this.fd);
                }

                while (to_write.len > 0) {
                    switch (bun.sys.write(this.fd, to_write)) {
                        .err => |e| {
                            if (e.isRetry()) {
                                log("write({d}) retry", .{
                                    to_write.len,
                                });

                                this.watch(this.fd);
                                this.poll_ref.?.flags.insert(.fifo);
                                return;
                            }

                            if (e.getErrno() == .PIPE) {
                                this.deinit();
                                return;
                            }

                            // fail
                            log("write({d}) fail: {d}", .{ to_write.len, e.errno });
                            this.deinit();
                            return;
                        },

                        .result => |bytes_written| {
                            this.written += bytes_written;

                            log(
                                "write({d}) {d}",
                                .{
                                    to_write.len,
                                    bytes_written,
                                },
                            );

                            this.remain = this.remain[@min(bytes_written, this.remain.len)..];
                            to_write = to_write[bytes_written..];

                            // we are done or it accepts no more input
                            if (this.remain.len == 0 or (allow_blocking and bytes_written == 0)) {
                                this.deinit();
                                return;
                            }
                        },
                    }
                }
            }

            fn closeFDIfOpen(this: *BufferedInput) void {
                if (this.poll_ref) |poll| {
                    this.poll_ref = null;
                    poll.deinit();
                }

                if (this.fd != bun.invalid_fd) {
                    _ = bun.sys.close(this.fd);
                    this.fd = bun.invalid_fd;
                }
            }

            pub fn deinit(this: *BufferedInput) void {
                this.closeFDIfOpen();

                switch (this.source) {
                    .blob => |*blob| {
                        blob.detach();
                    },
                    .array_buffer => |*array_buffer| {
                        array_buffer.deinit();
                    },
                }
                if (this.subproc.cmd_parent) |cmd| {
                    cmd.bufferedInputClose();
                }
            }
        };

        pub fn getIO(this: *Subprocess, comptime out_kind: OutKind) *Readable {
            switch (out_kind) {
                .stdout => return &this.stdout,
                .stderr => return &this.stderr,
            }
        }

        pub fn hasExited(this: *const Subprocess) bool {
            return this.exit_code != null or this.waitpid_err != null or this.signal_code != null;
        }

        pub fn ref(this: *Subprocess) void {
            // const vm = this.globalThis.bunVM();

            switch (this.poll) {
                .poll_ref => if (this.poll.poll_ref) |poll| {
                    // if (poll.flags.contains(.enable)
                    poll.ref(GlobalHandle.init(this.globalThis).eventLoopCtx());
                },
                .wait_thread => |*wait_thread| {
                    wait_thread.poll_ref.ref(GlobalHandle.init(this.globalThis).eventLoopCtx());
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
        pub fn unref(this: *@This(), comptime deactivate_poll_ref: bool) void {
            // const vm = this.globalThis.bunVM();

            switch (this.poll) {
                .poll_ref => if (this.poll.poll_ref) |poll| {
                    if (deactivate_poll_ref) {
                        poll.onEnded(GlobalHandle.init(this.globalThis).eventLoopCtx());
                    } else {
                        poll.unref(GlobalHandle.init(this.globalThis).eventLoopCtx());
                    }
                },
                .wait_thread => |*wait_thread| {
                    wait_thread.poll_ref.unref(GlobalHandle.init(this.globalThis).eventLoopCtx());
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

        pub fn hasKilled(this: *const @This()) bool {
            return this.exit_code != null or this.signal_code != null;
        }

        pub fn tryKill(this: *@This(), sig: i32) JSC.Node.Maybe(void) {
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
                        const rc = std.os.linux.pidfd_send_signal(this.pidfd.cast(), @as(u8, @intCast(sig)), null, 0);

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

        fn closeProcess(this: *@This()) void {
            if (comptime !Environment.isLinux) {
                return;
            }

            const pidfd = this.pidfd;

            this.pidfd = bun.invalid_fd;

            if (pidfd != bun.invalid_fd) {
                _ = bun.sys.close(pidfd);
            }
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

            this.closeIO(.stdin);
            this.closeIO(.stdout);
            this.closeIO(.stderr);

            // this.exit_promise.deinit();
            // Deinitialization of the shell state is handled by the shell state machine
            // this.on_exit_callback.deinit();
        }

        pub fn deinit(this: *@This()) void {
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
                .{ .inherit = .{} },
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

            pub fn default(arena: *bun.ArenaAllocator, jsc_vm: GlobalRef, comptime is_sync: bool) SpawnArgs {
                var out: SpawnArgs = .{
                    .arena = arena,

                    .override_env = false,
                    .env_array = .{
                        .items = &.{},
                        .capacity = 0,
                    },
                    .cwd = GlobalHandle.init(jsc_vm).topLevelDir(),
                    .stdio = .{
                        .{ .ignore = {} },
                        .{ .pipe = null },
                        .{ .inherit = .{} },
                    },
                    .lazy = false,
                    .PATH = GlobalHandle.init(jsc_vm).env().get("PATH") orelse "",
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
            globalThis_: GlobalRef,
            spawn_args_: SpawnArgs,
            out: **@This(),
        ) bun.shell.Result(void) {
            const globalThis = GlobalHandle.init(globalThis_);
            if (comptime Environment.isWindows) {
                return .{ .err = globalThis.throwTODO("spawn() is not yet implemented on Windows") };
            }
            var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();

            var spawn_args = spawn_args_;

            var out_watchfd: ?WatchFd = null;

            const subprocess = switch (spawnMaybeSyncImpl(
                .{
                    .is_sync = false,
                },
                globalThis_,
                arena.allocator(),
                &out_watchfd,
                &spawn_args,
                out,
            )) {
                .result => |subproc| subproc,
                .err => |err| return .{ .err = err },
            };
            _ = subprocess; // autofix

            return bun.shell.Result(void).success;
        }

        pub fn spawnSync(
            globalThis: *JSC.JSGlobalObject,
            spawn_args_: SpawnArgs,
        ) !?*@This() {
            if (comptime Environment.isWindows) {
                globalThis.throwTODO("spawn() is not yet implemented on Windows");
                return null;
            }
            const is_sync = true;
            var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            var jsc_vm = globalThis.bunVM();

            var spawn_args = spawn_args_;

            var out_err: ?JSValue = null;
            var out_watchfd: if (Environment.isLinux) ?std.os.fd_t else ?i32 = null;
            var subprocess = util.spawnMaybeSyncImpl(
                .{
                    .SpawnArgs = SpawnArgs,
                    .Subprocess = @This(),
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
                const poll = Async.FilePoll.init(jsc_vm, watchfd, .{}, @This(), subprocess);
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
                WaiterThread.appendShell(
                    Subprocess,
                    subprocess,
                );
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

        pub fn spawnMaybeSyncImpl(
            comptime config: struct {
                is_sync: bool,
            },
            globalThis_: GlobalRef,
            allocator: Allocator,
            out_watchfd: *?WatchFd,
            spawn_args: *SpawnArgs,
            out_subproc: **@This(),
        ) bun.shell.Result(*@This()) {
            const globalThis = GlobalHandle.init(globalThis_);
            const is_sync = config.is_sync;

            var env: [*:null]?[*:0]const u8 = undefined;

            var attr = PosixSpawn.Attr.init() catch {
                return .{ .err = globalThis.throw("out of memory", .{}) };
            };

            var flags: i32 = bun.C.POSIX_SPAWN_SETSIGDEF | bun.C.POSIX_SPAWN_SETSIGMASK;

            if (comptime Environment.isMac) {
                flags |= bun.C.POSIX_SPAWN_CLOEXEC_DEFAULT;
            }

            if (spawn_args.detached) {
                flags |= bun.C.POSIX_SPAWN_SETSID;
            }

            defer attr.deinit();
            var actions = PosixSpawn.Actions.init() catch |err| {
                return .{ .err = globalThis.handleError(err, "in posix_spawn") };
            };
            if (comptime Environment.isMac) {
                attr.set(@intCast(flags)) catch |err| {
                    return .{ .err = globalThis.handleError(err, "in posix_spawn") };
                };
            } else if (comptime Environment.isLinux) {
                attr.set(@intCast(flags)) catch |err| {
                    return .{ .err = globalThis.handleError(err, "in posix_spawn") };
                };
            }

            attr.resetSignals() catch {
                return .{ .err = globalThis.throw("Failed to reset signals in posix_spawn", .{}) };
            };

            defer actions.deinit();

            if (!spawn_args.override_env and spawn_args.env_array.items.len == 0) {
                // spawn_args.env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
                spawn_args.env_array.items = globalThis.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
                spawn_args.env_array.capacity = spawn_args.env_array.items.len;
            }

            const stdin_pipe = if (spawn_args.stdio[0].isPiped()) bun.sys.pipe().unwrap() catch |err| {
                return .{ .err = globalThis.throw("failed to create stdin pipe: {s}", .{@errorName(err)}) };
            } else undefined;

            const stdout_pipe = if (spawn_args.stdio[1].isPiped()) bun.sys.pipe().unwrap() catch |err| {
                return .{ .err = globalThis.throw("failed to create stdout pipe: {s}", .{@errorName(err)}) };
            } else undefined;

            const stderr_pipe = if (spawn_args.stdio[2].isPiped()) bun.sys.pipe().unwrap() catch |err| {
                return .{ .err = globalThis.throw("failed to create stderr pipe: {s}", .{@errorName(err)}) };
            } else undefined;

            spawn_args.stdio[0].setUpChildIoPosixSpawn(
                &actions,
                stdin_pipe,
                bun.STDIN_FD,
            ) catch |err| {
                return .{ .err = globalThis.handleError(err, "in configuring child stdin") };
            };

            spawn_args.stdio[1].setUpChildIoPosixSpawn(
                &actions,
                stdout_pipe,
                bun.STDOUT_FD,
            ) catch |err| {
                return .{ .err = globalThis.handleError(err, "in configuring child stdout") };
            };

            spawn_args.stdio[2].setUpChildIoPosixSpawn(
                &actions,
                stderr_pipe,
                bun.STDERR_FD,
            ) catch |err| {
                return .{ .err = globalThis.handleError(err, "in configuring child stderr") };
            };

            actions.chdir(spawn_args.cwd) catch |err| {
                return .{ .err = globalThis.handleError(err, "in chdir()") };
            };

            spawn_args.argv.append(allocator, null) catch {
                return .{ .err = globalThis.throw("out of memory", .{}) };
            };

            // // IPC is currently implemented in a very limited way.
            // //
            // // Node lets you pass as many fds as you want, they all become be sockets; then, IPC is just a special
            // // runtime-owned version of "pipe" (in which pipe is a misleading name since they're bidirectional sockets).
            // //
            // // Bun currently only supports three fds: stdin, stdout, and stderr, which are all unidirectional
            // //
            // // And then fd 3 is assigned specifically and only for IPC. This is quite lame, because Node.js allows
            // // the ipc fd to be any number and it just works. But most people only care about the default `.fork()`
            // // behavior, where this workaround suffices.
            // //
            // // When Bun.spawn() is given a `.onMessage` callback, it enables IPC as follows:
            // var socket: if (is_js) IPC.Socket else u0 = undefined;
            // if (comptime is_js) {
            //     if (spawn_args.ipc_mode != .none) {
            //         if (comptime is_sync) {
            //             globalThis.throwInvalidArguments("IPC is not supported in Bun.spawnSync", .{});
            //             return null;
            //         }

            //         spawn_args.env_array.ensureUnusedCapacity(allocator, 2) catch |err| {
            //             out_err.* = globalThis.handleError(err, "in posix_spawn");
            //             return null;
            //         };
            //         spawn_args.env_array.appendAssumeCapacity("BUN_INTERNAL_IPC_FD=3");

            //         var fds: [2]uws.LIBUS_SOCKET_DESCRIPTOR = undefined;
            //         socket = uws.newSocketFromPair(
            //             jsc_vm.rareData().spawnIPCContext(jsc_vm),
            //             @sizeOf(*Subprocess),
            //             &fds,
            //         ) orelse {
            //             globalThis.throw("failed to create socket pair: E{s}", .{
            //                 @tagName(bun.sys.getErrno(-1)),
            //             });
            //             return null;
            //         };
            //         actions.dup2(fds[1], 3) catch |err| {
            //             out_err.* = globalThis.handleError(err, "in posix_spawn");
            //             return null;
            //         };
            //     }
            // }

            spawn_args.env_array.append(allocator, null) catch {
                return .{ .err = globalThis.throw("out of memory", .{}) };
            };
            env = @as(@TypeOf(env), @ptrCast(spawn_args.env_array.items.ptr));

            const pid = brk: {
                defer {
                    if (spawn_args.stdio[0].isPiped()) {
                        _ = bun.sys.close(stdin_pipe[0]);
                    }

                    if (spawn_args.stdio[1].isPiped()) {
                        _ = bun.sys.close(stdout_pipe[1]);
                    }

                    if (spawn_args.stdio[2].isPiped()) {
                        _ = bun.sys.close(stderr_pipe[1]);
                    }
                }

                log("spawning", .{});
                break :brk switch (PosixSpawn.spawnZ(spawn_args.argv.items[0].?, actions, attr, @as([*:null]?[*:0]const u8, @ptrCast(spawn_args.argv.items[0..].ptr)), env)) {
                    .err => |err| {
                        log("error spawning", .{});
                        return .{ .err = .{ .sys = err.toSystemError() } };
                    },
                    .result => |pid_| pid_,
                };
            };

            const pidfd: std.os.fd_t = brk: {
                if (!Environment.isLinux or WaiterThread.shouldUseWaiterThread()) {
                    break :brk pid;
                }

                var pidfd_flags = JSC.Subprocess.pidfdFlagsForLinux();

                var rc = std.os.linux.pidfd_open(
                    @intCast(pid),
                    pidfd_flags,
                );
                while (true) {
                    switch (std.os.linux.getErrno(rc)) {
                        .SUCCESS => break :brk @as(std.os.fd_t, @intCast(rc)),
                        .INTR => {
                            rc = std.os.linux.pidfd_open(
                                @intCast(pid),
                                pidfd_flags,
                            );
                            continue;
                        },
                        else => |err| {
                            if (err == .INVAL) {
                                if (pidfd_flags != 0) {
                                    rc = std.os.linux.pidfd_open(
                                        @intCast(pid),
                                        0,
                                    );
                                    pidfd_flags = 0;
                                    continue;
                                }
                            }

                            const error_instance = brk2: {
                                if (err == .NOSYS) {
                                    WaiterThread.setShouldUseWaiterThread();
                                    break :brk pid;
                                }

                                break :brk2 bun.sys.Error.fromCode(err, .open);
                            };
                            var status: u32 = 0;
                            // ensure we don't leak the child process on error
                            _ = std.os.linux.wait4(pid, &status, 0, null);
                            log("Error in getting pidfd", .{});
                            return .{ .err = .{ .sys = error_instance.toSystemError() } };
                        },
                    }
                }
            };

            var subprocess = globalThis.allocator().create(Subprocess) catch bun.outOfMemory();
            out_subproc.* = subprocess;
            subprocess.* = Subprocess{
                .globalThis = globalThis_,
                .pid = pid,
                .pidfd = if (Environment.isLinux and WaiterThread.shouldUseWaiterThread()) bun.toFD(pidfd) else if (Environment.isLinux) bun.invalid_fd else 0,
                .stdin = Subprocess.Writable.init(subprocess, spawn_args.stdio[0], stdin_pipe[1], globalThis_) catch bun.outOfMemory(),
                // Readable initialization functions won't touch the subrpocess pointer so it's okay to hand it to them even though it technically has undefined memory at the point of Readble initialization
                // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
                .stdout = Subprocess.Readable.init(subprocess, .stdout, spawn_args.stdio[1], stdout_pipe[0], globalThis.getAllocator(), Subprocess.default_max_buffer_size),
                .stderr = Subprocess.Readable.init(subprocess, .stderr, spawn_args.stdio[2], stderr_pipe[0], globalThis.getAllocator(), Subprocess.default_max_buffer_size),
                .flags = .{
                    .is_sync = is_sync,
                },
                .cmd_parent = spawn_args.cmd_parent,
            };

            if (subprocess.stdin == .pipe) {
                subprocess.stdin.pipe.signal = JSC.WebCore.Signal.init(&subprocess.stdin);
            }

            var send_exit_notification = false;
            const watchfd = bun.toFD(if (comptime Environment.isLinux) brk: {
                break :brk pidfd;
            } else brk: {
                break :brk pid;
            });
            out_watchfd.* = bun.toFD(watchfd);

            if (comptime !is_sync) {
                if (!WaiterThread.shouldUseWaiterThread()) {
                    const poll = Async.FilePoll.init(globalThis.eventLoopCtx(), watchfd, .{}, Subprocess, subprocess);
                    subprocess.poll = .{ .poll_ref = poll };
                    switch (subprocess.poll.poll_ref.?.register(
                        // jsc_vm.event_loop_handle.?,
                        JSC.AbstractVM(globalThis.eventLoopCtx()).platformEventLoop(),
                        .process,
                        true,
                    )) {
                        .result => {
                            subprocess.poll.poll_ref.?.enableKeepingProcessAlive(globalThis.eventLoopCtx());
                        },
                        .err => |err| {
                            if (err.getErrno() != .SRCH) {
                                @panic("This shouldn't happen");
                            }

                            send_exit_notification = true;
                            spawn_args.lazy = false;
                        },
                    }
                } else {
                    WaiterThread.appendShell(Subprocess, subprocess);
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

        pub fn onExitNotificationTask(this: *@This()) void {
            // var vm = this.globalThis.bunVM();
            const is_sync = this.flags.is_sync;

            defer {
                // if (!is_sync)
                //     vm.drainMicrotasks();
                if (!is_sync) {
                    if (comptime EventLoopKind == .js) this.globalThis.bunVM().drainMicrotasks();
                }
            }
            this.wait(false);
        }

        pub fn onExitNotification(
            this: *@This(),
        ) void {
            std.debug.assert(this.flags.is_sync);

            this.wait(this.flags.is_sync);
        }

        pub fn wait(this: *@This(), sync: bool) void {
            return this.onWaitPid(sync, PosixSpawn.waitpid(this.pid, if (sync) 0 else std.os.W.NOHANG));
        }

        pub fn watch(this: *@This()) JSC.Maybe(void) {
            if (WaiterThread.shouldUseWaiterThread()) {
                WaiterThread.appendShell(@This(), this);
                return JSC.Maybe(void){ .result = {} };
            }

            if (this.poll.poll_ref) |poll| {
                var global_handle = GlobalHandle.init(this.globalThis);
                var event_loop_ctx = JSC.AbstractVM(global_handle.eventLoopCtx());
                const registration = poll.register(
                    // this.globalThis.bunVM().event_loop_handle.?,
                    event_loop_ctx.platformEventLoop(),
                    .process,
                    true,
                );

                return registration;
            } else {
                @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
            }
        }

        pub fn onWaitPid(this: *@This(), sync: bool, waitpid_result_: JSC.Maybe(PosixSpawn.WaitPidResult)) void {
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
                // const vm = this.globalThis.bunVM();

                // prevent duplicate notifications
                switch (this.poll) {
                    .poll_ref => |poll_| {
                        if (poll_) |poll| {
                            this.poll.poll_ref = null;
                            // poll.deinitWithVM(vm);

                            poll.deinitWithVM(GlobalHandle.init(this.globalThis).eventLoopCtx());
                        }
                    },
                    .wait_thread => {
                        // this.poll.wait_thread.poll_ref.deactivate(vm.event_loop_handle.?);
                        this.poll.wait_thread.poll_ref.deactivate(GlobalHandle.init(this.globalThis).platformEventLoop());
                    },
                }

                this.onExit(this.globalThis);
            }
        }

        fn runOnExit(this: *@This(), globalThis: GlobalRef) void {
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
            this: *@This(),
            globalThis: GlobalRef,
        ) void {
            log("onExit({d}) = {d}, \"{s}\"", .{ this.pid, if (this.exit_code) |e| @as(i32, @intCast(e)) else -1, if (this.signal_code) |code| @tagName(code) else "" });
            // defer this.updateHasPendingActivity();

            if (this.hasExited()) {
                {
                    // this.flags.waiting_for_onexit = true;

                    // const Holder = struct {
                    //     process: *@This(),
                    //     task: JSC.AnyTask,

                    //     pub fn unref(self: *@This()) void {
                    //         // this calls disableKeepingProcessAlive on pool_ref and stdin, stdout, stderr
                    //         self.process.flags.waiting_for_onexit = false;
                    //         self.process.unref(true);
                    //         // self.process.updateHasPendingActivity();
                    //         bun.default_allocator.destroy(self);
                    //     }
                    // };

                    // var holder = bun.default_allocator.create(Holder) catch @panic("OOM");

                    // holder.* = .{
                    //     .process = this,
                    //     .task = JSC.AnyTask.New(Holder, Holder.unref).init(holder),
                    // };

                    // this.globalThis.bunVM().enqueueTask(JSC.Task.init(&holder.task));
                }

                this.runOnExit(globalThis);
            }
        }

        const os = std.os;

        pub fn extractStdioBlob(
            globalThis: *JSC.JSGlobalObject,
            blob: JSC.WebCore.AnyBlob,
            i: u32,
            stdio_array: []Stdio,
        ) bool {
            return util.extractStdioBlob(globalThis, blob, i, stdio_array);
        }
    };
}

const WaiterThread = bun.JSC.Subprocess.WaiterThread;
