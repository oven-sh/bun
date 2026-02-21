/// Pure SMTP connection: protocol state machine, socket I/O, authentication.
/// No JSC dependency. The owner provides callbacks for events.
const SMTPConnection = @This();

const debug = bun.Output.scoped(.smtp, .hidden);

pub const State = enum {
    disconnected,
    connecting,
    proxy_connect, // Waiting for HTTP CONNECT response from proxy
    greeting,
    ehlo,
    starttls,
    auth_login_user,
    auth_login_pass,
    auth_plain,
    auth_cram_md5,
    auth_xoauth2,
    ready,
    mail_from,
    rcpt_to,
    data_cmd,
    data_body,
    rset,
    quit,
    closed,
    failed,
};

pub const TLSMode = enum { none, starttls, direct };

/// Standard SMTP error codes (compatible with nodemailer).
pub const ErrorCode = enum {
    ECONNECTION,
    ETIMEDOUT,
    ESOCKET,
    EPROTOCOL,
    EENVELOPE,
    EMESSAGE,
    EAUTH,
    ETLS,
    ESTREAM,
    EUNKNOWN,
};

/// Callback interface for the connection owner.
pub const Callbacks = struct {
    /// Called when a send completes successfully. `response` is the final server response.
    on_send_complete: *const fn (ctx: *anyopaque, response: []const u8) void,
    /// Called when the connection enters ready state after EHLO+AUTH (for verify).
    on_ready: *const fn (ctx: *anyopaque) void,
    /// Called on any protocol or connection error. Includes error code for programmatic handling.
    on_error: *const fn (ctx: *anyopaque, message: []const u8, code: ErrorCode) void,
    /// Called when STARTTLS 220 is received; owner must call wrapTLS on the socket.
    on_starttls: *const fn (ctx: *anyopaque) void,
    /// Owner context pointer (the JSSMTPClient).
    ctx: *anyopaque,
};

// ---- Fields ----
state: State = .disconnected,
host: []const u8 = "",
port: u16 = 587,
tls_mode: TLSMode = .none,
local_hostname: []const u8 = "[127.0.0.1]",
auth_user: []const u8 = "",
auth_pass: []const u8 = "",
auth_method: []const u8 = "", // Force specific method: "PLAIN", "LOGIN", "CRAM-MD5", "XOAUTH2"
auth_xoauth2_token: []const u8 = "", // Pre-generated XOAUTH2 token
lmtp: bool = false, // Use LMTP protocol (LHLO instead of EHLO)
require_tls: bool = false,
ignore_tls: bool = false,
secure: bool = false,

// Proxy settings
proxy_host: []const u8 = "",
proxy_port: u16 = 0,
proxy_auth: []const u8 = "", // "user:pass" for Proxy-Authorization Basic

// REQUIRETLS (RFC 8689)
require_tls_extension: bool = false, // User wants REQUIRETLS in MAIL FROM

// Server capabilities (parsed from EHLO)
supports_starttls: bool = false,
supports_requiretls: bool = false, // Server advertises REQUIRETLS
supported_auth_plain: bool = false,
supported_auth_login: bool = false,
supported_auth_cram_md5: bool = false,
supported_auth_xoauth2: bool = false,
server_max_size: u64 = 0,

// Socket
socket: Socket = .{ .SocketTCP = .detached },
socket_ctx: ?*uws.SocketContext = null,

// Buffers
ehlo_lines: bun.MutableString = .{ .allocator = bun.default_allocator, .list = .{} },
read_buffer: bun.MutableString = .{ .allocator = bun.default_allocator, .list = .{} },
write_buffer: bun.OffsetByteList = .{},
has_backpressure: bool = false,

// Send state
envelope_from: []const u8 = "",
envelope_to: []const []const u8 = &.{},
message_data: []const u8 = "",
current_rcpt_index: usize = 0,
accepted_count: usize = 0,
rejected_count: usize = 0,
// Dynamic arrays tracking accepted/rejected recipient indices
accepted_indices: std.ArrayListUnmanaged(u16) = .{},
rejected_indices: std.ArrayListUnmanaged(u16) = .{},
pending_send: bool = false,

callbacks: Callbacks,

// ========== Public API ==========

/// Start a new send operation. Caller must have already set envelope_from, envelope_to, message_data.
pub fn startSend(this: *SMTPConnection) void {
    this.current_rcpt_index = 0;
    this.accepted_count = 0;
    this.rejected_count = 0;
    this.accepted_indices.clearRetainingCapacity();
    this.rejected_indices.clearRetainingCapacity();

    if (this.state == .ready) {
        this.doStartSending();
    } else {
        this.pending_send = true;
    }
}

/// Reset connection capabilities for a fresh connection.
pub fn resetCapabilities(this: *SMTPConnection) void {
    this.supports_starttls = false;
    this.supports_requiretls = false;
    this.supported_auth_plain = false;
    this.supported_auth_login = false;
    this.supported_auth_cram_md5 = false;
    this.supported_auth_xoauth2 = false;
    this.server_max_size = 0;
    this.state = .disconnected;
}

/// Close the connection gracefully.
pub fn closeSocket(this: *SMTPConnection) void {
    if (this.state == .closed) return;
    if ((this.state == .ready or this.state == .rset) and !this.socket.isClosed()) {
        this.writeAll("QUIT\r\n");
    }
    this.state = .closed;
    if (!this.socket.isClosed()) this.socket.close();
    this.socket = .{ .SocketTCP = .detached };
}

pub fn isVerifyMode(this: *const SMTPConnection) bool {
    return this.envelope_from.len == 0 and this.message_data.len == 0;
}

// ========== Socket Handler (compile-time generic for TCP/TLS) ==========

pub fn SocketHandler(comptime ssl: bool, comptime Owner: type) type {
    return struct {
        const SocketType = uws.NewSocketHandler(ssl);

        fn _socket(s: SocketType) Socket {
            if (comptime ssl) return Socket{ .SocketTLS = s };
            return Socket{ .SocketTCP = s };
        }

        pub fn onOpen(owner: *Owner, s: SocketType) void {
            const conn = owner.connection();
            debug("onOpen: {s}:{d}", .{ conn.host, conn.port });
            conn.socket = _socket(s);
            if (conn.proxy_host.len > 0 and conn.state == .connecting) {
                // Connected to proxy - send HTTP CONNECT
                conn.sendProxyConnect();
            } else {
                conn.state = .greeting;
            }
            owner.onSocketOpen();
        }

        fn onHandshake_(owner: *Owner, _: anytype, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            _ = ssl_error;
            const conn = owner.connection();
            if (success != 1) {
                conn.onErrorWithCode("TLS handshake failed", .ETLS);
                return;
            }
            conn.secure = true;
            if (conn.state == .starttls) {
                conn.state = .ehlo;
                conn.writeCmd("EHLO {s}\r\n", .{conn.local_hostname});
            }
        }

        pub const onHandshake = if (ssl) onHandshake_ else null;

        pub fn onClose(owner: *Owner, _: SocketType, _: i32, _: ?*anyopaque) void {
            const conn = owner.connection();
            conn.socket = .{ .SocketTCP = .detached };
            if (conn.state != .closed and conn.state != .failed) conn.onErrorWithCode("Connection closed unexpectedly", .ECONNECTION);
            owner.onSocketClose();
        }

        pub fn onEnd(owner: *Owner, _: SocketType) void {
            const conn = owner.connection();
            if (conn.state != .closed and conn.state != .failed and conn.state != .quit) {
                conn.socket = .{ .SocketTCP = .detached };
                conn.onErrorWithCode("Connection closed unexpectedly", .ECONNECTION);
                owner.onSocketClose();
            }
        }

        pub fn onConnectError(owner: *Owner, _: SocketType, _: i32) void {
            const conn = owner.connection();
            conn.socket = .{ .SocketTCP = .detached };
            conn.onErrorWithCode("Failed to connect to SMTP server", .ECONNECTION);
            owner.onSocketClose();
        }

        pub fn onTimeout(owner: *Owner, _: SocketType) void {
            owner.connection().onErrorWithCode("Socket timeout", .ETIMEDOUT);
        }

        pub fn onWritable(owner: *Owner, _: SocketType) void {
            owner.connection().flushWriteBuffer();
        }
        pub fn onLongTimeout(_: *Owner, _: SocketType) void {}

        pub fn onData(owner: *Owner, _: SocketType, data: []const u8) void {
            owner.onSocketData(data);
        }
    };
}

// ========== Data Processing ==========

pub fn processIncomingData(this: *SMTPConnection, data: []const u8) void {
    this.read_buffer.appendSlice(data) catch return;

    // Handle HTTP CONNECT proxy response (not SMTP protocol)
    if (this.state == .proxy_connect) {
        this.handleProxyResponse();
        if (this.state == .proxy_connect) return; // Still waiting for full response
        if (this.state == .failed) return;
        // Fall through to process any remaining SMTP data in the buffer
    }

    while (true) {
        const buf = this.read_buffer.slice();
        const nl = std.mem.indexOf(u8, buf, "\r\n") orelse return;
        const line = buf[0..nl];
        if (line.len >= 4 and line[3] == '-') {
            this.ehlo_lines.appendSlice(line) catch {};
            this.ehlo_lines.appendSlice("\n") catch {};
            this.consumeReadBuffer(nl + 2);
            continue;
        }
        this.ehlo_lines.appendSlice(line) catch {};
        const full = this.ehlo_lines.slice();
        this.handleResponse(full);
        this.ehlo_lines.list.clearRetainingCapacity();
        this.consumeReadBuffer(nl + 2);
    }
}

fn consumeReadBuffer(this: *SMTPConnection, bytes: usize) void {
    const buf = this.read_buffer.slice();
    if (bytes >= buf.len) {
        this.read_buffer.list.clearRetainingCapacity();
        return;
    }
    const rem = buf[bytes..];
    std.mem.copyForwards(u8, this.read_buffer.list.items[0..rem.len], rem);
    this.read_buffer.list.items.len = rem.len;
}

// ========== Protocol Response Dispatch ==========

fn handleResponse(this: *SMTPConnection, resp: []const u8) void {
    if (resp.len < 3) {
        this.onError("Invalid response");
        return;
    }
    const code = std.fmt.parseInt(u16, resp[0..3], 10) catch {
        this.onError("Invalid response code");
        return;
    };
    debug("SMTP {d} state={s}", .{ code, @tagName(this.state) });

    switch (this.state) {
        .greeting => this.handleGreeting(code),
        .ehlo => this.handleEhlo(code, resp),
        .starttls => this.handleStartTLS(code),
        .auth_plain => this.handleAuthResult(code),
        .auth_login_user => this.handleAuthLoginUser(code),
        .auth_login_pass => this.handleAuthLoginPass(code),
        .auth_cram_md5 => this.handleAuthCramMD5(code, resp),
        .auth_xoauth2 => this.handleAuthResult(code),
        .mail_from => this.handleMailFrom(code),
        .rcpt_to => this.handleRcptTo(code),
        .data_cmd => {
            if (code != 354 and code != 250) this.onError("DATA command rejected") else {
                this.state = .data_body;
                this.sendMessageData();
            }
        },
        .data_body => this.handleDataBody(code, resp),
        .rset => {
            this.state = .ready;
            if (this.pending_send) {
                this.pending_send = false;
                this.doStartSending();
            }
        },
        .quit => {
            this.state = .closed;
            if (!this.socket.isClosed()) this.socket.close();
            this.socket = .{ .SocketTCP = .detached };
        },
        else => {},
    }
}

// ========== State Handlers ==========

fn handleGreeting(this: *SMTPConnection, code: u16) void {
    if (code != 220) {
        this.onError("Invalid greeting from server");
        return;
    }
    this.state = .ehlo;
    if (this.lmtp) {
        this.writeCmd("LHLO {s}\r\n", .{this.local_hostname});
        return;
    }
    this.writeCmd("EHLO {s}\r\n", .{this.local_hostname});
}

fn handleEhlo(this: *SMTPConnection, code: u16, response: []const u8) void {
    if (code == 421) {
        this.onError("Server terminating connection");
        return;
    }
    if (code != 250) {
        if (this.require_tls) {
            this.onError("EHLO failed but STARTTLS is required");
            return;
        }
        this.writeCmd("HELO {s}\r\n", .{this.local_hostname});
        return;
    }
    this.parseEhloExtensions(response);

    // STARTTLS negotiation
    if (!this.secure and !this.ignore_tls and this.tls_mode != .direct) {
        if (this.supports_starttls) {
            this.state = .starttls;
            this.writeAll("STARTTLS\r\n");
            return;
        } else if (this.require_tls) {
            this.onError("Server does not support STARTTLS but requireTLS is set");
            return;
        }
    }

    this.proceedAfterEhlo();
}

fn handleStartTLS(this: *SMTPConnection, code: u16) void {
    if (code != 220) {
        this.onError("STARTTLS rejected by server");
        return;
    }
    // Ask the owner to perform the TLS upgrade. The owner must call wrapTLS
    // on the socket. Once the TLS handshake completes, onHandshake will
    // transition to ehlo state and re-send EHLO.
    this.callbacks.on_starttls(this.callbacks.ctx);
}

fn handleAuthResult(this: *SMTPConnection, code: u16) void {
    if (code == 235) {
        if (this.isVerifyMode()) {
            this.callbacks.on_ready(this.callbacks.ctx);
            this.state = .quit;
            this.writeAll("QUIT\r\n");
        } else {
            this.doStartSending();
        }
        return;
    }
    this.onErrorWithCode("Authentication failed", .EAUTH);
}

fn handleAuthLoginUser(this: *SMTPConnection, code: u16) void {
    if (code != 334) {
        this.onError("AUTH LOGIN failed");
        return;
    }
    // Server sent "334 VXNlcm5hbWU6" (Username:), send base64(username)
    var buf: [1024]u8 = undefined;
    const len = bun.base64.encode(&buf, this.auth_user);
    this.state = .auth_login_pass;
    this.writeAll(buf[0..len]);
    this.writeAll("\r\n");
}

fn handleAuthLoginPass(this: *SMTPConnection, code: u16) void {
    if (code == 334) {
        // Server sent "334 UGFzc3dvcmQ6" (Password:), send base64(password)
        var buf: [1024]u8 = undefined;
        const len = bun.base64.encode(&buf, this.auth_pass);
        this.writeAll(buf[0..len]);
        this.writeAll("\r\n");
        return;
    }
    if (code == 235) {
        if (this.isVerifyMode()) {
            this.callbacks.on_ready(this.callbacks.ctx);
            this.state = .quit;
            this.writeAll("QUIT\r\n");
        } else {
            this.doStartSending();
        }
        return;
    }
    this.onErrorWithCode("Authentication failed", .EAUTH);
}

fn handleMailFrom(this: *SMTPConnection, code: u16) void {
    if (code != 250) {
        this.onErrorWithCode("MAIL FROM rejected by server", .EENVELOPE);
        return;
    }
    this.current_rcpt_index = 0;
    this.sendNextRcptTo();
}

fn handleRcptTo(this: *SMTPConnection, code: u16) void {
    if (code == 250 or code == 251) {
        this.accepted_indices.append(bun.default_allocator, @intCast(this.current_rcpt_index)) catch {};
        this.accepted_count += 1;
    } else {
        this.rejected_indices.append(bun.default_allocator, @intCast(this.current_rcpt_index)) catch {};
        this.rejected_count += 1;
    }
    this.current_rcpt_index += 1;
    if (this.current_rcpt_index < this.envelope_to.len) {
        this.sendNextRcptTo();
    } else {
        if (this.accepted_count == 0) {
            this.onErrorWithCode("All recipients were rejected", .EENVELOPE);
            return;
        }
        this.state = .data_cmd;
        this.writeAll("DATA\r\n");
    }
}

fn handleDataBody(this: *SMTPConnection, code: u16, line: []const u8) void {
    if (code != 250) {
        this.onErrorWithCode("Message rejected by server", .EMESSAGE);
        return;
    }
    // Set state and send RSET BEFORE the callback, so that pool queue
    // processing in the callback sees state == .rset (not .data_body).
    this.state = .rset;
    this.writeAll("RSET\r\n");
    this.callbacks.on_send_complete(this.callbacks.ctx, line);
}

// ========== Proxy Support ==========

/// Send the HTTP CONNECT request to the proxy server.
pub fn sendProxyConnect(this: *SMTPConnection) void {
    this.state = .proxy_connect;
    const alloc = bun.default_allocator;
    // HTTP CONNECT request - use writeAll directly (not writeCmd which sanitizes CRLF)
    const header = std.fmt.allocPrint(alloc, "CONNECT {s}:{d} HTTP/1.1\r\nHost: {s}:{d}\r\n", .{ this.host, this.port, this.host, this.port }) catch return;
    defer alloc.free(header);
    this.writeAll(header);
    if (this.proxy_auth.len > 0) {
        const b64_buf = alloc.alloc(u8, bun.base64.encodeLenFromSize(this.proxy_auth.len)) catch return;
        defer alloc.free(b64_buf);
        const b64_len = bun.base64.encode(b64_buf, this.proxy_auth);
        const auth_line = std.fmt.allocPrint(alloc, "Proxy-Authorization: Basic {s}\r\n", .{b64_buf[0..b64_len]}) catch return;
        defer alloc.free(auth_line);
        this.writeAll(auth_line);
    }
    this.writeAll("\r\n");
}

/// Handle the HTTP response from a CONNECT proxy. Looks for \r\n\r\n terminator
/// and checks that the status is 2xx.
fn handleProxyResponse(this: *SMTPConnection) void {
    const buf = this.read_buffer.slice();
    // Look for the end of HTTP headers
    const header_end = std.mem.indexOf(u8, buf, "\r\n\r\n") orelse return; // Need more data

    // Extract first line to check status code: "HTTP/1.x 200 ..."
    const first_line_end = std.mem.indexOf(u8, buf[0..header_end], "\r\n") orelse header_end;
    const first_line = buf[0..first_line_end];

    // Parse status code - find first space, then read 3 digits
    var ok = false;
    if (std.mem.indexOf(u8, first_line, " ")) |space_idx| {
        if (space_idx + 1 < first_line.len and first_line[space_idx + 1] == '2') {
            ok = true; // 2xx response
        }
    }

    if (!ok) {
        this.onErrorWithCode("Proxy CONNECT failed", .ECONNECTION);
        return;
    }

    // Consume the HTTP response headers from the buffer, leave any SMTP data
    this.consumeReadBuffer(header_end + 4);

    // Proxy tunnel established. For direct TLS, the owner needs to upgrade.
    // For non-TLS, transition to greeting state (server greeting will arrive).
    if (this.tls_mode == .direct) {
        // Owner must upgrade to TLS, then we'll get the greeting via onHandshake/onOpen
        this.callbacks.on_starttls(this.callbacks.ctx);
    }
    this.state = .greeting;
}

// ========== Protocol Helpers ==========

fn proceedAfterEhlo(this: *SMTPConnection) void {
    if (this.auth_user.len > 0) {
        this.startAuth();
    } else if (this.isVerifyMode()) {
        this.callbacks.on_ready(this.callbacks.ctx);
        this.state = .quit;
        this.writeAll("QUIT\r\n");
    } else {
        this.doStartSending();
    }
}

fn parseEhloExtensions(this: *SMTPConnection, r: []const u8) void {
    if (std.ascii.indexOfIgnoreCase(r, "STARTTLS") != null) this.supports_starttls = true;
    if (std.ascii.indexOfIgnoreCase(r, "REQUIRETLS") != null) this.supports_requiretls = true;
    if (std.ascii.indexOfIgnoreCase(r, "AUTH") != null) {
        if (std.ascii.indexOfIgnoreCase(r, "PLAIN") != null) this.supported_auth_plain = true;
        if (std.ascii.indexOfIgnoreCase(r, "LOGIN") != null) this.supported_auth_login = true;
        if (std.ascii.indexOfIgnoreCase(r, "CRAM-MD5") != null) this.supported_auth_cram_md5 = true;
        if (std.ascii.indexOfIgnoreCase(r, "XOAUTH2") != null) this.supported_auth_xoauth2 = true;
    }
    if (std.ascii.indexOfIgnoreCase(r, "SIZE")) |pos| {
        var i = pos + 4;
        while (i < r.len and (r[i] == ' ' or r[i] == '\t')) : (i += 1) {}
        var end = i;
        while (end < r.len and r[end] >= '0' and r[end] <= '9') : (end += 1) {}
        if (end > i) this.server_max_size = std.fmt.parseInt(u64, r[i..end], 10) catch 0;
    }
}

fn startAuth(this: *SMTPConnection) void {
    // XOAUTH2: if token provided or method forced
    if (this.auth_xoauth2_token.len > 0 or (this.auth_method.len >= 7 and std.ascii.eqlIgnoreCase(this.auth_method, "XOAUTH2"))) {
        this.state = .auth_xoauth2;
        if (this.auth_xoauth2_token.len > 0) {
            // Pre-built token
            this.writeCmd("AUTH XOAUTH2 {s}\r\n", .{this.auth_xoauth2_token});
        } else if (this.auth_user.len > 0 and this.auth_pass.len > 0) {
            // Build XOAUTH2 token: base64("user=" + user + "\x01auth=Bearer " + token + "\x01\x01")
            var token_buf: [2048]u8 = undefined;
            const token_data = std.fmt.bufPrint(&token_buf, "user={s}\x01auth=Bearer {s}\x01\x01", .{ this.auth_user, this.auth_pass }) catch {
                this.onErrorWithCode("XOAUTH2 token too long", .EAUTH);
                return;
            };
            var b64_buf: [4096]u8 = undefined;
            const b64_len = bun.base64.encode(&b64_buf, token_data);
            this.writeCmd("AUTH XOAUTH2 {s}\r\n", .{b64_buf[0..b64_len]});
        }
        return;
    }

    // Determine method: explicit > best available
    const use_cram = (this.auth_method.len >= 8 and std.ascii.eqlIgnoreCase(this.auth_method, "CRAM-MD5")) or
        (this.auth_method.len == 0 and this.supported_auth_cram_md5 and !this.supported_auth_plain);
    const use_login = (this.auth_method.len >= 5 and std.ascii.eqlIgnoreCase(this.auth_method, "LOGIN")) or
        (this.auth_method.len == 0 and !this.supported_auth_plain and this.supported_auth_login and !use_cram);

    if (use_cram) {
        this.state = .auth_cram_md5;
        this.writeAll("AUTH CRAM-MD5\r\n");
    } else if (use_login) {
        this.state = .auth_login_user;
        this.writeAll("AUTH LOGIN\r\n");
    } else {
        // AUTH PLAIN (default)
        this.state = .auth_plain;
        var plain: [1024]u8 = undefined;
        var p: usize = 0;
        plain[p] = 0;
        p += 1;
        @memcpy(plain[p .. p + this.auth_user.len], this.auth_user);
        p += this.auth_user.len;
        plain[p] = 0;
        p += 1;
        @memcpy(plain[p .. p + this.auth_pass.len], this.auth_pass);
        p += this.auth_pass.len;
        var b64: [2048]u8 = undefined;
        const len = bun.base64.encode(&b64, plain[0..p]);
        this.writeCmd("AUTH PLAIN {s}\r\n", .{b64[0..len]});
    }
}

fn handleAuthCramMD5(this: *SMTPConnection, code: u16, resp: []const u8) void {
    if (code != 334) {
        this.onError("AUTH CRAM-MD5 failed");
        return;
    }
    // Server sent "334 <base64 challenge>"
    // Extract challenge after "334 "
    const challenge_b64 = if (resp.len > 4) resp[4..] else "";
    // Decode challenge from base64
    var challenge_buf: [512]u8 = undefined;
    const decode_result = bun.base64.decode(&challenge_buf, challenge_b64);
    if (!decode_result.isSuccessful()) {
        this.onError("Invalid CRAM-MD5 challenge");
        return;
    }
    const challenge = challenge_buf[0..decode_result.count];

    // HMAC-MD5(password, challenge)
    const c = bun.BoringSSL.c;
    const hmac_ctx = c.HMAC_CTX_new() orelse {
        this.onError("Failed to create HMAC context");
        return;
    };
    defer c.HMAC_CTX_free(hmac_ctx);

    if (c.HMAC_Init_ex(hmac_ctx, this.auth_pass.ptr, this.auth_pass.len, c.EVP_md5(), null) != 1) {
        this.onError("HMAC init failed");
        return;
    }
    _ = c.HMAC_Update(hmac_ctx, challenge.ptr, challenge.len);
    var hmac_result: [16]u8 = undefined; // MD5 = 16 bytes
    var hmac_len: c_uint = 16;
    _ = c.HMAC_Final(hmac_ctx, &hmac_result, &hmac_len);

    // Build response: "username hex-digest"
    var response_buf: [512]u8 = undefined;
    const hex = std.fmt.bytesToHex(hmac_result, .lower);
    const response = std.fmt.bufPrint(&response_buf, "{s} {s}", .{ this.auth_user, hex }) catch {
        this.onError("CRAM-MD5 response too long");
        return;
    };

    // Base64 encode and send
    var b64_buf: [1024]u8 = undefined;
    const b64_len = bun.base64.encode(&b64_buf, response);
    this.state = .auth_plain; // Reuse auth_plain state for the final 235 response
    this.writeAll(b64_buf[0..b64_len]);
    this.writeAll("\r\n");
}

fn doStartSending(this: *SMTPConnection) void {
    if (this.envelope_from.len == 0) return;
    if (this.server_max_size > 0 and this.message_data.len > this.server_max_size) {
        this.onErrorWithCode("Message size exceeds server limit", .EMESSAGE);
        return;
    }
    // REQUIRETLS (RFC 8689): error if requested but not supported
    if (this.require_tls_extension and !this.supports_requiretls) {
        this.onErrorWithCode("Server does not support REQUIRETLS extension", .EENVELOPE);
        return;
    }
    this.state = .mail_from;
    const requiretls_param: []const u8 = if (this.require_tls_extension and this.supports_requiretls) " REQUIRETLS" else "";
    if (this.server_max_size > 0) {
        this.writeCmd("MAIL FROM:<{s}> SIZE={d}{s}\r\n", .{ this.envelope_from, this.message_data.len, requiretls_param });
    } else if (requiretls_param.len > 0) {
        this.writeCmd("MAIL FROM:<{s}>{s}\r\n", .{ this.envelope_from, requiretls_param });
    } else {
        this.writeCmd("MAIL FROM:<{s}>\r\n", .{this.envelope_from});
    }
}

fn sendNextRcptTo(this: *SMTPConnection) void {
    if (this.current_rcpt_index >= this.envelope_to.len) return;
    this.state = .rcpt_to;
    this.writeCmd("RCPT TO:<{s}>\r\n", .{this.envelope_to[this.current_rcpt_index]});
}

fn sendMessageData(this: *SMTPConnection) void {
    const data = this.message_data;
    var i: usize = 0;
    var ls: usize = 0;
    // RFC 5321 4.5.2: dot-stuff lines starting with "." after CRLF
    if (data.len > 0 and data[0] == '.') this.writeAll(".");
    while (i < data.len) : (i += 1) {
        if (data[i] == '\r' and i + 1 < data.len and data[i + 1] == '\n' and i + 2 < data.len and data[i + 2] == '.') {
            // Write through the \r\n, then add extra dot
            this.writeAll(data[ls .. i + 2]);
            this.writeAll(".");
            ls = i + 2;
        }
    }
    if (ls < data.len) this.writeAll(data[ls..]);
    // Ensure message ends with CRLF before the terminating dot
    if (data.len < 2 or data[data.len - 2] != '\r' or data[data.len - 1] != '\n') this.writeAll("\r\n");
    this.writeAll(".\r\n");
}

/// Buffered write: appends to write_buffer, then flushes what the socket can accept.
pub fn writeAll(this: *SMTPConnection, data: []const u8) void {
    if (this.has_backpressure) {
        // Socket is full, just buffer
        this.write_buffer.write(bun.default_allocator, data) catch return;
        return;
    }
    // Try direct write first
    if (this.write_buffer.len() == 0) {
        const wrote = this.socket.write(data);
        if (wrote < 0) return; // socket error
        const written: usize = @intCast(wrote);
        if (written < data.len) {
            // Partial write - buffer remainder
            this.has_backpressure = true;
            this.write_buffer.write(bun.default_allocator, data[written..]) catch return;
        }
        return;
    }
    // Have pending data, append to buffer
    this.write_buffer.write(bun.default_allocator, data) catch return;
    this.flushWriteBuffer();
}

/// Flush pending write buffer to socket. Called from onWritable.
pub fn flushWriteBuffer(this: *SMTPConnection) void {
    const chunk = this.write_buffer.remaining();
    if (chunk.len == 0) {
        this.has_backpressure = false;
        return;
    }
    const wrote = this.socket.write(chunk);
    if (wrote > 0) {
        this.write_buffer.consume(@intCast(wrote));
    }
    this.has_backpressure = this.write_buffer.len() > 0;
}

pub fn writeCmd(this: *SMTPConnection, comptime fmt: []const u8, args: anytype) void {
    const cmd = std.fmt.allocPrint(bun.default_allocator, fmt, args) catch return;
    defer bun.default_allocator.free(cmd);
    // Security: sanitize embedded CRLF in user-controlled values.
    // The only legitimate \r\n should be the trailing command terminator.
    // Strip any \r or \n that appear before the final \r\n.
    if (cmd.len >= 2 and cmd[cmd.len - 2] == '\r' and cmd[cmd.len - 1] == '\n') {
        const sanitized = bun.default_allocator.alloc(u8, cmd.len) catch {
            this.writeAll(cmd);
            return;
        };
        defer bun.default_allocator.free(sanitized);
        var j: usize = 0;
        for (cmd[0 .. cmd.len - 2]) |c| {
            if (c != '\r' and c != '\n') {
                sanitized[j] = c;
                j += 1;
            }
        }
        sanitized[j] = '\r';
        sanitized[j + 1] = '\n';
        this.writeAll(sanitized[0 .. j + 2]);
    } else {
        this.writeAll(cmd);
    }
}

fn onError(this: *SMTPConnection, message: []const u8) void {
    this.onErrorWithCode(message, .EPROTOCOL);
}

pub fn onErrorWithCode(this: *SMTPConnection, message: []const u8, code: ErrorCode) void {
    if (this.state == .closed or this.state == .failed) return;
    this.state = .failed;
    this.callbacks.on_error(this.callbacks.ctx, message, code);
}

// ========== Cleanup ==========

pub fn deinit(this: *SMTPConnection) void {
    this.ehlo_lines.deinit();
    this.read_buffer.deinit();
    this.write_buffer.deinit(bun.default_allocator);
}

const bun = @import("bun");
const std = @import("std");

const uws = bun.uws;
const Socket = uws.AnySocket;
