const JSType = JSC.C.JSType;

pub const fetch_error_no_args = "fetch() expects a string but received no arguments.";
pub const fetch_error_blank_url = "fetch() URL must not be a blank string.";
pub const fetch_error_unexpected_body = "fetch() request with GET/HEAD/OPTIONS method cannot have body.";
pub const fetch_error_proxy_unix = "fetch() cannot use a proxy with a unix socket.";
const JSTypeErrorEnum = std.enums.EnumArray(JSType, string);
pub const fetch_type_error_names: JSTypeErrorEnum = brk: {
    var errors = JSTypeErrorEnum.initUndefined();
    errors.set(JSType.kJSTypeUndefined, "Undefined");
    errors.set(JSType.kJSTypeNull, "Null");
    errors.set(JSType.kJSTypeBoolean, "Boolean");
    errors.set(JSType.kJSTypeNumber, "Number");
    errors.set(JSType.kJSTypeString, "String");
    errors.set(JSType.kJSTypeObject, "Object");
    errors.set(JSType.kJSTypeSymbol, "Symbol");
    break :brk errors;
};

pub const fetch_type_error_string_values = .{
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeUndefined)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNull)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeBoolean)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNumber)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeString)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeObject)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeSymbol)}),
};

pub const fetch_type_error_strings: JSTypeErrorEnum = brk: {
    var errors = JSTypeErrorEnum.initUndefined();
    errors.set(
        JSType.kJSTypeUndefined,
        bun.asByteSlice(fetch_type_error_string_values[0]),
    );
    errors.set(
        JSType.kJSTypeNull,
        bun.asByteSlice(fetch_type_error_string_values[1]),
    );
    errors.set(
        JSType.kJSTypeBoolean,
        bun.asByteSlice(fetch_type_error_string_values[2]),
    );
    errors.set(
        JSType.kJSTypeNumber,
        bun.asByteSlice(fetch_type_error_string_values[3]),
    );
    errors.set(
        JSType.kJSTypeString,
        bun.asByteSlice(fetch_type_error_string_values[4]),
    );
    errors.set(
        JSType.kJSTypeObject,
        bun.asByteSlice(fetch_type_error_string_values[5]),
    );
    errors.set(
        JSType.kJSTypeSymbol,
        bun.asByteSlice(fetch_type_error_string_values[6]),
    );
    break :brk errors;
};

pub const FetchTasklet = struct {
    pub const FetchTaskletStream = JSC.WebCore.NetworkSink;

    const log = Output.scoped(.FetchTasklet, false);
    sink: ?*FetchTaskletStream.JSSink = null,
    http: ?*http.AsyncHTTP = null,
    result: http.HTTPClientResult = .{},
    metadata: ?http.HTTPResponseMetadata = null,
    javascript_vm: *VirtualMachine = undefined,
    global_this: *JSGlobalObject = undefined,
    request_body: HTTPRequestBody = undefined,

    /// buffer being used by AsyncHTTP
    response_buffer: MutableString = undefined,
    /// buffer used to stream response to JS
    scheduled_response_buffer: MutableString = undefined,
    /// response weak ref we need this to track the response JS lifetime
    response: JSC.Weak(FetchTasklet) = .{},
    /// native response ref if we still need it when JS is discarted
    native_response: ?*Response = null,
    ignore_data: bool = false,
    /// stream strong ref if any is available
    readable_stream_ref: JSC.WebCore.ReadableStream.Strong = .{},
    request_headers: Headers = Headers{ .allocator = undefined },
    promise: JSC.JSPromise.Strong,
    concurrent_task: JSC.ConcurrentTask = .{},
    poll_ref: Async.KeepAlive = .{},
    memory_reporter: *bun.MemoryReportingAllocator,
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    body_size: http.HTTPClientResult.BodySize = .unknown,

    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    url_proxy_buffer: []const u8 = "",

    signal: ?*JSC.WebCore.AbortSignal = null,
    signals: http.Signals = .{},
    signal_store: http.Signals.Store = .{},
    has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    // must be stored because AbortSignal stores reason weakly
    abort_reason: JSC.Strong.Optional = .empty,

    // custom checkServerIdentity
    check_server_identity: JSC.Strong.Optional = .empty,
    reject_unauthorized: bool = true,
    // Custom Hostname
    hostname: ?[]u8 = null,
    is_waiting_body: bool = false,
    is_waiting_abort: bool = false,
    is_waiting_request_stream_start: bool = false,
    mutex: Mutex,

    tracker: JSC.Debugger.AsyncTaskTracker,

    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

    pub fn ref(this: *FetchTasklet) void {
        const count = this.ref_count.fetchAdd(1, .monotonic);
        bun.debugAssert(count > 0);
    }

    pub fn deref(this: *FetchTasklet) void {
        const count = this.ref_count.fetchSub(1, .monotonic);
        bun.debugAssert(count > 0);

        if (count == 1) {
            this.deinit();
        }
    }

    pub fn derefFromThread(this: *FetchTasklet) void {
        const count = this.ref_count.fetchSub(1, .monotonic);
        bun.debugAssert(count > 0);

        if (count == 1) {
            // this is really unlikely to happen, but can happen
            // lets make sure that we always call deinit from main thread

            this.javascript_vm.eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, FetchTasklet.deinit));
        }
    }

    pub const HTTPRequestBody = union(enum) {
        AnyBlob: AnyBlob,
        Sendfile: http.Sendfile,
        ReadableStream: JSC.WebCore.ReadableStream.Strong,

        pub const Empty: HTTPRequestBody = .{ .AnyBlob = .{ .Blob = .{} } };

        pub fn store(this: *HTTPRequestBody) ?*Blob.Store {
            return switch (this.*) {
                .AnyBlob => this.AnyBlob.store(),
                else => null,
            };
        }

        pub fn slice(this: *const HTTPRequestBody) []const u8 {
            return switch (this.*) {
                .AnyBlob => this.AnyBlob.slice(),
                else => "",
            };
        }

        pub fn detach(this: *HTTPRequestBody) void {
            switch (this.*) {
                .AnyBlob => this.AnyBlob.detach(),
                .ReadableStream => |*stream| {
                    stream.deinit();
                },
                .Sendfile => {
                    if (@max(this.Sendfile.offset, this.Sendfile.remain) > 0)
                        this.Sendfile.fd.close();
                    this.Sendfile.offset = 0;
                    this.Sendfile.remain = 0;
                },
            }
        }

        pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) bun.JSError!HTTPRequestBody {
            var body_value = try Body.Value.fromJS(globalThis, value);
            if (body_value == .Used or (body_value == .Locked and (body_value.Locked.action != .none or body_value.Locked.isDisturbed2(globalThis)))) {
                return globalThis.ERR(.BODY_ALREADY_USED, "body already used", .{}).throw();
            }
            if (body_value == .Locked) {
                if (body_value.Locked.readable.has()) {
                    // just grab the ref
                    return FetchTasklet.HTTPRequestBody{ .ReadableStream = body_value.Locked.readable };
                }
                const readable = body_value.toReadableStream(globalThis);
                if (!readable.isEmptyOrUndefinedOrNull() and body_value == .Locked and body_value.Locked.readable.has()) {
                    return FetchTasklet.HTTPRequestBody{ .ReadableStream = body_value.Locked.readable };
                }
            }
            return FetchTasklet.HTTPRequestBody{ .AnyBlob = body_value.useAsAnyBlob() };
        }

        pub fn needsToReadFile(this: *HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |blob| blob.needsToReadFile(),
                else => false,
            };
        }

        pub fn isS3(this: *const HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |*blob| blob.isS3(),
                else => false,
            };
        }

        pub fn hasContentTypeFromUser(this: *HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |blob| blob.hasContentTypeFromUser(),
                else => false,
            };
        }

        pub fn getAnyBlob(this: *HTTPRequestBody) ?*AnyBlob {
            return switch (this.*) {
                .AnyBlob => &this.AnyBlob,
                else => null,
            };
        }

        pub fn hasBody(this: *HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |blob| blob.size() > 0,
                .ReadableStream => |*stream| stream.has(),
                .Sendfile => true,
            };
        }
    };

    pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet {
        return FetchTasklet{};
    }

    fn clearSink(this: *FetchTasklet) void {
        if (this.sink) |wrapper| {
            this.sink = null;

            wrapper.sink.done = true;
            wrapper.sink.ended = true;
            wrapper.sink.finalize();
            wrapper.detach();
            wrapper.sink.finalizeAndDestroy();
        }
    }

    fn clearData(this: *FetchTasklet) void {
        log("clearData", .{});
        const allocator = this.memory_reporter.allocator();
        if (this.url_proxy_buffer.len > 0) {
            allocator.free(this.url_proxy_buffer);
            this.url_proxy_buffer.len = 0;
        }

        if (this.hostname) |hostname| {
            allocator.free(hostname);
            this.hostname = null;
        }

        if (this.result.certificate_info) |*certificate| {
            certificate.deinit(bun.default_allocator);
            this.result.certificate_info = null;
        }

        this.request_headers.entries.deinit(allocator);
        this.request_headers.buf.deinit(allocator);
        this.request_headers = Headers{ .allocator = undefined };

        if (this.http) |http_| {
            http_.clearData();
        }

        if (this.metadata != null) {
            this.metadata.?.deinit(allocator);
            this.metadata = null;
        }

        this.response_buffer.deinit();
        this.response.deinit();
        if (this.native_response) |response| {
            this.native_response = null;

            response.unref();
        }

        this.readable_stream_ref.deinit();

        this.scheduled_response_buffer.deinit();
        if (this.request_body != .ReadableStream or this.is_waiting_request_stream_start) {
            this.request_body.detach();
        }

        this.abort_reason.deinit();
        this.check_server_identity.deinit();
        this.clearAbortSignal();
    }

    pub fn deinit(this: *FetchTasklet) void {
        log("deinit", .{});

        bun.assert(this.ref_count.load(.monotonic) == 0);

        this.clearData();

        var reporter = this.memory_reporter;
        const allocator = reporter.allocator();

        if (this.http) |http_| {
            this.http = null;
            allocator.destroy(http_);
        }
        allocator.destroy(this);
        // reporter.assert();
        bun.default_allocator.destroy(reporter);
    }

    fn getCurrentResponse(this: *FetchTasklet) ?*Response {
        // we need a body to resolve the promise when buffering
        if (this.native_response) |response| {
            return response;
        }

        // if we did not have a direct reference we check if the Weak ref is still alive
        if (this.response.get()) |response_js| {
            if (response_js.as(Response)) |response| {
                return response;
            }
        }

        return null;
    }

    pub fn onResolveRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        var args = callframe.arguments_old(2);
        var this: *@This() = args.ptr[args.len - 1].asPromisePtr(@This());
        defer this.deref();
        if (this.request_body == .ReadableStream) {
            var readable_stream_ref = this.request_body.ReadableStream;
            this.request_body.ReadableStream = .{};
            defer readable_stream_ref.deinit();
            if (readable_stream_ref.get(globalThis)) |stream| {
                stream.done(globalThis);
                this.clearSink();
            }
        }

        return .js_undefined;
    }

    pub fn onRejectRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const args = callframe.arguments_old(2);
        var this = args.ptr[args.len - 1].asPromisePtr(@This());
        defer this.deref();
        const err = args.ptr[0];
        if (this.request_body == .ReadableStream) {
            var readable_stream_ref = this.request_body.ReadableStream;
            this.request_body.ReadableStream = .{};
            defer readable_stream_ref.deinit();
            if (readable_stream_ref.get(globalThis)) |stream| {
                stream.cancel(globalThis);
                this.clearSink();
            }
        }

        this.abortListener(err);
        return .js_undefined;
    }
    comptime {
        const jsonResolveRequestStream = JSC.toJSHostFn(onResolveRequestStream);
        @export(&jsonResolveRequestStream, .{ .name = "Bun__FetchTasklet__onResolveRequestStream" });
        const jsonRejectRequestStream = JSC.toJSHostFn(onRejectRequestStream);
        @export(&jsonRejectRequestStream, .{ .name = "Bun__FetchTasklet__onRejectRequestStream" });
    }

    pub fn startRequestStream(this: *FetchTasklet) void {
        this.is_waiting_request_stream_start = false;
        bun.assert(this.request_body == .ReadableStream);
        if (this.request_body.ReadableStream.get(this.global_this)) |stream| {
            this.ref(); // lets only unref when sink is done

            const globalThis = this.global_this;
            var response_stream = FetchTaskletStream.new(.{
                .task = .{ .fetch = this },
                .buffer = .{},
                .globalThis = globalThis,
            }).toSink();
            var signal = &response_stream.sink.signal;
            this.sink = response_stream;

            signal.* = FetchTaskletStream.JSSink.SinkSignal.init(JSValue.zero);

            // explicitly set it to a dead pointer
            // we use this memory address to disable signals being sent
            signal.clear();
            bun.assert(signal.isDead());

            // We are already corked!
            const assignment_result: JSValue = FetchTaskletStream.JSSink.assignToStream(
                globalThis,
                stream.value,
                response_stream,
                @as(**anyopaque, @ptrCast(&signal.ptr)),
            );

            assignment_result.ensureStillAlive();

            // assert that it was updated
            bun.assert(!signal.isDead());

            if (assignment_result.toError()) |err_value| {
                response_stream.detach();
                this.sink = null;
                response_stream.sink.finalizeAndDestroy();
                return this.abortListener(err_value);
            }

            if (!assignment_result.isEmptyOrUndefinedOrNull()) {
                assignment_result.ensureStillAlive();
                // it returns a Promise when it goes through ReadableStreamDefaultReader
                if (assignment_result.asAnyPromise()) |promise| {
                    switch (promise.status(globalThis.vm())) {
                        .pending => {
                            this.ref();
                            assignment_result.then(
                                globalThis,
                                this,
                                onResolveRequestStream,
                                onRejectRequestStream,
                            );
                        },
                        .fulfilled => {
                            var readable_stream_ref = this.request_body.ReadableStream;
                            this.request_body.ReadableStream = .{};
                            defer {
                                stream.done(globalThis);
                                this.clearSink();
                                readable_stream_ref.deinit();
                            }
                        },
                        .rejected => {
                            var readable_stream_ref = this.request_body.ReadableStream;
                            this.request_body.ReadableStream = .{};
                            defer {
                                stream.cancel(globalThis);
                                this.clearSink();
                                readable_stream_ref.deinit();
                            }

                            this.abortListener(promise.result(globalThis.vm()));
                        },
                    }
                    return;
                } else {
                    // if is not a promise we treat it as Error
                    response_stream.detach();
                    this.sink = null;
                    response_stream.sink.finalizeAndDestroy();
                    return this.abortListener(assignment_result);
                }
            }
        }
    }
    pub fn onBodyReceived(this: *FetchTasklet) void {
        const success = this.result.isSuccess();
        const globalThis = this.global_this;
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        var buffer_reset = true;
        defer {
            if (buffer_reset) {
                this.scheduled_response_buffer.reset();
            }
        }

        if (!success) {
            var err = this.onReject();
            var need_deinit = true;
            defer if (need_deinit) err.deinit();
            // if we are streaming update with error
            if (this.readable_stream_ref.get(globalThis)) |readable| {
                if (readable.ptr == .Bytes) {
                    readable.ptr.Bytes.onData(
                        .{
                            .err = .{ .JSValue = err.toJS(globalThis) },
                        },
                        bun.default_allocator,
                    );
                }
            }
            // if we are buffering resolve the promise
            if (this.getCurrentResponse()) |response| {
                response.body.value.toErrorInstance(err, globalThis);
                need_deinit = false; // body value now owns the error
                const body = response.body;
                if (body.value == .Locked) {
                    if (body.value.Locked.promise) |promise_| {
                        const promise = promise_.asAnyPromise().?;
                        promise.reject(globalThis, response.body.value.Error.toJS(globalThis));
                    }
                }
            }
            return;
        }

        if (this.readable_stream_ref.get(globalThis)) |readable| {
            if (readable.ptr == .Bytes) {
                readable.ptr.Bytes.size_hint = this.getSizeHint();
                // body can be marked as used but we still need to pipe the data
                const scheduled_response_buffer = this.scheduled_response_buffer.list;

                const chunk = scheduled_response_buffer.items;

                if (this.result.has_more) {
                    readable.ptr.Bytes.onData(
                        .{
                            .temporary = bun.ByteList.initConst(chunk),
                        },
                        bun.default_allocator,
                    );
                } else {
                    var prev = this.readable_stream_ref;
                    this.readable_stream_ref = .{};
                    defer prev.deinit();
                    buffer_reset = false;
                    this.memory_reporter.discard(scheduled_response_buffer.allocatedSlice());
                    this.scheduled_response_buffer = .{
                        .allocator = bun.default_allocator,
                        .list = .{
                            .items = &.{},
                            .capacity = 0,
                        },
                    };
                    readable.ptr.Bytes.onData(
                        .{
                            .owned_and_done = bun.ByteList.initConst(chunk),
                        },
                        bun.default_allocator,
                    );
                }
                return;
            }
        }

        if (this.getCurrentResponse()) |response| {
            var body = &response.body;
            if (body.value == .Locked) {
                if (body.value.Locked.readable.get(globalThis)) |readable| {
                    if (readable.ptr == .Bytes) {
                        readable.ptr.Bytes.size_hint = this.getSizeHint();

                        const scheduled_response_buffer = this.scheduled_response_buffer.list;

                        const chunk = scheduled_response_buffer.items;

                        if (this.result.has_more) {
                            readable.ptr.Bytes.onData(
                                .{
                                    .temporary = bun.ByteList.initConst(chunk),
                                },
                                bun.default_allocator,
                            );
                        } else {
                            var prev = body.value.Locked.readable;
                            body.value.Locked.readable = .{};
                            readable.value.ensureStillAlive();
                            prev.deinit();
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
                } else {
                    response.body.value.Locked.size_hint = this.getSizeHint();
                }
                // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
                buffer_reset = false;
                if (!this.result.has_more) {
                    var scheduled_response_buffer = this.scheduled_response_buffer.list;
                    this.memory_reporter.discard(scheduled_response_buffer.allocatedSlice());

                    // done resolve body
                    var old = body.value;
                    const body_value = Body.Value{
                        .InternalBlob = .{
                            .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
                        },
                    };
                    response.body.value = body_value;

                    this.scheduled_response_buffer = .{
                        .allocator = this.memory_reporter.allocator(),
                        .list = .{
                            .items = &.{},
                            .capacity = 0,
                        },
                    };

                    if (old == .Locked) {
                        old.resolve(&response.body.value, this.global_this, response.getFetchHeaders());
                    }
                }
            }
        }
    }

    pub fn onProgressUpdate(this: *FetchTasklet) void {
        JSC.markBinding(@src());
        log("onProgressUpdate", .{});
        this.mutex.lock();
        this.has_schedule_callback.store(false, .monotonic);
        const is_done = !this.result.has_more;

        const vm = this.javascript_vm;
        // vm is shutting down we cannot touch JS
        if (vm.isShuttingDown()) {
            this.mutex.unlock();
            if (is_done) {
                this.deref();
            }
            return;
        }

        const globalThis = this.global_this;
        defer {
            this.mutex.unlock();
            // if we are not done we wait until the next call
            if (is_done) {
                var poll_ref = this.poll_ref;
                this.poll_ref = .{};
                poll_ref.unref(vm);
                this.deref();
            }
        }
        if (this.is_waiting_request_stream_start and this.result.can_stream) {
            // start streaming
            this.startRequestStream();
        }
        // if we already respond the metadata and still need to process the body
        if (this.is_waiting_body) {
            this.onBodyReceived();
            return;
        }
        if (this.metadata == null and this.result.isSuccess()) return;

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        if (this.is_waiting_abort) {
            return;
        }
        const promise_value = this.promise.valueOrEmpty();

        if (promise_value.isEmptyOrUndefinedOrNull()) {
            log("onProgressUpdate: promise_value is null", .{});
            this.promise.deinit();
            return;
        }

        if (this.result.certificate_info) |certificate_info| {
            this.result.certificate_info = null;
            defer certificate_info.deinit(bun.default_allocator);

            // we receive some error
            if (this.reject_unauthorized and !this.checkServerIdentity(certificate_info)) {
                log("onProgressUpdate: aborted due certError", .{});
                // we need to abort the request
                const promise = promise_value.asAnyPromise().?;
                const tracker = this.tracker;
                var result = this.onReject();
                defer result.deinit();

                promise_value.ensureStillAlive();
                promise.reject(globalThis, result.toJS(globalThis));

                tracker.didDispatch(globalThis);
                this.promise.deinit();
                return;
            }
            // everything ok
            if (this.metadata == null) {
                log("onProgressUpdate: metadata is null", .{});
                return;
            }
        }

        const tracker = this.tracker;
        tracker.willDispatch(globalThis);
        defer {
            log("onProgressUpdate: promise_value is not null", .{});
            tracker.didDispatch(globalThis);
            this.promise.deinit();
        }
        const success = this.result.isSuccess();
        const result = switch (success) {
            true => JSC.Strong.Optional.create(this.onResolve(), globalThis),
            false => brk: {
                // in this case we wanna a JSC.Strong.Optional so we just convert it
                var value = this.onReject();
                _ = value.toJS(globalThis);
                break :brk value.JSValue;
            },
        };

        promise_value.ensureStillAlive();
        const Holder = struct {
            held: JSC.Strong.Optional,
            promise: JSC.Strong.Optional,
            globalObject: *JSC.JSGlobalObject,
            task: JSC.AnyTask,

            pub fn resolve(self: *@This()) void {
                // cleanup
                defer bun.default_allocator.destroy(self);
                defer self.held.deinit();
                defer self.promise.deinit();
                // resolve the promise
                var prom = self.promise.swap().asAnyPromise().?;
                const res = self.held.swap();
                res.ensureStillAlive();
                prom.resolve(self.globalObject, res);
            }

            pub fn reject(self: *@This()) void {
                // cleanup
                defer bun.default_allocator.destroy(self);
                defer self.held.deinit();
                defer self.promise.deinit();

                // reject the promise
                var prom = self.promise.swap().asAnyPromise().?;
                const res = self.held.swap();
                res.ensureStillAlive();
                prom.reject(self.globalObject, res);
            }
        };
        var holder = bun.default_allocator.create(Holder) catch bun.outOfMemory();
        holder.* = .{
            .held = result,
            // we need the promise to be alive until the task is done
            .promise = this.promise.strong,
            .globalObject = globalThis,
            .task = undefined,
        };
        this.promise.strong = .empty;
        holder.task = switch (success) {
            true => JSC.AnyTask.New(Holder, Holder.resolve).init(holder),
            false => JSC.AnyTask.New(Holder, Holder.reject).init(holder),
        };

        vm.enqueueTask(JSC.Task.init(&holder.task));
    }

    pub fn checkServerIdentity(this: *FetchTasklet, certificate_info: http.CertificateInfo) bool {
        if (this.check_server_identity.get()) |check_server_identity| {
            check_server_identity.ensureStillAlive();
            if (certificate_info.cert.len > 0) {
                const cert = certificate_info.cert;
                var cert_ptr = cert.ptr;
                if (BoringSSL.d2i_X509(null, &cert_ptr, @intCast(cert.len))) |x509| {
                    const globalObject = this.global_this;
                    defer x509.free();
                    const js_cert = X509.toJS(x509, globalObject) catch |err| {
                        switch (err) {
                            error.JSError => {},
                            error.OutOfMemory => globalObject.throwOutOfMemory() catch {},
                        }
                        const check_result = globalObject.tryTakeException().?;
                        // mark to wait until deinit
                        this.is_waiting_abort = this.result.has_more;
                        this.abort_reason.set(globalObject, check_result);
                        this.signal_store.aborted.store(true, .monotonic);
                        this.tracker.didCancel(this.global_this);
                        // we need to abort the request
                        if (this.http) |http_| http.http_thread.scheduleShutdown(http_);
                        this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                        return false;
                    };
                    var hostname: bun.String = bun.String.createUTF8(certificate_info.hostname);
                    defer hostname.deref();
                    const js_hostname = hostname.toJS(globalObject);
                    js_hostname.ensureStillAlive();
                    js_cert.ensureStillAlive();
                    const check_result = check_server_identity.call(globalObject, .js_undefined, &.{ js_hostname, js_cert }) catch |err| globalObject.takeException(err);

                    // > Returns <Error> object [...] on failure
                    if (check_result.isAnyError()) {
                        // mark to wait until deinit
                        this.is_waiting_abort = this.result.has_more;
                        this.abort_reason.set(globalObject, check_result);
                        this.signal_store.aborted.store(true, .monotonic);
                        this.tracker.didCancel(this.global_this);

                        // we need to abort the request
                        if (this.http) |http_| {
                            http.http_thread.scheduleShutdown(http_);
                        }
                        this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
        return false;
    }

    fn getAbortError(this: *FetchTasklet) ?Body.Value.ValueError {
        if (this.abort_reason.has()) {
            defer this.clearAbortSignal();
            const out = this.abort_reason;

            this.abort_reason = .empty;
            return Body.Value.ValueError{ .JSValue = out };
        }

        if (this.signal) |signal| {
            if (signal.reasonIfAborted(this.global_this)) |reason| {
                defer this.clearAbortSignal();
                return reason.toBodyValueError(this.global_this);
            }
        }

        return null;
    }

    fn clearAbortSignal(this: *FetchTasklet) void {
        const signal = this.signal orelse return;
        this.signal = null;
        defer {
            signal.pendingActivityUnref();
            signal.unref();
        }

        signal.cleanNativeBindings(this);
    }

    pub fn onReject(this: *FetchTasklet) Body.Value.ValueError {
        bun.assert(this.result.fail != null);
        log("onReject", .{});

        if (this.getAbortError()) |err| {
            return err;
        }

        if (this.result.abortReason()) |reason| {
            return .{ .AbortReason = reason };
        }

        // some times we don't have metadata so we also check http.url
        const path = if (this.metadata) |metadata|
            bun.String.createUTF8(metadata.url)
        else if (this.http) |http_|
            bun.String.createUTF8(http_.url.href)
        else
            bun.String.empty;

        const fetch_error = JSC.SystemError{
            .code = bun.String.static(switch (this.result.fail.?) {
                error.ConnectionClosed => "ECONNRESET",
                else => |e| @errorName(e),
            }),
            .message = switch (this.result.fail.?) {
                error.ConnectionClosed => bun.String.static("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"),
                error.FailedToOpenSocket => bun.String.static("Was there a typo in the url or port?"),
                error.TooManyRedirects => bun.String.static("The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()"),
                error.ConnectionRefused => bun.String.static("Unable to connect. Is the computer able to access the url?"),
                error.RedirectURLInvalid => bun.String.static("Redirect URL in Location header is invalid."),

                error.UNABLE_TO_GET_ISSUER_CERT => bun.String.static("unable to get issuer certificate"),
                error.UNABLE_TO_GET_CRL => bun.String.static("unable to get certificate CRL"),
                error.UNABLE_TO_DECRYPT_CERT_SIGNATURE => bun.String.static("unable to decrypt certificate's signature"),
                error.UNABLE_TO_DECRYPT_CRL_SIGNATURE => bun.String.static("unable to decrypt CRL's signature"),
                error.UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY => bun.String.static("unable to decode issuer public key"),
                error.CERT_SIGNATURE_FAILURE => bun.String.static("certificate signature failure"),
                error.CRL_SIGNATURE_FAILURE => bun.String.static("CRL signature failure"),
                error.CERT_NOT_YET_VALID => bun.String.static("certificate is not yet valid"),
                error.CRL_NOT_YET_VALID => bun.String.static("CRL is not yet valid"),
                error.CERT_HAS_EXPIRED => bun.String.static("certificate has expired"),
                error.CRL_HAS_EXPIRED => bun.String.static("CRL has expired"),
                error.ERROR_IN_CERT_NOT_BEFORE_FIELD => bun.String.static("format error in certificate's notBefore field"),
                error.ERROR_IN_CERT_NOT_AFTER_FIELD => bun.String.static("format error in certificate's notAfter field"),
                error.ERROR_IN_CRL_LAST_UPDATE_FIELD => bun.String.static("format error in CRL's lastUpdate field"),
                error.ERROR_IN_CRL_NEXT_UPDATE_FIELD => bun.String.static("format error in CRL's nextUpdate field"),
                error.OUT_OF_MEM => bun.String.static("out of memory"),
                error.DEPTH_ZERO_SELF_SIGNED_CERT => bun.String.static("self signed certificate"),
                error.SELF_SIGNED_CERT_IN_CHAIN => bun.String.static("self signed certificate in certificate chain"),
                error.UNABLE_TO_GET_ISSUER_CERT_LOCALLY => bun.String.static("unable to get local issuer certificate"),
                error.UNABLE_TO_VERIFY_LEAF_SIGNATURE => bun.String.static("unable to verify the first certificate"),
                error.CERT_CHAIN_TOO_LONG => bun.String.static("certificate chain too long"),
                error.CERT_REVOKED => bun.String.static("certificate revoked"),
                error.INVALID_CA => bun.String.static("invalid CA certificate"),
                error.INVALID_NON_CA => bun.String.static("invalid non-CA certificate (has CA markings)"),
                error.PATH_LENGTH_EXCEEDED => bun.String.static("path length constraint exceeded"),
                error.PROXY_PATH_LENGTH_EXCEEDED => bun.String.static("proxy path length constraint exceeded"),
                error.PROXY_CERTIFICATES_NOT_ALLOWED => bun.String.static("proxy certificates not allowed, please set the appropriate flag"),
                error.INVALID_PURPOSE => bun.String.static("unsupported certificate purpose"),
                error.CERT_UNTRUSTED => bun.String.static("certificate not trusted"),
                error.CERT_REJECTED => bun.String.static("certificate rejected"),
                error.APPLICATION_VERIFICATION => bun.String.static("application verification failure"),
                error.SUBJECT_ISSUER_MISMATCH => bun.String.static("subject issuer mismatch"),
                error.AKID_SKID_MISMATCH => bun.String.static("authority and subject key identifier mismatch"),
                error.AKID_ISSUER_SERIAL_MISMATCH => bun.String.static("authority and issuer serial number mismatch"),
                error.KEYUSAGE_NO_CERTSIGN => bun.String.static("key usage does not include certificate signing"),
                error.UNABLE_TO_GET_CRL_ISSUER => bun.String.static("unable to get CRL issuer certificate"),
                error.UNHANDLED_CRITICAL_EXTENSION => bun.String.static("unhandled critical extension"),
                error.KEYUSAGE_NO_CRL_SIGN => bun.String.static("key usage does not include CRL signing"),
                error.KEYUSAGE_NO_DIGITAL_SIGNATURE => bun.String.static("key usage does not include digital signature"),
                error.UNHANDLED_CRITICAL_CRL_EXTENSION => bun.String.static("unhandled critical CRL extension"),
                error.INVALID_EXTENSION => bun.String.static("invalid or inconsistent certificate extension"),
                error.INVALID_POLICY_EXTENSION => bun.String.static("invalid or inconsistent certificate policy extension"),
                error.NO_EXPLICIT_POLICY => bun.String.static("no explicit policy"),
                error.DIFFERENT_CRL_SCOPE => bun.String.static("Different CRL scope"),
                error.UNSUPPORTED_EXTENSION_FEATURE => bun.String.static("Unsupported extension feature"),
                error.UNNESTED_RESOURCE => bun.String.static("RFC 3779 resource not subset of parent's resources"),
                error.PERMITTED_VIOLATION => bun.String.static("permitted subtree violation"),
                error.EXCLUDED_VIOLATION => bun.String.static("excluded subtree violation"),
                error.SUBTREE_MINMAX => bun.String.static("name constraints minimum and maximum not supported"),
                error.UNSUPPORTED_CONSTRAINT_TYPE => bun.String.static("unsupported name constraint type"),
                error.UNSUPPORTED_CONSTRAINT_SYNTAX => bun.String.static("unsupported or invalid name constraint syntax"),
                error.UNSUPPORTED_NAME_SYNTAX => bun.String.static("unsupported or invalid name syntax"),
                error.CRL_PATH_VALIDATION_ERROR => bun.String.static("CRL path validation error"),
                error.SUITE_B_INVALID_VERSION => bun.String.static("Suite B: certificate version invalid"),
                error.SUITE_B_INVALID_ALGORITHM => bun.String.static("Suite B: invalid public key algorithm"),
                error.SUITE_B_INVALID_CURVE => bun.String.static("Suite B: invalid ECC curve"),
                error.SUITE_B_INVALID_SIGNATURE_ALGORITHM => bun.String.static("Suite B: invalid signature algorithm"),
                error.SUITE_B_LOS_NOT_ALLOWED => bun.String.static("Suite B: curve not allowed for this LOS"),
                error.SUITE_B_CANNOT_SIGN_P_384_WITH_P_256 => bun.String.static("Suite B: cannot sign P-384 with P-256"),
                error.HOSTNAME_MISMATCH => bun.String.static("Hostname mismatch"),
                error.EMAIL_MISMATCH => bun.String.static("Email address mismatch"),
                error.IP_ADDRESS_MISMATCH => bun.String.static("IP address mismatch"),
                error.INVALID_CALL => bun.String.static("Invalid certificate verification context"),
                error.STORE_LOOKUP => bun.String.static("Issuer certificate lookup error"),
                error.NAME_CONSTRAINTS_WITHOUT_SANS => bun.String.static("Issuer has name constraints but leaf has no SANs"),
                error.UNKNOWN_CERTIFICATE_VERIFICATION_ERROR => bun.String.static("unknown certificate verification error"),

                else => |e| bun.String.createFormat("{s} fetching \"{}\". For more information, pass `verbose: true` in the second argument to fetch()", .{
                    @errorName(e),
                    path,
                }) catch bun.outOfMemory(),
            },
            .path = path,
        };

        return .{ .SystemError = fetch_error };
    }

    pub fn onReadableStreamAvailable(ctx: *anyopaque, globalThis: *JSC.JSGlobalObject, readable: JSC.WebCore.ReadableStream) void {
        const this = bun.cast(*FetchTasklet, ctx);
        this.readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable, globalThis);
    }

    pub fn onStartStreamingRequestBodyCallback(ctx: *anyopaque) JSC.WebCore.DrainResult {
        const this = bun.cast(*FetchTasklet, ctx);
        if (this.http) |http_| {
            http_.enableBodyStreaming();
        }
        if (this.signal_store.aborted.load(.monotonic)) {
            return JSC.WebCore.DrainResult{
                .aborted = {},
            };
        }

        this.mutex.lock();
        defer this.mutex.unlock();
        const size_hint = this.getSizeHint();

        var scheduled_response_buffer = this.scheduled_response_buffer.list;
        // This means we have received part of the body but not the whole thing
        if (scheduled_response_buffer.items.len > 0) {
            this.memory_reporter.discard(scheduled_response_buffer.allocatedSlice());
            this.scheduled_response_buffer = .{
                .allocator = this.memory_reporter.allocator(),
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            };

            return .{
                .owned = .{
                    .list = scheduled_response_buffer.toManaged(bun.default_allocator),
                    .size_hint = size_hint,
                },
            };
        }

        return .{
            .estimated_size = size_hint,
        };
    }

    fn getSizeHint(this: *FetchTasklet) Blob.SizeType {
        return switch (this.body_size) {
            .content_length => @truncate(this.body_size.content_length),
            .total_received => @truncate(this.body_size.total_received),
            .unknown => 0,
        };
    }

    fn toBodyValue(this: *FetchTasklet) Body.Value {
        if (this.getAbortError()) |err| {
            return .{ .Error = err };
        }
        if (this.is_waiting_body) {
            const response = Body.Value{
                .Locked = .{
                    .size_hint = this.getSizeHint(),
                    .task = this,
                    .global = this.global_this,
                    .onStartStreaming = FetchTasklet.onStartStreamingRequestBodyCallback,
                    .onReadableStreamAvailable = FetchTasklet.onReadableStreamAvailable,
                },
            };
            return response;
        }

        var scheduled_response_buffer = this.scheduled_response_buffer.list;
        this.memory_reporter.discard(scheduled_response_buffer.allocatedSlice());
        const response = Body.Value{
            .InternalBlob = .{
                .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
            },
        };
        this.scheduled_response_buffer = .{
            .allocator = this.memory_reporter.allocator(),
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        };

        return response;
    }

    fn toResponse(this: *FetchTasklet) Response {
        log("toResponse", .{});
        bun.assert(this.metadata != null);
        // at this point we always should have metadata
        const metadata = this.metadata.?;
        const http_response = metadata.response;
        this.is_waiting_body = this.result.has_more;
        return Response{
            .url = bun.String.createAtomIfPossible(metadata.url),
            .redirected = this.result.redirected,
            .init = .{
                .headers = FetchHeaders.createFromPicoHeaders(http_response.headers),
                .status_code = @as(u16, @truncate(http_response.status_code)),
                .status_text = bun.String.createAtomIfPossible(http_response.status),
            },
            .body = .{
                .value = this.toBodyValue(),
            },
        };
    }

    fn ignoreRemainingResponseBody(this: *FetchTasklet) void {
        log("ignoreRemainingResponseBody", .{});
        // enabling streaming will make the http thread to drain into the main thread (aka stop buffering)
        // without a stream ref, response body or response instance alive it will just ignore the result
        if (this.http) |http_| {
            http_.enableBodyStreaming();
        }
        // we should not keep the process alive if we are ignoring the body
        const vm = this.javascript_vm;
        this.poll_ref.unref(vm);
        // clean any remaining refereces
        this.readable_stream_ref.deinit();
        this.response.deinit();

        if (this.native_response) |response| {
            response.unref();
            this.native_response = null;
        }

        this.ignore_data = true;
    }

    export fn Bun__FetchResponse_finalize(this: *FetchTasklet) callconv(.C) void {
        log("onResponseFinalize", .{});
        if (this.native_response) |response| {
            const body = response.body;
            // Three scenarios:
            //
            // 1. We are streaming, in which case we should not ignore the body.
            // 2. We were buffering, in which case
            //    2a. if we have no promise, we should ignore the body.
            //    2b. if we have a promise, we should keep loading the body.
            // 3. We never started buffering, in which case we should ignore the body.
            //
            // Note: We cannot call .get() on the ReadableStreamRef. This is called inside a finalizer.
            if (body.value != .Locked or this.readable_stream_ref.held.has()) {
                // Scenario 1 or 3.
                return;
            }

            if (body.value.Locked.promise) |promise| {
                if (promise.isEmptyOrUndefinedOrNull()) {
                    // Scenario 2b.
                    this.ignoreRemainingResponseBody();
                }
            } else {
                // Scenario 3.
                this.ignoreRemainingResponseBody();
            }
        }
    }
    comptime {
        _ = Bun__FetchResponse_finalize;
    }

    pub fn onResolve(this: *FetchTasklet) JSValue {
        log("onResolve", .{});
        const response = bun.new(Response, this.toResponse());
        const response_js = Response.makeMaybePooled(@as(*JSC.JSGlobalObject, this.global_this), response);
        response_js.ensureStillAlive();
        this.response = JSC.Weak(FetchTasklet).create(response_js, this.global_this, .FetchResponse, this);
        this.native_response = response.ref();
        return response_js;
    }

    pub fn get(
        allocator: std.mem.Allocator,
        globalThis: *JSC.JSGlobalObject,
        fetch_options: FetchOptions,
        promise: JSC.JSPromise.Strong,
    ) !*FetchTasklet {
        var jsc_vm = globalThis.bunVM();
        var fetch_tasklet = try allocator.create(FetchTasklet);

        fetch_tasklet.* = .{
            .mutex = .{},
            .scheduled_response_buffer = .{
                .allocator = fetch_options.memory_reporter.allocator(),
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            },
            .response_buffer = MutableString{
                .allocator = fetch_options.memory_reporter.allocator(),
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            },
            .http = try allocator.create(http.AsyncHTTP),
            .javascript_vm = jsc_vm,
            .request_body = fetch_options.body,
            .global_this = globalThis,
            .promise = promise,
            .request_headers = fetch_options.headers,
            .url_proxy_buffer = fetch_options.url_proxy_buffer,
            .signal = fetch_options.signal,
            .hostname = fetch_options.hostname,
            .tracker = JSC.Debugger.AsyncTaskTracker.init(jsc_vm),
            .memory_reporter = fetch_options.memory_reporter,
            .check_server_identity = fetch_options.check_server_identity,
            .reject_unauthorized = fetch_options.reject_unauthorized,
        };

        fetch_tasklet.signals = fetch_tasklet.signal_store.to();

        fetch_tasklet.tracker.didSchedule(globalThis);

        if (fetch_tasklet.request_body.store()) |store| {
            store.ref();
        }

        var proxy: ?ZigURL = null;
        if (fetch_options.proxy) |proxy_opt| {
            if (!proxy_opt.isEmpty()) { //if is empty just ignore proxy
                proxy = fetch_options.proxy orelse jsc_vm.transpiler.env.getHttpProxyFor(fetch_options.url);
            }
        } else {
            proxy = jsc_vm.transpiler.env.getHttpProxyFor(fetch_options.url);
        }

        if (fetch_tasklet.check_server_identity.has() and fetch_tasklet.reject_unauthorized) {
            fetch_tasklet.signal_store.cert_errors.store(true, .monotonic);
        } else {
            fetch_tasklet.signals.cert_errors = null;
        }

        // This task gets queued on the HTTP thread.
        fetch_tasklet.http.?.* = http.AsyncHTTP.init(
            fetch_options.memory_reporter.allocator(),
            fetch_options.method,
            fetch_options.url,
            fetch_options.headers.entries,
            fetch_options.headers.buf.items,
            &fetch_tasklet.response_buffer,
            fetch_tasklet.request_body.slice(),
            http.HTTPClientResult.Callback.New(
                *FetchTasklet,
                // handles response events (on headers, on body, etc.)
                FetchTasklet.callback,
            ).init(fetch_tasklet),
            fetch_options.redirect_type,
            .{
                .http_proxy = proxy,
                .hostname = fetch_options.hostname,
                .signals = fetch_tasklet.signals,
                .unix_socket_path = fetch_options.unix_socket_path,
                .disable_timeout = fetch_options.disable_timeout,
                .disable_keepalive = fetch_options.disable_keepalive,
                .disable_decompression = fetch_options.disable_decompression,
                .reject_unauthorized = fetch_options.reject_unauthorized,
                .verbose = fetch_options.verbose,
                .tls_props = fetch_options.ssl_config,
            },
        );
        // enable streaming the write side
        const isStream = fetch_tasklet.request_body == .ReadableStream;
        fetch_tasklet.http.?.client.flags.is_streaming_request_body = isStream;
        fetch_tasklet.is_waiting_request_stream_start = isStream;
        if (isStream) {
            fetch_tasklet.http.?.request_body = .{
                .stream = .{
                    .buffer = .{},
                    .ended = false,
                },
            };
        }
        // TODO is this necessary? the http client already sets the redirect type,
        // so manually setting it here seems redundant
        if (fetch_options.redirect_type != FetchRedirect.follow) {
            fetch_tasklet.http.?.client.remaining_redirect_count = 0;
        }

        // we want to return after headers are received
        fetch_tasklet.signal_store.header_progress.store(true, .monotonic);

        if (fetch_tasklet.request_body == .Sendfile) {
            bun.assert(fetch_options.url.isHTTP());
            bun.assert(fetch_options.proxy == null);
            fetch_tasklet.http.?.request_body = .{ .sendfile = fetch_tasklet.request_body.Sendfile };
        }

        if (fetch_tasklet.signal) |signal| {
            signal.pendingActivityRef();
            fetch_tasklet.signal = signal.listen(FetchTasklet, fetch_tasklet, FetchTasklet.abortListener);
        }
        return fetch_tasklet;
    }

    pub fn abortListener(this: *FetchTasklet, reason: JSValue) void {
        log("abortListener", .{});
        reason.ensureStillAlive();
        this.abort_reason.set(this.global_this, reason);
        this.abortTask();
        if (this.sink) |wrapper| {
            wrapper.sink.abort();
            return;
        }
    }

    pub fn sendRequestData(this: *FetchTasklet, data: []const u8, ended: bool) void {
        if (this.http) |http_| {
            http.http_thread.scheduleRequestWrite(http_, data, ended);
        } else if (data.len != 3) {
            bun.default_allocator.free(data);
        }
    }

    pub fn abortTask(this: *FetchTasklet) void {
        this.signal_store.aborted.store(true, .monotonic);
        this.tracker.didCancel(this.global_this);

        if (this.http) |http_| {
            http.http_thread.scheduleShutdown(http_);
        }
    }

    const FetchOptions = struct {
        method: Method,
        headers: Headers,
        body: HTTPRequestBody,
        disable_timeout: bool,
        disable_keepalive: bool,
        disable_decompression: bool,
        reject_unauthorized: bool,
        url: ZigURL,
        verbose: http.HTTPVerboseLevel = .none,
        redirect_type: FetchRedirect = FetchRedirect.follow,
        proxy: ?ZigURL = null,
        url_proxy_buffer: []const u8 = "",
        signal: ?*JSC.WebCore.AbortSignal = null,
        globalThis: ?*JSGlobalObject,
        // Custom Hostname
        hostname: ?[]u8 = null,
        memory_reporter: *bun.MemoryReportingAllocator,
        check_server_identity: JSC.Strong.Optional = .empty,
        unix_socket_path: ZigString.Slice,
        ssl_config: ?*SSLConfig = null,
    };

    pub fn queue(
        allocator: std.mem.Allocator,
        global: *JSGlobalObject,
        fetch_options: FetchOptions,
        promise: JSC.JSPromise.Strong,
    ) !*FetchTasklet {
        http.HTTPThread.init(&.{});
        var node = try get(
            allocator,
            global,
            fetch_options,
            promise,
        );

        var batch = bun.ThreadPool.Batch{};
        node.http.?.schedule(allocator, &batch);
        node.poll_ref.ref(global.bunVM());

        // increment ref so we can keep it alive until the http client is done
        node.ref();
        http.http_thread.schedule(batch);

        return node;
    }

    /// Called from HTTP thread. Handles HTTP events received from socket.
    pub fn callback(task: *FetchTasklet, async_http: *http.AsyncHTTP, result: http.HTTPClientResult) void {
        // at this point only this thread is accessing result to is no race condition
        const is_done = !result.has_more;
        // we are done with the http client so we can deref our side
        // this is a atomic operation and will enqueue a task to deinit on the main thread
        defer if (is_done) task.derefFromThread();

        task.mutex.lock();
        // we need to unlock before task.deref();
        defer task.mutex.unlock();
        task.http.?.* = async_http.*;
        task.http.?.response_buffer = async_http.response_buffer;

        log("callback success={} has_more={} bytes={}", .{ result.isSuccess(), result.has_more, result.body.?.list.items.len });

        const prev_metadata = task.result.metadata;
        const prev_cert_info = task.result.certificate_info;
        task.result = result;

        // Preserve pending certificate info if it was preovided in the previous update.
        if (task.result.certificate_info == null) {
            if (prev_cert_info) |cert_info| {
                task.result.certificate_info = cert_info;
            }
        }

        // metadata should be provided only once
        if (result.metadata orelse prev_metadata) |metadata| {
            log("added callback metadata", .{});
            if (task.metadata == null) {
                task.metadata = metadata;
            }

            task.result.metadata = null;
        }

        task.body_size = result.body_size;

        const success = result.isSuccess();
        task.response_buffer = result.body.?.*;

        if (task.ignore_data) {
            task.response_buffer.reset();

            if (task.scheduled_response_buffer.list.capacity > 0) {
                task.scheduled_response_buffer.deinit();
                task.scheduled_response_buffer = .{
                    .allocator = task.memory_reporter.allocator(),
                    .list = .{
                        .items = &.{},
                        .capacity = 0,
                    },
                };
            }
            if (success and result.has_more) {
                // we are ignoring the body so we should not receive more data, so will only signal when result.has_more = true
                return;
            }
        } else {
            if (success) {
                _ = task.scheduled_response_buffer.write(task.response_buffer.list.items) catch bun.outOfMemory();
            }
            // reset for reuse
            task.response_buffer.reset();
        }

        if (task.has_schedule_callback.cmpxchgStrong(false, true, .acquire, .monotonic)) |has_schedule_callback| {
            if (has_schedule_callback) {
                return;
            }
        }

        task.javascript_vm.eventLoop().enqueueTaskConcurrent(task.concurrent_task.from(task, .manual_deinit));
    }
};

fn dataURLResponse(
    _data_url: DataURL,
    globalThis: *JSGlobalObject,
    allocator: std.mem.Allocator,
) JSValue {
    var data_url = _data_url;

    const data = data_url.decodeData(allocator) catch {
        const err = globalThis.createError("failed to fetch the data URL", .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    };
    var blob = Blob.init(data, allocator, globalThis);

    var allocated = false;
    const mime_type = bun.http.MimeType.init(data_url.mime_type, allocator, &allocated);
    blob.content_type = mime_type.value;
    if (allocated) {
        blob.content_type_allocated = true;
    }

    var response = bun.new(
        Response,
        Response{
            .body = Body{
                .value = .{
                    .Blob = blob,
                },
            },
            .init = Response.Init{
                .status_code = 200,
                .status_text = bun.String.createAtomASCII("OK"),
            },
            .url = data_url.url.dupeRef(),
        },
    );

    return JSPromise.resolvedPromiseValue(globalThis, response.toJS(globalThis));
}

comptime {
    const Bun__fetchPreconnect = JSC.toJSHostFn(Bun__fetchPreconnect_);
    @export(&Bun__fetchPreconnect, .{ .name = "Bun__fetchPreconnect" });
}
pub fn Bun__fetchPreconnect_(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).slice();

    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("fetch.preconnect", 1, arguments.len);
    }

    var url_str = try JSC.URL.hrefFromJS(arguments[0], globalObject);
    defer url_str.deref();

    if (globalObject.hasException()) {
        return .zero;
    }

    if (url_str.tag == .Dead) {
        return globalObject.ERR(.INVALID_ARG_TYPE, "Invalid URL", .{}).throw();
    }

    if (url_str.isEmpty()) {
        return globalObject.ERR(.INVALID_ARG_TYPE, fetch_error_blank_url, .{}).throw();
    }

    const url = ZigURL.parse(url_str.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory());
    if (!url.isHTTP() and !url.isHTTPS() and !url.isS3()) {
        bun.default_allocator.free(url.href);
        return globalObject.throwInvalidArguments("URL must be HTTP or HTTPS", .{});
    }

    if (url.hostname.len == 0) {
        bun.default_allocator.free(url.href);
        return globalObject.ERR(.INVALID_ARG_TYPE, fetch_error_blank_url, .{}).throw();
    }

    if (!url.hasValidPort()) {
        bun.default_allocator.free(url.href);
        return globalObject.throwInvalidArguments("Invalid port", .{});
    }

    bun.http.AsyncHTTP.preconnect(url, true);
    return .js_undefined;
}

const StringOrURL = struct {
    pub fn fromJS(value: JSC.JSValue, globalThis: *JSC.JSGlobalObject) bun.JSError!?bun.String {
        if (value.isString()) {
            return try bun.String.fromJS(value, globalThis);
        }

        const out = try JSC.URL.hrefFromJS(value, globalThis);
        if (out.tag == .Dead) return null;
        return out;
    }
};

comptime {
    const Bun__fetch = JSC.toJSHostFn(Bun__fetch_);
    @export(&Bun__fetch, .{ .name = "Bun__fetch" });
}

/// Implementation of `Bun.fetch`
pub fn Bun__fetch_(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    JSC.markBinding(@src());
    const globalThis = ctx;
    const arguments = callframe.arguments_old(2);
    bun.Analytics.Features.fetch += 1;
    const vm = JSC.VirtualMachine.get();

    var memory_reporter = bun.default_allocator.create(bun.MemoryReportingAllocator) catch bun.outOfMemory();
    // used to clean up dynamically allocated memory on error (a poor man's errdefer)
    var is_error = false;
    var allocator = memory_reporter.wrap(bun.default_allocator);
    errdefer bun.default_allocator.destroy(memory_reporter);
    defer {
        memory_reporter.report(globalThis.vm());

        if (is_error) bun.default_allocator.destroy(memory_reporter);
    }

    if (arguments.len == 0) {
        const err = ctx.toTypeError(.MISSING_ARGS, fetch_error_no_args, .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    var headers: ?Headers = null;
    var method = Method.GET;

    var args = JSC.CallFrame.ArgumentsSlice.init(vm, arguments.slice());

    var url = ZigURL{};
    var first_arg = args.nextEat().?;

    // We must always get the Body before the Headers That way, we can set
    // the Content-Type header from the Blob if no Content-Type header is
    // set in the Headers
    //
    // which is important for FormData.
    // https://github.com/oven-sh/bun/issues/2264
    //
    var body: FetchTasklet.HTTPRequestBody = FetchTasklet.HTTPRequestBody.Empty;

    var disable_timeout = false;
    var disable_keepalive = false;
    var disable_decompression = false;
    var verbose: http.HTTPVerboseLevel = if (vm.log.level.atLeast(.debug)) .headers else .none;
    if (verbose == .none) {
        verbose = vm.getVerboseFetch();
    }

    var proxy: ?ZigURL = null;
    var redirect_type: FetchRedirect = FetchRedirect.follow;
    var signal: ?*JSC.WebCore.AbortSignal = null;
    // Custom Hostname
    var hostname: ?[]u8 = null;
    var range: ?[]u8 = null;
    var unix_socket_path: ZigString.Slice = ZigString.Slice.empty;

    var url_proxy_buffer: []const u8 = "";
    const URLType = enum {
        remote,
        file,
        blob,
    };
    var url_type = URLType.remote;

    var ssl_config: ?*SSLConfig = null;
    var reject_unauthorized = vm.getTLSRejectUnauthorized();
    var check_server_identity: JSValue = .zero;

    defer {
        if (signal) |sig| {
            signal = null;
            sig.unref();
        }

        unix_socket_path.deinit();

        allocator.free(url_proxy_buffer);
        url_proxy_buffer = "";

        if (headers) |*headers_| {
            headers_.buf.deinit(allocator);
            headers_.entries.deinit(allocator);
            headers = null;
        }

        body.detach();

        // clean hostname if any
        if (hostname) |hn| {
            bun.default_allocator.free(hn);
            hostname = null;
        }
        if (range) |range_| {
            bun.default_allocator.free(range_);
            range = null;
        }

        if (ssl_config) |conf| {
            ssl_config = null;
            conf.deinit();
            bun.default_allocator.destroy(conf);
        }
    }

    const options_object: ?JSValue = brk: {
        if (args.nextEat()) |options| {
            if (options.isObject() or options.jsType() == .DOMWrapper) {
                break :brk options;
            }
        }

        break :brk null;
    };
    const request: ?*Request = brk: {
        if (first_arg.isCell()) {
            if (first_arg.asDirect(Request)) |request_| {
                break :brk request_;
            }
        }

        break :brk null;
    };
    // If it's NOT a Request or a subclass of Request, treat the first argument as a URL.
    const url_str_optional = if (first_arg.as(Request) == null) try StringOrURL.fromJS(first_arg, globalThis) else null;
    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    const request_init_object: ?JSValue = brk: {
        if (request != null) break :brk null;
        if (url_str_optional != null) break :brk null;
        if (first_arg.isObject()) break :brk first_arg;
        break :brk null;
    };

    var url_str = extract_url: {
        if (url_str_optional) |str| break :extract_url str;

        if (request) |req| {
            req.ensureURL() catch bun.outOfMemory();
            break :extract_url req.url.dupeRef();
        }

        if (request_init_object) |request_init| {
            if (try request_init.fastGet(globalThis, .url)) |url_| {
                if (!url_.isUndefined()) {
                    break :extract_url try bun.String.fromJS(url_, globalThis);
                }
            }
        }

        break :extract_url bun.String.empty;
    };
    defer url_str.deref();

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    if (url_str.isEmpty()) {
        is_error = true;
        const err = ctx.toTypeError(.INVALID_URL, fetch_error_blank_url, .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (url_str.hasPrefixComptime("data:")) {
        var url_slice = url_str.toUTF8WithoutRef(allocator);
        defer url_slice.deinit();

        var data_url = DataURL.parseWithoutCheck(url_slice.slice()) catch {
            const err = ctx.createError("failed to fetch the data URL", .{});
            is_error = true;
            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
        };

        data_url.url = url_str;
        return dataURLResponse(data_url, globalThis, allocator);
    }

    url = ZigURL.fromString(allocator, url_str) catch {
        const err = ctx.toTypeError(.INVALID_URL, "fetch() URL is invalid", .{});
        is_error = true;
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(
            globalThis,
            err,
        );
    };
    if (url.isFile()) {
        url_type = URLType.file;
    } else if (url.isBlob()) {
        url_type = URLType.blob;
    }
    url_proxy_buffer = url.href;

    if (url_str.hasPrefixComptime("data:")) {
        var url_slice = url_str.toUTF8WithoutRef(allocator);
        defer url_slice.deinit();

        var data_url = DataURL.parseWithoutCheck(url_slice.slice()) catch {
            const err = globalThis.createError("failed to fetch the data URL", .{});
            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
        };
        data_url.url = url_str;

        return dataURLResponse(data_url, globalThis, allocator);
    }

    // **Start with the harmless ones.**

    // "method"
    method = extract_method: {
        if (options_object) |options| {
            if (try options.getTruthyComptime(globalThis, "method")) |method_| {
                break :extract_method try Method.fromJS(globalThis, method_);
            }
        }

        if (request) |req| {
            break :extract_method req.method;
        }

        if (request_init_object) |req| {
            if (try req.getTruthyComptime(globalThis, "method")) |method_| {
                break :extract_method try Method.fromJS(globalThis, method_);
            }
        }

        break :extract_method null;
    } orelse .GET;

    // "decompress: boolean"
    disable_decompression = extract_disable_decompression: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "decompress")) |decompression_value| {
                    if (decompression_value.isBoolean()) {
                        break :extract_disable_decompression !decompression_value.asBoolean();
                    } else if (decompression_value.isNumber()) {
                        break :extract_disable_decompression decompression_value.to(i32) == 0;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_disable_decompression disable_decompression;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // "tls: TLSConfig"
    ssl_config = extract_ssl_config: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "tls")) |tls| {
                    if (tls.isObject()) {
                        if (try tls.get(ctx, "rejectUnauthorized")) |reject| {
                            if (reject.isBoolean()) {
                                reject_unauthorized = reject.asBoolean();
                            } else if (reject.isNumber()) {
                                reject_unauthorized = reject.to(i32) != 0;
                            }
                        }

                        if (globalThis.hasException()) {
                            is_error = true;
                            return .zero;
                        }

                        if (try tls.get(ctx, "checkServerIdentity")) |checkServerIdentity| {
                            if (checkServerIdentity.isCell() and checkServerIdentity.isCallable()) {
                                check_server_identity = checkServerIdentity;
                            }
                        }

                        if (globalThis.hasException()) {
                            is_error = true;
                            return .zero;
                        }

                        if (SSLConfig.fromJS(vm, globalThis, tls) catch {
                            is_error = true;
                            return .zero;
                        }) |config| {
                            const ssl_config_object = bun.default_allocator.create(SSLConfig) catch bun.outOfMemory();
                            ssl_config_object.* = config;
                            break :extract_ssl_config ssl_config_object;
                        }
                    }
                }
            }
        }

        break :extract_ssl_config ssl_config;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // unix: string | undefined
    unix_socket_path = extract_unix_socket_path: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "unix")) |socket_path| {
                    if (socket_path.isString() and try socket_path.getLength(ctx) > 0) {
                        if (socket_path.toSliceCloneWithAllocator(globalThis, allocator)) |slice| {
                            break :extract_unix_socket_path slice;
                        }
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }
        break :extract_unix_socket_path unix_socket_path;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // timeout: false | number | undefined
    disable_timeout = extract_disable_timeout: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "timeout")) |timeout_value| {
                    if (timeout_value.isBoolean()) {
                        break :extract_disable_timeout !timeout_value.asBoolean();
                    } else if (timeout_value.isNumber()) {
                        break :extract_disable_timeout timeout_value.to(i32) == 0;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_disable_timeout disable_timeout;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // redirect: "follow" | "error" | "manual" | undefined;
    redirect_type = extract_redirect_type: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (objects_to_try[i].getOptionalEnum(globalThis, "redirect", FetchRedirect) catch {
                    is_error = true;
                    return .zero;
                }) |redirect_value| {
                    break :extract_redirect_type redirect_value;
                }
            }
        }

        break :extract_redirect_type redirect_type;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // keepalive: boolean | undefined;
    disable_keepalive = extract_disable_keepalive: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "keepalive")) |keepalive_value| {
                    if (keepalive_value.isBoolean()) {
                        break :extract_disable_keepalive !keepalive_value.asBoolean();
                    } else if (keepalive_value.isNumber()) {
                        break :extract_disable_keepalive keepalive_value.to(i32) == 0;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_disable_keepalive disable_keepalive;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // verbose: boolean | "curl" | undefined;
    verbose = extract_verbose: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "verbose")) |verb| {
                    if (verb.isString()) {
                        if ((try verb.getZigString(globalThis)).eqlComptime("curl")) {
                            break :extract_verbose .curl;
                        }
                    } else if (verb.isBoolean()) {
                        break :extract_verbose if (verb.toBoolean()) .headers else .none;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }
        break :extract_verbose verbose;
    };

    // proxy: string | undefined;
    url_proxy_buffer = extract_proxy: {
        const objects_to_try = [_]JSC.JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };
        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "proxy")) |proxy_arg| {
                    if (proxy_arg.isString() and try proxy_arg.getLength(ctx) > 0) {
                        var href = try JSC.URL.hrefFromJS(proxy_arg, globalThis);
                        if (href.tag == .Dead) {
                            const err = ctx.toTypeError(.INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{});
                            is_error = true;
                            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
                        }
                        defer href.deref();
                        const buffer = try std.fmt.allocPrint(allocator, "{s}{}", .{ url_proxy_buffer, href });
                        url = ZigURL.parse(buffer[0..url.href.len]);
                        if (url.isFile()) {
                            url_type = URLType.file;
                        } else if (url.isBlob()) {
                            url_type = URLType.blob;
                        }

                        proxy = ZigURL.parse(buffer[url.href.len..]);
                        allocator.free(url_proxy_buffer);
                        break :extract_proxy buffer;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_proxy url_proxy_buffer;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // signal: AbortSignal | undefined;
    signal = extract_signal: {
        if (options_object) |options| {
            if (try options.get(globalThis, "signal")) |signal_| {
                if (!signal_.isUndefined()) {
                    if (signal_.as(JSC.WebCore.AbortSignal)) |signal__| {
                        break :extract_signal signal__.ref();
                    }
                }
            }

            if (globalThis.hasException()) {
                is_error = true;
                return .zero;
            }
        }

        if (request) |req| {
            if (req.signal) |signal_| {
                break :extract_signal signal_.ref();
            }
            break :extract_signal null;
        }

        if (request_init_object) |options| {
            if (try options.get(globalThis, "signal")) |signal_| {
                if (signal_.isUndefined()) {
                    break :extract_signal null;
                }

                if (signal_.as(JSC.WebCore.AbortSignal)) |signal__| {
                    break :extract_signal signal__.ref();
                }
            }
        }

        break :extract_signal null;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // We do this 2nd to last instead of last so that if it's a FormData
    // object, we can still insert the boundary.
    //
    // body: BodyInit | null | undefined;
    //
    body = extract_body: {
        if (options_object) |options| {
            if (try options.fastGet(globalThis, .body)) |body__| {
                if (!body__.isUndefined()) {
                    break :extract_body try FetchTasklet.HTTPRequestBody.fromJS(ctx, body__);
                }
            }

            if (globalThis.hasException()) {
                is_error = true;
                return .zero;
            }
        }

        if (request) |req| {
            if (req.body.value == .Used or (req.body.value == .Locked and (req.body.value.Locked.action != .none or req.body.value.Locked.isDisturbed(Request, globalThis, first_arg)))) {
                return globalThis.ERR(.BODY_ALREADY_USED, "Request body already used", .{}).throw();
            }

            if (req.body.value == .Locked) {
                if (req.body.value.Locked.readable.has()) {
                    break :extract_body FetchTasklet.HTTPRequestBody{ .ReadableStream = JSC.WebCore.ReadableStream.Strong.init(req.body.value.Locked.readable.get(globalThis).?, globalThis) };
                }
                const readable = req.body.value.toReadableStream(globalThis);
                if (!readable.isEmptyOrUndefinedOrNull() and req.body.value == .Locked and req.body.value.Locked.readable.has()) {
                    break :extract_body FetchTasklet.HTTPRequestBody{ .ReadableStream = JSC.WebCore.ReadableStream.Strong.init(req.body.value.Locked.readable.get(globalThis).?, globalThis) };
                }
            }

            break :extract_body FetchTasklet.HTTPRequestBody{ .AnyBlob = req.body.value.useAsAnyBlob() };
        }

        if (request_init_object) |req| {
            if (try req.fastGet(globalThis, .body)) |body__| {
                if (!body__.isUndefined()) {
                    break :extract_body try FetchTasklet.HTTPRequestBody.fromJS(ctx, body__);
                }
            }
        }

        break :extract_body null;
    } orelse FetchTasklet.HTTPRequestBody.Empty;

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // headers: Headers | undefined;
    headers = extract_headers: {
        var fetch_headers_to_deref: ?*bun.webcore.FetchHeaders = null;
        defer {
            if (fetch_headers_to_deref) |fetch_headers| {
                fetch_headers.deref();
            }
        }

        const fetch_headers: ?*bun.webcore.FetchHeaders = brk: {
            if (options_object) |options| {
                if (try options.fastGet(globalThis, .headers)) |headers_value| {
                    if (!headers_value.isUndefined()) {
                        if (headers_value.as(FetchHeaders)) |headers__| {
                            if (headers__.isEmpty()) {
                                break :brk null;
                            }

                            break :brk headers__;
                        }

                        if (FetchHeaders.createFromJS(ctx, headers_value)) |headers__| {
                            fetch_headers_to_deref = headers__;
                            break :brk headers__;
                        }

                        break :brk null;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }

            if (request) |req| {
                if (req.getFetchHeadersUnlessEmpty()) |head| {
                    break :brk head;
                }

                break :brk null;
            }

            if (request_init_object) |options| {
                if (try options.fastGet(globalThis, .headers)) |headers_value| {
                    if (!headers_value.isUndefined()) {
                        if (headers_value.as(FetchHeaders)) |headers__| {
                            if (headers__.isEmpty()) {
                                break :brk null;
                            }

                            break :brk headers__;
                        }

                        if (FetchHeaders.createFromJS(ctx, headers_value)) |headers__| {
                            fetch_headers_to_deref = headers__;
                            break :brk headers__;
                        }

                        break :brk null;
                    }
                }
            }

            if (globalThis.hasException()) {
                is_error = true;
                return .zero;
            }

            break :extract_headers headers;
        };

        if (globalThis.hasException()) {
            is_error = true;
            return .zero;
        }

        if (fetch_headers) |headers_| {
            if (headers_.fastGet(bun.webcore.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                if (hostname) |host| {
                    hostname = null;
                    allocator.free(host);
                }
                hostname = _hostname.toOwnedSliceZ(allocator) catch bun.outOfMemory();
            }
            if (url.isS3()) {
                if (headers_.fastGet(bun.webcore.FetchHeaders.HTTPHeaderName.Range)) |_range| {
                    if (range) |range_| {
                        range = null;
                        allocator.free(range_);
                    }
                    range = _range.toOwnedSliceZ(allocator) catch bun.outOfMemory();
                }
            }

            break :extract_headers Headers.from(headers_, allocator, .{ .body = body.getAnyBlob() }) catch bun.outOfMemory();
        }

        break :extract_headers headers;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    if (proxy != null and unix_socket_path.length() > 0) {
        is_error = true;
        const err = ctx.toTypeError(.INVALID_ARG_VALUE, fetch_error_proxy_unix, .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // This is not 100% correct.
    // We don't pass along headers, we ignore method, we ignore status code...
    // But it's better than status quo.
    if (url_type != .remote) {
        defer unix_socket_path.deinit();
        var path_buf: bun.PathBuffer = undefined;
        const PercentEncoding = @import("../../url.zig").PercentEncoding;
        var path_buf2: bun.PathBuffer = undefined;
        var stream = std.io.fixedBufferStream(&path_buf2);
        var url_path_decoded = path_buf2[0 .. PercentEncoding.decode(
            @TypeOf(&stream.writer()),
            &stream.writer(),
            switch (url_type) {
                .file => url.path,
                .blob => url.href["blob:".len..],
                .remote => unreachable,
            },
        ) catch |err| {
            return globalThis.throwError(err, "Failed to decode file url");
        }];
        var url_string: bun.String = bun.String.empty;
        defer url_string.deref();
        // This can be a blob: url or a file: url.
        const blob_to_use = blob: {

            // Support blob: urls
            if (url_type == URLType.blob) {
                if (JSC.WebCore.ObjectURLRegistry.singleton().resolveAndDupe(url_path_decoded)) |blob| {
                    url_string = bun.String.createFormat("blob:{s}", .{url_path_decoded}) catch bun.outOfMemory();
                    break :blob blob;
                } else {
                    // Consistent with what Node.js does - it rejects, not a 404.
                    const err = globalThis.toTypeError(.INVALID_ARG_VALUE, "Failed to resolve blob:{s}", .{
                        url_path_decoded,
                    });
                    is_error = true;
                    return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
                }
            }

            const temp_file_path = brk: {
                if (std.fs.path.isAbsolute(url_path_decoded)) {
                    if (Environment.isWindows) {
                        // pathname will start with / if is a absolute path on windows, so we remove before normalizing it
                        if (url_path_decoded[0] == '/') {
                            url_path_decoded = url_path_decoded[1..];
                        }
                        break :brk PosixToWinNormalizer.resolveCWDWithExternalBufZ(&path_buf, url_path_decoded) catch |err| {
                            return globalThis.throwError(err, "Failed to resolve file url");
                        };
                    }
                    break :brk url_path_decoded;
                }

                var cwd_buf: bun.PathBuffer = undefined;
                const cwd = if (Environment.isWindows) (bun.getcwd(&cwd_buf) catch |err| {
                    return globalThis.throwError(err, "Failed to resolve file url");
                }) else globalThis.bunVM().transpiler.fs.top_level_dir;

                const fullpath = bun.path.joinAbsStringBuf(
                    cwd,
                    &path_buf,
                    &[_]string{
                        globalThis.bunVM().main,
                        "../",
                        url_path_decoded,
                    },
                    .auto,
                );
                if (Environment.isWindows) {
                    break :brk PosixToWinNormalizer.resolveCWDWithExternalBufZ(&path_buf2, fullpath) catch |err| {
                        return globalThis.throwError(err, "Failed to resolve file url");
                    };
                }
                break :brk fullpath;
            };

            url_string = JSC.URL.fileURLFromString(bun.String.fromUTF8(temp_file_path));

            var pathlike: JSC.Node.PathOrFileDescriptor = .{
                .path = .{
                    .encoded_slice = ZigString.Slice.init(bun.default_allocator, try bun.default_allocator.dupe(u8, temp_file_path)),
                },
            };

            break :blob Blob.findOrCreateFileFromPath(
                &pathlike,
                globalThis,
                true,
            );
        };

        const response = bun.new(Response, Response{
            .body = Body{
                .value = .{ .Blob = blob_to_use },
            },
            .init = Response.Init{
                .status_code = 200,
            },
            .url = url_string.clone(),
        });

        return JSPromise.resolvedPromiseValue(globalThis, response.toJS(globalThis));
    }

    if (url.protocol.len > 0) {
        if (!(url.isHTTP() or url.isHTTPS() or url.isS3())) {
            const err = globalThis.toTypeError(.INVALID_ARG_VALUE, "protocol must be http:, https: or s3:", .{});
            is_error = true;
            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
        }
    }

    if (!method.hasRequestBody() and body.hasBody()) {
        const err = globalThis.toTypeError(.INVALID_ARG_VALUE, fetch_error_unexpected_body, .{});
        is_error = true;
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (headers == null and body.hasBody() and body.hasContentTypeFromUser()) {
        headers = Headers.from(
            null,
            allocator,
            .{ .body = body.getAnyBlob() },
        ) catch bun.outOfMemory();
    }

    var http_body = body;
    if (body.isS3()) {
        prepare_body: {
            // is a S3 file we can use chunked here

            if (JSC.WebCore.ReadableStream.fromJS(JSC.WebCore.ReadableStream.fromBlobCopyRef(globalThis, &body.AnyBlob.Blob, s3.MultiPartUploadOptions.DefaultPartSize), globalThis)) |stream| {
                var old = body;
                defer old.detach();
                body = .{ .ReadableStream = JSC.WebCore.ReadableStream.Strong.init(stream, globalThis) };
                break :prepare_body;
            }
            const rejected_value = JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, globalThis.createErrorInstance("Failed to start s3 stream", .{}));
            body.detach();

            return rejected_value;
        }
    }
    if (body.needsToReadFile()) {
        prepare_body: {
            const opened_fd_res: JSC.Maybe(bun.FileDescriptor) = switch (body.store().?.data.file.pathlike) {
                .fd => |fd| bun.sys.dup(fd),
                .path => |path| bun.sys.open(path.sliceZ(&globalThis.bunVM().nodeFS().sync_error_buf), if (Environment.isWindows) bun.O.RDONLY else bun.O.RDONLY | bun.O.NOCTTY, 0),
            };

            const opened_fd = switch (opened_fd_res) {
                .err => |err| {
                    const rejected_value = JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err.toJSC(globalThis));
                    is_error = true;
                    return rejected_value;
                },
                .result => |fd| fd,
            };

            if (proxy == null and bun.http.Sendfile.isEligible(url)) {
                use_sendfile: {
                    const stat: bun.Stat = switch (bun.sys.fstat(opened_fd)) {
                        .result => |result| result,
                        // bail out for any reason
                        .err => break :use_sendfile,
                    };

                    if (Environment.isMac) {
                        // macOS only supports regular files for sendfile()
                        if (!bun.isRegularFile(stat.mode)) {
                            break :use_sendfile;
                        }
                    }

                    // if it's < 32 KB, it's not worth it
                    if (stat.size < 32 * 1024) {
                        break :use_sendfile;
                    }

                    const original_size = body.AnyBlob.Blob.size;
                    const stat_size = @as(Blob.SizeType, @intCast(stat.size));
                    const blob_size = if (bun.isRegularFile(stat.mode))
                        stat_size
                    else
                        @min(original_size, stat_size);

                    http_body = .{
                        .Sendfile = .{
                            .fd = opened_fd,
                            .remain = body.AnyBlob.Blob.offset + original_size,
                            .offset = body.AnyBlob.Blob.offset,
                            .content_size = blob_size,
                        },
                    };

                    if (bun.isRegularFile(stat.mode)) {
                        http_body.Sendfile.offset = @min(http_body.Sendfile.offset, stat_size);
                        http_body.Sendfile.remain = @min(@max(http_body.Sendfile.remain, http_body.Sendfile.offset), stat_size) -| http_body.Sendfile.offset;
                    }
                    body.detach();

                    break :prepare_body;
                }
            }

            // TODO: make this async + lazy
            const res = JSC.Node.fs.NodeFS.readFile(
                globalThis.bunVM().nodeFS(),
                .{
                    .encoding = .buffer,
                    .path = .{ .fd = opened_fd },
                    .offset = body.AnyBlob.Blob.offset,
                    .max_size = body.AnyBlob.Blob.size,
                },
                .sync,
            );

            if (body.store().?.data.file.pathlike == .path) {
                opened_fd.close();
            }

            switch (res) {
                .err => |err| {
                    is_error = true;
                    const rejected_value = JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err.toJSC(globalThis));
                    body.detach();

                    return rejected_value;
                },
                .result => |result| {
                    body.detach();
                    body = .{ .AnyBlob = .fromOwnedSlice(allocator, @constCast(result.slice())) };
                    http_body = .{ .AnyBlob = body.AnyBlob };
                },
            }
        }
    }

    if (url.isS3()) {
        // get ENV config
        var credentialsWithOptions: s3.S3CredentialsWithOptions = .{
            .credentials = globalThis.bunVM().transpiler.env.getS3Credentials(),
            .options = .{},
            .acl = null,
            .storage_class = null,
        };
        defer {
            credentialsWithOptions.deinit();
        }

        if (options_object) |options| {
            if (try options.getTruthyComptime(globalThis, "s3")) |s3_options| {
                if (s3_options.isObject()) {
                    s3_options.ensureStillAlive();
                    credentialsWithOptions = try s3.S3Credentials.getCredentialsWithOptions(credentialsWithOptions.credentials, .{}, s3_options, null, null, globalThis);
                }
            }
        }

        if (body == .ReadableStream) {
            // we cannot direct stream to s3 we need to use multi part upload
            defer body.ReadableStream.deinit();
            const Wrapper = struct {
                promise: JSC.JSPromise.Strong,
                url: ZigURL,
                url_proxy_buffer: []const u8,
                global: *JSC.JSGlobalObject,

                pub const new = bun.TrivialNew(@This());

                pub fn resolve(result: s3.S3UploadResult, self: *@This()) void {
                    const global = self.global;
                    switch (result) {
                        .success => {
                            const response = bun.new(Response, Response{
                                .body = .{ .value = .Empty },
                                .redirected = false,
                                .init = .{ .method = .PUT, .status_code = 200 },
                                .url = bun.String.createAtomIfPossible(self.url.href),
                            });
                            const response_js = Response.makeMaybePooled(@as(*JSC.JSGlobalObject, global), response);
                            response_js.ensureStillAlive();
                            self.promise.resolve(global, response_js);
                        },
                        .failure => |err| {
                            const response = bun.new(Response, Response{
                                .body = .{
                                    .value = .{
                                        .InternalBlob = .{
                                            .bytes = std.ArrayList(u8).fromOwnedSlice(bun.default_allocator, bun.default_allocator.dupe(u8, err.message) catch bun.outOfMemory()),
                                            .was_string = true,
                                        },
                                    },
                                },
                                .redirected = false,
                                .init = .{
                                    .method = .PUT,
                                    .status_code = 500,
                                    .status_text = bun.String.createAtomIfPossible(err.code),
                                },
                                .url = bun.String.createAtomIfPossible(self.url.href),
                            });
                            const response_js = Response.makeMaybePooled(@as(*JSC.JSGlobalObject, global), response);
                            response_js.ensureStillAlive();
                            self.promise.resolve(global, response_js);
                        },
                    }
                    bun.default_allocator.free(self.url_proxy_buffer);
                    bun.destroy(self);
                }
            };
            if (method != .PUT and method != .POST) {
                return JSC.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, globalThis.createErrorInstance("Only POST and PUT do support body when using S3", .{}));
            }
            const promise = JSC.JSPromise.Strong.init(globalThis);

            const s3_stream = Wrapper.new(.{
                .url = url,
                .url_proxy_buffer = url_proxy_buffer,
                .promise = promise,
                .global = globalThis,
            });

            const promise_value = promise.value();
            const proxy_url = if (proxy) |p| p.href else "";
            _ = bun.S3.uploadStream(
                credentialsWithOptions.credentials.dupe(),
                url.s3Path(),
                body.ReadableStream.get(globalThis).?,
                globalThis,
                credentialsWithOptions.options,
                credentialsWithOptions.acl,
                credentialsWithOptions.storage_class,
                if (headers) |h| (h.getContentType()) else null,
                proxy_url,
                @ptrCast(&Wrapper.resolve),
                s3_stream,
            );
            url = .{};
            url_proxy_buffer = "";
            return promise_value;
        }
        if (method == .POST) {
            method = .PUT;
        }

        var result = credentialsWithOptions.credentials.signRequest(.{
            .path = url.s3Path(),
            .method = method,
        }, false, null) catch |sign_err| {
            is_error = true;
            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, s3.getJSSignError(sign_err, globalThis));
        };
        defer result.deinit();
        if (proxy) |proxy_| {
            // proxy and url are in the same buffer lets replace it
            const old_buffer = url_proxy_buffer;
            defer allocator.free(old_buffer);
            var buffer = allocator.alloc(u8, result.url.len + proxy_.href.len) catch bun.outOfMemory();
            bun.copy(u8, buffer[0..result.url.len], result.url);
            bun.copy(u8, buffer[proxy_.href.len..], proxy_.href);
            url_proxy_buffer = buffer;

            url = ZigURL.parse(url_proxy_buffer[0..result.url.len]);
            proxy = ZigURL.parse(url_proxy_buffer[result.url.len..]);
        } else {
            // replace headers and url of the request
            allocator.free(url_proxy_buffer);
            url_proxy_buffer = result.url;
            url = ZigURL.parse(result.url);
            result.url = ""; // fetch now owns this
        }

        const content_type = if (headers) |h| (h.getContentType()) else null;
        var header_buffer: [10]picohttp.Header = undefined;

        if (range) |range_| {
            const _headers = result.mixWithHeader(&header_buffer, .{ .name = "range", .value = range_ });
            setHeaders(&headers, _headers, allocator);
        } else if (content_type) |ct| {
            if (ct.len > 0) {
                const _headers = result.mixWithHeader(&header_buffer, .{ .name = "Content-Type", .value = ct });
                setHeaders(&headers, _headers, allocator);
            } else {
                setHeaders(&headers, result.headers(), allocator);
            }
        } else {
            setHeaders(&headers, result.headers(), allocator);
        }
    }

    // Only create this after we have validated all the input.
    // or else we will leak it
    var promise = JSPromise.Strong.init(globalThis);

    const promise_val = promise.value();

    const initial_body_reference_count: if (Environment.isDebug) usize else u0 = brk: {
        if (Environment.isDebug) {
            if (body.store()) |store| {
                break :brk store.ref_count.load(.monotonic);
            }
        }

        break :brk 0;
    };

    _ = FetchTasklet.queue(
        allocator,
        globalThis,
        .{
            .method = method,
            .url = url,
            .headers = headers orelse Headers{
                .allocator = allocator,
            },
            .body = http_body,
            .disable_keepalive = disable_keepalive,
            .disable_timeout = disable_timeout,
            .disable_decompression = disable_decompression,
            .reject_unauthorized = reject_unauthorized,
            .redirect_type = redirect_type,
            .verbose = verbose,
            .proxy = proxy,
            .url_proxy_buffer = url_proxy_buffer,
            .signal = signal,
            .globalThis = globalThis,
            .ssl_config = ssl_config,
            .hostname = hostname,
            .memory_reporter = memory_reporter,
            .check_server_identity = if (check_server_identity.isEmptyOrUndefinedOrNull()) .empty else .create(check_server_identity, globalThis),
            .unix_socket_path = unix_socket_path,
        },
        // Pass the Strong value instead of creating a new one, or else we
        // will leak it
        // see https://github.com/oven-sh/bun/issues/2985
        promise,
    ) catch bun.outOfMemory();

    if (Environment.isDebug) {
        if (body.store()) |store| {
            if (store.ref_count.load(.monotonic) == initial_body_reference_count) {
                Output.panic("Expected body ref count to have incremented in FetchTasklet", .{});
            }
        }
    }

    // These are now owned by FetchTasklet.
    url = .{};
    headers = null;
    // Reference count for the blob is incremented above.
    if (body.store() != null) {
        body.detach();
    } else {
        // These are single-use, and have effectively been moved to the FetchTasklet.
        body = FetchTasklet.HTTPRequestBody.Empty;
    }
    proxy = null;
    url_proxy_buffer = "";
    signal = null;
    ssl_config = null;
    hostname = null;
    unix_socket_path = ZigString.Slice.empty;

    return promise_val;
}
fn setHeaders(headers: *?Headers, new_headers: []const picohttp.Header, allocator: std.mem.Allocator) void {
    var old = headers.*;
    headers.* = Headers.fromPicoHttpHeaders(new_headers, allocator) catch bun.outOfMemory();

    if (old) |*headers_| {
        headers_.deinit();
    }
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const DataURL = @import("../../resolver/data_url.zig").DataURL;
const string = bun.string;
const MutableString = bun.MutableString;
const ZigString = JSC.ZigString;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSPromise = JSC.JSPromise;
const ZigURL = @import("../../url.zig").URL;
const Output = bun.Output;
const http = bun.http;
const VirtualMachine = JSC.VirtualMachine;
const FetchRedirect = http.FetchRedirect;
const Blob = JSC.WebCore.Blob;
const Response = JSC.WebCore.Response;
const Request = JSC.WebCore.Request;
const Headers = bun.http.Headers;
const Method = @import("../../http/method.zig").Method;
const Body = JSC.WebCore.Body;
const Async = bun.Async;
const SSLConfig = @import("../api/server.zig").ServerConfig.SSLConfig;
const Mutex = bun.Mutex;
const BoringSSL = bun.BoringSSL.c;
const X509 = @import("../api/bun/x509.zig");
const FetchHeaders = bun.webcore.FetchHeaders;
const Environment = bun.Environment;
const PosixToWinNormalizer = bun.path.PosixToWinNormalizer;
const AnyBlob = JSC.WebCore.Blob.Any;
const s3 = bun.S3;
const picohttp = bun.picohttp;
