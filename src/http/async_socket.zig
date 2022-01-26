const boring = @import("boringssl");
const std = @import("std");
const AsyncIO = @import("io");
const AsyncMessage = @import("./async_message.zig");
const AsyncBIO = @import("./async_bio.zig");
const Completion = AsyncIO.Completion;
const AsyncSocket = @This();

const Output = @import("../global.zig").Output;
const NetworkThread = @import("../network_thread.zig");
const Environment = @import("../global.zig").Environment;

const extremely_verbose = @import("../http_client_async.zig").extremely_verbose;
const SOCKET_FLAGS: u32 = @import("../http_client_async.zig").SOCKET_FLAGS;
const getAllocator = @import("../http_client_async.zig").getAllocator;
const OPEN_SOCKET_FLAGS: u32 = @import("../http_client_async.zig").OPEN_SOCKET_FLAGS;

io: *AsyncIO = undefined,
socket: std.os.socket_t = 0,
head: *AsyncMessage = undefined,
tail: *AsyncMessage = undefined,
allocator: std.mem.Allocator,
err: ?anyerror = null,
queued: usize = 0,
sent: usize = 0,
send_frame: @Frame(AsyncSocket.send) = undefined,
read_frame: @Frame(AsyncSocket.read) = undefined,
connect_frame: @Frame(AsyncSocket.connectToAddress) = undefined,
close_frame: @Frame(AsyncSocket.close) = undefined,

read_context: []u8 = undefined,
read_offset: u64 = 0,
read_completion: AsyncIO.Completion = undefined,
connect_completion: AsyncIO.Completion = undefined,
close_completion: AsyncIO.Completion = undefined,

const ConnectError = AsyncIO.ConnectError || std.os.SocketError || std.os.SetSockOptError || error{UnknownHostName};

pub fn init(io: *AsyncIO, socket: std.os.socket_t, allocator: std.mem.Allocator) !AsyncSocket {
    var head = AsyncMessage.get(allocator);

    return AsyncSocket{ .io = io, .socket = socket, .head = head, .tail = head, .allocator = allocator };
}

fn on_connect(this: *AsyncSocket, _: *Completion, err: ConnectError!void) void {
    err catch |resolved_err| {
        this.err = resolved_err;
    };

    resume this.connect_frame;
}

fn connectToAddress(this: *AsyncSocket, address: std.net.Address) ConnectError!void {
    const sockfd = AsyncIO.openSocket(address.any.family, OPEN_SOCKET_FLAGS | std.os.SOCK.STREAM, std.os.IPPROTO.TCP) catch |err| {
        if (extremely_verbose) {
            Output.prettyErrorln("openSocket error: {s}", .{@errorName(err)});
        }

        return error.ConnectionRefused;
    };

    this.io.connect(*AsyncSocket, this, on_connect, &this.connect_completion, sockfd, address);
    suspend {
        this.connect_frame = @frame().*;
    }

    if (this.err) |e| {
        return @errSetCast(ConnectError, e);
    }

    this.socket = sockfd;
    return;
}

fn on_close(this: *AsyncSocket, _: *Completion, _: AsyncIO.CloseError!void) void {
    resume this.close_frame;
}

pub fn close(this: *AsyncSocket) void {
    if (this.socket == 0) return;
    this.io.close(*AsyncSocket, this, on_close, &this.close_completion, this.socket);
    suspend {
        this.close_frame = @frame().*;
    }
    this.socket = 0;
}

pub fn connect(this: *AsyncSocket, name: []const u8, port: u16) ConnectError!void {
    this.socket = 0;
    outer: while (true) {
        // on macOS, getaddrinfo() is very slow
        // If you send ~200 network requests, about 1.5s is spent on getaddrinfo()
        // So, we cache this.
        var address_list = NetworkThread.getAddressList(getAllocator(), name, port) catch |err| {
            return @errSetCast(ConnectError, err);
        };

        const list = address_list.address_list;
        if (list.addrs.len == 0) return error.ConnectionRefused;

        try_cached_index: {
            if (address_list.index) |i| {
                const address = list.addrs[i];
                if (address_list.invalidated) continue :outer;

                this.connectToAddress(address) catch |err| {
                    if (err == error.ConnectionRefused) {
                        address_list.index = null;
                        break :try_cached_index;
                    }

                    address_list.invalidate();
                    continue :outer;
                };
            }
        }

        for (list.addrs) |address, i| {
            if (address_list.invalidated) continue :outer;
            this.connectToAddress(address) catch |err| {
                if (err == error.ConnectionRefused) continue;
                address_list.invalidate();
                if (err == error.AddressNotAvailable or err == error.UnknownHostName) continue :outer;
                return err;
            };
            address_list.index = @truncate(u32, i);
            return;
        }

        if (address_list.invalidated) continue :outer;

        address_list.invalidate();
        return error.ConnectionRefused;
    }
}

fn on_send(msg: *AsyncMessage, _: *Completion, result: SendError!usize) void {
    var this = @ptrCast(*AsyncSocket, @alignCast(@alignOf(*AsyncSocket), msg.context));
    const written = result catch |err| {
        this.err = err;
        resume this.send_frame;
        return;
    };

    if (written == 0) {
        resume this.send_frame;
        return;
    }

    msg.sent += @truncate(u16, written);
    const has_more = msg.used > msg.sent;
    this.sent += written;

    if (has_more) {
        this.io.send(
            *AsyncMessage,
            msg,
            on_send,
            &msg.completion,
            this.socket,
            msg.slice(),
            SOCKET_FLAGS,
        );
    } else {
        msg.release();
    }

    // complete
    if (this.queued <= this.sent) {
        resume this.send_frame;
    }
}

pub fn write(this: *AsyncSocket, buf: []const u8) usize {
    this.tail.context = this;

    const resp = this.tail.writeAll(buf);
    this.queued += resp.written;

    if (resp.overflow) {
        var next = AsyncMessage.get(getAllocator());
        this.tail.next = next;
        this.tail = next;

        return @as(usize, resp.written) + this.write(buf[resp.written..]);
    }

    return @as(usize, resp.written);
}

pub const SendError = AsyncIO.SendError;

pub fn deinit(this: *AsyncSocket) void {
    this.head.release();
}

pub fn send(this: *AsyncSocket) SendError!usize {
    const original_sent = this.sent;
    this.head.context = this;

    this.io.send(
        *AsyncMessage,
        this.head,
        on_send,
        &this.head.completion,
        this.socket,
        this.head.slice(),
        SOCKET_FLAGS,
    );

    var node = this.head;
    while (node.next) |element| {
        this.io.send(
            *AsyncMessage,
            element,
            on_send,
            &element.completion,
            this.socket,
            element.slice(),
            SOCKET_FLAGS,
        );
        node = element.next orelse break;
    }

    suspend {
        this.send_frame = @frame().*;
    }

    if (this.err) |err| {
        this.err = null;
        return @errSetCast(AsyncSocket.SendError, err);
    }

    return this.sent - original_sent;
}

pub const RecvError = AsyncIO.RecvError;

const Reader = struct {
    pub fn on_read(ctx: *AsyncSocket, _: *AsyncIO.Completion, result: RecvError!usize) void {
        const len = result catch |err| {
            ctx.err = err;
            resume ctx.read_frame;
            return;
        };
        ctx.read_offset += len;
        resume ctx.read_frame;
    }
};

pub fn read(
    this: *AsyncSocket,
    bytes: []u8,
    offset: u64,
) RecvError!u64 {
    this.read_context = bytes;
    this.read_offset = offset;
    const original_read_offset = this.read_offset;

    this.io.recv(
        *AsyncSocket,
        this,
        Reader.on_read,
        &this.read_completion,
        this.socket,
        bytes,
    );

    suspend {
        this.read_frame = @frame().*;
    }

    if (this.err) |err| {
        this.err = null;
        return @errSetCast(RecvError, err);
    }

    return this.read_offset - original_read_offset;
}

pub const SSL = struct {
    ssl: *boring.SSL = undefined,
    ssl_loaded: bool = false,
    socket: AsyncSocket,
    handshake_complete: bool = false,
    ssl_bio: ?*AsyncBIO = null,
    read_bio: ?*AsyncMessage = null,
    handshake_frame: @Frame(SSL.handshake) = undefined,
    send_frame: @Frame(SSL.send) = undefined,
    read_frame: @Frame(SSL.read) = undefined,
    hostname: [std.fs.MAX_PATH_BYTES]u8 = undefined,
    is_ssl: bool = false,

    const SSLConnectError = ConnectError || HandshakeError;
    const HandshakeError = error{OpenSSLError};

    pub fn connect(this: *SSL, name: []const u8, port: u16) !void {
        this.is_ssl = true;
        try this.socket.connect(name, port);

        this.handshake_complete = false;

        var ssl = boring.initClient();
        this.ssl = ssl;
        this.ssl_loaded = true;
        errdefer {
            this.ssl_loaded = false;
            this.ssl.deinit();
            this.ssl = undefined;
        }

        {
            std.mem.copy(u8, &this.hostname, name);
            this.hostname[name.len] = 0;
            var name_ = this.hostname[0..name.len :0];
            ssl.setHostname(name_);
        }

        var bio = try AsyncBIO.init(this.socket.allocator);
        bio.socket_fd = this.socket.socket;
        this.ssl_bio = bio;

        boring.SSL_set_bio(ssl, bio.bio, bio.bio);

        this.read_bio = AsyncMessage.get(this.socket.allocator);
        try this.handshake();
    }

    pub fn close(this: *SSL) void {
        this.socket.close();
    }

    fn handshake(this: *SSL) HandshakeError!void {
        while (!this.ssl.isInitFinished()) {
            boring.ERR_clear_error();
            this.ssl_bio.?.enqueueSend();
            const handshake_result = boring.SSL_connect(this.ssl);
            if (handshake_result == 0) {
                Output.prettyErrorln("ssl accept error", .{});
                Output.flush();
                return error.OpenSSLError;
            }
            this.handshake_complete = handshake_result == 1 and this.ssl.isInitFinished();

            if (!this.handshake_complete) {
                // accept_result < 0
                const e = boring.SSL_get_error(this.ssl, handshake_result);
                if ((e == boring.SSL_ERROR_WANT_READ or e == boring.SSL_ERROR_WANT_WRITE)) {
                    this.ssl_bio.?.enqueueSend();
                    suspend {
                        this.handshake_frame = @frame().*;
                        this.ssl_bio.?.pushPendingFrame(&this.handshake_frame);
                    }

                    continue;
                }

                Output.prettyErrorln("ssl accept error = {}, return val was {}", .{ e, handshake_result });
                Output.flush();
                return error.OpenSSLError;
            }
        }
    }

    pub fn write(this: *SSL, buffer_: []const u8) usize {
        var buffer = buffer_;
        var read_bio = this.read_bio;
        while (buffer.len > 0) {
            const response = read_bio.?.writeAll(buffer);
            buffer = buffer[response.written..];
            if (response.overflow) {
                read_bio = read_bio.?.next orelse brk: {
                    read_bio.?.next = AsyncMessage.get(this.socket.allocator);
                    break :brk read_bio.?.next.?;
                };
            }
        }

        return buffer_.len;
    }

    pub fn send(this: *SSL) !usize {
        var bio_ = this.read_bio;
        var len: usize = 0;
        while (bio_) |bio| {
            var slice = bio.slice();
            len += this.ssl.write(slice) catch |err| {
                switch (err) {
                    error.WantRead => {
                        suspend {
                            this.send_frame = @frame().*;
                            this.ssl_bio.?.pushPendingFrame(&this.send_frame);
                        }
                        continue;
                    },
                    error.WantWrite => {
                        this.ssl_bio.?.enqueueSend();

                        suspend {
                            this.send_frame = @frame().*;
                            this.ssl_bio.?.pushPendingFrame(&this.send_frame);
                        }
                        continue;
                    },
                    else => {},
                }

                if (comptime Environment.isDebug) {
                    Output.prettyErrorln("SSL error: {s} (buf: {s})\n URL:", .{
                        @errorName(err),
                        bio.slice(),
                    });
                    Output.flush();
                }

                return err;
            };

            bio_ = bio.next;
        }
        return len;
    }

    pub fn read(this: *SSL, buf_: []u8, offset: u64) !u64 {
        var buf = buf_[offset..];
        var len: usize = 0;
        while (buf.len > 0) {
            this.ssl_bio.?.read_buf_len = buf.len;
            len = this.ssl.read(buf) catch |err| {
                switch (err) {
                    error.WantWrite => {
                        this.ssl_bio.?.enqueueSend();

                        if (extremely_verbose) {
                            Output.prettyErrorln(
                                "error: {s}: \n Read Wait: {s}\n Send Wait: {s}",
                                .{
                                    @errorName(err),
                                    @tagName(this.ssl_bio.?.read_wait),
                                    @tagName(this.ssl_bio.?.send_wait),
                                },
                            );
                            Output.flush();
                        }

                        suspend {
                            this.read_frame = @frame().*;
                            this.ssl_bio.?.pushPendingFrame(&this.read_frame);
                        }
                        continue;
                    },
                    error.WantRead => {
                        // this.ssl_bio.enqueueSend();

                        if (extremely_verbose) {
                            Output.prettyErrorln(
                                "error: {s}: \n Read Wait: {s}\n Send Wait: {s}",
                                .{
                                    @errorName(err),
                                    @tagName(this.ssl_bio.?.read_wait),
                                    @tagName(this.ssl_bio.?.send_wait),
                                },
                            );
                            Output.flush();
                        }

                        suspend {
                            this.read_frame = @frame().*;
                            this.ssl_bio.?.pushPendingFrame(&this.read_frame);
                        }
                        continue;
                    },
                    else => return err,
                }
                unreachable;
            };

            break;
        }

        return len;
    }

    pub inline fn init(allocator: std.mem.Allocator, io: *AsyncIO) !SSL {
        return SSL{
            .socket = try AsyncSocket.init(io, 0, allocator),
        };
    }

    pub fn deinit(this: *SSL) void {
        this.socket.deinit();
        if (!this.is_ssl) return;

        if (this.ssl_bio) |bio| {
            _ = boring.BIO_set_data(bio.bio, null);
            bio.pending_frame = AsyncBIO.PendingFrame.init();
            bio.socket_fd = 0;
            bio.release();
            this.ssl_bio = null;
        }

        if (this.ssl_loaded) {
            this.ssl.deinit();
            this.ssl_loaded = false;
        }

        this.handshake_complete = false;

        if (this.read_bio) |bio| {
            var next_ = bio.next;
            while (next_) |next| {
                next.release();
                next_ = next.next;
            }

            bio.release();
            this.read_bio = null;
        }
    }
};
