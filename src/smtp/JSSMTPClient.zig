/// JavaScript bindings for SMTPClient. Bridges JSC promises/values to the
/// pure SMTP connection in smtp_connection.zig.
const JSSMTPClient = @This();

pub const js = jsc.Codegen.JSSMTPClient;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;
pub const new = bun.TrivialNew(@This());

// ---- Fields ----
ref_count: RefCount,
globalObject: *jsc.JSGlobalObject,
this_value: jsc.JSRef = jsc.JSRef.empty(),
poll_ref: bun.Async.KeepAlive = .{},
conn: SMTPConnection,

// Message data owned by JS wrapper (freed between sends)
envelope_from_buf: []const u8 = "",
envelope_to_buf: [][]const u8 = &.{},
message_data_buf: []const u8 = "",

// Persistent connection config strings
connection_strings: []u8,
message_id_hostname: []const u8 = "bun",

// Build options
disable_file_access: bool = false,
keep_bcc: bool = false,
sendmail_path: []const u8 = "", // if non-empty, use sendmail transport instead of SMTP
auto_close: bool = false, // if true, close connection after first send (used by Bun.email())

// Pool options
pool: bool = false,
max_messages: u32 = 100,
messages_sent: u32 = 0,
rate_limit: u32 = 0, // max messages per rateDelta ms (0 = unlimited)
rate_delta: u32 = 1000, // time window in ms for rate limiting

// Pool: FIFO queue of pending sends (JS array of [msg, promise] pairs)
pool_queue: jsc.Strong.Optional = .empty,

// Rate limiting: track send timestamps
rate_window_start: i64 = 0, // ms timestamp of current rate window start
rate_window_count: u32 = 0, // sends in current window

// Timeouts
connection_timeout_ms: u32 = 120_000,
socket_timeout_ms: u32 = 600_000,
timer: bun.api.Timer.EventLoopTimer = .{ .tag = .SMTPConnectionTimeout, .next = .epoch },

allocator: std.mem.Allocator,

/// Get the underlying connection (used by SocketHandler).
pub fn connection(this: *JSSMTPClient) *SMTPConnection {
    return &this.conn;
}

// ========== Socket event handlers (called by SMTPConnection.SocketHandler) ==========

pub fn onSocketOpen(this: *JSSMTPClient) void {
    this.resetConnectionTimeout();
    this.updatePollRef();
}

pub fn onSocketClose(this: *JSSMTPClient) void {
    this.updatePollRef();
}

pub fn onSocketData(this: *JSSMTPClient, data: []const u8) void {
    this.ref();
    defer this.deref();
    defer this.resetConnectionTimeout();
    const vm = this.globalObject.bunVM();
    if (vm.isShuttingDown()) return;
    const event_loop = vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();
    this.conn.processIncomingData(data);
}

// ========== SMTPConnection callbacks ==========

fn onSendComplete(ctx: *anyopaque, response: []const u8) void {
    const this: *JSSMTPClient = @ptrCast(@alignCast(ctx));
    this.resolveSendPromise(response);
    this.messages_sent += 1;
    if (this.auto_close) {
        this.conn.closeSocket();
        this.updatePollRef();
        return;
    }
    // Pool: process queued send if any
    this.processQueue();
}

fn processQueue(this: *JSSMTPClient) void {
    const queue = this.pool_queue.get() orelse return;
    const go = this.globalObject;

    // Rate limiting: if rate_limit > 0, check if we can send now
    if (this.rate_limit > 0) {
        const now = bun.timespec.now(.allow_mocked_time).ms();
        if (now - this.rate_window_start >= this.rate_delta) {
            // New window
            this.rate_window_start = now;
            this.rate_window_count = 0;
        }
        if (this.rate_window_count >= this.rate_limit) {
            // Rate limit reached - schedule retry after remaining window time
            const remaining = this.rate_delta - @as(u32, @intCast(@min(this.rate_delta, now - this.rate_window_start)));
            const vm = go.bunVM();
            if (this.timer.state == .ACTIVE) vm.timer.remove(&this.timer);
            this.timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(remaining + 1));
            vm.timer.insert(&this.timer);
            return;
        }
        this.rate_window_count += 1;
    }

    // shift() to get the next [msg, promise] pair
    const shift_fn = (queue.getPropertyValue(go, "shift") catch return) orelse return;
    const pair = shift_fn.call(go, queue, &.{}) catch return;
    if (pair == .js_undefined or pair == .zero) return;

    const msg_val = pair.getIndex(go, 0) catch return;
    const promise_val = pair.getIndex(go, 1) catch return;

    // Set the promise on the client so resolveSendPromise finds it
    if (this.this_value.tryGet()) |this_js| {
        js.sendPromiseSetCached(this_js, go, promise_val);
    }

    // Build and send the queued message
    this.processQueuedSend(msg_val) catch {
        if (promise_val.asPromise()) |p| {
            p.reject(go, go.createErrorInstance("Failed to process queued send", .{})) catch {};
        }
    };
}

fn processQueuedSend(this: *JSSMTPClient, msg: jsc.JSValue) !void {
    const globalObject = this.globalObject;

    var reuse = this.conn.state == .ready or this.conn.state == .rset;

    // Pool: if maxMessages reached, force a new connection
    if (reuse and this.messages_sent >= this.max_messages) {
        this.conn.closeSocket();
        this.conn.state = .disconnected;
        this.messages_sent = 0;
        reuse = false;
    }

    // Parse envelope
    const envelope_override = try msg.getTruthy(globalObject, "envelope");
    const env_src = if (envelope_override != null and envelope_override.?.isObject()) envelope_override.? else msg;

    if (try env_src.getTruthy(globalObject, "from")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(this.allocator);
        defer u.deinit();
        this.freeEnvelopeFrom();
        const parsed = try address_parser.parse(this.allocator, u.slice());
        defer this.allocator.free(parsed);
        const raw_email = if (parsed.len > 0) extractAddrFromParsed(parsed[0]) else null;
        const email = raw_email orelse mime.extractEmail(u.slice());
        if (!isCleanEmail(email)) return;
        this.envelope_from_buf = try this.allocator.dupe(u8, email);
        this.conn.envelope_from = this.envelope_from_buf;
    } else return;

    var sfb = std.heap.stackFallback(@sizeOf([]const u8) * 32, this.allocator);
    const sfb_alloc = sfb.get();
    var to_list = std.ArrayListUnmanaged([]const u8){};
    defer to_list.deinit(sfb_alloc);
    try this.collectRecipients(globalObject, env_src, "to", sfb_alloc, &to_list);
    if (envelope_override == null) {
        try this.collectRecipients(globalObject, msg, "cc", sfb_alloc, &to_list);
        try this.collectRecipients(globalObject, msg, "bcc", sfb_alloc, &to_list);
    }
    if (to_list.items.len == 0) return;

    this.freeEnvelopeTo();
    const to_slice = try this.allocator.alloc([]const u8, to_list.items.len);
    @memcpy(to_slice, to_list.items);
    this.envelope_to_buf = @ptrCast(to_slice);
    this.conn.envelope_to = @ptrCast(to_slice);

    this.freeMessageData();
    if (try msg.getTruthy(globalObject, "raw")) |raw_val| {
        if (raw_val.isString()) {
            const s = try raw_val.toBunString(globalObject);
            defer s.deref();
            const u = s.toUTF8WithoutRef(this.allocator);
            defer u.deinit();
            this.message_data_buf = try this.allocator.dupe(u8, u.slice());
        }
    } else {
        this.message_data_buf = try mime.buildMessageWithOptions(this.allocator, globalObject, msg, .{
            .message_id_hostname = this.message_id_hostname,
            .keep_bcc = this.keep_bcc,
            .disable_file_access = this.disable_file_access,
        });
    }

    if (try msg.getTruthy(globalObject, "dkim")) |dkim_obj| {
        if (dkim_obj.isObject()) try this.applyDkim(globalObject, dkim_obj);
    }

    this.conn.message_data = this.message_data_buf;
    this.conn.current_rcpt_index = 0;
    this.conn.accepted_count = 0;
    this.conn.rejected_count = 0;

    if (reuse) {
        this.conn.startSend();
    } else {
        this.conn.resetCapabilities();
        this.ref();
        this.doConnect() catch {
            this.deref();
        };
    }
}

fn onReady(ctx: *anyopaque) void {
    const this: *JSSMTPClient = @ptrCast(@alignCast(ctx));
    // Verify mode: resolve with boolean true and unref poll
    const go = this.globalObject;
    const this_js = this.this_value.tryGet() orelse return;
    if (js.sendPromiseGetCached(this_js)) |pv| {
        js.sendPromiseSetCached(this_js, go, .zero);
        if (pv.asPromise()) |p| {
            p.resolve(go, jsc.JSValue.true) catch {};
        }
    }
    this.updatePollRef();
}

fn onError(ctx: *anyopaque, message: []const u8, code: SMTPConnection.ErrorCode) void {
    const this: *JSSMTPClient = @ptrCast(@alignCast(ctx));
    this.failWithError(message, code);
    // Pool: don't process queue on error - the queued send would also fail
    // since the connection is broken. Let it timeout or reject naturally.
}

fn onStartTLS(ctx: *anyopaque) void {
    const this: *JSSMTPClient = @ptrCast(@alignCast(ctx));
    // Upgrade the TCP socket to TLS using us_socket_upgrade_to_tls.
    // After TLS handshake completes, onHandshake_ in SocketHandler
    // will see state == .starttls and re-send EHLO.
    switch (this.conn.socket) {
        .SocketTCP => |tcp| {
            const vm = this.globalObject.bunVM();
            var err: uws.create_bun_socket_error_t = .none;
            const ssl_ctx = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*JSSMTPClient), .{}, &err) orelse {
                this.conn.onErrorWithCode("Failed to create TLS context for STARTTLS", .ETLS);
                return;
            };
            const Handler = SMTPConnection.SocketHandler;
            uws.NewSocketHandler(true).configure(ssl_ctx, true, *JSSMTPClient, Handler(true, JSSMTPClient));
            // Upgrade raw socket to TLS (like MySQL's upgradeToTLS)
            const raw_socket = tcp.socket.connected;
            const new_socket = raw_socket.upgrade(ssl_ctx, null) orelse {
                this.conn.onErrorWithCode("STARTTLS upgrade failed", .ETLS);
                return;
            };
            this.conn.socket_ctx = ssl_ctx;
            this.conn.socket = .{ .SocketTLS = .{ .socket = .{ .connected = new_socket } } };
        },
        .SocketTLS => {
            this.conn.onErrorWithCode("STARTTLS on already-secure connection", .ETLS);
        },
    }
}

const conn_callbacks = SMTPConnection.Callbacks{
    .on_send_complete = onSendComplete,
    .on_ready = onReady,
    .on_error = onError,
    .on_starttls = onStartTLS,
    .ctx = undefined, // set in constructor
};

// ========== Bun.email() one-shot helper ==========

/// Bun.email(options) — one-shot email send.
/// Creates a transient SMTPClient with auto_close=true, sends one message,
/// and automatically closes the connection when done.
pub fn jsEmail(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isObject())
        return globalObject.throwInvalidArguments("Bun.email() requires an options object", .{});

    const client = try constructFromOpts(globalObject, args[0]);
    client.auto_close = true;

    // Wrap in a JSC object with a strong ref so GC doesn't collect
    // the transient client before the async send completes.
    const client_js = client.toJS(globalObject);
    client.this_value = jsc.JSRef.initStrong(client_js, globalObject);

    return client.send(globalObject, callframe);
}

// ========== Static Methods ==========

pub fn jsCreateTestAccount(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    // Use fetch() to POST to Ethereal.email API. Build the entire async
    // chain in one call: fetch().then(r => r.json()).then(d => validate(d)).
    const fetch_fn = (try globalObject.toJSValue().getPropertyValue(globalObject, "fetch")) orelse
        return globalObject.throw("fetch is not available", .{});

    const url_str = (bun.String.static("https://api.nodemailer.com/user")).toJS(globalObject) catch
        return globalObject.throw("internal error", .{});
    const opts = jsc.JSValue.createEmptyObject(globalObject, 3);
    opts.put(globalObject, bun.String.static("method"), (bun.String.static("POST")).toJS(globalObject) catch .js_undefined);
    const hdrs = jsc.JSValue.createEmptyObject(globalObject, 1);
    hdrs.put(globalObject, bun.String.static("Content-Type"), (bun.String.static("application/json")).toJS(globalObject) catch .js_undefined);
    opts.put(globalObject, bun.String.static("headers"), hdrs);
    opts.put(globalObject, bun.String.static("body"), (bun.String.static(
        \\{"requestor":"bun","version":"1.0"}
    )).toJS(globalObject) catch .js_undefined);

    // fetch(url, opts) returns a Response promise
    const fetch_promise = try fetch_fn.call(globalObject, globalObject.toJSValue(), &.{ url_str, opts });

    // Chain: .then(r => r.json())
    const then1 = (try fetch_promise.getPropertyValue(globalObject, "then")) orelse return fetch_promise;
    const json_fn = jsc.JSFunction.create(globalObject, bun.String.static(""), createTestAccountJsonStep, 1, .{});
    const json_promise = try then1.call(globalObject, fetch_promise, &.{json_fn});

    // Chain: .then(d => validate)
    const then2 = (try json_promise.getPropertyValue(globalObject, "then")) orelse return json_promise;
    const validate_fn = jsc.JSFunction.create(globalObject, bun.String.static(""), createTestAccountValidateStep, 1, .{});
    return then2.call(globalObject, json_promise, &.{validate_fn});
}

fn createTestAccountJsonStep(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1) return .js_undefined;
    const response = args[0];
    const json_method = (try response.getPropertyValue(globalObject, "json")) orelse return .js_undefined;
    return json_method.call(globalObject, response, &.{});
}

fn createTestAccountValidateStep(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1) return .js_undefined;
    const data = args[0];
    if (try data.getPropertyValue(globalObject, "status")) |status| {
        if (status.isString()) {
            const s = try status.toBunString(globalObject);
            defer s.deref();
            if (!bun.strings.eqlComptime(s.byteSlice(), "success")) {
                return globalObject.throw("Failed to create test account", .{});
            }
        }
    }
    return data;
}

pub fn jsParseAddress(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isString()) return .js_undefined;

    // Check for { flatten: true } option
    var flatten = false;
    if (args.len >= 2 and args[1].isObject()) {
        if (try args[1].getTruthy(globalObject, "flatten")) |v| {
            flatten = v.toBoolean();
        }
    }

    const alloc = bun.default_allocator;
    const s = try args[0].toBunString(globalObject);
    defer s.deref();
    const utf8 = s.toUTF8WithoutRef(alloc);
    defer utf8.deinit();

    const parsed = address_parser.parse(alloc, utf8.slice()) catch return .js_undefined;
    defer alloc.free(parsed);

    if (flatten) {
        // Flatten: walk all results and extract individual addresses from groups
        // First pass: count total addresses
        var total: usize = 0;
        for (parsed) |item| {
            switch (item) {
                .address => total += 1,
                .group => |grp| total += grp.members.len,
            }
        }
        const result = try jsc.JSValue.createEmptyArray(globalObject, total);
        var idx: u32 = 0;
        for (parsed) |item| {
            switch (item) {
                .address => |addr| {
                    try result.putIndex(globalObject, idx, try makeAddrObj(globalObject, addr));
                    idx += 1;
                },
                .group => |grp| {
                    for (grp.members) |m| {
                        try result.putIndex(globalObject, idx, try makeAddrObj(globalObject, m));
                        idx += 1;
                    }
                },
            }
        }
        return result;
    }

    // Non-flatten: return structured array with groups
    const result = try jsc.JSValue.createEmptyArray(globalObject, parsed.len);
    for (parsed, 0..) |item, i| {
        switch (item) {
            .address => |addr| {
                try result.putIndex(globalObject, @intCast(i), try makeAddrObj(globalObject, addr));
            },
            .group => |grp| {
                const obj = jsc.JSValue.createEmptyObject(globalObject, 2);
                const name_str = bun.String.createFormat("{s}", .{grp.name}) catch bun.String.empty;
                obj.put(globalObject, bun.String.static("name"), name_str.toJS(globalObject) catch .js_undefined);
                const members = try jsc.JSValue.createEmptyArray(globalObject, grp.members.len);
                for (grp.members, 0..) |m, j| {
                    try members.putIndex(globalObject, @intCast(j), try makeAddrObj(globalObject, m));
                }
                obj.put(globalObject, bun.String.static("group"), members);
                try result.putIndex(globalObject, @intCast(i), obj);
            },
        }
    }

    return result;
}

fn makeAddrObj(globalObject: *jsc.JSGlobalObject, addr: address_parser.Address) !jsc.JSValue {
    const obj = jsc.JSValue.createEmptyObject(globalObject, 2);
    const name_str = bun.String.createFormat("{s}", .{addr.name}) catch bun.String.empty;
    obj.put(globalObject, bun.String.static("name"), name_str.toJS(globalObject) catch .js_undefined);
    const addr_str = bun.String.createFormat("{s}", .{addr.address}) catch bun.String.empty;
    obj.put(globalObject, bun.String.static("address"), addr_str.toJS(globalObject) catch .js_undefined);
    return obj;
}

// ========== Constructor ==========

pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, js_this: jsc.JSValue) bun.JSError!*JSSMTPClient {
    const args = callframe.arguments();
    if (args.len < 1) return globalObject.throwInvalidArguments("SMTPClient requires an options object or URL string", .{});
    const client = try constructFromOpts(globalObject, args[0]);
    client.this_value = jsc.JSRef.initWeak(js_this);
    return client;
}

fn constructFromOpts(globalObject: *jsc.JSGlobalObject, arg0: jsc.JSValue) bun.JSError!*JSSMTPClient {

    // Support string argument as URL: new SMTPClient("smtp://user:pass@host:port")
    var opts: jsc.JSValue = undefined;
    var url_str: ?[]const u8 = null;
    var url_buf_owned: ?[]u8 = null;

    const alloc = bun.default_allocator;

    if (arg0.isString()) {
        const s = try arg0.toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        url_buf_owned = try alloc.dupe(u8, utf8.slice());
        url_str = url_buf_owned.?;
        // Create empty options object for the rest of parsing
        opts = jsc.JSValue.createEmptyObject(globalObject, 0);
    } else if (arg0.isObject()) {
        opts = arg0;
        // Check for url property
        if (try opts.getTruthy(globalObject, "url")) |v| {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            url_buf_owned = try alloc.dupe(u8, utf8.slice());
            url_str = url_buf_owned.?;
        }
    } else {
        return globalObject.throwInvalidArguments("SMTPClient requires an options object or URL string", .{});
    }
    defer if (url_buf_owned) |b| alloc.free(b);

    var host_str: []const u8 = "localhost";
    var port: u16 = 587;
    var secure: bool = false;
    var auth_user: []const u8 = "";
    var auth_pass: []const u8 = "";
    var local_hostname: []const u8 = "[127.0.0.1]";
    var require_tls: bool = false;
    var ignore_tls: bool = false;
    var conn_timeout: u32 = 120_000;
    var mid_hostname: []const u8 = "bun";

    // Parse URL using Bun's URL parser
    if (url_str) |url_raw| {
        // Ensure protocol prefix so the URL parser works
        const needs_prefix = !bun.strings.contains(url_raw, "://");
        const url_to_parse = if (needs_prefix) brk: {
            var buf: [2048]u8 = undefined;
            const s = std.fmt.bufPrint(&buf, "smtp://{s}", .{url_raw}) catch break :brk url_raw;
            break :brk s;
        } else url_raw;

        if (URL.fromUTF8(alloc, url_to_parse)) |url| {
            if (bun.strings.hasPrefixComptime(url.protocol, "smtps")) secure = true;
            if (url.hostname.len > 0) host_str = url.hostname;
            if (url.port.len > 0) port = std.fmt.parseInt(u16, url.port, 10) catch 587;
            if (url.username.len > 0) auth_user = url.username;
            if (url.password.len > 0) auth_pass = url.password;
        } else |_| {}
    }

    // Well-known service lookup
    if (try opts.getTruthy(globalObject, "service")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        if (well_known.lookup(utf8.slice())) |svc| {
            host_str = svc.host;
            port = svc.port;
            secure = svc.secure;
        }
    }

    // Explicit overrides
    if (try opts.getTruthy(globalObject, "host")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(alloc);
        defer u.deinit();
        host_str = u.slice();
    }
    if (try opts.getTruthy(globalObject, "port")) |v| {
        const p = v.toInt32();
        if (p < 1 or p > 65535) return globalObject.throwInvalidArguments("Port must be between 1 and 65535", .{});
        port = @intCast(p);
    }
    if (try opts.getTruthy(globalObject, "secure")) |v| secure = v.toBoolean();
    if (try opts.getTruthy(globalObject, "requireTLS")) |v| require_tls = v.toBoolean();
    if (try opts.getTruthy(globalObject, "ignoreTLS")) |v| ignore_tls = v.toBoolean();
    var require_tls_extension: bool = false;
    if (try opts.getTruthy(globalObject, "requireTLSExtension")) |v| require_tls_extension = v.toBoolean();
    if (port == 465) secure = true;
    if (try opts.getTruthy(globalObject, "name")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(alloc);
        defer u.deinit();
        local_hostname = u.slice();
    }
    var sock_timeout: u32 = 600_000;
    if (try opts.getTruthy(globalObject, "connectionTimeout")) |v| conn_timeout = @intCast(@max(0, v.toInt32()));
    if (try opts.getTruthy(globalObject, "socketTimeout")) |v| sock_timeout = @intCast(@max(0, v.toInt32()));
    if (try opts.getTruthy(globalObject, "hostname")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(alloc);
        defer u.deinit();
        mid_hostname = u.slice();
    }
    var auth_method: []const u8 = "";
    var auth_xoauth2_token: []const u8 = "";
    var disable_file_access: bool = false;
    var keep_bcc: bool = false;

    if (try opts.getTruthy(globalObject, "auth")) |ao| {
        if (ao.isObject()) {
            if (try ao.getTruthy(globalObject, "user")) |v| {
                const s = try v.toBunString(globalObject);
                defer s.deref();
                const u = s.toUTF8WithoutRef(alloc);
                defer u.deinit();
                auth_user = u.slice();
            }
            if (try ao.getTruthy(globalObject, "pass")) |v| {
                const s = try v.toBunString(globalObject);
                defer s.deref();
                const u = s.toUTF8WithoutRef(alloc);
                defer u.deinit();
                auth_pass = u.slice();
            }
            if (try ao.getTruthy(globalObject, "method")) |v| {
                const s = try v.toBunString(globalObject);
                defer s.deref();
                const u = s.toUTF8WithoutRef(alloc);
                defer u.deinit();
                auth_method = u.slice();
            }
            if (try ao.getTruthy(globalObject, "xoauth2")) |v| {
                const s = try v.toBunString(globalObject);
                defer s.deref();
                const u = s.toUTF8WithoutRef(alloc);
                defer u.deinit();
                auth_xoauth2_token = u.slice();
            }
        }
    }

    var lmtp: bool = false;
    var pool: bool = false;
    var max_messages: u32 = 100;
    if (try opts.getTruthy(globalObject, "disableFileAccess")) |v| disable_file_access = v.toBoolean();
    if (try opts.getTruthy(globalObject, "keepBcc")) |v| keep_bcc = v.toBoolean();
    if (try opts.getTruthy(globalObject, "lmtp")) |v| lmtp = v.toBoolean();
    var sendmail_path_str: []const u8 = "";
    if (try opts.getTruthy(globalObject, "sendmail")) |v| {
        if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const u = s.toUTF8WithoutRef(alloc);
            defer u.deinit();
            sendmail_path_str = u.slice();
        } else if (v.toBoolean()) {
            sendmail_path_str = "/usr/sbin/sendmail";
        }
    }
    var rate_limit: u32 = 0;
    var rate_delta: u32 = 1000;
    if (try opts.getTruthy(globalObject, "pool")) |v| pool = v.toBoolean();
    if (try opts.getTruthy(globalObject, "maxMessages")) |v| max_messages = @intCast(@max(1, v.toInt32()));
    if (try opts.getTruthy(globalObject, "rateLimit")) |v| rate_limit = @intCast(@max(0, v.toInt32()));
    if (try opts.getTruthy(globalObject, "rateDelta")) |v| rate_delta = @intCast(@max(1, v.toInt32()));

    // Proxy support: parse proxy URL like "http://user:pass@proxy.host:port"
    var proxy_host_str: []const u8 = "";
    var proxy_port_val: u16 = 0;
    var proxy_auth_str: []const u8 = "";
    if (try opts.getTruthy(globalObject, "proxy")) |v| {
        if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const u = s.toUTF8WithoutRef(alloc);
            defer u.deinit();
            const proxy_raw = u.slice();
            // Parse proxy URL using Bun's URL parser
            if (URL.fromUTF8(alloc, proxy_raw)) |purl| {
                if (purl.hostname.len > 0) proxy_host_str = purl.hostname;
                if (purl.port.len > 0) {
                    proxy_port_val = std.fmt.parseInt(u16, purl.port, 10) catch 80;
                } else if (bun.strings.hasPrefixComptime(purl.protocol, "https")) {
                    proxy_port_val = 443;
                } else {
                    proxy_port_val = 80;
                }
                // Combine username:password for Proxy-Authorization
                if (purl.username.len > 0) {
                    if (purl.password.len > 0) {
                        var auth_buf: [512]u8 = undefined;
                        proxy_auth_str = std.fmt.bufPrint(&auth_buf, "{s}:{s}", .{ purl.username, purl.password }) catch "";
                    } else {
                        proxy_auth_str = purl.username;
                    }
                }
            } else |_| {}
        }
    }

    // Persist strings
    var sb = bun.StringBuilder{};
    sb.count(host_str);
    sb.count(auth_user);
    sb.count(auth_pass);
    sb.count(auth_method);
    sb.count(auth_xoauth2_token);
    sb.count(local_hostname);
    sb.count(mid_hostname);
    sb.count(proxy_host_str);
    sb.count(proxy_auth_str);
    sb.count(sendmail_path_str);
    try sb.allocate(alloc);
    const h = sb.append(host_str);
    const au = sb.append(auth_user);
    const ap = sb.append(auth_pass);
    const am = sb.append(auth_method);
    const ax = sb.append(auth_xoauth2_token);
    const ln = sb.append(local_hostname);
    const mh = sb.append(mid_hostname);
    const ph = sb.append(proxy_host_str);
    const pa = sb.append(proxy_auth_str);
    const sp = sb.append(sendmail_path_str);
    var cs: []u8 = &.{};
    sb.moveToSlice(&cs);

    bun.analytics.Features.smtp += 1;

    const client = JSSMTPClient.new(.{
        .ref_count = .init(),
        .globalObject = globalObject,
        .conn = .{
            .host = h,
            .port = port,
            .tls_mode = if (secure) .direct else .none,
            .local_hostname = ln,
            .auth_user = au,
            .auth_pass = ap,
            .auth_method = am,
            .auth_xoauth2_token = ax,
            .require_tls = require_tls,
            .ignore_tls = ignore_tls,
            .require_tls_extension = require_tls_extension,
            .secure = secure,
            .lmtp = lmtp,
            .proxy_host = ph,
            .proxy_port = proxy_port_val,
            .proxy_auth = pa,
            .callbacks = undefined,
        },
        .connection_strings = cs,
        .connection_timeout_ms = conn_timeout,
        .socket_timeout_ms = sock_timeout,
        .disable_file_access = disable_file_access,
        .keep_bcc = keep_bcc,
        .sendmail_path = sp,
        .pool = pool,
        .max_messages = max_messages,
        .rate_limit = rate_limit,
        .rate_delta = rate_delta,
        .message_id_hostname = mh,
        .allocator = alloc,
    });

    // Wire callbacks to point at this client
    client.conn.callbacks = .{
        .on_send_complete = onSendComplete,
        .on_ready = onReady,
        .on_error = onError,
        .on_starttls = onStartTLS,
        .ctx = @ptrCast(client),
    };

    return client;
}

// ========== JS API Methods ==========

pub fn send(this: *JSSMTPClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isObject()) return globalObject.throwInvalidArguments("send() requires a message object", .{});

    const state = this.conn.state;
    const is_busy = state != .disconnected and state != .closed and state != .failed and state != .ready and state != .rset and state != .quit;

    // Pool mode: if busy, queue the send instead of rejecting
    if (is_busy and this.pool) {
        const promise_ptr = jsc.JSPromise.create(globalObject);
        const promise_js = promise_ptr.toJS();
        // Push [msg, promise] pair onto the pool queue (JS array)
        const queue = if (this.pool_queue.get()) |q| q else brk: {
            const arr = jsc.JSValue.createEmptyArray(globalObject, 0) catch return .js_undefined;
            this.pool_queue = .create(arr, globalObject);
            break :brk arr;
        };
        const pair = jsc.JSValue.createEmptyArray(globalObject, 2) catch return .js_undefined;
        pair.putIndex(globalObject, 0, args[0]) catch {};
        pair.putIndex(globalObject, 1, promise_js) catch {};
        // push() via getPropertyValue + call
        const push_fn = (try queue.getPropertyValue(globalObject, "push")) orelse return .js_undefined;
        _ = push_fn.call(globalObject, queue, &.{pair}) catch {};
        return promise_js;
    }

    if (is_busy) return globalObject.throw("SMTPClient is already busy with another operation", .{});
    var reuse = state == .ready or state == .rset;

    // Pool: if maxMessages reached, force a new connection
    if (reuse and this.pool and this.messages_sent >= this.max_messages) {
        this.conn.closeSocket();
        this.conn.state = .disconnected;
        this.messages_sent = 0;
        reuse = false;
    }

    const promise_ptr = jsc.JSPromise.create(globalObject);
    const promise_js = promise_ptr.toJS();
    if (this.this_value.tryGet()) |this_js| js.sendPromiseSetCached(this_js, globalObject, promise_js);

    const msg = args[0];

    // Check for explicit envelope override
    const envelope_override = try msg.getTruthy(globalObject, "envelope");
    const env_src = if (envelope_override != null and envelope_override.?.isObject()) envelope_override.? else msg;

    // Parse envelope FROM
    if (try env_src.getTruthy(globalObject, "from")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(this.allocator);
        defer u.deinit();
        this.freeEnvelopeFrom();
        const parsed = try address_parser.parse(this.allocator, u.slice());
        defer this.allocator.free(parsed);
        const raw_email = if (parsed.len > 0) extractAddrFromParsed(parsed[0]) else null;
        const email = raw_email orelse mime.extractEmail(u.slice());
        if (!isCleanEmail(email)) {
            try promise_ptr.reject(globalObject, globalObject.createErrorInstance("Invalid 'from' address: contains control characters", .{}));
            return promise_js;
        }
        this.envelope_from_buf = try this.allocator.dupe(u8, email);
        this.conn.envelope_from = this.envelope_from_buf;
    } else {
        try promise_ptr.reject(globalObject, globalObject.createErrorInstance("send() requires 'from' field", .{}));
        return promise_js;
    }

    // Parse envelope TO (includes cc, bcc unless envelope override)
    var sfb = std.heap.stackFallback(@sizeOf([]const u8) * 32, this.allocator);
    const sfb_alloc = sfb.get();
    var to_list = std.ArrayListUnmanaged([]const u8){};
    defer to_list.deinit(sfb_alloc);
    try this.collectRecipients(globalObject, env_src, "to", sfb_alloc, &to_list);
    if (envelope_override == null) {
        try this.collectRecipients(globalObject, msg, "cc", sfb_alloc, &to_list);
        try this.collectRecipients(globalObject, msg, "bcc", sfb_alloc, &to_list);
    }
    if (to_list.items.len == 0) {
        try promise_ptr.reject(globalObject, globalObject.createErrorInstance("send() requires at least one recipient in 'to'", .{}));
        return promise_js;
    }

    this.freeEnvelopeTo();
    // Copy to a persistent allocation owned by this client
    const to_slice = try this.allocator.alloc([]const u8, to_list.items.len);
    @memcpy(to_slice, to_list.items);
    this.envelope_to_buf = @ptrCast(to_slice);
    this.conn.envelope_to = @ptrCast(to_slice);

    // Build message (or use raw)
    this.freeMessageData();
    if (try msg.getTruthy(globalObject, "raw")) |raw_val| {
        if (raw_val.isString()) {
            const s = try raw_val.toBunString(globalObject);
            defer s.deref();
            const u = s.toUTF8WithoutRef(this.allocator);
            defer u.deinit();
            this.message_data_buf = try this.allocator.dupe(u8, u.slice());
        } else if (raw_val.asArrayBuffer(globalObject)) |buf| {
            this.message_data_buf = try this.allocator.dupe(u8, buf.slice());
        }
    } else {
        this.message_data_buf = try mime.buildMessageWithOptions(this.allocator, globalObject, msg, .{
            .message_id_hostname = this.message_id_hostname,
            .keep_bcc = this.keep_bcc,
            .disable_file_access = this.disable_file_access,
        });
    }

    // DKIM signing
    if (try msg.getTruthy(globalObject, "dkim")) |dkim_obj| {
        if (dkim_obj.isObject()) {
            try this.applyDkim(globalObject, dkim_obj);
        }
    }

    this.conn.message_data = this.message_data_buf;

    // Sendmail transport: spawn sendmail binary and pipe message to stdin
    if (this.sendmail_path.len > 0) {
        return this.sendViaSendmail(globalObject, promise_ptr, promise_js);
    }

    // Send via SMTP
    this.conn.current_rcpt_index = 0;
    this.conn.accepted_count = 0;
    this.conn.rejected_count = 0;
    this.conn.accepted_indices.clearRetainingCapacity();
    this.conn.rejected_indices.clearRetainingCapacity();

    if (reuse) {
        this.conn.startSend();
    } else {
        this.conn.resetCapabilities();
        this.ref();
        this.doConnect() catch {
            this.deref();
            try promise_ptr.reject(globalObject, globalObject.createErrorInstance("Failed to connect to SMTP server", .{}));
            return promise_js;
        };
    }
    return promise_js;
}

pub fn verify(this: *JSSMTPClient, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const state = this.conn.state;
    if (state != .disconnected and state != .closed and state != .failed and state != .ready and state != .rset)
        return globalObject.throw("SMTPClient is busy", .{});

    const promise_ptr = jsc.JSPromise.create(globalObject);
    const promise_js = promise_ptr.toJS();

    if (state == .ready or state == .rset) {
        try promise_ptr.resolve(globalObject, jsc.JSValue.true);
        return promise_js;
    }

    if (this.this_value.tryGet()) |this_js| js.sendPromiseSetCached(this_js, globalObject, promise_js);

    // Verify mode: no envelope, no message
    this.conn.envelope_from = "";
    this.conn.message_data = "";
    this.conn.resetCapabilities();

    this.ref();
    this.doConnect() catch {
        this.deref();
        try promise_ptr.reject(globalObject, globalObject.createErrorInstance("Failed to connect to SMTP server", .{}));
        return promise_js;
    };
    return promise_js;
}

pub fn close(this: *JSSMTPClient, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    this.conn.closeSocket();
    const vm = this.globalObject.bunVM();
    if (this.timer.state == .ACTIVE) vm.timer.remove(&this.timer);
    this.poll_ref.unref(vm);
    return .js_undefined;
}

pub fn getConnected(this: *JSSMTPClient, _: *jsc.JSGlobalObject) jsc.JSValue {
    const s = this.conn.state;
    return jsc.JSValue.jsBoolean(s == .ready or s == .rset or s == .greeting or s == .ehlo or
        s == .mail_from or s == .rcpt_to or s == .data_cmd or s == .data_body or s == .connecting);
}

pub fn getSecure(this: *JSSMTPClient, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.conn.secure);
}

pub fn finalize(this: *JSSMTPClient) void {
    this.conn.closeSocket();
    this.deref();
}

pub fn memoryCost(this: *const JSSMTPClient) usize {
    return this.connection_strings.len + this.message_data_buf.len;
}

// ========== Connection ==========

fn doConnect(this: *JSSMTPClient) !void {
    const vm = this.globalObject.bunVM();
    this.ref();
    defer this.deref();

    const Handler = SMTPConnection.SocketHandler;
    const use_proxy = this.conn.proxy_host.len > 0;

    // When using a proxy, always connect TCP to the proxy first
    if (use_proxy) {
        const ctx = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*JSSMTPClient)) orelse {
            this.conn.state = .failed;
            return error.FailedToCreateSocketContext;
        };
        uws.NewSocketHandler(false).configure(ctx, true, *JSSMTPClient, Handler(false, JSSMTPClient));
        this.conn.socket_ctx = ctx;
        this.conn.state = .connecting;
        this.conn.socket = .{ .SocketTCP = try uws.SocketTCP.connectAnon(this.conn.proxy_host, this.conn.proxy_port, ctx, this, false) };
    } else if (this.conn.tls_mode == .direct) {
        var err: uws.create_bun_socket_error_t = .none;
        const ctx = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*JSSMTPClient), .{}, &err) orelse {
            this.conn.state = .failed;
            return error.FailedToCreateTLSContext;
        };
        uws.NewSocketHandler(true).configure(ctx, true, *JSSMTPClient, Handler(true, JSSMTPClient));
        this.conn.socket_ctx = ctx;
        this.conn.state = .connecting;
        this.conn.socket = .{ .SocketTLS = try uws.SocketTLS.connectAnon(this.conn.host, this.conn.port, ctx, this, false) };
    } else {
        const ctx = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*JSSMTPClient)) orelse {
            this.conn.state = .failed;
            return error.FailedToCreateSocketContext;
        };
        uws.NewSocketHandler(false).configure(ctx, true, *JSSMTPClient, Handler(false, JSSMTPClient));
        this.conn.socket_ctx = ctx;
        this.conn.state = .connecting;
        this.conn.socket = .{ .SocketTCP = try uws.SocketTCP.connectAnon(this.conn.host, this.conn.port, ctx, this, false) };
    }

    this.poll_ref.ref(vm);
    this.resetConnectionTimeout();
}

fn updatePollRef(this: *JSSMTPClient) void {
    const vm = this.globalObject.bunVM();
    switch (this.conn.state) {
        .disconnected, .closed, .failed, .quit => this.poll_ref.unref(vm),
        else => this.poll_ref.ref(vm),
    }
}

fn resetConnectionTimeout(this: *JSSMTPClient) void {
    const vm = this.globalObject.bunVM();
    if (this.timer.state == .ACTIVE) vm.timer.remove(&this.timer);
    // Use socket timeout if connection is established, connection timeout otherwise
    const timeout_ms = switch (this.conn.state) {
        .ready, .rset => this.socket_timeout_ms,
        else => this.connection_timeout_ms,
    };
    if (timeout_ms > 0) {
        this.timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(timeout_ms));
        vm.timer.insert(&this.timer);
    }
}

pub fn onConnectionTimeout(this: *JSSMTPClient) void {
    this.timer.state = .FIRED;
    // Check if this is a rate-limit retry (queue has items and connection is ready)
    if (this.rate_limit > 0 and this.pool_queue.get() != null) {
        const state = this.conn.state;
        if (state == .ready or state == .rset) {
            this.processQueue();
            return;
        }
    }
    this.conn.callbacks.on_error(this.conn.callbacks.ctx, "Connection timeout", .ETIMEDOUT);
}

// ========== Promise Resolution ==========

fn resolveSendPromise(this: *JSSMTPClient, response: []const u8) void {
    const go = this.globalObject;
    const this_js = this.this_value.tryGet() orelse return;
    if (js.sendPromiseGetCached(this_js)) |pv| {
        js.sendPromiseSetCached(this_js, go, .zero);
        if (pv.asPromise()) |p| {
            const r = jsc.JSValue.createEmptyObject(go, 6);

            // Build accepted array from dynamic indices
            const acc = jsc.JSValue.createEmptyArray(go, @intCast(this.conn.accepted_indices.items.len)) catch .js_undefined;
            for (this.conn.accepted_indices.items, 0..) |idx, i| {
                if (idx < this.conn.envelope_to.len) {
                    const addr_str = bun.String.createFormat("{s}", .{this.conn.envelope_to[idx]}) catch bun.String.empty;
                    acc.putIndex(go, @intCast(i), addr_str.toJS(go) catch .js_undefined) catch {};
                }
            }
            r.put(go, bun.String.static("accepted"), acc);

            // Build rejected array from dynamic indices
            const rej = jsc.JSValue.createEmptyArray(go, @intCast(this.conn.rejected_indices.items.len)) catch .js_undefined;
            for (this.conn.rejected_indices.items, 0..) |idx, i| {
                if (idx < this.conn.envelope_to.len) {
                    const addr_str = bun.String.createFormat("{s}", .{this.conn.envelope_to[idx]}) catch bun.String.empty;
                    rej.putIndex(go, @intCast(i), addr_str.toJS(go) catch .js_undefined) catch {};
                }
            }
            r.put(go, bun.String.static("rejected"), rej);

            // Response string
            const rs = bun.String.createFormat("{s}", .{response}) catch bun.String.empty;
            r.put(go, bun.String.static("response"), rs.toJS(go) catch .js_undefined);

            // Envelope object { from, to }
            const env = jsc.JSValue.createEmptyObject(go, 2);
            const env_from = bun.String.createFormat("{s}", .{this.conn.envelope_from}) catch bun.String.empty;
            env.put(go, bun.String.static("from"), env_from.toJS(go) catch .js_undefined);
            const env_to = jsc.JSValue.createEmptyArray(go, this.conn.envelope_to.len) catch .js_undefined;
            for (this.conn.envelope_to, 0..) |addr, i| {
                const a = bun.String.createFormat("{s}", .{addr}) catch bun.String.empty;
                env_to.putIndex(go, @intCast(i), a.toJS(go) catch .js_undefined) catch {};
            }
            env.put(go, bun.String.static("to"), env_to);
            r.put(go, bun.String.static("envelope"), env);

            // MessageId - extract from message data if present
            r.put(go, bun.String.static("messageId"), extractMessageId(this.message_data_buf, go));

            p.resolve(go, r) catch {};
        }
    }
}

fn extractMessageId(message: []const u8, go: *jsc.JSGlobalObject) jsc.JSValue {
    // Find "Message-ID: <...>" in the message
    if (std.mem.indexOf(u8, message, "Message-ID: <")) |start| {
        const id_start = start + 13; // skip "Message-ID: <"
        if (std.mem.indexOfPos(u8, message, id_start, ">")) |end| {
            const mid = message[id_start - 1 .. end + 1]; // include < and >
            const s = bun.String.createFormat("{s}", .{mid}) catch return .js_undefined;
            return s.toJS(go) catch .js_undefined;
        }
    }
    return .js_undefined;
}

fn failWithError(this: *JSSMTPClient, message: []const u8, code: SMTPConnection.ErrorCode) void {
    const go = this.globalObject;
    const this_js = this.this_value.tryGet() orelse return;
    if (js.sendPromiseGetCached(this_js)) |pv| {
        js.sendPromiseSetCached(this_js, go, .zero);
        if (pv.asPromise()) |p| {
            // Create error with code property like nodemailer
            const err_instance = go.createErrorInstance("{s}", .{message});
            const code_str = switch (code) {
                .ECONNECTION => "ECONNECTION",
                .ETIMEDOUT => "ETIMEDOUT",
                .ESOCKET => "ESOCKET",
                .EPROTOCOL => "EPROTOCOL",
                .EENVELOPE => "EENVELOPE",
                .EMESSAGE => "EMESSAGE",
                .EAUTH => "EAUTH",
                .ETLS => "ETLS",
                .ESTREAM => "ESTREAM",
                .EUNKNOWN => "EUNKNOWN",
            };
            err_instance.put(go, bun.String.static("code"), (bun.String.createFormat("{s}", .{code_str}) catch bun.String.empty).toJS(go) catch .js_undefined);
            p.reject(go, err_instance) catch {};
        }
    }
    this.conn.closeSocket();
    const vm = this.globalObject.bunVM();
    if (this.timer.state == .ACTIVE) vm.timer.remove(&this.timer);
    this.poll_ref.unref(vm);
}

// ========== Helpers ==========

fn applyDkim(this: *JSSMTPClient, globalObject: *jsc.JSGlobalObject, dkim_obj: jsc.JSValue) !void {
    var dc: dkim.DKIMConfig = undefined;
    var have = false;
    if (try dkim_obj.getTruthy(globalObject, "domainName")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(this.allocator);
        defer u.deinit();
        dc.domain_name = try this.allocator.dupe(u8, u.slice());
        have = true;
    }
    if (try dkim_obj.getTruthy(globalObject, "keySelector")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(this.allocator);
        defer u.deinit();
        dc.key_selector = try this.allocator.dupe(u8, u.slice());
    }
    if (try dkim_obj.getTruthy(globalObject, "privateKey")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const u = s.toUTF8WithoutRef(this.allocator);
        defer u.deinit();
        dc.private_key_pem = try this.allocator.dupe(u8, u.slice());
    }
    if (have) {
        if (dkim.signMessage(this.allocator, this.message_data_buf, dc)) |signed| {
            this.allocator.free(@constCast(this.message_data_buf));
            this.message_data_buf = signed;
        } else |_| {}
        this.allocator.free(@constCast(dc.domain_name));
        this.allocator.free(@constCast(dc.key_selector));
        this.allocator.free(@constCast(dc.private_key_pem));
    }
}

fn sendViaSendmail(this: *JSSMTPClient, globalObject: *jsc.JSGlobalObject, promise_ptr: *jsc.JSPromise, promise_js: jsc.JSValue) bun.JSError!jsc.JSValue {
    _ = promise_ptr;
    // Build sendmail args: sendmail -i -f <from> <to1> <to2> ...
    // Use JS Bun.spawn to run the sendmail binary
    const spawn_fn = (try globalObject.toJSValue().getPropertyValue(globalObject, "Bun")) orelse return promise_js;
    const bun_spawn = (try spawn_fn.getPropertyValue(globalObject, "spawn")) orelse return promise_js;

    // Build cmd array: [sendmail_path, "-i", "-f", from, ...to_addrs]
    const to_len = this.conn.envelope_to.len;
    const cmd = jsc.JSValue.createEmptyArray(globalObject, @intCast(3 + to_len)) catch return promise_js;
    const path_str = bun.String.createFormat("{s}", .{this.sendmail_path}) catch bun.String.empty;
    cmd.putIndex(globalObject, 0, path_str.toJS(globalObject) catch .js_undefined) catch {};
    const dash_i = bun.String.static("-i");
    cmd.putIndex(globalObject, 1, dash_i.toJS(globalObject) catch .js_undefined) catch {};
    // -f<from> MUST come before recipients (sendmail treats post-recipient args as recipients)
    const env_from_str = bun.String.createFormat("-f{s}", .{this.conn.envelope_from}) catch bun.String.empty;
    cmd.putIndex(globalObject, 2, env_from_str.toJS(globalObject) catch .js_undefined) catch {};
    // Add each recipient after -f flag
    for (this.conn.envelope_to, 0..) |addr, i| {
        const a = bun.String.createFormat("{s}", .{addr}) catch bun.String.empty;
        cmd.putIndex(globalObject, @intCast(3 + i), a.toJS(globalObject) catch .js_undefined) catch {};
    }

    // Build options: { cmd, stdin: "pipe" }
    const spawn_opts = jsc.JSValue.createEmptyObject(globalObject, 2);
    spawn_opts.put(globalObject, bun.String.static("cmd"), cmd);
    spawn_opts.put(globalObject, bun.String.static("stdin"), (bun.String.static("pipe")).toJS(globalObject) catch .js_undefined);

    // Spawn the process
    const proc = bun_spawn.call(globalObject, spawn_fn, &.{spawn_opts}) catch {
        return promise_js;
    };

    // Write message to stdin
    const stdin = (try proc.getPropertyValue(globalObject, "stdin")) orelse return promise_js;
    const write_fn = (try stdin.getPropertyValue(globalObject, "write")) orelse return promise_js;
    const msg_str = bun.String.createFormat("{s}", .{this.message_data_buf}) catch bun.String.empty;
    _ = write_fn.call(globalObject, stdin, &.{msg_str.toJS(globalObject) catch .js_undefined}) catch {};
    // End stdin
    const end_fn = (try stdin.getPropertyValue(globalObject, "end")) orelse return promise_js;
    _ = end_fn.call(globalObject, stdin, &.{}) catch {};

    // Return proc.exited.then(() => result)
    const exited = (try proc.getPropertyValue(globalObject, "exited")) orelse return promise_js;
    const then_fn = (try exited.getPropertyValue(globalObject, "then")) orelse return promise_js;
    const resolve_cb = jsc.JSFunction.create(globalObject, bun.String.static(""), sendmailResolveCb, 1, .{});
    return then_fn.call(globalObject, exited, &.{resolve_cb});
}

fn sendmailResolveCb(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    const exit_code = if (args.len > 0) args[0].toInt32() else @as(i32, -1);
    if (exit_code != 0) {
        return globalObject.throw("sendmail exited with code {d}", .{exit_code});
    }
    // Return a minimal result object
    const r = jsc.JSValue.createEmptyObject(globalObject, 3);
    const empty_arr = jsc.JSValue.createEmptyArray(globalObject, 0) catch .js_undefined;
    r.put(globalObject, bun.String.static("accepted"), empty_arr);
    r.put(globalObject, bun.String.static("rejected"), jsc.JSValue.createEmptyArray(globalObject, 0) catch .js_undefined);
    r.put(globalObject, bun.String.static("response"), (bun.String.static("250 OK")).toJS(globalObject) catch .js_undefined);
    return r;
}

fn extractAddrFromParsed(parsed: address_parser.ParsedAddress) ?[]const u8 {
    return switch (parsed) {
        .address => |a| if (a.address.len > 0) a.address else null,
        .group => null,
    };
}

/// Returns true if the email address is safe (no control characters).
fn isCleanEmail(email: []const u8) bool {
    for (email) |c| {
        if (c == '\r' or c == '\n' or c == '\x00') return false;
    }
    return true;
}

fn appendParsedAddresses(this: *JSSMTPClient, parsed: []const address_parser.ParsedAddress, alloc: std.mem.Allocator, list: *std.ArrayListUnmanaged([]const u8)) !void {
    for (parsed) |p| {
        if (extractAddrFromParsed(p)) |email| {
            if (isCleanEmail(email)) try list.append(alloc, try this.allocator.dupe(u8, email));
        }
    }
}

fn collectRecipients(this: *JSSMTPClient, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue, comptime field: []const u8, alloc: std.mem.Allocator, list: *std.ArrayListUnmanaged([]const u8)) !void {
    if (try msg.getTruthy(globalObject, field)) |val| {
        if (val.isString()) {
            const s = try val.toBunString(globalObject);
            defer s.deref();
            const u = s.toUTF8WithoutRef(this.allocator);
            defer u.deinit();
            // Use address parser to handle comma-separated lists like "a@b.com, c@d.com"
            const parsed = try address_parser.parse(this.allocator, u.slice());
            defer this.allocator.free(parsed);
            try this.appendParsedAddresses(parsed, alloc, list);
        } else if (val.isArray()) {
            var iter = try val.arrayIterator(globalObject);
            while (try iter.next()) |item| {
                if (item.isString()) {
                    const s = try item.toBunString(globalObject);
                    defer s.deref();
                    const u = s.toUTF8WithoutRef(this.allocator);
                    defer u.deinit();
                    const parsed = try address_parser.parse(this.allocator, u.slice());
                    defer this.allocator.free(parsed);
                    try this.appendParsedAddresses(parsed, alloc, list);
                }
            }
        }
    }
}

// ========== Memory Management ==========

fn freeEnvelopeFrom(this: *JSSMTPClient) void {
    if (this.envelope_from_buf.len > 0) {
        this.allocator.free(@constCast(this.envelope_from_buf));
        this.envelope_from_buf = "";
    }
}

fn freeEnvelopeTo(this: *JSSMTPClient) void {
    for (this.envelope_to_buf) |item| this.allocator.free(@constCast(item));
    if (this.envelope_to_buf.len > 0) {
        this.allocator.free(@constCast(@as([]const []const u8, this.envelope_to_buf)));
        this.envelope_to_buf = &.{};
    }
}

fn freeMessageData(this: *JSSMTPClient) void {
    if (this.message_data_buf.len > 0) {
        this.allocator.free(@constCast(this.message_data_buf));
        this.message_data_buf = "";
    }
}

fn deinit(this: *JSSMTPClient) void {
    this.conn.closeSocket();
    this.conn.deinit();
    this.freeEnvelopeFrom();
    this.freeEnvelopeTo();
    this.freeMessageData();
    if (this.connection_strings.len > 0) this.allocator.free(this.connection_strings);
    const vm = this.globalObject.bunVM();
    if (this.timer.state == .ACTIVE) vm.timer.remove(&this.timer);
    this.poll_ref.unref(vm);
    bun.destroy(this);
}

const SMTPConnection = @import("./smtp_connection.zig");
const address_parser = @import("./address_parser.zig");
const dkim = @import("./dkim.zig");
const mime = @import("./mime.zig");
const std = @import("std");
const well_known = @import("./well_known.zig");

const bun = @import("bun");
const URL = bun.URL;
const jsc = bun.jsc;
const uws = bun.uws;
