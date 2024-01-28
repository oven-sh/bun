const bun = @import("root").bun;
const std = @import("std");

/// Read a blocking pipe without blocking the current thread.
pub fn PosixPipeReader(
    comptime This: type,
    // Originally this was the comptime vtable struct like the below
    // But that caused a Zig compiler segfault as of 0.12.0-dev.1604+caae40c21
    comptime getFd: fn (*This) bun.FileDescriptor,
    comptime getBuffer: fn (*This) *std.ArrayList(u8),
    comptime onReadChunk: ?fn (*This, chunk: []u8) void,
    comptime registerPoll: ?fn (*This) void,
    comptime done: fn (*This) void,
    comptime onError: fn (*This, bun.sys.Error) void,
) type {
    return struct {
        const vtable = .{
            .getFd = getFd,
            .getBuffer = getBuffer,
            .onReadChunk = onReadChunk,
            .registerPoll = registerPoll,
            .done = done,
            .onError = onError,
        };

        pub fn read(this: *This) void {
            const buffer = @call(.always_inline, vtable.getBuffer, .{this});
            const fd = @call(.always_inline, vtable.getFd, .{this});
            switch (bun.isReadable(fd)) {
                .ready, .hup => {
                    readFromBlockingPipeWithoutBlocking(this, buffer, fd, 0);
                },
                .not_ready => {
                    if (comptime vtable.registerPoll) |register| {
                        register(this);
                    }
                },
            }
        }

        pub fn onPoll(parent: *This, size_hint: isize) void {
            const resizable_buffer = vtable.getBuffer(parent);
            const fd = @call(.always_inline, vtable.getFd, .{parent});

            readFromBlockingPipeWithoutBlocking(parent, resizable_buffer, fd, size_hint);
        }

        const stack_buffer_len = 16384;

        fn readFromBlockingPipeWithoutBlocking(parent: *This, resizable_buffer: *std.ArrayList(u8), fd: bun.FileDescriptor, size_hint: isize) void {
            if (size_hint > stack_buffer_len) {
                resizable_buffer.ensureUnusedCapacity(@intCast(size_hint)) catch bun.outOfMemory();
            }

            const start_length: usize = resizable_buffer.items.len;

            while (true) {
                var buffer: []u8 = resizable_buffer.unusedCapacitySlice();
                var stack_buffer: [stack_buffer_len]u8 = undefined;

                if (buffer.len < stack_buffer_len) {
                    buffer = &stack_buffer;
                }

                switch (bun.sys.read(fd, buffer)) {
                    .result => |bytes_read| {
                        if (bytes_read == 0) {
                            vtable.done(parent);
                            return;
                        }

                        switch (bun.isReadable(fd)) {
                            .ready, .hup => {
                                if (buffer.ptr == &stack_buffer) {
                                    resizable_buffer.appendSlice(buffer[0..bytes_read]) catch bun.outOfMemory();
                                } else {
                                    resizable_buffer.items.len += bytes_read;
                                }
                                continue;
                            },

                            .not_ready => {
                                if (comptime vtable.onReadChunk) |onRead| {
                                    if (resizable_buffer.items[start_length..].len > 0) {
                                        onRead(parent, resizable_buffer.items[start_length..]);
                                    }

                                    resizable_buffer.items.len = 0;

                                    if (buffer.ptr == &stack_buffer) {
                                        onRead(parent, buffer[0..bytes_read]);
                                    }
                                } else {
                                    if (buffer.ptr == &stack_buffer) {
                                        resizable_buffer.appendSlice(buffer[0..bytes_read]) catch bun.outOfMemory();
                                    } else {
                                        resizable_buffer.items.len += bytes_read;
                                    }
                                }

                                if (comptime vtable.registerPoll) |register| {
                                    register(parent);
                                }

                                return;
                            },
                        }
                    },
                    .err => |err| {
                        vtable.onError(parent, err);
                        return;
                    },
                }
            }
        }
    };
}

const uv = bun.windows.libuv;
pub fn WindowsPipeReader(
    comptime This: type,
    // Originally this was the comptime vtable struct like the below
    // But that caused a Zig compiler segfault as of 0.12.0-dev.1604+caae40c21
    comptime getFd: anytype,
    comptime getBuffer: fn (*This) *std.ArrayList(u8),
    comptime onReadChunk: ?fn (*This, chunk: []u8) void,
    comptime registerPoll: ?fn (*This) void,
    comptime done: fn (*This) void,
    comptime onError: fn (*This, bun.sys.Error) void,
) type {
    return struct {
        pub usingnamespace uv.StreamReaderMixin(This, .pipe);

        const vtable = .{
            .getFd = getFd,
            .getBuffer = getBuffer,
            .onReadChunk = onReadChunk,
            .registerPoll = registerPoll,
            .done = done,
            .onError = onError,
        };

        fn _pipe(this: *This) *uv.Pipe {
            return this.pipe;
        }

        pub fn open(this: *This, loop: *uv.Loop, fd: bun.FileDescriptor, ipc: bool) bun.JSC.Maybe(void) {
            switch (_pipe(this).init(loop, ipc)) {
                .err => |err| {
                    return .{ .err = err };
                },
                else => {},
            }

            switch (_pipe(this).open(bun.uvfdcast(fd))) {
                .err => |err| {
                    return .{ .err = err };
                },
                else => {},
            }

            return .{ .result = {} };
        }

        fn onClosePipe(pipe: *uv.Pipe) callconv(.C) void {
            const this = @fieldParentPtr(This, "pipe", pipe);
            done(this);
        }

        pub fn onRead(this: *This, amount: bun.JSC.Maybe(usize), buf: *const uv.uv_buf_t) void {
            if (amount == .err) {
                onError(this, amount.err);
                return;
            }

            var buffer = getBuffer(this);

            if (amount.result == 0) {
                close(this);
                return;
            }

            if (comptime bun.Environment.allow_assert) {
                if (!bun.isSliceInBuffer(buf.slice()[0..amount.result], buffer.items)) {
                    @panic("uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it.");
                }
            }

            buffer.items.len += amount.result;

            if (comptime onReadChunk) |onChunk| {
                onChunk(this, buf[0..amount.result].slice());
            }
        }

        pub fn close(this: *This) void {
            this.stopReading().unwrap() catch unreachable;
            _pipe(this).close(&onClosePipe);
        }
    };
}

pub const PipeReader = if (bun.Environment.isWindows) WindowsPipeReader else PosixPipeReader;
