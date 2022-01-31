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
const buffer_pool_len = AsyncMessage.buffer_pool_len;
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
socket_send_len: u32 = 0,
socket_recv_eof: bool = false,
bio_write_offset: u32 = 0,
bio_read_offset: u32 = 0,

socket_send_error: ?anyerror = null,
socket_recv_error: ?anyerror = null,

next: ?*AsyncBIO = null,

onReady: ?Callback = null,

pub const Callback = struct {
    ctx: *anyopaque,
    callback: fn (ctx: *anyopaque) void,

    pub inline fn run(this: Callback) void {
        this.callback(this.ctx);
    }

    pub fn Wrap(comptime Context: type, comptime func: anytype) type {
        return struct {
            pub fn wrap(context: *anyopaque) void {
                func(@ptrCast(*Context, @alignCast(@alignOf(*Context), context)));
            }

            pub fn get(ctx: *Context) Callback {
                return Callback{
                    .ctx = ctx,
                    .callback = wrap,
                };
            }
        };
    }
};

pub fn nextFrame(this: *AsyncBIO) void {
    if (this.onReady) |ready| {
        ready.run();
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
    this.socket_send_len = 0;
    this.socket_recv_len = 0;
    this.bio_write_offset = 0;
    this.bio_read_offset = 0;
    this.socket_recv_error = null;
    this.socket_send_error = null;
    this.onReady = null;

    if (this.recv_buffer) |recv| {
        recv.release();
        this.recv_buffer = null;
    }

    if (this.send_buffer) |write| {
        write.release();
        this.send_buffer = null;
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
    const socket_recv_len = @intCast(
        c_int,
        result_ catch |err| {
            this.socket_recv_error = err;
            this.socket_recv_len = fail;
            this.onSocketReadComplete();
            return;
        },
    );
    this.socket_recv_len += socket_recv_len;
    if (extremely_verbose) {
        Output.prettyErrorln("onRead: {d}", .{socket_recv_len});
        Output.flush();
    }
    if (socket_recv_len == 0) {
        this.socket_recv_eof = true;
    }
    this.read_wait = .pending;

    // if (socket_recv_len == 0) {

    this.onSocketReadComplete();
    //     return;
    // }

    // this.read_wait = .pending;
    // this.scheduleSocketRead();
}

pub fn doSocketWrite(this: *AsyncBIO, _: *Completion, result_: AsyncIO.SendError!usize) void {
    const socket_send_len = @truncate(
        u32,
        result_ catch |err| {
            this.socket_send_error = err;
            this.send_wait = .pending;
            this.onSocketWriteComplete();
            return;
        },
    );
    this.socket_send_len += socket_send_len;

    if (socket_send_len == 0 or this.writeBuf().len == 0) {
        this.send_wait = .pending;
        this.onSocketWriteComplete();
        return;
    }

    this.send_wait = .pending;
    this.scheduleSocketWrite();
}

fn onSocketReadComplete(this: *AsyncBIO) void {
    this.handleSocketReadComplete();

    this.nextFrame();
}

inline fn readBuf(this: *AsyncBIO) []u8 {
    return this.recv_buffer.?.data[this.bio_read_offset..];
}

inline fn writeBuf(this: *AsyncBIO) []const u8 {
    return this.send_buffer.?.data[this.socket_send_len..this.bio_write_offset];
}

pub fn hasPendingReadData(this: *AsyncBIO) bool {
    return this.socket_recv_len > 0;
}

pub fn scheduleSocketRead(this: *AsyncBIO) void {
    this.read_wait = .suspended;
    if (this.recv_buffer == null) {
        this.recv_buffer = BufferPool.get(getAllocator());
    }

    AsyncIO.global.recv(*AsyncBIO, this, doSocketRead, &this.recv_completion, this.socket_fd, this.readBuf());
}

pub fn scheduleSocketWrite(this: *AsyncBIO) void {
    this.send_wait = .suspended;

    AsyncIO.global.send(*AsyncBIO, this, doSocketWrite, &this.send_completion, this.socket_fd, this.writeBuf(), SOCKET_FLAGS);
}

fn handleSocketReadComplete(
    this: *AsyncBIO,
) void {
    this.read_wait = .pending;

    if (this.socket_recv_len <= 0) {
        if (this.recv_buffer) |buf| {
            buf.release();
            this.recv_buffer = null;
        }
    }
}

pub fn onSocketWriteComplete(
    this: *AsyncBIO,
) void {
    assert(this.send_wait == .pending);
    this.handleSocketWriteComplete();
    this.nextFrame();
}

pub fn handleSocketWriteComplete(
    this: *AsyncBIO,
) void {
    this.send_wait = .completed;

    if (extremely_verbose) {
        Output.prettyErrorln("onWrite: {d}", .{this.socket_send_len});
        Output.flush();
    }

    // if (this.send_buffer) |buf| {
    //     buf.release();
    //     this.send_buffer = null;

    //     // this might be incorrect!
    //     this.bio_write_offset = 0;
    //     this.socket_send_len = 0;
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
    pub fn write(this_bio: *boring.BIO, ptr: [*c]const u8, len_: c_int) callconv(.C) c_int {
        if (len_ < 0) return len_;
        assert(@ptrToInt(ptr) > 0);
        {
            const retry_flags = boring.BIO_get_retry_flags(this_bio);
            boring.BIO_clear_retry_flags(this_bio);
            if ((retry_flags & boring.BIO_FLAGS_READ) != 0) {
                boring.BIO_set_retry_read(this_bio);
            }
        }
        var this = cast(this_bio);
        const len = @intCast(u32, len_);

        if (this.socket_send_error != null) {
            if (extremely_verbose) {
                Output.prettyErrorln("write: {s}", .{@errorName(this.socket_send_error.?)});
                Output.flush();
            }
            return -1;
        }

        if (this.send_buffer == null) {
            this.send_buffer = BufferPool.get(getAllocator());
        }

        var data = this.send_buffer.?.data[this.bio_write_offset..];
        const to_copy = @minimum(len, @intCast(u32, data.len));

        if (to_copy == 0) {
            boring.BIO_set_retry_write(this_bio);
            return -1;
        }

        @memcpy(data.ptr, ptr, to_copy);
        this.bio_write_offset += to_copy;

        this.scheduleSocketWrite();

        return @intCast(c_int, to_copy);
    }

    pub fn read(this_bio: *boring.BIO, ptr: [*c]u8, len_: c_int) callconv(.C) c_int {
        if (len_ < 0) return len_;
        const len__: u32 = @intCast(u32, len_);
        assert(@ptrToInt(ptr) > 0);
        {
            const retry_flags = boring.BIO_get_retry_flags(this_bio);
            boring.BIO_clear_retry_flags(this_bio);
            if ((retry_flags & boring.BIO_FLAGS_WRITE) != 0) {
                boring.BIO_set_retry_write(this_bio);
            }
        }

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
        if ((this.socket_send_error != null) and (socket_recv_len == OK or socket_recv_len == pending)) {
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

            boring.BIO_set_retry_read(this_bio);
            return pending;
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
        if (!(bio_read_offset < socket_recv_len_)) {
            return 0;
        }
        const len = @minimum(len__, socket_recv_len_ - bio_read_offset);
        var data = @ptrCast([*]const u8, this.recv_buffer.?.data[bio_read_offset..].ptr);
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
