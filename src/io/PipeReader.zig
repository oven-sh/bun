// This is a runtime type instead of comptime due to bugs in Zig.
// https://github.com/ziglang/zig/issues/18664
const BufferedReaderVTable = struct {
    parent: *anyopaque = undefined,
    fns: *const Fn = undefined,

    pub fn init(comptime Type: type) BufferedReaderVTable {
        return .{
            .fns = Fn.init(Type),
        };
    }

    pub const Fn = struct {
        onReadChunk: ?*const fn (*anyopaque, chunk: []const u8, hasMore: ReadState) bool = null,
        onReaderDone: *const fn (*anyopaque) void,
        onReaderError: *const fn (*anyopaque, bun.sys.Error) void,
        loop: *const fn (*anyopaque) *Async.Loop,
        eventLoop: *const fn (*anyopaque) jsc.EventLoopHandle,

        pub fn init(comptime Type: type) *const BufferedReaderVTable.Fn {
            const fns = struct {
                fn onReadChunk(this: *anyopaque, chunk: []const u8, hasMore: ReadState) bool {
                    return Type.onReadChunk(@as(*Type, @ptrCast(@alignCast(this))), chunk, hasMore);
                }
                fn onReaderDone(this: *anyopaque) void {
                    return Type.onReaderDone(@as(*Type, @ptrCast(@alignCast(this))));
                }
                fn onReaderError(this: *anyopaque, err: bun.sys.Error) void {
                    return Type.onReaderError(@as(*Type, @ptrCast(@alignCast(this))), err);
                }
                fn eventLoop(this: *anyopaque) jsc.EventLoopHandle {
                    return jsc.EventLoopHandle.init(Type.eventLoop(@as(*Type, @ptrCast(@alignCast(this)))));
                }
                fn loop(this: *anyopaque) *Async.Loop {
                    return Type.loop(@as(*Type, @ptrCast(@alignCast(this))));
                }
            };
            return comptime &BufferedReaderVTable.Fn{
                .onReadChunk = if (@hasDecl(Type, "onReadChunk")) &fns.onReadChunk else null,
                .onReaderDone = &fns.onReaderDone,
                .onReaderError = &fns.onReaderError,
                .eventLoop = &fns.eventLoop,
                .loop = &fns.loop,
            };
        }
    };

    pub fn eventLoop(this: @This()) jsc.EventLoopHandle {
        return this.fns.eventLoop(this.parent);
    }

    pub fn loop(this: @This()) *Async.Loop {
        return this.fns.loop(this.parent);
    }

    pub fn isStreamingEnabled(this: @This()) bool {
        return this.fns.onReadChunk != null;
    }

    /// When the reader has read a chunk of data
    /// and hasMore is true, it means that there might be more data to read.
    ///
    /// Returning false prevents the reader from reading more data.
    pub fn onReadChunk(this: @This(), chunk: []const u8, hasMore: ReadState) bool {
        return this.fns.onReadChunk.?(this.parent, chunk, hasMore);
    }

    pub fn onReaderDone(this: @This()) void {
        this.fns.onReaderDone(this.parent);
    }

    pub fn onReaderError(this: @This(), err: bun.sys.Error) void {
        this.fns.onReaderError(this.parent, err);
    }
};

const PosixBufferedReader = struct {
    handle: PollOrFd = .{ .closed = {} },
    _buffer: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),
    _offset: usize = 0,
    vtable: BufferedReaderVTable,
    flags: Flags = .{},
    count: usize = 0,
    maxbuf: ?*MaxBuf = null,

    const Flags = packed struct(u16) {
        is_done: bool = false,
        pollable: bool = false,
        nonblocking: bool = false,
        socket: bool = false,
        received_eof: bool = false,
        closed_without_reporting: bool = false,
        close_handle: bool = true,
        memfd: bool = false,
        use_pread: bool = false,
        is_paused: bool = false,
        _: u6 = 0,
    };

    pub fn init(comptime Type: type) PosixBufferedReader {
        return .{
            .vtable = BufferedReaderVTable.init(Type),
        };
    }

    pub fn updateRef(this: *const PosixBufferedReader, value: bool) void {
        const poll = this.handle.getPoll() orelse return;
        poll.setKeepingProcessAlive(this.vtable.eventLoop(), value);
    }

    pub inline fn isDone(this: *const PosixBufferedReader) bool {
        return this.flags.is_done or this.flags.received_eof or this.flags.closed_without_reporting;
    }

    pub fn memoryCost(this: *const PosixBufferedReader) usize {
        return @sizeOf(@This()) + this._buffer.capacity;
    }

    pub fn from(to: *@This(), other: *PosixBufferedReader, parent_: *anyopaque) void {
        to.* = .{
            .handle = other.handle,
            ._buffer = other.buffer().*,
            ._offset = other._offset,
            .flags = other.flags,
            .vtable = .{
                .fns = to.vtable.fns,
                .parent = parent_,
            },
        };
        other.buffer().* = std.array_list.Managed(u8).init(bun.default_allocator);
        other.flags.is_done = true;
        other.handle = .{ .closed = {} };
        other._offset = 0;
        MaxBuf.transferToPipereader(&other.maxbuf, &to.maxbuf);
        to.handle.setOwner(to);

        // note: the caller is supposed to drain the buffer themselves
        // doing it here automatically makes it very easy to end up reading from the same buffer multiple times.
    }

    pub fn setParent(this: *PosixBufferedReader, parent_: *anyopaque) void {
        this.vtable.parent = parent_;
        this.handle.setOwner(this);
    }

    pub fn startMemfd(this: *PosixBufferedReader, fd: bun.FileDescriptor) void {
        this.flags.memfd = true;
        this.handle = .{ .fd = fd };
    }

    pub fn getFileType(this: *const PosixBufferedReader) FileType {
        const flags = this.flags;
        if (flags.socket) {
            return .socket;
        }

        if (flags.pollable) {
            if (flags.nonblocking) {
                return .nonblocking_pipe;
            }

            return .pipe;
        }

        return .file;
    }

    pub fn close(this: *PosixBufferedReader) void {
        this.closeHandle();
    }

    fn closeWithoutReporting(this: *PosixBufferedReader) void {
        if (this.getFd() != bun.invalid_fd) {
            bun.assert(!this.flags.closed_without_reporting);
            this.flags.closed_without_reporting = true;
            if (this.flags.close_handle) this.handle.close(this, {});
        }
    }

    pub fn getFd(this: *PosixBufferedReader) bun.FileDescriptor {
        return this.handle.getFd();
    }

    pub fn pause(this: *PosixBufferedReader) void {
        if (this.flags.is_paused) return;
        this.flags.is_paused = true;

        // Unregister the FilePoll if it's registered
        if (this.handle == .poll) {
            if (this.handle.poll.isRegistered()) {
                _ = this.handle.poll.unregister(this.loop(), false);
            }
        }
    }

    pub fn unpause(this: *PosixBufferedReader) void {
        if (!this.flags.is_paused) return;
        this.flags.is_paused = false;
        // The next read() call will re-register the poll if needed
    }

    pub fn takeBuffer(this: *PosixBufferedReader) std.array_list.Managed(u8) {
        const out = this._buffer;
        this._buffer = std.array_list.Managed(u8).init(out.allocator);
        return out;
    }

    pub fn buffer(this: *PosixBufferedReader) *std.array_list.Managed(u8) {
        return &this._buffer;
    }

    pub fn finalBuffer(this: *PosixBufferedReader) *std.array_list.Managed(u8) {
        if (this.flags.memfd and this.handle == .fd) {
            defer this.handle.close(null, {});
            _ = bun.sys.File.readToEndWithArrayList(.{ .handle = this.handle.fd }, this.buffer(), .unknown_size).unwrap() catch |err| {
                bun.Output.debugWarn("error reading from memfd\n{}", .{err});
                return this.buffer();
            };
        }

        return this.buffer();
    }

    pub fn disableKeepingProcessAlive(this: *@This(), event_loop_ctx: anytype) void {
        _ = event_loop_ctx; // autofix
        this.updateRef(false);
    }

    pub fn enableKeepingProcessAlive(this: *@This(), event_loop_ctx: anytype) void {
        _ = event_loop_ctx; // autofix
        this.updateRef(true);
    }

    fn finish(this: *PosixBufferedReader) void {
        if (this.handle != .closed or this.flags.closed_without_reporting) {
            if (this.flags.close_handle) this.closeHandle();
            return;
        }

        bun.assert(!this.flags.is_done);
        this.flags.is_done = true;
        this._buffer.shrinkAndFree(this._buffer.items.len);
    }

    fn closeHandle(this: *PosixBufferedReader) void {
        if (this.flags.closed_without_reporting) {
            this.flags.closed_without_reporting = false;
            this.done();
            return;
        }

        if (this.flags.close_handle) this.handle.close(this, done);
    }

    pub fn done(this: *PosixBufferedReader) void {
        if (this.handle != .closed and this.flags.close_handle) {
            this.closeHandle();
            return;
        } else if (this.flags.closed_without_reporting) {
            this.flags.closed_without_reporting = false;
        }
        this.finish();
        this.vtable.onReaderDone();
    }

    pub fn deinit(this: *PosixBufferedReader) void {
        MaxBuf.removeFromPipereader(&this.maxbuf);
        this.buffer().clearAndFree();
        this.closeWithoutReporting();
    }

    pub fn onError(this: *PosixBufferedReader, err: bun.sys.Error) void {
        this.vtable.onReaderError(err);
    }

    pub fn registerPoll(this: *PosixBufferedReader) void {
        const poll = this.handle.getPoll() orelse brk: {
            if (this.handle == .fd and this.flags.pollable) {
                const fd = this.handle.fd;
                this.handle = .{ .poll = Async.FilePoll.init(this.eventLoop(), fd, .{}, @This(), this) };
                break :brk this.handle.poll;
            }

            return;
        };
        poll.owner.set(this);

        if (!poll.flags.contains(.was_ever_registered))
            poll.enableKeepingProcessAlive(this.eventLoop());

        switch (poll.registerWithFd(this.loop(), .readable, .dispatch, poll.fd)) {
            .err => |err| {
                this.onError(err);
            },
            .result => {},
        }
    }

    pub fn start(this: *PosixBufferedReader, fd: bun.FileDescriptor, is_pollable: bool) bun.sys.Maybe(void) {
        if (!is_pollable) {
            this.buffer().clearRetainingCapacity();
            this.flags.is_done = false;
            this.handle.close(null, {});
            this.handle = .{ .fd = fd };
            return .success;
        }
        this.flags.pollable = true;
        if (this.getFd() != fd) {
            this.handle = .{ .fd = fd };
        }
        this.registerPoll();

        return .{
            .result = {},
        };
    }

    pub fn startFileOffset(this: *PosixBufferedReader, fd: bun.FileDescriptor, poll: bool, offset: usize) bun.sys.Maybe(void) {
        this._offset = offset;
        this.flags.use_pread = true;
        return this.start(fd, poll);
    }

    // Exists for consistently with Windows.
    pub fn hasPendingRead(this: *const PosixBufferedReader) bool {
        return this.handle == .poll and this.handle.poll.isRegistered();
    }

    pub fn watch(this: *PosixBufferedReader) void {
        if (this.flags.pollable) {
            this.registerPoll();
        }
    }

    pub fn hasPendingActivity(this: *const PosixBufferedReader) bool {
        return switch (this.handle) {
            .poll => |poll| poll.isActive(),
            .fd => true,
            else => false,
        };
    }

    pub fn loop(this: *const PosixBufferedReader) *Async.Loop {
        return this.vtable.loop();
    }

    pub fn eventLoop(this: *const PosixBufferedReader) jsc.EventLoopHandle {
        return this.vtable.eventLoop();
    }

    pub fn read(this: *PosixBufferedReader) void {
        // Don't initiate new reads if paused
        if (this.flags.is_paused) {
            return;
        }

        const buf = this.buffer();
        const fd = this.getFd();

        switch (this.getFileType()) {
            .nonblocking_pipe => {
                readPipe(this, buf, fd, 0, false);
                return;
            },
            .file => {
                readFile(this, buf, fd, 0, false);
                return;
            },
            .socket => {
                readSocket(this, buf, fd, 0, false);
                return;
            },
            .pipe => {
                switch (bun.isReadable(fd)) {
                    .ready => {
                        readFromBlockingPipeWithoutBlocking(this, buf, fd, 0, false);
                    },
                    .hup => {
                        readFromBlockingPipeWithoutBlocking(this, buf, fd, 0, true);
                    },
                    .not_ready => {
                        this.registerPoll();
                    },
                }
            },
        }
    }

    pub fn onPoll(parent: *PosixBufferedReader, size_hint: isize, received_hup: bool) void {
        const resizable_buffer = parent.buffer();
        const fd = parent.getFd();
        bun.sys.syslog("onPoll({f}) = {d}", .{ fd, size_hint });

        switch (parent.getFileType()) {
            .nonblocking_pipe => {
                readPipe(parent, resizable_buffer, fd, size_hint, received_hup);
            },
            .file => {
                readFile(parent, resizable_buffer, fd, size_hint, received_hup);
            },
            .socket => {
                readSocket(parent, resizable_buffer, fd, size_hint, received_hup);
            },
            .pipe => {
                readFromBlockingPipeWithoutBlocking(parent, resizable_buffer, fd, size_hint, received_hup);
            },
        }
    }

    inline fn drainChunk(parent: *PosixBufferedReader, chunk: []const u8, hasMore: ReadState) bool {
        if (parent.vtable.isStreamingEnabled()) {
            if (chunk.len > 0) {
                return parent.vtable.onReadChunk(chunk, hasMore);
            }
        }

        return false;
    }

    fn wrapReadFn(comptime func: *const fn (bun.FileDescriptor, []u8) bun.sys.Maybe(usize)) *const fn (bun.FileDescriptor, []u8, usize) bun.sys.Maybe(usize) {
        return struct {
            pub fn call(fd: bun.FileDescriptor, buf: []u8, offset: usize) bun.sys.Maybe(usize) {
                _ = offset;
                return func(fd, buf);
            }
        }.call;
    }

    fn readFile(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FileDescriptor, size_hint: isize, received_hup: bool) void {
        const preadFn = struct {
            pub fn call(fd1: bun.FileDescriptor, buf: []u8, offset: usize) bun.sys.Maybe(usize) {
                return bun.sys.pread(fd1, buf, @intCast(offset));
            }
        }.call;
        if (parent.flags.use_pread) {
            return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .file, preadFn);
        } else {
            return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .file, wrapReadFn(bun.sys.read));
        }
    }

    fn readSocket(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FileDescriptor, size_hint: isize, received_hup: bool) void {
        return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .socket, wrapReadFn(bun.sys.recvNonBlock));
    }

    fn readPipe(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FileDescriptor, size_hint: isize, received_hup: bool) void {
        return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .nonblocking_pipe, wrapReadFn(bun.sys.readNonblocking));
    }

    fn readBlockingPipe(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FileDescriptor, _: isize, received_hup: bool) void {
        while (true) {
            const streaming = parent.vtable.isStreamingEnabled();

            if (resizable_buffer.capacity == 0) {
                // Use stack buffer for streaming
                const stack_buffer = parent.vtable.eventLoop().pipeReadBuffer();

                switch (bun.sys.readNonblocking(fd, stack_buffer)) {
                    .result => |bytes_read| {
                        if (parent.maxbuf) |l| l.onReadBytes(bytes_read);

                        if (bytes_read == 0) {
                            // EOF - finished and closed pipe
                            parent.closeWithoutReporting();
                            if (!parent.flags.is_done)
                                parent.done();
                            return;
                        }

                        if (streaming) {
                            // Stream this chunk and register for next cycle
                            _ = parent.vtable.onReadChunk(stack_buffer[0..bytes_read], if (received_hup and bytes_read < stack_buffer.len) .eof else .progress);
                        } else {
                            bun.handleOom(resizable_buffer.appendSlice(stack_buffer[0..bytes_read]));
                        }
                    },
                    .err => |err| {
                        if (!err.isRetry()) {
                            parent.onError(err);
                            return;
                        }
                        // EAGAIN - fall through to register for next poll
                    },
                }
            } else {
                bun.handleOom(resizable_buffer.ensureUnusedCapacity(16 * 1024));
                var buf: []u8 = resizable_buffer.unusedCapacitySlice();

                switch (bun.sys.readNonblocking(fd, buf)) {
                    .result => |bytes_read| {
                        if (parent.maxbuf) |l| l.onReadBytes(bytes_read);
                        parent._offset += bytes_read;
                        resizable_buffer.items.len += bytes_read;

                        if (bytes_read == 0) {
                            parent.closeWithoutReporting();
                            if (!parent.flags.is_done)
                                parent.done();
                            return;
                        }

                        if (streaming) {
                            if (!parent.vtable.onReadChunk(buf[0..bytes_read], if (received_hup and bytes_read < buf.len) .eof else .progress)) {
                                return;
                            }
                        }
                    },
                    .err => |err| {
                        if (!err.isRetry()) {
                            parent.onError(err);
                            return;
                        }
                    },
                }
            }

            // Register for next poll cycle unless we got HUP
            if (!received_hup) {
                parent.registerPoll();
                return;
            }

            // We have received HUP but have not consumed it yet. We can't register for next poll cycle.
            // We need to keep going.
        }
    }

    fn readWithFn(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FileDescriptor, size_hint: isize, received_hup: bool, comptime file_type: FileType, comptime sys_fn: *const fn (bun.FileDescriptor, []u8, usize) bun.sys.Maybe(usize)) void {
        _ = size_hint; // autofix
        const streaming = parent.vtable.isStreamingEnabled();

        if (streaming) {
            const stack_buffer = parent.vtable.eventLoop().pipeReadBuffer();
            while (resizable_buffer.capacity == 0) {
                const stack_buffer_cutoff = stack_buffer.len / 2;
                var stack_buffer_head = stack_buffer;
                while (stack_buffer_head.len > 16 * 1024) {
                    var buf = stack_buffer_head;

                    switch (sys_fn(
                        fd,
                        buf,
                        parent._offset,
                    )) {
                        .result => |bytes_read| {
                            if (parent.maxbuf) |l| l.onReadBytes(bytes_read);
                            parent._offset += bytes_read;
                            buf = stack_buffer_head[0..bytes_read];
                            stack_buffer_head = stack_buffer_head[bytes_read..];

                            if (bytes_read == 0) {
                                parent.closeWithoutReporting();
                                if (stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len].len > 0)
                                    _ = parent.vtable.onReadChunk(stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len], .eof);
                                if (!parent.flags.is_done)
                                    parent.done();
                                return;
                            }

                            // Keep reading as much as we can
                            if (stack_buffer_head.len < stack_buffer_cutoff) {
                                if (!parent.vtable.onReadChunk(stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len], if (received_hup) .eof else .progress)) {
                                    return;
                                }
                                stack_buffer_head = stack_buffer;
                            }
                        },
                        .err => |err| {
                            if (err.isRetry()) {
                                if (comptime file_type == .file) {
                                    bun.Output.debugWarn("Received EAGAIN while reading from a file. This is a bug.", .{});
                                } else {
                                    parent.registerPoll();
                                }

                                if (stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len].len > 0)
                                    _ = parent.vtable.onReadChunk(stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len], .drained);
                                return;
                            }

                            if (stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len].len > 0)
                                _ = parent.vtable.onReadChunk(stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len], .progress);
                            parent.onError(err);
                            return;
                        },
                    }
                }

                if (stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len].len > 0) {
                    if (!parent.vtable.onReadChunk(stack_buffer[0 .. stack_buffer.len - stack_buffer_head.len], if (received_hup) .eof else .progress) and !received_hup) {
                        return;
                    }
                }

                if (!parent.vtable.isStreamingEnabled()) break;
            }
        } else if (resizable_buffer.capacity == 0 and parent._offset == 0) {
            // Avoid a 16 KB dynamic memory allocation when the buffer might very well be empty.
            const stack_buffer = parent.vtable.eventLoop().pipeReadBuffer();

            // Unlike the block of code following this one, only handle the non-streaming case.
            bun.debugAssert(!streaming);

            switch (sys_fn(fd, stack_buffer, 0)) {
                .result => |bytes_read| {
                    if (bytes_read > 0) {
                        bun.handleOom(resizable_buffer.appendSlice(stack_buffer[0..bytes_read]));
                    }
                    if (parent.maxbuf) |l| l.onReadBytes(bytes_read);
                    parent._offset += bytes_read;

                    if (bytes_read == 0) {
                        parent.closeWithoutReporting();
                        _ = drainChunk(parent, resizable_buffer.items, .eof);
                        if (!parent.flags.is_done)
                            parent.done();
                        return;
                    }
                },
                .err => |err| {
                    if (err.isRetry()) {
                        if (comptime file_type == .file) {
                            bun.Output.debugWarn("Received EAGAIN while reading from a file. This is a bug.", .{});
                        } else {
                            parent.registerPoll();
                        }
                        return;
                    }
                    parent.onError(err);
                    return;
                },
            }

            // Allow falling through
        }

        while (true) {
            bun.handleOom(resizable_buffer.ensureUnusedCapacity(16 * 1024));
            var buf: []u8 = resizable_buffer.unusedCapacitySlice();

            switch (sys_fn(fd, buf, parent._offset)) {
                .result => |bytes_read| {
                    if (parent.maxbuf) |l| l.onReadBytes(bytes_read);
                    parent._offset += bytes_read;
                    buf = buf[0..bytes_read];
                    resizable_buffer.items.len += bytes_read;

                    if (bytes_read == 0) {
                        parent.closeWithoutReporting();
                        _ = drainChunk(parent, resizable_buffer.items, .eof);
                        if (!parent.flags.is_done)
                            parent.done();
                        return;
                    }

                    if (parent.vtable.isStreamingEnabled()) {
                        if (resizable_buffer.items.len > 128_000) {
                            defer {
                                resizable_buffer.clearRetainingCapacity();
                            }
                            if (!parent.vtable.onReadChunk(resizable_buffer.items, .progress)) {
                                return;
                            }

                            continue;
                        }
                    }
                },
                .err => |err| {
                    if (parent.vtable.isStreamingEnabled()) {
                        if (resizable_buffer.items.len > 0) {
                            _ = parent.vtable.onReadChunk(resizable_buffer.items, .drained);
                            resizable_buffer.clearRetainingCapacity();
                        }
                    }

                    if (err.isRetry()) {
                        if (comptime file_type == .file) {
                            bun.Output.debugWarn("Received EAGAIN while reading from a file. This is a bug.", .{});
                        } else {
                            parent.registerPoll();
                        }
                        return;
                    }
                    parent.onError(err);
                    return;
                },
            }
        }
    }

    fn readFromBlockingPipeWithoutBlocking(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FileDescriptor, size_hint: isize, received_hup: bool) void {
        if (parent.vtable.isStreamingEnabled()) {
            resizable_buffer.clearRetainingCapacity();
        }

        readBlockingPipe(parent, resizable_buffer, fd, size_hint, received_hup);
    }

    comptime {
        bun.meta.banFieldType(@This(), bool); // put them in flags instead.
    }
};

const WindowsBufferedReaderVTable = struct {
    onReaderDone: *const fn (*anyopaque) void,
    onReaderError: *const fn (*anyopaque, bun.sys.Error) void,
    onReadChunk: ?*const fn (
        *anyopaque,
        chunk: []const u8,
        hasMore: ReadState,
    ) bool = null,
    loop: *const fn (*anyopaque) *Async.Loop,
};

pub const WindowsBufferedReader = struct {
    /// The pointer to this pipe must be stable.
    /// It cannot change because we don't know what libuv will do with it.
    source: ?Source = null,
    _offset: usize = 0,
    _buffer: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),
    // for compatibility with Linux
    flags: Flags = .{},
    maxbuf: ?*MaxBuf = null,

    parent: *anyopaque = undefined,
    vtable: WindowsBufferedReaderVTable = undefined,

    pub fn memoryCost(this: *const WindowsBufferedReader) usize {
        return @sizeOf(@This()) + this._buffer.capacity;
    }

    const Flags = packed struct(u16) {
        is_done: bool = false,
        pollable: bool = false,
        nonblocking: bool = false,
        received_eof: bool = false,
        closed_without_reporting: bool = false,
        close_handle: bool = true,

        is_paused: bool = true,
        has_inflight_read: bool = false,
        use_pread: bool = false,

        /// When true, wait for the file operation callback before calling done().
        /// Used to ensure proper cleanup ordering when closing during cancellation.
        defer_done_callback: bool = false,
        _: u6 = 0,
    };

    pub fn init(comptime Type: type) WindowsBufferedReader {
        const fns = struct {
            fn onReadChunk(this: *anyopaque, chunk: []const u8, hasMore: ReadState) bool {
                return Type.onReadChunk(@as(*Type, @ptrCast(@alignCast(this))), chunk, hasMore);
            }
            fn onReaderDone(this: *anyopaque) void {
                return Type.onReaderDone(@as(*Type, @ptrCast(@alignCast(this))));
            }
            fn onReaderError(this: *anyopaque, err: bun.sys.Error) void {
                return Type.onReaderError(@as(*Type, @ptrCast(@alignCast(this))), err);
            }
            fn loop(this: *anyopaque) *Async.Loop {
                return Type.loop(@as(*Type, @alignCast(@ptrCast(this))));
            }
        };
        return .{
            .vtable = .{
                .onReadChunk = if (@hasDecl(Type, "onReadChunk")) &fns.onReadChunk else null,
                .onReaderDone = &fns.onReaderDone,
                .onReaderError = &fns.onReaderError,
                .loop = &fns.loop,
            },
        };
    }

    pub inline fn isDone(this: *WindowsBufferedReader) bool {
        return this.flags.is_done or this.flags.received_eof or this.flags.closed_without_reporting;
    }

    pub fn from(to: *WindowsBufferedReader, other: anytype, parent: anytype) void {
        bun.assert(other.source != null and to.source == null);
        to.* = .{
            .vtable = to.vtable,
            .flags = other.flags,
            ._buffer = other.buffer().*,
            ._offset = other._offset,
            .source = other.source,
        };
        other.flags.is_done = true;
        other._offset = 0;
        other.buffer().* = std.array_list.Managed(u8).init(bun.default_allocator);
        other.source = null;
        MaxBuf.transferToPipereader(&other.maxbuf, &to.maxbuf);
        to.setParent(parent);
    }

    pub fn getFd(this: *const WindowsBufferedReader) bun.FileDescriptor {
        const source = this.source orelse return bun.invalid_fd;
        return source.getFd();
    }

    pub fn watch(_: *WindowsBufferedReader) void {
        // No-op on windows.
    }

    pub fn setParent(this: *WindowsBufferedReader, parent: anytype) void {
        this.parent = parent;
        if (!this.flags.is_done) {
            if (this.source) |source| {
                source.setData(this);
            }
        }
    }

    pub fn updateRef(this: *WindowsBufferedReader, value: bool) void {
        if (this.source) |source| {
            if (value) {
                source.ref();
            } else {
                source.unref();
            }
        }
    }

    pub fn enableKeepingProcessAlive(this: *WindowsBufferedReader, _: anytype) void {
        this.updateRef(true);
    }

    pub fn disableKeepingProcessAlive(this: *WindowsBufferedReader, _: anytype) void {
        this.updateRef(false);
    }

    pub fn takeBuffer(this: *WindowsBufferedReader) std.array_list.Managed(u8) {
        const out = this._buffer;
        this._buffer = std.array_list.Managed(u8).init(out.allocator);
        return out;
    }

    pub fn buffer(this: *WindowsBufferedReader) *std.array_list.Managed(u8) {
        return &this._buffer;
    }

    pub const finalBuffer = buffer;

    pub fn hasPendingActivity(this: *const WindowsBufferedReader) bool {
        const source = this.source orelse return false;
        return source.isActive();
    }

    pub fn hasPendingRead(this: *const WindowsBufferedReader) bool {
        if (this.flags.has_inflight_read) return true;
        const source = this.source orelse return false;
        return switch (source) {
            .file, .sync_file => |file| file.state != .deinitialized,
            else => false,
        };
    }

    fn _onReadChunk(this: *WindowsBufferedReader, buf: []u8, hasMore: ReadState) bool {
        if (this.maxbuf) |m| m.onReadBytes(buf.len);

        if (hasMore == .eof) {
            this.flags.received_eof = true;
        }

        const onReadChunkFn = this.vtable.onReadChunk orelse {
            this.flags.has_inflight_read = false;
            return true;
        };
        const result = onReadChunkFn(this.parent, buf, hasMore);
        // Clear has_inflight_read after the callback completes to prevent
        // libuv from starting a new read while we're still processing data
        this.flags.has_inflight_read = false;
        return result;
    }

    fn finish(this: *WindowsBufferedReader) void {
        this.flags.has_inflight_read = false;
        this.flags.is_done = true;
        this._buffer.shrinkAndFree(this._buffer.items.len);
    }

    pub fn done(this: *WindowsBufferedReader) void {
        if (this.source) |source| bun.assert(source.isClosed());

        this.finish();

        this.vtable.onReaderDone(this.parent);
    }

    pub fn onError(this: *WindowsBufferedReader, err: bun.sys.Error) void {
        this.finish();
        this.vtable.onReaderError(this.parent, err);
    }

    pub fn getReadBufferWithStableMemoryAddress(this: *WindowsBufferedReader, suggested_size: usize) []u8 {
        this.flags.has_inflight_read = true;
        bun.handleOom(this._buffer.ensureUnusedCapacity(suggested_size));
        const res = this._buffer.allocatedSlice()[this._buffer.items.len..];
        return res;
    }

    pub fn startWithCurrentPipe(this: *WindowsBufferedReader) bun.sys.Maybe(void) {
        bun.assert(!this.source.?.isClosed());
        this.source.?.setData(this);
        this.buffer().clearRetainingCapacity();
        this.flags.is_done = false;
        return this.startReading();
    }

    pub fn startWithPipe(this: *WindowsBufferedReader, pipe: *uv.Pipe) bun.sys.Maybe(void) {
        this.source = .{ .pipe = pipe };
        return this.startWithCurrentPipe();
    }

    pub fn start(this: *WindowsBufferedReader, fd: bun.FileDescriptor, _: bool) bun.sys.Maybe(void) {
        bun.assert(this.source == null);
        // Use the event loop from the parent, not the global one
        // This is critical for spawnSync to use its isolated loop
        const loop = this.vtable.loop(this.parent);
        const source = switch (Source.open(loop, fd)) {
            .err => |err| return .{ .err = err },
            .result => |source| source,
        };
        source.setData(this);
        this.source = source;
        return this.startWithCurrentPipe();
    }

    pub fn startFileOffset(this: *WindowsBufferedReader, fd: bun.FileDescriptor, poll: bool, offset: usize) bun.sys.Maybe(void) {
        this._offset = offset;
        this.flags.use_pread = true;
        return this.start(fd, poll);
    }

    pub fn deinit(this: *WindowsBufferedReader) void {
        MaxBuf.removeFromPipereader(&this.maxbuf);
        this.buffer().deinit();
        const source = this.source orelse return;
        this.source = null;
        if (!source.isClosed()) {
            // closeImpl will take care of freeing the source
            this.closeImpl(false);
        }
    }

    pub fn setRawMode(this: *WindowsBufferedReader, value: bool) bun.sys.Maybe(void) {
        const source = this.source orelse return .{
            .err = .{
                .errno = @intFromEnum(bun.sys.E.BADF),
                .syscall = .uv_tty_set_mode,
            },
        };
        return source.setRawMode(value);
    }

    fn onStreamAlloc(handle: *uv.Handle, suggested_size: usize, buf: *uv.uv_buf_t) callconv(.c) void {
        var this = bun.cast(*WindowsBufferedReader, handle.data);
        const result = this.getReadBufferWithStableMemoryAddress(suggested_size);
        buf.* = uv.uv_buf_t.init(result);
    }

    fn onStreamRead(handle: *uv.uv_handle_t, nread: uv.ReturnCodeI64, buf: *const uv.uv_buf_t) callconv(.c) void {
        const stream = bun.cast(*uv.uv_stream_t, handle);
        var this = bun.cast(*WindowsBufferedReader, stream.data);

        const nread_int = nread.int();

        bun.sys.syslog("onStreamRead(0x{d}) = {d}", .{ @intFromPtr(this), nread_int });

        // NOTE: pipes/tty need to call stopReading on errors (yeah)
        switch (nread_int) {
            0 => {
                // EAGAIN or EWOULDBLOCK or canceled  (buf is not safe to access here)
                // With libuv 1.51.0+, calling onRead(.drained) here causes a race condition
                // where subsequent reads return truncated data (see logs showing 6024 instead
                // of 74468 bytes). Just ignore 0-byte reads and let libuv continue.
                return;
            },
            uv.UV_EOF => {
                _ = this.stopReading();
                // EOF (buf is not safe to access here)
                return this.onRead(.{ .result = 0 }, "", .eof);
            },
            else => {
                if (nread.toError(.recv)) |err| {
                    _ = this.stopReading();
                    // ERROR (buf is not safe to access here)
                    this.onRead(.{ .err = err }, "", .progress);
                    return;
                }
                // we got some data we can slice the buffer!
                const len: usize = @intCast(nread_int);
                var slice = buf.slice();
                this.onRead(.{ .result = len }, slice[0..len], .progress);
            },
        }
    }

    /// Callback fired when a file read operation completes or is canceled.
    /// Handles cleanup, cancellation, and normal read processing.
    fn onFileRead(fs: *uv.fs_t) callconv(.c) void {
        const file = Source.File.fromFS(fs);
        const result = fs.result;
        const nread_int = result.int();
        const was_canceled = nread_int == uv.UV_ECANCELED;

        bun.sys.syslog("onFileRead({f}) = {d}", .{ bun.FD.fromUV(fs.file.fd), nread_int });

        // Get parent before completing (fs.data may be null if detached)
        const parent_ptr = fs.data;

        // ALWAYS complete the read first (cleans up fs_t, updates state)
        file.complete(was_canceled);

        // If detached, file should be closing itself now
        if (parent_ptr == null) {
            bun.assert(file.state == .closing); // complete should have started close
            return;
        }

        var this: *WindowsBufferedReader = bun.cast(*WindowsBufferedReader, parent_ptr);

        // Mark no longer in flight
        this.flags.has_inflight_read = false;

        // If canceled, check if we need to call deferred done
        if (was_canceled) {
            if (this.flags.defer_done_callback) {
                this.flags.defer_done_callback = false;
                // Now safe to call done - buffer will be freed by deinit
                this.closeImpl(true);
            } else {
                this.buffer().clearRetainingCapacity();
            }
            return;
        }

        if (this.flags.is_done) return;

        switch (nread_int) {
            // 0 actually means EOF too
            0, uv.UV_EOF => {
                this.flags.is_paused = true;
                this.onRead(.{ .result = 0 }, "", .eof);
            },
            // UV_ECANCELED needs to be on the top so we avoid UAF
            uv.UV_ECANCELED => unreachable,
            else => {
                if (result.toError(.read)) |err| {
                    this.flags.is_paused = true;
                    this.onRead(.{ .err = err }, "", .progress);
                    return;
                }
                defer {
                    // if we are not paused we keep reading until EOF or err
                    if (!this.flags.is_paused) {
                        if (this.source) |source| {
                            if (source == .file) {
                                const file_ptr = source.file;

                                // Can only start if file is in deinitialized state
                                if (file_ptr.canStart()) {
                                    source.setData(this);
                                    file_ptr.prepare();
                                    const buf = this.getReadBufferWithStableMemoryAddress(64 * 1024);
                                    file_ptr.iov = uv.uv_buf_t.init(buf);
                                    this.flags.has_inflight_read = true;

                                    if (uv.uv_fs_read(this.vtable.loop(this.parent), &file_ptr.fs, file_ptr.file, @ptrCast(&file_ptr.iov), 1, if (this.flags.use_pread) @intCast(this._offset) else -1, onFileRead).toError(.write)) |err| {
                                        file_ptr.complete(false);
                                        this.flags.has_inflight_read = false;
                                        this.flags.is_paused = true;
                                        // we should inform the error if we are unable to keep reading
                                        this.onRead(.{ .err = err }, "", .progress);
                                    }
                                }
                            }
                        }
                    }
                }

                const len: usize = @intCast(nread_int);
                this._offset += len;
                // we got some data lets get the current iov
                if (this.source) |source| {
                    if (source == .file) {
                        var buf = source.file.iov.slice();
                        return this.onRead(.{ .result = len }, buf[0..len], .progress);
                    }
                }
                // ops we should not hit this lets fail with EPIPE
                bun.assert(false);
                return this.onRead(.{ .err = bun.sys.Error.fromCode(bun.sys.E.PIPE, .read) }, "", .progress);
            },
        }
    }

    pub fn startReading(this: *WindowsBufferedReader) bun.sys.Maybe(void) {
        if (this.flags.is_done or !this.flags.is_paused) return .success;
        this.flags.is_paused = false;
        const source: Source = this.source orelse return .{ .err = bun.sys.Error.fromCode(bun.sys.E.BADF, .read) };
        bun.assert(!source.isClosed());

        switch (source) {
            .file => |file| {
                // If already reading, just set data and unpause
                if (!file.canStart()) {
                    source.setData(this);
                    return .success;
                }

                // Start new read - set data before prepare
                source.setData(this);
                file.prepare();
                const buf = this.getReadBufferWithStableMemoryAddress(64 * 1024);
                file.iov = uv.uv_buf_t.init(buf);
                this.flags.has_inflight_read = true;

                if (uv.uv_fs_read(this.vtable.loop(this.parent), &file.fs, file.file, @ptrCast(&file.iov), 1, if (this.flags.use_pread) @intCast(this._offset) else -1, onFileRead).toError(.write)) |err| {
                    file.complete(false);
                    this.flags.has_inflight_read = false;
                    return .{ .err = err };
                }
            },
            else => {
                if (uv.uv_read_start(source.toStream(), &onStreamAlloc, &onStreamRead).toError(.open)) |err| {
                    bun.windows.libuv.log("uv_read_start() = {s}", .{err.name()});
                    return .{ .err = err };
                }
            },
        }

        return .success;
    }

    pub fn stopReading(this: *WindowsBufferedReader) bun.sys.Maybe(void) {
        if (this.flags.is_done or this.flags.is_paused) return .success;
        this.flags.is_paused = true;
        const source = this.source orelse return .success;
        switch (source) {
            .file => |file| {
                file.stop();
            },
            else => {
                source.toStream().readStop();
            },
        }
        return .success;
    }

    pub fn closeImpl(this: *WindowsBufferedReader, comptime callDone: bool) void {
        if (this.source) |source| {
            switch (source) {
                .sync_file, .file => |file| {
                    // Detach - file will close itself after operation completes
                    file.detach();
                },
                .pipe => |pipe| {
                    pipe.data = pipe;
                    this.flags.is_paused = true;
                    pipe.close(onPipeClose);
                },
                .tty => |tty| {
                    if (Source.StdinTTY.isStdinTTY(tty)) {
                        // Node only ever closes stdin on process exit.
                    } else {
                        tty.data = tty;
                        tty.close(onTTYClose);
                    }

                    this.flags.is_paused = true;
                },
            }
            this.source = null;
            if (comptime callDone) this.done();
        }
    }

    /// Close the reader and call the done callback.
    /// If a file operation is in progress, defers the done callback until
    /// the operation completes to ensure proper cleanup ordering.
    pub fn close(this: *WindowsBufferedReader) void {
        _ = this.stopReading();

        // Check if we have a pending file operation
        if (this.source) |source| {
            if (source == .file or source == .sync_file) {
                const file = source.file;
                // Defer done if operation is in progress (whether cancel succeeded or failed)
                if (file.state == .canceling or file.state == .operating) {
                    this.flags.defer_done_callback = true;
                    return; // Don't call closeImpl yet - wait for operation callback
                }
            }
        }

        this.closeImpl(true);
    }

    fn onPipeClose(handle: *uv.Pipe) callconv(.c) void {
        const this = bun.cast(*uv.Pipe, handle.data);
        bun.default_allocator.destroy(this);
    }

    fn onTTYClose(handle: *uv.uv_tty_t) callconv(.c) void {
        const this = bun.cast(*uv.uv_tty_t, handle.data);
        bun.default_allocator.destroy(this);
    }

    pub fn onRead(this: *WindowsBufferedReader, amount: bun.sys.Maybe(usize), slice: []u8, hasMore: ReadState) void {
        if (amount == .err) {
            this.onError(amount.err);
            return;
        }

        var buf = this.buffer();
        if (comptime bun.Environment.allow_assert) {
            if (slice.len > 0 and !bun.isSliceInBuffer(slice, buf.allocatedSlice())) {
                @panic("uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it.");
            }
        }

        // move cursor foward
        buf.items.len += amount.result;

        _ = this._onReadChunk(slice, hasMore);

        if (hasMore == .eof) {
            close(this);
        }
    }

    pub fn pause(this: *WindowsBufferedReader) void {
        _ = this.stopReading();
    }

    pub fn unpause(this: *WindowsBufferedReader) void {
        _ = this.startReading();
    }

    pub fn read(this: *WindowsBufferedReader) void {
        // we cannot sync read pipes on Windows so we just check if we are paused to resume the reading
        this.unpause();
    }

    comptime {
        bun.meta.banFieldType(WindowsBufferedReader, bool); // Don't increase the size of the struct. Put them in flags instead.
    }
};

pub const BufferedReader = if (bun.Environment.isPosix)
    PosixBufferedReader
else if (bun.Environment.isWindows)
    WindowsBufferedReader
else
    @compileError("Unsupported platform");

const MaxBuf = @import("./MaxBuf.zig");
const std = @import("std");
const Source = @import("./source.zig").Source;

const FileType = @import("./pipes.zig").FileType;
const PollOrFd = @import("./pipes.zig").PollOrFd;
const ReadState = @import("./pipes.zig").ReadState;

const bun = @import("bun");
const Async = bun.Async;
const jsc = bun.jsc;
const uv = bun.windows.libuv;
