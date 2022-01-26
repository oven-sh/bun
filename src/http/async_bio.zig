const boring = @import("boringssl");
const std = @import("std");
const AsyncIO = @import("io");
const Completion = AsyncIO.Completion;
const AsyncMessage = @import("./async_message.zig");
const AsyncBIO = @This();
const Output = @import("../global.zig").Output;
const extremely_verbose = @import("../http_client_async.zig").extremely_verbose;
const SOCKET_FLAGS = @import("../http_client_async.zig").SOCKET_FLAGS;
const getAllocator = @import("../http_client_async.zig").getAllocator;
const assert = std.debug.assert;
const BufferPool = AsyncMessage.BufferPool;

const fail = -3;
const connection_closed = -2;
const pending = -1;
const OK = 0;

bio: *boring.BIO = undefined,
socket_fd: std.os.socket_t = 0,

allocator: std.mem.Allocator,

read_wait: Wait = Wait.pending,
send_wait: Wait = Wait.pending,

recv_buffer: ?*BufferPool.Node = null,
recv_completion: Completion = undefined,

send_buffer: ?*BufferPool.Node = null,
send_completion: Completion = undefined,

write_error: c_int = 0,
socket_recv_len: c_int = 0,
bio_read_offset: u32 = 0,

socket_send_error: ?anyerror = null,
socket_recv_error: ?anyerror = null,

next: ?*AsyncBIO = null,

pending_frame: PendingFrame = PendingFrame.init(),
pub const PendingFrame = std.fifo.LinearFifo(anyframe, .{ .Static = 8 });

pub inline fn pushPendingFrame(this: *AsyncBIO, frame: anyframe) void {
    this.pending_frame.writeItem(frame) catch {};
}

pub inline fn popPendingFrame(this: *AsyncBIO) ?anyframe {
    return this.pending_frame.readItem();
}

pub fn nextFrame(this: *AsyncBIO) void {
    if (this.pending_frame.readItem()) |frame| {
        resume frame;
    }
}

var method: ?*boring.BIO_METHOD = null;
var head: ?*AsyncBIO = null;

const async_bio_name: [:0]const u8 = "AsyncBIO";

const Wait = enum {
    pending,
    suspended,
    completed,
};

fn instance(allocator: std.mem.Allocator) *AsyncBIO {
    if (head) |head_| {
        var next = head_.next;
        var ret = head_;
        ret.read_wait = .pending;
        ret.send_wait = .pending;
        head = next;

        ret.pending_frame = PendingFrame.init();
        return ret;
    }

    var bio = allocator.create(AsyncBIO) catch unreachable;
    bio.* = AsyncBIO{
        .allocator = allocator,
        .read_wait = .pending,
        .send_wait = .pending,
    };

    return bio;
}

pub fn release(this: *AsyncBIO) void {
    if (head) |head_| {
        this.next = head_;
    }

    this.read_wait = .pending;
    this.send_wait = .pending;
    this.pending_frame = PendingFrame.init();

    if (this.recv_buffer) |recv| {
        recv.release();
        this.recv_buffer = null;
    }

    if (this.write_buffer) |write| {
        write.release();
        this.write_buffer = null;
    }

    head = this;
}

pub fn init(allocator: std.mem.Allocator) !*AsyncBIO {
    var bio = instance(allocator);

    bio.bio = boring.BIO_new(
        method orelse brk: {
            method = boring.BIOMethod.init(async_bio_name, Bio.create, Bio.destroy, Bio.write, Bio.read, null, Bio.ctrl);
            break :brk method.?;
        },
    ) orelse return error.OutOfMemory;

    _ = boring.BIO_set_data(bio.bio, bio);
    return bio;
}

const WaitResult = enum {
    none,
    read,
    send,
};

pub fn doSocketRead(this: *AsyncBIO, _: *Completion, result_: AsyncIO.RecvError!usize) void {
    const socket_recv_len = @truncate(
        c_int,
        result_ catch |err| {
            this.socket_recv_error = err;
            this.socket_recv_len = fail;
            this.onSocketReadComplete();
            return;
        },
    );
    this.socket_recv_len += socket_recv_len;

    if (socket_recv_len == 0) {
        this.onSocketReadComplete();
        return;
    }

    this.read_wait = .pending;
    this.scheduleSocketRead();
}

fn onSocketReadComplete(this: *AsyncBIO) void {
    assert(this.read_wait == .suspended);
    this.handleSocketReadComplete();

    this.nextFrame();
}

inline fn readBuf(this: *AsyncBIO) []u8 {
    return this.recv_buffer.?.data[this.bio_read_offset..];
}

pub fn scheduleSocketRead(this: *AsyncBIO) void {
    assert(this.read_wait == .pending);
    this.read_wait = .suspended;

    AsyncIO.global.recv(*AsyncBIO, this, this.doSocketRead, &this.recv_completion, this.socket_fd, this.readBuf());
}

fn handleSocketReadComplete(
    this: *AsyncBIO,
) void {
    this.read_wait = .completed;

    if (this.socket_recv_len <= 0) {
        if (this.recv_buffer) |buf| {
            buf.release();
            this.recv_buffer = null;
        }
    }
}

pub fn onSocketWriteComplete(this: *AsyncBIO, _: *Completion, result: AsyncIO.SendError!usize) void {
    assert(this.send_wait == .pending);
    this.handleSocketWriteComplete(result);
    this.nextFrame();
}

pub fn handleSocketWriteComplete(this: *AsyncBIO, result: AsyncIO.SendError!usize) void {
    //  this.last_socket_recv_len = result;
    // this.read_wait = .completed;
    // if (extremely_verbose) {
    //     const socket_recv_len = result catch @as(usize, 999);
    //     Output.prettyErrorln("onRead: {d}", .{socket_recv_len});
    //     Output.flush();
    // }
}

pub const Bio = struct {
    inline fn cast(bio: *boring.BIO) *AsyncBIO {
        return @ptrCast(*AsyncBIO, @alignCast(@alignOf(*AsyncBIO), boring.BIO_get_data(bio)));
    }

    pub fn create(this_bio: *boring.BIO) callconv(.C) c_int {
        boring.BIO_set_init(this_bio, 1);
        return 1;
    }
    pub fn destroy(this_bio: *boring.BIO) callconv(.C) c_int {
        boring.BIO_set_init(this_bio, 0);

        if (boring.BIO_get_data(this_bio) != null) {
            var this = cast(this_bio);
            this.release();
        }

        return 0;
    }
    pub fn write(this_bio: *boring.BIO, ptr: [*c]const u8, len: c_int) callconv(.C) c_int {
        if (len < 0) return len;
        assert(@ptrToInt(ptr) > 0);
        boring.BIO_clear_retry_flags(this_bio);
        var this = cast(this_bio);

        if (this.socket_send_error != null) {
            if (extremely_verbose) {
                Output.prettyErrorln("write: {s}", .{@errorName(this.socket_send_error.?)});
                Output.flush();
            }
            return -1;
        }
    }

    pub fn read(this_bio: *boring.BIO, ptr: [*c]u8, len_: c_int) callconv(.C) c_int {
        if (len_ < 0) return len_;
        const len__: u32 = @intCast(u32, len_);
        assert(@ptrToInt(ptr) > 0);

        boring.BIO_clear_retry_flags(this_bio);
        var this = cast(this_bio);

        var socket_recv_len = this.socket_recv_len;
        var bio_read_offset = this.bio_read_offset;
        defer {
            this.bio_read_offset = bio_read_offset;
            this.socket_recv_len = socket_recv_len;
        }

        if (this.socket_recv_error) |socket_err| {
            if (extremely_verbose) Output.prettyErrorln("SSL read error: {s}", .{@errorName(socket_err)});
            return -1;
        }

        // If there is no result available synchronously, report any Write() errors
        // that were observed. Otherwise the application may have encountered a socket
        // error while writing that would otherwise not be reported until the
        // application attempted to write again - which it may never do. See
        // https://crbug.com/249848.
        if ((this.write_error != OK or this.write_error != pending) and (socket_recv_len == OK or socket_recv_len == pending)) {
            return -1;
        }

        if (socket_recv_len == 0) {
            // Instantiate the read buffer and read from the socket. Although only |len|
            // bytes were requested, intentionally read to the full buffer size. The SSL
            // layer reads the record header and body in separate reads to avoid
            // overreading, but issuing one is more efficient. SSL sockets are not
            // reused after shutdown for non-SSL traffic, so overreading is fine.
            assert(bio_read_offset == 0);
            this.scheduleSocketRead();
            socket_recv_len = pending;
        }

        if (socket_recv_len == pending) {
            boring.BIO_set_retry_read(this_bio);
            return -1;
        }

        // If the last Read() failed, report the error.
        if (socket_recv_len < 0) {
            if (extremely_verbose) Output.prettyErrorln("Unexpected ssl error: {d}", .{socket_recv_len});
            return -1;
        }

        const socket_recv_len_ = @intCast(u32, socket_recv_len);

        // Report the result of the last Read() if non-empty.
        if (!(bio_read_offset < socket_recv_len_)) return 0;
        const len = @minimum(len__, socket_recv_len_ - bio_read_offset);
        var data = @ptrCast([*]const u8, &this.recv_buffer.?.data[bio_read_offset]);
        @memcpy(ptr, data, len);
        bio_read_offset += len;

        if (bio_read_offset == socket_recv_len_) {
            // The read buffer is empty.
            bio_read_offset = 0;
            socket_recv_len = 0;

            if (this.recv_buffer) |buf| {
                buf.release();
                this.recv_buffer = null;
            }
        }

        return @intCast(c_int, len);
    }

    // https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/socket/socket_bio_adapter.cc#376
    pub fn ctrl(_: *boring.BIO, cmd: c_int, _: c_long, _: ?*anyopaque) callconv(.C) c_long {
        return switch (cmd) {
            // The SSL stack requires BIOs handle BIO_flush.
            boring.BIO_CTRL_FLUSH => 1,
            else => 0,
        };
    }
};
