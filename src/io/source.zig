const std = @import("std");
const bun = @import("root").bun;
const uv = bun.windows.libuv;

const log = bun.Output.scoped(.PipeSource, false);

pub const Source = union(enum) {
    pipe: *Pipe,
    tty: *Tty,
    file: *File,
    sync_file: *File,

    const Pipe = uv.Pipe;
    const Tty = uv.uv_tty_t;

    pub const File = struct {
        fs: uv.fs_t,
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

    pub fn openTty(loop: *uv.Loop, fd: bun.FileDescriptor) bun.JSC.Maybe(*Source.Tty) {
        log("openTTY (fd = {})", .{fd});
        const tty = bun.default_allocator.create(Source.Tty) catch bun.outOfMemory();

        return switch (tty.init(loop, bun.uvfdcast(fd))) {
            .err => |err| .{ .err = err },
            .result => brk: {
                _ = tty.setMode(.raw);
                break :brk .{ .result = tty };
            },
        };
    }

    pub fn openFile(fd: bun.FileDescriptor) *Source.File {
        log("openFile (fd = {})", .{fd});
        const file = bun.default_allocator.create(Source.File) catch bun.outOfMemory();

        file.* = std.mem.zeroes(Source.File);
        file.file = bun.uvfdcast(fd);
        return file;
    }

    pub fn open(loop: *uv.Loop, fd: bun.FileDescriptor) bun.JSC.Maybe(Source) {
        log("open (fd = {})", .{fd});
        const rc = bun.windows.GetFileType(fd.cast());
        switch (rc) {
            bun.windows.FILE_TYPE_PIPE => {
                switch (openPipe(loop, fd)) {
                    .result => |pipe| return .{ .result = .{ .pipe = pipe } },
                    .err => |err| return .{ .err = err },
                }
            },
            bun.windows.FILE_TYPE_CHAR => {
                switch (openTty(loop, fd)) {
                    .result => |tty| return .{ .result = .{ .tty = tty } },
                    .err => |err| return .{ .err = err },
                }
            },
            else => {
                return .{ .result = .{
                    .file = openFile(fd),
                } };
            },
        }
    }
};
