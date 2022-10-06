const Bun = @This();
const default_allocator = @import("../../../global.zig").default_allocator;
const bun = @import("../../../global.zig");
const Environment = bun.Environment;
const NetworkThread = @import("http").NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("javascript_core");
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../../../which.zig");

pub const Subprocess = struct {
    const log = Output.scoped(.Subprocess, true);
    pub usingnamespace JSC.Codegen.JSSubprocess;
    const default_max_buffer_size = 1024 * 1024 * 4;

    pid: std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: std.os.fd_t = std.math.maxInt(std.os.fd_t),

    stdin: Writable,
    stdout: Readable,
    stderr: Readable,

    killed: bool = false,
    reffer: JSC.Ref = JSC.Ref.init(),
    poll_ref: JSC.PollRef = JSC.PollRef.init(),

    exit_promise: JSValue = JSValue.zero,
    this_jsvalue: JSValue = JSValue.zero,

    exit_code: ?u8 = null,
    waitpid_err: ?JSC.Node.Syscall.Error = null,

    has_waitpid_task: bool = false,
    notification_task: JSC.AnyTask = undefined,
    waitpid_task: JSC.AnyTask = undefined,

    wait_task: JSC.ConcurrentTask = .{},

    finalized: bool = false,

    globalThis: *JSC.JSGlobalObject,

    pub fn ref(this: *Subprocess) void {
        this.reffer.ref(this.globalThis.bunVM());
        this.poll_ref.ref(this.globalThis.bunVM());
    }

    pub fn unref(this: *Subprocess) void {
        this.reffer.unref(this.globalThis.bunVM());
        this.poll_ref.unref(this.globalThis.bunVM());
    }

    pub fn constructor(
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*Subprocess {
        return null;
    }

    const Readable = union(enum) {
        fd: JSC.Node.FileDescriptor,
        pipe: JSC.WebCore.ReadableStream,
        inherit: void,
        ignore: void,
        closed: void,

        pub fn init(stdio: Stdio, fd: i32, globalThis: *JSC.JSGlobalObject) Readable {
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    var blob = JSC.WebCore.Blob.findOrCreateFileFromPath(.{ .fd = fd }, globalThis);
                    defer blob.detach();

                    var stream = JSC.WebCore.ReadableStream.fromBlob(globalThis, &blob, 0);
                    var out = JSC.WebCore.ReadableStream.fromJS(stream, globalThis).?;
                    out.ptr.File.stored_global_this_ = globalThis;
                    break :brk Readable{ .pipe = out };
                },
                .path, .blob, .fd => Readable{ .fd = @intCast(JSC.Node.FileDescriptor, fd) },
                else => unreachable,
            };
        }

        pub fn close(this: *Readable) void {
            switch (this.*) {
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
                },
                .pipe => |pipe| {
                    pipe.done();
                },
                else => {},
            }

            this.* = .closed;
        }

        pub fn toJS(this: Readable) JSValue {
            switch (this) {
                .fd => |fd| {
                    return JSValue.jsNumber(fd);
                },
                .pipe => |pipe| {
                    return pipe.toJS();
                },
                else => {
                    return JSValue.jsUndefined();
                },
            }
        }
    };

    pub fn getStderr(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return this.stderr.toJS();
    }

    pub fn getStdin(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return this.stdin.toJS(globalThis);
    }

    pub fn getStdout(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return this.stdout.toJS();
    }

    pub fn kill(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var arguments = callframe.arguments(1);
        var sig: i32 = 0;

        if (arguments.len > 0) {
            sig = arguments.ptr[0].toInt32();
        }

        if (!(sig > -1 and sig < std.math.maxInt(u8))) {
            globalThis.throwInvalidArguments("Invalid signal: must be > -1 and < 255", .{});
            return JSValue.jsUndefined();
        }

        switch (this.tryKill(sig)) {
            .result => {},
            .err => |err| {
                globalThis.throwValue(err.toJSC(globalThis));
                return JSValue.jsUndefined();
            },
        }

        return JSValue.jsUndefined();
    }

    pub fn tryKill(this: *Subprocess, sig: i32) JSC.Node.Maybe(void) {
        if (this.killed) {
            return .{ .result = {} };
        }

        if (comptime Environment.isLinux) {
            // should this be handled differently?
            // this effectively shouldn't happen
            if (this.pidfd == std.math.maxInt(std.os.fd_t)) {
                return .{ .result = {} };
            }

            // first appeared in Linux 5.1
            const rc = std.os.linux.pidfd_send_signal(this.pidfd, @intCast(u8, sig), null, 0);

            if (rc != 0) {
                return .{ .err = JSC.Node.Syscall.Error.fromCode(std.os.linux.getErrno(rc), .kill) };
            }
        } else {
            const err = std.c.kill(this.pid, sig);
            if (err != 0) {
                return .{ .err = JSC.Node.Syscall.Error.fromCode(std.c.getErrno(err), .kill) };
            }
        }

        return .{ .result = {} };
    }

    pub fn onKill(
        this: *Subprocess,
    ) void {
        if (this.killed) {
            return;
        }

        this.killed = true;
        this.closePorts();
    }

    pub fn closePorts(this: *Subprocess) void {
        if (comptime Environment.isLinux) {
            if (this.pidfd != std.math.maxInt(std.os.fd_t)) {
                _ = std.os.close(this.pidfd);
                this.pidfd = std.math.maxInt(std.os.fd_t);
            }
        }

        if (this.stdout == .pipe) {
            if (this.stdout.pipe.isDisturbed(this.globalThis))
                this.stdout.pipe.cancel(this.globalThis);
        }

        if (this.stderr == .pipe) {
            if (this.stderr.pipe.isDisturbed(this.globalThis))
                this.stderr.pipe.cancel(this.globalThis);
        }

        this.stdin.close();
        this.stdout.close();
        this.stderr.close();
    }

    pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.ref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.unref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn getPid(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsNumber(this.pid);
    }

    pub fn getKilled(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.killed);
    }

    pub const BufferedInput = struct {
        remain: []const u8 = "",
        fd: JSC.Node.FileDescriptor = std.math.maxInt(JSC.Node.FileDescriptor),
        poll_ref: JSC.PollRef = .{},
        written: usize = 0,

        source: union(enum) {
            blob: JSC.WebCore.AnyBlob,
            array_buffer: JSC.ArrayBuffer.Strong,
        },

        pub usingnamespace JSC.WebCore.NewReadyWatcher(BufferedInput, .write, onReady);

        pub fn onReady(this: *BufferedInput, size_or_offset: i64) void {
            this.write(@intCast(usize, @maximum(size_or_offset, 0)));
        }

        pub fn write(this: *BufferedInput, _: usize) void {
            var to_write = this.remain;

            if (to_write.len == 0) {
                if (this.poll_ref.isActive()) this.unwatch(this.fd);
                // we are done!
                this.closeFDIfOpen();
                return;
            }

            while (to_write.len > 0) {
                switch (JSC.Node.Syscall.write(this.fd, to_write)) {
                    .err => |e| {
                        if (e.isRetry()) {
                            log("write({d}) retry", .{
                                to_write.len,
                            });

                            this.watch(this.fd);
                            return;
                        }

                        // fail
                        log("write({d}) fail: {d}", .{ to_write.len, e.errno });
                        this.deinit();
                        return;
                    },

                    .result => |bytes_written| {
                        this.written += bytes_written;

                        log(
                            "write({d}) {d}",
                            .{
                                to_write.len,
                                bytes_written,
                            },
                        );

                        this.remain = this.remain[@minimum(bytes_written, this.remain.len)..];
                        to_write = to_write[bytes_written..];

                        // we are done or it accepts no more input
                        if (this.remain.len == 0 or bytes_written == 0) {
                            this.deinit();
                            return;
                        }
                    },
                }
            }
        }

        fn closeFDIfOpen(this: *BufferedInput) void {
            if (this.poll_ref.isActive()) this.unwatch(this.fd);

            if (this.fd != std.math.maxInt(JSC.Node.FileDescriptor)) {
                _ = JSC.Node.Syscall.close(this.fd);
                this.fd = std.math.maxInt(JSC.Node.FileDescriptor);
            }
        }

        pub fn deinit(this: *BufferedInput) void {
            this.closeFDIfOpen();

            switch (this.source) {
                .blob => |*blob| {
                    blob.detach();
                },
                .array_buffer => |*array_buffer| {
                    array_buffer.deinit();
                },
            }
        }
    };

    const BufferedOutput = struct {
        internal_buffer: bun.ByteList = bun.ByteList.init(""),
        max_internal_buffer: usize = default_max_buffer_size,
    };

    const Writable = union(enum) {
        pipe: *JSC.WebCore.FileSink,
        pipe_to_readable_stream: struct {
            pipe: *JSC.WebCore.FileSink,
            readable_stream: JSC.WebCore.ReadableStream,
        },
        fd: JSC.Node.FileDescriptor,
        buffered_input: BufferedInput,
        inherit: void,
        ignore: void,

        pub fn init(stdio: Stdio, fd: i32, globalThis: *JSC.JSGlobalObject) !Writable {
            switch (stdio) {
                .path, .pipe => {
                    var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                    sink.* = .{
                        .fd = fd,
                        .buffer = bun.ByteList.init(&.{}),
                        .allocator = globalThis.bunVM().allocator,
                    };

                    if (stdio == .pipe) {
                        if (stdio.pipe) |readable| {
                            return Writable{
                                .pipe_to_readable_stream = .{
                                    .pipe = sink,
                                    .readable_stream = readable,
                                },
                            };
                        }
                    }

                    return Writable{ .pipe = sink };
                },
                .array_buffer, .blob => {
                    var buffered_input: BufferedInput = .{ .fd = fd, .source = undefined };
                    switch (stdio) {
                        .array_buffer => |array_buffer| {
                            buffered_input.source = .{ .array_buffer = array_buffer };
                        },
                        .blob => |blob| {
                            buffered_input.source = .{ .blob = blob };
                        },
                        else => unreachable,
                    }
                    return Writable{ .buffered_input = buffered_input };
                },
                .fd => {
                    return Writable{ .fd = @intCast(JSC.Node.FileDescriptor, fd) };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .ignore => {
                    return Writable{ .ignore = {} };
                },
            }
        }

        pub fn toJS(this: Writable, globalThis: *JSC.JSGlobalObject) JSValue {
            return switch (this) {
                .pipe => |pipe| pipe.toJS(globalThis),
                .fd => |fd| JSValue.jsNumber(fd),
                .ignore => JSValue.jsUndefined(),
                .inherit => JSValue.jsUndefined(),
                .buffered_input => JSValue.jsUndefined(),
                .pipe_to_readable_stream => this.pipe_to_readable_stream.readable_stream.value,
            };
        }

        pub fn close(this: *Writable) void {
            return switch (this.*) {
                .pipe => |pipe| {
                    _ = pipe.end(null);
                },
                .pipe_to_readable_stream => |*pipe_to_readable_stream| {
                    _ = pipe_to_readable_stream.pipe.end(null);
                },
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
                },
                .buffered_input => {
                    this.buffered_input.deinit();
                },
                .ignore => {},
                .inherit => {},
            };
        }
    };

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        this.unref();
        this.closePorts();
        this.finalized = true;

        if (this.exit_code != null)
            bun.default_allocator.destroy(this);
    }

    pub fn getExited(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.exit_code) |code| {
            return JSC.JSPromise.resolvedPromiseValue(globalThis, JSC.JSValue.jsNumber(code));
        }

        if (this.exit_promise == .zero) {
            this.exit_promise = JSC.JSPromise.create(globalThis).asValue(globalThis);
            // close stdin to signal to the process we are done
            this.stdin.close();
        }

        return this.exit_promise;
    }

    pub fn getExitCode(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.exit_code) |code| {
            return JSC.JSValue.jsNumber(code);
        }
        return JSC.JSValue.jsNull();
    }

    pub fn spawn(globalThis: *JSC.JSGlobalObject, args: JSValue) JSValue {
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var allocator = arena.allocator();

        var env: [*:null]?[*:0]const u8 = undefined;

        var env_array = std.ArrayListUnmanaged(?[*:0]const u8){
            .items = &.{},
            .capacity = 0,
        };

        var cwd = globalThis.bunVM().bundler.fs.top_level_dir;

        var stdio = [3]Stdio{
            .{ .ignore = .{} },
            .{ .inherit = .{} },
            .{ .pipe = null },
        };

        var PATH = globalThis.bunVM().bundler.env.get("PATH") orelse "";
        var argv: std.ArrayListUnmanaged(?[*:0]const u8) = undefined;
        {
            var cmd_value = args.get(globalThis, "cmd") orelse {
                globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                return JSValue.jsUndefined();
            };

            var cmds_array = cmd_value.arrayIterator(globalThis);
            argv = @TypeOf(argv).initCapacity(allocator, cmds_array.len) catch {
                globalThis.throw("out of memory", .{});
                return JSValue.jsUndefined();
            };

            if (cmd_value.isEmptyOrUndefinedOrNull()) {
                globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                return JSValue.jsUndefined();
            }

            if (cmds_array.len == 0) {
                globalThis.throwInvalidArguments("cmd must not be empty", .{});
                return JSValue.jsUndefined();
            }

            {
                var first_cmd = cmds_array.next().?;
                var arg0 = first_cmd.toSlice(globalThis, allocator);
                defer arg0.deinit();
                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var resolved = Which.which(&path_buf, PATH, cwd, arg0.slice()) orelse {
                    globalThis.throwInvalidArguments("cmd not in $PATH: {s}", .{arg0});
                    return JSValue.jsUndefined();
                };
                argv.appendAssumeCapacity(allocator.dupeZ(u8, bun.span(resolved)) catch {
                    globalThis.throw("out of memory", .{});
                    return JSValue.jsUndefined();
                });
            }

            while (cmds_array.next()) |value| {
                argv.appendAssumeCapacity(value.getZigString(globalThis).toOwnedSliceZ(allocator) catch {
                    globalThis.throw("out of memory", .{});
                    return JSValue.jsUndefined();
                });
            }

            if (argv.items.len == 0) {
                globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                return JSValue.jsUndefined();
            }

            if (args.get(globalThis, "cwd")) |cwd_| {
                if (!cwd_.isEmptyOrUndefinedOrNull()) {
                    cwd = cwd_.getZigString(globalThis).toOwnedSliceZ(allocator) catch {
                        globalThis.throw("out of memory", .{});
                        return JSValue.jsUndefined();
                    };
                }
            }

            if (args.get(globalThis, "env")) |object| {
                if (!object.isEmptyOrUndefinedOrNull()) {
                    if (!object.isObject()) {
                        globalThis.throwInvalidArguments("env must be an object", .{});
                        return JSValue.jsUndefined();
                    }

                    var object_iter = JSC.JSPropertyIterator(.{
                        .skip_empty_name = false,
                        .include_value = true,
                    }).init(globalThis, object.asObjectRef());
                    defer object_iter.deinit();
                    env_array.ensureTotalCapacityPrecise(allocator, object_iter.len) catch {
                        globalThis.throw("out of memory", .{});
                        return JSValue.jsUndefined();
                    };

                    while (object_iter.next()) |key| {
                        var value = object_iter.value;
                        var line = std.fmt.allocPrintZ(allocator, "{}={}", .{ key, value.getZigString(globalThis) }) catch {
                            globalThis.throw("out of memory", .{});
                            return JSValue.jsUndefined();
                        };

                        if (key.eqlComptime("PATH")) {
                            PATH = bun.span(line["PATH=".len..]);
                        }
                        env_array.append(allocator, line) catch {
                            globalThis.throw("out of memory", .{});
                            return JSValue.jsUndefined();
                        };
                    }
                }
            }

            if (args.get(globalThis, "stdio")) |stdio_val| {
                if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                    if (stdio_val.jsType().isArray()) {
                        var stdio_iter = stdio_val.arrayIterator(globalThis);
                        stdio_iter.len = @minimum(stdio_iter.len, 3);
                        var i: usize = 0;
                        while (stdio_iter.next()) |value| : (i += 1) {
                            if (!extractStdio(globalThis, i, value, &stdio))
                                return JSC.JSValue.jsUndefined();
                        }
                    } else {
                        globalThis.throwInvalidArguments("stdio must be an array", .{});
                        return JSValue.jsUndefined();
                    }
                }
            } else {
                if (args.get(globalThis, "stdin")) |value| {
                    if (!extractStdio(globalThis, std.os.STDIN_FILENO, value, &stdio))
                        return JSC.JSValue.jsUndefined();
                }

                if (args.get(globalThis, "stderr")) |value| {
                    if (!extractStdio(globalThis, std.os.STDERR_FILENO, value, &stdio))
                        return JSC.JSValue.jsUndefined();
                }

                if (args.get(globalThis, "stdout")) |value| {
                    if (!extractStdio(globalThis, std.os.STDOUT_FILENO, value, &stdio))
                        return JSC.JSValue.jsUndefined();
                }
            }
        }

        var attr = PosixSpawn.Attr.init() catch {
            globalThis.throw("out of memory", .{});
            return JSValue.jsUndefined();
        };

        defer attr.deinit();
        var actions = PosixSpawn.Actions.init() catch |err| return globalThis.handleError(err, "in posix_spawn");
        if (comptime Environment.isMac) {
            attr.set(
                os.darwin.POSIX_SPAWN_CLOEXEC_DEFAULT | os.darwin.POSIX_SPAWN_SETSIGDEF | os.darwin.POSIX_SPAWN_SETSIGMASK,
            ) catch |err| return globalThis.handleError(err, "in posix_spawn");
        } else if (comptime Environment.isLinux) {
            attr.set(
                bun.C.linux.POSIX_SPAWN.SETSIGDEF | bun.C.linux.POSIX_SPAWN.SETSIGMASK,
            ) catch |err| return globalThis.handleError(err, "in posix_spawn");
        }
        defer actions.deinit();

        if (env_array.items.len == 0) {
            env_array.items = globalThis.bunVM().bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.handleError(err, "in posix_spawn");
            env_array.capacity = env_array.items.len;
        }

        const any_ignore = stdio[0] == .ignore or stdio[1] == .ignore or stdio[2] == .ignore;
        const dev_null_fd = @intCast(
            i32,
            if (any_ignore)
                std.os.openZ("/dev/null", std.os.O.RDONLY | std.os.O.WRONLY, 0) catch |err| {
                    globalThis.throw("failed to open /dev/null: {s}", .{err});
                    return JSValue.jsUndefined();
                }
            else
                -1,
        );

        const stdin_pipe = if (stdio[0].isPiped()) os.pipe2(0) catch |err| {
            globalThis.throw("failed to create stdin pipe: {s}", .{err});
            return JSValue.jsUndefined();
        } else undefined;
        errdefer if (stdio[0].isPiped()) destroyPipe(stdin_pipe);

        const stdout_pipe = if (stdio[1].isPiped()) os.pipe2(0) catch |err| {
            globalThis.throw("failed to create stdout pipe: {s}", .{err});
            return JSValue.jsUndefined();
        } else undefined;
        errdefer if (stdio[1].isPiped()) destroyPipe(stdout_pipe);

        const stderr_pipe = if (stdio[2].isPiped()) os.pipe2(0) catch |err| {
            globalThis.throw("failed to create stderr pipe: {s}", .{err});
            return JSValue.jsUndefined();
        } else undefined;
        errdefer if (stdio[2].isPiped()) destroyPipe(stderr_pipe);

        stdio[0].setUpChildIoPosixSpawn(
            &actions,
            stdin_pipe,
            std.os.STDIN_FILENO,
            dev_null_fd,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdin");

        stdio[1].setUpChildIoPosixSpawn(
            &actions,
            stdout_pipe,
            std.os.STDOUT_FILENO,
            dev_null_fd,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdout");

        stdio[2].setUpChildIoPosixSpawn(
            &actions,
            stderr_pipe,
            std.os.STDERR_FILENO,
            dev_null_fd,
        ) catch |err| return globalThis.handleError(err, "in configuring child stderr");

        actions.chdir(cwd) catch |err| return globalThis.handleError(err, "in chdir()");

        argv.append(allocator, null) catch {
            globalThis.throw("out of memory", .{});
            return JSValue.jsUndefined();
        };

        if (env_array.items.len > 0) {
            env_array.append(allocator, null) catch {
                globalThis.throw("out of memory", .{});
                return JSValue.jsUndefined();
            };
            env = @ptrCast(@TypeOf(env), env_array.items.ptr);
        }

        const pid = switch (PosixSpawn.spawnZ(argv.items[0].?, actions, attr, @ptrCast([*:null]?[*:0]const u8, argv.items[0..].ptr), env)) {
            .err => |err| return err.toJSC(globalThis),
            .result => |pid_| pid_,
        };

        const pidfd: std.os.fd_t = brk: {
            if (Environment.isMac) {
                break :brk @intCast(std.os.fd_t, pid);
            }

            const kernel = @import("../../../analytics.zig").GenerateHeader.GeneratePlatform.kernelVersion();

            // pidfd_nonblock only supported in 5.10+
            const flags: u32 = if (kernel.orderWithoutTag(.{ .major = 5, .minor = 10, .patch = 0 }).compare(.gte))
                std.os.O.NONBLOCK
            else
                0;

            const fd = std.os.linux.pidfd_open(
                pid,
                flags,
            );

            switch (std.os.linux.getErrno(fd)) {
                .SUCCESS => break :brk @intCast(std.os.fd_t, fd),
                else => |err| {
                    globalThis.throwValue(JSC.Node.Syscall.Error.fromCode(err, .open).toJSC(globalThis));
                    var status: u32 = 0;
                    // ensure we don't leak the child process on error
                    _ = std.os.linux.waitpid(pid, &status, 0);
                    return JSValue.jsUndefined();
                },
            }
        };

        // set non-blocking stdin
        if (stdio[0].isPiped())
            _ = std.os.fcntl(stdin_pipe[1], std.os.F.SETFL, std.os.O.NONBLOCK) catch 0;

        var subprocess = globalThis.allocator().create(Subprocess) catch {
            globalThis.throw("out of memory", .{});
            return JSValue.jsUndefined();
        };

        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .pid = pid,
            .pidfd = pidfd,
            .stdin = Writable.init(stdio[std.os.STDIN_FILENO], stdin_pipe[1], globalThis) catch {
                globalThis.throw("out of memory", .{});
                return JSValue.jsUndefined();
            },
            .stdout = Readable.init(stdio[std.os.STDOUT_FILENO], stdout_pipe[0], globalThis),
            .stderr = Readable.init(stdio[std.os.STDERR_FILENO], stderr_pipe[0], globalThis),
        };

        subprocess.this_jsvalue = subprocess.toJS(globalThis);
        subprocess.this_jsvalue.ensureStillAlive();

        switch (globalThis.bunVM().poller.watch(
            @intCast(JSC.Node.FileDescriptor, pidfd),
            .process,
            Subprocess,
            subprocess,
        )) {
            .result => {},
            .err => |err| {
                if (err.getErrno() == .SRCH) {
                    @panic("This shouldn't happen");
                }

                // process has already exited
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.onExitNotification();
            },
        }

        if (subprocess.stdin == .buffered_input) {
            subprocess.stdin.buffered_input.remain = switch (subprocess.stdin.buffered_input.source) {
                .blob => subprocess.stdin.buffered_input.source.blob.slice(),
                .array_buffer => |array_buffer| array_buffer.slice(),
            };
            subprocess.stdin.buffered_input.write(0);
        }

        return subprocess.this_jsvalue;
    }

    pub fn onExitNotification(
        this: *Subprocess,
    ) void {
        this.wait(this.globalThis.bunVM());
    }

    pub fn wait(this: *Subprocess, vm: *JSC.VirtualMachine) void {
        if (this.has_waitpid_task) {
            return;
        }

        this.has_waitpid_task = true;
        const pid = this.pid;
        switch (PosixSpawn.waitpid(pid, 0)) {
            .err => |err| {
                this.waitpid_err = err;
            },
            .result => |status| {
                this.exit_code = @truncate(u8, status.status);
            },
        }

        this.waitpid_task = JSC.AnyTask.New(Subprocess, onExit).init(this);
        this.has_waitpid_task = true;
        vm.eventLoop().enqueueTask(JSC.Task.init(&this.waitpid_task));
    }

    fn onExit(this: *Subprocess) void {
        this.closePorts();

        this.has_waitpid_task = false;

        if (this.exit_promise != .zero) {
            var promise = this.exit_promise;
            this.exit_promise = .zero;
            if (this.exit_code) |code| {
                promise.asPromise().?.resolve(this.globalThis, JSValue.jsNumber(code));
            } else if (this.waitpid_err) |err| {
                this.waitpid_err = null;
                promise.asPromise().?.reject(this.globalThis, err.toJSC(this.globalThis));
            } else {
                // crash in debug mode
                if (comptime Environment.allow_assert)
                    unreachable;
            }
        }

        this.unref();

        if (this.finalized) {
            this.finalize();
        }
    }

    const os = std.os;
    fn destroyPipe(pipe: [2]os.fd_t) void {
        os.close(pipe[0]);
        if (pipe[0] != pipe[1]) os.close(pipe[1]);
    }

    const PosixSpawn = @import("./spawn.zig").PosixSpawn;

    const Stdio = union(enum) {
        inherit: void,
        ignore: void,
        fd: JSC.Node.FileDescriptor,
        path: JSC.Node.PathLike,
        blob: JSC.WebCore.AnyBlob,
        pipe: ?JSC.WebCore.ReadableStream,
        array_buffer: JSC.ArrayBuffer.Strong,

        pub fn isPiped(self: Stdio) bool {
            return switch (self) {
                .array_buffer, .blob, .pipe => true,
                else => false,
            };
        }

        fn setUpChildIoPosixSpawn(
            stdio: @This(),
            actions: *PosixSpawn.Actions,
            pipe_fd: [2]i32,
            std_fileno: i32,
            _: i32,
        ) !void {
            switch (stdio) {
                .array_buffer, .blob, .pipe => {
                    std.debug.assert(!(stdio == .blob and stdio.blob.needsToReadFile()));
                    const idx: usize = if (std_fileno == 0) 0 else 1;

                    try actions.dup2(pipe_fd[idx], std_fileno);
                    try actions.close(pipe_fd[1 - idx]);
                },
                .fd => |fd| {
                    try actions.dup2(fd, std_fileno);
                },
                .path => |pathlike| {
                    const flag = if (std_fileno == std.os.STDIN_FILENO) @as(u32, os.O.WRONLY) else @as(u32, std.os.O.RDONLY);
                    try actions.open(std_fileno, pathlike.slice(), flag | std.os.O.CREAT, 0o664);
                },
                .inherit => {
                    if (comptime Environment.isMac) {
                        try actions.inherit(std_fileno);
                    } else {
                        try actions.dup2(std_fileno, std_fileno);
                    }
                },
                .ignore => {
                    const flag = if (std_fileno == std.os.STDIN_FILENO) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                    try actions.openZ(std_fileno, "/dev/null", flag, 0o664);
                },
            }
        }
    };

    fn extractStdioBlob(
        globalThis: *JSC.JSGlobalObject,
        blob: JSC.WebCore.AnyBlob,
        i: usize,
        stdio_array: []Stdio,
    ) bool {
        if (blob.needsToReadFile()) {
            if (blob.store()) |store| {
                if (store.data.file.pathlike == .fd) {
                    if (store.data.file.pathlike.fd == @intCast(JSC.Node.FileDescriptor, i)) {
                        stdio_array[i] = Stdio{ .inherit = {} };
                    } else {
                        switch (@intCast(std.os.fd_t, i)) {
                            std.os.STDIN_FILENO => {
                                if (i == std.os.STDERR_FILENO or i == std.os.STDOUT_FILENO) {
                                    globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                                    return false;
                                }
                            },

                            std.os.STDOUT_FILENO, std.os.STDERR_FILENO => {
                                if (i == std.os.STDIN_FILENO) {
                                    globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                                    return false;
                                }
                            },
                            else => {},
                        }

                        stdio_array[i] = Stdio{ .fd = store.data.file.pathlike.fd };
                    }

                    return true;
                }

                stdio_array[i] = .{ .path = store.data.file.pathlike.path };
                return true;
            }
        }

        stdio_array[i] = .{ .blob = blob };
        return true;
    }

    fn extractStdio(
        globalThis: *JSC.JSGlobalObject,
        i: usize,
        value: JSValue,
        stdio_array: []Stdio,
    ) bool {
        if (value.isEmptyOrUndefinedOrNull()) {
            return true;
        }

        if (value.isString()) {
            const str = value.getZigString(globalThis);
            if (str.eqlComptime("inherit")) {
                stdio_array[i] = Stdio{ .inherit = {} };
            } else if (str.eqlComptime("ignore")) {
                stdio_array[i] = Stdio{ .ignore = {} };
            } else if (str.eqlComptime("pipe")) {
                stdio_array[i] = Stdio{ .pipe = null };
            } else {
                globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'ignore', or null", .{});
                return false;
            }

            return true;
        } else if (value.isNumber()) {
            const fd_ = value.toInt64();
            if (fd_ < 0) {
                globalThis.throwInvalidArguments("file descriptor must be a positive integer", .{});
                return false;
            }

            const fd = @intCast(JSC.Node.FileDescriptor, fd_);

            switch (@intCast(std.os.fd_t, i)) {
                std.os.STDIN_FILENO => {
                    if (i == std.os.STDERR_FILENO or i == std.os.STDOUT_FILENO) {
                        globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                        return false;
                    }
                },

                std.os.STDOUT_FILENO, std.os.STDERR_FILENO => {
                    if (i == std.os.STDIN_FILENO) {
                        globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                        return false;
                    }
                },
                else => {},
            }

            stdio_array[i] = Stdio{ .fd = fd };

            return true;
        } else if (value.as(JSC.WebCore.Blob)) |blob| {
            return extractStdioBlob(globalThis, .{ .Blob = blob.dupe() }, i, stdio_array);
        } else if (value.as(JSC.WebCore.Request)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, stdio_array);
        } else if (value.as(JSC.WebCore.Response)) |req| {
            req.getBodyValue().toBlobIfPossible();
            return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, stdio_array);
        } else if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |*req| {
            if (i == std.os.STDIN_FILENO) {
                if (req.toAnyBlob(globalThis)) |blob| {
                    return extractStdioBlob(globalThis, blob, i, stdio_array);
                }

                switch (req.ptr) {
                    .File, .Blob => unreachable,
                    .Direct, .JavaScript, .Bytes => {
                        if (req.isLocked(globalThis)) {
                            globalThis.throwInvalidArguments("ReadableStream cannot be locked", .{});
                            return false;
                        }

                        stdio_array[i] = .{ .pipe = req.* };
                        return true;
                    },
                    else => {},
                }

                globalThis.throwInvalidArguments("Unsupported ReadableStream type", .{});
                return false;
            }
        } else if (value.asArrayBuffer(globalThis)) |array_buffer| {
            if (array_buffer.slice().len == 0) {
                globalThis.throwInvalidArguments("ArrayBuffer cannot be empty", .{});
                return false;
            }

            stdio_array[i] = .{
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
};
