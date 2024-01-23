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

const ClosingState = Blob.ClosingState;

pub const WriteFile = struct {
    file_blob: Blob,
    bytes_blob: Blob,

    opened_fd: bun.FileDescriptor = invalid_fd,
    system_error: ?JSC.SystemError = null,
    errno: ?anyerror = null,
    task: bun.ThreadPool.Task = undefined,
    io_task: ?*WriteFileTask = null,
    io_poll: bun.io.Poll = .{},
    io_request: bun.io.Request = .{ .callback = &onRequestWritable },
    state: std.atomic.Value(ClosingState) = std.atomic.Value(ClosingState).init(.running),

    onCompleteCtx: *anyopaque = undefined,
    onCompleteCallback: OnWriteFileCallback = undefined,
    total_written: usize = 0,

    could_block: bool = false,
    close_after_io: bool = false,
    mkdirp_if_not_exists: bool = false,

    pub const ResultType = SystemError.Maybe(SizeType);
    pub const OnWriteFileCallback = *const fn (ctx: *anyopaque, count: ResultType) void;
    pub const io_tag = io.Poll.Tag.WriteFile;

    pub usingnamespace FileOpenerMixin(WriteFile);
    pub usingnamespace FileCloserMixin(WriteFile);

    pub const open_flags = std.os.O.WRONLY | std.os.O.CREAT | std.os.O.TRUNC | std.os.O.NONBLOCK;

    pub fn onWritable(request: *io.Request) void {
        var this: *WriteFile = @fieldParentPtr(WriteFile, "io_request", request);
        this.onReady();
    }

    pub fn onReady(this: *WriteFile) void {
        bloblog("WriteFile.onReady()", .{});
        this.task = .{ .callback = &doWriteLoopTask };
        JSC.WorkPool.schedule(&this.task);
    }

    pub fn onIOError(this: *WriteFile, err: bun.sys.Error) void {
        bloblog("WriteFile.onIOError()", .{});
        this.errno = bun.errnoToZigErr(err.errno);
        this.system_error = err.toSystemError();
        this.task = .{ .callback = &doWriteLoopTask };
        JSC.WorkPool.schedule(&this.task);
    }

    pub fn onRequestWritable(request: *io.Request) io.Action {
        bloblog("WriteFile.onRequestWritable()", .{});
        request.scheduled = false;
        var this: *WriteFile = @fieldParentPtr(WriteFile, "io_request", request);
        return io.Action{
            .writable = .{
                .onError = @ptrCast(&onIOError),
                .ctx = this,
                .fd = this.opened_fd,
                .poll = &this.io_poll,
                .tag = WriteFile.io_tag,
            },
        };
    }

    pub fn waitForWritable(this: *WriteFile) void {
        this.close_after_io = true;
        @atomicStore(@TypeOf(this.io_request.callback), &this.io_request.callback, &onRequestWritable, .SeqCst);
        if (!this.io_request.scheduled)
            io.Loop.get().schedule(&this.io_request);
    }

    pub fn createWithCtx(
        allocator: std.mem.Allocator,
        file_blob: Blob,
        bytes_blob: Blob,
        onWriteFileContext: *anyopaque,
        onCompleteCallback: OnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) !*WriteFile {
        _ = allocator;
        const write_file = bun.new(WriteFile, WriteFile{
            .file_blob = file_blob,
            .bytes_blob = bytes_blob,
            .onCompleteCtx = onWriteFileContext,
            .onCompleteCallback = onCompleteCallback,
            .task = .{ .callback = &doWriteLoopTask },
            .mkdirp_if_not_exists = mkdirp_if_not_exists,
        });
        file_blob.store.?.ref();
        bytes_blob.store.?.ref();
        return write_file;
    }

    pub fn create(
        allocator: std.mem.Allocator,
        file_blob: Blob,
        bytes_blob: Blob,
        comptime Context: type,
        context: Context,
        comptime callback: fn (ctx: Context, bytes: ResultType) void,
        mkdirp_if_not_exists: bool,
    ) !*WriteFile {
        const Handler = struct {
            pub fn run(ptr: *anyopaque, bytes: ResultType) void {
                callback(bun.cast(Context, ptr), bytes);
            }
        };

        return try WriteFile.createWithCtx(
            allocator,
            file_blob,
            bytes_blob,
            @as(*anyopaque, @ptrCast(context)),
            Handler.run,
            mkdirp_if_not_exists,
        );
    }

    pub fn doWrite(
        this: *WriteFile,
        buffer: []const u8,
        wrote: *usize,
    ) bool {
        const fd = this.opened_fd;
        std.debug.assert(fd != invalid_fd);

        const result: JSC.Maybe(usize) =
            // We do not use pwrite() because the file may not be
            // seekable (such as stdout)
            //
            // On macOS, it is an error to use pwrite() on a
            // non-seekable file.
            bun.sys.write(fd, buffer);

        while (true) {
            switch (result) {
                .result => |res| {
                    wrote.* = res;
                    this.total_written += res;
                },
                .err => |err| {
                    switch (err.getErrno()) {
                        bun.io.retry => {
                            if (!this.could_block) {
                                // regular files cannot use epoll.
                                // this is fine on kqueue, but not on epoll.
                                continue;
                            }
                            this.waitForWritable();
                            return false;
                        },
                        else => {
                            this.errno = bun.errnoToZigErr(err.getErrno());
                            this.system_error = err.toSystemError();
                            return false;
                        },
                    }
                },
            }
            break;
        }

        return true;
    }

    pub const WriteFileTask = JSC.WorkTask(@This());

    pub fn then(this: *WriteFile, _: *JSC.JSGlobalObject) void {
        const cb = this.onCompleteCallback;
        const cb_ctx = this.onCompleteCtx;

        this.bytes_blob.store.?.deref();
        this.file_blob.store.?.deref();

        if (this.system_error) |err| {
            bun.destroy(this);
            cb(cb_ctx, .{
                .err = err,
            });
            return;
        }

        const wrote = this.total_written;
        bun.destroy(this);
        cb(cb_ctx, .{ .result = @as(SizeType, @truncate(wrote)) });
    }
    pub fn run(this: *WriteFile, task: *WriteFileTask) void {
        if (Environment.isWindows) {
            @panic("todo");
        }
        this.io_task = task;
        this.runAsync();
    }

    fn runAsync(this: *WriteFile) void {
        this.getFd(runWithFD);
    }

    pub fn isAllowedToClose(this: *const WriteFile) bool {
        return this.file_blob.store.?.data.file.pathlike == .path;
    }

    fn onFinish(this: *WriteFile) void {
        bloblog("WriteFile.onFinish()", .{});

        const close_after_io = this.close_after_io;
        if (this.doClose(this.isAllowedToClose())) {
            return;
        }
        if (!close_after_io) {
            if (this.io_task) |io_task| {
                this.io_task = null;
                io_task.onFinish();
            }
        }
    }

    fn runWithFD(this: *WriteFile, fd_: bun.FileDescriptor) void {
        if (fd_ == invalid_fd or this.errno != null) {
            this.onFinish();
            return;
        }

        const fd = this.opened_fd;

        this.could_block = brk: {
            if (this.file_blob.store) |store| {
                if (store.data == .file and store.data.file.pathlike == .fd) {
                    // If seekable was set, then so was mode
                    if (store.data.file.seekable != null) {
                        // This is mostly to handle pipes which were passsed to the process somehow
                        // such as stderr, stdout. Bun.stdin and Bun.stderr will automatically set `mode` for us.
                        break :brk !bun.isRegularFile(store.data.file.mode);
                    }
                }
            }

            // We opened the file descriptor with O_NONBLOCK, so we
            // shouldn't have to worry about blocking reads/writes
            //
            // We do not call fstat() because that is very expensive.
            break :brk false;
        };

        // We have never supported offset in Bun.write().
        // and properly adding support means we need to also support it
        // with splice, sendfile, and the other cases.
        //
        // if (this.file_blob.offset > 0) {
        //     // if we start at an offset in the file
        //     // example code:
        //     //
        //     //    Bun.write(Bun.file("/tmp/lol.txt").slice(10), "hello world");
        //     //
        //     // it should write "hello world" to /tmp/lol.txt starting at offset 10
        //     switch (bun.sys.setFileOffset(fd, this.file_blob.offset)) {
        //         // we ignore errors because it should continue to work even if its a pipe
        //         .err, .result => {},
        //     }
        // }

        if (this.could_block and bun.isWritable(fd) == .not_ready) {
            this.waitForWritable();
            return;
        }

        if (comptime Environment.isLinux) {
            // If it's a potentially large file, lets attempt to
            // preallocate the saved filesystem size.
            //
            // We only do this on Linux because the equivalent on macOS
            // seemed to have zero performance impact in
            // microbenchmarks.
            if (!this.could_block and this.bytes_blob.sharedView().len > 1024) {
                bun.C.preallocate_file(fd.cast(), 0, @intCast(this.bytes_blob.sharedView().len)) catch {}; // we don't care if it fails.
            }
        }

        this.doWriteLoop();
    }

    fn doWriteLoopTask(task: *JSC.WorkPoolTask) void {
        var this: *WriteFile = @fieldParentPtr(WriteFile, "task", task);
        // On macOS, we use one-shot mode, so we don't need to unregister.
        if (comptime Environment.isMac) {
            this.close_after_io = false;
        }
        this.doWriteLoop();
    }

    pub fn update(this: *WriteFile) void {
        this.doWriteLoop();
    }

    fn doWriteLoop(this: *WriteFile) void {
        while (this.state.load(.Monotonic) == .running) {
            var remain = this.bytes_blob.sharedView();

            remain = remain[@min(this.total_written, remain.len)..];

            if (remain.len > 0 and this.errno == null) {
                var wrote: usize = 0;
                const continue_writing = this.doWrite(remain, &wrote);
                this.bytes_blob.offset += @truncate(wrote);
                if (!continue_writing) {
                    // Stop writing, we errored
                    if (this.errno != null) {
                        this.onFinish();
                        return;
                    }

                    // Stop writing, we need to wait for it to become writable.
                    return;
                }

                // Do not immediately attempt to write again if it's not a regular file.
                if (this.could_block and bun.isWritable(this.opened_fd) == .not_ready) {
                    this.waitForWritable();
                    return;
                }

                if (wrote == 0) {
                    // we are done, we received EOF
                    this.onFinish();
                    return;
                }

                continue;
            }

            break;
        }

        this.onFinish();
    }
};

pub const WriteFilePromise = struct {
    promise: JSPromise.Strong = .{},
    globalThis: *JSGlobalObject,
    pub fn run(handler: *@This(), count: Blob.WriteFile.ResultType) void {
        var promise = handler.promise.swap();
        const globalThis = handler.globalThis;
        bun.destroy(handler);
        const value = promise.asValue(globalThis);
        value.ensureStillAlive();
        switch (count) {
            .err => |err| {
                promise.reject(globalThis, err.toErrorInstance(globalThis));
            },
            .result => |wrote| {
                promise.resolve(globalThis, JSC.JSValue.jsNumberFromUint64(wrote));
            },
        }
    }
};

const Body = JSC.WebCore.Body;
pub const WriteFileWaitFromLockedValueTask = struct {
    file_blob: Blob,
    globalThis: *JSGlobalObject,
    promise: JSC.JSPromise.Strong,
    mkdirp_if_not_exists: bool = false,

    pub fn thenWrap(this: *anyopaque, value: *Body.Value) void {
        then(bun.cast(*WriteFileWaitFromLockedValueTask, this), value);
    }

    pub fn then(this: *WriteFileWaitFromLockedValueTask, value: *Body.Value) void {
        var promise = this.promise.get();
        var globalThis = this.globalThis;
        var file_blob = this.file_blob;
        switch (value.*) {
            .Error => |err| {
                file_blob.detach();
                _ = value.use();
                this.promise.strong.deinit();
                bun.destroy(this);
                promise.reject(globalThis, err);
            },
            .Used => {
                file_blob.detach();
                _ = value.use();
                this.promise.strong.deinit();
                bun.destroy(this);
                promise.reject(globalThis, ZigString.init("Body was used after it was consumed").toErrorInstance(globalThis));
            },
            .WTFStringImpl,
            .InternalBlob,
            .Null,
            .Empty,
            .Blob,
            => {
                var blob = value.use();
                // TODO: this should be one promise not two!
                const new_promise = Blob.writeFileWithSourceDestination(globalThis, &blob, &file_blob, this.mkdirp_if_not_exists);
                if (new_promise.asAnyPromise()) |_promise| {
                    switch (_promise.status(globalThis.vm())) {
                        .Pending => {
                            promise.resolve(
                                globalThis,
                                new_promise,
                            );
                        },
                        .Rejected => {
                            promise.reject(globalThis, _promise.result(globalThis.vm()));
                        },
                        else => {
                            promise.resolve(globalThis, _promise.result(globalThis.vm()));
                        },
                    }
                }

                file_blob.detach();
                this.promise.strong.deinit();
                bun.destroy(this);
            },
            .Locked => {
                value.Locked.onReceiveValue = thenWrap;
                value.Locked.task = this;
            },
        }
    }
};
