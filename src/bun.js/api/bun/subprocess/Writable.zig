pub const Writable = union(enum) {
    pipe: *jsc.WebCore.FileSink,
    fd: bun.FileDescriptor,
    buffer: *StaticPipeWriter,
    memfd: bun.FileDescriptor,
    inherit: void,
    ignore: void,

    pub fn memoryCost(this: *const Writable) usize {
        return switch (this.*) {
            .pipe => |pipe| pipe.memoryCost(),
            .buffer => |buffer| buffer.memoryCost(),
            // TODO: memfd
            else => 0,
        };
    }

    pub fn hasPendingActivity(this: *const Writable) bool {
        return switch (this.*) {
            .pipe => false,

            // we mark them as .ignore when they are closed, so this must be true
            .buffer => true,
            else => false,
        };
    }

    pub fn ref(this: *Writable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(true);
            },
            .buffer => {
                this.buffer.updateRef(true);
            },
            else => {},
        }
    }

    pub fn unref(this: *Writable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(false);
            },
            .buffer => {
                this.buffer.updateRef(false);
            },
            else => {},
        }
    }

    // When the stream has closed we need to be notified to prevent a use-after-free
    // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
    pub fn onClose(this: *Writable, _: ?bun.sys.Error) void {
        const process: *Subprocess = @fieldParentPtr("stdin", this);

        if (process.this_value.tryGet()) |this_jsvalue| {
            if (js.stdinGetCached(this_jsvalue)) |existing_value| {
                jsc.WebCore.FileSink.JSSink.setDestroyCallback(existing_value, 0);
            }
        }

        switch (this.*) {
            .buffer => {
                this.buffer.deref();
            },
            .pipe => {
                this.pipe.deref();
            },
            else => {},
        }

        process.onStdinDestroyed();

        this.* = .{
            .ignore = {},
        };
    }
    pub fn onReady(_: *Writable, _: ?jsc.WebCore.Blob.SizeType, _: ?jsc.WebCore.Blob.SizeType) void {}
    pub fn onStart(_: *Writable) void {}

    pub fn init(
        stdio: *Stdio,
        event_loop: *jsc.EventLoop,
        subprocess: *Subprocess,
        result: StdioResult,
        promise_for_stream: *jsc.JSValue,
    ) !Writable {
        Subprocess.assertStdioResult(result);

        if (Environment.isWindows) {
            switch (stdio.*) {
                .pipe, .readable_stream => {
                    if (result == .buffer) {
                        const pipe = jsc.WebCore.FileSink.createWithPipe(event_loop, result.buffer);

                        switch (pipe.writer.startWithCurrentPipe()) {
                            .result => {},
                            .err => |err| {
                                _ = err; // autofix
                                pipe.deref();
                                if (stdio.* == .readable_stream) {
                                    stdio.readable_stream.cancel(event_loop.global);
                                }
                                return error.UnexpectedCreatingStdin;
                            },
                        }
                        pipe.writer.setParent(pipe);
                        subprocess.weak_file_sink_stdin_ptr = pipe;
                        subprocess.ref();
                        subprocess.flags.deref_on_stdin_destroyed = true;
                        subprocess.flags.has_stdin_destructor_called = false;

                        if (stdio.* == .readable_stream) {
                            const assign_result = pipe.assignToStream(&stdio.readable_stream, event_loop.global);
                            if (assign_result.toError()) |err| {
                                pipe.deref();
                                subprocess.deref();
                                return event_loop.global.throwValue(err);
                            }
                            promise_for_stream.* = assign_result;
                        }

                        return Writable{
                            .pipe = pipe,
                        };
                    }
                    return Writable{ .inherit = {} };
                },

                .blob => |blob| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                    };
                },
                .array_buffer => |array_buffer| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                    };
                },
                .fd => |fd| {
                    return Writable{ .fd = fd };
                },
                .dup2 => |dup2| {
                    return Writable{ .fd = dup2.to.toFd() };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .memfd, .path, .ignore => {
                    return Writable{ .ignore = {} };
                },
                .ipc, .capture => {
                    return Writable{ .ignore = {} };
                },
            }
        }

        if (comptime Environment.isPosix) {
            if (stdio.* == .pipe) {
                _ = bun.sys.setNonblocking(result.?);
            }
        }

        switch (stdio.*) {
            .dup2 => @panic("TODO dup2 stdio"),
            .pipe, .readable_stream => {
                const pipe = jsc.WebCore.FileSink.create(event_loop, result.?);

                switch (pipe.writer.start(pipe.fd, true)) {
                    .result => {},
                    .err => |err| {
                        _ = err; // autofix
                        pipe.deref();
                        if (stdio.* == .readable_stream) {
                            stdio.readable_stream.cancel(event_loop.global);
                        }

                        return error.UnexpectedCreatingStdin;
                    },
                }

                pipe.writer.handle.poll.flags.insert(.socket);

                subprocess.weak_file_sink_stdin_ptr = pipe;
                subprocess.ref();
                subprocess.flags.has_stdin_destructor_called = false;
                subprocess.flags.deref_on_stdin_destroyed = true;

                if (stdio.* == .readable_stream) {
                    const assign_result = pipe.assignToStream(&stdio.readable_stream, event_loop.global);
                    if (assign_result.toError()) |err| {
                        pipe.deref();
                        subprocess.deref();
                        return event_loop.global.throwValue(err);
                    }
                    promise_for_stream.* = assign_result;
                }

                return Writable{
                    .pipe = pipe,
                };
            },

            .blob => |blob| {
                return Writable{
                    .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                };
            },
            .array_buffer => |array_buffer| {
                return Writable{
                    .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                };
            },
            .memfd => |memfd| {
                bun.assert(memfd != bun.invalid_fd);
                return Writable{ .memfd = memfd };
            },
            .fd => {
                return Writable{ .fd = result.? };
            },
            .inherit => {
                return Writable{ .inherit = {} };
            },
            .path, .ignore => {
                return Writable{ .ignore = {} };
            },
            .ipc, .capture => {
                return Writable{ .ignore = {} };
            },
        }
    }

    pub fn toJS(this: *Writable, globalThis: *jsc.JSGlobalObject, subprocess: *Subprocess) JSValue {
        return switch (this.*) {
            .fd => |fd| fd.toJS(globalThis),
            .memfd, .ignore => .js_undefined,
            .buffer, .inherit => .js_undefined,
            .pipe => |pipe| {
                this.* = .{ .ignore = {} };
                if (subprocess.process.hasExited() and !subprocess.flags.has_stdin_destructor_called) {
                    // onAttachedProcessExit() can call deref on the
                    // subprocess. Since we never called ref(), it would be
                    // unbalanced to do so, leading to a use-after-free.
                    // So, let's not do that.
                    // https://github.com/oven-sh/bun/pull/14092
                    bun.debugAssert(!subprocess.flags.deref_on_stdin_destroyed);
                    const debug_ref_count = if (Environment.isDebug) subprocess.ref_count else 0;
                    pipe.onAttachedProcessExit(&subprocess.process.status);
                    if (Environment.isDebug) {
                        bun.debugAssert(subprocess.ref_count.get() == debug_ref_count.get());
                    }
                    return pipe.toJS(globalThis);
                } else {
                    subprocess.flags.has_stdin_destructor_called = false;
                    subprocess.weak_file_sink_stdin_ptr = pipe;
                    subprocess.ref();
                    subprocess.flags.deref_on_stdin_destroyed = true;
                    if (@intFromPtr(pipe.signal.ptr) == @intFromPtr(subprocess)) {
                        pipe.signal.clear();
                    }
                    return pipe.toJSWithDestructor(
                        globalThis,
                        jsc.WebCore.Sink.DestructorPtr.init(subprocess),
                    );
                }
            },
        };
    }

    pub fn finalize(this: *Writable) void {
        const subprocess: *Subprocess = @fieldParentPtr("stdin", this);
        if (subprocess.this_value.tryGet()) |this_jsvalue| {
            if (jsc.Codegen.JSSubprocess.stdinGetCached(this_jsvalue)) |existing_value| {
                jsc.WebCore.FileSink.JSSink.setDestroyCallback(existing_value, 0);
            }
        }

        return switch (this.*) {
            .pipe => |pipe| {
                if (pipe.signal.ptr == @as(*anyopaque, @ptrCast(this))) {
                    pipe.signal.clear();
                }

                pipe.deref();

                this.* = .{ .ignore = {} };
            },
            .buffer => {
                this.buffer.updateRef(false);
                this.buffer.deref();
            },
            .memfd => |fd| {
                fd.close();
                this.* = .{ .ignore = {} };
            },
            .ignore => {},
            .fd, .inherit => {},
        };
    }

    pub fn close(this: *Writable) void {
        switch (this.*) {
            .pipe => |pipe| {
                _ = pipe.end(null);
            },
            .memfd => |fd| {
                fd.close();
                this.* = .{ .ignore = {} };
            },
            .fd => {
                this.* = .{ .ignore = {} };
            },
            .buffer => {
                this.buffer.close();
            },
            .ignore => {},
            .inherit => {},
        }
    }
};

const bun = @import("bun");
const Environment = bun.Environment;
const Stdio = bun.spawn.Stdio;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const Subprocess = jsc.API.Subprocess;
const StaticPipeWriter = Subprocess.StaticPipeWriter;
const StdioResult = Subprocess.StdioResult;
const js = Subprocess.js;
