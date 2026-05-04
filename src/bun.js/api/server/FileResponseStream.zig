//! Streams an already-open file descriptor to a uWS `AnyResponse`, handling
//! backpressure, client aborts, and fd lifetime. Shared by `FileRoute` (static
//! file routes) and `RequestContext` (file-blob bodies returned from `fetch`
//! handlers) so both get the same abort-safe lifecycle and so the SSL/Windows
//! path streams instead of buffering the whole file.
//!
//! The caller writes status + headers first, then hands off body streaming by
//! calling `start()`. Exactly one of `on_complete` / `on_error` fires, exactly
//! once; after it fires the caller must not touch `resp` body methods again.

const FileResponseStream = @This();

ref_count: RefCount,
resp: AnyResponse,
vm: *jsc.VirtualMachine,
fd: bun.FD,
auto_close: bool,
idle_timeout: u8,

ctx: *anyopaque,
on_complete: *const fn (*anyopaque, AnyResponse) void,
on_abort: ?*const fn (*anyopaque, AnyResponse) void,
on_error: *const fn (*anyopaque, AnyResponse, bun.sys.Error) void,

mode: Mode,
reader: bun.io.BufferedReader = bun.io.BufferedReader.init(FileResponseStream),
max_size: ?u64 = null,
eof_task: ?jsc.AnyTask = null,
sendfile: Sendfile = .{},

state: packed struct(u8) {
    response_done: bool = false,
    finished: bool = false,
    errored: bool = false,
    resp_detached: bool = false,
    _: u4 = 0,
} = .{},

const Mode = enum { reader, sendfile };

const Sendfile = struct {
    socket_fd: bun.FD = bun.invalid_fd,
    remain: u64 = 0,
    offset: u64 = 0,
    has_set_on_writable: bool = false,
};

pub const StartOptions = struct {
    fd: bun.FD,
    auto_close: bool = true,
    resp: AnyResponse,
    vm: *jsc.VirtualMachine,
    file_type: bun.io.FileType,
    pollable: bool,
    /// Byte offset into the file to begin reading from.
    offset: u64 = 0,
    /// Maximum bytes to send; `null` reads to EOF. For regular files this
    /// should be `stat.size - offset` (after Range/slice clamping).
    length: ?u64 = null,
    idle_timeout: u8,
    ctx: *anyopaque,
    on_complete: *const fn (*anyopaque, AnyResponse) void,
    /// Fires instead of `on_complete` when the client disconnects mid-stream.
    /// If null, abort is reported via `on_complete`.
    on_abort: ?*const fn (*anyopaque, AnyResponse) void = null,
    on_error: *const fn (*anyopaque, AnyResponse, bun.sys.Error) void,
};

pub fn start(opts: StartOptions) void {
    const use_sendfile = canSendfile(opts.resp, opts.file_type, opts.length);

    var this = bun.new(FileResponseStream, .{
        .ref_count = .init(),
        .resp = opts.resp,
        .vm = opts.vm,
        .fd = opts.fd,
        .auto_close = opts.auto_close,
        .idle_timeout = opts.idle_timeout,
        .ctx = opts.ctx,
        .on_complete = opts.on_complete,
        .on_abort = opts.on_abort,
        .on_error = opts.on_error,
        .mode = if (use_sendfile) .sendfile else .reader,
    });

    this.resp.timeout(this.idle_timeout);
    this.resp.onAborted(*FileResponseStream, onAborted, this);

    log("start mode={s} len={?d}", .{ @tagName(this.mode), opts.length });

    if (use_sendfile) {
        this.sendfile = .{
            .socket_fd = opts.resp.getNativeHandle(),
            .offset = opts.offset,
            .remain = opts.length.?,
        };
        this.resp.prepareForSendfile();
        _ = this.onSendfile();
        return;
    }

    // BufferedReader path
    this.max_size = opts.length;
    this.reader.flags.close_handle = false; // we own fd via auto_close
    this.reader.flags.pollable = opts.pollable;
    this.reader.flags.nonblocking = opts.file_type != .file;
    if (comptime bun.Environment.isPosix) {
        if (opts.file_type == .socket) this.reader.flags.socket = true;
    }
    this.reader.setParent(this);

    this.ref();
    defer this.deref();

    switch (if (opts.offset > 0)
        this.reader.startFileOffset(this.fd, opts.pollable, opts.offset)
    else
        this.reader.start(this.fd, opts.pollable)) {
        .err => |err| {
            this.failWith(err);
            return;
        },
        .result => {},
    }

    this.reader.updateRef(true);

    if (comptime bun.Environment.isPosix) {
        if (this.reader.handle.getPoll()) |poll| {
            if (this.reader.flags.nonblocking) poll.flags.insert(.nonblocking);
            switch (opts.file_type) {
                .socket => poll.flags.insert(.socket),
                .nonblocking_pipe, .pipe => poll.flags.insert(.fifo),
                .file => {},
            }
        }
    }

    // hold a ref for the in-flight read; released in onReaderDone/onReaderError
    this.ref();
    this.reader.read();
}

fn canSendfile(resp: AnyResponse, file_type: bun.io.FileType, length: ?u64) bool {
    if (comptime bun.Environment.isWindows) return false;
    // sendfile() needs a real socket fd; SSL writes go through BIO and H3
    // through lsquic stream frames — neither has one.
    if (resp != .TCP) return false;
    if (file_type != .file) return false;
    const len = length orelse return false;
    // Below ~1MB the syscall + dual-readiness overhead doesn't pay off.
    return len >= 1 << 20;
}

// ───────────────────────── reader backend ─────────────────────────

pub fn onReadChunk(this: *FileResponseStream, chunk_: []const u8, state_: bun.io.ReadState) bool {
    this.ref();
    defer this.deref();

    if (this.state.response_done) return false;

    const chunk, const state = brk: {
        if (this.max_size) |*max| {
            const c = chunk_[0..@min(chunk_.len, max.*)];
            max.* -|= c.len;
            if (state_ != .eof and max.* == 0) {
                if (comptime !bun.Environment.isPosix) this.reader.pause();
                this.eof_task = jsc.AnyTask.New(FileResponseStream, FileResponseStream.onReaderDone).init(this);
                this.vm.eventLoop().enqueueTask(jsc.Task.init(&this.eof_task.?));
                break :brk .{ c, .eof };
            }
            break :brk .{ c, state_ };
        }
        break :brk .{ chunk_, state_ };
    };

    this.resp.timeout(this.idle_timeout);

    if (state == .eof) {
        this.state.response_done = true;
        this.detachResp();
        this.resp.end(chunk, this.resp.shouldCloseConnection());
        this.on_complete(this.ctx, this.resp);
        return false;
    }

    switch (this.resp.write(chunk)) {
        .backpressure => {
            // release the read ref; onWritable re-takes it
            defer this.deref();
            this.resp.onWritable(*FileResponseStream, onWritable, this);
            if (comptime !bun.Environment.isPosix) this.reader.pause();
            return false;
        },
        .want_more => return true,
    }
}

pub fn onReaderDone(this: *FileResponseStream) void {
    defer this.deref();
    this.finish();
}

pub fn onReaderError(this: *FileResponseStream, err: bun.sys.Error) void {
    defer this.deref();
    this.failWith(err);
}

fn onWritable(this: *FileResponseStream, _: u64, _: AnyResponse) bool {
    log("onWritable", .{});
    this.ref();
    defer this.deref();

    if (this.mode == .sendfile) return this.onSendfile();

    if (this.reader.isDone()) {
        this.finish();
        return true;
    }
    this.resp.timeout(this.idle_timeout);
    this.ref();
    this.reader.read();
    return true;
}

// ───────────────────────── sendfile backend ─────────────────────────

fn onSendfile(this: *FileResponseStream) bool {
    log("onSendfile remain={d} offset={d}", .{ this.sendfile.remain, this.sendfile.offset });
    if (this.state.response_done) {
        this.finish();
        return false;
    }

    if (comptime bun.Environment.isLinux) {
        while (true) {
            const adjusted = @min(this.sendfile.remain, @as(u64, std.math.maxInt(i32)));
            var off: i64 = @intCast(this.sendfile.offset);
            const rc = std.os.linux.sendfile(
                this.sendfile.socket_fd.cast(),
                this.fd.cast(),
                &off,
                adjusted,
            );
            const errno = bun.sys.getErrno(rc);
            const sent: u64 = @intCast(@max(@as(i64, @intCast(off)) - @as(i64, @intCast(this.sendfile.offset)), 0));
            this.sendfile.offset = @intCast(off);
            this.sendfile.remain -|= sent;

            switch (errno) {
                .SUCCESS => {
                    if (this.sendfile.remain == 0 or sent == 0) {
                        this.endSendfile();
                        return false;
                    }
                    return this.armSendfileWritable();
                },
                .INTR => continue,
                .AGAIN => return this.armSendfileWritable(),
                else => {
                    this.failWith(.{ .errno = @intFromEnum(errno), .syscall = .sendfile, .fd = this.fd });
                    return false;
                },
            }
        }
    } else if (comptime bun.Environment.isMac) {
        while (true) {
            var sbytes: std.posix.off_t = @intCast(@min(this.sendfile.remain, @as(u64, std.math.maxInt(i32))));
            const errno = bun.sys.getErrno(std.c.sendfile(
                this.fd.cast(),
                this.sendfile.socket_fd.cast(),
                @intCast(this.sendfile.offset),
                &sbytes,
                null,
                0,
            ));
            const sent: u64 = @intCast(sbytes);
            this.sendfile.offset += sent;
            this.sendfile.remain -|= sent;

            switch (errno) {
                .SUCCESS => {
                    if (this.sendfile.remain == 0 or sent == 0) {
                        this.endSendfile();
                        return false;
                    }
                    return this.armSendfileWritable();
                },
                .INTR => continue,
                .AGAIN => return this.armSendfileWritable(),
                .PIPE, .NOTCONN => {
                    this.endSendfile();
                    return false;
                },
                else => {
                    this.failWith(.{ .errno = @intFromEnum(errno), .syscall = .sendfile, .fd = this.fd });
                    return false;
                },
            }
        }
    } else {
        unreachable; // canSendfile gates this
    }
}

fn armSendfileWritable(this: *FileResponseStream) bool {
    log("armSendfileWritable", .{});
    if (!this.sendfile.has_set_on_writable) {
        this.sendfile.has_set_on_writable = true;
        this.resp.onWritable(*FileResponseStream, onWritable, this);
    }
    this.resp.markNeedsMore();
    return true;
}

fn endSendfile(this: *FileResponseStream) void {
    log("endSendfile", .{});
    if (this.state.response_done) return;
    this.state.response_done = true;
    this.detachResp();
    this.resp.endSendFile(this.sendfile.offset, this.resp.shouldCloseConnection());
    this.on_complete(this.ctx, this.resp);
    this.finish();
}

// ───────────────────────── lifecycle ─────────────────────────

fn onAborted(this: *FileResponseStream, _: AnyResponse) void {
    log("onAborted", .{});
    if (!this.state.response_done) {
        this.state.response_done = true;
        this.detachResp();
        (this.on_abort orelse this.on_complete)(this.ctx, this.resp);
    }
    this.finish();
}

fn failWith(this: *FileResponseStream, err: bun.sys.Error) void {
    if (!this.state.response_done) {
        this.state.response_done = true;
        this.state.errored = true;
        this.detachResp();
        this.resp.forceClose();
        this.on_error(this.ctx, this.resp, err);
    }
    this.finish();
}

/// Clear all uWS callbacks pointing at us. Must run while `resp` is still
/// live (i.e., before `resp.end()` / `endSendFile()` / `forceClose()` give the
/// socket back to uWS, which may free it on the next loop tick). After this
/// runs, `finish()` — which can be reached from the deferred `eof_task` —
/// will not touch `resp` again.
fn detachResp(this: *FileResponseStream) void {
    if (this.state.resp_detached) return;
    this.state.resp_detached = true;
    this.resp.clearOnWritable();
    this.resp.clearAborted();
    this.resp.clearTimeout();
}

fn finish(this: *FileResponseStream) void {
    log("finish (already={})", .{this.state.finished});
    if (this.state.finished) return;
    this.state.finished = true;

    if (!this.state.response_done) {
        this.state.response_done = true;
        this.detachResp();
        this.resp.endWithoutBody(this.resp.shouldCloseConnection());
        this.on_complete(this.ctx, this.resp);
    }

    this.deref();
}

fn deinit(this: *FileResponseStream) void {
    log("deinit", .{});
    if (this.mode == .reader) this.reader.deinit();
    if (this.auto_close) {
        bun.Async.Closer.close(this.fd, if (comptime bun.Environment.isWindows) bun.windows.libuv.Loop.get());
    }
    bun.destroy(this);
}

pub fn eventLoop(this: *FileResponseStream) jsc.EventLoopHandle {
    return jsc.EventLoopHandle.init(this.vm.eventLoop());
}

pub fn loop(this: *FileResponseStream) *Async.Loop {
    if (comptime bun.Environment.isWindows) {
        return this.eventLoop().loop().uv_loop;
    }
    return this.eventLoop().loop();
}

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

const log = bun.Output.scoped(.FileResponseStream, .hidden);

const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;
const jsc = bun.jsc;

const uws = bun.uws;
const AnyResponse = uws.AnyResponse;
