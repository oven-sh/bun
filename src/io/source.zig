const log = bun.Output.scoped(.PipeSource, .hidden);

pub const Source = union(enum) {
    pipe: *Pipe,
    tty: *Tty,
    file: *File,
    sync_file: *File,

    const Pipe = uv.Pipe;
    const Tty = uv.uv_tty_t;

    /// File source for async file I/O operations using libuv.
    ///
    /// Manages a single `uv_fs_t` through a state machine that ensures:
    /// - Only one operation uses the `fs` field at a time
    /// - The `fs` is properly deinitialized before reuse
    /// - Cancellation is only attempted when an operation is in-flight
    ///
    /// Typical usage pattern:
    /// 1. Check `canStart()` - returns true if ready for a new operation
    /// 2. Call `prepare()` - marks fs as in-use
    /// 3. Set up buffer and call `uv_fs_read()` or `uv_fs_write()`
    /// 4. In callback, call `complete()` first to clean up
    /// 5. Process the result
    ///
    /// Cancellation:
    /// - Call `stop()` to cancel an in-flight operation
    /// - The callback will still fire with UV_ECANCELED
    /// - Always call `complete()` in the callback regardless of cancellation
    ///
    /// Cleanup:
    /// - Call `detach()` if parent is destroyed before operation completes
    /// - File will automatically close itself after the operation finishes
    pub const File = struct {
        /// The fs_t for I/O operations (reads/writes) and state-machine-managed closes.
        /// State machine ensures this is only used for one operation at a time.
        fs: uv.fs_t,

        /// Buffer descriptor for the current read operation (unused by writers).
        iov: uv.uv_buf_t,

        /// The file descriptor.
        file: uv.uv_file,

        /// Current state of the fs_t request.
        state: enum(u8) {
            deinitialized, // fs.deinit() called, ready for next operation
            operating, // read or write operation in progress
            canceling, // cancel requested, waiting for callback
            closing, // close operation in progress
        } = .deinitialized,

        /// When true, file will close itself when the current operation completes.
        close_after_operation: bool = false,

        /// Get the File struct from an fs_t pointer using field offset.
        pub fn fromFS(fs: *uv.fs_t) *File {
            return @fieldParentPtr("fs", fs);
        }

        /// Returns true if ready to start a new operation.
        pub fn canStart(this: *const File) bool {
            return this.state == .deinitialized and this.fs.data != null;
        }

        /// Mark the file as in-use for an operation.
        /// Must only be called when canStart() returns true.
        pub fn prepare(this: *File) void {
            bun.assert(this.state == .deinitialized);
            bun.assert(this.fs.data != null);
            this.state = .operating;
            this.close_after_operation = false;
        }

        /// Request cancellation of the current operation.
        /// If successful, the callback will fire with UV_ECANCELED.
        /// If cancel fails, the operation completes normally.
        pub fn stop(this: *File) void {
            if (this.state != .operating) return;

            const cancel_result = uv.uv_cancel(@ptrCast(&this.fs));
            if (cancel_result == 0) {
                this.state = .canceling;
            }
        }

        /// Detach from parent and schedule automatic cleanup.
        /// If an operation is in progress, it will complete and then close the file.
        /// If idle, closes the file immediately.
        pub fn detach(this: *File) void {
            this.fs.data = null;
            this.close_after_operation = true;
            this.stop();

            if (this.state == .deinitialized) {
                this.close_after_operation = false;
                this.startClose();
            }
        }

        /// Mark the operation as complete and clean up.
        /// Must be called first in the callback before processing data.
        pub fn complete(this: *File, was_canceled: bool) void {
            bun.assert(this.state == .operating or this.state == .canceling);
            if (was_canceled) {
                bun.assert(this.state == .canceling);
            }

            this.fs.deinit();
            this.state = .deinitialized;

            if (this.close_after_operation) {
                this.close_after_operation = false;
                this.startClose();
            }
        }

        fn startClose(this: *File) void {
            bun.assert(this.state == .deinitialized);
            this.state = .closing;
            _ = uv.uv_fs_close(uv.Loop.get(), &this.fs, this.file, onCloseComplete);
        }

        fn onCloseComplete(fs: *uv.fs_t) callconv(.c) void {
            const file = File.fromFS(fs);
            bun.assert(file.state == .closing);
            fs.deinit();
            bun.default_allocator.destroy(file);
        }
    };

    pub fn isClosed(this: Source) bool {
        return switch (this) {
            .pipe => |pipe| pipe.isClosed(),
            .tty => |tty| tty.isClosed(),
            .sync_file, .file => |file| file.file == -1,
        };
    }

    pub fn isActive(this: Source) bool {
        return switch (this) {
            .pipe => |pipe| pipe.isActive(),
            .tty => |tty| tty.isActive(),
            .sync_file, .file => true,
        };
    }

    pub fn getHandle(this: Source) *uv.Handle {
        return switch (this) {
            .pipe => @ptrCast(this.pipe),
            .tty => @ptrCast(this.tty),
            .sync_file, .file => unreachable,
        };
    }
    pub fn toStream(this: Source) *uv.uv_stream_t {
        return switch (this) {
            .pipe => this.pipe.asStream(),
            .tty => @ptrCast(this.tty),
            .sync_file, .file => unreachable,
        };
    }

    pub fn getFd(this: Source) bun.FileDescriptor {
        return switch (this) {
            .pipe => |pipe| pipe.fd(),
            .tty => |tty| tty.fd(),
            .sync_file, .file => |file| .fromUV(file.file),
        };
    }

    pub fn setData(this: Source, data: ?*anyopaque) void {
        switch (this) {
            .pipe => |pipe| pipe.data = data,
            .tty => |tty| tty.data = data,
            .sync_file, .file => |file| file.fs.data = data,
        }
    }

    pub fn getData(this: Source) ?*anyopaque {
        return switch (this) {
            .pipe => |pipe| pipe.data,
            .tty => |tty| tty.data,
            .sync_file, .file => |file| file.fs.data,
        };
    }

    pub fn ref(this: Source) void {
        switch (this) {
            .pipe => this.pipe.ref(),
            .tty => this.tty.ref(),
            .sync_file, .file => return,
        }
    }

    pub fn unref(this: Source) void {
        switch (this) {
            .pipe => this.pipe.unref(),
            .tty => this.tty.unref(),
            .sync_file, .file => return,
        }
    }

    pub fn hasRef(this: Source) bool {
        return switch (this) {
            .pipe => |pipe| pipe.hasRef(),
            .tty => |tty| tty.hasRef(),
            .sync_file, .file => false,
        };
    }

    pub fn openPipe(loop: *uv.Loop, fd: bun.FileDescriptor) bun.sys.Maybe(*Source.Pipe) {
        log("openPipe (fd = {f})", .{fd});
        const pipe = bun.default_allocator.create(Source.Pipe) catch |err| bun.handleOom(err);
        // we should never init using IPC here see ipc.zig
        switch (pipe.init(loop, false)) {
            .err => |err| {
                bun.default_allocator.destroy(pipe);
                return .{ .err = err };
            },
            else => {},
        }

        switch (pipe.open(fd)) {
            .err => |err| {
                bun.default_allocator.destroy(pipe);
                return .{
                    .err = err,
                };
            },
            .result => {},
        }

        return .{ .result = pipe };
    }

    pub const StdinTTY = struct {
        var data: uv.uv_tty_t = undefined;
        var lock: bun.Mutex = .{};
        var initialized = std.atomic.Value(bool).init(false);
        const value: *uv.uv_tty_t = &data;

        pub fn isStdinTTY(tty: *const Source.Tty) bool {
            return tty == StdinTTY.value;
        }

        fn getStdinTTY(loop: *uv.Loop) bun.sys.Maybe(*Source.Tty) {
            StdinTTY.lock.lock();
            defer StdinTTY.lock.unlock();

            if (StdinTTY.initialized.swap(true, .monotonic) == false) {
                const rc = uv.uv_tty_init(loop, StdinTTY.value, 0, 0);
                if (rc.toError(.open)) |err| {
                    StdinTTY.initialized.store(false, .monotonic);
                    return .{ .err = err };
                }
            }

            return .{ .result = StdinTTY.value };
        }
    };

    pub fn openTty(loop: *uv.Loop, fd: bun.FileDescriptor) bun.sys.Maybe(*Source.Tty) {
        log("openTTY (fd = {f})", .{fd});

        const uv_fd = fd.uv();

        if (uv_fd == 0) {
            return StdinTTY.getStdinTTY(loop);
        }

        const tty = bun.default_allocator.create(Source.Tty) catch |err| bun.handleOom(err);
        switch (tty.init(loop, uv_fd)) {
            .err => |err| {
                bun.default_allocator.destroy(tty);
                return .{ .err = err };
            },
            .result => {},
        }

        return .{ .result = tty };
    }

    pub fn openFile(fd: bun.FileDescriptor) *Source.File {
        bun.assert(fd.isValid() and fd.uv() != -1);
        log("openFile (fd = {f})", .{fd});
        const file = bun.handleOom(bun.default_allocator.create(Source.File));

        file.* = std.mem.zeroes(Source.File);
        file.file = fd.uv();
        return file;
    }

    pub fn open(loop: *uv.Loop, fd: bun.FileDescriptor) bun.sys.Maybe(Source) {
        const rc = bun.windows.libuv.uv_guess_handle(fd.uv());
        log("open(fd: {f}, type: {s})", .{ fd, @tagName(rc) });

        switch (rc) {
            .named_pipe => {
                switch (openPipe(loop, fd)) {
                    .result => |pipe| return .{ .result = .{ .pipe = pipe } },
                    .err => |err| return .{ .err = err },
                }
            },
            .tty => {
                switch (openTty(loop, fd)) {
                    .result => |tty| return .{ .result = .{ .tty = tty } },
                    .err => |err| return .{ .err = err },
                }
            },
            .file => {
                return .{
                    .result = .{
                        .file = openFile(fd),
                    },
                };
            },
            else => {
                const errno = bun.windows.getLastErrno();

                if (errno == .SUCCESS) {
                    return .{
                        .result = .{
                            .file = openFile(fd),
                        },
                    };
                }

                return .{ .err = bun.sys.Error.fromCode(errno, .open) };
            },
        }
    }

    pub fn setRawMode(this: Source, value: bool) bun.sys.Maybe(void) {
        return switch (this) {
            .tty => |tty| {
                if (tty
                    .setMode(if (value) .raw else .normal)
                    .toError(.uv_tty_set_mode)) |err|
                {
                    return .{ .err = err };
                } else {
                    return .success;
                }
            },
            else => .{
                .err = .{
                    .errno = @intFromEnum(bun.sys.E.NOTSUP),
                    .syscall = .uv_tty_set_mode,
                    .fd = this.getFd(),
                },
            },
        };
    }
};

export fn Source__setRawModeStdin(raw: bool) c_int {
    const tty = switch (Source.openTty(bun.jsc.VirtualMachine.get().uvLoop(), .stdin())) {
        .result => |tty| tty,
        .err => |e| return e.errno,
    };
    // UV_TTY_MODE_RAW_VT is a variant of UV_TTY_MODE_RAW that enables control
    // sequence processing on the TTY implementer side, rather than having libuv
    // translate keypress events into control sequences, aligning behavior more
    // closely with POSIX platforms. This is also required to support some
    // control sequences at all on Windows, such as bracketed paste mode. The
    // Node.js readline implementation handles differences between these modes.
    if (tty.setMode(if (raw) .vt else .normal).toError(.uv_tty_set_mode)) |err| {
        return err.errno;
    }
    return 0;
}

const bun = @import("bun");
const std = @import("std");
const uv = bun.windows.libuv;
