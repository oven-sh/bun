const ByteStream = @This();

buffer: std.ArrayList(u8) = .{
    .allocator = bun.default_allocator,
    .items = &.{},
    .capacity = 0,
},
has_received_last_chunk: bool = false,
pending: streams.Result.Pending = .{ .result = .{ .done = {} } },
done: bool = false,
pending_buffer: []u8 = &.{},
pending_value: jsc.Strong.Optional = .empty,
offset: usize = 0,
highWaterMark: Blob.SizeType = 0,
pipe: Pipe = .{},
size_hint: Blob.SizeType = 0,
buffer_action: ?BufferAction = null,

pub const Source = webcore.ReadableStream.NewSource(
    @This(),
    "Bytes",
    onStart,
    onPull,
    onCancel,
    deinit,
    null,
    drain,
    memoryCost,
    toBufferedValue,
);

const log = Output.scoped(.ByteStream, false);

pub const tag = webcore.ReadableStream.Tag.Bytes;

pub fn setup(this: *ByteStream) void {
    this.* = .{};
}

pub fn onStart(this: *@This()) streams.Start {
    if (this.has_received_last_chunk and this.buffer.items.len == 0) {
        return .{ .empty = {} };
    }

    if (this.has_received_last_chunk) {
        return .{ .owned_and_done = bun.ByteList.fromList(this.buffer.moveToUnmanaged()) };
    }

    if (this.highWaterMark == 0) {
        return .{ .ready = {} };
    }

    // For HTTP, the maximum streaming response body size will be 512 KB.
    // #define LIBUS_RECV_BUFFER_LENGTH 524288
    // For HTTPS, the size is probably quite a bit lower like 64 KB due to TLS transmission.
    // We add 1 extra page size so that if there's a little bit of excess buffered data, we avoid extra allocations.
    const page_size: Blob.SizeType = @intCast(std.heap.pageSize());
    return .{ .chunk_size = @min(512 * 1024 + page_size, @max(this.highWaterMark, page_size)) };
}

pub fn value(this: *@This()) JSValue {
    const result = this.pending_value.get() orelse {
        return .zero;
    };
    this.pending_value.clearWithoutDeallocation();
    return result;
}

pub fn isCancelled(this: *const @This()) bool {
    return this.parent().cancelled;
}

pub fn unpipeWithoutDeref(this: *@This()) void {
    this.pipe.ctx = null;
    this.pipe.onPipe = null;
}

pub fn onData(
    this: *@This(),
    stream: streams.Result,
    allocator: std.mem.Allocator,
) void {
    jsc.markBinding(@src());
    if (this.done) {
        if (stream.isDone() and (stream == .owned or stream == .owned_and_done)) {
            if (stream == .owned) allocator.free(stream.owned.slice());
            if (stream == .owned_and_done) allocator.free(stream.owned_and_done.slice());
        }
        this.has_received_last_chunk = stream.isDone();

        log("ByteStream.onData already done... do nothing", .{});

        return;
    }

    bun.assert(!this.has_received_last_chunk or stream == .err);
    this.has_received_last_chunk = stream.isDone();

    if (this.pipe.ctx) |ctx| {
        this.pipe.onPipe.?(ctx, stream, allocator);
        return;
    }

    const chunk = stream.slice();

    if (this.buffer_action) |*action| {
        if (stream == .err) {
            defer {
                this.buffer.clearAndFree();
                this.pending.result.deinit();
                this.pending.result = .{ .done = {} };
                this.buffer_action = null;
            }

            log("ByteStream.onData err  action.reject()", .{});

            action.reject(this.parent().globalThis, stream.err);
            return;
        }

        if (this.has_received_last_chunk) {
            defer {
                this.buffer_action = null;
            }

            if (this.buffer.capacity == 0 and stream == .done) {
                log("ByteStream.onData done and action.fulfill()", .{});

                var blob = this.toAnyBlob().?;
                action.fulfill(this.parent().globalThis, &blob);
                return;
            }
            if (this.buffer.capacity == 0 and stream == .owned_and_done) {
                log("ByteStream.onData owned_and_done and action.fulfill()", .{});

                this.buffer = std.ArrayList(u8).fromOwnedSlice(bun.default_allocator, @constCast(chunk));
                var blob = this.toAnyBlob().?;
                action.fulfill(this.parent().globalThis, &blob);
                return;
            }
            defer {
                if (stream == .owned_and_done or stream == .owned) {
                    allocator.free(stream.slice());
                }
            }
            log("ByteStream.onData appendSlice and action.fulfill()", .{});

            this.buffer.appendSlice(chunk) catch bun.outOfMemory();
            var blob = this.toAnyBlob().?;
            action.fulfill(this.parent().globalThis, &blob);

            return;
        } else {
            this.buffer.appendSlice(chunk) catch bun.outOfMemory();

            if (stream == .owned_and_done or stream == .owned) {
                allocator.free(stream.slice());
            }
        }

        return;
    }

    if (this.pending.state == .pending) {
        bun.assert(this.buffer.items.len == 0);
        const to_copy = this.pending_buffer[0..@min(chunk.len, this.pending_buffer.len)];
        const pending_buffer_len = this.pending_buffer.len;
        bun.assert(to_copy.ptr != chunk.ptr);
        @memcpy(to_copy, chunk[0..to_copy.len]);
        this.pending_buffer = &.{};

        const is_really_done = this.has_received_last_chunk and to_copy.len <= pending_buffer_len;

        if (is_really_done) {
            this.done = true;

            if (to_copy.len == 0) {
                if (stream == .err) {
                    this.pending.result = .{
                        .err = stream.err,
                    };
                } else {
                    this.pending.result = .{
                        .done = {},
                    };
                }
            } else {
                this.pending.result = .{
                    .into_array_and_done = .{
                        .value = this.value(),
                        .len = @as(Blob.SizeType, @truncate(to_copy.len)),
                    },
                };
            }
        } else {
            this.pending.result = .{
                .into_array = .{
                    .value = this.value(),
                    .len = @as(Blob.SizeType, @truncate(to_copy.len)),
                },
            };
        }

        const remaining = chunk[to_copy.len..];
        if (remaining.len > 0 and chunk.len > 0)
            this.append(stream, to_copy.len, chunk, allocator) catch @panic("Out of memory while copying request body");

        log("ByteStream.onData pending.run()", .{});

        this.pending.run();

        return;
    }

    log("ByteStream.onData no action just append", .{});

    this.append(stream, 0, chunk, allocator) catch @panic("Out of memory while copying request body");
}

pub fn append(
    this: *@This(),
    stream: streams.Result,
    offset: usize,
    base_address: []const u8,
    allocator: std.mem.Allocator,
) !void {
    const chunk = stream.slice()[offset..];

    if (this.buffer.capacity == 0) {
        switch (stream) {
            .owned => |owned| {
                this.buffer = owned.listManaged(allocator);
                this.offset += offset;
            },
            .owned_and_done => |owned| {
                this.buffer = owned.listManaged(allocator);
                this.offset += offset;
            },
            .temporary_and_done, .temporary => {
                this.buffer = try std.ArrayList(u8).initCapacity(bun.default_allocator, chunk.len);
                this.buffer.appendSliceAssumeCapacity(chunk);
            },
            .err => {
                this.pending.result = .{ .err = stream.err };
            },
            .done => {},
            else => unreachable,
        }
        return;
    }

    switch (stream) {
        .temporary_and_done, .temporary => {
            try this.buffer.appendSlice(chunk);
        },
        .owned_and_done, .owned => {
            try this.buffer.appendSlice(chunk);
            allocator.free(@constCast(base_address));
        },
        .err => {
            if (this.buffer_action != null) {
                @panic("Expected buffer action to be null");
            }

            this.pending.result = .{ .err = stream.err };
        },
        .done => {},
        // We don't support the rest of these yet
        else => unreachable,
    }

    return;
}

pub fn setValue(this: *@This(), view: jsc.JSValue) void {
    jsc.markBinding(@src());
    this.pending_value.set(this.parent().globalThis, view);
}

pub fn parent(this: *@This()) *Source {
    return @fieldParentPtr("context", this);
}

pub fn onPull(this: *@This(), buffer: []u8, view: jsc.JSValue) streams.Result {
    jsc.markBinding(@src());
    bun.assert(buffer.len > 0);
    bun.debugAssert(this.buffer_action == null);

    if (this.buffer.items.len > 0) {
        bun.assert(this.value() == .zero);
        const to_write = @min(
            this.buffer.items.len - this.offset,
            buffer.len,
        );
        const remaining_in_buffer = this.buffer.items[this.offset..][0..to_write];

        @memcpy(buffer[0..to_write], this.buffer.items[this.offset..][0..to_write]);

        if (this.offset + to_write == this.buffer.items.len) {
            this.offset = 0;
            this.buffer.items.len = 0;
        } else {
            this.offset += to_write;
        }

        if (this.has_received_last_chunk and remaining_in_buffer.len == 0) {
            this.buffer.clearAndFree();
            this.done = true;

            return .{
                .into_array_and_done = .{
                    .value = view,
                    .len = @as(Blob.SizeType, @truncate(to_write)),
                },
            };
        }

        return .{
            .into_array = .{
                .value = view,
                .len = @as(Blob.SizeType, @truncate(to_write)),
            },
        };
    }

    if (this.has_received_last_chunk) {
        return .{
            .done = {},
        };
    }

    this.pending_buffer = buffer;
    this.setValue(view);

    return .{
        .pending = &this.pending,
    };
}

pub fn onCancel(this: *@This()) void {
    jsc.markBinding(@src());
    const view = this.value();
    if (this.buffer.capacity > 0) this.buffer.clearAndFree();
    this.done = true;
    this.pending_value.deinit();

    if (view != .zero) {
        this.pending_buffer = &.{};
        this.pending.result.deinit();
        this.pending.result = .{ .done = {} };
        this.pending.run();
    }

    if (this.buffer_action) |*action| {
        const global = this.parent().globalThis;
        action.reject(global, .{ .AbortReason = .UserAbort });
        this.buffer_action = null;
    }
}

pub fn memoryCost(this: *const @This()) usize {
    // ReadableStreamSource covers @sizeOf(ByteStream)
    return this.buffer.capacity;
}

pub fn deinit(this: *@This()) void {
    jsc.markBinding(@src());
    if (this.buffer.capacity > 0) this.buffer.clearAndFree();

    this.pending_value.deinit();
    if (!this.done) {
        this.done = true;

        this.pending_buffer = &.{};
        this.pending.result.deinit();
        this.pending.result = .{ .done = {} };
        if (this.pending.state == .pending and this.pending.future == .promise) {
            // We must never run JavaScript inside of a GC finalizer.
            this.pending.runOnNextTick();
        } else {
            this.pending.run();
        }
    }
    if (this.buffer_action) |*action| {
        action.deinit();
    }
    this.parent().deinit();
}

pub fn drain(this: *@This()) bun.ByteList {
    if (this.buffer.items.len > 0) {
        const out = bun.ByteList.fromList(this.buffer);
        this.buffer = .{
            .allocator = bun.default_allocator,
            .items = &.{},
            .capacity = 0,
        };

        return out;
    }

    return .{};
}

pub fn toAnyBlob(this: *@This()) ?Blob.Any {
    if (this.has_received_last_chunk) {
        const buffer = this.buffer;
        this.buffer = .{
            .allocator = bun.default_allocator,
            .items = &.{},
            .capacity = 0,
        };
        this.done = true;
        this.pending.result.deinit();
        this.pending.result = .{ .done = {} };
        this.parent().is_closed = true;
        return .{ .InternalBlob = .{
            .bytes = buffer,
            .was_string = false,
        } };
    }

    return null;
}

pub fn toBufferedValue(this: *@This(), globalThis: *jsc.JSGlobalObject, action: streams.BufferAction.Tag) bun.JSError!jsc.JSValue {
    if (this.buffer_action != null) {
        return globalThis.throw("Cannot buffer value twice", .{});
    }

    if (this.pending.result == .err) {
        const err, _ = this.pending.result.err.toJSWeak(globalThis);
        this.pending.result.deinit();
        this.done = true;
        this.buffer.clearAndFree();
        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (this.toAnyBlob()) |blob_| {
        var blob = blob_;
        return blob.toPromise(globalThis, action);
    }

    this.buffer_action = switch (action) {
        .blob => .{ .blob = .init(globalThis) },
        .bytes => .{ .bytes = .init(globalThis) },
        .arrayBuffer => .{ .arrayBuffer = .init(globalThis) },
        .json => .{ .json = .init(globalThis) },
        .text => .{ .text = .init(globalThis) },
    };

    return this.buffer_action.?.value();
}

const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const webcore = bun.webcore;
const streams = webcore.streams;
const jsc = bun.jsc;
const Blob = webcore.Blob;
const Pipe = webcore.Pipe;
const BufferAction = streams.BufferAction;
const JSValue = jsc.JSValue;
