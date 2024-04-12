const bun = @import("root").bun;
const std = @import("std");
const Async = bun.Async;
const JSC = bun.JSC;
const uv = bun.windows.libuv;
const Source = @import("./source.zig").Source;

const log = bun.Output.scoped(.PipeWriter, true);
const FileType = @import("./pipes.zig").FileType;

pub const WriteResult = union(enum) {
    done: usize,
    wrote: usize,
    pending: usize,
    err: bun.sys.Error,
};

pub const WriteStatus = enum {
    end_of_file,
    drained,
    pending,
};

pub fn PosixPipeWriter(
    comptime This: type,
    // Originally this was the comptime vtable struct like the below
    // But that caused a Zig compiler segfault as of 0.12.0-dev.1604+caae40c21
    comptime getFd: fn (*This) bun.FileDescriptor,
    comptime getBuffer: fn (*This) []const u8,
    comptime onWrite: fn (*This, written: usize, status: WriteStatus) void,
    comptime registerPoll: ?fn (*This) void,
    comptime onError: fn (*This, bun.sys.Error) void,
    comptime onWritable: fn (*This) void,
    comptime getFileType: *const fn (*This) FileType,
) type {
    _ = onWritable; // autofix
    return struct {
        pub fn _tryWrite(this: *This, buf_: []const u8) WriteResult {
            return switch (getFileType(this)) {
                inline else => |ft| return _tryWriteWithWriteFn(this, buf_, comptime writeToFileType(ft)),
            };
        }

        fn _tryWriteWithWriteFn(this: *This, buf_: []const u8, comptime write_fn: *const fn (bun.FileDescriptor, []const u8) JSC.Maybe(usize)) WriteResult {
            const fd = getFd(this);
            var buf = buf_;

            while (buf.len > 0) {
                switch (write_fn(fd, buf)) {
                    .err => |err| {
                        if (err.isRetry()) {
                            return .{ .pending = buf_.len - buf.len };
                        }

                        if (err.getErrno() == .PIPE) {
                            return .{ .done = buf_.len - buf.len };
                        }

                        return .{ .err = err };
                    },

                    .result => |wrote| {
                        if (wrote == 0) {
                            return .{ .done = buf_.len - buf.len };
                        }

                        buf = buf[wrote..];
                    },
                }
            }

            return .{ .wrote = buf_.len - buf.len };
        }

        fn writeToFileType(comptime file_type: FileType) *const (fn (bun.FileDescriptor, []const u8) JSC.Maybe(usize)) {
            comptime return switch (file_type) {
                .nonblocking_pipe, .file => &bun.sys.write,
                .pipe => &writeToBlockingPipe,
                .socket => &bun.sys.sendNonBlock,
            };
        }

        fn writeToBlockingPipe(fd: bun.FileDescriptor, buf: []const u8) JSC.Maybe(usize) {
            if (comptime bun.Environment.isLinux) {
                if (bun.C.linux.RWFFlagSupport.isMaybeSupported()) {
                    return bun.sys.writeNonblocking(fd, buf);
                }
            }

            switch (bun.isWritable(fd)) {
                .ready, .hup => return bun.sys.write(fd, buf),
                .not_ready => return JSC.Maybe(usize){ .err = bun.sys.Error.retry },
            }
        }

        pub fn onPoll(parent: *This, size_hint: isize, received_hup: bool) void {
            const buffer = getBuffer(parent);
            log("onPoll({})", .{buffer.len});
            if (buffer.len == 0 and !received_hup) {
                log("PosixPipeWriter(0x{x}) handle={s}", .{ @intFromPtr(parent), @tagName(parent.handle) });
                if (parent.handle == .poll) {
                    log("PosixPipeWriter(0x{x}) got 0, registered state = {any}", .{ @intFromPtr(parent), parent.handle.poll.isRegistered() });
                }
                return;
            }

            switch (drainBufferedData(
                parent,
                buffer,
                if (size_hint > 0 and getFileType(parent).isBlocking()) @intCast(size_hint) else std.math.maxInt(usize),
                received_hup,
            )) {
                .pending => |wrote| {
                    if (wrote > 0)
                        onWrite(parent, wrote, .pending);

                    if (comptime registerPoll) |register| {
                        register(parent);
                    }
                },
                .wrote => |amt| {
                    onWrite(parent, amt, .drained);
                    if (@hasDecl(This, "auto_poll")) {
                        if (!This.auto_poll) return;
                    }
                    if (getBuffer(parent).len > 0) {
                        if (comptime registerPoll) |register| {
                            register(parent);
                        }
                    }
                },
                .err => |err| {
                    onError(parent, err);
                },
                .done => |amt| {
                    onWrite(parent, amt, .end_of_file);
                },
            }
        }

        pub fn drainBufferedData(parent: *This, input_buffer: []const u8, max_write_size: usize, received_hup: bool) WriteResult {
            _ = received_hup; // autofix
            var buf = input_buffer;
            buf = if (max_write_size < buf.len and max_write_size > 0) buf[0..max_write_size] else buf;
            const original_buf = buf;

            while (buf.len > 0) {
                const attempt = _tryWrite(parent, buf);
                switch (attempt) {
                    .pending => |pending| {
                        return .{ .pending = pending + (original_buf.len - buf.len) };
                    },
                    .wrote => |amt| {
                        buf = buf[amt..];
                    },
                    .err => |err| {
                        const wrote = original_buf.len - buf.len;
                        if (err.isRetry()) {
                            return .{ .pending = wrote };
                        }

                        if (wrote > 0) {
                            onError(parent, err);
                            return .{ .wrote = wrote };
                        } else {
                            return .{ .err = err };
                        }
                    },
                    .done => |amt| {
                        buf = buf[amt..];
                        const wrote = original_buf.len - buf.len;

                        return .{ .done = wrote };
                    },
                }
            }

            const wrote = original_buf.len - buf.len;
            return .{ .wrote = wrote };
        }
    };
}

const PollOrFd = @import("./pipes.zig").PollOrFd;

pub fn PosixBufferedWriter(
    comptime Parent: type,
    comptime onWrite: *const fn (*Parent, amount: usize, status: WriteStatus) void,
    comptime onError: *const fn (*Parent, bun.sys.Error) void,
    comptime onClose: ?*const fn (*Parent) void,
    comptime getBuffer: *const fn (*Parent) []const u8,
    comptime onWritable: ?*const fn (*Parent) void,
) type {
    return struct {
        handle: PollOrFd = .{ .closed = {} },
        parent: *Parent = undefined,
        is_done: bool = false,
        pollable: bool = false,
        closed_without_reporting: bool = false,
        close_fd: bool = true,

        const PosixWriter = @This();

        pub const auto_poll = if (@hasDecl(Parent, "auto_poll")) Parent.auto_poll else true;

        pub fn createPoll(this: *@This(), fd: bun.FileDescriptor) *Async.FilePoll {
            return Async.FilePoll.init(@as(*Parent, @ptrCast(this.parent)).eventLoop(), fd, .{}, PosixWriter, this);
        }

        pub fn getPoll(this: *const @This()) ?*Async.FilePoll {
            return this.handle.getPoll();
        }

        pub fn getFileType(this: *const @This()) FileType {
            const poll = getPoll(this) orelse return FileType.file;

            return poll.fileType();
        }

        pub fn getFd(this: *const PosixWriter) bun.FileDescriptor {
            return this.handle.getFd();
        }

        fn _onError(
            this: *PosixWriter,
            err: bun.sys.Error,
        ) void {
            bun.assert(!err.isRetry());

            onError(this.parent, err);

            this.close();
        }

        fn _onWrite(
            this: *PosixWriter,
            written: usize,
            status: WriteStatus,
        ) void {
            const was_done = this.is_done == true;
            const parent = this.parent;

            if (status == .end_of_file and !was_done) {
                this.closeWithoutReporting();
            }

            onWrite(parent, written, status);
            if (status == .end_of_file and !was_done) {
                this.close();
            }
        }

        fn _onWritable(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            if (onWritable) |cb| {
                cb(this.parent);
            }
        }

        pub fn registerPoll(this: *PosixWriter) void {
            var poll = this.getPoll() orelse return;
            switch (poll.registerWithFd(bun.uws.Loop.get(), .writable, .dispatch, poll.fd)) {
                .err => |err| {
                    onError(this.parent, err);
                },
                .result => {},
            }
        }

        pub const tryWrite = @This()._tryWrite;

        pub fn hasRef(this: *PosixWriter) bool {
            if (this.is_done) {
                return false;
            }

            const poll = this.getPoll() orelse return false;
            return poll.canEnableKeepingProcessAlive();
        }

        pub fn enableKeepingProcessAlive(this: *PosixWriter, event_loop: anytype) void {
            this.updateRef(event_loop, true);
        }

        pub fn disableKeepingProcessAlive(this: *PosixWriter, event_loop: anytype) void {
            this.updateRef(event_loop, false);
        }

        fn getBufferInternal(this: *PosixWriter) []const u8 {
            return getBuffer(this.parent);
        }

        pub usingnamespace PosixPipeWriter(@This(), getFd, getBufferInternal, _onWrite, registerPoll, _onError, _onWritable, getFileType);

        pub fn end(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            this.close();
        }

        fn closeWithoutReporting(this: *PosixWriter) void {
            if (this.getFd() != bun.invalid_fd) {
                bun.assert(!this.closed_without_reporting);
                this.closed_without_reporting = true;
                if (this.close_fd) this.handle.close(null, {});
            }
        }

        pub fn close(this: *PosixWriter) void {
            if (onClose) |closer| {
                if (this.closed_without_reporting) {
                    this.closed_without_reporting = false;
                    closer(this.parent);
                } else {
                    this.handle.closeImpl(this.parent, closer, this.close_fd);
                }
            }
        }

        pub fn updateRef(this: *const PosixWriter, event_loop: anytype, value: bool) void {
            const poll = this.getPoll() orelse return;
            poll.setKeepingProcessAlive(event_loop, value);
        }

        pub fn setParent(this: *PosixWriter, parent: *Parent) void {
            this.parent = parent;
            this.handle.setOwner(this);
        }

        pub fn write(this: *PosixWriter) void {
            this.onPoll(0, false);
        }

        pub fn watch(this: *PosixWriter) void {
            if (this.pollable) {
                if (this.handle == .fd) {
                    this.handle = .{ .poll = this.createPoll(this.getFd()) };
                }

                this.registerPoll();
            }
        }

        pub fn start(this: *PosixWriter, fd: bun.FileDescriptor, pollable: bool) JSC.Maybe(void) {
            this.pollable = pollable;
            if (!pollable) {
                bun.assert(this.handle != .poll);
                this.handle = .{ .fd = fd };
                return JSC.Maybe(void){ .result = {} };
            }
            var poll = this.getPoll() orelse brk: {
                this.handle = .{ .poll = this.createPoll(fd) };
                break :brk this.handle.poll;
            };
            const loop = @as(*Parent, @ptrCast(this.parent)).eventLoop().loop();

            switch (poll.registerWithFd(loop, .writable, .dispatch, fd)) {
                .err => |err| {
                    return JSC.Maybe(void){ .err = err };
                },
                .result => {
                    this.enableKeepingProcessAlive(@as(*Parent, @ptrCast(this.parent)).eventLoop());
                },
            }

            return JSC.Maybe(void){ .result = {} };
        }
    };
}

pub fn PosixStreamingWriter(
    comptime Parent: type,
    comptime onWrite: fn (*Parent, amount: usize, status: WriteStatus) void,
    comptime onError: fn (*Parent, bun.sys.Error) void,
    comptime onReady: ?fn (*Parent) void,
    comptime onClose: fn (*Parent) void,
) type {
    return struct {
        // TODO: replace buffer + head for StreamBuffer
        buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
        handle: PollOrFd = .{ .closed = {} },
        parent: *Parent = undefined,
        head: usize = 0,
        is_done: bool = false,
        closed_without_reporting: bool = false,

        // TODO:
        chunk_size: usize = 0,

        pub fn getPoll(this: *@This()) ?*Async.FilePoll {
            return this.handle.getPoll();
        }

        pub fn getFd(this: *PosixWriter) bun.FileDescriptor {
            return this.handle.getFd();
        }

        pub fn getFileType(this: *PosixWriter) FileType {
            const poll = this.getPoll() orelse return FileType.file;

            return poll.fileType();
        }

        const PosixWriter = @This();

        pub fn getBuffer(this: *PosixWriter) []const u8 {
            return this.buffer.items[this.head..];
        }

        fn _onError(
            this: *PosixWriter,
            err: bun.sys.Error,
        ) void {
            bun.assert(!err.isRetry());

            this.closeWithoutReporting();
            this.is_done = true;

            onError(@alignCast(@ptrCast(this.parent)), err);
            this.close();
        }

        fn _onWrite(
            this: *PosixWriter,
            written: usize,
            status: WriteStatus,
        ) void {
            this.head += written;

            if (status == .end_of_file and !this.is_done) {
                this.closeWithoutReporting();
            }

            if (this.buffer.items.len == this.head) {
                if (this.buffer.capacity > 1024 * 1024 and status != .end_of_file) {
                    this.buffer.clearAndFree();
                } else {
                    this.buffer.clearRetainingCapacity();
                }
                this.head = 0;
            }

            onWrite(@ptrCast(this.parent), written, status);
        }

        pub fn setParent(this: *PosixWriter, parent: *Parent) void {
            this.parent = parent;
            this.handle.setOwner(this);
        }

        fn _onWritable(this: *PosixWriter) void {
            if (this.is_done or this.closed_without_reporting) {
                return;
            }

            this.head = 0;
            if (onReady) |cb| {
                cb(@ptrCast(this.parent));
            }
        }

        pub fn hasPendingData(this: *const PosixWriter) bool {
            return this.buffer.items.len > 0;
        }

        fn closeWithoutReporting(this: *PosixWriter) void {
            if (this.getFd() != bun.invalid_fd) {
                bun.assert(!this.closed_without_reporting);
                this.closed_without_reporting = true;
                this.handle.close(null, {});
            }
        }

        fn registerPoll(this: *PosixWriter) void {
            const poll = this.getPoll() orelse return;
            switch (poll.registerWithFd(@as(*Parent, @ptrCast(this.parent)).loop(), .writable, .dispatch, poll.fd)) {
                .err => |err| {
                    onError(this.parent, err);
                    this.close();
                },
                .result => {},
            }
        }

        pub fn tryWrite(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            if (this.buffer.items.len > 0) {
                this.buffer.appendSlice(buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };

                return .{ .pending = 0 };
            }

            return @This()._tryWrite(this, buf);
        }

        pub fn writeUTF16(this: *PosixWriter, buf: []const u16) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            const had_buffered_data = this.buffer.items.len > 0;
            {
                var byte_list = bun.ByteList.fromList(this.buffer);
                defer this.buffer = byte_list.listManaged(bun.default_allocator);

                _ = byte_list.writeUTF16(bun.default_allocator, buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };
            }

            if (had_buffered_data) {
                return .{ .pending = 0 };
            }

            return this._tryWriteNewlyBufferedData();
        }

        pub fn writeLatin1(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            if (bun.strings.isAllASCII(buf)) {
                return this.write(buf);
            }

            const had_buffered_data = this.buffer.items.len > 0;
            {
                var byte_list = bun.ByteList.fromList(this.buffer);
                defer this.buffer = byte_list.listManaged(bun.default_allocator);

                _ = byte_list.writeLatin1(bun.default_allocator, buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };
            }

            if (had_buffered_data) {
                return .{ .pending = 0 };
            }

            return this._tryWriteNewlyBufferedData();
        }

        fn _tryWriteNewlyBufferedData(this: *PosixWriter) WriteResult {
            bun.assert(!this.is_done);

            switch (@This()._tryWrite(this, this.buffer.items)) {
                .wrote => |amt| {
                    if (amt == this.buffer.items.len) {
                        this.buffer.clearRetainingCapacity();
                    } else {
                        this.head = amt;
                    }
                    return .{ .wrote = amt };
                },
                .done => |amt| {
                    this.buffer.clearRetainingCapacity();

                    return .{ .done = amt };
                },
                else => |r| return r,
            }
        }

        pub fn write(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            if (this.buffer.items.len + buf.len < this.chunk_size) {
                this.buffer.appendSlice(buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };

                return .{ .pending = 0 };
            }

            const rc = @This()._tryWrite(this, buf);
            this.head = 0;
            switch (rc) {
                .pending => |amt| {
                    this.buffer.appendSlice(buf[amt..]) catch {
                        return .{ .err = bun.sys.Error.oom };
                    };

                    onWrite(this.parent, amt, .pending);

                    registerPoll(this);
                },
                .wrote => |amt| {
                    if (amt < buf.len) {
                        this.buffer.appendSlice(buf[amt..]) catch {
                            return .{ .err = bun.sys.Error.oom };
                        };
                        onWrite(this.parent, amt, .pending);
                    } else {
                        this.buffer.clearRetainingCapacity();
                        onWrite(this.parent, amt, .drained);
                    }
                },
                .done => |amt| {
                    this.buffer.clearRetainingCapacity();
                    onWrite(this.parent, amt, .end_of_file);
                    return .{ .done = amt };
                },
                else => {},
            }

            return rc;
        }

        pub usingnamespace PosixPipeWriter(@This(), getFd, getBuffer, _onWrite, registerPoll, _onError, _onWritable, getFileType);

        pub fn flush(this: *PosixWriter) WriteResult {
            if (this.closed_without_reporting or this.is_done) {
                return .{ .done = 0 };
            }

            const buffer = this.buffer.items;
            if (buffer.len == 0) {
                return .{ .wrote = 0 };
            }

            const rc = this.drainBufferedData(buffer, std.math.maxInt(usize), brk: {
                if (this.getPoll()) |poll| {
                    break :brk poll.flags.contains(.hup);
                }

                break :brk false;
            });
            // update head
            switch (rc) {
                .pending => |written| {
                    this.head += written;
                },
                .wrote => |written| {
                    this.head += written;
                },
                .done => |written| {
                    this.head += written;
                },
                else => {},
            }
            return rc;
        }

        pub fn deinit(this: *PosixWriter) void {
            this.buffer.clearAndFree();
            this.closeWithoutReporting();
        }

        pub fn hasRef(this: *PosixWriter) bool {
            const poll = this.getPoll() orelse return false;
            return !this.is_done and poll.canEnableKeepingProcessAlive();
        }

        pub fn enableKeepingProcessAlive(this: *PosixWriter, event_loop: JSC.EventLoopHandle) void {
            if (this.is_done) return;
            const poll = this.getPoll() orelse return;

            poll.enableKeepingProcessAlive(event_loop);
        }

        pub fn disableKeepingProcessAlive(this: *PosixWriter, event_loop: JSC.EventLoopHandle) void {
            const poll = this.getPoll() orelse return;
            poll.disableKeepingProcessAlive(event_loop);
        }

        pub fn updateRef(this: *PosixWriter, event_loop: JSC.EventLoopHandle, value: bool) void {
            if (value) {
                this.enableKeepingProcessAlive(event_loop);
            } else {
                this.disableKeepingProcessAlive(event_loop);
            }
        }

        pub fn end(this: *PosixWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            this.close();
        }

        pub fn close(this: *PosixWriter) void {
            if (this.closed_without_reporting) {
                this.closed_without_reporting = false;
                bun.assert(this.getFd() == bun.invalid_fd);
                onClose(@ptrCast(this.parent));
                return;
            }

            this.handle.close(@ptrCast(this.parent), onClose);
        }

        pub fn start(this: *PosixWriter, fd: bun.FileDescriptor, is_pollable: bool) JSC.Maybe(void) {
            if (!is_pollable) {
                this.close();
                this.handle = .{ .fd = fd };
                return JSC.Maybe(void){ .result = {} };
            }

            const loop = @as(*Parent, @ptrCast(this.parent)).eventLoop();
            var poll = this.getPoll() orelse brk: {
                this.handle = .{ .poll = Async.FilePoll.init(loop, fd, .{}, PosixWriter, this) };
                break :brk this.handle.poll;
            };

            switch (poll.registerWithFd(loop.loop(), .writable, .dispatch, fd)) {
                .err => |err| {
                    return JSC.Maybe(void){ .err = err };
                },
                .result => {},
            }

            return JSC.Maybe(void){ .result = {} };
        }
    };
}

/// Will provide base behavior for pipe writers
/// The WindowsPipeWriter type should implement the following interface:
/// struct {
///   source: ?Source = null,
///   parent: *Parent = undefined,
///   is_done: bool = false,
///   pub fn startWithCurrentPipe(this: *WindowsPipeWriter) bun.JSC.Maybe(void),
///   fn onClosePipe(pipe: *uv.Pipe) callconv(.C) void,
/// };
fn BaseWindowsPipeWriter(
    comptime WindowsPipeWriter: type,
    comptime Parent: type,
) type {
    return struct {
        pub fn getFd(this: *const WindowsPipeWriter) bun.FileDescriptor {
            const pipe = this.source orelse return bun.invalid_fd;
            return pipe.getFd();
        }

        pub fn hasRef(this: *const WindowsPipeWriter) bool {
            if (this.is_done) {
                return false;
            }
            if (this.source) |pipe| return pipe.hasRef();
            return false;
        }

        pub fn enableKeepingProcessAlive(this: *WindowsPipeWriter, event_loop: anytype) void {
            this.updateRef(event_loop, true);
        }

        pub fn disableKeepingProcessAlive(this: *WindowsPipeWriter, event_loop: anytype) void {
            this.updateRef(event_loop, false);
        }

        fn onFileClose(handle: *uv.fs_t) callconv(.C) void {
            const file = bun.cast(*Source.File, handle.data);
            handle.deinit();
            bun.default_allocator.destroy(file);
        }

        fn onPipeClose(handle: *uv.Pipe) callconv(.C) void {
            const this = bun.cast(*uv.Pipe, handle.data);
            bun.default_allocator.destroy(this);
        }

        fn onTTYClose(handle: *uv.uv_tty_t) callconv(.C) void {
            const this = bun.cast(*uv.uv_tty_t, handle.data);
            bun.default_allocator.destroy(this);
        }

        pub fn close(this: *WindowsPipeWriter) void {
            this.is_done = true;
            if (this.source) |source| {
                switch (source) {
                    .sync_file, .file => |file| {
                        // always cancel the current one
                        file.fs.cancel();
                        // always use close_fs here because we can have a operation in progress
                        file.close_fs.data = file;
                        _ = uv.uv_fs_close(uv.Loop.get(), &file.close_fs, file.file, onFileClose);
                    },
                    .pipe => |pipe| {
                        pipe.data = pipe;
                        pipe.close(onPipeClose);
                    },
                    .tty => |tty| {
                        tty.data = tty;
                        tty.close(onTTYClose);
                    },
                }
                this.source = null;
                this.onCloseSource();
            }
        }

        pub fn updateRef(this: *WindowsPipeWriter, _: anytype, value: bool) void {
            if (this.source) |pipe| {
                if (value) {
                    pipe.ref();
                } else {
                    pipe.unref();
                }
            }
        }

        pub fn setParent(this: *WindowsPipeWriter, parent: *Parent) void {
            this.parent = parent;
            if (!this.is_done) {
                if (this.source) |pipe| {
                    pipe.setData(this);
                }
            }
        }

        pub fn watch(_: *WindowsPipeWriter) void {
            // no-op
        }

        pub fn startWithPipe(this: *WindowsPipeWriter, pipe: *uv.Pipe) bun.JSC.Maybe(void) {
            bun.assert(this.source == null);
            this.source = .{ .pipe = pipe };
            this.setParent(this.parent);
            return this.startWithCurrentPipe();
        }

        pub fn startSync(this: *WindowsPipeWriter, fd: bun.FileDescriptor, _: bool) bun.JSC.Maybe(void) {
            bun.assert(this.source == null);
            const source = Source{
                .sync_file = Source.openFile(fd),
            };
            source.setData(this);
            this.source = source;
            this.setParent(this.parent);
            return this.startWithCurrentPipe();
        }

        pub fn startWithFile(this: *WindowsPipeWriter, fd: bun.FileDescriptor) bun.JSC.Maybe(void) {
            bun.assert(this.source == null);
            const source: bun.io.Source = .{ .file = Source.openFile(fd) };
            source.setData(this);
            this.source = source;
            this.setParent(this.parent);
            return this.startWithCurrentPipe();
        }

        pub fn start(this: *WindowsPipeWriter, fd: bun.FileDescriptor, _: bool) bun.JSC.Maybe(void) {
            bun.assert(this.source == null);
            const source = switch (Source.open(uv.Loop.get(), fd)) {
                .result => |source| source,
                .err => |err| return .{ .err = err },
            };
            source.setData(this);
            this.source = source;
            this.setParent(this.parent);
            return this.startWithCurrentPipe();
        }

        pub fn setPipe(this: *WindowsPipeWriter, pipe: *uv.Pipe) void {
            this.source = .{ .pipe = pipe };
            this.setParent(this.parent);
        }

        pub fn getStream(this: *const WindowsPipeWriter) ?*uv.uv_stream_t {
            const source = this.source orelse return null;
            if (source == .file) return null;
            return source.toStream();
        }
    };
}

pub fn WindowsBufferedWriter(
    comptime Parent: type,
    comptime onWrite: *const fn (*Parent, amount: usize, status: WriteStatus) void,
    comptime onError: *const fn (*Parent, bun.sys.Error) void,
    comptime onClose: ?*const fn (*Parent) void,
    comptime getBuffer: *const fn (*Parent) []const u8,
    comptime onWritable: ?*const fn (*Parent) void,
) type {
    return struct {
        source: ?Source = null,
        parent: *Parent = undefined,
        is_done: bool = false,
        // we use only one write_req, any queued data in outgoing will be flushed after this ends
        write_req: uv.uv_write_t = std.mem.zeroes(uv.uv_write_t),
        write_buffer: uv.uv_buf_t = uv.uv_buf_t.init(""),
        pending_payload_size: usize = 0,

        const WindowsWriter = @This();

        pub usingnamespace BaseWindowsPipeWriter(WindowsWriter, Parent);

        fn onCloseSource(this: *WindowsWriter) void {
            if (onClose) |onCloseFn| {
                onCloseFn(this.parent);
            }
        }

        pub fn startWithCurrentPipe(this: *WindowsWriter) bun.JSC.Maybe(void) {
            bun.assert(this.source != null);
            this.is_done = false;
            this.write();
            return .{ .result = {} };
        }

        fn onWriteComplete(this: *WindowsWriter, status: uv.ReturnCode) void {
            const written = this.pending_payload_size;
            this.pending_payload_size = 0;
            if (status.toError(.write)) |err| {
                this.close();
                onError(this.parent, err);
                return;
            }
            const pending = this.getBufferInternal();
            const has_pending_data = (pending.len - written) == 0;
            onWrite(this.parent, @intCast(written), if (this.is_done and !has_pending_data) .drained else .pending);
            // is_done can be changed inside onWrite
            if (this.is_done and !has_pending_data) {
                // already done and end was called
                this.close();
                return;
            }

            if (onWritable) |onWritableFn| {
                onWritableFn(this.parent);
            }
        }

        fn onFsWriteComplete(fs: *uv.fs_t) callconv(.C) void {
            const result = fs.result;
            if (result.int() == uv.UV_ECANCELED) {
                fs.deinit();
                return;
            }
            const this = bun.cast(*WindowsWriter, fs.data);

            fs.deinit();
            if (result.toError(.write)) |err| {
                this.close();
                onError(this.parent, err);
                return;
            }

            this.onWriteComplete(.zero);
        }

        pub fn write(this: *WindowsWriter) void {
            const buffer = this.getBufferInternal();
            // if we are already done or if we have some pending payload we just wait until next write
            if (this.is_done or this.pending_payload_size > 0 or buffer.len == 0) {
                return;
            }

            const pipe = this.source orelse return;
            switch (pipe) {
                .sync_file => {
                    @panic("This code path shouldn't be reached - sync_file in PipeWriter.zig");
                },
                .file => |file| {
                    this.pending_payload_size = buffer.len;
                    file.fs.deinit();
                    file.fs.setData(this);
                    this.write_buffer = uv.uv_buf_t.init(buffer);

                    if (uv.uv_fs_write(uv.Loop.get(), &file.fs, file.file, @ptrCast(&this.write_buffer), 1, -1, onFsWriteComplete).toError(.write)) |err| {
                        this.close();
                        onError(this.parent, err);
                    }
                },
                else => {
                    // the buffered version should always have a stable ptr
                    this.pending_payload_size = buffer.len;
                    this.write_buffer = uv.uv_buf_t.init(buffer);
                    if (this.write_req.write(pipe.toStream(), &this.write_buffer, this, onWriteComplete).asErr()) |write_err| {
                        this.close();
                        onError(this.parent, write_err);
                    }
                },
            }
        }

        fn getBufferInternal(this: *WindowsWriter) []const u8 {
            return getBuffer(this.parent);
        }

        pub fn end(this: *WindowsWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            if (this.pending_payload_size == 0) {
                // will auto close when pending stuff get written
                this.close();
            }
        }
    };
}

/// Basic std.ArrayList(u8) + u32 cursor wrapper
pub const StreamBuffer = struct {
    list: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
    // should cursor be usize?
    cursor: u32 = 0,

    pub fn reset(this: *StreamBuffer) void {
        this.cursor = 0;
        if (this.list.capacity > 32 * 1024) {
            this.list.shrinkAndFree(std.mem.page_size);
        }
        this.list.clearRetainingCapacity();
    }

    pub fn size(this: *const StreamBuffer) usize {
        return this.list.items.len - this.cursor;
    }

    pub fn isEmpty(this: *const StreamBuffer) bool {
        return this.size() == 0;
    }

    pub fn isNotEmpty(this: *const StreamBuffer) bool {
        return this.size() > 0;
    }

    pub fn write(this: *StreamBuffer, buffer: []const u8) !void {
        _ = try this.list.appendSlice(buffer);
    }

    pub fn writeAssumeCapacity(this: *StreamBuffer, buffer: []const u8) void {
        var byte_list = bun.ByteList.fromList(this.list);
        defer this.list = byte_list.listManaged(this.list.allocator);
        byte_list.appendSliceAssumeCapacity(buffer);
    }

    pub fn ensureUnusedCapacity(this: *StreamBuffer, capacity: usize) !void {
        var byte_list = bun.ByteList.fromList(this.list);
        defer this.list = byte_list.listManaged(this.list.allocator);

        _ = try byte_list.ensureUnusedCapacity(this.list.allocator, capacity);
    }

    pub fn writeTypeAsBytes(this: *StreamBuffer, comptime T: type, data: *const T) !void {
        _ = try this.write(std.mem.asBytes(data));
    }

    pub fn writeTypeAsBytesAssumeCapacity(this: *StreamBuffer, comptime T: type, data: T) void {
        var byte_list = bun.ByteList.fromList(this.list);
        defer this.list = byte_list.listManaged(this.list.allocator);
        byte_list.writeTypeAsBytesAssumeCapacity(T, data);
    }

    pub fn writeOrFallback(this: *StreamBuffer, buffer: anytype, comptime writeFn: anytype) ![]const u8 {
        if (comptime @TypeOf(writeFn) == @TypeOf(&writeLatin1) and writeFn == &writeLatin1) {
            if (bun.strings.isAllASCII(buffer)) {
                return buffer;
            }

            {
                var byte_list = bun.ByteList.fromList(this.list);
                defer this.list = byte_list.listManaged(this.list.allocator);
                _ = try byte_list.writeLatin1(this.list.allocator, buffer);
            }

            return this.list.items[this.cursor..];
        } else if (comptime @TypeOf(writeFn) == @TypeOf(&writeUTF16) and writeFn == &writeUTF16) {
            {
                var byte_list = bun.ByteList.fromList(this.list);
                defer this.list = byte_list.listManaged(this.list.allocator);

                _ = try byte_list.writeUTF16(this.list.allocator, buffer);
            }

            return this.list.items[this.cursor..];
        } else if (comptime @TypeOf(writeFn) == @TypeOf(&write) and writeFn == &write) {
            return buffer;
        } else {
            @compileError("Unsupported writeFn " ++ @typeName(@TypeOf(writeFn)));
        }
    }

    pub fn writeLatin1(this: *StreamBuffer, buffer: []const u8) !void {
        if (bun.strings.isAllASCII(buffer)) {
            return this.write(buffer);
        }

        var byte_list = bun.ByteList.fromList(this.list);
        defer this.list = byte_list.listManaged(this.list.allocator);

        _ = try byte_list.writeLatin1(this.list.allocator, buffer);
    }

    pub fn writeUTF16(this: *StreamBuffer, buffer: []const u16) !void {
        var byte_list = bun.ByteList.fromList(this.list);
        defer this.list = byte_list.listManaged(this.list.allocator);

        _ = try byte_list.writeUTF16(this.list.allocator, buffer);
    }

    pub fn slice(this: *StreamBuffer) []const u8 {
        return this.list.items[this.cursor..];
    }

    pub fn deinit(this: *StreamBuffer) void {
        this.cursor = 0;
        if (this.list.capacity > 0) {
            this.list.clearAndFree();
        }
    }
};

pub fn WindowsStreamingWriter(
    comptime Parent: type,
    /// reports the amount written and done means that we dont have any other pending data to send (but we may send more data)
    comptime onWrite: fn (*Parent, amount: usize, status: WriteStatus) void,
    comptime onError: fn (*Parent, bun.sys.Error) void,
    comptime onWritable: ?fn (*Parent) void,
    comptime onClose: fn (*Parent) void,
) type {
    return struct {
        source: ?Source = null,
        parent: *Parent = undefined,
        is_done: bool = false,
        // we use only one write_req, any queued data in outgoing will be flushed after this ends
        write_req: uv.uv_write_t = std.mem.zeroes(uv.uv_write_t),
        write_buffer: uv.uv_buf_t = uv.uv_buf_t.init(""),

        // queue any data that we want to write here
        outgoing: StreamBuffer = .{},
        // libuv requires a stable ptr when doing async so we swap buffers
        current_payload: StreamBuffer = .{},
        // we preserve the last write result for simplicity
        last_write_result: WriteResult = .{ .wrote = 0 },
        // some error happed? we will not report onClose only onError
        closed_without_reporting: bool = false,

        pub usingnamespace BaseWindowsPipeWriter(WindowsWriter, Parent);

        fn onCloseSource(this: *WindowsWriter) void {
            this.source = null;
            if (!this.closed_without_reporting) {
                onClose(this.parent);
            }
        }

        pub fn startWithCurrentPipe(this: *WindowsWriter) bun.JSC.Maybe(void) {
            bun.assert(this.source != null);
            this.is_done = false;
            return .{ .result = {} };
        }

        pub fn hasPendingData(this: *const WindowsWriter) bool {
            return (this.outgoing.isNotEmpty() or this.current_payload.isNotEmpty());
        }

        fn isDone(this: *WindowsWriter) bool {
            // done is flags andd no more data queued? so we are done!
            return this.is_done and !this.hasPendingData();
        }

        fn onWriteComplete(this: *WindowsWriter, status: uv.ReturnCode) void {
            if (status.toError(.write)) |err| {
                this.last_write_result = .{ .err = err };
                log("onWrite() = {s}", .{err.name()});

                onError(this.parent, err);
                this.closeWithoutReporting();
                return;
            }

            // success means that we send all the data inside current_payload
            const written = this.current_payload.size();
            this.current_payload.reset();

            // if we dont have more outgoing data we report done in onWrite
            const done = this.outgoing.isEmpty();
            const was_done = this.is_done;

            log("onWrite({d}) ({d} left)", .{ written, this.outgoing.size() });

            if (was_done and done) {
                // we already call .end lets close the connection
                this.last_write_result = .{ .done = written };
                onWrite(this.parent, written, .end_of_file);
                return;
            }
            // .end was not called yet
            this.last_write_result = .{ .wrote = written };

            // report data written
            onWrite(this.parent, written, if (done) .drained else .pending);

            // process pending outgoing data if any
            this.processSend();

            // TODO: should we report writable?
            if (onWritable) |onWritableFn| {
                onWritableFn(this.parent);
            }
        }

        fn onFsWriteComplete(fs: *uv.fs_t) callconv(.C) void {
            const result = fs.result;
            if (result.int() == uv.UV_ECANCELED) {
                fs.deinit();
                return;
            }
            const this = bun.cast(*WindowsWriter, fs.data);

            fs.deinit();
            if (result.toError(.write)) |err| {
                this.close();
                onError(this.parent, err);
                return;
            }

            this.onWriteComplete(.zero);
        }

        /// this tries to send more data returning if we are writable or not after this
        fn processSend(this: *WindowsWriter) void {
            log("processSend", .{});
            if (this.current_payload.isNotEmpty()) {
                // we have some pending async request, the next outgoing data will be processed after this finish
                this.last_write_result = .{ .pending = 0 };
                return;
            }

            const bytes = this.outgoing.slice();
            // nothing todo (we assume we are writable until we try to write something)
            if (bytes.len == 0) {
                this.last_write_result = .{ .wrote = 0 };
                return;
            }

            var pipe = this.source orelse {
                const err = bun.sys.Error.fromCode(bun.C.E.PIPE, .pipe);
                this.last_write_result = .{ .err = err };
                onError(this.parent, err);
                this.closeWithoutReporting();
                return;
            };

            // current payload is empty we can just swap with outgoing
            const temp = this.current_payload;
            this.current_payload = this.outgoing;
            this.outgoing = temp;
            switch (pipe) {
                .sync_file => {
                    @panic("sync_file pipe write should not be reachable");
                },
                .file => |file| {
                    file.fs.deinit();
                    file.fs.setData(this);
                    this.write_buffer = uv.uv_buf_t.init(bytes);

                    if (uv.uv_fs_write(uv.Loop.get(), &file.fs, file.file, @ptrCast(&this.write_buffer), 1, -1, onFsWriteComplete).toError(.write)) |err| {
                        this.last_write_result = .{ .err = err };
                        onError(this.parent, err);
                        this.closeWithoutReporting();
                        return;
                    }
                },
                else => {
                    // enqueue the write
                    this.write_buffer = uv.uv_buf_t.init(bytes);
                    if (this.write_req.write(pipe.toStream(), &this.write_buffer, this, onWriteComplete).asErr()) |err| {
                        this.last_write_result = .{ .err = err };
                        onError(this.parent, err);
                        this.closeWithoutReporting();
                        return;
                    }
                },
            }
            this.last_write_result = .{ .pending = 0 };
        }

        const WindowsWriter = @This();

        fn closeWithoutReporting(this: *WindowsWriter) void {
            if (this.getFd() != bun.invalid_fd) {
                bun.assert(!this.closed_without_reporting);
                this.closed_without_reporting = true;
                this.close();
            }
        }

        pub fn deinit(this: *WindowsWriter) void {
            // clean both buffers if needed
            this.outgoing.deinit();
            this.current_payload.deinit();
            this.close();
        }

        fn writeInternal(this: *WindowsWriter, buffer: anytype, comptime writeFn: anytype) WriteResult {
            if (this.is_done) {
                return .{ .done = 0 };
            }

            if (this.source != null and this.source.? == .sync_file) {
                defer this.outgoing.reset();
                var remain = StreamBuffer.writeOrFallback(&this.outgoing, buffer, comptime writeFn) catch {
                    return .{ .err = bun.sys.Error.oom };
                };
                const initial_len = remain.len;
                const fd = bun.toFD(this.source.?.sync_file.file);

                while (remain.len > 0) {
                    switch (bun.sys.write(fd, remain)) {
                        .err => |err| {
                            return .{ .err = err };
                        },
                        .result => |wrote| {
                            remain = remain[wrote..];
                            if (wrote == 0) {
                                break;
                            }
                        },
                    }
                }

                const wrote = initial_len - remain.len;
                if (wrote == 0) {
                    return .{ .done = wrote };
                }
                return .{ .wrote = wrote };
            }

            const had_buffered_data = this.outgoing.isNotEmpty();
            writeFn(&this.outgoing, buffer) catch {
                return .{ .err = bun.sys.Error.oom };
            };
            if (had_buffered_data) {
                return .{ .pending = 0 };
            }
            this.processSend();
            return this.last_write_result;
        }

        pub fn writeUTF16(this: *WindowsWriter, buf: []const u16) WriteResult {
            return writeInternal(this, buf, &StreamBuffer.writeUTF16);
        }

        pub fn writeLatin1(this: *WindowsWriter, buffer: []const u8) WriteResult {
            return writeInternal(this, buffer, &StreamBuffer.writeLatin1);
        }

        pub fn write(this: *WindowsWriter, buffer: []const u8) WriteResult {
            return writeInternal(this, buffer, &StreamBuffer.write);
        }

        pub fn flush(this: *WindowsWriter) WriteResult {
            if (this.is_done) {
                return .{ .done = 0 };
            }
            if (!this.hasPendingData()) {
                return .{ .wrote = 0 };
            }

            this.processSend();
            return this.last_write_result;
        }

        pub fn end(this: *WindowsWriter) void {
            if (this.is_done) {
                return;
            }

            this.is_done = true;
            this.closed_without_reporting = false;
            // if we are done we can call close if not we wait all the data to be flushed
            if (this.isDone()) {
                this.close();
            }
        }
    };
}

pub const BufferedWriter = if (bun.Environment.isPosix) PosixBufferedWriter else WindowsBufferedWriter;
pub const StreamingWriter = if (bun.Environment.isPosix) PosixStreamingWriter else WindowsStreamingWriter;
