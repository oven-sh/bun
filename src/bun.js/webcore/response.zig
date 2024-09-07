const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const MimeType = bun.http.MimeType;
const ZigURL = @import("../../url.zig").URL;
const http = bun.http;
const FetchRedirect = http.FetchRedirect;
const JSC = bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = bun.Output;
const MutableString = bun.MutableString;
const strings = bun.strings;
const string = bun.string;
const default_allocator = bun.default_allocator;
const FeatureFlags = bun.FeatureFlags;
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
const NullableAllocator = bun.NullableAllocator;
const DataURL = @import("../../resolver/data_url.zig").DataURL;

const SSLConfig = @import("../api/server.zig").ServerConfig.SSLConfig;

const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const JSPrinter = bun.js_printer;
const picohttp = bun.picohttp;
const StringJoiner = bun.StringJoiner;
const uws = bun.uws;
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
const PosixToWinNormalizer = bun.path.PosixToWinNormalizer;

pub const Response = struct {
    const ResponseMixin = BodyMixin(@This());
    pub usingnamespace JSC.Codegen.JSResponse;

    body: Body,
    init: Init,
    url: bun.String = bun.String.empty,
    redirected: bool = false,
    /// We increment this count in fetch so if JS Response is discarted we can resolve the Body
    /// In the server we use a flag response_protected to protect/unprotect the response
    ref_count: u32 = 1,

    // We must report a consistent value for this
    reported_estimated_size: usize = 0,

    pub const getText = ResponseMixin.getText;
    pub const getBody = ResponseMixin.getBody;
    pub const getBytes = ResponseMixin.getBytes;
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
        return bun.FormData.AsyncFormData.init(bun.default_allocator, encoding) catch bun.outOfMemory();
    }

    pub fn estimatedSize(this: *Response) callconv(.C) usize {
        return this.reported_estimated_size;
    }

    pub fn calculateEstimatedByteSize(this: *Response) void {
        this.reported_estimated_size = this.body.value.estimatedSize() +
            this.url.byteSlice().len +
            this.init.status_text.byteSlice().len +
            @sizeOf(Response);
    }

    pub fn toJS(this: *Response, globalObject: *JSGlobalObject) JSValue {
        this.calculateEstimatedByteSize();
        return Response.toJSUnchecked(globalObject, this);
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
        try writer.print("Response ({}) {{\n", .{bun.fmt.size(this.body.len(), .{})});

        {
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>ok<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.isOK()), .BooleanObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>url<d>:<r> \"", enable_ansi_colors));
            try writer.print(comptime Output.prettyFmt("<r><b>{}<r>", enable_ansi_colors), .{this.url});
            try writer.writeAll("\"");
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>status<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(this.init.status_code), .NumberObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>statusText<d>:<r> ", enable_ansi_colors));
            try writer.print(comptime Output.prettyFmt("<r>\"<b>{}<r>\"", enable_ansi_colors), .{this.init.status_text});
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>headers<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Private, Writer, writer, this.getHeaders(formatter.globalThis), .DOMWrapper, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>redirected<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.redirected), .BooleanObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
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
    ) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return this.url.toJS(globalThis);
    }

    pub fn getResponseType(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        if (this.init.status_code < 200) {
            return ZigString.init("error").toJS(globalThis);
        }

        return ZigString.init("default").toJS(globalThis);
    }

    pub fn getStatusText(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText
        return this.init.status_text.toJS(globalThis);
    }

    pub fn getRedirected(
        this: *Response,
        _: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected
        return JSValue.jsBoolean(this.redirected);
    }

    pub fn getOK(
        this: *Response,
        _: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        return JSValue.jsBoolean(this.isOK());
    }

    fn getOrCreateHeaders(this: *Response, globalThis: *JSC.JSGlobalObject) *FetchHeaders {
        if (this.init.headers == null) {
            this.init.headers = FetchHeaders.createEmpty();

            if (this.body.value == .Blob) {
                const content_type = this.body.value.Blob.content_type;
                if (content_type.len > 0) {
                    this.init.headers.?.put(.ContentType, content_type, globalThis);
                }
            }
        }

        return this.init.headers.?;
    }

    pub fn getHeaders(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return this.getOrCreateHeaders(globalThis).toJS(globalThis);
    }

    pub fn doClone(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSValue {
        const this_value = callframe.this();
        const cloned = this.clone(globalThis);
        if (globalThis.hasException()) {
            cloned.finalize();
            return .zero;
        }

        const js_wrapper = Response.makeMaybePooled(globalThis, cloned);

        if (js_wrapper != .zero) {
            if (cloned.body.value == .Locked) {
                if (cloned.body.value.Locked.readable.get()) |readable| {
                    // If we are teed, then we need to update the cached .body
                    // value to point to the new readable stream
                    // We must do this on both the original and cloned response
                    // but especially the original response since it will have a stale .body value now.
                    Response.bodySetCached(js_wrapper, globalThis, readable.value);
                    if (this.body.value.Locked.readable.get()) |other_readable| {
                        Response.bodySetCached(this_value, globalThis, other_readable.value);
                    }
                }
            }
        }

        return js_wrapper;
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
    ) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        return JSValue.jsNumber(this.init.status_code);
    }

    fn destroy(this: *Response) void {
        this.init.deinit(bun.default_allocator);
        this.body.deinit(bun.default_allocator);
        this.url.deref();

        bun.destroy(this);
    }

    pub fn ref(this: *Response) *Response {
        this.ref_count += 1;
        return this;
    }

    pub fn unref(this: *Response) void {
        bun.assert(this.ref_count > 0);
        this.ref_count -= 1;
        if (this.ref_count == 0) {
            this.destroy();
        }
    }

    pub fn finalize(
        this: *Response,
    ) callconv(.C) void {
        this.unref();
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
    ) JSValue {
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
        var did_succeed = false;
        defer {
            if (!did_succeed) {
                response.body.deinit(bun.default_allocator);
                response.init.deinit(bun.default_allocator);
            }
        }
        const json_value = args.nextEat() orelse JSC.JSValue.zero;

        if (@intFromEnum(json_value) != 0) {
            var str = bun.String.empty;
            // calling JSON.stringify on an empty string adds extra quotes
            // so this is correct
            json_value.jsonStringify(globalThis, 0, &str);

            if (globalThis.hasException()) {
                return .zero;
            }

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
                if (Response.Init.init(globalThis, init) catch |err| if (err == error.JSError) return .zero else null) |_init| {
                    response.init = _init;
                }
            }
        }

        var headers_ref = response.getOrCreateHeaders(globalThis);
        headers_ref.putDefault(.ContentType, MimeType.json.value, globalThis);
        did_succeed = true;
        return bun.new(Response, response).toJS(globalThis);
    }
    pub fn constructRedirect(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSValue {
        var args_list = callframe.arguments(4);
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args_list.ptr[0..args_list.len]);

        var url_string_slice = ZigString.Slice.empty;
        defer url_string_slice.deinit();
        var response: Response = brk: {
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
            url_string_slice = url_string.toSlice(getAllocator(globalThis));
            var did_succeed = false;
            defer {
                if (!did_succeed) {
                    response.body.deinit(bun.default_allocator);
                    response.init.deinit(bun.default_allocator);
                }
            }

            if (args.nextEat()) |init| {
                if (init.isUndefinedOrNull()) {} else if (init.isNumber()) {
                    response.init.status_code = @as(u16, @intCast(@min(@max(0, init.toInt32()), std.math.maxInt(u16))));
                } else {
                    if (Response.Init.init(globalThis, init) catch |err|
                        if (err == error.JSError) return .zero else null) |_init|
                    {
                        response.init = _init;
                        response.init.status_code = 302;
                    }
                }
            }
            if (globalThis.hasException()) {
                return .zero;
            }
            did_succeed = true;
            break :brk response;
        };

        response.init.headers = response.getOrCreateHeaders(globalThis);
        var headers_ref = response.init.headers.?;
        headers_ref.put(.Location, url_string_slice.slice(), globalThis);
        const ptr = bun.new(Response, response);

        return ptr.toJS(globalThis);
    }
    pub fn constructError(
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) JSValue {
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
    ) ?*Response {
        const args_list = brk: {
            var args = callframe.arguments(2);
            if (args.len > 1 and args.ptr[1].isEmptyOrUndefinedOrNull()) {
                args.len = 1;
            }
            break :brk args;
        };

        const arguments = args_list.ptr[0..args_list.len];

        var init: Init = @as(?Init, brk: {
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
                        break :brk Init.init(globalThis, arguments[1]) catch null;
                    }

                    if (!globalThis.hasException()) {
                        globalThis.throwInvalidArguments("new Response() requires a Response-like object in the 2nd argument", .{});
                    }

                    break :brk null;
                },
            }
            unreachable;
        }) orelse return null;

        if (globalThis.hasException()) {
            init.deinit(bun.default_allocator);
            return null;
        }

        var body: Body = brk: {
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
        } orelse {
            init.deinit(bun.default_allocator);

            return null;
        };

        if (globalThis.hasException()) {
            body.deinit(bun.default_allocator);
            init.deinit(bun.default_allocator);
            return null;
        }

        var response = bun.new(Response, Response{
            .body = body,
            .init = init,
        });

        if (response.body.value == .Blob and
            response.init.headers != null and
            response.body.value.Blob.content_type.len > 0 and
            !response.init.headers.?.fastHas(.ContentType))
        {
            response.init.headers.?.put(.ContentType, response.body.value.Blob.content_type, globalThis);
        }

        response.calculateEstimatedByteSize();

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

        pub fn init(globalThis: *JSGlobalObject, response_init: JSC.JSValue) !?Init {
            var result = Init{ .status_code = 200 };
            errdefer {
                result.deinit(bun.default_allocator);
            }

            if (!response_init.isCell())
                return null;

            if (response_init.jsType() == .DOMWrapper) {
                // fast path: it's a Request object or a Response object
                // we can skip calling JS getters
                if (response_init.asDirect(Request)) |req| {
                    if (req.getFetchHeadersUnlessEmpty()) |headers| {
                        result.headers = headers.cloneThis(globalThis);
                    }

                    result.method = req.method;
                    return result;
                }

                if (response_init.asDirect(Response)) |resp| {
                    return resp.init.clone(globalThis);
                }
            }

            if (globalThis.hasException()) {
                return error.JSError;
            }

            if (response_init.fastGet(globalThis, .headers)) |headers| {
                if (headers.as(FetchHeaders)) |orig| {
                    if (!orig.isEmpty()) {
                        result.headers = orig.cloneThis(globalThis);
                    }
                } else {
                    result.headers = FetchHeaders.createFromJS(globalThis.ptr(), headers);
                }
            }

            if (globalThis.hasException()) {
                return error.JSError;
            }

            if (response_init.fastGet(globalThis, .status)) |status_value| {
                const number = status_value.coerceToInt64(globalThis);
                if ((200 <= number and number < 600) or number == 101) {
                    result.status_code = @as(u16, @truncate(@as(u32, @intCast(number))));
                } else {
                    if (!globalThis.hasException()) {
                        const err = globalThis.createRangeErrorInstance("The status provided ({d}) must be 101 or in the range of [200, 599]", .{number});
                        globalThis.throwValue(err);
                    }
                    return error.JSError;
                }
            }

            if (globalThis.hasException()) {
                return error.JSError;
            }

            if (response_init.fastGet(globalThis, .statusText)) |status_text| {
                result.status_text = bun.String.fromJS(status_text, globalThis);
            }

            if (globalThis.hasException()) {
                return error.JSError;
            }

            if (response_init.fastGet(globalThis, .method)) |method_value| {
                if (Method.fromJS(globalThis, method_value)) |method| {
                    result.method = method;
                }
            }

            if (globalThis.hasException()) {
                return error.JSError;
            }

            return result;
        }

        pub fn deinit(this: *Init, _: std.mem.Allocator) void {
            if (this.headers) |headers| {
                this.headers = null;

                headers.deref();
            }

            this.status_text.deref();
            this.status_text = bun.String.empty;
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

    comptime {
        if (!JSC.is_bindgen) {
            _ = Bun__fetch;
            _ = Bun__fetchPreconnect;
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
        abort_reason: JSC.Strong = .{},

        // custom checkServerIdentity
        check_server_identity: JSC.Strong = .{},
        reject_unauthorized: bool = true,
        // Custom Hostname
        hostname: ?[]u8 = null,
        is_waiting_body: bool = false,
        is_waiting_abort: bool = false,
        mutex: Mutex,

        tracker: JSC.AsyncTaskTracker,

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
            this.request_body.detach();

            this.abort_reason.deinit();
            this.check_server_identity.deinit();
            this.clearAbortSignal();
        }

        fn deinit(this: *FetchTasklet) void {
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
                if (this.readable_stream_ref.get()) |readable| {
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
                    if (body.value.Locked.readable.get()) |readable| {
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
            // if we already respond the metadata and still need to process the body
            if (this.is_waiting_body) {
                this.onBodyReceived();
                return;
            }
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
                true => JSC.Strong.create(this.onResolve(), globalThis),
                false => brk: {
                    // in this case we wanna a JSC.Strong so we just convert it
                    var value = this.onReject();
                    _ = value.toJS(globalThis);
                    break :brk value.JSValue;
                },
            };

            promise_value.ensureStillAlive();
            const Holder = struct {
                held: JSC.Strong,
                promise: JSC.Strong,
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
            this.promise.strong = .{};
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
                        defer BoringSSL.X509_free(x509);
                        const globalObject = this.global_this;
                        const js_cert = X509.toJS(x509, globalObject);
                        var hostname: bun.String = bun.String.createUTF8(certificate_info.hostname);
                        defer hostname.deref();
                        const js_hostname = hostname.toJS(globalObject);
                        js_hostname.ensureStillAlive();
                        js_cert.ensureStillAlive();
                        const check_result = check_server_identity.call(globalObject, .undefined, &[_]JSC.JSValue{ js_hostname, js_cert });
                        // if check failed abort the request
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

                this.abort_reason = .{};
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
                .code = bun.String.static(@errorName(this.result.fail.?)),
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
                    error.UNKKNOW_CERTIFICATE_VERIFICATION_ERROR => bun.String.static("unknown certificate verification error"),

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
            const response_js = Response.makeMaybePooled(@as(js.JSContextRef, this.global_this), response);
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
                fetch_tasklet.signal_store.cert_errors.store(true, .monotonic);
            } else {
                fetch_tasklet.signals.cert_errors = null;
            }

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
            memory_reporter: *JSC.MemoryReportingAllocator,
            check_server_identity: JSC.Strong = .{},
            unix_socket_path: ZigString.Slice,
            ssl_config: ?*SSLConfig = null,
        };

        pub fn queue(
            allocator: std.mem.Allocator,
            global: *JSGlobalObject,
            fetch_options: FetchOptions,
            promise: JSC.JSPromise.Strong,
        ) !*FetchTasklet {
            http.HTTPThread.init();
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

        pub fn callback(task: *FetchTasklet, async_http: *http.AsyncHTTP, result: http.HTTPClientResult) void {
            task.mutex.lock();
            defer task.mutex.unlock();
            const is_done = !result.has_more;
            // we are done with the http client so we can deref our side
            defer if (is_done) task.deref();

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

    pub export fn Bun__fetchPreconnect(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(1).slice();

        if (arguments.len < 1) {
            globalObject.throwNotEnoughArguments("fetch.preconnect", 1, arguments.len);
            return .zero;
        }

        var url_str = JSC.URL.hrefFromJS(arguments[0], globalObject);
        defer url_str.deref();

        if (globalObject.hasException()) {
            return .zero;
        }

        if (url_str.tag == .Dead) {
            globalObject.ERR_INVALID_ARG_TYPE("Invalid URL", .{}).throw();
            return .zero;
        }

        if (url_str.isEmpty()) {
            globalObject.ERR_INVALID_ARG_TYPE(fetch_error_blank_url, .{}).throw();
            return .zero;
        }

        const url = ZigURL.parse(url_str.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory());
        if (!url.isHTTP() and !url.isHTTPS()) {
            globalObject.throwInvalidArguments("URL must be HTTP or HTTPS", .{});
            bun.default_allocator.free(url.href);
            return .zero;
        }

        if (url.hostname.len == 0) {
            globalObject.ERR_INVALID_ARG_TYPE(fetch_error_blank_url, .{}).throw();
            bun.default_allocator.free(url.href);
            return .zero;
        }

        if (!url.hasValidPort()) {
            globalObject.throwInvalidArguments("Invalid port", .{});
            bun.default_allocator.free(url.href);
            return .zero;
        }

        bun.http.AsyncHTTP.preconnect(url, true);
        return .undefined;
    }

    const StringOrURL = struct {
        pub fn fromJS(value: JSC.JSValue, globalThis: *JSC.JSGlobalObject) ?bun.String {
            if (value.isString()) {
                return bun.String.tryFromJS(value, globalThis);
            }

            const out = JSC.URL.hrefFromJS(value, globalThis);
            if (out.tag == .Dead) {
                return null;
            }
            return out;
        }
    };

    pub export fn Bun__fetch(
        ctx: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(JSC.conv) JSC.JSValue {
        JSC.markBinding(@src());
        const globalThis = ctx.ptr();
        const arguments = callframe.arguments(2);
        bun.Analytics.Features.fetch += 1;
        const vm = JSC.VirtualMachine.get();

        var exception_val = [_]JSC.C.JSValueRef{null};
        const exception: JSC.C.ExceptionRef = &exception_val;
        var memory_reporter = bun.default_allocator.create(JSC.MemoryReportingAllocator) catch bun.outOfMemory();
        // used to clean up dynamically allocated memory on error (a poor man's errdefer)
        var is_error = false;
        var allocator = memory_reporter.wrap(bun.default_allocator);
        defer {
            if (exception.* != null) {
                is_error = true;
                ctx.throwValue(JSC.JSValue.c(exception.*));
            }

            memory_reporter.report(globalThis.vm());

            if (is_error) bun.default_allocator.destroy(memory_reporter);
        }

        if (arguments.len == 0) {
            const err = JSC.toTypeError(.ERR_MISSING_ARGS, fetch_error_no_args, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        var headers: ?Headers = null;
        var method = Method.GET;

        var args = JSC.Node.ArgumentsSlice.init(vm, arguments.slice());

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
        var verbose: http.HTTPVerboseLevel = if (vm.log.level.atLeast(.debug)) .headers else .none;
        if (verbose == .none) {
            verbose = vm.getVerboseFetch();
        }

        var proxy: ?ZigURL = null;
        var redirect_type: FetchRedirect = FetchRedirect.follow;
        var signal: ?*JSC.WebCore.AbortSignal = null;
        // Custom Hostname
        var hostname: ?[]u8 = null;
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

            if (!is_error and globalThis.hasException()) {
                is_error = true;
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
        const url_str_optional = if (first_arg.as(Request) == null) StringOrURL.fromJS(first_arg, globalThis) else null;
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
                if (request_init.fastGet(globalThis, .url)) |url_| {
                    if (!url_.isUndefined()) {
                        if (bun.String.tryFromJS(url_, globalThis)) |str| {
                            break :extract_url str;
                        }
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
            const err = JSC.toTypeError(.ERR_INVALID_URL, fetch_error_blank_url, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        if (url_str.hasPrefixComptime("data:")) {
            var url_slice = url_str.toUTF8WithoutRef(allocator);
            defer url_slice.deinit();

            var data_url = DataURL.parseWithoutCheck(url_slice.slice()) catch {
                const err = JSC.createError(globalThis, "failed to fetch the data URL", .{});
                is_error = true;
                return JSPromise.rejectedPromiseValue(globalThis, err);
            };

            data_url.url = url_str;
            return dataURLResponse(data_url, globalThis, allocator);
        }

        url = ZigURL.fromString(allocator, url_str) catch {
            const err = JSC.toTypeError(.ERR_INVALID_URL, "fetch() URL is invalid", .{}, ctx);
            is_error = true;
            return JSPromise.rejectedPromiseValue(
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
                const err = JSC.createError(globalThis, "failed to fetch the data URL", .{});
                return JSPromise.rejectedPromiseValue(globalThis, err);
            };
            data_url.url = url_str;

            return dataURLResponse(data_url, globalThis, allocator);
        }

        // **Start with the harmless ones.**

        // "method"
        method = extract_method: {
            if (options_object) |options| {
                if (options.getTruthyComptime(globalThis, "method")) |method_| {
                    break :extract_method Method.fromJS(globalThis, method_);
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }

            if (request) |req| {
                break :extract_method req.method;
            }

            if (request_init_object) |req| {
                if (req.getTruthyComptime(globalThis, "method")) |method_| {
                    break :extract_method Method.fromJS(globalThis, method_);
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }

            break :extract_method null;
        } orelse .GET;

        if (globalThis.hasException()) {
            is_error = true;
            return .zero;
        }

        // "decompression: boolean"
        disable_decompression = extract_disable_decompression: {
            const objects_to_try = [_]JSValue{
                options_object orelse .zero,
                request_init_object orelse .zero,
            };

            inline for (0..2) |i| {
                if (objects_to_try[i] != .zero) {
                    if (objects_to_try[i].get(globalThis, "decompress")) |decompression_value| {
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
                    if (objects_to_try[i].get(globalThis, "tls")) |tls| {
                        if (tls.isObject()) {
                            if (tls.get(ctx, "rejectUnauthorized")) |reject| {
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

                            if (tls.get(ctx, "checkServerIdentity")) |checkServerIdentity| {
                                if (checkServerIdentity.isCell() and checkServerIdentity.isCallable(globalThis.vm())) {
                                    check_server_identity = checkServerIdentity;
                                }
                            }

                            if (globalThis.hasException()) {
                                is_error = true;
                                return .zero;
                            }

                            if (SSLConfig.inJS(vm, globalThis, tls, exception)) |config| {
                                if (exception.* != null) {
                                    is_error = true;
                                    return .zero;
                                }

                                const ssl_config_object = bun.default_allocator.create(SSLConfig) catch bun.outOfMemory();
                                ssl_config_object.* = config;
                                break :extract_ssl_config ssl_config_object;
                            }

                            if (exception.* != null) {
                                is_error = true;
                                return .zero;
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
                    if (objects_to_try[i].get(globalThis, "unix")) |socket_path| {
                        if (socket_path.isString() and socket_path.getLength(ctx) > 0) {
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
                    if (objects_to_try[i].get(globalThis, "timeout")) |timeout_value| {
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
                    if (objects_to_try[i].get(globalThis, "keepalive")) |keepalive_value| {
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
                    if (objects_to_try[i].get(globalThis, "verbose")) |verb| {
                        if (verb.isString()) {
                            if (verb.getZigString(globalThis).eqlComptime("curl")) {
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
                    if (objects_to_try[i].get(globalThis, "proxy")) |proxy_arg| {
                        if (proxy_arg.isString() and proxy_arg.getLength(ctx) > 0) {
                            var href = JSC.URL.hrefFromJS(proxy_arg, globalThis);
                            if (href.tag == .Dead) {
                                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{}, ctx);
                                is_error = true;
                                return JSPromise.rejectedPromiseValue(globalThis, err);
                            }
                            defer href.deref();
                            const buffer = std.fmt.allocPrint(allocator, "{s}{}", .{ url_proxy_buffer, href }) catch {
                                globalThis.throwOutOfMemory();
                                return .zero;
                            };
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
                if (options.get(globalThis, "signal")) |signal_| {
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
                if (options.get(globalThis, "signal")) |signal_| {
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
                if (options.fastGet(globalThis, .body)) |body__| {
                    if (!body__.isUndefined()) {
                        if (Body.Value.fromJS(ctx.ptr(), body__)) |body_const| {
                            var body_value = body_const;
                            break :extract_body body_value.useAsAnyBlob();
                        }
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }

            if (request) |req| {
                if (req.body.value == .Used or (req.body.value == .Locked and (req.body.value.Locked.action != .none or req.body.value.Locked.isDisturbed(Request, globalThis, first_arg)))) {
                    globalThis.ERR_BODY_ALREADY_USED("Request body already used", .{}).throw();
                    is_error = true;
                    return .zero;
                }

                break :extract_body req.body.value.useAsAnyBlob();
            }

            if (request_init_object) |req| {
                if (req.fastGet(globalThis, .body)) |body__| {
                    if (!body__.isUndefined()) {
                        if (Body.Value.fromJS(ctx.ptr(), body__)) |body_const| {
                            var body_value = body_const;
                            break :extract_body body_value.useAsAnyBlob();
                        }
                    }
                }
            }

            break :extract_body null;
        } orelse AnyBlob{ .Blob = .{} };

        if (globalThis.hasException()) {
            is_error = true;
            return .zero;
        }

        // headers: Headers | undefined;
        headers = extract_headers: {
            var fetch_headers_to_deref: ?*JSC.FetchHeaders = null;
            defer {
                if (fetch_headers_to_deref) |fetch_headers| {
                    fetch_headers.deref();
                }
            }

            const fetch_headers: ?*JSC.FetchHeaders = brk: {
                if (options_object) |options| {
                    if (options.fastGet(globalThis, .headers)) |headers_value| {
                        if (!headers_value.isUndefined()) {
                            if (headers_value.as(FetchHeaders)) |headers__| {
                                if (headers__.isEmpty()) {
                                    break :brk null;
                                }

                                break :brk headers__;
                            }

                            if (FetchHeaders.createFromJS(ctx.ptr(), headers_value)) |headers__| {
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
                    if (options.fastGet(globalThis, .headers)) |headers_value| {
                        if (!headers_value.isUndefined()) {
                            if (headers_value.as(FetchHeaders)) |headers__| {
                                if (headers__.isEmpty()) {
                                    break :brk null;
                                }

                                break :brk headers__;
                            }

                            if (FetchHeaders.createFromJS(ctx.ptr(), headers_value)) |headers__| {
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
                if (headers_.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                    if (hostname) |host| {
                        hostname = null;
                        allocator.free(host);
                    }
                    hostname = _hostname.toOwnedSliceZ(allocator) catch bun.outOfMemory();
                }

                break :extract_headers Headers.from(headers_, allocator, .{ .body = &body }) catch bun.outOfMemory();
            }

            break :extract_headers headers;
        };

        if (globalThis.hasException()) {
            is_error = true;
            return .zero;
        }

        if (proxy != null and unix_socket_path.length() > 0) {
            is_error = true;
            const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_proxy_unix, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
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
                globalThis.throwError(err, "Failed to decode file url");
                return .zero;
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
                        const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "Failed to resolve blob:{s}", .{
                            url_path_decoded,
                        }, ctx);
                        is_error = true;
                        return JSPromise.rejectedPromiseValue(globalThis, err);
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
                                globalThis.throwError(err, "Failed to resolve file url");
                                return .zero;
                            };
                        }
                        break :brk url_path_decoded;
                    }

                    var cwd_buf: bun.PathBuffer = undefined;
                    const cwd = if (Environment.isWindows) (bun.getcwd(&cwd_buf) catch |err| {
                        globalThis.throwError(err, "Failed to resolve file url");
                        return .zero;
                    }) else globalThis.bunVM().bundler.fs.top_level_dir;

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
                            globalThis.throwError(err, "Failed to resolve file url");
                            return .zero;
                        };
                    }
                    break :brk fullpath;
                };

                url_string = JSC.URL.fileURLFromString(bun.String.fromUTF8(temp_file_path));

                var pathlike: JSC.Node.PathOrFileDescriptor = .{
                    .path = .{
                        .encoded_slice = ZigString.Slice.init(bun.default_allocator, bun.default_allocator.dupe(u8, temp_file_path) catch {
                            globalThis.throwOutOfMemory();
                            return .zero;
                        }),
                    },
                };

                break :blob Blob.findOrCreateFileFromPath(
                    &pathlike,
                    globalThis,
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
            if (!(url.isHTTP() or url.isHTTPS())) {
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "protocol must be http: or https:", .{}, ctx);
                is_error = true;
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }
        }

        if (!method.hasRequestBody() and body.size() > 0) {
            const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_unexpected_body, .{}, ctx);
            is_error = true;
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        if (headers == null and body.size() > 0 and body.hasContentTypeFromUser()) {
            headers = Headers.from(
                null,
                allocator,
                .{ .body = &body },
            ) catch bun.outOfMemory();
        }

        var http_body = FetchTasklet.HTTPRequestBody{
            .AnyBlob = body,
        };

        if (body.needsToReadFile()) {
            prepare_body: {
                const opened_fd_res: JSC.Maybe(bun.FileDescriptor) = switch (body.Blob.store.?.data.file.pathlike) {
                    .fd => |fd| bun.sys.dup(fd),
                    .path => |path| bun.sys.open(path.sliceZ(&globalThis.bunVM().nodeFS().sync_error_buf), if (Environment.isWindows) bun.O.RDONLY else bun.O.RDONLY | bun.O.NOCTTY, 0),
                };

                const opened_fd = switch (opened_fd_res) {
                    .err => |err| {
                        const rejected_value = JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
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
                        is_error = true;
                        const rejected_value = JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                        body.detach();

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
                .check_server_identity = if (check_server_identity.isEmptyOrUndefinedOrNull()) .{} else JSC.Strong.create(check_server_identity, globalThis),
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
            body = .{
                .Blob = .{},
            };
        }
        proxy = null;
        url_proxy_buffer = "";
        signal = null;
        ssl_config = null;
        hostname = null;
        unix_socket_path = ZigString.Slice.empty;

        return promise_val;
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Headers
pub const Headers = struct {
    pub usingnamespace http.Headers;
    entries: Headers.Entries = .{},
    buf: std.ArrayListUnmanaged(u8) = .{},
    allocator: std.mem.Allocator,

    pub fn deinit(this: *Headers) void {
        this.entries.deinit(this.allocator);
        this.buf.clearAndFree(this.allocator);
    }

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
        headers.entries.ensureTotalCapacity(allocator, header_count) catch bun.outOfMemory();
        headers.entries.len = header_count;
        headers.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch bun.outOfMemory();
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
