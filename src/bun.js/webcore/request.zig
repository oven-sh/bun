const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("bun");
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("bun").HTTP;
const NetworkThread = HTTPClient.NetworkThread;
const AsyncIO = NetworkThread.AsyncIO;
const JSC = @import("bun").JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const ObjectPool = @import("../../pool.zig").ObjectPool;
const SystemError = JSC.SystemError;
const Output = @import("bun").Output;
const MutableString = @import("bun").MutableString;
const strings = @import("bun").strings;
const string = @import("bun").string;
const default_allocator = @import("bun").default_allocator;
const FeatureFlags = @import("bun").FeatureFlags;
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
const picohttp = @import("bun").picohttp;
const StringJoiner = @import("../../string_joiner.zig");
const uws = @import("bun").uws;

const InlineBlob = JSC.WebCore.InlineBlob;
const AnyBlob = JSC.WebCore.AnyBlob;
const InternalBlob = JSC.WebCore.InternalBlob;
const BodyMixin = JSC.WebCore.BodyMixin;
const Body = JSC.WebCore.Body;
const Blob = JSC.WebCore.Blob;

// https://developer.mozilla.org/en-US/docs/Web/API/Request
pub const Request = struct {
    url: []const u8 = "",
    url_was_allocated: bool = false,

    headers: ?*FetchHeaders = null,
    body: Body.Value = Body.Value{ .Empty = {} },
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

        if (this.body == .Blob) {
            if (this.body.Blob.content_type.len > 0)
                return ZigString.Slice.fromUTF8NeverFree(this.body.Blob.content_type);
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
            this.reported_estimated_size = @truncate(u63, this.body.estimatedSize() + this.sizeOfURL() + @sizeOf(Request));
            break :brk this.reported_estimated_size.?;
        };
    }

    pub fn writeFormat(this: *Request, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);
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
            try this.ensureURL();
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
            .body = .{ .Empty = {} },
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
                    request.url = (arguments[0].toSlice(globalThis, bun.default_allocator).cloneIfNeeded(bun.default_allocator) catch {
                        return null;
                    }).slice();
                    request.url_was_allocated = request.url.len > 0;
                } else {
                    if (Body.Init.init(getAllocator(globalThis), globalThis, arguments[0], url_or_object_type) catch null) |req_init| {
                        request.headers = req_init.headers;
                        request.method = req_init.method;
                    }

                    if (urlOrObject.fastGet(globalThis, .body)) |body_| {
                        if (Body.Value.fromJS(globalThis, body_)) |body| {
                            request.body = body;
                        } else {
                            if (request.headers) |head| {
                                head.deref();
                            }

                            return null;
                        }
                    }

                    if (urlOrObject.fastGet(globalThis, .url)) |url| {
                        request.url = (url.toSlice(globalThis, bun.default_allocator).cloneIfNeeded(bun.default_allocator) catch {
                            return null;
                        }).slice();
                        request.url_was_allocated = request.url.len > 0;
                    }
                }
            },
            else => {
                if (Body.Init.init(getAllocator(globalThis), globalThis, arguments[1], arguments[1].jsType()) catch null) |req_init| {
                    request.headers = req_init.headers;
                    request.method = req_init.method;
                }

                if (arguments[1].fastGet(globalThis, .body)) |body_| {
                    if (Body.Value.fromJS(globalThis, body_)) |body| {
                        request.body = body;
                    } else {
                        if (request.headers) |head| {
                            head.deref();
                        }

                        return null;
                    }
                }

                request.url = (arguments[0].toSlice(globalThis, bun.default_allocator).cloneIfNeeded(bun.default_allocator) catch {
                    return null;
                }).slice();
                request.url_was_allocated = request.url.len > 0;
            },
        }

        if (request.body == .Blob and
            request.headers != null and
            request.body.Blob.content_type.len > 0 and
            !request.headers.?.fastHas(.ContentType))
        {
            request.headers.?.put("content-type", request.body.Blob.content_type);
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

                if (this.body == .Blob) {
                    const content_type = this.body.Blob.content_type;
                    if (content_type.len > 0) {
                        this.headers.?.put("content-type", content_type);
                    }
                }
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
