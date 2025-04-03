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

const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
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
const Mutex = bun.Mutex;

const InlineBlob = JSC.WebCore.InlineBlob;
const AnyBlob = JSC.WebCore.AnyBlob;
const InternalBlob = JSC.WebCore.InternalBlob;
const BodyMixin = JSC.WebCore.BodyMixin;
const Body = JSC.WebCore.Body;
const Request = JSC.WebCore.Request;
const Blob = JSC.WebCore.Blob;
const Async = bun.Async;

const BoringSSL = bun.BoringSSL.c;
const X509 = @import("../api/bun/x509.zig");
const PosixToWinNormalizer = bun.path.PosixToWinNormalizer;
const s3 = bun.S3;

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

    pub export fn jsFunctionRequestOrResponseHasBodyValue(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        _ = globalObject; // autofix
        const arguments = callframe.arguments_old(1);
        const this_value = arguments.ptr[0];
        if (this_value.isEmptyOrUndefinedOrNull()) {
            return .false;
        }

        if (this_value.as(Response)) |response| {
            return JSC.JSValue.jsBoolean(!response.body.value.isDefinitelyEmpty());
        } else if (this_value.as(Request)) |request| {
            return JSC.JSValue.jsBoolean(!request.body.value.isDefinitelyEmpty());
        }

        return .false;
    }

    pub export fn jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments_old(1);
        const this_value = arguments.ptr[0];
        if (this_value.isEmptyOrUndefinedOrNull()) {
            return .undefined;
        }

        const body: *Body.Value = brk: {
            if (this_value.as(Response)) |response| {
                break :brk &response.body.value;
            } else if (this_value.as(Request)) |request| {
                break :brk &request.body.value;
            }

            return .undefined;
        };

        // Get the body if it's available synchronously.
        switch (body.*) {
            .Used, .Empty, .Null => return .undefined,
            .Blob => |*blob| {
                if (blob.isBunFile()) {
                    return .undefined;
                }
                defer body.* = .{ .Used = {} };
                return blob.toArrayBuffer(globalObject, .transfer) catch return .zero;
            },
            .WTFStringImpl, .InternalBlob => {
                var any_blob = body.useAsAnyBlob();
                return any_blob.toArrayBufferTransfer(globalObject) catch return .zero;
            },
            .Error, .Locked => return .undefined,
        }
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
            try formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.isOK()), .BooleanObject, enable_ansi_colors);
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
            try formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(this.init.status_code), .NumberObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>statusText<d>:<r> ", enable_ansi_colors));
            try writer.print(comptime Output.prettyFmt("<r>\"<b>{}<r>\"", enable_ansi_colors), .{this.init.status_text});
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>headers<d>:<r> ", enable_ansi_colors));
            try formatter.printAs(.Private, Writer, writer, this.getHeaders(formatter.globalThis), .DOMWrapper, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>redirected<d>:<r> ", enable_ansi_colors));
            try formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.redirected), .BooleanObject, enable_ansi_colors);
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
            return bun.String.static("error").toJS(globalThis);
        }

        return bun.String.static("default").toJS(globalThis);
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
    ) bun.JSError!JSValue {
        const this_value = callframe.this();
        const cloned = this.clone(globalThis);
        if (globalThis.hasException()) {
            cloned.finalize();
            return .zero;
        }

        const js_wrapper = Response.makeMaybePooled(globalThis, cloned);

        if (js_wrapper != .zero) {
            if (cloned.body.value == .Locked) {
                if (cloned.body.value.Locked.readable.get(globalThis)) |readable| {
                    // If we are teed, then we need to update the cached .body
                    // value to point to the new readable stream
                    // We must do this on both the original and cloned response
                    // but especially the original response since it will have a stale .body value now.
                    Response.bodySetCached(js_wrapper, globalThis, readable.value);
                    if (this.body.value.Locked.readable.get(globalThis)) |other_readable| {
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
    ) bun.JSError!JSValue {
        const args_list = callframe.arguments_old(2);
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
    ) bun.JSError!JSValue {
        var args_list = callframe.arguments_old(4);
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
                url_string = try url_string_value.getZigString(globalThis);
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
    ) bun.JSError!JSValue {
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

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*Response {
        const arguments = callframe.argumentsAsArray(2);

        if (!arguments[0].isUndefinedOrNull() and arguments[0].isObject()) {
            if (arguments[0].as(Blob)) |blob| {
                if (blob.isS3()) {
                    if (!arguments[1].isEmptyOrUndefinedOrNull()) {
                        return globalThis.throwInvalidArguments("new Response(s3File) do not support ResponseInit options", .{});
                    }
                    var response: Response = .{
                        .init = Response.Init{
                            .status_code = 302,
                        },
                        .body = Body{
                            .value = .{ .Empty = {} },
                        },
                        .url = bun.String.empty,
                    };

                    const credentials = blob.store.?.data.s3.getCredentials();

                    const result = credentials.signRequest(.{
                        .path = blob.store.?.data.s3.path(),
                        .method = .GET,
                    }, false, .{ .expires = 15 * 60 }) catch |sign_err| {
                        return s3.throwSignError(sign_err, globalThis);
                    };
                    defer result.deinit();
                    response.init.headers = response.getOrCreateHeaders(globalThis);
                    response.redirected = true;
                    var headers_ref = response.init.headers.?;
                    headers_ref.put(.Location, result.url, globalThis);
                    return bun.new(Response, response);
                }
            }
        }
        var init: Init = (brk: {
            if (arguments[1].isUndefinedOrNull()) {
                break :brk Init{
                    .status_code = 200,
                    .headers = null,
                };
            }
            if (arguments[1].isObject()) {
                break :brk try Init.init(globalThis, arguments[1]) orelse unreachable;
            }
            if (!globalThis.hasException()) {
                return globalThis.throwInvalidArguments("Failed to construct 'Response': The provided body value is not of type 'ResponseInit'", .{});
            }
            return error.JSError;
        });
        errdefer init.deinit(bun.default_allocator);

        if (globalThis.hasException()) {
            return error.JSError;
        }

        var body: Body = brk: {
            if (arguments[0].isUndefinedOrNull()) {
                break :brk Body{
                    .value = Body.Value{ .Null = {} },
                };
            }
            break :brk try Body.extract(globalThis, arguments[0]);
        };
        errdefer body.deinit(bun.default_allocator);

        if (globalThis.hasException()) {
            return error.JSError;
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

        pub fn init(globalThis: *JSGlobalObject, response_init: JSC.JSValue) bun.JSError!?Init {
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
                    result.headers = FetchHeaders.createFromJS(globalThis, headers);
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
                        return globalThis.throwValue(err);
                    }
                    return error.JSError;
                }
            }

            if (globalThis.hasException()) {
                return error.JSError;
            }

            if (response_init.fastGet(globalThis, .statusText)) |status_text| {
                result.status_text = try bun.String.fromJS(status_text, globalThis);
            }

            if (response_init.fastGet(globalThis, .method)) |method_value| {
                if (try Method.fromJS(globalThis, method_value)) |method| {
                    result.method = method;
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

/// https://developer.mozilla.org/en-US/docs/Web/API/Headers
// TODO: move to http.zig. this has nothing to do with JSC or WebCore
pub const Headers = struct {
    pub const Entry = struct {
        name: Api.StringPointer,
        value: Api.StringPointer,

        pub const List = bun.MultiArrayList(Entry);
    };

    entries: Entry.List = .{},
    buf: std.ArrayListUnmanaged(u8) = .{},
    allocator: std.mem.Allocator,

    pub fn memoryCost(this: *const Headers) usize {
        return this.buf.items.len + this.entries.memoryCost();
    }

    pub fn clone(this: *Headers) !Headers {
        return Headers{
            .entries = try this.entries.clone(this.allocator),
            .buf = try this.buf.clone(this.allocator),
            .allocator = this.allocator,
        };
    }

    pub fn append(this: *Headers, name: []const u8, value: []const u8) !void {
        var offset: u32 = @truncate(this.buf.items.len);
        try this.buf.ensureUnusedCapacity(this.allocator, name.len + value.len);
        const name_ptr = Api.StringPointer{
            .offset = offset,
            .length = @truncate(name.len),
        };
        this.buf.appendSliceAssumeCapacity(name);
        offset = @truncate(this.buf.items.len);
        this.buf.appendSliceAssumeCapacity(value);

        const value_ptr = Api.StringPointer{
            .offset = offset,
            .length = @truncate(value.len),
        };
        try this.entries.append(this.allocator, .{
            .name = name_ptr,
            .value = value_ptr,
        });
    }

    pub fn deinit(this: *Headers) void {
        this.entries.deinit(this.allocator);
        this.buf.clearAndFree(this.allocator);
    }
    pub fn getContentType(this: *const Headers) ?[]const u8 {
        if (this.entries.len == 0 or this.buf.items.len == 0) {
            return null;
        }
        const header_entries = this.entries.slice();
        const header_names = header_entries.items(.name);
        const header_values = header_entries.items(.value);

        for (header_names, 0..header_names.len) |name, i| {
            if (bun.strings.eqlCaseInsensitiveASCII(this.asStr(name), "content-type", true)) {
                return this.asStr(header_values[i]);
            }
        }
        return null;
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

    pub fn fromPicoHttpHeaders(headers: []const picohttp.Header, allocator: std.mem.Allocator) !Headers {
        const header_count = headers.len;
        var result = Headers{
            .entries = .{},
            .buf = .{},
            .allocator = allocator,
        };

        var buf_len: usize = 0;
        for (headers) |header| {
            buf_len += header.name.len + header.value.len;
        }
        result.entries.ensureTotalCapacity(allocator, header_count) catch bun.outOfMemory();
        result.entries.len = headers.len;
        result.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch bun.outOfMemory();
        result.buf.items.len = buf_len;
        var offset: u32 = 0;
        for (headers, 0..headers.len) |header, i| {
            const name_offset = offset;
            bun.copy(u8, result.buf.items[offset..][0..header.name.len], header.name);
            offset += @truncate(header.name.len);
            const value_offset = offset;
            bun.copy(u8, result.buf.items[offset..][0..header.value.len], header.value);
            offset += @truncate(header.value.len);

            result.entries.set(i, .{
                .name = .{
                    .offset = name_offset,
                    .length = @truncate(header.name.len),
                },
                .value = .{
                    .offset = value_offset,
                    .length = @truncate(header.value.len),
                },
            });
        }
        return result;
    }

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
pub const Fetch = @import("fetch.zig");
