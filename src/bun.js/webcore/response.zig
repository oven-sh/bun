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

    allocator: std.mem.Allocator,
    body: Body,
    url: string = "",
    status_text: string = "",
    redirected: bool = false,

    // We must report a consistent value for this
    reported_estimated_size: ?u63 = null,

    pub fn estimatedSize(this: *Response) callconv(.C) usize {
        return this.reported_estimated_size orelse brk: {
            this.reported_estimated_size = @intCast(
                u63,
                this.body.value.estimatedSize() + this.url.len + this.status_text.len + @sizeOf(Response),
            );
            break :brk this.reported_estimated_size.?;
        };
    }

    pub fn getBodyValue(
        this: *Response,
    ) *Body.Value {
        return &this.body.value;
    }

    pub inline fn statusCode(this: *const Response) u16 {
        return this.body.init.status_code;
    }

    pub fn redirectLocation(this: *const Response) ?[]const u8 {
        return this.header(.Location);
    }

    pub fn header(this: *const Response, name: JSC.FetchHeaders.HTTPHeaderName) ?[]const u8 {
        return if ((this.body.init.headers orelse return null).fastGet(name)) |str|
            str.slice()
        else
            null;
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

    pub fn getStatusText(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText
        return ZigString.init(this.status_text).withEncoding().toValueGC(globalThis);
    }

    pub fn getRedirected(
        this: *Response,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected
        return JSValue.jsBoolean(this.redirected);
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
        this: *Response,
        new_response: *Response,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
    ) void {
        new_response.* = Response{
            .allocator = allocator,
            .body = this.body.clone(globalThis),
            .url = allocator.dupe(u8, this.url) catch unreachable,
            .status_text = allocator.dupe(u8, this.status_text) catch unreachable,
            .redirected = this.redirected,
        };
    }

    pub fn clone(this: *Response, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) *Response {
        var new_response = allocator.create(Response) catch unreachable;
        this.cloneInto(new_response, allocator, globalThis);
        return new_response;
    }

    pub usingnamespace BodyMixin(@This());

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
        if (response.header(.ContentType)) |content_type| {
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

                // auto-detect HTML if unspecified
                if (strings.hasPrefixComptime(response.body.value.slice(), "<!DOCTYPE html>")) {
                    return MimeType.html.value;
                }

                return default.value;
            },
            // .InlineBlob => {
            //     // auto-detect HTML if unspecified
            //     if (strings.hasPrefixComptime(response.body.value.slice(), "<!DOCTYPE html>")) {
            //         return MimeType.html.value;
            //     }

            //     return response.body.value.InlineBlob.contentType();
            // },
            .InternalBlob => {
                // auto-detect HTML if unspecified
                if (strings.hasPrefixComptime(response.body.value.slice(), "<!DOCTYPE html>")) {
                    return MimeType.html.value;
                }

                return response.body.value.InternalBlob.contentType();
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
                if (Body.Init.init(getAllocator(globalThis), globalThis, init, init.jsType()) catch null) |_init| {
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
                if (Body.Init.init(getAllocator(globalThis), globalThis, init, init.jsType()) catch null) |_init| {
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
                    switch (arguments[1].jsType()) {
                        .Object, .FinalObject, .DOMWrapper => |js_type| {
                            break :brk Body.extractWithInit(globalThis, arguments[0], arguments[1], js_type);
                        },
                        else => {
                            break :brk Body.extract(globalThis, arguments[0]);
                        },
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

    pub const fetch_error_no_args = "fetch() expects a string but received no arguments.";
    pub const fetch_error_blank_url = "fetch() URL must not be a blank string.";
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
        http: ?*HTTPClient.AsyncHTTP = null,
        result: HTTPClient.HTTPClientResult = .{},
        javascript_vm: *VirtualMachine = undefined,
        global_this: *JSGlobalObject = undefined,
        request_body: AnyBlob = undefined,
        response_buffer: MutableString = undefined,
        request_headers: Headers = Headers{ .allocator = undefined },
        ref: *JSC.napi.Ref = undefined,
        concurrent_task: JSC.ConcurrentTask = .{},
        poll_ref: JSC.PollRef = .{},

        pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet {
            return FetchTasklet{};
        }

        fn clearData(this: *FetchTasklet) void {
            this.request_headers.entries.deinit(bun.default_allocator);
            this.request_headers.buf.deinit(bun.default_allocator);
            this.request_headers = Headers{ .allocator = undefined };
            this.http.?.deinit();

            this.result.deinitMetadata();
            this.response_buffer.deinit();
            this.request_body.detach();
        }

        pub fn deinit(this: *FetchTasklet) void {
            if (this.http) |http| this.javascript_vm.allocator.destroy(http);
            this.javascript_vm.allocator.destroy(this);
        }

        pub fn onDone(this: *FetchTasklet) void {
            if (comptime JSC.is_bindgen)
                unreachable;

            const globalThis = this.global_this;

            var ref = this.ref;
            const promise_value = ref.get();
            defer ref.destroy();
            var poll_ref = this.poll_ref;
            var vm = globalThis.bunVM();
            defer poll_ref.unref(vm);

            if (promise_value.isEmptyOrUndefinedOrNull()) {
                this.clearData();
                return;
            }

            var promise = promise_value.asPromise().?;

            const success = this.result.isSuccess();
            const result = switch (success) {
                true => this.onResolve(),
                false => this.onReject(),
            };

            this.clearData();

            promise_value.ensureStillAlive();

            switch (success) {
                true => {
                    promise.resolve(globalThis, result);
                },
                false => {
                    promise.reject(globalThis, result);
                },
            }
        }

        pub fn onReject(this: *FetchTasklet) JSValue {
            const fetch_error = JSC.SystemError{
                .code = ZigString.init(@errorName(this.result.fail)),
                .message = ZigString.init("fetch() failed"),
                .path = ZigString.init(this.http.?.url.href),
            };

            return fetch_error.toErrorInstance(this.global_this);
        }

        fn toBodyValue(this: *FetchTasklet) Body.Value {
            var response_buffer = this.response_buffer.list;
            this.response_buffer = .{
                .allocator = default_allocator,
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            };

            // if (response_buffer.items.len < InlineBlob.available_bytes) {
            //     const inline_blob = InlineBlob.init(response_buffer.items);
            //     defer response_buffer.deinit(bun.default_allocator);
            //     return .{ .InlineBlob = inline_blob };
            // }

            return .{
                .InternalBlob = .{
                    .bytes = response_buffer.toManaged(bun.default_allocator),
                },
            };
        }

        fn toResponse(this: *FetchTasklet, allocator: std.mem.Allocator) Response {
            const http_response = this.result.response;
            return Response{
                .allocator = allocator,
                .url = allocator.dupe(u8, this.result.href) catch unreachable,
                .status_text = allocator.dupe(u8, http_response.status) catch unreachable,
                .redirected = this.result.redirected,
                .body = .{
                    .init = .{
                        .headers = FetchHeaders.createFromPicoHeaders(http_response.headers),
                        .status_code = @truncate(u16, http_response.status_code),
                    },
                    .value = this.toBodyValue(),
                },
            };
        }

        pub fn onResolve(this: *FetchTasklet) JSValue {
            var allocator = this.global_this.bunVM().allocator;
            var response = allocator.create(Response) catch unreachable;
            response.* = this.toResponse(allocator);
            return Response.makeMaybePooled(@ptrCast(js.JSContextRef, this.global_this), response);
        }

        pub fn get(
            allocator: std.mem.Allocator,
            globalThis: *JSC.JSGlobalObject,
            promise: JSValue,
            fetch_options: FetchOptions,
        ) !*FetchTasklet {
            var jsc_vm = globalThis.bunVM();
            var fetch_tasklet = try jsc_vm.allocator.create(FetchTasklet);

            fetch_tasklet.* = .{
                .response_buffer = MutableString{
                    .allocator = bun.default_allocator,
                    .list = .{
                        .items = &.{},
                        .capacity = 0,
                    },
                },
                .http = try jsc_vm.allocator.create(HTTPClient.AsyncHTTP),
                .javascript_vm = jsc_vm,
                .request_body = fetch_options.body,
                .global_this = globalThis,
                .request_headers = fetch_options.headers,
                .ref = JSC.napi.Ref.create(globalThis, promise),
            };

            if (fetch_tasklet.request_body.store()) |store| {
                store.ref();
            }

            fetch_tasklet.http.?.* = HTTPClient.AsyncHTTP.init(
                allocator,
                fetch_options.method,
                fetch_options.url,
                fetch_options.headers.entries,
                fetch_options.headers.buf.items,
                &fetch_tasklet.response_buffer,
                fetch_tasklet.request_body.slice(),
                fetch_options.timeout,
                HTTPClient.HTTPClientResult.Callback.New(
                    *FetchTasklet,
                    FetchTasklet.callback,
                ).init(
                    fetch_tasklet,
                ),
            );
            fetch_tasklet.http.?.client.disable_timeout = fetch_options.disable_timeout;
            fetch_tasklet.http.?.client.verbose = fetch_options.verbose;
            fetch_tasklet.http.?.client.disable_keepalive = fetch_options.disable_keepalive;
            return fetch_tasklet;
        }

        const FetchOptions = struct {
            method: Method,
            headers: Headers,
            body: AnyBlob,
            timeout: usize,
            disable_timeout: bool,
            disable_keepalive: bool,
            url: ZigURL,
            verbose: bool = false,
        };

        pub fn queue(
            allocator: std.mem.Allocator,
            global: *JSGlobalObject,
            fetch_options: FetchOptions,
            promise: JSValue,
        ) !*FetchTasklet {
            try HTTPClient.HTTPThread.init();
            var node = try get(
                allocator,
                global,
                promise,
                fetch_options,
            );

            var batch = NetworkThread.Batch{};
            node.http.?.schedule(allocator, &batch);
            node.poll_ref.ref(global.bunVM());

            HTTPClient.http_thread.schedule(batch);

            return node;
        }

        pub fn callback(task: *FetchTasklet, result: HTTPClient.HTTPClientResult) void {
            task.response_buffer = result.body.?.*;
            task.result = result;
            task.javascript_vm.eventLoop().enqueueTaskConcurrent(task.concurrent_task.from(task));
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
        var method = Method.GET;
        var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
        defer args.deinit();

        var url: ZigURL = undefined;
        var first_arg = args.nextEat().?;
        var body: AnyBlob = AnyBlob{
            .Blob = .{},
        };
        var disable_timeout = false;
        var disable_keepalive = false;
        var verbose = false;
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

            url = ZigURL.parse(url_str);

            if (arguments.len >= 2) {
                const options = arguments[1].?.value();
                if (options.isObject() or options.jsType() == .DOMWrapper) {
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
                        if (Body.Value.fromJS(ctx.ptr(), body__)) |*body_value| {
                            // TODO: buffer ReadableStream?
                            // we have to explicitly check for InternalBlob
                            body = body_value.useAsAnyBlob();
                        } else {
                            // an error was thrown
                            return JSC.JSValue.jsUndefined().asObjectRef();
                        }
                    }

                    if (options.get(ctx, "timeout")) |timeout_value| {
                        if (timeout_value.isBoolean()) {
                            disable_timeout = !timeout_value.asBoolean();
                        } else if (timeout_value.isNumber()) {
                            disable_timeout = timeout_value.to(i32) == 0;
                        }
                    }

                    if (options.get(ctx, "keepalive")) |keepalive_value| {
                        if (keepalive_value.isBoolean()) {
                            disable_keepalive = !keepalive_value.asBoolean();
                        } else if (keepalive_value.isNumber()) {
                            disable_keepalive = keepalive_value.to(i32) == 0;
                        }
                    }
                }

                // non-standard debug things
                if (arguments.len == 3) {
                    const special = arguments[2].?.value();
                    if (!special.isEmptyOrUndefinedOrNull() and special.isObject()) {
                        if (special.get(globalThis, "verbose")) |verb| {
                            verbose = verb.toBoolean();
                        }
                    }
                }
            }
        } else if (first_arg.as(Request)) |request| {
            url = ZigURL.parse(getAllocator(ctx).dupe(u8, request.url) catch unreachable);
            method = request.method;
            if (request.headers) |head| {
                headers = Headers.from(head, bun.default_allocator) catch unreachable;
            }
            body = request.body.useAsAnyBlob();
        } else {
            const fetch_error = fetch_type_error_strings.get(js.JSValueGetType(ctx, arguments[0]));
            exception.* = ZigString.init(fetch_error).toErrorInstance(globalThis).asObjectRef();
            return null;
        }

        var deferred_promise = JSC.C.JSObjectMakeDeferredPromise(globalThis, null, null, null);

        // var resolve = FetchTasklet.FetchResolver.Class.make(ctx: js.JSContextRef, ptr: *ZigType)
        _ = FetchTasklet.queue(
            default_allocator,
            globalThis,
            .{
                .method = method,
                .url = url,
                .headers = headers orelse Headers{
                    .allocator = bun.default_allocator,
                },
                .body = body,
                .timeout = std.time.ns_per_hour,
                .disable_keepalive = disable_keepalive,
                .disable_timeout = disable_timeout,
                .verbose = verbose,
            },
            JSC.JSValue.fromRef(deferred_promise),
        ) catch unreachable;
        return deferred_promise;
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
            return PathOrBlob{
                .path = path,
            };
        }

        const arg = args.nextEat() orelse return null;

        if (arg.as(Blob)) |blob| {
            return PathOrBlob{
                .blob = blob.dupe(),
            };
        }

        return null;
    }

    pub fn fromJSNoCopy(ctx: js.JSContextRef, args: *JSC.Node.ArgumentsSlice, exception: js.ExceptionRef) ?PathOrBlob {
        if (JSC.Node.PathOrFileDescriptor.fromJS(ctx, args, exception)) |path| {
            return PathOrBlob{
                .path = path,
            };
        }

        const arg = args.nextEat() orelse return null;

        if (arg.as(Blob)) |blob| {
            return PathOrBlob{
                .blob = blob.*,
            };
        }

        return null;
    }
};

pub const Blob = struct {
    pub usingnamespace JSC.Codegen.JSBlob;

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

    pub fn contentType(this: *const Blob) string {
        return this.content_type;
    }

    pub fn isDetached(this: *const Blob) bool {
        return this.store == null;
    }

    pub fn writeFormatForSize(size: usize, writer: anytype, comptime enable_ansi_colors: bool) !void {
        try writer.writeAll(comptime Output.prettyFmt("<r>Blob<r>", enable_ansi_colors));
        try writer.print(
            comptime Output.prettyFmt(" (<yellow>{any}<r>)", enable_ansi_colors),
            .{
                bun.fmt.size(size),
            },
        );
    }
    pub fn writeFormat(this: *const Blob, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try formatter.writeIndent(Writer, writer);

        if (this.isDetached()) {
            try writer.writeAll(comptime Output.prettyFmt("<d>[<r>Blob<r> detached<d>]<r>", enable_ansi_colors));
            return;
        }

        {
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
                    try writeFormatForSize(this.size, writer, enable_ansi_colors);
                },
            }
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
                // .InlineBlob,
                .InternalBlob,
                .Empty,
                .Blob,
                => {
                    var blob = value.use();
                    // TODO: this should be one promise not two!
                    const new_promise = writeFileWithSourceDestination(globalThis, &blob, &file_blob);
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
                    value.Locked.onReceiveValue = thenWrap;
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
            return JSPromise.resolvedPromiseValue(ctx.ptr(), cloned.toJS(ctx)).asObjectRef();
        } else if (destination_type == .bytes and source_type == .file) {
            var fake_call_frame: [8]JSC.JSValue = undefined;
            @memset(@ptrCast([*]u8, &fake_call_frame), 0, @sizeOf(@TypeOf(fake_call_frame)));
            const blob_value =
                source_blob.getSlice(ctx, @ptrCast(*JSC.CallFrame, &fake_call_frame));

            return JSPromise.resolvedPromiseValue(
                ctx.ptr(),
                blob_value,
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
        var path_or_blob = PathOrBlob.fromJSNoCopy(ctx, &args, exception) orelse {
            exception.* = JSC.toInvalidArguments("Bun.write expects a path, file descriptor or a blob", .{}, ctx).asObjectRef();
            return null;
        };

        var data = args.nextEat() orelse {
            exception.* = JSC.toInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{}, ctx).asObjectRef();
            return null;
        };

        if (data.isEmptyOrUndefinedOrNull()) {
            exception.* = JSC.toInvalidArguments("Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write", .{}, ctx).asObjectRef();
            return null;
        }

        if (path_or_blob == .blob and path_or_blob.blob.store == null) {
            exception.* = JSC.toInvalidArguments("Blob is detached", .{}, ctx).asObjectRef();
            return null;
        }

        var needs_async = false;
        if (data.isString()) {
            const len = data.getLengthOfArray(ctx);

            if (len < 256 * 1024) {
                const str = data.getZigString(ctx);

                const pathlike: JSC.Node.PathOrFileDescriptor = if (path_or_blob == .path)
                    path_or_blob.path
                else
                    path_or_blob.blob.store.?.data.file.pathlike;

                if (pathlike == .path) {
                    const result = writeStringToFileFast(
                        ctx,
                        pathlike,
                        str,
                        &needs_async,
                        true,
                    );
                    if (!needs_async) {
                        return result.asObjectRef();
                    }
                } else {
                    const result = writeStringToFileFast(
                        ctx,
                        pathlike,
                        str,
                        &needs_async,
                        false,
                    );
                    if (!needs_async) {
                        return result.asObjectRef();
                    }
                }
            }
        } else if (data.asArrayBuffer(ctx)) |buffer_view| {
            if (buffer_view.byte_len < 256 * 1024) {
                const pathlike: JSC.Node.PathOrFileDescriptor = if (path_or_blob == .path)
                    path_or_blob.path
                else
                    path_or_blob.blob.store.?.data.file.pathlike;

                if (pathlike == .path) {
                    const result = writeBytesToFileFast(
                        ctx,
                        pathlike,
                        buffer_view.byteSlice(),
                        &needs_async,
                        true,
                    );

                    if (!needs_async) {
                        return result.asObjectRef();
                    }
                } else {
                    const result = writeBytesToFileFast(
                        ctx,
                        pathlike,
                        buffer_view.byteSlice(),
                        &needs_async,
                        false,
                    );

                    if (!needs_async) {
                        return result.asObjectRef();
                    }
                }
            }
        }

        // if path_or_blob is a path, convert it into a file blob
        var destination_blob: Blob = if (path_or_blob == .path)
            Blob.findOrCreateFileFromPath(path_or_blob.path, ctx.ptr())
        else
            path_or_blob.blob.dupe();

        if (destination_blob.store == null) {
            exception.* = JSC.toInvalidArguments("Writing to an empty blob is not implemented yet", .{}, ctx).asObjectRef();
            return null;
        }

        // TODO: implement a writeev() fast path
        var source_blob: Blob = brk: {
            if (data.as(Response)) |response| {
                switch (response.body.value) {
                    // .InlineBlob,
                    .InternalBlob,
                    .Used,
                    .Empty,
                    .Blob,
                    => {
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
                        response.body.value.Locked.onReceiveValue = WriteFileWaitFromLockedValueTask.thenWrap;

                        return promise.asValue(ctx.ptr()).asObjectRef();
                    },
                }
            }

            if (data.as(Request)) |request| {
                switch (request.body) {
                    // .InlineBlob,
                    .InternalBlob,
                    .Used,
                    .Empty,
                    .Blob,
                    => {
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
                        request.body.Locked.onReceiveValue = WriteFileWaitFromLockedValueTask.thenWrap;

                        return promise.asValue(ctx.ptr()).asObjectRef();
                    },
                }
            }

            break :brk Blob.get(
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

    const write_permissions = 0o664;

    fn writeStringToFileFast(
        globalThis: *JSC.JSGlobalObject,
        pathlike: JSC.Node.PathOrFileDescriptor,
        str: ZigString,
        needs_async: *bool,
        comptime needs_open: bool,
    ) JSC.JSValue {
        const fd: JSC.Node.FileDescriptor = if (comptime !needs_open) pathlike.fd else brk: {
            var file_path: [bun.MAX_PATH_BYTES]u8 = undefined;
            switch (JSC.Node.Syscall.open(
                pathlike.path.sliceZ(&file_path),
                // we deliberately don't use O_TRUNC here
                // it's a perf optimization
                std.os.O.WRONLY | std.os.O.CREAT | std.os.O.NONBLOCK,
                write_permissions,
            )) {
                .result => |result| {
                    break :brk result;
                },
                .err => |err| {
                    return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                },
            }
            unreachable;
        };

        var truncate = needs_open or str.len == 0;
        var jsc_vm = globalThis.bunVM();
        var written: usize = 0;

        defer {
            // we only truncate if it's a path
            // if it's a file descriptor, we assume they want manual control over that behavior
            if (truncate) {
                _ = JSC.Node.Syscall.system.ftruncate(fd, @intCast(i64, written));
            }

            if (needs_open) {
                _ = JSC.Node.Syscall.close(fd);
            }
        }
        if (str.len == 0) {} else if (str.is16Bit()) {
            var decoded = str.toSlice(jsc_vm.allocator);
            defer decoded.deinit();

            var remain = decoded.slice();
            const end = remain.ptr + remain.len;

            while (remain.ptr != end) {
                const result = JSC.Node.Syscall.write(fd, remain);
                switch (result) {
                    .result => |res| {
                        written += res;
                        remain = remain[res..];
                        if (res == 0) break;
                    },
                    .err => |err| {
                        truncate = false;
                        if (err.getErrno() == .AGAIN) {
                            needs_async.* = true;
                            return .zero;
                        }
                        return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                    },
                }
            }
        } else if (str.isUTF8() or strings.isAllASCII(str.slice())) {
            var remain = str.slice();
            const end = remain.ptr + remain.len;

            while (remain.ptr != end) {
                const result = JSC.Node.Syscall.write(fd, remain);
                switch (result) {
                    .result => |res| {
                        written += res;
                        remain = remain[res..];
                        if (res == 0) break;
                    },
                    .err => |err| {
                        truncate = false;
                        if (err.getErrno() == .AGAIN) {
                            needs_async.* = true;
                            return .zero;
                        }

                        return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                    },
                }
            }
        } else {
            var decoded = str.toOwnedSlice(jsc_vm.allocator) catch {
                return JSC.JSPromise.rejectedPromiseValue(globalThis, ZigString.static("Out of memory").toErrorInstance(globalThis));
            };
            defer jsc_vm.allocator.free(decoded);
            var remain = decoded;
            const end = remain.ptr + remain.len;
            while (remain.ptr != end) {
                const result = JSC.Node.Syscall.write(fd, remain);
                switch (result) {
                    .result => |res| {
                        written += res;
                        remain = remain[res..];
                        if (res == 0) break;
                    },
                    .err => |err| {
                        truncate = false;
                        if (err.getErrno() == .AGAIN) {
                            needs_async.* = true;
                            return .zero;
                        }

                        return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                    },
                }
            }
        }

        return JSC.JSPromise.resolvedPromiseValue(globalThis, JSC.JSValue.jsNumber(written));
    }

    fn writeBytesToFileFast(
        globalThis: *JSC.JSGlobalObject,
        pathlike: JSC.Node.PathOrFileDescriptor,
        bytes: []const u8,
        needs_async: *bool,
        comptime needs_open: bool,
    ) JSC.JSValue {
        const fd: JSC.Node.FileDescriptor = if (comptime !needs_open) pathlike.fd else brk: {
            var file_path: [bun.MAX_PATH_BYTES]u8 = undefined;
            switch (JSC.Node.Syscall.open(
                pathlike.path.sliceZ(&file_path),
                // we deliberately don't use O_TRUNC here
                // it's a perf optimization
                std.os.O.WRONLY | std.os.O.CREAT | std.os.O.NONBLOCK,
                write_permissions,
            )) {
                .result => |result| {
                    break :brk result;
                },
                .err => |err| {
                    return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                },
            }
            unreachable;
        };

        var truncate = needs_open or bytes.len == 0;
        var written: usize = 0;
        defer {
            if (truncate) {
                _ = JSC.Node.Syscall.system.ftruncate(fd, @intCast(i64, written));
            }

            if (needs_open) {
                _ = JSC.Node.Syscall.close(fd);
            }
        }

        var remain = bytes;
        const end = remain.ptr + remain.len;

        while (remain.ptr != end) {
            const result = JSC.Node.Syscall.write(fd, remain);
            switch (result) {
                .result => |res| {
                    written += res;
                    remain = remain[res..];
                    if (res == 0) break;
                },
                .err => |err| {
                    truncate = false;
                    if (err.getErrno() == .AGAIN) {
                        needs_async.* = true;
                        return .zero;
                    }
                    return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                },
            }
        }

        return JSC.JSPromise.resolvedPromiseValue(globalThis, JSC.JSValue.jsNumber(written));
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
        return ptr.toJS(ctx).asObjectRef();
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
                var frame = bun.default_allocator.create(@Frame(runAsync)) catch unreachable;
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
                    bun.default_allocator.destroy(@frame());
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
                var frame = bun.default_allocator.create(@Frame(runAsync)) catch unreachable;
                _ = @asyncCall(std.mem.asBytes(frame), undefined, runAsync, .{ this, task });
            }

            fn runAsync(this: *WriteFile, task: *WriteFileTask) void {
                this._runAsync();
                task.onFinish();
                suspend {
                    bun.default_allocator.destroy(@frame());
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

        pub fn isSeekable(this: *const FileStore) ?bool {
            if (this.seekable) |seekable| {
                return seekable;
            }

            if (this.mode != 0) {
                return std.os.S.ISREG(this.mode);
            }

            return null;
        }

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

    pub fn getStream(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var recommended_chunk_size: SizeType = 0;
        var arguments_ = callframe.arguments(2);
        var arguments = arguments_.ptr[0..arguments_.len];
        if (arguments.len > 0) {
            if (!arguments[0].isNumber() and !arguments[0].isUndefinedOrNull()) {
                globalThis.throwInvalidArguments("chunkSize must be a number", .{});
                return JSValue.jsUndefined();
            }

            recommended_chunk_size = @intCast(SizeType, @maximum(0, @truncate(i52, arguments[0].toInt64())));
        }
        return JSC.WebCore.ReadableStream.fromBlob(
            globalThis,
            this,
            recommended_chunk_size,
        );
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
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return promisified(this.toString(globalThis, .clone), globalThis);
    }

    pub fn getTextTransfer(
        this: *Blob,
        globalObject: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return promisified(this.toString(globalObject, .transfer), globalObject);
    }

    pub fn getJSON(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return promisified(this.toJSON(globalThis, .share), globalThis);
    }

    pub fn getArrayBufferTransfer(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return promisified(this.toArrayBuffer(globalThis, .transfer), globalThis);
    }

    pub fn getArrayBuffer(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        return promisified(this.toArrayBuffer(globalThis, .clone), globalThis);
    }

    pub fn getWriter(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var arguments_ = callframe.arguments(1);
        var arguments = arguments_.ptr[0..arguments_.len];

        var store = this.store orelse {
            globalThis.throwInvalidArguments("Blob is detached", .{});
            return JSValue.jsUndefined();
        };

        if (store.data != .file) {
            globalThis.throwInvalidArguments("Blob is read-only", .{});
            return JSValue.jsUndefined();
        }

        var sink = JSC.WebCore.FileSink.init(globalThis.allocator(), null) catch |err| {
            globalThis.throwInvalidArguments("Failed to create FileSink: {s}", .{@errorName(err)});
            return JSValue.jsUndefined();
        };

        var input_path: JSC.WebCore.PathOrFileDescriptor = undefined;
        if (store.data.file.pathlike == .fd) {
            input_path = .{ .fd = store.data.file.pathlike.fd };
        } else {
            input_path = .{
                .path = ZigString.Slice{
                    .ptr = store.data.file.pathlike.path.slice().ptr,
                    .len = @truncate(u32, store.data.file.pathlike.path.slice().len),
                    .allocated = false,
                    .allocator = bun.default_allocator,
                },
            };
        }

        var stream_start: JSC.WebCore.StreamStart = .{
            .FileSink = .{
                .input_path = input_path,
            },
        };

        if (arguments.len > 0) {
            stream_start = JSC.WebCore.StreamStart.fromJSWithTag(globalThis, arguments[0], .FileSink);
            stream_start.FileSink.input_path = input_path;
        }

        switch (sink.start(stream_start)) {
            .err => |err| {
                globalThis.vm().throwError(globalThis, err.toJSC(globalThis));
                sink.finalize();
                return JSC.JSValue.jsUndefined();
            },
            else => {},
        }

        return sink.toJS(globalThis);
    }

    /// https://w3c.github.io/FileAPI/#slice-method-algo
    /// The slice() method returns a new Blob object with bytes ranging from the
    /// optional start parameter up to but not including the optional end
    /// parameter, and with a type attribute that is the value of the optional
    /// contentType parameter. It must act as follows:
    pub fn getSlice(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var allocator = globalThis.allocator();
        var arguments_ = callframe.arguments(2);
        var args = arguments_.ptr[0..arguments_.len];

        if (this.size == 0) {
            const empty = Blob.initEmpty(globalThis);
            var ptr = allocator.create(Blob) catch {
                return JSC.JSValue.jsUndefined();
            };
            ptr.* = empty;
            ptr.allocator = allocator;
            return ptr.toJS(globalThis);
        }

        // If the optional start parameter is not used as a parameter when making this call, let relativeStart be 0.
        var relativeStart: i64 = 0;

        // If the optional end parameter is not used as a parameter when making this call, let relativeEnd be size.
        var relativeEnd: i64 = @intCast(i64, this.size);

        var args_iter = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args);
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
                var zig_str = content_type_.getZigString(globalThis);
                var slicer = zig_str.toSlice(bun.default_allocator);
                defer slicer.deinit();
                var slice = slicer.slice();
                var content_type_buf = allocator.alloc(u8, slice.len) catch unreachable;
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

        var blob_ = allocator.create(Blob) catch unreachable;
        blob_.* = blob;
        blob_.allocator = allocator;
        return blob_.toJS(globalThis);
    }

    pub fn getType(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        return ZigString.init(this.content_type).toValue(globalThis);
    }

    pub fn setType(
        this: *Blob,
        globalThis: *JSC.JSGlobalObject,
        value: JSC.JSValue,
    ) callconv(.C) bool {
        var zig_str = value.getZigString(globalThis);
        if (zig_str.is16Bit())
            return false;

        var slice = zig_str.trimmedSlice();
        if (strings.eql(slice, this.content_type))
            return true;

        const prev_content_type = this.content_type;
        {
            defer if (this.content_type_allocated) bun.default_allocator.free(prev_content_type);
            var content_type_buf = globalThis.allocator().alloc(u8, slice.len) catch unreachable;
            this.content_type = strings.copyLowercase(slice, content_type_buf);
        }

        this.content_type_allocated = true;
        return true;
    }

    pub fn getSize(this: *Blob, _: *JSC.JSGlobalObject) callconv(.C) JSValue {
        if (this.size == Blob.max_size) {
            this.resolveSize();
            if (this.size == Blob.max_size and this.store != null) {
                return JSValue.jsNumberFromChar(0);
            }
        }

        if (this.size < std.math.maxInt(i32)) {
            return JSValue.jsNumber(this.size);
        }

        return JSC.JSValue.jsNumberFromUint64(this.size);
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
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Blob {
        var allocator = globalThis.allocator();
        var blob: Blob = undefined;
        var arguments = callframe.arguments(2);
        var args = arguments.ptr[0..arguments.len];

        switch (args.len) {
            0 => {
                var empty: []u8 = &[_]u8{};
                blob = Blob.init(empty, allocator, globalThis);
            },
            else => {
                blob = get(globalThis, args[0], false, true) catch |err| {
                    if (err == error.InvalidArguments) {
                        globalThis.throwInvalidArguments("new Blob() expects an Array", .{});
                        return null;
                    }
                    globalThis.throw("out of memory", .{});
                    return null;
                };

                if (args.len > 1) {
                    var options = args[0];
                    if (options.isCell()) {
                        // type, the ASCII-encoded string in lower case
                        // representing the media type of the Blob.
                        // Normative conditions for this member are provided
                        // in the § 3.1 Constructors.
                        if (options.get(globalThis, "type")) |content_type| {
                            if (content_type.isString()) {
                                var content_type_str = content_type.getZigString(globalThis);
                                if (!content_type_str.is16Bit()) {
                                    var slice = content_type_str.trimmedSlice();
                                    var content_type_buf = allocator.alloc(u8, slice.len) catch unreachable;
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

        var blob_ = allocator.create(Blob) catch unreachable;
        blob_.* = blob;
        blob_.allocator = allocator;
        return blob_;
    }

    pub fn finalize(this: *Blob) callconv(.C) void {
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

    pub fn create(
        bytes_: []const u8,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
        was_string: bool,
    ) Blob {
        var bytes = allocator.dupe(u8, bytes_) catch @panic("Out of memory");
        return Blob{
            .size = @truncate(SizeType, bytes_.len),
            .store = if (bytes.len > 0)
                Blob.Store.init(bytes, allocator) catch unreachable
            else
                null,
            .allocator = null,
            .content_type = if (was_string) MimeType.text.value else "",
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

        if (buf.len == 0) {
            return ZigString.Empty.toValue(global);
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
                return JSC.ArrayBuffer.create(global, buf, .ArrayBuffer);
            },
            .share => {
                this.store.?.ref();
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJSWithContext(
                    global,
                    this.store.?,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
            .transfer => {
                var store = this.store.?;
                this.transfer();
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJSWithContext(
                    global,
                    store,
                    JSC.BlobArrayBuffer_deallocator,
                    null,
                );
            },
            .temporary => {
                return JSC.ArrayBuffer.fromBytes(buf, .ArrayBuffer).toJS(
                    global,
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
            return JSC.ArrayBuffer.create(global, "", .ArrayBuffer);

        return toArrayBufferWithBytes(this, global, bun.constStrToU8(view_), lifetime);
    }

    pub inline fn get(
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

                .DOMWrapper => {
                    if (top_value.as(Blob)) |blob| {
                        if (comptime move) {
                            var _blob = blob.*;
                            _blob.allocator = null;
                            blob.transfer();
                            return _blob;
                        } else {
                            return blob.dupe();
                        }
                    }
                },

                else => {},
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

                                .DOMWrapper => {
                                    if (item.as(Blob)) |blob| {
                                        could_have_non_ascii = could_have_non_ascii or !(blob.is_all_ascii orelse false);
                                        joiner.append(blob.sharedView(), 0, null);
                                        continue;
                                    }
                                },
                                else => {},
                            }
                        }

                        stack.appendAssumeCapacity(item);
                    }
                },

                .DOMWrapper => {
                    if (current.as(Blob)) |blob| {
                        could_have_non_ascii = could_have_non_ascii or !(blob.is_all_ascii orelse false);
                        joiner.append(blob.sharedView(), 0, null);
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
                    could_have_non_ascii = true;
                },

                else => {
                    var sliced = current.toSlice(global, bun.default_allocator);
                    could_have_non_ascii = could_have_non_ascii or sliced.allocated;
                    joiner.append(
                        sliced.slice(),
                        0,
                        if (sliced.allocated) sliced.allocator else null,
                    );
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

pub const AnyBlob = union(enum) {
    Blob: Blob,
    // InlineBlob: InlineBlob,
    InternalBlob: InternalBlob,

    pub fn toJSON(this: *AnyBlob, global: *JSGlobalObject, comptime lifetime: JSC.WebCore.Lifetime) JSValue {
        switch (this.*) {
            .Blob => return this.Blob.toJSON(global, lifetime),
            // .InlineBlob => {
            //     if (this.InlineBlob.len == 0) {
            //         return JSValue.jsNull();
            //     }
            //     var str = this.InlineBlob.toStringOwned(global);
            //     return str.parseJSON(global);
            // },
            .InternalBlob => {
                if (this.InternalBlob.bytes.items.len == 0) {
                    return JSValue.jsNull();
                }

                var str = this.InternalBlob.toStringOwned(global);

                // the GC will collect the string
                this.* = .{
                    .Blob = .{},
                };

                return str.parseJSON(global);
            },
        }
    }

    pub fn toString(this: *AnyBlob, global: *JSGlobalObject, comptime lifetime: JSC.WebCore.Lifetime) JSValue {
        switch (this.*) {
            .Blob => return this.Blob.toString(global, lifetime),
            // .InlineBlob => {
            //     const owned = this.InlineBlob.toStringOwned(global);
            //     this.* = .{ .InlineBlob = .{ .len = 0 } };
            //     return owned;
            // },
            .InternalBlob => {
                const owned = this.InternalBlob.toStringOwned(global);
                this.* = .{ .Blob = .{} };
                return owned;
            },
        }
    }

    pub fn toArrayBuffer(this: *AnyBlob, global: *JSGlobalObject, comptime lifetime: JSC.WebCore.Lifetime) JSValue {
        switch (this.*) {
            .Blob => return this.Blob.toArrayBuffer(global, lifetime),
            // .InlineBlob => {
            //     if (this.InlineBlob.len == 0) {
            //         return JSC.ArrayBuffer.empty.toJS(global, null);
            //     }
            //     var bytes = this.InlineBlob.sliceConst();
            //     this.InlineBlob.len = 0;
            //     const value = JSC.ArrayBuffer.create(
            //         global,
            //         bytes,
            //         .ArrayBuffer,
            //     );
            //     return value;
            // },
            .InternalBlob => {
                if (this.InternalBlob.bytes.items.len == 0) {
                    return JSC.ArrayBuffer.empty.toJS(global, null);
                }

                var bytes = this.InternalBlob.toOwnedSlice();
                this.* = .{ .Blob = .{} };
                const value = JSC.ArrayBuffer.fromBytes(
                    bytes,
                    .ArrayBuffer,
                );
                return value.toJS(global, null);
            },
        }
    }

    pub inline fn size(this: *const AnyBlob) Blob.SizeType {
        return switch (this.*) {
            .Blob => this.Blob.size,
            else => @truncate(Blob.SizeType, this.slice().len),
        };
    }

    pub fn from(this: *AnyBlob, list: std.ArrayList(u8)) void {
        this.* = .{
            .InternalBlob = InternalBlob{
                .bytes = list,
            },
        };
    }

    pub fn isDetached(this: *const AnyBlob) bool {
        return switch (this.*) {
            .Blob => |blob| blob.isDetached(),
            else => this.slice().len == 0,
        };
    }

    pub fn store(this: *const @This()) ?*Blob.Store {
        if (this.* == .Blob) {
            return this.Blob.store;
        }

        return null;
    }

    pub fn contentType(self: *const @This()) []const u8 {
        return switch (self.*) {
            .Blob => self.Blob.content_type,
            // .InlineBlob => self.InlineBlob.contentType(),
            .InternalBlob => self.InternalBlob.contentType(),
        };
    }

    pub fn wasString(self: *const @This()) bool {
        return switch (self.*) {
            .Blob => self.Blob.is_all_ascii orelse false,
            // .InlineBlob => self.InlineBlob.was_string,
            .InternalBlob => self.InternalBlob.was_string,
        };
    }

    pub inline fn slice(self: *const @This()) []const u8 {
        return switch (self.*) {
            .Blob => self.Blob.sharedView(),
            // .InlineBlob => self.InlineBlob.sliceConst(),
            .InternalBlob => self.InternalBlob.sliceConst(),
        };
    }

    pub fn needsToReadFile(self: *const @This()) bool {
        return switch (self.*) {
            .Blob => self.Blob.needsToReadFile(),
            // .InlineBlob => false,
            .InternalBlob => false,
        };
    }

    pub fn detach(self: *@This()) void {
        return switch (self.*) {
            .Blob => {
                self.Blob.detach();
                self.* = .{
                    .Blob = .{},
                };
            },
            // .InlineBlob => {
            //     self.InlineBlob.len = 0;
            // },
            .InternalBlob => {
                self.InternalBlob.bytes.clearAndFree();
                self.* = .{
                    .Blob = .{},
                };
            },
        };
    }
};

/// A single-use Blob
pub const InternalBlob = struct {
    bytes: std.ArrayList(u8),
    was_string: bool = false,

    pub fn toStringOwned(this: *@This(), globalThis: *JSC.JSGlobalObject) JSValue {
        var str = ZigString.init(this.sliceConst());

        if (strings.isAllASCII(this.sliceConst())) {
            this.bytes.items = &.{};
            this.bytes.capacity = 0;
            return str.toExternalValue(globalThis);
        }

        str.markUTF8();
        const out = str.toValueGC(globalThis);
        out.ensureStillAlive();
        this.deinit();
        return out;
    }

    pub inline fn sliceConst(this: *const @This()) []const u8 {
        return this.bytes.items;
    }

    pub fn deinit(this: *@This()) void {
        this.bytes.deinit();
    }

    pub inline fn slice(this: @This()) []u8 {
        return this.bytes.items;
    }

    pub fn toOwnedSlice(this: *@This()) []u8 {
        var bytes = this.bytes.items;
        this.bytes.items = &.{};
        this.bytes.capacity = 0;
        return bytes;
    }

    pub fn clearAndFree(this: *@This()) void {
        this.bytes.clearAndFree();
    }

    pub fn contentType(self: *const @This()) []const u8 {
        if (self.was_string) {
            return MimeType.text.value;
        }

        return MimeType.other.value;
    }
};

/// A blob which stores all the data in the same space as a real Blob
/// This is an optimization for small Response and Request bodies
/// It means that we can avoid an additional heap allocation for a small response
pub const InlineBlob = extern struct {
    const real_blob_size = @sizeOf(Blob);
    pub const IntSize = u8;
    pub const available_bytes = real_blob_size - @sizeOf(IntSize) - 1 - 1;
    bytes: [available_bytes]u8 align(1) = undefined,
    len: IntSize align(1) = 0,
    was_string: bool align(1) = false,

    pub fn concat(first: []const u8, second: []const u8) InlineBlob {
        const total = first.len + second.len;
        std.debug.assert(total <= available_bytes);

        var inline_blob: JSC.WebCore.InlineBlob = .{};
        var bytes_slice = inline_blob.bytes[0..total];

        if (first.len > 0)
            @memcpy(bytes_slice.ptr, first.ptr, first.len);

        if (second.len > 0)
            @memcpy(bytes_slice.ptr + first.len, second.ptr, second.len);

        inline_blob.len = @truncate(@TypeOf(inline_blob.len), total);
        return inline_blob;
    }

    fn internalInit(data: []const u8, was_string: bool) InlineBlob {
        std.debug.assert(data.len <= available_bytes);

        var blob = InlineBlob{
            .len = @intCast(IntSize, data.len),
            .was_string = was_string,
        };

        if (data.len > 0)
            @memcpy(&blob.bytes, data.ptr, data.len);
        return blob;
    }

    pub fn init(data: []const u8) InlineBlob {
        return internalInit(data, false);
    }

    pub fn initString(data: []const u8) InlineBlob {
        return internalInit(data, true);
    }

    pub fn toStringOwned(this: *@This(), globalThis: *JSC.JSGlobalObject) JSValue {
        if (this.len == 0)
            return ZigString.Empty.toValue(globalThis);

        var str = ZigString.init(this.sliceConst());

        if (!strings.isAllASCII(this.sliceConst())) {
            str.markUTF8();
        }

        const out = str.toValueGC(globalThis);
        out.ensureStillAlive();
        this.len = 0;
        return out;
    }

    pub fn contentType(self: *const @This()) []const u8 {
        if (self.was_string) {
            return MimeType.text.value;
        }

        return MimeType.other.value;
    }

    pub fn deinit(_: *@This()) void {}

    pub inline fn slice(this: *@This()) []u8 {
        return this.bytes[0..this.len];
    }

    pub inline fn sliceConst(this: *const @This()) []const u8 {
        return this.bytes[0..this.len];
    }

    pub fn toOwnedSlice(this: *@This()) []u8 {
        return this.slice();
    }

    pub fn clearAndFree(_: *@This()) void {}
};

// https://developer.mozilla.org/en-US/docs/Web/API/Body
pub const Body = struct {
    init: Init = Init{ .headers = null, .status_code = 200 },
    value: Value = Value.empty,

    pub inline fn len(this: *const Body) Blob.SizeType {
        return this.value.size();
    }

    pub fn slice(this: *const Body) []const u8 {
        return this.value.slice();
    }

    pub fn use(this: *Body) Blob {
        return this.value.use();
    }

    pub fn clone(this: *Body, globalThis: *JSGlobalObject) Body {
        return Body{
            .init = this.init.clone(globalThis),
            .value = this.value.clone(globalThis),
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
        } else if (this.value == .InternalBlob) {
            try formatter.printComma(Writer, writer, enable_ansi_colors);
            try writer.writeAll("\n");
            try formatter.writeIndent(Writer, writer);
            try Blob.writeFormatForSize(this.value.size(), writer, enable_ansi_colors);
        } else if (this.value == .Locked) {
            if (this.value.Locked.readable) |stream| {
                try formatter.printComma(Writer, writer, enable_ansi_colors);
                try writer.writeAll("\n");
                formatter.printAs(.Object, Writer, writer, stream.value, stream.value.jsType(), enable_ansi_colors);
            }
        }
    }

    pub fn deinit(this: *Body, _: std.mem.Allocator) void {
        if (this.init.headers) |headers| {
            this.init.headers = null;

            headers.deref();
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

        pub fn init(allocator: std.mem.Allocator, ctx: *JSGlobalObject, response_init: JSC.JSValue, js_type: JSC.JSValue.JSType) !?Init {
            var result = Init{ .status_code = 200 };

            if (!response_init.isCell())
                return null;

            if (js_type == .DOMWrapper) {
                // fast path: it's a Request object or a Response object
                // we can skip calling JS getters
                if (response_init.as(Request)) |req| {
                    if (req.headers) |headers| {
                        result.headers = headers.cloneThis();
                    }

                    result.method = req.method;
                    return result;
                }

                if (response_init.as(Response)) |req| {
                    return req.body.init.clone(ctx);
                }
            }

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
        onReceiveValue: ?fn (ctx: *anyopaque, value: *Value) void = null,

        /// conditionally runs when requesting data
        /// used in HTTP server to ignore request bodies unless asked for it
        onStartBuffering: ?fn (ctx: *anyopaque) void = null,

        onStartStreaming: ?fn (ctx: *anyopaque) JSC.WebCore.DrainResult = null,

        deinit: bool = false,
        action: Action = Action.none,

        pub fn toAnyBlob(this: *PendingValue) ?AnyBlob {
            if (this.promise != null)
                return null;

            return this.toAnyBlobAllowPromise();
        }

        pub fn toAnyBlobAllowPromise(this: *PendingValue) ?AnyBlob {
            var stream = if (this.readable != null) &this.readable.? else return null;

            if (stream.toAnyBlob(this.global)) |blob| {
                this.readable = null;
                return blob;
            }

            return null;
        }

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

                if (value.onStartBuffering) |onStartBuffering| {
                    value.onStartBuffering = null;
                    onStartBuffering(value.task.?);
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

    /// This is a duplex stream!
    pub const Value = union(Tag) {
        Blob: Blob,
        /// Single-use Blob
        /// Avoids a heap allocation.
        InternalBlob: InternalBlob,
        /// Single-use Blob that stores the bytes in the Value itself.
        // InlineBlob: InlineBlob,
        Locked: PendingValue,
        Used: void,
        Empty: void,
        Error: JSValue,

        pub fn toBlobIfPossible(this: *Value) void {
            if (this.* != .Locked)
                return;

            if (this.Locked.toAnyBlob()) |blob| {
                this.* = switch (blob) {
                    .Blob => .{ .Blob = blob.Blob },
                    .InternalBlob => .{ .InternalBlob = blob.InternalBlob },
                    // .InlineBlob => .{ .InlineBlob = blob.InlineBlob },
                };
            }
        }

        pub fn size(this: *const Value) Blob.SizeType {
            return switch (this.*) {
                .Blob => this.Blob.size,
                .InternalBlob => @truncate(Blob.SizeType, this.InternalBlob.sliceConst().len),
                // .InlineBlob => @truncate(Blob.SizeType, this.InlineBlob.sliceConst().len),
                else => 0,
            };
        }

        pub fn estimatedSize(this: *const Value) usize {
            return switch (this.*) {
                .InternalBlob => this.InternalBlob.sliceConst().len,
                // .InlineBlob => this.InlineBlob.sliceConst().len,
                else => 0,
            };
        }

        pub fn createBlobValue(data: []u8, allocator: std.mem.Allocator, was_string: bool) Value {
            // if (data.len <= InlineBlob.available_bytes) {
            //     var _blob = InlineBlob{
            //         .bytes = undefined,
            //         .was_string = was_string,
            //         .len = @truncate(InlineBlob.IntSize, data.len),
            //     };
            //     @memcpy(&_blob.bytes, data.ptr, data.len);
            //     allocator.free(data);
            //     return Value{
            //         .InlineBlob = _blob,
            //     };
            // }

            return Value{
                .InternalBlob = InternalBlob{
                    .bytes = std.ArrayList(u8).fromOwnedSlice(allocator, data),
                    .was_string = was_string,
                },
            };
        }

        pub const Tag = enum {
            Blob,
            InternalBlob,
            // InlineBlob,
            Locked,
            Used,
            Empty,
            Error,
        };

        pub const empty = Value{ .Empty = .{} };

        pub fn toReadableStream(this: *Value, globalThis: *JSGlobalObject) JSValue {
            JSC.markBinding(@src());

            switch (this.*) {
                .Used, .Empty => {
                    return JSC.WebCore.ReadableStream.empty(globalThis);
                },
                .InternalBlob,
                .Blob,
                // .InlineBlob,
                => {
                    var blob = this.use();
                    defer blob.detach();
                    blob.resolveSize();
                    const value = JSC.WebCore.ReadableStream.fromBlob(globalThis, &blob, blob.size);

                    this.* = .{
                        .Locked = .{
                            .readable = JSC.WebCore.ReadableStream.fromJS(value, globalThis).?,
                            .global = globalThis,
                        },
                    };
                    this.Locked.readable.?.value.protect();

                    return value;
                },
                .Locked => {
                    var locked = &this.Locked;
                    if (locked.readable) |readable| {
                        return readable.value;
                    }
                    var drain_result: JSC.WebCore.DrainResult = .{
                        .estimated_size = 0,
                    };

                    if (locked.onStartStreaming) |drain| {
                        locked.onStartStreaming = null;
                        drain_result = drain(locked.task.?);
                    }

                    if (drain_result == .empty or drain_result == .aborted) {
                        this.* = .{ .Empty = void{} };
                        return JSC.WebCore.ReadableStream.empty(globalThis);
                    }

                    var reader = bun.default_allocator.create(JSC.WebCore.ByteStream.Source) catch unreachable;
                    reader.* = .{
                        .context = undefined,
                        .globalThis = globalThis,
                    };

                    reader.context.setup();

                    if (drain_result == .estimated_size) {
                        reader.context.highWaterMark = @truncate(Blob.SizeType, drain_result.estimated_size);
                        reader.context.size_hint = @truncate(Blob.SizeType, drain_result.estimated_size);
                    } else if (drain_result == .owned) {
                        reader.context.buffer = drain_result.owned.list;
                        reader.context.size_hint = @truncate(Blob.SizeType, drain_result.owned.size_hint);
                    }

                    locked.readable = .{
                        .ptr = .{ .Bytes = &reader.context },
                        .value = reader.toJS(globalThis),
                    };

                    locked.readable.?.value.protect();
                    return locked.readable.?.value;
                },

                else => unreachable,
            }
        }

        pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) ?Value {
            value.ensureStillAlive();

            if (value.isEmptyOrUndefinedOrNull()) {
                return Body.Value{
                    .Empty = void{},
                };
            }

            const js_type = value.jsType();

            if (js_type.isStringLike()) {
                var str = value.getZigString(globalThis);
                if (str.len == 0) {
                    return Body.Value{
                        .Empty = {},
                    };
                }

                // if (str.is16Bit()) {
                //     if (str.maxUTF8ByteLength() < InlineBlob.available_bytes or
                //         (str.len <= InlineBlob.available_bytes and str.utf8ByteLength() <= InlineBlob.available_bytes))
                //     {
                //         var blob = InlineBlob{
                //             .was_string = true,
                //             .bytes = undefined,
                //             .len = 0,
                //         };
                //         if (comptime Environment.allow_assert) {
                //             std.debug.assert(str.utf8ByteLength() <= InlineBlob.available_bytes);
                //         }

                //         const result = strings.copyUTF16IntoUTF8(
                //             blob.bytes[0..blob.bytes.len],
                //             []const u16,
                //             str.utf16SliceAligned(),
                //         );
                //         blob.len = @intCast(InlineBlob.IntSize, result.written);
                //         std.debug.assert(@as(usize, result.read) == str.len);
                //         std.debug.assert(@as(usize, result.written) <= InlineBlob.available_bytes);

                //         return Body.Value{
                //             .InlineBlob = blob,
                //         };
                //     }
                // } else {
                //     if (str.maxUTF8ByteLength() <= InlineBlob.available_bytes or
                //         (str.len <= InlineBlob.available_bytes and str.utf8ByteLength() <= InlineBlob.available_bytes))
                //     {
                //         var blob = InlineBlob{
                //             .was_string = true,
                //             .bytes = undefined,
                //             .len = 0,
                //         };
                //         if (comptime Environment.allow_assert) {
                //             std.debug.assert(str.utf8ByteLength() <= InlineBlob.available_bytes);
                //         }
                //         const result = strings.copyLatin1IntoUTF8(
                //             blob.bytes[0..blob.bytes.len],
                //             []const u8,
                //             str.slice(),
                //         );
                //         blob.len = @intCast(InlineBlob.IntSize, result.written);
                //         std.debug.assert(@as(usize, result.read) == str.len);
                //         std.debug.assert(@as(usize, result.written) <= InlineBlob.available_bytes);
                //         return Body.Value{
                //             .InlineBlob = blob,
                //         };
                //     }
                // }

                var buffer = str.toOwnedSlice(bun.default_allocator) catch {
                    globalThis.vm().throwError(globalThis, ZigString.static("Failed to clone string").toErrorInstance(globalThis));
                    return null;
                };

                return Body.Value{
                    .InternalBlob = .{
                        .bytes = std.ArrayList(u8).fromOwnedSlice(bun.default_allocator, buffer),
                        .was_string = true,
                    },
                };
            }

            if (js_type.isTypedArray()) {
                if (value.asArrayBuffer(globalThis)) |buffer| {
                    var bytes = buffer.byteSlice();

                    if (bytes.len == 0) {
                        return Body.Value{
                            .Empty = {},
                        };
                    }

                    // if (bytes.len <= InlineBlob.available_bytes) {
                    //     return Body.Value{
                    //         .InlineBlob = InlineBlob.init(bytes),
                    //     };
                    // }

                    return Body.Value{
                        .InternalBlob = .{
                            .bytes = std.ArrayList(u8){
                                .items = bun.default_allocator.dupe(u8, bytes) catch {
                                    globalThis.vm().throwError(globalThis, ZigString.static("Failed to clone ArrayBufferView").toErrorInstance(globalThis));
                                    return null;
                                },
                                .capacity = bytes.len,
                                .allocator = bun.default_allocator,
                            },
                            .was_string = false,
                        },
                    };
                }
            }

            if (js_type == .DOMWrapper) {
                if (value.as(Blob)) |blob| {
                    return Body.Value{
                        .Blob = blob.dupe(),
                    };
                }
            }

            value.ensureStillAlive();

            if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |readable| {
                switch (readable.ptr) {
                    .Blob => |blob| {
                        var result: Value = .{
                            .Blob = Blob.initWithStore(blob.store, globalThis),
                        };
                        blob.store.ref();

                        readable.done();

                        if (!blob.done) {
                            blob.done = true;
                            blob.deinit();
                        }
                        return result;
                    },
                    else => {},
                }

                return Body.Value.fromReadableStream(readable, globalThis);
            }

            return Body.Value{
                .Blob = Blob.get(globalThis, value, true, false) catch |err| {
                    if (err == error.InvalidArguments) {
                        globalThis.throwInvalidArguments("Expected an Array", .{});
                        return null;
                    }

                    globalThis.throwInvalidArguments("Invalid Body object", .{});
                    return null;
                },
            };
        }

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

        pub fn resolve(to_resolve: *Value, new: *Value, global: *JSGlobalObject) void {
            if (to_resolve.* == .Locked) {
                var locked = &to_resolve.Locked;
                if (locked.readable) |readable| {
                    readable.done();
                    locked.readable = null;
                }

                if (locked.onReceiveValue) |callback| {
                    locked.onReceiveValue = null;
                    callback(locked.task.?, new);
                    return;
                }

                if (locked.promise) |promise_| {
                    var promise = promise_.asPromise().?;
                    locked.promise = null;

                    switch (locked.action) {
                        .getText => {
                            switch (new.*) {
                                .InternalBlob,
                                // .InlineBlob,
                                => {
                                    var blob = new.useAsAnyBlob();
                                    promise.resolve(global, blob.toString(global, .transfer));
                                },
                                else => {
                                    var blob = new.use();
                                    promise.resolve(global, blob.toString(global, .transfer));
                                },
                            }
                        },
                        .getJSON => {
                            var blob = new.useAsAnyBlob();
                            const json_value = blob.toJSON(global, .share);
                            blob.detach();

                            if (json_value.isAnyError(global)) {
                                promise.reject(global, json_value);
                            } else {
                                promise.resolve(global, json_value);
                            }
                        },
                        .getArrayBuffer => {
                            var blob = new.useAsAnyBlob();
                            promise.resolve(global, blob.toArrayBuffer(global, .transfer));
                        },
                        .getBlob => {
                            var ptr = bun.default_allocator.create(Blob) catch unreachable;
                            ptr.* = new.use();

                            ptr.allocator = bun.default_allocator;
                            promise.resolve(global, ptr.toJS(global));
                        },
                        else => {
                            var ptr = bun.default_allocator.create(Blob) catch unreachable;
                            ptr.* = new.use();
                            ptr.allocator = bun.default_allocator;
                            promise_.asInternalPromise().?.resolve(global, ptr.toJS(global));
                        },
                    }
                    JSC.C.JSValueUnprotect(global, promise_.asObjectRef());
                }
            }
        }
        pub fn slice(this: *const Value) []const u8 {
            return switch (this.*) {
                .Blob => this.Blob.sharedView(),
                .InternalBlob => this.InternalBlob.sliceConst(),
                // .InlineBlob => this.InlineBlob.sliceConst(),
                else => "",
            };
        }

        pub fn use(this: *Value) Blob {
            this.toBlobIfPossible();

            switch (this.*) {
                .Blob => {
                    var new_blob = this.Blob;
                    std.debug.assert(new_blob.allocator == null); // owned by Body
                    this.* = .{ .Used = .{} };
                    return new_blob;
                },
                .InternalBlob => {
                    var new_blob = Blob.init(
                        this.InternalBlob.toOwnedSlice(),
                        // we will never resize it from here
                        // we have to use the default allocator
                        // even if it was actually allocated on a different thread
                        bun.default_allocator,
                        JSC.VirtualMachine.vm.global,
                    );
                    if (this.InternalBlob.was_string) {
                        new_blob.content_type = MimeType.text.value;
                    }

                    this.* = .{ .Used = .{} };
                    return new_blob;
                },
                // .InlineBlob => {
                //     const cloned = this.InlineBlob.bytes;
                //     const new_blob = Blob.create(
                //         cloned[0..this.InlineBlob.len],
                //         bun.default_allocator,
                //         JSC.VirtualMachine.vm.global,
                //         this.InlineBlob.was_string,
                //     );

                //     this.* = .{ .Used = .{} };
                //     return new_blob;
                // },
                else => {
                    return Blob.initEmpty(undefined);
                },
            }
        }

        pub fn tryUseAsAnyBlob(this: *Value) ?AnyBlob {
            const any_blob: AnyBlob = switch (this.*) {
                .Blob => AnyBlob{ .Blob = this.Blob },
                .InternalBlob => AnyBlob{ .InternalBlob = this.InternalBlob },
                // .InlineBlob => AnyBlob{ .InlineBlob = this.InlineBlob },
                .Locked => this.Locked.toAnyBlobAllowPromise() orelse return null,
                else => return null,
            };

            this.* = .{ .Used = .{} };
            return any_blob;
        }

        pub fn useAsAnyBlob(this: *Value) AnyBlob {
            const any_blob: AnyBlob = switch (this.*) {
                .Blob => .{ .Blob = this.Blob },
                .InternalBlob => .{ .InternalBlob = this.InternalBlob },
                // .InlineBlob => .{ .InlineBlob = this.InlineBlob },
                .Locked => this.Locked.toAnyBlobAllowPromise() orelse AnyBlob{ .Blob = .{} },
                else => .{ .Blob = Blob.initEmpty(undefined) },
            };

            this.* = .{ .Used = {} };
            return any_blob;
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
                    JSC.C.JSValueUnprotect(global, promise.asObjectRef());
                    locked.promise = null;
                }

                if (locked.readable) |readable| {
                    readable.done();
                    locked.readable = null;
                }

                this.* = .{ .Error = error_instance };
                if (locked.onReceiveValue) |onReceiveValue| {
                    locked.onReceiveValue = null;
                    onReceiveValue(locked.task.?, this);
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
                if (!this.Locked.deinit) {
                    this.Locked.deinit = true;

                    if (this.Locked.readable) |*readable| {
                        readable.done();
                    }
                }

                return;
            }

            if (tag == .InternalBlob) {
                this.InternalBlob.clearAndFree();
                this.* = Value.empty;
            }

            if (tag == .Blob) {
                this.Blob.deinit();
                this.* = Value.empty;
            }

            if (tag == .Error) {
                JSC.C.JSValueUnprotect(VirtualMachine.vm.global, this.Error.asObjectRef());
            }
        }

        pub fn clone(this: *Value, globalThis: *JSC.JSGlobalObject) Value {
            if (this.* == .InternalBlob) {
                var internal_blob = this.InternalBlob;
                this.* = .{
                    .Blob = Blob.init(
                        internal_blob.toOwnedSlice(),
                        internal_blob.bytes.allocator,
                        globalThis,
                    ),
                };
            }

            // if (this.* == .InlineBlob) {
            //     return this.*;
            // }

            if (this.* == .Blob) {
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
            .Cell,
        );
    }

    pub fn extractWithInit(
        globalThis: *JSGlobalObject,
        value: JSValue,
        init: JSValue,
        init_type: JSValue.JSType,
    ) ?Body {
        return extractBody(
            globalThis,
            value,
            true,
            init,
            init_type,
        );
    }

    // https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
    inline fn extractBody(
        globalThis: *JSGlobalObject,
        value: JSValue,
        comptime has_init: bool,
        init: JSValue,
        init_type: JSC.JSValue.JSType,
    ) ?Body {
        var body = Body{
            .init = Init{ .headers = null, .status_code = 200 },
        };
        var allocator = getAllocator(globalThis);

        if (comptime has_init) {
            if (Init.init(allocator, globalThis, init, init_type)) |maybeInit| {
                if (maybeInit) |init_| {
                    body.init = init_;
                }
            } else |_| {}
        }

        body.value = Value.fromJS(globalThis, value) orelse return null;
        if (body.value == .Blob)
            std.debug.assert(body.value.Blob.allocator == null); // owned by Body

        return body;
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Request
pub const Request = struct {
    url: []const u8 = "",
    headers: ?*FetchHeaders = null,
    body: Body.Value = Body.Value{ .Empty = .{} },
    method: Method = Method.GET,
    uws_request: ?*uws.Request = null,
    upgrader: ?*anyopaque = null,

    // We must report a consistent value for this
    reported_estimated_size: ?u63 = null,
    base_url_string_for_joining: []const u8 = "",

    url_was_allocated: bool = false,

    pub usingnamespace JSC.Codegen.JSRequest;

    pub fn estimatedSize(this: *Request) callconv(.C) usize {
        return this.reported_estimated_size orelse brk: {
            this.reported_estimated_size = @truncate(u63, this.body.estimatedSize() + this.url.len + @sizeOf(Request));
            break :brk this.reported_estimated_size.?;
        };
    }

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
            try writer.print(comptime Output.prettyFmt("<r><b>{s}<r>", enable_ansi_colors), .{this.url});
            try writer.writeAll("\"");
            if (this.body == .Blob) {
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                try this.body.Blob.writeFormat(formatter, writer, enable_ansi_colors);
            } else if (this.body == .InternalBlob) {
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                if (this.body.size() == 0) {
                    try Blob.initEmpty(undefined).writeFormat(formatter, writer, enable_ansi_colors);
                } else {
                    try Blob.writeFormatForSize(this.body.size(), writer, enable_ansi_colors);
                }
            } else if (this.body == .Locked) {
                if (this.body.Locked.readable) |stream| {
                    try writer.writeAll("\n");
                    try formatter.writeIndent(Writer, writer);
                    formatter.printAs(.Object, Writer, writer, stream.value, stream.value.jsType(), enable_ansi_colors);
                }
            }
        }
        try writer.writeAll("\n");
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
    }

    pub fn fromRequestContext(ctx: *RequestContext) !Request {
        var req = Request{
            .url = std.mem.span(ctx.getFullURL()),
            .body = Body.Value.empty,
            .method = ctx.method,
            .headers = FetchHeaders.createFromPicoHeaders(ctx.request.headers),
            .url_was_allocated = true,
        };
        return req;
    }

    pub fn mimeType(this: *const Request) string {
        if (this.headers) |headers| {
            if (headers.fastGet(.ContentType)) |content_type| {
                return content_type.slice();
            }
        }

        switch (this.body) {
            .Blob => |blob| {
                if (blob.content_type.len > 0) {
                    return blob.content_type;
                }

                return MimeType.other.value;
            },
            .InternalBlob => return this.body.InternalBlob.contentType(),
            // .InlineBlob => return this.body.InlineBlob.contentType(),
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
            .GET => "GET",
            .HEAD => "HEAD",
            .PATCH => "PATCH",
            .PUT => "PUT",
            .POST => "POST",
            .OPTIONS => "OPTIONS",
            .CONNECT => "CONNECT",
            .TRACE => "TRACE",
            .DELETE => "DELETE",
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

        if (this.url_was_allocated) {
            bun.default_allocator.free(bun.constStrToU8(this.url));
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
        this.ensureURL() catch {
            globalObject.throw("Failed to join URL", .{});
            return .zero;
        };

        return ZigString.init(this.url).withEncoding().toValueGC(globalObject);
    }

    pub fn ensureURL(this: *Request) !void {
        if (this.url.len > 0) return;

        if (this.uws_request) |req| {
            if (this.base_url_string_for_joining.len > 0) {
                const str = try strings.append(bun.default_allocator, this.base_url_string_for_joining, req.url());
                this.url = str;

                // don't keep this around when we don't need it
                this.base_url_string_for_joining = "";
                this.url_was_allocated = true;
            } else {
                this.url = try bun.default_allocator.dupe(u8, req.url());
                this.url_was_allocated = true;
            }
        }
    }

    pub fn constructInto(
        globalThis: *JSC.JSGlobalObject,
        arguments: []const JSC.JSValue,
    ) ?Request {
        var request = Request{};

        switch (arguments.len) {
            0 => {},
            1 => {
                const urlOrObject = arguments[0];
                const url_or_object_type = urlOrObject.jsType();
                if (url_or_object_type.isStringLike()) {
                    request.url = (arguments[0].toSlice(globalThis, bun.default_allocator).cloneIfNeeded() catch {
                        return null;
                    }).slice();
                    request.url_was_allocated = request.url.len > 0;
                } else {
                    if (urlOrObject.fastGet(globalThis, .body)) |body_| {
                        if (Body.Value.fromJS(globalThis, body_)) |body| {
                            request.body = body;
                        } else {
                            return null;
                        }
                    }

                    if (Body.Init.init(getAllocator(globalThis), globalThis, arguments[0], url_or_object_type) catch null) |req_init| {
                        request.headers = req_init.headers;
                        request.method = req_init.method;
                    }

                    if (urlOrObject.fastGet(globalThis, .url)) |url| {
                        request.url = (url.toSlice(globalThis, bun.default_allocator).cloneIfNeeded() catch {
                            return null;
                        }).slice();
                        request.url_was_allocated = request.url.len > 0;
                    }
                }
            },
            else => {
                if (arguments[1].fastGet(globalThis, .body)) |body_| {
                    if (Body.Value.fromJS(globalThis, body_)) |body| {
                        request.body = body;
                    } else {
                        return null;
                    }
                }

                if (Body.Init.init(getAllocator(globalThis), globalThis, arguments[1], arguments[1].jsType()) catch null) |req_init| {
                    request.headers = req_init.headers;
                    request.method = req_init.method;
                }

                request.url = (arguments[0].toSlice(globalThis, bun.default_allocator).cloneIfNeeded() catch {
                    return null;
                }).slice();
                request.url_was_allocated = request.url.len > 0;
            },
        }

        return request;
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Request {
        const arguments_ = callframe.arguments(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        const request = constructInto(globalThis, arguments) orelse return null;
        var request_ = getAllocator(globalThis).create(Request) catch return null;
        request_.* = request;
        return request_;
    }

    pub fn getBodyValue(
        this: *Request,
    ) *Body.Value {
        return &this.body;
    }

    pub usingnamespace BodyMixin(@This());

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
        this: *Request,
        req: *Request,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
    ) void {
        this.ensureURL() catch {};

        req.* = Request{
            .body = this.body.clone(globalThis),
            .url = allocator.dupe(u8, this.url) catch {
                globalThis.throw("Failed to clone request", .{});
                return;
            },
            .method = this.method,
        };

        if (this.headers) |head| {
            req.headers = head.cloneThis();
        } else if (this.uws_request) |uws_req| {
            req.headers = FetchHeaders.createFromUWS(globalThis, uws_req);
            this.headers = req.headers.?.cloneThis().?;
        }
    }

    pub fn clone(this: *Request, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) *Request {
        var req = allocator.create(Request) catch unreachable;
        this.cloneInto(req, allocator, globalThis);
        return req;
    }
};

fn BodyMixin(comptime Type: type) type {
    return struct {
        pub fn getText(
            this: *Type,
            globalThis: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalThis);
            }

            if (value.* == .Locked) {
                return value.Locked.setPromise(globalThis, .getText);
            }

            var blob = value.useAsAnyBlob();
            return JSC.JSPromise.wrap(globalThis, blob.toString(globalThis, .transfer));
        }

        pub fn getBody(
            this: *Type,
            globalThis: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            var body: *Body.Value = this.getBodyValue();

            if (body.* == .Used) {
                // TODO: make this closed
                return JSC.WebCore.ReadableStream.empty(globalThis);
            }

            return body.toReadableStream(globalThis);
        }

        pub fn getBodyUsed(
            this: *Type,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            return JSValue.jsBoolean(this.getBodyValue().* == .Used);
        }

        pub fn getJSON(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                return value.Locked.setPromise(globalObject, .getJSON);
            }

            var blob = value.useAsAnyBlob();
            return JSC.JSPromise.wrap(globalObject, blob.toJSON(globalObject, .share));
        }

        fn handleBodyAlreadyUsed(globalObject: *JSC.JSGlobalObject) JSValue {
            return JSC.JSPromise.rejectedPromiseValue(
                globalObject,
                ZigString.static("Body already used").toErrorInstance(globalObject),
            );
        }

        pub fn getArrayBuffer(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                return value.Locked.setPromise(globalObject, .getArrayBuffer);
            }

            var blob: AnyBlob = value.useAsAnyBlob();
            return JSC.JSPromise.wrap(globalObject, blob.toArrayBuffer(globalObject, .transfer));
        }

        pub fn getBlob(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                return value.Locked.setPromise(globalObject, .getBlob);
            }

            var blob = value.use();
            var ptr = getAllocator(globalObject).create(Blob) catch unreachable;
            ptr.* = blob;
            blob.allocator = getAllocator(globalObject);
            return JSC.JSPromise.resolvedPromiseValue(globalObject, ptr.toJS(globalObject));
        }
    };
}

// https://github.com/WebKit/WebKit/blob/main/Source/WebCore/workers/service/FetchEvent.h
pub const FetchEvent = struct {
    started_waiting_at: u64 = 0,
    response: ?*Response = null,
    request_context: ?*RequestContext = null,
    request: Request,
    pending_promise: JSValue = JSValue.zero,

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
        // A Response or a Promise that resolves to a Response. Otherwise, a network error is returned to Fetch.
        if (arguments.len == 0) {
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            request_context.sendInternalError(error.respondWithWasEmpty) catch {};
            return js.JSValueMakeUndefined(ctx);
        }

        var arg = arguments[0];

        var existing_response: ?*Response = arguments[0].?.value().as(Response);

        if (existing_response == null) {
            switch (JSValue.fromRef(arg).jsType()) {
                .JSPromise => {
                    this.pending_promise = JSValue.fromRef(arg);
                },
                else => {
                    JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
                    request_context.sendInternalError(error.respondWithWasNotResponse) catch {};
                    return js.JSValueMakeUndefined(ctx);
                },
            }
        }

        if (this.pending_promise.asPromise()) |promise| {
            switch (promise.status(ctx.vm())) {
                JSC.JSPromise.Status.Pending => {
                    while (promise.status(ctx.vm()) == .Pending) {
                        ctx.bunVM().tick();
                    }
                },
                else => {},
            }

            switch (promise.status(ctx.ptr().vm())) {
                .Fulfilled => {},
                else => {
                    this.rejected = true;
                    this.pending_promise = JSValue.zero;
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
        } else if (this.pending_promise.asInternalPromise()) |promise| {
            globalThis.bunVM().waitForPromise(promise);

            switch (promise.status(ctx.ptr().vm())) {
                .Fulfilled => {},
                else => {
                    this.rejected = true;
                    this.pending_promise = JSValue.zero;
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
            this.pending_promise = JSValue.zero;
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

        defer this.pending_promise = JSValue.zero;
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
