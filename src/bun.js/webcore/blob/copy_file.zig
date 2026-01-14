// blocking, but off the main thread
pub const CopyFile = struct {
    destination_file_store: Store.File,
    source_file_store: Store.File,
    store: ?*Store = null,
    source_store: ?*Store = null,
    offset: SizeType = 0,
    size: SizeType = 0,
    max_length: SizeType = Blob.max_size,
    destination_fd: bun.FileDescriptor = bun.invalid_fd,
    source_fd: bun.FileDescriptor = bun.invalid_fd,

    system_error: ?SystemError = null,

    read_len: SizeType = 0,
    read_off: SizeType = 0,

    globalThis: *JSGlobalObject,

    mkdirp_if_not_exists: bool = false,
    destination_mode: ?bun.Mode = null,

    pub const ResultType = anyerror!SizeType;

    pub const Callback = *const fn (ctx: *anyopaque, len: ResultType) void;

    pub fn create(
        allocator: std.mem.Allocator,
        store: *Store,
        source_store: *Store,
        off: SizeType,
        max_len: SizeType,
        globalThis: *JSGlobalObject,
        mkdirp_if_not_exists: bool,
        destination_mode: ?bun.Mode,
    ) *CopyFilePromiseTask {
        const read_file = bun.new(CopyFile, CopyFile{
            .store = store,
            .source_store = source_store,
            .offset = off,
            .max_length = max_len,
            .globalThis = globalThis,
            .destination_file_store = store.data.file,
            .source_file_store = source_store.data.file,
            .mkdirp_if_not_exists = mkdirp_if_not_exists,
            .destination_mode = destination_mode,
        });
        store.ref();
        source_store.ref();
        return CopyFilePromiseTask.createOnJSThread(allocator, globalThis, read_file);
    }

    const linux = std.os.linux;
    const darwin = std.posix.system;

    pub fn deinit(this: *CopyFile) void {
        if (this.source_file_store.pathlike == .path) {
            if (this.source_file_store.pathlike.path == .string and this.system_error == null) {
                bun.default_allocator.free(@constCast(this.source_file_store.pathlike.path.slice()));
            }
        }
        this.store.?.deref();

        bun.destroy(this);
    }

    pub fn reject(this: *CopyFile, promise: *jsc.JSPromise) bun.JSTerminated!void {
        const globalThis = this.globalThis;
        var system_error: SystemError = this.system_error orelse SystemError{ .message = .empty };
        if (this.source_file_store.pathlike == .path and system_error.path.isEmpty()) {
            system_error.path = bun.String.cloneUTF8(this.source_file_store.pathlike.path.slice());
        }

        if (system_error.message.isEmpty()) {
            system_error.message = bun.String.static("Failed to copy file");
        }

        const instance = system_error.toErrorInstance(this.globalThis);
        if (this.store) |store| {
            store.deref();
        }
        try promise.reject(globalThis, instance);
    }

    pub fn then(this: *CopyFile, promise: *jsc.JSPromise) bun.JSTerminated!void {
        this.source_store.?.deref();

        if (this.system_error != null) {
            try this.reject(promise);
            return;
        }

        try promise.resolve(this.globalThis, .jsNumberFromUint64(this.read_len));
    }

    pub fn run(this: *CopyFile) void {
        this.runAsync();
    }

    pub fn doClose(this: *CopyFile) void {
        const close_input = this.destination_file_store.pathlike != .fd and this.destination_fd != bun.invalid_fd;
        const close_output = this.source_file_store.pathlike != .fd and this.source_fd != bun.invalid_fd;

        // Apply destination mode using fchmod before closing (for POSIX platforms)
        // This ensures mode is applied even when overwriting existing files, since
        // open()'s mode argument only affects newly created files.
        // On macOS clonefile path, chmod is called separately after clonefile.
        // On Windows, this is handled via async uv_fs_chmod.
        if (comptime !Environment.isWindows) {
            if (this.destination_mode) |mode| {
                if (this.destination_fd != bun.invalid_fd and this.system_error == null) {
                    switch (bun.sys.fchmod(this.destination_fd, mode)) {
                        .err => |err| {
                            this.system_error = err.toSystemError();
                        },
                        .result => {},
                    }
                }
            }
        }

        if (close_input and close_output) {
            this.doCloseFile(.both);
        } else if (close_input) {
            this.doCloseFile(.destination);
        } else if (close_output) {
            this.doCloseFile(.source);
        }
    }

    const posix = std.posix;

    pub fn doCloseFile(this: *CopyFile, comptime which: IOWhich) void {
        switch (which) {
            .both => {
                this.destination_fd.close();
                this.source_fd.close();
            },
            .destination => {
                this.destination_fd.close();
            },
            .source => {
                this.source_fd.close();
            },
        }
    }

    const O = bun.O;
    const open_destination_flags = O.CLOEXEC | O.CREAT | O.WRONLY | O.TRUNC;
    const open_source_flags = O.CLOEXEC | O.RDONLY;

    pub fn doOpenFile(this: *CopyFile, comptime which: IOWhich) !void {
        var path_buf1: bun.PathBuffer = undefined;
        // open source file first
        // if it fails, we don't want the extra destination file hanging out
        if (which == .both or which == .source) {
            this.source_fd = switch (bun.sys.open(
                this.source_file_store.pathlike.path.sliceZ(&path_buf1),
                open_source_flags,
                0,
            )) {
                .result => |result| switch (result.makeLibUVOwnedForSyscall(.open, .close_on_fail)) {
                    .result => |result_fd| result_fd,
                    .err => |errno| {
                        this.system_error = errno.toSystemError();
                        return bun.errnoToZigErr(errno.errno);
                    },
                },
                .err => |errno| {
                    this.system_error = errno.toSystemError();
                    return bun.errnoToZigErr(errno.errno);
                },
            };
        }

        if (which == .both or which == .destination) {
            while (true) {
                const dest = this.destination_file_store.pathlike.path.sliceZ(&path_buf1);
                const mode = this.destination_mode orelse jsc.Node.fs.default_permission;
                this.destination_fd = switch (bun.sys.open(
                    dest,
                    open_destination_flags,
                    mode,
                )) {
                    .result => |result| switch (result.makeLibUVOwnedForSyscall(.open, .close_on_fail)) {
                        .result => |result_fd| result_fd,
                        .err => |errno| {
                            this.system_error = errno.toSystemError();
                            return bun.errnoToZigErr(errno.errno);
                        },
                    },
                    .err => |errno| {
                        switch (Blob.mkdirIfNotExists(this, errno, dest, dest)) {
                            .@"continue" => continue,
                            .fail => {
                                if (which == .both) {
                                    this.source_fd.close();
                                    this.source_fd = .invalid;
                                }
                                return bun.errnoToZigErr(errno.errno);
                            },
                            .no => {},
                        }

                        if (which == .both) {
                            this.source_fd.close();
                            this.source_fd = .invalid;
                        }

                        this.system_error = errno.withPath(this.destination_file_store.pathlike.path.slice()).toSystemError();
                        return bun.errnoToZigErr(errno.errno);
                    },
                };
                break;
            }
        }
    }

    const TryWith = enum {
        sendfile,
        copy_file_range,
        splice,

        pub const tag = std.EnumMap(TryWith, bun.sys.Tag).init(.{
            .sendfile = .sendfile,
            .copy_file_range = .copy_file_range,
            .splice = .splice,
        });
    };

    pub fn doCopyFileRange(
        this: *CopyFile,
        comptime use: TryWith,
        comptime clear_append_if_invalid: bool,
    ) anyerror!void {
        this.read_off += this.offset;

        var remain = @as(usize, this.max_length);
        const unknown_size = remain == Blob.max_size or remain == 0;
        if (unknown_size) {
            // sometimes stat lies
            // let's give it 4096 and see how it goes
            remain = 4096;
        }

        var total_written: usize = 0;
        const src_fd = this.source_fd;
        const dest_fd = this.destination_fd;

        defer {
            this.read_len = @as(SizeType, @truncate(total_written));
        }

        var has_unset_append = false;

        // If they can't use copy_file_range, they probably also can't
        // use sendfile() or splice()
        if (!bun.canUseCopyFileRangeSyscall()) {
            switch (jsc.Node.fs.NodeFS.copyFileUsingReadWriteLoop("", "", src_fd, dest_fd, if (unknown_size) 0 else remain, &total_written)) {
                .err => |err| {
                    this.system_error = err.toSystemError();
                    return bun.errnoToZigErr(err.errno);
                },
                .result => {
                    _ = linux.ftruncate(dest_fd.cast(), @as(std.posix.off_t, @intCast(total_written)));
                    return;
                },
            }
        }

        while (true) {
            // TODO: this should use non-blocking I/O.
            const written = switch (comptime use) {
                .copy_file_range => linux.copy_file_range(src_fd.cast(), null, dest_fd.cast(), null, remain, 0),
                .sendfile => linux.sendfile(dest_fd.cast(), src_fd.cast(), null, remain),
                .splice => bun.linux.splice(src_fd.cast(), null, dest_fd.cast(), null, remain, 0),
            };

            switch (bun.sys.getErrno(written)) {
                .SUCCESS => {},

                // XDEV: cross-device copy not supported
                // NOSYS: syscall not available
                // OPNOTSUPP: filesystem doesn't support this operation
                .NOSYS, .XDEV, .OPNOTSUPP => {
                    // TODO: this should use non-blocking I/O.
                    switch (jsc.Node.fs.NodeFS.copyFileUsingReadWriteLoop("", "", src_fd, dest_fd, if (unknown_size) 0 else remain, &total_written)) {
                        .err => |err| {
                            this.system_error = err.toSystemError();
                            return bun.errnoToZigErr(err.errno);
                        },
                        .result => {
                            _ = linux.ftruncate(dest_fd.cast(), @as(std.posix.off_t, @intCast(total_written)));
                            return;
                        },
                    }
                },

                // EINVAL: eCryptfs and other filesystems may not support copy_file_range.
                // Also returned when the file descriptor is incompatible with the syscall.
                .INVAL => {
                    if (comptime clear_append_if_invalid) {
                        if (!has_unset_append) {
                            // https://kylelaker.com/2018/08/31/stdout-oappend.html
                            // make() can set STDOUT / STDERR to O_APPEND
                            // this messes up sendfile()
                            has_unset_append = true;
                            const flags = linux.fcntl(dest_fd.cast(), linux.F.GETFL, @as(c_int, 0));
                            if ((flags & O.APPEND) != 0) {
                                _ = linux.fcntl(dest_fd.cast(), linux.F.SETFL, flags ^ O.APPEND);
                                continue;
                            }
                        }
                    }

                    // If the Linux machine doesn't support
                    // copy_file_range or the file descriptor is
                    // incompatible with the chosen syscall, fall back
                    // to a read/write loop
                    if (total_written == 0) {
                        // TODO: this should use non-blocking I/O.
                        switch (jsc.Node.fs.NodeFS.copyFileUsingReadWriteLoop("", "", src_fd, dest_fd, if (unknown_size) 0 else remain, &total_written)) {
                            .err => |err| {
                                this.system_error = err.toSystemError();
                                return bun.errnoToZigErr(err.errno);
                            },
                            .result => {
                                _ = linux.ftruncate(dest_fd.cast(), @as(std.posix.off_t, @intCast(total_written)));
                                return;
                            },
                        }
                    }

                    this.system_error = (bun.sys.Error{
                        .errno = @as(bun.sys.Error.Int, @intCast(@intFromEnum(linux.E.INVAL))),
                        .syscall = TryWith.tag.get(use).?,
                    }).toSystemError();
                    return bun.errnoToZigErr(linux.E.INVAL);
                },
                else => |errno| {
                    this.system_error = (bun.sys.Error{
                        .errno = @as(bun.sys.Error.Int, @intCast(@intFromEnum(errno))),
                        .syscall = TryWith.tag.get(use).?,
                    }).toSystemError();
                    return bun.errnoToZigErr(errno);
                },
            }

            // wrote zero bytes means EOF
            remain -|= @intCast(written);
            total_written += @intCast(written);
            if (written == 0 or remain == 0) break;
        }
    }

    pub fn doFCopyFileWithReadWriteLoopFallback(this: *CopyFile) anyerror!void {
        switch (bun.sys.fcopyfile(this.source_fd, this.destination_fd, posix.system.COPYFILE{ .DATA = true })) {
            .err => |errno| {
                switch (errno.getErrno()) {
                    // If the file type doesn't support seeking, it may return EBADF
                    // Example case:
                    //
                    // bun test bun-write.test | xargs echo
                    //
                    .BADF => {
                        var total_written: u64 = 0;

                        // TODO: this should use non-blocking I/O.
                        switch (jsc.Node.fs.NodeFS.copyFileUsingReadWriteLoop("", "", this.source_fd, this.destination_fd, 0, &total_written)) {
                            .err => |err| {
                                this.system_error = err.toSystemError();
                                return bun.errnoToZigErr(err.errno);
                            },
                            .result => {},
                        }
                    },
                    else => {
                        this.system_error = errno.toSystemError();

                        return bun.errnoToZigErr(errno.errno);
                    },
                }
            },
            .result => {},
        }
    }

    pub fn doClonefile(this: *CopyFile) anyerror!void {
        var source_buf: bun.PathBuffer = undefined;
        var dest_buf: bun.PathBuffer = undefined;

        while (true) {
            const dest = this.destination_file_store.pathlike.path.sliceZ(
                &dest_buf,
            );
            switch (bun.sys.clonefile(
                this.source_file_store.pathlike.path.sliceZ(&source_buf),
                dest,
            )) {
                .err => |errno| {
                    switch (Blob.mkdirIfNotExists(this, errno, dest, this.destination_file_store.pathlike.path.slice())) {
                        .@"continue" => continue,
                        .fail => {},
                        .no => {},
                    }
                    this.system_error = errno.toSystemError();
                    return bun.errnoToZigErr(errno.errno);
                },
                .result => {},
            }
            break;
        }
    }

    pub fn runAsync(this: *CopyFile) void {
        if (Environment.isWindows) return; //why
        // defer task.onFinish();

        var stat_: ?bun.Stat = null;

        if (this.destination_file_store.pathlike == .fd) {
            this.destination_fd = this.destination_file_store.pathlike.fd;
        }

        if (this.source_file_store.pathlike == .fd) {
            this.source_fd = this.source_file_store.pathlike.fd;
        }

        // Do we need to open both files?
        if (this.destination_fd == bun.invalid_fd and this.source_fd == bun.invalid_fd) {

            // First, we attempt to clonefile() on macOS
            // This is the fastest way to copy a file.
            if (comptime Environment.isMac) {
                if (this.offset == 0 and this.source_file_store.pathlike == .path and this.destination_file_store.pathlike == .path) {
                    do_clonefile: {
                        var path_buf: bun.PathBuffer = undefined;

                        // stat the output file, make sure it:
                        // 1. Exists
                        switch (bun.sys.stat(this.source_file_store.pathlike.path.sliceZ(&path_buf))) {
                            .result => |result| {
                                stat_ = result;

                                if (posix.S.ISDIR(result.mode)) {
                                    this.system_error = unsupported_directory_error;
                                    return;
                                }

                                if (!posix.S.ISREG(result.mode))
                                    break :do_clonefile;
                            },
                            .err => |err| {
                                // If we can't stat it, we also can't copy it.
                                this.system_error = err.toSystemError();
                                return;
                            },
                        }

                        if (this.doClonefile()) {
                            if (this.max_length != Blob.max_size and this.max_length < @as(SizeType, @intCast(stat_.?.size))) {
                                // If this fails...well, there's not much we can do about it.
                                _ = bun.c.truncate(
                                    this.destination_file_store.pathlike.path.sliceZ(&path_buf),
                                    @as(std.posix.off_t, @intCast(this.max_length)),
                                );
                                this.read_len = @as(SizeType, @intCast(this.max_length));
                            } else {
                                this.read_len = @as(SizeType, @intCast(stat_.?.size));
                            }
                            // Apply destination mode if specified (clonefile copies source permissions)
                            if (this.destination_mode) |mode| {
                                switch (bun.sys.chmod(this.destination_file_store.pathlike.path.sliceZ(&path_buf), mode)) {
                                    .err => |err| {
                                        this.system_error = err.toSystemError();
                                        return;
                                    },
                                    .result => {},
                                }
                            }
                            return;
                        } else |_| {

                            // this may still fail, in which case we just continue trying with fcopyfile
                            // it can fail when the input file already exists
                            // or if the output is not a directory
                            // or if it's a network volume
                            this.system_error = null;
                        }
                    }
                }
            }

            this.doOpenFile(.both) catch return;
            // Do we need to open only one file?
        } else if (this.destination_fd == bun.invalid_fd) {
            this.source_fd = this.source_file_store.pathlike.fd;

            this.doOpenFile(.destination) catch return;
            // Do we need to open only one file?
        } else if (this.source_fd == bun.invalid_fd) {
            this.destination_fd = this.destination_file_store.pathlike.fd;

            this.doOpenFile(.source) catch return;
        }

        if (this.system_error != null) {
            return;
        }

        assert(this.destination_fd.isValid());
        assert(this.source_fd.isValid());

        if (this.destination_file_store.pathlike == .fd) {}

        const stat: bun.Stat = stat_ orelse switch (bun.sys.fstat(this.source_fd)) {
            .result => |result| result,
            .err => |err| {
                this.doClose();
                this.system_error = err.toSystemError();
                return;
            },
        };

        if (posix.S.ISDIR(stat.mode)) {
            this.system_error = unsupported_directory_error;
            this.doClose();
            return;
        }

        if (stat.size != 0) {
            this.max_length = @max(@min(@as(SizeType, @intCast(stat.size)), this.max_length), this.offset) - this.offset;
            if (this.max_length == 0) {
                this.doClose();
                return;
            }

            if (bun.sys.preallocate_supported and
                posix.S.ISREG(stat.mode) and
                this.max_length > bun.sys.preallocate_length and
                this.max_length != Blob.max_size)
            {
                bun.sys.preallocate_file(this.destination_fd.cast(), 0, this.max_length) catch {};
            }
        }

        if (comptime Environment.isLinux) {

            // Bun.write(Bun.file("a"), Bun.file("b"))
            if (posix.S.ISREG(stat.mode) and (posix.S.ISREG(this.destination_file_store.mode) or this.destination_file_store.mode == 0)) {
                if (this.destination_file_store.is_atty orelse false) {
                    this.doCopyFileRange(.copy_file_range, true) catch {};
                } else {
                    this.doCopyFileRange(.copy_file_range, false) catch {};
                }

                this.doClose();
                return;
            }

            // $ bun run foo.js | bun run bar.js
            if (posix.S.ISFIFO(stat.mode) and posix.S.ISFIFO(this.destination_file_store.mode)) {
                if (this.destination_file_store.is_atty orelse false) {
                    this.doCopyFileRange(.splice, true) catch {};
                } else {
                    this.doCopyFileRange(.splice, false) catch {};
                }

                this.doClose();
                return;
            }

            if (posix.S.ISREG(stat.mode) or posix.S.ISCHR(stat.mode) or posix.S.ISSOCK(stat.mode)) {
                if (this.destination_file_store.is_atty orelse false) {
                    this.doCopyFileRange(.sendfile, true) catch {};
                } else {
                    this.doCopyFileRange(.sendfile, false) catch {};
                }

                this.doClose();
                return;
            }

            this.system_error = unsupported_non_regular_file_error;
            this.doClose();
            return;
        }

        if (comptime Environment.isMac) {
            this.doFCopyFileWithReadWriteLoopFallback() catch {
                this.doClose();

                return;
            };
            if (stat.size != 0 and @as(SizeType, @intCast(stat.size)) > this.max_length) {
                _ = darwin.ftruncate(this.destination_fd.cast(), @as(std.posix.off_t, @intCast(this.max_length)));
            }

            this.doClose();
        } else {
            @compileError("TODO: implement copyfile");
        }
    }
};

pub const CopyFileWindows = struct {
    destination_file_store: *Store,
    source_file_store: *Store,

    io_request: libuv.fs_t = std.mem.zeroes(libuv.fs_t),
    promise: jsc.JSPromise.Strong = .{},
    mkdirp_if_not_exists: bool = false,
    destination_mode: ?bun.Mode = null,
    event_loop: *jsc.EventLoop,

    size: Blob.SizeType = Blob.max_size,

    /// Bytes written, stored for use after async chmod completes
    written_bytes: usize = 0,

    /// For mkdirp
    err: ?bun.sys.Error = null,

    /// When we are unable to get the original file path, we do a read-write loop that uses libuv.
    read_write_loop: ReadWriteLoop = .{},

    pub const ReadWriteLoop = struct {
        source_fd: bun.FileDescriptor = bun.invalid_fd,
        must_close_source_fd: bool = false,
        destination_fd: bun.FileDescriptor = bun.invalid_fd,
        must_close_destination_fd: bool = false,
        written: usize = 0,
        read_buf: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),
        uv_buf: libuv.uv_buf_t = .{ .base = undefined, .len = 0 },

        pub fn start(read_write_loop: *ReadWriteLoop, this: *CopyFileWindows) bun.sys.Maybe(void) {
            bun.handleOom(read_write_loop.read_buf.ensureTotalCapacityPrecise(64 * 1024));

            return read(read_write_loop, this);
        }

        pub fn read(read_write_loop: *ReadWriteLoop, this: *CopyFileWindows) bun.sys.Maybe(void) {
            read_write_loop.read_buf.items.len = 0;
            read_write_loop.uv_buf = libuv.uv_buf_t.init(read_write_loop.read_buf.allocatedSlice());
            const loop = this.event_loop.virtual_machine.event_loop_handle.?;

            // This io_request is used for both reading and writing.
            // For now, we don't start reading the next chunk until
            // we've finished writing all the previous chunks.
            this.io_request.data = @ptrCast(this);

            const rc = libuv.uv_fs_read(
                loop,
                &this.io_request,
                read_write_loop.source_fd.uv(),
                @ptrCast(&read_write_loop.uv_buf),
                1,
                -1,
                &onRead,
            );

            if (rc.toError(.read)) |err| {
                return .{ .err = err };
            }

            return .success;
        }

        fn onRead(req: *libuv.fs_t) callconv(.c) void {
            var this: *CopyFileWindows = @fieldParentPtr("io_request", req);
            bun.assert(req.data == @as(?*anyopaque, @ptrCast(this)));

            const source_fd = this.read_write_loop.source_fd;
            const destination_fd = this.read_write_loop.destination_fd;
            const read_buf = &this.read_write_loop.read_buf.items;

            const event_loop = this.event_loop;

            const rc = req.result;

            bun.sys.syslog("uv_fs_read({f}, {d}) = {d}", .{ source_fd, read_buf.len, rc.int() });
            if (rc.toError(.read)) |err| {
                this.err = err;
                this.onReadWriteLoopComplete();
                return;
            }

            read_buf.len = @intCast(rc.int());
            this.read_write_loop.uv_buf = libuv.uv_buf_t.init(read_buf.*);

            if (rc.int() == 0) {
                // Handle EOF. We can't read any more.
                this.onReadWriteLoopComplete();
                return;
            }

            // Re-use the fs request.
            req.deinit();
            const rc2 = libuv.uv_fs_write(
                event_loop.virtual_machine.event_loop_handle.?,
                &this.io_request,
                destination_fd.uv(),
                @ptrCast(&this.read_write_loop.uv_buf),
                1,
                -1,
                &onWrite,
            );
            req.data = @ptrCast(this);

            if (rc2.toError(.write)) |err| {
                this.err = err;
                this.onReadWriteLoopComplete();
                return;
            }
        }

        fn onWrite(req: *libuv.fs_t) callconv(.c) void {
            var this: *CopyFileWindows = @fieldParentPtr("io_request", req);
            bun.assert(req.data == @as(?*anyopaque, @ptrCast(this)));
            const buf = &this.read_write_loop.read_buf.items;

            const destination_fd = this.read_write_loop.destination_fd;

            const rc = req.result;

            bun.sys.syslog("uv_fs_write({f}, {d}) = {d}", .{ destination_fd, buf.len, rc.int() });

            if (rc.toError(.write)) |err| {
                this.err = err;
                this.onReadWriteLoopComplete();
                return;
            }

            const wrote: u32 = @intCast(rc.int());

            this.read_write_loop.written += wrote;

            if (wrote < buf.len) {
                if (wrote == 0) {
                    // Handle EOF. We can't write any more.
                    this.onReadWriteLoopComplete();
                    return;
                }

                // Re-use the fs request.
                req.deinit();
                req.data = @ptrCast(this);

                this.read_write_loop.uv_buf = libuv.uv_buf_t.init(this.read_write_loop.uv_buf.slice()[wrote..]);
                const rc2 = libuv.uv_fs_write(
                    this.event_loop.virtual_machine.event_loop_handle.?,
                    &this.io_request,
                    destination_fd.uv(),
                    @ptrCast(&this.read_write_loop.uv_buf),
                    1,
                    -1,
                    &onWrite,
                );

                if (rc2.toError(.write)) |err| {
                    this.err = err;
                    this.onReadWriteLoopComplete();
                    return;
                }

                return;
            }

            req.deinit();
            switch (this.read_write_loop.read(this)) {
                .err => |err| {
                    this.err = err;
                    this.onReadWriteLoopComplete();
                },
                .result => {},
            }
        }

        pub fn close(this: *ReadWriteLoop) void {
            if (this.must_close_source_fd) {
                if (this.source_fd.makeLibUVOwned()) |fd| {
                    bun.Async.Closer.close(
                        fd,
                        bun.Async.Loop.get(),
                    );
                } else |_| {
                    this.source_fd.close();
                }
                this.must_close_source_fd = false;
                this.source_fd = bun.invalid_fd;
            }

            if (this.must_close_destination_fd) {
                if (this.destination_fd.makeLibUVOwned()) |fd| {
                    bun.Async.Closer.close(
                        fd,
                        bun.Async.Loop.get(),
                    );
                } else |_| {
                    this.destination_fd.close();
                }
                this.must_close_destination_fd = false;
                this.destination_fd = bun.invalid_fd;
            }

            this.read_buf.clearAndFree();
        }
    };

    pub fn onReadWriteLoopComplete(this: *CopyFileWindows) void {
        this.event_loop.unrefConcurrently();

        if (this.err) |err| {
            this.err = null;
            this.throw(err);
            return;
        }

        this.onComplete(this.read_write_loop.written);
    }

    pub const new = bun.TrivialNew(@This());

    pub fn init(
        destination_file_store: *Store,
        source_file_store: *Store,
        event_loop: *jsc.EventLoop,
        mkdirp_if_not_exists: bool,
        size_: Blob.SizeType,
        destination_mode: ?bun.Mode,
    ) jsc.JSValue {
        destination_file_store.ref();
        source_file_store.ref();
        const result = CopyFileWindows.new(.{
            .destination_file_store = destination_file_store,
            .source_file_store = source_file_store,
            .promise = jsc.JSPromise.Strong.init(event_loop.global),
            .io_request = std.mem.zeroes(libuv.fs_t),
            .event_loop = event_loop,
            .mkdirp_if_not_exists = mkdirp_if_not_exists,
            .destination_mode = destination_mode,
            .size = size_,
        });
        const promise = result.promise.value();

        // On error, this function might free the CopyFileWindows struct.
        // So we can no longer reference it beyond this point.
        result.copyfile();

        return promise;
    }

    fn preparePathlike(pathlike: *jsc.Node.PathOrFileDescriptor, must_close: *bool, is_reading: bool) bun.sys.Maybe(bun.FileDescriptor) {
        if (pathlike.* == .path) {
            const fd = switch (bun.sys.openatWindowsT(
                u8,
                bun.invalid_fd,
                pathlike.path.slice(),
                if (is_reading)
                    bun.O.RDONLY
                else
                    bun.O.WRONLY | bun.O.CREAT,
                0,
            )) {
                .result => |result| result.makeLibUVOwned() catch {
                    result.close();
                    return .{
                        .err = .{
                            .errno = @as(c_int, @intCast(@intFromEnum(bun.sys.SystemErrno.EMFILE))),
                            .syscall = .open,
                            .path = pathlike.path.slice(),
                        },
                    };
                },
                .err => |err| {
                    return .{
                        .err = err,
                    };
                },
            };
            must_close.* = true;
            return .{ .result = fd };
        } else {
            // We assume that this is already a uv-casted file descriptor.
            return .{ .result = pathlike.fd };
        }
    }

    fn prepareReadWriteLoop(this: *CopyFileWindows) void {
        // Open the destination first, so that if we need to call
        // mkdirp(), we don't spend extra time opening the file handle for
        // the source.
        this.read_write_loop.destination_fd = switch (preparePathlike(&this.destination_file_store.data.file.pathlike, &this.read_write_loop.must_close_destination_fd, false)) {
            .result => |fd| fd,
            .err => |err| {
                if (this.mkdirp_if_not_exists and err.getErrno() == .NOENT) {
                    this.mkdirp();
                    return;
                }

                this.throw(err);
                return;
            },
        };

        this.read_write_loop.source_fd = switch (preparePathlike(&this.source_file_store.data.file.pathlike, &this.read_write_loop.must_close_source_fd, true)) {
            .result => |fd| fd,
            .err => |err| {
                this.throw(err);
                return;
            },
        };

        switch (this.read_write_loop.start(this)) {
            .err => |err| {
                this.throw(err);
                return;
            },
            .result => {
                this.event_loop.refConcurrently();
            },
        }
    }

    fn copyfile(this: *CopyFileWindows) void {
        // This is for making it easier for us to test this code path
        if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE.get()) {
            this.prepareReadWriteLoop();
            return;
        }

        var pathbuf1: bun.PathBuffer = undefined;
        var pathbuf2: bun.PathBuffer = undefined;
        var destination_file_store = &this.destination_file_store.data.file;
        var source_file_store = &this.source_file_store.data.file;

        const new_path: [:0]const u8 = brk: {
            switch (destination_file_store.pathlike) {
                .path => {
                    break :brk destination_file_store.pathlike.path.sliceZ(&pathbuf1);
                },
                .fd => |fd| {
                    switch (bun.sys.File.from(fd).kind()) {
                        .err => |err| {
                            this.throw(err);
                            return;
                        },
                        .result => |kind| {
                            switch (kind) {
                                .directory => {
                                    this.throw(bun.sys.Error.fromCode(.ISDIR, .open));
                                    return;
                                },
                                .character_device => {
                                    this.prepareReadWriteLoop();
                                    return;
                                },
                                else => {
                                    const out = bun.getFdPath(fd, &pathbuf1) catch {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        this.prepareReadWriteLoop();
                                        return;
                                    };
                                    pathbuf1[out.len] = 0;
                                    break :brk pathbuf1[0..out.len :0];
                                },
                            }
                        },
                    }
                },
            }
        };
        const old_path: [:0]const u8 = brk: {
            switch (source_file_store.pathlike) {
                .path => {
                    break :brk source_file_store.pathlike.path.sliceZ(&pathbuf2);
                },
                .fd => |fd| {
                    switch (bun.sys.File.from(fd).kind()) {
                        .err => |err| {
                            this.throw(err);
                            return;
                        },
                        .result => |kind| {
                            switch (kind) {
                                .directory => {
                                    this.throw(bun.sys.Error.fromCode(.ISDIR, .open));
                                    return;
                                },
                                .character_device => {
                                    this.prepareReadWriteLoop();
                                    return;
                                },
                                else => {
                                    const out = bun.getFdPath(fd, &pathbuf2) catch {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        this.prepareReadWriteLoop();
                                        return;
                                    };
                                    pathbuf2[out.len] = 0;
                                    break :brk pathbuf2[0..out.len :0];
                                },
                            }
                        },
                    }
                },
            }
        };
        const loop = this.event_loop.virtual_machine.event_loop_handle.?;
        this.io_request.data = @ptrCast(this);

        const rc = libuv.uv_fs_copyfile(
            loop,
            &this.io_request,
            old_path,
            new_path,
            0,
            &onCopyFile,
        );

        if (rc.errno()) |errno| {
            this.throw(.{
                // #6336
                .errno = if (errno == @intFromEnum(bun.sys.SystemErrno.EPERM))
                    @as(c_int, @intCast(@intFromEnum(bun.sys.SystemErrno.ENOENT)))
                else
                    errno,
                .syscall = .copyfile,
                .path = old_path,
            });
            return;
        }
        this.event_loop.refConcurrently();
    }

    pub fn throw(this: *CopyFileWindows, err: bun.sys.Error) void {
        const globalThis = this.event_loop.global;
        const promise = this.promise.swap();
        const err_instance = err.toJS(globalThis);

        var event_loop = this.event_loop;
        event_loop.enter();
        defer event_loop.exit();
        this.deinit();
        promise.reject(globalThis, err_instance) catch {}; // TODO: properly propagate exception upwards
    }

    fn onCopyFile(req: *libuv.fs_t) callconv(.c) void {
        var this: *CopyFileWindows = @fieldParentPtr("io_request", req);
        bun.assert(req.data == @as(?*anyopaque, @ptrCast(this)));

        var event_loop = this.event_loop;
        event_loop.unrefConcurrently();
        const rc = req.result;

        bun.sys.syslog("uv_fs_copyfile() = {f}", .{rc});
        if (rc.errEnum()) |errno| {
            if (this.mkdirp_if_not_exists and errno == .NOENT) {
                req.deinit();
                this.mkdirp();
                return;
            } else {
                var err = bun.sys.Error.fromCode(
                    // #6336
                    if (errno == .PERM) .NOENT else errno,

                    .copyfile,
                );
                const destination = &this.destination_file_store.data.file;

                // we don't really know which one it is
                if (destination.pathlike == .path) {
                    err = err.withPath(destination.pathlike.path.slice());
                } else if (destination.pathlike == .fd) {
                    err = err.withFd(destination.pathlike.fd);
                }

                this.throw(err);
            }
            return;
        }

        this.onComplete(req.statbuf.size);
    }

    pub fn onComplete(this: *CopyFileWindows, written_actual: usize) void {
        var written = written_actual;
        if (written != @as(@TypeOf(written), @intCast(this.size)) and this.size != Blob.max_size) {
            this.truncate();
            written = @intCast(this.size);
        }

        // Apply destination mode if specified (async)
        if (this.destination_mode) |mode| {
            if (this.destination_file_store.data.file.pathlike == .path) {
                this.written_bytes = written;
                var pathbuf: bun.PathBuffer = undefined;
                const path = this.destination_file_store.data.file.pathlike.path.sliceZ(&pathbuf);
                const loop = this.event_loop.virtual_machine.event_loop_handle.?;
                this.io_request.deinit();
                this.io_request = std.mem.zeroes(libuv.fs_t);
                this.io_request.data = @ptrCast(this);

                const rc = libuv.uv_fs_chmod(
                    loop,
                    &this.io_request,
                    path,
                    @intCast(mode),
                    &onChmod,
                );

                if (rc.errno()) |errno| {
                    // chmod failed to start - reject the promise to report the error
                    var err = bun.sys.Error.fromCode(@enumFromInt(errno), .chmod);
                    const destination = &this.destination_file_store.data.file;
                    if (destination.pathlike == .path) {
                        err = err.withPath(destination.pathlike.path.slice());
                    }
                    this.throw(err);
                    return;
                }
                this.event_loop.refConcurrently();
                return;
            }
        }

        this.resolvePromise(written);
    }

    fn onChmod(req: *libuv.fs_t) callconv(.c) void {
        var this: *CopyFileWindows = @fieldParentPtr("io_request", req);
        bun.assert(req.data == @as(?*anyopaque, @ptrCast(this)));

        var event_loop = this.event_loop;
        event_loop.unrefConcurrently();

        const rc = req.result;
        if (rc.errEnum()) |errno| {
            var err = bun.sys.Error.fromCode(errno, .chmod);
            const destination = &this.destination_file_store.data.file;
            if (destination.pathlike == .path) {
                err = err.withPath(destination.pathlike.path.slice());
            }
            this.throw(err);
            return;
        }

        this.resolvePromise(this.written_bytes);
    }

    fn resolvePromise(this: *CopyFileWindows, written: usize) void {
        const globalThis = this.event_loop.global;
        const promise = this.promise.swap();
        var event_loop = this.event_loop;
        event_loop.enter();
        defer event_loop.exit();

        this.deinit();
        promise.resolve(globalThis, jsc.JSValue.jsNumberFromUint64(written)) catch {}; // TODO: properly propagate exception upwards
    }

    fn truncate(this: *CopyFileWindows) void {
        // TODO: optimize this
        @branchHint(.cold);

        var node_fs: jsc.Node.fs.NodeFS = .{};
        _ = node_fs.truncate(
            .{
                .path = this.destination_file_store.data.file.pathlike,
                .len = @intCast(this.size),
            },
            .sync,
        );
    }

    pub fn deinit(this: *CopyFileWindows) void {
        this.read_write_loop.close();
        this.destination_file_store.deref();
        this.source_file_store.deref();
        this.promise.deinit();
        this.io_request.deinit();
        bun.destroy(this);
    }

    fn mkdirp(
        this: *CopyFileWindows,
    ) void {
        bun.sys.syslog("mkdirp", .{});
        this.mkdirp_if_not_exists = false;
        var destination = &this.destination_file_store.data.file;
        if (destination.pathlike != .path) {
            this.throw(.{
                .errno = @as(c_int, @intCast(@intFromEnum(bun.sys.SystemErrno.EINVAL))),
                .syscall = .mkdir,
            });
            return;
        }

        this.event_loop.refConcurrently();
        jsc.Node.fs.Async.AsyncMkdirp.new(.{
            .completion = @ptrCast(&onMkdirpCompleteConcurrent),
            .completion_ctx = this,
            .path = bun.Dirname.dirname(u8, destination.pathlike.path.slice())
            // this shouldn't happen
            orelse destination.pathlike.path.slice(),
        }).schedule();
    }

    fn onMkdirpComplete(this: *CopyFileWindows) void {
        this.event_loop.unrefConcurrently();

        if (bun.take(&this.err)) |err| {
            this.throw(err);
            var err2 = err;
            err2.deinit();
            return;
        }

        this.copyfile();
    }

    fn onMkdirpCompleteConcurrent(this: *CopyFileWindows, err_: bun.sys.Maybe(void)) void {
        bun.sys.syslog("mkdirp complete", .{});
        assert(this.err == null);
        this.err = if (err_ == .err) err_.err else null;
        this.event_loop.enqueueTaskConcurrent(jsc.ConcurrentTask.create(jsc.ManagedTask.New(CopyFileWindows, onMkdirpComplete).init(this)));
    }
};

pub const IOWhich = enum {
    source,
    destination,
    both,
};

const unsupported_directory_error = SystemError{
    .errno = @as(c_int, @intCast(@intFromEnum(bun.sys.SystemErrno.EISDIR))),
    .message = bun.String.static("That doesn't work on folders"),
    .syscall = bun.String.static("fstat"),
};
const unsupported_non_regular_file_error = SystemError{
    .errno = @as(c_int, @intCast(@intFromEnum(bun.sys.SystemErrno.ENOTSUP))),
    .message = bun.String.static("Non-regular files aren't supported yet"),
    .syscall = bun.String.static("fstat"),
};

pub const CopyFilePromiseTask = jsc.ConcurrentPromiseTask(CopyFile);
pub const CopyFilePromiseTaskEventLoopTask = CopyFilePromiseTask.EventLoopTask;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const webcore = bun.webcore;
const libuv = bun.windows.libuv;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const SystemError = jsc.SystemError;

const Blob = webcore.Blob;
const SizeType = Blob.SizeType;
const Store = Blob.Store;
