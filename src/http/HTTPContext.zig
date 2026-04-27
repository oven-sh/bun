pub fn NewHTTPContext(comptime ssl: bool) type {
    return struct {
        const pool_size = 64;
        const PooledSocket = struct {
            http_socket: HTTPSocket,
            hostname_buf: [MAX_KEEPALIVE_HOSTNAME]u8 = undefined,
            hostname_len: u8 = 0,
            port: u16 = 0,
            /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
            did_have_handshaking_error_while_reject_unauthorized_is_false: bool = false,
            /// The interned SSLConfig this socket was created with (null = default context).
            /// Owns a strong ref while the socket is in the keepalive pool.
            ssl_config: ?SSLConfig.SharedPtr = null,
            /// The context that owns this pooled socket's memory (for returning to correct pool).
            owner: *Context,
            /// If this socket carries an established CONNECT tunnel (HTTPS through
            /// an HTTP proxy), the tunnel is preserved here. The pool owns one
            /// strong ref while the socket is parked. Null for direct connections.
            proxy_tunnel: ?ProxyTunnel.RefPtr = null,
            /// Target (origin) hostname the tunnel connects to. `hostname_buf`
            /// above holds the PROXY hostname; this is the upstream we CONNECTed
            /// to. Heap-allocated only when proxy_tunnel is set; empty otherwise.
            target_hostname: []const u8 = "",
            target_port: u16 = 0,
            /// Hash of the effective Proxy-Authorization value so that tunnels
            /// established with different credentials are not cross-shared.
            /// 0 = no proxy auth.
            proxy_auth_hash: u64 = 0,
            /// HTTP/2 connection state (HPACK tables, server SETTINGS) when
            /// this socket negotiated "h2". Owned by the pool while parked.
            h2_session: ?*H2.ClientSession = null,
        };

        pub fn markTaggedSocketAsDead(socket: HTTPSocket, tagged: ActiveSocket) void {
            if (tagged.is(PooledSocket)) {
                Handler.addMemoryBackToPool(tagged.as(PooledSocket));
            }

            if (socket.ext(**anyopaque)) |ctx| {
                ctx.* = bun.cast(**anyopaque, ActiveSocket.init(dead_socket).ptr());
            }
        }

        pub fn markSocketAsDead(socket: HTTPSocket) void {
            markTaggedSocketAsDead(socket, getTaggedFromSocket(socket));
        }

        pub fn terminateSocket(socket: HTTPSocket) void {
            markSocketAsDead(socket);
            socket.close(.failure);
        }

        pub fn closeSocket(socket: HTTPSocket) void {
            markSocketAsDead(socket);
            socket.close(.normal);
        }

        fn getTagged(ptr: *anyopaque) ActiveSocket {
            return ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
        }

        pub fn getTaggedFromSocket(socket: HTTPSocket) ActiveSocket {
            if (socket.ext(anyopaque)) |ctx| {
                return getTagged(ctx);
            }
            return ActiveSocket.init(dead_socket);
        }

        pub const PooledSocketHiveAllocator = bun.HiveArray(PooledSocket, pool_size);

        /// Heap-allocated custom-SSL contexts only. The cache entry in
        /// custom_ssl_context_map holds 1; each in-flight HTTPClient that set
        /// `client.custom_ssl_ctx = this` holds 1. Eviction drops the cache
        /// ref but the context survives until the last client releases it,
        /// so deinit() never runs while a request is mid-flight. The global
        /// http_context/https_context start at 1 and are never deref'd.
        const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
        pub const ref = RefCount.ref;
        pub const deref = RefCount.deref;

        ref_count: RefCount,
        pending_sockets: PooledSocketHiveAllocator,
        us_socket_context: *uws.SocketContext,
        /// HTTP/2 sessions with at least one active stream, available for
        /// concurrent attachment if `hasHeadroom()`.
        active_h2_sessions: std.ArrayListUnmanaged(*H2.ClientSession) = .{},
        /// HTTPClients whose fresh TLS connect is in flight and whose request
        /// is h2-capable. Subsequent h2-capable requests to the same origin
        /// coalesce onto the first one's session once ALPN resolves rather
        /// than each opening its own socket.
        pending_h2_connects: std.ArrayListUnmanaged(*H2.PendingConnect) = .{},

        const Context = @This();
        pub const HTTPSocket = uws.NewSocketHandler(ssl);

        pub fn context() *@This() {
            if (comptime ssl) {
                return &bun.http.http_thread.https_context;
            } else {
                return &bun.http.http_thread.http_context;
            }
        }

        const ActiveSocket = TaggedPointerUnion(.{
            DeadSocket,
            HTTPClient,
            PooledSocket,
            H2.ClientSession,
        });
        const ssl_int = @as(c_int, @intFromBool(ssl));

        const MAX_KEEPALIVE_HOSTNAME = 128;

        pub fn registerH2(this: *@This(), session: *H2.ClientSession) void {
            if (comptime !ssl) return;
            if (session.registry_index != std.math.maxInt(u32)) return;
            session.ref();
            session.registry_index = @intCast(this.active_h2_sessions.items.len);
            bun.handleOom(this.active_h2_sessions.append(bun.default_allocator, session));
        }

        /// Called from drainQueuedShutdowns when the abort-tracker lookup
        /// misses: a request parked in `PendingConnect.waiters` (coalesced
        /// onto a leader's in-flight TLS connect) never registered a socket,
        /// so it can only be found by scanning here.
        pub fn abortPendingH2Waiter(this: *@This(), async_http_id: u32) bool {
            if (comptime !ssl) return false;
            for (this.pending_h2_connects.items) |pc| {
                for (pc.waiters.items, 0..) |waiter, i| {
                    if (waiter.async_http_id == async_http_id) {
                        _ = pc.waiters.swapRemove(i);
                        waiter.failFromH2(error.Aborted);
                        return true;
                    }
                }
            }
            return false;
        }

        pub fn unregisterH2(this: *@This(), session: *H2.ClientSession) void {
            if (comptime !ssl) return;
            const idx = session.registry_index;
            if (idx == std.math.maxInt(u32)) return;
            session.registry_index = std.math.maxInt(u32);
            const list = &this.active_h2_sessions;
            bun.debugAssert(idx < list.items.len and list.items[idx] == session);
            _ = list.swapRemove(idx);
            if (idx < list.items.len) list.items[idx].registry_index = idx;
            session.deref();
        }

        pub fn tagAsH2(socket: HTTPSocket, session: *H2.ClientSession) void {
            if (socket.ext(**anyopaque)) |ctx| {
                ctx.* = bun.cast(**anyopaque, ActiveSocket.init(session).ptr());
            }
        }

        pub fn sslCtx(this: *@This()) *BoringSSL.SSL_CTX {
            if (comptime !ssl) {
                unreachable;
            }

            return @as(*BoringSSL.SSL_CTX, @ptrCast(this.us_socket_context.getNativeHandle(true)));
        }

        fn deinit(this: *@This()) void {
            // Replace callbacks with no-ops first to avoid UAF when closing sockets.
            this.us_socket_context.cleanCallbacks(ssl);

            // Drain pooled keepalive sockets: deref their ssl_config and force-close.
            // Must force-close (code != 0) because SSL clean shutdown (code=0) requires a
            // shutdown handshake with the peer, which won't complete during eviction.
            // Without force-close, the socket stays linked and the context refcount never
            // reaches 0, leaking the SSL_CTX.
            {
                var iter = this.pending_sockets.used.iterator(.{ .kind = .set });
                while (iter.next()) |idx| {
                    const pooled = this.pending_sockets.at(@intCast(idx));
                    // Not gated on comptime ssl — an HTTP-proxy-to-HTTPS
                    // tunnel pools in the non-SSL context but still stores
                    // the inner-TLS tls_props here for pool-key matching.
                    if (pooled.ssl_config) |*s| s.deinit();
                    pooled.ssl_config = null;
                    if (pooled.proxy_tunnel) |*rp| {
                        // Do NOT call rp.data.shutdown() here — it drives
                        // SSLWrapper.shutdown → triggerCloseCallback →
                        // onClose(handlers.ctx), and handlers.ctx is the
                        // stale HTTPClient pointer from detachOwner(). That
                        // client is freed by now. http_socket.close(.failure)
                        // below force-closes the TCP without triggering the
                        // callback, same as addMemoryBackToPool().
                        rp.deref();
                    }
                    pooled.proxy_tunnel = null;
                    if (pooled.target_hostname.len > 0) {
                        bun.default_allocator.free(pooled.target_hostname);
                        pooled.target_hostname = "";
                    }
                    if (pooled.h2_session) |s| s.deref();
                    pooled.h2_session = null;
                    pooled.http_socket.close(.failure);
                }
            }

            this.active_h2_sessions.deinit(bun.default_allocator);
            for (this.pending_h2_connects.items) |pc| pc.deinit();
            this.pending_h2_connects.deinit(bun.default_allocator);

            // Use deferred free pattern (via nextTick) to avoid freeing the uSockets
            // context while close callbacks may still reference it.
            this.us_socket_context.deinit(ssl);
            bun.default_allocator.destroy(this);
        }

        pub fn initWithClientConfig(this: *@This(), client: *HTTPClient) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            const opts = client.tls_props.?.get().asUSocketsForClientVerification();
            try this.initWithOpts(&opts);
        }

        fn initWithOpts(this: *@This(), opts: *const uws.SocketContext.BunSocketContextOptions) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }

            var err: uws.create_bun_socket_error_t = .none;
            const socket = uws.SocketContext.createSSLContext(bun.http.http_thread.loop.loop, @sizeOf(usize), opts.*, &err);
            if (socket == null) {
                return switch (err) {
                    .load_ca_file => error.LoadCAFile,
                    .invalid_ca_file => error.InvalidCAFile,
                    .invalid_ca => error.InvalidCA,
                    else => error.FailedToOpenSocket,
                };
            }
            this.us_socket_context = socket.?;
            this.sslCtx().setup();

            HTTPSocket.configure(
                this.us_socket_context,
                false,
                anyopaque,
                Handler,
            );
        }

        pub fn initWithThreadOpts(this: *@This(), init_opts: *const HTTPThread.InitOpts) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            var opts: uws.SocketContext.BunSocketContextOptions = .{
                .ca = if (init_opts.ca.len > 0) @ptrCast(init_opts.ca) else null,
                .ca_count = @intCast(init_opts.ca.len),
                .ca_file_name = if (init_opts.abs_ca_file_name.len > 0) init_opts.abs_ca_file_name else null,
                .request_cert = 1,
            };

            try this.initWithOpts(&opts);
        }

        pub fn init(this: *@This()) void {
            if (comptime ssl) {
                const opts: uws.SocketContext.BunSocketContextOptions = .{
                    // we request the cert so we load root certs and can verify it
                    .request_cert = 1,
                    // we manually abort the connection if the hostname doesn't match
                    .reject_unauthorized = 0,
                };
                var err: uws.create_bun_socket_error_t = .none;
                this.us_socket_context = uws.SocketContext.createSSLContext(bun.http.http_thread.loop.loop, @sizeOf(usize), opts, &err).?;

                this.sslCtx().setup();
            } else {
                this.us_socket_context = uws.SocketContext.createNoSSLContext(bun.http.http_thread.loop.loop, @sizeOf(usize)).?;
            }

            HTTPSocket.configure(
                this.us_socket_context,
                false,
                anyopaque,
                Handler,
            );
        }

        /// Attempt to keep the socket alive by reusing it for another request.
        /// If no space is available, close the socket.
        ///
        /// If `did_have_handshaking_error_while_reject_unauthorized_is_false`
        /// is set, then we can only reuse the socket for HTTP Keep Alive if
        /// `reject_unauthorized` is set to `false`.
        ///
        /// If `tunnel` is non-null, the socket carries an established CONNECT
        /// tunnel. The pool takes ownership of one strong ref on the tunnel;
        /// the caller must NOT deref it afterwards. If pooling fails (pool
        /// full, hostname too long, socket bad), the tunnel is dereffed here.
        pub fn releaseSocket(
            this: *@This(),
            socket: HTTPSocket,
            did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
            hostname: []const u8,
            port: u16,
            ssl_config: ?SSLConfig.SharedPtr,
            tunnel: ?*ProxyTunnel,
            target_hostname: []const u8,
            target_port: u16,
            proxy_auth_hash: u64,
            h2_session: ?*H2.ClientSession,
        ) void {
            // log("releaseSocket(0x{f})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

            if (comptime Environment.allow_assert) {
                assert(!socket.isClosed());
                assert(!socket.isShutdown());
                assert(socket.isEstablished());
            }
            assert(hostname.len > 0);
            assert(port > 0);

            if (hostname.len <= MAX_KEEPALIVE_HOSTNAME and
                !socket.isClosedOrHasError() and
                socket.isEstablished())
            {
                if (this.pending_sockets.get()) |pending| {
                    if (socket.ext(**anyopaque)) |ctx| {
                        ctx.* = bun.cast(**anyopaque, ActiveSocket.init(pending).ptr());
                    }
                    socket.flush();
                    socket.timeout(0);
                    socket.setTimeoutMinutes(5);

                    pending.http_socket = socket;
                    pending.did_have_handshaking_error_while_reject_unauthorized_is_false = did_have_handshaking_error_while_reject_unauthorized_is_false;
                    @memcpy(pending.hostname_buf[0..hostname.len], hostname);
                    pending.hostname_len = @as(u8, @truncate(hostname.len));
                    pending.port = port;
                    pending.owner = this;
                    // Clone a strong ref for the keepalive pool; the caller retains
                    // its own ref via HTTPClient.tls_props.
                    pending.ssl_config = if (ssl_config) |s| s.clone() else null;

                    // Pool owns the tunnel ref transferred by the caller.
                    pending.proxy_tunnel = if (tunnel) |t| .takeRef(t) else null;
                    pending.proxy_auth_hash = proxy_auth_hash;
                    pending.target_hostname = if (tunnel != null and target_hostname.len > 0)
                        bun.handleOom(bun.default_allocator.dupe(u8, target_hostname))
                    else
                        "";
                    pending.target_port = target_port;
                    pending.h2_session = h2_session;

                    log("Keep-Alive release {s}:{d} tunnel={} target={s}:{d}", .{
                        hostname,
                        port,
                        tunnel != null,
                        target_hostname,
                        target_port,
                    });
                    return;
                }
            }
            log("close socket", .{});
            if (tunnel) |t| {
                t.shutdown();
                t.detachAndDeref();
            }
            if (h2_session) |s| s.deref();
            closeSocket(socket);
        }

        pub const Handler = struct {
            pub fn onOpen(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const active = getTagged(ptr);
                if (active.get(HTTPClient)) |client| {
                    if (client.onOpen(comptime ssl, socket)) |_| {
                        return;
                    } else |_| {
                        log("Unable to open socket", .{});
                        terminateSocket(socket);
                        return;
                    }
                }

                log("Unexpected open on unknown socket", .{});
                terminateSocket(socket);
            }
            pub fn onHandshake(
                ptr: *anyopaque,
                socket: HTTPSocket,
                success: i32,
                ssl_error: uws.us_bun_verify_error_t,
            ) void {
                const handshake_success = if (success == 1) true else false;

                const handshake_error = HTTPCertError{
                    .error_no = ssl_error.error_no,
                    .code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code) :0],
                    .reason = if (ssl_error.code == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason) :0],
                };

                const active = getTagged(ptr);
                if (active.get(HTTPClient)) |client| {
                    // handshake completed but we may have ssl errors
                    client.flags.did_have_handshaking_error = handshake_error.error_no != 0;
                    if (handshake_success) {
                        if (client.flags.reject_unauthorized) {
                            // only reject the connection if reject_unauthorized == true
                            if (client.flags.did_have_handshaking_error) {
                                client.closeAndFail(BoringSSL.getCertErrorFromNo(handshake_error.error_no), comptime ssl, socket);
                                return;
                            }

                            // if checkServerIdentity returns false, we dont call firstCall — the connection was rejected
                            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
                            if (!client.checkServerIdentity(comptime ssl, socket, handshake_error, ssl_ptr, true)) {
                                client.flags.did_have_handshaking_error = true;
                                client.unregisterAbortTracker();
                                if (!socket.isClosed()) terminateSocket(socket);
                                return;
                            }
                        }

                        return client.firstCall(comptime ssl, socket);
                    } else {
                        // if we are here is because server rejected us, and the error_no is the cause of this
                        // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                        if (client.flags.did_have_handshaking_error) {
                            client.closeAndFail(BoringSSL.getCertErrorFromNo(handshake_error.error_no), comptime ssl, socket);
                            return;
                        }
                        // if handshake_success it self is false, this means that the connection was rejected
                        client.closeAndFail(error.ConnectionRefused, comptime ssl, socket);
                        return;
                    }
                }

                if (socket.isClosed()) {
                    markSocketAsDead(socket);

                    return;
                }

                if (handshake_success) {
                    if (active.is(PooledSocket)) {
                        // Allow pooled sockets to be reused if the handshake was successful.
                        socket.setTimeout(0);
                        socket.setTimeoutMinutes(5);
                        return;
                    }
                }

                terminateSocket(socket);
            }
            pub fn onClose(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
                _: ?*anyopaque,
            ) void {
                const tagged = getTagged(ptr);
                markSocketAsDead(socket);

                if (tagged.get(HTTPClient)) |client| {
                    return client.onClose(comptime ssl, socket);
                }
                if (tagged.get(H2.ClientSession)) |session| {
                    return session.onClose(error.ConnectionClosed);
                }
            }

            fn addMemoryBackToPool(pooled: *PooledSocket) void {
                if (pooled.ssl_config) |*s| s.deinit();
                pooled.ssl_config = null;
                if (pooled.proxy_tunnel) |*rp| {
                    rp.deref();
                }
                pooled.proxy_tunnel = null;
                if (pooled.target_hostname.len > 0) {
                    bun.default_allocator.free(pooled.target_hostname);
                    pooled.target_hostname = "";
                }
                if (pooled.h2_session) |s| s.deref();
                pooled.h2_session = null;
                assert(pooled.owner.pending_sockets.put(pooled));
            }

            pub fn onData(
                ptr: *anyopaque,
                socket: HTTPSocket,
                buf: []const u8,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onData(
                        comptime ssl,
                        buf,
                        client.getSslCtx(ssl),
                        socket,
                    );
                } else if (tagged.get(H2.ClientSession)) |session| {
                    return session.onData(buf);
                } else if (tagged.is(PooledSocket)) {
                    const pooled = tagged.as(PooledSocket);
                    // If this pooled socket carries a CONNECT tunnel, any
                    // idle data is inner-TLS traffic (close_notify, alert,
                    // pipelined bytes) that we can't process without the
                    // SSLWrapper. We'd hand back a tunnel whose inner state
                    // diverged from ours. Evict it.
                    if (pooled.proxy_tunnel != null) {
                        log("Data on idle pooled tunnel — evicting", .{});
                        terminateSocket(socket);
                        return;
                    }

                    if (pooled.h2_session) |session| {
                        session.onIdleData(buf);
                        if (!session.canPool()) terminateSocket(socket);
                        return;
                    }

                    // trailing zero is fine to ignore
                    if (strings.eqlComptime(buf, bun.http.end_of_chunked_http1_1_encoding_response_body)) {
                        return;
                    }

                    log("Unexpected data on socket", .{});

                    return;
                }
                log("Unexpected data on unknown socket", .{});
                terminateSocket(socket);
            }
            pub fn onWritable(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onWritable(
                        false,
                        comptime ssl,
                        socket,
                    );
                } else if (tagged.get(H2.ClientSession)) |session| {
                    return session.onWritable();
                } else if (tagged.is(PooledSocket)) {
                    // it's a keep-alive socket
                } else {
                    // don't know what this is, let's close it
                    log("Unexpected writable on socket", .{});
                    terminateSocket(socket);
                }
            }
            pub fn onLongTimeout(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onTimeout(comptime ssl, socket);
                }
                if (tagged.get(H2.ClientSession)) |session| {
                    markSocketAsDead(socket);
                    session.onClose(error.Timeout);
                }

                terminateSocket(socket);
            }
            pub fn onConnectError(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
            ) void {
                const tagged = getTagged(ptr);
                markTaggedSocketAsDead(socket, tagged);
                if (tagged.get(HTTPClient)) |client| {
                    client.onConnectError();
                }
                // us_connecting_socket_close is always called internally by uSockets
            }
            pub fn onEnd(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                // TCP fin must be closed, but we must keep the original tagged
                // pointer so that their onClose callback is called.
                //
                // Three possible states:
                // 1. HTTP Keep-Alive socket: it must be removed from the pool
                // 2. HTTP Client socket: it might need to be retried
                // 3. Dead socket: it is already marked as dead
                const tagged = getTagged(ptr);
                markTaggedSocketAsDead(socket, tagged);
                socket.close(.failure);

                if (tagged.get(HTTPClient)) |client| {
                    client.onClose(comptime ssl, socket);
                    return;
                }
                if (tagged.get(H2.ClientSession)) |session| {
                    session.onClose(error.ConnectionClosed);
                    return;
                }
            }
        };

        const ExistingSocket = struct {
            socket: HTTPSocket,
            /// Non-null if the socket carries an established CONNECT tunnel.
            /// Ownership (one strong ref) is transferred to the caller.
            tunnel: ?*ProxyTunnel,
            /// Non-null if the socket negotiated "h2"; ownership transferred.
            h2_session: ?*H2.ClientSession,
        };

        fn existingSocket(
            this: *@This(),
            reject_unauthorized: bool,
            hostname: []const u8,
            port: u16,
            ssl_config: ?*SSLConfig,
            want_tunnel: bool,
            target_hostname: []const u8,
            target_port: u16,
            proxy_auth_hash: u64,
            want_h2: BoringSSL.SSL.AlpnOffer,
        ) ?ExistingSocket {
            if (hostname.len > MAX_KEEPALIVE_HOSTNAME)
                return null;

            var iter = this.pending_sockets.used.iterator(.{ .kind = .set });

            while (iter.next()) |pending_socket_index| {
                var socket = this.pending_sockets.at(@as(u16, @intCast(pending_socket_index)));
                if (socket.port != port) {
                    continue;
                }

                // Match ssl_config by pointer equality (interned configs)
                if (SSLConfig.rawPtr(socket.ssl_config) != ssl_config) {
                    continue;
                }

                if (socket.did_have_handshaking_error_while_reject_unauthorized_is_false and reject_unauthorized) {
                    continue;
                }

                // ALPN on the pooled socket has already decided which protocol
                // it speaks; only match callers compatible with that choice.
                if (socket.h2_session != null) {
                    if (want_h2 == .h1) continue;
                } else if (want_h2 == .h2_only) {
                    continue;
                }

                // Tunnel presence must match: a direct-connection socket cannot
                // serve a tunneled request and vice versa.
                if (want_tunnel != (socket.proxy_tunnel != null)) {
                    continue;
                }

                if (want_tunnel) {
                    if (socket.proxy_auth_hash != proxy_auth_hash) {
                        continue;
                    }
                    if (socket.target_port != target_port) {
                        continue;
                    }
                    if (!strings.eqlLong(socket.target_hostname, target_hostname, true)) {
                        continue;
                    }
                    // A tunnel established with reject_unauthorized=false never
                    // ran checkServerIdentity — a CA-valid wrong-hostname cert
                    // leaves did_have_handshaking_error=false so the outer
                    // guard passes. Block a strict caller from reusing it.
                    if (reject_unauthorized and !socket.proxy_tunnel.?.data.established_with_reject_unauthorized) {
                        continue;
                    }
                }

                if (strings.eqlLong(socket.hostname_buf[0..socket.hostname_len], hostname, true)) {
                    const http_socket = socket.http_socket;

                    if (http_socket.isClosed()) {
                        markSocketAsDead(http_socket);
                        continue;
                    }

                    if (http_socket.isShutdown() or http_socket.getError() != 0) {
                        terminateSocket(http_socket);
                        continue;
                    }

                    // Release the pool's strong ref (caller has its own via tls_props)
                    if (socket.ssl_config) |*s| s.deinit();
                    socket.ssl_config = null;
                    // Transfer tunnel ownership to the caller.
                    const tunnel: ?*ProxyTunnel = if (socket.proxy_tunnel) |*rp| rp.leak() else null;
                    socket.proxy_tunnel = null;
                    if (socket.target_hostname.len > 0) {
                        bun.default_allocator.free(socket.target_hostname);
                        socket.target_hostname = "";
                    }
                    const h2_session = socket.h2_session;
                    socket.h2_session = null;
                    assert(this.pending_sockets.put(socket));
                    log("+ Keep-Alive reuse {s}:{d}{s}", .{ hostname, port, if (tunnel != null) " (with tunnel)" else "" });
                    return .{ .socket = http_socket, .tunnel = tunnel, .h2_session = h2_session };
                }
            }

            return null;
        }

        pub fn connectSocket(this: *@This(), client: *HTTPClient, socket_path: []const u8) !?HTTPSocket {
            client.connected_url = if (client.http_proxy) |proxy| proxy else client.url;
            const socket = try HTTPSocket.connectUnixAnon(
                socket_path,
                this.us_socket_context,
                ActiveSocket.init(client).ptr(),
                false, // dont allow half-open sockets
            );
            client.allow_retry = false;
            return socket;
        }

        pub fn connect(this: *@This(), client: *HTTPClient, hostname_: []const u8, port: u16) !?HTTPSocket {
            const hostname = if (FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(hostname_, "localhost"))
                "127.0.0.1"
            else
                hostname_;

            client.connected_url = if (client.http_proxy) |proxy| proxy else client.url;
            client.connected_url.hostname = hostname;

            if (comptime ssl) {
                if (client.canOfferH2()) {
                    for (this.active_h2_sessions.items) |session| {
                        if (session.hasHeadroom() and session.matches(hostname, port, SSLConfig.rawPtr(client.tls_props))) {
                            session.adopt(client);
                            return null;
                        }
                    }
                    for (this.pending_h2_connects.items) |pc| {
                        if (pc.matches(hostname, port, SSLConfig.rawPtr(client.tls_props))) {
                            bun.handleOom(pc.waiters.append(bun.default_allocator, client));
                            return null;
                        }
                    }
                }
            }

            if (client.isKeepAlivePossible()) {
                const want_tunnel = client.http_proxy != null and client.url.isHTTPS();
                // CONNECT TCP target (writeProxyConnect line 346). The SNI
                // override (client.hostname) is hashed into proxyAuthHash.
                const target_hostname: []const u8 = if (want_tunnel) client.url.hostname else "";
                const target_port: u16 = if (want_tunnel) client.url.getPortAuto() else 0;
                const proxy_auth_hash: u64 = if (want_tunnel) client.proxyAuthHash() else 0;

                if (this.existingSocket(
                    client.flags.reject_unauthorized,
                    hostname,
                    port,
                    SSLConfig.rawPtr(client.tls_props),
                    want_tunnel,
                    target_hostname,
                    target_port,
                    proxy_auth_hash,
                    if (comptime ssl) client.alpnOffer() else .h1,
                )) |found| {
                    const sock = found.socket;
                    if (sock.ext(**anyopaque)) |ctx| {
                        ctx.* = bun.cast(**anyopaque, ActiveSocket.init(client).ptr());
                    }
                    client.allow_retry = true;
                    if (found.h2_session) |session| {
                        if (comptime ssl) {
                            session.socket = sock;
                            tagAsH2(sock, session);
                            this.registerH2(session);
                            session.adopt(client);
                        } else unreachable;
                        return null;
                    }
                    if (found.tunnel) |tunnel| {
                        // Reattach the pooled tunnel BEFORE onOpen so the
                        // request/response stage is already .proxy_headers.
                        // onOpen only promotes .pending -> .opened, and
                        // firstCall only acts on .opened/.pending, so both
                        // become no-ops for the CONNECT/handshake phases.
                        tunnel.adopt(client, comptime ssl, sock);
                        try client.onOpen(comptime ssl, sock);
                        client.onWritable(true, comptime ssl, sock);
                    } else {
                        try client.onOpen(comptime ssl, sock);
                        if (comptime ssl) {
                            client.firstCall(comptime ssl, sock);
                        }
                    }
                    return sock;
                }
            }

            const socket = try HTTPSocket.connectAnon(
                hostname,
                port,
                this.us_socket_context,
                ActiveSocket.init(client).ptr(),
                false,
            );
            client.allow_retry = false;
            if (comptime ssl) {
                if (client.canOfferH2()) {
                    const pc = H2.PendingConnect.new(.{
                        .hostname = bun.handleOom(bun.default_allocator.dupe(u8, hostname)),
                        .port = port,
                        .ssl_config = SSLConfig.rawPtr(client.tls_props),
                    });
                    bun.handleOom(this.pending_h2_connects.append(bun.default_allocator, pc));
                    client.pending_h2 = pc;
                }
            }
            return socket;
        }
    };
}

const DeadSocket = struct {
    garbage: u8 = 0,
    /// Must be aligned to `@alignOf(usize)` so that tagged pointer values
    /// embedding this address pass the `@alignCast` in `bun.cast`.
    pub var dead_socket: DeadSocket align(@alignOf(usize)) = .{};
};

var dead_socket = &DeadSocket.dead_socket;
const log = bun.Output.scoped(.HTTPContext, .hidden);

const HTTPCertError = @import("./HTTPCertError.zig");
const HTTPThread = @import("./HTTPThread.zig");
const ProxyTunnel = @import("./ProxyTunnel.zig");
const std = @import("std");
const TaggedPointerUnion = @import("../ptr.zig").TaggedPointerUnion;

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const assert = bun.assert;
const strings = bun.strings;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const HTTPClient = bun.http;
const H2 = bun.http.H2;
const InitError = HTTPClient.InitError;
