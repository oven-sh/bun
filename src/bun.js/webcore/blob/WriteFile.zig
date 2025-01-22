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

    pub const open_flags = bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC | bun.O.NONBLOCK;

    pub fn onWritable(request: *io.Request) void {
        var this: *WriteFile = @fieldParentPtr("io_request", request);
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
        var this: *WriteFile = @fieldParentPtr("io_request", request);
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
        @atomicStore(@TypeOf(this.io_request.callback), &this.io_request.callback, &onRequestWritable, .seq_cst);
        if (!this.io_request.scheduled)
            io.Loop.get().schedule(&this.io_request);
    }

    pub fn createWithCtx(
        file_blob: Blob,
        bytes_blob: Blob,
        onWriteFileContext: *anyopaque,
        onCompleteCallback: OnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) !*WriteFile {
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
        bun.assert(fd != invalid_fd);

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
        var this: *WriteFile = @fieldParentPtr("task", task);
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
        while (this.state.load(.monotonic) == .running) {
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

const uv = bun.windows.libuv;
pub const WriteFileWindows = struct {
    io_request: uv.fs_t,
    file_blob: Blob,
    bytes_blob: Blob,
    onCompleteCallback: OnWriteFileCallback,
    onCompleteCtx: *anyopaque,
    mkdirp_if_not_exists: bool = false,
    uv_bufs: [1]uv.uv_buf_t,

    fd: uv.uv_file = -1,
    err: ?bun.sys.Error = null,
    total_written: usize = 0,
    event_loop: *JSC.EventLoop,

    owned_fd: bool = false,

    const log = bun.Output.scoped(.WriteFile, true);

    pub fn createWithCtx(
        file_blob: Blob,
        bytes_blob: Blob,
        event_loop: *bun.JSC.EventLoop,
        onWriteFileContext: *anyopaque,
        onCompleteCallback: OnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) *WriteFileWindows {
        const write_file = WriteFileWindows.new(.{
            .file_blob = file_blob,
            .bytes_blob = bytes_blob,
            .onCompleteCtx = onWriteFileContext,
            .onCompleteCallback = onCompleteCallback,
            .mkdirp_if_not_exists = mkdirp_if_not_exists and file_blob.store.?.data.file.pathlike == .path,
            .io_request = std.mem.zeroes(uv.fs_t),
            .uv_bufs = .{.{ .base = undefined, .len = 0 }},
            .event_loop = event_loop,
        });
        file_blob.store.?.ref();
        bytes_blob.store.?.ref();
        write_file.io_request.loop = event_loop.virtual_machine.event_loop_handle.?;
        write_file.io_request.data = write_file;

        switch (file_blob.store.?.data.file.pathlike) {
            .path => {
                write_file.open();
            },
            .fd => {
                write_file.fd = brk: {
                    if (event_loop.virtual_machine.rare_data) |rare| {
                        if (file_blob.store == rare.stdout_store) {
                            break :brk 1;
                        } else if (file_blob.store == rare.stderr_store) {
                            break :brk 2;
                        } else if (file_blob.store == rare.stdin_store) {
                            break :brk 0;
                        }
                    }

                    // The file stored descriptor is not stdin, stdout, or stderr.
                    break :brk bun.uvfdcast(file_blob.store.?.data.file.pathlike.fd);
                };

                write_file.doWriteLoop(write_file.loop());
            },
        }

        write_file.event_loop.refConcurrently();
        return write_file;
    }
    pub const ResultType = WriteFile.ResultType;
    pub const OnWriteFileCallback = WriteFile.OnWriteFileCallback;

    pub inline fn loop(this: *const WriteFileWindows) *uv.Loop {
        return this.event_loop.virtual_machine.event_loop_handle.?;
    }

    pub fn open(this: *WriteFileWindows) void {
        const path = this.file_blob.store.?.data.file.pathlike.path.slice();
        this.io_request.data = this;
        const rc = uv.uv_fs_open(
            this.loop(),
            &this.io_request,
            &(std.posix.toPosixPath(path) catch {
                this.throw(bun.sys.Error{
                    .errno = @intFromEnum(bun.C.E.NAMETOOLONG),
                    .syscall = .open,
                });
                return;
            }),
            uv.O.CREAT | uv.O.WRONLY | uv.O.NOCTTY | uv.O.NONBLOCK | uv.O.SEQUENTIAL | uv.O.TRUNC,
            0o644,
            @ptrCast(&onOpen),
        );

        // libuv always returns 0 when a callback is specified
        if (rc.errEnum()) |err| {
            bun.assert(err != .NOENT);

            this.throw(.{
                .errno = @intFromEnum(err),
                .path = path,
                .syscall = .open,
            });
        } else {
            this.owned_fd = true;
        }
    }

    pub fn onOpen(req: *uv.fs_t) callconv(.C) void {
        var this: *WriteFileWindows = @fieldParentPtr("io_request", req);
        bun.assert(this == @as(*WriteFileWindows, @alignCast(@ptrCast(req.data.?))));
        const rc = this.io_request.result;
        if (comptime Environment.allow_assert)
            log("onOpen({s}) = {}", .{ this.file_blob.store.?.data.file.pathlike.path.slice(), rc });

        if (rc.errEnum()) |err| {
            if (err == .NOENT and this.mkdirp_if_not_exists) {
                // cleanup the request so we can reuse it later.
                req.deinit();

                // attempt to create the directory on another thread
                this.mkdirp();
                return;
            }

            this.throw(.{
                .errno = @intFromEnum(err),
                .path = this.file_blob.store.?.data.file.pathlike.path.slice(),
                .syscall = .open,
            });
            return;
        }

        this.fd = @intCast(rc.int());

        // the loop must be copied
        this.doWriteLoop(this.loop());
    }

    fn mkdirp(this: *WriteFileWindows) void {
        log("mkdirp", .{});
        this.mkdirp_if_not_exists = false;
        this.event_loop.refConcurrently();

        const path = this.file_blob.store.?.data.file.pathlike.path.slice();
        JSC.Node.Async.AsyncMkdirp.new(.{
            .completion = @ptrCast(&onMkdirpCompleteConcurrent),
            .completion_ctx = this,
            .path = bun.Dirname.dirname(u8, path)
            // this shouldn't happen
            orelse path,
        }).schedule();
    }

    fn onMkdirpComplete(this: *WriteFileWindows) void {
        this.event_loop.unrefConcurrently();

        const err = this.err;
        this.err = null;
        if (err) |err_| {
            this.throw(err_);
            bun.default_allocator.free(err_.path);
            return;
        }

        this.open();
    }

    fn onMkdirpCompleteConcurrent(this: *WriteFileWindows, err_: JSC.Maybe(void)) void {
        log("mkdirp complete", .{});
        bun.assert(this.err == null);
        this.err = if (err_ == .err) err_.err else null;
        this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.ManagedTask.New(WriteFileWindows, onMkdirpComplete).init(this)));
    }

    fn onWriteComplete(req: *uv.fs_t) callconv(.C) void {
        var this: *WriteFileWindows = @fieldParentPtr("io_request", req);
        bun.assert(this == @as(*WriteFileWindows, @alignCast(@ptrCast(req.data.?))));
        const rc = this.io_request.result;
        if (rc.errno()) |err| {
            this.throw(.{
                .errno = @intCast(err),
                .syscall = .write,
            });
            return;
        }

        this.total_written += @intCast(rc.int());
        this.doWriteLoop(this.loop());
    }

    pub fn onFinish(container: *WriteFileWindows) void {
        container.event_loop.unrefConcurrently();
        var event_loop = container.event_loop;
        event_loop.enter();
        defer event_loop.exit();

        // We don't need to enqueue task since this is already in a task.
        container.runFromJSThread();
    }

    pub fn runFromJSThread(this: *WriteFileWindows) void {
        const cb = this.onCompleteCallback;
        const cb_ctx = this.onCompleteCtx;

        if (this.toSystemError()) |err| {
            this.deinit();
            cb(cb_ctx, .{
                .err = err,
            });
        } else {
            const wrote = this.total_written;
            this.deinit();
            cb(cb_ctx, .{ .result = @as(SizeType, @truncate(wrote)) });
        }
    }

    pub fn throw(this: *WriteFileWindows, err: bun.sys.Error) void {
        bun.assert(this.err == null);
        this.err = err;
        this.onFinish();
    }

    pub fn toSystemError(this: *WriteFileWindows) ?JSC.SystemError {
        if (this.err) |err| {
            var sys_err = err;
            if (this.owned_fd) {
                sys_err = sys_err.withPath(this.file_blob.store.?.data.file.pathlike.path.slice());
            } else {
                sys_err = sys_err.withFd(this.file_blob.store.?.data.file.pathlike.fd);
            }

            return sys_err.toSystemError();
        }
        return null;
    }

    pub fn doWriteLoop(this: *WriteFileWindows, uv_loop: *uv.Loop) void {
        var remain = this.bytes_blob.sharedView();
        remain = remain[@min(this.total_written, remain.len)..];

        if (remain.len == 0 or this.err != null) {
            this.onFinish();
            return;
        }

        this.uv_bufs[0].base = @constCast(remain.ptr);
        this.uv_bufs[0].len = @truncate(remain.len);

        uv.uv_fs_req_cleanup(&this.io_request);
        const rc = uv.uv_fs_write(uv_loop, &this.io_request, this.fd, &this.uv_bufs, 1, -1, &onWriteComplete);
        this.io_request.data = this;
        if (rc.int() == 0) {
            // EINPROGRESS
            return;
        }

        if (rc.errno()) |err| {
            this.throw(.{
                .errno = err,
                .syscall = .write,
            });
            return;
        }

        if (rc.int() != 0) bun.Output.panic("unexpected return code from uv_fs_write: {d}", .{rc.int()});
    }

    pub usingnamespace bun.New(@This());

    pub fn deinit(this: *@This()) void {
        const fd = this.fd;
        if (fd > 0 and this.owned_fd) {
            bun.Async.Closer.close(fd, this.io_request.loop);
        }
        this.file_blob.store.?.deref();
        this.bytes_blob.store.?.deref();
        uv.uv_fs_req_cleanup(&this.io_request);
        this.destroy();
    }

    pub fn create(
        event_loop: *JSC.EventLoop,
        file_blob: Blob,
        bytes_blob: Blob,
        comptime Context: type,
        context: Context,
        comptime callback: *const fn (ctx: Context, bytes: ResultType) void,
        mkdirp_if_not_exists: bool,
    ) *WriteFileWindows {
        return WriteFileWindows.createWithCtx(
            file_blob,
            bytes_blob,
            event_loop,
            @as(*anyopaque, @ptrCast(context)),
            @ptrCast(callback),
            mkdirp_if_not_exists,
        );
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
            .Error => |*err_ref| {
                file_blob.detach();
                _ = value.use();
                this.promise.deinit();
                bun.destroy(this);
                promise.reject(globalThis, err_ref.toJS(globalThis));
            },
            .Used => {
                file_blob.detach();
                _ = value.use();
                this.promise.deinit();
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
                const new_promise = Blob.writeFileWithSourceDestination(globalThis, &blob, &file_blob, .{ .mkdirp_if_not_exists = this.mkdirp_if_not_exists });
                if (new_promise.asAnyPromise()) |p| {
                    switch (p.unwrap(globalThis.vm(), .mark_handled)) {
                        // Fulfill the new promise using the pending promise
                        .pending => promise.resolve(globalThis, new_promise),

                        .rejected => |err| promise.reject(globalThis, err),
                        .fulfilled => |result| promise.resolve(globalThis, result),
                    }
                }

                file_blob.detach();
                this.promise.deinit();
                bun.destroy(this);
            },
            .Locked => {
                value.Locked.onReceiveValue = thenWrap;
                value.Locked.task = this;
            },
        }
    }
};
