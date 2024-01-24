const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const JSC = @import("root").bun.JSC;
const WebCore = @import("../webcore/response.zig");
const ZigString = JSC.ZigString;
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Response = WebCore.Response;
const LOLHTML = @import("root").bun.LOLHTML;

const SelectorMap = std.ArrayListUnmanaged(*LOLHTML.HTMLSelector);
pub const LOLHTMLContext = struct {
    selectors: SelectorMap = .{},
    element_handlers: std.ArrayListUnmanaged(*ElementHandler) = .{},
    document_handlers: std.ArrayListUnmanaged(*DocumentHandler) = .{},
    ref_count: u32 = 1,

    pub usingnamespace bun.NewRefCounted(@This(), deinit);

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

        this.destroy();
    }
};
pub const HTMLRewriter = struct {
    builder: *LOLHTML.HTMLRewriter.Builder,
    context: *LOLHTMLContext,

    pub usingnamespace JSC.Codegen.JSHTMLRewriter;

    pub fn constructor(_: *JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*HTMLRewriter {
        const rewriter = bun.default_allocator.create(HTMLRewriter) catch unreachable;
        rewriter.* = HTMLRewriter{
            .builder = LOLHTML.HTMLRewriter.Builder.init(),
            .context = LOLHTMLContext.new(.{}),
        };
        return rewriter;
    }

    pub fn on_(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        selector_name: ZigString,
        callFrame: *JSC.CallFrame,
        listener: JSValue,
    ) JSValue {
        const selector_slice = std.fmt.allocPrint(bun.default_allocator, "{}", .{selector_name}) catch unreachable;

        var selector = LOLHTML.HTMLSelector.parse(selector_slice) catch
            return throwLOLHTMLError(global);
        const handler_ = ElementHandler.init(global, listener) catch return .zero;
        const handler = getAllocator(global).create(ElementHandler) catch unreachable;
        handler.* = handler_;

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
            selector.deinit();
            return throwLOLHTMLError(global);
        };

        this.context.selectors.append(bun.default_allocator, selector) catch unreachable;
        this.context.element_handlers.append(bun.default_allocator, handler) catch unreachable;
        return callFrame.this();
    }

    pub fn onDocument_(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        listener: JSValue,
        callFrame: *JSC.CallFrame,
    ) JSValue {
        const handler_ = DocumentHandler.init(global, listener) catch return .zero;

        const handler = getAllocator(global).create(DocumentHandler) catch unreachable;
        handler.* = handler_;

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

        this.context.document_handlers.append(bun.default_allocator, handler) catch unreachable;
        return callFrame.this();
    }

    pub fn finalize(this: *HTMLRewriter) callconv(.C) void {
        this.finalizeWithoutDestroy();
        bun.default_allocator.destroy(this);
    }

    pub fn finalizeWithoutDestroy(this: *HTMLRewriter) void {
        this.context.deref();
        this.builder.deinit();
    }

    pub fn beginTransform(this: *HTMLRewriter, global: *JSGlobalObject, response: *Response) JSValue {
        const new_context = this.context;
        new_context.ref();
        return BufferOutputSink.init(new_context, global, response, this.builder);
    }

    pub fn transform_(this: *HTMLRewriter, global: *JSGlobalObject, response_value: JSC.JSValue) JSValue {
        if (response_value.as(Response)) |response| {
            if (response.body.value == .Used) {
                global.throwInvalidArguments("Response body already used", .{});
                return .zero;
            }

            const out = this.beginTransform(global, response);

            if (out != .zero) {
                if (out.toError()) |err| {
                    global.throwValue(err);
                    return .zero;
                }
            }

            return out;
        }

        const ResponseKind = enum { string, array_buffer, other };
        const kind: ResponseKind = brk: {
            if (response_value.isString())
                break :brk .string
            else if (response_value.jsType().isTypedArray())
                break :brk .array_buffer
            else
                break :brk .other;
        };

        if (kind != .other) {
            if (JSC.WebCore.Body.extract(global, response_value)) |body_value| {
                const resp = bun.new(Response, Response{
                    .init = .{
                        .status_code = 200,
                    },
                    .body = body_value,
                });
                defer resp.finalize();
                const out_response_value = this.beginTransform(global, resp);
                out_response_value.ensureStillAlive();
                var out_response = out_response_value.as(Response) orelse return out_response_value;
                var blob = out_response.body.value.useAsAnyBlobAllowNonUTF8String();

                defer {
                    _ = Response.dangerouslySetPtr(out_response_value, null);
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

        global.throwInvalidArguments("Expected Response or Body", .{});
        return .zero;
    }

    pub const on = JSC.wrapInstanceMethod(HTMLRewriter, "on_", false);
    pub const onDocument = JSC.wrapInstanceMethod(HTMLRewriter, "onDocument_", false);
    pub const transform = JSC.wrapInstanceMethod(HTMLRewriter, "transform_", false);

    pub const HTMLRewriterLoader = struct {
        rewriter: *LOLHTML.HTMLRewriter,
        finalized: bool = false,
        context: LOLHTMLContext,
        chunk_size: usize = 0,
        failed: bool = false,
        output: JSC.WebCore.Sink,
        signal: JSC.WebCore.Signal = .{},
        backpressure: std.fifo.LinearFifo(u8, .Dynamic) = std.fifo.LinearFifo(u8, .Dynamic).init(bun.default_allocator),

        pub fn finalize(this: *HTMLRewriterLoader) void {
            if (this.finalized) return;
            this.rewriter.deinit();
            this.backpressure.deinit();
            this.backpressure = std.fifo.LinearFifo(u8, .Dynamic).init(bun.default_allocator);
            this.finalized = true;
        }

        pub fn fail(this: *HTMLRewriterLoader, err: bun.sys.Error) void {
            this.signal.close(err);
            this.output.end(err);
            this.failed = true;
            this.finalize();
        }

        pub fn connect(this: *HTMLRewriterLoader, signal: JSC.WebCore.Signal) void {
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

            const write_result = this.output.write(.{ .temporary = bun.ByteList.init(bytes) });

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
            output: JSC.WebCore.Sink,
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

        pub fn sink(this: *HTMLRewriterLoader) JSC.WebCore.Sink {
            return JSC.WebCore.Sink.init(this);
        }

        fn writeBytes(this: *HTMLRewriterLoader, bytes: bun.ByteList, comptime deinit_: bool) ?bun.sys.Error {
            this.rewriter.write(bytes.slice()) catch {
                return bun.sys.Error{
                    .errno = 1,
                    // TODO: make this a union
                    .path = bun.default_allocator.dupe(u8, LOLHTML.HTMLString.lastError().slice()) catch unreachable,
                };
            };
            if (comptime deinit_) bytes.listManaged(bun.default_allocator).deinit();
            return null;
        }

        pub fn write(this: *HTMLRewriterLoader, data: JSC.WebCore.StreamResult) JSC.WebCore.StreamResult.Writable {
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

        pub fn writeUTF16(this: *HTMLRewriterLoader, data: JSC.WebCore.StreamResult) JSC.WebCore.StreamResult.Writable {
            return JSC.WebCore.Sink.UTF8Fallback.writeUTF16(HTMLRewriterLoader, this, data, write);
        }

        pub fn writeLatin1(this: *HTMLRewriterLoader, data: JSC.WebCore.StreamResult) JSC.WebCore.StreamResult.Writable {
            return JSC.WebCore.Sink.UTF8Fallback.writeLatin1(HTMLRewriterLoader, this, data, write);
        }
    };

    pub const BufferOutputSink = struct {
        global: *JSGlobalObject,
        bytes: bun.MutableString,
        rewriter: ?*LOLHTML.HTMLRewriter = null,
        context: *LOLHTMLContext,
        response: *Response,
        response_value: JSC.Strong = .{},
        bodyValueBufferer: ?JSC.WebCore.BodyValueBufferer = null,
        tmp_sync_error: ?*JSC.JSValue = null,
        // const log = bun.Output.scoped(.BufferOutputSink, false);
        pub fn init(context: *LOLHTMLContext, global: *JSGlobalObject, original: *Response, builder: *LOLHTML.HTMLRewriter.Builder) JSC.JSValue {
            var sink = bun.new(BufferOutputSink, BufferOutputSink{
                .global = global,
                .bytes = bun.MutableString.initEmpty(bun.default_allocator),
                .rewriter = null,
                .context = context,
                .response = undefined,
            });
            var result = bun.new(Response, .{
                .init = .{
                    .status_code = 200,
                },
                .body = .{
                    .value = .{
                        .Locked = .{
                            .global = global,
                            .task = sink,
                        },
                    },
                },
            });

            sink.response = result;

            const input_size = original.body.len();
            sink.rewriter = builder.build(
                .UTF8,
                .{
                    .preallocated_parsing_buffer_size = if (input_size == JSC.WebCore.Blob.max_size)
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
                sink.deinit();
                result.finalize();
                return throwLOLHTMLError(global);
            };

            result.init.method = original.init.method;
            result.init.status_code = original.init.status_code;
            result.init.status_text = original.init.status_text.clone();

            // https://github.com/oven-sh/bun/issues/3334
            if (original.init.headers) |headers| {
                result.init.headers = headers.cloneThis(global);
            }

            // Hold off on cloning until we're actually done.
            const response_js_value = sink.response.toJS(sink.global);
            sink.response_value.set(global, response_js_value);

            result.url = original.url.clone();
            var sink_error: JSC.JSValue = .zero;
            sink.tmp_sync_error = &sink_error;
            const value = original.getBodyValue();
            sink.bodyValueBufferer = JSC.WebCore.BodyValueBufferer.init(sink, onFinishedBuffering, sink.global, bun.default_allocator);
            response_js_value.ensureStillAlive();
            sink.bodyValueBufferer.?.run(value) catch |buffering_error| {
                return switch (buffering_error) {
                    error.StreamAlreadyUsed => {
                        var err = JSC.SystemError{
                            .code = bun.String.static(@as(string, @tagName(JSC.Node.ErrorCode.ERR_STREAM_ALREADY_FINISHED))),
                            .message = bun.String.static("Stream already used, please create a new one"),
                        };
                        return err.toErrorInstance(sink.global);
                    },
                    error.InvalidStream => {
                        var err = JSC.SystemError{
                            .code = bun.String.static(@as(string, @tagName(JSC.Node.ErrorCode.ERR_STREAM_CANNOT_PIPE))),
                            .message = bun.String.static("Invalid stream"),
                        };
                        return err.toErrorInstance(sink.global);
                    },
                    else => {
                        var err = JSC.SystemError{
                            .code = bun.String.static(@as(string, @tagName(JSC.Node.ErrorCode.ERR_STREAM_CANNOT_PIPE))),
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
                defer sink.deinit();

                return sink_error;
            }

            response_js_value.ensureStillAlive();
            return response_js_value;
        }

        pub fn onFinishedBuffering(ctx: *anyopaque, bytes: []const u8, js_err: ?JSC.JSValue, is_async: bool) void {
            const sink = bun.cast(*BufferOutputSink, ctx);
            if (js_err) |err| {
                if (sink.response.body.value == .Locked and @intFromPtr(sink.response.body.value.Locked.task) == @intFromPtr(sink) and
                    sink.response.body.value.Locked.promise == null)
                {
                    sink.response.body.value = .{ .Empty = {} };
                    // is there a pending promise?
                    // we will need to reject it
                } else if (sink.response.body.value == .Locked and @intFromPtr(sink.response.body.value.Locked.task) == @intFromPtr(sink) and
                    sink.response.body.value.Locked.promise != null)
                {
                    sink.response.body.value.Locked.onReceiveValue = null;
                    sink.response.body.value.Locked.task = null;
                }
                if (is_async) {
                    sink.response.body.value.toErrorInstance(err, sink.global);
                } else {
                    var ret_err = throwLOLHTMLError(sink.global);
                    ret_err.ensureStillAlive();
                    ret_err.protect();
                    sink.tmp_sync_error.?.* = ret_err;
                }
                sink.rewriter.?.end() catch {};
                sink.deinit();
                return;
            }

            if (sink.runOutputSink(bytes, is_async)) |ret_err| {
                ret_err.ensureStillAlive();
                ret_err.protect();
                sink.tmp_sync_error.?.* = ret_err;
            } else {
                sink.deinit();
            }
        }

        pub fn runOutputSink(
            sink: *BufferOutputSink,
            bytes: []const u8,
            is_async: bool,
        ) ?JSValue {
            sink.bytes.growBy(bytes.len) catch unreachable;
            const global = sink.global;
            var response = sink.response;

            sink.rewriter.?.write(bytes) catch {
                sink.deinit();

                if (is_async) {
                    response.body.value.toErrorInstance(throwLOLHTMLError(global), global);

                    return null;
                } else {
                    return throwLOLHTMLError(global);
                }
            };

            sink.rewriter.?.end() catch {
                if (!is_async) response.finalize();
                sink.response = undefined;
                sink.deinit();

                if (is_async) {
                    response.body.value.toErrorInstance(throwLOLHTMLError(global), global);
                    return null;
                } else {
                    return throwLOLHTMLError(global);
                }
            };

            return null;
        }

        pub const Sync = enum { suspended, pending, done };

        pub fn done(this: *BufferOutputSink) void {
            var prev_value = this.response.body.value;
            this.response.body.value = JSC.WebCore.Body.Value{
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
                &this.response.body.value,
                this.global,
            );
        }

        pub fn write(this: *BufferOutputSink, bytes: []const u8) void {
            this.bytes.append(bytes) catch unreachable;
        }

        pub fn deinit(this: *BufferOutputSink) void {
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
    //     input: JSC.WebCore.Blob = undefined,
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

    //             return throwLOLHTMLError(global);
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

    //         var input: JSC.WebCore.Blob = original.body.value.use();

    //         const is_pending = input.needsToReadFile();
    //         defer if (!is_pending) input.detach();

    //         if (is_pending) {
    //             input.doReadFileInternal(*StreamOutputSink, sink, onFinishedLoading, global);
    //         } else if (sink.runOutputSink(input.sharedView(), false, false)) |error_value| {
    //             return error_value;
    //         }

    //         // Hold off on cloning until we're actually done.

    //         return JSC.JSValue.fromRef(
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
    //         var bytes = this.bytes.toOwnedSliceLeaky();
    //         this.response.body.value = .{
    //             .Blob = JSC.WebCore.Blob.init(bytes, this.bytes.allocator, this.global),
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
            global.throwInvalidArguments(
                "Expected object",
                .{},
            );
            return error.InvalidArguments;
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

        if (thisObject.get(global, "doctype")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                global.throwInvalidArguments("doctype must be a function", .{});
                return error.InvalidArguments;
            }
            val.protect();
            handler.onDocTypeCallback = val;
        }

        if (thisObject.get(global, "comments")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                global.throwInvalidArguments("comments must be a function", .{});
                return error.InvalidArguments;
            }
            val.protect();
            handler.onCommentCallback = val;
        }

        if (thisObject.get(global, "text")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                global.throwInvalidArguments("text must be a function", .{});
                return error.InvalidArguments;
            }
            val.protect();
            handler.onTextCallback = val;
        }

        if (thisObject.get(global, "end")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                global.throwInvalidArguments("end must be a function", .{});
                return error.InvalidArguments;
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
            JSC.markBinding(@src());
            var zig_element = bun.default_allocator.create(ZigType) catch unreachable;
            @field(zig_element, field_name) = value;
            defer @field(zig_element, field_name) = null;

            var result = @field(this, callback_name).?.callWithThis(
                this.global,
                if (comptime @hasField(HandlerType, "thisObject"))
                    @field(this, "thisObject")
                else
                    JSValue.zero,
                &.{zig_element.toJS(this.global)},
            );

            if (!result.isUndefinedOrNull()) {
                if (result.isError() or result.isAggregateError(this.global)) {
                    return true;
                }

                if (result.asAnyPromise()) |promise| {
                    this.global.bunVM().waitForPromise(promise);
                    const fail = promise.status(this.global.vm()) == .Rejected;
                    if (fail) {
                        this.global.bunVM().runErrorHandler(promise.result(this.global.vm()), null);
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
            global.throwInvalidArguments(
                "Expected object",
                .{},
            );
            return error.InvalidArguments;
        }

        if (thisObject.get(global, "element")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                global.throwInvalidArguments("element must be a function", .{});
                return error.InvalidArguments;
            }
            val.protect();
            handler.onElementCallback = val;
        }

        if (thisObject.get(global, "comments")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                global.throwInvalidArguments("comments must be a function", .{});
                return error.InvalidArguments;
            }
            val.protect();
            handler.onCommentCallback = val;
        }

        if (thisObject.get(global, "text")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                global.throwInvalidArguments("text must be a function", .{});
                return error.InvalidArguments;
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

fn throwLOLHTMLError(global: *JSGlobalObject) JSValue {
    const err = LOLHTML.HTMLString.lastError();
    defer err.deinit();
    return ZigString.fromUTF8(err.slice()).toErrorInstance(global);
}

fn htmlStringValue(input: LOLHTML.HTMLString, globalObject: *JSGlobalObject) JSValue {
    return input.toJS(globalObject);
}

pub const TextChunk = struct {
    text_chunk: ?*LOLHTML.TextChunk = null,

    pub usingnamespace JSC.Codegen.JSTextChunk;

    fn contentHandler(this: *TextChunk, comptime Callback: (fn (*LOLHTML.TextChunk, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.text_chunk == null)
            return JSC.JSValue.jsUndefined();
        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.text_chunk.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn before_(
        this: *TextChunk,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.before, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn after_(
        this: *TextChunk,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.after, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn replace_(
        this: *TextChunk,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.replace, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const before = JSC.wrapInstanceMethod(TextChunk, "before_", false);
    pub const after = JSC.wrapInstanceMethod(TextChunk, "after_", false);
    pub const replace = JSC.wrapInstanceMethod(TextChunk, "replace_", false);

    pub fn remove(
        this: *TextChunk,
        _: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        if (this.text_chunk == null)
            return JSValue.jsUndefined();
        this.text_chunk.?.remove();
        return callFrame.this();
    }

    pub fn getText(
        this: *TextChunk,
        global: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.text_chunk == null)
            return JSValue.jsUndefined();
        return ZigString.init(this.text_chunk.?.getContent().slice()).withEncoding().toValueGC(global);
    }

    pub fn removed(this: *TextChunk, _: *JSGlobalObject) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.text_chunk.?.isRemoved());
    }

    pub fn lastInTextNode(this: *TextChunk, _: *JSGlobalObject) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.text_chunk.?.isLastInTextNode());
    }

    pub fn finalize(this: *TextChunk) callconv(.C) void {
        this.text_chunk = null;
        bun.default_allocator.destroy(this);
    }
};

pub const DocType = struct {
    doctype: ?*LOLHTML.DocType = null,

    pub fn finalize(this: *DocType) callconv(.C) void {
        this.doctype = null;
        bun.default_allocator.destroy(this);
    }

    pub usingnamespace JSC.Codegen.JSDocType;

    /// The doctype name.
    pub fn name(
        this: *DocType,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.doctype == null)
            return JSValue.jsUndefined();
        const str = this.doctype.?.getName().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toValueGC(globalObject);
    }

    pub fn systemId(
        this: *DocType,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.doctype == null)
            return JSValue.jsUndefined();

        const str = this.doctype.?.getSystemId().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toValueGC(globalObject);
    }

    pub fn publicId(
        this: *DocType,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.doctype == null)
            return JSValue.jsUndefined();

        const str = this.doctype.?.getPublicId().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toValueGC(globalObject);
    }
};

pub const DocEnd = struct {
    doc_end: ?*LOLHTML.DocEnd,

    pub fn finalize(this: *DocEnd) callconv(.C) void {
        this.doc_end = null;
        bun.default_allocator.destroy(this);
    }

    pub usingnamespace JSC.Codegen.JSDocEnd;

    fn contentHandler(this: *DocEnd, comptime Callback: (fn (*LOLHTML.DocEnd, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.doc_end == null)
            return JSValue.jsNull();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.doc_end.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn append_(
        this: *DocEnd,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.DocEnd.append, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const append = JSC.wrapInstanceMethod(DocEnd, "append_", false);
};

pub const Comment = struct {
    comment: ?*LOLHTML.Comment = null,

    pub fn finalize(this: *Comment) callconv(.C) void {
        this.comment = null;
        bun.default_allocator.destroy(this);
    }

    pub usingnamespace JSC.Codegen.JSComment;

    fn contentHandler(this: *Comment, comptime Callback: (fn (*LOLHTML.Comment, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.comment.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn before_(
        this: *Comment,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.before, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn after_(
        this: *Comment,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.after, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn replace_(
        this: *Comment,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.replace, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const before = JSC.wrapInstanceMethod(Comment, "before_", false);
    pub const after = JSC.wrapInstanceMethod(Comment, "after_", false);
    pub const replace = JSC.wrapInstanceMethod(Comment, "replace_", false);

    pub fn remove(
        this: *Comment,
        _: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        this.comment.?.remove();
        return callFrame.this();
    }

    pub fn getText(
        this: *Comment,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        return this.comment.?.getText().toJS(globalObject);
    }

    pub fn setText(
        this: *Comment,
        global: *JSGlobalObject,
        value: JSValue,
    ) callconv(.C) bool {
        if (this.comment == null)
            return false;
        var text = value.toSlice(global, bun.default_allocator);
        defer text.deinit();
        this.comment.?.setText(text.slice()) catch {
            global.throwValue(throwLOLHTMLError(global));
            return false;
        };

        return true;
    }

    pub fn removed(
        this: *Comment,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.comment == null)
            return JSValue.jsUndefined();
        return JSValue.jsBoolean(this.comment.?.isRemoved());
    }
};

pub const EndTag = struct {
    end_tag: ?*LOLHTML.EndTag,

    pub fn finalize(this: *EndTag) callconv(.C) void {
        this.end_tag = null;
        bun.default_allocator.destroy(this);
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

    pub usingnamespace JSC.Codegen.JSEndTag;

    fn contentHandler(this: *EndTag, comptime Callback: (fn (*LOLHTML.EndTag, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.end_tag == null)
            return JSValue.jsNull();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.end_tag.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return thisObject;
    }

    pub fn before_(
        this: *EndTag,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.before, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn after_(
        this: *EndTag,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.after, callFrame.this(), globalObject, content, contentOptions);
    }

    pub fn replace_(
        this: *EndTag,
        callFrame: *JSC.CallFrame,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.replace, callFrame.this(), globalObject, content, contentOptions);
    }

    pub const before = JSC.wrapInstanceMethod(EndTag, "before_", false);
    pub const after = JSC.wrapInstanceMethod(EndTag, "after_", false);
    pub const replace = JSC.wrapInstanceMethod(EndTag, "replace_", false);

    pub fn remove(
        this: *EndTag,
        _: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        if (this.end_tag == null)
            return JSValue.jsUndefined();

        this.end_tag.?.remove();
        return callFrame.this();
    }

    pub fn getName(
        this: *EndTag,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.end_tag == null)
            return JSValue.jsUndefined();

        return this.end_tag.?.getName().toJS(globalObject);
    }

    pub fn setName(
        this: *EndTag,
        global: *JSGlobalObject,
        value: JSValue,
    ) callconv(.C) bool {
        if (this.end_tag == null)
            return false;
        var text = value.toSlice(global, bun.default_allocator);
        defer text.deinit();
        this.end_tag.?.setName(text.slice()) catch {
            global.throwValue(throwLOLHTMLError(global));
            return false;
        };

        return true;
    }
};

pub const AttributeIterator = struct {
    iterator: ?*LOLHTML.Attribute.Iterator = null,

    pub fn finalize(this: *AttributeIterator) callconv(.C) void {
        if (this.iterator) |iter| {
            iter.deinit();
            this.iterator = null;
        }
        bun.default_allocator.destroy(this);
    }

    pub usingnamespace JSC.Codegen.JSAttributeIterator;

    pub fn next(this: *AttributeIterator, globalObject: *JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        const done_label = JSC.ZigString.static("done");
        const value_label = JSC.ZigString.static("value");

        if (this.iterator == null) {
            return JSValue.createObject2(globalObject, done_label, value_label, JSValue.jsBoolean(true), JSValue.jsUndefined());
        }

        var attribute = this.iterator.?.next() orelse {
            this.iterator.?.deinit();
            this.iterator = null;
            return JSValue.createObject2(globalObject, done_label, value_label, JSValue.jsBoolean(true), JSValue.jsUndefined());
        };

        const value = attribute.value();
        const name = attribute.name();

        return JSValue.createObject2(globalObject, done_label, value_label, JSValue.jsBoolean(false), bun.String.toJSArray(
            globalObject,
            &[_]bun.String{
                name.toString(),
                value.toString(),
            },
        ));
    }

    pub fn getThis(_: *AttributeIterator, _: *JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        return callFrame.this();
    }
};
pub const Element = struct {
    element: ?*LOLHTML.Element = null,

    pub usingnamespace JSC.Codegen.JSElement;

    pub fn finalize(this: *Element) callconv(.C) void {
        this.element = null;
        bun.default_allocator.destroy(this);
    }

    pub fn onEndTag_(
        this: *Element,
        globalObject: *JSGlobalObject,
        function: JSValue,
        callFrame: *JSC.CallFrame,
    ) JSValue {
        if (this.element == null)
            return JSValue.jsNull();
        if (function.isUndefinedOrNull() or !function.isCallable(globalObject.vm())) {
            return ZigString.init("Expected a function").withEncoding().toValueGC(globalObject);
        }

        const end_tag_handler = bun.default_allocator.create(EndTag.Handler) catch unreachable;
        end_tag_handler.* = .{ .global = globalObject, .callback = function };

        this.element.?.onEndTag(EndTag.Handler.onEndTagHandler, end_tag_handler) catch {
            bun.default_allocator.destroy(end_tag_handler);
            return throwLOLHTMLError(globalObject);
        };

        function.protect();
        return callFrame.this();
    }

    //     // fn wrap(comptime name: string)

    ///  Returns the value for a given attribute name: ZigString on the element, or null if it is not found.
    pub fn getAttribute_(this: *Element, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsNull();

        var slice = name.toSlice(bun.default_allocator);
        defer slice.deinit();
        var attr = this.element.?.getAttribute(slice.slice());

        if (attr.len == 0)
            return JSValue.jsNull();

        return attr.toJS(globalObject);
    }

    /// Returns a boolean indicating whether an attribute exists on the element.
    pub fn hasAttribute_(this: *Element, global: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsBoolean(false);

        var slice = name.toSlice(bun.default_allocator);
        defer slice.deinit();
        return JSValue.jsBoolean(this.element.?.hasAttribute(slice.slice()) catch return throwLOLHTMLError(global));
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub fn setAttribute_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, name_: ZigString, value_: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        var name_slice = name_.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        var value_slice = value_.toSlice(bun.default_allocator);
        defer value_slice.deinit();
        this.element.?.setAttribute(name_slice.slice(), value_slice.slice()) catch return throwLOLHTMLError(globalObject);
        return callFrame.this();
    }

    ///  Removes the attribute.
    pub fn removeAttribute_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        var name_slice = name.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        this.element.?.removeAttribute(
            name_slice.slice(),
        ) catch return throwLOLHTMLError(globalObject);
        return callFrame.this();
    }

    pub const onEndTag = JSC.wrapInstanceMethod(Element, "onEndTag_", false);
    pub const getAttribute = JSC.wrapInstanceMethod(Element, "getAttribute_", false);
    pub const hasAttribute = JSC.wrapInstanceMethod(Element, "hasAttribute_", false);
    pub const setAttribute = JSC.wrapInstanceMethod(Element, "setAttribute_", false);
    pub const removeAttribute = JSC.wrapInstanceMethod(Element, "removeAttribute_", false);

    fn contentHandler(this: *Element, comptime Callback: (fn (*LOLHTML.Element, []const u8, bool) LOLHTML.Error!void), thisObject: JSValue, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.element.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return thisObject;
    }

    ///  Inserts content before the element.
    pub fn before_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
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
    pub fn after_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
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
    pub fn prepend_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
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
    pub fn append_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
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
    pub fn replace_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
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
    pub fn setInnerContent_(this: *Element, callFrame: *JSC.CallFrame, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.setInnerContent,
            callFrame.this(),
            globalObject,
            content,
            contentOptions,
        );
    }

    pub const before = JSC.wrapInstanceMethod(Element, "before_", false);
    pub const after = JSC.wrapInstanceMethod(Element, "after_", false);
    pub const prepend = JSC.wrapInstanceMethod(Element, "prepend_", false);
    pub const append = JSC.wrapInstanceMethod(Element, "append_", false);
    pub const replace = JSC.wrapInstanceMethod(Element, "replace_", false);
    pub const setInnerContent = JSC.wrapInstanceMethod(Element, "setInnerContent_", false);

    ///  Removes the element with all its content.
    pub fn remove(
        this: *Element,
        _: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        this.element.?.remove();
        return callFrame.this();
    }

    ///  Removes the start tag and end tag of the element but keeps its inner content intact.
    pub fn removeAndKeepContent(
        this: *Element,
        _: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        this.element.?.removeAndKeepContent();
        return callFrame.this();
    }
    pub fn getTagName(this: *Element, globalObject: *JSGlobalObject) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        return htmlStringValue(this.element.?.tagName(), globalObject);
    }

    pub fn setTagName(
        this: *Element,
        global: *JSGlobalObject,
        value: JSValue,
    ) callconv(.C) bool {
        if (this.element == null)
            return false;

        var text = value.toSlice(global, bun.default_allocator);
        defer text.deinit();

        this.element.?.setTagName(text.slice()) catch {
            global.throwValue(throwLOLHTMLError(global));
            return false;
        };

        return true;
    }

    pub fn getRemoved(
        this: *Element,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();
        return JSValue.jsBoolean(this.element.?.isRemoved());
    }

    pub fn getSelfClosing(
        this: *Element,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();
        return JSValue.jsBoolean(this.element.?.isSelfClosing());
    }

    pub fn getCanHaveContent(
        this: *Element,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();
        return JSValue.jsBoolean(this.element.?.canHaveContent());
    }

    pub fn getNamespaceURI(
        this: *Element,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();
        var str = bun.String.createUTF8(std.mem.span(this.element.?.namespaceURI()));
        defer str.deref();
        return str.toJS(globalObject);
    }

    pub fn getAttributes(
        this: *Element,
        globalObject: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        const iter = this.element.?.attributes() orelse return throwLOLHTMLError(globalObject);
        var attr_iter = bun.default_allocator.create(AttributeIterator) catch unreachable;
        attr_iter.* = .{ .iterator = iter };
        var js_attr_iter = attr_iter.toJS(globalObject);
        js_attr_iter.protect();
        defer js_attr_iter.unprotect();
        return js_attr_iter;
    }
};
