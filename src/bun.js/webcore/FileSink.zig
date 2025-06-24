const FileSink = @This();

ref_count: RefCount,
writer: IOWriter = .{},
event_loop_handle: JSC.EventLoopHandle,
written: usize = 0,
pending: streams.Result.Writable.Pending = .{
    .result = .{ .done = {} },
},
signal: streams.Signal = .{},
done: bool = false,
started: bool = false,
must_be_kept_alive_until_eof: bool = false,

// TODO: these fields are duplicated on writer()
// we should not duplicate these fields...
pollable: bool = false,
nonblocking: bool = false,
force_sync: bool = false,

is_socket: bool = false,
fd: bun.FileDescriptor = bun.invalid_fd,

auto_flusher: webcore.AutoFlusher = .{},
run_pending_later: FlushPendingTask = .{},

const log = Output.scoped(.FileSink, false);

pub const RefCount = bun.ptr.RefCount(FileSink, "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const IOWriter = bun.io.StreamingWriter(@This(), opaque {
    pub const onClose = FileSink.onClose;
    pub const onWritable = FileSink.onReady;
    pub const onError = FileSink.onError;
    pub const onWrite = FileSink.onWrite;
});
pub const Poll = IOWriter;

pub const Options = struct {
    chunk_size: Blob.SizeType = 1024,
    input_path: webcore.PathOrFileDescriptor,
    truncate: bool = true,
    close: bool = false,
    mode: bun.Mode = 0o664,

    pub fn flags(this: *const Options) i32 {
        _ = this;

        return bun.O.NONBLOCK | bun.O.CLOEXEC | bun.O.CREAT | bun.O.WRONLY;
    }
};

pub fn memoryCost(this: *const FileSink) usize {
    // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(FileSink).
    return this.writer.memoryCost();
}

fn Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(_: *JSC.JSGlobalObject, jsvalue: JSC.JSValue) callconv(.C) void {
    var this: *FileSink = @alignCast(@ptrCast(JSSink.fromJS(jsvalue) orelse return));
    this.force_sync = true;
    if (comptime !Environment.isWindows) {
        this.writer.force_sync = true;
        if (this.fd != bun.invalid_fd) {
            _ = bun.sys.updateNonblocking(this.fd, false);
        }
    }
}

comptime {
    @export(&Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio, .{ .name = "Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio" });
}

pub fn onAttachedProcessExit(this: *FileSink) void {
    log("onAttachedProcessExit()", .{});
    this.done = true;
    this.writer.close();

    this.pending.result = .{ .err = .fromCode(.PIPE, .write) };

    this.runPending();

    if (this.must_be_kept_alive_until_eof) {
        this.must_be_kept_alive_until_eof = false;
        this.deref();
    }
}

fn runPending(this: *FileSink) void {
    this.ref();
    defer this.deref();

    this.run_pending_later.has = false;
    const l = this.eventLoop();
    l.enter();
    defer l.exit();
    this.pending.run();
}

pub fn onWrite(this: *FileSink, amount: usize, status: bun.io.WriteStatus) void {
    log("onWrite({d}, {any})", .{ amount, status });

    this.written += amount;

    // TODO: on windows done means ended (no pending data on the buffer) on unix we can still have pending data on the buffer
    // we should unify the behaviors to simplify this
    const has_pending_data = this.writer.hasPendingData();
    // Only keep the event loop ref'd while there's a pending write in progress.
    // If there's no pending write, no need to keep the event loop ref'd.
    this.writer.updateRef(this.eventLoop(), has_pending_data);

    if (has_pending_data) {
        if (this.event_loop_handle.bunVM()) |vm| {
            if (!vm.is_inside_deferred_task_queue) {
                webcore.AutoFlusher.registerDeferredMicrotaskWithType(@This(), this, vm);
            }
        }
    }

    // if we are not done yet and has pending data we just wait so we do not runPending twice
    if (status == .pending and has_pending_data) {
        if (this.pending.state == .pending) {
            this.pending.consumed = @truncate(amount);
        }
        return;
    }

    if (this.pending.state == .pending) {
        this.pending.consumed = @truncate(amount);

        // when "done" is true, we will never receive more data.
        if (this.done or status == .end_of_file) {
            this.pending.result = .{ .owned_and_done = this.pending.consumed };
        } else {
            this.pending.result = .{ .owned = this.pending.consumed };
        }

        this.runPending();

        // this.done == true means ended was called
        const ended_and_done = this.done and status == .end_of_file;

        if (this.done and status == .drained) {
            // if we call end/endFromJS and we have some pending returned from .flush() we should call writer.end()
            this.writer.end();
        } else if (ended_and_done and !has_pending_data) {
            this.writer.close();
        }
    }

    if (status == .end_of_file) {
        if (this.must_be_kept_alive_until_eof) {
            this.must_be_kept_alive_until_eof = false;
            this.deref();
        }
        this.signal.close(null);
    }
}

pub fn onError(this: *FileSink, err: bun.sys.Error) void {
    log("onError({any})", .{err});
    if (this.pending.state == .pending) {
        this.pending.result = .{ .err = err };
        if (this.eventLoop().bunVM()) |vm| {
            if (vm.is_inside_deferred_task_queue) {
                this.runPendingLater();
                return;
            }
        }

        this.runPending();
    }
}

pub fn onReady(this: *FileSink) void {
    log("onReady()", .{});

    this.signal.ready(null, null);
}

pub fn onClose(this: *FileSink) void {
    log("onClose()", .{});
    this.signal.close(null);
}

pub fn createWithPipe(
    event_loop_: anytype,
    pipe: *uv.Pipe,
) *FileSink {
    if (Environment.isPosix) {
        @compileError("FileSink.createWithPipe is only available on Windows");
    }

    const evtloop = switch (@TypeOf(event_loop_)) {
        JSC.EventLoopHandle => event_loop_,
        else => JSC.EventLoopHandle.init(event_loop_),
    };

    var this = bun.new(FileSink, .{
        .ref_count = .init(),
        .event_loop_handle = JSC.EventLoopHandle.init(evtloop),
        .fd = pipe.fd(),
    });
    this.writer.setPipe(pipe);
    this.writer.setParent(this);
    return this;
}

pub fn create(
    event_loop_: anytype,
    fd: bun.FileDescriptor,
) *FileSink {
    const evtloop = switch (@TypeOf(event_loop_)) {
        JSC.EventLoopHandle => event_loop_,
        else => JSC.EventLoopHandle.init(event_loop_),
    };
    var this = bun.new(FileSink, .{
        .ref_count = .init(),
        .event_loop_handle = JSC.EventLoopHandle.init(evtloop),
        .fd = fd,
    });
    this.writer.setParent(this);
    return this;
}

pub fn setup(this: *FileSink, options: *const FileSink.Options) JSC.Maybe(void) {
    const result = bun.io.openForWriting(
        bun.FileDescriptor.cwd(),
        options.input_path,
        options.flags(),
        options.mode,
        &this.pollable,
        &this.is_socket,
        this.force_sync,
        &this.nonblocking,
        *FileSink,
        this,
        struct {
            fn onForceSyncOrIsaTTY(fs: *FileSink) void {
                if (comptime bun.Environment.isPosix) {
                    fs.force_sync = true;
                    fs.writer.force_sync = true;
                }
            }
        }.onForceSyncOrIsaTTY,
        bun.sys.isPollable,
    );

    const fd = switch (result) {
        .err => |err| {
            return .{ .err = err };
        },
        .result => |fd| fd,
    };

    if (comptime Environment.isWindows) {
        if (this.force_sync) {
            switch (this.writer.startSync(
                fd,
                this.pollable,
            )) {
                .err => |err| {
                    fd.close();
                    return .{ .err = err };
                },
                .result => {
                    this.writer.updateRef(this.eventLoop(), false);
                },
            }
            return .{ .result = {} };
        }
    }

    switch (this.writer.start(
        fd,
        this.pollable,
    )) {
        .err => |err| {
            fd.close();
            return .{ .err = err };
        },
        .result => {
            // Only keep the event loop ref'd while there's a pending write in progress.
            // If there's no pending write, no need to keep the event loop ref'd.
            this.writer.updateRef(this.eventLoop(), false);
            if (comptime Environment.isPosix) {
                if (this.nonblocking) {
                    this.writer.getPoll().?.flags.insert(.nonblocking);
                }

                if (this.is_socket) {
                    this.writer.getPoll().?.flags.insert(.socket);
                } else if (this.pollable) {
                    this.writer.getPoll().?.flags.insert(.fifo);
                }
            }
        },
    }

    return .{ .result = {} };
}

pub fn loop(this: *FileSink) *bun.Async.Loop {
    return this.event_loop_handle.loop();
}

pub fn eventLoop(this: *FileSink) JSC.EventLoopHandle {
    return this.event_loop_handle;
}

pub fn connect(this: *FileSink, signal: streams.Signal) void {
    this.signal = signal;
}

pub fn start(this: *FileSink, stream_start: streams.Start) JSC.Maybe(void) {
    switch (stream_start) {
        .FileSink => |*file| {
            switch (this.setup(file)) {
                .err => |err| {
                    return .{ .err = err };
                },
                .result => {},
            }
        },
        else => {},
    }

    this.done = false;
    this.started = true;
    this.signal.start();
    return .{ .result = {} };
}

pub fn runPendingLater(this: *FileSink) void {
    if (this.run_pending_later.has) {
        return;
    }
    this.run_pending_later.has = true;
    const event_loop = this.eventLoop();
    if (event_loop == .js) {
        this.ref();
        event_loop.js.enqueueTask(JSC.Task.init(&this.run_pending_later));
    }
}

pub fn onAutoFlush(this: *FileSink) bool {
    if (this.done or !this.writer.hasPendingData()) {
        this.updateRef(false);
        this.auto_flusher.registered = false;
        return false;
    }

    this.ref();
    defer this.deref();

    const amount_buffered = this.writer.outgoing.size();

    switch (this.writer.flush()) {
        .err, .done => {
            this.updateRef(false);
            this.runPendingLater();
        },
        .wrote => |amount_drained| {
            if (amount_drained == amount_buffered) {
                this.updateRef(false);
                this.runPendingLater();
            }
        },
        else => {
            return true;
        },
    }

    const is_registered = !this.writer.hasPendingData();
    this.auto_flusher.registered = is_registered;
    return is_registered;
}

pub fn flush(_: *FileSink) JSC.Maybe(void) {
    return .{ .result = {} };
}

pub fn flushFromJS(this: *FileSink, globalThis: *JSGlobalObject, wait: bool) JSC.Maybe(JSValue) {
    _ = wait;

    if (this.pending.state == .pending) {
        return .{ .result = this.pending.future.promise.strong.value() };
    }

    if (this.done) {
        return .initResult(.js_undefined);
    }

    const rc = this.writer.flush();
    switch (rc) {
        .done => |written| {
            this.written += @truncate(written);
        },
        .pending => |written| {
            this.written += @truncate(written);
        },
        .wrote => |written| {
            this.written += @truncate(written);
        },
        .err => |err| {
            return .{ .err = err };
        },
    }
    return switch (this.toResult(rc)) {
        .err => unreachable,
        else => |result| .initResult(result.toJS(globalThis)),
    };
}

pub fn finalize(this: *FileSink) void {
    this.pending.deinit();
    this.deref();
}

pub fn init(fd: bun.FileDescriptor, event_loop_handle: anytype) *FileSink {
    var this = bun.new(FileSink, .{
        .ref_count = .init(),
        .writer = .{},
        .fd = fd,
        .event_loop_handle = JSC.EventLoopHandle.init(event_loop_handle),
    });
    this.writer.setParent(this);

    return this;
}

pub fn construct(this: *FileSink, _: std.mem.Allocator) void {
    this.* = FileSink{
        .ref_count = .init(),
        .event_loop_handle = JSC.EventLoopHandle.init(JSC.VirtualMachine.get().eventLoop()),
    };
}

pub fn write(this: *@This(), data: streams.Result) streams.Result.Writable {
    if (this.done) {
        return .{ .done = {} };
    }

    return this.toResult(this.writer.write(data.slice()));
}
pub const writeBytes = write;
pub fn writeLatin1(this: *@This(), data: streams.Result) streams.Result.Writable {
    if (this.done) {
        return .{ .done = {} };
    }

    return this.toResult(this.writer.writeLatin1(data.slice()));
}
pub fn writeUTF16(this: *@This(), data: streams.Result) streams.Result.Writable {
    if (this.done) {
        return .{ .done = {} };
    }

    return this.toResult(this.writer.writeUTF16(data.slice16()));
}

pub fn end(this: *FileSink, _: ?bun.sys.Error) JSC.Maybe(void) {
    if (this.done) {
        return .{ .result = {} };
    }

    switch (this.writer.flush()) {
        .done => |written| {
            this.written += @truncate(written);
            this.writer.end();
            return .{ .result = {} };
        },
        .err => |e| {
            this.writer.close();
            return .{ .err = e };
        },
        .pending => |written| {
            this.written += @truncate(written);
            if (!this.must_be_kept_alive_until_eof) {
                this.must_be_kept_alive_until_eof = true;
                this.ref();
            }
            this.done = true;
            return .{ .result = {} };
        },
        .wrote => |written| {
            this.written += @truncate(written);
            this.writer.end();
            return .{ .result = {} };
        },
    }
}

fn deinit(this: *FileSink) void {
    this.pending.deinit();
    this.writer.deinit();
    if (this.event_loop_handle.globalObject()) |global| {
        webcore.AutoFlusher.unregisterDeferredMicrotaskWithType(@This(), this, global.bunVM());
    }
    bun.destroy(this);
}

pub fn toJS(this: *FileSink, globalThis: *JSGlobalObject) JSValue {
    return JSSink.createObject(globalThis, this, 0);
}

pub fn toJSWithDestructor(this: *FileSink, globalThis: *JSGlobalObject, destructor: ?Sink.DestructorPtr) JSValue {
    return JSSink.createObject(globalThis, this, if (destructor) |dest| @intFromPtr(dest.ptr()) else 0);
}

pub fn endFromJS(this: *FileSink, globalThis: *JSGlobalObject) JSC.Maybe(JSValue) {
    if (this.done) {
        if (this.pending.state == .pending) {
            return .{ .result = this.pending.future.promise.strong.value() };
        }

        return .{ .result = JSValue.jsNumber(this.written) };
    }

    switch (this.writer.flush()) {
        .done => |written| {
            this.updateRef(false);
            this.writer.end();
            return .{ .result = JSValue.jsNumber(written) };
        },
        .err => |err| {
            this.writer.close();
            return .{ .err = err };
        },
        .pending => |pending_written| {
            this.written += @truncate(pending_written);
            if (!this.must_be_kept_alive_until_eof) {
                this.must_be_kept_alive_until_eof = true;
                this.ref();
            }
            this.done = true;
            this.pending.result = .{ .owned = @truncate(pending_written) };
            return .{ .result = this.pending.promise(globalThis).toJS() };
        },
        .wrote => |written| {
            this.writer.end();
            return .{ .result = JSValue.jsNumber(written) };
        },
    }
}

pub fn sink(this: *FileSink) Sink {
    return Sink.init(this);
}

pub fn updateRef(this: *FileSink, value: bool) void {
    if (value) {
        this.writer.enableKeepingProcessAlive(this.event_loop_handle);
    } else {
        this.writer.disableKeepingProcessAlive(this.event_loop_handle);
    }
}

pub const JSSink = Sink.JSSink(@This(), "FileSink");

fn getFd(this: *const @This()) i32 {
    if (Environment.isWindows) {
        return switch (this.fd.decodeWindows()) {
            .windows => -1, // TODO:
            .uv => |num| num,
        };
    }
    return this.fd.cast();
}

fn toResult(this: *FileSink, write_result: bun.io.WriteResult) streams.Result.Writable {
    switch (write_result) {
        .done => |amt| {
            if (amt > 0)
                return .{ .owned_and_done = @truncate(amt) };

            return .{ .done = {} };
        },
        .wrote => |amt| {
            if (amt > 0)
                return .{ .owned = @truncate(amt) };

            return .{ .temporary = @truncate(amt) };
        },
        .err => |err| {
            return .{ .err = err };
        },
        .pending => |pending_written| {
            if (!this.must_be_kept_alive_until_eof) {
                this.must_be_kept_alive_until_eof = true;
                this.ref();
            }
            this.pending.consumed += @truncate(pending_written);
            this.pending.result = .{ .owned = @truncate(pending_written) };
            return .{ .pending = &this.pending };
        },
    }
}

pub const FlushPendingTask = struct {
    has: bool = false,

    pub fn runFromJSThread(flush_pending: *FlushPendingTask) void {
        const had = flush_pending.has;
        flush_pending.has = false;
        const this: *FileSink = @alignCast(@fieldParentPtr("run_pending_later", flush_pending));
        defer this.deref();
        if (had)
            this.runPending();
    }
};

const std = @import("std");
const bun = @import("bun");
const uv = bun.windows.libuv;
const Output = bun.Output;
const Environment = bun.Environment;
const JSC = bun.jsc;
const webcore = bun.webcore;
const Blob = webcore.Blob;
const Sink = webcore.Sink;
const streams = webcore.streams;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
