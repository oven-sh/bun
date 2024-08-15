const Allocator = std.mem.Allocator;
const uws = bun.uws;
const std = @import("std");
const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const Async = bun.Async;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const posix = std.posix;
const Output = bun.Output;
const os = std.os;

const uv = bun.windows.libuv;
pub const Stdio = union(enum) {
    inherit: void,
    capture: struct { fd: bun.FileDescriptor, buf: *bun.ByteList },
    ignore: void,
    fd: bun.FileDescriptor,
    dup2: struct {
        out: bun.JSC.Subprocess.StdioKind,
        to: bun.JSC.Subprocess.StdioKind,
    },
    path: JSC.Node.PathLike,
    blob: JSC.WebCore.AnyBlob,
    array_buffer: JSC.ArrayBuffer.Strong,
    memfd: bun.FileDescriptor,
    pipe: void,
    ipc: void,

    const log = bun.sys.syslog;

    pub const Result = union(enum) {
        result: bun.spawn.SpawnOptions.Stdio,
        err: ToSpawnOptsError,
    };

    pub fn ResultT(comptime T: type) type {
        return union(enum) {
            result: T,
            err: ToSpawnOptsError,
        };
    }

    pub const ToSpawnOptsError = union(enum) {
        stdin_used_as_out,
        out_used_as_stdin,
        blob_used_as_out,
        uv_pipe: bun.C.E,

        pub fn toStr(this: *const @This()) []const u8 {
            return switch (this.*) {
                .stdin_used_as_out => "Stdin cannot be used for stdout or stderr",
                .out_used_as_stdin => "Stdout and stderr cannot be used for stdin",
                .blob_used_as_out => "Blobs are immutable, and cannot be used for stdout/stderr",
                .uv_pipe => @panic("TODO"),
            };
        }

        pub fn throwJS(this: *const @This(), globalThis: *JSC.JSGlobalObject) JSValue {
            globalThis.throw("{s}", .{this.toStr()});
            return .zero;
        }
    };

    pub fn byteSlice(this: *const Stdio) []const u8 {
        return switch (this.*) {
            .capture => this.capture.buf.slice(),
            .array_buffer => this.array_buffer.array_buffer.byteSlice(),
            .blob => this.blob.slice(),
            else => &[_]u8{},
        };
    }

    pub fn deinit(this: *Stdio) void {
        switch (this.*) {
            .array_buffer => |*array_buffer| {
                array_buffer.deinit();
            },
            .blob => |*blob| {
                blob.detach();
            },
            .memfd => |fd| {
                _ = bun.sys.close(fd);
            },
            else => {},
        }
    }

    pub fn canUseMemfd(this: *const @This(), is_sync: bool) bool {
        if (comptime !Environment.isLinux) {
            return false;
        }

        return switch (this.*) {
            .blob => !this.blob.needsToReadFile(),
            .memfd, .array_buffer => true,
            .pipe => is_sync,
            else => false,
        };
    }

    pub fn useMemfd(this: *@This(), index: u32) void {
        if (comptime !Environment.isLinux) {
            return;
        }
        const label = switch (index) {
            0 => "spawn_stdio_stdin",
            1 => "spawn_stdio_stdout",
            2 => "spawn_stdio_stderr",
            else => "spawn_stdio_memory_file",
        };

        const fd = bun.sys.memfd_create(label, 0).unwrap() catch return;

        var remain = this.byteSlice();

        if (remain.len > 0)
            // Hint at the size of the file
            _ = bun.sys.ftruncate(fd, @intCast(remain.len));

        // Dump all the bytes in there
        var written: isize = 0;
        while (remain.len > 0) {
            switch (bun.sys.pwrite(fd, remain, written)) {
                .err => |err| {
                    if (err.getErrno() == .AGAIN) {
                        continue;
                    }

                    Output.debugWarn("Failed to write to memfd: {s}", .{@tagName(err.getErrno())});
                    _ = bun.sys.close(fd);
                    return;
                },
                .result => |result| {
                    if (result == 0) {
                        Output.debugWarn("Failed to write to memfd: EOF", .{});
                        _ = bun.sys.close(fd);
                        return;
                    }
                    written += @intCast(result);
                    remain = remain[result..];
                },
            }
        }

        switch (this.*) {
            .array_buffer => this.array_buffer.deinit(),
            .blob => this.blob.detach(),
            else => {},
        }

        this.* = .{ .memfd = fd };
    }

    fn toPosix(
        stdio: *@This(),
        i: u32,
    ) Result {
        return .{
            .result = switch (stdio.*) {
                .blob => |blob| brk: {
                    const fd = bun.stdio(i);
                    if (blob.needsToReadFile()) {
                        if (blob.store()) |store| {
                            if (store.data.file.pathlike == .fd) {
                                if (store.data.file.pathlike.fd == fd) {
                                    break :brk .{ .inherit = {} };
                                }

                                switch (bun.FDTag.get(store.data.file.pathlike.fd)) {
                                    .stdin => {
                                        if (i == 1 or i == 2) {
                                            return .{ .err = .stdin_used_as_out };
                                        }
                                    },
                                    .stdout, .stderr => {
                                        if (i == 0) {
                                            return .{ .err = .out_used_as_stdin };
                                        }
                                    },
                                    else => {},
                                }

                                break :brk .{ .pipe = store.data.file.pathlike.fd };
                            }

                            break :brk .{ .path = store.data.file.pathlike.path.slice() };
                        }
                    }

                    if (i == 1 or i == 2) {
                        return .{ .err = .blob_used_as_out };
                    }

                    break :brk .{ .buffer = {} };
                },
                .dup2 => .{ .dup2 = .{ .out = stdio.dup2.out, .to = stdio.dup2.to } },
                .capture, .pipe, .array_buffer => .{ .buffer = {} },
                .ipc => .{ .ipc = {} },
                .fd => |fd| .{ .pipe = fd },
                .memfd => |fd| .{ .pipe = fd },
                .path => |pathlike| .{ .path = pathlike.slice() },
                .inherit => .{ .inherit = {} },
                .ignore => .{ .ignore = {} },
            },
        };
    }

    fn toWindows(
        stdio: *@This(),
        i: u32,
    ) Result {
        return .{
            .result = switch (stdio.*) {
                .blob => |blob| brk: {
                    const fd = bun.stdio(i);
                    if (blob.needsToReadFile()) {
                        if (blob.store()) |store| {
                            if (store.data.file.pathlike == .fd) {
                                if (store.data.file.pathlike.fd == fd) {
                                    break :brk .{ .inherit = {} };
                                }

                                switch (bun.FDTag.get(store.data.file.pathlike.fd)) {
                                    .stdin => {
                                        if (i == 1 or i == 2) {
                                            return .{ .err = .stdin_used_as_out };
                                        }
                                    },
                                    .stdout, .stderr => {
                                        if (i == 0) {
                                            return .{ .err = .out_used_as_stdin };
                                        }
                                    },
                                    else => {},
                                }

                                break :brk .{ .pipe = store.data.file.pathlike.fd };
                            }

                            break :brk .{ .path = store.data.file.pathlike.path.slice() };
                        }
                    }

                    if (i == 1 or i == 2) {
                        return .{ .err = .blob_used_as_out };
                    }

                    break :brk .{ .buffer = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
                },
                .ipc => .{ .ipc = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() },
                .capture, .pipe, .array_buffer => .{ .buffer = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() },
                .fd => |fd| .{ .pipe = fd },
                .dup2 => .{ .dup2 = .{ .out = stdio.dup2.out, .to = stdio.dup2.to } },
                .path => |pathlike| .{ .path = pathlike.slice() },
                .inherit => .{ .inherit = {} },
                .ignore => .{ .ignore = {} },

                .memfd => @panic("This should never happen"),
            },
        };
    }

    pub fn toSync(this: *@This(), i: u32) void {
        // Piping an empty stdin doesn't make sense
        if (i == 0 and this.* == .pipe) {
            this.* = .{ .ignore = {} };
        }
    }

    /// On windows this function allocate memory ensure that .deinit() is called or ownership is passed for all *uv.Pipe
    pub fn asSpawnOption(
        stdio: *@This(),
        i: u32,
    ) Stdio.Result {
        if (comptime Environment.isWindows) {
            return stdio.toWindows(i);
        } else {
            return stdio.toPosix(i);
        }
    }

    pub fn isPiped(self: Stdio) bool {
        return switch (self) {
            .capture, .array_buffer, .blob, .pipe => true,
            .ipc => Environment.isWindows,
            else => false,
        };
    }

    pub fn extract(
        out_stdio: *Stdio,
        globalThis: *JSC.JSGlobalObject,
        i: u32,
        value: JSValue,
    ) bool {
        switch (value) {
            // undefined: default
            .undefined, .zero => return true,
            // null: ignore
            .null => {
                out_stdio.* = Stdio{ .ignore = {} };
                return true;
            },
            else => {},
        }

        if (value.isString()) {
            const str = value.getZigString(globalThis);
            if (str.eqlComptime("inherit")) {
                out_stdio.* = Stdio{ .inherit = {} };
            } else if (str.eqlComptime("ignore")) {
                out_stdio.* = Stdio{ .ignore = {} };
            } else if (str.eqlComptime("pipe") or str.eqlComptime("overlapped")) {
                out_stdio.* = Stdio{ .pipe = {} };
            } else if (str.eqlComptime("ipc")) {
                out_stdio.* = Stdio{ .ipc = {} };
            } else {
                globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'pipe', 'ignore', Bun.file(pathOrFd), number, or null", .{});
                return false;
            }

            return true;
        } else if (value.isNumber()) {
            const fd = value.asFileDescriptor();
            const file_fd = bun.uvfdcast(fd);
            if (file_fd < 0) {
                globalThis.throwInvalidArguments("file descriptor must be a positive integer", .{});
                return false;
            }

            if (file_fd >= std.math.maxInt(i32)) {
                var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
                globalThis.throwInvalidArguments("file descriptor must be a valid integer, received: {}", .{
                    value.toFmt(&formatter),
                });
                return false;
            }

            switch (bun.FDTag.get(fd)) {
                .stdin => {
                    if (i == 1 or i == 2) {
                        globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                        return false;
                    }

                    out_stdio.* = Stdio{ .inherit = {} };
                    return true;
                },

                .stdout, .stderr => |tag| {
                    if (i == 0) {
                        globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                        return false;
                    }

                    if (i == 1 and tag == .stdout) {
                        out_stdio.* = .{ .inherit = {} };
                        return true;
                    } else if (i == 2 and tag == .stderr) {
                        out_stdio.* = .{ .inherit = {} };
                        return true;
                    }
                },
                else => {},
            }

            out_stdio.* = Stdio{ .fd = fd };

            return true;
        } else if (value.as(JSC.WebCore.Blob)) |blob| {
            return out_stdio.extractBlob(globalThis, .{ .Blob = blob.dupe() }, i);
        } else if (value.as(JSC.WebCore.Request)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return out_stdio.extractBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i);
        } else if (value.as(JSC.WebCore.Response)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return out_stdio.extractBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i);
        } else if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |req_const| {
            var req = req_const;
            if (i == 0) {
                if (req.toAnyBlob(globalThis)) |blob| {
                    return out_stdio.extractBlob(globalThis, blob, i);
                }

                switch (req.ptr) {
                    .File, .Blob => {
                        globalThis.throwTODO("Support fd/blob backed ReadableStream in spawn stdin. See https://github.com/oven-sh/bun/issues/8049");
                        return false;
                    },
                    .Direct, .JavaScript, .Bytes => {
                        // out_stdio.* = .{ .connect = req };
                        globalThis.throwTODO("Re-enable ReadableStream support in spawn stdin. ");
                        return false;
                    },
                    .Invalid => {
                        globalThis.throwInvalidArguments("ReadableStream is in invalid state.", .{});
                        return false;
                    },
                }
            }
        } else if (value.asArrayBuffer(globalThis)) |array_buffer| {
            // Change in Bun v1.0.34: don't throw for empty ArrayBuffer
            if (array_buffer.byteSlice().len == 0) {
                out_stdio.* = .{ .ignore = {} };
                return true;
            }

            out_stdio.* = .{
                .array_buffer = JSC.ArrayBuffer.Strong{
                    .array_buffer = array_buffer,
                    .held = JSC.Strong.create(array_buffer.value, globalThis),
                },
            };

            return true;
        }

        globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'ignore', or null", .{});
        return false;
    }

    pub fn extractBlob(
        stdio: *Stdio,
        globalThis: *JSC.JSGlobalObject,
        blob: JSC.WebCore.AnyBlob,
        i: u32,
    ) bool {
        const fd = bun.stdio(i);

        if (blob.needsToReadFile()) {
            if (blob.store()) |store| {
                if (store.data.file.pathlike == .fd) {
                    if (store.data.file.pathlike.fd == fd) {
                        stdio.* = Stdio{ .inherit = {} };
                    } else {
                        switch (bun.FDTag.get(i)) {
                            .stdin => {
                                if (i == 1 or i == 2) {
                                    globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                                    return false;
                                }
                            },

                            .stdout, .stderr => {
                                if (i == 0) {
                                    globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                                    return false;
                                }
                            },
                            else => {},
                        }

                        stdio.* = Stdio{ .fd = store.data.file.pathlike.fd };
                    }

                    return true;
                }

                stdio.* = .{ .path = store.data.file.pathlike.path };
                return true;
            }
        }

        if (i == 1 or i == 2) {
            globalThis.throwInvalidArguments("Blobs are immutable, and cannot be used for stdout/stderr", .{});
            return false;
        }

        // Instead of writing an empty blob, lets just make it /dev/null
        if (blob.fastSize() == 0) {
            stdio.* = .{ .ignore = {} };
            return true;
        }

        stdio.* = .{ .blob = blob };
        return true;
    }
};
