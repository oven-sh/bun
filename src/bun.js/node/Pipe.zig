//! Native Pipe handle for `process.binding('pipe_wrap').Pipe`.
//!
//! Node's `net.Socket({fd})` calls `createHandle(fd)` which constructs
//! `new Pipe(SOCKET)` then `.open(fd)`. The handle exposes the StreamBase
//! readStart/readStop/onread surface that `net.Socket` uses for backpressure-
//! driven fd release (push() === false → readStop(), _read → readStart()).
//!
//! Two-step construction: ctor stores only the pipe type; `open(fd)` attaches
//! the fd. This mirrors libuv's `uv_pipe_init` + `uv_pipe_open`.
//!
//! Lifecycle: JSRef starts weak, upgrades to strong on readStart and back to
//! weak on readStop so the JS wrapper survives GC while the poll is live. The
//! Zig struct is separately ref-counted: the JS wrapper holds one ref
//! (released in finalize), and the reader holds one while started — so reader
//! callbacks never fire on freed memory even if GC finalizes mid-read.

const Pipe = @This();

const log = bun.Output.scoped(.PipeHandle, .hidden);

pub const js = jsc.Codegen.JSPipe;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const IOReader = bun.io.BufferedReader;

pub const IOWriter = bun.io.StreamingWriter(@This(), struct {
    pub const onWrite = Pipe.onWriterWrite;
    pub const onError = Pipe.onWriterError;
    pub const onWritable = Pipe.onWriterReady;
    pub const onClose = Pipe.onWriterClose;
});
/// Poll type alias for FilePoll Owner registration.
pub const Poll = IOWriter;

ref_count: RefCount,

/// 0=SOCKET, 1=SERVER, 2=IPC
pipe_type: u8,

/// `bun.invalid_fd` until open() is called.
fd: bun.FD = bun.invalid_fd,
fd_int: i32 = -1,

reader: IOReader,
writer: IOWriter = .{},

this_value: jsc.JSRef = jsc.JSRef.empty(),
event_loop_handle: jsc.EventLoopHandle,
globalThis: *jsc.JSGlobalObject,

bytes_read: u64 = 0,
bytes_written: u64 = 0,

flags: Flags = .{},

pub const Flags = packed struct(u8) {
    reading: bool = false,
    closed: bool = false,
    /// reader.start() succeeded (and the reader holds a ref on this struct)
    reader_started: bool = false,
    /// writer.start() succeeded (and the writer holds a ref on this struct)
    writer_started: bool = false,
    /// user called handle.unref(); readStart must not re-ref
    unreffed: bool = false,
    _: u3 = 0,
};

const UV_EOF: i32 = -4095;

inline fn toUVErrno(err: bun.sys.Error) i32 {
    if (comptime Environment.isWindows) {
        // bun.sys.Error.errno on Windows is already a translated UV_E* value.
        return @intCast(err.errno);
    }
    return -@as(i32, @intCast(err.errno));
}

pub fn constructor(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    this_value: jsc.JSValue,
) bun.JSError!*Pipe {
    const args = callframe.argumentsAsArray(1);
    const type_int: u8 = if (args[0].isNumber()) @intCast(@max(0, @min(2, args[0].toInt32()))) else 0;

    const pipe = bun.new(Pipe, .{
        .ref_count = .init(),
        .pipe_type = type_int,
        .reader = IOReader.init(Pipe),
        .event_loop_handle = jsc.EventLoopHandle.init(globalObject.bunVM().eventLoop()),
        .globalThis = globalObject,
    });

    pipe.reader.setParent(pipe);
    pipe.this_value = jsc.JSRef.initWeak(this_value);

    return pipe;
}

pub fn open(this: *Pipe, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.argumentsAsArray(1);
    if (!args[0].isNumber()) return JSValue.jsNumber(-@as(i32, @intCast(bun.sys.UV_E.INVAL)));
    const fd_int = args[0].toInt32();
    if (fd_int < 0) return JSValue.jsNumber(-@as(i32, @intCast(bun.sys.UV_E.BADF)));

    const fd: bun.FD = .fromUV(fd_int);

    if (comptime Environment.isPosix) {
        // Set O_NONBLOCK like uv_pipe_open. Failure → return -errno.
        const flags = switch (bun.sys.fcntl(fd, std.posix.F.GETFL, 0)) {
            .result => |f| f,
            .err => |err| return JSValue.jsNumber(toUVErrno(err)),
        };
        switch (bun.sys.fcntl(fd, std.posix.F.SETFL, flags | bun.O.NONBLOCK)) {
            .result => {},
            .err => |err| return JSValue.jsNumber(toUVErrno(err)),
        }
        this.reader.flags.nonblocking = true;
        this.reader.flags.pollable = true;
    }
    // Windows: store fd; Source.openPipe deferred to first readStart().

    this.reader.flags.close_handle = false;
    this.fd = fd;
    this.fd_int = fd_int;
    return JSValue.jsNumber(0);
}

pub fn readStart(this: *Pipe, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    log("readStart", .{});
    if (this.flags.closed) return JSValue.jsNumber(0);
    if (this.fd == bun.invalid_fd) return JSValue.jsNumber(-@as(i32, @intCast(bun.sys.UV_E.BADF)));

    this.flags.reading = true;
    this.this_value.upgrade(this.globalThis);

    if (!this.flags.reader_started) {
        switch (this.reader.start(this.fd, true)) {
            .result => {
                this.flags.reader_started = true;
                // Reader now holds a ref on this struct until its terminal
                // callback (onReaderDone/onReaderError) fires.
                this.ref();
                if (comptime Environment.isPosix) {
                    if (this.reader.handle == .poll) {
                        this.reader.handle.poll.flags.insert(.nonblocking);
                    }
                }
                // reader.start() calls updateRef(true) internally; honor a
                // prior unref().
                if (this.flags.unreffed) this.reader.updateRef(false);
            },
            .err => |err| return JSValue.jsNumber(toUVErrno(err)),
        }
    } else {
        // unpause() only clears the flag; watch() re-arms the poll. updateRef
        // re-activates the loop's keepalive that pause()'s unregister dropped
        // (unless the user explicitly unref'd).
        this.reader.unpause();
        if (!this.reader.isDone() and !this.reader.hasPendingRead()) {
            this.reader.watch();
        }
        if (!this.flags.unreffed) this.reader.updateRef(true);
    }

    return JSValue.jsNumber(0);
}

pub fn readStop(this: *Pipe, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    log("readStop", .{});
    this.flags.reading = false;
    if (this.flags.reader_started) {
        this.reader.pause();
    }
    this.this_value.downgrade();
    return JSValue.jsNumber(0);
}

pub fn doRef(this: *Pipe, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.flags.unreffed = false;
    this.reader.updateRef(true);
    return .js_undefined;
}

pub fn doUnref(this: *Pipe, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.flags.unreffed = true;
    this.reader.updateRef(false);
    return .js_undefined;
}

pub fn close(this: *Pipe, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    _ = callframe;
    this.closeInternal();
    return .js_undefined;
}

fn closeInternal(this: *Pipe) void {
    if (this.flags.closed) return;
    this.flags.closed = true;
    this.flags.reading = false;

    if (this.flags.reader_started) {
        this.reader.close();
    }
    if (this.flags.writer_started) {
        this.writer.end();
    }
    // We never own the fd (caller-provided via open()).
    this.safeDowngrade();
}

// Write side -----------------------------------------------------------------

fn ensureWriterStarted(this: *Pipe) i32 {
    if (this.flags.writer_started) return 0;
    if (this.fd == bun.invalid_fd) return -@as(i32, @intCast(bun.sys.UV_E.BADF));

    this.writer.setParent(this);
    // The Pipe doesn't own this.fd (caller-provided via open()).
    if (comptime Environment.isPosix) {
        this.writer.close_fd = false;
        // Node's writeBuffer is one uv_write per call; the Socket's
        // _writableState handles buffering. PosixStreamingWriter's userland
        // chunk buffer would otherwise drop bytes on end().
        this.writer.force_sync = true;
    } else {
        this.writer.owns_fd = false;
    }
    switch (this.writer.start(this.fd, true)) {
        .result => {
            this.flags.writer_started = true;
            this.ref();
            if (this.flags.unreffed) this.writer.updateRef(this.event_loop_handle, false);
            return 0;
        },
        .err => |err| return toUVErrno(err),
    }
}

fn writeBytes(this: *Pipe, this_jsvalue: JSValue, req: JSValue, bytes: []const u8) i32 {
    const start_err = this.ensureWriterStarted();
    if (start_err != 0) return start_err;

    return switch (this.writer.write(bytes)) {
        .err => |err| toUVErrno(err),
        .pending => |_| blk: {
            // Only stash the req for the async path; for .wrote/.done JS handles
            // the callback synchronously via !req.async.
            js.gc.set(.writeReq, this_jsvalue, this.globalThis, req);
            req.put(this.globalThis, jsc.ZigString.static("async"), JSValue.jsBoolean(true));
            break :blk 0;
        },
        .wrote, .done => 0,
    };
}

pub fn writeBuffer(this: *Pipe, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.argumentsAsArray(2);
    const req = args[0];
    const buf = args[1].asArrayBuffer(globalObject) orelse {
        return JSValue.jsNumber(-@as(i32, @intCast(bun.sys.UV_E.INVAL)));
    };
    return JSValue.jsNumber(this.writeBytes(callframe.this(), req, buf.slice()));
}

pub fn writeUtf8String(this: *Pipe, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.argumentsAsArray(2);
    const req = args[0];
    const str = try args[1].toBunString(globalObject);
    defer str.deref();
    const utf8 = str.toUTF8(bun.default_allocator);
    defer utf8.deinit();
    return JSValue.jsNumber(this.writeBytes(callframe.this(), req, utf8.slice()));
}

pub fn shutdown(this: *Pipe, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.argumentsAsArray(1);
    const req = args[0];
    if (!this.flags.writer_started) {
        // Nothing to flush — complete the req synchronously.
        if (req.isObject()) {
            req.put(this.globalThis, jsc.ZigString.static("async"), JSValue.jsBoolean(false));
        }
        return JSValue.jsNumber(0);
    }
    js.gc.set(.shutdownReq, callframe.this(), this.globalThis, req);
    if (req.isObject()) {
        req.put(this.globalThis, jsc.ZigString.static("async"), JSValue.jsBoolean(true));
    }
    this.writer.end();
    return JSValue.jsNumber(0);
}

/// bind/listen/connect/fchmod are Unix-socket server/client; Bun routes those
/// via usockets, not pipe_wrap.
pub fn notsup(_: *Pipe, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    return JSValue.jsNumber(-@as(i32, @intCast(bun.sys.UV_E.NOTSUP)));
}

fn fireReqComplete(this: *Pipe, comptime slot: @TypeOf(.enum_literal), status: i32) void {
    const this_jsvalue = this.this_value.tryGet() orelse return;
    const req = js.gc.get(slot, this_jsvalue) orelse return;
    js.gc.set(slot, this_jsvalue, this.globalThis, .js_undefined);
    if (!req.isObject()) return;
    const oncomplete = req.get(this.globalThis, "oncomplete") catch return orelse return;
    if (!oncomplete.isCallable()) return;
    this.globalThis.bunVM().eventLoop().runCallback(
        oncomplete,
        this.globalThis,
        req,
        &.{JSValue.jsNumber(status)},
    );
}

pub fn onWriterWrite(this: *Pipe, amount: usize, status: bun.io.WriteStatus) void {
    log("onWriterWrite: {} status={}", .{ amount, status });
    this.bytes_written += amount;
    if (status == .drained or status == .end_of_file) {
        this.fireReqComplete(.writeReq, 0);
    }
}

pub fn onWriterError(this: *Pipe, err: bun.sys.Error) void {
    log("onWriterError: {any}", .{err});
    this.fireReqComplete(.writeReq, toUVErrno(err));
    this.fireReqComplete(.shutdownReq, toUVErrno(err));
}

pub fn onWriterReady(_: *Pipe) void {}

pub fn onWriterClose(this: *Pipe) void {
    log("onWriterClose", .{});
    this.fireReqComplete(.shutdownReq, 0);
    if (this.flags.writer_started) {
        this.flags.writer_started = false;
        this.deref();
    }
}

pub fn getOnRead(_: *Pipe, thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) JSValue {
    return js.gc.get(.onread, thisValue) orelse .js_undefined;
}

pub fn setOnRead(_: *Pipe, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: JSValue) void {
    js.gc.set(.onread, thisValue, globalObject, value);
}

pub fn getBytesRead(this: *Pipe, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.bytes_read);
}

pub fn getBytesWritten(this: *Pipe, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.bytes_written);
}

pub fn getFd(this: *Pipe, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.fd_int);
}

pub fn getExternalStream(_: *Pipe, _: *jsc.JSGlobalObject) JSValue {
    return .jsNull();
}

// Reader vtable callbacks ----------------------------------------------------

pub fn onReadChunk(this: *Pipe, chunk: []const u8, has_more: bun.io.ReadState) bool {
    _ = has_more;
    log("onReadChunk: {} bytes", .{chunk.len});
    if (chunk.len == 0) return this.flags.reading;

    const this_jsvalue = this.this_value.tryGet() orelse return this.flags.reading;
    const callback = js.gc.get(.onread, this_jsvalue) orelse return this.flags.reading;

    const globalThis = this.globalThis;
    // The reader buffer is reused across reads.
    const duped = bun.default_allocator.dupe(u8, chunk) catch return this.flags.reading;
    const buf = jsc.ArrayBuffer.createBuffer(globalThis, duped) catch return this.flags.reading;

    this.bytes_read += chunk.len;

    globalThis.bunVM().eventLoop().runCallback(
        callback,
        globalThis,
        this_jsvalue,
        &.{ JSValue.jsNumber(@as(i32, @intCast(chunk.len))), buf },
    );

    return this.flags.reading;
}

pub fn onReaderDone(this: *Pipe) void {
    log("onReaderDone", .{});
    defer this.readerTerminated();
    this.flags.reading = false;
    // close_handle=false means BufferedReader.finish() leaves the poll
    // registered and ref'd; drop both so the process can exit after EOF.
    this.reader.pause();
    this.reader.updateRef(false);
    this.callOnRead(JSValue.jsNumber(UV_EOF), .js_undefined);
    this.safeDowngrade();
}

pub fn onReaderError(this: *Pipe, err: bun.sys.Error) void {
    log("onReaderError: {any}", .{err});
    defer this.readerTerminated();
    this.flags.reading = false;
    this.reader.pause();
    this.reader.updateRef(false);
    this.callOnRead(JSValue.jsNumber(toUVErrno(err)), .js_undefined);
    this.safeDowngrade();
}

/// Reader's terminal callback fired — release the ref it held.
fn readerTerminated(this: *Pipe) void {
    if (this.flags.reader_started) {
        this.flags.reader_started = false;
        this.deref();
    }
}

/// downgrade() asserts on .finalized; reader callbacks may run after finalize
/// (struct stays alive via ref_count), so check first.
inline fn safeDowngrade(this: *Pipe) void {
    if (this.this_value.isStrong()) this.this_value.downgrade();
}

fn callOnRead(this: *Pipe, nread: JSValue, buf: JSValue) void {
    const this_jsvalue = this.this_value.tryGet() orelse return;
    const callback = js.gc.get(.onread, this_jsvalue) orelse return;
    this.globalThis.bunVM().eventLoop().runCallback(
        callback,
        this.globalThis,
        this_jsvalue,
        &.{ nread, buf },
    );
}

// EventLoop hooks for IOReader ----------------------------------------------

pub fn eventLoop(this: *Pipe) jsc.EventLoopHandle {
    return this.event_loop_handle;
}

pub fn loop(this: *Pipe) *bun.Async.Loop {
    if (comptime Environment.isWindows) {
        return this.event_loop_handle.loop().uv_loop;
    }
    return this.event_loop_handle.loop();
}

pub fn finalize(this: *Pipe) callconv(.c) void {
    log("finalize", .{});
    jsc.markBinding(@src());
    this.closeInternal();
    this.this_value.finalize();
    this.deref();
}

fn deinit(this: *Pipe) void {
    this.reader.deinit();
    this.writer.deinit();
    bun.destroy(this);
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
