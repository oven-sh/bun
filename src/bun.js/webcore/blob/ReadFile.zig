const bun = @import("root").bun;
const JSC = bun.JSC;
const std = @import("std");
const Blob = JSC.WebCore.Blob;
const invalid_fd = bun.invalid_fd;

const SystemError = JSC.SystemError;
const SizeType = Blob.SizeType;
const io = bun.io;
const FileOpenerMixin = Blob.Store.FileOpenerMixin;
const FileCloserMixin = Blob.Store.FileCloserMixin;
const Environment = bun.Environment;
const bloblog = bun.Output.scoped(.WriteFile, true);
const JSPromise = JSC.JSPromise;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const libuv = bun.windows.libuv;

const log = bun.Output.scoped(.ReadFile, true);

pub fn NewReadFileHandler(comptime Function: anytype) type {
    return struct {
        context: Blob,
        promise: JSPromise.Strong = .{},
        globalThis: *JSGlobalObject,

        pub fn run(handler: *@This(), maybe_bytes: Blob.ReadFile.ResultType) void {
            var promise = handler.promise.swap();
            var blob = handler.context;
            blob.allocator = null;
            const globalThis = handler.globalThis;
            bun.destroy(handler);
            switch (maybe_bytes) {
                .result => |result| {
                    const bytes = result.buf;
                    if (blob.size > 0)
                        blob.size = @min(@as(Blob.SizeType, @truncate(bytes.len)), blob.size);
                    const WrappedFn = struct {
                        pub fn wrapped(b: *Blob, g: *JSGlobalObject, by: []u8) JSC.JSValue {
                            return Function(b, g, by, .temporary);
                        }
                    };

                    JSC.AnyPromise.wrap(.{ .Normal = promise }, globalThis, WrappedFn.wrapped, .{ &blob, globalThis, bytes });
                },
                .err => |err| {
                    promise.reject(globalThis, err.toErrorInstance(globalThis));
                },
            }
        }
    };
}

const FileStore = Blob.FileStore;
const ByteStore = Blob.ByteStore;
const Store = Blob.Store;
const ClosingState = Blob.ClosingState;

pub const ReadFile = struct {
    file_store: FileStore,
    byte_store: ByteStore = ByteStore{ .allocator = bun.default_allocator },
    store: ?*Store = null,
    offset: SizeType = 0,
    max_length: SizeType = Blob.max_size,
    total_size: SizeType = Blob.max_size,
    opened_fd: bun.FileDescriptor = invalid_fd,
    read_off: SizeType = 0,
    read_eof: bool = false,
    size: SizeType = 0,
    buffer: std.ArrayListUnmanaged(u8) = .{},
    task: bun.ThreadPool.Task = undefined,
    system_error: ?JSC.SystemError = null,
    errno: ?anyerror = null,
    onCompleteCtx: *anyopaque = undefined,
    onCompleteCallback: OnReadFileCallback = undefined,
    io_task: ?*ReadFileTask = null,
    io_poll: bun.io.Poll = .{},
    io_request: bun.io.Request = .{ .callback = &onRequestReadable },
    could_block: bool = false,
    close_after_io: bool = false,
    state: std.atomic.Value(ClosingState) = std.atomic.Value(ClosingState).init(.running),

    pub const Read = struct {
        buf: []u8,
        is_temporary: bool = false,
        total_size: SizeType = 0,
    };
    pub const ResultType = SystemError.Maybe(Read);

    pub const OnReadFileCallback = *const fn (ctx: *anyopaque, bytes: ResultType) void;

    pub usingnamespace FileOpenerMixin(ReadFile);
    pub usingnamespace FileCloserMixin(ReadFile);

    pub fn update(this: *ReadFile) void {
        switch (this.state.load(.monotonic)) {
            .closing => {
                this.onFinish();
            },
            .running => this.doReadLoop(),
        }
    }

    pub fn createWithCtx(
        _: std.mem.Allocator,
        store: *Store,
        onReadFileContext: *anyopaque,
        onCompleteCallback: OnReadFileCallback,
        off: SizeType,
        max_len: SizeType,
    ) !*ReadFile {
        if (Environment.isWindows)
            @compileError("Do not call ReadFile.createWithCtx on Windows, see ReadFileUV");

        const read_file = bun.new(ReadFile, ReadFile{
            .file_store = store.data.file,
            .offset = off,
            .max_length = max_len,
            .store = store,
            .onCompleteCtx = onReadFileContext,
            .onCompleteCallback = onCompleteCallback,
        });
        store.ref();
        return read_file;
    }

    pub fn create(
        allocator: std.mem.Allocator,
        store: *Store,
        off: SizeType,
        max_len: SizeType,
        comptime Context: type,
        context: Context,
        comptime callback: fn (ctx: Context, bytes: ResultType) void,
    ) !*ReadFile {
        if (Environment.isWindows)
            @compileError("dont call this function on windows");

        const Handler = struct {
            pub fn run(ptr: *anyopaque, bytes: ResultType) void {
                callback(bun.cast(Context, ptr), bytes);
            }
        };

        return try ReadFile.createWithCtx(allocator, store, @as(*anyopaque, @ptrCast(context)), Handler.run, off, max_len);
    }

    pub const io_tag = io.Poll.Tag.ReadFile;

    pub fn onReadable(request: *io.Request) void {
        var this: *ReadFile = @fieldParentPtr("io_request", request);
        this.onReady();
    }

    pub fn onReady(this: *ReadFile) void {
        bloblog("ReadFile.onReady", .{});
        this.task = .{ .callback = &doReadLoopTask };
        // On macOS, we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        if (comptime Environment.isMac) {
            // unless pending IO has been scheduled in-between.
            this.close_after_io = this.io_request.scheduled;
        }

        JSC.WorkPool.schedule(&this.task);
    }

    pub fn onIOError(this: *ReadFile, err: bun.sys.Error) void {
        bloblog("ReadFile.onIOError", .{});
        this.errno = bun.errnoToZigErr(err.errno);
        this.system_error = err.toSystemError();
        this.task = .{ .callback = &doReadLoopTask };
        // On macOS, we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        if (comptime Environment.isMac) {
            // unless pending IO has been scheduled in-between.
            this.close_after_io = this.io_request.scheduled;
        }
        JSC.WorkPool.schedule(&this.task);
    }

    pub fn onRequestReadable(request: *io.Request) io.Action {
        bloblog("ReadFile.onRequestReadable", .{});
        request.scheduled = false;
        var this: *ReadFile = @alignCast(@fieldParentPtr("io_request", request));
        return io.Action{
            .readable = .{
                .onError = @ptrCast(&onIOError),
                .ctx = this,
                .fd = this.opened_fd,
                .poll = &this.io_poll,
                .tag = ReadFile.io_tag,
            },
        };
    }

    pub fn waitForReadable(this: *ReadFile) void {
        bloblog("ReadFile.waitForReadable", .{});
        this.close_after_io = true;
        @atomicStore(@TypeOf(this.io_request.callback), &this.io_request.callback, &onRequestReadable, .seq_cst);
        if (!this.io_request.scheduled)
            io.Loop.get().schedule(&this.io_request);
    }

    fn remainingBuffer(this: *const ReadFile, stack_buffer: []u8) []u8 {
        var remaining = if (this.buffer.items.ptr[this.buffer.items.len..this.buffer.capacity].len < stack_buffer.len) stack_buffer else this.buffer.items.ptr[this.buffer.items.len..this.buffer.capacity];
        remaining = remaining[0..@min(remaining.len, this.max_length -| this.read_off)];
        return remaining;
    }

    pub fn doRead(this: *ReadFile, buffer: []u8, read_len: *usize, retry: *bool) bool {
        const result: JSC.Maybe(usize) = brk: {
            if (std.posix.S.ISSOCK(this.file_store.mode)) {
                break :brk bun.sys.recvNonBlock(this.opened_fd, buffer);
            }

            break :brk bun.sys.read(this.opened_fd, buffer);
        };

        while (true) {
            switch (result) {
                .result => |res| {
                    read_len.* = @truncate(res);
                    this.read_eof = res == 0;
                },
                .err => |err| {
                    switch (err.getErrno()) {
                        bun.io.retry => {
                            if (!this.could_block) {
                                // regular files cannot use epoll.
                                // this is fine on kqueue, but not on epoll.
                                continue;
                            }
                            retry.* = true;
                            this.read_eof = false;
                            return true;
                        },
                        else => {
                            this.errno = bun.errnoToZigErr(err.errno);
                            this.system_error = err.toSystemError();
                            if (this.system_error.?.path.isEmpty()) {
                                this.system_error.?.path = if (this.file_store.pathlike == .path)
                                    bun.String.createUTF8(this.file_store.pathlike.path.slice())
                                else
                                    bun.String.empty;
                            }
                            return false;
                        },
                    }
                },
            }
            break;
        }

        return true;
    }

    pub const ReadFileTask = JSC.WorkTask(@This());

    pub fn then(this: *ReadFile, _: *JSC.JSGlobalObject) void {
        const cb = this.onCompleteCallback;
        const cb_ctx = this.onCompleteCtx;

        if (this.store == null and this.system_error != null) {
            const system_error = this.system_error.?;
            bun.destroy(this);
            cb(cb_ctx, ResultType{ .err = system_error });
            return;
        } else if (this.store == null) {
            bun.destroy(this);
            if (Environment.allow_assert) @panic("assertion failure - store should not be null");
            cb(cb_ctx, ResultType{
                .err = SystemError{
                    .code = bun.String.static("INTERNAL_ERROR"),
                    .message = bun.String.static("assertion failure - store should not be null"),
                    .syscall = bun.String.static("read"),
                },
            });
            return;
        }

        var store = this.store.?;
        const buf = this.buffer.items;

        defer store.deref();
        const system_error = this.system_error;
        const total_size = this.total_size;
        bun.destroy(this);

        if (system_error) |err| {
            cb(cb_ctx, ResultType{ .err = err });
            return;
        }

        cb(cb_ctx, .{ .result = .{ .buf = buf, .total_size = total_size, .is_temporary = true } });
    }

    pub fn run(this: *ReadFile, task: *ReadFileTask) void {
        this.runAsync(task);
    }

    fn runAsync(this: *ReadFile, task: *ReadFileTask) void {
        this.io_task = task;

        if (this.file_store.pathlike == .fd) {
            this.opened_fd = this.file_store.pathlike.fd;
        }

        this.getFd(runAsyncWithFD);
    }

    pub fn isAllowedToClose(this: *const ReadFile) bool {
        return this.file_store.pathlike == .path;
    }

    fn onFinish(this: *ReadFile) void {
        const close_after_io = this.close_after_io;
        this.size = @truncate(this.buffer.items.len);

        {
            if (this.doClose(this.isAllowedToClose())) {
                bloblog("ReadFile.onFinish() = deferred", .{});
                // we have to wait for the close to finish
                return;
            }
        }
        if (!close_after_io) {
            if (this.io_task) |io_task| {
                this.io_task = null;
                bloblog("ReadFile.onFinish() = immediately", .{});
                io_task.onFinish();
            }
        }
    }

    fn resolveSizeAndLastModified(this: *ReadFile, fd: bun.FileDescriptor) void {
        const stat: bun.Stat = switch (bun.sys.fstat(fd)) {
            .result => |result| result,
            .err => |err| {
                this.errno = bun.errnoToZigErr(err.errno);
                this.system_error = err.toSystemError();
                return;
            },
        };

        if (this.store) |store| {
            if (store.data == .file) {
                store.data.file.last_modified = JSC.toJSTime(stat.mtime().tv_sec, stat.mtime().tv_nsec);
            }
        }

        if (bun.S.ISDIR(@intCast(stat.mode))) {
            this.errno = error.EISDIR;
            this.system_error = JSC.SystemError{
                .code = bun.String.static("EISDIR"),
                .path = if (this.file_store.pathlike == .path)
                    bun.String.createUTF8(this.file_store.pathlike.path.slice())
                else
                    bun.String.empty,
                .message = bun.String.static("Directories cannot be read like files"),
                .syscall = bun.String.static("read"),
            };
            return;
        }

        this.could_block = !bun.isRegularFile(stat.mode);
        this.total_size = @truncate(@as(SizeType, @intCast(@max(@as(i64, @intCast(stat.size)), 0))));

        if (stat.size > 0 and !this.could_block) {
            this.size = @min(this.total_size, this.max_length);
            // read up to 4k at a time if
            // they didn't explicitly set a size and we're reading from something that's not a regular file
        } else if (stat.size == 0 and this.could_block) {
            this.size = if (this.max_length == Blob.max_size)
                4096
            else
                this.max_length;
        }

        if (this.offset > 0) {
            // We DO support offset in Bun.file()
            switch (bun.sys.setFileOffset(fd, this.offset)) {
                // we ignore errors because it should continue to work even if its a pipe
                .err, .result => {},
            }
        }
    }

    fn runAsyncWithFD(this: *ReadFile, fd: bun.FileDescriptor) void {
        if (this.errno != null) {
            this.onFinish();
            return;
        }

        this.resolveSizeAndLastModified(fd);
        if (this.errno != null)
            return this.onFinish();

        // Special files might report a size of > 0, and be wrong.
        // so we should check specifically that its a regular file before trusting the size.
        if (this.size == 0 and bun.isRegularFile(this.file_store.mode)) {
            this.buffer = .{};
            this.byte_store = ByteStore.init(this.buffer.items, bun.default_allocator);

            this.onFinish();
            return;
        }

        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        if (!this.could_block or (this.size > 0 and this.size != Blob.max_size))
            this.buffer = std.ArrayListUnmanaged(u8).initCapacity(bun.default_allocator, this.size + 16) catch |err| {
                this.errno = err;
                this.onFinish();
                return;
            };
        this.read_off = 0;

        // If it's not a regular file, it might be something
        // which would block on the next read. So we should
        // avoid immediately reading again until the next time
        // we're scheduled to read.
        //
        // An example of where this happens is stdin.
        //
        //    await Bun.stdin.text();
        //
        // If we immediately call read(), it will block until stdin is
        // readable.
        if (this.could_block) {
            if (bun.isReadable(fd) == .not_ready) {
                this.waitForReadable();
                return;
            }
        }

        this.doReadLoop();
    }

    fn doReadLoopTask(task: *JSC.WorkPoolTask) void {
        var this: *ReadFile = @alignCast(@fieldParentPtr("task", task));

        this.update();
    }

    fn doReadLoop(this: *ReadFile) void {
        while (this.state.load(.monotonic) == .running) {
            // we hold a 64 KB stack buffer incase the amount of data to
            // be read is greater than the reported amount
            //
            // 64 KB is large, but since this is running in a thread
            // with it's own stack, it should have sufficient space.
            var stack_buffer: [64 * 1024]u8 = undefined;
            var buffer: []u8 = this.remainingBuffer(&stack_buffer);

            if (buffer.len > 0 and this.errno == null and !this.read_eof) {
                var read_amount: usize = 0;
                var retry = false;
                const continue_reading = this.doRead(buffer, &read_amount, &retry);
                const read = buffer[0..read_amount];

                // We might read into the stack buffer, so we need to copy it into the heap.
                if (read.ptr == &stack_buffer) {
                    if (this.buffer.capacity == 0) {
                        // We need to allocate a new buffer
                        // In this case, we want to use `ensureTotalCapacityPrecis` so that it's an exact amount
                        // We want to avoid over-allocating incase it's a large amount of data sent in a single chunk followed by a 0 byte chunk.
                        this.buffer.ensureTotalCapacityPrecise(bun.default_allocator, read.len) catch bun.outOfMemory();
                    } else {
                        this.buffer.ensureUnusedCapacity(bun.default_allocator, read.len) catch bun.outOfMemory();
                    }
                    this.buffer.appendSliceAssumeCapacity(read);
                } else {
                    // record the amount of data read
                    this.buffer.items.len += read.len;
                }
                // - If they DID set a max length, we should stop
                //   reading after that.
                //
                // - If they DID NOT set a max_length, then it will
                //   be Blob.max_size which is an impossibly large
                //   amount to read.
                if (!this.read_eof and this.buffer.items.len >= this.max_length) {
                    break;
                }

                if (!continue_reading) {
                    // Stop reading, we errored
                    break;
                }

                // If it's not a regular file, it might be something
                // which would block on the next read. So we should
                // avoid immediately reading again until the next time
                // we're scheduled to read.
                //
                // An example of where this happens is stdin.
                //
                //    await Bun.stdin.text();
                //
                // If we immediately call read(), it will block until stdin is
                // readable.
                if ((retry or (this.could_block and
                    // If we received EOF, we can skip the poll() system
                    // call. We already know it's done.
                    !this.read_eof)))
                {
                    if ((this.could_block and
                        // If we received EOF, we can skip the poll() system
                        // call. We already know it's done.
                        !this.read_eof))
                    {
                        switch (bun.isReadable(this.opened_fd)) {
                            .not_ready => {},
                            .ready, .hup => continue,
                        }
                    }
                    this.read_eof = false;
                    this.waitForReadable();

                    return;
                }

                // There can be more to read
                continue;
            }

            // -- We are done reading.
            break;
        }

        if (this.system_error != null) {
            this.buffer.clearAndFree(bun.default_allocator);
        }

        // If we over-allocated by a lot, we should shrink the buffer to conserve memory.
        if (this.buffer.items.len + 16_000 < this.buffer.capacity) {
            this.buffer.shrinkAndFree(bun.default_allocator, this.buffer.items.len);
        }
        this.byte_store = ByteStore.init(this.buffer.items, bun.default_allocator);
        this.onFinish();
    }
};

pub const ReadFileUV = struct {
    pub usingnamespace FileOpenerMixin(ReadFileUV);
    pub usingnamespace FileCloserMixin(ReadFileUV);

    loop: *libuv.Loop,
    file_store: FileStore,
    byte_store: ByteStore = ByteStore{ .allocator = bun.default_allocator },
    store: *Store,
    offset: SizeType = 0,
    max_length: SizeType = Blob.max_size,
    total_size: SizeType = Blob.max_size,
    opened_fd: bun.FileDescriptor = invalid_fd,
    read_len: SizeType = 0,
    read_off: SizeType = 0,
    read_eof: bool = false,
    size: SizeType = 0,
    buffer: std.ArrayListUnmanaged(u8) = .{},
    system_error: ?JSC.SystemError = null,
    errno: ?anyerror = null,
    on_complete_data: *anyopaque = undefined,
    on_complete_fn: ReadFile.OnReadFileCallback,
    is_regular_file: bool = false,

    req: libuv.fs_t = std.mem.zeroes(libuv.fs_t),

    pub fn start(loop: *libuv.Loop, store: *Store, off: SizeType, max_len: SizeType, comptime Handler: type, handler: *anyopaque) void {
        log("ReadFileUV.start", .{});
        var this = bun.new(ReadFileUV, .{
            .loop = loop,
            .file_store = store.data.file,
            .store = store,
            .offset = off,
            .max_length = max_len,
            .on_complete_data = handler,
            .on_complete_fn = @ptrCast(&Handler.run),
        });
        store.ref();
        this.getFd(onFileOpen);
    }

    pub fn finalize(this: *ReadFileUV) void {
        log("ReadFileUV.finalize", .{});
        defer {
            this.store.deref();
            this.req.deinit();
            bun.destroy(this);
            log("ReadFileUV.finalize destroy", .{});
        }

        const cb = this.on_complete_fn;
        const cb_ctx = this.on_complete_data;

        if (this.system_error) |err| {
            cb(cb_ctx, ReadFile.ResultType{ .err = err });
            return;
        }

        cb(cb_ctx, .{ .result = .{ .buf = this.byte_store.slice(), .total_size = this.total_size, .is_temporary = true } });
    }

    pub fn isAllowedToClose(this: *const ReadFileUV) bool {
        return this.file_store.pathlike == .path;
    }

    fn onFinish(this: *ReadFileUV) void {
        log("ReadFileUV.onFinish", .{});
        const fd = this.opened_fd;
        const needs_close = fd != bun.invalid_fd;

        this.size = @max(this.read_len, this.size);
        this.total_size = @max(this.total_size, this.size);

        if (needs_close) {
            if (this.doClose(this.isAllowedToClose())) {
                // we have to wait for the close to finish
                return;
            }
        }

        this.finalize();
    }

    pub fn onFileOpen(this: *ReadFileUV, opened_fd: bun.FileDescriptor) void {
        log("ReadFileUV.onFileOpen", .{});
        if (this.errno != null) {
            this.onFinish();
            return;
        }

        this.req.deinit();
        this.req.data = this;

        if (libuv.uv_fs_fstat(this.loop, &this.req, bun.uvfdcast(opened_fd), &onFileInitialStat).errEnum()) |errno| {
            this.errno = bun.errnoToZigErr(errno);
            this.system_error = bun.sys.Error.fromCode(errno, .fstat).toSystemError();
            this.onFinish();
            return;
        }

        this.req.data = this;
    }

    fn onFileInitialStat(req: *libuv.fs_t) callconv(.C) void {
        log("ReadFileUV.onFileInitialStat", .{});
        var this: *ReadFileUV = @alignCast(@ptrCast(req.data));

        if (req.result.errEnum()) |errno| {
            this.errno = bun.errnoToZigErr(errno);
            this.system_error = bun.sys.Error.fromCode(errno, .fstat).toSystemError();
            this.onFinish();
            return;
        }

        const stat = req.statbuf;
        log("stat: {any}", .{stat});

        // keep in sync with resolveSizeAndLastModified
        if (this.store.data == .file) {
            this.store.data.file.last_modified = JSC.toJSTime(stat.mtime().tv_sec, stat.mtime().tv_nsec);
        }

        if (bun.S.ISDIR(@intCast(stat.mode))) {
            this.errno = error.EISDIR;
            this.system_error = JSC.SystemError{
                .code = bun.String.static("EISDIR"),
                .path = if (this.file_store.pathlike == .path)
                    bun.String.createUTF8(this.file_store.pathlike.path.slice())
                else
                    bun.String.empty,
                .message = bun.String.static("Directories cannot be read like files"),
                .syscall = bun.String.static("read"),
            };
            this.onFinish();
            return;
        }
        this.total_size = @truncate(@as(SizeType, @intCast(@max(@as(i64, @intCast(stat.size)), 0))));
        this.is_regular_file = bun.isRegularFile(stat.mode);

        log("is_regular_file: {}", .{this.is_regular_file});

        if (stat.size > 0 and this.is_regular_file) {
            this.size = @min(this.total_size, this.max_length);
        } else if (stat.size == 0 and !this.is_regular_file) {
            // read up to 4k at a time if they didn't explicitly set a size and
            // we're reading from something that's not a regular file.
            this.size = if (this.max_length == Blob.max_size)
                4096
            else
                this.max_length;
        }

        if (this.offset > 0) {
            // We DO support offset in Bun.file()
            switch (bun.sys.setFileOffset(this.opened_fd, this.offset)) {
                // we ignore errors because it should continue to work even if its a pipe
                .err, .result => {},
            }
        }

        // Special files might report a size of > 0, and be wrong.
        // so we should check specifically that its a regular file before trusting the size.
        if (this.size == 0 and this.is_regular_file) {
            this.byte_store = ByteStore.init(this.buffer.items, bun.default_allocator);
            this.onFinish();
            return;
        }

        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        this.buffer.ensureTotalCapacityPrecise(this.byte_store.allocator, this.size + 16) catch |err| {
            this.errno = err;
            this.onFinish();
            return;
        };
        this.read_len = 0;
        this.read_off = 0;

        this.req.deinit();

        this.queueRead();
    }

    fn remainingBuffer(this: *const ReadFileUV) []u8 {
        var remaining = this.buffer.unusedCapacitySlice();
        return remaining[0..@min(remaining.len, this.max_length -| this.read_off)];
    }

    pub fn queueRead(this: *ReadFileUV) void {
        if (this.remainingBuffer().len > 0 and this.errno == null and !this.read_eof) {
            log("ReadFileUV.queueRead - this.remainingBuffer().len = {d}", .{this.remainingBuffer().len});

            if (!this.is_regular_file) {
                // non-regular files have variable sizes, so we always ensure
                // theres at least 4096 bytes of free space. there has already
                // been an initial allocation done for us
                this.buffer.ensureUnusedCapacity(this.byte_store.allocator, 4096) catch |err| {
                    this.errno = err;
                    this.onFinish();
                };
            }

            const buf = this.remainingBuffer();
            var bufs: [1]libuv.uv_buf_t = .{
                libuv.uv_buf_t.init(buf),
            };
            this.req.assertCleanedUp();
            const res = libuv.uv_fs_read(
                this.loop,
                &this.req,
                bun.uvfdcast(this.opened_fd),
                &bufs,
                bufs.len,
                @as(i64, @intCast(this.offset + this.read_off)),
                &onRead,
            );
            this.req.data = this;
            if (res.errEnum()) |errno| {
                this.errno = bun.errnoToZigErr(errno);
                this.system_error = bun.sys.Error.fromCode(errno, .read).toSystemError();
                this.onFinish();
            }
        } else {
            log("ReadFileUV.queueRead done", .{});

            // We are done reading.
            this.byte_store = ByteStore.init(
                this.buffer.toOwnedSlice(this.byte_store.allocator) catch |err| {
                    this.errno = err;
                    this.onFinish();
                    return;
                },
                bun.default_allocator,
            );
            this.onFinish();
        }
    }

    pub fn onRead(req: *libuv.fs_t) callconv(.C) void {
        var this: *ReadFileUV = @alignCast(@ptrCast(req.data));

        const result = req.result;

        if (result.errEnum()) |errno| {
            this.errno = bun.errnoToZigErr(errno);
            this.system_error = bun.sys.Error.fromCode(errno, .read).toSystemError();
            this.finalize();
            return;
        }

        if (result.int() == 0) {
            // We are done reading.
            this.byte_store = ByteStore.init(
                this.buffer.toOwnedSlice(this.byte_store.allocator) catch |err| {
                    this.errno = err;
                    this.onFinish();
                    return;
                },
                bun.default_allocator,
            );
            this.onFinish();
            return;
        }

        this.read_off += @intCast(result.int());
        this.buffer.items.len += @intCast(result.int());

        this.req.deinit();
        this.queueRead();
    }
};
