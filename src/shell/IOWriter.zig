//! Abstraction to allow multiple writers that can write to a file descriptor.
//!
//! This exists because kqueue/epoll does not work when registering multiple
//! poll events on the same file descriptor.
//!
//! One way to get around this limitation is to just call `.dup()` on the file
//! descriptor, which we do for the top-level stdin/stdout/stderr. But calling
//! `.dup()` for every concurrent writer is expensive.
//!
//! So `IOWriter` is essentially a writer queue to a file descriptor.
//!
//! We also make `*IOWriter` reference counted, this simplifies management of
//! the file descriptor.
const IOWriter = @This();

pub const RefCount = bun.ptr.RefCount(@This(), "ref_count", asyncDeinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,
writer: WriterImpl = if (bun.Environment.isWindows) .{} else .{ .close_fd = false },
fd: bun.FileDescriptor,
writers: Writers = .{ .inlined = .{} },
buf: std.ArrayListUnmanaged(u8) = .{},
/// quick hack to get windows working
/// ideally this should be removed
winbuf: if (bun.Environment.isWindows) std.ArrayListUnmanaged(u8) else u0 = if (bun.Environment.isWindows) .empty else 0,
writer_idx: usize = 0,
total_bytes_written: usize = 0,
err: ?JSC.SystemError = null,
evtloop: JSC.EventLoopHandle,
concurrent_task: JSC.EventLoopTask,
concurrent_task2: JSC.EventLoopTask,
is_writing: bool = false,
async_deinit: AsyncDeinitWriter = .{},
started: bool = false,
flags: Flags = .{},

const debug = bun.Output.scoped(.IOWriter, true);

pub const ChildPtr = IOWriterChildPtr;

/// ~128kb
/// We shrunk the `buf` when we reach the last writer,
/// but if this never happens, we shrink `buf` when it exceeds this threshold
const SHRINK_THRESHOLD = 1024 * 128;

const CallstackChild = struct {
    child: ChildPtr,
    completed: bool = false,
};

pub const auto_poll = false;

pub const WriterImpl = bun.io.BufferedWriter(IOWriter, struct {
    pub const onWrite = IOWriter.onWritePollable;
    pub const onError = IOWriter.onError;
    pub const onClose = IOWriter.onClose;
    pub const getBuffer = IOWriter.getBuffer;
    pub const onWritable = null;
});
pub const Poll = WriterImpl;

// pub fn __onClose(_: *IOWriter) void {}
// pub fn __flush(_: *IOWriter) void {}

pub fn refSelf(this: *IOWriter) *IOWriter {
    this.ref();
    return this;
}

pub const Flags = packed struct(u8) {
    pollable: bool = false,
    nonblocking: bool = false,
    is_socket: bool = false,
    broken_pipe: bool = false,
    __unused: u4 = 0,
};

pub fn init(fd: bun.FileDescriptor, flags: Flags, evtloop: JSC.EventLoopHandle) *IOWriter {
    const this = bun.new(IOWriter, .{
        .ref_count = .init(),
        .fd = fd,
        .evtloop = evtloop,
        .concurrent_task = JSC.EventLoopTask.fromEventLoop(evtloop),
        .concurrent_task2 = JSC.EventLoopTask.fromEventLoop(evtloop),
    });

    this.writer.parent = this;
    this.flags = flags;

    debug("IOWriter(0x{x}, fd={}) init flags={any}", .{ @intFromPtr(this), fd, flags });

    return this;
}

pub fn __start(this: *IOWriter) Maybe(void) {
    debug("IOWriter(0x{x}, fd={}) __start()", .{ @intFromPtr(this), this.fd });
    if (this.writer.start(this.fd, this.flags.pollable).asErr()) |e_| {
        const e: bun.sys.Error = e_;
        if (bun.Environment.isPosix) {
            // We get this if we pass in a file descriptor that is not
            // pollable, for example a special character device like
            // /dev/null. If so, restart with polling disabled.
            //
            // It's also possible on Linux for EINVAL to be returned
            // when registering multiple writable/readable polls for the
            // same file descriptor. The shell code here makes sure to
            // _not_ run into that case, but it is possible.
            if (e.getErrno() == .INVAL) {
                debug("IOWriter(0x{x}, fd={}) got EINVAL", .{ @intFromPtr(this), this.fd });
                this.flags.pollable = false;
                this.flags.nonblocking = false;
                this.flags.is_socket = false;
                this.writer.handle = .{ .closed = {} };
                return __start(this);
            }

            if (bun.Environment.isLinux) {
                // On linux regular files are not pollable and return EPERM,
                // so restart if that's the case with polling disabled.
                if (e.getErrno() == .PERM) {
                    this.flags.pollable = false;
                    this.flags.nonblocking = false;
                    this.flags.is_socket = false;
                    this.writer.handle = .{ .closed = {} };
                    return __start(this);
                }
            }
        }

        if (bun.Environment.isWindows) {
            // This might happen if the file descriptor points to NUL.
            // On Windows GetFileType(NUL) returns FILE_TYPE_CHAR, so
            // `this.writer.start()` will try to open it as a tty with
            // uv_tty_init, but this returns EBADF. As a workaround,
            // we'll try opening the file descriptor as a file.
            if (e.getErrno() == .BADF) {
                this.flags.pollable = false;
                this.flags.nonblocking = false;
                this.flags.is_socket = false;
                return this.writer.startWithFile(this.fd);
            }
        }
        return .{ .err = e };
    }
    if (comptime bun.Environment.isPosix) {
        if (this.flags.nonblocking) {
            this.writer.getPoll().?.flags.insert(.nonblocking);
        }

        if (this.flags.is_socket) {
            this.writer.getPoll().?.flags.insert(.socket);
        } else if (this.flags.pollable) {
            this.writer.getPoll().?.flags.insert(.fifo);
        }
    }

    return Maybe(void).success;
}

pub fn eventLoop(this: *IOWriter) JSC.EventLoopHandle {
    return this.evtloop;
}

/// Idempotent write call
fn write(this: *IOWriter) enum {
    suspended,
    failed,
    is_actually_file,
} {
    if (bun.Environment.isPosix)
        bun.assert(this.flags.pollable);

    if (!this.started) {
        log("IOWriter(0x{x}, fd={}) starting", .{ @intFromPtr(this), this.fd });
        if (this.__start().asErr()) |e| {
            this.onError(e);
            return .failed;
        }
        this.started = true;
        if (comptime bun.Environment.isPosix) {
            // if `handle == .fd` it means it's a file which does not
            // support polling for writeability and we should just
            // write to it
            if (this.writer.handle == .fd) {
                bun.assert(!this.flags.pollable);
                return .is_actually_file;
            }
            return .suspended;
        }
        return .suspended;
    }

    if (bun.Environment.isWindows) {
        log("IOWriter(0x{x}, fd={}) write() is_writing={any}", .{ @intFromPtr(this), this.fd, this.is_writing });
        if (this.is_writing) return .suspended;
        this.is_writing = true;
        if (this.writer.startWithCurrentPipe().asErr()) |e| {
            this.onError(e);
            return .failed;
        }
        return .suspended;
    }

    bun.assert(this.writer.handle == .poll);
    if (this.writer.handle.poll.isWatching()) return .suspended;
    this.writer.start(this.fd, this.flags.pollable).assert();
    return .suspended;
}

/// Cancel the chunks enqueued by the given writer by
/// marking them as dead
pub fn cancelChunks(this: *IOWriter, ptr_: anytype) void {
    const ptr = switch (@TypeOf(ptr_)) {
        ChildPtr => ptr_,
        else => ChildPtr.init(ptr_),
    };
    if (this.writers.len() == 0) return;
    const idx = this.writer_idx;
    const slice: []Writer = this.writers.sliceMutable();
    if (idx >= slice.len) return;
    for (slice[idx..]) |*w| {
        if (w.ptr.ptr.repr._ptr == ptr.ptr.repr._ptr) {
            w.setDead();
        }
    }
}

const Writer = struct {
    ptr: ChildPtr,
    len: usize,
    written: usize = 0,
    bytelist: ?*bun.ByteList = null,

    pub fn wroteEverything(this: *const Writer) bool {
        return this.written >= this.len;
    }

    pub fn rawPtr(this: Writer) ?*anyopaque {
        return this.ptr.ptr.ptr();
    }

    pub fn isDead(this: Writer) bool {
        return this.ptr.ptr.isNull();
    }

    pub fn setDead(this: *Writer) void {
        this.ptr.ptr = ChildPtrRaw.Null;
    }
};

pub const Writers = SmolList(Writer, 2);

/// Skips over dead children and increments `total_bytes_written` by the
/// amount they would have written so the buf is skipped as well
pub fn skipDead(this: *IOWriter) void {
    const slice = this.writers.slice();
    for (slice[this.writer_idx..]) |*w| {
        if (w.isDead()) {
            this.writer_idx += 1;
            this.total_bytes_written += w.len - w.written;
            continue;
        }
        return;
    }
    return;
}

pub fn doFileWrite(this: *IOWriter) Yield {
    assert(bun.Environment.isPosix);
    assert(!this.flags.pollable);
    assert(this.writer_idx < this.writers.len());

    defer this.setWriting(false);
    this.skipDead();

    const child = this.writers.get(this.writer_idx);
    assert(!child.isDead());

    const buf = this.getBuffer();
    assert(buf.len > 0);

    var done = false;
    const writeResult = drainBufferedData(this, buf, std.math.maxInt(u32), false);
    const amt = switch (writeResult) {
        .done => |amt| amt: {
            done = true;
            break :amt amt;
        },
        // .wrote can be returned if an error was encountered but there we wrote
        // some data before it happened. In that case, onError will also be
        // called so we should just return.
        .wrote => |amt| amt: {
            if (this.err != null) return .done;
            break :amt amt;
        },
        // This is returned when we hit EAGAIN which should not be the case
        // when writing to files unless we opened the file with non-blocking
        // mode
        .pending => bun.unreachablePanic("drainBufferedData returning .pending in IOWriter.doFileWrite should not happen", .{}),
        .err => |e| {
            this.onError(e);
            return .done;
        },
    };
    if (child.bytelist) |bl| {
        const written_slice = this.buf.items[this.total_bytes_written .. this.total_bytes_written + amt];
        bl.append(bun.default_allocator, written_slice) catch bun.outOfMemory();
    }
    child.written += amt;
    if (!child.wroteEverything()) {
        bun.assert(writeResult == .done);
        // This should never happen if we are here. The only case where we get
        // partial writes is when an error is encountered
        bun.unreachablePanic("IOWriter.doFileWrite: child.wroteEverything() is false. This is unexpected behavior and indicates a bug in Bun. Please file a GitHub issue.", .{});
    }
    return this.bump(child);
}

pub fn onWritePollable(this: *IOWriter, amount: usize, status: bun.io.WriteStatus) void {
    if (bun.Environment.isPosix) bun.assert(this.flags.pollable);

    this.setWriting(false);
    debug("IOWriter(0x{x}, fd={}) onWrite({d}, {})", .{ @intFromPtr(this), this.fd, amount, status });
    if (this.writer_idx >= this.writers.len()) return;
    const child = this.writers.get(this.writer_idx);
    if (child.isDead()) {
        this.bump(child).run();
    } else {
        if (child.bytelist) |bl| {
            const written_slice = this.buf.items[this.total_bytes_written .. this.total_bytes_written + amount];
            bl.append(bun.default_allocator, written_slice) catch bun.outOfMemory();
        }
        this.total_bytes_written += amount;
        child.written += amount;
        if (status == .end_of_file) {
            const not_fully_written = if (this.isLastIdx(this.writer_idx)) true else child.written < child.len;
            // We wrote everything
            if (!not_fully_written) return;

            // We did not write everything.
            // This seems to happen in a pipeline where the command which
            // _reads_ the output of the previous command closes before the
            // previous command.
            //
            // Example: `ls . | echo hi`
            //
            // 1. We call `socketpair()` and give `ls .` a socket to _write_ to and `echo hi` a socket to _read_ from
            // 2. `ls .` executes first, but has to do some async work and so is suspended
            // 3. `echo hi` then executes and finishes first (since it does less work) and closes its socket
            // 4. `ls .` does its thing and then tries to write to its socket
            // 5. Because `echo hi` closed its socket, when `ls .` does `send(...)` it will return EPIPE
            // 6. Inside our PipeWriter abstraction this gets returned as bun.io.WriteStatus.end_of_file
            //
            // So what should we do? In a normal shell, `ls .` would receive the SIGPIPE signal and exit.
            // We don't support signals right now. In fact we don't even have a way to kill the shell.
            //
            // So for a quick hack we're just going to have all writes return an error.
            bun.assert(this.flags.is_socket);
            bun.Output.debugWarn("IOWriter(0x{x}, fd={}) received done without fully writing data", .{ @intFromPtr(this), this.fd });
            this.flags.broken_pipe = true;
            this.brokenPipeForWriters();
            return;
        }

        if (child.written >= child.len) {
            this.bump(child).run();
        }
    }

    const wrote_everything: bool = this.wroteEverything();

    log("IOWriter(0x{x}, fd={}) wrote_everything={}, idx={d} writers={d} next_len={d}", .{ @intFromPtr(this), this.fd, wrote_everything, this.writer_idx, this.writers.len(), if (this.writers.len() >= 1) this.writers.get(0).len else 0 });
    if (!wrote_everything and this.writer_idx < this.writers.len()) {
        debug("IOWriter(0x{x}, fd={}) poll again", .{ @intFromPtr(this), this.fd });
        if (comptime bun.Environment.isWindows) {
            this.setWriting(true);
            this.writer.write();
        } else {
            bun.assert(this.writer.handle == .poll);
            this.writer.registerPoll();
        }
    }
}

pub fn brokenPipeForWriters(this: *IOWriter) void {
    bun.assert(this.flags.broken_pipe);
    var offset: usize = 0;
    for (this.writers.sliceMutable()) |*w| {
        if (w.isDead()) {
            offset += w.len;
            continue;
        }
        log("IOWriter(0x{x}, fd={}) brokenPipeForWriters {s}(0x{x})", .{ @intFromPtr(this), this.fd, @tagName(w.ptr.ptr.tag()), @intFromPtr(w.ptr.ptr.ptr()) });
        const err: JSC.SystemError = bun.sys.Error.fromCode(.PIPE, .write).toSystemError();
        w.ptr.onIOWriterChunk(0, err).run();
        offset += w.len;
    }

    this.total_bytes_written = 0;
    this.writers.clearRetainingCapacity();
    this.buf.clearRetainingCapacity();
    this.writer_idx = 0;
}

pub fn wroteEverything(this: *IOWriter) bool {
    return this.total_bytes_written >= this.buf.items.len;
}

pub fn onClose(this: *IOWriter) void {
    this.setWriting(false);
}

pub fn onError(this: *IOWriter, err__: bun.sys.Error) void {
    this.setWriting(false);
    const ee = err__.toShellSystemError();
    this.err = ee;
    log("IOWriter(0x{x}, fd={}) onError errno={s} errmsg={} errsyscall={}", .{ @intFromPtr(this), this.fd, @tagName(ee.getErrno()), ee.message, ee.syscall });
    var seen_alloc = std.heap.stackFallback(@sizeOf(usize) * 64, bun.default_allocator);
    var seen = std.ArrayList(usize).initCapacity(seen_alloc.get(), 64) catch bun.outOfMemory();
    defer seen.deinit();
    writer_loop: for (this.writers.slice()) |w| {
        if (w.isDead()) continue;
        const ptr = w.ptr.ptr.ptr();
        if (seen.items.len < 8) {
            for (seen.items[0..]) |item| {
                if (item == @intFromPtr(ptr)) {
                    continue :writer_loop;
                }
            }
        } else if (std.mem.indexOfScalar(usize, seen.items[0..], @intFromPtr(ptr)) != null) {
            continue :writer_loop;
        }

        seen.append(@intFromPtr(ptr)) catch bun.outOfMemory();
        // TODO: This probably shouldn't call .run()
        w.ptr.onIOWriterChunk(0, this.err).run();
    }

    this.total_bytes_written = 0;
    this.writer_idx = 0;
    this.buf.clearRetainingCapacity();
    this.writers.clearRetainingCapacity();
}

/// Returns the buffer of data that needs to be written
/// for the *current* writer.
pub fn getBuffer(this: *IOWriter) []const u8 {
    const result = this.getBufferImpl();
    if (comptime bun.Environment.isWindows) {
        this.winbuf.clearRetainingCapacity();
        this.winbuf.appendSlice(bun.default_allocator, result) catch bun.outOfMemory();
        return this.winbuf.items;
    }
    log("IOWriter(0x{x}, fd={}) getBuffer = {d} bytes", .{ @intFromPtr(this), this.fd, result.len });
    return result;
}

fn getBufferImpl(this: *IOWriter) []const u8 {
    const writer = brk: {
        if (this.writer_idx >= this.writers.len()) {
            log("IOWriter(0x{x}, fd={}) getBufferImpl all writes done", .{ @intFromPtr(this), this.fd });
            return "";
        }
        log("IOWriter(0x{x}, fd={}) getBufferImpl idx={d} writer_len={d}", .{ @intFromPtr(this), this.fd, this.writer_idx, this.writers.len() });
        var writer = this.writers.get(this.writer_idx);
        if (!writer.isDead()) break :brk writer;
        log("IOWriter(0x{x}, fd={}) skipping dead", .{ @intFromPtr(this), this.fd });
        this.skipDead();
        if (this.writer_idx >= this.writers.len()) {
            log("IOWriter(0x{x}, fd={}) getBufferImpl all writes done", .{ @intFromPtr(this), this.fd });
            return "";
        }
        writer = this.writers.get(this.writer_idx);
        break :brk writer;
    };
    log("IOWriter(0x{x}, fd={}) getBufferImpl writer_len={} writer_written={}", .{ @intFromPtr(this), this.fd, writer.len, writer.written });
    const remaining = writer.len - writer.written;
    if (bun.Environment.allow_assert) {
        assert(!(writer.len == writer.written));
    }
    return this.buf.items[this.total_bytes_written .. this.total_bytes_written + remaining];
}

pub fn bump(this: *IOWriter, current_writer: *Writer) Yield {
    log("IOWriter(0x{x}, fd={}) bump(0x{x} {s})", .{ @intFromPtr(this), this.fd, @intFromPtr(current_writer), @tagName(current_writer.ptr.ptr.tag()) });

    const is_dead = current_writer.isDead();
    const written = current_writer.written;
    const child_ptr = current_writer.ptr;

    if (is_dead) {
        this.skipDead();
    } else {
        if (bun.Environment.allow_assert) {
            if (!is_dead) assert(current_writer.written == current_writer.len);
        }
        this.writer_idx += 1;
    }

    if (this.writer_idx >= this.writers.len()) {
        log("IOWriter(0x{x}, fd={}) all writers complete: truncating", .{ @intFromPtr(this), this.fd });
        this.buf.clearRetainingCapacity();
        this.writer_idx = 0;
        this.writers.clearRetainingCapacity();
        this.total_bytes_written = 0;
    } else if (this.total_bytes_written >= SHRINK_THRESHOLD) {
        const slice = this.buf.items[this.total_bytes_written..];
        const remaining_len = slice.len;
        log("IOWriter(0x{x}, fd={}) exceeded shrink threshold: truncating (new_len={d}, writer_starting_idx={d})", .{ @intFromPtr(this), this.fd, remaining_len, this.writer_idx });
        if (slice.len == 0) {
            this.buf.clearRetainingCapacity();
            this.total_bytes_written = 0;
        } else {
            bun.copy(u8, this.buf.items[0..remaining_len], slice);
            this.buf.items.len = remaining_len;
            this.total_bytes_written = 0;
        }
        this.writers.truncate(this.writer_idx);
        this.writer_idx = 0;
        if (bun.Environment.allow_assert) {
            if (this.writers.len() > 0) {
                const first = this.writers.getConst(this.writer_idx);
                assert(this.buf.items.len >= first.len);
            }
        }
    }

    // If the writer was not dead then call its `onIOWriterChunk` callback
    if (!is_dead) {
        return child_ptr.onIOWriterChunk(written, null);
    }

    return .done;
}

fn enqueueFile(this: *IOWriter) Yield {
    if (this.is_writing) {
        return .suspended;
    }
    this.setWriting(true);

    return this.doFileWrite();
}

/// `writer` is the new writer to queue
///
/// You MUST have already added the data to `this.buf`!!
pub fn enqueueInternal(this: *IOWriter) Yield {
    bun.assert(!this.flags.broken_pipe);
    if (!this.flags.pollable and bun.Environment.isPosix) return this.enqueueFile();
    switch (this.write()) {
        .suspended => return .suspended,
        .is_actually_file => {
            bun.assert(bun.Environment.isPosix);
            return this.enqueueFile();
        },
        // FIXME
        .failed => return .failed,
    }
}

pub fn handleBrokenPipe(this: *IOWriter, ptr: ChildPtr) ?Yield {
    if (this.flags.broken_pipe) {
        const err: JSC.SystemError = bun.sys.Error.fromCode(.PIPE, .write).toSystemError();
        log("IOWriter(0x{x}, fd={}) broken pipe {s}(0x{x})", .{ @intFromPtr(this), this.fd, @tagName(ptr.ptr.tag()), @intFromPtr(ptr.ptr.ptr()) });
        return .{ .on_io_writer_chunk = .{ .child = ptr.asAnyOpaque(), .written = 0, .err = err } };
    }
    return null;
}

pub fn enqueue(this: *IOWriter, ptr: anytype, bytelist: ?*bun.ByteList, buf: []const u8) Yield {
    const childptr = if (@TypeOf(ptr) == ChildPtr) ptr else ChildPtr.init(ptr);
    if (this.handleBrokenPipe(childptr)) |yield| return yield;

    if (buf.len == 0) {
        log("IOWriter(0x{x}, fd={}) enqueue EMPTY", .{ @intFromPtr(this), this.fd });
        return .{ .on_io_writer_chunk = .{ .child = childptr.asAnyOpaque(), .written = 0, .err = null } };
    }
    const writer: Writer = .{
        .ptr = childptr,
        .len = buf.len,
        .bytelist = bytelist,
    };
    log("IOWriter(0x{x}, fd={}) enqueue(0x{x} {s}, buf_len={d}, buf={s}, writer_len={d})", .{ @intFromPtr(this), this.fd, @intFromPtr(writer.rawPtr()), @tagName(writer.ptr.ptr.tag()), buf.len, buf[0..@min(128, buf.len)], this.writers.len() + 1 });
    this.buf.appendSlice(bun.default_allocator, buf) catch bun.outOfMemory();
    this.writers.append(writer);
    return this.enqueueInternal();
}

pub fn enqueueFmtBltn(
    this: *IOWriter,
    ptr: anytype,
    bytelist: ?*bun.ByteList,
    comptime kind: ?Interpreter.Builtin.Kind,
    comptime fmt_: []const u8,
    args: anytype,
) Yield {
    const cmd_str = comptime if (kind) |k| @tagName(k) ++ ": " else "";
    const fmt__ = cmd_str ++ fmt_;
    return this.enqueueFmt(ptr, bytelist, fmt__, args);
}

pub fn enqueueFmt(
    this: *IOWriter,
    ptr: anytype,
    bytelist: ?*bun.ByteList,
    comptime fmt: []const u8,
    args: anytype,
) Yield {
    var buf_writer = this.buf.writer(bun.default_allocator);
    const start = this.buf.items.len;
    buf_writer.print(fmt, args) catch bun.outOfMemory();

    const childptr = if (@TypeOf(ptr) == ChildPtr) ptr else ChildPtr.init(ptr);
    if (this.handleBrokenPipe(childptr)) |yield| return yield;

    const end = this.buf.items.len;
    const writer: Writer = .{
        .ptr = childptr,
        .len = end - start,
        .bytelist = bytelist,
    };
    log("IOWriter(0x{x}, fd={}) enqueue(0x{x} {s}, {s})", .{ @intFromPtr(this), this.fd, @intFromPtr(writer.rawPtr()), @tagName(writer.ptr.ptr.tag()), this.buf.items[start..end] });
    this.writers.append(writer);
    return this.enqueueInternal();
}

fn asyncDeinit(this: *@This()) void {
    debug("IOWriter(0x{x}, fd={}) asyncDeinit", .{ @intFromPtr(this), this.fd });
    this.async_deinit.enqueue();
}

pub fn deinitOnMainThread(this: *IOWriter) void {
    debug("IOWriter(0x{x}, fd={}) deinit", .{ @intFromPtr(this), this.fd });
    if (bun.Environment.allow_assert) this.ref_count.assertNoRefs();
    this.buf.deinit(bun.default_allocator);
    if (comptime bun.Environment.isPosix) {
        if (this.writer.handle == .poll and this.writer.handle.poll.isRegistered()) {
            this.writer.handle.closeImpl(null, {}, false);
        }
    } else this.winbuf.deinit(bun.default_allocator);
    if (this.fd.isValid()) this.fd.close();
    this.writer.disableKeepingProcessAlive(this.evtloop);
    bun.destroy(this);
}

pub fn isLastIdx(this: *IOWriter, idx: usize) bool {
    return idx == this.writers.len() -| 1;
}

/// Only does things on windows
pub inline fn setWriting(this: *IOWriter, writing: bool) void {
    if (bun.Environment.isWindows) {
        log("IOWriter(0x{x}, fd={}) setWriting({any})", .{ @intFromPtr(this), this.fd, writing });
        this.is_writing = writing;
    }
}

// this is unused
pub fn runFromMainThread(_: *IOWriter) void {}

// this is unused
pub fn runFromMainThreadMini(_: *IOWriter, _: *void) void {}

/// Anything which uses `*IOWriter` to write to a file descriptor needs to
/// register itself here so we know how to call its callback on completion.
pub const IOWriterChildPtr = struct {
    ptr: ChildPtrRaw,

    pub fn init(p: anytype) IOWriterChildPtr {
        return .{
            .ptr = ChildPtrRaw.init(p),
        };
    }

    pub fn asAnyOpaque(this: IOWriterChildPtr) *anyopaque {
        return this.ptr.ptr();
    }

    pub fn fromAnyOpaque(p: *anyopaque) IOWriterChildPtr {
        return .{ .ptr = ChildPtrRaw.from(p) };
    }

    /// Called when the IOWriter writes a complete chunk of data the child enqueued
    pub fn onIOWriterChunk(this: IOWriterChildPtr, amount: usize, err: ?JSC.SystemError) Yield {
        return this.ptr.call("onIOWriterChunk", .{ amount, err }, Yield);
    }
};

pub const ChildPtrRaw = bun.TaggedPointerUnion(.{
    Interpreter.Cmd,
    Interpreter.Pipeline,
    Interpreter.CondExpr,
    Interpreter.Subshell,
    Interpreter.Builtin.Cd,
    Interpreter.Builtin.Echo,
    Interpreter.Builtin.Export,
    Interpreter.Builtin.Ls,
    Interpreter.Builtin.Ls.ShellLsOutputTask,
    Interpreter.Builtin.Mv,
    Interpreter.Builtin.Pwd,
    Interpreter.Builtin.Rm,
    Interpreter.Builtin.Which,
    Interpreter.Builtin.Mkdir,
    Interpreter.Builtin.Mkdir.ShellMkdirOutputTask,
    Interpreter.Builtin.Touch,
    Interpreter.Builtin.Touch.ShellTouchOutputTask,
    Interpreter.Builtin.Cat,
    Interpreter.Builtin.Exit,
    Interpreter.Builtin.True,
    Interpreter.Builtin.False,
    Interpreter.Builtin.Yes,
    Interpreter.Builtin.Seq,
    Interpreter.Builtin.Dirname,
    Interpreter.Builtin.Basename,
    Interpreter.Builtin.Cp,
    Interpreter.Builtin.Cp.ShellCpOutputTask,
    shell.subproc.PipeReader.CapturedWriter,
});

/// TODO: This function and `drainBufferedData` are copy pastes from
/// `PipeWriter.zig`, it would be nice to not have to do that
fn tryWriteWithWriteFn(fd: bun.FileDescriptor, buf: []const u8, comptime write_fn: *const fn (bun.FileDescriptor, []const u8) JSC.Maybe(usize)) bun.io.WriteResult {
    var offset: usize = 0;

    while (offset < buf.len) {
        switch (write_fn(fd, buf[offset..])) {
            .err => |err| {
                if (err.isRetry()) {
                    return .{ .pending = offset };
                }

                if (err.getErrno() == .PIPE) {
                    return .{ .done = offset };
                }

                return .{ .err = err };
            },

            .result => |wrote| {
                offset += wrote;
                if (wrote == 0) {
                    return .{ .done = offset };
                }
            },
        }
    }

    return .{ .wrote = offset };
}

pub fn drainBufferedData(parent: *IOWriter, buf: []const u8, max_write_size: usize, received_hup: bool) bun.io.WriteResult {
    _ = received_hup;

    const trimmed = if (max_write_size < buf.len and max_write_size > 0) buf[0..max_write_size] else buf;

    var drained: usize = 0;

    while (drained < trimmed.len) {
        const attempt = tryWriteWithWriteFn(parent.fd, buf, bun.sys.write);
        switch (attempt) {
            .pending => |pending| {
                drained += pending;
                return .{ .pending = drained };
            },
            .wrote => |amt| {
                drained += amt;
            },
            .err => |err| {
                if (drained > 0) {
                    onError(parent, err);
                    return .{ .wrote = drained };
                } else {
                    return .{ .err = err };
                }
            },
            .done => |amt| {
                drained += amt;
                return .{ .done = drained };
            },
        }
    }

    return .{ .wrote = drained };
}

/// TODO: Investigate what we need to do to remove this since we did most of the leg
///       work in removing recursion in the shell. That is what caused the need for
///       making deinitialization asynchronous in the first place.
///
///       There are two areas which need to change:
///
///       1. `IOWriter.onWritePollable` calls `this.bump(child).run()` which could
///          deinitialize the child which will deref and potentially deinitalize the
///          `IOWriter`. Simple solution is to ref and defer ref the `IOWriter`
///
///       2. `PipeWriter` seems to try to use this struct after IOWriter
///          deinitializes. We might not be able to get around this.
pub const AsyncDeinitWriter = struct {
    ran: bool = false,

    pub fn enqueue(this: *@This()) void {
        if (this.ran) return;
        this.ran = true;

        var iowriter = this.writer();

        if (iowriter.evtloop == .js) {
            iowriter.evtloop.js.enqueueTaskConcurrent(iowriter.concurrent_task.js.from(this, .manual_deinit));
        } else {
            iowriter.evtloop.mini.enqueueTaskConcurrent(iowriter.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    pub fn writer(this: *@This()) *IOWriter {
        return @alignCast(@fieldParentPtr("async_deinit", this));
    }

    pub fn runFromMainThread(this: *@This()) void {
        this.writer().deinitOnMainThread();
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }
};

const bun = @import("bun");
const Yield = bun.shell.Yield;
const shell = bun.shell;
const Interpreter = shell.Interpreter;
const JSC = bun.JSC;
const std = @import("std");
const assert = bun.assert;
const log = bun.Output.scoped(.IOWriter, true);
const SmolList = shell.SmolList;
const Maybe = JSC.Maybe;
