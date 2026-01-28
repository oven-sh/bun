const log = bun.Output.scoped(.PipeWriter, .hidden);

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
    comptime _: fn (*This) void,
    comptime getFileType: *const fn (*This) FileType,
) type {
    return struct {
        fn tryWrite(this: *This, force_sync: bool, buf_: []const u8) WriteResult {
            return switch (if (!force_sync) getFileType(this) else .file) {
                inline else => |ft| return tryWriteWithWriteFn(this, buf_, comptime writeToFileType(ft)),
            };
        }

        fn tryWriteWithWriteFn(this: *This, buf: []const u8, comptime write_fn: *const fn (bun.FileDescriptor, []const u8) bun.sys.Maybe(usize)) WriteResult {
            const fd = getFd(this);

            var offset: usize = 0;

            while (offset < buf.len) {
                switch (write_fn(fd, buf[offset..])) {
                    .err => |err| {
                        if (err.isRetry()) {
                            return .{ .pending = offset };
                        }

                        // Return EPIPE as an error so it propagates to JavaScript.
                        // This ensures process.stdout.write() properly emits an error
                        // when writing to a broken pipe, matching Node.js behavior.

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

        fn writeToFileType(comptime file_type: FileType) *const (fn (bun.FileDescriptor, []const u8) bun.sys.Maybe(usize)) {
            comptime return switch (file_type) {
                .nonblocking_pipe, .file => &bun.sys.write,
                .pipe => &writeToBlockingPipe,
                .socket => &bun.sys.sendNonBlock,
            };
        }

        fn writeToBlockingPipe(fd: bun.FileDescriptor, buf: []const u8) bun.sys.Maybe(usize) {
            if (comptime bun.Environment.isLinux) {
                if (bun.linux.RWFFlagSupport.isMaybeSupported()) {
                    return bun.sys.writeNonblocking(fd, buf);
                }
            }

            switch (bun.isWritable(fd)) {
                .ready, .hup => return bun.sys.write(fd, buf),
                .not_ready => return bun.sys.Maybe(usize){ .err = bun.sys.Error.retry },
            }
        }

        pub fn onPoll(parent: *This, size_hint: isize, received_hup: bool) void {
            const buffer = getBuffer(parent);
            log("onPoll({})", .{buffer.len});
            if (buffer.len == 0 and !received_hup) {
                log("PosixPipeWriter(0x{x}) handle={s}", .{ @intFromPtr(parent), @tagName(parent.handle) });
                if (parent.handle == .poll) {
                    log("PosixPipeWriter(0x{x}) got 0, registered state = {}", .{ @intFromPtr(parent), parent.handle.poll.isRegistered() });
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

        pub fn drainBufferedData(parent: *This, buf: []const u8, max_write_size: usize, received_hup: bool) WriteResult {
            _ = received_hup; // autofix

            const trimmed = if (max_write_size < buf.len and max_write_size > 0) buf[0..max_write_size] else buf;

            var drained: usize = 0;

            while (drained < trimmed.len) {
                const attempt = tryWrite(parent, parent.getForceSync(), trimmed[drained..]);
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
    };
}

/// See below for the expected signature of `function_table`. In many cases, the
/// function table can be the same as `Parent`. `anytype` is used because of a
/// dependency loop in Zig.
pub fn PosixBufferedWriter(Parent: type, function_table: anytype) type {
    return struct {
        const PosixWriter = @This();
        const onWrite: *const fn (*Parent, amount: usize, status: WriteStatus) void = function_table.onWrite;
        const onError: *const fn (*Parent, bun.sys.Error) void = function_table.onError;
        const onClose: ?*const fn (*Parent) void = function_table.onClose;
        const getBuffer: *const fn (*Parent) []const u8 = function_table.getBuffer;
        const onWritable: ?*const fn (*Parent) void = function_table.onWritable;

        handle: PollOrFd = .{ .closed = {} },
        parent: *Parent = undefined,
        is_done: bool = false,
        pollable: bool = false,
        closed_without_reporting: bool = false,
        close_fd: bool = true,

        const internals = PosixPipeWriter(@This(), getFd, getBufferInternal, _onWrite, registerPoll, _onError, _onWritable, getFileType);
        pub const onPoll = internals.onPoll;
        pub const drainBufferedData = internals.drainBufferedData;

        pub fn memoryCost(_: *const @This()) usize {
            return @sizeOf(@This());
        }

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

        pub fn getForceSync(_: *const @This()) bool {
            return false;
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
            // Use the event loop from the parent, not the global one
            const loop = this.parent.eventLoop().loop();
            switch (poll.registerWithFd(loop, .writable, .dispatch, poll.fd)) {
                .err => |err| {
                    onError(this.parent, err);
                },
                .result => {},
            }
        }

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

        pub fn start(this: *PosixWriter, rawfd: anytype, pollable: bool) bun.sys.Maybe(void) {
            const FDType = @TypeOf(rawfd);
            const fd = switch (FDType) {
                bun.FileDescriptor => rawfd,
                *bun.MovableIfWindowsFd, bun.MovableIfWindowsFd => rawfd.getPosix(),
                else => @compileError("Expected `bun.FileDescriptor`, `*bun.MovableIfWindowsFd` or `bun.MovableIfWindowsFd` but got: " ++ @typeName(rawfd)),
            };
            this.pollable = pollable;
            if (!pollable) {
                bun.assert(this.handle != .poll);
                this.handle = .{ .fd = fd };
                return .success;
            }
            var poll = this.getPoll() orelse brk: {
                this.handle = .{ .poll = this.createPoll(fd) };
                break :brk this.handle.poll;
            };
            const loop = @as(*Parent, @ptrCast(this.parent)).eventLoop().loop();

            switch (poll.registerWithFd(loop, .writable, .dispatch, fd)) {
                .err => |err| {
                    return .initErr(err);
                },
                .result => {
                    this.enableKeepingProcessAlive(@as(*Parent, @ptrCast(this.parent)).eventLoop());
                },
            }

            return .success;
        }
    };
}

/// See below for the expected signature of `function_table`. In many cases, the
/// function table can be the same as `Parent`. `anytype` is used because of a
/// dependency loop in Zig.
pub fn PosixStreamingWriter(comptime Parent: type, comptime function_table: anytype) type {
    return struct {
        const onWrite: fn (*Parent, amount: usize, status: WriteStatus) void = function_table.onWrite;
        const onError: fn (*Parent, bun.sys.Error) void = function_table.onError;
        const onReady: ?fn (*Parent) void = function_table.onReady;
        const onClose: fn (*Parent) void = function_table.onClose;

        outgoing: StreamBuffer = .{},
        handle: PollOrFd = .{ .closed = {} },
        parent: *Parent = undefined,
        is_done: bool = false,
        closed_without_reporting: bool = false,
        force_sync: bool = false,

        const internals = PosixPipeWriter(@This(), getFd, getBuffer, _onWrite, registerPoll, _onError, _onWritable, getFileType);
        pub const onPoll = internals.onPoll;
        pub const drainBufferedData = internals.drainBufferedData;

        pub fn getForceSync(this: *const @This()) bool {
            return this.force_sync;
        }

        // TODO: configurable?
        const chunk_size: usize = std.heap.page_size_min;

        pub fn memoryCost(this: *const @This()) usize {
            return @sizeOf(@This()) + this.outgoing.memoryCost();
        }

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

        pub fn hasPendingData(this: *const PosixWriter) bool {
            return this.outgoing.isNotEmpty();
        }

        pub fn shouldBuffer(this: *const PosixWriter, addition: usize) bool {
            return !this.force_sync and this.outgoing.size() + addition < chunk_size;
        }

        const PosixWriter = @This();

        pub fn getBuffer(this: *const PosixWriter) []const u8 {
            return this.outgoing.slice();
        }

        fn _onError(
            this: *PosixWriter,
            err: bun.sys.Error,
        ) void {
            bun.assert(!err.isRetry());

            this.closeWithoutReporting();
            this.is_done = true;
            this.outgoing.reset();

            onError(@ptrCast(@alignCast(this.parent)), err);
            this.close();
        }

        fn _onWrite(
            this: *PosixWriter,
            written: usize,
            status: WriteStatus,
        ) void {
            this.outgoing.wrote(written);

            if (status == .end_of_file and !this.is_done) {
                this.closeWithoutReporting();
            }

            if (this.outgoing.isEmpty()) {
                this.outgoing.cursor = 0;
                if (status != .end_of_file) {
                    this.outgoing.maybeShrink();
                }
                this.outgoing.list.clearRetainingCapacity();
            }

            onWrite(this.parent, written, status);
        }

        pub fn setParent(this: *PosixWriter, parent: *Parent) void {
            this.parent = parent;
            this.handle.setOwner(this);
        }

        fn _onWritable(this: *PosixWriter) void {
            if (this.is_done or this.closed_without_reporting) {
                return;
            }

            this.outgoing.reset();

            if (onReady) |cb| {
                cb(@ptrCast(this.parent));
            }
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
            switch (poll.registerWithFd(this.parent.loop(), .writable, .dispatch, poll.fd)) {
                .err => |err| {
                    onError(this.parent, err);
                    this.close();
                },
                .result => {},
            }
        }

        pub fn writeUTF16(this: *PosixWriter, buf: []const u16) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            const before_len = this.outgoing.size();

            this.outgoing.writeUTF16(buf) catch {
                return .{ .err = bun.sys.Error.oom };
            };

            const buf_len = this.outgoing.size() - before_len;

            return this.maybeWriteNewlyBufferedData(buf_len);
        }

        pub fn writeLatin1(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            if (bun.strings.isAllASCII(buf)) {
                return this.write(buf);
            }

            const before_len = this.outgoing.size();

            const check_ascii = false;
            this.outgoing.writeLatin1(buf, check_ascii) catch {
                return .{ .err = bun.sys.Error.oom };
            };

            const buf_len = this.outgoing.size() - before_len;

            return this.maybeWriteNewlyBufferedData(buf_len);
        }

        fn maybeWriteNewlyBufferedData(this: *PosixWriter, buf_len: usize) WriteResult {
            bun.assert(!this.is_done);

            if (this.shouldBuffer(0)) {
                onWrite(this.parent, buf_len, .drained);
                registerPoll(this);

                return .{ .wrote = buf_len };
            }

            return this.tryWriteNewlyBufferedData(this.outgoing.slice());
        }

        fn tryWriteNewlyBufferedData(this: *PosixWriter, buf: []const u8) WriteResult {
            bun.assert(!this.is_done);

            const rc = internals.tryWrite(this, this.force_sync, buf);

            switch (rc) {
                .wrote => |amt| {
                    if (amt == this.outgoing.size()) {
                        this.outgoing.reset();
                        onWrite(this.parent, amt, .drained);
                    } else {
                        this.outgoing.wrote(amt);
                        onWrite(this.parent, amt, .pending);
                        registerPoll(this);
                        return .{ .pending = amt };
                    }
                },
                .done => |amt| {
                    this.outgoing.reset();
                    onWrite(this.parent, amt, .end_of_file);
                },
                .pending => |amt| {
                    this.outgoing.wrote(amt);
                    onWrite(this.parent, amt, .pending);
                    registerPoll(this);
                },

                else => |r| return r,
            }

            return rc;
        }

        pub fn write(this: *PosixWriter, buf: []const u8) WriteResult {
            if (this.is_done or this.closed_without_reporting) {
                return .{ .done = 0 };
            }

            if (this.shouldBuffer(buf.len)) {

                // this is streaming, but we buffer the data below `chunk_size` to
                // reduce the number of writes
                this.outgoing.write(buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };

                // noop, but need this to have a chance
                // to register deferred tasks (onAutoFlush)
                onWrite(this.parent, buf.len, .drained);
                registerPoll(this);

                // it's buffered, but should be reported as written to
                // callers
                return .{ .wrote = buf.len };
            }

            if (this.outgoing.size() > 0) {
                // make sure write is in-order
                this.outgoing.write(buf) catch {
                    return .{ .err = bun.sys.Error.oom };
                };

                return this.tryWriteNewlyBufferedData(this.outgoing.slice());
            }

            const rc = internals.tryWrite(this, this.force_sync, buf);

            switch (rc) {
                .pending => |amt| {
                    this.outgoing.write(buf[amt..]) catch {
                        return .{ .err = bun.sys.Error.oom };
                    };
                    onWrite(this.parent, amt, .pending);
                    registerPoll(this);
                },
                .wrote => |amt| {
                    if (amt < buf.len) {
                        this.outgoing.write(buf[amt..]) catch {
                            return .{ .err = bun.sys.Error.oom };
                        };
                        onWrite(this.parent, amt, .pending);
                        registerPoll(this);
                    } else {
                        this.outgoing.reset();
                        onWrite(this.parent, amt, .drained);
                    }
                },
                .done => |amt| {
                    this.outgoing.reset();
                    onWrite(this.parent, amt, .end_of_file);
                    return .{ .done = amt };
                },
                else => {},
            }

            return rc;
        }

        pub fn flush(this: *PosixWriter) WriteResult {
            if (this.closed_without_reporting or this.is_done) {
                return .{ .done = 0 };
            }

            const buffer = this.getBuffer();
            if (buffer.len == 0) {
                this.outgoing.reset();
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
                    this.outgoing.wrote(written);
                    if (this.outgoing.isEmpty()) {
                        this.outgoing.reset();
                    }
                },
                .wrote => |written| {
                    this.outgoing.wrote(written);
                    if (this.outgoing.isEmpty()) {
                        this.outgoing.reset();
                    }
                },
                else => {
                    this.outgoing.reset();
                },
            }
            return rc;
        }

        pub fn deinit(this: *PosixWriter) void {
            this.outgoing.deinit();
            this.closeWithoutReporting();
        }

        pub fn hasRef(this: *PosixWriter) bool {
            const poll = this.getPoll() orelse return false;
            return !this.is_done and poll.canEnableKeepingProcessAlive();
        }

        pub fn enableKeepingProcessAlive(this: *PosixWriter, event_loop: jsc.EventLoopHandle) void {
            if (this.is_done) return;
            const poll = this.getPoll() orelse return;

            poll.enableKeepingProcessAlive(event_loop);
        }

        pub fn disableKeepingProcessAlive(this: *PosixWriter, event_loop: jsc.EventLoopHandle) void {
            const poll = this.getPoll() orelse return;
            poll.disableKeepingProcessAlive(event_loop);
        }

        pub fn updateRef(this: *PosixWriter, event_loop: jsc.EventLoopHandle, value: bool) void {
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
                onClose(this.parent);
                return;
            }

            this.handle.close(this.parent, onClose);
        }

        pub fn start(this: *PosixWriter, fd: bun.FileDescriptor, is_pollable: bool) bun.sys.Maybe(void) {
            if (!is_pollable) {
                this.close();
                this.handle = .{ .fd = fd };
                return .success;
            }

            const loop = this.parent.eventLoop();
            var poll = this.getPoll() orelse brk: {
                this.handle = .{ .poll = Async.FilePoll.init(loop, fd, .{}, PosixWriter, this) };
                break :brk this.handle.poll;
            };

            switch (poll.registerWithFd(loop.loop(), .writable, .dispatch, fd)) {
                .err => |err| {
                    return bun.sys.Maybe(void){ .err = err };
                },
                .result => {},
            }

            return .success;
        }
    };
}

/// Will provide base behavior for pipe writers
/// The WindowsPipeWriter type should implement the following interface:
/// struct {
///   source: ?Source = null,
///   parent: *Parent = undefined,
///   is_done: bool = false,
///   pub fn startWithCurrentPipe(this: *WindowsPipeWriter) bun.sys.Maybe(void),
///   fn onClosePipe(pipe: *uv.Pipe) callconv(.c) void,
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

        fn onPipeClose(handle: *uv.Pipe) callconv(.c) void {
            const this = bun.cast(*uv.Pipe, handle.data);
            bun.default_allocator.destroy(this);
        }

        fn onTTYClose(handle: *uv.uv_tty_t) callconv(.c) void {
            const this = bun.cast(*uv.uv_tty_t, handle.data);
            bun.default_allocator.destroy(this);
        }

        pub fn close(this: *WindowsPipeWriter) void {
            this.is_done = true;
            if (this.source) |source| {
                switch (source) {
                    .sync_file, .file => |file| {
                        // Use state machine to handle close after operation completes
                        if (this.owns_fd) {
                            file.detach();
                        } else {
                            // Don't own fd, just stop operations and detach parent
                            file.stop();
                            file.fs.data = null;
                        }
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

        pub fn startWithPipe(this: *WindowsPipeWriter, pipe: *uv.Pipe) bun.sys.Maybe(void) {
            bun.assert(this.source == null);
            this.source = .{ .pipe = pipe };
            this.setParent(this.parent);
            return this.startWithCurrentPipe();
        }

        pub fn startSync(this: *WindowsPipeWriter, fd: bun.FileDescriptor, _: bool) bun.sys.Maybe(void) {
            bun.assert(this.source == null);
            const source = Source{
                .sync_file = Source.openFile(fd),
            };
            source.setData(this);
            this.source = source;
            this.setParent(this.parent);
            return this.startWithCurrentPipe();
        }

        pub fn startWithFile(this: *WindowsPipeWriter, fd: bun.FileDescriptor) bun.sys.Maybe(void) {
            bun.assert(this.source == null);
            const source: bun.io.Source = .{ .file = Source.openFile(fd) };
            source.setData(this);
            this.source = source;
            this.setParent(this.parent);
            return this.startWithCurrentPipe();
        }

        pub fn start(this: *WindowsPipeWriter, rawfd: anytype, _: bool) bun.sys.Maybe(void) {
            const FDType = @TypeOf(rawfd);
            const fd = switch (FDType) {
                bun.FileDescriptor => rawfd,
                *bun.MovableIfWindowsFd => rawfd.get().?,
                else => @compileError("Expected `bun.FileDescriptor` or `*bun.MovableIfWindowsFd` but got: " ++ @typeName(rawfd)),
            };
            bun.assert(this.source == null);
            // Use the event loop from the parent, not the global one
            // This is critical for spawnSync to use its isolated loop
            const loop = this.parent.loop();
            const source = switch (Source.open(loop, fd)) {
                .result => |source| source,
                .err => |err| return .{ .err = err },
            };
            // Creating a uv_pipe/uv_tty takes ownership of the file descriptor
            // TODO: Change the type of the parameter and update all places to
            //       use MovableFD
            if (switch (source) {
                .pipe, .tty => true,
                else => false,
            } and FDType == *bun.MovableIfWindowsFd) {
                _ = rawfd.take();
            }
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

/// See below for the expected signature of `function_table`. In many cases, the
/// function table can be the same as `Parent`. `anytype` is used because of a
/// dependency loop in Zig.
pub fn WindowsBufferedWriter(Parent: type, function_table: anytype) type {
    return struct {
        source: ?Source = null,
        owns_fd: bool = true,
        parent: *Parent = undefined,
        is_done: bool = false,
        // we use only one write_req, any queued data in outgoing will be flushed after this ends
        write_req: uv.uv_write_t = std.mem.zeroes(uv.uv_write_t),
        write_buffer: uv.uv_buf_t = uv.uv_buf_t.init(""),
        pending_payload_size: usize = 0,

        const onWrite: *const fn (*Parent, amount: usize, status: WriteStatus) void = function_table.onWrite;
        const onError: *const fn (*Parent, bun.sys.Error) void = function_table.onError;
        const onClose: ?*const fn (*Parent) void = function_table.onClose;
        const getBuffer: *const fn (*Parent) []const u8 = function_table.getBuffer;
        const onWritable: ?*const fn (*Parent) void = function_table.onWritable;

        const WindowsWriter = @This();

        const internals = BaseWindowsPipeWriter(WindowsWriter, Parent);
        pub const getFd = internals.getFd;
        pub const hasRef = internals.hasRef;
        pub const enableKeepingProcessAlive = internals.enableKeepingProcessAlive;
        pub const disableKeepingProcessAlive = internals.disableKeepingProcessAlive;
        pub const close = internals.close;
        pub const updateRef = internals.updateRef;
        pub const setParent = internals.setParent;
        pub const watch = internals.watch;
        pub const startWithPipe = internals.startWithPipe;
        pub const startSync = internals.startSync;
        pub const startWithFile = internals.startWithFile;
        pub const start = internals.start;
        pub const setPipe = internals.setPipe;
        pub const getStream = internals.getStream;

        fn onCloseSource(this: *WindowsWriter) void {
            if (onClose) |onCloseFn| {
                onCloseFn(this.parent);
            }
        }

        pub fn memoryCost(this: *const WindowsWriter) usize {
            return @sizeOf(@This()) + this.write_buffer.len;
        }

        pub fn startWithCurrentPipe(this: *WindowsWriter) bun.sys.Maybe(void) {
            bun.assert(this.source != null);
            this.is_done = false;
            this.write();
            return .success;
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
            const has_pending_data = (pending.len - written) != 0;
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

        fn onFsWriteComplete(fs: *uv.fs_t) callconv(.c) void {
            const file = Source.File.fromFS(fs);
            const result = fs.result;
            const was_canceled = result.int() == uv.UV_ECANCELED;
            const parent_ptr = fs.data;

            // ALWAYS complete first
            file.complete(was_canceled);

            // If detached, file may be closing (owned fd) or just stopped (non-owned fd)
            if (parent_ptr == null) {
                return;
            }

            const this = bun.cast(*WindowsWriter, parent_ptr);

            if (was_canceled) {
                // Canceled write - clear pending state
                this.pending_payload_size = 0;
                return;
            }

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
                    // BufferedWriter ensures pending_payload_size blocks concurrent writes
                    bun.assert(file.canStart());

                    this.pending_payload_size = buffer.len;
                    file.fs.setData(this);
                    file.prepare();
                    this.write_buffer = uv.uv_buf_t.init(buffer);

                    if (uv.uv_fs_write(this.parent.loop(), &file.fs, file.file, @ptrCast(&this.write_buffer), 1, -1, onFsWriteComplete).toError(.write)) |err| {
                        file.complete(false);
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

/// Basic std.array_list.Managed(u8) + usize cursor wrapper
pub const StreamBuffer = struct {
    list: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),
    cursor: usize = 0,

    pub fn reset(this: *StreamBuffer) void {
        this.cursor = 0;
        this.maybeShrink();
        this.list.clearRetainingCapacity();
    }

    pub fn maybeShrink(this: *StreamBuffer) void {
        if (this.list.capacity > std.heap.pageSize()) {
            // workaround insane zig decision to make it undefined behavior to resize .len < .capacity
            this.list.expandToCapacity();
            this.list.shrinkAndFree(std.heap.pageSize());
        }
    }

    pub fn memoryCost(this: *const StreamBuffer) usize {
        return this.list.capacity;
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

    pub fn write(this: *StreamBuffer, buffer: []const u8) OOM!void {
        _ = try this.list.appendSlice(buffer);
    }

    pub fn wrote(this: *StreamBuffer, amount: usize) void {
        this.cursor += amount;
    }

    pub fn writeAssumeCapacity(this: *StreamBuffer, buffer: []const u8) void {
        this.list.appendSliceAssumeCapacity(buffer);
    }

    pub fn ensureUnusedCapacity(this: *StreamBuffer, capacity: usize) OOM!void {
        return this.list.ensureUnusedCapacity(capacity);
    }

    pub fn writeTypeAsBytes(this: *StreamBuffer, comptime T: type, data: *const T) OOM!void {
        _ = try this.write(std.mem.asBytes(data));
    }

    pub fn writeTypeAsBytesAssumeCapacity(this: *StreamBuffer, comptime T: type, data: T) void {
        var byte_list = bun.ByteList.moveFromList(&this.list);
        defer this.list = byte_list.moveToListManaged(this.list.allocator);
        byte_list.writeTypeAsBytesAssumeCapacity(T, data);
    }

    pub fn writeOrFallback(this: *StreamBuffer, buffer: anytype, comptime writeFn: anytype) OOM![]const u8 {
        if (comptime @TypeOf(writeFn) == @TypeOf(&writeLatin1) and writeFn == &writeLatin1) {
            if (bun.strings.isAllASCII(buffer)) {
                return buffer;
            }

            {
                var byte_list = bun.ByteList.moveFromList(&this.list);
                defer this.list = byte_list.moveToListManaged(this.list.allocator);
                _ = try byte_list.writeLatin1(this.list.allocator, buffer);
            }

            return this.list.items[this.cursor..];
        } else if (comptime @TypeOf(writeFn) == @TypeOf(&writeUTF16) and writeFn == &writeUTF16) {
            {
                var byte_list = bun.ByteList.moveFromList(&this.list);
                defer this.list = byte_list.moveToListManaged(this.list.allocator);

                _ = try byte_list.writeUTF16(this.list.allocator, buffer);
            }

            return this.list.items[this.cursor..];
        } else if (comptime @TypeOf(writeFn) == @TypeOf(&write) and writeFn == &write) {
            return buffer;
        } else {
            @compileError("Unsupported writeFn " ++ @typeName(@TypeOf(writeFn)));
        }
    }

    pub fn writeLatin1(this: *StreamBuffer, buffer: []const u8, comptime check_ascii: bool) OOM!void {
        if (comptime check_ascii) {
            if (bun.strings.isAllASCII(buffer)) {
                return this.write(buffer);
            }
        }

        var byte_list = bun.ByteList.moveFromList(&this.list);
        defer this.list = byte_list.moveToListManaged(this.list.allocator);

        _ = try byte_list.writeLatin1(this.list.allocator, buffer);
    }

    pub fn writeUTF16(this: *StreamBuffer, buffer: []const u16) OOM!void {
        var byte_list = bun.ByteList.moveFromList(&this.list);
        defer this.list = byte_list.moveToListManaged(this.list.allocator);

        _ = try byte_list.writeUTF16(this.list.allocator, buffer);
    }

    pub fn slice(this: *const StreamBuffer) []const u8 {
        return this.list.items[this.cursor..];
    }

    pub fn deinit(this: *StreamBuffer) void {
        this.cursor = 0;
        if (this.list.capacity > 0) {
            this.list.clearAndFree();
        }
    }
};

/// See below for the expected signature of `function_table`. In many cases, the
/// function table can be the same as `Parent`. `anytype` is used because of a
/// dependency loop in Zig.
pub fn WindowsStreamingWriter(comptime Parent: type, function_table: anytype) type {
    return struct {
        /// reports the amount written and done means that we dont have any
        /// other pending data to send (but we may send more data)
        const onWrite: fn (*Parent, amount: usize, status: WriteStatus) void = function_table.onWrite;
        const onError: fn (*Parent, bun.sys.Error) void = function_table.onError;
        const onWritable: ?fn (*Parent) void = function_table.onWritable;
        const onClose: fn (*Parent) void = function_table.onClose;

        source: ?Source = null,
        /// if the source of this writer is a file descriptor, calling end() will not close it.
        /// if it is a path, then we claim ownership and the backing fd will be closed by end().
        owns_fd: bool = true,
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

        const internals = BaseWindowsPipeWriter(WindowsWriter, Parent);
        pub const getFd = internals.getFd;
        pub const hasRef = internals.hasRef;
        pub const enableKeepingProcessAlive = internals.enableKeepingProcessAlive;
        pub const disableKeepingProcessAlive = internals.disableKeepingProcessAlive;
        pub const close = internals.close;
        pub const updateRef = internals.updateRef;
        pub const setParent = internals.setParent;
        pub const watch = internals.watch;
        pub const startWithPipe = internals.startWithPipe;
        pub const startSync = internals.startSync;
        pub const startWithFile = internals.startWithFile;
        pub const start = internals.start;
        pub const setPipe = internals.setPipe;
        pub const getStream = internals.getStream;

        pub fn memoryCost(this: *const WindowsWriter) usize {
            return @sizeOf(@This()) + this.current_payload.memoryCost() + this.outgoing.memoryCost();
        }

        fn onCloseSource(this: *WindowsWriter) void {
            this.source = null;
            if (this.closed_without_reporting) {
                this.closed_without_reporting = false;
                return;
            }
            onClose(this.parent);
        }

        pub fn startWithCurrentPipe(this: *WindowsWriter) bun.sys.Maybe(void) {
            bun.assert(this.source != null);
            this.is_done = false;
            return .success;
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

        fn onFsWriteComplete(fs: *uv.fs_t) callconv(.c) void {
            const file = Source.File.fromFS(fs);
            const result = fs.result;
            const was_canceled = result.int() == uv.UV_ECANCELED;
            const parent_ptr = fs.data;

            // ALWAYS complete first
            file.complete(was_canceled);

            // If detached, file may be closing (owned fd) or just stopped (non-owned fd)
            if (parent_ptr == null) {
                return;
            }

            const this = bun.cast(*WindowsWriter, parent_ptr);

            if (was_canceled) {
                // Canceled write - reset buffers
                this.current_payload.reset();
                return;
            }

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
                const err = bun.sys.Error.fromCode(bun.sys.E.PIPE, .pipe);
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
                    // StreamingWriter ensures current_payload blocks concurrent writes
                    bun.assert(file.canStart());

                    file.fs.setData(this);
                    file.prepare();
                    this.write_buffer = uv.uv_buf_t.init(bytes);

                    if (uv.uv_fs_write(this.parent.loop(), &file.fs, file.file, @ptrCast(&this.write_buffer), 1, -1, onFsWriteComplete).toError(.write)) |err| {
                        file.complete(false);
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
            this.closeWithoutReporting();
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
                const fd: bun.FD = .fromUV(this.source.?.sync_file.file);

                while (remain.len > 0) {
                    switch (fd.write(remain)) {
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
            (if (comptime @TypeOf(writeFn) == @TypeOf(&StreamBuffer.writeLatin1) and writeFn == &StreamBuffer.writeLatin1)
                writeFn(&this.outgoing, buffer, true)
            else
                writeFn(&this.outgoing, buffer)) catch {
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

            this.closed_without_reporting = false;
            this.is_done = true;

            if (!this.hasPendingData()) {
                if (!this.owns_fd) {
                    return;
                }
                this.close();
            }
        }
    };
}

pub const BufferedWriter = if (bun.Environment.isPosix) PosixBufferedWriter else WindowsBufferedWriter;
pub const StreamingWriter = if (bun.Environment.isPosix) PosixStreamingWriter else WindowsStreamingWriter;

const std = @import("std");
const Source = @import("./source.zig").Source;

const FileType = @import("./pipes.zig").FileType;
const PollOrFd = @import("./pipes.zig").PollOrFd;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const OOM = bun.OOM;
const jsc = bun.jsc;
const uv = bun.windows.libuv;
