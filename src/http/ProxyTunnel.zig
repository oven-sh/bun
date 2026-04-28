const ProxyTunnel = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", ProxyTunnel.deinit, .{});
pub const ref = ProxyTunnel.RefCount.ref;
pub const deref = ProxyTunnel.RefCount.deref;
pub const RefPtr = bun.ptr.RefPtr(@This());

wrapper: ?ProxyTunnelWrapper = null,
shutdown_err: anyerror = error.ConnectionClosed,
// active socket is the socket that is currently being used
socket: union(enum) {
    tcp: NewHTTPContext(false).HTTPSocket,
    ssl: NewHTTPContext(true).HTTPSocket,
    none: void,
} = .{ .none = {} },
write_buffer: bun.io.StreamBuffer = .{},
/// Property of the inner TLS session, not the owning client. Captured from
/// the client in detachOwner() and restored to the next client in adopt()
/// so the pool's did_have_handshaking_error_while_reject_unauthorized_is_false
/// flag survives across reuse — otherwise a reject_unauthorized=false reuse
/// would re-pool with the flag erased, letting a later reject_unauthorized=true
/// request silently reuse a tunnel whose cert failed validation.
did_have_handshaking_error: bool = false,
/// Whether the inner TLS session was established with reject_unauthorized=true
/// (and therefore hostname-verified via checkServerIdentity). A CA-valid but
/// wrong-hostname cert produces error_no=0 so did_have_handshaking_error stays
/// false; without this flag, a strict caller could reuse a tunnel where
/// hostname was never checked.
established_with_reject_unauthorized: bool = false,
ref_count: RefCount,

const ProxyTunnelWrapper = SSLWrapper(*HTTPClient);

fn onOpen(this: *HTTPClient) void {
    log("ProxyTunnel onOpen", .{});
    bun.analytics.Features.http_client_proxy += 1;
    this.state.response_stage = .proxy_handshake;
    this.state.request_stage = .proxy_handshake;
    if (this.proxy_tunnel) |proxy| {
        proxy.ref();
        defer proxy.deref();
        if (proxy.wrapper) |*wrapper| {
            var ssl_ptr = wrapper.ssl orelse return;
            const _hostname = this.hostname orelse this.url.hostname;

            var hostname: [:0]const u8 = "";
            var hostname_needs_free = false;
            if (!strings.isIPAddress(_hostname)) {
                if (_hostname.len < bun.http.temp_hostname.len) {
                    @memcpy(bun.http.temp_hostname[0.._hostname.len], _hostname);
                    bun.http.temp_hostname[_hostname.len] = 0;
                    hostname = bun.http.temp_hostname[0.._hostname.len :0];
                } else {
                    hostname = bun.default_allocator.dupeZ(u8, _hostname) catch unreachable;
                    hostname_needs_free = true;
                }
            }

            defer if (hostname_needs_free) bun.default_allocator.free(hostname);
            ssl_ptr.configureHTTPClient(hostname);
        }
    }
}

fn onData(this: *HTTPClient, decoded_data: []const u8) void {
    if (decoded_data.len == 0) return;
    log("ProxyTunnel onData decoded {}", .{decoded_data.len});
    if (this.proxy_tunnel) |proxy| {
        proxy.ref();
        defer proxy.deref();
        switch (this.state.response_stage) {
            .body => {
                log("ProxyTunnel onData body", .{});
                if (decoded_data.len == 0) return;
                const report_progress = this.handleResponseBody(decoded_data, false) catch |err| {
                    proxy.close(err);
                    return;
                };

                if (report_progress) {
                    switch (proxy.socket) {
                        .ssl => |socket| {
                            this.progressUpdate(true, &bun.http.http_thread.https_context, socket);
                        },
                        .tcp => |socket| {
                            this.progressUpdate(false, &bun.http.http_thread.http_context, socket);
                        },
                        .none => {},
                    }
                    return;
                }
            },
            .body_chunk => {
                log("ProxyTunnel onData body_chunk", .{});
                if (decoded_data.len == 0) return;
                const report_progress = this.handleResponseBodyChunkedEncoding(decoded_data) catch |err| {
                    proxy.close(err);
                    return;
                };

                if (report_progress) {
                    switch (proxy.socket) {
                        .ssl => |socket| {
                            this.progressUpdate(true, &bun.http.http_thread.https_context, socket);
                        },
                        .tcp => |socket| {
                            this.progressUpdate(false, &bun.http.http_thread.http_context, socket);
                        },
                        .none => {},
                    }
                    return;
                }
            },
            .proxy_headers => {
                log("ProxyTunnel onData proxy_headers", .{});
                switch (proxy.socket) {
                    .ssl => |socket| {
                        this.handleOnDataHeaders(true, decoded_data, &bun.http.http_thread.https_context, socket);
                    },
                    .tcp => |socket| {
                        this.handleOnDataHeaders(false, decoded_data, &bun.http.http_thread.http_context, socket);
                    },
                    .none => {},
                }
            },
            else => {
                log("ProxyTunnel onData unexpected data", .{});
                this.state.pending_response = null;
                proxy.close(error.UnexpectedData);
            },
        }
    }
}

fn onHandshake(this: *HTTPClient, handshake_success: bool, ssl_error: uws.us_bun_verify_error_t) void {
    if (this.proxy_tunnel) |proxy| {
        log("ProxyTunnel onHandshake", .{});
        proxy.ref();
        defer proxy.deref();
        this.state.response_stage = .proxy_headers;
        this.state.request_stage = .proxy_headers;
        this.state.request_sent_len = 0;
        const handshake_error = HTTPCertError{
            .error_no = ssl_error.error_no,
            .code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code) :0],
            .reason = if (ssl_error.code == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason) :0],
        };
        if (handshake_success) {
            log("ProxyTunnel onHandshake success", .{});
            // handshake completed but we may have ssl errors
            this.flags.did_have_handshaking_error = handshake_error.error_no != 0;
            if (this.flags.reject_unauthorized) {
                // only reject the connection if reject_unauthorized == true
                if (this.flags.did_have_handshaking_error) {
                    proxy.close(BoringSSL.getCertErrorFromNo(handshake_error.error_no));
                    return;
                }

                // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
                bun.assert(proxy.wrapper != null);
                const ssl_ptr = proxy.wrapper.?.ssl orelse return;

                switch (proxy.socket) {
                    .ssl => |socket| {
                        if (!this.checkServerIdentity(true, socket, handshake_error, ssl_ptr, false)) {
                            log("ProxyTunnel onHandshake checkServerIdentity failed", .{});
                            // checkServerIdentity already called closeAndFail()
                            // → fail() → result callback, which may have
                            // destroyed the AsyncHTTP that embeds `this`. Do not
                            // touch `this` after a `false` return.
                            return;
                        }
                    },
                    .tcp => |socket| {
                        if (!this.checkServerIdentity(false, socket, handshake_error, ssl_ptr, false)) {
                            log("ProxyTunnel onHandshake checkServerIdentity failed", .{});
                            // see .ssl arm — `this` may be freed here.
                            return;
                        }
                    },
                    .none => {},
                }
            }

            switch (proxy.socket) {
                .ssl => |socket| {
                    this.onWritable(true, true, socket);
                },
                .tcp => |socket| {
                    this.onWritable(true, false, socket);
                },
                .none => {},
            }
        } else {
            log("ProxyTunnel onHandshake failed", .{});
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            if (this.flags.did_have_handshaking_error and handshake_error.error_no != 0) {
                proxy.close(BoringSSL.getCertErrorFromNo(handshake_error.error_no));
                return;
            }
            // if handshake_success it self is false, this means that the connection was rejected
            proxy.close(error.ConnectionRefused);
            return;
        }
    }
}

pub fn writeEncrypted(this: *HTTPClient, encoded_data: []const u8) void {
    if (this.proxy_tunnel) |proxy| {
        // Preserve TLS record ordering: if any encrypted bytes are buffered,
        // enqueue new bytes and flush them in FIFO via onWritable.
        if (proxy.write_buffer.isNotEmpty()) {
            bun.handleOom(proxy.write_buffer.write(encoded_data));
            return;
        }
        const written = switch (proxy.socket) {
            .ssl => |socket| socket.write(encoded_data),
            .tcp => |socket| socket.write(encoded_data),
            .none => 0,
        };
        const pending = encoded_data[@intCast(written)..];
        if (pending.len > 0) {
            // lets flush when we are truly writable
            bun.handleOom(proxy.write_buffer.write(pending));
        }
    }
}

fn onClose(this: *HTTPClient) void {
    log("ProxyTunnel onClose {s}", .{if (this.proxy_tunnel == null) "tunnel is detached" else "tunnel exists"});
    if (this.proxy_tunnel) |proxy| {
        proxy.ref();

        // If a response is in progress, mirror HTTPClient.onClose semantics:
        // treat connection close as end-of-body for identity transfer when no content-length.
        const in_progress = this.state.stage != .done and this.state.stage != .fail and this.state.flags.is_redirect_pending == false;
        if (in_progress) {
            if (this.state.isChunkedEncoding()) {
                switch (this.state.chunked_decoder._state) {
                    .CHUNKED_IN_TRAILERS_LINE_HEAD, .CHUNKED_IN_TRAILERS_LINE_MIDDLE => {
                        this.state.flags.received_last_chunk = true;
                        progressUpdateForProxySocket(this, proxy);
                        // Drop our temporary ref asynchronously to avoid freeing within callback
                        bun.http.http_thread.scheduleProxyDeref(proxy);
                        return;
                    },
                    else => {},
                }
            } else if (this.state.content_length == null and this.state.response_stage == .body) {
                this.state.flags.received_last_chunk = true;
                progressUpdateForProxySocket(this, proxy);
                // Balance the ref we took asynchronously
                bun.http.http_thread.scheduleProxyDeref(proxy);
                return;
            }
        }

        // Otherwise, treat as failure.
        const err = proxy.shutdown_err;
        switch (proxy.socket) {
            .ssl => |socket| {
                this.closeAndFail(err, true, socket);
            },
            .tcp => |socket| {
                this.closeAndFail(err, false, socket);
            },
            .none => {},
        }
        proxy.detachSocket();
        // Deref after returning to the event loop to avoid lifetime hazards.
        bun.http.http_thread.scheduleProxyDeref(proxy);
    }
}

fn progressUpdateForProxySocket(this: *HTTPClient, proxy: *ProxyTunnel) void {
    switch (proxy.socket) {
        .ssl => |socket| this.progressUpdate(true, &bun.http.http_thread.https_context, socket),
        .tcp => |socket| this.progressUpdate(false, &bun.http.http_thread.http_context, socket),
        .none => {},
    }
}

pub fn start(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, ssl_options: jsc.API.ServerConfig.SSLConfig, start_payload: []const u8) void {
    const proxy_tunnel = bun.new(ProxyTunnel, .{
        .ref_count = .init(),
    });

    // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
    const custom_options = ssl_options.forClientVerification();
    proxy_tunnel.wrapper = SSLWrapper(*HTTPClient).init(custom_options, true, .{
        .onOpen = ProxyTunnel.onOpen,
        .onData = ProxyTunnel.onData,
        .onHandshake = ProxyTunnel.onHandshake,
        .onClose = ProxyTunnel.onClose,
        .write = ProxyTunnel.writeEncrypted,
        .ctx = this,
    }) catch |err| {
        if (err == error.OutOfMemory) {
            bun.outOfMemory();
        }

        // invalid TLS Options
        proxy_tunnel.detachAndDeref();
        this.closeAndFail(error.ConnectionRefused, is_ssl, socket);
        return;
    };
    this.proxy_tunnel = proxy_tunnel;
    if (is_ssl) {
        proxy_tunnel.socket = .{ .ssl = socket };
    } else {
        proxy_tunnel.socket = .{ .tcp = socket };
    }
    if (start_payload.len > 0) {
        log("proxy tunnel start with payload", .{});
        proxy_tunnel.wrapper.?.startWithPayload(start_payload);
    } else {
        log("proxy tunnel start", .{});
        proxy_tunnel.wrapper.?.start();
    }
}

pub fn close(this: *ProxyTunnel, err: anyerror) void {
    this.shutdown_err = err;
    this.shutdown();
}

pub fn shutdown(this: *ProxyTunnel) void {
    if (this.wrapper) |*wrapper| {
        // fast shutdown the connection
        _ = wrapper.shutdown(true);
    }
}

pub fn onWritable(this: *ProxyTunnel, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("ProxyTunnel onWritable", .{});
    this.ref();
    defer this.deref();
    defer if (this.wrapper) |*wrapper| {
        // Cycle to through the SSL state machine
        _ = wrapper.flush();
    };

    const encoded_data = this.write_buffer.slice();
    if (encoded_data.len == 0) {
        return;
    }
    const written = socket.write(encoded_data);
    if (written == encoded_data.len) {
        this.write_buffer.reset();
    } else {
        this.write_buffer.cursor += @intCast(written);
    }
}

pub fn receive(this: *ProxyTunnel, buf: []const u8) void {
    this.ref();
    defer this.deref();
    if (this.wrapper) |*wrapper| {
        wrapper.receiveData(buf);
    }
}

pub fn write(this: *ProxyTunnel, buf: []const u8) !usize {
    if (this.wrapper) |*wrapper| {
        return try wrapper.writeData(buf);
    }
    return error.ConnectionClosed;
}

pub fn detachSocket(this: *ProxyTunnel) void {
    this.socket = .{ .none = {} };
}

pub fn detachAndDeref(this: *ProxyTunnel) void {
    this.detachSocket();
    this.deref();
}

/// Detach the tunnel from its current HTTPClient owner so it can be safely
/// pooled for keepalive. The inner TLS session is preserved. The tunnel's
/// refcount is NOT changed — the caller must ensure the ref is transferred
/// to the pool (or dereffed on failure to pool).
pub fn detachOwner(this: *ProxyTunnel, client: *const HTTPClient) void {
    this.socket = .{ .none = {} };
    // Capture the handshaking-error flag from the client — this is a property
    // of the inner TLS session, not the client. adopt() restores it to the
    // next client so re-pooling doesn't erase it.
    this.did_have_handshaking_error = client.flags.did_have_handshaking_error;
    // OR semantics — a lax client is allowed to reuse a strict tunnel (the
    // existingSocket guard only blocks the reverse). When that lax client
    // detaches, it must not downgrade a hostname-verified TLS session to
    // lax-established; once true, stays true.
    this.established_with_reject_unauthorized = this.established_with_reject_unauthorized or client.flags.reject_unauthorized;
    // We intentionally leave wrapper.handlers.ctx stale here. The tunnel is
    // idle in the pool and no callbacks will fire until adopt() reattaches
    // a new owner and socket.
}

/// Reattach a pooled tunnel to a new HTTPClient and socket. The TLS session
/// is reused as-is — no CONNECT and no new TLS handshake. The client's
/// request/response stage is set to .proxy_headers so the next onWritable
/// writes the HTTP request directly into the tunnel.
pub fn adopt(this: *ProxyTunnel, client: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("ProxyTunnel adopt (reusing pooled tunnel)", .{});
    // Discard any stale encrypted bytes from the previous request. A clean
    // request boundary should leave this empty, but an early server response
    // (e.g. HTTP 413) with Connection: keep-alive before the full body was
    // consumed could leave unsent bytes that would corrupt the next request.
    this.write_buffer.reset();
    if (this.wrapper) |*wrapper| {
        wrapper.handlers.ctx = client;
    }
    if (is_ssl) {
        this.socket = .{ .ssl = socket };
    } else {
        this.socket = .{ .tcp = socket };
    }
    client.proxy_tunnel = this;
    client.flags.proxy_tunneling = false;
    // Restore the cert-error flag captured in detachOwner() — no handshake
    // runs here, so the client's own flag would otherwise stay false and
    // re-pooling would erase the record.
    client.flags.did_have_handshaking_error = this.did_have_handshaking_error;
    client.state.request_stage = .proxy_headers;
    client.state.response_stage = .proxy_headers;
    client.state.request_sent_len = 0;
}

fn deinit(this: *ProxyTunnel) void {
    this.socket = .{ .none = {} };
    if (this.wrapper) |*wrapper| {
        wrapper.deinit();
        this.wrapper = null;
    }
    this.write_buffer.deinit();
    bun.destroy(this);
}

const log = bun.Output.scoped(.http_proxy_tunnel, .visible);

const HTTPCertError = @import("./HTTPCertError.zig");
const SSLWrapper = @import("../bun.js/api/bun/ssl_wrapper.zig").SSLWrapper;

const bun = @import("bun");
const jsc = bun.jsc;
const strings = bun.strings;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;

const HTTPClient = bun.http;
const NewHTTPContext = bun.http.NewHTTPContext;
