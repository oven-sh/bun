//! Similar to `IOWriter` but for reading
//!
//! *NOTE* This type is reference counted, but deinitialization is queued onto
//! the event loop. This was done to prevent bugs.
pub const IOReader = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", asyncDeinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

fd: bun.FileDescriptor,
reader: ReaderImpl,
buf: std.ArrayListUnmanaged(u8) = .{},
readers: Readers = .{ .inlined = .{} },
read: usize = 0,
ref_count: RefCount,
err: ?jsc.SystemError = null,
evtloop: jsc.EventLoopHandle,
concurrent_task: jsc.EventLoopTask,
async_deinit: AsyncDeinitReader,
is_reading: if (bun.Environment.isWindows) bool else u0 = if (bun.Environment.isWindows) false else 0,

pub const ChildPtr = IOReaderChildPtr;
pub const ReaderImpl = bun.io.BufferedReader;

const InitFlags = packed struct(u8) {
    pollable: bool = false,
    nonblocking: bool = false,
    socket: bool = false,
    __unused: u5 = 0,
};

pub fn dupeRef(this: *IOReader) *IOReader {
    this.ref();
    return this;
}

pub fn memoryCost(this: *const IOReader) usize {
    var size: usize = @sizeOf(IOReader);
    size += this.buf.allocatedSlice().len;
    size += this.readers.memoryCost();
    return size;
}

pub fn eventLoop(this: *IOReader) jsc.EventLoopHandle {
    return this.evtloop;
}

pub fn loop(this: *IOReader) *bun.Async.Loop {
    if (comptime bun.Environment.isWindows) {
        return this.evtloop.loop().uv_loop;
    } else {
        return this.evtloop.loop();
    }
}

pub fn init(fd: bun.FileDescriptor, evtloop: jsc.EventLoopHandle) *IOReader {
    const this = bun.new(IOReader, .{
        .ref_count = .init(),
        .fd = fd,
        .reader = ReaderImpl.init(@This()),
        .evtloop = evtloop,
        .concurrent_task = jsc.EventLoopTask.fromEventLoop(evtloop),
        .async_deinit = .{},
    });
    log("IOReader(0x{x}, fd={f}) create", .{ @intFromPtr(this), fd });

    if (bun.Environment.isPosix) {
        this.reader.flags.close_handle = false;
    }

    if (bun.Environment.isWindows) {
        this.reader.source = .{ .file = bun.io.Source.openFile(fd) };
    }
    this.reader.setParent(this);

    return this;
}

/// Idempotent function to start the reading
pub fn start(this: *IOReader) Yield {
    if (bun.Environment.isPosix) {
        if (this.reader.handle == .closed or !this.reader.handle.poll.isRegistered()) {
            if (this.reader.start(this.fd, true).asErr()) |e| {
                this.onReaderError(e);
            }
        }
        return .suspended;
    }

    if (this.is_reading) return .suspended;
    this.is_reading = true;
    if (this.reader.startWithCurrentPipe().asErr()) |e| {
        this.onReaderError(e);
        return .failed;
    }
    return .suspended;
}

/// Only does things on windows
pub inline fn setReading(this: *IOReader, reading: bool) void {
    if (bun.Environment.isWindows) {
        log("IOReader(0x{x}) setReading({})", .{ @intFromPtr(this), reading });
        this.is_reading = reading;
    }
}

pub fn addReader(this: *IOReader, reader_: anytype) void {
    const reader: ChildPtr = switch (@TypeOf(reader_)) {
        ChildPtr => reader_,
        else => ChildPtr.init(reader_),
    };

    const slice = this.readers.slice();
    const usize_slice: []const usize = @as([*]const usize, @ptrCast(slice.ptr))[0..slice.len];
    const ptr_usize: usize = @intFromPtr(reader.ptr.ptr());
    // Only add if it hasn't been added yet
    if (std.mem.indexOfScalar(usize, usize_slice, ptr_usize) == null) {
        this.readers.append(reader);
    }
}

pub fn removeReader(this: *IOReader, reader_: anytype) void {
    const reader = switch (@TypeOf(reader_)) {
        ChildPtr => reader_,
        else => ChildPtr.init(reader_),
    };
    const slice = this.readers.slice();
    const usize_slice: []const usize = @as([*]const usize, @ptrCast(slice.ptr))[0..slice.len];
    const ptr_usize: usize = @intFromPtr(reader.ptr.ptr());
    if (std.mem.indexOfScalar(usize, usize_slice, ptr_usize)) |idx| {
        this.readers.swapRemove(idx);
    }
}

pub fn onReadChunk(ptr: *anyopaque, chunk: []const u8, has_more: bun.io.ReadState) bool {
    var this: *IOReader = @ptrCast(@alignCast(ptr));
    log("IOReader(0x{x}, fd={f}) onReadChunk(chunk_len={d}, has_more={s})", .{ @intFromPtr(this), this.fd, chunk.len, @tagName(has_more) });
    this.setReading(false);

    var i: usize = 0;
    while (i < this.readers.len()) {
        var r = this.readers.get(i);
        var remove = false;
        r.onReadChunk(chunk, &remove).run();
        if (remove) {
            this.readers.swapRemove(i);
        } else {
            i += 1;
        }
    }

    const should_continue = has_more != .eof;
    if (should_continue) {
        if (this.readers.len() > 0) {
            this.setReading(true);
            if (bun.Environment.isPosix)
                this.reader.registerPoll()
            else switch (this.reader.startWithCurrentPipe()) {
                .err => |e| {
                    this.onReaderError(e);
                    return false;
                },
                else => {},
            }
        }
    }

    return should_continue;
}

pub fn onReaderError(this: *IOReader, err: bun.sys.Error) void {
    log("IOReader(0x{x}.onReaderError({f}) ", .{ @intFromPtr(this), err });
    this.setReading(false);
    this.err = err.toShellSystemError();
    for (this.readers.slice()) |r| {
        r.onReaderDone(if (this.err) |*e| brk: {
            e.ref();
            break :brk e.*;
        } else null).run();
    }
}

pub fn onReaderDone(this: *IOReader) void {
    log("IOReader(0x{x}) done", .{@intFromPtr(this)});
    this.setReading(false);
    for (this.readers.slice()) |r| {
        r.onReaderDone(if (this.err) |*err| brk: {
            err.ref();
            break :brk err.*;
        } else null).run();
    }
}

fn asyncDeinit(this: *@This()) void {
    log("IOReader(0x{x}) asyncDeinit", .{@intFromPtr(this)});
    this.async_deinit.enqueue(); // calls `asyncDeinitCallback`
}

fn asyncDeinitCallback(this: *@This()) void {
    if (this.fd != bun.invalid_fd) {
        // windows reader closes the file descriptor
        if (bun.Environment.isWindows) {
            if (this.reader.source != null and !this.reader.source.?.isClosed()) {
                this.reader.closeImpl(false);
            }
        } else {
            log("IOReader(0x{x}) __deinit fd={f}", .{ @intFromPtr(this), this.fd });
            this.fd.close();
        }
    }
    this.buf.deinit(bun.default_allocator);
    this.reader.disableKeepingProcessAlive({});
    this.reader.deinit();
    bun.destroy(this);
}

pub const Reader = struct {
    ptr: ChildPtr,
};

pub const Readers = SmolList(ChildPtr, 4);

pub const IOReaderChildPtr = struct {
    ptr: ChildPtrRaw,

    pub const ChildPtrRaw = bun.TaggedPointerUnion(.{
        Interpreter.Builtin.Cat,
    });

    pub fn init(p: anytype) IOReaderChildPtr {
        return .{
            .ptr = ChildPtrRaw.init(p),
            // .ptr = @ptrCast(p),
        };
    }

    pub fn memoryCost(this: IOReaderChildPtr) usize {
        if (this.ptr.is(Interpreter.Builtin.Cat)) {
            // TODO:
            return @sizeOf(Interpreter.Builtin.Cat);
        }
        return 0;
    }

    /// Return true if the child should be deleted
    pub fn onReadChunk(this: IOReaderChildPtr, chunk: []const u8, remove: *bool) Yield {
        return this.ptr.call("onIOReaderChunk", .{ chunk, remove }, Yield);
    }

    pub fn onReaderDone(this: IOReaderChildPtr, err: ?jsc.SystemError) Yield {
        return this.ptr.call("onIOReaderDone", .{err}, Yield);
    }
};

pub const AsyncDeinitReader = struct {
    ran: bool = false,

    pub fn enqueue(this: *@This()) void {
        if (this.ran) return;
        this.ran = true;

        var ioreader = this.reader();
        if (ioreader.evtloop == .js) {
            ioreader.evtloop.js.enqueueTaskConcurrent(ioreader.concurrent_task.js.from(this, .manual_deinit));
        } else {
            ioreader.evtloop.mini.enqueueTaskConcurrent(ioreader.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    pub fn reader(this: *AsyncDeinitReader) *IOReader {
        return @alignCast(@fieldParentPtr("async_deinit", this));
    }

    pub fn runFromMainThread(this: *AsyncDeinitReader) void {
        const ioreader: *IOReader = @alignCast(@fieldParentPtr("async_deinit", this));
        ioreader.asyncDeinitCallback();
    }

    pub fn runFromMainThreadMini(this: *AsyncDeinitReader, _: *void) void {
        this.runFromMainThread();
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const shell = bun.shell;
const Interpreter = bun.shell.Interpreter;
const SmolList = bun.shell.SmolList;
const Yield = shell.Yield;
const log = bun.shell.interpret.log;
