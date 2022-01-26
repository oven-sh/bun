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

bio: *boring.BIO = undefined,
socket_fd: std.os.socket_t = 0,
allocator: std.mem.Allocator,

read_buf_len: usize = 0,

read_wait: Wait = Wait.pending,
send_wait: Wait = Wait.pending,
recv_completion: AsyncIO.Completion = undefined,
send_completion: AsyncIO.Completion = undefined,

write_buffer: ?*AsyncMessage = null,

last_send_result: AsyncIO.SendError!usize = 0,

last_read_result: AsyncIO.RecvError!usize = 0,
next: ?*AsyncBIO = null,
pending_frame: PendingFrame = PendingFrame.init(),

pub const PendingFrame = std.fifo.LinearFifo(anyframe, .{ .Static = 8 });

pub inline fn pushPendingFrame(this: *AsyncBIO, frame: anyframe) void {
    this.pending_frame.writeItem(frame) catch {};
}

pub inline fn popPendingFrame(this: *AsyncBIO) ?anyframe {
    return this.pending_frame.readItem();
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
    this.last_read_result = 0;
    this.send_wait = .pending;
    this.last_read_result = 0;
    this.pending_frame = PendingFrame.init();

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

const Sender = struct {
    pub fn onSend(this: *AsyncBIO, _: *Completion, result: AsyncIO.SendError!usize) void {
        this.last_send_result = result;
        this.send_wait = .completed;
        this.write_buffer.?.sent += @truncate(u32, result catch 0);

        if (extremely_verbose) {
            const read_result = result catch @as(usize, 999);
            Output.prettyErrorln("onSend: {d}", .{read_result});
            Output.flush();
        }

        if (this.pending_frame.readItem()) |frame| {
            resume frame;
        }
    }
};

pub fn enqueueSend(
    self: *AsyncBIO,
) void {
    if (self.write_buffer == null) return;
    var to_write = self.write_buffer.?.slice();
    if (to_write.len == 0) {
        return;
    }

    self.last_send_result = 0;

    AsyncIO.global.send(
        *AsyncBIO,
        self,
        Sender.onSend,
        &self.send_completion,
        self.socket_fd,
        to_write,
        SOCKET_FLAGS,
    );
    self.send_wait = .suspended;
    if (extremely_verbose) {
        Output.prettyErrorln("enqueueSend: {d}", .{to_write.len});
        Output.flush();
    }
}

const Reader = struct {
    pub fn onRead(this: *AsyncBIO, _: *Completion, result: AsyncIO.RecvError!usize) void {
        this.last_read_result = result;
        this.read_wait = .completed;
        if (extremely_verbose) {
            const read_result = result catch @as(usize, 999);
            Output.prettyErrorln("onRead: {d}", .{read_result});
            Output.flush();
        }
        if (this.pending_frame.readItem()) |frame| {
            resume frame;
        }
    }
};

pub fn enqueueRead(self: *AsyncBIO, read_buf: []u8, off: u64) void {
    var read_buffer = read_buf[off..];
    if (read_buffer.len == 0) {
        return;
    }

    self.last_read_result = 0;
    AsyncIO.global.recv(*AsyncBIO, self, Reader.onRead, &self.recv_completion, self.socket_fd, read_buffer);
    self.read_wait = .suspended;
    if (extremely_verbose) {
        Output.prettyErrorln("enqueuedRead: {d}", .{read_buf.len});
        Output.flush();
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
            this.release();
        }

        return 0;
    }
    pub fn write(this_bio: *boring.BIO, ptr: [*c]const u8, len: c_int) callconv(.C) c_int {
        std.debug.assert(@ptrToInt(ptr) > 0 and len >= 0);

        var buf = ptr[0..@intCast(usize, len)];
        boring.BIO_clear_flags(this_bio, boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY);

        if (len <= 0) {
            return 0;
        }

        var this = cast(this_bio);
        if (this.read_wait == .suspended) {
            boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));
            return -1;
        }

        switch (this.send_wait) {
            .pending => {
                var write_buffer = this.write_buffer orelse brk: {
                    this.write_buffer = AsyncMessage.get(getAllocator());
                    break :brk this.write_buffer.?;
                };

                _ = write_buffer.writeAll(buf);
                boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));

                return -1;
            },
            .suspended => {
                boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));

                return -1;
            },
            .completed => {
                this.send_wait = .pending;
                const written = this.last_send_result catch |err| {
                    Output.prettyErrorln("HTTPS error: {s}", .{@errorName(err)});
                    Output.flush();
                    boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));
                    return -1;
                };
                this.last_send_result = 0;
                return @intCast(c_int, written);
            },
        }

        unreachable;
    }

    pub fn read(this_bio: *boring.BIO, ptr: [*c]u8, len: c_int) callconv(.C) c_int {
        std.debug.assert(@ptrToInt(ptr) > 0 and len >= 0);
        var this = cast(this_bio);

        var buf = ptr[0..@maximum(@intCast(usize, len), this.read_buf_len)];

        boring.BIO_clear_flags(this_bio, boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY);

        switch (this.read_wait) {
            .pending => {
                this.enqueueRead(buf, 0);
                boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_WRITE | boring.BIO_FLAGS_SHOULD_RETRY));
                return -1;
            },
            .suspended => {
                boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_WRITE | boring.BIO_FLAGS_SHOULD_RETRY));
                return -1;
            },
            .completed => {
                this.read_wait = .pending;
                const read_len = this.last_read_result catch |err| {
                    Output.prettyErrorln("HTTPS error: {s}", .{@errorName(err)});
                    Output.flush();
                    boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_WRITE | boring.BIO_FLAGS_SHOULD_RETRY));
                    return -1;
                };
                this.last_read_result = 0;
                return @intCast(c_int, read_len);
            },
        }
        unreachable;
    }
    pub fn ctrl(_: *boring.BIO, cmd: c_int, _: c_long, _: ?*anyopaque) callconv(.C) c_long {
        return switch (cmd) {
            boring.BIO_CTRL_PENDING, boring.BIO_CTRL_WPENDING => 0,
            else => 1,
        };
    }
};
