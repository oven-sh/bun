const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const bun = @import("../../../global.zig");
const RequestContext = @import("../../../http.zig").RequestContext;
const MimeType = @import("../../../http.zig").MimeType;
const ZigURL = @import("../../../url.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;

const JSC = @import("../../../jsc.zig");
const js = JSC.C;

const Method = @import("../../../http/method.zig").Method;

const ObjectPool = @import("../../../pool.zig").ObjectPool;

const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const strings = @import("../../../global.zig").strings;
const string = @import("../../../global.zig").string;
const default_allocator = @import("../../../global.zig").default_allocator;
const FeatureFlags = @import("../../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../../env.zig");
const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = @import("../javascript.zig").Task;
const JSPrinter = @import("../../../js_printer.zig");
const picohttp = @import("picohttp");
const StringJoiner = @import("../../../string_joiner.zig");
pub const Response = struct {
    pub const Class = NewClass(
        Response,
        .{ .name = "Response" },
        .{
            .@"constructor" = constructor,
            .@"finalize" = finalize,
            .@"text" = .{
                .rfn = Response.getText,
                .ts = d.ts{},
            },
            .@"json" = .{
                .rfn = Response.getJSON,
                .ts = d.ts{},
            },
            .@"arrayBuffer" = .{
                .rfn = Response.getArrayBuffer,
                .ts = d.ts{},
            },
            .@"blob" = .{
                .rfn = Response.getBlob,
                .ts = d.ts{},
            },

            .@"clone" = .{
                .rfn = doClone,
                .ts = d.ts{},
            },
        },
        .{
            .@"url" = .{
                .@"get" = getURL,
                .ro = true,
            },

            .@"ok" = .{
                .@"get" = getOK,
                .ro = true,
            },
            .@"status" = .{
                .@"get" = getStatus,
                .ro = true,
            },
            .@"statusText" = .{
                .@"get" = getStatusText,
                .ro = true,
            },
            .@"headers" = .{
                .@"get" = getHeaders,
                .ro = true,
            },
            .@"bodyUsed" = .{
                .@"get" = getBodyUsed,
                .ro = true,
            },
        },
    );

    allocator: std.mem.Allocator,
    body: Body,
    url: string = "",
    status_text: string = "",
    redirected: bool = false,

    pub const Props = struct {};

    pub fn writeFormat(this: *const Response, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);
        try formatter.writeIndent(Writer, writer);
        try writer.print("Response ({}) {{\n", .{bun.fmt.size(this.body.len())});
        {
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("ok: ");
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.isOK()), .BooleanObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try this.body.writeFormat(formatter, writer, enable_ansi_colors);

            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("url: \"");
            try writer.print(comptime Output.prettyFmt("<r><b>{s}<r>", enable_ansi_colors), .{this.url});
            try writer.writeAll("\"");
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("statusText: ");
            try JSPrinter.writeJSONString(this.status_text, Writer, writer, false);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("redirected: ");
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.redirected), .BooleanObject, enable_ansi_colors);
        }
        try writer.writeAll("\n");
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
    }

    pub fn isOK(this: *const Response) bool {
        return this.body.init.status_code == 304 or (this.body.init.status_code >= 200 and this.body.init.status_code <= 299);
    }

    pub fn getURL(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return ZigString.init(this.url).withEncoding().toValueGC(ctx.ptr()).asObjectRef();
    }

    pub fn getBodyUsed(
        this: *Response,
        _: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return JSC.JSValue.jsBoolean(this.body.value == .Used).asRef();
    }

    pub fn getStatusText(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return ZigString.init(this.status_text).withEncoding().toValueGC(ctx.ptr()).asObjectRef();
    }

    pub fn getOK(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        return js.JSValueMakeBoolean(ctx, this.isOK());
    }

    pub fn getHeaders(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.body.init.headers == null) {
            this.body.init.headers = Headers.RefCountedHeaders.init(Headers.empty(getAllocator(ctx)), getAllocator(ctx)) catch unreachable;
        }

        return Headers.Class.make(ctx, this.body.init.headers.?.getRef());
    }

    pub fn doClone(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var cloned = this.clone(getAllocator(ctx));
        return Response.Class.make(ctx, cloned);
    }

    pub fn cloneInto(this: *const Response, new_response: *Response, allocator: std.mem.Allocator) void {
        new_response.* = Response{
            .allocator = allocator,
            .body = this.body.clone(allocator),
            .url = allocator.dupe(u8, this.url) catch unreachable,
            .status_text = allocator.dupe(u8, this.status_text) catch unreachable,
            .redirected = this.redirected,
        };
    }

    pub fn clone(this: *const Response, allocator: std.mem.Allocator) *Response {
        var new_response = allocator.create(Response) catch unreachable;
        this.cloneInto(new_response, allocator);
        return new_response;
    }

    pub usingnamespace BlobInterface(@This());

    pub fn getStatus(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        return js.JSValueMakeNumber(ctx, @intToFloat(f64, this.body.init.status_code));
    }

    pub fn finalize(
        this: *Response,
    ) void {
        this.body.deinit(this.allocator);

        var allocator = this.allocator;

        if (this.status_text.len > 0) {
            allocator.free(this.status_text);
        }

        if (this.url.len > 0) {
            allocator.free(this.url);
        }

        allocator.destroy(this);
    }

    pub fn mimeType(response: *const Response, request_ctx_: ?*const RequestContext) string {
        return mimeTypeWithDefault(response, MimeType.other, request_ctx_);
    }

    pub fn mimeTypeWithDefault(response: *const Response, default: MimeType, request_ctx_: ?*const RequestContext) string {
        if (response.body.init.headers) |headers_ref| {
            var headers = headers_ref.get();
            defer headers_ref.deref();
            // Remember, we always lowercase it
            // hopefully doesn't matter here tho
            if (headers.getHeaderIndex("content-type")) |content_type| {
                return headers.asStr(headers.entries.items(.value)[content_type]);
            }
        }

        if (request_ctx_) |request_ctx| {
            if (request_ctx.url.extname.len > 0) {
                return MimeType.byExtension(request_ctx.url.extname).value;
            }
        }

        switch (response.body.value) {
            .Blob => |blob| {
                if (blob.content_type.len > 0) {
                    return blob.content_type;
                }

                return default.value;
            },
            .Used, .Locked, .Empty => return default.value,
        }
    }

    pub fn constructor(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        const body: Body = brk: {
            switch (arguments.len) {
                0 => {
                    break :brk Body.@"200"(ctx);
                },
                1 => {
                    break :brk Body.extract(ctx, arguments[0], exception);
                },
                else => {
                    if (js.JSValueGetType(ctx, arguments[1]) == js.JSType.kJSTypeObject) {
                        break :brk Body.extractWithInit(ctx, arguments[0], arguments[1], exception);
                    } else {
                        break :brk Body.extract(ctx, arguments[0], exception);
                    }
                },
            }
            unreachable;
        };

        var response = getAllocator(ctx).create(Response) catch unreachable;
        response.* = Response{
            .body = body,
            .allocator = getAllocator(ctx),
            .url = "",
        };
        return Response.Class.make(
            ctx,
            response,
        );
    }
};

pub const Fetch = struct {
    const headers_string = "headers";
    const method_string = "method";

    var fetch_body_string: MutableString = undefined;
    var fetch_body_string_loaded = false;

    const JSType = js.JSType;

    const fetch_error_no_args = "fetch() expects a string but received no arguments.";
    const fetch_error_blank_url = "fetch() URL must not be a blank string.";
    const JSTypeErrorEnum = std.enums.EnumArray(JSType, string);
    const fetch_type_error_names: JSTypeErrorEnum = brk: {
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

    const fetch_type_error_string_values = .{
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeUndefined)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNull)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeBoolean)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNumber)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeString)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeObject)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeSymbol)}),
    };

    const fetch_type_error_strings: JSTypeErrorEnum = brk: {
        var errors = JSTypeErrorEnum.initUndefined();
        errors.set(
            JSType.kJSTypeUndefined,
            std.mem.span(fetch_type_error_string_values[0]),
        );
        errors.set(
            JSType.kJSTypeNull,
            std.mem.span(fetch_type_error_string_values[1]),
        );
        errors.set(
            JSType.kJSTypeBoolean,
            std.mem.span(fetch_type_error_string_values[2]),
        );
        errors.set(
            JSType.kJSTypeNumber,
            std.mem.span(fetch_type_error_string_values[3]),
        );
        errors.set(
            JSType.kJSTypeString,
            std.mem.span(fetch_type_error_string_values[4]),
        );
        errors.set(
            JSType.kJSTypeObject,
            std.mem.span(fetch_type_error_string_values[5]),
        );
        errors.set(
            JSType.kJSTypeSymbol,
            std.mem.span(fetch_type_error_string_values[6]),
        );
        break :brk errors;
    };

    pub const Class = NewClass(
        void,
        .{ .name = "fetch" },
        .{
            .@"call" = .{
                .rfn = Fetch.call,
                .ts = d.ts{},
            },
        },
        .{},
    );

    const fetch_error_cant_fetch_same_origin = "fetch to same-origin on the server is not supported yet - sorry! (it would just hang forever)";

    pub const FetchTasklet = struct {
        promise: *JSInternalPromise = undefined,
        http: HTTPClient.AsyncHTTP = undefined,
        status: Status = Status.pending,
        javascript_vm: *VirtualMachine = undefined,
        global_this: *JSGlobalObject = undefined,

        empty_request_body: MutableString = undefined,
        // pooled_body: *BodyPool.Node = undefined,
        this_object: js.JSObjectRef = null,
        resolve: js.JSObjectRef = null,
        reject: js.JSObjectRef = null,
        context: FetchTaskletContext = undefined,
        response_buffer: MutableString = undefined,

        blob_store: ?*Blob.Store = null,

        const Pool = ObjectPool(FetchTasklet, init, true, 32);
        const BodyPool = ObjectPool(MutableString, MutableString.init2048, true, 8);
        pub const FetchTaskletContext = struct {
            tasklet: *FetchTasklet,
        };

        pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet {
            return FetchTasklet{};
        }

        pub const Status = enum(u8) {
            pending,
            running,
            done,
        };

        pub fn onDone(this: *FetchTasklet) void {
            var args = [1]js.JSValueRef{undefined};

            var callback_object = switch (this.http.state.load(.Monotonic)) {
                .success => this.resolve,
                .fail => this.reject,
                else => unreachable,
            };

            args[0] = switch (this.http.state.load(.Monotonic)) {
                .success => this.onResolve().asObjectRef(),
                .fail => this.onReject().asObjectRef(),
                else => unreachable,
            };

            _ = js.JSObjectCallAsFunction(this.global_this.ref(), callback_object, null, 1, &args, null);

            this.release();
        }

        pub fn reset(_: *FetchTasklet) void {}

        pub fn release(this: *FetchTasklet) void {
            js.JSValueUnprotect(this.global_this.ref(), this.resolve);
            js.JSValueUnprotect(this.global_this.ref(), this.reject);
            js.JSValueUnprotect(this.global_this.ref(), this.this_object);

            this.global_this = undefined;
            this.javascript_vm = undefined;
            this.promise = undefined;
            this.status = Status.pending;
            // var pooled = this.pooled_body;
            // BodyPool.release(pooled);
            // this.pooled_body = undefined;
            this.http = undefined;
            this.this_object = null;
            this.resolve = null;
            this.reject = null;
            Pool.release(@fieldParentPtr(Pool.Node, "data", this));
        }

        pub const FetchResolver = struct {
            pub fn call(
                _: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                _: usize,
                arguments: [*c]const js.JSValueRef,
                _: js.ExceptionRef,
            ) callconv(.C) js.JSObjectRef {
                return JSPrivateDataPtr.from(js.JSObjectGetPrivate(arguments[0]))
                    .get(FetchTaskletContext).?.tasklet.onResolve().asObjectRef();
                //  return  js.JSObjectGetPrivate(arguments[0]).? .tasklet.onResolve().asObjectRef();
            }
        };

        pub const FetchRejecter = struct {
            pub fn call(
                _: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                _: usize,
                arguments: [*c]const js.JSValueRef,
                _: js.ExceptionRef,
            ) callconv(.C) js.JSObjectRef {
                return JSPrivateDataPtr.from(js.JSObjectGetPrivate(arguments[0]))
                    .get(FetchTaskletContext).?.tasklet.onReject().asObjectRef();
            }
        };

        pub fn onReject(this: *FetchTasklet) JSValue {
            if (this.blob_store) |store| {
                store.deref();
            }
            const fetch_error = std.fmt.allocPrint(
                default_allocator,
                "fetch() failed – {s}\nurl: \"{s}\"",
                .{
                    @errorName(this.http.err orelse error.HTTPFail),
                    this.http.url.href,
                },
            ) catch unreachable;
            return ZigString.init(fetch_error).toErrorInstance(this.global_this);
        }

        pub fn onResolve(this: *FetchTasklet) JSValue {
            var allocator = default_allocator;
            var http_response = this.http.response.?;
            var response = allocator.create(Response) catch unreachable;
            if (this.blob_store) |store| {
                store.deref();
            }
            response.* = Response{
                .allocator = allocator,
                .url = allocator.dupe(u8, this.http.url.href) catch unreachable,
                .status_text = allocator.dupe(u8, http_response.status) catch unreachable,
                .redirected = this.http.redirect_count > 0,
                .body = .{
                    .init = .{
                        .headers = Headers.RefCountedHeaders.init(
                            Headers.fromPicoHeaders(allocator, http_response.headers) catch unreachable,
                            allocator,
                        ) catch unreachable,
                        .status_code = @truncate(u16, http_response.status_code),
                    },
                    .value = .{
                        .Blob = Blob.init(this.http.response_buffer.toOwnedSliceLeaky(), allocator, this.global_this),
                    },
                },
            };
            return JSValue.fromRef(Response.Class.make(@ptrCast(js.JSContextRef, this.global_this), response));
        }

        pub fn get(
            allocator: std.mem.Allocator,
            method: Method,
            url: ZigURL,
            headers: Headers.Entries,
            headers_buf: string,
            request_body: ?*MutableString,
            timeout: usize,
            request_body_store: ?*Blob.Store,
        ) !*FetchTasklet.Pool.Node {
            var linked_list = FetchTasklet.Pool.get(allocator);
            linked_list.data.javascript_vm = VirtualMachine.vm;
            linked_list.data.empty_request_body = MutableString.init(allocator, 0) catch unreachable;
            // linked_list.data.pooled_body = BodyPool.get(allocator);
            linked_list.data.blob_store = request_body_store;
            linked_list.data.response_buffer = MutableString.initEmpty(allocator);
            linked_list.data.http = try HTTPClient.AsyncHTTP.init(
                allocator,
                method,
                url,
                headers,
                headers_buf,
                &linked_list.data.response_buffer,
                request_body orelse &linked_list.data.empty_request_body,

                timeout,
            );
            linked_list.data.context = .{ .tasklet = &linked_list.data };

            return linked_list;
        }

        pub fn queue(
            allocator: std.mem.Allocator,
            global: *JSGlobalObject,
            method: Method,
            url: ZigURL,
            headers: Headers.Entries,
            headers_buf: string,
            request_body: ?*MutableString,
            timeout: usize,
            request_body_store: ?*Blob.Store,
        ) !*FetchTasklet.Pool.Node {
            var node = try get(allocator, method, url, headers, headers_buf, request_body, timeout, request_body_store);
            node.data.promise = JSInternalPromise.create(global);

            node.data.global_this = global;
            node.data.http.callback = callback;
            var batch = NetworkThread.Batch{};
            node.data.http.schedule(allocator, &batch);
            NetworkThread.global.pool.schedule(batch);
            VirtualMachine.vm.active_tasks +|= 1;
            return node;
        }

        pub fn callback(http_: *HTTPClient.AsyncHTTP) void {
            var task: *FetchTasklet = @fieldParentPtr(FetchTasklet, "http", http_);
            @atomicStore(Status, &task.status, Status.done, .Monotonic);
            task.javascript_vm.eventLoop().enqueueTaskConcurrent(Task.init(task));
        }
    };

    pub fn call(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        var globalThis = ctx.ptr();

        if (arguments.len == 0) {
            const fetch_error = fetch_error_no_args;
            return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
        }

        var headers: ?Headers = null;
        var body: MutableString = MutableString.initEmpty(bun.default_allocator);
        var method = Method.GET;
        var args = JSC.Node.ArgumentsSlice.from(arguments);
        var url: ZigURL = undefined;
        var first_arg = args.nextEat().?;
        var blob_store: ?*Blob.Store = null;
        if (first_arg.isString()) {
            var url_zig_str = ZigString.init("");
            JSValue.fromRef(arguments[0]).toZigString(&url_zig_str, globalThis);
            var url_str = url_zig_str.slice();

            if (url_str.len == 0) {
                const fetch_error = fetch_error_blank_url;
                return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
            }

            if (url_str[0] == '/') {
                url_str = strings.append(getAllocator(ctx), VirtualMachine.vm.bundler.options.origin.origin, url_str) catch unreachable;
            } else {
                url_str = getAllocator(ctx).dupe(u8, url_str) catch unreachable;
            }

            NetworkThread.init() catch @panic("Failed to start network thread");
            url = ZigURL.parse(url_str);

            if (arguments.len >= 2 and js.JSValueIsObject(ctx, arguments[1])) {
                var options = JSValue.fromRef(arguments[1]);
                if (options.get(ctx.ptr(), "method")) |method_| {
                    var slice_ = method_.toSlice(ctx.ptr(), getAllocator(ctx));
                    defer slice_.deinit();
                    method = Method.which(slice_.slice()) orelse .GET;
                }

                if (options.get(ctx.ptr(), "headers")) |headers_| {
                    var headers2: Headers = undefined;
                    if (headers_.as(Headers.RefCountedHeaders)) |headers__| {
                        headers__.leak().clone(&headers2) catch unreachable;
                        headers = headers2;
                    } else if (Headers.JS.headersInit(ctx, headers_.asObjectRef()) catch null) |headers__| {
                        headers__.clone(&headers2) catch unreachable;
                        headers = headers2;
                    }
                }

                if (options.get(ctx.ptr(), "body")) |body__| {
                    if (Blob.fromJS(ctx.ptr(), body__, true)) |new_blob| {
                        if (new_blob.size > 0) {
                            body = MutableString{
                                .list = std.ArrayListUnmanaged(u8){
                                    .items = bun.constStrToU8(new_blob.sharedView()),
                                    .capacity = new_blob.size,
                                },
                                .allocator = bun.default_allocator,
                            };
                            blob_store = new_blob.store;
                        }
                        // transfer is unnecessary here because this is a new slice
                        //new_blob.transfer();
                    } else |_| {
                        return JSPromise.rejectedPromiseValue(globalThis, ZigString.init("fetch() received invalid body").toErrorInstance(globalThis)).asRef();
                    }
                }
            }
        } else if (Request.Class.loaded and first_arg.as(Request) != null) {
            var request = first_arg.as(Request).?;
            url = ZigURL.parse(request.url.dupe(getAllocator(ctx)) catch unreachable);
            method = request.method;
            if (request.headers) |head| {
                var for_clone: Headers = undefined;
                head.leak().clone(&for_clone) catch unreachable;
                headers = for_clone;
            }
            var blob = request.body.use();
            // TODO: make RequestBody _NOT_ a MutableString
            body = MutableString{
                .list = std.ArrayListUnmanaged(u8){
                    .items = bun.constStrToU8(blob.sharedView()),
                    .capacity = bun.constStrToU8(blob.sharedView()).len,
                },
                .allocator = blob.allocator orelse bun.default_allocator,
            };
            blob_store = blob.store;
        } else {
            const fetch_error = fetch_type_error_strings.get(js.JSValueGetType(ctx, arguments[0]));
            return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
        }

        if (url.origin.len > 0 and strings.eql(url.origin, VirtualMachine.vm.bundler.options.origin.origin)) {
            const fetch_error = fetch_error_cant_fetch_same_origin;
            return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
        }

        var header_entries: Headers.Entries = .{};
        var header_buf: string = "";

        if (headers) |head| {
            header_entries = head.entries;
            header_buf = head.buf.items;
        }
        var resolve = js.JSObjectMakeFunctionWithCallback(ctx, null, Fetch.FetchTasklet.FetchResolver.call);
        var reject = js.JSObjectMakeFunctionWithCallback(ctx, null, Fetch.FetchTasklet.FetchRejecter.call);

        js.JSValueProtect(ctx, resolve);
        js.JSValueProtect(ctx, reject);

        var request_body: ?*MutableString = null;
        if (body.list.items.len > 0) {
            var mutable = bun.default_allocator.create(MutableString) catch unreachable;
            mutable.* = body;
            request_body = mutable;
        }

        // var resolve = FetchTasklet.FetchResolver.Class.make(ctx: js.JSContextRef, ptr: *ZigType)
        var queued = FetchTasklet.queue(
            default_allocator,
            globalThis,
            method,
            url,
            header_entries,
            header_buf,
            request_body,
            std.time.ns_per_hour,
            blob_store,
        ) catch unreachable;
        queued.data.this_object = js.JSObjectMake(ctx, null, JSPrivateDataPtr.from(&queued.data.context).ptr());
        js.JSValueProtect(ctx, queued.data.this_object);

        var promise = js.JSObjectMakeDeferredPromise(ctx, &resolve, &reject, exception);
        queued.data.reject = reject;
        queued.data.resolve = resolve;

        return promise;
        // queued.data.promise.create(globalThis: *JSGlobalObject)
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Headers
pub const Headers = struct {
    pub usingnamespace HTTPClient.Headers;
    entries: Headers.Entries = .{},
    buf: std.ArrayListUnmanaged(u8) = .{},
    allocator: std.mem.Allocator,
    guard: Guard = Guard.none,

    pub const RefCountedHeaders = bun.RefCount(Headers, true);

    pub fn deinit(
        headers: *Headers,
    ) void {
        headers.buf.deinit(headers.allocator);
        headers.entries.deinit(headers.allocator);
    }

    pub fn empty(allocator: std.mem.Allocator) Headers {
        return Headers{
            .entries = .{},
            .buf = .{},
            .allocator = allocator,
            .guard = Guard.none,
        };
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/Headers#methods
    pub const JS = struct {

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/get
        pub fn get(
            ref: *RefCountedHeaders,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var this = ref.leak();
            if (arguments.len == 0) {
                return js.JSValueMakeNull(ctx);
            }

            const key_slice = ZigString.from(arguments[0], ctx).toSlice(bun.default_allocator);
            if (key_slice.len == 0) {
                return js.JSValueMakeNull(ctx);
            }
            defer key_slice.deinit();

            if (this.getHeaderIndex(key_slice.slice())) |index| {
                return ZigString.init(this.asStr(this.entries.items(.value)[index]))
                    .toValue(ctx.ptr()).asObjectRef();
            } else {
                return js.JSValueMakeNull(ctx);
            }
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/set
        // > The difference between set() and Headers.append is that if the specified header already exists and accepts multiple values
        // > set() overwrites the existing value with the new one, whereas Headers.append appends the new value to the end of the set of values.
        pub fn set(
            ref: *RefCountedHeaders,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var this = ref.leak();
            if (arguments.len == 0) {
                return js.JSValueMakeNull(ctx);
            }
            const key_slice = ZigString.from(arguments[0], ctx);
            if (key_slice.len == 0) {
                return js.JSValueMakeNull(ctx);
            }

            this.putHeaderFromJS(key_slice, ZigString.from(arguments[1], ctx), false);
            return js.JSValueMakeUndefined(ctx);
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/append
        pub fn append(
            ref: *RefCountedHeaders,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var this = ref.leak();
            if (arguments.len == 0) {
                return js.JSValueMakeNull(ctx);
            }
            const key_slice = ZigString.from(arguments[0], ctx);
            if (key_slice.len == 0) {
                return js.JSValueMakeNull(ctx);
            }

            this.putHeaderFromJS(key_slice, ZigString.from(arguments[1], ctx), true);
            return js.JSValueMakeUndefined(ctx);
        }
        pub fn delete(
            ref: *RefCountedHeaders,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var this: *Headers = ref.leak();

            const key = ZigString.from(arguments[0], ctx);
            if (key.len == 0) {
                return js.JSValueMakeNull(ctx);
            }
            var str = key.toSlice(ref.allocator);
            defer str.deinit();
            var entries_ = &this.entries;

            if (this.getHeaderIndex(str.slice())) |header_i| {
                entries_.orderedRemove(header_i);
            }

            return js.JSValueMakeUndefined(ctx);
        }
        pub fn entries(
            _: *RefCountedHeaders,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("<r><b>Headers.entries()<r> is not implemented yet - sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }
        pub fn keys(
            _: *RefCountedHeaders,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("H<r><b>Headers.keys()<r> is not implemented yet- sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }
        pub fn values(
            _: *RefCountedHeaders,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("<r><b>Headers.values()<r> is not implemented yet - sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }

        pub fn headersInit(ctx: js.JSContextRef, header_prop: js.JSObjectRef) !?Headers {
            const header_keys = js.JSObjectCopyPropertyNames(ctx, header_prop);
            defer js.JSPropertyNameArrayRelease(header_keys);
            const total_header_count = js.JSPropertyNameArrayGetCount(header_keys);
            if (total_header_count == 0) return null;

            // 2 passes through the headers

            // Pass #1: find the "real" count.
            // The number of things which are strings or numbers.
            // Anything else should be ignored.
            // We could throw a TypeError, but ignoring silently is more JavaScript-like imo
            var real_header_count: usize = 0;
            var estimated_buffer_len: usize = 0;
            var j: usize = 0;
            while (j < total_header_count) : (j += 1) {
                var key_ref = js.JSPropertyNameArrayGetNameAtIndex(header_keys, j);
                var value_ref = js.JSObjectGetProperty(ctx, header_prop, key_ref, null);

                switch (js.JSValueGetType(ctx, value_ref)) {
                    js.JSType.kJSTypeNumber => {
                        const key_len = js.JSStringGetLength(key_ref);
                        if (key_len > 0) {
                            real_header_count += 1;
                            estimated_buffer_len += key_len;
                            estimated_buffer_len += std.fmt.count("{d}", .{js.JSValueToNumber(ctx, value_ref, null)});
                        }
                    },
                    js.JSType.kJSTypeString => {
                        const key_len = js.JSStringGetLength(key_ref);
                        const value_len = js.JSStringGetLength(value_ref);
                        if (key_len > 0 and value_len > 0) {
                            real_header_count += 1;
                            estimated_buffer_len += key_len + value_len;
                        }
                    },
                    else => {},
                }
            }

            if (real_header_count == 0 or estimated_buffer_len == 0) return null;

            j = 0;
            var allocator = getAllocator(ctx);
            var headers = Headers{
                .allocator = allocator,
                .buf = try std.ArrayListUnmanaged(u8).initCapacity(allocator, estimated_buffer_len),
                .entries = Headers.Entries{},
            };
            errdefer headers.deinit();
            try headers.entries.ensureTotalCapacity(allocator, real_header_count);

            while (j < total_header_count) : (j += 1) {
                var key_ref = js.JSPropertyNameArrayGetNameAtIndex(header_keys, j);
                var value_ref = js.JSObjectGetProperty(ctx, header_prop, key_ref, null);

                switch (js.JSValueGetType(ctx, value_ref)) {
                    js.JSType.kJSTypeNumber => {
                        if (js.JSStringGetLength(key_ref) == 0) continue;
                        try headers.appendInit(ctx, key_ref, .kJSTypeNumber, value_ref);
                    },
                    js.JSType.kJSTypeString => {
                        if (js.JSStringGetLength(value_ref) == 0 or js.JSStringGetLength(key_ref) == 0) continue;
                        try headers.appendInit(ctx, key_ref, .kJSTypeString, value_ref);
                    },
                    else => {},
                }
            }
            return headers;
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/Headers
        pub fn constructor(
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSObjectRef {
            var headers = getAllocator(ctx).create(RefCountedHeaders) catch unreachable;
            if (arguments.len > 0 and js.JSValueIsObjectOfClass(ctx, arguments[0], Headers.Class.get().*)) {
                var other = castObj(arguments[0], RefCountedHeaders).leak();
                other.clone(&headers.value) catch unreachable;
                headers.count = 1;
                headers.allocator = getAllocator(ctx);
            } else if (arguments.len == 1 and js.JSValueIsObject(ctx, arguments[0])) {
                headers.* = .{
                    .value = (JS.headersInit(ctx, arguments[0]) catch null) orelse Headers{
                        .entries = .{},
                        .buf = .{},
                        .allocator = getAllocator(ctx),
                        .guard = Guard.none,
                    },
                    .allocator = getAllocator(ctx),
                    .count = 1,
                };
            } else {
                headers.* = .{
                    .value = Headers.empty(getAllocator(ctx)),
                    .allocator = getAllocator(ctx),
                    .count = 1,
                };
            }

            return Headers.Class.make(ctx, headers);
        }

        pub fn finalize(
            this: *RefCountedHeaders,
        ) void {
            this.deref();
        }
    };
    pub const Class = NewClass(
        RefCountedHeaders,
        .{
            .name = "Headers",
            .read_only = true,
        },
        .{
            .@"get" = .{
                .rfn = JS.get,
            },
            .@"set" = .{
                .rfn = JS.set,
                .ts = d.ts{},
            },
            .@"append" = .{
                .rfn = JS.append,
                .ts = d.ts{},
            },
            .@"delete" = .{
                .rfn = JS.delete,
                .ts = d.ts{},
            },
            .@"entries" = .{
                .rfn = JS.entries,
                .ts = d.ts{},
            },
            .@"keys" = .{
                .rfn = JS.keys,
                .ts = d.ts{},
            },
            .@"values" = .{
                .rfn = JS.values,
                .ts = d.ts{},
            },
            .@"constructor" = .{
                .rfn = JS.constructor,
                .ts = d.ts{},
            },
            .@"finalize" = .{
                .rfn = JS.finalize,
            },
            .toJSON = .{
                .rfn = toJSON,
                .name = "toJSON",
            },
        },
        .{},
    );

    // https://developer.mozilla.org/en-US/docs/Glossary/Guard
    pub const Guard = enum {
        immutable,
        request,
        @"request-no-cors",
        response,
        none,
    };

    pub fn fromPicoHeaders(allocator: std.mem.Allocator, picohttp_headers: []const picohttp.Header) !Headers {
        var total_len: usize = 0;
        for (picohttp_headers) |header| {
            total_len += header.name.len;
            total_len += header.value.len;
        }
        // for the null bytes
        total_len += picohttp_headers.len * 2;
        var headers = Headers{
            .allocator = allocator,
            .entries = Headers.Entries{},
            .buf = std.ArrayListUnmanaged(u8){},
        };
        try headers.entries.ensureTotalCapacity(allocator, picohttp_headers.len);
        try headers.buf.ensureTotalCapacity(allocator, total_len);
        headers.buf.expandToCapacity();
        headers.guard = Guard.request;

        for (picohttp_headers) |header| {
            headers.entries.appendAssumeCapacity(.{
                .name = headers.appendString(
                    string,
                    header.name,
                    true,
                    true,
                ),
                .value = headers.appendString(
                    string,
                    header.value,
                    true,
                    true,
                ),
            });
        }

        return headers;
    }

    // TODO: is it worth making this lazy? instead of copying all the request headers, should we just do it on get/put/iterator?
    pub fn fromRequestCtx(allocator: std.mem.Allocator, request: *RequestContext) !Headers {
        return fromPicoHeaders(allocator, request.request.headers);
    }

    pub fn asStr(headers: *const Headers, ptr: Api.StringPointer) []u8 {
        return headers.buf.items[ptr.offset..][0..ptr.length];
    }

    pub fn putHeader(headers: *Headers, key_: []const u8, value_: []const u8, comptime append: bool) void {
        var header_kv_buf: [4096]u8 = undefined;

        const key = strings.copyLowercase(strings.trim(key_, " \n\r"), &header_kv_buf);
        const value = strings.copyLowercase(strings.trim(value_, " \n\r"), header_kv_buf[key.len..]);

        return headers.putHeaderNormalized(key, value, append);
    }

    pub fn putHeaderFromJS(headers: *Headers, key_: ZigString, value_: ZigString, comptime append: bool) void {
        var key_slice = key_.toSlice(headers.allocator);
        var value_slice = value_.toSlice(headers.allocator);

        defer key_slice.deinit();
        defer value_slice.deinit();

        headers.putHeader(key_slice.slice(), value_slice.slice(), append);
    }

    pub fn putHeaderNormalized(headers: *Headers, key: []const u8, value: []const u8, comptime append: bool) void {
        if (headers.getHeaderIndex(key)) |header_i| {
            const existing_value = headers.entries.items(.value)[header_i];

            if (append) {
                const end = @truncate(u32, value.len + existing_value.length + 2);
                const offset = headers.buf.items.len;
                headers.buf.ensureUnusedCapacity(headers.allocator, end) catch unreachable;
                headers.buf.appendSliceAssumeCapacity(headers.asStr(existing_value));
                headers.buf.appendSliceAssumeCapacity(", ");
                headers.buf.appendSliceAssumeCapacity(value);
                headers.entries.items(.value)[header_i] = Api.StringPointer{ .offset = @truncate(u32, offset), .length = @truncate(u32, headers.buf.items.len - offset) };
                // Can we get away with just overwriting in-place?
            } else if (existing_value.length >= value.len) {
                std.mem.copy(u8, headers.asStr(existing_value), value);
                headers.entries.items(.value)[header_i].length = @truncate(u32, value.len);
                headers.asStr(headers.entries.items(.value)[header_i]).ptr[value.len] = 0;
                // Otherwise, append to the buffer, and just don't bother dealing with the existing header value
                // We assume that these header objects are going to be kind of short-lived.
            } else {
                headers.buf.ensureUnusedCapacity(headers.allocator, value.len + 1) catch unreachable;
                headers.entries.items(.value)[header_i] = headers.appendString(string, value, false, true);
            }
        } else {
            headers.appendHeader(key, value, false, false);
        }
    }

    pub fn getHeaderIndex(headers: *const Headers, key: string) ?u32 {
        for (headers.entries.items(.name)) |name, i| {
            if (name.length == key.len and strings.eqlInsensitive(key, headers.asStr(name))) {
                return @truncate(u32, i);
            }
        }

        return null;
    }

    pub fn appendHeader(
        headers: *Headers,
        key: string,
        value: string,
        comptime needs_lowercase: bool,
        comptime needs_normalize: bool,
    ) void {
        headers.buf.ensureUnusedCapacity(headers.allocator, key.len + value.len + 2) catch unreachable;

        headers.entries.append(
            headers.allocator,
            .{
                .name = headers.appendString(
                    string,
                    key,
                    needs_lowercase,
                    needs_normalize,
                ),
                .value = headers.appendString(
                    string,
                    value,
                    needs_lowercase,
                    needs_normalize,
                ),
            },
        ) catch unreachable;
    }

    fn appendString(
        this: *Headers,
        comptime StringType: type,
        str: StringType,
        comptime needs_lowercase: bool,
        comptime needs_normalize: bool,
    ) Api.StringPointer {
        var ptr = Api.StringPointer{ .offset = @truncate(u32, this.buf.items.len), .length = 0 };
        ptr.length = @truncate(
            u32,
            switch (comptime StringType) {
                js.JSStringRef => js.JSStringGetLength(str),
                else => str.len,
            },
        );
        if (Environment.allow_assert) std.debug.assert(ptr.length > 0);
        this.buf.ensureUnusedCapacity(this.allocator, ptr.length) catch unreachable;
        var slice = this.buf.items;
        slice.len += ptr.length;
        slice = slice[ptr.offset..][0..ptr.length];

        switch (comptime StringType) {
            js.JSStringRef => {
                ptr.length = @truncate(u32, js.JSStringGetUTF8CString(str, slice.ptr, slice.len) - 1);
            },
            else => {
                std.mem.copy(u8, slice, str);
            },
        }

        if (comptime needs_normalize) {
            slice = strings.trim(slice, " \r\n");
        }

        if (comptime needs_lowercase) {
            for (slice) |c, i| {
                slice[i] = std.ascii.toLower(c);
            }
        }

        ptr.length = @truncate(u32, slice.len);
        this.buf.items.len += slice.len;
        return ptr;
    }

    pub fn toJSON(
        ref: *RefCountedHeaders,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var this = ref.leak();
        const slice = this.entries.slice();
        const keys = slice.items(.name);
        const values = slice.items(.value);
        const StackFallback = std.heap.StackFallbackAllocator(32 * 2 * @sizeOf(ZigString));
        var stack = StackFallback{
            .buffer = undefined,
            .fallback_allocator = default_allocator,
            .fixed_buffer_allocator = undefined,
        };
        var allocator = stack.get();
        var key_strings_ = allocator.alloc(ZigString, keys.len * 2) catch unreachable;
        var key_strings = key_strings_[0..keys.len];
        var value_strings = key_strings_[keys.len..];

        for (keys) |key, i| {
            key_strings[i] = ZigString.init(this.asStr(key));
            key_strings[i].detectEncoding();
            value_strings[i] = ZigString.init(this.asStr(values[i]));
            value_strings[i].detectEncoding();
        }

        var result = JSValue.fromEntries(ctx.ptr(), key_strings.ptr, value_strings.ptr, keys.len, true).asObjectRef();
        allocator.free(key_strings_);
        return result;
    }

    pub fn writeFormat(this: *const Headers, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        if (this.entries.len == 0) {
            try writer.writeAll("Headers (0 KB) {}");
            return;
        }

        try writer.print("Headers ({}) {{\n", .{bun.fmt.size(this.buf.items.len)});
        const Writer = @TypeOf(writer);
        {
            var slice = this.entries.slice();
            const names = slice.items(.name);
            const values = slice.items(.value);
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            for (names) |name, i| {
                if (i > 0) {
                    formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                    writer.writeAll("\n") catch unreachable;
                }

                const value = values[i];
                formatter.writeIndent(Writer, writer) catch unreachable;
                try JSPrinter.writeJSONString(this.asStr(name), Writer, writer, false);
                writer.writeAll(": ") catch unreachable;
                try JSPrinter.writeJSONString(this.asStr(value), Writer, writer, false);
            }
        }

        try writer.writeAll("\n");
        try formatter.writeIndent(@TypeOf(writer), writer);
        try writer.writeAll("}");
    }

    fn appendNumber(this: *Headers, num: f64) Api.StringPointer {
        var ptr = Api.StringPointer{ .offset = @truncate(u32, this.buf.items.len), .length = @truncate(
            u32,
            std.fmt.count("{d}", .{num}),
        ) };
        this.buf.ensureUnusedCapacity(this.allocator, ptr.length + 1) catch unreachable;
        this.buf.items.len += ptr.length;
        var slice = this.buf.items[ptr.offset..][0..ptr.length];
        var buf = std.fmt.bufPrint(slice, "{d}", .{num}) catch &[_]u8{};
        ptr.length = @truncate(u32, buf.len);
        return ptr;
    }

    pub fn appendInit(this: *Headers, ctx: js.JSContextRef, key: js.JSStringRef, comptime value_type: js.JSType, value: js.JSValueRef) !void {
        this.entries.append(this.allocator, .{
            .name = this.appendString(js.JSStringRef, key, true, true),
            .value = switch (comptime value_type) {
                js.JSType.kJSTypeNumber => this.appendNumber(js.JSValueToNumber(ctx, value, null)),
                js.JSType.kJSTypeString => this.appendString(js.JSStringRef, value, true, true),
                else => unreachable,
            },
        }) catch unreachable;
    }

    pub fn clone(this: *const Headers, to: *Headers) !void {
        var buf = this.buf;
        to.* = Headers{
            .entries = try this.entries.clone(this.allocator),
            .buf = try buf.clone(this.allocator),
            .allocator = this.allocator,
            .guard = Guard.none,
        };
    }
};

pub const Blob = struct {
    size: u32 = 0,
    offset: u32 = 0,
    allocator: ?std.mem.Allocator = null,
    store: ?*Store = null,
    content_type: string = "",
    content_type_allocated: bool = false,

    /// JavaScriptCore strings are either latin1 or UTF-16
    /// When UTF-16, they're nearly always due to non-ascii characters
    is_all_ascii: ?bool = null,

    globalThis: *JSGlobalObject,

    pub const Store = struct {
        ptr: [*]u8 = undefined,
        len: u32 = 0,
        ref_count: u32 = 0,
        cap: u32 = 0,
        allocator: std.mem.Allocator,
        is_all_ascii: ?bool = null,

        pub inline fn ref(this: *Store) void {
            this.ref_count += 1;
        }

        pub fn init(bytes: []u8, allocator: std.mem.Allocator) !*Store {
            var store = try allocator.create(Store);
            store.* = .{
                .ptr = bytes.ptr,
                .len = @truncate(u32, bytes.len),
                .ref_count = 1,
                .cap = @truncate(u32, bytes.len),
                .allocator = allocator,
            };
            return store;
        }

        pub fn external(ptr: ?*anyopaque, _: ?*anyopaque, _: usize) callconv(.C) void {
            if (ptr == null) return;
            var this = bun.cast(*Store, ptr);
            this.deref();
        }

        pub fn fromArrayList(list: std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator) !*Store {
            var store = try allocator.create(Store);
            store.* = .{
                .ptr = list.items.ptr,
                .len = @truncate(u32, list.items.len),
                .ref_count = 1,
                .cap = @truncate(u32, list.capacity),
                .allocator = allocator,
            };
            return store;
        }

        pub fn leakSlice(this: *const Store) []const u8 {
            return this.ptr[0..this.len];
        }

        pub fn slice(this: *Store) []u8 {
            this.ref_count += 1;
            return this.leakSlice();
        }

        pub fn isOnlyOneRef(this: *const Store) bool {
            return this.ref_count <= 1;
        }

        pub fn deref(this: *Store) void {
            this.ref_count -= 1;
            if (this.ref_count == 0) {
                var allocated_slice = this.ptr[0..this.cap];
                var allocator = this.allocator;
                allocator.free(allocated_slice);
                allocator.destroy(this);
            }
        }

        pub fn asArrayList(this: *Store) std.ArrayListUnmanaged(u8) {
            this.ref_count += 1;

            return this.asArrayListLeak();
        }

        pub fn asArrayListLeak(this: *const Store) std.ArrayListUnmanaged(u8) {
            return .{
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
            };
        }
    };

    pub const Class = NewClass(
        Blob,
        .{ .name = "Blob" },
        .{
            .constructor = constructor,
            .finalize = finalize,
            .text = .{
                .rfn = getText,
            },
            .json = .{
                .rfn = getJSON,
            },
            .arrayBuffer = .{
                .rfn = getArrayBuffer,
            },
            .slice = .{
                .rfn = getSlice,
            },
        },
        .{
            .@"type" = .{
                .get = getType,
                .set = setType,
            },
            .@"size" = .{
                .get = getSize,
                .ro = true,
            },
        },
    );

    fn promisified(
        value: JSC.JSValue,
        global: *JSGlobalObject,
    ) JSC.JSValue {
        return JSC.JSPromise.resolvedPromiseValue(global, value);
    }

    pub fn getText(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) JSC.C.JSObjectRef {
        return promisified(this.toString(ctx.ptr(), .clone), ctx.ptr()).asObjectRef();
    }

    pub fn getTextTransfer(
        this: *Blob,
        ctx: js.JSContextRef,
    ) JSC.C.JSObjectRef {
        return promisified(this.toString(ctx.ptr(), .transfer), ctx.ptr()).asObjectRef();
    }

    pub fn getJSON(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) JSC.C.JSObjectRef {
        return promisified(this.toJSON(ctx.ptr()), ctx.ptr()).asObjectRef();
    }

    pub fn getArrayBufferTransfer(
        this: *Blob,
        ctx: js.JSContextRef,
    ) JSC.C.JSObjectRef {
        return promisified(this.toArrayBuffer(ctx.ptr(), .transfer), ctx.ptr()).asObjectRef();
    }

    pub fn getArrayBuffer(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) JSC.C.JSObjectRef {
        return promisified(this.toArrayBuffer(ctx.ptr(), .clone), ctx.ptr()).asObjectRef();
    }

    /// https://w3c.github.io/FileAPI/#slice-method-algo
    /// The slice() method returns a new Blob object with bytes ranging from the
    /// optional start parameter up to but not including the optional end
    /// parameter, and with a type attribute that is the value of the optional
    /// contentType parameter. It must act as follows:
    pub fn getSlice(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) JSC.C.JSObjectRef {
        if (this.size == 0) {
            return constructor(ctx, null, &[_]js.JSValueRef{}, exception);
        }
        // If the optional start parameter is not used as a parameter when making this call, let relativeStart be 0.
        var relativeStart: i32 = 0;

        // If the optional end parameter is not used as a parameter when making this call, let relativeEnd be size.
        var relativeEnd: i32 = @intCast(i32, this.size);

        var args_iter = JSC.Node.ArgumentsSlice.from(args);
        if (args_iter.nextEat()) |start_| {
            const start = start_.toInt32();
            if (start < 0) {
                // If the optional start parameter is negative, let relativeStart be start + size.
                relativeStart = @intCast(i32, @maximum(start + @intCast(i32, this.size), 0));
            } else {
                // Otherwise, let relativeStart be start.
                relativeStart = @minimum(@intCast(i32, start), @intCast(i32, this.size));
            }
        }

        if (args_iter.nextEat()) |end_| {
            const end = end_.toInt32();
            // If end is negative, let relativeEnd be max((size + end), 0).
            if (end < 0) {
                // If the optional start parameter is negative, let relativeStart be start + size.
                relativeEnd = @intCast(i32, @maximum(end + @intCast(i32, this.size), 0));
            } else {
                // Otherwise, let relativeStart be start.
                relativeEnd = @minimum(@intCast(i32, end), @intCast(i32, this.size));
            }
        }

        var content_type: string = "";
        if (args_iter.nextEat()) |content_type_| {
            if (content_type_.isString()) {
                var zig_str = content_type_.getZigString(ctx.ptr());
                var slicer = zig_str.toSlice(bun.default_allocator);
                defer slicer.deinit();
                var slice = slicer.slice();
                var content_type_buf = getAllocator(ctx).alloc(u8, slice.len) catch unreachable;
                content_type = strings.copyLowercase(slice, content_type_buf);
            }
        }

        const len = @intCast(u32, @maximum(relativeEnd - relativeStart, 0));

        // This copies over the is_all_ascii flag
        // which is okay because this will only be a <= slice
        var blob = this.dupe();
        blob.offset = @intCast(u32, relativeStart);
        blob.size = len;
        blob.content_type = content_type;
        blob.content_type_allocated = content_type.len > 0;

        var blob_ = getAllocator(ctx).create(Blob) catch unreachable;
        blob_.* = blob;
        blob_.allocator = getAllocator(ctx);
        return Blob.Class.make(ctx, blob_);
    }

    pub fn getType(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.content_type).toValue(ctx.ptr()).asObjectRef();
    }

    pub fn setType(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        value: js.JSValueRef,
        _: js.ExceptionRef,
    ) bool {
        var zig_str = JSValue.fromRef(value).getZigString(ctx.ptr());
        if (zig_str.is16Bit())
            return false;

        var slice = zig_str.trimmedSlice();
        if (strings.eql(slice, this.content_type))
            return true;

        const prev_content_type = this.content_type;
        defer if (this.content_type_allocated) bun.default_allocator.free(prev_content_type);
        var content_type_buf = getAllocator(ctx).alloc(u8, slice.len) catch unreachable;
        this.content_type = strings.copyLowercase(slice, content_type_buf);
        this.content_type_allocated = true;
        return true;
    }

    pub fn getSize(
        this: *Blob,
        _: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return JSValue.jsNumber(@truncate(u32, this.size)).asRef();
    }

    pub fn constructor(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        var blob: Blob = undefined;
        switch (args.len) {
            0 => {
                var empty: []u8 = &[_]u8{};
                blob = Blob.init(empty, getAllocator(ctx), ctx.ptr());
            },
            else => {
                blob = fromJS(ctx.ptr(), JSValue.fromRef(args[0]), false) catch |err| {
                    if (err == error.InvalidArguments) {
                        JSC.JSError(getAllocator(ctx), "new Blob() expects an Array", .{}, ctx, exception);
                        return null;
                    }
                    JSC.JSError(getAllocator(ctx), "out of memory :(", .{}, ctx, exception);
                    return null;
                };

                if (args.len > 1) {
                    var options = JSValue.fromRef(args[1]);
                    if (options.isCell()) {
                        // type, the ASCII-encoded string in lower case
                        // representing the media type of the Blob.
                        // Normative conditions for this member are provided
                        // in the § 3.1 Constructors.
                        if (options.get(ctx.ptr(), "type")) |content_type| {
                            if (content_type.isString()) {
                                var content_type_str = content_type.getZigString(ctx.ptr());
                                if (!content_type_str.is16Bit()) {
                                    var slice = content_type_str.trimmedSlice();
                                    var content_type_buf = getAllocator(ctx).alloc(u8, slice.len) catch unreachable;
                                    blob.content_type = strings.copyLowercase(slice, content_type_buf);
                                    blob.content_type_allocated = true;
                                }
                            }
                        }
                    }
                }

                if (blob.content_type.len == 0) {
                    blob.content_type = "";
                }
            },
        }

        var blob_ = getAllocator(ctx).create(Blob) catch unreachable;
        blob_.* = blob;
        blob_.allocator = getAllocator(ctx);
        return Blob.Class.make(ctx, blob_);
    }

    pub fn finalize(this: *Blob) void {
        this.deinit();
    }

    pub fn initWithAllASCII(bytes: []u8, allocator: std.mem.Allocator, globalThis: *JSGlobalObject, is_all_ascii: bool) Blob {
        var store = Blob.Store.init(bytes, allocator) catch unreachable;
        store.is_all_ascii = is_all_ascii;
        return Blob{
            .size = @truncate(u32, bytes.len),
            .store = store,
            .allocator = null,
            .content_type = "",
            .globalThis = globalThis,
            .is_all_ascii = is_all_ascii,
        };
    }

    pub fn init(bytes: []u8, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) Blob {
        return Blob{
            .size = @truncate(u32, bytes.len),
            .store = Blob.Store.init(bytes, allocator) catch unreachable,
            .allocator = null,
            .content_type = "",
            .globalThis = globalThis,
        };
    }

    pub fn initEmpty(globalThis: *JSGlobalObject) Blob {
        return Blob{
            .size = 0,
            .store = null,
            .allocator = null,
            .content_type = "",
            .globalThis = globalThis,
        };
    }

    // Transferring doesn't change the reference count
    // It is a move
    inline fn transfer(this: *Blob) void {
        this.store = null;
    }

    pub fn detach(this: *Blob) void {
        if (this.store) |store| {
            store.deref();
            this.store = null;
        }
    }

    /// This does not duplicate
    /// This creates a new view
    /// and increment the reference count
    pub fn dupe(this: *const Blob) Blob {
        if (this.store) |store| {
            store.ref();
        }

        return this.*;
    }

    pub fn deinit(this: *Blob) void {
        this.detach();

        if (this.allocator) |alloc| {
            this.allocator = null;
            alloc.destroy(this);
        }
    }

    pub fn sharedView(this: *const Blob) []const u8 {
        if (this.size == 0 or this.store == null) return "";
        return this.store.?.leakSlice()[this.offset..][0..this.size];
    }

    pub fn view(this: *const Blob) []const u8 {
        if (this.size == 0 or this.store == null) return "";
        return this.store.?.slice()[this.offset..][0..this.size];
    }

    pub fn setASCIIFlagIfNeeded(this: *Blob, buf: []const u8) bool {
        var store = this.store orelse return true;

        if (this.is_all_ascii != null)
            return this.is_all_ascii.?;

        const sync_with_store = this.offset == 0 and this.size == store.len;
        if (sync_with_store) {
            this.is_all_ascii = store.is_all_ascii;
        }

        this.is_all_ascii = this.is_all_ascii orelse strings.isAllASCII(buf);

        if (sync_with_store) {
            store.is_all_ascii = this.is_all_ascii;
        }

        return this.is_all_ascii.?;
    }

    pub const Lifetime = enum {
        clone,
        transfer,
        share,
    };

    pub fn toString(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        var view_: []const u8 =
            this.sharedView();

        if (view_.len == 0)
            return ZigString.Empty.toValue(global);

        // TODO: use the index to make this one pass instead of two passes
        var buf = view_;
        const is_all_ascii = this.setASCIIFlagIfNeeded(buf);

        if (!is_all_ascii) {
            if (strings.toUTF16Alloc(bun.default_allocator, buf, false) catch null) |external| {
                if (lifetime == .transfer) {
                    this.detach();
                }

                return ZigString.toExternalU16(external.ptr, external.len, global);
            }

            // if we get here, it means we were wrong
            // but it generally shouldn't happen
            this.is_all_ascii = true;

            if (comptime Environment.allow_assert) {
                unreachable;
            }
        }

        switch (comptime lifetime) {
            .clone => {
                this.store.?.ref();
                return ZigString.init(buf).external(global, this.store.?, Store.external);
            },
            .transfer => {
                var store = this.store.?;
                this.transfer();
                return ZigString.init(buf).external(global, store, Store.external);
            },
            .share => {
                this.store.?.ref();
                return ZigString.init(buf).external(global, this.store.?, Store.external);
            },
        }
    }

    pub fn toJSON(this: *Blob, global: *JSGlobalObject) JSValue {
        var view_ = this.sharedView();

        if (view_.len == 0)
            return ZigString.Empty.toValue(global);

        // TODO: use the index to make this one pass instead of two passes
        var buf = view_;

        const is_all_ascii = this.setASCIIFlagIfNeeded(buf);

        if (!is_all_ascii) {
            if (strings.toUTF16Alloc(bun.default_allocator, buf, false) catch null) |external| {
                return ZigString.toExternalU16(external.ptr, external.len, global).parseJSON(global);
            }

            // if we get here, it means we were wrong
            // but it generally shouldn't happen
            this.is_all_ascii = true;

            if (comptime Environment.allow_assert) {
                unreachable;
            }
        }

        return ZigString.init(buf).toValue(
            global,
        ).parseJSON(global);
    }
    pub fn toArrayBuffer(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        var view_ = this.sharedView();

        if (view_.len == 0)
            return JSC.ArrayBuffer.fromBytes(&[_]u8{}, .ArrayBuffer).toJS(global.ref(), null);

        switch (comptime lifetime) {
            .clone => {
                var clone = bun.default_allocator.alloc(u8, view_.len) catch unreachable;
                @memcpy(clone.ptr, view_.ptr, view_.len);

                return JSC.ArrayBuffer.fromBytes(clone, .ArrayBuffer).toJS(global.ref(), null);
            },
            .share => {
                this.store.?.ref();
                return JSC.ArrayBuffer.fromBytes(bun.constStrToU8(view_), .ArrayBuffer).toJSWithContext(
                    global.ref(),
                    this.store.?,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
            .transfer => {
                var store = this.store.?;
                this.transfer();
                return JSC.ArrayBuffer.fromBytes(bun.constStrToU8(view_), .ArrayBuffer).toJSWithContext(
                    global.ref(),
                    store,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
        }
    }

    pub inline fn fromJS(global: *JSGlobalObject, arg: JSValue, comptime move: bool) anyerror!Blob {
        if (comptime move) {
            return fromJSMove(global, arg);
        } else {
            return fromJSClone(global, arg);
        }
    }

    pub inline fn fromJSMove(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, true);
    }

    pub inline fn fromJSClone(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, false);
    }

    fn fromJSMovable(global: *JSGlobalObject, arg: JSValue, comptime move: bool) anyerror!Blob {
        const FromJSFunction = if (comptime move)
            fromJSMove
        else
            fromJSClone;
        const DeferCtx = struct {
            args: std.meta.ArgsTuple(@TypeOf(FromJSFunction)),
            ret: anyerror!Blob = undefined,

            pub fn run(ctx: ?*anyopaque) callconv(.C) void {
                var that = bun.cast(*@This(), ctx.?);
                that.ret = @call(.{}, FromJSFunction, that.args);
            }
        };
        var ctx = DeferCtx{
            .args = .{
                global,
                arg,
            },
            .ret = undefined,
        };
        JSC.VirtualMachine.vm.global.vm().deferGC(&ctx, DeferCtx.run);
        return ctx.ret;
    }

    fn fromJSWithoutDeferGC(global: *JSGlobalObject, arg: JSValue, comptime move: bool) anyerror!Blob {
        var current = arg;
        if (current.isUndefinedOrNull()) {
            return Blob{ .globalThis = global };
        }

        var top_value = current;
        var might_only_be_one_thing = false;
        switch (current.jsTypeLoose()) {
            .Array, .DerivedArray => {
                var top_iter = JSC.JSArrayIterator.init(current, global);
                might_only_be_one_thing = top_iter.len == 1;
                if (top_iter.len == 0) {
                    return Blob{ .globalThis = global };
                }
                if (might_only_be_one_thing) {
                    top_value = top_iter.next().?;
                }
            },
            else => {
                might_only_be_one_thing = true;
                if (comptime !move) {
                    return error.InvalidArguments;
                }
            },
        }

        if (might_only_be_one_thing or !move) {

            // Fast path: one item, we don't need to join
            switch (top_value.jsTypeLoose()) {
                .Cell,
                .NumberObject,
                JSC.JSValue.JSType.String,
                JSC.JSValue.JSType.StringObject,
                JSC.JSValue.JSType.DerivedStringObject,
                => {
                    var sliced = top_value.toSlice(global, bun.default_allocator);
                    const is_all_ascii = !sliced.allocated;
                    if (!sliced.allocated) {
                        sliced.ptr = @ptrCast([*]const u8, (try bun.default_allocator.dupe(u8, sliced.slice())).ptr);
                        sliced.allocated = true;
                    }

                    return Blob.initWithAllASCII(bun.constStrToU8(sliced.slice()), bun.default_allocator, global, is_all_ascii);
                },

                JSC.JSValue.JSType.ArrayBuffer,
                JSC.JSValue.JSType.Int8Array,
                JSC.JSValue.JSType.Uint8Array,
                JSC.JSValue.JSType.Uint8ClampedArray,
                JSC.JSValue.JSType.Int16Array,
                JSC.JSValue.JSType.Uint16Array,
                JSC.JSValue.JSType.Int32Array,
                JSC.JSValue.JSType.Uint32Array,
                JSC.JSValue.JSType.Float32Array,
                JSC.JSValue.JSType.Float64Array,
                JSC.JSValue.JSType.BigInt64Array,
                JSC.JSValue.JSType.BigUint64Array,
                JSC.JSValue.JSType.DataView,
                => {
                    var buf = try bun.default_allocator.dupe(u8, top_value.asArrayBuffer(global).?.slice());
                    return Blob.init(buf, bun.default_allocator, global);
                },

                else => {
                    if (JSC.C.JSObjectGetPrivate(top_value.asObjectRef())) |priv| {
                        var data = JSC.JSPrivateDataPtr.from(priv);
                        switch (data.tag()) {
                            .Blob => {
                                var blob: *Blob = data.as(Blob);
                                if (comptime move) {
                                    var _blob = blob.*;
                                    blob.transfer();
                                    return _blob;
                                } else {
                                    return blob.dupe();
                                }
                            },

                            else => return Blob.initEmpty(global),
                        }
                    }
                },
            }
        }

        var stack_allocator = std.heap.stackFallback(1024, bun.default_allocator);
        var stack_mem_all = stack_allocator.get();
        var stack: std.ArrayList(JSValue) = std.ArrayList(JSValue).init(stack_mem_all);
        var joiner = StringJoiner{ .use_pool = false, .node_allocator = stack_mem_all };

        defer if (stack_allocator.fixed_buffer_allocator.end_index >= 1024) stack.deinit();

        while (true) {
            switch (current.jsTypeLoose()) {
                .NumberObject,
                JSC.JSValue.JSType.String,
                JSC.JSValue.JSType.StringObject,
                JSC.JSValue.JSType.DerivedStringObject,
                => {
                    var sliced = current.toSlice(global, bun.default_allocator);
                    joiner.append(
                        sliced.slice(),
                        0,
                        if (sliced.allocated) sliced.allocator else null,
                    );
                },

                .Array, .DerivedArray => {
                    var iter = JSC.JSArrayIterator.init(current, global);
                    try stack.ensureUnusedCapacity(iter.len);
                    var any_arrays = false;
                    while (iter.next()) |item| {
                        if (item.isUndefinedOrNull()) continue;

                        // When it's a string or ArrayBuffer inside an array, we can avoid the extra push/pop
                        // we only really want this for nested arrays
                        // However, we must preserve the order
                        // That means if there are any arrays
                        // we have to restart the loop
                        if (!any_arrays) {
                            switch (item.jsTypeLoose()) {
                                .NumberObject,
                                .Cell,
                                JSC.JSValue.JSType.String,
                                JSC.JSValue.JSType.StringObject,
                                JSC.JSValue.JSType.DerivedStringObject,
                                => {
                                    var sliced = item.toSlice(global, bun.default_allocator);
                                    joiner.append(
                                        sliced.slice(),
                                        0,
                                        if (sliced.allocated) sliced.allocator else null,
                                    );
                                    continue;
                                },
                                JSC.JSValue.JSType.ArrayBuffer,
                                JSC.JSValue.JSType.Int8Array,
                                JSC.JSValue.JSType.Uint8Array,
                                JSC.JSValue.JSType.Uint8ClampedArray,
                                JSC.JSValue.JSType.Int16Array,
                                JSC.JSValue.JSType.Uint16Array,
                                JSC.JSValue.JSType.Int32Array,
                                JSC.JSValue.JSType.Uint32Array,
                                JSC.JSValue.JSType.Float32Array,
                                JSC.JSValue.JSType.Float64Array,
                                JSC.JSValue.JSType.BigInt64Array,
                                JSC.JSValue.JSType.BigUint64Array,
                                JSC.JSValue.JSType.DataView,
                                => {
                                    var buf = item.asArrayBuffer(global).?;
                                    joiner.append(buf.slice(), 0, null);
                                    continue;
                                },
                                .Array, .DerivedArray => {
                                    any_arrays = true;
                                    break;
                                },
                                else => {
                                    if (JSC.C.JSObjectGetPrivate(item.asObjectRef())) |priv| {
                                        var data = JSC.JSPrivateDataPtr.from(priv);
                                        switch (data.tag()) {
                                            .Blob => {
                                                var blob: *Blob = data.as(Blob);
                                                joiner.append(blob.sharedView(), 0, null);
                                                continue;
                                            },
                                            else => {},
                                        }
                                    }
                                },
                            }
                        }

                        stack.appendAssumeCapacity(item);
                    }
                },

                JSC.JSValue.JSType.ArrayBuffer,
                JSC.JSValue.JSType.Int8Array,
                JSC.JSValue.JSType.Uint8Array,
                JSC.JSValue.JSType.Uint8ClampedArray,
                JSC.JSValue.JSType.Int16Array,
                JSC.JSValue.JSType.Uint16Array,
                JSC.JSValue.JSType.Int32Array,
                JSC.JSValue.JSType.Uint32Array,
                JSC.JSValue.JSType.Float32Array,
                JSC.JSValue.JSType.Float64Array,
                JSC.JSValue.JSType.BigInt64Array,
                JSC.JSValue.JSType.BigUint64Array,
                JSC.JSValue.JSType.DataView,
                => {
                    var buf = current.asArrayBuffer(global).?;
                    joiner.append(buf.slice(), 0, null);
                },

                else => {
                    outer: {
                        if (JSC.C.JSObjectGetPrivate(current.asObjectRef())) |priv| {
                            var data = JSC.JSPrivateDataPtr.from(priv);
                            switch (data.tag()) {
                                .Blob => {
                                    var blob: *Blob = data.as(Blob);
                                    joiner.append(blob.sharedView(), 0, null);
                                    break :outer;
                                },
                                else => {},
                            }
                        }

                        var sliced = current.toSlice(global, bun.default_allocator);
                        joiner.append(
                            sliced.slice(),
                            0,
                            if (sliced.allocated) sliced.allocator else null,
                        );
                    }
                },
            }
            current = stack.popOrNull() orelse break;
        }

        var joined = try joiner.done(bun.default_allocator);
        return Blob.init(joined, bun.default_allocator, global);
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Body
pub const Body = struct {
    init: Init = Init{ .headers = null, .status_code = 200 },
    value: Value = Value.empty,

    pub inline fn len(this: *const Body) usize {
        return this.slice().len;
    }

    pub fn slice(this: *const Body) []const u8 {
        return this.value.slice();
    }

    pub fn use(this: *Body) Blob {
        return this.value.use();
    }

    pub fn clone(this: Body, allocator: std.mem.Allocator) Body {
        return Body{
            .init = this.init.clone(allocator),
            .value = this.value.clone(allocator),
        };
    }

    pub fn writeFormat(this: *const Body, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("bodyUsed: ");
        formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.value == .Used), .BooleanObject, enable_ansi_colors);
        try formatter.printComma(Writer, writer, enable_ansi_colors);
        try writer.writeAll("\n");

        if (this.init.headers) |headers| {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("headers: ");
            try headers.leak().writeFormat(formatter, writer, comptime enable_ansi_colors);
            try writer.writeAll("\n");
        }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("status: ");
        formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(this.init.status_code), .NumberObject, enable_ansi_colors);
    }

    pub fn deinit(this: *Body, _: std.mem.Allocator) void {
        if (this.init.headers) |headers| {
            headers.deref();
            this.init.headers = null;
        }

        this.value.deinit();
    }

    pub const Init = struct {
        headers: ?*Headers.RefCountedHeaders = null,
        status_code: u16,
        method: Method = Method.GET,

        pub fn clone(this: Init, allocator: std.mem.Allocator) Init {
            var that = this;
            var headers = this.headers;
            if (headers) |head| {
                headers.?.value.allocator = allocator;
                var new_headers = allocator.create(Headers.RefCountedHeaders) catch unreachable;
                new_headers.allocator = allocator;
                new_headers.count = 1;
                head.leak().clone(&new_headers.value) catch unreachable;
                that.headers = new_headers;
            }

            return that;
        }

        pub fn init(allocator: std.mem.Allocator, ctx: js.JSContextRef, init_ref: js.JSValueRef) !?Init {
            var result = Init{ .headers = null, .status_code = 0 };
            var array = js.JSObjectCopyPropertyNames(ctx, init_ref);
            defer js.JSPropertyNameArrayRelease(array);
            const count = js.JSPropertyNameArrayGetCount(array);

            var i: usize = 0;
            while (i < count) : (i += 1) {
                var property_name_ref = js.JSPropertyNameArrayGetNameAtIndex(array, i);
                switch (js.JSStringGetLength(property_name_ref)) {
                    "headers".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "headers")) {
                            // only support headers as an object for now.
                            if (js.JSObjectGetProperty(ctx, init_ref, property_name_ref, null)) |header_prop| {
                                switch (js.JSValueGetType(ctx, header_prop)) {
                                    js.JSType.kJSTypeObject => {
                                        if (JSC.JSValue.fromRef(header_prop).as(Headers.RefCountedHeaders)) |headers| {
                                            result.headers = try Headers.RefCountedHeaders.init(undefined, allocator);
                                            try headers.leak().clone(&result.headers.?.value);
                                        } else if (try Headers.JS.headersInit(ctx, header_prop)) |headers| {
                                            result.headers = try Headers.RefCountedHeaders.init(headers, allocator);
                                        }
                                    },
                                    else => {},
                                }
                            }
                        }
                    },
                    "statusCode".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "statusCode")) {
                            var value_ref = js.JSObjectGetProperty(ctx, init_ref, property_name_ref, null);
                            var exception: js.JSValueRef = null;
                            const number = js.JSValueToNumber(ctx, value_ref, &exception);
                            if (exception != null or !std.math.isFinite(number)) continue;
                            result.status_code = @truncate(u16, @floatToInt(u64, number));
                        }
                    },
                    "method".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "method")) {
                            result.method = Method.which(
                                JSC.JSValue.fromRef(init_ref).get(ctx.ptr(), "method").?.getZigString(ctx.ptr()).slice(),
                            ) orelse Method.GET;
                        }
                    },
                    else => {},
                }
            }

            if (result.headers == null and result.status_code < 200) return null;
            return result;
        }
    };

    pub const PendingValue = struct {
        promise: ?JSValue = null,
        global: *JSGlobalObject,
        task: ?*anyopaque = null,
        deinit: bool = false,
    };

    pub const Value = union(Tag) {
        Blob: Blob,
        Locked: PendingValue,
        Used: void,
        Empty: void,

        pub const Tag = enum {
            Blob,
            Locked,
            Used,
            Empty,
        };

        pub const empty = Value{ .Empty = .{} };
        pub fn slice(this: Value) []const u8 {
            return switch (this) {
                .Blob => this.Blob.sharedView(),
                else => "",
            };
        }

        pub fn use(this: *Value) Blob {
            switch (this.*) {
                .Blob => {
                    var new_blob = this.Blob;
                    this.* = .{ .Used = .{} };
                    return new_blob;
                },
                else => {
                    return Blob.initEmpty(undefined);
                },
            }
        }

        pub fn deinit(this: *Value) void {
            const tag = @as(Tag, this.*);
            if (tag == .Locked) {
                this.Locked.deinit = true;
                return;
            }

            if (tag == .Blob) {
                this.Blob.deinit();
                this.* = Value.empty;
            }
        }

        pub fn clone(this: Value, _: std.mem.Allocator) Value {
            if (this == .Blob) {
                return Value{ .Blob = this.Blob.dupe() };
            }

            return Value{ .Empty = .{} };
        }
    };

    pub fn @"404"(_: js.JSContextRef) Body {
        return Body{
            .init = Init{
                .headers = null,
                .status_code = 404,
            },
            .value = Value.empty,
        };
    }

    pub fn @"200"(_: js.JSContextRef) Body {
        return Body{
            .init = Init{
                .headers = null,
                .status_code = 200,
            },
            .value = Value.empty,
        };
    }

    pub fn extract(ctx: js.JSContextRef, body_ref: js.JSObjectRef, exception: js.ExceptionRef) Body {
        return extractBody(
            ctx,
            body_ref,
            false,
            null,
            exception,
        );
    }

    pub fn extractWithInit(ctx: js.JSContextRef, body_ref: js.JSObjectRef, init_ref: js.JSValueRef, exception: js.ExceptionRef) Body {
        return extractBody(
            ctx,
            body_ref,
            true,
            init_ref,
            exception,
        );
    }

    // https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
    inline fn extractBody(
        ctx: js.JSContextRef,
        body_ref: js.JSObjectRef,
        comptime has_init: bool,
        init_ref: js.JSValueRef,
        exception: js.ExceptionRef,
    ) Body {
        var body = Body{
            .init = Init{ .headers = null, .status_code = 200 },
        };
        const value = JSC.JSValue.fromRef(body_ref);
        var allocator = getAllocator(ctx);

        if (comptime has_init) {
            if (Init.init(allocator, ctx, init_ref.?)) |maybeInit| {
                if (maybeInit) |init_| {
                    body.init = init_;
                }
            } else |_| {}
        }

        body.value = .{
            .Blob = Blob.fromJS(ctx.ptr(), value, true) catch |err| {
                if (err == error.InvalidArguments) {
                    JSC.JSError(allocator, "Expected an Array", .{}, ctx, exception);
                    return body;
                }

                JSC.JSError(allocator, "Out of memory", .{}, ctx, exception);
                return body;
            },
        };

        return body;
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Request
pub const Request = struct {
    url: ZigString = ZigString.Empty,
    headers: ?*Headers.RefCountedHeaders = null,
    body: Body.Value = Body.Value{ .Empty = .{} },
    method: Method = Method.GET,

    pub fn fromRequestContext(ctx: *RequestContext) !Request {
        var req = Request{
            .url = ZigString.init(std.mem.span(ctx.getFullURL())),
            .body = Body.Value.empty,
            .method = ctx.method,
            .headers = try Headers.RefCountedHeaders.init(Headers.fromRequestCtx(bun.default_allocator, ctx) catch unreachable, bun.default_allocator),
        };
        req.url.mark();
        return req;
    }

    pub fn mimeType(this: *const Request) string {
        if (this.headers) |headers_ref| {
            var headers = headers_ref.get();
            defer headers_ref.deref();
            // Remember, we always lowercase it
            // hopefully doesn't matter here tho
            if (headers.getHeaderIndex("content-type")) |content_type| {
                return headers.asStr(headers.entries.items(.value)[content_type]);
            }
        }

        switch (this.body) {
            .Blob => |blob| {
                if (blob.content_type.len > 0) {
                    return blob.content_type;
                }

                return MimeType.other.value;
            },
            .Used, .Locked, .Empty => return MimeType.other.value,
        }
    }

    pub const Class = NewClass(
        Request,
        .{
            .name = "Request",
            .read_only = true,
        },
        .{ .finalize = finalize, .constructor = constructor, .text = .{
            .rfn = Request.getText,
        }, .json = .{
            .rfn = Request.getJSON,
        }, .arrayBuffer = .{
            .rfn = Request.getArrayBuffer,
        }, .blob = .{
            .rfn = Request.getBlob,
        }, .clone = .{
            .rfn = Request.doClone,
        } },
        .{
            .@"cache" = .{
                .@"get" = getCache,
                .@"ro" = true,
            },
            .@"credentials" = .{
                .@"get" = getCredentials,
                .@"ro" = true,
            },
            .@"destination" = .{
                .@"get" = getDestination,
                .@"ro" = true,
            },
            .@"headers" = .{
                .@"get" = getHeaders,
                .@"ro" = true,
            },
            .@"integrity" = .{
                .@"get" = getIntegrity,
                .@"ro" = true,
            },
            .@"method" = .{
                .@"get" = getMethod,
                .@"ro" = true,
            },
            .@"mode" = .{
                .@"get" = getMode,
                .@"ro" = true,
            },
            .@"redirect" = .{
                .@"get" = getRedirect,
                .@"ro" = true,
            },
            .@"referrer" = .{
                .@"get" = getReferrer,
                .@"ro" = true,
            },
            .@"referrerPolicy" = .{
                .@"get" = getReferrerPolicy,
                .@"ro" = true,
            },
            .@"url" = .{
                .@"get" = getUrl,
                .@"ro" = true,
            },
            .@"bodyUsed" = .{
                .@"get" = getBodyUsed,
                .@"ro" = true,
            },
        },
    );

    pub fn getCache(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, ZigString.init(Properties.UTF8.default).toValueGC(ctx.ptr()).asRef());
    }
    pub fn getCredentials(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, ZigString.init(Properties.UTF8.include).toValueGC(ctx.ptr()).asRef());
    }
    pub fn getDestination(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, ZigString.init("").toValueGC(ctx.ptr()).asRef());
    }

    pub fn getIntegrity(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.Empty.toValueGC(ctx.ptr()).asRef();
    }
    pub fn getMethod(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        const string_contents: string = switch (this.method) {
            .GET => Properties.UTF8.GET,
            .HEAD => Properties.UTF8.HEAD,
            .PATCH => Properties.UTF8.PATCH,
            .PUT => Properties.UTF8.PUT,
            .POST => Properties.UTF8.POST,
            .OPTIONS => Properties.UTF8.OPTIONS,
            else => "",
        };

        return ZigString.init(string_contents).toValue(ctx.ptr()).asRef();
    }

    pub fn getMode(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(Properties.UTF8.navigate).toValue(ctx.ptr()).asRef();
    }

    pub fn finalize(this: *Request) void {
        if (this.headers) |headers| {
            headers.deref();
            this.headers = null;
        }

        bun.default_allocator.destroy(this);
    }

    pub fn getRedirect(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(Properties.UTF8.follow).toValueGC(ctx.ptr()).asRef();
    }
    pub fn getReferrer(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.headers) |headers_ref| {
            var headers = headers_ref.leak();
            if (headers.getHeaderIndex("referrer")) |i| {
                return ZigString.init(headers.asStr(headers.entries.get(i).value)).toValueGC(ctx.ptr()).asObjectRef();
            }
        }

        return ZigString.init("").toValueGC(ctx.ptr()).asRef();
    }
    pub fn getReferrerPolicy(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init("").toValueGC(ctx.ptr()).asRef();
    }
    pub fn getUrl(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return this.url.toValueGC(ctx.ptr()).asObjectRef();
    }

    pub fn constructor(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        var request = Request{};

        switch (arguments.len) {
            0 => {},
            1 => {
                request.url = JSC.JSValue.fromRef(arguments[0]).getZigString(ctx.ptr());
            },
            else => {
                request.url = JSC.JSValue.fromRef(arguments[0]).getZigString(ctx.ptr());

                if (Body.Init.init(getAllocator(ctx), ctx, arguments[1]) catch null) |req_init| {
                    request.headers = req_init.headers;
                    request.method = req_init.method;
                }

                if (JSC.JSValue.fromRef(arguments[1]).get(ctx.ptr(), "body")) |body_| {
                    if (Blob.fromJS(ctx.ptr(), body_, true)) |blob| {
                        if (blob.size > 0) {
                            request.body = Body.Value{ .Blob = blob };
                        }
                    } else |err| {
                        if (err == error.InvalidArguments) {
                            JSC.JSError(getAllocator(ctx), "Expected an Array", .{}, ctx, exception);
                            return null;
                        }

                        JSC.JSError(getAllocator(ctx), "Invalid Body", .{}, ctx, exception);
                        return null;
                    }
                }
            },
        }

        var request_ = getAllocator(ctx).create(Request) catch unreachable;
        request_.* = request;
        return Request.Class.make(
            ctx,
            request_,
        );
    }

    pub fn getBodyUsed(
        this: *Request,
        _: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return JSC.JSValue.jsBoolean(this.body == .Used).asRef();
    }

    pub usingnamespace BlobInterface(@This());

    pub fn doClone(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var cloned = this.clone(getAllocator(ctx));
        return Request.Class.make(ctx, cloned);
    }

    pub fn getHeaders(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.headers == null) {
            this.headers = Headers.RefCountedHeaders.init(Headers.empty(bun.default_allocator), bun.default_allocator) catch unreachable;
        }

        return Headers.Class.make(ctx, this.headers.?.getRef());
    }

    pub fn cloneInto(this: *const Request, req: *Request, allocator: std.mem.Allocator) void {
        req.* = Request{
            .body = this.body.clone(allocator),
            .url = ZigString.init(allocator.dupe(u8, this.url.slice()) catch unreachable),
        };
        if (this.headers) |head| {
            var new_headers = Headers.RefCountedHeaders.init(undefined, allocator) catch unreachable;
            head.leak().clone(&new_headers.value) catch unreachable;
            req.headers = new_headers;
        }
    }

    pub fn clone(this: *const Request, allocator: std.mem.Allocator) *Request {
        var req = allocator.create(Request) catch unreachable;
        this.cloneInto(req, allocator);
        return req;
    }
};

fn BlobInterface(comptime Type: type) type {
    return struct {
        pub fn getText(
            this: *Type,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var blob = this.body.use();
            return blob.getTextTransfer(ctx);
        }

        pub fn getJSON(
            this: *Type,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            var blob = this.body.use();
            return blob.getJSON(ctx, null, null, &.{}, exception);
        }
        pub fn getArrayBuffer(
            this: *Type,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var blob = this.body.use();
            return blob.getArrayBufferTransfer(ctx);
        }

        pub fn getBlob(
            this: *Type,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var blob = this.body.use();
            var ptr = getAllocator(ctx).create(Blob) catch unreachable;
            ptr.* = blob;
            blob.allocator = getAllocator(ctx);
            return JSC.JSPromise.resolvedPromiseValue(ctx.ptr(), JSValue.fromRef(Blob.Class.make(ctx, ptr))).asObjectRef();
        }
    };
}

// https://github.com/WebKit/WebKit/blob/main/Source/WebCore/workers/service/FetchEvent.h
pub const FetchEvent = struct {
    started_waiting_at: u64 = 0,
    response: ?*Response = null,
    request_context: ?*RequestContext = null,
    request: Request,
    pending_promise: ?*JSInternalPromise = null,

    onPromiseRejectionCtx: *anyopaque = undefined,
    onPromiseRejectionHandler: ?fn (ctx: *anyopaque, err: anyerror, fetch_event: *FetchEvent, value: JSValue) void = null,
    rejected: bool = false,

    pub const Class = NewClass(
        FetchEvent,
        .{
            .name = "FetchEvent",
            .read_only = true,
            .ts = .{ .class = d.ts.class{ .interface = true } },
        },
        .{
            .@"respondWith" = .{
                .rfn = respondWith,
                .ts = d.ts{
                    .tsdoc = "Render the response in the active HTTP request",
                    .@"return" = "void",
                    .args = &[_]d.ts.arg{
                        .{ .name = "response", .@"return" = "Response" },
                    },
                },
            },
            .@"waitUntil" = waitUntil,
            .finalize = finalize,
        },
        .{
            .@"client" = .{
                .@"get" = getClient,
                .ro = true,
                .ts = d.ts{
                    .tsdoc = "HTTP client metadata. This is not implemented yet, do not use.",
                    .@"return" = "undefined",
                },
            },
            .@"request" = .{
                .@"get" = getRequest,
                .ro = true,
                .ts = d.ts{
                    .tsdoc = "HTTP request",
                    .@"return" = "InstanceType<Request>",
                },
            },
        },
    );

    pub fn finalize(
        this: *FetchEvent,
    ) void {
        VirtualMachine.vm.allocator.destroy(this);
    }

    pub fn getClient(
        _: *FetchEvent,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        Output.prettyErrorln("FetchEvent.client is not implemented yet - sorry!!", .{});
        Output.flush();
        return js.JSValueMakeUndefined(ctx);
    }
    pub fn getRequest(
        this: *FetchEvent,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var req = bun.default_allocator.create(Request) catch unreachable;
        req.* = this.request;

        return Request.Class.make(
            ctx,
            req,
        );
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
    pub fn respondWith(
        this: *FetchEvent,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var request_context = this.request_context orelse return js.JSValueMakeUndefined(ctx);
        if (request_context.has_called_done) return js.JSValueMakeUndefined(ctx);
        var globalThis = ctx.ptr();

        // A Response or a Promise that resolves to a Response. Otherwise, a network error is returned to Fetch.
        if (arguments.len == 0 or !Response.Class.loaded or !js.JSValueIsObject(ctx, arguments[0])) {
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            request_context.sendInternalError(error.respondWithWasEmpty) catch {};
            return js.JSValueMakeUndefined(ctx);
        }

        var arg = arguments[0];

        if (!js.JSValueIsObjectOfClass(ctx, arg, Response.Class.ref)) {
            this.pending_promise = this.pending_promise orelse JSInternalPromise.resolvedPromise(globalThis, JSValue.fromRef(arguments[0]));
        }

        if (this.pending_promise) |promise| {
            VirtualMachine.vm.event_loop.waitForPromise(promise);

            switch (promise.status(ctx.ptr().vm())) {
                .Fulfilled => {},
                else => {
                    this.rejected = true;
                    this.pending_promise = null;
                    this.onPromiseRejectionHandler.?(
                        this.onPromiseRejectionCtx,
                        error.PromiseRejection,
                        this,
                        promise.result(globalThis.vm()),
                    );
                    return js.JSValueMakeUndefined(ctx);
                },
            }

            arg = promise.result(ctx.ptr().vm()).asRef();
        }

        if (!js.JSValueIsObjectOfClass(ctx, arg, Response.Class.ref)) {
            this.rejected = true;
            this.pending_promise = null;
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            this.onPromiseRejectionHandler.?(this.onPromiseRejectionCtx, error.RespondWithInvalidType, this, JSValue.fromRef(exception.*));

            return js.JSValueMakeUndefined(ctx);
        }

        var response: *Response = GetJSPrivateData(Response, arg) orelse {
            this.rejected = true;
            this.pending_promise = null;
            JSError(getAllocator(ctx), "event.respondWith()'s Response object was invalid. This may be an internal error.", .{}, ctx, exception);
            this.onPromiseRejectionHandler.?(this.onPromiseRejectionCtx, error.RespondWithInvalidTypeInternal, this, JSValue.fromRef(exception.*));
            return js.JSValueMakeUndefined(ctx);
        };

        defer {
            if (!VirtualMachine.vm.had_errors) {
                Output.printElapsed(@intToFloat(f64, (request_context.timer.lap())) / std.time.ns_per_ms);

                Output.prettyError(
                    " <b>{s}<r><d> - <b>{d}<r> <d>transpiled, <d><b>{d}<r> <d>imports<r>\n",
                    .{
                        request_context.matched_route.?.name,
                        VirtualMachine.vm.transpiled_count,
                        VirtualMachine.vm.resolved_count,
                    },
                );
            }
        }

        defer this.pending_promise = null;
        var needs_mime_type = true;
        var content_length: ?usize = null;
        if (response.body.init.headers) |headers_ref| {
            var headers = headers_ref.get();
            defer headers_ref.deref();
            request_context.clearHeaders() catch {};
            var i: usize = 0;
            while (i < headers.entries.len) : (i += 1) {
                var header = headers.entries.get(i);
                const name = headers.asStr(header.name);
                if (strings.eqlComptime(name, "content-type") and headers.asStr(header.value).len > 0) {
                    needs_mime_type = false;
                }

                if (strings.eqlComptime(name, "content-length")) {
                    content_length = std.fmt.parseInt(usize, headers.asStr(header.value), 10) catch null;
                    continue;
                }

                // Some headers need to be managed by bun
                if (strings.eqlComptime(name, "transfer-encoding") or
                    strings.eqlComptime(name, "content-encoding") or
                    strings.eqlComptime(name, "strict-transport-security") or
                    strings.eqlComptime(name, "content-security-policy"))
                {
                    continue;
                }

                request_context.appendHeaderSlow(
                    name,
                    headers.asStr(header.value),
                ) catch unreachable;
            }
        }

        if (needs_mime_type) {
            request_context.appendHeader("Content-Type", response.mimeTypeWithDefault(MimeType.html, request_context));
        }

        var blob = response.body.value.use();
        defer blob.deinit();

        const content_length_ = content_length orelse blob.size;

        if (content_length_ == 0) {
            request_context.sendNoContent() catch return js.JSValueMakeUndefined(ctx);
            return js.JSValueMakeUndefined(ctx);
        }

        if (FeatureFlags.strong_etags_for_built_files) {
            const did_send = request_context.writeETag(blob.sharedView()) catch false;
            if (did_send) {
                // defer getAllocator(ctx).destroy(str.ptr);
                return js.JSValueMakeUndefined(ctx);
            }
        }

        defer request_context.done();

        request_context.writeStatusSlow(response.body.init.status_code) catch return js.JSValueMakeUndefined(ctx);
        request_context.prepareToSendBody(content_length_, false) catch return js.JSValueMakeUndefined(ctx);

        request_context.writeBodyBuf(blob.sharedView()) catch return js.JSValueMakeUndefined(ctx);

        return js.JSValueMakeUndefined(ctx);
    }

    // our implementation of the event listener already does this
    // so this is a no-op for us
    pub fn waitUntil(
        _: *FetchEvent,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeUndefined(ctx);
    }
};
