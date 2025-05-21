const bun = @import("bun");

const BoringSSL = bun.BoringSSL.c;
const X509 = @import("./x509.zig");
const JSC = bun.JSC;
const uws = bun.uws;
const log = bun.Output.scoped(.SSLWrapper, true);

/// Mimics the behavior of openssl.c in uSockets, wrapping data that can be received from any where (network, DuplexStream, etc)
pub fn SSLWrapper(comptime T: type) type {
    // receiveData() is called when we receive data from the network (encrypted data that will be decrypted by SSLWrapper)
    // writeData() is called when we want to send data to the network (unencrypted data that will be encrypted by SSLWrapper)

    // after init we need to call start() to start the SSL handshake
    // this will trigger the onOpen callback before the handshake starts and the onHandshake callback after the handshake completes
    // onData and write callbacks are triggered when we have data to read or write respectively
    // onData will pass the decrypted data that we received from the network
    // write will pass the encrypted data that we want to send to the network
    // onClose callback is triggered when we wanna the network connection to be closed (remember to flush the data before closing the connection)

    // Notes:
    // SSL_read() read unencrypted data which is stored in the input BIO.
    // SSL_write() write unencrypted data into the output BIO.
    // BIO_write() write encrypted data into the input BIO.
    // BIO_read() read encrypted data from the output BIO.

    return struct {
        const This = @This();
        // 64kb nice buffer size for SSL reads and writes, should be enough for most cases
        // in reads we loop until we have no more data to read and in writes we loop until we have no more data to write/backpressure
        const BUFFER_SIZE = 65536;

        handlers: Handlers,
        ssl: ?*BoringSSL.SSL,
        ctx: ?*BoringSSL.SSL_CTX,

        flags: Flags = .{},

        pub const Flags = packed struct(u8) {
            handshake_state: HandshakeState = HandshakeState.HANDSHAKE_PENDING,
            received_ssl_shutdown: bool = false,
            sent_ssl_shutdown: bool = false,
            is_client: bool = false,
            authorized: bool = false,
            fatal_error: bool = false,
            closed_notified: bool = false,
        };
        pub const HandshakeState = enum(u2) {
            HANDSHAKE_PENDING = 0,
            HANDSHAKE_COMPLETED = 1,
            HANDSHAKE_RENEGOTIATION_PENDING = 2,
        };
        pub const Handlers = struct {
            ctx: T,
            onOpen: *const fn (T) void,
            onHandshake: *const fn (T, bool, uws.us_bun_verify_error_t) void,
            write: *const fn (T, []const u8) void,
            onData: *const fn (T, []const u8) void,
            onClose: *const fn (T) void,
        };

        /// Initialize the SSLWrapper with a specific SSL_CTX*, remember to call SSL_CTX_up_ref if you want to keep the SSL_CTX alive after the SSLWrapper is deinitialized
        pub fn initWithCTX(ctx: *BoringSSL.SSL_CTX, is_client: bool, handlers: Handlers) !This {
            bun.BoringSSL.load();
            const ssl = BoringSSL.SSL_new(ctx) orelse return error.OutOfMemory;
            errdefer BoringSSL.SSL_free(ssl);

            // OpenSSL enables TLS renegotiation by default and accepts renegotiation requests from the peer transparently. Renegotiation is an extremely problematic protocol feature, so BoringSSL rejects peer renegotiations by default.
            // We explicitly set the SSL_set_renegotiate_mode so if we switch to OpenSSL we keep the same behavior
            // See: https://boringssl.googlesource.com/boringssl/+/HEAD/PORTING.md#TLS-renegotiation
            if (is_client) {
                // Set the renegotiation mode to explicit so that we can renegotiate on the client side if needed (better performance than ssl_renegotiate_freely)
                // BoringSSL: Renegotiation is only supported as a client in TLS and the HelloRequest must be received at a quiet point in the application protocol. This is sufficient to support the common use of requesting a new client certificate between an HTTP request and response in (unpipelined) HTTP/1.1.
                BoringSSL.SSL_set_renegotiate_mode(ssl, BoringSSL.ssl_renegotiate_explicit);
                BoringSSL.SSL_set_connect_state(ssl);
            } else {
                // Set the renegotiation mode to never so that we can't renegotiate on the server side (security reasons)
                // BoringSSL: There is no support for renegotiation as a server. (Attempts by clients will result in a fatal alert so that ClientHello messages cannot be used to flood a server and escape higher-level limits.)
                BoringSSL.SSL_set_renegotiate_mode(ssl, BoringSSL.ssl_renegotiate_never);
                BoringSSL.SSL_set_accept_state(ssl);
            }
            const input = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse return error.OutOfMemory;
            errdefer _ = BoringSSL.BIO_free(input);
            const output = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse return error.OutOfMemory;
            // Set the EOF return value to -1 so that we can detect when the BIO is empty using BIO_ctrl_pending
            _ = BoringSSL.BIO_set_mem_eof_return(input, -1);
            _ = BoringSSL.BIO_set_mem_eof_return(output, -1);
            // Set the input and output BIOs
            BoringSSL.SSL_set_bio(ssl, input, output);

            return .{
                .handlers = handlers,
                .flags = .{ .is_client = is_client },
                .ctx = ctx,
                .ssl = ssl,
            };
        }

        pub fn init(ssl_options: JSC.API.ServerConfig.SSLConfig, is_client: bool, handlers: Handlers) !This {
            bun.BoringSSL.load();

            const ctx_opts: uws.us_bun_socket_context_options_t = JSC.API.ServerConfig.SSLConfig.asUSockets(ssl_options);
            var err: uws.create_bun_socket_error_t = .none;
            // Create SSL context using uSockets to match behavior of node.js
            const ctx = uws.create_ssl_context_from_bun_options(ctx_opts, &err) orelse return error.InvalidOptions; // invalid options
            errdefer BoringSSL.SSL_CTX_free(ctx);
            return try This.initWithCTX(ctx, is_client, handlers);
        }

        pub fn start(this: *This) void {
            // trigger the onOpen callback so the user can configure the SSL connection before first handshake
            this.handlers.onOpen(this.handlers.ctx);
            // start the handshake
            this.handleTraffic();
        }
        pub fn startWithPayload(this: *This, payload: []const u8) void {
            this.handlers.onOpen(this.handlers.ctx);
            this.receiveData(payload);
            // start the handshake
            this.handleTraffic();
        }

        /// Shutdown the read direction of the SSL (fake it just for convenience)
        pub fn shutdownRead(this: *This) void {
            // We cannot shutdown read in SSL, the read direction is closed by the peer.
            // So we just ignore the onData data, we still wanna to wait until we received the shutdown
            const DummyReadHandler = struct {
                fn onData(_: T, _: []const u8) void {}
            };
            this.handlers.onData = DummyReadHandler.onData;
        }
        /// Shutdown the write direction of the SSL and returns if we are completed closed or not
        /// We cannot assume that the read part will remain open after we sent a shutdown, the other side will probably complete the 2-step shutdown ASAP.
        /// Caution: never reuse a socket if fast_shutdown = true, this will also fully close both read and write directions
        pub fn shutdown(this: *This, fast_shutdown: bool) bool {
            const ssl = this.ssl orelse return false;
            // we already sent the ssl shutdown
            if (this.flags.sent_ssl_shutdown or this.flags.fatal_error) return this.flags.received_ssl_shutdown;

            // Calling SSL_shutdown() only closes the write direction of the connection; the read direction is closed by the peer.
            // Once SSL_shutdown() is called, SSL_write(3) can no longer be used, but SSL_read(3) may still be used until the peer decides to close the connection in turn.
            // The peer might continue sending data for some period of time before handling the local application's shutdown indication.
            // This will start a full shutdown process if fast_shutdown = false, we can assume that the other side will complete the 2-step shutdown ASAP.
            const ret = BoringSSL.SSL_shutdown(ssl);
            // when doing a fast shutdown we don't need to wait for the peer to send a shutdown so we just call SSL_shutdown again
            if (fast_shutdown) {
                // This allows for a more rapid shutdown process if the application does not wish to wait for the peer.
                // This alternative "fast shutdown" approach should only be done if it is known that the peer will not send more data, otherwise there is a risk of an application exposing itself to a truncation attack.
                // The full SSL_shutdown() process, in which both parties send close_notify alerts and SSL_shutdown() returns 1, provides a cryptographically authenticated indication of the end of a connection.

                // The fast shutdown approach can only be used if there is no intention to reuse the underlying connection (e.g. a TCP connection) for further communication; in this case, the full shutdown process must be performed to ensure synchronisation.
                _ = BoringSSL.SSL_shutdown(ssl);
                this.flags.received_ssl_shutdown = true;
                // Reset pending handshake because we are closed for sure now
                if (this.flags.handshake_state != HandshakeState.HANDSHAKE_COMPLETED) {
                    this.flags.handshake_state = HandshakeState.HANDSHAKE_COMPLETED;
                    this.triggerHandshakeCallback(false, this.getVerifyError());
                }

                // we need to trigger close because we are not receiving a SSL_shutdown
                this.triggerCloseCallback();
                return false;
            }

            // we sent the shutdown
            this.flags.sent_ssl_shutdown = ret >= 0;
            if (ret < 0) {
                const err = BoringSSL.SSL_get_error(ssl, ret);
                BoringSSL.ERR_clear_error();

                if (err == BoringSSL.SSL_ERROR_SSL or err == BoringSSL.SSL_ERROR_SYSCALL) {
                    this.flags.fatal_error = true;
                    this.triggerCloseCallback();
                    return false;
                }
            }
            return ret == 1; // truly closed
        }

        // flush buffered data and returns amount of pending data to write
        pub fn flush(this: *This) usize {
            const ssl = this.ssl orelse return 0;
            this.handleTraffic();
            const pending = BoringSSL.BIO_ctrl_pending(BoringSSL.SSL_get_wbio(ssl));
            if (pending > 0) return @intCast(pending);
            return 0;
        }

        // Return if we have pending data to be read or write
        pub fn hasPendingData(this: *const This) bool {
            const ssl = this.ssl orelse return false;
            return BoringSSL.BIO_ctrl_pending(BoringSSL.SSL_get_wbio(ssl)) > 0 or BoringSSL.BIO_ctrl_pending(BoringSSL.SSL_get_rbio(ssl)) > 0;
        }

        /// Return if we buffered data inside the BIO read buffer, not necessarily will return data to read
        /// this dont reflect SSL_pending()
        fn hasPendingRead(this: *const This) bool {
            const ssl = this.ssl orelse return false;
            return BoringSSL.BIO_ctrl_pending(BoringSSL.SSL_get_rbio(ssl)) > 0;
        }
        // We sent or received a shutdown (closing or closed)
        pub fn isShutdown(this: *const This) bool {
            return this.flags.closed_notified or this.flags.received_ssl_shutdown or this.flags.sent_ssl_shutdown;
        }

        // We sent and received the shutdown (fully closed)
        pub fn isClosed(this: *const This) bool {
            return this.flags.received_ssl_shutdown and this.flags.sent_ssl_shutdown;
        }

        pub fn isAuthorized(this: *This) bool {
            // handshake ended we know if we are authorized or not
            if (this.flags.handshake_state == HandshakeState.HANDSHAKE_COMPLETED) {
                return this.flags.authorized;
            }
            // hanshake still in progress
            return false;
        }

        // Receive data from the network (encrypted data)
        pub fn receiveData(this: *This, data: []const u8) void {
            const ssl = this.ssl orelse return;

            const input = BoringSSL.SSL_get_rbio(ssl) orelse return;
            const written = BoringSSL.BIO_write(input, data.ptr, @as(c_int, @intCast(data.len)));
            if (written > -1) {
                this.handleTraffic();
            }
        }

        // Send data to the network (unencrypted data)
        pub fn writeData(this: *This, data: []const u8) !usize {
            const ssl = this.ssl orelse return error.ConnectionClosed;

            // shutdown is sent we cannot write anymore
            if (this.flags.sent_ssl_shutdown) return error.ConnectionClosed;

            if (data.len == 0) {
                // just cycle through internal openssl's state
                this.handleTraffic();
                return 0;
            }
            const written = BoringSSL.SSL_write(ssl, data.ptr, @as(c_int, @intCast(data.len)));
            if (written <= 0) {
                const err = BoringSSL.SSL_get_error(ssl, written);
                BoringSSL.ERR_clear_error();

                if (err == BoringSSL.SSL_ERROR_WANT_READ) {
                    // we wanna read/write
                    this.handleTraffic();
                    return error.WantRead;
                }
                if (err == BoringSSL.SSL_ERROR_WANT_WRITE) {
                    // we wanna read/write
                    this.handleTraffic();
                    return error.WantWrite;
                }
                // some bad error happened here we must close
                this.flags.fatal_error = err == BoringSSL.SSL_ERROR_SSL or err == BoringSSL.SSL_ERROR_SYSCALL;
                this.triggerCloseCallback();
                return error.ConnectionClosed;
            }
            this.handleTraffic();
            return @intCast(written);
        }

        pub fn deinit(this: *This) void {
            this.flags.closed_notified = true;
            if (this.ssl) |ssl| {
                this.ssl = null;
                // SSL_free will also free the input and output BIOs
                _ = BoringSSL.SSL_free(ssl);
            }
            if (this.ctx) |ctx| {
                this.ctx = null;
                // SSL_CTX_free will free the SSL context and all the certificates
                _ = BoringSSL.SSL_CTX_free(ctx);
            }
        }

        fn triggerHandshakeCallback(this: *This, success: bool, result: uws.us_bun_verify_error_t) void {
            if (this.flags.closed_notified) return;

            this.flags.authorized = success;
            // trigger the handshake callback
            this.handlers.onHandshake(this.handlers.ctx, success, result);
        }

        fn triggerWannaWriteCallback(this: *This, data: []const u8) void {
            if (this.flags.closed_notified) return;

            // trigger the write callback
            this.handlers.write(this.handlers.ctx, data);
        }

        fn triggerDataCallback(this: *This, data: []const u8) void {
            if (this.flags.closed_notified) return;

            // trigger the onData callback
            this.handlers.onData(this.handlers.ctx, data);
        }

        fn triggerCloseCallback(this: *This) void {
            if (this.flags.closed_notified) return;
            this.flags.closed_notified = true;
            // trigger the onClose callback
            this.handlers.onClose(this.handlers.ctx);
        }

        fn getVerifyError(this: *This) uws.us_bun_verify_error_t {
            if (this.isShutdown()) {
                return .{};
            }
            const ssl = this.ssl orelse return .{};
            return uws.us_ssl_socket_verify_error_from_ssl(ssl);
        }

        /// Update the handshake state
        /// Returns true if we can call handleReading
        fn updateHandshakeState(this: *This) bool {
            if (this.flags.closed_notified) return false;
            const ssl = this.ssl orelse return false;

            if (BoringSSL.SSL_is_init_finished(ssl) != 0) {
                // handshake already completed nothing to do here
                if ((BoringSSL.SSL_get_shutdown(ssl) & BoringSSL.SSL_RECEIVED_SHUTDOWN) != 0) {
                    // we received a shutdown
                    this.flags.received_ssl_shutdown = true;
                    // 2-step shutdown
                    _ = this.shutdown(false);
                    this.triggerCloseCallback();

                    return false;
                }
                return true;
            }

            if (this.flags.handshake_state == HandshakeState.HANDSHAKE_RENEGOTIATION_PENDING) {
                // we are in the middle of a renegotiation need to call read/write
                return true;
            }

            const result = BoringSSL.SSL_do_handshake(ssl);

            if (result <= 0) {
                const err = BoringSSL.SSL_get_error(ssl, result);
                BoringSSL.ERR_clear_error();
                if (err == BoringSSL.SSL_ERROR_ZERO_RETURN) {
                    // Remotely-Initiated Shutdown
                    // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                    this.flags.received_ssl_shutdown = true;
                    // 2-step shutdown
                    _ = this.shutdown(false);
                    this.handleEndOfRenegotiation();
                    return false;
                }
                // as far as I know these are the only errors we want to handle
                if (err != BoringSSL.SSL_ERROR_WANT_READ and err != BoringSSL.SSL_ERROR_WANT_WRITE) {
                    // clear per thread error queue if it may contain something
                    this.flags.fatal_error = err == BoringSSL.SSL_ERROR_SSL or err == BoringSSL.SSL_ERROR_SYSCALL;

                    this.flags.handshake_state = HandshakeState.HANDSHAKE_COMPLETED;
                    this.triggerHandshakeCallback(false, this.getVerifyError());

                    if (this.flags.fatal_error) {
                        this.triggerCloseCallback();
                        return false;
                    }
                    return true;
                }
                this.flags.handshake_state = HandshakeState.HANDSHAKE_PENDING;
                return true;
            }

            // handshake completed
            this.flags.handshake_state = HandshakeState.HANDSHAKE_COMPLETED;
            this.triggerHandshakeCallback(true, this.getVerifyError());

            return true;
        }

        /// Handle the end of a renegotiation if it was pending
        /// This function is called when we receive a SSL_ERROR_ZERO_RETURN or successfully read data
        fn handleEndOfRenegotiation(this: *This) void {
            if (this.flags.handshake_state == HandshakeState.HANDSHAKE_RENEGOTIATION_PENDING and (this.ssl == null or BoringSSL.SSL_is_init_finished(this.ssl) != 0)) {
                // renegotiation ended successfully call on_handshake
                this.flags.handshake_state = HandshakeState.HANDSHAKE_COMPLETED;
                this.triggerHandshakeCallback(true, this.getVerifyError());
            }
        }

        /// Handle reading data
        /// Returns true if we can call handleWriting
        fn handleReading(this: *This, buffer: *[BUFFER_SIZE]u8) bool {
            var read: usize = 0;

            // read data from the input BIO
            while (true) {
                log("handleReading", .{});
                const ssl = this.ssl orelse return false;

                const available = buffer[read..];
                const just_read = BoringSSL.SSL_read(ssl, available.ptr, @intCast(available.len));
                log("just read {d}", .{just_read});
                if (just_read <= 0) {
                    const err = BoringSSL.SSL_get_error(ssl, just_read);
                    BoringSSL.ERR_clear_error();

                    if (err != BoringSSL.SSL_ERROR_WANT_READ and err != BoringSSL.SSL_ERROR_WANT_WRITE) {
                        if (err == BoringSSL.SSL_ERROR_WANT_RENEGOTIATE) {
                            this.flags.handshake_state = HandshakeState.HANDSHAKE_RENEGOTIATION_PENDING;
                            if (BoringSSL.SSL_renegotiate(ssl) == 0) {
                                this.flags.handshake_state = HandshakeState.HANDSHAKE_COMPLETED;
                                // we failed to renegotiate
                                this.triggerHandshakeCallback(false, this.getVerifyError());
                                this.triggerCloseCallback();
                                return false;
                            }
                            // ok, we are done here, we need to call SSL_read again
                            // this dont mean that we are done with the handshake renegotiation
                            // we need to call SSL_read again
                            continue;
                        } else if (err == BoringSSL.SSL_ERROR_ZERO_RETURN) {
                            // Remotely-Initiated Shutdown
                            // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                            this.flags.received_ssl_shutdown = true;
                            // 2-step shutdown
                            _ = this.shutdown(false);
                            this.handleEndOfRenegotiation();
                        }
                        this.flags.fatal_error = err == BoringSSL.SSL_ERROR_SSL or err == BoringSSL.SSL_ERROR_SYSCALL;

                        // flush the reading
                        if (read > 0) {
                            log("triggering data callback (read {d})", .{read});
                            this.triggerDataCallback(buffer[0..read]);
                        }
                        this.triggerCloseCallback();
                        return false;
                    } else {
                        log("wanna read/write just break", .{});
                        // we wanna read/write just break
                        break;
                    }
                }

                this.handleEndOfRenegotiation();

                read += @intCast(just_read);
                if (read == buffer.len) {
                    log("triggering data callback (read {d}) and resetting read buffer", .{read});
                    // we filled the buffer
                    this.triggerDataCallback(buffer[0..read]);
                    read = 0;
                }
            }
            // we finished reading
            if (read > 0) {
                log("triggering data callback (read {d})", .{read});
                this.triggerDataCallback(buffer[0..read]);
            }
            return true;
        }

        fn handleWriting(this: *This, buffer: *[BUFFER_SIZE]u8) void {
            var read: usize = 0;
            while (true) {
                const ssl = this.ssl orelse return;
                const output = BoringSSL.SSL_get_wbio(ssl) orelse return;
                const available = buffer[read..];
                const just_read = BoringSSL.BIO_read(output, available.ptr, @intCast(available.len));
                if (just_read > 0) {
                    read += @intCast(just_read);
                    if (read == buffer.len) {
                        this.triggerWannaWriteCallback(buffer[0..read]);
                        read = 0;
                    }
                } else {
                    break;
                }
            }
            if (read > 0) {
                this.triggerWannaWriteCallback(buffer[0..read]);
            }
        }

        fn handleTraffic(this: *This) void {

            // always handle the handshake first
            if (this.updateHandshakeState()) {
                // shared stack buffer for reading and writing
                var buffer: [BUFFER_SIZE]u8 = undefined;
                // drain the input BIO first
                this.handleWriting(&buffer);

                // drain the output BIO in loop, because read can trigger writing and vice versa
                while (this.hasPendingRead() and this.handleReading(&buffer)) {
                    // read data can trigger writing so we need to handle it
                    this.handleWriting(&buffer);
                }
            }
        }
    };
}
