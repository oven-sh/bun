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
            switch (poll.registerWithFd(bun.uws.Loop.get(), .writable, .dispatch, poll.fd)) {
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

            onError(@alignCast(@ptrCast(this.parent)), err);
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
///   fn onClosePipe(pipe: *uv.Pipe) callconv(.C) void,
/// };
fn BaseWindowsPipeWriter(
    comptime WindowsPipeWriter: type,
    comptime Parent: type,
) type {
    return struct {
        pub fn getFd(this: *const WindowsPipeWriter) bun.FileDescriptor {
            mlog("BaseWindowsPipeWriter getFd(0x{d})\n", .{@intFromPtr(this)});
            const pipe = this.source orelse {
                mlog("BaseWindowsPipeWriter getFd(0x{d}) -> no source, returning invalid_fd\n", .{@intFromPtr(this)});
                return bun.invalid_fd;
            };
            const fd = pipe.getFd();
            mlog("BaseWindowsPipeWriter getFd(0x{d}) -> fd={}\n", .{ @intFromPtr(this), fd });
            return fd;
        }

        pub fn hasRef(this: *const WindowsPipeWriter) bool {
            mlog("BaseWindowsPipeWriter hasRef(0x{d}) is_done={}\n", .{ @intFromPtr(this), this.is_done });
            if (this.is_done) {
                mlog("BaseWindowsPipeWriter hasRef(0x{d}) -> false (is_done)\n", .{@intFromPtr(this)});
                return false;
            }
            if (this.source) |pipe| {
                const has_ref = pipe.hasRef();
                mlog("BaseWindowsPipeWriter hasRef(0x{d}) -> {} (from pipe)\n", .{ @intFromPtr(this), has_ref });
                return has_ref;
            }
            mlog("BaseWindowsPipeWriter hasRef(0x{d}) -> false (no source)\n", .{@intFromPtr(this)});
            return false;
        }

        pub fn enableKeepingProcessAlive(this: *WindowsPipeWriter, event_loop: anytype) void {
            mlog("BaseWindowsPipeWriter enableKeepingProcessAlive(0x{d})\n", .{@intFromPtr(this)});
            this.updateRef(event_loop, true);
        }

        pub fn disableKeepingProcessAlive(this: *WindowsPipeWriter, event_loop: anytype) void {
            mlog("BaseWindowsPipeWriter disableKeepingProcessAlive(0x{d})\n", .{@intFromPtr(this)});
            this.updateRef(event_loop, false);
        }

        fn onFileClose(handle: *uv.fs_t) callconv(.C) void {
            mlog("BaseWindowsPipeWriter onFileClose() handle=0x{d}\n", .{@intFromPtr(handle)});
            const file = bun.cast(*Source.File, handle.data);
            mlog("BaseWindowsPipeWriter onFileClose() file=0x{d}, cleaning up\n", .{@intFromPtr(file)});
            handle.deinit();
            bun.default_allocator.destroy(file);
        }

        fn onPipeClose(handle: *uv.Pipe) callconv(.C) void {
            mlog("BaseWindowsPipeWriter onPipeClose() handle=0x{d}\n", .{@intFromPtr(handle)});
            const this = bun.cast(*uv.Pipe, handle.data);
            mlog("BaseWindowsPipeWriter onPipeClose() pipe=0x{d}, destroying\n", .{@intFromPtr(this)});
            bun.default_allocator.destroy(this);
        }

        fn onTTYClose(handle: *uv.uv_tty_t) callconv(.C) void {
            mlog("BaseWindowsPipeWriter onTTYClose() handle=0x{d}\n", .{@intFromPtr(handle)});
            const this = bun.cast(*uv.uv_tty_t, handle.data);
            mlog("BaseWindowsPipeWriter onTTYClose() tty=0x{d}, destroying\n", .{@intFromPtr(this)});
            bun.default_allocator.destroy(this);
        }

        pub fn close(this: *WindowsPipeWriter) void {
            mlog("BaseWindowsPipeWriter close(0x{d}) is_done={} owns_fd={}\n", .{ @intFromPtr(this), this.is_done, this.owns_fd });
            this.is_done = true;
            if (this.source) |source| {
                mlog("BaseWindowsPipeWriter close(0x{d}) closing source type={s}\n", .{ @intFromPtr(this), @tagName(source) });
                switch (source) {
                    .sync_file, .file => |file| {
                        mlog("BaseWindowsPipeWriter close(0x{d}) handling file/sync_file, calling fs.cancel()\n", .{@intFromPtr(this)});
                        // always cancel the current one
                        file.fs.cancel();
                        if (this.owns_fd) {
                            mlog("BaseWindowsPipeWriter close(0x{d}) owns_fd=true, calling uv_fs_close\n", .{@intFromPtr(this)});
                            // always use close_fs here because we can have a operation in progress
                            file.close_fs.data = file;
                            _ = uv.uv_fs_close(uv.Loop.get(), &file.close_fs, file.file, onFileClose);
                        } else {
                            mlog("BaseWindowsPipeWriter close(0x{d}) owns_fd=false, skipping uv_fs_close\n", .{@intFromPtr(this)});
                        }
                    },
                    .pipe => |pipe| {
                        mlog("BaseWindowsPipeWriter close(0x{d}) handling pipe, calling pipe.close()\n", .{@intFromPtr(this)});
                        pipe.data = pipe;
                        pipe.close(onPipeClose);
                    },
                    .tty => |tty| {
                        mlog("BaseWindowsPipeWriter close(0x{d}) handling tty, calling tty.close()\n", .{@intFromPtr(this)});
                        tty.data = tty;
                        tty.close(onTTYClose);
                    },
                }
                this.source = null;
                mlog("BaseWindowsPipeWriter close(0x{d}) calling onCloseSource()\n", .{@intFromPtr(this)});
                this.onCloseSource();
            } else {
                mlog("BaseWindowsPipeWriter close(0x{d}) no source to close\n", .{@intFromPtr(this)});
            }
        }

        pub fn updateRef(this: *WindowsPipeWriter, _: anytype, value: bool) void {
            mlog("BaseWindowsPipeWriter updateRef(0x{d}, value={})\n", .{ @intFromPtr(this), value });
            if (this.source) |pipe| {
                if (value) {
                    mlog("BaseWindowsPipeWriter updateRef(0x{d}) calling pipe.ref()\n", .{@intFromPtr(this)});
                    pipe.ref();
                } else {
                    mlog("BaseWindowsPipeWriter updateRef(0x{d}) calling pipe.unref()\n", .{@intFromPtr(this)});
                    pipe.unref();
                }
            } else {
                mlog("BaseWindowsPipeWriter updateRef(0x{d}) no source to update\n", .{@intFromPtr(this)});
            }
        }

        pub fn setParent(this: *WindowsPipeWriter, parent: *Parent) void {
            mlog("BaseWindowsPipeWriter setParent(0x{d}, parent=0x{d}) is_done={}\n", .{ @intFromPtr(this), @intFromPtr(parent), this.is_done });
            this.parent = parent;
            if (!this.is_done) {
                if (this.source) |pipe| {
                    mlog("BaseWindowsPipeWriter setParent(0x{d}) calling pipe.setData\n", .{@intFromPtr(this)});
                    pipe.setData(this);
                } else {
                    mlog("BaseWindowsPipeWriter setParent(0x{d}) no source to setData\n", .{@intFromPtr(this)});
                }
            } else {
                mlog("BaseWindowsPipeWriter setParent(0x{d}) skipping setData (is_done=true)\n", .{@intFromPtr(this)});
            }
        }

        pub fn watch(this: *WindowsPipeWriter) void {
            mlog("BaseWindowsPipeWriter watch(0x{d}) - no-op\n", .{@intFromPtr(this)});
            // no-op
        }

        pub fn startWithPipe(this: *WindowsPipeWriter, pipe: *uv.Pipe) bun.sys.Maybe(void) {
            mlog("BaseWindowsPipeWriter startWithPipe(0x{d}, pipe=0x{d})\n", .{ @intFromPtr(this), @intFromPtr(pipe) });
            bun.assert(this.source == null);
            this.source = .{ .pipe = pipe };
            mlog("BaseWindowsPipeWriter startWithPipe(0x{d}) calling setParent\n", .{@intFromPtr(this)});
            this.setParent(this.parent);
            mlog("BaseWindowsPipeWriter startWithPipe(0x{d}) calling startWithCurrentPipe\n", .{@intFromPtr(this)});
            return this.startWithCurrentPipe();
        }

        pub fn startSync(this: *WindowsPipeWriter, fd: bun.FileDescriptor, _: bool) bun.sys.Maybe(void) {
            mlog("BaseWindowsPipeWriter startSync(0x{d}, fd={})\n", .{ @intFromPtr(this), fd });
            bun.assert(this.source == null);
            const source = Source{
                .sync_file = Source.openFile(fd),
            };
            mlog("BaseWindowsPipeWriter startSync(0x{d}) created sync_file source\n", .{@intFromPtr(this)});
            source.setData(this);
            this.source = source;
            this.setParent(this.parent);
            mlog("BaseWindowsPipeWriter startSync(0x{d}) calling startWithCurrentPipe\n", .{@intFromPtr(this)});
            return this.startWithCurrentPipe();
        }

        pub fn startWithFile(this: *WindowsPipeWriter, fd: bun.FileDescriptor) bun.sys.Maybe(void) {
            mlog("BaseWindowsPipeWriter startWithFile(0x{d}, fd={})\n", .{ @intFromPtr(this), fd });
            bun.assert(this.source == null);
            const source: bun.io.Source = .{ .file = Source.openFile(fd) };
            mlog("BaseWindowsPipeWriter startWithFile(0x{d}) created file source\n", .{@intFromPtr(this)});
            source.setData(this);
            this.source = source;
            this.setParent(this.parent);
            mlog("BaseWindowsPipeWriter startWithFile(0x{d}) calling startWithCurrentPipe\n", .{@intFromPtr(this)});
            return this.startWithCurrentPipe();
        }

        pub fn start(this: *WindowsPipeWriter, rawfd: anytype, _: bool) bun.sys.Maybe(void) {
            const FDType = @TypeOf(rawfd);
            mlog("BaseWindowsPipeWriter start(0x{d}, FDType={s})\n", .{ @intFromPtr(this), @typeName(FDType) });
            const fd = switch (FDType) {
                bun.FileDescriptor => rawfd,
                *bun.MovableIfWindowsFd => rawfd.get().?,
                else => @compileError("Expected `bun.FileDescriptor` or `*bun.MovableIfWindowsFd` but got: " ++ @typeName(rawfd)),
            };
            mlog("BaseWindowsPipeWriter start(0x{d}) resolved fd={}\n", .{ @intFromPtr(this), fd });
            bun.assert(this.source == null);
            const source = switch (Source.open(uv.Loop.get(), fd)) {
                .result => |src| blk: {
                    mlog("BaseWindowsPipeWriter start(0x{d}) Source.open succeeded\n", .{@intFromPtr(this)});
                    break :blk src;
                },
                .err => |err| {
                    mlog("BaseWindowsPipeWriter start(0x{d}) Source.open failed: {}\n", .{ @intFromPtr(this), err });
                    return .{ .err = err };
                },
            };
            // Creating a uv_pipe/uv_tty takes ownership of the file descriptor
            // TODO: Change the type of the parameter and update all places to
            //       use MovableFD
            const should_take_ownership = switch (source) {
                .pipe, .tty => true,
                else => false,
            } and FDType == *bun.MovableIfWindowsFd;
            if (should_take_ownership) {
                mlog("BaseWindowsPipeWriter start(0x{d}) taking ownership of MovableFD\n", .{@intFromPtr(this)});
                _ = rawfd.take();
            } else {
                mlog("BaseWindowsPipeWriter start(0x{d}) not taking ownership (source={s}, FDType={s})\n", .{ @intFromPtr(this), @tagName(source), @typeName(FDType) });
            }
            source.setData(this);
            this.source = source;
            mlog("BaseWindowsPipeWriter start(0x{d}) calling setParent\n", .{@intFromPtr(this)});
            this.setParent(this.parent);
            mlog("BaseWindowsPipeWriter start(0x{d}) calling startWithCurrentPipe\n", .{@intFromPtr(this)});
            return this.startWithCurrentPipe();
        }

        pub fn setPipe(this: *WindowsPipeWriter, pipe: *uv.Pipe) void {
            mlog("BaseWindowsPipeWriter setPipe(0x{d}, pipe=0x{d})\n", .{ @intFromPtr(this), @intFromPtr(pipe) });
            this.source = .{ .pipe = pipe };
            this.setParent(this.parent);
        }

        pub fn getStream(this: *const WindowsPipeWriter) ?*uv.uv_stream_t {
            mlog("BaseWindowsPipeWriter getStream(0x{d})\n", .{@intFromPtr(this)});
            const source = this.source orelse {
                mlog("BaseWindowsPipeWriter getStream(0x{d}) -> null (no source)\n", .{@intFromPtr(this)});
                return null;
            };
            if (source == .file) {
                mlog("BaseWindowsPipeWriter getStream(0x{d}) -> null (file source)\n", .{@intFromPtr(this)});
                return null;
            }
            const stream = source.toStream();
            mlog("BaseWindowsPipeWriter getStream(0x{d}) -> stream=0x{d}\n", .{ @intFromPtr(this), @intFromPtr(stream) });
            return stream;
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
            mlog("WindowsBufferedWriter onCloseSource(0x{d})\n", .{@intFromPtr(this)});
            if (onClose) |onCloseFn| {
                onCloseFn(this.parent);
            }
        }

        pub fn memoryCost(this: *const WindowsWriter) usize {
            mlog("WindowsBufferedWriter memoryCost(0x{d})\n", .{@intFromPtr(this)});
            return @sizeOf(@This()) + this.write_buffer.len;
        }

        pub fn startWithCurrentPipe(this: *WindowsWriter) bun.sys.Maybe(void) {
            mlog("WindowsBufferedWriter startWithCurrentPipe(0x{d})\n", .{@intFromPtr(this)});
            bun.assert(this.source != null);
            this.is_done = false;
            this.write();
            return .success;
        }

        fn onWriteComplete(this: *WindowsWriter, status: uv.ReturnCode) void {
            const written = this.pending_payload_size;
            mlog("WindowsBufferedWriter onWriteComplete(0x{d}, written={}, status={})\n", .{ @intFromPtr(this), written, status.int() });
            this.pending_payload_size = 0;
            if (status.toError(.write)) |err| {
                mlog("There was an error during write: {}\n", .{err});
                this.close();
                onError(this.parent, err);
                return;
            }

            const pending = this.getBufferInternal();
            const has_pending_data = (pending.len - written) == 0;
            mlog("has_pending_data: {}, is_done: {}\n", .{ has_pending_data, this.is_done });
            onWrite(this.parent, @intCast(written), if (this.is_done and !has_pending_data) .drained else .pending);
            // is_done can be changed inside onWrite
            if (this.is_done and !has_pending_data) {
                // already done and end was called
                mlog("WindowsBufferedWriter onWriteComplete(0x{d}) LIFECYCLE: closing writer after completion (is_done={} no_pending_data={})\n", .{ @intFromPtr(this), this.is_done, !has_pending_data });
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
            mlog("WindowsWriter onFsWriteComplete(0x{d}, result={})\n", .{ @intFromPtr(this), result.int() });

            fs.deinit();
            if (result.toError(.write)) |err| {
                this.close();
                onError(this.parent, err);
                return;
            }

            this.onWriteComplete(.zero);
        }

        pub fn write(this: *WindowsWriter) void {
            mlog("WindowsBufferedWriter write(0x{d}) called\n", .{@intFromPtr(this)});
            const buffer = this.getBufferInternal();
            mlog("WindowsBufferedWriter write(0x{d}) buffer.len={} is_done={} pending_payload_size={}\n", .{ @intFromPtr(this), buffer.len, this.is_done, this.pending_payload_size });
            // if we are already done or if we have some pending payload we just wait until next write
            if (this.is_done or this.pending_payload_size > 0 or buffer.len == 0) {
                mlog("WindowsBufferedWriter write(0x{d}) exiting early: is_done={} payload_size={} buffer.len={}\n", .{ @intFromPtr(this), this.is_done, this.pending_payload_size, buffer.len });
                return;
            }

            const pipe = this.source orelse {
                mlog("WindowsBufferedWriter write(0x{d}) no source, returning\n", .{@intFromPtr(this)});
                return;
            };
            mlog("WindowsBufferedWriter write(0x{d}) source type={s}\n", .{ @intFromPtr(this), @tagName(pipe) });
            switch (pipe) {
                .sync_file => {
                    mlog("WindowsBufferedWriter write(0x{d}) ERROR: sync_file path reached\n", .{@intFromPtr(this)});
                    @panic("This code path shouldn't be reached - sync_file in PipeWriter.zig");
                },
                .file => |file| {
                    mlog("WindowsBufferedWriter write(0x{d}) writing to file, buffer.len={}\n", .{ @intFromPtr(this), buffer.len });
                    this.pending_payload_size = buffer.len;
                    file.fs.deinit();
                    file.fs.setData(this);
                    this.write_buffer = uv.uv_buf_t.init(buffer);

                    mlog("WindowsBufferedWriter write(0x{d}) calling uv_fs_write\n", .{@intFromPtr(this)});
                    if (uv.uv_fs_write(uv.Loop.get(), &file.fs, file.file, @ptrCast(&this.write_buffer), 1, -1, onFsWriteComplete).toError(.write)) |err| {
                        mlog("WindowsBufferedWriter write(0x{d}) uv_fs_write failed: {}\n", .{ @intFromPtr(this), err });
                        this.close();
                        onError(this.parent, err);
                    } else {
                        mlog("WindowsBufferedWriter write(0x{d}) uv_fs_write initiated successfully\n", .{@intFromPtr(this)});
                    }
                },
                else => {
                    mlog("WindowsBufferedWriter write(0x{d}) writing to stream, buffer.len={}\n", .{ @intFromPtr(this), buffer.len });
                    // the buffered version should always have a stable ptr
                    this.pending_payload_size = buffer.len;
                    this.write_buffer = uv.uv_buf_t.init(buffer);
                    mlog("WindowsBufferedWriter write(0x{d}) calling write_req.write\n", .{@intFromPtr(this)});
                    if (this.write_req.write(pipe.toStream(), &this.write_buffer, this, onWriteComplete).asErr()) |write_err| {
                        mlog("WindowsBufferedWriter write(0x{d}) write_req.write failed: {}\n", .{ @intFromPtr(this), write_err });
                        this.close();
                        onError(this.parent, write_err);
                    } else {
                        mlog("WindowsBufferedWriter write(0x{d}) write_req.write initiated successfully\n", .{@intFromPtr(this)});
                    }
                },
            }
        }

        fn getBufferInternal(this: *WindowsWriter) []const u8 {
            const buffer = getBuffer(this.parent);
            mlog("WindowsBufferedWriter getBufferInternal(0x{d}) -> buffer.len={}\n", .{ @intFromPtr(this), buffer.len });
            return buffer;
        }

        pub fn end(this: *WindowsWriter) void {
            mlog("WindowsBufferedWriter end(0x{d}) LIFECYCLE: end() called, pending_payload_size={}\n", .{ @intFromPtr(this), this.pending_payload_size });
            if (this.is_done) {
                mlog("WindowsBufferedWriter end(0x{d}) LIFECYCLE: already done, ignoring\n", .{@intFromPtr(this)});
                return;
            }

            this.is_done = true;
            if (this.pending_payload_size == 0) {
                // will auto close when pending stuff get written
                mlog("WindowsBufferedWriter end(0x{d}) LIFECYCLE: closing immediately (no pending data)\n", .{@intFromPtr(this)});
                this.close();
            } else {
                mlog("WindowsBufferedWriter end(0x{d}) LIFECYCLE: waiting for pending write to complete before closing\n", .{@intFromPtr(this)});
            }
        }
    };
}

/// Basic std.ArrayList(u8) + usize cursor wrapper
pub const StreamBuffer = struct {
    list: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
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
            const cost = @sizeOf(@This()) + this.current_payload.memoryCost() + this.outgoing.memoryCost();
            mlog("WindowsStreamingWriter memoryCost(0x{d}) = {d}\n", .{ @intFromPtr(this), cost });
            return cost;
        }

        fn onCloseSource(this: *WindowsWriter) void {
            mlog("WindowsStreamingWriter onCloseSource(0x{d}) closed_without_reporting={}\n", .{ @intFromPtr(this), this.closed_without_reporting });
            this.source = null;
            if (this.closed_without_reporting) {
                mlog("WindowsStreamingWriter onCloseSource(0x{d}) early return due to closed_without_reporting\n", .{@intFromPtr(this)});
                this.closed_without_reporting = false;
                return;
            }
            mlog("WindowsStreamingWriter onCloseSource(0x{d}) calling onClose\n", .{@intFromPtr(this)});
            onClose(this.parent);
        }

        pub fn startWithCurrentPipe(this: *WindowsWriter) bun.sys.Maybe(void) {
            mlog("WindowsStreamingWriter startWithCurrentPipe(0x{d}) source_is_null={}\n", .{ @intFromPtr(this), this.source == null });
            bun.assert(this.source != null);
            this.is_done = false;
            mlog("WindowsStreamingWriter startWithCurrentPipe(0x{d}) success, is_done={}\n", .{ @intFromPtr(this), this.is_done });
            return .success;
        }

        pub fn hasPendingData(this: *const WindowsWriter) bool {
            const has_pending = (this.outgoing.isNotEmpty() or this.current_payload.isNotEmpty());
            mlog("WindowsStreamingWriter hasPendingData(0x{d}) = {} (outgoing={}, current_payload={})\n", .{ @intFromPtr(this), has_pending, this.outgoing.isNotEmpty(), this.current_payload.isNotEmpty() });
            return has_pending;
        }

        fn isDone(this: *WindowsWriter) bool {
            // done is flags andd no more data queued? so we are done!
            const pending = this.hasPendingData();
            const done = this.is_done and !pending;
            mlog("WindowsStreamingWriter isDone(0x{d}) = {} (is_done={}, hasPendingData={})\n", .{ @intFromPtr(this), done, this.is_done, pending });
            return done;
        }

        fn onWriteComplete(this: *WindowsWriter, status: uv.ReturnCode) void {
            mlog("WindowsStreamingWriter onWriteComplete(0x{d}, status={})\n", .{ @intFromPtr(this), status.int() });
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
            mlog("WindowsStreamingWriter onFsWriteComplete() result={}\n", .{result.int()});
            if (result.int() == uv.UV_ECANCELED) {
                mlog("WindowsStreamingWriter onFsWriteComplete() CANCELED path\n", .{});
                fs.deinit();
                return;
            }
            const this = bun.cast(*WindowsWriter, fs.data);
            mlog("WindowsStreamingWriter onFsWriteComplete(0x{d}, result={})\n", .{ @intFromPtr(this), result.int() });

            fs.deinit();
            if (result.toError(.write)) |err| {
                mlog("WindowsStreamingWriter onFsWriteComplete(0x{d}) ERROR path: {}\n", .{ @intFromPtr(this), err });
                this.close();
                onError(this.parent, err);
                return;
            }

            mlog("WindowsStreamingWriter onFsWriteComplete(0x{d}) SUCCESS path: calling onWriteComplete\n", .{@intFromPtr(this)});
            this.onWriteComplete(.zero);
        }

        /// this tries to send more data returning if we are writable or not after this
        fn processSend(this: *WindowsWriter) void {
            mlog("WindowsStreamingWriter processSend(0x{d}) called\n", .{@intFromPtr(this)});
            log("processSend", .{});
            if (this.current_payload.isNotEmpty()) {
                // we have some pending async request, the next outgoing data will be processed after this finish
                mlog("WindowsStreamingWriter processSend(0x{d}) PENDING path: current_payload not empty, size={}\n", .{ @intFromPtr(this), this.current_payload.size() });
                this.last_write_result = .{ .pending = 0 };
                return;
            }

            const bytes = this.outgoing.slice();
            // nothing todo (we assume we are writable until we try to write something)
            if (bytes.len == 0) {
                mlog("WindowsStreamingWriter processSend(0x{d}) EMPTY path: no outgoing data\n", .{@intFromPtr(this)});
                this.last_write_result = .{ .wrote = 0 };
                return;
            }

            mlog("WindowsStreamingWriter processSend(0x{d}) processing {} bytes\n", .{ @intFromPtr(this), bytes.len });
            var pipe = this.source orelse {
                mlog("WindowsStreamingWriter processSend(0x{d}) ERROR: no source pipe\n", .{@intFromPtr(this)});
                const err = bun.sys.Error.fromCode(bun.sys.E.PIPE, .pipe);
                this.last_write_result = .{ .err = err };
                onError(this.parent, err);
                this.closeWithoutReporting();
                return;
            };

            // current payload is empty we can just swap with outgoing
            mlog("WindowsStreamingWriter processSend(0x{d}) swapping buffers\n", .{@intFromPtr(this)});
            const temp = this.current_payload;
            this.current_payload = this.outgoing;
            this.outgoing = temp;
            switch (pipe) {
                .sync_file => {
                    mlog("WindowsStreamingWriter processSend(0x{d}) PANIC: sync_file should not be reachable\n", .{@intFromPtr(this)});
                    @panic("sync_file pipe write should not be reachable");
                },
                .file => |file| {
                    mlog("WindowsStreamingWriter processSend(0x{d}) FILE path: calling uv_fs_write\n", .{@intFromPtr(this)});
                    file.fs.deinit();
                    file.fs.setData(this);
                    this.write_buffer = uv.uv_buf_t.init(bytes);

                    if (uv.uv_fs_write(uv.Loop.get(), &file.fs, file.file, @ptrCast(&this.write_buffer), 1, -1, onFsWriteComplete).toError(.write)) |err| {
                        mlog("WindowsStreamingWriter processSend(0x{d}) FILE ERROR: uv_fs_write failed: {}\n", .{ @intFromPtr(this), err });
                        this.last_write_result = .{ .err = err };
                        onError(this.parent, err);
                        this.closeWithoutReporting();
                        return;
                    }
                    mlog("WindowsStreamingWriter processSend(0x{d}) FILE: uv_fs_write queued successfully\n", .{@intFromPtr(this)});
                },
                else => {
                    // enqueue the write
                    mlog("WindowsStreamingWriter processSend(0x{d}) STREAM path: calling write_req.write\n", .{@intFromPtr(this)});
                    this.write_buffer = uv.uv_buf_t.init(bytes);
                    if (this.write_req.write(pipe.toStream(), &this.write_buffer, this, onWriteComplete).asErr()) |err| {
                        mlog("WindowsStreamingWriter processSend(0x{d}) STREAM ERROR: write_req.write failed: {}\n", .{ @intFromPtr(this), err });
                        this.last_write_result = .{ .err = err };
                        onError(this.parent, err);
                        this.closeWithoutReporting();
                        return;
                    }
                    mlog("WindowsStreamingWriter processSend(0x{d}) STREAM: write_req.write queued successfully\n", .{@intFromPtr(this)});
                },
            }
            mlog("WindowsStreamingWriter processSend(0x{d}) setting last_write_result to pending\n", .{@intFromPtr(this)});
            this.last_write_result = .{ .pending = 0 };
        }

        const WindowsWriter = @This();

        fn closeWithoutReporting(this: *WindowsWriter) void {
            mlog("WindowsStreamingWriter closeWithoutReporting(0x{d}) fd={}, closed_without_reporting={}\n", .{ @intFromPtr(this), this.getFd().cast(), this.closed_without_reporting });
            if (this.getFd() != bun.invalid_fd) {
                bun.assert(!this.closed_without_reporting);
                mlog("WindowsStreamingWriter closeWithoutReporting(0x{d}) setting flag and calling close\n", .{@intFromPtr(this)});
                this.closed_without_reporting = true;
                this.close();
            } else {
                mlog("WindowsStreamingWriter closeWithoutReporting(0x{d}) invalid fd, skipping close\n", .{@intFromPtr(this)});
            }
        }

        pub fn deinit(this: *WindowsWriter) void {
            mlog("WindowsStreamingWriter deinit(0x{d}) outgoing_size={}, current_payload_size={}\n", .{ @intFromPtr(this), this.outgoing.size(), this.current_payload.size() });
            // clean both buffers if needed
            this.outgoing.deinit();
            this.current_payload.deinit();
            mlog("WindowsStreamingWriter deinit(0x{d}) buffers cleaned, calling closeWithoutReporting\n", .{@intFromPtr(this)});
            this.closeWithoutReporting();
        }

        fn writeInternal(this: *WindowsWriter, buffer: anytype, comptime writeFn: anytype) WriteResult {
            mlog("WindowsStreamingWriter writeInternal(0x{d}) buffer_len={}, is_done={}\n", .{ @intFromPtr(this), @as(usize, buffer.len), this.is_done });
            if (this.is_done) {
                mlog("WindowsStreamingWriter writeInternal(0x{d}) DONE path: already ended\n", .{@intFromPtr(this)});
                return .{ .done = 0 };
            }

            if (this.source != null and this.source.? == .sync_file) {
                mlog("WindowsStreamingWriter writeInternal(0x{d}) SYNC_FILE path\n", .{@intFromPtr(this)});
                defer this.outgoing.reset();
                var remain = StreamBuffer.writeOrFallback(&this.outgoing, buffer, comptime writeFn) catch {
                    mlog("WindowsStreamingWriter writeInternal(0x{d}) SYNC_FILE OOM error\n", .{@intFromPtr(this)});
                    return .{ .err = bun.sys.Error.oom };
                };
                const initial_len = remain.len;
                const fd: bun.FD = .fromUV(this.source.?.sync_file.file);
                mlog("WindowsStreamingWriter writeInternal(0x{d}) SYNC_FILE writing {} bytes to fd={}\n", .{ @intFromPtr(this), initial_len, fd.cast() });

                while (remain.len > 0) {
                    switch (fd.write(remain)) {
                        .err => |err| {
                            mlog("WindowsStreamingWriter writeInternal(0x{d}) SYNC_FILE write error: {}\n", .{ @intFromPtr(this), err });
                            return .{ .err = err };
                        },
                        .result => |wrote| {
                            mlog("WindowsStreamingWriter writeInternal(0x{d}) SYNC_FILE wrote {} bytes, {} remaining\n", .{ @intFromPtr(this), wrote, remain.len - wrote });
                            remain = remain[wrote..];
                            if (wrote == 0) {
                                mlog("WindowsStreamingWriter writeInternal(0x{d}) SYNC_FILE wrote 0, breaking\n", .{@intFromPtr(this)});
                                break;
                            }
                        },
                    }
                }

                const wrote = initial_len - remain.len;
                mlog("WindowsStreamingWriter writeInternal(0x{d}) SYNC_FILE total wrote={}\n", .{ @intFromPtr(this), wrote });
                if (wrote == 0) {
                    return .{ .done = wrote };
                }
                return .{ .wrote = wrote };
            }

            const had_buffered_data = this.outgoing.isNotEmpty();
            mlog("WindowsStreamingWriter writeInternal(0x{d}) ASYNC path: had_buffered_data={}, outgoing_size={}\n", .{ @intFromPtr(this), had_buffered_data, this.outgoing.size() });
            (if (comptime @TypeOf(writeFn) == @TypeOf(&StreamBuffer.writeLatin1) and writeFn == &StreamBuffer.writeLatin1)
                writeFn(&this.outgoing, buffer, true)
            else
                writeFn(&this.outgoing, buffer)) catch {
                mlog("WindowsStreamingWriter writeInternal(0x{d}) ASYNC OOM error during buffer write\n", .{@intFromPtr(this)});
                return .{ .err = bun.sys.Error.oom };
            };
            if (had_buffered_data) {
                mlog("WindowsStreamingWriter writeInternal(0x{d}) ASYNC had buffered data, returning pending\n", .{@intFromPtr(this)});
                return .{ .pending = 0 };
            }
            mlog("WindowsStreamingWriter writeInternal(0x{d}) ASYNC calling processSend\n", .{@intFromPtr(this)});
            this.processSend();
            return this.last_write_result;
        }

        pub fn writeUTF16(this: *WindowsWriter, buf: []const u16) WriteResult {
            mlog("WindowsStreamingWriter writeUTF16(0x{d}, buf.len={})\n", .{ @intFromPtr(this), buf.len });
            return writeInternal(this, buf, &StreamBuffer.writeUTF16);
        }

        pub fn writeLatin1(this: *WindowsWriter, buffer: []const u8) WriteResult {
            mlog("WindowsStreamingWriter writeLatin1(0x{d}, buffer.len={})\n", .{ @intFromPtr(this), buffer.len });
            return writeInternal(this, buffer, &StreamBuffer.writeLatin1);
        }

        pub fn write(this: *WindowsWriter, buffer: []const u8) WriteResult {
            mlog("WindowsStreamingWriter write(0x{d}, buffer.len={})\n", .{ @intFromPtr(this), buffer.len });
            return writeInternal(this, buffer, &StreamBuffer.write);
        }

        pub fn flush(this: *WindowsWriter) WriteResult {
            mlog("WindowsStreamingWriter flush(0x{d}) is_done={}\n", .{ @intFromPtr(this), this.is_done });
            if (this.is_done) {
                mlog("WindowsStreamingWriter flush(0x{d}) DONE path: already ended\n", .{@intFromPtr(this)});
                return .{ .done = 0 };
            }
            const has_pending = this.hasPendingData();
            if (!has_pending) {
                mlog("WindowsStreamingWriter flush(0x{d}) NO_PENDING path: no data to flush\n", .{@intFromPtr(this)});
                return .{ .wrote = 0 };
            }

            mlog("WindowsStreamingWriter flush(0x{d}) calling processSend\n", .{@intFromPtr(this)});
            this.processSend();
            return this.last_write_result;
        }

        pub fn end(this: *WindowsWriter) void {
            mlog("WindowsStreamingWriter end(0x{d}) is_done={}, owns_fd={}\n", .{ @intFromPtr(this), this.is_done, this.owns_fd });
            if (this.is_done) {
                mlog("WindowsStreamingWriter end(0x{d}) already done, returning\n", .{@intFromPtr(this)});
                return;
            }

            this.closed_without_reporting = false;
            this.is_done = true;

            const has_pending = this.hasPendingData();
            mlog("WindowsStreamingWriter end(0x{d}) hasPendingData={}\n", .{ @intFromPtr(this), has_pending });
            if (!has_pending) {
                if (!this.owns_fd) {
                    mlog("WindowsStreamingWriter end(0x{d}) not owning fd, returning\n", .{@intFromPtr(this)});
                    return;
                }
                mlog("WindowsStreamingWriter end(0x{d}) calling close\n", .{@intFromPtr(this)});
                this.close();
            } else {
                mlog("WindowsStreamingWriter end(0x{d}) has pending data, will close after writes complete\n", .{@intFromPtr(this)});
            }
        }
    };
}

pub const BufferedWriter = if (bun.Environment.isPosix) PosixBufferedWriter else WindowsBufferedWriter;
pub const StreamingWriter = if (bun.Environment.isPosix) PosixStreamingWriter else WindowsStreamingWriter;

const std = @import("std");
const Source = @import("./source.zig").Source;
const mlog = @import("../mlog.zig").log;

const FileType = @import("./pipes.zig").FileType;
const PollOrFd = @import("./pipes.zig").PollOrFd;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const OOM = bun.OOM;
const jsc = bun.jsc;
const uv = bun.windows.libuv;
