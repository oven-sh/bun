const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const http = @import("../../http.zig");
const JavaScript = @import("../javascript.zig");
const QueryStringMap = @import("../../url.zig").QueryStringMap;
const CombinedScanner = @import("../../url.zig").CombinedScanner;
const bun = @import("root").bun;
const string = bun.string;
const JSC = @import("root").bun.JSC;
const js = JSC.C;
const WebCore = @import("../webcore/response.zig");
const Router = @This();
const Bundler = bun.bundler;
const VirtualMachine = JavaScript.VirtualMachine;
const ScriptSrcStream = std.io.FixedBufferStream([]u8);
const ZigString = JSC.ZigString;
const Fs = @import("../../fs.zig");
const Base = @import("../base.zig");
const getAllocator = Base.getAllocator;
const JSObject = JSC.JSObject;
const JSError = Base.JSError;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = @import("root").bun.strings;
const NewClass = Base.NewClass;
const To = Base.To;
const Request = WebCore.Request;

const FetchEvent = WebCore.FetchEvent;
const Response = WebCore.Response;
const LOLHTML = @import("root").bun.LOLHTML;

const SelectorMap = std.ArrayListUnmanaged(*LOLHTML.HTMLSelector);
pub const LOLHTMLContext = struct {
    selectors: SelectorMap = .{},
    element_handlers: std.ArrayListUnmanaged(*ElementHandler) = .{},
    document_handlers: std.ArrayListUnmanaged(*DocumentHandler) = .{},

    pub fn deinit(this: *LOLHTMLContext, allocator: std.mem.Allocator) void {
        for (this.selectors.items) |selector| {
            selector.deinit();
        }
        this.selectors.deinit(allocator);
        this.selectors = .{};

        for (this.element_handlers.items) |handler| {
            handler.deinit();
        }
        this.element_handlers.deinit(allocator);
        this.element_handlers = .{};

        for (this.document_handlers.items) |handler| {
            handler.deinit();
        }
        this.document_handlers.deinit(allocator);
        this.document_handlers = .{};
    }
};
pub const HTMLRewriter = struct {
    builder: *LOLHTML.HTMLRewriter.Builder,
    context: LOLHTMLContext,

    pub const Constructor = JSC.NewConstructor(HTMLRewriter, .{ .constructor = constructor }, .{});

    pub const Class = NewClass(
        HTMLRewriter,
        .{ .name = "HTMLRewriter" },
        .{
            .finalize = finalize,
            .on = .{
                .rfn = wrap(HTMLRewriter, "on"),
            },
            .onDocument = .{
                .rfn = wrap(HTMLRewriter, "onDocument"),
            },
            .transform = .{
                .rfn = wrap(HTMLRewriter, "transform"),
            },
        },
        .{},
    );

    pub fn constructor(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSObjectRef {
        var rewriter = bun.default_allocator.create(HTMLRewriter) catch unreachable;
        rewriter.* = HTMLRewriter{
            .builder = LOLHTML.HTMLRewriter.Builder.init(),
            .context = .{},
        };
        return HTMLRewriter.Class.make(ctx, rewriter);
    }

    pub fn on(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        selector_name: ZigString,
        thisObject: JSC.C.JSObjectRef,
        listener: JSValue,
        exception: JSC.C.ExceptionRef,
    ) JSValue {
        var selector_slice = std.fmt.allocPrint(bun.default_allocator, "{}", .{selector_name}) catch unreachable;

        var selector = LOLHTML.HTMLSelector.parse(selector_slice) catch
            return throwLOLHTMLError(global);
        var handler_ = ElementHandler.init(global, listener, exception);
        if (exception.* != null) {
            selector.deinit();
            return JSValue.fromRef(exception.*);
        }
        var handler = getAllocator(global).create(ElementHandler) catch unreachable;
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
        return JSValue.fromRef(thisObject);
    }

    pub fn onDocument(
        this: *HTMLRewriter,
        global: *JSGlobalObject,
        listener: JSValue,
        thisObject: JSC.C.JSObjectRef,
        exception: JSC.C.ExceptionRef,
    ) JSValue {
        var handler_ = DocumentHandler.init(global, listener, exception);
        if (exception.* != null) {
            return JSValue.fromRef(exception.*);
        }

        var handler = getAllocator(global).create(DocumentHandler) catch unreachable;
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
        return JSValue.fromRef(thisObject);
    }

    pub fn finalize(this: *HTMLRewriter) void {
        this.finalizeWithoutDestroy();
        bun.default_allocator.destroy(this);
    }

    pub fn finalizeWithoutDestroy(this: *HTMLRewriter) void {
        this.context.deinit(bun.default_allocator);
    }

    pub fn beginTransform(this: *HTMLRewriter, global: *JSGlobalObject, response: *Response) JSValue {
        const new_context = this.context;
        this.context = .{};
        return BufferOutputSink.init(new_context, global, response, this.builder);
    }

    pub fn returnEmptyResponse(this: *HTMLRewriter, global: *JSGlobalObject, response: *Response) JSValue {
        var result = bun.default_allocator.create(Response) catch unreachable;

        response.cloneInto(result, getAllocator(global), global);
        this.finalizeWithoutDestroy();
        return result.toJS(global);
    }

    pub fn transform(this: *HTMLRewriter, global: *JSGlobalObject, response: *Response) JSValue {
        if (response.body.len() == 0 and !(response.body.value == .Blob and response.body.value.Blob.needsToReadFile())) {
            return this.returnEmptyResponse(global, response);
        }

        return this.beginTransform(global, response);
    }

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

        pub fn fail(this: *HTMLRewriterLoader, err: JSC.Node.Syscall.Error) void {
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
                    this.fail(JSC.Node.Syscall.Error.oom);
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
            context: LOLHTMLContext,
            size_hint: ?usize,
            output: JSC.WebCore.Sink,
        ) ?[]const u8 {
            for (context.document_handlers.items) |doc| {
                doc.ctx = this;
            }
            for (context.element_handlers.items) |doc| {
                doc.ctx = this;
            }

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

        fn writeBytes(this: *HTMLRewriterLoader, bytes: bun.ByteList, comptime deinit_: bool) ?JSC.Node.Syscall.Error {
            this.rewriter.write(bytes.slice()) catch {
                return JSC.Node.Syscall.Error{
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
        rewriter: *LOLHTML.HTMLRewriter,
        context: LOLHTMLContext,
        response: *Response,
        input: JSC.WebCore.AnyBlob = undefined,
        pub fn init(context: LOLHTMLContext, global: *JSGlobalObject, original: *Response, builder: *LOLHTML.HTMLRewriter.Builder) JSValue {
            var result = bun.default_allocator.create(Response) catch unreachable;
            var sink = bun.default_allocator.create(BufferOutputSink) catch unreachable;
            sink.* = BufferOutputSink{
                .global = global,
                .bytes = bun.MutableString.initEmpty(bun.default_allocator),
                .rewriter = undefined,
                .context = context,
                .response = result,
            };

            for (sink.context.document_handlers.items) |doc| {
                doc.ctx = sink;
            }
            for (sink.context.element_handlers.items) |doc| {
                doc.ctx = sink;
            }
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
                bun.default_allocator.destroy(result);

                return throwLOLHTMLError(global);
            };

            result.* = Response{
                .allocator = bun.default_allocator,
                .body = .{
                    .init = .{
                        .status_code = 200,
                    },
                    .value = .{
                        .Locked = .{
                            .global = global,
                            .task = sink,
                        },
                    },
                },
            };

            result.body.init.headers = original.body.init.headers;
            result.body.init.method = original.body.init.method;
            result.body.init.status_code = original.body.init.status_code;

            result.url = bun.default_allocator.dupe(u8, original.url) catch unreachable;
            result.status_text = bun.default_allocator.dupe(u8, original.status_text) catch unreachable;

            var input = original.body.value.useAsAnyBlob();
            sink.input = input;

            const is_pending = input.needsToReadFile();
            defer if (!is_pending) input.detach();

            if (is_pending) {
                sink.input.Blob.doReadFileInternal(*BufferOutputSink, sink, onFinishedLoading, global);
            } else if (sink.runOutputSink(input.slice(), false, false)) |error_value| {
                return error_value;
            }

            // Hold off on cloning until we're actually done.
            return sink.response.toJS(sink.global);
        }

        pub fn onFinishedLoading(sink: *BufferOutputSink, bytes: JSC.WebCore.Blob.Store.ReadFile.ResultType) void {
            switch (bytes) {
                .err => |err| {
                    if (sink.response.body.value == .Locked and @ptrToInt(sink.response.body.value.Locked.task) == @ptrToInt(sink) and
                        sink.response.body.value.Locked.promise == null)
                    {
                        sink.response.body.value = .{ .Empty = {} };
                        // is there a pending promise?
                        // we will need to reject it
                    } else if (sink.response.body.value == .Locked and @ptrToInt(sink.response.body.value.Locked.task) == @ptrToInt(sink) and
                        sink.response.body.value.Locked.promise != null)
                    {
                        sink.response.body.value.Locked.onReceiveValue = null;
                        sink.response.body.value.Locked.task = null;
                    }

                    sink.response.body.value.toErrorInstance(err.toErrorInstance(sink.global), sink.global);
                    sink.rewriter.end() catch {};
                    sink.deinit();
                    return;
                },
                .result => |data| {
                    _ = sink.runOutputSink(data.buf, true, data.is_temporary);
                },
            }
        }

        pub fn runOutputSink(
            sink: *BufferOutputSink,
            bytes: []const u8,
            is_async: bool,
            free_bytes_on_end: bool,
        ) ?JSValue {
            defer if (free_bytes_on_end)
                bun.default_allocator.free(bun.constStrToU8(bytes));

            sink.bytes.growBy(bytes.len) catch unreachable;
            var global = sink.global;
            var response = sink.response;

            sink.rewriter.write(bytes) catch {
                sink.deinit();
                bun.default_allocator.destroy(sink);

                if (is_async) {
                    response.body.value.toErrorInstance(throwLOLHTMLError(global), global);

                    return null;
                } else {
                    return throwLOLHTMLError(global);
                }
            };

            sink.rewriter.end() catch {
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
            var bytes = this.bytes.toOwnedSliceLeaky();
            this.response.body.value = JSC.WebCore.Body.Value.createBlobValue(
                bytes,
                bun.default_allocator,

                true,
            );
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

            this.context.deinit(bun.default_allocator);
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
    //             .body = .{
    //                 .init = .{
    //                     .status_code = 200,
    //                 },
    //                 .value = .{
    //                     .Locked = .{
    //                         .global = global,
    //                         .task = sink,
    //                     },
    //                 },
    //             },
    //         };

    //         result.body.init.headers = original.body.init.headers;
    //         result.body.init.method = original.body.init.method;
    //         result.body.init.status_code = original.body.init.status_code;

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
    //             bun.default_allocator.free(bun.constStrToU8(bytes));

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
    ctx: ?*HTMLRewriter.BufferOutputSink = null,

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

    pub fn init(global: *JSGlobalObject, thisObject: JSValue, exception: JSC.C.ExceptionRef) DocumentHandler {
        var handler = DocumentHandler{
            .thisObject = thisObject,
            .global = global,
        };

        switch (thisObject.jsType()) {
            .Object, .ProxyObject, .Cell, .FinalObject => {},
            else => |kind| {
                JSC.throwInvalidArguments(
                    "Expected object but received {s}",
                    .{@as(string, @tagName(kind))},
                    global,
                    exception,
                );
                return undefined;
            },
        }

        if (thisObject.get(global, "doctype")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                JSC.throwInvalidArguments("doctype must be a function", .{}, global, exception);
                return undefined;
            }
            JSC.C.JSValueProtect(global, val.asObjectRef());
            handler.onDocTypeCallback = val;
        }

        if (thisObject.get(global, "comments")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                JSC.throwInvalidArguments("comments must be a function", .{}, global, exception);
                return undefined;
            }
            JSC.C.JSValueProtect(global, val.asObjectRef());
            handler.onCommentCallback = val;
        }

        if (thisObject.get(global, "text")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                JSC.throwInvalidArguments("text must be a function", .{}, global, exception);
                return undefined;
            }
            JSC.C.JSValueProtect(global, val.asObjectRef());
            handler.onTextCallback = val;
        }

        if (thisObject.get(global, "end")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                JSC.throwInvalidArguments("end must be a function", .{}, global, exception);
                return undefined;
            }
            JSC.C.JSValueProtect(global, val.asObjectRef());
            handler.onEndCallback = val;
        }

        JSC.C.JSValueProtect(global, thisObject.asObjectRef());
        return handler;
    }

    pub fn deinit(this: *DocumentHandler) void {
        if (this.onDocTypeCallback) |cb| {
            JSC.C.JSValueUnprotect(this.global, cb.asObjectRef());
            this.onDocTypeCallback = null;
        }

        if (this.onCommentCallback) |cb| {
            JSC.C.JSValueUnprotect(this.global, cb.asObjectRef());
            this.onCommentCallback = null;
        }

        if (this.onTextCallback) |cb| {
            JSC.C.JSValueUnprotect(this.global, cb.asObjectRef());
            this.onTextCallback = null;
        }

        if (this.onEndCallback) |cb| {
            JSC.C.JSValueUnprotect(this.global, cb.asObjectRef());
            this.onEndCallback = null;
        }

        JSC.C.JSValueUnprotect(this.global, this.thisObject.asObjectRef());
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

            // At the end of this scope, the value is no longer valid
            var args = [1]JSC.C.JSObjectRef{
                ZigType.Class.make(this.global, zig_element),
            };
            var result = JSC.C.JSObjectCallAsFunctionReturnValue(
                this.global,
                @field(this, callback_name).?.asObjectRef(),
                if (comptime @hasField(HandlerType, "thisObject"))
                    @field(this, "thisObject").asObjectRef()
                else
                    null,
                1,
                &args,
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
    ctx: ?*HTMLRewriter.BufferOutputSink = null,

    pub fn init(global: *JSGlobalObject, thisObject: JSValue, exception: JSC.C.ExceptionRef) ElementHandler {
        var handler = ElementHandler{
            .thisObject = thisObject,
            .global = global,
        };

        switch (thisObject.jsType()) {
            .Object, .ProxyObject, .Cell, .FinalObject => {},
            else => |kind| {
                JSC.throwInvalidArguments(
                    "Expected object but received {s}",
                    .{@as(string, @tagName(kind))},
                    global,
                    exception,
                );
                return undefined;
            },
        }

        if (thisObject.get(global, "element")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                JSC.throwInvalidArguments("element must be a function", .{}, global, exception);
                return undefined;
            }
            JSC.C.JSValueProtect(global, val.asObjectRef());
            handler.onElementCallback = val;
        }

        if (thisObject.get(global, "comments")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                JSC.throwInvalidArguments("comments must be a function", .{}, global, exception);
                return undefined;
            }
            JSC.C.JSValueProtect(global, val.asObjectRef());
            handler.onCommentCallback = val;
        }

        if (thisObject.get(global, "text")) |val| {
            if (val.isUndefinedOrNull() or !val.isCell() or !val.isCallable(global.vm())) {
                JSC.throwInvalidArguments("text must be a function", .{}, global, exception);
                return undefined;
            }
            JSC.C.JSValueProtect(global, val.asObjectRef());
            handler.onTextCallback = val;
        }

        JSC.C.JSValueProtect(global, thisObject.asObjectRef());
        return handler;
    }

    pub fn deinit(this: *ElementHandler) void {
        if (this.onElementCallback) |cb| {
            JSC.C.JSValueUnprotect(this.global, cb.asObjectRef());
            this.onElementCallback = null;
        }

        if (this.onCommentCallback) |cb| {
            JSC.C.JSValueUnprotect(this.global, cb.asObjectRef());
            this.onCommentCallback = null;
        }

        if (this.onTextCallback) |cb| {
            JSC.C.JSValueUnprotect(this.global, cb.asObjectRef());
            this.onTextCallback = null;
        }

        JSC.C.JSValueUnprotect(this.global, this.thisObject.asObjectRef());
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

const getterWrap = JSC.getterWrap;
const setterWrap = JSC.setterWrap;
const wrap = JSC.wrapSync;

pub fn free_html_writer_string(_: ?*anyopaque, ptr: ?*anyopaque, len: usize) callconv(.C) void {
    var str = LOLHTML.HTMLString{ .ptr = bun.cast([*]const u8, ptr.?), .len = len };
    str.deinit();
}

fn throwLOLHTMLError(global: *JSGlobalObject) JSValue {
    var err = LOLHTML.HTMLString.lastError();
    return ZigString.init(err.slice()).toErrorInstance(global);
}

fn htmlStringValue(input: LOLHTML.HTMLString, globalObject: *JSGlobalObject) JSValue {
    var str = ZigString.init(
        input.slice(),
    );
    str.detectEncoding();

    return str.toExternalValueWithCallback(
        globalObject,
        free_html_writer_string,
    );
}

pub const TextChunk = struct {
    text_chunk: ?*LOLHTML.TextChunk = null,

    pub const Class = NewClass(
        TextChunk,
        .{ .name = "TextChunk" },
        .{
            .before = .{
                .rfn = wrap(TextChunk, "before"),
            },
            .after = .{
                .rfn = wrap(TextChunk, "after"),
            },

            .replace = .{
                .rfn = wrap(TextChunk, "replace"),
            },

            .remove = .{
                .rfn = wrap(TextChunk, "remove"),
            },
            .finalize = finalize,
        },
        .{
            .removed = .{
                .get = getterWrap(TextChunk, "removed"),
            },
            .lastInTextNode = .{
                .get = getterWrap(TextChunk, "lastInTextNode"),
            },
            .text = .{
                .get = getterWrap(TextChunk, "getText"),
            },
        },
    );

    fn contentHandler(this: *TextChunk, comptime Callback: (fn (*LOLHTML.TextChunk, []const u8, bool) LOLHTML.Error!void), thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.text_chunk == null)
            return JSC.JSValue.jsUndefined();
        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.text_chunk.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return JSValue.fromRef(thisObject);
    }

    pub fn before(
        this: *TextChunk,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.before, thisObject, globalObject, content, contentOptions);
    }

    pub fn after(
        this: *TextChunk,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.after, thisObject, globalObject, content, contentOptions);
    }

    pub fn replace(
        this: *TextChunk,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.TextChunk.replace, thisObject, globalObject, content, contentOptions);
    }

    pub fn remove(this: *TextChunk, thisObject: js.JSObjectRef) JSValue {
        if (this.text_chunk == null)
            return JSC.JSValue.jsUndefined();
        this.text_chunk.?.remove();
        return JSValue.fromRef(thisObject);
    }

    pub fn getText(this: *TextChunk, global: *JSGlobalObject) JSValue {
        if (this.text_chunk == null)
            return JSC.JSValue.jsUndefined();
        return ZigString.init(this.text_chunk.?.getContent().slice()).withEncoding().toValueGC(global);
    }

    pub fn removed(this: *TextChunk, _: *JSGlobalObject) JSValue {
        return JSC.JSValue.jsBoolean(this.text_chunk.?.isRemoved());
    }

    pub fn lastInTextNode(this: *TextChunk, _: *JSGlobalObject) JSValue {
        return JSC.JSValue.jsBoolean(this.text_chunk.?.isLastInTextNode());
    }

    pub fn finalize(this: *TextChunk) void {
        this.text_chunk = null;
        bun.default_allocator.destroy(this);
    }
};

pub const DocType = struct {
    doctype: ?*LOLHTML.DocType = null,

    pub fn finalize(this: *DocType) void {
        this.doctype = null;
        bun.default_allocator.destroy(this);
    }

    pub const Class = NewClass(
        DocType,
        .{
            .name = "DocType",
        },
        .{
            .finalize = finalize,
        },
        .{
            .name = .{
                .get = getterWrap(DocType, "name"),
            },
            .systemId = .{
                .get = getterWrap(DocType, "systemId"),
            },

            .publicId = .{
                .get = getterWrap(DocType, "publicId"),
            },
        },
    );

    /// The doctype name.
    pub fn name(this: *DocType, global: *JSGlobalObject) JSValue {
        if (this.doctype == null)
            return JSC.JSValue.jsUndefined();
        const str = this.doctype.?.getName().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toValueGC(global);
    }

    pub fn systemId(this: *DocType, global: *JSGlobalObject) JSValue {
        if (this.doctype == null)
            return JSC.JSValue.jsUndefined();

        const str = this.doctype.?.getSystemId().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toValueGC(global);
    }

    pub fn publicId(this: *DocType, global: *JSGlobalObject) JSValue {
        if (this.doctype == null)
            return JSC.JSValue.jsUndefined();

        const str = this.doctype.?.getPublicId().slice();
        if (str.len == 0)
            return JSValue.jsNull();
        return ZigString.init(str).toValueGC(global);
    }
};

pub const DocEnd = struct {
    doc_end: ?*LOLHTML.DocEnd,

    pub fn finalize(this: *DocEnd) void {
        this.doc_end = null;
        bun.default_allocator.destroy(this);
    }

    pub const Class = NewClass(
        DocEnd,
        .{ .name = "DocEnd" },
        .{
            .finalize = finalize,
            .append = .{
                .rfn = wrap(DocEnd, "append"),
            },
        },
        .{},
    );

    fn contentHandler(this: *DocEnd, comptime Callback: (fn (*LOLHTML.DocEnd, []const u8, bool) LOLHTML.Error!void), thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.doc_end == null)
            return JSValue.jsNull();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.doc_end.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return JSValue.fromRef(thisObject);
    }

    pub fn append(
        this: *DocEnd,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.DocEnd.append, thisObject, globalObject, content, contentOptions);
    }
};

pub const Comment = struct {
    comment: ?*LOLHTML.Comment = null,

    pub fn finalize(this: *Comment) void {
        this.comment = null;
        bun.default_allocator.destroy(this);
    }

    pub const Class = NewClass(
        Comment,
        .{ .name = "Comment" },
        .{
            .before = .{
                .rfn = wrap(Comment, "before"),
            },
            .after = .{
                .rfn = wrap(Comment, "after"),
            },

            .replace = .{
                .rfn = wrap(Comment, "replace"),
            },

            .remove = .{
                .rfn = wrap(Comment, "remove"),
            },
            .finalize = finalize,
        },
        .{
            .removed = .{
                .get = getterWrap(Comment, "removed"),
            },
            .text = .{
                .get = getterWrap(Comment, "getText"),
                .set = setterWrap(Comment, "setText"),
            },
        },
    );

    fn contentHandler(this: *Comment, comptime Callback: (fn (*LOLHTML.Comment, []const u8, bool) LOLHTML.Error!void), thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.comment.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return JSValue.fromRef(thisObject);
    }

    pub fn before(
        this: *Comment,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.before, thisObject, globalObject, content, contentOptions);
    }

    pub fn after(
        this: *Comment,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.after, thisObject, globalObject, content, contentOptions);
    }

    pub fn replace(
        this: *Comment,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.Comment.replace, thisObject, globalObject, content, contentOptions);
    }

    pub fn remove(this: *Comment, thisObject: js.JSObjectRef) JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        this.comment.?.remove();
        return JSValue.fromRef(thisObject);
    }

    pub fn getText(this: *Comment, global: *JSGlobalObject) JSValue {
        if (this.comment == null)
            return JSValue.jsNull();
        return ZigString.init(this.comment.?.getText().slice()).withEncoding().toValueGC(global);
    }

    pub fn setText(
        this: *Comment,
        value: JSValue,
        exception: JSC.C.ExceptionRef,
        global: *JSGlobalObject,
    ) void {
        if (this.comment == null)
            return;
        var text = value.toSlice(global, bun.default_allocator);
        defer text.deinit();
        this.comment.?.setText(text.slice()) catch {
            exception.* = throwLOLHTMLError(global).asObjectRef();
        };
    }

    pub fn removed(this: *Comment, _: *JSGlobalObject) JSValue {
        if (this.comment == null)
            return JSC.JSValue.jsUndefined();
        return JSC.JSValue.jsBoolean(this.comment.?.isRemoved());
    }
};

pub const EndTag = struct {
    end_tag: ?*LOLHTML.EndTag,

    pub fn finalize(this: *EndTag) void {
        this.end_tag = null;
        bun.default_allocator.destroy(this);
    }

    pub const Handler = struct {
        callback: ?JSC.JSValue,
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

    pub const Class = NewClass(
        EndTag,
        .{ .name = "EndTag" },
        .{
            .before = .{
                .rfn = wrap(EndTag, "before"),
            },
            .after = .{
                .rfn = wrap(EndTag, "after"),
            },

            .remove = .{
                .rfn = wrap(EndTag, "remove"),
            },
            .finalize = finalize,
        },
        .{
            .name = .{
                .get = getterWrap(EndTag, "getName"),
                .set = setterWrap(EndTag, "setName"),
            },
        },
    );

    fn contentHandler(this: *EndTag, comptime Callback: (fn (*LOLHTML.EndTag, []const u8, bool) LOLHTML.Error!void), thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.end_tag == null)
            return JSValue.jsNull();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.end_tag.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return JSValue.fromRef(thisObject);
    }

    pub fn before(
        this: *EndTag,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.before, thisObject, globalObject, content, contentOptions);
    }

    pub fn after(
        this: *EndTag,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.after, thisObject, globalObject, content, contentOptions);
    }

    pub fn replace(
        this: *EndTag,
        thisObject: js.JSObjectRef,
        globalObject: *JSGlobalObject,
        content: ZigString,
        contentOptions: ?ContentOptions,
    ) JSValue {
        return this.contentHandler(LOLHTML.EndTag.replace, thisObject, globalObject, content, contentOptions);
    }

    pub fn remove(this: *EndTag, thisObject: js.JSObjectRef) JSValue {
        if (this.end_tag == null)
            return JSC.JSValue.jsUndefined();

        this.end_tag.?.remove();
        return JSValue.fromRef(thisObject);
    }

    pub fn getName(this: *EndTag, global: *JSGlobalObject) JSValue {
        if (this.end_tag == null)
            return JSC.JSValue.jsUndefined();

        return ZigString.init(this.end_tag.?.getName().slice()).withEncoding().toValueGC(global);
    }

    pub fn setName(
        this: *EndTag,
        value: JSValue,
        exception: JSC.C.ExceptionRef,
        global: *JSGlobalObject,
    ) void {
        if (this.end_tag == null)
            return;
        var text = value.toSlice(global, bun.default_allocator);
        defer text.deinit();
        this.end_tag.?.setName(text.slice()) catch {
            exception.* = throwLOLHTMLError(global).asObjectRef();
        };
    }
};

pub const AttributeIterator = struct {
    iterator: ?*LOLHTML.Attribute.Iterator = null,

    const attribute_iterator_path: string = "file:///bun-vfs/lolhtml/AttributeIterator.js";
    const attribute_iterator_code: string =
        \\"use strict";
        \\
        \\class AttributeIterator {
        \\  constructor(internal) {
        \\    this.#iterator = internal;
        \\  }
        \\
        \\  #iterator;
        \\
        \\  [Symbol.iterator]() {
        \\     return this;
        \\  }
        \\
        \\  next() {
        \\     if (this.#iterator === null)
        \\          return {done: true};
        \\     var value = this.#iterator.next();
        \\     if (!value) {
        \\         this.#iterator = null;
        \\         return {done: true};
        \\     }
        \\     return {done: false, value: value};
        \\  }
        \\}
        \\
        \\return new AttributeIterator(internal1);
    ;
    threadlocal var attribute_iterator_class: JSC.C.JSObjectRef = undefined;
    threadlocal var attribute_iterator_loaded: bool = false;

    pub fn getAttributeIteratorJSClass(global: *JSGlobalObject) JSValue {
        if (attribute_iterator_loaded)
            return JSC.JSValue.fromRef(attribute_iterator_class);
        attribute_iterator_loaded = true;
        var exception_ptr: ?[*]JSC.JSValueRef = null;
        var name = JSC.C.JSStringCreateStatic("AttributeIteratorGetter", "AttributeIteratorGetter".len);
        var param_name = JSC.C.JSStringCreateStatic("internal1", "internal1".len);
        var attribute_iterator_class_ = JSC.C.JSObjectMakeFunction(
            global,
            name,
            1,
            &[_]JSC.C.JSStringRef{param_name},
            JSC.C.JSStringCreateStatic(attribute_iterator_code.ptr, attribute_iterator_code.len),
            JSC.C.JSStringCreateStatic(attribute_iterator_path.ptr, attribute_iterator_path.len),
            0,
            exception_ptr,
        );
        JSC.C.JSValueProtect(global, attribute_iterator_class_);
        attribute_iterator_class = attribute_iterator_class_;
        return JSC.JSValue.fromRef(attribute_iterator_class);
    }

    pub fn finalize(this: *AttributeIterator) void {
        if (this.iterator) |iter| {
            iter.deinit();
            this.iterator = null;
        }
        bun.default_allocator.destroy(this);
    }

    pub const Class = NewClass(
        AttributeIterator,
        .{ .name = "AttributeIterator" },
        .{
            .next = .{
                .rfn = wrap(AttributeIterator, "next"),
            },
            .finalize = finalize,
        },
        .{},
    );

    const value_ = ZigString.init("value");
    const done_ = ZigString.init("done");
    pub fn next(
        this: *AttributeIterator,
        globalObject: *JSGlobalObject,
    ) JSValue {
        if (this.iterator == null) {
            return JSC.JSValue.jsNull();
        }

        var attribute = this.iterator.?.next() orelse {
            this.iterator.?.deinit();
            this.iterator = null;
            return JSC.JSValue.jsNull();
        };

        // TODO: don't clone here
        const value = attribute.value();
        const name = attribute.name();
        defer name.deinit();
        defer value.deinit();

        var strs = [2]ZigString{
            ZigString.init(name.slice()),
            ZigString.init(value.slice()),
        };

        var valid_strs: []ZigString = strs[0..2];

        var array = JSC.JSValue.createStringArray(
            globalObject,
            valid_strs.ptr,
            valid_strs.len,
            true,
        );

        return array;
    }
};
pub const Element = struct {
    element: ?*LOLHTML.Element = null,

    pub const Class = NewClass(
        Element,
        .{ .name = "Element" },
        .{
            .getAttribute = .{
                .rfn = wrap(Element, "getAttribute"),
            },
            .hasAttribute = .{
                .rfn = wrap(Element, "hasAttribute"),
            },
            .setAttribute = .{
                .rfn = wrap(Element, "setAttribute"),
            },
            .removeAttribute = .{
                .rfn = wrap(Element, "removeAttribute"),
            },
            .before = .{
                .rfn = wrap(Element, "before"),
            },
            .after = .{
                .rfn = wrap(Element, "after"),
            },
            .prepend = .{
                .rfn = wrap(Element, "prepend"),
            },
            .append = .{
                .rfn = wrap(Element, "append"),
            },
            .replace = .{
                .rfn = wrap(Element, "replace"),
            },
            .setInnerContent = .{
                .rfn = wrap(Element, "setInnerContent"),
            },
            .remove = .{
                .rfn = wrap(Element, "remove"),
            },
            .removeAndKeepContent = .{
                .rfn = wrap(Element, "removeAndKeepContent"),
            },
            .onEndTag = .{
                .rfn = wrap(Element, "onEndTag"),
            },
            .finalize = finalize,
        },
        .{
            .tagName = .{
                .get = getterWrap(Element, "getTagName"),
                .set = setterWrap(Element, "setTagName"),
            },
            .removed = .{
                .get = getterWrap(Element, "getRemoved"),
            },
            .namespaceURI = .{
                .get = getterWrap(Element, "getNamespaceURI"),
            },
            .attributes = .{
                .get = getterWrap(Element, "getAttributes"),
            },
        },
    );

    pub fn finalize(this: *Element) void {
        this.element = null;
        bun.default_allocator.destroy(this);
    }

    pub fn onEndTag(
        this: *Element,
        globalObject: *JSGlobalObject,
        function: JSValue,
        thisObject: JSC.C.JSObjectRef,
    ) JSValue {
        if (this.element == null)
            return JSValue.jsNull();
        if (function.isUndefinedOrNull() or !function.isCallable(globalObject.vm())) {
            return ZigString.init("Expected a function").withEncoding().toValueGC(globalObject);
        }

        var end_tag_handler = bun.default_allocator.create(EndTag.Handler) catch unreachable;
        end_tag_handler.* = .{ .global = globalObject, .callback = function };

        this.element.?.onEndTag(EndTag.Handler.onEndTagHandler, end_tag_handler) catch {
            bun.default_allocator.destroy(end_tag_handler);
            return throwLOLHTMLError(globalObject);
        };

        JSC.C.JSValueProtect(globalObject.ref(), function.asObjectRef());
        return JSValue.fromRef(thisObject);
    }

    //     // fn wrap(comptime name: string)

    ///  Returns the value for a given attribute name: ZigString on the element, or null if it is not found.
    pub fn getAttribute(this: *Element, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsNull();

        var slice = name.toSlice(bun.default_allocator);
        defer slice.deinit();
        var attr = this.element.?.getAttribute(slice.slice()).slice();

        if (attr.len == 0)
            return JSC.JSValue.jsNull();

        var str = ZigString.init(
            attr,
        );

        return str.toExternalValueWithCallback(
            globalObject,
            free_html_writer_string,
        );
    }

    /// Returns a boolean indicating whether an attribute exists on the element.
    pub fn hasAttribute(this: *Element, global: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsBoolean(false);

        var slice = name.toSlice(bun.default_allocator);
        defer slice.deinit();
        return JSValue.jsBoolean(this.element.?.hasAttribute(slice.slice()) catch return throwLOLHTMLError(global));
    }

    /// Sets an attribute to a provided value, creating the attribute if it does not exist.
    pub fn setAttribute(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, name_: ZigString, value_: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        var name_slice = name_.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        var value_slice = value_.toSlice(bun.default_allocator);
        defer value_slice.deinit();
        this.element.?.setAttribute(name_slice.slice(), value_slice.slice()) catch return throwLOLHTMLError(globalObject);
        return JSValue.fromRef(thisObject);
    }

    ///  Removes the attribute.
    pub fn removeAttribute(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, name: ZigString) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        var name_slice = name.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        this.element.?.removeAttribute(
            name_slice.slice(),
        ) catch return throwLOLHTMLError(globalObject);
        return JSValue.fromRef(thisObject);
    }

    fn contentHandler(this: *Element, comptime Callback: (fn (*LOLHTML.Element, []const u8, bool) LOLHTML.Error!void), thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        var content_slice = content.toSlice(bun.default_allocator);
        defer content_slice.deinit();

        Callback(
            this.element.?,
            content_slice.slice(),
            contentOptions != null and contentOptions.?.html,
        ) catch return throwLOLHTMLError(globalObject);

        return JSValue.fromRef(thisObject);
    }

    ///  Inserts content before the element.
    pub fn before(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.before,
            thisObject,
            globalObject,
            content,
            contentOptions,
        );
    }

    ///  Inserts content right after the element.
    pub fn after(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.after,
            thisObject,
            globalObject,
            content,
            contentOptions,
        );
    }

    /// Inserts content right after the start tag of the element.
    pub fn prepend(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.prepend,
            thisObject,
            globalObject,
            content,
            contentOptions,
        );
    }

    ///  Inserts content right before the end tag of the element.
    pub fn append(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.append,
            thisObject,
            globalObject,
            content,
            contentOptions,
        );
    }

    /// Removes the element and inserts content in place of it.
    pub fn replace(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.replace,
            thisObject,
            globalObject,
            content,
            contentOptions,
        );
    }

    ///  Replaces content of the element.
    pub fn setInnerContent(this: *Element, thisObject: js.JSObjectRef, globalObject: *JSGlobalObject, content: ZigString, contentOptions: ?ContentOptions) JSValue {
        return contentHandler(
            this,
            LOLHTML.Element.setInnerContent,
            thisObject,
            globalObject,
            content,
            contentOptions,
        );
    }

    ///  Removes the element with all its content.
    pub fn remove(this: *Element, thisObject: js.JSObjectRef) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        this.element.?.remove();
        return JSValue.fromRef(thisObject);
    }

    ///  Removes the start tag and end tag of the element but keeps its inner content intact.
    pub fn removeAndKeepContent(this: *Element, thisObject: js.JSObjectRef) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        this.element.?.removeAndKeepContent();
        return JSValue.fromRef(thisObject);
    }

    pub fn getTagName(this: *Element, globalObject: *JSGlobalObject) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        return htmlStringValue(this.element.?.tagName(), globalObject);
    }

    pub fn setTagName(this: *Element, value: JSValue, exception: JSC.C.ExceptionRef, global: *JSGlobalObject) void {
        if (this.element == null)
            return;

        var text = value.toSlice(global, bun.default_allocator);
        defer text.deinit();

        this.element.?.setTagName(text.slice()) catch {
            exception.* = throwLOLHTMLError(global).asObjectRef();
        };
    }

    pub fn getRemoved(this: *Element, _: *JSGlobalObject) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();
        return JSC.JSValue.jsBoolean(this.element.?.isRemoved());
    }

    pub fn getNamespaceURI(this: *Element, globalObject: *JSGlobalObject) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        return ZigString.init(std.mem.span(this.element.?.namespaceURI())).toValueGC(globalObject);
    }

    pub fn getAttributes(this: *Element, globalObject: *JSGlobalObject) JSValue {
        if (this.element == null)
            return JSValue.jsUndefined();

        var iter = this.element.?.attributes() orelse return throwLOLHTMLError(globalObject);
        var attr_iter = bun.default_allocator.create(AttributeIterator) catch unreachable;
        attr_iter.* = .{ .iterator = iter };
        var attr = AttributeIterator.Class.make(globalObject.ref(), attr_iter);
        JSC.C.JSValueProtect(globalObject.ref(), attr);
        defer JSC.C.JSValueUnprotect(globalObject.ref(), attr);
        return JSC.JSValue.fromRef(
            JSC.C.JSObjectCallAsFunction(
                globalObject.ref(),
                AttributeIterator.getAttributeIteratorJSClass(globalObject).asObjectRef(),
                null,
                1,
                @ptrCast([*]JSC.C.JSObjectRef, &attr),
                null,
            ),
        );
    }
};
