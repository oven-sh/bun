pub const Readable = union(enum) {
    fd: bun.FileDescriptor,
    memfd: bun.FileDescriptor,
    pipe: *PipeReader,
    inherit: void,
    ignore: void,
    closed: void,
    /// Eventually we will implement Readables created from blobs and array buffers.
    /// When we do that, `buffer` will be borrowed from those objects.
    ///
    /// When a buffered `pipe` finishes reading from its file descriptor,
    /// the owning `Readable` will be convered into this variant and the pipe's
    /// buffer will be taken as an owned `CowString`.
    buffer: CowString,

    pub fn memoryCost(this: *const Readable) usize {
        return switch (this.*) {
            .pipe => @sizeOf(PipeReader) + this.pipe.memoryCost(),
            .buffer => this.buffer.length(),
            else => 0,
        };
    }

    pub fn hasPendingActivity(this: *const Readable) bool {
        return switch (this.*) {
            .pipe => this.pipe.hasPendingActivity(),
            else => false,
        };
    }

    pub fn ref(this: *Readable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(true);
            },
            else => {},
        }
    }

    pub fn unref(this: *Readable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(false);
            },
            else => {},
        }
    }

    pub fn init(stdio: Stdio, event_loop: *jsc.EventLoop, process: *Subprocess, result: StdioResult, allocator: std.mem.Allocator, max_size: ?*MaxBuf, is_sync: bool) Readable {
        _ = allocator; // autofix
        _ = is_sync; // autofix
        Subprocess.assertStdioResult(result);

        if (comptime Environment.isPosix) {
            if (stdio == .pipe) {
                _ = bun.sys.setNonblocking(result.?);
            }
        }

        return switch (stdio) {
            .inherit => Readable{ .inherit = {} },
            .ignore, .ipc, .path => Readable{ .ignore = {} },
            .fd => |fd| if (Environment.isPosix) Readable{ .fd = result.? } else Readable{ .fd = fd },
            .memfd => if (Environment.isPosix) Readable{ .memfd = stdio.memfd } else Readable{ .ignore = {} },
            .dup2 => |dup2| if (Environment.isPosix) Output.panic("TODO: implement dup2 support in Stdio readable", .{}) else Readable{ .fd = dup2.out.toFd() },
            .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result, max_size) },
            .array_buffer, .blob => Output.panic("TODO: implement ArrayBuffer & Blob support in Stdio readable", .{}),
            .capture => Output.panic("TODO: implement capture support in Stdio readable", .{}),
            .readable_stream => Readable{ .ignore = {} }, // ReadableStream is handled separately
        };
    }

    pub fn onClose(this: *Readable, _: ?bun.sys.Error) void {
        this.* = .closed;
    }

    pub fn onReady(_: *Readable, _: ?jsc.WebCore.Blob.SizeType, _: ?jsc.WebCore.Blob.SizeType) void {}

    pub fn onStart(_: *Readable) void {}

    pub fn close(this: *Readable) void {
        switch (this.*) {
            .memfd => |fd| {
                this.* = .{ .closed = {} };
                fd.close();
            },
            .fd => |_| {
                this.* = .{ .closed = {} };
            },
            .pipe => {
                this.pipe.close();
            },
            else => {},
        }
    }

    pub fn finalize(this: *Readable) void {
        switch (this.*) {
            .memfd => |fd| {
                this.* = .{ .closed = {} };
                fd.close();
            },
            .fd => {
                this.* = .{ .closed = {} };
            },
            .pipe => |pipe| {
                defer pipe.detach();
                this.* = .{ .closed = {} };
            },
            .buffer => |*buf| {
                buf.deinit(bun.default_allocator);
            },
            else => {},
        }
    }

    pub fn toJS(this: *Readable, globalThis: *jsc.JSGlobalObject, exited: bool) bun.JSError!JSValue {
        _ = exited; // autofix
        switch (this.*) {
            // should only be reachable when the entire output is buffered.
            .memfd => return this.toBufferedValue(globalThis),

            .fd => |fd| {
                return fd.toJS(globalThis);
            },
            .pipe => |pipe| {
                defer pipe.detach();
                this.* = .{ .closed = {} };
                return pipe.toJS(globalThis);
            },
            .buffer => |*buffer| {
                defer this.* = .{ .closed = {} };

                if (buffer.length() == 0) {
                    return jsc.WebCore.ReadableStream.empty(globalThis);
                }

                const own = try buffer.takeSlice(bun.default_allocator);
                return jsc.WebCore.ReadableStream.fromOwnedSlice(globalThis, own, 0);
            },
            else => {
                return .js_undefined;
            },
        }
    }

    pub fn toBufferedValue(this: *Readable, globalThis: *jsc.JSGlobalObject) bun.JSError!JSValue {
        switch (this.*) {
            .fd => |fd| {
                return fd.toJS(globalThis);
            },
            .memfd => |fd| {
                if (comptime !Environment.isPosix) {
                    Output.panic("memfd is only supported on Linux", .{});
                }
                this.* = .{ .closed = {} };
                return jsc.ArrayBuffer.toJSBufferFromMemfd(fd, globalThis);
            },
            .pipe => |pipe| {
                defer pipe.detach();
                this.* = .{ .closed = {} };
                return pipe.toBuffer(globalThis);
            },
            .buffer => |*buf| {
                defer this.* = .{ .closed = {} };
                const own = buf.takeSlice(bun.default_allocator) catch {
                    return globalThis.throwOutOfMemory();
                };

                return jsc.MarkedArrayBuffer.fromBytes(own, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
            },
            else => {
                return .js_undefined;
            },
        }
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const CowString = bun.ptr.CowString;
const Stdio = bun.spawn.Stdio;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const Subprocess = jsc.API.Subprocess;
const MaxBuf = Subprocess.MaxBuf;
const PipeReader = Subprocess.PipeReader;
const StdioResult = Subprocess.StdioResult;
