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
__idx: usize = 0,
total_bytes_written: usize = 0,
err: ?JSC.SystemError = null,
evtloop: JSC.EventLoopHandle,
concurrent_task: JSC.EventLoopTask,
is_writing: if (bun.Environment.isWindows) bool else u0 = if (bun.Environment.isWindows) false else 0,
async_deinit: AsyncDeinitWriter = .{},
started: bool = false,
flags: InitFlags = .{},

const debug = bun.Output.scoped(.IOWriter, true);

const ChildPtr = IOWriterChildPtr;

/// ~128kb
/// We shrunk the `buf` when we reach the last writer,
/// but if this never happens, we shrink `buf` when it exceeds this threshold
const SHRINK_THRESHOLD = 1024 * 128;

pub const auto_poll = false;

pub const WriterImpl = bun.io.BufferedWriter(IOWriter, struct {
    pub const onWrite = IOWriter.onWrite;
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

pub const InitFlags = packed struct(u8) {
    pollable: bool = false,
    nonblocking: bool = false,
    is_socket: bool = false,
    __unused: u5 = 0,
};

pub fn init(fd: bun.FileDescriptor, flags: InitFlags, evtloop: JSC.EventLoopHandle) *IOWriter {
    const this = bun.new(IOWriter, .{
        .ref_count = .init(),
        .fd = fd,
        .evtloop = evtloop,
        .concurrent_task = JSC.EventLoopTask.fromEventLoop(evtloop),
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
pub fn write(this: *IOWriter) void {
    if (!this.started) {
        log("IOWriter(0x{x}, fd={}) starting", .{ @intFromPtr(this), this.fd });
        if (this.__start().asErr()) |e| {
            this.onError(e);
            return;
        }
        this.started = true;
        if (comptime bun.Environment.isPosix) {
            if (this.writer.handle == .fd) {} else return;
        } else return;
    }
    if (bun.Environment.isWindows) {
        log("IOWriter(0x{x}, fd={}) write() is_writing={any}", .{ @intFromPtr(this), this.fd, this.is_writing });
        if (this.is_writing) return;
        this.is_writing = true;
        if (this.writer.startWithCurrentPipe().asErr()) |e| {
            this.onError(e);
            return;
        }
        return;
    }

    if (this.writer.handle == .poll) {
        if (!this.writer.handle.poll.isWatching()) {
            log("IOWriter(0x{x}, fd={}) calling this.writer.write()", .{ @intFromPtr(this), this.fd });
            this.writer.write();
        } else log("IOWriter(0x{x}, fd={}) poll already watching", .{ @intFromPtr(this), this.fd });
    } else {
        log("IOWriter(0x{x}, fd={}) no poll, calling write", .{ @intFromPtr(this), this.fd });
        this.writer.write();
    }
}

/// Cancel the chunks enqueued by the given writer by
/// marking them as dead
pub fn cancelChunks(this: *IOWriter, ptr_: anytype) void {
    const ptr = switch (@TypeOf(ptr_)) {
        ChildPtr => ptr_,
        else => ChildPtr.init(ptr_),
    };
    if (this.writers.len() == 0) return;
    const idx = this.__idx;
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

    pub fn rawPtr(this: Writer) ?*anyopaque {
        return this.ptr.ptr.ptr();
    }

    pub fn isDead(this: Writer) bool {
        return this.ptr.ptr.isNull();
    }

    pub fn setDead(this: *Writer) void {
        this.ptr.ptr = ChildPtr.ChildPtrRaw.Null;
    }
};

pub const Writers = SmolList(Writer, 2);

/// Skips over dead children and increments `total_bytes_written` by the
/// amount they would have written so the buf is skipped as well
pub fn skipDead(this: *IOWriter) void {
    const slice = this.writers.slice();
    for (slice[this.__idx..]) |*w| {
        if (w.isDead()) {
            this.__idx += 1;
            this.total_bytes_written += w.len - w.written;
            continue;
        }
        return;
    }
    return;
}

pub fn onWrite(this: *IOWriter, amount: usize, status: bun.io.WriteStatus) void {
    this.setWriting(false);
    debug("IOWriter(0x{x}, fd={}) onWrite({d}, {})", .{ @intFromPtr(this), this.fd, amount, status });
    if (this.__idx >= this.writers.len()) return;
    const child = this.writers.get(this.__idx);
    if (child.isDead()) {
        this.bump(child);
    } else {
        if (child.bytelist) |bl| {
            const written_slice = this.buf.items[this.total_bytes_written .. this.total_bytes_written + amount];
            bl.append(bun.default_allocator, written_slice) catch bun.outOfMemory();
        }
        this.total_bytes_written += amount;
        child.written += amount;
        if (status == .end_of_file) {
            const not_fully_written = !this.isLastIdx(this.__idx) or child.written < child.len;
            if (bun.Environment.allow_assert and not_fully_written) {
                bun.Output.debugWarn("IOWriter(0x{x}, fd={}) received done without fully writing data, check that onError is thrown", .{ @intFromPtr(this), this.fd });
            }
            return;
        }

        if (child.written >= child.len) {
            this.bump(child);
        }
    }

    const wrote_everything: bool = this.total_bytes_written >= this.buf.items.len;

    log("IOWriter(0x{x}, fd={}) wrote_everything={}, idx={d} writers={d} next_len={d}", .{ @intFromPtr(this), this.fd, wrote_everything, this.__idx, this.writers.len(), if (this.writers.len() >= 1) this.writers.get(0).len else 0 });
    if (!wrote_everything and this.__idx < this.writers.len()) {
        debug("IOWriter(0x{x}, fd={}) poll again", .{ @intFromPtr(this), this.fd });
        if (comptime bun.Environment.isWindows) {
            this.setWriting(true);
            this.writer.write();
        } else {
            if (this.writer.handle == .poll)
                this.writer.registerPoll()
            else
                this.writer.write();
        }
    }
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

        w.ptr.onWriteChunk(0, this.err);
        seen.append(@intFromPtr(ptr)) catch bun.outOfMemory();
    }
}

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
        if (this.__idx >= this.writers.len()) {
            log("IOWriter(0x{x}, fd={}) getBufferImpl all writes done", .{ @intFromPtr(this), this.fd });
            return "";
        }
        log("IOWriter(0x{x}, fd={}) getBufferImpl idx={d} writer_len={d}", .{ @intFromPtr(this), this.fd, this.__idx, this.writers.len() });
        var writer = this.writers.get(this.__idx);
        if (!writer.isDead()) break :brk writer;
        log("IOWriter(0x{x}, fd={}) skipping dead", .{ @intFromPtr(this), this.fd });
        this.skipDead();
        if (this.__idx >= this.writers.len()) {
            log("IOWriter(0x{x}, fd={}) getBufferImpl all writes done", .{ @intFromPtr(this), this.fd });
            return "";
        }
        writer = this.writers.get(this.__idx);
        break :brk writer;
    };
    log("IOWriter(0x{x}, fd={}) getBufferImpl writer_len={} writer_written={}", .{ @intFromPtr(this), this.fd, writer.len, writer.written });
    const remaining = writer.len - writer.written;
    if (bun.Environment.allow_assert) {
        assert(!(writer.len == writer.written));
    }
    return this.buf.items[this.total_bytes_written .. this.total_bytes_written + remaining];
}

pub fn bump(this: *IOWriter, current_writer: *Writer) void {
    log("IOWriter(0x{x}, fd={}) bump(0x{x} {s})", .{ @intFromPtr(this), this.fd, @intFromPtr(current_writer), @tagName(current_writer.ptr.ptr.tag()) });

    const is_dead = current_writer.isDead();
    const written = current_writer.written;
    const child_ptr = current_writer.ptr;

    defer {
        if (!is_dead) child_ptr.onWriteChunk(written, null);
    }

    if (is_dead) {
        this.skipDead();
    } else {
        if (bun.Environment.allow_assert) {
            if (!is_dead) assert(current_writer.written == current_writer.len);
        }
        this.__idx += 1;
    }

    if (this.__idx >= this.writers.len()) {
        log("IOWriter(0x{x}, fd={}) all writers complete: truncating", .{ @intFromPtr(this), this.fd });
        this.buf.clearRetainingCapacity();
        this.__idx = 0;
        this.writers.clearRetainingCapacity();
        this.total_bytes_written = 0;
        return;
    }

    if (this.total_bytes_written >= SHRINK_THRESHOLD) {
        const slice = this.buf.items[this.total_bytes_written..];
        const remaining_len = slice.len;
        log("IOWriter(0x{x}, fd={}) exceeded shrink threshold: truncating (new_len={d}, writer_starting_idx={d})", .{ @intFromPtr(this), this.fd, remaining_len, this.__idx });
        if (slice.len == 0) {
            this.buf.clearRetainingCapacity();
            this.total_bytes_written = 0;
        } else {
            bun.copy(u8, this.buf.items[0..remaining_len], slice);
            this.buf.items.len = remaining_len;
            this.total_bytes_written = 0;
        }
        this.writers.truncate(this.__idx);
        this.__idx = 0;
        if (bun.Environment.allow_assert) {
            if (this.writers.len() > 0) {
                const first = this.writers.getConst(this.__idx);
                assert(this.buf.items.len >= first.len);
            }
        }
    }
}

pub fn enqueue(this: *IOWriter, ptr: anytype, bytelist: ?*bun.ByteList, buf: []const u8) void {
    const childptr = if (@TypeOf(ptr) == ChildPtr) ptr else ChildPtr.init(ptr);
    if (buf.len == 0) {
        log("IOWriter(0x{x}, fd={}) enqueue EMPTY", .{ @intFromPtr(this), this.fd });
        childptr.onWriteChunk(0, null);
        return;
    }
    const writer: Writer = .{
        .ptr = childptr,
        .len = buf.len,
        .bytelist = bytelist,
    };
    log("IOWriter(0x{x}, fd={}) enqueue(0x{x} {s}, buf_len={d}, buf={s}, writer_len={d})", .{ @intFromPtr(this), this.fd, @intFromPtr(writer.rawPtr()), @tagName(writer.ptr.ptr.tag()), buf.len, buf[0..@min(128, buf.len)], this.writers.len() + 1 });
    this.buf.appendSlice(bun.default_allocator, buf) catch bun.outOfMemory();
    this.writers.append(writer);
    this.write();
}

pub fn enqueueFmtBltn(
    this: *IOWriter,
    ptr: anytype,
    bytelist: ?*bun.ByteList,
    comptime kind: ?Interpreter.Builtin.Kind,
    comptime fmt_: []const u8,
    args: anytype,
) void {
    const cmd_str = comptime if (kind) |k| @tagName(k) ++ ": " else "";
    const fmt__ = cmd_str ++ fmt_;
    this.enqueueFmt(ptr, bytelist, fmt__, args);
}

pub fn enqueueFmt(
    this: *IOWriter,
    ptr: anytype,
    bytelist: ?*bun.ByteList,
    comptime fmt: []const u8,
    args: anytype,
) void {
    var buf_writer = this.buf.writer(bun.default_allocator);
    const start = this.buf.items.len;
    buf_writer.print(fmt, args) catch bun.outOfMemory();
    const end = this.buf.items.len;
    const writer: Writer = .{
        .ptr = if (@TypeOf(ptr) == ChildPtr) ptr else ChildPtr.init(ptr),
        .len = end - start,
        .bytelist = bytelist,
    };
    log("IOWriter(0x{x}, fd={}) enqueue(0x{x} {s}, {s})", .{ @intFromPtr(this), this.fd, @intFromPtr(writer.rawPtr()), @tagName(writer.ptr.ptr.tag()), this.buf.items[start..end] });
    this.writers.append(writer);
    this.write();
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

const bun = @import("bun");
const shell = bun.shell;
const Interpreter = shell.Interpreter;
const JSC = bun.JSC;
const std = @import("std");
const assert = bun.assert;
const log = bun.Output.scoped(.IOWriter, true);
const SmolList = shell.SmolList;
const Maybe = JSC.Maybe;
const IOWriterChildPtr = shell.interpret.IOWriterChildPtr;
const AsyncDeinitWriter = shell.Interpreter.AsyncDeinitWriter;
