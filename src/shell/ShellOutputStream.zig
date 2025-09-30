const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const webcore = jsc.WebCore;
const Blob = webcore.Blob;
const streams = webcore.streams;
const Output = bun.Output;

/// ShellOutputStream provides a ReadableStream interface over a ByteList that is
/// being written to during shell execution. It allows streaming stdout/stderr
/// while the shell is still running, rather than waiting for completion.
const ShellOutputStream = @This();

/// Pointer to the ByteList being written to by the shell
buffer: *bun.ByteList,
/// Current read offset in the buffer
offset: usize = 0,
/// Whether the shell has finished and no more data will be written
done: bool = false,
/// Pending read operation
pending: streams.Result.Pending = .{ .result = .{ .done = {} } },
/// Buffer for pending read
pending_buffer: []u8 = &.{},
/// JSValue for the pending read
pending_value: jsc.Strong.Optional = .empty,

pub const Source = webcore.ReadableStream.NewSource(
    @This(),
    "ShellOutputStream",
    onStart,
    onPull,
    onCancel,
    deinit,
    null,
    null,
    null,
    null,
);

const log = Output.scoped(.ShellOutputStream, .visible);

pub fn init(buffer: *bun.ByteList) ShellOutputStream {
    return .{
        .buffer = buffer,
    };
}

pub fn parent(this: *@This()) *Source {
    return @fieldParentPtr("context", this);
}

pub fn onStart(this: *@This()) streams.Start {
    // If we already have data, let the consumer know
    if (this.buffer.len > 0 and this.done) {
        return .{ .chunk_size = 16384 };
    }

    return .{ .ready = {} };
}

pub fn onPull(this: *@This(), buffer: []u8, view: jsc.JSValue) streams.Result {
    jsc.markBinding(@src());
    bun.assert(buffer.len > 0);

    const available = this.buffer.len -| this.offset;

    if (available > 0) {
        const to_copy = @min(available, buffer.len);
        @memcpy(buffer[0..to_copy], this.buffer.slice()[this.offset..][0..to_copy]);
        this.offset += to_copy;

        // If we've read everything and the shell is done, signal completion
        if (this.done and this.offset >= this.buffer.len) {
            return .{
                .into_array_and_done = .{
                    .value = view,
                    .len = @as(Blob.SizeType, @truncate(to_copy)),
                },
            };
        }

        return .{
            .into_array = .{
                .value = view,
                .len = @as(Blob.SizeType, @truncate(to_copy)),
            },
        };
    }

    // No data available yet
    if (this.done) {
        return .{ .done = {} };
    }

    // Wait for data
    this.pending_buffer = buffer;
    this.pending_value.set(this.parent().globalThis, view);
    return .{
        .pending = &this.pending,
    };
}

pub fn onCancel(this: *@This()) void {
    jsc.markBinding(@src());
    this.done = true;
    this.pending_value.deinit();

    if (this.pending.state == .pending) {
        this.pending_buffer = &.{};
        this.pending.result.deinit();
        this.pending.result = .{ .done = {} };
        this.pending.run();
    }
}

pub fn deinit(this: *@This()) void {
    jsc.markBinding(@src());
    this.pending_value.deinit();

    if (!this.done) {
        this.done = true;
        if (this.pending.state == .pending) {
            this.pending_buffer = &.{};
            this.pending.result.deinit();
            this.pending.result = .{ .done = {} };
            if (this.pending.future == .promise) {
                this.pending.runOnNextTick();
            } else {
                this.pending.run();
            }
        }
    }

    this.parent().deinit();
}

/// Called when new data has been written to the buffer.
/// Resumes any pending read operation.
pub fn onData(this: *@This()) void {
    if (this.pending.state != .pending) {
        return;
    }

    const available = this.buffer.len -| this.offset;
    if (available == 0) {
        return;
    }

    const to_copy = @min(available, this.pending_buffer.len);
    @memcpy(
        this.pending_buffer[0..to_copy],
        this.buffer.slice()[this.offset..][0..to_copy]
    );
    this.offset += to_copy;

    const view = this.pending_value.get() orelse {
        return;
    };
    this.pending_value.clearWithoutDeallocation();
    this.pending_buffer = &.{};

    const is_done = this.done and this.offset >= this.buffer.len;

    if (is_done) {
        this.pending.result = .{
            .into_array_and_done = .{
                .value = view,
                .len = @as(Blob.SizeType, @truncate(to_copy)),
            },
        };
    } else {
        this.pending.result = .{
            .into_array = .{
                .value = view,
                .len = @as(Blob.SizeType, @truncate(to_copy)),
            },
        };
    }

    this.pending.run();
}

/// Called when the shell has finished and no more data will be written.
pub fn setDone(this: *@This()) void {
    this.done = true;

    // If we have a pending read and no more data, resolve it as done
    if (this.pending.state == .pending) {
        const available = this.buffer.len -| this.offset;
        if (available == 0) {
            this.pending_buffer = &.{};
            const view = this.pending_value.get();
            if (view) |v| {
                _ = v;
                this.pending_value.clearWithoutDeallocation();
            }
            this.pending.result.deinit();
            this.pending.result = .{ .done = {} };
            this.pending.run();
        } else {
            // We have data, let onData handle it
            this.onData();
        }
    }
}
