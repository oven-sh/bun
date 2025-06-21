const Response = @This();

const ResponseMixin = BodyMixin(@This());
pub const js = JSC.Codegen.JSResponse;
// NOTE: toJS is overridden
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

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

pub fn getFormDataEncoding(this: *Response) bun.JSError!?*bun.FormData.AsyncFormData {
    var content_type_slice: ZigString.Slice = (try this.getContentType()) orelse return null;
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
    return js.toJSUnchecked(globalObject, this);
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
        return .js_undefined;
    }

    const body: *Body.Value = brk: {
        if (this_value.as(Response)) |response| {
            break :brk &response.body.value;
        } else if (this_value.as(Request)) |request| {
            break :brk &request.body.value;
        }

        return .js_undefined;
    };

    // Get the body if it's available synchronously.
    switch (body.*) {
        .Used, .Empty, .Null => return .js_undefined,
        .Blob => |*blob| {
            if (blob.isBunFile()) {
                return .js_undefined;
            }
            defer body.* = .{ .Used = {} };
            return blob.toArrayBuffer(globalObject, .transfer) catch return .zero;
        },
        .WTFStringImpl, .InternalBlob => {
            var any_blob = body.useAsAnyBlob();
            return any_blob.toArrayBufferTransfer(globalObject) catch return .zero;
        },
        .Error, .Locked => return .js_undefined,
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

pub fn header(this: *const Response, name: bun.webcore.FetchHeaders.HTTPHeaderName) ?[]const u8 {
    return if (try (this.init.headers orelse return null).fastGet(name)) |str|
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
                js.bodySetCached(js_wrapper, globalThis, readable.value);
                if (this.body.value.Locked.readable.get(globalThis)) |other_readable| {
                    js.bodySetCached(this_value, globalThis, other_readable.value);
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
) bun.JSError!?ZigString.Slice {
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
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), args_list.ptr[0..args_list.len]);

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
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), args_list.ptr[0..args_list.len]);

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
        url_string_slice = url_string.toSlice(bun.default_allocator);
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

        if (try response_init.fastGet(globalThis, .headers)) |headers| {
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

        if (try response_init.fastGet(globalThis, .status)) |status_value| {
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

        if (try response_init.fastGet(globalThis, .statusText)) |status_text| {
            result.status_text = try bun.String.fromJS(status_text, globalThis);
        }

        if (try response_init.fastGet(globalThis, .method)) |method_value| {
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

/// https://developer.mozilla.org/en-US/docs/Web/API/Headers
// TODO: move to http.zig. this has nothing to do with JSC or WebCore

const std = @import("std");
const bun = @import("bun");
const MimeType = bun.http.MimeType;
const http = bun.http;
const JSC = bun.JSC;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = bun.webcore.FetchHeaders;
const Output = bun.Output;
const string = bun.string;
const default_allocator = bun.default_allocator;

const ZigString = JSC.ZigString;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

const InternalBlob = JSC.WebCore.Blob.Internal;
const BodyMixin = JSC.WebCore.Body.Mixin;
const Body = JSC.WebCore.Body;
const Request = JSC.WebCore.Request;
const Blob = JSC.WebCore.Blob;

const s3 = bun.S3;
