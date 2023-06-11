const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("root").bun.HTTP;
const NetworkThread = HTTPClient.NetworkThread;
const AsyncIO = NetworkThread.AsyncIO;
const JSC = @import("root").bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const AbortSignal = JSC.WebCore.AbortSignal;
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
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../env.zig");
const ZigString = JSC.ZigString;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const NullableAllocator = @import("../../nullable_allocator.zig").NullableAllocator;

const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const JSPrinter = bun.js_printer;
const picohttp = @import("root").bun.picohttp;
const StringJoiner = @import("../../string_joiner.zig");
const uws = @import("root").bun.uws;

const InlineBlob = JSC.WebCore.InlineBlob;
const AnyBlob = JSC.WebCore.AnyBlob;
const InternalBlob = JSC.WebCore.InternalBlob;
const BodyMixin = JSC.WebCore.BodyMixin;
const Body = JSC.WebCore.Body;
const Blob = JSC.WebCore.Blob;

const body_value_pool_size: u16 = 256;
pub const BodyValueRef = bun.HiveRef(Body.Value, body_value_pool_size);
const BodyValueHiveAllocator = bun.HiveArray(BodyValueRef, body_value_pool_size).Fallback;

var body_value_hive_allocator = BodyValueHiveAllocator.init(bun.default_allocator);

pub fn InitRequestBodyValue(value: Body.Value) !*BodyValueRef {
    return try BodyValueRef.init(value, &body_value_hive_allocator);
}
// https://developer.mozilla.org/en-US/docs/Web/API/Request
pub const Request = struct {
    url: []const u8 = "",
    url_was_allocated: bool = false,

    headers: ?*FetchHeaders = null,
    signal: ?*AbortSignal = null,
    body: *BodyValueRef,
    method: Method = Method.GET,
    uws_request: ?*uws.Request = null,
    https: bool = false,
    upgrader: ?*anyopaque = null,

    // We must report a consistent value for this
    reported_estimated_size: ?u63 = null,

    const RequestMixin = BodyMixin(@This());
    pub usingnamespace JSC.Codegen.JSRequest;

    pub const getText = RequestMixin.getText;
    pub const getBody = RequestMixin.getBody;
    pub const getBodyUsed = RequestMixin.getBodyUsed;
    pub const getJSON = RequestMixin.getJSON;
    pub const getArrayBuffer = RequestMixin.getArrayBuffer;
    pub const getBlob = RequestMixin.getBlob;
    pub const getFormData = RequestMixin.getFormData;

    pub fn getContentType(
        this: *Request,
    ) ?ZigString.Slice {
        if (this.uws_request) |req| {
            if (req.header("content-type")) |value| {
                return ZigString.Slice.fromUTF8NeverFree(value);
            }
        }

        if (this.headers) |headers| {
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

    pub fn getFormDataEncoding(this: *Request) ?*bun.FormData.AsyncFormData {
        var content_type_slice: ZigString.Slice = this.getContentType() orelse return null;
        defer content_type_slice.deinit();
        const encoding = bun.FormData.Encoding.get(content_type_slice.slice()) orelse return null;
        return bun.FormData.AsyncFormData.init(bun.default_allocator, encoding) catch unreachable;
    }

    pub fn estimatedSize(this: *Request) callconv(.C) usize {
        return this.reported_estimated_size orelse brk: {
            this.reported_estimated_size = @truncate(u63, this.body.value.estimatedSize() + this.sizeOfURL() + @sizeOf(Request));
            break :brk this.reported_estimated_size.?;
        };
    }

    pub fn writeFormat(this: *Request, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);
        try writer.print("Request ({}) {{\n", .{bun.fmt.size(this.body.value.size())});
        {
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>method<d>:<r> \"", enable_ansi_colors));

            try writer.writeAll(bun.asByteSlice(@tagName(this.method)));
            try writer.writeAll("\"");
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>url<d>:<r> ", enable_ansi_colors));
            try this.ensureURL();
            try writer.print(comptime Output.prettyFmt("\"<b>{s}<r>\"", enable_ansi_colors), .{this.url});
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>headers<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Private, Writer, writer, this.getHeaders(formatter.globalThis), .DOMWrapper, enable_ansi_colors);

            if (this.body.value == .Blob) {
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                try this.body.value.Blob.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
            } else if (this.body.value == .InternalBlob) {
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                if (this.body.value.size() == 0) {
                    try Blob.initEmpty(undefined).writeFormat(Formatter, formatter, writer, enable_ansi_colors);
                } else {
                    try Blob.writeFormatForSize(this.body.value.size(), writer, enable_ansi_colors);
                }
            } else if (this.body.value == .Locked) {
                if (this.body.value.Locked.readable) |stream| {
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
            .url = bun.asByteSlice(ctx.getFullURL()),
            .body = try InitRequestBodyValue(.{ .Null = {} }),
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

        switch (this.body.value) {
            .Blob => |blob| {
                if (blob.content_type.len > 0) {
                    return blob.content_type;
                }

                return MimeType.other.value;
            },
            .InternalBlob => return this.body.value.InternalBlob.contentType(),
            .WTFStringImpl => return MimeType.text.value,
            // .InlineBlob => return this.body.value.InlineBlob.contentType(),
            .Null, .Error, .Used, .Locked, .Empty => return MimeType.other.value,
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

    pub fn getSignal(this: *Request, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        // Already have an C++ instance
        if (this.signal) |signal| {
            return signal.toJS(globalThis);
        } else {
            //Lazy create default signal
            const js_signal = AbortSignal.create(globalThis);
            js_signal.ensureStillAlive();
            if (AbortSignal.fromJS(js_signal)) |signal| {
                this.signal = signal.ref();
            }
            return js_signal;
        }
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

    pub fn finalizeWithoutDeinit(this: *Request) void {
        if (this.headers) |headers| {
            headers.deref();
            this.headers = null;
        }

        if (this.url_was_allocated) {
            bun.default_allocator.free(bun.constStrToU8(this.url));
        }

        if (this.signal) |signal| {
            _ = signal.unref();
            this.signal = null;
        }
    }

    pub fn finalize(this: *Request) callconv(.C) void {
        this.finalizeWithoutDeinit();
        _ = this.body.unref();
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
            if (headers_ref.get("referrer", globalObject)) |referrer| {
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

    pub fn sizeOfURL(this: *const Request) usize {
        if (this.url.len > 0)
            return this.url.len;

        if (this.uws_request) |req| {
            const req_url = req.url();
            if (req_url.len > 0 and req_url[0] == '/') {
                if (req.header("host")) |host| {
                    const fmt = ZigURL.HostFormatter{
                        .is_https = this.https,
                        .host = host,
                    };
                    return this.getProtocol().len + req_url.len + std.fmt.count("{any}", .{fmt});
                }
            }
            return req_url.len;
        }

        return 0;
    }

    pub fn getProtocol(this: *const Request) []const u8 {
        if (this.https)
            return "https://";

        return "http://";
    }

    pub fn ensureURL(this: *Request) !void {
        if (this.url.len > 0) return;

        if (this.uws_request) |req| {
            const req_url = req.url();
            if (req_url.len > 0 and req_url[0] == '/') {
                if (req.header("host")) |host| {
                    const fmt = ZigURL.HostFormatter{
                        .is_https = this.https,
                        .host = host,
                    };
                    const url = try std.fmt.allocPrint(bun.default_allocator, "{s}{any}{s}", .{
                        this.getProtocol(),
                        fmt,
                        req_url,
                    });
                    if (comptime Environment.allow_assert) {
                        std.debug.assert(this.sizeOfURL() == url.len);
                    }
                    this.url = url;
                    this.url_was_allocated = true;
                    return;
                }
            }

            if (comptime Environment.allow_assert) {
                std.debug.assert(this.sizeOfURL() == req_url.len);
            }
            this.url = try bun.default_allocator.dupe(u8, req_url);
            this.url_was_allocated = true;
        }
    }

    const Fields = enum {
        method,
        headers,
        body,
        // referrer,
        // referrerPolicy,
        // mode,
        // credentials,
        // redirect,
        // integrity,
        // keepalive,
        signal,
        // proxy,
        // timeout,
        url,
    };

    pub fn constructInto(
        globalThis: *JSC.JSGlobalObject,
        arguments: []const JSC.JSValue,
    ) ?Request {
        var req = Request{
            .body = InitRequestBodyValue(.{ .Null = {} }) catch {
                return null;
            },
        };

        if (arguments.len == 0) {
            globalThis.throw("Failed to construct 'Request': 1 argument required, but only 0 present.", .{});
            _ = req.body.unref();
            return null;
        } else if (arguments[0].isEmptyOrUndefinedOrNull() or !arguments[0].isCell()) {
            globalThis.throw("Failed to construct 'Request': expected non-empty string or object, got undefined", .{});
            _ = req.body.unref();
            return null;
        }

        const url_or_object = arguments[0];
        const url_or_object_type = url_or_object.jsType();
        var fields = std.EnumSet(Fields).initEmpty();

        const is_first_argument_a_url =
            // fastest path:
            url_or_object_type.isStringLike() or
            // slower path:
            url_or_object.as(JSC.DOMURL) != null;

        if (is_first_argument_a_url) {
            const slice = arguments[0].toSliceOrNull(globalThis) orelse {
                req.finalizeWithoutDeinit();
                _ = req.body.unref();
                return null;
            };
            req.url = (slice.cloneIfNeeded(globalThis.allocator()) catch {
                req.finalizeWithoutDeinit();
                _ = req.body.unref();
                return null;
            }).slice();
            req.url_was_allocated = req.url.len > 0;
            if (req.url.len > 0)
                fields.insert(.url);
        } else if (!url_or_object_type.isObject()) {
            globalThis.throw("Failed to construct 'Request': expected non-empty string or object", .{});
            _ = req.body.unref();
            return null;
        }

        const values_to_try_ = [_]JSValue{
            if (arguments.len > 1 and arguments[1].isObject())
                arguments[1]
            else if (is_first_argument_a_url)
                JSValue.undefined
            else
                url_or_object,
            if (is_first_argument_a_url) JSValue.undefined else url_or_object,
        };
        const values_to_try = values_to_try_[0 .. @as(usize, @boolToInt(!is_first_argument_a_url)) +
            @as(usize, @boolToInt(arguments.len > 1 and arguments[1].isObject()))];

        for (values_to_try) |value| {
            const value_type = value.jsType();

            if (value_type == .DOMWrapper) {
                if (value.as(Request)) |request| {
                    if (values_to_try.len == 1) {
                        request.cloneInto(&req, globalThis.allocator(), globalThis, fields.contains(.url));
                        return req;
                    }

                    if (!fields.contains(.method)) {
                        req.method = request.method;
                        fields.insert(.method);
                    }

                    if (!fields.contains(.headers)) {
                        if (request.cloneHeaders(globalThis)) |headers| {
                            req.headers = headers;
                            fields.insert(.headers);
                        }
                    }

                    if (!fields.contains(.body)) {
                        switch (request.body.value) {
                            .Null, .Empty, .Used => {},
                            else => {
                                req.body.value = request.body.value.clone(globalThis);
                                fields.insert(.body);
                            },
                        }
                    }
                }

                if (value.as(JSC.WebCore.Response)) |response| {
                    if (!fields.contains(.method)) {
                        req.method = response.body.init.method;
                        fields.insert(.method);
                    }

                    if (!fields.contains(.headers)) {
                        if (response.body.init.headers) |headers| {
                            req.headers = headers.cloneThis(globalThis);
                            fields.insert(.headers);
                        }
                    }

                    if (!fields.contains(.url)) {
                        if (response.url.len > 0) {
                            req.url = globalThis.allocator().dupe(u8, response.url) catch unreachable;
                            req.url_was_allocated = true;
                            fields.insert(.url);
                        }
                    }

                    if (!fields.contains(.body)) {
                        switch (response.body.value) {
                            .Null, .Empty, .Used => {},
                            else => {
                                req.body.value = response.body.value.clone(globalThis);
                                fields.insert(.body);
                            },
                        }
                    }
                }
            }

            if (!fields.contains(.body)) {
                if (value.fastGet(globalThis, .body)) |body_| {
                    fields.insert(.body);
                    if (Body.Value.fromJS(globalThis, body_)) |body| {
                        req.body.value = body;
                    } else {
                        req.finalizeWithoutDeinit();
                        _ = req.body.unref();
                        return null;
                    }
                }
            }

            if (!fields.contains(.url)) {
                if (value.fastGet(globalThis, .url)) |url| {
                    req.url = (url.toSlice(globalThis, bun.default_allocator).cloneIfNeeded(bun.default_allocator) catch {
                        return null;
                    }).slice();
                    req.url_was_allocated = req.url.len > 0;
                    if (req.url.len > 0)
                        fields.insert(.url);

                    // first value
                } else if (@enumToInt(value) == @enumToInt(values_to_try[values_to_try.len - 1]) and !is_first_argument_a_url and
                    value.implementsToString(globalThis))
                {
                    const slice = value.toSliceOrNull(globalThis) orelse {
                        req.finalizeWithoutDeinit();
                        _ = req.body.unref();
                        return null;
                    };
                    req.url = (slice.cloneIfNeeded(globalThis.allocator()) catch {
                        req.finalizeWithoutDeinit();
                        _ = req.body.unref();
                        return null;
                    }).slice();
                    req.url_was_allocated = req.url.len > 0;
                    if (req.url.len > 0)
                        fields.insert(.url);
                }
            }

            if (!fields.contains(.signal)) {
                if (value.get(globalThis, "signal")) |signal_| {
                    fields.insert(.signal);

                    if (AbortSignal.fromJS(signal_)) |signal| {
                        //Keep it alive
                        signal_.ensureStillAlive();
                        req.signal = signal.ref();
                    } else {
                        globalThis.throw("Failed to construct 'Request': signal is not of type AbortSignal.", .{});
                        req.finalizeWithoutDeinit();
                        _ = req.body.unref();
                        return null;
                    }
                }
            }

            if (!fields.contains(.method) or !fields.contains(.headers)) {
                if (Body.Init.init(globalThis.allocator(), globalThis, value) catch null) |init| {
                    if (!fields.contains(.method)) {
                        req.method = init.method;
                        fields.insert(.method);
                    }

                    if (init.headers) |headers| {
                        if (!fields.contains(.headers)) {
                            req.headers = headers;
                            fields.insert(.headers);
                        } else {
                            headers.deref();
                        }
                    }
                }
            }
        }

        if (req.url.len == 0) {
            globalThis.throw("Failed to construct 'Request': url is required.", .{});
            req.finalizeWithoutDeinit();
            _ = req.body.unref();
            return null;
        }

        const parsed_url = ZigURL.parse(req.url);
        if (parsed_url.hostname.len == 0) {
            globalThis.throw("Failed to construct 'Request': Invalid URL (missing a hostname)", .{});
            req.finalizeWithoutDeinit();
            _ = req.body.unref();
            return null;
        }

        if (req.body.value == .Blob and
            req.headers != null and
            req.body.value.Blob.content_type.len > 0 and
            !req.headers.?.fastHas(.ContentType))
        {
            req.headers.?.put("content-type", req.body.value.Blob.content_type, globalThis);
        }

        return req;
    }
    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Request {
        const arguments_ = callframe.arguments(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        var request = constructInto(globalThis, arguments) orelse {
            return null;
        };
        var request_ = getAllocator(globalThis).create(Request) catch {
            return null;
        };
        request_.* = request;
        return request_;
    }

    pub fn getBodyValue(
        this: *Request,
    ) *Body.Value {
        return &this.body.value;
    }

    pub fn getFetchHeaders(
        this: *Request,
    ) ?*FetchHeaders {
        return this.headers;
    }

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

                if (this.body.value == .Blob) {
                    const content_type = this.body.value.Blob.content_type;
                    if (content_type.len > 0) {
                        this.headers.?.put("content-type", content_type, globalThis);
                    }
                }
            }
        }

        return this.headers.?.toJS(globalThis);
    }

    pub fn cloneHeaders(this: *Request, globalThis: *JSGlobalObject) ?*FetchHeaders {
        if (this.headers == null) {
            if (this.uws_request) |uws_req| {
                this.headers = FetchHeaders.createFromUWS(globalThis, uws_req);
            }
        }

        if (this.headers) |head| {
            if (head.isEmpty()) {
                return null;
            }

            return head.cloneThis(globalThis);
        }

        return null;
    }

    pub fn cloneInto(
        this: *Request,
        req: *Request,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
        preserve_url: bool,
    ) void {
        this.ensureURL() catch {};

        var body = InitRequestBodyValue(this.body.value.clone(globalThis)) catch {
            globalThis.throw("Failed to clone request", .{});
            return;
        };

        const original_url = req.url;

        req.* = Request{
            .body = body,
            .url = if (preserve_url) original_url else allocator.dupe(u8, this.url) catch {
                _ = body.unref();
                globalThis.throw("Failed to clone request", .{});
                return;
            },
            .url_was_allocated = if (preserve_url) req.url_was_allocated else true,
            .method = this.method,
            .headers = this.cloneHeaders(globalThis),
        };

        if (this.signal) |signal| {
            req.signal = signal.ref();
        }
    }

    pub fn clone(this: *Request, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) *Request {
        var req = allocator.create(Request) catch unreachable;
        this.cloneInto(req, allocator, globalThis, false);
        return req;
    }
};
