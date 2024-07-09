const std = @import("std");
const bun = @import("root").bun;
const uv = bun.windows.libuv;

const log = bun.Output.scoped(.PipeSource, true);

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
            .pipe => @ptrCast(this.pipe),
            .tty => @ptrCast(this.tty),
            .sync_file, .file => unreachable,
        };
    }

    pub fn getFd(this: Source) bun.FileDescriptor {
        return switch (this) {
            .pipe => |pipe| pipe.fd(),
            .tty => |tty| tty.fd(),
            .sync_file, .file => |file| bun.FDImpl.fromUV(file.file).encode(),
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

    pub fn openPipe(loop: *uv.Loop, fd: bun.FileDescriptor) bun.JSC.Maybe(*Source.Pipe) {
        log("openPipe (fd = {})", .{fd});
        const pipe = bun.default_allocator.create(Source.Pipe) catch bun.outOfMemory();
        // we should never init using IPC here see ipc.zig
        switch (pipe.init(loop, false)) {
            .err => |err| {
                return .{ .err = err };
            },
            else => {},
        }

        const file_fd = bun.uvfdcast(fd);

        return switch (pipe.open(file_fd)) {
            .err => |err| .{
                .err = err,
            },
            .result => .{
                .result = pipe,
            },
        };
    }

    pub var stdin_tty: uv.uv_tty_t = undefined;
    pub var stdin_tty_init = false;

    pub fn openTty(loop: *uv.Loop, fd: bun.FileDescriptor) bun.JSC.Maybe(*Source.Tty) {
        log("openTTY (fd = {})", .{fd});

        const uv_fd = bun.uvfdcast(fd);

        if (uv_fd == 0) {
            if (!stdin_tty_init) {
                switch (stdin_tty.init(loop, uv_fd)) {
                    .err => |err| return .{ .err = err },
                    .result => {},
                }
                stdin_tty_init = true;
            }

            return .{ .result = &stdin_tty };
        }

        const tty = bun.default_allocator.create(Source.Tty) catch bun.outOfMemory();
        return switch (tty.init(loop, uv_fd)) {
            .err => |err| .{ .err = err },
            .result => .{ .result = tty },
        };
    }

    pub fn openFile(fd: bun.FileDescriptor) *Source.File {
        bun.assert(fd.isValid() and bun.uvfdcast(fd) != -1);
        log("openFile (fd = {})", .{fd});
        const file = bun.default_allocator.create(Source.File) catch bun.outOfMemory();

        file.* = std.mem.zeroes(Source.File);
        file.file = bun.uvfdcast(fd);
        return file;
    }

    pub fn open(loop: *uv.Loop, fd: bun.FileDescriptor) bun.JSC.Maybe(Source) {
        const rc = bun.windows.libuv.uv_guess_handle(bun.uvfdcast(fd));
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
                    return .{ .result = {} };
                }
            },
            else => .{
                .err = .{
                    .errno = @intFromEnum(bun.C.E.NOTSUP),
                    .syscall = .uv_tty_set_mode,
                    .fd = this.getFd(),
                },
            },
        };
    }
};

export fn Source__setRawModeStdin(raw: bool) c_int {
    const tty = switch (Source.openTty(bun.JSC.VirtualMachine.get().uvLoop(), bun.STDIN_FD)) {
        .result => |tty| tty,
        .err => |e| return e.errno,
    };
    if (tty.setMode(if (raw) .raw else .normal).toError(.uv_tty_set_mode)) |err| {
        return err.errno;
    }
    return 0;
}
