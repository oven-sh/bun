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
    /// When `flags.threadpool` is set, each read() allocates a task and
    /// submits it to `jsc.WorkPool` instead of calling read(2) inline.
    /// The task is heap-allocated rather than embedded so it can outlive
    /// the reader — if the reader is closed mid-read, the pool thread
    /// finishes its syscall and the completion task drops its write back
    /// to the reader on noticing the detached state.
    threadpool_task: ?*ThreadPoolReadTask = null,

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
        /// Route read() through `jsc.WorkPool` rather than calling read(2)
        /// inline on the caller's (JS) thread. Set by `FileReader.onStart`
        /// when the fd is a blocking non-regular, non-TTY file descriptor
        /// (typically a character device such as /dev/zero). Prevents the
        /// synchronous read loop from starving the event loop — signals,
        /// timers, and I/O callbacks all get CPU between reads. See #30189.
        threadpool: bool = false,
        /// A worker-pool read is currently in flight — the pool thread
        /// owns `threadpool_task.buf`, and the main thread must not
        /// schedule another read until the completion task has run.
        threadpool_in_flight: bool = false,
        _: u4 = 0,
    };

    /// One-shot worker-pool read. Heap-allocated so it can outlive its
    /// owning `PosixBufferedReader`: if the reader closes while a read
    /// is in flight on a pool thread, the pool thread still gets to
    /// finish its syscall and schedule the completion task, and the
    /// completion task sees `reader == null` (set by `detachAndClose`)
    /// and destroys itself without touching the freed reader.
    const ThreadPoolReadTask = struct {
        task: bun.ThreadPool.Task = .{ .callback = &runOnPoolThread },
        concurrent: jsc.ConcurrentTask = .{},
        /// Pool-thread read target. Owned by this task.
        buf: []u8 = &.{},
        /// Result of `bun.sys.read`, written on the pool thread.
        result: bun.sys.Maybe(usize) = .{ .result = 0 },
        /// The owning reader. Cleared (under `lock`) by
        /// `detachAndClose` when the reader tears down before this
        /// task's completion runs on the JS thread. The pool thread
        /// also reads this under `lock` so it can close the fd itself
        /// if the reader has already been freed.
        reader: ?*PosixBufferedReader,
        /// The fd to read from, cached at schedule time so the pool
        /// thread doesn't have to reach back through `reader`. Kept
        /// valid by the detach handshake: the reader either holds the
        /// fd open until completion, or takes ownership back and
        /// closes it itself after `detachAndClose` returns.
        fd: bun.FD,
        /// The event loop to wake when the read completes. Cached
        /// alongside `fd` so the pool thread never dereferences
        /// `reader` to find it.
        event_loop: jsc.EventLoopHandle,
        /// Refs the event loop while a pool read is in flight so the
        /// process doesn't exit before the completion task runs. The
        /// inline path relies on the FilePoll's refcount for this, but
        /// the threadpool path has no poll handle (fds used here are
        /// non-pollable character devices), so we track it explicitly.
        /// Ref'd in `schedule`, unref'd in `runFromJSThread` or
        /// `detachAndClose` — i.e. exactly once per task lifetime.
        keep_alive: Async.KeepAlive = .{},
        lock: bun.Mutex = .{},

        /// Size of each pool-thread read. Smaller than the inline
        /// streaming path's 256 KB: each chunk round-trips through
        /// `onReadChunk` → JS → `_read` → another pool read, and 64 KB
        /// keeps the per-chunk latency low on slow devices while still
        /// coalescing syscalls on fast ones like /dev/zero.
        const buf_size: usize = 64 * 1024;

        pub const new = bun.TrivialNew(@This());

        fn schedule(reader: *PosixBufferedReader) void {
            if (reader.flags.threadpool_in_flight) return;
            reader.flags.threadpool_in_flight = true;

            const event_loop = reader.eventLoop();
            const self = ThreadPoolReadTask.new(.{
                .buf = bun.handleOom(bun.default_allocator.alloc(u8, buf_size)),
                .reader = reader,
                .fd = reader.getFd(),
                .event_loop = event_loop,
            });
            // Ref the loop before the task hits the pool — the reader
            // has no poll handle to do this for it.
            self.keep_alive.ref(event_loop);
            reader.threadpool_task = self;
            jsc.WorkPool.schedule(&self.task);
        }

        /// Called on the JS thread when the reader is being torn down
        /// while `flags.threadpool_in_flight` is set. Hands ownership
        /// of the fd to the task so the pool thread can close it
        /// after its read completes — the task must free both the fd
        /// and itself from `runFromJSThread`.
        fn detachAndClose(reader: *PosixBufferedReader) void {
            const self = reader.threadpool_task orelse return;
            reader.threadpool_task = null;
            self.lock.lock();
            defer self.lock.unlock();
            self.reader = null;
            // The reader no longer owns the fd — ownership has moved
            // to the task, which will close it in `runFromJSThread`.
            // Drop the keep-alive now that teardown has started so the
            // completion task doesn't keep a closing process alive.
            self.keep_alive.unref(self.event_loop);
        }

        fn runOnPoolThread(task: *bun.ThreadPool.Task) void {
            const self: *ThreadPoolReadTask = @fieldParentPtr("task", task);
            // Read the fd (blocking on the pool thread). Never touch
            // JS-visible state here.
            self.result = bun.sys.read(self.fd, self.buf);
            self.event_loop.enqueueTaskConcurrent(.{ .js = self.concurrent.from(self, .manual_deinit) });
        }

        pub fn runFromJSThread(self: *ThreadPoolReadTask) void {
            defer {
                // Release the loop-keep-alive we took in `schedule`.
                // Safe even if `detachAndClose` already unref'd because
                // `KeepAlive.unref` is a no-op when not active.
                self.keep_alive.unref(self.event_loop);
                bun.default_allocator.free(self.buf);
                bun.destroy(self);
            }

            // Acquire the detach lock and capture the reader pointer
            // atomically with `flags.threadpool_in_flight` so we can't
            // race with `detachAndClose`.
            self.lock.lock();
            const reader = self.reader;
            self.lock.unlock();

            if (reader == null) {
                // Reader was torn down while we were reading. Close
                // the fd we inherited and exit.
                self.fd.close();
                return;
            }

            const r = reader.?;
            r.threadpool_task = null;
            r.flags.threadpool_in_flight = false;

            if (r.flags.is_done or r.flags.closed_without_reporting or r.flags.is_paused) {
                return;
            }

            const buf = self.buf;
            switch (self.result) {
                .result => |bytes_read| {
                    if (r.maxbuf) |l| l.onReadBytes(bytes_read);

                    if (bytes_read == 0) {
                        // EOF
                        r.closeWithoutReporting();
                        if (!r.flags.is_done) r.done();
                        return;
                    }

                    r._offset += bytes_read;
                    const streaming = r.vtable.isStreamingEnabled();
                    if (streaming) {
                        const wants_more = r.vtable.onReadChunk(buf[0..bytes_read], .progress);
                        if (wants_more and !r.flags.is_paused and !r.isDone()) {
                            // Schedule the next pool read. The JS-thread
                            // round trip in between is the yield that
                            // lets signals/timers/I/O drain.
                            schedule(r);
                        }
                    } else {
                        // Non-streaming: append to resizable buffer and
                        // keep reading until EOF/error.
                        bun.handleOom(r._buffer.appendSlice(buf[0..bytes_read]));
                        if (!r.flags.is_paused and !r.isDone()) {
                            schedule(r);
                        }
                    }
                },
                .err => |err| {
                    if (err.isRetry()) {
                        // Character devices shouldn't return EAGAIN on
                        // blocking read, but be defensive: just reschedule.
                        if (!r.flags.is_paused and !r.isDone()) {
                            schedule(r);
                        }
                        return;
                    }
                    r.onError(err);
                },
            }
        }
    };

    pub fn init(comptime Type: type) PosixBufferedReader {
        return .{
            .vtable = BufferedReaderVTable.init(Type),
        };
    }

    pub fn updateRef(this: *const PosixBufferedReader, value: bool) void {
        if (this.handle.getPoll()) |poll| {
            poll.setKeepingProcessAlive(this.vtable.eventLoop(), value);
            return;
        }
        // No poll handle — the only keep-alive this reader has is the
        // ref held by an in-flight threadpool read, if any.
        if (this.threadpool_task) |task| {
            if (value) task.keep_alive.ref(task.event_loop) else task.keep_alive.unref(task.event_loop);
        }
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

    pub fn startMemfd(this: *PosixBufferedReader, fd: bun.FD) void {
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
        // If a pool-thread read is in flight the completion task could
        // otherwise dereference a freed reader. Detach: the task takes
        // ownership of the fd and closes it when its read returns.
        // We still fire the normal `done` → `onReaderDone` path here so
        // the parent stream sees the close synchronously.
        if (this.flags.threadpool_in_flight) {
            ThreadPoolReadTask.detachAndClose(this);
            this.handle = .{ .closed = {} };
            if (!this.flags.is_done) this.done();
            return;
        }
        this.closeHandle();
    }

    fn closeWithoutReporting(this: *PosixBufferedReader) void {
        if (this.getFd() != bun.invalid_fd) {
            bun.assert(!this.flags.closed_without_reporting);
            this.flags.closed_without_reporting = true;
            if (this.flags.threadpool_in_flight) {
                ThreadPoolReadTask.detachAndClose(this);
                this.handle = .{ .closed = {} };
                return;
            }
            if (this.flags.close_handle) this.handle.close(this, {});
        }
    }

    pub fn getFd(this: *PosixBufferedReader) bun.FD {
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

    pub fn start(this: *PosixBufferedReader, fd: bun.FD, is_pollable: bool) bun.sys.Maybe(void) {
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

    pub fn startFileOffset(this: *PosixBufferedReader, fd: bun.FD, poll: bool, offset: usize) bun.sys.Maybe(void) {
        this._offset = offset;
        this.flags.use_pread = true;
        return this.start(fd, poll);
    }

    // Exists for consistently with Windows.
    pub fn hasPendingRead(this: *const PosixBufferedReader) bool {
        if (this.flags.threadpool_in_flight) return true;
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
                // For blocking non-regular fds (character devices like
                // /dev/zero) dispatch each read to the worker pool so the
                // JS thread doesn't sit in a read(2) loop that never
                // yields — signals and timers stay serviced. Regular
                // files keep the inline path because they hit EOF
                // quickly and the thread-hop per chunk isn't worth the
                // overhead.
                if (this.flags.threadpool) {
                    ThreadPoolReadTask.schedule(this);
                    return;
                }
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

    fn wrapReadFn(comptime func: *const fn (bun.FD, []u8) bun.sys.Maybe(usize)) *const fn (bun.FD, []u8, usize) bun.sys.Maybe(usize) {
        return struct {
            pub fn call(fd: bun.FD, buf: []u8, offset: usize) bun.sys.Maybe(usize) {
                _ = offset;
                return func(fd, buf);
            }
        }.call;
    }

    fn readFile(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FD, size_hint: isize, received_hup: bool) void {
        const preadFn = struct {
            pub fn call(fd1: bun.FD, buf: []u8, offset: usize) bun.sys.Maybe(usize) {
                return bun.sys.pread(fd1, buf, @intCast(offset));
            }
        }.call;
        if (parent.flags.use_pread) {
            return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .file, preadFn);
        } else {
            return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .file, wrapReadFn(bun.sys.read));
        }
    }

    fn readSocket(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FD, size_hint: isize, received_hup: bool) void {
        return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .socket, wrapReadFn(bun.sys.recvNonBlock));
    }

    fn readPipe(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FD, size_hint: isize, received_hup: bool) void {
        return readWithFn(parent, resizable_buffer, fd, size_hint, received_hup, .nonblocking_pipe, wrapReadFn(bun.sys.readNonblocking));
    }

    fn readBlockingPipe(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FD, _: isize, received_hup_initially: bool) void {
        var received_hup = received_hup_initially;
        while (true) {
            const streaming = parent.vtable.isStreamingEnabled();
            var got_retry = false;

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
                        got_retry = true;
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
                        got_retry = true;
                    },
                }
            }

            // Register for next poll cycle unless we got HUP
            if (!received_hup) {
                parent.registerPoll();
                return;
            }

            // We have received HUP. Normally that means all writers are gone
            // and draining the buffer will eventually hit EOF (read() == 0),
            // so we loop locally instead of re-arming the poll (HUP is
            // level-triggered and would fire again immediately).
            //
            // But `received_hup` is a snapshot from when the epoll/kqueue
            // event fired. `onReadChunk` above re-enters JS (resolves the
            // pending read, drains microtasks, fires the 'data' event), and
            // user code there can open a new writer on the same FIFO — after
            // which the pipe is no longer hung up. Looping again would then
            // either spin forever on EAGAIN (if the fd is O_NONBLOCK) or
            // block the event loop in read() (if the fd is blocking and
            // RWF_NOWAIT is unavailable — Linux named FIFOs return
            // EOPNOTSUPP for it, unlike anonymous pipes).
            //
            // An explicit EAGAIN proves the HUP is stale, so re-arm.
            if (got_retry) {
                parent.registerPoll();
                return;
            }
            // Otherwise we just returned from user JS; re-poll the fd to see
            // whether HUP still holds before committing to another blocking
            // read. This is one extra poll() per chunk only on the HUP path
            // (i.e. while draining the final buffered bytes), not per read.
            switch (bun.isReadable(fd)) {
                .hup => {
                    // Still hung up; keep draining towards EOF.
                },
                .ready => {
                    // Data is available but HUP cleared — a writer came back.
                    // Drop the stale HUP so the next iteration takes the
                    // normal registerPoll() exit once the data is drained.
                    received_hup = false;
                },
                .not_ready => {
                    // No data and no HUP: a writer exists. Go back to the
                    // event loop instead of blocking in read().
                    parent.registerPoll();
                    return;
                },
            }
        }
    }

    fn readWithFn(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FD, size_hint: isize, received_hup: bool, comptime file_type: FileType, comptime sys_fn: *const fn (bun.FD, []u8, usize) bun.sys.Maybe(usize)) void {
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

    fn readFromBlockingPipeWithoutBlocking(parent: *PosixBufferedReader, resizable_buffer: *std.array_list.Managed(u8), fd: bun.FD, size_hint: isize, received_hup: bool) void {
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
                return Type.loop(@as(*Type, @ptrCast(@alignCast(this))));
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

    pub fn getFd(this: *const WindowsBufferedReader) bun.FD {
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

    pub fn start(this: *WindowsBufferedReader, fd: bun.FD, _: bool) bun.sys.Maybe(void) {
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

    pub fn startFileOffset(this: *WindowsBufferedReader, fd: bun.FD, poll: bool, offset: usize) bun.sys.Maybe(void) {
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
        bun.destroy(this);
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

pub const PosixThreadPoolReadTask = if (bun.Environment.isPosix) PosixBufferedReader.ThreadPoolReadTask else @compileError("POSIX only");

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
