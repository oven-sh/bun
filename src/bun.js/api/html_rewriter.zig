const SelectorMap = std.ArrayListUnmanaged(*LOLHTML.HTMLSelector);
pub const LOLHTMLContext = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    selectors: SelectorMap = .{},
    element_handlers: std.ArrayListUnmanaged(*ElementHandler) = .{},
    document_handlers: std.ArrayListUnmanaged(*DocumentHandler) = .{},

    fn deinit(this: *LOLHTMLContext) void {
        for (this.selectors.items) |selector| {
            selector.deinit();
        }
        this.selectors.deinit(bun.default_allocator);
        this.selectors = .{};

        for (this.element_handlers.items) |handler| {
            handler.deinit();
        }
        this.element_handlers.deinit(bun.default_allocator);
        this.element_handlers = .{};

        for (this.document_handlers.items) |handler| {
            handler.deinit();
        }
        this.document_handlers.deinit(bun.default_allocator);
        this.document_handlers = .{};

        bun.destroy(this);
    }
};
pub const HTMLRewriter = struct {
    builder: *LOLHTML.HTMLRewriter.Builder,
    context: *LOLHTMLContext,

    pub const js = jsc.Codegen.JSHTMLRewriter;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn constructor(_: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*HTMLRewriter {
        const rewriter = bun.handleOom(bun.default_allocator.create(HTMLRewriter));
        rewriter.* = HTMLRewriter{
            .builder = LOLHTML.HTMLRewriter.Builder.init(),
            .context = bun.new(LOLHTMLContext, .{
                .ref_count = .init(),
            }),
        };
        bun.analytics.Features.html_rewriter += 1;
        return rewriter;
    }

    pub fn on_(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        selector_name: ZigString,
        callFrame: *jsc.CallFrame,
        listener: JSValue,
    ) bun.JSError!JSValue {
        const selector_slice = bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{f}", .{selector_name}));
        defer bun.default_allocator.free(selector_slice);

        var selector = LOLHTML.HTMLSelector.parse(selector_slice) catch
            return global.throwValue(createLOLHTMLError(global));
        errdefer selector.deinit();

        const handler_ = try ElementHandler.init(global, listener);
        const handler = bun.handleOom(bun.default_allocator.create(ElementHandler));
        handler.* = handler_;
        errdefer {
            handler.deinit();
            bun.default_allocator.destroy(handler);
        }

        this.builder.addElementContentHandlers(
            selector,

            ElementHandler,
            ElementHandler.onElement,
            if (handler.onElementCallback != null)
                handler
            else
                null,

            ElementHandler,
            ElementHandler.onComment,
            if (handler.onCommentCallback != null)
                handler
            else
                null,

            ElementHandler,
            ElementHandler.onText,
            if (handler.onTextCallback != null)
                handler
            else
                null,
        ) catch {
            return global.throwValue(createLOLHTMLError(global));
        };

        bun.handleOom(this.context.selectors.append(bun.default_allocator, selector));
        bun.handleOom(this.context.element_handlers.append(bun.default_allocator, handler));
        return callFrame.this();
    }

    pub fn onDocument_(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        listener: JSValue,
        callFrame: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        const handler_ = try DocumentHandler.init(global, listener);

        const handler = bun.handleOom(bun.default_allocator.create(DocumentHandler));
        handler.* = handler_;
        errdefer {
            handler.deinit();
            bun.default_allocator.destroy(handler);
        }

        // If this fails, subsequent calls to write or end should throw
        this.builder.addDocumentContentHandlers(
            DocumentHandler,
            DocumentHandler.onDocType,
            if (handler.onDocTypeCallback != null)
                handler
            else
                null,

            DocumentHandler,
            DocumentHandler.onComment,
            if (handler.onCommentCallback != null)
                handler
            else
                null,

            DocumentHandler,
            DocumentHandler.onText,
            if (handler.onTextCallback != null)
                handler
            else
                null,

            DocumentHandler,
            DocumentHandler.onEnd,
            if (handler.onEndCallback != null)
                handler
            else
                null,
        );

        bun.handleOom(this.context.document_handlers.append(bun.default_allocator, handler));
        return callFrame.this();
    }

    pub fn finalize(this: *HTMLRewriter) void {
        this.finalizeWithoutDestroy();
        bun.default_allocator.destroy(this);
    }

    pub fn finalizeWithoutDestroy(this: *HTMLRewriter) void {
        this.context.deref();
        this.builder.deinit();
    }

    pub fn beginTransform(this: *HTMLRewriter, global: *JSGlobalObject, response: *Response) bun.JSError!JSValue {
        const new_context = this.context;
        new_context.ref();
        return BufferOutputSink.init(new_context, global, response, this.builder);
    }

    pub fn transform_(this: *HTMLRewriter, global: *JSGlobalObject, response_value: jsc.JSValue) bun.JSError!JSValue {
        if (response_value.as(Response)) |response| {
            const body_value = response.getBodyValue();
            if (body_value.* == .Used) {
                return global.throwInvalidArguments("Response body already used", .{});
            }
            const out = try this.beginTransform(global, response);
            // Check if the returned value is an error and throw it properly
            if (out.toError()) |err| {
                return global.throwValue(err);
            }
            return out;
        }

        const ResponseKind = enum { string, array_buffer, other };
        const kind: ResponseKind = brk: {
            if (response_value.isString())
                break :brk .string
            else if (response_value.jsType().isTypedArrayOrArrayBuffer())
                break :brk .array_buffer
            else
                break :brk .other;
        };

        if (kind != .other) {
            {
                const body_value = try jsc.WebCore.Body.extract(global, response_value);
                const resp = bun.new(Response, Response.init(
                    .{
                        .status_code = 200,
                    },
                    body_value,
                    bun.String.empty,
                    false,
                ));
                defer resp.finalize();
                const out_response_value = try this.beginTransform(global, resp);
                // Check if the returned value is an error and throw it properly
                if (out_response_value.toError()) |err| {
                    return global.throwValue(err);
                }
                out_response_value.ensureStillAlive();
                var out_response = out_response_value.as(Response) orelse return out_response_value;
                var blob = out_response.getBodyValue().useAsAnyBlobAllowNonUTF8String();

                defer {
                    _ = Response.js.dangerouslySetPtr(out_response_value, null);
                    // Manually invoke the finalizer to ensure it does what we want
                    out_response.finalize();
                }

                return switch (kind) {
                    .string => brk: {
                        break :brk blob.toString(global, .transfer);
                    },
                    .array_buffer => brk: {
                        break :brk blob.toArrayBuffer(global, .transfer);
                    },
                    .other => unreachable,
                };
            }
        }

        return global.throwInvalidArguments("Expected Response or Body", .{});
    }

    pub const on = host_fn.wrapInstanceMethod(HTMLRewriter, "on_", false);
    pub const onDocument = host_fn.wrapInstanceMethod(HTMLRewriter, "onDocument_", false);
    pub const transform = host_fn.wrapInstanceMethod(HTMLRewriter, "transform_", false);

    pub const HTMLRewriterLoader = struct {
        rewriter: *LOLHTML.HTMLRewriter,
        finalized: bool = false,
        context: LOLHTMLContext,
        chunk_size: usize = 0,
        failed: bool = false,
        output: jsc.WebCore.Sink,
        signal: jsc.WebCore.Signal = .{},
        backpressure: bun.LinearFifo(u8, .Dynamic) = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator),

        pub fn finalize(this: *HTMLRewriterLoader) void {
            if (this.finalized) return;
            this.rewriter.deinit();
            this.backpressure.deinit();
            this.backpressure = bun.LinearFifo(u8, .Dynamic).init(bun.default_allocator);
            this.finalized = true;
        }

        pub fn fail(this: *HTMLRewriterLoader, err: bun.sys.Error) void {
            this.signal.close(err);
            this.output.end(err);
            this.failed = true;
            this.finalize();
        }

        pub fn connect(this: *HTMLRewriterLoader, signal: jsc.WebCore.Signal) void {
            this.signal = signal;
        }

        pub fn writeToDestination(this: *HTMLRewriterLoader, bytes: []const u8) void {
            if (this.backpressure.count > 0) {
                this.backpressure.write(bytes) catch {
                    this.fail(bun.sys.Error.oom);
                    this.finalize();
                };
                return;
            }

            const write_result = this.output.write(.{ .temporary = bun.ByteList.fromBorrowedSliceDangerous(bytes) });

            switch (write_result) {
                .err => |err| {
                    this.fail(err);
                },
                .owned_and_done, .temporary_and_done, .into_array_and_done => {
                    this.done();
                },
                .pending => |pending| {
                    pending.applyBackpressure(bun.default_allocator, &this.output, pending, bytes);
                },
                .into_array, .owned, .temporary => {
                    this.signal.ready(if (this.chunk_size > 0) this.chunk_size else null, null);
                },
            }
        }

        pub fn done(
            this: *HTMLRewriterLoader,
        ) void {
            this.output.end(null);
            this.signal.close(null);
            this.finalize();
        }

        pub fn setup(
            this: *HTMLRewriterLoader,
            builder: *LOLHTML.HTMLRewriter.Builder,
            context: *LOLHTMLContext,
            size_hint: ?usize,
            output: jsc.WebCore.Sink,
        ) ?[]const u8 {
            const chunk_size = @max(size_hint orelse 16384, 1024);
            this.rewriter = builder.build(
                .UTF8,
                .{
                    .preallocated_parsing_buffer_size = chunk_size,
                    .max_allowed_memory_usage = std.math.maxInt(u32),
                },
                false,
                HTMLRewriterLoader,
                this,
                HTMLRewriterLoader.writeToDestination,
                HTMLRewriterLoader.done,
            ) catch {
                output.end();
                return LOLHTML.HTMLString.lastError().slice();
            };

            this.chunk_size = chunk_size;
            this.context = context;
            this.output = output;

            return null;
        }

        pub fn sink(this: *HTMLRewriterLoader) jsc.WebCore.Sink {
            return jsc.WebCore.Sink.init(this);
        }

        fn writeBytes(this: *HTMLRewriterLoader, bytes: bun.ByteList, comptime deinit_: bool) ?bun.sys.Error {
            this.rewriter.write(bytes.slice()) catch {
                return bun.sys.Error{
                    .errno = 1,
                    // TODO: make this a union
                    .path = bun.handleOom(bun.default_allocator.dupe(u8, LOLHTML.HTMLString.lastError().slice())),
                };
            };
            if (comptime deinit_) bytes.deinit(bun.default_allocator);
            return null;
        }

        pub fn write(this: *HTMLRewriterLoader, data: jsc.WebCore.StreamResult) jsc.WebCore.StreamResult.Writable {
            switch (data) {
                .owned => |bytes| {
                    if (this.writeBytes(bytes, true)) |err| {
                        return .{ .err = err };
                    }
                    return .{ .owned = bytes.len };
                },
                .owned_and_done => |bytes| {
                    if (this.writeBytes(bytes, true)) |err| {
                        return .{ .err = err };
                    }
                    return .{ .owned_and_done = bytes.len };
                },
                .temporary_and_done => |bytes| {
                    if (this.writeBytes(bytes, false)) |err| {
                        return .{ .err = err };
                    }
                    return .{ .temporary_and_done = bytes.len };
                },
                .temporary => |bytes| {
                    if (this.writeBytes(bytes, false)) |err| {
                        return .{ .err = err };
                    }
                    return .{ .temporary = bytes.len };
                },
                else => unreachable,
            }
        }

        pub fn writeUTF16(this: *HTMLRewriterLoader, data: jsc.WebCore.StreamResult) jsc.WebCore.StreamResult.Writable {
            return jsc.WebCore.Sink.UTF8Fallback.writeUTF16(HTMLRewriterLoader, this, data, write);
        }

        pub fn writeLatin1(this: *HTMLRewriterLoader, data: jsc.WebCore.StreamResult) jsc.WebCore.StreamResult.Writable {
            return jsc.WebCore.Sink.UTF8Fallback.writeLatin1(HTMLRewriterLoader, this, data, write);
        }
    };

    pub const BufferOutputSink = struct {
        const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
        pub const ref = RefCount.ref;
        pub const deref = RefCount.deref;

        ref_count: RefCount,
        global: *JSGlobalObject,
        bytes: bun.MutableString,
        rewriter: ?*LOLHTML.HTMLRewriter = null,
        context: *LOLHTMLContext,
        response: *Response,
        response_value: jsc.Strong.Optional = .empty,
        bodyValueBufferer: ?jsc.WebCore.Body.ValueBufferer = null,
        tmp_sync_error: ?*jsc.JSValue = null,

        // const log = bun.Output.scoped(.BufferOutputSink, .visible);
        pub fn init(context: *LOLHTMLContext, global: *JSGlobalObject, original: *Response, builder: *LOLHTML.HTMLRewriter.Builder) bun.JSError!jsc.JSValue {
            var sink = bun.new(BufferOutputSink, .{
                .ref_count = .init(),
                .global = global,
                .bytes = bun.MutableString.initEmpty(bun.default_allocator),
                .rewriter = null,
                .context = context,
                .response = undefined,
            });
            defer sink.deref();
            var result = bun.new(Response, Response.init(
                .{
                    .status_code = 200,
                },
                .{
                    .value = .{
                        .Locked = .{
                            .global = global,
                            .task = sink,
                        },
                    },
                },
                bun.String.empty,
                false,
            ));

            sink.response = result;
            var sink_error: jsc.JSValue = .zero;
            const input_size = original.getBodyLen();
            var vm = global.bunVM();

            // Since we're still using vm.waitForPromise, we have to also
            // override the error rejection handler. That way, we can propagate
            // errors to the caller.
            var scope = vm.unhandledRejectionScope();
            const prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
            vm.unhandled_pending_rejection_to_capture = &sink_error;
            sink.tmp_sync_error = &sink_error;
            vm.onUnhandledRejection = &jsc.VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;
            defer {
                sink_error.ensureStillAlive();
                vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;
                scope.apply(vm);
            }

            sink.rewriter = builder.build(
                .UTF8,
                .{
                    .preallocated_parsing_buffer_size = if (input_size == jsc.WebCore.Blob.max_size)
                        1024
                    else
                        @max(input_size, 1024),
                    .max_allowed_memory_usage = std.math.maxInt(u32),
                },
                false,
                BufferOutputSink,
                sink,
                BufferOutputSink.write,
                BufferOutputSink.done,
            ) catch {
                result.finalize();
                return createLOLHTMLError(global);
            };

            result.setInit(
                original.getMethod(),
                original.getInitStatusCode(),
                original.getInitStatusText().clone(),
            );

            // https://github.com/oven-sh/bun/issues/3334
            if (original.getInitHeaders()) |_headers| {
                result.setInitHeaders(try _headers.cloneThis(global));
            }

            // Hold off on cloning until we're actually done.
            const response_js_value = sink.response.toJS(sink.global);
            sink.response_value.set(global, response_js_value);

            result.setUrl(original.getUrl().clone());

            const value = original.getBodyValue();
            const owned_readable_stream = original.getBodyReadableStream(sink.global);
            sink.ref();
            sink.bodyValueBufferer = jsc.WebCore.Body.ValueBufferer.init(sink, @ptrCast(&onFinishedBuffering), sink.global, bun.default_allocator);
            response_js_value.ensureStillAlive();

            sink.bodyValueBufferer.?.run(value, owned_readable_stream) catch |buffering_error| {
                defer sink.deref();
                return switch (buffering_error) {
                    error.StreamAlreadyUsed => {
                        var err = jsc.SystemError{
                            .code = bun.String.static("ERR_STREAM_ALREADY_FINISHED"),
                            .message = bun.String.static("Stream already used, please create a new one"),
                        };
                        return err.toErrorInstance(sink.global);
                    },
                    else => {
                        var err = jsc.SystemError{
                            .code = bun.String.static("ERR_STREAM_CANNOT_PIPE"),
                            .message = bun.String.static("Failed to pipe stream"),
                        };
                        return err.toErrorInstance(sink.global);
                    },
                };
            };

            // sync error occurs
            if (sink_error != .zero) {
                sink_error.ensureStillAlive();
                sink_error.unprotect();

                return sink_error;
            }

            response_js_value.ensureStillAlive();
            return response_js_value;
        }

        pub fn onFinishedBuffering(sink: *BufferOutputSink, bytes: []const u8, js_err: ?jsc.WebCore.Body.Value.ValueError, is_async: bool) void {
            defer sink.deref();
            if (js_err) |err| {
                const sinkBodyValue = sink.response.getBodyValue();
                if (sinkBodyValue.* == .Locked and @intFromPtr(sinkBodyValue.Locked.task) == @intFromPtr(sink) and
                    sinkBodyValue.Locked.promise == null)
                {
                    sinkBodyValue.Locked.readable.deinit();
                    sinkBodyValue.* = .{ .Empty = {} };
                    // is there a pending promise?
                    // we will need to reject it
                } else if (sinkBodyValue.* == .Locked and @intFromPtr(sinkBodyValue.Locked.task) == @intFromPtr(sink) and
                    sinkBodyValue.Locked.promise != null)
                {
                    sinkBodyValue.Locked.onReceiveValue = null;
                    sinkBodyValue.Locked.task = null;
                }
                if (is_async) {
                    sinkBodyValue.toErrorInstance(err.dupe(sink.global), sink.global) catch {}; // TODO: properly propagate exception upwards
                } else {
                    var ret_err = createLOLHTMLError(sink.global);
                    ret_err.ensureStillAlive();
                    ret_err.protect();
                    sink.tmp_sync_error.?.* = ret_err;
                }
                sink.rewriter.?.end() catch {};

                return;
            }

            if (sink.runOutputSink(bytes, is_async)) |ret_err| {
                ret_err.ensureStillAlive();
                ret_err.protect();
                sink.tmp_sync_error.?.* = ret_err;
            } else {}
        }

        pub fn runOutputSink(
            sink: *BufferOutputSink,
            bytes: []const u8,
            is_async: bool,
        ) ?JSValue {
            bun.handleOom(sink.bytes.growBy(bytes.len));
            const global = sink.global;
            var response = sink.response;

            sink.rewriter.?.write(bytes) catch {
                if (is_async) {
                    response.getBodyValue().toErrorInstance(.{ .Message = createLOLHTMLStringError() }, global) catch {}; // TODO: properly propagate exception upwards
                    return null;
                } else {
                    return createLOLHTMLError(global);
                }
            };

            sink.rewriter.?.end() catch {
                if (!is_async) response.finalize();
                sink.response = undefined;
                if (is_async) {
                    response.getBodyValue().toErrorInstance(.{ .Message = createLOLHTMLStringError() }, global) catch {}; // TODO: properly propagate exception upwards
                    return null;
                } else {
                    return createLOLHTMLError(global);
                }
            };

            return null;
        }

        pub const Sync = enum { suspended, pending, done };

        pub fn done(this: *BufferOutputSink) void {
            const bodyValue = this.response.getBodyValue();
            var prev_value = bodyValue.*;
            bodyValue.* = jsc.WebCore.Body.Value{
                .InternalBlob = .{
                    .bytes = this.bytes.list.toManaged(bun.default_allocator),
                },
            };

            this.bytes = .{
                .allocator = bun.default_allocator,
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            };

            prev_value.resolve(
                bodyValue,
                this.global,
                null,
            ) catch {}; // TODO: properly propagate exception upwards
        }

        pub fn write(this: *BufferOutputSink, bytes: []const u8) void {
            bun.handleOom(this.bytes.append(bytes));
        }

        fn deinit(this: *BufferOutputSink) void {
            this.bytes.deinit();
            if (this.bodyValueBufferer) |*bufferer| {
                bufferer.deinit();
            }

            this.context.deref();
            this.response_value.deinit();
            if (this.rewriter) |rewriter| {
                rewriter.deinit();
            }

            bun.destroy(this);
        }
    };

    // pub const StreamOutputSink = struct {
    //     global: *JSGlobalObject,
    //     rewriter: *LOLHTML.HTMLRewriter,
    //     context: LOLHTMLContext,
    //     response: *Response,
    //     input: jsc.WebCore.Blob = undefined,
    //     pub fn init(context: LOLHTMLContext, global: *JSGlobalObject, original: *Response, builder: *LOLHTML.HTMLRewriter.Builder) JSValue {
    //         var result = bun.default_allocator.create(Response) catch unreachable;
    //         var sink = bun.default_allocator.create(StreamOutputSink) catch unreachable;
    //         sink.* = StreamOutputSink{
    //             .global = global,
    //             .rewriter = undefined,
    //             .context = context,
    //             .response = result,
    //         };

    //         for (sink.context.document_handlers.items) |doc| {
    //             doc.ctx = sink;
    //         }
    //         for (sink.context.element_handlers.items) |doc| {
    //             doc.ctx = sink;
    //         }

    //         sink.rewriter = builder.build(
    //             .UTF8,
    //             .{
    //                 .preallocated_parsing_buffer_size = @max(original.body.len(), 1024),
    //                 .max_allowed_memory_usage = std.math.maxInt(u32),
    //             },
    //             false,
    //             StreamOutputSink,
    //             sink,
    //             StreamOutputSink.write,
    //             StreamOutputSink.done,
    //         ) catch {
    //             sink.deinit();
    //             bun.default_allocator.destroy(result);

    //             return createLOLHTMLError(global);
    //         };

    //         result.* = Response{
    //             .allocator = bun.default_allocator,
    //             .init = .{
    //                 .status_code = 200,
    //             },
    //             .body = .{
    //                 .value = .{
    //                     .Locked = .{
    //                         .global = global,
    //                         .task = sink,
    //                     },
    //                 },
    //             },
    //         };

    //         result.init.headers = original.init.headers;
    //         result.init.method = original.init.method;
    //         result.init.status_code = original.init.status_code;

    //         result.url = bun.default_allocator.dupe(u8, original.url) catch unreachable;
    //         result.status_text = bun.default_allocator.dupe(u8, original.status_text) catch unreachable;

    //         var input: jsc.WebCore.Blob = original.body.value.use();

    //         const is_pending = input.needsToReadFile();
    //         defer if (!is_pending) input.detach();

    //         if (is_pending) {
    //             input.doReadFileInternal(*StreamOutputSink, sink, onFinishedLoading, global);
    //         } else if (sink.runOutputSink(input.sharedView(), false, false)) |error_value| {
    //             return error_value;
    //         }

    //         // Hold off on cloning until we're actually done.

    //         return jsc.JSValue.fromRef(
    //             Response.makeMaybePooled(sink.global, sink.response),
    //         );
    //     }

    //     pub fn runOutputSink(
    //         sink: *StreamOutputSink,
    //         bytes: []const u8,
    //         is_async: bool,
    //         free_bytes_on_end: bool,
    //     ) ?JSValue {
    //         defer if (free_bytes_on_end)
    //             bun.default_allocator.free(bytes);

    //         return null;
    //     }

    //     pub const Sync = enum { suspended, pending, done };

    //     pub fn done(this: *StreamOutputSink) void {
    //         var prev_value = this.response.body.value;
    //         var bytes = this.bytes.slice();
    //         this.response.body.value = .{
    //             .Blob = jsc.WebCore.Blob.init(bytes, this.bytes.allocator, this.global),
    //         };
    //         prev_value.resolve(
    //             &this.response.body.value,
    //             this.global,
    //         );
    //     }

    //     pub fn write(this: *StreamOutputSink, bytes: []const u8) void {
    //         this.bytes.append(bytes) catch unreachable;
    //     }

    //     pub fn deinit(this: *StreamOutputSink) void {
    //         this.bytes.deinit();

    //         this.context.deinit(bun.default_allocator);
    //     }
    // };
};

const DocumentHandler = struct {
    onDocTypeCallback: ?JSValue = null,
    onCommentCallback: ?JSValue = null,
    onTextCallback: ?JSValue = null,
    onEndCallback: ?JSValue = null,
    thisObject: JSValue,
    global: *JSGlobalObject,

    pub const onDocType = HandlerCallback(
        DocumentHandler,
        DocType,
        LOLHTML.DocType,
        "doctype",
        "onDocTypeCallback",
    );
    pub const onComment = HandlerCallback(
        DocumentHandler,
        Comment,
        LOLHTML.Comment,
        "comment",
        "onCommentCallback",
    );
    pub const onText = HandlerCallback(
        DocumentHandler,
        TextChunk,
        LOLHTML.TextChunk,
        "text_chunk",
        "onTextCallback",
    );
    pub const onEnd = HandlerCallback(
        DocumentHandler,
        DocEnd,
        LOLHTML.DocEnd,
        "doc_end",
        "onEndCallback",
    );

    pub fn init(global: *JSGlobalObject, thisObject: JSValue) !DocumentHandler {
        var handler = DocumentHandler{
            .thisObject = thisObject,
            .global = global,
        };

        if (!thisObject.isObject()) {
            return global.throwInvalidArguments("Expected object", .{});
        }

        errdefer {
            if (handler.onDocTypeCallback) |cb| {
                cb.unprotect();
            }

            if (handler.onCommentCallback) |cb| {
                cb.unprotect();
            }

            if (handler.onTextCallback) |cb| {
                cb.unprotect();
            }

            if (handler.onEndCallback) |cb| {
                cb.unprotect();
            }
        }

        if (try thisObject.get(global, "doctype")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable()) {
                return global.throwInvalidArguments("doctype must be a function", .{});
            }
            val.protect();
            handler.onDocTypeCallback = val;
        }

        if (try thisObject.get(global, "comments")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable()) {
                return global.throwInvalidArguments("comments must be a function", .{});
            }
            val.protect();
            handler.onCommentCallback = val;
        }

        if (try thisObject.get(global, "text")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable()) {
                return global.throwInvalidArguments("text must be a function", .{});
            }
            val.protect();
            handler.onTextCallback = val;
        }

        if (try thisObject.get(global, "end")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable()) {
                return global.throwInvalidArguments("end must be a function", .{});
            }
            val.protect();
            handler.onEndCallback = val;
        }

        thisObject.protect();
        return handler;
    }

    pub fn deinit(this: *DocumentHandler) void {
        if (this.onDocTypeCallback) |cb| {
            cb.unprotect();
            this.onDocTypeCallback = null;
        }

        if (this.onCommentCallback) |cb| {
            cb.unprotect();
            this.onCommentCallback = null;
        }

        if (this.onTextCallback) |cb| {
            cb.unprotect();
            this.onTextCallback = null;
        }

        if (this.onEndCallback) |cb| {
            cb.unprotect();
            this.onEndCallback = null;
        }

        this.thisObject.unprotect();
    }
};

fn HandlerCallback(
    comptime HandlerType: type,
    comptime ZigType: type,
    comptime LOLHTMLType: type,
    comptime field_name: string,
    comptime callback_name: string,
) (fn (*HandlerType, *LOLHTMLType) bool) {
    return struct {
        pub fn callback(this: *HandlerType, value: *LOLHTMLType) bool {
            jsc.markBinding(@src());

            var wrapper = ZigType.init(value);
            wrapper.ref();

            // When using RefCount, we don't check the count value directly
            // as it's an opaque type now
            // The init values are handled by bun.new with .init()

            defer {
                @field(wrapper, field_name) = null;
                wrapper.deref();
            }

            // Use a TopExceptionScope to properly handle exceptions from the JavaScript callback
            var scope: bun.jsc.TopExceptionScope = undefined;
            scope.init(this.global, @src());
            defer scope.deinit();

            const result = @field(this, callback_name).?.call(
                this.global,
                if (comptime @hasField(HandlerType, "thisObject"))
                    @field(this, "thisObject")
                else
                    JSValue.zero,
                &.{wrapper.toJS(this.global)},
            ) catch {
                // If there's an exception in the scope, capture it for later retrieval
                if (scope.exception()) |exc| {
                    const exc_value = JSValue.fromCell(exc);
                    // Store the exception in the VM's unhandled rejection capture mechanism
                    // if it's available (this is the same mechanism used by BufferOutputSink)
                    if (this.global.bunVM().unhandled_pending_rejection_to_capture) |err_ptr| {
                        err_ptr.* = exc_value;
                        exc_value.protect();
                    }
                }
                // Clear the exception from the scope to prevent assertion failures
                scope.clearException();
                // Return true to indicate failure to LOLHTML, which will cause the write
                // operation to fail and the error handling logic to take over.
                return true;
            };

            // Check if there's an exception that was thrown but not caught by the error union
            if (scope.exception()) |exc| {
                const exc_value = JSValue.fromCell(exc);
                // Store the exception in the VM's unhandled rejection capture mechanism
                if (this.global.bunVM().unhandled_pending_rejection_to_capture) |err_ptr| {
                    err_ptr.* = exc_value;
                    exc_value.protect();
                }
                // Clear the exception to prevent assertion failures
                scope.clearException();
                return true;
            }

            if (!result.isUndefinedOrNull()) {
                if (result.isError() or result.isAggregateError(this.global)) {
                    return true;
                }

                if (result.asAnyPromise()) |promise| {
                    this.global.bunVM().waitForPromise(promise);
                    const fail = promise.status() == .rejected;
                    if (fail) {
                        this.global.bunVM().unhandledRejection(this.global, promise.result(this.global.vm()), promise.asValue());
                    }
                    return fail;
                }
            }
            return false;
        }
    }.callback;
}

const ElementHandler = struct {
    onElementCallback: ?JSValue = null,
    onCommentCallback: ?JSValue = null,
    onTextCallback: ?JSValue = null,
    thisObject: JSValue,
    global: *JSGlobalObject,

    pub fn init(global: *JSGlobalObject, thisObject: JSValue) !ElementHandler {
        var handler = ElementHandler{
            .thisObject = thisObject,
            .global = global,
        };
        errdefer {
            if (handler.onCommentCallback) |cb| {
                cb.unprotect();
            }

            if (handler.onElementCallback) |cb| {
                cb.unprotect();
            }

            if (handler.onTextCallback) |cb| {
                cb.unprotect();
            }
        }

        if (!thisObject.isObject()) {
            return global.throwInvalidArguments("Expected object", .{});
        }

        if (try thisObject.get(global, "element")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable()) {
                return global.throwInvalidArguments("element must be a function", .{});
            }
            val.protect();
            handler.onElementCallback = val;
        }

        if (try thisObject.get(global, "comments")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable()) {
                return global.throwInvalidArguments("comments must be a function", .{});
            }
            val.protect();
            handler.onCommentCallback = val;
        }

        if (try thisObject.get(global, "text")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable()) {
                return global.throwInvalidArguments("text must be a function", .{});
            }
            val.protect();
            handler.onTextCallback = val;
        }

        thisObject.protect();
        return handler;
    }

    pub fn deinit(this: *ElementHandler) void {
        if (this.onElementCallback) |cb| {
            cb.unprotect();
            this.onElementCallback = null;
        }

        if (this.onCommentCallback) |cb| {
            cb.unprotect();
            this.onCommentCallback = null;
        }

        if (this.onTextCallback) |cb| {
            cb.unprotect();
            this.onTextCallback = null;
        }

        this.thisObject.unprotect();
    }

    pub fn onElement(this: *ElementHandler, value: *LOLHTML.Element) bool {
        return HandlerCallback(
            ElementHandler,
            Element,
            LOLHTML.Element,
            "element",
            "onElementCallback",
        )(this, value);
    }

    pub const onComment = HandlerCallback(
        ElementHandler,
        Comment,
        LOLHTML.Comment,
        "comment",
        "onCommentCallback",
    );

    pub const onText = HandlerCallback(
        ElementHandler,
        TextChunk,
        LOLHTML.TextChunk,
        "text_chunk",
        "onTextCallback",
    );
};

pub const ContentOptions = struct {
    html: bool = false,
};

fn createLOLHTMLError(global: *JSGlobalObject) JSValue {
    // If there was already a pending exception, we want to use that instead.
    if (global.tryTakeException()) |err| {
        // it's a synchronous error
        return err;
    } else if (global.bunVM().unhandled_pending_rejection_to_capture) |err_ptr| {
        if (err_ptr.* != .zero) {
            // it's a promise rejection
            const result = err_ptr.*;
            err_ptr.* = .zero;
            return result;
        }
    }

    var err = createLOLHTMLStringError();
    const value = err.toErrorInstance(global);
    value.put(global, "name", ZigString.init("HTMLRewriterError").toJS(global));
    return value;
}
fn createLOLHTMLStringError() bun.String {
    // We must clone this string.
    const err = LOLHTML.HTMLString.lastError();
    defer err.deinit();
    return bun.String.cloneUTF8(err.slice());
}

fn htmlStringValue(input: LOLHTML.HTMLString, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return try input.toJS(globalObject);
}

pub const TextChunk = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    text_chunk: ?*LOLHTML.TextChunk = null,

    pub const js = jsc.Codegen.JSTextChunk;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn init(text_chunk: *LOLHTML.TextChunk) *TextChunk {
        return bun.new(TextChunk, .{
            .ref_count = .init(),
            .text_chunk = text_chunk,
        });
    }

    fn contentHandler(this: *TextChunk, comptime Callback: (fn (*LOLHTML.TextChunk, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        const text_chunk = this.text_chunk orelse return .js_undefined;
        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            text_chunk,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return createLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn before_(
        this: *TextChunk,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.before, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn after_(
        this: *TextChunk,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.after, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn replace_(
        this: *TextChunk,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.replace, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const before = host_fn.wrapInstanceMethod(TextChunk, "before_", false);
    pub const after = host_fn.wrapInstanceMethod(TextChunk, "after_", false);
    pub const replace = host_fn.wrapInstanceMethod(TextChunk, "replace_", false);

    pub fn remove(
        this: *TextChunk,
        _: *JSGlobalObject,
        callFrame: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        const text_chunk = this.text_chunk orelse return .js_undefined;
        text_chunk.remove();
        return callFrame.this();
    }

    pub fn getText(
        this: *TextChunk,
        global: *JSGlobalObject,
    ) bun.JSError!JSValue {
        const text_chunk = this.text_chunk orelse return .js_undefined;
        return bun.String.createUTF8ForJS(global, text_chunk.getContent().slice());
    }

    pub fn removed(this: *TextChunk, _: *JSGlobalObject) JSValue {
        const text_chunk = this.text_chunk orelse return .js_undefined;
        return JSValue.jsBoolean(text_chunk.isRemoved());
    }

    pub fn lastInTextNode(this: *TextChunk, _: *JSGlobalObject) JSValue {
        const text_chunk = this.text_chunk orelse return .js_undefined;
        return JSValue.jsBoolean(text_chunk.isLastInTextNode());
    }

    pub fn finalize(this: *TextChunk) void {
        this.deref();
    }

    fn deinit(this: *TextChunk) void {
        this.text_chunk = null;
        bun.destroy(this);
    }
};

pub const DocType = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    doctype: ?*LOLHTML.DocType = null,

    fn deinit(this: *DocType) void {
        this.doctype = null;
        bun.destroy(this);
    }

    pub fn finalize(this: *DocType) void {
        this.deref();
    }

    pub fn init(doctype: *LOLHTML.DocType) *DocType {
        return bun.new(DocType, .{
            .ref_count = .init(),
            .doctype = doctype,
        });
    }

    pub const js = jsc.Codegen.JSDocType;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    /// The doctype name.
    pub fn name(
        this: *DocType,
        globalObject: *JSGlobalObject,
    ) JSValue {
        if (this.doctype == null)
            return .js_undefined;
        const str = this.doctype.?.getName().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toJS(globalObject);
    }

    pub fn systemId(
        this: *DocType,
        globalObject: *JSGlobalObject,
    ) JSValue {
        if (this.doctype == null)
            return .js_undefined;

        const str = this.doctype.?.getSystemId().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toJS(globalObject);
    }

    pub fn publicId(
        this: *DocType,
        globalObject: *JSGlobalObject,
    ) JSValue {
        if (this.doctype == null)
            return .js_undefined;

        const str = this.doctype.?.getPublicId().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toJS(globalObject);
    }

    pub fn remove(
        this: *DocType,
        _: *JSGlobalObject,
        callFrame: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        if (this.doctype == null)
            return .js_undefined;
        this.doctype.?.remove();
        return callFrame.this();
    }

    pub fn removed(
        this: *DocType,
        _: *JSGlobalObject,
    ) JSValue {
        if (this.doctype == null)
            return .js_undefined;
        return JSValue.jsBoolean(this.doctype.?.isRemoved());
    }
};

pub const DocEnd = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    doc_end: ?*LOLHTML.DocEnd,

    pub const js = jsc.Codegen.JSDocEnd;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn init(doc_end: *LOLHTML.DocEnd) *DocEnd {
        return bun.new(DocEnd, .{
            .ref_count = .init(),
            .doc_end = doc_end,
        });
    }

    fn contentHandler(this: *DocEnd, comptime Callback: (fn (*LOLHTML.DocEnd, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.doc_end == null)
            return JSValue.jsNull();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.doc_end.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return createLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn append_(
        this: *DocEnd,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.DocEnd.append, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const append = host_fn.wrapInstanceMethod(DocEnd, "append_", false);

    pub fn finalize(this: *DocEnd) void {
        this.deref();
    }

    fn deinit(this: *DocEnd) void {
        this.doc_end = null;
        bun.destroy(this);
    }
};

pub const Comment = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    comment: ?*LOLHTML.Comment = null,

    pub const js = jsc.Codegen.JSComment;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn init(comment: *LOLHTML.Comment) *Comment {
        return bun.new(Comment, .{
            .ref_count = .init(),
            .comment = comment,
        });
    }

    fn contentHandler(this: *Comment, comptime Callback: (fn (*LOLHTML.Comment, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.comment.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return createLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn before_(
        this: *Comment,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.before, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn after_(
        this: *Comment,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.after, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn replace_(
        this: *Comment,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.replace, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const before = host_fn.wrapInstanceMethod(Comment, "before_", false);
    pub const after = host_fn.wrapInstanceMethod(Comment, "after_", false);
    pub const replace = host_fn.wrapInstanceMethod(Comment, "replace_", false);

    pub fn remove(
        this: *Comment,
        _: *JSGlobalObject,
        callFrame: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        this.comment.?.remove();
        return callFrame.this();
    }

    pub fn getText(
        this: *Comment,
        globalObject: *JSGlobalObject,
    ) bun.JSError!JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        return try this.comment.?.getText().toJS(globalObject);
    }

    pub fn setText(
        this: *Comment,
        global: *JSGlobalObject,
        value: JSValue,
    ) JSError!void {
        if (this.comment == null)
            return;
        var text = try value.toSlice(global, bun.default_allocator);
        defer text.deinit();
        this.comment.?.setText(text.slice()) catch {
            return global.throwValue(createLOLHTMLError(global));
        };
    }

    pub fn removed(
        this: *Comment,
        _: *JSGlobalObject,
    ) JSValue {
        if (this.comment == null)
            return .js_undefined;
        return JSValue.jsBoolean(this.comment.?.isRemoved());
    }

    pub fn finalize(this: *Comment) void {
        this.deref();
    }

    fn deinit(this: *Comment) void {
        this.comment = null;
        bun.destroy(this);
    }
};

pub const EndTag = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    end_tag: ?*LOLHTML.EndTag,

    pub fn init(end_tag: *LOLHTML.EndTag) *EndTag {
        return bun.new(EndTag, .{
            .ref_count = .init(),
            .end_tag = end_tag,
        });
    }

    pub fn finalize(this: *EndTag) void {
        this.deref();
    }

    fn deinit(this: *EndTag) void {
        this.end_tag = null;
        bun.destroy(this);
    }

    pub const Handler = struct {
        callback: ?JSValue,
        global: *JSGlobalObject,

        pub const onEndTag = HandlerCallback(
            Handler,
            EndTag,
            LOLHTML.EndTag,
            "end_tag",
            "callback",
        );

        pub const onEndTagHandler = LOLHTML.DirectiveHandler(LOLHTML.EndTag, Handler, onEndTag);
    };

    pub const js = jsc.Codegen.JSEndTag;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    fn contentHandler(this: *EndTag, comptime Callback: (fn (*LOLHTML.EndTag, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.end_tag == null)
            return JSValue.jsNull();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.end_tag.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return createLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn before_(
        this: *EndTag,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.before, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn after_(
        this: *EndTag,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.after, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn replace_(
        this: *EndTag,
        callFrame: *jsc.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.replace, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const before = host_fn.wrapInstanceMethod(EndTag, "before_", false);
    pub const after = host_fn.wrapInstanceMethod(EndTag, "after_", false);
    pub const replace = host_fn.wrapInstanceMethod(EndTag, "replace_", false);

    pub fn remove(
        this: *EndTag,
        _: *JSGlobalObject,
        callFrame: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        if (this.end_tag == null)
            return .js_undefined;

        this.end_tag.?.remove();
        return callFrame.this();
    }

    pub fn getName(
        this: *EndTag,
        globalObject: *JSGlobalObject,
    ) bun.JSError!JSValue {
        if (this.end_tag == null)
            return .js_undefined;

        return try this.end_tag.?.getName().toJS(globalObject);
    }

    pub fn setName(
        this: *EndTag,
        global: *JSGlobalObject,
        value: JSValue,
    ) JSError!void {
        if (this.end_tag == null)
            return;
        var text = try value.toSlice(global, bun.default_allocator);
        defer text.deinit();
        this.end_tag.?.setName(text.slice()) catch {
            return global.throwValue(createLOLHTMLError(global));
        };
    }
};

pub const AttributeIterator = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    iterator: ?*LOLHTML.Attribute.Iterator = null,

    pub fn init(iterator: *LOLHTML.Attribute.Iterator) *AttributeIterator {
        return bun.new(AttributeIterator, .{
            .ref_count = .init(),
            .iterator = iterator,
        });
    }

    fn detach(this: *AttributeIterator) void {
        if (this.iterator) |iter| {
            iter.deinit();
            this.iterator = null;
        }
    }

    pub fn finalize(this: *AttributeIterator) void {
        this.detach();
        this.deref();
    }

    fn deinit(this: *AttributeIterator) void {
        this.detach();
        bun.destroy(this);
    }

    pub const js = jsc.Codegen.JSAttributeIterator;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn next(this: *AttributeIterator, globalObject: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        const done_label = jsc.ZigString.static("done");
        const value_label = jsc.ZigString.static("value");

        if (this.iterator == null) {
            return JSValue.createObject2(globalObject, done_label, value_label, .true, .js_undefined);
        }

        var attribute = this.iterator.?.next() orelse {
            this.iterator.?.deinit();
            this.iterator = null;
            return JSValue.createObject2(globalObject, done_label, value_label, .true, .js_undefined);
        };

        const value = attribute.value();
        const name = attribute.name();

        return JSValue.createObject2(globalObject, done_label, value_label, .false, try bun.String.toJSArray(
            globalObject,
            &[_]bun.String{
                name.toString(),
                value.toString(),
            },
        ));
    }

    pub fn getThis(_: *AttributeIterator, _: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
        return callFrame.this();
    }
};
pub const Element = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    element: ?*LOLHTML.Element = null,

    pub const js = jsc.Codegen.JSElement;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn init(element: *LOLHTML.Element) *Element {
        return bun.new(Element, .{
            .ref_count = .init(),
            .element = element,
        });
    }

    pub fn finalize(this: *Element) void {
        this.deref();
    }

    fn deinit(this: *Element) void {
        this.element = null;
        bun.destroy(this);
    }

    pub fn onEndTag_(
        this: *Element,
        globalObject: *JSGlobalObject,
        function: JSValue,
        callFrame: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        if (this.element == null)
            return JSValue.jsNull();
        if (function.isUndefinedOrNull() or !function.isCallable()) {
            return ZigString.init("Expected a function").withEncoding().toJS(globalObject);
        }

        const end_tag_handler = bun.handleOom(bun.default_allocator.create(EndTag.Handler));
        end_tag_handler.* = .{ .global = globalObject, .callback = function };

        this.element.?.onEndTag(EndTag.Handler.onEndTagHandler, end_tag_handler) catch {
            bun.default_allocator.destroy(end_tag_handler);
            const err = createLOLHTMLError(globalObject);
            return globalObject.throwValue(err);
        };

        function.protect();
        return callFrame.this();
    }

    //     // fn wrap(comptime name: string)

    ///  Returns the value for a given attribute name: ZigString on the element, or null if it is not found.
    pub fn getAttribute_(this: *Element, globalObject: *JSGlobalObject, name: ZigString) bun.JSError!JSValue {
        if (this.element == null)
            return JSValue.jsNull();

        var slice = name.toSlice(bun.default_allocator);
        defer slice.deinit();
        var attr = this.element.?.getAttribute(slice.slice());

        if (attr.len == 0)
            return JSValue.jsNull();

        return try attr.toJS(globalObject);
    }

    /// Returns a boolean indicating whether an attribute exists on the element.
    pub fn hasAttribute_(this: *Element, global: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return .false;

        var slice = name.toSlice(bun.default_allocator);
        defer slice.deinit();
        return JSValue.jsBoolean(this.element.?.hasAttribute(slice.slice()) catch return createLOLHTMLError(global));
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub fn setAttribute_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, name_: ZigString, value_: ZigString) JSValue {
        if (this.element == null)
            return .js_undefined;

        var name_slice = name_.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        var value_slice = value_.toSlice(bun.default_allocator);
        defer value_slice.deinit();
        this.element.?.setAttribute(name_slice.slice(), value_slice.slice()) catch return createLOLHTMLError(globalObject);
        return callFrame.this();
    }

    ///  Removes the attribute.
    pub fn removeAttribute_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return .js_undefined;

        var name_slice = name.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        this.element.?.removeAttribute(
            name_slice.slice(),
        ) catch return createLOLHTMLError(globalObject);
        return callFrame.this();
    }

    pub const onEndTag = host_fn.wrapInstanceMethod(Element, "onEndTag_", false);
    pub const getAttribute = host_fn.wrapInstanceMethod(Element, "getAttribute_", false);
    pub const hasAttribute = host_fn.wrapInstanceMethod(Element, "hasAttribute_", false);
    pub const setAttribute = host_fn.wrapInstanceMethod(Element, "setAttribute_", false);
    pub const removeAttribute = host_fn.wrapInstanceMethod(Element, "removeAttribute_", false);

    fn contentHandler(this: *Element, comptime Callback: (fn (*LOLHTML.Element, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.element == null)
            return .js_undefined;

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.element.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return createLOLHTMLError(globalObject);

        return thisObject;
    }

    ///  Inserts content before the element.
    pub fn before_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.before,
            callFrame.this(),
            globalObject,
            content,
            contentOptions,
        );
    }

    ///  Inserts content right after the element.
    pub fn after_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.after,
            callFrame.this(),
            globalObject,
            content,
            contentOptions,
        );
    }

    /// Inserts content right after the start tag of the element.
    pub fn prepend_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.prepend,
            callFrame.this(),
            globalObject,
            content,
            contentOptions,
        );
    }

    ///  Inserts content right before the end tag of the element.
    pub fn append_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.append,
            callFrame.this(),
            globalObject,
            content,
            contentOptions,
        );
    }

    /// Removes the element and inserts content in place of it.
    pub fn replace_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.replace,
            callFrame.this(),
            globalObject,
            content,
            contentOptions,
        );
    }

    ///  Replaces content of the element.
    pub fn setInnerContent_(this: *Element, callFrame: *jsc.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.setInnerContent,
            callFrame.this(),
            globalObject,
            content,
            contentOptions,
        );
    }

    pub const before = host_fn.wrapInstanceMethod(Element, "before_", false);
    pub const after = host_fn.wrapInstanceMethod(Element, "after_", false);
    pub const prepend = host_fn.wrapInstanceMethod(Element, "prepend_", false);
    pub const append = host_fn.wrapInstanceMethod(Element, "append_", false);
    pub const replace = host_fn.wrapInstanceMethod(Element, "replace_", false);
    pub const setInnerContent = host_fn.wrapInstanceMethod(Element, "setInnerContent_", false);

    ///  Removes the element with all its content.
    pub fn remove(this: *Element, _: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
        if (this.element == null)
            return .js_undefined;

        this.element.?.remove();
        return callFrame.this();
    }

    ///  Removes the start tag and end tag of the element but keeps its inner content intact.
    pub fn removeAndKeepContent(this: *Element, _: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
        if (this.element == null)
            return .js_undefined;

        this.element.?.removeAndKeepContent();
        return callFrame.this();
    }

    pub fn getTagName(this: *Element, globalObject: *JSGlobalObject) bun.JSError!JSValue {
        if (this.element == null)
            return .js_undefined;

        return try htmlStringValue(this.element.?.tagName(), globalObject);
    }

    pub fn setTagName(this: *Element, global: *JSGlobalObject, value: JSValue) JSError!void {
        if (this.element == null)
            return;
        var text = try value.toSlice(global, bun.default_allocator);
        defer text.deinit();

        this.element.?.setTagName(text.slice()) catch {
            return global.throwValue(createLOLHTMLError(global));
        };
    }

    pub fn getRemoved(this: *Element, _: *JSGlobalObject) JSValue {
        if (this.element == null)
            return .js_undefined;
        return JSValue.jsBoolean(this.element.?.isRemoved());
    }

    pub fn getSelfClosing(this: *Element, _: *JSGlobalObject) JSValue {
        if (this.element == null)
            return .js_undefined;
        return JSValue.jsBoolean(this.element.?.isSelfClosing());
    }

    pub fn getCanHaveContent(this: *Element, _: *JSGlobalObject) JSValue {
        if (this.element == null)
            return .js_undefined;
        return JSValue.jsBoolean(this.element.?.canHaveContent());
    }

    pub fn getNamespaceURI(this: *Element, globalObject: *JSGlobalObject) JSError!JSValue {
        if (this.element == null)
            return .js_undefined;
        return bun.String.createUTF8ForJS(globalObject, std.mem.span(this.element.?.namespaceURI()));
    }

    pub fn getAttributes(this: *Element, globalObject: *JSGlobalObject) JSValue {
        if (this.element == null)
            return .js_undefined;

        const iter = this.element.?.attributes() orelse return createLOLHTMLError(globalObject);
        var attr_iter = bun.new(AttributeIterator, .{
            .ref_count = .init(),
            .iterator = iter,
        });
        return attr_iter.toJS(globalObject);
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const LOLHTML = bun.LOLHTML;
const Response = bun.webcore.Response;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const host_fn = jsc.host_fn;
