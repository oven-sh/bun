const log = bun.Output.scoped(.PipeSource, .hidden);

pub const Source = union(enum) {
    pipe: *Pipe,
    tty: *Tty,
    file: *File,
    sync_file: *File,

    const Pipe = uv.Pipe;
    const Tty = uv.uv_tty_t;

    pub const File = struct {
        fs: uv.fs_t,
        // we need a new fs_t to close the file
        // the current one is used for write/reading/canceling
        // we dont wanna to free any data that is being used in uv loop
        close_fs: uv.fs_t,
        iov: uv.uv_buf_t,
        file: uv.uv_file,
        can_be_canceled: bool = true,

        pub fn stopReading(this: *File) void {
            if (!this.can_be_canceled) return;
            this.can_be_canceled = false;
            this.fs.cancel();
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
        log("openPipe (fd = {})", .{fd});
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
        log("openTTY (fd = {})", .{fd});

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
        log("openFile (fd = {})", .{fd});
        const file = bun.handleOom(bun.default_allocator.create(Source.File));

        file.* = std.mem.zeroes(Source.File);
        file.file = fd.uv();
        return file;
    }

    pub fn open(loop: *uv.Loop, fd: bun.FileDescriptor) bun.sys.Maybe(Source) {
        const rc = bun.windows.libuv.uv_guess_handle(fd.uv());
        log("open(fd: {}, type: {d})", .{ fd, @tagName(rc) });

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
