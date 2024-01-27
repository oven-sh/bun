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

// pub const ShellSubprocess = NewShellSubprocess(.js);
// pub const ShellSubprocessMini = NewShellSubprocess(.mini);

pub const ShellSubprocess = NewShellSubprocess(.js, bun.shell.interpret.Interpreter.Cmd);
pub const ShellSubprocessMini = NewShellSubprocess(.mini, bun.shell.interpret.InterpreterMini.Cmd);

pub fn NewShellSubprocess(comptime EventLoopKind: JSC.EventLoopKind, comptime ShellCmd: type) type {
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

        pub const Process = bun.spawn.Process;

        pub const GlobalHandle = switch (EventLoopKind) {
            .js => bun.shell.GlobalJS,
            .mini => bun.shell.GlobalMini,
        };

        cmd_parent: ?*ShellCmd = null,

        process: *Process,

        stdin: Writable,
        stdout: Readable,
        stderr: Readable,

        globalThis: GlobalRef,

        closed: std.enums.EnumSet(enum {
            stdin,
            stdout,
            stderr,
        }) = .{},
        this_jsvalue: JSC.JSValue = .zero,

        flags: Flags = .{},

        pub const OutKind = util.OutKind;

        pub const Flags = packed struct(u3) {
            is_sync: bool = false,
            killed: bool = false,
            waiting_for_onexit: bool = false,
        };
        pub const SignalCode = bun.SignalCode;

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

            pub fn init(subproc: *Subprocess, stdio: Stdio, fd: ?bun.FileDescriptor, globalThis: GlobalRef) !Writable {
                switch (stdio) {
                    .pipe => {
                        // var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                        var sink = try GlobalHandle.init(globalThis).allocator().create(FileSink);
                        sink.* = .{
                            .fd = fd.?,
                            .buffer = bun.ByteList{},
                            .allocator = GlobalHandle.init(globalThis).allocator(),
                            .auto_close = true,
                        };
                        sink.mode = std.os.S.IFIFO;
                        sink.watch(fd.?);
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
                        var buffered_input: BufferedInput = .{ .fd = fd.?, .source = undefined, .subproc = subproc };
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
                        return Writable{ .fd = fd.? };
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

            pub fn init(subproc: *Subprocess, comptime kind: OutKind, stdio: Stdio, fd: ?bun.FileDescriptor, allocator: std.mem.Allocator, max_size: u32) Readable {
                return switch (stdio) {
                    .ignore => Readable{ .ignore = {} },
                    .pipe => {
                        var subproc_readable_ptr = subproc.getIO(kind);
                        subproc_readable_ptr.* = Readable{ .pipe = .{ .buffer = undefined } };
                        BufferedOutput.initWithAllocator(subproc, &subproc_readable_ptr.pipe.buffer, kind, allocator, fd.?, max_size);
                        return subproc_readable_ptr.*;
                    },
                    .inherit => {
                        // Same as pipe
                        if (stdio.inherit.captured != null) {
                            var subproc_readable_ptr = subproc.getIO(kind);
                            subproc_readable_ptr.* = Readable{ .pipe = .{ .buffer = undefined } };
                            BufferedOutput.initWithAllocator(subproc, &subproc_readable_ptr.pipe.buffer, kind, allocator, fd.?, max_size);
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
                    .blob, .fd => Readable{ .fd = fd.? },
                    .array_buffer => {
                        var subproc_readable_ptr = subproc.getIO(kind);
                        subproc_readable_ptr.* = Readable{
                            .pipe = .{
                                .buffer = undefined,
                            },
                        };
                        if (stdio.array_buffer.from_jsc) {
                            BufferedOutput.initWithArrayBuffer(subproc, &subproc_readable_ptr.pipe.buffer, kind, fd.?, stdio.array_buffer.buf);
                        } else {
                            subproc_readable_ptr.pipe.buffer = BufferedOutput.initWithSlice(subproc, kind, fd.?, stdio.array_buffer.buf.slice());
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
            return this.process.hasExited();
        }

        pub fn ref(this: *Subprocess) void {
            this.process.enableKeepingEventLoopAlive();

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
            _ = deactivate_poll_ref; // autofix
            // const vm = this.globalThis.bunVM();

            this.process.disableKeepingEventLoopAlive();
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
            return this.process.hasKilled();
        }

        pub fn tryKill(this: *@This(), sig: i32) JSC.Node.Maybe(void) {
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

            this.closeIO(.stdin);
            this.closeIO(.stdout);
            this.closeIO(.stderr);
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

            _ = switch (spawnMaybeSyncImpl(
                .{
                    .is_sync = false,
                },
                globalThis_,
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
            globalThis_: GlobalRef,
            allocator: Allocator,
            spawn_args: *SpawnArgs,
            out_subproc: **@This(),
        ) bun.shell.Result(*@This()) {
            const globalThis = GlobalHandle.init(globalThis_);
            const is_sync = config.is_sync;

            if (!spawn_args.override_env and spawn_args.env_array.items.len == 0) {
                // spawn_args.env_array.items = jsc_vm.bundler.env.map.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
                spawn_args.env_array.items = globalThis.createNullDelimitedEnvMap(allocator) catch bun.outOfMemory();
                spawn_args.env_array.capacity = spawn_args.env_array.items.len;
            }

            var spawn_options = bun.spawn.SpawnOptions{
                .cwd = spawn_args.cwd,
                .stdin = spawn_args.stdio[0].toPosix(),
                .stdout = spawn_args.stdio[1].toPosix(),
                .stderr = spawn_args.stdio[2].toPosix(),
            };

            spawn_args.argv.append(allocator, null) catch {
                return .{ .err = globalThis.throw("out of memory", .{}) };
            };

            spawn_args.env_array.append(allocator, null) catch {
                return .{ .err = globalThis.throw("out of memory", .{}) };
            };

            const spawn_result = bun.spawn.spawnProcess(
                &spawn_options,
                @ptrCast(spawn_args.argv.items.ptr),
                @ptrCast(spawn_args.env_array.items.ptr),
            ) catch |err| {
                return .{ .err = globalThis.throw("Failed to spawn process: {s}", .{@errorName(err)}) };
            };

            var subprocess = globalThis.allocator().create(Subprocess) catch bun.outOfMemory();
            out_subproc.* = subprocess;
            subprocess.* = Subprocess{
                .globalThis = globalThis_,
                .process = Process.initPosix(
                    spawn_result,
                    if (comptime EventLoopKind == .js) globalThis.eventLoopCtx().eventLoop() else globalThis.eventLoopCtx(),
                    is_sync,
                ),
                .stdin = Subprocess.Writable.init(subprocess, spawn_args.stdio[0], spawn_result.stdin, globalThis_) catch bun.outOfMemory(),
                // Readable initialization functions won't touch the subrpocess pointer so it's okay to hand it to them even though it technically has undefined memory at the point of Readble initialization
                // stdout and stderr only uses allocator and default_max_buffer_size if they are pipes and not a array buffer
                .stdout = Subprocess.Readable.init(subprocess, .stdout, spawn_args.stdio[1], spawn_result.stdout, globalThis.getAllocator(), Subprocess.default_max_buffer_size),
                .stderr = Subprocess.Readable.init(subprocess, .stderr, spawn_args.stdio[2], spawn_result.stderr, globalThis.getAllocator(), Subprocess.default_max_buffer_size),
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
                switch (subprocess.process.watch(globalThis.eventLoopCtx())) {
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
            return this.process.wait(sync);
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

const WaiterThread = bun.spawn.WaiterThread;
