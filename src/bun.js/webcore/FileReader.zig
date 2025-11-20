const FileReader = @This();

const log = Output.scoped(.FileReader, .visible);

reader: IOReader = IOReader.init(FileReader),
done: bool = false,
pending: streams.Result.Pending = .{},
pending_value: jsc.Strong.Optional = .empty,
pending_view: []u8 = &.{},
fd: bun.FileDescriptor = bun.invalid_fd,
start_offset: ?usize = null,
max_size: ?usize = null,
total_readed: usize = 0,
started: bool = false,
waiting_for_onReaderDone: bool = false,
event_loop: jsc.EventLoopHandle,
lazy: Lazy = .{ .none = {} },
buffered: std.ArrayListUnmanaged(u8) = .{},
read_inside_on_pull: ReadDuringJSOnPullResult = .{ .none = {} },
highwater_mark: usize = 16384,
flowing: bool = true,

pub const IOReader = bun.io.BufferedReader;
pub const Poll = IOReader;
pub const tag = ReadableStream.Tag.File;

const ReadDuringJSOnPullResult = union(enum) {
    none: void,
    js: []u8,
    amount_read: usize,
    temporary: []const u8,
    use_buffered: usize,
};

pub const Lazy = union(enum) {
    none: void,
    blob: *Blob.Store,

    const OpenedFileBlob = struct {
        fd: bun.FileDescriptor,
        pollable: bool = false,
        nonblocking: bool = true,
        file_type: bun.io.FileType = .file,
    };

    pub extern "c" fn open_as_nonblocking_tty(i32, i32) i32;
    pub fn openFileBlob(file: *Blob.Store.File) bun.sys.Maybe(OpenedFileBlob) {
        var this = OpenedFileBlob{ .fd = bun.invalid_fd };
        var file_buf: bun.PathBuffer = undefined;
        var is_nonblocking = false;

        const fd: bun.FD = if (file.pathlike == .fd)
            if (file.pathlike.fd.stdioTag() != null) brk: {
                if (comptime Environment.isPosix) {
                    const rc = open_as_nonblocking_tty(file.pathlike.fd.native(), bun.O.RDONLY);
                    if (rc > -1) {
                        is_nonblocking = true;
                        file.is_atty = true;
                        break :brk .fromNative(rc);
                    }
                }
                break :brk file.pathlike.fd;
            } else brk: {
                const duped = bun.sys.dupWithFlags(file.pathlike.fd, 0);

                if (duped != .result) {
                    return .{ .err = duped.err.withFd(file.pathlike.fd) };
                }

                const fd: bun.FD = duped.result;
                if (comptime Environment.isPosix) {
                    if (fd.stdioTag() == null) {
                        is_nonblocking = switch (fd.getFcntlFlags()) {
                            .result => |flags| (flags & bun.O.NONBLOCK) != 0,
                            .err => false,
                        };
                    }
                }

                break :brk switch (fd.makeLibUVOwnedForSyscall(.dup, .close_on_fail)) {
                    .result => |owned_fd| owned_fd,
                    .err => |err| {
                        return .{ .err = err };
                    },
                };
            }
        else switch (bun.sys.open(file.pathlike.path.sliceZ(&file_buf), bun.O.RDONLY | bun.O.NONBLOCK | bun.O.CLOEXEC, 0)) {
            .result => |fd| brk: {
                if (Environment.isPosix) is_nonblocking = true;
                break :brk fd;
            },

            .err => |err| {
                return .{ .err = err.withPath(file.pathlike.path.slice()) };
            },
        };

        if (comptime Environment.isPosix) {
            if ((file.is_atty orelse false) or
                (fd.stdioTag() != null and std.posix.isatty(fd.cast())) or
                (file.pathlike == .fd and
                    file.pathlike.fd.stdioTag() != null and
                    std.posix.isatty(file.pathlike.fd.cast())))
            {
                // var termios = std.mem.zeroes(std.posix.termios);
                // _ = std.c.tcgetattr(fd.cast(), &termios);
                // bun.C.cfmakeraw(&termios);
                // _ = std.c.tcsetattr(fd.cast(), std.posix.TCSA.NOW, &termios);
                file.is_atty = true;
            }

            const stat: bun.Stat = switch (bun.sys.fstat(fd)) {
                .result => |result| result,
                .err => |err| {
                    fd.close();
                    return .{ .err = err };
                },
            };

            if (bun.S.ISDIR(stat.mode)) {
                bun.Async.Closer.close(fd, {});
                return .{ .err = .fromCode(.ISDIR, .fstat) };
            }

            if (bun.S.ISREG(stat.mode)) {
                is_nonblocking = false;
            }

            this.pollable = bun.sys.isPollable(stat.mode) or is_nonblocking or (file.is_atty orelse false);
            this.file_type = if (bun.S.ISFIFO(stat.mode))
                .pipe
            else if (bun.S.ISSOCK(stat.mode))
                .socket
            else
                .file;

            // pretend it's a non-blocking pipe if it's a TTY
            if (is_nonblocking and this.file_type != .socket) {
                this.file_type = .nonblocking_pipe;
            }

            this.nonblocking = is_nonblocking or (this.pollable and
                !(file.is_atty orelse false) and
                this.file_type != .pipe);

            if (this.nonblocking and this.file_type == .pipe) {
                this.file_type = .nonblocking_pipe;
            }
        }

        this.fd = fd;

        return .{ .result = this };
    }
};

pub fn eventLoop(this: *const FileReader) jsc.EventLoopHandle {
    return this.event_loop;
}

pub fn loop(this: *const FileReader) *bun.Async.Loop {
    if (comptime bun.Environment.isWindows) {
        return this.eventLoop().loop().uv_loop;
    } else {
        return this.eventLoop().loop();
    }
}

pub fn setup(
    this: *FileReader,
    fd: bun.FileDescriptor,
) void {
    this.* = FileReader{
        .reader = .{},
        .done = false,
        .fd = fd,
    };

    this.event_loop = this.parent().globalThis.bunVM().eventLoop();
}

pub fn onStart(this: *FileReader) streams.Start {
    this.reader.setParent(this);
    const was_lazy = this.lazy != .none;
    var pollable = false;
    var file_type: bun.io.FileType = .file;
    if (this.lazy == .blob) {
        switch (this.lazy.blob.data) {
            .s3, .bytes => @panic("Invalid state in FileReader: expected file "),
            .file => |*file| {
                defer {
                    this.lazy.blob.deref();
                    this.lazy = .none;
                }
                switch (Lazy.openFileBlob(file)) {
                    .err => |err| {
                        this.fd = bun.invalid_fd;
                        return .{ .err = err };
                    },
                    .result => |opened| {
                        bun.assert(opened.fd.isValid());
                        this.fd = opened.fd;
                        pollable = opened.pollable;
                        file_type = opened.file_type;
                        this.reader.flags.nonblocking = opened.nonblocking;
                        this.reader.flags.pollable = pollable;
                    },
                }
            },
        }
    }

    {
        const reader_fd = this.reader.getFd();
        if (reader_fd != bun.invalid_fd and this.fd == bun.invalid_fd) {
            this.fd = reader_fd;
        }
    }

    this.event_loop = jsc.EventLoopHandle.init(this.parent().globalThis.bunVM().eventLoop());

    if (was_lazy) {
        _ = this.parent().incrementCount();
        this.waiting_for_onReaderDone = true;
        if (this.start_offset) |offset| {
            switch (this.reader.startFileOffset(this.fd, pollable, offset)) {
                .result => {},
                .err => |e| {
                    return .{ .err = e };
                },
            }
        } else {
            switch (this.reader.start(this.fd, pollable)) {
                .result => {},
                .err => |e| {
                    return .{ .err = e };
                },
            }
        }
    } else if (comptime Environment.isPosix) {
        if (this.reader.flags.pollable and !this.reader.isDone()) {
            this.waiting_for_onReaderDone = true;
            _ = this.parent().incrementCount();
        }
    }

    if (comptime Environment.isPosix) {
        if (file_type == .socket) {
            this.reader.flags.socket = true;
        }

        if (this.reader.handle.getPoll()) |poll| {
            if (file_type == .socket or this.reader.flags.socket) {
                poll.flags.insert(.socket);
            } else {
                // if it's a TTY, we report it as a fifo
                // we want the behavior to be as though it were a blocking pipe.
                poll.flags.insert(.fifo);
            }

            if (this.reader.flags.nonblocking) {
                poll.flags.insert(.nonblocking);
            }
        }
    }

    this.started = true;

    if (this.reader.isDone()) {
        this.consumeReaderBuffer();
        if (this.buffered.items.len > 0) {
            return .{ .owned_and_done = bun.ByteList.moveFromList(&this.buffered) };
        }
    } else if (comptime Environment.isPosix) {
        if (!was_lazy and this.reader.flags.pollable) {
            this.reader.read();
        }
    }

    return .{ .ready = {} };
}

pub fn parent(this: *@This()) *Source {
    return @fieldParentPtr("context", this);
}

pub fn onCancel(this: *FileReader) void {
    if (this.done) return;
    this.done = true;
    this.reader.updateRef(false);
    if (!this.reader.isDone())
        this.reader.close();
}

pub fn deinit(this: *FileReader) void {
    this.buffered.deinit(bun.default_allocator);
    this.reader.updateRef(false);
    this.reader.deinit();
    this.pending_value.deinit();

    if (this.lazy != .none) {
        this.lazy.blob.deref();
        this.lazy = .none;
    }

    this.parent().deinit();
}

pub fn onReadChunk(this: *@This(), init_buf: []const u8, state: bun.io.ReadState) bool {
    var buf = init_buf;
    log("onReadChunk() = {d} ({s}) - read_inside_on_pull: {s}", .{ buf.len, @tagName(state), @tagName(this.read_inside_on_pull) });

    if (this.done) {
        this.reader.close();
        return false;
    }
    var close = false;
    defer if (close) this.reader.close();
    var hasMore = state != .eof;

    if (buf.len > 0) {
        if (this.max_size) |max_size| {
            if (this.total_readed >= max_size) return false;
            const len = @min(max_size - this.total_readed, buf.len);
            if (buf.len > len) {
                buf = buf[0..len];
            }
            this.total_readed += len;

            if (buf.len == 0) {
                close = true;
                hasMore = false;
            }
        }
    }

    const reader_buffer = this.reader.buffer();
    if (this.read_inside_on_pull != .none) {
        switch (this.read_inside_on_pull) {
            .js => |in_progress| {
                if (in_progress.len >= buf.len and !hasMore) {
                    @memcpy(in_progress[0..buf.len], buf);
                    this.read_inside_on_pull = .{ .js = in_progress[buf.len..] };
                } else if (in_progress.len > 0 and !hasMore) {
                    this.read_inside_on_pull = .{ .temporary = buf };
                } else if (hasMore and !bun.isSliceInBuffer(buf, this.buffered.allocatedSlice())) {
                    bun.handleOom(this.buffered.appendSlice(bun.default_allocator, buf));
                    this.read_inside_on_pull = .{ .use_buffered = buf.len };
                }
            },
            .use_buffered => |original| {
                bun.handleOom(this.buffered.appendSlice(bun.default_allocator, buf));
                this.read_inside_on_pull = .{ .use_buffered = buf.len + original };
            },
            .none => unreachable,
            else => @panic("Invalid state"),
        }
    } else if (this.pending.state == .pending) {
        // Certain readers (such as pipes) may return 0-byte reads even when
        // not at EOF. Consequently, we need to check whether the reader is
        // actually done or not.
        if (buf.len == 0 and state == .drained) {
            // If the reader is not done, we still want to keep reading.
            return true;
        }

        defer {
            this.pending_value.clearWithoutDeallocation();
            this.pending_view = &.{};
            this.pending.run();
        }

        if (buf.len == 0) {
            if (this.buffered.items.len == 0) {
                this.buffered.clearAndFree(bun.default_allocator);
                this.buffered = reader_buffer.moveToUnmanaged();
            }

            var buffer = &this.buffered;
            defer buffer.clearAndFree(bun.default_allocator);
            if (buffer.items.len > 0) {
                if (this.pending_view.len >= buffer.items.len) {
                    @memcpy(this.pending_view[0..buffer.items.len], buffer.items);
                    this.pending.result = .{ .into_array_and_done = .{ .value = this.pending_value.get() orelse .zero, .len = @truncate(buffer.items.len) } };
                } else {
                    this.pending.result = .{ .owned_and_done = bun.ByteList.moveFromList(buffer) };
                }
            } else {
                this.pending.result = .{ .done = {} };
            }
            return false;
        }

        const was_done = this.reader.isDone();

        if (this.pending_view.len >= buf.len) {
            @memcpy(this.pending_view[0..buf.len], buf);
            reader_buffer.clearRetainingCapacity();
            this.buffered.clearRetainingCapacity();

            const into_array: streams.Result.IntoArray = .{
                .value = this.pending_value.get() orelse .zero,
                .len = @truncate(buf.len),
            };

            this.pending.result = if (was_done)
                .{ .into_array_and_done = into_array }
            else
                .{ .into_array = into_array };
            return !was_done;
        }

        if (bun.isSliceInBuffer(buf, reader_buffer.allocatedSlice())) {
            if (this.reader.isDone()) {
                bun.assert_eql(buf.ptr, reader_buffer.items.ptr);
                var buffer = reader_buffer.moveToUnmanaged();
                buffer.shrinkRetainingCapacity(buf.len);
                this.pending.result = .{ .owned_and_done = .moveFromList(&buffer) };
            } else {
                reader_buffer.clearRetainingCapacity();
                this.pending.result = .{ .temporary = .fromBorrowedSliceDangerous(buf) };
            }
            return !was_done;
        }

        if (!bun.isSliceInBuffer(buf, this.buffered.allocatedSlice())) {
            this.pending.result = if (this.reader.isDone())
                .{ .temporary_and_done = .fromBorrowedSliceDangerous(buf) }
            else
                .{ .temporary = .fromBorrowedSliceDangerous(buf) };
            return !was_done;
        }

        bun.assert_eql(buf.ptr, this.buffered.items.ptr);
        var buffered = this.buffered;
        this.buffered = .{};
        buffered.shrinkRetainingCapacity(buf.len);

        this.pending.result = if (this.reader.isDone())
            .{ .owned_and_done = .moveFromList(&buffered) }
        else
            .{ .owned = .moveFromList(&buffered) };
        return !was_done;
    } else if (!bun.isSliceInBuffer(buf, this.buffered.allocatedSlice())) {
        bun.handleOom(this.buffered.appendSlice(bun.default_allocator, buf));
        if (bun.isSliceInBuffer(buf, reader_buffer.allocatedSlice())) {
            reader_buffer.clearRetainingCapacity();
        }
    }

    // For pipes, we have to keep pulling or the other process will block.
    return this.read_inside_on_pull != .temporary and
        !(this.buffered.items.len + reader_buffer.items.len >= this.highwater_mark and
            !this.reader.flags.pollable);
}

fn isPulling(this: *const FileReader) bool {
    return this.read_inside_on_pull != .none;
}

pub fn onPull(this: *FileReader, buffer: []u8, array: jsc.JSValue) streams.Result {
    array.ensureStillAlive();
    defer array.ensureStillAlive();
    const drained = this.drain();

    if (drained.len > 0) {
        log("onPull({d}) = {d}", .{ buffer.len, drained.len });

        this.pending_value.clearWithoutDeallocation();
        this.pending_view = &.{};

        if (buffer.len >= @as(usize, drained.len)) {
            @memcpy(buffer[0..drained.len], drained.slice());
            this.buffered.clearAndFree(bun.default_allocator);

            if (this.reader.isDone()) {
                return .{ .into_array_and_done = .{ .value = array, .len = drained.len } };
            } else {
                return .{ .into_array = .{ .value = array, .len = drained.len } };
            }
        }

        if (this.reader.isDone()) {
            return .{ .owned_and_done = drained };
        } else {
            return .{ .owned = drained };
        }
    }

    if (this.reader.isDone()) {
        return .{ .done = {} };
    }

    if (!this.reader.hasPendingRead()) {
        // If not flowing (paused), don't initiate new reads
        if (!this.flowing) {
            log("onPull({d}) = pending (not flowing)", .{buffer.len});
            this.pending_value.set(this.parent().globalThis, array);
            this.pending_view = buffer;
            return .{ .pending = &this.pending };
        }

        this.read_inside_on_pull = .{ .js = buffer };
        this.reader.read();

        defer this.read_inside_on_pull = .{ .none = {} };
        switch (this.read_inside_on_pull) {
            .js => |remaining_buf| {
                const amount_read = buffer.len - remaining_buf.len;

                log("onPull({d}) = {d}", .{ buffer.len, amount_read });

                if (amount_read > 0) {
                    if (this.reader.isDone()) {
                        return .{ .into_array_and_done = .{ .value = array, .len = @truncate(amount_read) } };
                    }

                    return .{ .into_array = .{ .value = array, .len = @truncate(amount_read) } };
                }

                if (this.reader.isDone()) {
                    return .{ .done = {} };
                }
            },
            .temporary => |buf| {
                log("onPull({d}) = {d}", .{ buffer.len, buf.len });
                if (this.reader.isDone()) {
                    return .{ .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(buf) };
                }

                return .{ .temporary = bun.ByteList.fromBorrowedSliceDangerous(buf) };
            },
            .use_buffered => {
                log("onPull({d}) = {d}", .{ buffer.len, this.buffered.items.len });
                if (this.reader.isDone()) {
                    return .{ .owned_and_done = bun.ByteList.moveFromList(&this.buffered) };
                }
                return .{ .owned = bun.ByteList.moveFromList(&this.buffered) };
            },
            else => {},
        }

        if (this.reader.isDone()) {
            log("onPull({d}) = done", .{buffer.len});

            return .{ .done = {} };
        }
    }

    this.pending_value.set(this.parent().globalThis, array);
    this.pending_view = buffer;

    log("onPull({d}) = pending", .{buffer.len});

    return .{ .pending = &this.pending };
}

pub fn drain(this: *FileReader) bun.ByteList {
    if (this.buffered.items.len > 0) {
        const out = bun.ByteList.moveFromList(&this.buffered);
        if (comptime Environment.allow_assert) {
            bun.assert(this.reader.buffer().items.ptr != out.ptr);
        }
        return out;
    }

    if (this.reader.hasPendingRead()) {
        return .{};
    }

    return bun.ByteList.moveFromList(this.reader.buffer());
}

pub fn setRefOrUnref(this: *FileReader, enable: bool) void {
    if (this.done) return;
    this.reader.updateRef(enable);
}

fn consumeReaderBuffer(this: *FileReader) void {
    if (this.buffered.capacity == 0) {
        this.buffered = this.reader.buffer().moveToUnmanaged();
    }
}

pub fn onReaderDone(this: *FileReader) void {
    log("onReaderDone()", .{});
    if (!this.isPulling()) {
        this.consumeReaderBuffer();
        if (this.pending.state == .pending) {
            if (this.buffered.items.len > 0) {
                this.pending.result = .{ .owned_and_done = bun.ByteList.moveFromList(&this.buffered) };
            } else {
                this.pending.result = .{ .done = {} };
            }
            this.buffered = .{};
            this.pending.run();
        }
        // Don't handle buffered data here - it will be returned on the next onPull
        // This ensures proper ordering of chunks
    }

    // Only close the stream if there's no buffered data left to deliver
    if (this.buffered.items.len == 0) {
        this.parent().onClose();
    }
    if (this.waiting_for_onReaderDone) {
        this.waiting_for_onReaderDone = false;
        _ = this.parent().decrementCount();
    }
}

pub fn onReaderError(this: *FileReader, err: bun.sys.Error) void {
    this.consumeReaderBuffer();
    if (this.buffered.capacity > 0 and this.buffered.items.len == 0) {
        this.buffered.deinit(bun.default_allocator);
        this.buffered = .{};
    }

    this.pending.result = .{ .err = .{ .Error = err } };
    this.pending.run();
}

pub fn setRawMode(this: *FileReader, flag: bool) bun.sys.Maybe(void) {
    if (!Environment.isWindows) {
        @panic("FileReader.setRawMode must not be called on " ++ comptime Environment.os.displayString());
    }
    return this.reader.setRawMode(flag);
}

pub fn setFlowing(this: *FileReader, flag: bool) void {
    log("setFlowing({}) was={}", .{ flag, this.flowing });

    if (this.flowing == flag) {
        return;
    }

    this.flowing = flag;

    if (flag) {
        this.reader.unpause();
        if (!this.reader.isDone() and !this.reader.hasPendingRead()) {
            // Kick off a new read if needed
            this.reader.read();
        }
    } else {
        this.reader.pause();
    }
}

pub fn memoryCost(this: *const FileReader) usize {
    // ReadableStreamSource covers @sizeOf(FileReader)
    return this.reader.memoryCost() + this.buffered.capacity;
}

pub const Source = ReadableStream.NewSource(
    @This(),
    "File",
    onStart,
    onPull,
    onCancel,
    deinit,
    setRefOrUnref,
    drain,
    memoryCost,
    null,
);

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const jsc = bun.jsc;

const webcore = bun.webcore;
const Blob = webcore.Blob;
const ReadableStream = webcore.ReadableStream;
const streams = webcore.streams;
