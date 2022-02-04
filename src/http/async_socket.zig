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

const SSLFeatureFlags = struct {
    pub const early_data_enabled = true;
};

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
    this.err = null;
    this.queued = 0;
    this.sent = 0;
    this.read_context = &[_]u8{};
    this.read_offset = 0;
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

pub inline fn bufferedReadAmount(_: *AsyncSocket) usize {
    return 0;
}

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

pub fn Yield(comptime Type: anytype) type {
    return struct {
        frame: @Frame(Type) = undefined,
        wait: bool = false,

        pub fn set(this: *@This(), frame: anytype) void {
            this.wait = true;
            this.frame = frame.*;
        }

        pub fn maybeResume(this: *@This()) void {
            if (!this.wait) return;
            this.wait = false;
            resume this.frame;
        }
    };
}

pub const SSL = struct {
    ssl: *boring.SSL = undefined,
    ssl_loaded: bool = false,
    socket: AsyncSocket,
    handshake_complete: bool = false,
    ssl_bio: AsyncBIO = undefined,
    ssl_bio_loaded: bool = false,
    unencrypted_bytes_to_send: ?*AsyncMessage = null,
    connect_frame: Yield(SSL.handshake) = Yield(SSL.handshake){},
    send_frame: Yield(SSL.send) = Yield(SSL.send){},
    read_frame: Yield(SSL.read) = Yield(SSL.read){},

    hostname: [std.fs.MAX_PATH_BYTES]u8 = undefined,
    is_ssl: bool = false,

    handshake_state: HandshakeState = HandshakeState.none,
    next_handshake_state: HandshakeState = HandshakeState.none,
    first_posthandshake_write: bool = true,
    in_confirm_handshake: bool = false,
    completed_connect: bool = false,
    disconnected: bool = false,

    pending_write_buffer: []const u8 = &[_]u8{},
    pending_read_buffer: []u8 = &[_]u8{},
    pending_read_result: anyerror!u32 = 0,
    pending_write_result: anyerror!u32 = 0,

    handshake_retry_count: u16 = 5,

    first_post_handshake_write: bool = true,

    handshake_result: ?anyerror = null,

    peek_complete: bool = false,

    pub const HandshakeState = enum {
        none,
        handshake,
        complete,
    };

    const SSLConnectError = ConnectError || HandshakeError;
    const HandshakeError = error{ ClientCertNeeded, OpenSSLError, WouldBlock };

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

        // SNI should only contain valid DNS hostnames, not IP addresses (see RFC
        // 6066, Section 3).
        //
        // See https://crbug.com/496472 and https://crbug.com/496468 for discussion.
        {
            std.mem.copy(u8, &this.hostname, name);
            this.hostname[name.len] = 0;
            var name_ = this.hostname[0..name.len :0];
            ssl.setHostname(name_);
        }

        try this.ssl_bio.init();
        this.ssl_bio_loaded = true;

        this.ssl_bio.onReady = AsyncBIO.Callback.Wrap(SSL, SSL.retryAll).get(this);
        this.ssl_bio.socket_fd = this.socket.socket;

        boring.SSL_set_bio(ssl, this.ssl_bio.bio.?, this.ssl_bio.bio.?);

        // boring.SSL_set_early_data_enabled(ssl, 1);
        _ = boring.SSL_clear_options(ssl, boring.SSL_OP_NO_COMPRESSION | boring.SSL_OP_LEGACY_SERVER_CONNECT);
        _ = boring.SSL_set_options(ssl, boring.SSL_OP_NO_COMPRESSION | boring.SSL_OP_LEGACY_SERVER_CONNECT);
        const mode = boring.SSL_MODE_CBC_RECORD_SPLITTING | boring.SSL_MODE_ENABLE_FALSE_START;

        _ = boring.SSL_set_mode(ssl, mode);
        _ = boring.SSL_clear_mode(ssl, mode);

        var alpns = &[_]u8{ 8, 'h', 't', 't', 'p', '/', '1', '.', '1' };
        std.debug.assert(boring.SSL_set_alpn_protos(this.ssl, alpns, alpns.len) == 0);

        boring.SSL_enable_signed_cert_timestamps(ssl);
        boring.SSL_enable_ocsp_stapling(ssl);

        // std.debug.assert(boring.SSL_set_strict_cipher_list(ssl, boring.SSL_DEFAULT_CIPHER_LIST) == 0);

        boring.SSL_set_enable_ech_grease(ssl, 1);

        // Configure BoringSSL to allow renegotiations. Once the initial handshake
        // completes, if renegotiations are not allowed, the default reject value will
        // be restored. This is done in this order to permit a BoringSSL
        // optimization. See https://crbug.com/boringssl/123. Use
        // ssl_renegotiate_explicit rather than ssl_renegotiate_freely so DoPeek()
        // does not trigger renegotiations.
        boring.SSL_set_renegotiate_mode(ssl, boring.ssl_renegotiate_explicit);

        boring.SSL_set_shed_handshake_config(ssl, 1);

        this.unencrypted_bytes_to_send = this.socket.head;

        try this.handshake();

        this.completed_connect = true;
    }

    pub fn close(this: *SSL) void {
        this.socket.close();
    }

    pub fn handshake(this: *SSL) HandshakeError!void {
        this.next_handshake_state = .handshake;
        this.handshake_result = null;
        this.doHandshakeLoop() catch |err| {
            if (err == error.WouldBlock) {
                suspend {
                    this.connect_frame.set(@frame());
                }
            } else {
                return err;
            }
        };

        if (this.handshake_result) |handshake_err| {
            const err2 = @errSetCast(HandshakeError, handshake_err);
            this.handshake_result = null;
            return err2;
        }
    }

    fn retryAll(this: *SSL) void {
        const had_handshaked = this.completed_connect;
        // SSL_do_handshake, SSL_read, and SSL_write may all be retried when blocked,
        // so retry all operations for simplicity. (Otherwise, SSL_get_error for each
        // operation may be remembered to retry only the blocked ones.)
        if (this.next_handshake_state == .handshake) {
            this.onHandshakeIOComplete() catch {};
        }

        this.doPeek();
        if (!had_handshaked or !this.peek_complete) return;

        if (this.pending_read_buffer.len > 0) {
            reader: {
                var count: u32 = this.pending_read_result catch unreachable;
                this.pending_read_result = this.doPayloadRead(this.pending_read_buffer, &count) catch |err| brk: {
                    this.pending_read_result = count;

                    if (err == error.WouldBlock) {

                        // // partial reads are a success case
                        // // allow the client to ask for more
                        // if (count > 0) {
                        //     this.read_frame.maybeResume();
                        //     break :reader;
                        // }

                        break :reader;
                    }
                    break :brk err;
                };

                this.read_frame.maybeResume();
            }
        }

        if (this.pending_write_buffer.len > 0) {
            writer: {
                this.pending_write_result = this.doPayloadWrite() catch |err| brk: {
                    if (err == error.WantWrite or err == error.WantRead) break :writer;
                    break :brk err;
                };

                this.send_frame.maybeResume();
            }
        }
    }

    pub fn doPayloadWrite(this: *SSL) anyerror!u32 {
        const rv = try this.ssl.write(this.pending_write_buffer);

        if (rv >= 0) {
            this.pending_write_buffer = this.pending_write_buffer[rv..];
        }

        return rv;
    }

    pub fn doPayloadRead(this: *SSL, buffer: []u8, count: *u32) anyerror!u32 {
        if (this.ssl_bio.socket_recv_error != null) {
            const pending = this.ssl_bio.socket_recv_error.?;
            this.ssl_bio.socket_recv_error = null;
            return pending;
        }

        var total_bytes_read: u32 = count.*;
        var ssl_ret: c_int = 0;
        var ssl_err: c_int = 0;
        const buf_len = @truncate(u32, buffer.len);
        while (true) {
            boring.ERR_clear_error();
            ssl_ret = boring.SSL_read(this.ssl, buffer.ptr + total_bytes_read, @intCast(c_int, buf_len - total_bytes_read));
            ssl_err = boring.SSL_get_error(this.ssl, ssl_ret);

            if (ssl_ret > 0) {
                total_bytes_read += @intCast(u32, ssl_ret);
            } else if (ssl_err == boring.SSL_ERROR_WANT_RENEGOTIATE) {
                if (boring.SSL_renegotiate(this.ssl) == 0) {
                    ssl_err = boring.SSL_ERROR_SSL;
                }
            }

            // Continue processing records as long as there is more data available
            // synchronously.
            if (!(ssl_err == boring.SSL_ERROR_WANT_RENEGOTIATE or (total_bytes_read < buf_len and ssl_ret > 0 and this.ssl_bio.hasPendingReadData()))) break;
        }

        // Although only the final SSL_read call may have failed, the failure needs to
        // processed immediately, while the information still available in OpenSSL's
        // error queue.
        var result: anyerror!u32 = total_bytes_read;
        count.* = total_bytes_read;

        if (ssl_ret <= 0) {
            switch (ssl_err) {
                boring.SSL_ERROR_ZERO_RETURN => {},
                boring.SSL_ERROR_WANT_X509_LOOKUP => {
                    result = error.SSLErrorWantX509Lookup;
                },
                boring.SSL_ERROR_WANT_PRIVATE_KEY_OPERATION => {
                    result = error.SSLErrorWantPrivateKeyOperation;
                },

                // Do not treat insufficient data as an error to return in the next call to
                // DoPayloadRead() - instead, let the call fall through to check SSL_read()
                // again. The transport may have data available by then.
                boring.SSL_ERROR_WANT_READ, boring.SSL_ERROR_WANT_WRITE => {
                    result = error.WouldBlock;
                },
                else => {
                    if (extremely_verbose) {
                        const err = boring.ERR_get_error();

                        const version = std.mem.span(boring.SSL_get_version(this.ssl));
                        var hostname = std.mem.span(std.mem.sliceTo(&this.hostname, 0));
                        Output.prettyErrorln("[{s}] OpenSSLError reading (version: {s}, total read: {d}) - code: {d}", .{ hostname, version, total_bytes_read, err });
                    }
                    result = error.OpenSSLError;
                },
            }
        }

        // Many servers do not reliably send a close_notify alert when shutting down
        // a connection, and instead terminate the TCP connection. This is reported
        // as ERR_CONNECTION_CLOSED. Because of this, map the unclean shutdown to a
        // graceful EOF, instead of treating it as an error as it should be.
        if (this.ssl_bio.socket_recv_error) |err| {
            this.ssl_bio.socket_recv_error = null;
            return err;
        }

        return result;
    }

    fn doHandshakeLoop(
        this: *SSL,
    ) HandshakeError!void {
        while (true) {
            var state = this.next_handshake_state;
            this.next_handshake_state = HandshakeState.none;
            switch (state) {
                .handshake => {
                    this.doHandshake() catch |err| {
                        if (err != error.WouldBlock) {
                            this.handshake_result = err;
                        }
                        return err;
                    };
                },
                .complete => {
                    this.doHandshakeComplete();
                },
                else => unreachable,
            }
            if (this.next_handshake_state == .none) return;
        }
    }

    fn onHandshakeIOComplete(this: *SSL) HandshakeError!void {
        this.doHandshakeLoop() catch |err| {
            if (err == error.WouldBlock) {
                return;
            }
            this.in_confirm_handshake = false;
            this.connect_frame.maybeResume();
            return;
        };
        this.connect_frame.maybeResume();
    }

    fn doHandshakeComplete(this: *SSL) void {
        if (this.in_confirm_handshake) {
            this.next_handshake_state = .none;
            return;
        }

        this.completed_connect = true;
        this.next_handshake_state = .none;
        this.doPeek();
        if (extremely_verbose) {
            const version = std.mem.span(boring.SSL_get_version(this.ssl));
            var hostname = std.mem.span(std.mem.sliceTo(&this.hostname, 0));
            Output.prettyErrorln("[{s}] Handshake complete.\n[{s}] TLS Version: {s}", .{
                hostname,
                hostname,
                version,
            });
        }
    }

    fn doPeek(this: *SSL) void {
        if (!this.completed_connect) {
            return;
        }

        if (this.peek_complete) {
            return;
        }

        var byte: u8 = 0;
        boring.ERR_clear_error();
        var rv = boring.SSL_peek(this.ssl, &byte, 1);
        var ssl_error = boring.SSL_get_error(this.ssl, rv);
        switch (ssl_error) {
            boring.SSL_ERROR_WANT_READ, boring.SSL_ERROR_WANT_WRITE => {},
            else => {
                this.peek_complete = true;
            },
        }
    }

    fn doHandshake(this: *SSL) HandshakeError!void {
        boring.ERR_clear_error();

        const rv = boring.SSL_do_handshake(this.ssl);
        if (rv <= 0) {
            const ssl_error = boring.SSL_get_error(this.ssl, rv);

            switch (ssl_error) {
                boring.SSL_ERROR_WANT_PRIVATE_KEY_OPERATION, boring.SSL_ERROR_WANT_X509_LOOKUP => {
                    this.next_handshake_state = HandshakeState.handshake;
                    return error.ClientCertNeeded;
                },
                boring.SSL_ERROR_WANT_CERTIFICATE_VERIFY => {
                    this.next_handshake_state = HandshakeState.handshake;
                    return error.ClientCertNeeded;
                },
                boring.SSL_ERROR_WANT_READ, boring.SSL_ERROR_WANT_WRITE => {
                    this.next_handshake_state = HandshakeState.handshake;
                    return error.WouldBlock;
                },
                boring.SSL_ERROR_SYSCALL => {
                    this.handshake_retry_count -|= 1;
                    if (this.handshake_retry_count > 0) {
                        this.next_handshake_state = HandshakeState.handshake;
                        return error.WouldBlock;
                    }

                    return error.OpenSSLError;
                },
                else => {
                    if (extremely_verbose) {
                        const err = boring.ERR_get_error();
                        var error_buf: [1024]u8 = undefined;
                        @memset(&error_buf, 0, 1024);
                        var err_msg = std.mem.span(boring.ERR_error_string(err, &error_buf));
                        Output.prettyErrorln("Handshaking error {s}", .{err_msg});
                    }
                    return error.OpenSSLError;
                },
            }
        }

        this.next_handshake_state = HandshakeState.complete;
    }

    pub fn write(this: *SSL, buffer_: []const u8) usize {
        return this.unencrypted_bytes_to_send.?.writeAll(buffer_).written;
    }

    pub fn bufferedReadAmount(this: *SSL) usize {
        const pend = boring.SSL_pending(this.ssl);
        return if (pend <= 0)
            0
        else
            @intCast(usize, pend);
    }

    pub fn send(this: *SSL) anyerror!usize {
        this.unencrypted_bytes_to_send.?.sent = 0;
        this.pending_write_buffer = this.unencrypted_bytes_to_send.?.buf[this.unencrypted_bytes_to_send.?.sent..this.unencrypted_bytes_to_send.?.used];
        while (true) {
            const sent = this.doPayloadWrite() catch |err| {
                if (err == error.WantRead or err == error.WantWrite) {
                    if (err == error.WantWrite) {
                        if (this.first_post_handshake_write and boring.SSL_is_init_finished(this.ssl) != 0 and this.pending_write_buffer.len == 0) {
                            this.first_post_handshake_write = false;

                            if (boring.SSL_version(this.ssl) == boring.TLS1_3_VERSION) {
                                std.debug.assert(boring.SSL_key_update(this.ssl, boring.SSL_KEY_UPDATE_REQUESTED) == 0);
                                continue;
                            }
                        }
                    }

                    this.pending_write_result = 0;
                    suspend {
                        this.send_frame.set(@frame());
                    }
                    const result = this.pending_write_result;
                    this.pending_write_result = 0;
                    this.unencrypted_bytes_to_send.?.used = 0;
                    if (result) |res| {
                        return res;
                    } else |er| {
                        return er;
                    }
                }
                if (extremely_verbose) {
                    Output.prettyErrorln("SSL error: {s}", .{@errorName(err)});
                    Output.flush();
                }
                return err;
            };
            this.unencrypted_bytes_to_send.?.sent += sent;

            if (this.unencrypted_bytes_to_send.?.sent == this.unencrypted_bytes_to_send.?.used) {
                this.unencrypted_bytes_to_send.?.used = 0;
                this.unencrypted_bytes_to_send.?.sent = 0;
            }

            return sent;
        }
    }

    pub fn read(this: *SSL, buf_: []u8, offset: u64) !u32 {
        var buf = buf_[offset..];
        var read_bytes: u32 = 0;
        this.pending_read_result = 0;

        return this.doPayloadRead(buf, &read_bytes) catch |err| {
            if (err == error.WouldBlock) {
                this.pending_read_result = (this.pending_read_result catch unreachable) + read_bytes;
                this.pending_read_buffer = buf;

                suspend {
                    this.read_frame.set(@frame());
                }
                const result = this.pending_read_result;
                this.pending_read_result = 0;

                return result;
            }
            return err;
        };
    }

    pub inline fn init(allocator: std.mem.Allocator, io: *AsyncIO) !SSL {
        return SSL{
            .ssl_bio = AsyncBIO{
                .allocator = allocator,
            },
            .socket = try AsyncSocket.init(io, 0, allocator),
        };
    }

    pub fn deinit(this: *SSL) void {
        this.socket.deinit();

        if (this.ssl_loaded) {
            _ = boring.SSL_shutdown(this.ssl);
            this.ssl.deinit();
            this.ssl_loaded = false;
        }

        if (this.ssl_bio_loaded) {
            this.ssl_bio_loaded = false;
            if (this.ssl_bio.recv_buffer) |recv| {
                recv.release();
                this.ssl_bio.recv_buffer = null;
            }

            if (this.ssl_bio.send_buffer) |recv| {
                recv.release();
                this.ssl_bio.send_buffer = null;
            }

            this.ssl_bio.pending_reads = 0;
            this.ssl_bio.pending_sends = 0;
            this.ssl_bio.socket_recv_len = 0;
            this.ssl_bio.socket_send_len = 0;
            this.ssl_bio.bio_write_offset = 0;
            this.ssl_bio.bio_read_offset = 0;
            this.ssl_bio.socket_send_error = null;
            this.ssl_bio.socket_recv_error = null;

            this.ssl_bio.socket_fd = 0;
            this.ssl_bio.onReady = null;
        }

        this.handshake_complete = false;

        this.* = SSL{
            .socket = this.socket,
        };
    }
};
