//! Native TTY handle for `process.binding('tty_wrap').TTY`.
//!
//! Node's `tty.ReadStream` extends `net.Socket` with `_handle` set to a native
//! `TTY` object exposing readStart/readStop/setRawMode/getWindowSize/ref/unref
//! plus the StreamBase onread callback. This is Bun's equivalent, backed by
//! `bun.io.BufferedReader` so the same backpressure mechanism Node uses
//! (push() === false → readStop(), _read → readStart()) drives fd 0 release.
//!
//! Lifecycle: JSRef starts weak, upgrades to strong on readStart and back to
//! weak on readStop so the JS wrapper survives GC while the poll is live. The
//! Zig struct is separately ref-counted: the JS wrapper holds one ref
//! (released in finalize), and the reader holds one ref while started — so
//! reader callbacks never fire on freed memory even if GC finalizes mid-read.

const TTY = @This();

const log = bun.Output.scoped(.TTY, .hidden);

pub const js = jsc.Codegen.JSTTY;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const IOReader = bun.io.BufferedReader;

ref_count: RefCount,

/// Original fd as passed from JS (e.g. 0). Used for setRawMode/getWindowSize
/// (which take a C int on both platforms) and as fallback when the nonblocking
/// reopen fails.
fd: bun.FD,
fd_int: i32,

/// On POSIX this is the reopened nonblocking fd from open_as_nonblocking_tty,
/// or `fd` itself when reopen fails. On Windows it's always `fd`.
owned_fd: bun.FD,

reader: IOReader,

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
    /// owned_fd != fd; we close owned_fd on close()
    owns_fd: bool = false,
    /// user called handle.unref(); readStart must not re-ref
    unreffed: bool = false,
    _: u3 = 0,
};

extern "c" fn open_as_nonblocking_tty(i32, i32) i32;
extern "c" fn Bun__ttySetMode(i32, i32) i32;
extern "c" fn Bun__getTTYWindowSize(i32, *usize, *usize) bool;

const UV_EOF: i32 = -4095;

inline fn toUVErrno(err: bun.sys.Error) i32 {
    if (comptime Environment.isWindows) {
        return @intCast(err.errno);
    }
    return -@as(i32, @intCast(err.errno));
}

pub fn constructor(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
    this_value: jsc.JSValue,
) bun.JSError!*TTY {
    const args = callframe.argumentsAsArray(2);
    const fd_value = args[0];

    if (!fd_value.isNumber()) {
        return globalObject.throw("fd must be a number", .{});
    }
    const fd_int = fd_value.toInt32();
    if (fd_int < 0) {
        return globalObject.throw("fd must be a non-negative integer", .{});
    }
    const fd: bun.FD = .fromUV(fd_int);

    // g5: do NOT throw on !isatty — Node accepts pipe/socket fds in
    // tty.ReadStream and reports failures via the ctx out-param. We only
    // populate ctx.code on a hard syscall error below.

    var owned_fd = fd;
    var nonblocking = false;
    var owns_fd = false;

    if (comptime Environment.isPosix) {
        // c1/c5: reopen with the original access mode (not hardcoded RDONLY) so
        // writes don't EBADF. Fall back to the original fd on -1 (FileReader
        // pattern).
        const O_ACCMODE: u32 = 0o3;
        const accmode: i32 = switch (fd.getFcntlFlags()) {
            .result => |fl| @intCast(fl & O_ACCMODE),
            .err => bun.O.RDWR,
        };
        const rc = open_as_nonblocking_tty(fd_int, accmode);
        if (rc > -1) {
            owned_fd = .fromNative(rc);
            nonblocking = true;
            owns_fd = true;
        }
        // c1: intentionally NOT dup2(newfd, 0) — children with stdio:'inherit'
        // get the original blocking fd, which is the desired UX. Documented
        // divergence from libuv.
    }

    const tty = bun.new(TTY, .{
        .ref_count = .init(),
        .fd = fd,
        .fd_int = fd_int,
        .owned_fd = owned_fd,
        .reader = IOReader.init(TTY),
        .event_loop_handle = jsc.EventLoopHandle.init(globalObject.bunVM().eventLoop()),
        .globalThis = globalObject,
        .flags = .{ .owns_fd = owns_fd },
    });

    tty.reader.setParent(tty);
    tty.reader.flags.nonblocking = nonblocking;
    tty.reader.flags.pollable = true;
    tty.reader.flags.close_handle = false;

    tty.this_value = jsc.JSRef.initWeak(this_value);

    // Node's ctx out-param: only populate code on hard failure. We have none
    // here (reopen failure just falls back), so leave ctx untouched.
    _ = args[1];

    return tty;
}

pub fn readStart(this: *TTY, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    log("readStart (started={}, hasPendingRead={}, isDone={}, paused={})", .{ this.flags.reader_started, if (this.flags.reader_started) this.reader.hasPendingRead() else false, if (this.flags.reader_started) this.reader.isDone() else false, if (this.flags.reader_started) this.reader.flags.is_paused else false });
    if (this.flags.closed) return JSValue.jsNumber(0);

    this.flags.reading = true;
    this.this_value.upgrade(this.globalThis);

    if (!this.flags.reader_started) {
        switch (this.reader.start(this.owned_fd, true)) {
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
                if (this.flags.unreffed) this.reader.updateRef(false);
            },
            .err => |err| return JSValue.jsNumber(toUVErrno(err)),
        }
    } else {
        // c2: unpause() only clears the flag. registerPoll (via watch()) re-arms
        // the kevent; updateRef re-activates the loop's keepalive that pause()'s
        // unregister→deactivate dropped (unless the user explicitly unref'd).
        this.reader.unpause();
        if (!this.reader.isDone() and !this.reader.hasPendingRead()) {
            this.reader.watch();
        }
        if (!this.flags.unreffed) this.reader.updateRef(true);
    }

    return JSValue.jsNumber(0);
}

pub fn readStop(this: *TTY, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    log("readStop", .{});
    this.flags.reading = false;
    if (this.flags.reader_started) {
        this.reader.pause();
    }
    this.this_value.downgrade();
    return JSValue.jsNumber(0);
}

pub fn doRef(this: *TTY, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.flags.unreffed = false;
    this.reader.updateRef(true);
    return .js_undefined;
}

pub fn doUnref(this: *TTY, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.flags.unreffed = true;
    this.reader.updateRef(false);
    return .js_undefined;
}

pub fn setRawMode(this: *TTY, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.argumentsAsArray(1);
    _ = globalObject;
    const flag: i32 = if (args[0].toBoolean()) 1 else 0;

    if (comptime Environment.isWindows) {
        if (this.fd_int == 0) {
            return JSValue.jsNumber(Source__setRawModeStdin(flag != 0));
        }
        // Non-stdin TTY on Windows: no per-handle raw-mode path yet.
        return JSValue.jsNumber(0);
    }

    return JSValue.jsNumber(Bun__ttySetMode(this.fd_int, flag));
}

pub fn getWindowSize(this: *TTY, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.argumentsAsArray(1);
    const arr_value = args[0];
    if (!arr_value.jsType().isArray()) {
        return globalObject.throw("getWindowSize expects an array", .{});
    }

    var width: usize = 0;
    var height: usize = 0;
    if (!Bun__getTTYWindowSize(this.fd_int, &width, &height)) {
        return JSValue.jsBoolean(false);
    }

    try arr_value.putIndex(globalObject, 0, JSValue.jsNumber(width));
    try arr_value.putIndex(globalObject, 1, JSValue.jsNumber(height));
    return JSValue.jsBoolean(true);
}

pub fn close(this: *TTY, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.closeInternal();
    return .js_undefined;
}

fn closeInternal(this: *TTY) void {
    if (this.flags.closed) return;
    this.flags.closed = true;
    this.flags.reading = false;

    if (this.flags.reader_started) {
        this.reader.close();
    }
    if (this.flags.owns_fd and this.owned_fd != bun.invalid_fd) {
        this.owned_fd.close();
        this.owned_fd = bun.invalid_fd;
    }
    this.safeDowngrade();
}

pub fn getOnRead(_: *TTY, thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) JSValue {
    return js.gc.get(.onread, thisValue) orelse .js_undefined;
}

pub fn setOnRead(_: *TTY, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: JSValue) void {
    js.gc.set(.onread, thisValue, globalObject, value);
}

pub fn getBytesRead(this: *TTY, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.bytes_read);
}

pub fn getBytesWritten(this: *TTY, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.bytes_written);
}

pub fn getFd(this: *TTY, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.fd_int);
}

pub fn getExternalStream(_: *TTY, _: *jsc.JSGlobalObject) JSValue {
    return .jsNull();
}

// Reader vtable callbacks ----------------------------------------------------

pub fn onReadChunk(this: *TTY, chunk: []const u8, has_more: bun.io.ReadState) bool {
    _ = has_more;
    log("onReadChunk: {} bytes", .{chunk.len});

    // c4: drop zero-length reads (Node's onStreamRead skips nread == 0).
    if (chunk.len == 0) return this.flags.reading;

    const this_jsvalue = this.this_value.tryGet() orelse return this.flags.reading;
    const callback = js.gc.get(.onread, this_jsvalue) orelse return this.flags.reading;

    const globalThis = this.globalThis;
    // g6: dupe — the reader buffer is reused across reads.
    const duped = bun.default_allocator.dupe(u8, chunk) catch return this.flags.reading;
    const buf = jsc.ArrayBuffer.createBuffer(globalThis, duped) catch return this.flags.reading;

    this.bytes_read += chunk.len;

    globalThis.bunVM().eventLoop().runCallback(
        callback,
        globalThis,
        this_jsvalue,
        &.{ JSValue.jsNumber(@as(i32, @intCast(chunk.len))), buf },
    );

    // g6: honor readStop set during JS re-entry — don't hardcode true.
    return this.flags.reading;
}

pub fn onReaderDone(this: *TTY) void {
    log("onReaderDone", .{});
    defer this.readerTerminated();
    this.flags.reading = false;
    this.reader.pause();
    this.reader.updateRef(false);
    this.callOnRead(JSValue.jsNumber(UV_EOF), .js_undefined);
    this.safeDowngrade();
}

pub fn onReaderError(this: *TTY, err: bun.sys.Error) void {
    log("onReaderError: {any}", .{err});
    defer this.readerTerminated();
    this.flags.reading = false;
    this.reader.pause();
    this.reader.updateRef(false);
    this.callOnRead(JSValue.jsNumber(toUVErrno(err)), .js_undefined);
    this.safeDowngrade();
}

/// Reader's terminal callback fired — release the ref it held.
fn readerTerminated(this: *TTY) void {
    if (this.flags.reader_started) {
        this.flags.reader_started = false;
        this.deref();
    }
}

/// downgrade() asserts on .finalized; reader callbacks may run after finalize
/// (struct stays alive via ref_count), so check first.
inline fn safeDowngrade(this: *TTY) void {
    if (this.this_value.isStrong()) this.this_value.downgrade();
}

fn callOnRead(this: *TTY, nread: JSValue, buf: JSValue) void {
    const this_jsvalue = this.this_value.tryGet() orelse return;
    const callback = js.gc.get(.onread, this_jsvalue) orelse return;
    this.globalThis.bunVM().eventLoop().runCallback(
        callback,
        this.globalThis,
        this_jsvalue,
        &.{ nread, buf },
    );
}

// EventLoop hooks for IOReader -----------------------------------------------

pub fn eventLoop(this: *TTY) jsc.EventLoopHandle {
    return this.event_loop_handle;
}

pub fn loop(this: *TTY) *bun.Async.Loop {
    if (comptime Environment.isWindows) {
        return this.event_loop_handle.loop().uv_loop;
    }
    return this.event_loop_handle.loop();
}

pub fn finalize(this: *TTY) callconv(.c) void {
    log("finalize", .{});
    jsc.markBinding(@src());
    this.closeInternal();
    this.this_value.finalize();
    this.deref();
}

fn deinit(this: *TTY) void {
    this.reader.deinit();
    bun.destroy(this);
}

extern "c" fn Source__setRawModeStdin(bool) i32;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
