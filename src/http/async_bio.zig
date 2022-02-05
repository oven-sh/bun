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
const ObjectPool = @import("../pool.zig").ObjectPool;
const Environment = @import("../env.zig");

const Packet = struct {
    completion: Completion,
    min: u32 = 0,
    owned_slice: []u8 = &[_]u8{},

    pub const Pool = ObjectPool(Packet, null, false, 32);
};

bio: ?*boring.BIO = null,
socket_fd: std.os.socket_t = 0,

allocator: std.mem.Allocator,

pending_reads: u32 = 0,
pending_sends: u32 = 0,
recv_buffer: ?*BufferPool.Node = null,
send_buffer: ?*BufferPool.Node = null,
socket_recv_len: c_int = 0,
socket_send_len: u32 = 0,
bio_write_offset: u32 = 0,
bio_read_offset: u32 = 0,
socket_send_error: ?anyerror = null,
socket_recv_error: ?anyerror = null,

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
pub fn initBoringSSL() void {
    method = boring.BIOMethod.init(async_bio_name, Bio.create, Bio.destroy, Bio.write, Bio.read, null, Bio.ctrl);
}

const async_bio_name: [:0]const u8 = "AsyncBIO";

const Wait = enum {
    pending,
    suspended,
    completed,
};

pub fn init(this: *AsyncBIO) !void {
    if (this.bio == null) {
        this.bio = boring.BIO_new(
            method.?,
        );
    }

    _ = boring.BIO_set_data(this.bio.?, this);
}

const WaitResult = enum {
    none,
    read,
    send,
};

pub fn doSocketRead(this: *AsyncBIO, completion: *Completion, result_: AsyncIO.RecvError!usize) void {
    var ctx = @fieldParentPtr(Packet.Pool.Node, "data", @fieldParentPtr(Packet, "completion", completion));
    ctx.release();

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

    // if (socket_recv_len == 0) {

    this.onSocketReadComplete();
    //     return;
    // }

    // this.read_wait = .pending;
    // this.scheduleSocketRead();
}

pub fn doSocketWrite(this: *AsyncBIO, completion: *Completion, result_: AsyncIO.SendError!usize) void {
    var ctx = @fieldParentPtr(Packet.Pool.Node, "data", @fieldParentPtr(Packet, "completion", completion));
    defer ctx.release();

    const socket_send_len = @truncate(
        u32,
        result_ catch |err| {
            this.socket_send_error = err;
            this.onSocketWriteComplete();
            return;
        },
    );
    this.socket_send_len += socket_send_len;

    const remain = ctx.data.min - @minimum(ctx.data.min, socket_send_len);

    if (socket_send_len == 0 or remain == 0) {
        this.onSocketWriteComplete();
        return;
    }

    if (this.socket_fd == 0) return;
    this.scheduleSocketWrite(completion.operation.slice()[remain..]);
}

fn onSocketReadComplete(this: *AsyncBIO) void {
    this.handleSocketReadComplete();

    this.nextFrame();
}

inline fn readBuf(this: *AsyncBIO) []u8 {
    return this.recv_buffer.?.data[@intCast(u32, this.socket_recv_len)..];
}

pub fn hasPendingReadData(this: *AsyncBIO) bool {
    return this.socket_recv_len - @intCast(c_int, this.bio_read_offset) > 0;
}

pub fn scheduleSocketRead(this: *AsyncBIO, min: u32) void {
    if (this.recv_buffer == null) {
        this.recv_buffer = BufferPool.get(getAllocator());
    }

    this.scheduleSocketReadBuf(min, this.readBuf());
}

pub fn scheduleSocketReadBuf(this: *AsyncBIO, min: u32, buf: []u8) void {
    var packet = Packet.Pool.get(getAllocator());
    packet.data.min = @truncate(u32, min);

    AsyncIO.global.recv(*AsyncBIO, this, doSocketRead, &packet.data.completion, this.socket_fd, buf);
}

pub fn scheduleSocketWrite(this: *AsyncBIO, buf: []const u8) void {
    var packet = Packet.Pool.get(getAllocator());
    packet.data.min = @truncate(u32, buf.len);
    AsyncIO.global.send(*AsyncBIO, this, doSocketWrite, &packet.data.completion, this.socket_fd, buf, SOCKET_FLAGS);
}

fn handleSocketReadComplete(
    this: *AsyncBIO,
) void {
    this.pending_reads -|= 1;
}

pub fn onSocketWriteComplete(
    this: *AsyncBIO,
) void {
    this.handleSocketWriteComplete();
    this.nextFrame();
}

pub fn handleSocketWriteComplete(
    this: *AsyncBIO,
) void {
    this.pending_sends -|= 1;

    if (extremely_verbose) {
        Output.prettyErrorln("onWrite: {d}", .{this.socket_send_len});
        Output.flush();
    }

    if (this.pending_sends == 0) {
        if (this.send_buffer) |buf| {
            buf.release();
            this.send_buffer = null;

            // this might be incorrect!
            this.bio_write_offset = 0;
            this.socket_send_len = 0;
        }
    }
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
            this.bio = null;
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

        if (this.socket_fd == 0) {
            if (comptime Environment.allow_assert) std.debug.assert(false); // socket_fd should never be 0
            return -1;
        }

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

        this.scheduleSocketWrite(data[0..to_copy]);
        this.pending_sends += 1;

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
        assert(len_ < buffer_pool_len);

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

            if (this.socket_fd == 0) {
                if (comptime Environment.allow_assert) std.debug.assert(false); // socket_fd should never be 0
                return -1;
            }

            if (this.pending_reads == 0) {
                this.pending_reads += 1;
                this.scheduleSocketRead(len__);
            }

            boring.BIO_set_retry_read(this_bio);
            return pending;
        }

        // If the last Read() failed, report the error.
        if (socket_recv_len < 0) {
            if (extremely_verbose) Output.prettyErrorln("Unexpected ssl error: {d}", .{socket_recv_len});
            return -1;
        }

        const socket_recv_len_ = @intCast(u32, socket_recv_len);

        // Report the result of the last Read() if non-empty.
        const len = @minimum(len__, socket_recv_len_ - bio_read_offset);
        var bytes = this.recv_buffer.?.data[bio_read_offset..socket_recv_len_];

        if (len__ > @truncate(u32, bytes.len)) {
            if (this.socket_fd == 0) {
                if (comptime Environment.allow_assert) std.debug.assert(false); // socket_fd should never be 0
                return -1;
            }

            if (this.pending_reads == 0) {
                // if this is true, we will never have enough space
                if (socket_recv_len_ + len__ >= buffer_pool_len and len_ < buffer_pool_len) {
                    const unread = socket_recv_len_ - bio_read_offset;
                    // TODO: can we use virtual memory magic to skip the copy here?
                    std.mem.copyBackwards(u8, this.recv_buffer.?.data[0..unread], bytes);
                    bio_read_offset = 0;
                    this.bio_read_offset = 0;
                    this.socket_recv_len = @intCast(c_int, unread);
                    socket_recv_len = this.socket_recv_len;
                    bytes = this.recv_buffer.?.data[0..unread];
                }

                this.pending_reads += 1;
                this.scheduleSocketRead(@maximum(len__ - @truncate(u32, bytes.len), 1));
            }

            boring.BIO_set_retry_read(this_bio);
            return -1;
        }
        @memcpy(ptr, bytes.ptr, len);
        bio_read_offset += len;

        if (bio_read_offset == socket_recv_len_ and this.pending_reads == 0) {
            // The read buffer is empty.
            // we can reset the pointer back to the beginning of the buffer
            // if there is more data to read, we will ask for another
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
