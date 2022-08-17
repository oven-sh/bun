const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("../../global.zig");
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;
const AsyncIO = NetworkThread.AsyncIO;
const JSC = @import("javascript_core");
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = @import("../../global.zig").Output;
const MutableString = @import("../../global.zig").MutableString;
const strings = @import("../../global.zig").strings;
const string = @import("../../global.zig").string;
const default_allocator = @import("../../global.zig").default_allocator;
const FeatureFlags = @import("../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = JSC.Task;
const JSPrinter = @import("../../js_printer.zig");
const picohttp = @import("picohttp");
const StringJoiner = @import("../../string_joiner.zig");
const uws = @import("uws");

pub const Response = struct {
    pub usingnamespace JSC.Codegen.JSResponse;
    pub const Pool = struct {
        response_objects_pool: [127]JSC.JSValue = undefined,
        response_objects_used: u8 = 0,

        pub fn get(this: *Pool, ptr: *Response) ?JSValue {
            if (comptime JSC.is_bindgen)
                unreachable;
            if (this.response_objects_used > 0) {
                var result = this.response_objects_pool[this.response_objects_used - 1];
                this.response_objects_used -= 1;
                if (Response.dangerouslySetPtr(result, ptr)) {
                    return result;
                } else {
                    JSC.C.JSValueUnprotect(VirtualMachine.vm.global.ref(), result.asObjectRef());
                }
            }

            return null;
        }

        pub fn push(this: *Pool, globalThis: *JSC.JSGlobalObject, object: JSC.JSValue) void {
            var remaining = this.response_objects_pool[@minimum(this.response_objects_used, this.response_objects_pool.len)..];
            if (remaining.len == 0) {
                JSC.C.JSValueUnprotect(globalThis.ref(), object.asObjectRef());
                return;
            }

            if (object.as(Response)) |resp| {
                _ = Response.dangerouslySetPtr(object, null);

                _ = resp.body.use();
                resp.finalize();
                remaining[0] = object;
                this.response_objects_used += 1;
            }
        }
    };

    allocator: std.mem.Allocator,
    body: Body,
    url: string = "",
    status_text: string = "",
    redirected: bool = false,

    pub fn getBodyValue(
        this: *Response,
    ) *Body.Value {
        return &this.body.value;
    }

    pub inline fn statusCode(this: *const Response) u16 {
        return this.body.init.status_code;
    }

    pub fn redirectLocation(this: *const Response) ?[]const u8 {
        return this.header("location");
    }

    pub fn header(this: *const Response, comptime name: []const u8) ?[]const u8 {
        return (this.body.init.headers orelse return null).get(name);
    }

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

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("url: \"");
            try writer.print(comptime Output.prettyFmt("<r><b>{s}<r>", enable_ansi_colors), .{this.url});
            try writer.writeAll("\"");
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("statusText: ");
            try JSPrinter.writeJSONString(this.status_text, Writer, writer, .ascii);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("redirected: ");
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.redirected), .BooleanObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");
            try this.body.writeFormat(formatter, writer, enable_ansi_colors);
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
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return ZigString.init(this.url).toValueGC(globalThis);
    }

    pub fn getResponseType(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        if (this.body.init.status_code < 200) {
            return ZigString.init("error").toValue(globalThis);
        }

        return ZigString.init("basic").toValue(globalThis);
    }

    pub fn getBodyUsed(
        this: *Response,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.body.value == .Used);
    }

    pub fn getStatusText(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return ZigString.init(this.status_text).withEncoding().toValueGC(globalThis);
    }

    pub fn getOK(
        this: *Response,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        return JSValue.jsBoolean(this.isOK());
    }

    fn getOrCreateHeaders(this: *Response) *FetchHeaders {
        if (this.body.init.headers == null) {
            this.body.init.headers = FetchHeaders.createEmpty();
        }
        return this.body.init.headers.?;
    }

    pub fn getHeaders(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return this.getOrCreateHeaders().toJS(globalThis);
    }

    pub fn doClone(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var cloned = this.clone(getAllocator(globalThis), globalThis);
        const val = Response.makeMaybePooled(globalThis, cloned);
        if (this.body.init.headers) |headers| {
            cloned.body.init.headers = headers.cloneThis();
        }

        return val;
    }

    pub fn makeMaybePooled(globalObject: *JSC.JSGlobalObject, ptr: *Response) JSValue {
        return ptr.toJS(globalObject);
    }

    pub fn cloneInto(
        this: *const Response,
        new_response: *Response,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
    ) void {
        new_response.* = Response{
            .allocator = allocator,
            .body = this.body.clone(allocator, globalThis),
            .url = allocator.dupe(u8, this.url) catch unreachable,
            .status_text = allocator.dupe(u8, this.status_text) catch unreachable,
            .redirected = this.redirected,
        };
    }

    pub fn clone(this: *const Response, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) *Response {
        var new_response = allocator.create(Response) catch unreachable;
        this.cloneInto(new_response, allocator, globalThis);
        return new_response;
    }

    pub usingnamespace NewBlobInterface(@This());

    pub fn getStatus(
        this: *Response,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        return JSValue.jsNumber(this.body.init.status_code);
    }

    pub fn finalize(
        this: *Response,
    ) callconv(.C) void {
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
        if (response.header("content-type")) |content_type| {
            // Remember, we always lowercase it
            // hopefully doesn't matter here tho
            return content_type;
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
            .Used, .Locked, .Empty, .Error => return default.value,
        }
    }

    pub fn constructJSON(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args_list = callframe.arguments(2);
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args_list.ptr[0..args_list.len]);
        // var response = getAllocator(globalThis).create(Response) catch unreachable;

        var response = Response{
            .body = Body{
                .init = Body.Init{
                    .status_code = 200,
                },
                .value = Body.Value.empty,
            },
            .allocator = getAllocator(globalThis),
            .url = "",
        };

        const json_value = args.nextEat() orelse JSC.JSValue.zero;

        if (@enumToInt(json_value) != 0) {
            var zig_str = JSC.ZigString.init("");
            // calling JSON.stringify on an empty string adds extra quotes
            // so this is correct
            json_value.jsonStringify(globalThis.ptr(), 0, &zig_str);

            if (zig_str.len > 0) {
                var zig_str_slice = zig_str.toSlice(getAllocator(globalThis));

                if (zig_str_slice.allocated) {
                    response.body.value = .{
                        .Blob = Blob.initWithAllASCII(zig_str_slice.mut(), zig_str_slice.allocator, globalThis.ptr(), false),
                    };
                } else {
                    response.body.value = .{
                        .Blob = Blob.initWithAllASCII(getAllocator(globalThis).dupe(u8, zig_str_slice.slice()) catch unreachable, zig_str_slice.allocator, globalThis.ptr(), true),
                    };
                }
            }
        }

        if (args.nextEat()) |init| {
            if (init.isUndefinedOrNull()) {} else if (init.isNumber()) {
                response.body.init.status_code = @intCast(u16, @minimum(@maximum(0, init.toInt32()), std.math.maxInt(u16)));
            } else {
                if (Body.Init.init(getAllocator(globalThis), globalThis, init) catch null) |_init| {
                    response.body.init = _init;
                }
            }
        }

        var headers_ref = response.getOrCreateHeaders();
        headers_ref.putDefault("content-type", MimeType.json.value);
        var ptr = response.allocator.create(Response) catch unreachable;
        ptr.* = response;

        return ptr.toJS(globalThis);
    }
    pub fn constructRedirect(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var args_list = callframe.arguments(4);
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args_list.ptr[0..args_list.len]);
        // var response = getAllocator(globalThis).create(Response) catch unreachable;

        var response = Response{
            .body = Body{
                .init = Body.Init{
                    .status_code = 302,
                },
                .value = Body.Value.empty,
            },
            .allocator = getAllocator(globalThis),
            .url = "",
        };

        const url_string_value = args.nextEat() orelse JSC.JSValue.zero;
        var url_string = ZigString.init("");

        if (@enumToInt(url_string_value) != 0) {
            url_string = url_string_value.getZigString(globalThis.ptr());
        }
        var url_string_slice = url_string.toSlice(getAllocator(globalThis));
        defer url_string_slice.deinit();

        if (args.nextEat()) |init| {
            if (init.isUndefinedOrNull()) {} else if (init.isNumber()) {
                response.body.init.status_code = @intCast(u16, @minimum(@maximum(0, init.toInt32()), std.math.maxInt(u16)));
            } else {
                if (Body.Init.init(getAllocator(globalThis), globalThis, init) catch null) |_init| {
                    response.body.init = _init;
                    response.body.init.status_code = 302;
                }
            }
        }

        response.body.init.headers = response.getOrCreateHeaders();
        var headers_ref = response.body.init.headers.?;
        headers_ref.put("location", url_string_slice.slice());
        var ptr = response.allocator.create(Response) catch unreachable;
        ptr.* = response;

        return ptr.toJS(globalThis);
    }
    pub fn constructError(
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var response = getAllocator(globalThis).create(Response) catch unreachable;
        response.* = Response{
            .body = Body{
                .init = Body.Init{
                    .status_code = 0,
                },
                .value = Body.Value.empty,
            },
            .allocator = getAllocator(globalThis),
            .url = "",
        };

        return response.toJS(globalThis);
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Response {
        const args_list = callframe.arguments(4);
        const arguments = args_list.ptr[0..args_list.len];
        const body: Body = @as(?Body, brk: {
            switch (arguments.len) {
                0 => {
                    break :brk Body.@"200"(globalThis);
                },
                1 => {
                    break :brk Body.extract(globalThis, arguments[0]);
                },
                else => {
                    if (arguments[1].jsType().isObject()) {
                        break :brk Body.extractWithInit(globalThis, arguments[0], arguments[1]);
                    } else {
                        break :brk Body.extract(globalThis, arguments[0]);
                    }
                },
            }
            unreachable;
        }) orelse return null;

        var response = getAllocator(globalThis).create(Response) catch unreachable;
        response.* = Response{
            .body = body,
            .allocator = getAllocator(globalThis),
            .url = "",
        };
        return response;
    }
};

const null_fd = std.math.maxInt(JSC.Node.FileDescriptor);

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

    pub const FetchTasklet = struct {
        promise: *JSPromise = undefined,
        http: HTTPClient.AsyncHTTP = undefined,
        status: Status = Status.pending,
        javascript_vm: *VirtualMachine = undefined,
        global_this: *JSGlobalObject = undefined,

        empty_request_body: MutableString = undefined,

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
            if (comptime JSC.is_bindgen)
                unreachable;

            const globalThis = this.global_this;
            const promise = this.promise;
            const state = this.http.state.load(.Monotonic);
            const result = switch (state) {
                .success => this.onResolve(),
                .fail => this.onReject(),
                else => unreachable,
            };

            this.release();
            const promise_value = promise.asValue(globalThis);
            promise_value.unprotect();

            switch (state) {
                .success => {
                    promise.resolve(globalThis, result);
                },
                .fail => {
                    promise.reject(globalThis, result);
                },
                else => unreachable,
            }
        }

        pub fn reset(_: *FetchTasklet) void {}

        pub fn release(this: *FetchTasklet) void {
            this.global_this = undefined;
            this.javascript_vm = undefined;
            this.promise = undefined;
            this.status = Status.pending;
            // var pooled = this.pooled_body;
            // BodyPool.release(pooled);
            // this.pooled_body = undefined;
            this.http = undefined;

            Pool.release(@fieldParentPtr(Pool.Node, "data", this));
        }

        pub fn onReject(this: *FetchTasklet) JSValue {
            if (this.blob_store) |store| {
                this.blob_store = null;
                store.deref();
            }
            const fetch_error = std.fmt.allocPrint(
                default_allocator,
                "fetch() failed {s}\nurl: \"{s}\"",
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
                this.blob_store = null;
                store.deref();
            }
            response.* = Response{
                .allocator = allocator,
                .url = allocator.dupe(u8, this.http.url.href) catch unreachable,
                .status_text = allocator.dupe(u8, http_response.status) catch unreachable,
                .redirected = this.http.redirect_count > 0,
                .body = .{
                    .init = .{
                        .headers = FetchHeaders.createFromPicoHeaders(this.global_this, http_response.headers),
                        .status_code = @truncate(u16, http_response.status_code),
                    },
                    .value = .{
                        .Blob = Blob.init(this.http.response_buffer.toOwnedSliceLeaky(), allocator, this.global_this),
                    },
                },
            };
            return Response.makeMaybePooled(@ptrCast(js.JSContextRef, this.global_this), response);
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
            try NetworkThread.init();
            var node = try get(allocator, method, url, headers, headers_buf, request_body, timeout, request_body_store);

            node.data.global_this = global;
            node.data.http.callback = callback;
            var batch = NetworkThread.Batch{};
            node.data.http.schedule(allocator, &batch);
            NetworkThread.global.schedule(batch);
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
        _: js.ExceptionRef,
    ) js.JSObjectRef {
        var globalThis = ctx.ptr();

        if (arguments.len == 0) {
            const fetch_error = fetch_error_no_args;
            return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
        }

        var headers: ?Headers = null;
        var body: MutableString = MutableString.initEmpty(bun.default_allocator);
        var method = Method.GET;
        var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
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

            if (arguments.len >= 2 and arguments[1].?.value().isObject()) {
                var options = JSValue.fromRef(arguments[1]);
                if (options.fastGet(ctx.ptr(), .method)) |method_| {
                    var slice_ = method_.toSlice(ctx.ptr(), getAllocator(ctx));
                    defer slice_.deinit();
                    method = Method.which(slice_.slice()) orelse .GET;
                }

                if (options.fastGet(ctx.ptr(), .headers)) |headers_| {
                    if (headers_.as(FetchHeaders)) |headers__| {
                        headers = Headers.from(headers__, bun.default_allocator) catch unreachable;
                        // TODO: make this one pass
                    } else if (FetchHeaders.createFromJS(ctx.ptr(), headers_)) |headers__| {
                        headers = Headers.from(headers__, bun.default_allocator) catch unreachable;
                        headers__.deref();
                    }
                }

                if (options.fastGet(ctx.ptr(), .body)) |body__| {
                    if (Blob.fromJS(ctx.ptr(), body__, true, false)) |new_blob| {
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
        } else if (first_arg.as(Request)) |request| {
            url = ZigURL.parse(request.url.dupe(getAllocator(ctx)) catch unreachable);
            method = request.method;
            if (request.headers) |head| {
                headers = Headers.from(head, bun.default_allocator) catch unreachable;
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

        var header_entries: Headers.Entries = .{};
        var header_buf: string = "";

        if (headers) |head| {
            header_entries = head.entries;
            header_buf = head.buf.items;
        }

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
        const promise = JSC.JSPromise.create(ctx);
        queued.data.promise = promise;
        const promise_value = promise.asValue(ctx);
        promise_value.protect();

        return promise_value.asObjectRef();
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Headers
pub const Headers = struct {
    pub usingnamespace HTTPClient.Headers;
    entries: Headers.Entries = .{},
    buf: std.ArrayListUnmanaged(u8) = .{},
    allocator: std.mem.Allocator,

    pub fn asStr(this: *const Headers, ptr: Api.StringPointer) []const u8 {
        return if (ptr.offset + ptr.length <= this.buf.items.len)
            this.buf.items[ptr.offset..][0..ptr.length]
        else
            "";
    }

    pub fn from(headers_ref: *FetchHeaders, allocator: std.mem.Allocator) !Headers {
        var header_count: u32 = 0;
        var buf_len: u32 = 0;
        headers_ref.count(&header_count, &buf_len);
        var headers = Headers{
            .entries = .{},
            .buf = .{},
            .allocator = allocator,
        };
        headers.entries.ensureTotalCapacity(allocator, header_count) catch unreachable;
        headers.entries.len = header_count;
        headers.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch unreachable;
        headers.buf.items.len = buf_len;
        var sliced = headers.entries.slice();
        var names = sliced.items(.name);
        var values = sliced.items(.value);
        headers_ref.copyTo(names.ptr, values.ptr, headers.buf.items.ptr);
        return headers;
    }
};

const PathOrBlob = union(enum) {
    path: JSC.Node.PathOrFileDescriptor,
    blob: Blob,

    pub fn fromJS(ctx: js.JSContextRef, args: *JSC.Node.ArgumentsSlice, exception: js.ExceptionRef) ?PathOrBlob {
        if (JSC.Node.PathOrFileDescriptor.fromJS(ctx, args, exception)) |path| {
            return PathOrBlob{ .path = .{
                .path = .{
                    .string = bun.PathString.init((bun.default_allocator.dupeZ(u8, path.path.slice()) catch unreachable)[0..path.path.slice().len]),
                },
            } };
        }

        const arg = args.nextEat() orelse return null;

        if (arg.as(Blob)) |blob| {
            return PathOrBlob{
                .blob = blob.dupe(),
            };
        }

        return null;
    }
};

pub const Blob = struct {
    size: SizeType = 0,
    offset: SizeType = 0,
    /// When set, the blob will be freed on finalization callbacks
    /// If the blob is contained in Response or Request, this must be null
    allocator: ?std.mem.Allocator = null,
    store: ?*Store = null,
    content_type: string = "",
    content_type_allocated: bool = false,

    /// JavaScriptCore strings are either latin1 or UTF-16
    /// When UTF-16, they're nearly always due to non-ascii characters
    is_all_ascii: ?bool = null,

    globalThis: *JSGlobalObject = undefined,

    /// Max int of double precision
    /// 9 petabytes is probably enough for awhile
    /// We want to avoid coercing to a BigInt because that's a heap allocation
    /// and it's generally just harder to use
    pub const SizeType = u52;
    pub const max_size = std.math.maxInt(SizeType);

    pub fn isDetached(this: *const Blob) bool {
        return this.store == null;
    }

    pub fn writeFormat(this: *const Blob, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try formatter.writeIndent(Writer, writer);

        if (this.isDetached()) {
            try writer.writeAll(comptime Output.prettyFmt("<d>[<r>Blob<r> detached<d>]<r>", enable_ansi_colors));
            return;
        }

        var store = this.store.?;
        switch (store.data) {
            .file => |file| {
                try writer.writeAll(comptime Output.prettyFmt("<r>FileRef<r>", enable_ansi_colors));
                switch (file.pathlike) {
                    .path => |path| {
                        try writer.print(
                            comptime Output.prettyFmt(" (<green>\"{s}\"<r>)<r>", enable_ansi_colors),
                            .{
                                path.slice(),
                            },
                        );
                    },
                    .fd => |fd| {
                        try writer.print(
                            comptime Output.prettyFmt(" (<r>fd: <yellow>{d}<r>)<r>", enable_ansi_colors),
                            .{
                                fd,
                            },
                        );
                    },
                }
            },
            .bytes => {
                try writer.writeAll(comptime Output.prettyFmt("<r>Blob<r>", enable_ansi_colors));
                try writer.print(
                    comptime Output.prettyFmt(" (<yellow>{any}<r>)", enable_ansi_colors),
                    .{
                        bun.fmt.size(this.size),
                    },
                );
            },
        }

        if (this.content_type.len > 0 or this.offset > 0) {
            try writer.writeAll(" {\n");
            {
                formatter.indent += 1;
                defer formatter.indent -= 1;

                if (this.content_type.len > 0) {
                    try formatter.writeIndent(Writer, writer);
                    try writer.print(
                        comptime Output.prettyFmt("type: <green>\"{s}\"<r>", enable_ansi_colors),
                        .{
                            this.content_type,
                        },
                    );

                    if (this.offset > 0) {
                        formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                    }

                    try writer.writeAll("\n");
                }

                if (this.offset > 0) {
                    try formatter.writeIndent(Writer, writer);

                    try writer.print(
                        comptime Output.prettyFmt("offset: <yellow>{d}<r>\n", enable_ansi_colors),
                        .{
                            this.offset,
                        },
                    );
                }
            }

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("}");
        }
    }

    const CopyFilePromiseHandler = struct {
        promise: *JSPromise,
        globalThis: *JSGlobalObject,
        pub fn run(handler: *@This(), blob_: Store.CopyFile.ResultType) void {
            var promise = handler.promise;
            var globalThis = handler.globalThis;
            bun.default_allocator.destroy(handler);
            var blob = blob_ catch |err| {
                var error_string = ZigString.init(
                    std.fmt.allocPrint(bun.default_allocator, "Failed to write file \"{s}\"", .{std.mem.span(@errorName(err))}) catch unreachable,
                );
                error_string.mark();

                promise.reject(globalThis, error_string.toErrorInstance(globalThis));
                return;
            };
            var _blob = bun.default_allocator.create(Blob) catch unreachable;
            _blob.* = blob;
            _blob.allocator = bun.default_allocator;
            promise.resolve(
                globalThis,
            );
        }
    };

    const WriteFileWaitFromLockedValueTask = struct {
        file_blob: Blob,
        globalThis: *JSGlobalObject,
        promise: *JSPromise,

        pub fn thenWrap(this: *anyopaque, value: *Body.Value) void {
            then(bun.cast(*WriteFileWaitFromLockedValueTask, this), value);
        }

        pub fn then(this: *WriteFileWaitFromLockedValueTask, value: *Body.Value) void {
            var promise = this.promise;
            var globalThis = this.globalThis;
            var file_blob = this.file_blob;
            switch (value.*) {
                .Error => |err| {
                    file_blob.detach();
                    _ = value.use();
                    bun.default_allocator.destroy(this);
                    promise.reject(globalThis, err);
                },
                .Used => {
                    file_blob.detach();
                    _ = value.use();
                    bun.default_allocator.destroy(this);
                    promise.reject(globalThis, ZigString.init("Body was used after it was consumed").toErrorInstance(globalThis));
                },
                .Empty, .Blob => {
                    var blob = value.use();
                    // TODO: this should be one promise not two!
                    const new_promise = writeFileWithSourceDestination(globalThis.ref(), &blob, &file_blob);
                    if (JSC.JSValue.fromRef(new_promise.?).asPromise()) |_promise| {
                        switch (_promise.status(globalThis.vm())) {
                            .Pending => {
                                promise.resolve(
                                    globalThis,
                                    JSC.JSValue.fromRef(new_promise.?),
                                );
                            },
                            .Rejected => {
                                promise.reject(globalThis, _promise.result(globalThis.vm()));
                            },
                            else => {
                                promise.resolve(globalThis, _promise.result(globalThis.vm()));
                            },
                        }
                    } else if (JSC.JSValue.fromRef(new_promise.?).asInternalPromise()) |_promise| {
                        switch (_promise.status(globalThis.vm())) {
                            .Pending => {
                                promise.resolve(
                                    globalThis,
                                    JSC.JSValue.fromRef(new_promise.?),
                                );
                            },
                            .Rejected => {
                                promise.reject(globalThis, _promise.result(globalThis.vm()));
                            },
                            else => {
                                promise.resolve(globalThis, _promise.result(globalThis.vm()));
                            },
                        }
                    }

                    file_blob.detach();
                    bun.default_allocator.destroy(this);
                },
                .Locked => {
                    value.Locked.callback = thenWrap;
                    value.Locked.task = this;
                },
            }
        }
    };

    pub fn writeFileWithSourceDestination(
        ctx: JSC.C.JSContextRef,
        source_blob: *Blob,
        destination_blob: *Blob,
    ) js.JSObjectRef {
        const destination_type = std.meta.activeTag(destination_blob.store.?.data);

        // Writing an empty string to a file is a no-op
        if (source_blob.store == null) {
            destination_blob.detach();
            return JSC.JSPromise.resolvedPromiseValue(ctx.ptr(), JSC.JSValue.jsNumber(0)).asObjectRef();
        }

        const source_type = std.meta.activeTag(source_blob.store.?.data);

        if (destination_type == .file and source_type == .bytes) {
            var write_file_promise = bun.default_allocator.create(WriteFilePromise) catch unreachable;
            write_file_promise.* = .{
                .promise = JSC.JSPromise.create(ctx.ptr()),
                .globalThis = ctx.ptr(),
            };
            JSC.C.JSValueProtect(ctx, write_file_promise.promise.asValue(ctx.ptr()).asObjectRef());

            var file_copier = Store.WriteFile.create(
                bun.default_allocator,
                destination_blob.*,
                source_blob.*,
                *WriteFilePromise,
                write_file_promise,
                WriteFilePromise.run,
            ) catch unreachable;
            var task = Store.WriteFile.WriteFileTask.createOnJSThread(bun.default_allocator, ctx.ptr(), file_copier) catch unreachable;
            task.schedule();
            return write_file_promise.promise.asValue(ctx.ptr()).asObjectRef();
        }
        // If this is file <> file, we can just copy the file
        else if (destination_type == .file and source_type == .file) {
            var file_copier = Store.CopyFile.create(
                bun.default_allocator,
                destination_blob.store.?,
                source_blob.store.?,

                destination_blob.offset,
                destination_blob.size,
                ctx.ptr(),
            ) catch unreachable;
            file_copier.schedule();
            return file_copier.promise.asObjectRef();
        } else if (destination_type == .bytes and source_type == .bytes) {
            // If this is bytes <> bytes, we can just duplicate it
            // this is an edgecase
            // it will happen if someone did Bun.write(new Blob([123]), new Blob([456]))
            // eventually, this could be like Buffer.concat
            var clone = source_blob.dupe();
            clone.allocator = bun.default_allocator;
            var cloned = bun.default_allocator.create(Blob) catch unreachable;
            cloned.* = clone;
            return JSPromise.resolvedPromiseValue(ctx.ptr(), JSC.JSValue.fromRef(Blob.Class.make(ctx, cloned))).asObjectRef();
        } else if (destination_type == .bytes and source_type == .file) {
            return JSPromise.resolvedPromiseValue(
                ctx.ptr(),
                JSC.JSValue.fromRef(
                    source_blob.getSlice(ctx, undefined, undefined, &.{}, null),
                ),
            ).asObjectRef();
        }

        unreachable;
    }
    pub fn writeFile(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
        defer args.deinit();
        // accept a path or a blob
        var path_or_blob = PathOrBlob.fromJS(ctx, &args, exception) orelse {
            exception.* = JSC.toInvalidArguments("Bun.write expects a path, file descriptor or a blob", .{}, ctx).asObjectRef();
            return null;
        };

        // if path_or_blob is a path, convert it into a file blob
        var destination_blob: Blob = if (path_or_blob == .path)
            Blob.findOrCreateFileFromPath(path_or_blob.path, ctx.ptr())
        else
            path_or_blob.blob.dupe();

        if (destination_blob.store == null) {
            exception.* = JSC.toInvalidArguments("Writing to an empty blob is not implemented yet", .{}, ctx).asObjectRef();
            return null;
        }

        var data = args.nextEat() orelse {
            exception.* = JSC.toInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{}, ctx).asObjectRef();
            return null;
        };

        if (data.isUndefinedOrNull() or data.isEmpty()) {
            exception.* = JSC.toInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{}, ctx).asObjectRef();
            return null;
        }

        // TODO: implement a writeev() fast path
        var source_blob: Blob = brk: {
            if (data.as(Response)) |response| {
                switch (response.body.value) {
                    .Used, .Empty, .Blob => {
                        break :brk response.body.use();
                    },
                    .Error => {
                        destination_blob.detach();
                        const err = response.body.value.Error;
                        JSC.C.JSValueUnprotect(ctx, err.asObjectRef());
                        _ = response.body.value.use();
                        return JSC.JSPromise.rejectedPromiseValue(ctx.ptr(), err).asObjectRef();
                    },
                    .Locked => {
                        var task = bun.default_allocator.create(WriteFileWaitFromLockedValueTask) catch unreachable;
                        var promise = JSC.JSPromise.create(ctx.ptr());
                        task.* = WriteFileWaitFromLockedValueTask{
                            .globalThis = ctx.ptr(),
                            .file_blob = destination_blob,
                            .promise = promise,
                        };

                        response.body.value.Locked.task = task;
                        response.body.value.Locked.callback = WriteFileWaitFromLockedValueTask.thenWrap;

                        return promise.asValue(ctx.ptr()).asObjectRef();
                    },
                }
            }

            if (data.as(Request)) |request| {
                switch (request.body) {
                    .Used, .Empty, .Blob => {
                        break :brk request.body.use();
                    },
                    .Error => {
                        destination_blob.detach();
                        const err = request.body.Error;
                        JSC.C.JSValueUnprotect(ctx, err.asObjectRef());
                        _ = request.body.use();
                        return JSC.JSPromise.rejectedPromiseValue(ctx.ptr(), err).asObjectRef();
                    },
                    .Locked => {
                        var task = bun.default_allocator.create(WriteFileWaitFromLockedValueTask) catch unreachable;
                        var promise = JSC.JSPromise.create(ctx.ptr());
                        task.* = WriteFileWaitFromLockedValueTask{
                            .globalThis = ctx.ptr(),
                            .file_blob = destination_blob,
                            .promise = promise,
                        };

                        request.body.Locked.task = task;
                        request.body.Locked.callback = WriteFileWaitFromLockedValueTask.thenWrap;

                        return promise.asValue(ctx.ptr()).asObjectRef();
                    },
                }
            }

            break :brk Blob.fromJS(
                ctx.ptr(),
                data,
                false,
                false,
            ) catch |err| {
                if (err == error.InvalidArguments) {
                    exception.* = JSC.toInvalidArguments(
                        "Expected an Array",
                        .{},
                        ctx,
                    ).asObjectRef();
                    return null;
                }

                exception.* = JSC.toInvalidArguments(
                    "Out of memory",
                    .{},
                    ctx,
                ).asObjectRef();
                return null;
            };
        };

        return writeFileWithSourceDestination(ctx, &source_blob, &destination_blob);
    }

    pub fn constructFile(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
        defer args.deinit();

        var path = JSC.Node.PathOrFileDescriptor.fromJS(ctx, &args, exception) orelse {
            exception.* = JSC.toInvalidArguments("Expected file path string or file descriptor", .{}, ctx).asObjectRef();
            return js.JSValueMakeUndefined(ctx);
        };

        const blob = Blob.findOrCreateFileFromPath(path, ctx.ptr());

        var ptr = bun.default_allocator.create(Blob) catch unreachable;
        ptr.* = blob;
        ptr.allocator = bun.default_allocator;
        return Blob.Class.make(ctx, ptr);
    }

    pub fn findOrCreateFileFromPath(path_: JSC.Node.PathOrFileDescriptor, globalThis: *JSGlobalObject) Blob {
        var path = path_;
        var vm = globalThis.bunVM();
        if (vm.getFileBlob(path)) |blob| {
            blob.ref();
            return Blob.initWithStore(blob, globalThis);
        }

        switch (path) {
            .path => {
                path.path = .{
                    .string = bun.PathString.init(
                        (bun.default_allocator.dupeZ(u8, path.path.slice()) catch unreachable)[0..path.path.slice().len],
                    ),
                };
            },
            .fd => {
                switch (path.fd) {
                    std.os.STDIN_FILENO => return Blob.initWithStore(
                        vm.rareData().stdin(),
                        globalThis,
                    ),
                    std.os.STDERR_FILENO => return Blob.initWithStore(
                        vm.rareData().stderr(),
                        globalThis,
                    ),
                    std.os.STDOUT_FILENO => return Blob.initWithStore(
                        vm.rareData().stdout(),
                        globalThis,
                    ),
                    else => {},
                }
            },
        }

        const result = Blob.initWithStore(Blob.Store.initFile(path, null, bun.default_allocator) catch unreachable, globalThis);
        vm.putFileBlob(path, result.store.?) catch unreachable;
        return result;
    }

    pub const Store = struct {
        data: Data,

        mime_type: MimeType = MimeType.other,
        ref_count: u32 = 0,
        is_all_ascii: ?bool = null,
        allocator: std.mem.Allocator,

        pub fn size(this: *const Store) SizeType {
            return switch (this.data) {
                .bytes => this.data.bytes.len,
                .file => Blob.max_size,
            };
        }

        pub const Map = std.HashMap(u64, *JSC.WebCore.Blob.Store, IdentityContext(u64), 80);

        pub const Data = union(enum) {
            bytes: ByteStore,
            file: FileStore,
        };

        pub fn ref(this: *Store) void {
            this.ref_count += 1;
        }

        pub fn external(ptr: ?*anyopaque, _: ?*anyopaque, _: usize) callconv(.C) void {
            if (ptr == null) return;
            var this = bun.cast(*Store, ptr);
            this.deref();
        }

        pub fn initFile(pathlike: JSC.Node.PathOrFileDescriptor, mime_type: ?HTTPClient.MimeType, allocator: std.mem.Allocator) !*Store {
            var store = try allocator.create(Blob.Store);
            store.* = .{
                .data = .{ .file = FileStore.init(
                    pathlike,
                    mime_type orelse brk: {
                        if (pathlike == .path) {
                            const sliced = pathlike.path.slice();
                            if (sliced.len > 0) {
                                var extname = std.fs.path.extension(sliced);
                                extname = std.mem.trim(u8, extname, ".");
                                if (HTTPClient.MimeType.byExtensionNoDefault(extname)) |mime| {
                                    break :brk mime;
                                }
                            }
                        }

                        break :brk null;
                    },
                ) },
                .allocator = allocator,
                .ref_count = 1,
            };
            return store;
        }

        pub fn init(bytes: []u8, allocator: std.mem.Allocator) !*Store {
            var store = try allocator.create(Blob.Store);
            store.* = .{
                .data = .{ .bytes = ByteStore.init(bytes, allocator) },
                .allocator = allocator,
                .ref_count = 1,
            };
            return store;
        }

        pub fn sharedView(this: Store) []u8 {
            if (this.data == .bytes)
                return this.data.bytes.slice();

            return &[_]u8{};
        }

        pub fn deref(this: *Blob.Store) void {
            this.ref_count -= 1;
            if (this.ref_count == 0) {
                this.deinit();
            }
        }

        pub fn deinit(this: *Blob.Store) void {
            switch (this.data) {
                .bytes => |*bytes| {
                    bytes.deinit();
                },
                .file => |file| {
                    VirtualMachine.vm.removeFileBlob(file.pathlike);
                },
            }

            this.allocator.destroy(this);
        }

        pub fn fromArrayList(list: std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator) !*Blob.Store {
            return try Blob.Store.init(list.items, allocator);
        }

        pub fn FileOpenerMixin(comptime This: type) type {
            return struct {
                const __opener_flags = std.os.O.NONBLOCK | std.os.O.CLOEXEC;
                const open_flags_ = if (@hasDecl(This, "open_flags"))
                    This.open_flags | __opener_flags
                else
                    std.os.O.RDONLY | __opener_flags;

                pub fn getFdMac(this: *This) AsyncIO.OpenError!JSC.Node.FileDescriptor {
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var path_string = if (@hasField(This, "file_store"))
                        this.file_store.pathlike.path
                    else
                        this.file_blob.store.?.data.file.pathlike.path;

                    var path = path_string.sliceZ(&buf);

                    this.opened_fd = switch (JSC.Node.Syscall.open(path, open_flags_, JSC.Node.default_permission)) {
                        .result => |fd| fd,
                        .err => |err| {
                            this.errno = AsyncIO.asError(err.errno);
                            this.system_error = err.withPath(path_string.slice()).toSystemError();

                            return @errSetCast(AsyncIO.OpenError, this.errno.?);
                        },
                    };

                    return this.opened_fd;
                }

                pub fn getFd(this: *This) AsyncIO.OpenError!JSC.Node.FileDescriptor {
                    if (this.opened_fd != null_fd) {
                        return this.opened_fd;
                    }

                    if (comptime Environment.isMac) {
                        return try this.getFdMac();
                    } else {
                        return try this.getFdLinux();
                    }
                }

                pub fn getFdLinux(this: *This) AsyncIO.OpenError!JSC.Node.FileDescriptor {
                    var aio = &AsyncIO.global;

                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var path_string = if (@hasField(This, "file_store"))
                        this.file_store.pathlike.path
                    else
                        this.file_blob.store.?.data.file.pathlike.path;

                    var path = path_string.sliceZ(&buf);

                    aio.open(
                        *This,
                        this,
                        onOpen,
                        &this.open_completion,
                        path,
                        open_flags_,
                        JSC.Node.default_permission,
                    );

                    suspend {
                        this.open_frame = @frame().*;
                    }

                    if (this.errno) |errno| {
                        this.system_error = .{
                            .syscall = ZigString.init("open"),
                            .code = ZigString.init(std.mem.span(@errorName(errno))),
                            .path = ZigString.init(path_string.slice()),
                        };

                        return @errSetCast(AsyncIO.OpenError, errno);
                    }

                    return this.opened_fd;
                }

                pub fn onOpen(this: *This, completion: *HTTPClient.NetworkThread.Completion, result: AsyncIO.OpenError!JSC.Node.FileDescriptor) void {
                    this.opened_fd = result catch {
                        this.errno = AsyncIO.asError(-completion.result);

                        if (comptime Environment.isLinux) resume this.open_frame;
                        return;
                    };

                    if (comptime Environment.isLinux) resume this.open_frame;
                }
            };
        }

        pub fn FileCloserMixin(comptime This: type) type {
            return struct {
                pub fn doClose(this: *This) AsyncIO.CloseError!void {
                    var aio = &AsyncIO.global;

                    aio.close(
                        *This,
                        this,
                        onClose,
                        &this.close_completion,
                        this.opened_fd,
                    );
                    this.opened_fd = null_fd;

                    suspend {
                        this.close_frame = @frame().*;
                    }

                    if (@hasField(This, "errno")) {
                        if (this.errno) |errno| {
                            return @errSetCast(AsyncIO.CloseError, errno);
                        }
                    }
                }

                pub fn onClose(this: *This, _: *HTTPClient.NetworkThread.Completion, result: AsyncIO.CloseError!void) void {
                    result catch |err| {
                        if (@hasField(This, "errno")) {
                            this.errno = err;
                        }
                        resume this.close_frame;
                        return;
                    };

                    resume this.close_frame;
                }
            };
        }

        pub const ReadFile = struct {
            const OpenFrameType = if (Environment.isMac)
                void
            else
                @Frame(ReadFile.getFdLinux);
            file_store: FileStore,
            byte_store: ByteStore = ByteStore{ .allocator = bun.default_allocator },
            store: ?*Store = null,
            offset: SizeType = 0,
            max_length: SizeType = Blob.max_size,
            open_frame: OpenFrameType = undefined,
            read_frame: @Frame(ReadFile.doRead) = undefined,
            close_frame: @Frame(ReadFile.doClose) = undefined,
            open_completion: HTTPClient.NetworkThread.Completion = undefined,
            opened_fd: JSC.Node.FileDescriptor = null_fd,
            read_completion: HTTPClient.NetworkThread.Completion = undefined,
            read_len: SizeType = 0,
            read_off: SizeType = 0,
            size: SizeType = 0,
            buffer: []u8 = undefined,
            runAsyncFrame: @Frame(ReadFile.runAsync) = undefined,
            close_completion: HTTPClient.NetworkThread.Completion = undefined,
            task: HTTPClient.NetworkThread.Task = undefined,
            system_error: ?JSC.SystemError = null,
            errno: ?anyerror = null,
            onCompleteCtx: *anyopaque = undefined,
            onCompleteCallback: OnReadFileCallback = undefined,

            convert_to_byte_blob: bool = false,

            pub const Read = struct {
                buf: []u8,
                is_temporary: bool = false,
            };
            pub const ResultType = SystemError.Maybe(Read);

            pub const OnReadFileCallback = fn (ctx: *anyopaque, bytes: ResultType) void;

            pub usingnamespace FileOpenerMixin(ReadFile);
            pub usingnamespace FileCloserMixin(ReadFile);

            pub fn createWithCtx(
                allocator: std.mem.Allocator,
                store: *Store,
                onReadFileContext: *anyopaque,
                onCompleteCallback: OnReadFileCallback,
                off: SizeType,
                max_len: SizeType,
            ) !*ReadFile {
                var read_file = try allocator.create(ReadFile);
                read_file.* = ReadFile{
                    .file_store = store.data.file,
                    .offset = off,
                    .max_length = max_len,
                    .store = store,
                    .onCompleteCtx = onReadFileContext,
                    .onCompleteCallback = onCompleteCallback,
                };
                store.ref();
                return read_file;
            }

            pub fn create(
                allocator: std.mem.Allocator,
                store: *Store,
                off: SizeType,
                max_len: SizeType,
                comptime Context: type,
                context: Context,
                comptime callback: fn (ctx: Context, bytes: ResultType) void,
            ) !*ReadFile {
                const Handler = struct {
                    pub fn run(ptr: *anyopaque, bytes: ResultType) void {
                        callback(bun.cast(Context, ptr), bytes);
                    }
                };

                return try ReadFile.createWithCtx(allocator, store, @ptrCast(*anyopaque, context), Handler.run, off, max_len);
            }

            pub fn doRead(this: *ReadFile) AsyncIO.ReadError!SizeType {
                var aio = &AsyncIO.global;

                var remaining = this.buffer[this.read_off..];
                this.read_len = 0;
                aio.read(
                    *ReadFile,
                    this,
                    onRead,
                    &this.read_completion,
                    this.opened_fd,
                    remaining[0..@minimum(remaining.len, this.max_length - this.read_off)],
                    this.offset + this.read_off,
                );

                suspend {
                    this.read_frame = @frame().*;
                }

                if (this.errno) |errno| {
                    this.system_error = JSC.SystemError{
                        .code = ZigString.init(std.mem.span(@errorName(errno))),
                        .path = if (this.file_store.pathlike == .path)
                            ZigString.init(this.file_store.pathlike.path.slice())
                        else
                            ZigString.Empty,
                        .syscall = ZigString.init("read"),
                    };

                    return @errSetCast(AsyncIO.ReadError, errno);
                }

                return this.read_len;
            }

            pub const ReadFileTask = JSC.IOTask(@This());

            pub fn then(this: *ReadFile, _: *JSC.JSGlobalObject) void {
                var cb = this.onCompleteCallback;
                var cb_ctx = this.onCompleteCtx;

                if (this.store == null and this.system_error != null) {
                    var system_error = this.system_error.?;
                    bun.default_allocator.destroy(this);
                    cb(cb_ctx, ResultType{ .err = system_error });
                    return;
                } else if (this.store == null) {
                    bun.default_allocator.destroy(this);
                    cb(cb_ctx, ResultType{ .err = SystemError{
                        .code = ZigString.init("INTERNAL_ERROR"),
                        .path = ZigString.Empty,
                        .message = ZigString.init("assertion failure - store should not be null"),
                        .syscall = ZigString.init("read"),
                    } });
                    return;
                }
                var store = this.store.?;

                if (this.convert_to_byte_blob and this.file_store.pathlike == .path) {
                    VirtualMachine.vm.removeFileBlob(this.file_store.pathlike);
                }

                if (this.system_error) |err| {
                    bun.default_allocator.destroy(this);
                    store.deref();
                    cb(cb_ctx, ResultType{ .err = err });
                    return;
                }

                var buf = this.buffer;
                const is_temporary = !this.convert_to_byte_blob;
                if (this.convert_to_byte_blob) {
                    if (store.data == .bytes) {
                        bun.default_allocator.free(this.buffer);
                        buf = store.data.bytes.slice();
                    } else if (store.data == .file) {
                        if (this.file_store.pathlike == .path) {
                            if (this.file_store.pathlike.path == .string) {
                                bun.default_allocator.free(this.file_store.pathlike.path.slice());
                            }
                        }
                        store.data = .{ .bytes = ByteStore.init(buf, bun.default_allocator) };
                    }
                }

                bun.default_allocator.destroy(this);

                // Attempt to free it as soon as possible
                if (store.ref_count > 1) {
                    store.deref();
                    cb(cb_ctx, .{ .result = .{ .buf = buf, .is_temporary = is_temporary } });
                } else {
                    cb(cb_ctx, .{ .result = .{ .buf = buf, .is_temporary = is_temporary } });
                    store.deref();
                }
            }
            pub fn run(this: *ReadFile, task: *ReadFileTask) void {
                var frame = HTTPClient.getAllocator().create(@Frame(runAsync)) catch unreachable;
                _ = @asyncCall(std.mem.asBytes(frame), undefined, runAsync, .{ this, task });
            }

            pub fn onRead(this: *ReadFile, completion: *HTTPClient.NetworkThread.Completion, result: AsyncIO.ReadError!usize) void {
                this.read_len = @truncate(SizeType, result catch |err| {
                    if (@hasField(HTTPClient.NetworkThread.Completion, "result")) {
                        this.errno = AsyncIO.asError(-completion.result);
                        this.system_error = (JSC.Node.Syscall.Error{
                            .errno = @intCast(JSC.Node.Syscall.Error.Int, -completion.result),
                            .syscall = .read,
                        }).toSystemError();
                    } else {
                        this.errno = err;
                        this.system_error = .{ .code = ZigString.init(std.mem.span(@errorName(err))), .syscall = ZigString.init("read") };
                    }
                    this.read_len = 0;
                    resume this.read_frame;
                    return;
                });

                resume this.read_frame;
            }

            fn runAsync(this: *ReadFile, task: *ReadFileTask) void {
                this.runAsync_();
                task.onFinish();

                suspend {
                    HTTPClient.getAllocator().destroy(@frame());
                }
            }

            fn runAsync_(this: *ReadFile) void {
                if (this.file_store.pathlike == .fd) {
                    this.opened_fd = this.file_store.pathlike.fd;
                }

                const fd = this.getFd() catch return;
                const needs_close = this.file_store.pathlike == .path and fd != null_fd and fd > 2;
                const stat: std.os.Stat = switch (JSC.Node.Syscall.fstat(fd)) {
                    .result => |result| result,
                    .err => |err| {
                        this.errno = AsyncIO.asError(err.errno);
                        this.system_error = err.toSystemError();
                        return;
                    },
                };
                if (std.os.S.ISDIR(stat.mode)) {
                    this.errno = error.EISDIR;
                    this.system_error = JSC.SystemError{
                        .code = ZigString.init("EISDIR"),
                        .path = if (this.file_store.pathlike == .path)
                            ZigString.init(this.file_store.pathlike.path.slice())
                        else
                            ZigString.Empty,
                        .message = ZigString.init("Directories cannot be read like files"),
                        .syscall = ZigString.init("read"),
                    };
                    return;
                }

                if (stat.size > 0 and std.os.S.ISREG(stat.mode)) {
                    this.size = @minimum(
                        @truncate(SizeType, @intCast(SizeType, @maximum(@intCast(i64, stat.size), 0))),
                        this.max_length,
                    );
                    // read up to 4k at a time if
                    // they didn't explicitly set a size and we're reading from something that's not a regular file
                } else if (stat.size == 0 and !std.os.S.ISREG(stat.mode)) {
                    this.size = if (this.max_length == Blob.max_size)
                        4096
                    else
                        this.max_length;
                }

                if (this.size == 0) {
                    this.buffer = &[_]u8{};
                    this.byte_store = ByteStore.init(this.buffer, bun.default_allocator);

                    if (needs_close) {
                        this.doClose() catch {};
                    }
                    return;
                }

                var bytes = bun.default_allocator.alloc(u8, this.size) catch |err| {
                    this.errno = err;
                    if (needs_close) {
                        this.doClose() catch {};
                    }
                    return;
                };
                this.buffer = bytes;
                this.convert_to_byte_blob = std.os.S.ISREG(stat.mode) and this.file_store.pathlike == .path;

                var remain = bytes;
                while (remain.len > 0) {
                    var read_len = this.doRead() catch {
                        if (needs_close) {
                            this.doClose() catch {};
                        }
                        return;
                    };
                    this.read_off += read_len;
                    if (read_len == 0) break;
                    remain = remain[read_len..];
                }

                _ = bun.default_allocator.resize(bytes, this.read_off);
                this.buffer = bytes[0..this.read_off];
                this.byte_store = ByteStore.init(this.buffer, bun.default_allocator);
            }
        };

        pub const WriteFile = struct {
            const OpenFrameType = if (Environment.isMac)
                void
            else
                @Frame(WriteFile.getFdLinux);

            file_blob: Blob,
            bytes_blob: Blob,

            opened_fd: JSC.Node.FileDescriptor = null_fd,
            open_frame: OpenFrameType = undefined,
            write_frame: @Frame(WriteFile.doWrite) = undefined,
            close_frame: @Frame(WriteFile.doClose) = undefined,
            system_error: ?JSC.SystemError = null,
            errno: ?anyerror = null,
            open_completion: HTTPClient.NetworkThread.Completion = undefined,
            write_completion: HTTPClient.NetworkThread.Completion = undefined,
            close_completion: HTTPClient.NetworkThread.Completion = undefined,
            task: HTTPClient.NetworkThread.Task = undefined,

            onCompleteCtx: *anyopaque = undefined,
            onCompleteCallback: OnWriteFileCallback = undefined,
            wrote: usize = 0,

            pub const ResultType = SystemError.Maybe(SizeType);
            pub const OnWriteFileCallback = fn (ctx: *anyopaque, count: ResultType) void;

            pub usingnamespace FileOpenerMixin(WriteFile);
            pub usingnamespace FileCloserMixin(WriteFile);

            // Do not open with APPEND because we may use pwrite()
            pub const open_flags = std.os.O.WRONLY | std.os.O.CREAT | std.os.O.TRUNC;

            pub fn createWithCtx(
                allocator: std.mem.Allocator,
                file_blob: Blob,
                bytes_blob: Blob,
                onWriteFileContext: *anyopaque,
                onCompleteCallback: OnWriteFileCallback,
            ) !*WriteFile {
                var read_file = try allocator.create(WriteFile);
                read_file.* = WriteFile{
                    .file_blob = file_blob,
                    .bytes_blob = bytes_blob,
                    .onCompleteCtx = onWriteFileContext,
                    .onCompleteCallback = onCompleteCallback,
                };
                file_blob.store.?.ref();
                bytes_blob.store.?.ref();
                return read_file;
            }

            pub fn create(
                allocator: std.mem.Allocator,
                file_blob: Blob,
                bytes_blob: Blob,
                comptime Context: type,
                context: Context,
                comptime callback: fn (ctx: Context, bytes: ResultType) void,
            ) !*WriteFile {
                const Handler = struct {
                    pub fn run(ptr: *anyopaque, bytes: ResultType) void {
                        callback(bun.cast(Context, ptr), bytes);
                    }
                };

                return try WriteFile.createWithCtx(
                    allocator,
                    file_blob,
                    bytes_blob,
                    @ptrCast(*anyopaque, context),
                    Handler.run,
                );
            }

            pub fn doWrite(
                this: *WriteFile,
                buffer: []const u8,
                file_offset: u64,
            ) AsyncIO.WriteError!SizeType {
                var aio = &AsyncIO.global;
                this.wrote = 0;
                const fd = this.opened_fd;
                aio.write(
                    *WriteFile,
                    this,
                    onWrite,
                    &this.write_completion,
                    fd,
                    buffer,
                    if (fd > 2) file_offset else 0,
                );

                suspend {
                    this.write_frame = @frame().*;
                }

                if (this.errno) |errno| {
                    this.system_error = this.system_error orelse JSC.SystemError{
                        .code = ZigString.init(std.mem.span(@errorName(errno))),
                        .syscall = ZigString.init("write"),
                    };
                    return @errSetCast(AsyncIO.WriteError, errno);
                }

                return @truncate(SizeType, this.wrote);
            }

            pub const WriteFileTask = JSC.IOTask(@This());

            pub fn then(this: *WriteFile, _: *JSC.JSGlobalObject) void {
                var cb = this.onCompleteCallback;
                var cb_ctx = this.onCompleteCtx;

                this.bytes_blob.store.?.deref();
                this.file_blob.store.?.deref();

                if (this.system_error) |err| {
                    bun.default_allocator.destroy(this);
                    cb(cb_ctx, .{
                        .err = err,
                    });
                    return;
                }

                const wrote = this.wrote;
                bun.default_allocator.destroy(this);
                cb(cb_ctx, .{ .result = @truncate(SizeType, wrote) });
            }
            pub fn run(this: *WriteFile, task: *WriteFileTask) void {
                var frame = HTTPClient.getAllocator().create(@Frame(runAsync)) catch unreachable;
                _ = @asyncCall(std.mem.asBytes(frame), undefined, runAsync, .{ this, task });
            }

            fn runAsync(this: *WriteFile, task: *WriteFileTask) void {
                this._runAsync();
                task.onFinish();
                suspend {
                    HTTPClient.getAllocator().destroy(@frame());
                }
            }

            pub fn onWrite(this: *WriteFile, _: *HTTPClient.NetworkThread.Completion, result: AsyncIO.WriteError!usize) void {
                this.wrote += @truncate(SizeType, result catch |err| {
                    this.errno = err;
                    this.wrote = 0;
                    resume this.write_frame;
                    return;
                });

                resume this.write_frame;
            }

            fn _runAsync(this: *WriteFile) void {
                const file = this.file_blob.store.?.data.file;
                if (file.pathlike == .fd) {
                    this.opened_fd = file.pathlike.fd;
                }

                const fd = this.getFd() catch return;
                const needs_close = file.pathlike == .path and fd > 2;

                var remain = this.bytes_blob.sharedView();

                var total_written: usize = 0;
                var file_offset = this.file_blob.offset;

                const end =
                    @minimum(this.file_blob.size, remain.len);

                while (remain.len > 0 and total_written < end) {
                    const wrote_len = this.doWrite(remain, file_offset) catch {
                        if (needs_close) {
                            this.doClose() catch {};
                        }
                        this.wrote = @truncate(SizeType, total_written);
                        return;
                    };
                    remain = remain[wrote_len..];
                    total_written += wrote_len;
                    file_offset += wrote_len;
                    if (wrote_len == 0) break;
                }

                this.wrote = @truncate(SizeType, total_written);

                if (needs_close) {
                    this.doClose() catch {};
                }
            }
        };

        pub const IOWhich = enum {
            source,
            destination,
            both,
        };

        const unsupported_directory_error = SystemError{
            .errno = @intCast(c_int, @enumToInt(bun.C.SystemErrno.EISDIR)),
            .message = ZigString.init("That doesn't work on folders"),
            .syscall = ZigString.init("fstat"),
        };
        const unsupported_non_regular_file_error = SystemError{
            .errno = @intCast(c_int, @enumToInt(bun.C.SystemErrno.ENOTSUP)),
            .message = ZigString.init("Non-regular files aren't supported yet"),
            .syscall = ZigString.init("fstat"),
        };

        // blocking, but off the main thread
        pub const CopyFile = struct {
            destination_file_store: FileStore,
            source_file_store: FileStore,
            store: ?*Store = null,
            source_store: ?*Store = null,
            offset: SizeType = 0,
            size: SizeType = 0,
            max_length: SizeType = Blob.max_size,
            destination_fd: JSC.Node.FileDescriptor = null_fd,
            source_fd: JSC.Node.FileDescriptor = null_fd,

            system_error: ?SystemError = null,

            read_len: SizeType = 0,
            read_off: SizeType = 0,

            globalThis: *JSGlobalObject,

            pub const ResultType = anyerror!SizeType;

            pub const Callback = fn (ctx: *anyopaque, len: ResultType) void;
            pub const CopyFilePromiseTask = JSC.ConcurrentPromiseTask(CopyFile);
            pub const CopyFilePromiseTaskEventLoopTask = CopyFilePromiseTask.EventLoopTask;

            pub fn create(
                allocator: std.mem.Allocator,
                store: *Store,
                source_store: *Store,
                off: SizeType,
                max_len: SizeType,
                globalThis: *JSC.JSGlobalObject,
            ) !*CopyFilePromiseTask {
                var read_file = try allocator.create(CopyFile);
                read_file.* = CopyFile{
                    .store = store,
                    .source_store = source_store,
                    .offset = off,
                    .max_length = max_len,
                    .globalThis = globalThis,
                    .destination_file_store = store.data.file,
                    .source_file_store = source_store.data.file,
                };
                store.ref();
                source_store.ref();
                return try CopyFilePromiseTask.createOnJSThread(allocator, globalThis, read_file);
            }

            const linux = std.os.linux;
            const darwin = std.os.darwin;

            pub fn deinit(this: *CopyFile) void {
                if (this.source_file_store.pathlike == .path) {
                    if (this.source_file_store.pathlike.path == .string and this.system_error == null) {
                        bun.default_allocator.free(bun.constStrToU8(this.source_file_store.pathlike.path.slice()));
                    }
                }
                this.store.?.deref();

                bun.default_allocator.destroy(this);
            }

            pub fn reject(this: *CopyFile, promise: *JSC.JSInternalPromise) void {
                var globalThis = this.globalThis;
                var system_error: SystemError = this.system_error orelse SystemError{};
                if (this.source_file_store.pathlike == .path and system_error.path.len == 0) {
                    system_error.path = ZigString.init(this.source_file_store.pathlike.path.slice());
                    system_error.path.mark();
                }

                if (system_error.message.len == 0) {
                    system_error.message = ZigString.init("Failed to copy file");
                }

                var instance = system_error.toErrorInstance(this.globalThis);
                if (this.store) |store| {
                    store.deref();
                }
                promise.reject(globalThis, instance);
            }

            pub fn then(this: *CopyFile, promise: *JSC.JSInternalPromise) void {
                this.source_store.?.deref();

                if (this.system_error != null) {
                    this.reject(promise);
                    return;
                }

                promise.resolve(this.globalThis, JSC.JSValue.jsNumberFromUint64(this.read_len));
            }

            pub fn run(this: *CopyFile) void {
                this.runAsync();
            }

            pub fn doClose(this: *CopyFile) void {
                const close_input = this.destination_file_store.pathlike != .fd and this.destination_fd != null_fd;
                const close_output = this.source_file_store.pathlike != .fd and this.source_fd != null_fd;

                if (close_input and close_output) {
                    this.doCloseFile(.both);
                } else if (close_input) {
                    this.doCloseFile(.destination);
                } else if (close_output) {
                    this.doCloseFile(.source);
                }
            }

            const os = std.os;

            pub fn doCloseFile(this: *CopyFile, comptime which: IOWhich) void {
                switch (which) {
                    .both => {
                        _ = JSC.Node.Syscall.close(this.destination_fd);
                        _ = JSC.Node.Syscall.close(this.source_fd);
                    },
                    .destination => {
                        _ = JSC.Node.Syscall.close(this.destination_fd);
                    },
                    .source => {
                        _ = JSC.Node.Syscall.close(this.source_fd);
                    },
                }
            }

            const O = if (Environment.isLinux) linux.O else std.os.O;
            const open_destination_flags = O.CLOEXEC | O.CREAT | O.WRONLY | O.TRUNC;
            const open_source_flags = O.CLOEXEC | O.RDONLY;

            pub fn doOpenFile(this: *CopyFile, comptime which: IOWhich) !void {
                // open source file first
                // if it fails, we don't want the extra destination file hanging out
                if (which == .both or which == .source) {
                    this.source_fd = switch (JSC.Node.Syscall.open(
                        this.source_file_store.pathlike.path.sliceZAssume(),
                        open_source_flags,
                        0,
                    )) {
                        .result => |result| result,
                        .err => |errno| {
                            this.system_error = errno.toSystemError();
                            return AsyncIO.asError(errno.errno);
                        },
                    };
                }

                if (which == .both or which == .destination) {
                    this.destination_fd = switch (JSC.Node.Syscall.open(
                        this.destination_file_store.pathlike.path.sliceZAssume(),
                        open_destination_flags,
                        JSC.Node.default_permission,
                    )) {
                        .result => |result| result,
                        .err => |errno| {
                            if (which == .both) {
                                _ = JSC.Node.Syscall.close(this.source_fd);
                                this.source_fd = 0;
                            }

                            this.system_error = errno.toSystemError();
                            return AsyncIO.asError(errno.errno);
                        },
                    };
                }
            }

            const TryWith = enum {
                sendfile,
                copy_file_range,
                splice,

                pub const tag = std.EnumMap(TryWith, JSC.Node.Syscall.Tag).init(.{
                    .sendfile = .sendfile,
                    .copy_file_range = .copy_file_range,
                    .splice = .splice,
                });
            };

            pub fn doCopyFileRange(
                this: *CopyFile,
                comptime use: TryWith,
                comptime clear_append_if_invalid: bool,
            ) anyerror!void {
                this.read_off += this.offset;

                var remain = @as(usize, this.max_length);
                if (remain == max_size or remain == 0) {
                    // sometimes stat lies
                    // let's give it 4096 and see how it goes
                    remain = 4096;
                }

                var total_written: usize = 0;
                const src_fd = this.source_fd;
                const dest_fd = this.destination_fd;

                defer {
                    this.read_len = @truncate(SizeType, total_written);
                }

                var has_unset_append = false;

                while (true) {
                    const written = switch (comptime use) {
                        .copy_file_range => linux.copy_file_range(src_fd, null, dest_fd, null, remain, 0),
                        .sendfile => linux.sendfile(dest_fd, src_fd, null, remain),
                        .splice => bun.C.splice(src_fd, null, dest_fd, null, remain, 0),
                    };

                    switch (linux.getErrno(written)) {
                        .SUCCESS => {},

                        .INVAL => {
                            if (comptime clear_append_if_invalid) {
                                if (!has_unset_append) {
                                    // https://kylelaker.com/2018/08/31/stdout-oappend.html
                                    // make() can set STDOUT / STDERR to O_APPEND
                                    // this messes up sendfile()
                                    has_unset_append = true;
                                    const flags = linux.fcntl(dest_fd, linux.F.GETFL, 0);
                                    if ((flags & O.APPEND) != 0) {
                                        _ = linux.fcntl(dest_fd, linux.F.SETFL, flags ^ O.APPEND);
                                        continue;
                                    }
                                }
                            }

                            this.system_error = (JSC.Node.Syscall.Error{
                                .errno = @intCast(JSC.Node.Syscall.Error.Int, @enumToInt(linux.E.INVAL)),
                                .syscall = TryWith.tag.get(use).?,
                            }).toSystemError();
                            return AsyncIO.asError(linux.E.INVAL);
                        },
                        else => |errno| {
                            this.system_error = (JSC.Node.Syscall.Error{
                                .errno = @intCast(JSC.Node.Syscall.Error.Int, @enumToInt(errno)),
                                .syscall = TryWith.tag.get(use).?,
                            }).toSystemError();
                            return AsyncIO.asError(errno);
                        },
                    }

                    // wrote zero bytes means EOF
                    remain -|= written;
                    total_written += written;
                    if (written == 0 or remain == 0) break;
                }
            }

            pub fn doFCopyFile(this: *CopyFile) anyerror!void {
                switch (JSC.Node.Syscall.fcopyfile(this.source_fd, this.destination_fd, os.system.COPYFILE_DATA)) {
                    .err => |errno| {
                        this.system_error = errno.toSystemError();

                        return AsyncIO.asError(errno.errno);
                    },
                    .result => {},
                }
            }

            pub fn doClonefile(this: *CopyFile) anyerror!void {
                var source_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

                switch (JSC.Node.Syscall.clonefile(
                    this.source_file_store.pathlike.path.sliceZ(&source_buf),
                    this.destination_file_store.pathlike.path.sliceZ(
                        &dest_buf,
                    ),
                )) {
                    .err => |errno| {
                        this.system_error = errno.toSystemError();
                        return AsyncIO.asError(errno.errno);
                    },
                    .result => {},
                }
            }

            pub fn runAsync(this: *CopyFile) void {
                // defer task.onFinish();

                var stat_: ?std.os.Stat = null;

                if (this.destination_file_store.pathlike == .fd) {
                    this.destination_fd = this.destination_file_store.pathlike.fd;
                }

                if (this.source_file_store.pathlike == .fd) {
                    this.source_fd = this.source_file_store.pathlike.fd;
                }

                // Do we need to open both files?
                if (this.destination_fd == null_fd and this.source_fd == null_fd) {

                    // First, we attempt to clonefile() on macOS
                    // This is the fastest way to copy a file.
                    if (comptime Environment.isMac) {
                        if (this.offset == 0 and this.source_file_store.pathlike == .path and this.destination_file_store.pathlike == .path) {
                            do_clonefile: {

                                // stat the output file, make sure it:
                                // 1. Exists
                                switch (JSC.Node.Syscall.stat(this.source_file_store.pathlike.path.sliceZAssume())) {
                                    .result => |result| {
                                        stat_ = result;

                                        if (os.S.ISDIR(result.mode)) {
                                            this.system_error = unsupported_directory_error;
                                            return;
                                        }

                                        if (!os.S.ISREG(result.mode))
                                            break :do_clonefile;
                                    },
                                    .err => |err| {
                                        // If we can't stat it, we also can't copy it.
                                        this.system_error = err.toSystemError();
                                        return;
                                    },
                                }

                                if (this.doClonefile()) {
                                    if (this.max_length != Blob.max_size and this.max_length < @intCast(SizeType, stat_.?.size)) {
                                        // If this fails...well, there's not much we can do about it.
                                        _ = bun.C.truncate(
                                            this.destination_file_store.pathlike.path.sliceZAssume(),
                                            @intCast(std.os.off_t, this.max_length),
                                        );
                                        this.read_len = @intCast(SizeType, this.max_length);
                                    } else {
                                        this.read_len = @intCast(SizeType, stat_.?.size);
                                    }
                                    return;
                                } else |_| {

                                    // this may still fail, in which case we just continue trying with fcopyfile
                                    // it can fail when the input file already exists
                                    // or if the output is not a directory
                                    // or if it's a network volume
                                    this.system_error = null;
                                }
                            }
                        }
                    }

                    this.doOpenFile(.both) catch return;
                    // Do we need to open only one file?
                } else if (this.destination_fd == null_fd) {
                    this.source_fd = this.source_file_store.pathlike.fd;

                    this.doOpenFile(.destination) catch return;
                    // Do we need to open only one file?
                } else if (this.source_fd == null_fd) {
                    this.destination_fd = this.destination_file_store.pathlike.fd;

                    this.doOpenFile(.source) catch return;
                }

                if (this.system_error != null) {
                    return;
                }

                std.debug.assert(this.destination_fd != null_fd);
                std.debug.assert(this.source_fd != null_fd);

                if (this.destination_file_store.pathlike == .fd) {}

                const stat: std.os.Stat = stat_ orelse switch (JSC.Node.Syscall.fstat(this.source_fd)) {
                    .result => |result| result,
                    .err => |err| {
                        this.doClose();
                        this.system_error = err.toSystemError();
                        return;
                    },
                };

                if (os.S.ISDIR(stat.mode)) {
                    this.system_error = unsupported_directory_error;
                    this.doClose();
                    return;
                }

                if (stat.size != 0) {
                    this.max_length = @maximum(@minimum(@intCast(SizeType, stat.size), this.max_length), this.offset) - this.offset;
                    if (this.max_length == 0) {
                        this.doClose();
                        return;
                    }

                    if (os.S.ISREG(stat.mode) and
                        this.max_length > std.mem.page_size and
                        this.max_length != Blob.max_size)
                    {
                        bun.C.preallocate_file(this.destination_fd, 0, this.max_length) catch {};
                    }
                }

                if (comptime Environment.isLinux) {

                    // Bun.write(Bun.file("a"), Bun.file("b"))
                    if (os.S.ISREG(stat.mode) and (os.S.ISREG(this.destination_file_store.mode) or this.destination_file_store.mode == 0)) {
                        if (this.destination_file_store.is_atty orelse false) {
                            this.doCopyFileRange(.copy_file_range, true) catch {};
                        } else {
                            this.doCopyFileRange(.copy_file_range, false) catch {};
                        }

                        this.doClose();
                        return;
                    }

                    // $ bun run foo.js | bun run bar.js
                    if (os.S.ISFIFO(stat.mode) and os.S.ISFIFO(this.destination_file_store.mode)) {
                        if (this.destination_file_store.is_atty orelse false) {
                            this.doCopyFileRange(.splice, true) catch {};
                        } else {
                            this.doCopyFileRange(.splice, false) catch {};
                        }

                        this.doClose();
                        return;
                    }

                    if (os.S.ISREG(stat.mode) or os.S.ISCHR(stat.mode) or os.S.ISSOCK(stat.mode)) {
                        if (this.destination_file_store.is_atty orelse false) {
                            this.doCopyFileRange(.sendfile, true) catch {};
                        } else {
                            this.doCopyFileRange(.sendfile, false) catch {};
                        }

                        this.doClose();
                        return;
                    }

                    this.system_error = unsupported_non_regular_file_error;
                    this.doClose();
                    return;
                }

                if (comptime Environment.isMac) {
                    this.doFCopyFile() catch {
                        this.doClose();

                        return;
                    };
                    if (stat.size != 0 and @intCast(SizeType, stat.size) > this.max_length) {
                        _ = darwin.ftruncate(this.destination_fd, @intCast(std.os.off_t, this.max_length));
                    }

                    this.doClose();
                } else {
                    @compileError("TODO: implement copyfile");
                }
            }
        };
    };

    pub const FileStore = struct {
        pathlike: JSC.Node.PathOrFileDescriptor,
        mime_type: HTTPClient.MimeType = HTTPClient.MimeType.other,
        is_atty: ?bool = null,
        mode: JSC.Node.Mode = 0,
        seekable: ?bool = null,
        max_size: SizeType = 0,

        pub fn init(pathlike: JSC.Node.PathOrFileDescriptor, mime_type: ?HTTPClient.MimeType) FileStore {
            return .{ .pathlike = pathlike, .mime_type = mime_type orelse HTTPClient.MimeType.other };
        }
    };

    pub const ByteStore = struct {
        ptr: [*]u8 = undefined,
        len: SizeType = 0,
        cap: SizeType = 0,
        allocator: std.mem.Allocator,

        pub fn init(bytes: []u8, allocator: std.mem.Allocator) ByteStore {
            return .{
                .ptr = bytes.ptr,
                .len = @truncate(SizeType, bytes.len),
                .cap = @truncate(SizeType, bytes.len),
                .allocator = allocator,
            };
        }

        pub fn fromArrayList(list: std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator) !*ByteStore {
            return ByteStore.init(list.items, allocator);
        }

        pub fn slice(this: ByteStore) []u8 {
            return this.ptr[0..this.len];
        }

        pub fn deinit(this: *ByteStore) void {
            this.allocator.free(this.ptr[0..this.cap]);
        }

        pub fn asArrayList(this: ByteStore) std.ArrayListUnmanaged(u8) {
            return this.asArrayListLeak();
        }

        pub fn asArrayListLeak(this: ByteStore) std.ArrayListUnmanaged(u8) {
            return .{
                .items = this.ptr[0..this.len],
                .capacity = this.cap,
            };
        }
    };

    pub const Constructor = JSC.NewConstructor(
        Blob,
        .{
            .constructor = .{ .rfn = constructor },
        },
        .{},
    );

    pub const Class = NewClass(
        Blob,
        .{ .name = "Blob" },
        .{ .finalize = finalize, .text = .{
            .rfn = getText_c,
        }, .json = .{
            .rfn = getJSON_c,
        }, .arrayBuffer = .{
            .rfn = getArrayBuffer_c,
        }, .slice = .{
            .rfn = getSlice,
        }, .stream = .{
            .rfn = getStream,
        } },
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

    pub fn getStream(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) JSC.C.JSValueRef {
        var recommended_chunk_size: SizeType = 0;
        if (arguments.len > 0) {
            if (!JSValue.c(arguments[0]).isNumber() and !JSValue.c(arguments[0]).isUndefinedOrNull()) {
                JSC.throwInvalidArguments("chunkSize must be a number", .{}, ctx, exception);
                return null;
            }

            recommended_chunk_size = @intCast(SizeType, @maximum(0, @truncate(i52, JSValue.c(arguments[0]).toInt64())));
        }
        return JSC.WebCore.ReadableStream.fromBlob(
            ctx.ptr(),
            this,
            recommended_chunk_size,
        ).asObjectRef();
    }

    fn promisified(
        value: JSC.JSValue,
        global: *JSGlobalObject,
    ) JSC.JSValue {
        if (value.isError()) {
            return JSC.JSPromise.rejectedPromiseValue(global, value);
        }

        if (value.jsType() == .JSPromise)
            return value;

        return JSPromise.resolvedPromiseValue(
            global,
            value,
        );
    }

    pub fn getText(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return promisified(this.toString(globalThis, .clone), globalThis);
    }

    pub fn getText_c(
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
        globalObject: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return promisified(this.toString(globalObject, .transfer), globalObject);
    }

    pub fn getTextTransfer_c(
        this: *Blob,
        ctx: js.JSContextRef,
    ) JSC.C.JSObjectRef {
        return this.getTextTransfer(ctx).asObjectRef();
    }

    pub fn getJSON(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return promisified(this.toJSON(globalThis, .share), globalThis);
    }

    pub fn getJSON_c(
        this: *Blob,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) JSC.C.JSObjectRef {
        return promisified(this.toJSON(ctx.ptr(), .share), ctx.ptr()).asObjectRef();
    }

    pub fn getArrayBufferTransfer(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return promisified(this.toArrayBuffer(globalThis, .transfer), globalThis);
    }

    pub fn getArrayBufferTransfer_c(
        this: *Blob,
        ctx: js.JSContextRef,
    ) JSC.C.JSObjectRef {
        return promisified(this.toArrayBuffer(ctx.ptr(), .transfer), ctx.ptr()).asObjectRef();
    }

    pub fn getArrayBuffer(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        return promisified(this.toArrayBuffer(globalThis, .clone), globalThis);
    }

    pub fn getArrayBuffer_c(
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
        var relativeStart: i64 = 0;

        // If the optional end parameter is not used as a parameter when making this call, let relativeEnd be size.
        var relativeEnd: i64 = @intCast(i64, this.size);

        var args_iter = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), args);
        if (args_iter.nextEat()) |start_| {
            const start = start_.toInt64();
            if (start < 0) {
                // If the optional start parameter is negative, let relativeStart be start + size.
                relativeStart = @intCast(i64, @maximum(start + @intCast(i64, this.size), 0));
            } else {
                // Otherwise, let relativeStart be start.
                relativeStart = @minimum(@intCast(i64, start), @intCast(i64, this.size));
            }
        }

        if (args_iter.nextEat()) |end_| {
            const end = end_.toInt64();
            // If end is negative, let relativeEnd be max((size + end), 0).
            if (end < 0) {
                // If the optional start parameter is negative, let relativeStart be start + size.
                relativeEnd = @intCast(i64, @maximum(end + @intCast(i64, this.size), 0));
            } else {
                // Otherwise, let relativeStart be start.
                relativeEnd = @minimum(@intCast(i64, end), @intCast(i64, this.size));
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

        const len = @intCast(SizeType, @maximum(relativeEnd - relativeStart, 0));

        // This copies over the is_all_ascii flag
        // which is okay because this will only be a <= slice
        var blob = this.dupe();
        blob.offset = @intCast(SizeType, relativeStart);
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
        {
            defer if (this.content_type_allocated) bun.default_allocator.free(prev_content_type);
            var content_type_buf = getAllocator(ctx).alloc(u8, slice.len) catch unreachable;
            this.content_type = strings.copyLowercase(slice, content_type_buf);
        }

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
        if (this.size == Blob.max_size) {
            this.resolveSize();
            if (this.size == Blob.max_size and this.store != null) {
                return JSValue.jsNumberFromChar(0).asRef();
            }
        }

        if (this.size < std.math.maxInt(i32)) {
            return JSValue.jsNumber(this.size).asRef();
        }

        return JSC.JSValue.jsNumberFromUint64(this.size).asRef();
    }

    pub fn resolveSize(this: *Blob) void {
        if (this.store) |store| {
            if (store.data == .bytes) {
                const offset = this.offset;
                const store_size = store.size();
                if (store_size != Blob.max_size) {
                    this.offset = @minimum(store_size, offset);
                    this.size = store_size - offset;
                }
            }
        } else {
            this.size = 0;
        }
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
                blob = fromJS(ctx.ptr(), JSValue.fromRef(args[0]), false, true) catch |err| {
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
        // avoid allocating a Blob.Store if the buffer is actually empty
        var store: ?*Blob.Store = null;
        if (bytes.len > 0) {
            store = Blob.Store.init(bytes, allocator) catch unreachable;
            store.?.is_all_ascii = is_all_ascii;
        }
        return Blob{
            .size = @truncate(SizeType, bytes.len),
            .store = store,
            .allocator = null,
            .content_type = "",
            .globalThis = globalThis,
            .is_all_ascii = is_all_ascii,
        };
    }

    pub fn init(bytes: []u8, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) Blob {
        return Blob{
            .size = @truncate(SizeType, bytes.len),
            .store = if (bytes.len > 0)
                Blob.Store.init(bytes, allocator) catch unreachable
            else
                null,
            .allocator = null,
            .content_type = "",
            .globalThis = globalThis,
        };
    }

    pub fn initWithStore(store: *Blob.Store, globalThis: *JSGlobalObject) Blob {
        return Blob{
            .size = store.size(),
            .store = store,
            .allocator = null,
            .content_type = if (store.data == .file)
                store.data.file.mime_type.value
            else
                "",
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
        if (this.store != null) this.store.?.deref();
        this.store = null;
    }

    /// This does not duplicate
    /// This creates a new view
    /// and increment the reference count
    pub fn dupe(this: *const Blob) Blob {
        if (this.store != null) this.store.?.ref();
        var duped = this.*;
        duped.allocator = null;
        return duped;
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
        var slice_ = this.store.?.sharedView();
        if (slice_.len == 0) return "";
        slice_ = slice_[this.offset..];

        return slice_[0..@minimum(slice_.len, @as(usize, this.size))];
    }

    pub fn view(this: *const Blob) []const u8 {
        if (this.size == 0 or this.store == null) return "";
        return this.store.?.sharedView()[this.offset..][0..this.size];
    }

    pub const Lifetime = JSC.WebCore.Lifetime;
    pub fn setIsASCIIFlag(this: *Blob, is_all_ascii: bool) void {
        this.is_all_ascii = is_all_ascii;
        // if this Blob represents the entire binary data
        // which will be pretty common
        // we can update the store's is_all_ascii flag
        // and any other Blob that points to the same store
        // can skip checking the encoding
        if (this.size > 0 and this.offset == 0 and this.store.?.data == .bytes) {
            this.store.?.is_all_ascii = is_all_ascii;
        }
    }

    pub fn NewReadFileHandler(comptime Function: anytype, comptime lifetime: Lifetime) type {
        return struct {
            context: Blob,
            promise: *JSPromise,
            globalThis: *JSGlobalObject,
            pub fn run(handler: *@This(), bytes_: Blob.Store.ReadFile.ResultType) void {
                var promise = handler.promise;
                var blob = handler.context;
                blob.allocator = null;
                var globalThis = handler.globalThis;
                bun.default_allocator.destroy(handler);
                switch (bytes_) {
                    .result => |result| {
                        const bytes = result.buf;
                        const is_temporary = result.is_temporary;
                        if (blob.size > 0)
                            blob.size = @minimum(@truncate(u32, bytes.len), blob.size);
                        if (!is_temporary) {
                            promise.resolve(globalThis, Function(&blob, globalThis, bytes, comptime lifetime));
                        } else {
                            promise.resolve(globalThis, Function(&blob, globalThis, bytes, .temporary));
                        }
                    },
                    .err => |err| {
                        promise.reject(globalThis, err.toErrorInstance(globalThis));
                    },
                }
            }
        };
    }

    pub const WriteFilePromise = struct {
        promise: *JSPromise,
        globalThis: *JSGlobalObject,
        pub fn run(handler: *@This(), count: Blob.Store.WriteFile.ResultType) void {
            var promise = handler.promise;
            var globalThis = handler.globalThis;
            bun.default_allocator.destroy(handler);
            const value = promise.asValue(globalThis);
            value.ensureStillAlive();
            switch (count) {
                .err => |err| {
                    value.unprotect();
                    promise.reject(globalThis, err.toErrorInstance(globalThis));
                },
                .result => |wrote| {
                    value.unprotect();
                    promise.resolve(globalThis, JSC.JSValue.jsNumberFromUint64(wrote));
                },
            }
        }
    };

    pub fn NewInternalReadFileHandler(comptime Context: type, comptime Function: anytype) type {
        return struct {
            pub fn run(handler: *anyopaque, bytes_: Store.ReadFile.ResultType) void {
                Function(bun.cast(Context, handler), bytes_);
            }
        };
    }

    pub fn doReadFileInternal(this: *Blob, comptime Handler: type, ctx: Handler, comptime Function: anytype, global: *JSGlobalObject) void {
        var file_read = Store.ReadFile.createWithCtx(
            bun.default_allocator,
            this.store.?,
            ctx,
            NewInternalReadFileHandler(Handler, Function).run,
            this.offset,
            this.size,
        ) catch unreachable;
        var read_file_task = Store.ReadFile.ReadFileTask.createOnJSThread(bun.default_allocator, global, file_read) catch unreachable;
        read_file_task.schedule();
    }

    pub fn doReadFile(this: *Blob, comptime Function: anytype, comptime lifetime: Lifetime, global: *JSGlobalObject) JSValue {
        const Handler = NewReadFileHandler(Function, lifetime);
        var promise = JSPromise.create(global);

        var handler = Handler{
            .context = this.*,
            .promise = promise,
            .globalThis = global,
        };

        var ptr = bun.default_allocator.create(Handler) catch unreachable;
        ptr.* = handler;
        var file_read = Store.ReadFile.create(
            bun.default_allocator,
            this.store.?,
            this.offset,
            this.size,
            *Handler,
            ptr,
            Handler.run,
        ) catch unreachable;
        var read_file_task = Store.ReadFile.ReadFileTask.createOnJSThread(bun.default_allocator, global, file_read) catch unreachable;
        read_file_task.schedule();
        return promise.asValue(global);
    }

    pub fn needsToReadFile(this: *const Blob) bool {
        return this.store != null and this.store.?.data == .file;
    }

    pub fn toStringWithBytes(this: *Blob, global: *JSGlobalObject, buf: []const u8, comptime lifetime: Lifetime) JSValue {
        // null == unknown
        // false == can't be
        const could_be_all_ascii = this.is_all_ascii orelse this.store.?.is_all_ascii;

        if (could_be_all_ascii == null or !could_be_all_ascii.?) {
            // if toUTF16Alloc returns null, it means there are no non-ASCII characters
            // instead of erroring, invalid characters will become a U+FFFD replacement character
            if (strings.toUTF16Alloc(bun.default_allocator, buf, false) catch unreachable) |external| {
                if (lifetime != .temporary)
                    this.setIsASCIIFlag(false);

                if (lifetime == .transfer) {
                    this.detach();
                }

                if (lifetime == .temporary) {
                    bun.default_allocator.free(bun.constStrToU8(buf));
                }

                return ZigString.toExternalU16(external.ptr, external.len, global);
            }

            if (lifetime != .temporary) this.setIsASCIIFlag(true);
        }

        switch (comptime lifetime) {
            // strings are immutable
            // we don't need to clone
            .clone => {
                this.store.?.ref();
                return ZigString.init(buf).external(global, this.store.?, Store.external);
            },
            .transfer => {
                var store = this.store.?;
                this.transfer();
                return ZigString.init(buf).external(global, store, Store.external);
            },
            // strings are immutable
            // sharing isn't really a thing
            .share => {
                this.store.?.ref();
                return ZigString.init(buf).external(global, this.store.?, Store.external);
            },
            .temporary => {
                return ZigString.init(buf).toExternalValue(global);
            },
        }
    }

    pub fn toString(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        if (this.needsToReadFile()) {
            return this.doReadFile(toStringWithBytes, lifetime, global);
        }

        const view_: []u8 =
            bun.constStrToU8(this.sharedView());

        if (view_.len == 0)
            return ZigString.Empty.toValue(global);

        return toStringWithBytes(this, global, view_, lifetime);
    }

    pub fn toJSON(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        if (this.needsToReadFile()) {
            return this.doReadFile(toJSONWithBytes, lifetime, global);
        }

        var view_ = this.sharedView();

        if (view_.len == 0)
            return ZigString.Empty.toValue(global);

        return toJSONWithBytes(this, global, view_, lifetime);
    }

    pub fn toJSONWithBytes(this: *Blob, global: *JSGlobalObject, buf: []const u8, comptime lifetime: Lifetime) JSValue {
        // null == unknown
        // false == can't be
        const could_be_all_ascii = this.is_all_ascii orelse this.store.?.is_all_ascii;

        if (could_be_all_ascii == null or !could_be_all_ascii.?) {
            // if toUTF16Alloc returns null, it means there are no non-ASCII characters
            if (strings.toUTF16Alloc(bun.default_allocator, buf, false) catch null) |external| {
                if (comptime lifetime != .temporary) this.setIsASCIIFlag(false);
                return ZigString.toExternalU16(external.ptr, external.len, global).parseJSON(global);
            }

            if (comptime lifetime != .temporary) this.setIsASCIIFlag(true);
        }

        if (comptime lifetime == .temporary) {
            return ZigString.init(buf).toExternalValue(
                global,
            ).parseJSON(global);
        } else {
            return ZigString.init(buf).toValue(
                global,
            ).parseJSON(global);
        }
    }

    pub fn toArrayBufferWithBytes(this: *Blob, global: *JSGlobalObject, buf: []u8, comptime lifetime: Lifetime) JSValue {
        switch (comptime lifetime) {
            .clone => {
                var clone = bun.default_allocator.alloc(u8, buf.len) catch unreachable;
                @memcpy(clone.ptr, buf.ptr, buf.len);

                return JSC.ArrayBuffer.fromBytes(clone, .ArrayBuffer).toJS(global.ref(), null);
            },
            .share => {
                this.store.?.ref();
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJSWithContext(
                    global.ref(),
                    this.store.?,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
            .transfer => {
                var store = this.store.?;
                this.transfer();
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJSWithContext(
                    global.ref(),
                    store,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
            .temporary => {
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJS(
                    global.ref(),
                    null,
                );
            },
        }
    }

    pub fn toArrayBuffer(this: *Blob, global: *JSGlobalObject, comptime lifetime: Lifetime) JSValue {
        if (this.needsToReadFile()) {
            return this.doReadFile(toArrayBufferWithBytes, lifetime, global);
        }

        var view_ = this.sharedView();

        if (view_.len == 0)
            return JSC.ArrayBuffer.fromBytes(&[_]u8{}, .ArrayBuffer).toJS(global.ref(), null);

        return toArrayBufferWithBytes(this, global, bun.constStrToU8(view_), lifetime);
    }

    pub inline fn fromJS(
        global: *JSGlobalObject,
        arg: JSValue,
        comptime move: bool,
        comptime require_array: bool,
    ) anyerror!Blob {
        return fromJSMovable(global, arg, move, require_array);
    }

    pub inline fn fromJSMove(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, true, false);
    }

    pub inline fn fromJSClone(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, false, true);
    }

    pub inline fn fromJSCloneOptionalArray(global: *JSGlobalObject, arg: JSValue) anyerror!Blob {
        return fromJSWithoutDeferGC(global, arg, false, false);
    }

    fn fromJSMovable(
        global: *JSGlobalObject,
        arg: JSValue,
        comptime move: bool,
        comptime require_array: bool,
    ) anyerror!Blob {
        const FromJSFunction = if (comptime move and !require_array)
            fromJSMove
        else if (!require_array)
            fromJSCloneOptionalArray
        else
            fromJSClone;

        return FromJSFunction(global, arg);
    }

    fn fromJSWithoutDeferGC(
        global: *JSGlobalObject,
        arg: JSValue,
        comptime move: bool,
        comptime require_array: bool,
    ) anyerror!Blob {
        var current = arg;
        if (current.isUndefinedOrNull()) {
            return Blob{ .globalThis = global };
        }

        var top_value = current;
        var might_only_be_one_thing = false;
        arg.ensureStillAlive();
        defer arg.ensureStillAlive();
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
                if (require_array) {
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
                    if (!sliced.allocated and sliced.len > 0) {
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
                    var buf = try bun.default_allocator.dupe(u8, top_value.asArrayBuffer(global).?.byteSlice());

                    return Blob.init(buf, bun.default_allocator, global);
                },

                else => |tag| {
                    if (tag != .DOMWrapper) {
                        if (JSC.C.JSObjectGetPrivate(top_value.asObjectRef())) |priv| {
                            var data = JSC.JSPrivateDataPtr.from(priv);
                            switch (data.tag()) {
                                .Blob => {
                                    var blob: *Blob = data.as(Blob);
                                    if (comptime move) {
                                        var _blob = blob.*;
                                        _blob.allocator = null;
                                        blob.transfer();
                                        return _blob;
                                    } else {
                                        return blob.dupe();
                                    }
                                },

                                else => return Blob.initEmpty(global),
                            }
                        }
                    }
                },
            }
        }

        var stack_allocator = std.heap.stackFallback(1024, bun.default_allocator);
        var stack_mem_all = stack_allocator.get();
        var stack: std.ArrayList(JSValue) = std.ArrayList(JSValue).init(stack_mem_all);
        var joiner = StringJoiner{ .use_pool = false, .node_allocator = stack_mem_all };
        var could_have_non_ascii = false;

        defer if (stack_allocator.fixed_buffer_allocator.end_index >= 1024) stack.deinit();

        while (true) {
            switch (current.jsTypeLoose()) {
                .NumberObject,
                JSC.JSValue.JSType.String,
                JSC.JSValue.JSType.StringObject,
                JSC.JSValue.JSType.DerivedStringObject,
                => {
                    var sliced = current.toSlice(global, bun.default_allocator);
                    could_have_non_ascii = could_have_non_ascii or sliced.allocated;
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
                                    could_have_non_ascii = could_have_non_ascii or sliced.allocated;
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
                                    could_have_non_ascii = true;
                                    var buf = item.asArrayBuffer(global).?;
                                    joiner.append(buf.byteSlice(), 0, null);
                                    continue;
                                },
                                .Array, .DerivedArray => {
                                    any_arrays = true;
                                    could_have_non_ascii = true;
                                    break;
                                },
                                else => {
                                    if (JSC.C.JSObjectGetPrivate(item.asObjectRef())) |priv| {
                                        var data = JSC.JSPrivateDataPtr.from(priv);
                                        switch (data.tag()) {
                                            .Blob => {
                                                var blob: *Blob = data.as(Blob);
                                                could_have_non_ascii = could_have_non_ascii or !(blob.is_all_ascii orelse false);
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

                .DOMWrapper => {},

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
                    could_have_non_ascii = true;
                },

                else => {
                    outer: {
                        if (JSC.C.JSObjectGetPrivate(current.asObjectRef())) |priv| {
                            var data = JSC.JSPrivateDataPtr.from(priv);
                            switch (data.tag()) {
                                .Blob => {
                                    var blob: *Blob = data.as(Blob);
                                    could_have_non_ascii = could_have_non_ascii or !(blob.is_all_ascii orelse false);
                                    joiner.append(blob.sharedView(), 0, null);
                                    break :outer;
                                },
                                else => {},
                            }
                        }

                        var sliced = current.toSlice(global, bun.default_allocator);
                        could_have_non_ascii = could_have_non_ascii or sliced.allocated;
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

        if (!could_have_non_ascii) {
            return Blob.initWithAllASCII(joined, bun.default_allocator, global, true);
        }
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

    pub fn clone(this: Body, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) Body {
        return Body{
            .init = this.init.clone(globalThis),
            .value = this.value.clone(allocator),
        };
    }

    pub fn writeFormat(this: *const Body, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("bodyUsed: ");
        formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.value == .Used), .BooleanObject, enable_ansi_colors);
        formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
        try writer.writeAll("\n");

        // if (this.init.headers) |headers| {
        //     try formatter.writeIndent(Writer, writer);
        //     try writer.writeAll("headers: ");
        //     try headers.leak().writeFormat(formatter, writer, comptime enable_ansi_colors);
        //     try writer.writeAll("\n");
        // }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("status: ");
        formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(this.init.status_code), .NumberObject, enable_ansi_colors);
        if (this.value == .Blob) {
            try formatter.printComma(Writer, writer, enable_ansi_colors);
            try writer.writeAll("\n");
            try this.value.Blob.writeFormat(formatter, writer, enable_ansi_colors);
        }
    }

    pub fn deinit(this: *Body, _: std.mem.Allocator) void {
        if (this.init.headers) |headers| {
            headers.deref();
            this.init.headers = null;
        }
        this.value.deinit();
    }

    pub const Init = struct {
        headers: ?*FetchHeaders = null,
        status_code: u16,
        method: Method = Method.GET,

        pub fn clone(this: Init, _: *JSGlobalObject) Init {
            var that = this;
            var headers = this.headers;
            if (headers) |head| {
                that.headers = head.cloneThis();
            }

            return that;
        }

        pub fn init(allocator: std.mem.Allocator, ctx: *JSGlobalObject, response_init: JSC.JSValue) !?Init {
            var result = Init{ .status_code = 200 };

            if (!response_init.isCell())
                return null;

            if (response_init.fastGet(ctx, .headers)) |headers| {
                if (headers.as(FetchHeaders)) |orig| {
                    result.headers = orig.cloneThis();
                } else {
                    result.headers = FetchHeaders.createFromJS(ctx.ptr(), headers);
                }
            }

            if (response_init.fastGet(ctx, .status)) |status_value| {
                const number = status_value.to(i32);
                if (number > 0)
                    result.status_code = @truncate(u16, @intCast(u32, number));
            }

            if (response_init.fastGet(ctx, .method)) |method_value| {
                var method_str = method_value.toSlice(ctx, allocator);
                defer method_str.deinit();
                if (method_str.len > 0) {
                    result.method = Method.which(method_str.slice()) orelse .GET;
                }
            }

            if (result.headers == null and result.status_code < 200) return null;
            return result;
        }
    };

    pub const PendingValue = struct {
        promise: ?JSValue = null,
        readable: ?JSC.WebCore.ReadableStream = null,
        // writable: JSC.WebCore.Sink

        global: *JSGlobalObject,
        task: ?*anyopaque = null,
        /// runs after the data is available.
        callback: ?fn (ctx: *anyopaque, value: *Value) void = null,
        /// conditionally runs when requesting data
        /// used in HTTP server to ignore request bodies unless asked for it
        onPull: ?fn (ctx: *anyopaque) void = null,
        deinit: bool = false,
        action: Action = Action.none,

        pub fn setPromise(value: *PendingValue, globalThis: *JSC.JSGlobalObject, action: Action) JSValue {
            value.action = action;

            if (value.readable) |readable| {
                // switch (readable.ptr) {
                //     .JavaScript
                // }
                switch (action) {
                    .getText, .getJSON, .getBlob, .getArrayBuffer => {
                        switch (readable.ptr) {
                            .Blob => unreachable,
                            else => {},
                        }
                        value.promise = switch (action) {
                            .getJSON => globalThis.readableStreamToJSON(readable.value),
                            .getArrayBuffer => globalThis.readableStreamToArrayBuffer(readable.value),
                            .getText => globalThis.readableStreamToText(readable.value),
                            .getBlob => globalThis.readableStreamToBlob(readable.value),
                            else => unreachable,
                        };
                        value.promise.?.ensureStillAlive();
                        readable.value.unprotect();

                        // js now owns the memory
                        value.readable = null;

                        return value.promise.?;
                    },
                    .none => {},
                }
            }

            {
                var promise = JSC.JSPromise.create(globalThis);
                const promise_value = promise.asValue(globalThis);
                value.promise = promise_value;

                if (value.onPull) |onPull| {
                    value.onPull = null;
                    onPull(value.task.?);
                }
                return promise_value;
            }
        }

        pub const Action = enum {
            none,
            getText,
            getJSON,
            getArrayBuffer,
            getBlob,
        };
    };

    pub const Value = union(Tag) {
        Blob: Blob,
        Locked: PendingValue,
        Used: void,
        Empty: void,
        Error: JSValue,

        pub const Tag = enum {
            Blob,
            Locked,
            Used,
            Empty,
            Error,
        };

        pub const empty = Value{ .Empty = .{} };

        pub fn fromReadableStream(readable: JSC.WebCore.ReadableStream, globalThis: *JSGlobalObject) Value {
            if (readable.isLocked(globalThis)) {
                return .{ .Error = ZigString.init("Cannot use a locked ReadableStream").toErrorInstance(globalThis) };
            }

            readable.value.protect();
            return .{
                .Locked = .{
                    .readable = readable,
                    .global = globalThis,
                },
            };
        }

        pub fn resolve(this: *Value, new: *Value, global: *JSGlobalObject) void {
            if (this.* == .Locked) {
                var locked = &this.Locked;
                if (locked.readable) |readable| {
                    readable.done();
                    locked.readable = null;
                }

                if (locked.callback) |callback| {
                    locked.callback = null;
                    callback(locked.task.?, new);
                }

                if (locked.promise) |promise| {
                    locked.promise = null;
                    var blob = new.use();

                    switch (locked.action) {
                        .getText => {
                            promise.asPromise().?.resolve(global, blob.getTextTransfer(global.ref()));
                        },
                        .getJSON => {
                            promise.asPromise().?.resolve(global, blob.toJSON(global, .share));
                            blob.detach();
                        },
                        .getArrayBuffer => {
                            promise.asPromise().?.resolve(global, blob.getArrayBufferTransfer(global));
                        },
                        .getBlob => {
                            var ptr = bun.default_allocator.create(Blob) catch unreachable;
                            ptr.* = blob;
                            ptr.allocator = bun.default_allocator;
                            promise.asPromise().?.resolve(global, JSC.JSValue.fromRef(Blob.Class.make(global.ref(), ptr)));
                        },
                        else => {
                            var ptr = bun.default_allocator.create(Blob) catch unreachable;
                            ptr.* = blob;
                            ptr.allocator = bun.default_allocator;
                            promise.asInternalPromise().?.resolve(global, JSC.JSValue.fromRef(Blob.Class.make(global.ref(), ptr)));
                        },
                    }
                    JSC.C.JSValueUnprotect(global.ref(), promise.asObjectRef());
                }
            }
        }
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
                    std.debug.assert(new_blob.allocator == null); // owned by Body
                    this.* = .{ .Used = .{} };
                    return new_blob;
                },
                else => {
                    return Blob.initEmpty(undefined);
                },
            }
        }

        pub fn toErrorInstance(this: *Value, error_instance: JSC.JSValue, global: *JSGlobalObject) void {
            if (this.* == .Locked) {
                var locked = this.Locked;
                locked.deinit = true;
                if (locked.promise) |promise| {
                    if (promise.asInternalPromise()) |internal| {
                        internal.reject(global, error_instance);
                    } else if (promise.asPromise()) |internal| {
                        internal.reject(global, error_instance);
                    }
                    JSC.C.JSValueUnprotect(global.ref(), promise.asObjectRef());
                    locked.promise = null;
                }

                if (locked.readable) |readable| {
                    readable.done();
                    locked.readable = null;
                }

                this.* = .{ .Error = error_instance };
                if (locked.callback) |callback| {
                    locked.callback = null;
                    callback(locked.task.?, this);
                }
                return;
            }

            this.* = .{ .Error = error_instance };
        }

        pub fn toErrorString(this: *Value, comptime err: string, global: *JSGlobalObject) void {
            var error_str = ZigString.init(err);
            var error_instance = error_str.toErrorInstance(global);
            return this.toErrorInstance(error_instance, global);
        }

        pub fn toError(this: *Value, err: anyerror, global: *JSGlobalObject) void {
            var error_str = ZigString.init(std.fmt.allocPrint(
                bun.default_allocator,
                "Error reading file {s}",
                .{@errorName(err)},
            ) catch unreachable);
            error_str.mark();
            var error_instance = error_str.toErrorInstance(global);
            return this.toErrorInstance(error_instance, global);
        }

        pub fn deinit(this: *Value) void {
            const tag = @as(Tag, this.*);
            if (tag == .Locked) {
                if (this.Locked.readable) |*readable| {
                    readable.done();
                }

                this.Locked.deinit = true;
                return;
            }

            if (tag == .Blob) {
                this.Blob.deinit();
                this.* = Value.empty;
            }

            if (tag == .Error) {
                JSC.C.JSValueUnprotect(VirtualMachine.vm.global.ref(), this.Error.asObjectRef());
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
                .status_code = 200,
            },
            .value = Value.empty,
        };
    }

    pub fn extract(
        globalThis: *JSGlobalObject,
        value: JSValue,
    ) ?Body {
        return extractBody(
            globalThis,
            value,
            false,
            JSValue.zero,
        );
    }

    pub fn extractWithInit(
        globalThis: *JSGlobalObject,
        value: JSValue,
        init: JSValue,
    ) ?Body {
        return extractBody(
            globalThis,
            value,
            true,
            init,
        );
    }

    // https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
    inline fn extractBody(
        globalThis: *JSGlobalObject,
        value: JSValue,
        comptime has_init: bool,
        init: JSValue,
    ) ?Body {
        var body = Body{
            .init = Init{ .headers = null, .status_code = 200 },
        };
        var allocator = getAllocator(globalThis);

        if (comptime has_init) {
            if (Init.init(allocator, globalThis, init)) |maybeInit| {
                if (maybeInit) |init_| {
                    body.init = init_;
                }
            } else |_| {}
        }

        if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |readable| {
            switch (readable.ptr) {
                .Blob => |blob| {
                    body.value = .{
                        .Blob = Blob.initWithStore(blob.store, globalThis),
                    };
                    blob.store.ref();

                    readable.done();

                    if (!blob.done) {
                        blob.done = true;
                        blob.deinit();
                    }
                    return body;
                },
                else => {},
            }

            body.value = Body.Value.fromReadableStream(readable, globalThis);
            return body;
        }

        body.value = .{
            .Blob = Blob.fromJS(globalThis, value, true, false) catch |err| {
                if (err == error.InvalidArguments) {
                    globalThis.throwInvalidArguments("Expected an Array", .{});
                    return null;
                }

                globalThis.throwInvalidArguments("Invalid Body object", .{});
                return null;
            },
        };

        std.debug.assert(body.value.Blob.allocator == null); // owned by Body

        return body;
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Request
pub const Request = struct {
    url: ZigString = ZigString.Empty,
    headers: ?*FetchHeaders = null,
    body: Body.Value = Body.Value{ .Empty = .{} },
    method: Method = Method.GET,
    uws_request: ?*uws.Request = null,

    pub usingnamespace JSC.Codegen.JSRequest;

    pub fn writeFormat(this: *const Request, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);
        try formatter.writeIndent(Writer, writer);
        try writer.print("Request ({}) {{\n", .{bun.fmt.size(this.body.slice().len)});
        {
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("method: \"");
            try writer.writeAll(std.mem.span(@tagName(this.method)));
            try writer.writeAll("\"");
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("url: \"");
            try writer.print(comptime Output.prettyFmt("<r><b>{}<r>", enable_ansi_colors), .{this.url});
            try writer.writeAll("\"");
            if (this.body == .Blob) {
                try writer.writeAll("\n");
                try this.body.Blob.writeFormat(formatter, writer, enable_ansi_colors);
            }
        }
        try writer.writeAll("\n");
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
    }

    pub fn fromRequestContext(ctx: *RequestContext, global: *JSGlobalObject) !Request {
        var req = Request{
            .url = ZigString.init(std.mem.span(ctx.getFullURL())),
            .body = Body.Value.empty,
            .method = ctx.method,
            .headers = FetchHeaders.createFromPicoHeaders(global, ctx.request.headers),
        };
        req.url.mark();
        return req;
    }

    pub fn mimeType(this: *const Request) string {
        if (this.headers) |headers| {
            // Remember, we always lowercase it
            // hopefully doesn't matter here tho
            if (headers.fastGet(.ContentType)) |content_type| {
                return content_type;
            }
        }

        switch (this.body) {
            .Blob => |blob| {
                if (blob.content_type.len > 0) {
                    return blob.content_type;
                }

                return MimeType.other.value;
            },
            .Error, .Used, .Locked, .Empty => return MimeType.other.value,
        }
    }

    pub fn getCache(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(Properties.UTF8.default).toValueGC(globalThis);
    }
    pub fn getCredentials(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(Properties.UTF8.include).toValueGC(globalThis);
    }
    pub fn getDestination(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init("").toValueGC(globalThis);
    }

    pub fn getIntegrity(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.Empty.toValueGC(globalThis);
    }

    pub fn getMethod(
        this: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        const string_contents: string = switch (this.method) {
            .GET => Properties.UTF8.GET,
            .HEAD => Properties.UTF8.HEAD,
            .PATCH => Properties.UTF8.PATCH,
            .PUT => Properties.UTF8.PUT,
            .POST => Properties.UTF8.POST,
            .OPTIONS => Properties.UTF8.OPTIONS,
            else => "",
        };

        return ZigString.init(string_contents).toValueGC(globalThis);
    }

    pub fn getMode(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(Properties.UTF8.navigate).toValue(globalThis);
    }

    pub fn finalize(this: *Request) callconv(.C) void {
        if (this.headers) |headers| {
            headers.deref();
            this.headers = null;
        }

        if (this.url.isGloballyAllocated()) {
            bun.default_allocator.free(bun.constStrToU8(this.url.slice()));
        }

        this.body.deinit();

        bun.default_allocator.destroy(this);
    }

    pub fn getRedirect(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(Properties.UTF8.follow).toValueGC(globalThis);
    }
    pub fn getReferrer(
        this: *Request,
        globalObject: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        if (this.headers) |headers_ref| {
            if (headers_ref.get("referrer")) |referrer| {
                return ZigString.init(referrer).toValueGC(globalObject);
            }
        }

        return ZigString.init("").toValueGC(globalObject);
    }
    pub fn getReferrerPolicy(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init("").toValueGC(globalThis);
    }
    pub fn getUrl(
        this: *Request,
        globalObject: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return this.url.toValueGC(globalObject);
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Request {
        var request = Request{};
        const arguments_ = callframe.arguments(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        switch (arguments.len) {
            0 => {},
            1 => {
                const urlOrObject = arguments[0];
                if (urlOrObject.isString()) {
                    request.url = urlOrObject.getZigString(globalThis);
                } else {
                    if (Body.Init.init(getAllocator(globalThis), globalThis, arguments[0]) catch null) |req_init| {
                        request.headers = req_init.headers;
                        request.method = req_init.method;
                    }

                    if (urlOrObject.fastGet(globalThis, .url)) |url| {
                        request.url = url.getZigString(globalThis).clone(bun.default_allocator) catch {
                            return null;
                        };
                    }

                    if (urlOrObject.fastGet(globalThis, .body)) |body_| {
                        if (Blob.fromJS(globalThis, body_, true, false)) |blob| {
                            if (blob.size > 0) {
                                request.body = Body.Value{ .Blob = blob };
                            }
                        } else |err| {
                            if (err == error.InvalidArguments) {
                                globalThis.throwInvalidArguments("Expected an Array", .{});
                                return null;
                            }

                            globalThis.throwInvalidArguments("Invalid Body object", .{});
                            return null;
                        }
                    }
                }
            },
            else => {
                request.url = arguments[0].getZigString(globalThis);

                if (Body.Init.init(getAllocator(globalThis), globalThis, arguments[1]) catch null) |req_init| {
                    request.headers = req_init.headers;
                    request.method = req_init.method;
                }

                if (arguments[1].fastGet(globalThis, .body)) |body_| {
                    if (Blob.fromJS(globalThis, body_, true, false)) |blob| {
                        if (blob.size > 0) {
                            request.body = Body.Value{ .Blob = blob };
                        }
                    } else |err| {
                        if (err == error.InvalidArguments) {
                            globalThis.throwInvalidArguments("Expected an Array", .{});
                            return null;
                        }

                        globalThis.throwInvalidArguments("Invalid Body object", .{});
                        return null;
                    }
                }
            },
        }

        var request_ = getAllocator(globalThis).create(Request) catch unreachable;
        request_.* = request;
        return request_;
    }

    pub fn getBodyValue(
        this: *Request,
    ) *Body.Value {
        return &this.body;
    }

    pub fn getBodyUsed(
        this: *Request,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.body == .Used);
    }

    pub usingnamespace NewBlobInterface(@This());

    pub fn doClone(
        this: *Request,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var cloned = this.clone(getAllocator(globalThis), globalThis);
        return cloned.toJS(globalThis);
    }

    pub fn getHeaders(
        this: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        if (this.headers == null) {
            if (this.uws_request) |req| {
                this.headers = FetchHeaders.createFromUWS(globalThis, req);
            } else {
                this.headers = FetchHeaders.createEmpty();
            }
        }

        return this.headers.?.toJS(globalThis);
    }

    pub fn cloneInto(
        this: *const Request,
        req: *Request,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
    ) void {
        req.* = Request{
            .body = this.body.clone(allocator),
            .url = ZigString.init(allocator.dupe(u8, this.url.slice()) catch unreachable),
            .method = this.method,
        };
        if (this.headers) |head| {
            req.headers = head.cloneThis();
        } else if (this.uws_request) |uws_req| {
            req.headers = FetchHeaders.createFromUWS(globalThis, uws_req);
        }
    }

    pub fn clone(this: *const Request, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) *Request {
        var req = allocator.create(Request) catch unreachable;
        this.cloneInto(req, allocator, globalThis);
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
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Locked) {
                return value.Locked.setPromise(ctx.ptr(), .getText).asObjectRef();
            }

            var blob = this.body.use();
            return blob.getTextTransfer_c(ctx);
        }

        pub fn getJSON(
            this: *Type,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Locked) {
                return value.Locked.setPromise(ctx.ptr(), .getJSON).asObjectRef();
            }

            var blob = this.body.use();
            return blob.getJSON_c(ctx, null, null, &.{}, exception);
        }
        pub fn getArrayBuffer(
            this: *Type,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Locked) {
                return value.Locked.setPromise(ctx.ptr(), .getArrayBuffer).asObjectRef();
            }

            var blob = this.body.use();
            return blob.getArrayBufferTransfer_c(ctx);
        }

        pub fn getBlob(
            this: *Type,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Locked) {
                return value.Locked.setPromise(ctx.ptr(), .getBlob).asObjectRef();
            }

            var blob = this.body.use();
            var ptr = getAllocator(ctx).create(Blob) catch unreachable;
            ptr.* = blob;
            blob.allocator = getAllocator(ctx);
            return JSC.JSPromise.resolvedPromiseValue(ctx.ptr(), JSValue.fromRef(Blob.Class.make(ctx, ptr))).asObjectRef();
        }

        // pub fn getBody(
        //     this: *Type,
        //     ctx: js.JSContextRef,
        //     _: js.JSObjectRef,
        //     _: js.JSObjectRef,
        //     _: []const js.JSValueRef,
        //     _: js.ExceptionRef,
        // ) js.JSValueRef {
        //     var value: *Body.Value = this.getBodyValue();

        //     switch (value.*) {
        //         .Empty => {},
        //     }
        // }
    };
}

fn NewBlobInterface(comptime Type: type) type {
    return struct {
        pub fn getText(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            cf: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            std.mem.doNotOptimizeAway(cf);
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Locked) {
                return value.Locked.setPromise(globalObject, .getText);
            }

            var blob = value.use();
            return blob.getTextTransfer(globalObject);
        }

        pub fn getJSON(
            this: *Type,
            globalThis: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Locked) {
                return value.Locked.setPromise(globalThis, .getJSON);
            }

            var blob: Blob = value.use();
            return blob.getJSON(globalThis, callframe);
        }
        pub fn getArrayBuffer(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            cf: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            std.mem.doNotOptimizeAway(cf);
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Locked) {
                return value.Locked.setPromise(globalObject, .getArrayBuffer);
            }

            var blob: Blob = value.use();
            return blob.getArrayBufferTransfer(globalObject);
        }

        pub fn getBlob(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            cf: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            std.mem.doNotOptimizeAway(cf);
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Locked) {
                return value.Locked.setPromise(globalObject, .getBlob);
            }

            var blob = value.use();
            var ptr = getAllocator(globalObject).create(Blob) catch unreachable;
            ptr.* = blob;
            blob.allocator = getAllocator(globalObject);
            return JSC.JSPromise.resolvedPromiseValue(globalObject, JSValue.fromRef(Blob.Class.make(globalObject, ptr)));
        }

        // pub fn getBody(
        //     this: *Type,
        //     ctx: js.JSContextRef,
        //     _: js.JSObjectRef,
        //     _: js.JSObjectRef,
        //     _: []const js.JSValueRef,
        //     _: js.ExceptionRef,
        // ) js.JSValueRef {
        //     var value: *Body.Value = this.getBodyValue();

        //     switch (value.*) {
        //         .Empty => {},
        //     }
        // }
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

        return req.toJS(
            ctx,
        ).asObjectRef();
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
        var existing_response: ?*Response = if (arguments.len > 0)
            arguments[0].?.value().as(Response)
        else
            null;
        // A Response or a Promise that resolves to a Response. Otherwise, a network error is returned to Fetch.
        if (arguments.len == 0 or existing_response != null or !js.JSValueIsObject(ctx, arguments[0])) {
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            request_context.sendInternalError(error.respondWithWasEmpty) catch {};
            return js.JSValueMakeUndefined(ctx);
        }

        var arg = arguments[0];

        if (existing_response == null) {
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

        var response: *Response = JSValue.c(arg.?).as(Response) orelse {
            this.rejected = true;
            this.pending_promise = null;
            JSError(getAllocator(ctx), "event.respondWith() expects Response or Promise<Response>", .{}, ctx, exception);
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
            var headers = Headers.from(headers_ref, request_context.allocator) catch unreachable;

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
