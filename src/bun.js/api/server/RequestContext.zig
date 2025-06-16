pub fn NewRequestContext(comptime ssl_enabled: bool, comptime debug_mode: bool, comptime ThisServer: type) type {
    return struct {
        const RequestContext = @This();

        const App = uws.NewApp(ssl_enabled);
        pub threadlocal var pool: ?*RequestContext.RequestContextStackAllocator = null;
        pub const ResponseStream = JSC.WebCore.HTTPServerWritable(ssl_enabled);

        // This pre-allocates up to 2,048 RequestContext structs.
        // It costs about 655,632 bytes.
        pub const RequestContextStackAllocator = bun.HiveArray(RequestContext, if (bun.heap_breakdown.enabled) 0 else 2048).Fallback;

        server: ?*ThisServer,
        resp: ?*App.Response,
        /// thread-local default heap allocator
        /// this prevents an extra pthread_getspecific() call which shows up in profiling
        allocator: std.mem.Allocator,
        req: ?*uws.Request,
        request_weakref: Request.WeakRef = .empty,
        signal: ?*JSC.WebCore.AbortSignal = null,
        method: HTTP.Method,
        cookies: ?*JSC.WebCore.CookieMap = null,

        flags: NewFlags(debug_mode) = .{},

        upgrade_context: ?*uws.SocketContext = null,

        /// We can only safely free once the request body promise is finalized
        /// and the response is rejected
        response_jsvalue: JSC.JSValue = JSC.JSValue.zero,
        ref_count: u8 = 1,

        response_ptr: ?*JSC.WebCore.Response = null,
        blob: JSC.WebCore.Blob.Any = JSC.WebCore.Blob.Any{ .Blob = .{} },

        sendfile: SendfileContext = undefined,

        request_body_readable_stream_ref: JSC.WebCore.ReadableStream.Strong = .{},
        request_body: ?*WebCore.Body.Value.HiveRef = null,
        request_body_buf: std.ArrayListUnmanaged(u8) = .{},
        request_body_content_len: usize = 0,

        sink: ?*ResponseStream.JSSink = null,
        byte_stream: ?*JSC.WebCore.ByteStream = null,
        // reference to the readable stream / byte_stream alive
        readable_stream_ref: JSC.WebCore.ReadableStream.Strong = .{},

        /// Used in errors
        pathname: bun.String = bun.String.empty,

        /// Used either for temporary blob data or fallback
        /// When the response body is a temporary value
        response_buf_owned: std.ArrayListUnmanaged(u8) = .{},

        /// Defer finalization until after the request handler task is completed?
        defer_deinit_until_callback_completes: ?*bool = null,

        // TODO: support builtin compression
        const can_sendfile = !ssl_enabled and !Environment.isWindows;

        pub fn memoryCost(this: *const RequestContext) usize {
            // The Sink and ByteStream aren't owned by this.
            return @sizeOf(RequestContext) + this.request_body_buf.capacity + this.response_buf_owned.capacity + this.blob.memoryCost();
        }

        pub inline fn isAsync(this: *const RequestContext) bool {
            return this.defer_deinit_until_callback_completes == null;
        }

        fn drainMicrotasks(this: *const RequestContext) void {
            if (this.isAsync()) return;
            if (this.server) |server| server.vm.drainMicrotasks();
        }

        pub fn setAbortHandler(this: *RequestContext) void {
            if (this.flags.has_abort_handler) return;
            if (this.resp) |resp| {
                this.flags.has_abort_handler = true;
                resp.onAborted(*RequestContext, RequestContext.onAbort, this);
            }
        }

        pub fn setCookies(this: *RequestContext, cookie_map: ?*JSC.WebCore.CookieMap) void {
            if (this.cookies) |cookies| cookies.deref();
            this.cookies = cookie_map;
            if (this.cookies) |cookies| cookies.ref();
        }

        pub fn setTimeoutHandler(this: *RequestContext) void {
            if (this.flags.has_timeout_handler) return;
            if (this.resp) |resp| {
                this.flags.has_timeout_handler = true;
                resp.onTimeout(*RequestContext, RequestContext.onTimeout, this);
            }
        }

        pub fn onResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            ctxLog("onResolve", .{});

            const arguments = callframe.arguments_old(2);
            var ctx = arguments.ptr[1].asPromisePtr(@This());
            defer ctx.deref();

            const result = arguments.ptr[0];
            result.ensureStillAlive();

            handleResolve(ctx, result);
            return .js_undefined;
        }

        fn renderMissingInvalidResponse(ctx: *RequestContext, value: JSC.JSValue) void {
            const class_name = value.getClassInfoName() orelse "";

            if (ctx.server) |server| {
                const globalThis: *JSC.JSGlobalObject = server.globalThis;

                Output.enableBuffering();
                var writer = Output.errorWriter();

                if (bun.strings.eqlComptime(class_name, "Response")) {
                    Output.errGeneric("Expected a native Response object, but received a polyfilled Response object. Bun.serve() only supports native Response objects.", .{});
                } else if (value != .zero and !globalThis.hasException()) {
                    var formatter = JSC.ConsoleObject.Formatter{
                        .globalThis = globalThis,
                        .quote_strings = true,
                    };
                    defer formatter.deinit();
                    Output.errGeneric("Expected a Response object, but received '{}'", .{value.toFmt(&formatter)});
                } else {
                    Output.errGeneric("Expected a Response object", .{});
                }

                Output.flush();
                if (!globalThis.hasException()) {
                    JSC.ConsoleObject.writeTrace(@TypeOf(&writer), &writer, globalThis);
                }
                Output.flush();
            }
            ctx.renderMissing();
        }

        fn handleResolve(ctx: *RequestContext, value: JSC.JSValue) void {
            if (ctx.isAbortedOrEnded() or ctx.didUpgradeWebSocket()) {
                return;
            }

            if (ctx.server == null) {
                ctx.renderMissingInvalidResponse(value);
                return;
            }
            if (value.isEmptyOrUndefinedOrNull() or !value.isCell()) {
                ctx.renderMissingInvalidResponse(value);
                return;
            }

            const response = value.as(JSC.WebCore.Response) orelse {
                ctx.renderMissingInvalidResponse(value);
                return;
            };
            ctx.response_jsvalue = value;
            assert(!ctx.flags.response_protected);
            ctx.flags.response_protected = true;
            value.protect();

            if (ctx.method == .HEAD) {
                if (ctx.resp) |resp| {
                    var pair = HeaderResponsePair{ .this = ctx, .response = response };
                    resp.runCorkedWithType(*HeaderResponsePair, doRenderHeadResponse, &pair);
                }
                return;
            }

            ctx.render(response);
        }

        pub fn shouldRenderMissing(this: *RequestContext) bool {
            // If we did not respond yet, we should render missing
            // To allow this all the conditions above should be true:
            // 1 - still has a response (not detached)
            // 2 - not aborted
            // 3 - not marked completed
            // 4 - not marked pending
            // 5 - is the only reference of the context
            // 6 - is not waiting for request body
            // 7 - did not call sendfile
            return this.resp != null and !this.flags.aborted and !this.flags.has_marked_complete and !this.flags.has_marked_pending and this.ref_count == 1 and !this.flags.is_waiting_for_request_body and !this.flags.has_sendfile_ctx;
        }

        pub fn isDeadRequest(this: *RequestContext) bool {
            // check if has pending promise or extra reference (aka not the only reference)
            if (this.ref_count > 1) return false;
            // check if the body is Locked (streaming)
            if (this.request_body) |body| {
                if (body.value == .Locked) {
                    return false;
                }
            }

            return true;
        }

        /// destroy RequestContext, should be only called by deref or if defer_deinit_until_callback_completes is ref is set to true
        pub fn deinit(this: *RequestContext) void {
            this.detachResponse();
            this.endRequestStreamingAndDrain();
            // TODO: has_marked_complete is doing something?
            this.flags.has_marked_complete = true;

            if (this.defer_deinit_until_callback_completes) |defer_deinit| {
                defer_deinit.* = true;
                ctxLog("deferred deinit <d> ({*})<r>", .{this});
                return;
            }

            ctxLog("deinit<d> ({*})<r>", .{this});
            if (comptime Environment.isDebug)
                assert(this.flags.has_finalized);

            this.request_body_buf.clearAndFree(this.allocator);
            this.response_buf_owned.clearAndFree(this.allocator);

            if (this.request_body) |body| {
                _ = body.unref();
                this.request_body = null;
            }

            if (this.server) |server| {
                this.server = null;
                server.request_pool_allocator.put(this);
                server.onRequestComplete();
            }
        }

        pub fn deref(this: *RequestContext) void {
            streamLog("deref", .{});
            assert(this.ref_count > 0);
            const ref_count = this.ref_count;
            this.ref_count -= 1;
            if (ref_count == 1) {
                this.finalizeWithoutDeinit();
                this.deinit();
            }
        }

        pub fn ref(this: *RequestContext) void {
            streamLog("ref", .{});
            this.ref_count += 1;
        }

        pub fn onReject(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            ctxLog("onReject", .{});

            const arguments = callframe.arguments_old(2);
            const ctx = arguments.ptr[1].asPromisePtr(@This());
            const err = arguments.ptr[0];
            defer ctx.deref();
            handleReject(ctx, if (!err.isEmptyOrUndefinedOrNull()) err else .js_undefined);
            return .js_undefined;
        }

        fn handleReject(ctx: *RequestContext, value: JSC.JSValue) void {
            if (ctx.isAbortedOrEnded()) {
                return;
            }

            const resp = ctx.resp.?;
            const has_responded = resp.hasResponded();
            if (!has_responded) {
                const original_state = ctx.defer_deinit_until_callback_completes;
                var should_deinit_context = if (original_state) |defer_deinit| defer_deinit.* else false;
                ctx.defer_deinit_until_callback_completes = &should_deinit_context;
                ctx.runErrorHandler(
                    value,
                );
                ctx.defer_deinit_until_callback_completes = original_state;
                // we try to deinit inside runErrorHandler so we just return here and let it deinit
                if (should_deinit_context) {
                    ctx.deinit();
                    return;
                }
            }
            // check again in case it get aborted after runErrorHandler
            if (ctx.isAbortedOrEnded()) {
                return;
            }

            // I don't think this case happens?
            if (ctx.didUpgradeWebSocket()) {
                return;
            }

            if (!resp.hasResponded() and !ctx.flags.has_marked_pending and !ctx.flags.is_error_promise_pending) {
                ctx.renderMissing();
                return;
            }
        }

        pub fn renderMissing(ctx: *RequestContext) void {
            if (ctx.resp) |resp| {
                resp.runCorkedWithType(*RequestContext, renderMissingCorked, ctx);
            }
        }

        pub fn renderMissingCorked(ctx: *RequestContext) void {
            if (ctx.resp) |resp| {
                if (comptime !debug_mode) {
                    if (!ctx.flags.has_written_status)
                        resp.writeStatus("204 No Content");
                    ctx.flags.has_written_status = true;
                    ctx.end("", ctx.shouldCloseConnection());
                    return;
                }
                // avoid writing the status again and mismatching the content-length
                if (ctx.flags.has_written_status) {
                    ctx.end("", ctx.shouldCloseConnection());
                    return;
                }

                if (ctx.flags.is_web_browser_navigation) {
                    resp.writeStatus("200 OK");
                    ctx.flags.has_written_status = true;

                    resp.writeHeader("content-type", MimeType.html.value);
                    resp.writeHeader("content-encoding", "gzip");
                    resp.writeHeaderInt("content-length", welcome_page_html_gz.len);
                    ctx.end(welcome_page_html_gz, ctx.shouldCloseConnection());
                    return;
                }
                const missing_content = "Welcome to Bun! To get started, return a Response object.";
                resp.writeStatus("200 OK");
                resp.writeHeader("content-type", MimeType.text.value);
                resp.writeHeaderInt("content-length", missing_content.len);
                ctx.flags.has_written_status = true;
                ctx.end(missing_content, ctx.shouldCloseConnection());
            }
        }

        pub fn renderDefaultError(
            this: *RequestContext,
            log: *logger.Log,
            err: anyerror,
            exceptions: []Api.JsException,
            comptime fmt: string,
            args: anytype,
        ) void {
            if (!this.flags.has_written_status) {
                this.flags.has_written_status = true;
                if (this.resp) |resp| {
                    resp.writeStatus("500 Internal Server Error");
                    resp.writeHeader("content-type", MimeType.html.value);
                }
            }

            const allocator = this.allocator;

            const fallback_container = allocator.create(Api.FallbackMessageContainer) catch unreachable;
            defer allocator.destroy(fallback_container);
            fallback_container.* = Api.FallbackMessageContainer{
                .message = std.fmt.allocPrint(allocator, comptime Output.prettyFmt(fmt, false), args) catch unreachable,
                .router = null,
                .reason = .fetch_event_handler,
                .cwd = VirtualMachine.get().transpiler.fs.top_level_dir,
                .problems = Api.Problems{
                    .code = @as(u16, @truncate(@intFromError(err))),
                    .name = @errorName(err),
                    .exceptions = exceptions,
                    .build = log.toAPI(allocator) catch unreachable,
                },
            };

            if (comptime fmt.len > 0) Output.prettyErrorln(fmt, args);
            Output.flush();

            var bb = std.ArrayList(u8).init(allocator);
            const bb_writer = bb.writer();

            Fallback.renderBackend(
                allocator,
                fallback_container,
                @TypeOf(bb_writer),
                bb_writer,
            ) catch unreachable;
            if (this.resp == null or this.resp.?.tryEnd(bb.items, bb.items.len, this.shouldCloseConnection())) {
                bb.clearAndFree();
                this.detachResponse();
                this.endRequestStreamingAndDrain();
                this.finalizeWithoutDeinit();
                this.deref();
                return;
            }

            this.flags.has_marked_pending = true;
            this.response_buf_owned = std.ArrayListUnmanaged(u8){ .items = bb.items, .capacity = bb.capacity };

            if (this.resp) |resp| {
                resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }
        }

        pub fn renderResponseBuffer(this: *RequestContext) void {
            if (this.resp) |resp| {
                resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
            }
        }

        /// Render a complete response buffer
        pub fn renderResponseBufferAndMetadata(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();

                if (!resp.tryEnd(
                    this.response_buf_owned.items,
                    this.response_buf_owned.items.len,
                    this.shouldCloseConnection(),
                )) {
                    this.flags.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
                    return;
                }
            }
            this.detachResponse();
            this.endRequestStreamingAndDrain();
            this.deref();
        }

        /// Drain a partial response buffer
        pub fn drainResponseBufferAndMetadata(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();

                _ = resp.write(
                    this.response_buf_owned.items,
                );
            }
            this.response_buf_owned.items.len = 0;
        }

        pub fn end(this: *RequestContext, data: []const u8, closeConnection: bool) void {
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                resp.end(data, closeConnection);
            }
        }

        pub fn endStream(this: *RequestContext, closeConnection: bool) void {
            ctxLog("endStream", .{});
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                // This will send a terminating 0\r\n\r\n chunk to the client
                // We only want to do that if they're still expecting a body
                // We cannot call this function if the Content-Length header was previously set
                if (resp.state().isResponsePending())
                    resp.endStream(closeConnection);
            }
        }

        pub fn endWithoutBody(this: *RequestContext, closeConnection: bool) void {
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                resp.endWithoutBody(closeConnection);
            }
        }

        pub fn forceClose(this: *RequestContext) void {
            if (this.resp) |resp| {
                defer this.deref();
                this.detachResponse();
                this.endRequestStreamingAndDrain();
                resp.forceClose();
            }
        }

        pub fn onWritableResponseBuffer(this: *RequestContext, _: u64, resp: *App.Response) bool {
            ctxLog("onWritableResponseBuffer", .{});

            assert(this.resp == resp);
            if (this.isAbortedOrEnded()) {
                return false;
            }
            this.end("", this.shouldCloseConnection());
            return false;
        }

        // TODO: should we cork?
        pub fn onWritableCompleteResponseBufferAndMetadata(this: *RequestContext, write_offset: u64, resp: *App.Response) bool {
            ctxLog("onWritableCompleteResponseBufferAndMetadata", .{});
            assert(this.resp == resp);

            if (this.isAbortedOrEnded()) {
                return false;
            }

            if (!this.flags.has_written_status) {
                this.renderMetadata();
            }

            if (this.method == .HEAD) {
                this.endWithoutBody(this.shouldCloseConnection());
                return false;
            }

            return this.sendWritableBytesForCompleteResponseBuffer(this.response_buf_owned.items, write_offset, resp);
        }

        pub fn onWritableCompleteResponseBuffer(this: *RequestContext, write_offset: u64, resp: *App.Response) bool {
            ctxLog("onWritableCompleteResponseBuffer", .{});
            assert(this.resp == resp);
            if (this.isAbortedOrEnded()) {
                return false;
            }
            return this.sendWritableBytesForCompleteResponseBuffer(this.response_buf_owned.items, write_offset, resp);
        }

        pub fn create(this: *RequestContext, server: *ThisServer, req: *uws.Request, resp: *App.Response, should_deinit_context: ?*bool, method: ?bun.http.Method) void {
            this.* = .{
                .allocator = server.allocator,
                .resp = resp,
                .req = req,
                .method = method orelse HTTP.Method.which(req.method()) orelse .GET,
                .server = server,
                .defer_deinit_until_callback_completes = should_deinit_context,
            };

            ctxLog("create<d> ({*})<r>", .{this});
        }

        pub fn onTimeout(this: *RequestContext, resp: *App.Response) void {
            assert(this.resp == resp);
            assert(this.server != null);

            var any_js_calls = false;
            var vm = this.server.?.vm;
            const globalThis = this.server.?.globalThis;
            defer {
                // This is a task in the event loop.
                // If we called into JavaScript, we must drain the microtask queue
                if (any_js_calls) {
                    vm.drainMicrotasks();
                }
            }

            if (this.request_weakref.get()) |request| {
                if (request.internal_event_callback.trigger(Request.InternalJSEventCallback.EventType.timeout, globalThis)) {
                    any_js_calls = true;
                }
            }
        }

        pub fn onAbort(this: *RequestContext, resp: *App.Response) void {
            assert(this.resp == resp);
            assert(!this.flags.aborted);
            assert(this.server != null);
            // mark request as aborted
            this.flags.aborted = true;

            this.detachResponse();
            var any_js_calls = false;
            var vm = this.server.?.vm;
            const globalThis = this.server.?.globalThis;
            defer {
                // This is a task in the event loop.
                // If we called into JavaScript, we must drain the microtask queue
                if (any_js_calls) {
                    vm.drainMicrotasks();
                }
                this.deref();
            }

            if (this.request_weakref.get()) |request| {
                request.request_context = AnyRequestContext.Null;
                if (request.internal_event_callback.trigger(Request.InternalJSEventCallback.EventType.abort, globalThis)) {
                    any_js_calls = true;
                }
                // we can already clean this strong refs
                request.internal_event_callback.deinit();
                this.request_weakref.deref();
            }
            // if signal is not aborted, abort the signal
            if (this.signal) |signal| {
                this.signal = null;
                defer {
                    signal.pendingActivityUnref();
                    signal.unref();
                }
                if (!signal.aborted()) {
                    signal.signal(globalThis, .ConnectionClosed);
                    any_js_calls = true;
                }
            }

            //if have sink, call onAborted on sink
            if (this.sink) |wrapper| {
                wrapper.sink.abort();
                return;
            }

            // if we can, free the request now.
            if (this.isDeadRequest()) {
                this.finalizeWithoutDeinit();
            } else {
                if (this.endRequestStreaming()) {
                    any_js_calls = true;
                }

                if (this.response_ptr) |response| {
                    if (response.body.value == .Locked) {
                        var strong_readable = response.body.value.Locked.readable;
                        response.body.value.Locked.readable = .{};
                        defer strong_readable.deinit();
                        if (strong_readable.get(globalThis)) |readable| {
                            readable.abort(globalThis);
                            any_js_calls = true;
                        }
                    }
                }
            }
        }

        // This function may be called multiple times
        // so it's important that we can safely do that
        pub fn finalizeWithoutDeinit(this: *RequestContext) void {
            ctxLog("finalizeWithoutDeinit<d> ({*})<r>", .{this});
            this.blob.detach();
            assert(this.server != null);
            const globalThis = this.server.?.globalThis;

            if (comptime Environment.isDebug) {
                ctxLog("finalizeWithoutDeinit: has_finalized {any}", .{this.flags.has_finalized});
                this.flags.has_finalized = true;
            }

            if (this.response_jsvalue != .zero) {
                ctxLog("finalizeWithoutDeinit: response_jsvalue != .zero", .{});
                if (this.flags.response_protected) {
                    this.response_jsvalue.unprotect();
                    this.flags.response_protected = false;
                }
                this.response_jsvalue = JSC.JSValue.zero;
            }

            this.request_body_readable_stream_ref.deinit();

            if (this.cookies) |cookies| {
                this.cookies = null;
                cookies.deref();
            }

            if (this.request_weakref.get()) |request| {
                request.request_context = AnyRequestContext.Null;
                // we can already clean this strong refs
                request.internal_event_callback.deinit();
                this.request_weakref.deref();
            }

            // if signal is not aborted, abort the signal
            if (this.signal) |signal| {
                this.signal = null;
                defer {
                    signal.pendingActivityUnref();
                    signal.unref();
                }
                if (this.flags.aborted and !signal.aborted()) {
                    signal.signal(globalThis, .ConnectionClosed);
                }
            }

            // Case 1:
            // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
            // but we received nothing or the connection was aborted
            // the promise is pending
            // Case 2:
            // User ignored the body and the connection was aborted or ended
            // Case 3:
            // Stream was not consumed and the connection was aborted or ended
            _ = this.endRequestStreaming();

            if (this.byte_stream) |stream| {
                ctxLog("finalizeWithoutDeinit: stream != null", .{});

                this.byte_stream = null;
                stream.unpipeWithoutDeref();
            }

            this.readable_stream_ref.deinit();

            if (!this.pathname.isEmpty()) {
                this.pathname.deref();
                this.pathname = bun.String.empty;
            }
        }

        pub fn endSendFile(this: *RequestContext, writeOffSet: usize, closeConnection: bool) void {
            if (this.resp) |resp| {
                defer this.deref();

                this.detachResponse();
                this.endRequestStreamingAndDrain();
                resp.endSendFile(writeOffSet, closeConnection);
            }
        }

        fn cleanupAndFinalizeAfterSendfile(this: *RequestContext) void {
            const sendfile = this.sendfile;
            this.endSendFile(sendfile.offset, this.shouldCloseConnection());

            // use node syscall so that we don't segfault on BADF
            if (sendfile.auto_close)
                sendfile.fd.close();
        }
        const separator: string = "\r\n";
        const separator_iovec = [1]std.posix.iovec_const{.{
            .iov_base = separator.ptr,
            .iov_len = separator.len,
        }};

        pub fn onSendfile(this: *RequestContext) bool {
            if (this.isAbortedOrEnded()) {
                this.cleanupAndFinalizeAfterSendfile();
                return false;
            }
            const resp = this.resp.?;

            const adjusted_count_temporary = @min(@as(u64, this.sendfile.remain), @as(u63, std.math.maxInt(u63)));
            // TODO we should not need this int cast; improve the return type of `@min`
            const adjusted_count = @as(u63, @intCast(adjusted_count_temporary));

            if (Environment.isLinux) {
                var signed_offset = @as(i64, @intCast(this.sendfile.offset));
                const start = this.sendfile.offset;
                const val = linux.sendfile(this.sendfile.socket_fd.cast(), this.sendfile.fd.cast(), &signed_offset, this.sendfile.remain);
                this.sendfile.offset = @as(Blob.SizeType, @intCast(signed_offset));

                const errcode = bun.sys.getErrno(val);

                this.sendfile.remain -|= @as(Blob.SizeType, @intCast(this.sendfile.offset -| start));

                if (errcode != .SUCCESS or this.isAbortedOrEnded() or this.sendfile.remain == 0 or val == 0) {
                    if (errcode != .AGAIN and errcode != .SUCCESS and errcode != .PIPE and errcode != .NOTCONN) {
                        Output.prettyErrorln("Error: {s}", .{@tagName(errcode)});
                        Output.flush();
                    }
                    this.cleanupAndFinalizeAfterSendfile();
                    return errcode != .SUCCESS;
                }
            } else {
                var sbytes: std.posix.off_t = adjusted_count;
                const signed_offset = @as(i64, @bitCast(@as(u64, this.sendfile.offset)));
                const errcode = bun.sys.getErrno(std.c.sendfile(
                    this.sendfile.fd.cast(),
                    this.sendfile.socket_fd.cast(),
                    signed_offset,
                    &sbytes,
                    null,
                    0,
                ));
                const wrote = @as(Blob.SizeType, @intCast(sbytes));
                this.sendfile.offset +|= wrote;
                this.sendfile.remain -|= wrote;
                if (errcode != .AGAIN or this.isAbortedOrEnded() or this.sendfile.remain == 0 or sbytes == 0) {
                    if (errcode != .AGAIN and errcode != .SUCCESS and errcode != .PIPE and errcode != .NOTCONN) {
                        Output.prettyErrorln("Error: {s}", .{@tagName(errcode)});
                        Output.flush();
                    }
                    this.cleanupAndFinalizeAfterSendfile();
                    return errcode == .SUCCESS;
                }
            }

            if (!this.sendfile.has_set_on_writable) {
                this.sendfile.has_set_on_writable = true;
                this.flags.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableSendfile, this);
            }

            resp.markNeedsMore();

            return true;
        }

        pub fn onWritableBytes(this: *RequestContext, write_offset: u64, resp: *App.Response) bool {
            ctxLog("onWritableBytes", .{});
            assert(this.resp == resp);
            if (this.isAbortedOrEnded()) {
                return false;
            }

            // Copy to stack memory to prevent aliasing issues in release builds
            const blob = this.blob;
            const bytes = blob.slice();

            _ = this.sendWritableBytesForBlob(bytes, write_offset, resp);
            return true;
        }

        pub fn sendWritableBytesForBlob(this: *RequestContext, bytes_: []const u8, write_offset_: u64, resp: *App.Response) bool {
            assert(this.resp == resp);
            const write_offset: usize = write_offset_;

            const bytes = bytes_[@min(bytes_.len, @as(usize, @truncate(write_offset)))..];
            if (resp.tryEnd(bytes, bytes_.len, this.shouldCloseConnection())) {
                this.detachResponse();
                this.endRequestStreamingAndDrain();
                this.deref();
                return true;
            } else {
                this.flags.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableBytes, this);
                return true;
            }
        }

        pub fn sendWritableBytesForCompleteResponseBuffer(this: *RequestContext, bytes_: []const u8, write_offset_: u64, resp: *App.Response) bool {
            const write_offset: usize = write_offset_;
            assert(this.resp == resp);

            const bytes = bytes_[@min(bytes_.len, @as(usize, @truncate(write_offset)))..];
            if (resp.tryEnd(bytes, bytes_.len, this.shouldCloseConnection())) {
                this.response_buf_owned.items.len = 0;
                this.detachResponse();
                this.endRequestStreamingAndDrain();
                this.deref();
            } else {
                this.flags.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }

            return true;
        }

        pub fn onWritableSendfile(this: *RequestContext, _: u64, _: *App.Response) bool {
            ctxLog("onWritableSendfile", .{});
            return this.onSendfile();
        }

        // We tried open() in another thread for this
        // it was not faster due to the mountain of syscalls
        pub fn renderSendFile(this: *RequestContext, blob: JSC.WebCore.Blob) void {
            if (this.resp == null or this.server == null) return;
            const globalThis = this.server.?.globalThis;
            const resp = this.resp.?;

            this.blob = .{ .Blob = blob };
            const file = &this.blob.store().?.data.file;
            var file_buf: bun.PathBuffer = undefined;
            const auto_close = file.pathlike != .fd;
            const fd = if (!auto_close)
                file.pathlike.fd
            else switch (bun.sys.open(file.pathlike.path.sliceZ(&file_buf), bun.O.RDONLY | bun.O.NONBLOCK | bun.O.CLOEXEC, 0)) {
                .result => |_fd| _fd,
                .err => |err| return this.runErrorHandler(err.withPath(file.pathlike.path.slice()).toJSC(globalThis)),
            };

            // stat only blocks if the target is a file descriptor
            const stat: bun.Stat = switch (bun.sys.fstat(fd)) {
                .result => |result| result,
                .err => |err| {
                    this.runErrorHandler(err.withPathLike(file.pathlike).toJSC(globalThis));
                    if (auto_close) {
                        fd.close();
                    }
                    return;
                },
            };

            if (Environment.isMac) {
                if (!bun.isRegularFile(stat.mode)) {
                    if (auto_close) {
                        fd.close();
                    }

                    var err = bun.sys.Error{
                        .errno = @as(bun.sys.Error.Int, @intCast(@intFromEnum(std.posix.E.INVAL))),
                        .syscall = .sendfile,
                    };
                    var sys = err.withPathLike(file.pathlike).toSystemError();
                    sys.message = bun.String.static("MacOS does not support sending non-regular files");
                    this.runErrorHandler(sys.toErrorInstance(
                        globalThis,
                    ));
                    return;
                }
            }

            if (Environment.isLinux) {
                if (!(bun.isRegularFile(stat.mode) or std.posix.S.ISFIFO(stat.mode) or std.posix.S.ISSOCK(stat.mode))) {
                    if (auto_close) {
                        fd.close();
                    }

                    var err = bun.sys.Error{
                        .errno = @as(bun.sys.Error.Int, @intCast(@intFromEnum(std.posix.E.INVAL))),
                        .syscall = .sendfile,
                    };
                    var sys = err.withPathLike(file.pathlike).toShellSystemError();
                    sys.message = bun.String.static("File must be regular or FIFO");
                    this.runErrorHandler(sys.toErrorInstance(globalThis));
                    return;
                }
            }

            const original_size = this.blob.Blob.size;
            const stat_size = @as(Blob.SizeType, @intCast(stat.size));
            this.blob.Blob.size = if (bun.isRegularFile(stat.mode))
                stat_size
            else
                @min(original_size, stat_size);

            this.flags.needs_content_length = true;

            this.sendfile = .{
                .fd = fd,
                .remain = this.blob.Blob.offset + original_size,
                .offset = this.blob.Blob.offset,
                .auto_close = auto_close,
                .socket_fd = if (!this.isAbortedOrEnded()) resp.getNativeHandle() else bun.invalid_fd,
            };

            // if we are sending only part of a file, include the content-range header
            // only include content-range automatically when using a file path instead of an fd
            // this is to better support manually controlling the behavior
            if (bun.isRegularFile(stat.mode) and auto_close) {
                this.flags.needs_content_range = (this.sendfile.remain -| this.sendfile.offset) != stat_size;
            }

            // we know the bounds when we are sending a regular file
            if (bun.isRegularFile(stat.mode)) {
                this.sendfile.offset = @min(this.sendfile.offset, stat_size);
                this.sendfile.remain = @min(@max(this.sendfile.remain, this.sendfile.offset), stat_size) -| this.sendfile.offset;
            }

            resp.runCorkedWithType(*RequestContext, renderMetadataAndNewline, this);

            if (this.sendfile.remain == 0 or !this.method.hasBody()) {
                this.cleanupAndFinalizeAfterSendfile();
                return;
            }

            _ = this.onSendfile();
        }

        pub fn renderMetadataAndNewline(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();
                resp.prepareForSendfile();
            }
        }

        pub fn doSendfile(this: *RequestContext, blob: Blob) void {
            if (this.isAbortedOrEnded()) {
                return;
            }

            if (this.flags.has_sendfile_ctx) return;

            this.flags.has_sendfile_ctx = true;

            if (comptime can_sendfile) {
                return this.renderSendFile(blob);
            }
            if (this.server) |server| {
                this.ref();
                this.blob.Blob.doReadFileInternal(*RequestContext, this, onReadFile, server.globalThis);
            }
        }

        pub fn onReadFile(this: *RequestContext, result: Blob.read_file.ReadFileResultType) void {
            defer this.deref();

            if (this.isAbortedOrEnded()) {
                return;
            }

            if (result == .err) {
                if (this.server) |server| {
                    this.runErrorHandler(result.err.toErrorInstance(server.globalThis));
                }
                return;
            }

            const is_temporary = result.result.is_temporary;

            if (comptime Environment.allow_assert) {
                assert(this.blob == .Blob);
            }

            if (!is_temporary) {
                this.blob.Blob.resolveSize();
                this.doRenderBlob();
            } else {
                const stat_size = @as(Blob.SizeType, @intCast(result.result.total_size));

                if (this.blob == .Blob) {
                    const original_size = this.blob.Blob.size;
                    // if we dont know the size we use the stat size
                    this.blob.Blob.size = if (original_size == 0 or original_size == Blob.max_size)
                        stat_size
                    else // the blob can be a slice of a file
                        @max(original_size, stat_size);
                }

                if (!this.flags.has_written_status)
                    this.flags.needs_content_range = true;

                // this is used by content-range
                this.sendfile = .{
                    .fd = bun.invalid_fd,
                    .remain = @as(Blob.SizeType, @truncate(result.result.buf.len)),
                    .offset = if (this.blob == .Blob) this.blob.Blob.offset else 0,
                    .auto_close = false,
                    .socket_fd = bun.invalid_fd,
                };

                this.response_buf_owned = .{ .items = result.result.buf, .capacity = result.result.buf.len };
                this.resp.?.runCorkedWithType(*RequestContext, renderResponseBufferAndMetadata, this);
            }
        }

        pub fn doRenderWithBodyLocked(this: *anyopaque, value: *JSC.WebCore.Body.Value) void {
            doRenderWithBody(bun.cast(*RequestContext, this), value);
        }

        fn renderWithBlobFromBodyValue(this: *RequestContext) void {
            if (this.isAbortedOrEnded()) {
                return;
            }

            if (this.blob.needsToReadFile()) {
                if (!this.flags.has_sendfile_ctx)
                    this.doSendfile(this.blob.Blob);
                return;
            }

            this.doRenderBlob();
        }

        const StreamPair = struct { this: *RequestContext, stream: JSC.WebCore.ReadableStream };

        fn handleFirstStreamWrite(this: *@This()) void {
            if (!this.flags.has_written_status) {
                this.renderMetadata();
            }
        }

        fn doRenderStream(pair: *StreamPair) void {
            ctxLog("doRenderStream", .{});
            var this = pair.this;
            var stream = pair.stream;
            assert(this.server != null);
            const globalThis = this.server.?.globalThis;

            if (this.isAbortedOrEnded()) {
                stream.cancel(globalThis);
                this.readable_stream_ref.deinit();
                return;
            }
            const resp = this.resp.?;

            stream.value.ensureStillAlive();

            var response_stream = this.allocator.create(ResponseStream.JSSink) catch unreachable;
            response_stream.* = ResponseStream.JSSink{
                .sink = .{
                    .res = resp,
                    .allocator = this.allocator,
                    .buffer = bun.ByteList{},
                    .onFirstWrite = @ptrCast(&handleFirstStreamWrite),
                    .ctx = this,
                    .globalThis = globalThis,
                },
            };
            var signal = &response_stream.sink.signal;
            this.sink = response_stream;

            signal.* = ResponseStream.JSSink.SinkSignal.init(JSValue.zero);

            // explicitly set it to a dead pointer
            // we use this memory address to disable signals being sent
            signal.clear();
            assert(signal.isDead());
            // we need to render metadata before assignToStream because the stream can call res.end
            // and this would auto write an 200 status
            if (!this.flags.has_written_status) {
                this.renderMetadata();
            }

            // We are already corked!
            const assignment_result: JSValue = ResponseStream.JSSink.assignToStream(
                globalThis,
                stream.value,
                response_stream,
                @as(**anyopaque, @ptrCast(&signal.ptr)),
            );

            assignment_result.ensureStillAlive();

            // assert that it was updated
            assert(!signal.isDead());

            if (comptime Environment.allow_assert) {
                if (resp.hasResponded()) {
                    streamLog("responded", .{});
                }
            }

            this.flags.aborted = this.flags.aborted or response_stream.sink.aborted;

            if (assignment_result.toError()) |err_value| {
                streamLog("returned an error", .{});
                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                return this.handleReject(err_value);
            }

            if (resp.hasResponded()) {
                streamLog("done", .{});
                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                stream.done(globalThis);
                this.readable_stream_ref.deinit();
                this.endStream(this.shouldCloseConnection());
                return;
            }

            if (!assignment_result.isEmptyOrUndefinedOrNull()) {
                assignment_result.ensureStillAlive();
                // it returns a Promise when it goes through ReadableStreamDefaultReader
                if (assignment_result.asAnyPromise()) |promise| {
                    streamLog("returned a promise", .{});
                    this.drainMicrotasks();

                    switch (promise.status(globalThis.vm())) {
                        .pending => {
                            streamLog("promise still Pending", .{});
                            if (!this.flags.has_written_status) {
                                response_stream.sink.onFirstWrite = null;
                                response_stream.sink.ctx = null;
                                this.renderMetadata();
                            }

                            // TODO: should this timeout?
                            this.response_ptr.?.body.value = .{
                                .Locked = .{
                                    .readable = JSC.WebCore.ReadableStream.Strong.init(stream, globalThis),
                                    .global = globalThis,
                                },
                            };
                            this.ref();
                            assignment_result.then(
                                globalThis,
                                this,
                                onResolveStream,
                                onRejectStream,
                            );
                            // the response_stream should be GC'd

                        },
                        .fulfilled => {
                            streamLog("promise Fulfilled", .{});
                            var readable_stream_ref = this.readable_stream_ref;
                            this.readable_stream_ref = .{};
                            defer {
                                stream.done(globalThis);
                                readable_stream_ref.deinit();
                            }

                            this.handleResolveStream();
                        },
                        .rejected => {
                            streamLog("promise Rejected", .{});
                            var readable_stream_ref = this.readable_stream_ref;
                            this.readable_stream_ref = .{};
                            defer {
                                stream.cancel(globalThis);
                                readable_stream_ref.deinit();
                            }
                            this.handleRejectStream(globalThis, promise.result(globalThis.vm()));
                        },
                    }
                    return;
                } else {
                    // if is not a promise we treat it as Error
                    streamLog("returned an error", .{});
                    response_stream.detach();
                    this.sink = null;
                    response_stream.sink.destroy();
                    return this.handleReject(assignment_result);
                }
            }

            if (this.isAbortedOrEnded()) {
                response_stream.detach();
                stream.cancel(globalThis);
                defer this.readable_stream_ref.deinit();

                response_stream.sink.markDone();
                response_stream.sink.onFirstWrite = null;

                response_stream.sink.finalize();
                return;
            }
            var readable_stream_ref = this.readable_stream_ref;
            this.readable_stream_ref = .{};
            defer readable_stream_ref.deinit();

            const is_in_progress = response_stream.sink.has_backpressure or !(response_stream.sink.wrote == 0 and
                response_stream.sink.buffer.len == 0);

            if (!stream.isLocked(globalThis) and !is_in_progress) {
                if (JSC.WebCore.ReadableStream.fromJS(stream.value, globalThis)) |comparator| {
                    if (std.meta.activeTag(comparator.ptr) == std.meta.activeTag(stream.ptr)) {
                        streamLog("is not locked", .{});
                        this.renderMissing();
                        return;
                    }
                }
            }

            streamLog("is in progress, but did not return a Promise. Finalizing request context", .{});
            response_stream.sink.onFirstWrite = null;
            response_stream.sink.ctx = null;
            response_stream.detach();
            stream.cancel(globalThis);
            response_stream.sink.markDone();
            this.renderMissing();
        }

        const streamLog = Output.scoped(.ReadableStream, false);

        pub fn didUpgradeWebSocket(this: *RequestContext) bool {
            return @intFromPtr(this.upgrade_context) == std.math.maxInt(usize);
        }

        fn toAsyncWithoutAbortHandler(ctx: *RequestContext, req: *uws.Request, request_object: *Request) void {
            request_object.request_context.setRequest(req);
            assert(ctx.server != null);

            request_object.ensureURL() catch {
                request_object.url = bun.String.empty;
            };

            // we have to clone the request headers here since they will soon belong to a different request
            if (!request_object.hasFetchHeaders()) {
                request_object.setFetchHeaders(.createFromUWS(req));
            }

            // This object dies after the stack frame is popped
            // so we have to clear it in here too
            request_object.request_context.detachRequest();
        }

        pub fn toAsync(
            ctx: *RequestContext,
            req: *uws.Request,
            request_object: *Request,
        ) void {
            ctxLog("toAsync", .{});
            ctx.toAsyncWithoutAbortHandler(req, request_object);
            if (comptime debug_mode) {
                ctx.pathname = request_object.url.clone();
            }
            ctx.setAbortHandler();
        }

        fn endRequestStreamingAndDrain(this: *RequestContext) void {
            assert(this.server != null);

            if (this.endRequestStreaming()) {
                this.server.?.vm.drainMicrotasks();
            }
        }
        fn endRequestStreaming(this: *RequestContext) bool {
            assert(this.server != null);

            this.request_body_buf.clearAndFree(bun.default_allocator);

            // if we cannot, we have to reject pending promises
            // first, we reject the request body promise
            if (this.request_body) |body| {
                // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
                // but we received nothing or the connection was aborted
                if (body.value == .Locked) {
                    body.value.toErrorInstance(.{ .AbortReason = .ConnectionClosed }, this.server.?.globalThis);
                    return true;
                }
            }
            return false;
        }
        fn detachResponse(this: *RequestContext) void {
            this.request_body_buf.clearAndFree(bun.default_allocator);

            if (this.resp) |resp| {
                this.resp = null;

                if (this.flags.is_waiting_for_request_body) {
                    this.flags.is_waiting_for_request_body = false;
                    resp.clearOnData();
                }
                if (this.flags.has_abort_handler) {
                    resp.clearAborted();
                    this.flags.has_abort_handler = false;
                }
                if (this.flags.has_timeout_handler) {
                    resp.clearTimeout();
                    this.flags.has_timeout_handler = false;
                }
            }
        }

        pub fn isAbortedOrEnded(this: *const RequestContext) bool {
            // resp == null or aborted or server.stop(true)
            return this.resp == null or this.flags.aborted or this.server == null or this.server.?.flags.terminated;
        }
        const HeaderResponseSizePair = struct { this: *RequestContext, size: usize };
        pub fn doRenderHeadResponseAfterS3SizeResolved(pair: *HeaderResponseSizePair) void {
            var this = pair.this;
            this.renderMetadata();

            if (this.resp) |resp| {
                resp.writeHeaderInt("content-length", pair.size);
            }
            this.endWithoutBody(this.shouldCloseConnection());
            this.deref();
        }
        pub fn onS3SizeResolved(result: S3.S3StatResult, this: *RequestContext) void {
            defer {
                this.deref();
            }
            if (this.resp) |resp| {
                var pair = HeaderResponseSizePair{ .this = this, .size = switch (result) {
                    .failure, .not_found => 0,
                    .success => |stat| stat.size,
                } };
                resp.runCorkedWithType(*HeaderResponseSizePair, doRenderHeadResponseAfterS3SizeResolved, &pair);
            }
        }
        const HeaderResponsePair = struct { this: *RequestContext, response: *JSC.WebCore.Response };

        fn doRenderHeadResponse(pair: *HeaderResponsePair) void {
            var this = pair.this;
            var response = pair.response;
            if (this.resp == null) {
                return;
            }
            // we will render the content-length header later manually so we set this to false
            this.flags.needs_content_length = false;
            // Always this.renderMetadata() before sending the content-length or transfer-encoding header so status is sent first

            const resp = this.resp.?;
            this.response_ptr = response;
            const server = this.server orelse {
                // server detached?
                this.renderMetadata();
                resp.writeHeaderInt("content-length", 0);
                this.endWithoutBody(this.shouldCloseConnection());
                return;
            };
            const globalThis = server.globalThis;
            if (response.getFetchHeaders()) |headers| {
                // first respect the headers
                if (headers.fastGet(.TransferEncoding)) |transfer_encoding| {
                    const transfer_encoding_str = transfer_encoding.toSlice(server.allocator);
                    defer transfer_encoding_str.deinit();
                    this.renderMetadata();
                    resp.writeHeader("transfer-encoding", transfer_encoding_str.slice());
                    this.endWithoutBody(this.shouldCloseConnection());

                    return;
                }
                if (headers.fastGet(.ContentLength)) |content_length| {
                    const content_length_str = content_length.toSlice(server.allocator);
                    defer content_length_str.deinit();
                    this.renderMetadata();

                    const len = std.fmt.parseInt(usize, content_length_str.slice(), 10) catch 0;
                    resp.writeHeaderInt("content-length", len);
                    this.endWithoutBody(this.shouldCloseConnection());
                    return;
                }
            }
            // not content-length or transfer-encoding so we need to respect the body
            response.body.value.toBlobIfPossible();
            switch (response.body.value) {
                .InternalBlob, .WTFStringImpl => {
                    var blob = response.body.value.useAsAnyBlobAllowNonUTF8String();
                    defer blob.detach();
                    const size = blob.size();
                    this.renderMetadata();

                    if (size == Blob.max_size) {
                        resp.writeHeaderInt("content-length", 0);
                    } else {
                        resp.writeHeaderInt("content-length", size);
                    }
                    this.endWithoutBody(this.shouldCloseConnection());
                },

                .Blob => |*blob| {
                    if (blob.isS3()) {
                        // we need to read the size asynchronously
                        // in this case should always be a redirect so should not hit this path, but in case we change it in the future lets handle it
                        this.ref();

                        const credentials = blob.store.?.data.s3.getCredentials();
                        const path = blob.store.?.data.s3.path();
                        const env = globalThis.bunVM().transpiler.env;

                        S3.stat(credentials, path, @ptrCast(&onS3SizeResolved), this, if (env.getHttpProxy(true, null)) |proxy| proxy.href else null);

                        return;
                    }
                    this.renderMetadata();

                    blob.resolveSize();
                    if (blob.size == Blob.max_size) {
                        resp.writeHeaderInt("content-length", 0);
                    } else {
                        resp.writeHeaderInt("content-length", blob.size);
                    }
                    this.endWithoutBody(this.shouldCloseConnection());
                },
                .Locked => {
                    this.renderMetadata();
                    resp.writeHeader("transfer-encoding", "chunked");
                    this.endWithoutBody(this.shouldCloseConnection());
                },
                .Used, .Null, .Empty, .Error => {
                    this.renderMetadata();
                    resp.writeHeaderInt("content-length", 0);
                    this.endWithoutBody(this.shouldCloseConnection());
                },
            }
        }

        // Each HTTP request or TCP socket connection is effectively a "task".
        //
        // However, unlike the regular task queue, we don't drain the microtask
        // queue at the end.
        //
        // Instead, we drain it multiple times, at the points that would
        // otherwise "halt" the Response from being rendered.
        //
        // - If you return a Promise, we drain the microtask queue once
        // - If you return a streaming Response, we drain the microtask queue (possibly the 2nd time this task!)
        pub fn onResponse(
            ctx: *RequestContext,
            this: *ThisServer,
            request_value: JSValue,
            response_value: JSValue,
        ) void {
            request_value.ensureStillAlive();
            response_value.ensureStillAlive();
            ctx.drainMicrotasks();

            if (ctx.isAbortedOrEnded()) {
                return;
            }
            // if you return a Response object or a Promise<Response>
            // but you upgraded the connection to a WebSocket
            // just ignore the Response object. It doesn't do anything.
            // it's better to do that than to throw an error
            if (ctx.didUpgradeWebSocket()) {
                return;
            }

            if (response_value.isEmptyOrUndefinedOrNull()) {
                ctx.renderMissingInvalidResponse(response_value);
                return;
            }

            if (response_value.toError()) |err_value| {
                ctx.runErrorHandler(err_value);
                return;
            }

            if (response_value.as(JSC.WebCore.Response)) |response| {
                ctx.response_jsvalue = response_value;
                ctx.response_jsvalue.ensureStillAlive();
                ctx.flags.response_protected = false;
                if (ctx.method == .HEAD) {
                    if (ctx.resp) |resp| {
                        var pair = HeaderResponsePair{ .this = ctx, .response = response };
                        resp.runCorkedWithType(*HeaderResponsePair, doRenderHeadResponse, &pair);
                    }
                    return;
                } else {
                    response.body.value.toBlobIfPossible();

                    switch (response.body.value) {
                        .Blob => |*blob| {
                            if (blob.needsToReadFile()) {
                                response_value.protect();
                                ctx.flags.response_protected = true;
                            }
                        },
                        .Locked => {
                            response_value.protect();
                            ctx.flags.response_protected = true;
                        },
                        else => {},
                    }
                    ctx.render(response);
                }
                return;
            }

            var vm = this.vm;

            if (response_value.asAnyPromise()) |promise| {
                // If we immediately have the value available, we can skip the extra event loop tick
                switch (promise.unwrap(vm.global.vm(), .mark_handled)) {
                    .pending => {
                        ctx.ref();
                        response_value.then(this.globalThis, ctx, RequestContext.onResolve, RequestContext.onReject);
                        return;
                    },
                    .fulfilled => |fulfilled_value| {
                        // if you return a Response object or a Promise<Response>
                        // but you upgraded the connection to a WebSocket
                        // just ignore the Response object. It doesn't do anything.
                        // it's better to do that than to throw an error
                        if (ctx.didUpgradeWebSocket()) {
                            return;
                        }

                        if (fulfilled_value.isEmptyOrUndefinedOrNull()) {
                            ctx.renderMissingInvalidResponse(fulfilled_value);
                            return;
                        }
                        var response = fulfilled_value.as(JSC.WebCore.Response) orelse {
                            ctx.renderMissingInvalidResponse(fulfilled_value);
                            return;
                        };

                        ctx.response_jsvalue = fulfilled_value;
                        ctx.response_jsvalue.ensureStillAlive();
                        ctx.flags.response_protected = false;
                        ctx.response_ptr = response;
                        if (ctx.method == .HEAD) {
                            if (ctx.resp) |resp| {
                                var pair = HeaderResponsePair{ .this = ctx, .response = response };
                                resp.runCorkedWithType(*HeaderResponsePair, doRenderHeadResponse, &pair);
                            }
                            return;
                        }
                        response.body.value.toBlobIfPossible();
                        switch (response.body.value) {
                            .Blob => |*blob| {
                                if (blob.needsToReadFile()) {
                                    fulfilled_value.protect();
                                    ctx.flags.response_protected = true;
                                }
                            },
                            .Locked => {
                                fulfilled_value.protect();
                                ctx.flags.response_protected = true;
                            },
                            else => {},
                        }
                        ctx.render(response);
                        return;
                    },
                    .rejected => |err| {
                        ctx.handleReject(err);
                        return;
                    },
                }
            }
        }

        pub fn handleResolveStream(req: *RequestContext) void {
            streamLog("handleResolveStream", .{});

            var wrote_anything = false;
            if (req.sink) |wrapper| {
                req.flags.aborted = req.flags.aborted or wrapper.sink.aborted;
                wrote_anything = wrapper.sink.wrote > 0;

                wrapper.sink.finalize();
                wrapper.detach();
                req.sink = null;
                wrapper.sink.destroy();
            }

            if (req.response_ptr) |resp| {
                assert(req.server != null);

                if (resp.body.value == .Locked) {
                    const global = resp.body.value.Locked.global;
                    if (resp.body.value.Locked.readable.get(global)) |stream| {
                        stream.done(global);
                    }
                    resp.body.value.Locked.readable.deinit();
                    resp.body.value = .{ .Used = {} };
                }
            }

            if (req.isAbortedOrEnded()) {
                return;
            }

            streamLog("onResolve({any})", .{wrote_anything});
            if (!req.flags.has_written_status) {
                req.renderMetadata();
            }
            req.endStream(req.shouldCloseConnection());
        }

        pub fn onResolveStream(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            streamLog("onResolveStream", .{});
            var args = callframe.arguments_old(2);
            var req: *@This() = args.ptr[args.len - 1].asPromisePtr(@This());
            defer req.deref();
            req.handleResolveStream();
            return .js_undefined;
        }
        pub fn onRejectStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            streamLog("onRejectStream", .{});
            const args = callframe.arguments_old(2);
            var req = args.ptr[args.len - 1].asPromisePtr(@This());
            const err = args.ptr[0];
            defer req.deref();

            req.handleRejectStream(globalThis, err);
            return .js_undefined;
        }

        pub fn handleRejectStream(req: *@This(), globalThis: *JSC.JSGlobalObject, err: JSValue) void {
            streamLog("handleRejectStream", .{});

            if (req.sink) |wrapper| {
                wrapper.sink.pending_flush = null;
                wrapper.sink.done = true;
                req.flags.aborted = req.flags.aborted or wrapper.sink.aborted;
                wrapper.sink.finalize();
                wrapper.detach();
                req.sink = null;
                wrapper.sink.destroy();
            }

            if (req.response_ptr) |resp| {
                if (resp.body.value == .Locked) {
                    if (resp.body.value.Locked.readable.get(globalThis)) |stream| {
                        stream.done(globalThis);
                    }
                    resp.body.value.Locked.readable.deinit();
                    resp.body.value = .{ .Used = {} };
                }
            }

            // aborted so call finalizeForAbort
            if (req.isAbortedOrEnded()) {
                return;
            }

            streamLog("onReject()", .{});

            if (!req.flags.has_written_status) {
                req.renderMetadata();
            }

            if (comptime debug_mode) {
                if (req.server) |server| {
                    if (!err.isEmptyOrUndefinedOrNull()) {
                        var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(req.allocator);
                        defer exception_list.deinit();
                        server.vm.runErrorHandler(err, &exception_list);
                    }
                }
            }
            req.endStream(req.shouldCloseConnection());
        }

        pub fn doRenderWithBody(this: *RequestContext, value: *JSC.WebCore.Body.Value) void {
            this.drainMicrotasks();

            // If a ReadableStream can trivially be converted to a Blob, do so.
            // If it's a WTFStringImpl and it cannot be used as a UTF-8 string, convert it to a Blob.
            value.toBlobIfPossible();
            const globalThis = this.server.?.globalThis;
            switch (value.*) {
                .Error => |*err_ref| {
                    _ = value.use();
                    if (this.isAbortedOrEnded()) {
                        return;
                    }
                    this.runErrorHandler(err_ref.toJS(globalThis));
                    return;
                },
                // .InlineBlob,
                .WTFStringImpl,
                .InternalBlob,
                .Blob,
                => {
                    // toBlobIfPossible checks for WTFString needing a conversion.
                    this.blob = value.useAsAnyBlobAllowNonUTF8String();
                    this.renderWithBlobFromBodyValue();
                    return;
                },
                .Locked => |*lock| {
                    if (this.isAbortedOrEnded()) {
                        return;
                    }

                    if (lock.readable.get(globalThis)) |stream_| {
                        const stream: JSC.WebCore.ReadableStream = stream_;
                        // we hold the stream alive until we're done with it
                        this.readable_stream_ref = lock.readable;
                        value.* = .{ .Used = {} };

                        if (stream.isLocked(globalThis)) {
                            streamLog("was locked but it shouldn't be", .{});
                            var err = JSC.SystemError{
                                .code = bun.String.static(@tagName(JSC.Node.ErrorCode.ERR_STREAM_CANNOT_PIPE)),
                                .message = bun.String.static("Stream already used, please create a new one"),
                            };
                            stream.value.unprotect();
                            this.runErrorHandler(err.toErrorInstance(globalThis));
                            return;
                        }

                        switch (stream.ptr) {
                            .Invalid => {
                                this.readable_stream_ref.deinit();
                            },
                            // toBlobIfPossible will typically convert .Blob streams, or .File streams into a Blob object, but cannot always.
                            .Blob,
                            .File,
                            // These are the common scenario:
                            .JavaScript,
                            .Direct,
                            => {
                                if (this.resp) |resp| {
                                    var pair = StreamPair{ .stream = stream, .this = this };
                                    resp.runCorkedWithType(*StreamPair, doRenderStream, &pair);
                                }
                                return;
                            },

                            .Bytes => |byte_stream| {
                                assert(byte_stream.pipe.ctx == null);
                                assert(this.byte_stream == null);
                                if (this.resp == null) {
                                    // we don't have a response, so we can discard the stream
                                    stream.done(globalThis);
                                    this.readable_stream_ref.deinit();
                                    return;
                                }
                                const resp = this.resp.?;
                                // If we've received the complete body by the time this function is called
                                // we can avoid streaming it and just send it all at once.
                                if (byte_stream.has_received_last_chunk) {
                                    this.blob = .fromArrayList(byte_stream.drain().listManaged(bun.default_allocator));
                                    this.readable_stream_ref.deinit();
                                    this.doRenderBlob();
                                    return;
                                }
                                this.ref();
                                byte_stream.pipe = JSC.WebCore.Pipe.Wrap(@This(), onPipe).init(this);
                                this.readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(stream, globalThis);

                                this.byte_stream = byte_stream;
                                this.response_buf_owned = byte_stream.drain().list();

                                // we don't set size here because even if we have a hint
                                // uWebSockets won't let us partially write streaming content
                                this.blob.detach();

                                // if we've received metadata and part of the body, send everything we can and drain
                                if (this.response_buf_owned.items.len > 0) {
                                    resp.runCorkedWithType(*RequestContext, drainResponseBufferAndMetadata, this);
                                } else {
                                    // if we only have metadata to send, send it now
                                    resp.runCorkedWithType(*RequestContext, renderMetadata, this);
                                }
                                return;
                            },
                        }
                    }

                    if (lock.onReceiveValue != null or lock.task != null) {
                        // someone else is waiting for the stream or waiting for `onStartStreaming`
                        const readable = value.toReadableStream(globalThis);
                        readable.ensureStillAlive();
                        this.doRenderWithBody(value);
                        return;
                    }

                    // when there's no stream, we need to
                    lock.onReceiveValue = doRenderWithBodyLocked;
                    lock.task = this;

                    return;
                },
                else => {},
            }

            this.doRenderBlob();
        }

        pub fn onPipe(this: *RequestContext, stream: JSC.WebCore.streams.Result, allocator: std.mem.Allocator) void {
            const stream_needs_deinit = stream == .owned or stream == .owned_and_done;
            const is_done = stream.isDone();
            defer {
                if (is_done) this.deref();
                if (stream_needs_deinit) {
                    if (is_done) {
                        stream.owned_and_done.listManaged(allocator).deinit();
                    } else {
                        stream.owned.listManaged(allocator).deinit();
                    }
                }
            }

            if (this.isAbortedOrEnded()) {
                return;
            }
            const resp = this.resp.?;

            const chunk = stream.slice();
            // on failure, it will continue to allocate
            // we can't do buffering ourselves here or it won't work
            // uSockets will append and manage the buffer
            // so any write will buffer if the write fails
            if (resp.write(chunk) == .want_more) {
                if (is_done) {
                    this.endStream(this.shouldCloseConnection());
                }
            } else {
                // when it's the last one, we just want to know if it's done
                if (is_done) {
                    this.flags.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
                }
            }
        }

        pub fn doRenderBlob(this: *RequestContext) void {
            // We are not corked
            // The body is small
            // Faster to do the memcpy than to do the two network calls
            // We are not streaming
            // This is an important performance optimization
            if (this.flags.has_abort_handler and this.blob.fastSize() < 16384 - 1024) {
                if (this.resp) |resp| {
                    resp.runCorkedWithType(*RequestContext, doRenderBlobCorked, this);
                }
            } else {
                this.doRenderBlobCorked();
            }
        }

        pub fn doRenderBlobCorked(this: *RequestContext) void {
            this.renderMetadata();
            this.renderBytes();
        }

        pub fn doRender(this: *RequestContext) void {
            ctxLog("doRender", .{});

            if (this.isAbortedOrEnded()) {
                return;
            }
            var response = this.response_ptr.?;
            this.doRenderWithBody(&response.body.value);
        }

        pub fn renderProductionError(this: *RequestContext, status: u16) void {
            if (this.resp) |resp| {
                switch (status) {
                    404 => {
                        if (!this.flags.has_written_status) {
                            resp.writeStatus("404 Not Found");
                            this.flags.has_written_status = true;
                        }
                        this.endWithoutBody(this.shouldCloseConnection());
                    },
                    else => {
                        if (!this.flags.has_written_status) {
                            resp.writeStatus("500 Internal Server Error");
                            resp.writeHeader("content-type", "text/plain");
                            this.flags.has_written_status = true;
                        }

                        this.end("Something went wrong!", this.shouldCloseConnection());
                    },
                }
            }
        }

        pub fn runErrorHandler(
            this: *RequestContext,
            value: JSC.JSValue,
        ) void {
            runErrorHandlerWithStatusCode(this, value, 500);
        }

        const PathnameFormatter = struct {
            ctx: *RequestContext,

            pub fn format(formatter: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                var this = formatter.ctx;

                if (!this.pathname.isEmpty()) {
                    try this.pathname.format(fmt, opts, writer);
                    return;
                }

                if (!this.flags.has_abort_handler) {
                    if (this.req) |req| {
                        try writer.writeAll(req.url());
                        return;
                    }
                }

                try writer.writeAll("/");
            }
        };

        fn ensurePathname(this: *RequestContext) PathnameFormatter {
            return .{ .ctx = this };
        }

        pub inline fn shouldCloseConnection(this: *const RequestContext) bool {
            if (this.resp) |resp| {
                return resp.shouldCloseConnection();
            }
            return false;
        }

        fn finishRunningErrorHandler(this: *RequestContext, value: JSC.JSValue, status: u16) void {
            if (this.server == null) return this.renderProductionError(status);
            var vm: *JSC.VirtualMachine = this.server.?.vm;
            const globalThis = this.server.?.globalThis;
            if (comptime debug_mode) {
                var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(this.allocator);
                defer exception_list.deinit();
                const prev_exception_list = vm.onUnhandledRejectionExceptionList;
                vm.onUnhandledRejectionExceptionList = &exception_list;
                vm.onUnhandledRejection(vm, globalThis, value);
                vm.onUnhandledRejectionExceptionList = prev_exception_list;

                this.renderDefaultError(
                    vm.log,
                    error.ExceptionOcurred,
                    exception_list.toOwnedSlice() catch @panic("TODO"),
                    "<r><red>{s}<r> - <b>{}<r> failed",
                    .{ @as(string, @tagName(this.method)), this.ensurePathname() },
                );
            } else {
                if (status != 404) {
                    vm.onUnhandledRejection(vm, globalThis, value);
                }
                this.renderProductionError(status);
            }

            vm.log.reset();
        }

        pub fn runErrorHandlerWithStatusCodeDontCheckResponded(
            this: *RequestContext,
            value: JSC.JSValue,
            status: u16,
        ) void {
            JSC.markBinding(@src());
            if (this.server) |server| {
                if (server.config.onError != .zero and !this.flags.has_called_error_handler) {
                    this.flags.has_called_error_handler = true;
                    const result = server.config.onError.call(
                        server.globalThis,
                        server.js_value.get() orelse .js_undefined,
                        &.{value},
                    ) catch |err| server.globalThis.takeException(err);
                    defer result.ensureStillAlive();
                    if (!result.isEmptyOrUndefinedOrNull()) {
                        if (result.toError()) |err| {
                            this.finishRunningErrorHandler(err, status);
                            return;
                        } else if (result.asAnyPromise()) |promise| {
                            this.processOnErrorPromise(result, promise, value, status);
                            return;
                        } else if (result.as(Response)) |response| {
                            this.render(response);
                            return;
                        }
                    }
                }
            }

            this.finishRunningErrorHandler(value, status);
        }

        fn processOnErrorPromise(
            ctx: *RequestContext,
            promise_js: JSC.JSValue,
            promise: JSC.AnyPromise,
            value: JSC.JSValue,
            status: u16,
        ) void {
            assert(ctx.server != null);
            var vm = ctx.server.?.vm;

            switch (promise.unwrap(vm.global.vm(), .mark_handled)) {
                .pending => {
                    ctx.flags.is_error_promise_pending = true;
                    ctx.ref();
                    promise_js.then(
                        ctx.server.?.globalThis,
                        ctx,
                        RequestContext.onResolve,
                        RequestContext.onReject,
                    );
                },
                .fulfilled => |fulfilled_value| {
                    // if you return a Response object or a Promise<Response>
                    // but you upgraded the connection to a WebSocket
                    // just ignore the Response object. It doesn't do anything.
                    // it's better to do that than to throw an error
                    if (ctx.didUpgradeWebSocket()) {
                        return;
                    }

                    var response = fulfilled_value.as(JSC.WebCore.Response) orelse {
                        ctx.finishRunningErrorHandler(value, status);
                        return;
                    };

                    ctx.response_jsvalue = fulfilled_value;
                    ctx.response_jsvalue.ensureStillAlive();
                    ctx.flags.response_protected = false;
                    ctx.response_ptr = response;

                    response.body.value.toBlobIfPossible();
                    switch (response.body.value) {
                        .Blob => |*blob| {
                            if (blob.needsToReadFile()) {
                                fulfilled_value.protect();
                                ctx.flags.response_protected = true;
                            }
                        },
                        .Locked => {
                            fulfilled_value.protect();
                            ctx.flags.response_protected = true;
                        },
                        else => {},
                    }
                    ctx.render(response);
                    return;
                },
                .rejected => |err| {
                    ctx.finishRunningErrorHandler(err, status);
                    return;
                },
            }
        }

        pub fn runErrorHandlerWithStatusCode(
            this: *RequestContext,
            value: JSC.JSValue,
            status: u16,
        ) void {
            JSC.markBinding(@src());
            if (this.resp == null or this.resp.?.hasResponded()) return;

            runErrorHandlerWithStatusCodeDontCheckResponded(this, value, status);
        }

        pub fn renderMetadata(this: *RequestContext) void {
            if (this.resp == null) return;
            const resp = this.resp.?;

            var response: *JSC.WebCore.Response = this.response_ptr.?;
            var status = response.statusCode();
            var needs_content_range = this.flags.needs_content_range and this.sendfile.remain < this.blob.size();

            const size = if (needs_content_range)
                this.sendfile.remain
            else
                this.blob.size();

            status = if (status == 200 and size == 0 and !this.blob.isDetached())
                204
            else
                status;

            const content_type, const needs_content_type, const content_type_needs_free = getContentType(
                response.init.headers,
                &this.blob,
                this.allocator,
            );
            defer if (content_type_needs_free) content_type.deinit(this.allocator);
            var has_content_disposition = false;
            var has_content_range = false;
            if (response.init.headers) |headers_| {
                has_content_disposition = headers_.fastHas(.ContentDisposition);
                has_content_range = headers_.fastHas(.ContentRange);
                needs_content_range = needs_content_range and has_content_range;
                if (needs_content_range) {
                    status = 206;
                }

                this.doWriteStatus(status);
                this.doWriteHeaders(headers_);
                response.init.headers = null;
                headers_.deref();
            } else if (needs_content_range) {
                status = 206;
                this.doWriteStatus(status);
            } else {
                this.doWriteStatus(status);
            }

            if (this.cookies) |cookies| {
                this.cookies = null;
                defer cookies.deref();
                cookies.write(this.server.?.globalThis, ssl_enabled, @ptrCast(this.resp.?));
            }

            if (needs_content_type and
                // do not insert the content type if it is the fallback value
                // we may not know the content-type when streaming
                (!this.blob.isDetached() or content_type.value.ptr != MimeType.other.value.ptr))
            {
                resp.writeHeader("content-type", content_type.value);
            }

            // automatically include the filename when:
            // 1. Bun.file("foo")
            // 2. The content-disposition header is not present
            if (!has_content_disposition and content_type.category.autosetFilename()) {
                if (this.blob.getFileName()) |filename| {
                    const basename = std.fs.path.basename(filename);
                    if (basename.len > 0) {
                        var filename_buf: [1024]u8 = undefined;

                        resp.writeHeader(
                            "content-disposition",
                            std.fmt.bufPrint(&filename_buf, "filename=\"{s}\"", .{basename[0..@min(basename.len, 1024 - 32)]}) catch "",
                        );
                    }
                }
            }

            if (this.flags.needs_content_length) {
                resp.writeHeaderInt("content-length", size);
                this.flags.needs_content_length = false;
            }

            if (needs_content_range and !has_content_range) {
                var content_range_buf: [1024]u8 = undefined;

                resp.writeHeader(
                    "content-range",
                    std.fmt.bufPrint(
                        &content_range_buf,
                        // we omit the full size of the Blob because it could
                        // change between requests and this potentially leaks
                        // PII undesirably
                        "bytes {d}-{d}/*",
                        .{ this.sendfile.offset, this.sendfile.offset + (this.sendfile.remain -| 1) },
                    ) catch "bytes */*",
                );
                this.flags.needs_content_range = false;
            }
        }

        fn doWriteStatus(this: *RequestContext, status: u16) void {
            assert(!this.flags.has_written_status);
            this.flags.has_written_status = true;

            writeStatus(ssl_enabled, this.resp, status);
        }

        fn doWriteHeaders(this: *RequestContext, headers: *WebCore.FetchHeaders) void {
            writeHeaders(headers, ssl_enabled, this.resp);
        }

        pub fn renderBytes(this: *RequestContext) void {
            // copy it to stack memory to prevent aliasing issues in release builds
            const blob = this.blob;
            const bytes = blob.slice();
            if (this.resp) |resp| {
                if (!resp.tryEnd(
                    bytes,
                    bytes.len,
                    this.shouldCloseConnection(),
                )) {
                    this.flags.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableBytes, this);
                    return;
                }
            }
            this.detachResponse();
            this.endRequestStreamingAndDrain();
            this.deref();
        }

        pub fn render(this: *RequestContext, response: *JSC.WebCore.Response) void {
            ctxLog("render", .{});
            this.response_ptr = response;

            this.doRender();
        }

        pub fn onBufferedBodyChunk(this: *RequestContext, resp: *App.Response, chunk: []const u8, last: bool) void {
            ctxLog("onBufferedBodyChunk {} {}", .{ chunk.len, last });

            assert(this.resp == resp);

            this.flags.is_waiting_for_request_body = last == false;
            if (this.isAbortedOrEnded() or this.flags.has_marked_complete) return;
            if (!last and chunk.len == 0) {
                // Sometimes, we get back an empty chunk
                // We have to ignore those chunks unless it's the last one
                return;
            }
            const vm = this.server.?.vm;
            const globalThis = this.server.?.globalThis;

            // After the user does request.body,
            // if they then do .text(), .arrayBuffer(), etc
            // we can no longer hold the strong reference from the body value ref.
            if (this.request_body_readable_stream_ref.get(globalThis)) |readable| {
                assert(this.request_body_buf.items.len == 0);
                vm.eventLoop().enter();
                defer vm.eventLoop().exit();

                if (!last) {
                    readable.ptr.Bytes.onData(
                        .{
                            .temporary = bun.ByteList.initConst(chunk),
                        },
                        bun.default_allocator,
                    );
                } else {
                    var strong = this.request_body_readable_stream_ref;
                    this.request_body_readable_stream_ref = .{};
                    defer strong.deinit();
                    if (this.request_body) |request_body| {
                        _ = request_body.unref();
                        this.request_body = null;
                    }

                    readable.value.ensureStillAlive();
                    readable.ptr.Bytes.onData(
                        .{
                            .temporary_and_done = bun.ByteList.initConst(chunk),
                        },
                        bun.default_allocator,
                    );
                }

                return;
            }

            // This is the start of a task, so it's a good time to drain
            if (this.request_body != null) {
                var body = this.request_body.?;

                if (last) {
                    var bytes = &this.request_body_buf;

                    var old = body.value;

                    const total = bytes.items.len + chunk.len;
                    getter: {
                        // if (total <= JSC.WebCore.InlineBlob.available_bytes) {
                        //     if (total == 0) {
                        //         body.value = .{ .Empty = {} };
                        //         break :getter;
                        //     }

                        //     body.value = .{ .InlineBlob = JSC.WebCore.InlineBlob.concat(bytes.items, chunk) };
                        //     this.request_body_buf.clearAndFree(this.allocator);
                        // } else {
                        bytes.ensureTotalCapacityPrecise(this.allocator, total) catch |err| {
                            this.request_body_buf.clearAndFree(this.allocator);
                            body.value.toError(err, globalThis);
                            break :getter;
                        };

                        const prev_len = bytes.items.len;
                        bytes.items.len = total;
                        var slice = bytes.items[prev_len..];
                        @memcpy(slice[0..chunk.len], chunk);
                        body.value = .{
                            .InternalBlob = .{
                                .bytes = bytes.toManaged(this.allocator),
                            },
                        };
                        // }
                    }
                    this.request_body_buf = .{};

                    if (old == .Locked) {
                        var loop = vm.eventLoop();
                        loop.enter();
                        defer loop.exit();

                        old.resolve(&body.value, globalThis, null);
                    }
                    return;
                }

                if (this.request_body_buf.capacity == 0) {
                    this.request_body_buf.ensureTotalCapacityPrecise(this.allocator, @min(this.request_body_content_len, max_request_body_preallocate_length)) catch @panic("Out of memory while allocating request body buffer");
                }
                this.request_body_buf.appendSlice(this.allocator, chunk) catch @panic("Out of memory while allocating request body");
            }
        }

        pub fn onStartStreamingRequestBody(this: *RequestContext) JSC.WebCore.DrainResult {
            ctxLog("onStartStreamingRequestBody", .{});
            if (this.isAbortedOrEnded()) {
                return JSC.WebCore.DrainResult{
                    .aborted = {},
                };
            }

            // This means we have received part of the body but not the whole thing
            if (this.request_body_buf.items.len > 0) {
                var emptied = this.request_body_buf;
                this.request_body_buf = .{};
                return .{
                    .owned = .{
                        .list = emptied.toManaged(this.allocator),
                        .size_hint = if (emptied.capacity < max_request_body_preallocate_length)
                            emptied.capacity
                        else
                            0,
                    },
                };
            }

            return .{
                .estimated_size = this.request_body_content_len,
            };
        }
        const max_request_body_preallocate_length = 1024 * 256;
        pub fn onStartBuffering(this: *RequestContext) void {
            if (this.server) |server| {
                ctxLog("onStartBuffering", .{});
                // TODO: check if is someone calling onStartBuffering other than onStartBufferingCallback
                // if is not, this should be removed and only keep protect + setAbortHandler
                if (this.flags.is_transfer_encoding == false and this.request_body_content_len == 0) {
                    // no content-length or 0 content-length
                    // no transfer-encoding
                    if (this.request_body != null) {
                        var body = this.request_body.?;
                        var old = body.value;
                        old.Locked.onReceiveValue = null;
                        var new_body: WebCore.Body.Value = .{ .Null = {} };
                        old.resolve(&new_body, server.globalThis, null);
                        body.value = new_body;
                    }
                }
            }
        }

        pub fn onRequestBodyReadableStreamAvailable(ptr: *anyopaque, globalThis: *JSC.JSGlobalObject, readable: JSC.WebCore.ReadableStream) void {
            var this = bun.cast(*RequestContext, ptr);
            bun.debugAssert(this.request_body_readable_stream_ref.held.impl == null);
            this.request_body_readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable, globalThis);
        }

        pub fn onStartBufferingCallback(this: *anyopaque) void {
            onStartBuffering(bun.cast(*RequestContext, this));
        }

        pub fn onStartStreamingRequestBodyCallback(this: *anyopaque) JSC.WebCore.DrainResult {
            return onStartStreamingRequestBody(bun.cast(*RequestContext, this));
        }

        pub fn getRemoteSocketInfo(this: *RequestContext) ?uws.SocketAddress {
            return (this.resp orelse return null).getRemoteSocketInfo();
        }

        pub fn setTimeout(this: *RequestContext, seconds: c_uint) bool {
            if (this.resp) |resp| {
                resp.timeout(@min(seconds, 255));
                if (seconds > 0) {

                    // we only set the timeout callback if we wanna the timeout event to be triggered
                    // the connection will be closed so the abort handler will be called after the timeout
                    if (this.request_weakref.get()) |req| {
                        if (req.internal_event_callback.hasCallback()) {
                            this.setTimeoutHandler();
                        }
                    }
                } else {
                    // if the timeout is 0, we don't need to trigger the timeout event
                    resp.clearTimeout();
                }
                return true;
            }
            return false;
        }

        comptime {
            const export_prefix = "Bun__HTTPRequestContext" ++ (if (debug_mode) "Debug" else "") ++ (if (ThisServer.ssl_enabled) "TLS" else "");
            if (bun.Environment.export_cpp_apis) {
                @export(&JSC.toJSHostFn(onResolve), .{ .name = export_prefix ++ "__onResolve" });
                @export(&JSC.toJSHostFn(onReject), .{ .name = export_prefix ++ "__onReject" });
                @export(&JSC.toJSHostFn(onResolveStream), .{ .name = export_prefix ++ "__onResolveStream" });
                @export(&JSC.toJSHostFn(onRejectStream), .{ .name = export_prefix ++ "__onRejectStream" });
            }
        }
    };
}

const SendfileContext = struct {
    fd: bun.FileDescriptor,
    socket_fd: bun.FileDescriptor = bun.invalid_fd,
    remain: Blob.SizeType = 0,
    offset: Blob.SizeType = 0,
    has_listener: bool = false,
    has_set_on_writable: bool = false,
    auto_close: bool = false,
};

fn NewFlags(comptime debug_mode: bool) type {
    return packed struct(u16) {
        has_marked_complete: bool = false,
        has_marked_pending: bool = false,
        has_abort_handler: bool = false,
        has_timeout_handler: bool = false,
        has_sendfile_ctx: bool = false,
        has_called_error_handler: bool = false,
        needs_content_length: bool = false,
        needs_content_range: bool = false,
        /// Used to avoid looking at the uws.Request struct after it's been freed
        is_transfer_encoding: bool = false,

        /// Used to identify if request can be safely deinitialized
        is_waiting_for_request_body: bool = false,
        /// Used in renderMissing in debug mode to show the user an HTML page
        /// Used to avoid looking at the uws.Request struct after it's been freed
        is_web_browser_navigation: if (debug_mode) bool else void = if (debug_mode) false,
        has_written_status: bool = false,
        response_protected: bool = false,
        aborted: bool = false,
        has_finalized: bun.DebugOnly(bool) = if (Environment.isDebug) false,

        is_error_promise_pending: bool = false,

        _padding: PaddingInt = 0,

        const PaddingInt = brk: {
            var size: usize = 2;
            if (Environment.isDebug) {
                size -= 1;
            }

            if (debug_mode) {
                size -= 1;
            }

            break :brk std.meta.Int(.unsigned, size);
        };
    };
}

fn getContentType(headers: ?*WebCore.FetchHeaders, blob: *const WebCore.Blob.Any, allocator: std.mem.Allocator) struct { MimeType, bool, bool } {
    var needs_content_type = true;
    var content_type_needs_free = false;

    const content_type: MimeType = brk: {
        if (headers) |headers_| {
            if (headers_.fastGet(.ContentType)) |content| {
                needs_content_type = false;

                var content_slice = content.toSlice(allocator);
                defer content_slice.deinit();

                const content_type_allocator = if (content_slice.allocator.isNull()) null else allocator;
                break :brk MimeType.init(content_slice.slice(), content_type_allocator, &content_type_needs_free);
            }
        }

        break :brk if (blob.contentType().len > 0)
            MimeType.byName(blob.contentType())
        else if (MimeType.sniff(blob.slice())) |content|
            content
        else if (blob.wasString())
            MimeType.text
                // TODO: should we get the mime type off of the Blob.Store if it exists?
                // A little wary of doing this right now due to causing some breaking change
        else
            MimeType.other;
    };

    return .{ content_type, needs_content_type, content_type_needs_free };
}

const welcome_page_html_gz = @embedFile("../welcome-page.html.gz");

fn writeHeaders(
    headers: *WebCore.FetchHeaders,
    comptime ssl: bool,
    resp_ptr: ?*uws.NewApp(ssl).Response,
) void {
    ctxLog("writeHeaders", .{});
    headers.fastRemove(.ContentLength);
    headers.fastRemove(.TransferEncoding);
    if (resp_ptr) |resp| {
        headers.toUWSResponse(ssl, resp);
    }
}

const WebCore = JSC.WebCore;
const bun = @import("bun");
const uws = bun.uws;
const std = @import("std");
const Environment = bun.Environment;
const JSC = bun.JSC;
const Request = JSC.WebCore.Request;
const Response = JSC.WebCore.Response;
const FetchHeaders = JSC.WebCore.FetchHeaders;
const Body = JSC.WebCore.Body;
const Blob = JSC.WebCore.Blob;
const MimeType = bun.http.MimeType;
const HTTP = bun.http;
const Output = bun.Output;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const String = bun.String;
const JSError = bun.JSError;
const linux = std.os.linux;
const S3 = bun.S3;
const logger = bun.logger;
const assert = bun.assert;
const ctxLog = Output.scoped(.RequestContext, false);
const Api = bun.Schema.Api;
const string = []const u8;
const AnyRequestContext = JSC.API.AnyRequestContext;
const VirtualMachine = JSC.VirtualMachine;
const writeStatus = @import("../server.zig").writeStatus;
const Fallback = @import("../../../runtime.zig").Fallback;
