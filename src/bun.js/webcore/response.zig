const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const MimeType = bun.http.MimeType;
const ZigURL = @import("../../url.zig").URL;
const http = @import("root").bun.http;
const FetchRedirect = http.FetchRedirect;
const JSC = @import("root").bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const strings = @import("root").bun.strings;
const string = @import("root").bun.string;
const default_allocator = @import("root").bun.default_allocator;
const FeatureFlags = @import("root").bun.FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;

const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;

const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const NullableAllocator = @import("../../nullable_allocator.zig").NullableAllocator;
const DataURL = @import("../../resolver/data_url.zig").DataURL;

const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const JSPrinter = bun.js_printer;
const picohttp = @import("root").bun.picohttp;
const StringJoiner = @import("../../string_joiner.zig");
const uws = @import("root").bun.uws;
const Mutex = @import("../../lock.zig").Lock;

const InlineBlob = JSC.WebCore.InlineBlob;
const AnyBlob = JSC.WebCore.AnyBlob;
const InternalBlob = JSC.WebCore.InternalBlob;
const BodyMixin = JSC.WebCore.BodyMixin;
const Body = JSC.WebCore.Body;
const Request = JSC.WebCore.Request;
const Blob = JSC.WebCore.Blob;
const Async = bun.Async;

const BoringSSL = bun.BoringSSL;
const X509 = @import("../api/bun/x509.zig");

pub const Response = struct {
    const ResponseMixin = BodyMixin(@This());
    pub usingnamespace JSC.Codegen.JSResponse;

    body: Body,
    init: Init,
    url: bun.String = bun.String.empty,
    redirected: bool = false,

    // We must report a consistent value for this
    reported_estimated_size: ?u63 = null,

    pub const getText = ResponseMixin.getText;
    pub const getBody = ResponseMixin.getBody;
    pub const getBodyUsed = ResponseMixin.getBodyUsed;
    pub const getJSON = ResponseMixin.getJSON;
    pub const getArrayBuffer = ResponseMixin.getArrayBuffer;
    pub const getBlob = ResponseMixin.getBlob;
    pub const getBlobWithoutCallFrame = ResponseMixin.getBlobWithoutCallFrame;
    pub const getFormData = ResponseMixin.getFormData;

    pub fn getFormDataEncoding(this: *Response) ?*bun.FormData.AsyncFormData {
        var content_type_slice: ZigString.Slice = this.getContentType() orelse return null;
        defer content_type_slice.deinit();
        const encoding = bun.FormData.Encoding.get(content_type_slice.slice()) orelse return null;
        return bun.FormData.AsyncFormData.init(bun.default_allocator, encoding) catch unreachable;
    }

    pub fn estimatedSize(this: *Response) callconv(.C) usize {
        return this.reported_estimated_size orelse brk: {
            this.reported_estimated_size = @as(
                u63,
                @intCast(this.body.value.estimatedSize() + this.url.byteSlice().len + this.init.status_text.byteSlice().len + @sizeOf(Response)),
            );
            break :brk this.reported_estimated_size.?;
        };
    }

    pub fn getBodyValue(
        this: *Response,
    ) *Body.Value {
        return &this.body.value;
    }

    pub fn getFetchHeaders(
        this: *Response,
    ) ?*FetchHeaders {
        return this.init.headers;
    }

    pub inline fn statusCode(this: *const Response) u16 {
        return this.init.status_code;
    }

    pub fn redirectLocation(this: *const Response) ?[]const u8 {
        return this.header(.Location);
    }

    pub fn header(this: *const Response, name: JSC.FetchHeaders.HTTPHeaderName) ?[]const u8 {
        return if ((this.init.headers orelse return null).fastGet(name)) |str|
            str.slice()
        else
            null;
    }

    pub const Props = struct {};

    pub fn writeFormat(this: *Response, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);
        try writer.print("Response ({}) {{\n", .{bun.fmt.size(this.body.len())});

        {
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>ok<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.isOK()), .BooleanObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>url<d>:<r> \"", enable_ansi_colors));
            try writer.print(comptime Output.prettyFmt("<r><b>{}<r>", enable_ansi_colors), .{this.url});
            try writer.writeAll("\"");
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>status<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(this.init.status_code), .NumberObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>statusText<d>:<r> ", enable_ansi_colors));
            try writer.print(comptime Output.prettyFmt("<r>\"<b>{}<r>\"", enable_ansi_colors), .{this.init.status_text});
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>headers<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Private, Writer, writer, this.getHeaders(formatter.globalThis), .DOMWrapper, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>redirected<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.redirected), .BooleanObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            formatter.resetLine();
            try this.body.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
        }
        try writer.writeAll("\n");
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
        formatter.resetLine();
    }

    pub fn isOK(this: *const Response) bool {
        return this.init.status_code >= 200 and this.init.status_code <= 299;
    }

    pub fn getURL(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return this.url.toJS(globalThis);
    }

    pub fn getResponseType(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        if (this.init.status_code < 200) {
            return ZigString.init("error").toValue(globalThis);
        }

        return ZigString.init("default").toValue(globalThis);
    }

    pub fn getStatusText(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText
        return this.init.status_text.toJS(globalThis);
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

    fn getOrCreateHeaders(this: *Response, globalThis: *JSC.JSGlobalObject) *FetchHeaders {
        if (this.init.headers == null) {
            this.init.headers = FetchHeaders.createEmpty();

            if (this.body.value == .Blob) {
                const content_type = this.body.value.Blob.content_type;
                if (content_type.len > 0) {
                    this.init.headers.?.put("content-type", content_type, globalThis);
                }
            }
        }

        return this.init.headers.?;
    }

    pub fn getHeaders(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return this.getOrCreateHeaders(globalThis).toJS(globalThis);
    }

    pub fn doClone(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const cloned = this.clone(globalThis);
        return Response.makeMaybePooled(globalThis, cloned);
    }

    pub fn makeMaybePooled(globalObject: *JSC.JSGlobalObject, ptr: *Response) JSValue {
        return ptr.toJS(globalObject);
    }

    pub fn cloneValue(
        this: *Response,
        globalThis: *JSGlobalObject,
    ) Response {
        return Response{
            .body = this.body.clone(globalThis),
            .init = this.init.clone(globalThis),
            .url = this.url.clone(),
            .redirected = this.redirected,
        };
    }

    pub fn clone(this: *Response, globalThis: *JSGlobalObject) *Response {
        return bun.new(Response, this.cloneValue(globalThis));
    }

    pub fn getStatus(
        this: *Response,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        return JSValue.jsNumber(this.init.status_code);
    }

    pub fn finalize(
        this: *Response,
    ) callconv(.C) void {
        this.init.deinit(bun.default_allocator);
        this.body.deinit(bun.default_allocator);
        this.url.deref();

        bun.destroy(this);
    }

    pub fn getContentType(
        this: *Response,
    ) ?ZigString.Slice {
        if (this.init.headers) |headers| {
            if (headers.fastGet(.ContentType)) |value| {
                return value.toSlice(bun.default_allocator);
            }
        }

        if (this.body.value == .Blob) {
            if (this.body.value.Blob.content_type.len > 0)
                return ZigString.Slice.fromUTF8NeverFree(this.body.value.Blob.content_type);
        }

        return null;
    }

    pub fn constructJSON(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args_list = callframe.arguments(2);
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args_list.ptr[0..args_list.len]);

        var response = Response{
            .body = Body{
                .value = .{ .Empty = {} },
            },
            .init = Response.Init{
                .status_code = 200,
            },
            .url = bun.String.empty,
        };

        const json_value = args.nextEat() orelse JSC.JSValue.zero;

        if (@intFromEnum(json_value) != 0) {
            var str = bun.String.empty;
            // calling JSON.stringify on an empty string adds extra quotes
            // so this is correct
            json_value.jsonStringify(globalThis, 0, &str);

            if (!str.isEmpty()) {
                if (str.value.WTFStringImpl.toUTF8IfNeeded(bun.default_allocator)) |bytes| {
                    defer str.deref();
                    response.body.value = .{
                        .InternalBlob = InternalBlob{
                            .bytes = std.ArrayList(u8).fromOwnedSlice(bun.default_allocator, @constCast(bytes.slice())),
                            .was_string = true,
                        },
                    };
                } else {
                    response.body.value = Body.Value{
                        .WTFStringImpl = str.value.WTFStringImpl,
                    };
                }
            }
        }

        if (args.nextEat()) |init| {
            if (init.isUndefinedOrNull()) {} else if (init.isNumber()) {
                response.init.status_code = @as(u16, @intCast(@min(@max(0, init.toInt32()), std.math.maxInt(u16))));
            } else {
                if (Response.Init.init(getAllocator(globalThis), globalThis, init) catch null) |_init| {
                    response.init = _init;
                }
            }
        }

        var headers_ref = response.getOrCreateHeaders(globalThis);
        headers_ref.putDefault("content-type", MimeType.json.value, globalThis);
        return bun.new(Response, response).toJS(globalThis);
    }
    pub fn constructRedirect(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var args_list = callframe.arguments(4);
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args_list.ptr[0..args_list.len]);

        var response = Response{
            .init = Response.Init{
                .status_code = 302,
            },
            .body = Body{
                .value = .{ .Empty = {} },
            },
            .url = bun.String.empty,
        };

        const url_string_value = args.nextEat() orelse JSC.JSValue.zero;
        var url_string = ZigString.init("");

        if (@intFromEnum(url_string_value) != 0) {
            url_string = url_string_value.getZigString(globalThis.ptr());
        }
        var url_string_slice = url_string.toSlice(getAllocator(globalThis));
        defer url_string_slice.deinit();

        if (args.nextEat()) |init| {
            if (init.isUndefinedOrNull()) {} else if (init.isNumber()) {
                response.init.status_code = @as(u16, @intCast(@min(@max(0, init.toInt32()), std.math.maxInt(u16))));
            } else {
                if (Response.Init.init(getAllocator(globalThis), globalThis, init) catch null) |_init| {
                    response.init = _init;
                    response.init.status_code = 302;
                }
            }
        }

        response.init.headers = response.getOrCreateHeaders(globalThis);
        var headers_ref = response.init.headers.?;
        headers_ref.put("location", url_string_slice.slice(), globalThis);
        const ptr = bun.new(Response, response);

        return ptr.toJS(globalThis);
    }
    pub fn constructError(
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const response = bun.new(
            Response,
            Response{
                .init = Response.Init{
                    .status_code = 0,
                },
                .body = Body{
                    .value = .{ .Empty = {} },
                },
            },
        );

        return response.toJS(globalThis);
    }

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Response {
        const args_list = brk: {
            var args = callframe.arguments(2);
            if (args.len > 1 and args.ptr[1].isEmptyOrUndefinedOrNull()) {
                args.len = 1;
            }
            break :brk args;
        };

        const arguments = args_list.ptr[0..args_list.len];

        const init: Init = @as(?Init, brk: {
            switch (arguments.len) {
                0 => {
                    break :brk Init{
                        .status_code = 200,
                        .headers = null,
                    };
                },
                1 => {
                    break :brk Init{
                        .status_code = 200,
                        .headers = null,
                    };
                },
                else => {
                    if (arguments[1].isObject()) {
                        break :brk Init.init(bun.default_allocator, globalThis, arguments[1]) catch null;
                    }

                    std.debug.assert(!arguments[1].isEmptyOrUndefinedOrNull());

                    const err = globalThis.createTypeErrorInstance("Expected options to be one of: null, undefined, or object", .{});
                    globalThis.throwValue(err);
                    break :brk null;
                },
            }
            unreachable;
        }) orelse return null;

        const body: Body = brk: {
            switch (arguments.len) {
                0 => {
                    break :brk Body{
                        .value = Body.Value{ .Null = {} },
                    };
                },
                else => {
                    break :brk Body.extract(globalThis, arguments[0]);
                },
            }
            unreachable;
        } orelse return null;

        var response = bun.new(Response, Response{
            .body = body,
            .init = init,
        });

        if (response.body.value == .Blob and
            response.init.headers != null and
            response.body.value.Blob.content_type.len > 0 and
            !response.init.headers.?.fastHas(.ContentType))
        {
            response.init.headers.?.put("content-type", response.body.value.Blob.content_type, globalThis);
        }

        return response;
    }

    pub const Init = struct {
        headers: ?*FetchHeaders = null,
        status_code: u16,
        status_text: bun.String = bun.String.empty,
        method: Method = Method.GET,

        pub fn clone(this: Init, ctx: *JSGlobalObject) Init {
            var that = this;
            const headers = this.headers;
            if (headers) |head| {
                that.headers = head.cloneThis(ctx);
            }
            that.status_text = this.status_text.clone();

            return that;
        }

        pub fn init(allocator: std.mem.Allocator, ctx: *JSGlobalObject, response_init: JSC.JSValue) !?Init {
            var result = Init{ .status_code = 200 };

            if (!response_init.isCell())
                return null;

            if (response_init.jsType() == .DOMWrapper) {
                // fast path: it's a Request object or a Response object
                // we can skip calling JS getters
                if (response_init.as(Request)) |req| {
                    if (req.headers) |headers| {
                        if (!headers.isEmpty()) {
                            result.headers = headers.cloneThis(ctx);
                        }
                    }

                    result.method = req.method;
                    return result;
                }

                if (response_init.as(Response)) |resp| {
                    return resp.init.clone(ctx);
                }
            }

            if (response_init.fastGet(ctx, .headers)) |headers| {
                if (headers.as(FetchHeaders)) |orig| {
                    if (!orig.isEmpty()) {
                        result.headers = orig.cloneThis(ctx);
                    }
                } else {
                    result.headers = FetchHeaders.createFromJS(ctx.ptr(), headers);
                }
            }

            if (response_init.fastGet(ctx, .status)) |status_value| {
                const number = status_value.coerceToInt64(ctx);
                if ((200 <= number and number < 600) or number == 101) {
                    result.status_code = @as(u16, @truncate(@as(u32, @intCast(number))));
                } else {
                    const err = ctx.createRangeErrorInstance("The status provided ({d}) must be 101 or in the range of [200, 599]", .{number});
                    ctx.throwValue(err);
                    return null;
                }
            }

            if (response_init.fastGet(ctx, .statusText)) |status_text| {
                result.status_text = bun.String.fromJS(status_text, ctx);
            }

            if (response_init.fastGet(ctx, .method)) |method_value| {
                var method_str = method_value.toSlice(ctx, allocator);
                defer method_str.deinit();
                if (method_str.len > 0) {
                    result.method = Method.which(method_str.slice()) orelse .GET;
                }
            }

            return result;
        }

        pub fn deinit(this: *Init, _: std.mem.Allocator) void {
            if (this.headers) |headers| {
                this.headers = null;

                headers.deref();
            }

            this.status_text.deref();
        }
    };

    pub fn @"404"(globalThis: *JSC.JSGlobalObject) Response {
        return emptyWithStatus(globalThis, 404);
    }

    pub fn @"200"(globalThis: *JSC.JSGlobalObject) Response {
        return emptyWithStatus(globalThis, 200);
    }

    inline fn emptyWithStatus(_: *JSC.JSGlobalObject, status: u16) Response {
        return bun.new(Response, .{
            .body = Body{
                .value = Body.Value{ .Null = {} },
            },
            .init = Init{
                .status_code = status,
            },
        });
    }
};

const null_fd = bun.invalid_fd;

pub const Fetch = struct {
    const headers_string = "headers";
    const method_string = "method";

    const JSType = js.JSType;

    pub const fetch_error_no_args = "fetch() expects a string but received no arguments.";
    pub const fetch_error_blank_url = "fetch() URL must not be a blank string.";
    pub const fetch_error_unexpected_body = "fetch() request with GET/HEAD/OPTIONS method cannot have body.";
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

    comptime {
        if (!JSC.is_bindgen) {
            _ = Bun__fetch;
        }
    }

    pub const FetchTasklet = struct {
        const log = Output.scoped(.FetchTasklet, false);

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
        /// response strong ref
        response: JSC.Strong = .{},
        /// stream strong ref if any is available
        readable_stream_ref: JSC.WebCore.ReadableStream.Strong = .{},
        request_headers: Headers = Headers{ .allocator = undefined },
        promise: JSC.JSPromise.Strong,
        concurrent_task: JSC.ConcurrentTask = .{},
        poll_ref: Async.KeepAlive = .{},
        memory_reporter: *JSC.MemoryReportingAllocator,
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
        abort_reason: JSValue = JSValue.zero,

        // custom checkServerIdentity
        check_server_identity: JSC.Strong = .{},
        reject_unauthorized: bool = true,
        // Custom Hostname
        hostname: ?[]u8 = null,
        is_waiting_body: bool = false,
        is_waiting_abort: bool = false,
        mutex: Mutex,

        tracker: JSC.AsyncTaskTracker,

        pub const HTTPRequestBody = union(enum) {
            AnyBlob: AnyBlob,
            Sendfile: http.Sendfile,

            pub fn store(this: *HTTPRequestBody) ?*JSC.WebCore.Blob.Store {
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
                    .Sendfile => {
                        if (@max(this.Sendfile.offset, this.Sendfile.remain) > 0)
                            _ = bun.sys.close(this.Sendfile.fd);
                        this.Sendfile.offset = 0;
                        this.Sendfile.remain = 0;
                    },
                }
            }
        };

        pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet {
            return FetchTasklet{};
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

            this.request_headers.entries.deinit(allocator);
            this.request_headers.buf.deinit(allocator);
            this.request_headers = Headers{ .allocator = undefined };

            if (this.http != null) {
                this.http.?.clearData();
            }

            if (this.metadata != null) {
                this.metadata.?.deinit(allocator);
                this.metadata = null;
            }

            this.response_buffer.deinit();
            this.response.deinit();
            this.readable_stream_ref.deinit();

            this.scheduled_response_buffer.deinit();
            this.request_body.detach();

            if (this.abort_reason != .zero)
                this.abort_reason.unprotect();

            this.check_server_identity.deinit();

            if (this.signal) |signal| {
                this.signal = null;
                signal.detach(this);
            }
        }

        pub fn deinit(this: *FetchTasklet) void {
            log("deinit", .{});
            var reporter = this.memory_reporter;
            const allocator = reporter.allocator();

            if (this.http) |http_| allocator.destroy(http_);
            allocator.destroy(this);
            // reporter.assert();
            bun.default_allocator.destroy(reporter);
        }

        pub fn onBodyReceived(this: *FetchTasklet) void {
            this.mutex.lock();
            const success = this.result.isSuccess();
            const globalThis = this.global_this;
            const is_done = !success or !this.result.has_more;
            defer {
                this.has_schedule_callback.store(false, .Monotonic);
                this.mutex.unlock();
                if (is_done) {
                    const vm = globalThis.bunVM();
                    this.poll_ref.unref(vm);
                    this.clearData();
                    this.deinit();
                }
            }

            if (!success) {
                const err = this.onReject();
                err.ensureStillAlive();
                // if we are streaming update with error
                if (this.readable_stream_ref.get()) |readable| {
                    if (readable.ptr == .Bytes) {
                        readable.ptr.Bytes.onData(
                            .{
                                .err = .{ .JSValue = err },
                            },
                            bun.default_allocator,
                        );
                    }
                }
                // if we are buffering resolve the promise
                if (this.response.get()) |response_js| {
                    if (response_js.as(Response)) |response| {
                        const body = response.body;
                        if (body.value == .Locked) {
                            if (body.value.Locked.promise) |promise_| {
                                const promise = promise_.asAnyPromise().?;
                                promise.reject(globalThis, err);
                            }
                        }
                        response.body.value.toErrorInstance(err, globalThis);
                    }
                }
                return;
            }

            if (this.readable_stream_ref.get()) |readable| {
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

                        // clean for reuse later
                        this.scheduled_response_buffer.reset();
                    } else {
                        readable.ptr.Bytes.onData(
                            .{
                                .temporary_and_done = bun.ByteList.initConst(chunk),
                            },
                            bun.default_allocator,
                        );
                    }
                    return;
                }
            }

            if (this.response.get()) |response_js| {
                if (response_js.as(Response)) |response| {
                    const body = response.body;
                    if (body.value == .Locked) {
                        if (body.value.Locked.readable) |readable| {
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

                                    // clean for reuse later
                                    this.scheduled_response_buffer.reset();
                                } else {
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
                        // we will reach here when not streaming
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
                                old.resolve(&response.body.value, this.global_this);
                            }
                        }
                    }
                }
            }
        }

        pub fn onProgressUpdate(this: *FetchTasklet) void {
            JSC.markBinding(@src());
            log("onProgressUpdate", .{});
            if (this.is_waiting_body) {
                return this.onBodyReceived();
            }
            // if we abort because of cert error
            // we wait the Http Client because we already have the response
            // we just need to deinit
            const globalThis = this.global_this;
            this.mutex.lock();

            if (this.is_waiting_abort) {
                // has_more will be false when the request is aborted/finished
                if (this.result.has_more) {
                    this.mutex.unlock();
                    return;
                }
                this.mutex.unlock();
                var poll_ref = this.poll_ref;
                const vm = globalThis.bunVM();

                poll_ref.unref(vm);
                this.clearData();
                this.deinit();
                return;
            }

            var ref = this.promise;
            const promise_value = ref.valueOrEmpty();

            var poll_ref = this.poll_ref;
            const vm = globalThis.bunVM();

            if (promise_value.isEmptyOrUndefinedOrNull()) {
                log("onProgressUpdate: promise_value is null", .{});
                ref.strong.deinit();
                this.has_schedule_callback.store(false, .Monotonic);
                this.mutex.unlock();
                poll_ref.unref(vm);
                this.clearData();
                this.deinit();
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
                    const result = this.onReject();

                    result.ensureStillAlive();
                    promise_value.ensureStillAlive();

                    promise.reject(globalThis, result);

                    tracker.didDispatch(globalThis);
                    ref.strong.deinit();
                    this.has_schedule_callback.store(false, .Monotonic);
                    this.mutex.unlock();
                    if (this.is_waiting_abort) {
                        return;
                    }
                    // we are already done we can deinit
                    poll_ref.unref(vm);
                    this.clearData();
                    this.deinit();
                    return;
                }
                // everything ok
                if (this.metadata == null) {
                    log("onProgressUpdate: metadata is null", .{});
                    this.has_schedule_callback.store(false, .Monotonic);
                    // cannot continue without metadata
                    this.mutex.unlock();
                    return;
                }
            }

            const promise = promise_value.asAnyPromise().?;
            _ = promise;
            const tracker = this.tracker;
            tracker.willDispatch(globalThis);
            defer {
                log("onProgressUpdate: promise_value is not null", .{});
                tracker.didDispatch(globalThis);
                ref.strong.deinit();
                this.has_schedule_callback.store(false, .Monotonic);
                this.mutex.unlock();
                if (!this.is_waiting_body) {
                    poll_ref.unref(vm);
                    this.clearData();
                    this.deinit();
                }
            }
            const success = this.result.isSuccess();

            const result = switch (success) {
                true => this.onResolve(),
                false => this.onReject(),
            };
            result.ensureStillAlive();

            promise_value.ensureStillAlive();
            const Holder = struct {
                held: JSC.Strong,
                promise: JSC.Strong,
                globalObject: *JSC.JSGlobalObject,
                task: JSC.AnyTask,

                pub fn resolve(held: *@This()) void {
                    var prom = held.promise.swap().asAnyPromise().?;
                    const globalObject = held.globalObject;
                    const res = held.held.swap();
                    held.held.deinit();
                    held.promise.deinit();
                    res.ensureStillAlive();

                    bun.default_allocator.destroy(held);
                    prom.resolve(globalObject, res);
                }

                pub fn reject(held: *@This()) void {
                    var prom = held.promise.swap().asAnyPromise().?;
                    const globalObject = held.globalObject;
                    const res = held.held.swap();
                    held.held.deinit();
                    held.promise.deinit();
                    res.ensureStillAlive();

                    bun.default_allocator.destroy(held);
                    prom.reject(globalObject, res);
                }
            };

            var holder = bun.default_allocator.create(Holder) catch unreachable;
            holder.* = .{
                .held = JSC.Strong.create(result, globalThis),
                .promise = ref.strong,
                .globalObject = globalThis,
                .task = undefined,
            };
            ref.strong = .{};
            holder.task = switch (success) {
                true => JSC.AnyTask.New(Holder, Holder.resolve).init(holder),
                false => JSC.AnyTask.New(Holder, Holder.reject).init(holder),
            };

            globalThis.bunVM().enqueueTask(JSC.Task.init(&holder.task));
        }

        pub fn checkServerIdentity(this: *FetchTasklet, certificate_info: http.CertificateInfo) bool {
            if (this.check_server_identity.get()) |check_server_identity| {
                check_server_identity.ensureStillAlive();
                if (certificate_info.cert.len > 0) {
                    const cert = certificate_info.cert;
                    var cert_ptr = cert.ptr;
                    if (BoringSSL.d2i_X509(null, &cert_ptr, @intCast(cert.len))) |x509| {
                        defer BoringSSL.X509_free(x509);
                        const globalObject = this.global_this;
                        const js_cert = X509.toJS(x509, globalObject);
                        var hostname: bun.String = bun.String.createUTF8(certificate_info.hostname);
                        const js_hostname = hostname.toJS(globalObject);
                        js_hostname.ensureStillAlive();
                        js_cert.ensureStillAlive();
                        const check_result = check_server_identity.callWithThis(globalObject, JSC.JSValue.jsUndefined(), &[_]JSC.JSValue{ js_hostname, js_cert });
                        // if check failed abort the request
                        if (check_result.isAnyError()) {
                            // mark to wait until deinit
                            this.is_waiting_abort = this.result.has_more;

                            check_result.ensureStillAlive();
                            check_result.protect();
                            this.abort_reason = check_result;
                            this.signal_store.aborted.store(true, .Monotonic);
                            this.tracker.didCancel(this.global_this);

                            // we need to abort the request
                            if (this.http != null) {
                                http.http_thread.scheduleShutdown(this.http.?);
                            }
                            this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                            return false;
                        }
                        return true;
                    }
                }
            }
            this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
            return false;
        }

        pub fn getAbortError(this: *FetchTasklet) ?JSValue {
            // If this thread already received a signal we should abort
            if (this.abort_reason != .zero) {
                return this.abort_reason;
            }
            if (this.signal) |signal| {
                if (signal.aborted()) {
                    this.abort_reason = signal.abortReason();
                    if (this.abort_reason.isEmptyOrUndefinedOrNull()) {
                        return JSC.WebCore.AbortSignal.createAbortError(JSC.ZigString.static("The user aborted a request"), &JSC.ZigString.Empty, this.global_this);
                    }
                    this.abort_reason.protect();
                    return this.abort_reason;
                }
            }
            return null;
        }
        pub fn onReject(this: *FetchTasklet) JSValue {
            log("onReject", .{});

            if (this.getAbortError()) |err| {
                return err;
            }

            if (this.result.isTimeout()) {
                // Timeout without reason
                return JSC.WebCore.AbortSignal.createTimeoutError(JSC.ZigString.static("The operation timed out"), &JSC.ZigString.Empty, this.global_this);
            }

            if (this.result.isAbort()) {
                // Abort without reason
                return JSC.WebCore.AbortSignal.createAbortError(JSC.ZigString.static("The user aborted a request"), &JSC.ZigString.Empty, this.global_this);
            }

            var path: bun.String = undefined;

            // some times we don't have metadata so we also check http.url
            if (this.metadata) |metadata| {
                path = bun.String.createUTF8(metadata.url);
            } else if (this.http) |http_| {
                path = bun.String.createUTF8(http_.url.href);
            } else {
                path = bun.String.empty;
            }

            const fetch_error = JSC.SystemError{
                .code = bun.String.static(@errorName(this.result.fail)),
                .message = switch (this.result.fail) {
                    error.ConnectionClosed => bun.String.static("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"),
                    error.FailedToOpenSocket => bun.String.static("Was there a typo in the url or port?"),
                    error.TooManyRedirects => bun.String.static("The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()"),
                    error.ConnectionRefused => bun.String.static("Unable to connect. Is the computer able to access the url?"),

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
                    error.UNKKNOW_CERTIFICATE_VERIFICATION_ERROR => bun.String.static("unknown certificate verification error"),
                    else => bun.String.static("fetch() failed. For more information, pass `verbose: true` in the second argument to fetch()"),
                },
                .path = path,
            };

            return fetch_error.toErrorInstance(this.global_this);
        }

        pub fn onReadableStreamAvailable(ctx: *anyopaque, readable: JSC.WebCore.ReadableStream) void {
            const this = bun.cast(*FetchTasklet, ctx);
            this.readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable, this.global_this) catch .{};
        }

        pub fn onStartStreamingRequestBodyCallback(ctx: *anyopaque) JSC.WebCore.DrainResult {
            const this = bun.cast(*FetchTasklet, ctx);
            if (this.http) |http_| {
                http_.enableBodyStreaming();
            }
            if (this.signal_store.aborted.load(.Monotonic)) {
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
                else => 0,
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
            std.debug.assert(this.metadata != null);
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

        pub fn onResolve(this: *FetchTasklet) JSValue {
            log("onResolve", .{});
            const response = bun.new(Response, this.toResponse());
            const response_js = Response.makeMaybePooled(@as(js.JSContextRef, this.global_this), response);
            response_js.ensureStillAlive();
            this.response = JSC.Strong.create(response_js, this.global_this);
            return response_js;
        }

        pub fn get(
            allocator: std.mem.Allocator,
            globalThis: *JSC.JSGlobalObject,
            promise: JSC.JSPromise.Strong,
            fetch_options: FetchOptions,
        ) !*FetchTasklet {
            var jsc_vm = globalThis.bunVM();
            var fetch_tasklet = try allocator.create(FetchTasklet);

            fetch_tasklet.* = .{
                .mutex = Mutex.init(),
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
                .request_headers = fetch_options.headers,
                .promise = promise,
                .url_proxy_buffer = fetch_options.url_proxy_buffer,
                .signal = fetch_options.signal,
                .hostname = fetch_options.hostname,
                .tracker = JSC.AsyncTaskTracker.init(jsc_vm),
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
                    proxy = fetch_options.proxy orelse jsc_vm.bundler.env.getHttpProxy(fetch_options.url);
                }
            } else {
                proxy = jsc_vm.bundler.env.getHttpProxy(fetch_options.url);
            }

            if (fetch_tasklet.check_server_identity.has() and fetch_tasklet.reject_unauthorized) {
                fetch_tasklet.signal_store.cert_errors.store(true, .Monotonic);
            } else {
                fetch_tasklet.signals.cert_errors = null;
                // we use aborted to signal that we should abort reject_unauthorized after check with check_server_identity
                if (fetch_tasklet.signal == null) {
                    fetch_tasklet.signals.aborted = null;
                }
            }

            fetch_tasklet.http.?.* = http.AsyncHTTP.init(
                fetch_options.memory_reporter.allocator(),
                fetch_options.method,
                fetch_options.url,
                fetch_options.headers.entries,
                fetch_options.headers.buf.items,
                &fetch_tasklet.response_buffer,
                fetch_tasklet.request_body.slice(),
                fetch_options.timeout,
                http.HTTPClientResult.Callback.New(
                    *FetchTasklet,
                    FetchTasklet.callback,
                ).init(
                    fetch_tasklet,
                ),
                proxy,

                fetch_options.hostname,
                fetch_options.redirect_type,
                fetch_tasklet.signals,
            );

            if (fetch_options.redirect_type != FetchRedirect.follow) {
                fetch_tasklet.http.?.client.remaining_redirect_count = 0;
            }

            fetch_tasklet.http.?.client.disable_timeout = fetch_options.disable_timeout;
            fetch_tasklet.http.?.client.verbose = fetch_options.verbose;
            fetch_tasklet.http.?.client.disable_keepalive = fetch_options.disable_keepalive;
            fetch_tasklet.http.?.client.disable_decompression = fetch_options.disable_decompression;
            fetch_tasklet.http.?.client.reject_unauthorized = fetch_options.reject_unauthorized;

            // we wanna to return after headers are received
            fetch_tasklet.signal_store.header_progress.store(true, .Monotonic);

            if (fetch_tasklet.request_body == .Sendfile) {
                std.debug.assert(fetch_options.url.isHTTP());
                std.debug.assert(fetch_options.proxy == null);
                fetch_tasklet.http.?.request_body = .{ .sendfile = fetch_tasklet.request_body.Sendfile };
            }

            if (fetch_tasklet.signal) |signal| {
                fetch_tasklet.signal = signal.listen(FetchTasklet, fetch_tasklet, FetchTasklet.abortListener);
            }
            return fetch_tasklet;
        }

        pub fn abortListener(this: *FetchTasklet, reason: JSValue) void {
            log("abortListener", .{});
            reason.ensureStillAlive();
            this.abort_reason = reason;
            reason.protect();
            this.signal_store.aborted.store(true, .Monotonic);
            this.tracker.didCancel(this.global_this);

            if (this.http != null) {
                http.http_thread.scheduleShutdown(this.http.?);
            }
        }

        const FetchOptions = struct {
            method: Method,
            headers: Headers,
            body: HTTPRequestBody,
            timeout: usize,
            disable_timeout: bool,
            disable_keepalive: bool,
            disable_decompression: bool,
            reject_unauthorized: bool,
            url: ZigURL,
            verbose: bool = false,
            redirect_type: FetchRedirect = FetchRedirect.follow,
            proxy: ?ZigURL = null,
            url_proxy_buffer: []const u8 = "",
            signal: ?*JSC.WebCore.AbortSignal = null,
            globalThis: ?*JSGlobalObject,
            // Custom Hostname
            hostname: ?[]u8 = null,
            memory_reporter: *JSC.MemoryReportingAllocator,
            check_server_identity: JSC.Strong = .{},
        };

        pub fn queue(
            allocator: std.mem.Allocator,
            global: *JSGlobalObject,
            fetch_options: FetchOptions,
            promise: JSC.JSPromise.Strong,
        ) !*FetchTasklet {
            try http.HTTPThread.init();
            var node = try get(
                allocator,
                global,
                promise,
                fetch_options,
            );

            var batch = bun.ThreadPool.Batch{};
            node.http.?.schedule(allocator, &batch);
            node.poll_ref.ref(global.bunVM());

            http.http_thread.schedule(batch);

            return node;
        }

        pub fn callback(task: *FetchTasklet, result: http.HTTPClientResult) void {
            task.mutex.lock();
            defer task.mutex.unlock();
            log("callback success {} has_more {} bytes {}", .{ result.isSuccess(), result.has_more, result.body.?.list.items.len });
            task.result = result;

            // metadata should be provided only once so we preserve it until we consume it
            if (result.metadata) |metadata| {
                log("added callback metadata", .{});
                std.debug.assert(task.metadata == null);
                task.metadata = metadata;
            }
            task.body_size = result.body_size;

            const success = result.isSuccess();
            task.response_buffer = result.body.?.*;
            if (success) {
                _ = task.scheduled_response_buffer.write(task.response_buffer.list.items) catch @panic("OOM");
            }
            // reset for reuse
            task.response_buffer.reset();

            if (task.has_schedule_callback.cmpxchgStrong(false, true, .Acquire, .Monotonic)) |has_schedule_callback| {
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
            const err = JSC.createError(globalThis, "failed to fetch the data URL", .{});
            return JSPromise.rejectedPromiseValue(globalThis, err);
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

    pub export fn Bun__fetch(
        ctx: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());
        const globalThis = ctx.ptr();
        const arguments = callframe.arguments(2);

        var exception_val = [_]JSC.C.JSValueRef{null};
        const exception: JSC.C.ExceptionRef = &exception_val;
        var memory_reporter = bun.default_allocator.create(JSC.MemoryReportingAllocator) catch @panic("out of memory");
        var free_memory_reporter = false;
        var allocator = memory_reporter.wrap(bun.default_allocator);
        defer {
            if (exception.* != null) {
                free_memory_reporter = true;
                ctx.throwValue(JSC.JSValue.c(exception.*));
            }

            memory_reporter.report(globalThis.vm());

            if (free_memory_reporter) bun.default_allocator.destroy(memory_reporter);
        }

        if (arguments.len == 0) {
            const err = JSC.toTypeError(.ERR_MISSING_ARGS, fetch_error_no_args, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        var headers: ?Headers = null;
        var method = Method.GET;
        var script_ctx = globalThis.bunVM();

        var args = JSC.Node.ArgumentsSlice.init(script_ctx, arguments.slice());

        var url = ZigURL{};
        var first_arg = args.nextEat().?;

        // We must always get the Body before the Headers That way, we can set
        // the Content-Type header from the Blob if no Content-Type header is
        // set in the Headers
        //
        // which is important for FormData.
        // https://github.com/oven-sh/bun/issues/2264
        //
        var body: AnyBlob = AnyBlob{
            .Blob = .{},
        };
        var disable_timeout = false;
        var disable_keepalive = false;
        var disable_decompression = false;
        var verbose = script_ctx.log.level.atLeast(.debug);
        var proxy: ?ZigURL = null;
        var redirect_type: FetchRedirect = FetchRedirect.follow;
        var signal: ?*JSC.WebCore.AbortSignal = null;
        // Custom Hostname
        var hostname: ?[]u8 = null;

        var url_proxy_buffer: []const u8 = undefined;
        var is_file_url = false;
        var reject_unauthorized = script_ctx.bundler.env.getTLSRejectUnauthorized();
        var check_server_identity: JSValue = .zero;
        // TODO: move this into a DRYer implementation
        // The status quo is very repetitive and very bug prone
        if (first_arg.as(Request)) |request| {
            request.ensureURL() catch unreachable;

            if (request.url.isEmpty()) {
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_blank_url, .{}, ctx);
                // clean hostname if any
                if (hostname) |host| {
                    allocator.free(host);
                    hostname = null;
                }
                free_memory_reporter = true;
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }

            if (request.url.hasPrefixComptime("data:")) {
                var url_slice = request.url.toUTF8WithoutRef(allocator);
                defer url_slice.deinit();

                var data_url = DataURL.parseWithoutCheck(url_slice.slice()) catch {
                    const err = JSC.createError(globalThis, "failed to fetch the data URL", .{});
                    return JSPromise.rejectedPromiseValue(globalThis, err);
                };

                data_url.url = request.url;
                return dataURLResponse(data_url, globalThis, allocator);
            }

            url = ZigURL.fromString(allocator, request.url) catch {
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() URL is invalid", .{}, ctx);
                // clean hostname if any
                if (hostname) |host| {
                    allocator.free(host);
                    hostname = null;
                }
                free_memory_reporter = true;
                return JSPromise.rejectedPromiseValue(
                    globalThis,
                    err,
                );
            };
            is_file_url = url.isFile();
            url_proxy_buffer = url.href;
            if (!is_file_url) {
                if (args.nextEat()) |options| {
                    if (options.isObject() or options.jsType() == .DOMWrapper) {
                        if (options.fastGet(ctx.ptr(), .method)) |method_| {
                            var slice_ = method_.toSlice(ctx.ptr(), allocator);
                            defer slice_.deinit();
                            method = Method.which(slice_.slice()) orelse .GET;
                        } else {
                            method = request.method;
                        }

                        if (options.fastGet(ctx.ptr(), .body)) |body__| {
                            if (Body.Value.fromJS(ctx.ptr(), body__)) |body_const| {
                                var body_value = body_const;
                                // TODO: buffer ReadableStream?
                                // we have to explicitly check for InternalBlob
                                body = body_value.useAsAnyBlob();
                            } else {
                                // clean hostname if any
                                if (hostname) |host| {
                                    allocator.free(host);
                                    hostname = null;
                                }
                                // an error was thrown
                                return JSC.JSValue.jsUndefined();
                            }
                        } else {
                            body = request.body.value.useAsAnyBlob();
                        }

                        if (options.fastGet(ctx.ptr(), .headers)) |headers_| {
                            if (headers_.as(FetchHeaders)) |headers__| {
                                if (headers__.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    if (hostname) |host| {
                                        allocator.free(host);
                                    }
                                    hostname = _hostname.toOwnedSliceZ(allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, allocator, .{ .body = &body }) catch unreachable;
                                // TODO: make this one pass
                            } else if (FetchHeaders.createFromJS(ctx.ptr(), headers_)) |headers__| {
                                if (headers__.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    if (hostname) |host| {
                                        allocator.free(host);
                                    }
                                    hostname = _hostname.toOwnedSliceZ(allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, allocator, .{ .body = &body }) catch unreachable;
                                headers__.deref();
                            } else if (request.headers) |head| {
                                if (head.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    if (hostname) |host| {
                                        allocator.free(host);
                                    }
                                    hostname = _hostname.toOwnedSliceZ(allocator) catch unreachable;
                                }
                                headers = Headers.from(head, allocator, .{ .body = &body }) catch unreachable;
                            }
                        } else if (request.headers) |head| {
                            headers = Headers.from(head, allocator, .{ .body = &body }) catch unreachable;
                        }

                        if (options.get(ctx, "timeout")) |timeout_value| {
                            if (timeout_value.isBoolean()) {
                                disable_timeout = !timeout_value.asBoolean();
                            } else if (timeout_value.isNumber()) {
                                disable_timeout = timeout_value.to(i32) == 0;
                            }
                        }

                        if (options.getOptionalEnum(ctx, "redirect", FetchRedirect) catch {
                            return .zero;
                        }) |redirect_value| {
                            redirect_type = redirect_value;
                        }

                        if (options.get(ctx, "keepalive")) |keepalive_value| {
                            if (keepalive_value.isBoolean()) {
                                disable_keepalive = !keepalive_value.asBoolean();
                            } else if (keepalive_value.isNumber()) {
                                disable_keepalive = keepalive_value.to(i32) == 0;
                            }
                        }

                        if (options.get(globalThis, "verbose")) |verb| {
                            verbose = verb.toBoolean();
                        }

                        if (options.get(globalThis, "signal")) |signal_arg| {
                            if (signal_arg.as(JSC.WebCore.AbortSignal)) |signal_| {
                                _ = signal_.ref();
                                signal = signal_;
                            }
                        }

                        if (options.get(ctx, "decompress")) |decompress| {
                            if (decompress.isBoolean()) {
                                disable_decompression = !decompress.asBoolean();
                            } else if (decompress.isNumber()) {
                                disable_decompression = decompress.to(i32) == 0;
                            }
                        }

                        if (options.get(ctx, "tls")) |tls| {
                            if (!tls.isEmptyOrUndefinedOrNull() and tls.isObject()) {
                                if (tls.get(ctx, "rejectUnauthorized")) |reject| {
                                    if (reject.isBoolean()) {
                                        reject_unauthorized = reject.asBoolean();
                                    } else if (reject.isNumber()) {
                                        reject_unauthorized = reject.to(i32) != 0;
                                    }
                                }

                                if (tls.get(ctx, "checkServerIdentity")) |checkServerIdentity| {
                                    if (checkServerIdentity.isCell() and checkServerIdentity.isCallable(globalThis.vm())) {
                                        check_server_identity = checkServerIdentity;
                                    }
                                }
                            }
                        }

                        if (options.get(globalThis, "proxy")) |proxy_arg| {
                            if (proxy_arg.isString() and proxy_arg.getLength(ctx) > 0) {
                                var href = JSC.URL.hrefFromJS(proxy_arg, globalThis);
                                if (href.tag == .Dead) {
                                    const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{}, ctx);
                                    // clean hostname if any
                                    if (hostname) |host| {
                                        allocator.free(host);
                                        hostname = null;
                                    }
                                    allocator.free(url_proxy_buffer);

                                    return JSPromise.rejectedPromiseValue(globalThis, err);
                                }
                                defer href.deref();
                                var buffer = std.fmt.allocPrint(allocator, "{s}{}", .{ url_proxy_buffer, href }) catch {
                                    globalThis.throwOutOfMemory();
                                    return .zero;
                                };
                                url = ZigURL.parse(buffer[0..url.href.len]);
                                is_file_url = url.isFile();

                                proxy = ZigURL.parse(buffer[url.href.len..]);
                                allocator.free(url_proxy_buffer);
                                url_proxy_buffer = buffer;
                            }
                        }
                    }
                } else {
                    method = request.method;

                    if (request.body.value == .Locked) {
                        if (request.body.value.Locked.readable) |stream| {
                            if (stream.isDisturbed(globalThis)) {
                                globalThis.throw("ReadableStream has already been consumed", .{});
                                if (hostname) |host| {
                                    allocator.free(host);
                                    hostname = null;
                                }
                                return .zero;
                            }
                        }
                    }

                    // TODO: remove second isDisturbed check in useAsAnyBlob
                    body = request.body.value.useAsAnyBlob();

                    if (request.headers) |head| {
                        if (head.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                            if (hostname) |host| {
                                allocator.free(host);
                            }
                            hostname = _hostname.toOwnedSliceZ(allocator) catch unreachable;
                        }
                        headers = Headers.from(head, allocator, .{ .body = &body }) catch unreachable;
                    }
                    if (request.signal) |signal_| {
                        _ = signal_.ref();
                        signal = signal_;
                    }
                }
            }
        } else if (bun.String.tryFromJS(first_arg, globalThis)) |str| {
            defer str.deref();
            if (str.isEmpty()) {
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_blank_url, .{}, ctx);
                // clean hostname if any
                if (hostname) |host| {
                    allocator.free(host);
                    hostname = null;
                }
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }

            if (str.hasPrefixComptime("data:")) {
                var url_slice = str.toUTF8WithoutRef(allocator);
                defer url_slice.deinit();

                var data_url = DataURL.parseWithoutCheck(url_slice.slice()) catch {
                    const err = JSC.createError(globalThis, "failed to fetch the data URL", .{});
                    return JSPromise.rejectedPromiseValue(globalThis, err);
                };
                data_url.url = str;

                return dataURLResponse(data_url, globalThis, allocator);
            }

            url = ZigURL.fromString(allocator, str) catch {
                // clean hostname if any
                if (hostname) |host| {
                    allocator.free(host);
                    hostname = null;
                }
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() URL is invalid", .{}, ctx);
                return JSPromise.rejectedPromiseValue(globalThis, err);
            };
            url_proxy_buffer = url.href;
            is_file_url = url.isFile();

            if (!is_file_url) {
                if (args.nextEat()) |options| {
                    if (options.isObject() or options.jsType() == .DOMWrapper) {
                        if (options.fastGet(ctx.ptr(), .method)) |method_| {
                            var slice_ = method_.toSlice(ctx.ptr(), allocator);
                            defer slice_.deinit();
                            method = Method.which(slice_.slice()) orelse .GET;
                        }

                        if (options.fastGet(ctx.ptr(), .body)) |body__| {
                            if (Body.Value.fromJS(ctx.ptr(), body__)) |body_const| {
                                var body_value = body_const;
                                // TODO: buffer ReadableStream?
                                // we have to explicitly check for InternalBlob
                                body = body_value.useAsAnyBlob();
                            } else {
                                // clean hostname if any
                                if (hostname) |host| {
                                    allocator.free(host);
                                    hostname = null;
                                }
                                // an error was thrown
                                return JSC.JSValue.jsUndefined();
                            }
                        }

                        if (options.fastGet(ctx.ptr(), .headers)) |headers_| {
                            if (headers_.as(FetchHeaders)) |headers__| {
                                if (headers__.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    if (hostname) |host| {
                                        allocator.free(host);
                                    }
                                    hostname = _hostname.toOwnedSliceZ(allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, allocator, .{ .body = &body }) catch unreachable;
                                // TODO: make this one pass
                            } else if (FetchHeaders.createFromJS(ctx.ptr(), headers_)) |headers__| {
                                defer headers__.deref();
                                if (headers__.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    if (hostname) |host| {
                                        allocator.free(host);
                                    }
                                    hostname = _hostname.toOwnedSliceZ(allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, allocator, .{ .body = &body }) catch unreachable;
                            } else {
                                // Converting the headers failed; return null and
                                //  let the set exception get thrown
                                return .zero;
                            }
                        }

                        if (options.get(ctx, "timeout")) |timeout_value| {
                            if (timeout_value.isBoolean()) {
                                disable_timeout = !timeout_value.asBoolean();
                            } else if (timeout_value.isNumber()) {
                                disable_timeout = timeout_value.to(i32) == 0;
                            }
                        }

                        if (options.getOptionalEnum(ctx, "redirect", FetchRedirect) catch {
                            return .zero;
                        }) |redirect_value| {
                            redirect_type = redirect_value;
                        }

                        if (options.get(ctx, "keepalive")) |keepalive_value| {
                            if (keepalive_value.isBoolean()) {
                                disable_keepalive = !keepalive_value.asBoolean();
                            } else if (keepalive_value.isNumber()) {
                                disable_keepalive = keepalive_value.to(i32) == 0;
                            }
                        }

                        if (options.get(globalThis, "verbose")) |verb| {
                            verbose = verb.toBoolean();
                        }

                        if (options.get(globalThis, "signal")) |signal_arg| {
                            if (signal_arg.as(JSC.WebCore.AbortSignal)) |signal_| {
                                _ = signal_.ref();
                                signal = signal_;
                            }
                        }

                        if (options.get(ctx, "decompress")) |decompress| {
                            if (decompress.isBoolean()) {
                                disable_decompression = !decompress.asBoolean();
                            } else if (decompress.isNumber()) {
                                disable_decompression = decompress.to(i32) == 0;
                            }
                        }

                        if (options.get(ctx, "tls")) |tls| {
                            if (!tls.isEmptyOrUndefinedOrNull() and tls.isObject()) {
                                if (tls.get(ctx, "rejectUnauthorized")) |reject| {
                                    if (reject.isBoolean()) {
                                        reject_unauthorized = reject.asBoolean();
                                    } else if (reject.isNumber()) {
                                        reject_unauthorized = reject.to(i32) != 0;
                                    }
                                }

                                if (tls.get(ctx, "checkServerIdentity")) |checkServerIdentity| {
                                    if (checkServerIdentity.isCell() and checkServerIdentity.isCallable(globalThis.vm())) {
                                        check_server_identity = checkServerIdentity;
                                    }
                                }
                            }
                        }

                        if (options.getTruthy(globalThis, "proxy")) |proxy_arg| {
                            if (proxy_arg.isString() and proxy_arg.getLength(globalThis) > 0) {
                                var href = JSC.URL.hrefFromJS(proxy_arg, globalThis);
                                if (href.tag == .Dead) {
                                    const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{}, ctx);
                                    // clean hostname if any
                                    if (hostname) |host| {
                                        allocator.free(host);
                                        hostname = null;
                                    }
                                    allocator.free(url_proxy_buffer);
                                    free_memory_reporter = true;
                                    return JSPromise.rejectedPromiseValue(globalThis, err);
                                }
                                defer href.deref();
                                var buffer = std.fmt.allocPrint(allocator, "{s}{}", .{ url_proxy_buffer, href }) catch {
                                    globalThis.throwOutOfMemory();
                                    return .zero;
                                };
                                url = ZigURL.parse(buffer[0..url.href.len]);
                                proxy = ZigURL.parse(buffer[url.href.len..]);
                                allocator.free(url_proxy_buffer);
                                url_proxy_buffer = buffer;
                            }
                        }
                    }
                }
            }
        } else {
            const fetch_error = fetch_type_error_strings.get(js.JSValueGetType(ctx, first_arg.asRef()));
            const err = JSC.toTypeError(.ERR_INVALID_ARG_TYPE, "{s}", .{fetch_error}, ctx);
            exception.* = err.asObjectRef();
            return .zero;
        }

        if (url.isEmpty()) {
            free_memory_reporter = true;
            const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_blank_url, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        // This is not 100% correct.
        // We don't pass along headers, we ignore method, we ignore status code...
        // But it's better than status quo.
        if (is_file_url) {
            defer allocator.free(url_proxy_buffer);
            var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const PercentEncoding = @import("../../url.zig").PercentEncoding;
            var path_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
            var stream = std.io.fixedBufferStream(&path_buf2);
            const url_path_decoded = path_buf2[0 .. PercentEncoding.decode(
                @TypeOf(&stream.writer()),
                &stream.writer(),
                url.path,
            ) catch {
                globalThis.throwOutOfMemory();
                return .zero;
            }];
            const temp_file_path = bun.path.joinAbsStringBuf(
                globalThis.bunVM().bundler.fs.top_level_dir,
                &path_buf,
                &[_]string{
                    globalThis.bunVM().main,
                    "../",
                    url_path_decoded,
                },
                .auto,
            );
            var file_url_string = JSC.URL.fileURLFromString(bun.String.fromUTF8(temp_file_path));
            defer file_url_string.deref();

            var pathlike: JSC.Node.PathOrFileDescriptor = .{
                .path = .{
                    .encoded_slice = ZigString.Slice.init(bun.default_allocator, bun.default_allocator.dupe(u8, temp_file_path) catch {
                        globalThis.throwOutOfMemory();
                        return .zero;
                    }),
                },
            };

            const bun_file = Blob.findOrCreateFileFromPath(
                &pathlike,
                globalThis,
            );

            const response = bun.new(Response, Response{
                .body = Body{
                    .value = .{ .Blob = bun_file },
                },
                .init = Response.Init{
                    .status_code = 200,
                },
                .url = file_url_string.clone(),
            });

            return JSPromise.resolvedPromiseValue(globalThis, response.toJS(globalThis));
        }

        if (url.protocol.len > 0) {
            if (!(url.isHTTP() or url.isHTTPS())) {
                defer allocator.free(url_proxy_buffer);
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "protocol must be http: or https:", .{}, ctx);
                free_memory_reporter = true;
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }
        }

        if (!method.hasRequestBody() and body.size() > 0) {
            defer allocator.free(url_proxy_buffer);
            const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_unexpected_body, .{}, ctx);
            free_memory_reporter = true;
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        if (headers == null and body.size() > 0 and body.hasContentTypeFromUser()) {
            headers = Headers.from(
                null,
                allocator,
                .{ .body = &body },
            ) catch unreachable;
        }

        var http_body = FetchTasklet.HTTPRequestBody{
            .AnyBlob = body,
        };

        if (body.needsToReadFile()) {
            prepare_body: {
                const opened_fd_res: JSC.Node.Maybe(bun.FileDescriptor) = switch (body.Blob.store.?.data.file.pathlike) {
                    .fd => |fd| bun.sys.dup(fd),
                    .path => |path| bun.sys.open(path.sliceZ(&globalThis.bunVM().nodeFS().sync_error_buf), if (Environment.isWindows) std.os.O.RDONLY else std.os.O.RDONLY | std.os.O.NOCTTY, 0),
                };

                const opened_fd = switch (opened_fd_res) {
                    .err => |err| {
                        allocator.free(url_proxy_buffer);

                        const rejected_value = JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                        body.detach();
                        if (headers) |*headers_| {
                            headers_.buf.deinit(allocator);
                            headers_.entries.deinit(allocator);
                        }
                        free_memory_reporter = true;
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

                        const original_size = body.Blob.size;
                        const stat_size = @as(Blob.SizeType, @intCast(stat.size));
                        const blob_size = if (bun.isRegularFile(stat.mode))
                            stat_size
                        else
                            @min(original_size, stat_size);

                        http_body = .{
                            .Sendfile = .{
                                .fd = opened_fd,
                                .remain = body.Blob.offset + original_size,
                                .offset = body.Blob.offset,
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
                const res = JSC.Node.NodeFS.readFile(
                    globalThis.bunVM().nodeFS(),
                    .{
                        .encoding = .buffer,
                        .path = .{ .fd = opened_fd },
                        .offset = body.Blob.offset,
                        .max_size = body.Blob.size,
                    },
                    .sync,
                );

                if (body.Blob.store.?.data.file.pathlike == .path) {
                    _ = bun.sys.close(opened_fd);
                }

                switch (res) {
                    .err => |err| {
                        allocator.free(url_proxy_buffer);
                        free_memory_reporter = true;
                        const rejected_value = JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                        body.detach();
                        if (headers) |*headers_| {
                            headers_.buf.deinit(allocator);
                            headers_.entries.deinit(allocator);
                        }

                        return rejected_value;
                    },
                    .result => |result| {
                        body.detach();
                        body.from(std.ArrayList(u8).fromOwnedSlice(allocator, @constCast(result.slice())));
                        http_body = .{ .AnyBlob = body };
                    },
                }
            }
        }

        // Only create this after we have validated all the input.
        // or else we will leak it
        var promise = JSPromise.Strong.init(globalThis);

        const promise_val = promise.value();

        // var resolve = FetchTasklet.FetchResolver.Class.make(ctx: js.JSContextRef, ptr: *ZigType)
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
                .timeout = std.time.ns_per_hour,
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
                .hostname = hostname,
                .memory_reporter = memory_reporter,
                .check_server_identity = if (check_server_identity.isEmptyOrUndefinedOrNull()) .{} else JSC.Strong.create(check_server_identity, globalThis),
            },
            // Pass the Strong value instead of creating a new one, or else we
            // will leak it
            // see https://github.com/oven-sh/bun/issues/2985
            promise,
        ) catch unreachable;

        return promise_val;
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Headers
pub const Headers = struct {
    pub usingnamespace http.Headers;
    entries: Headers.Entries = .{},
    buf: std.ArrayListUnmanaged(u8) = .{},
    allocator: std.mem.Allocator,

    pub fn asStr(this: *const Headers, ptr: Api.StringPointer) []const u8 {
        return if (ptr.offset + ptr.length <= this.buf.items.len)
            this.buf.items[ptr.offset..][0..ptr.length]
        else
            "";
    }

    pub const Options = struct {
        body: ?*const AnyBlob = null,
    };

    pub fn from(fetch_headers_ref: ?*FetchHeaders, allocator: std.mem.Allocator, options: Options) !Headers {
        var header_count: u32 = 0;
        var buf_len: u32 = 0;
        if (fetch_headers_ref) |headers_ref|
            headers_ref.count(&header_count, &buf_len);
        var headers = Headers{
            .entries = .{},
            .buf = .{},
            .allocator = allocator,
        };
        const buf_len_before_content_type = buf_len;
        const needs_content_type = brk: {
            if (options.body) |body| {
                if (body.hasContentTypeFromUser() and (fetch_headers_ref == null or !fetch_headers_ref.?.fastHas(.ContentType))) {
                    header_count += 1;
                    buf_len += @as(u32, @truncate(body.contentType().len + "Content-Type".len));
                    break :brk true;
                }
            }
            break :brk false;
        };
        headers.entries.ensureTotalCapacity(allocator, header_count) catch unreachable;
        headers.entries.len = header_count;
        headers.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch unreachable;
        headers.buf.items.len = buf_len;
        var sliced = headers.entries.slice();
        var names = sliced.items(.name);
        var values = sliced.items(.value);
        if (fetch_headers_ref) |headers_ref|
            headers_ref.copyTo(names.ptr, values.ptr, headers.buf.items.ptr);

        // TODO: maybe we should send Content-Type header first instead of last?
        if (needs_content_type) {
            bun.copy(u8, headers.buf.items[buf_len_before_content_type..], "Content-Type");
            names[header_count - 1] = .{
                .offset = buf_len_before_content_type,
                .length = "Content-Type".len,
            };

            bun.copy(u8, headers.buf.items[buf_len_before_content_type + "Content-Type".len ..], options.body.?.contentType());
            values[header_count - 1] = .{
                .offset = buf_len_before_content_type + @as(u32, "Content-Type".len),
                .length = @as(u32, @truncate(options.body.?.contentType().len)),
            };
        }

        return headers;
    }
};
