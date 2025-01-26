const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const MimeType = bun.http.MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = bun.http;
const JSC = bun.JSC;
const js = JSC.C;

const Method = @import("../../http/method.zig").Method;
const FetchHeaders = JSC.FetchHeaders;
const AbortSignal = JSC.WebCore.AbortSignal;
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

const VirtualMachine = JSC.VirtualMachine;
const Task = JSC.Task;
const JSPrinter = bun.js_printer;
const picohttp = bun.picohttp;
const StringJoiner = bun.StringJoiner;
const uws = bun.uws;

const InlineBlob = JSC.WebCore.InlineBlob;
const AnyBlob = JSC.WebCore.AnyBlob;
const InternalBlob = JSC.WebCore.InternalBlob;
const BodyMixin = JSC.WebCore.BodyMixin;
const Body = JSC.WebCore.Body;
const Blob = JSC.WebCore.Blob;
const Response = JSC.WebCore.Response;

// https://developer.mozilla.org/en-US/docs/Web/API/Request
pub const Request = struct {
    url: bun.String = bun.String.empty,
    // NOTE(@cirospaciari): renamed to _headers to avoid direct manipulation, use getFetchHeaders, setFetchHeaders, ensureFetchHeaders and hasFetchHeaders instead
    _headers: ?*FetchHeaders = null,
    signal: ?*AbortSignal = null,
    body: *JSC.BodyValueRef,
    method: Method = Method.GET,
    request_context: JSC.API.AnyRequestContext = JSC.API.AnyRequestContext.Null,
    https: bool = false,
    weak_ptr_data: bun.WeakPtrData = .{},
    // We must report a consistent value for this
    reported_estimated_size: usize = 0,
    internal_event_callback: InternalJSEventCallback = .{},

    const RequestMixin = BodyMixin(@This());
    pub usingnamespace JSC.Codegen.JSRequest;
    pub usingnamespace bun.New(@This());

    pub const getText = RequestMixin.getText;
    pub const getBytes = RequestMixin.getBytes;
    pub const getBody = RequestMixin.getBody;
    pub const getBodyUsed = RequestMixin.getBodyUsed;
    pub const getJSON = RequestMixin.getJSON;
    pub const getArrayBuffer = RequestMixin.getArrayBuffer;
    pub const getBlob = RequestMixin.getBlob;
    pub const getFormData = RequestMixin.getFormData;
    pub const getBlobWithoutCallFrame = RequestMixin.getBlobWithoutCallFrame;
    pub const WeakRef = bun.WeakPtr(Request, .weak_ptr_data);

    pub fn memoryCost(this: *const Request) usize {
        return @sizeOf(Request) + this.request_context.memoryCost() + this.url.byteSlice().len + this.body.value.memoryCost();
    }

    pub export fn Request__getUWSRequest(
        this: *Request,
    ) ?*uws.Request {
        return this.request_context.getRequest();
    }

    pub export fn Request__setInternalEventCallback(
        this: *Request,
        callback: JSC.JSValue,
        globalThis: *JSC.JSGlobalObject,
    ) void {
        this.internal_event_callback = InternalJSEventCallback.init(callback, globalThis);
        // we always have the abort event but we need to enable the timeout event as well in case of `node:http`.Server.setTimeout is set
        this.request_context.enableTimeoutEvents();
    }

    pub export fn Request__setTimeout(this: *Request, seconds: JSC.JSValue, globalThis: *JSC.JSGlobalObject) void {
        if (!seconds.isNumber()) {
            globalThis.throw("Failed to set timeout: The provided value is not of type 'number'.", .{}) catch {};
            return;
        }

        this.setTimeout(seconds.to(c_uint));
    }

    comptime {
        if (!JSC.is_bindgen) {
            _ = Request__getUWSRequest;
            _ = Request__setInternalEventCallback;
            _ = Request__setTimeout;
        }
    }

    pub const InternalJSEventCallback = struct {
        function: JSC.Strong = .{},

        pub const EventType = enum(u8) {
            timeout = 0,
            abort = 1,
        };
        pub fn init(function: JSC.JSValue, globalThis: *JSC.JSGlobalObject) InternalJSEventCallback {
            return InternalJSEventCallback{
                .function = JSC.Strong.create(function, globalThis),
            };
        }

        pub fn hasCallback(this: *InternalJSEventCallback) bool {
            return this.function.has();
        }

        pub fn trigger(this: *InternalJSEventCallback, eventType: EventType, globalThis: *JSC.JSGlobalObject) bool {
            if (this.function.get()) |callback| {
                _ = callback.call(globalThis, JSC.JSValue.jsUndefined(), &.{JSC.JSValue.jsNumber(
                    @intFromEnum(eventType),
                )}) catch |err| globalThis.reportActiveExceptionAsUnhandled(err);
                return true;
            }
            return false;
        }

        pub fn deinit(this: *InternalJSEventCallback) void {
            this.function.deinit();
        }
    };

    pub fn init(
        url: bun.String,
        headers: ?*FetchHeaders,
        body: *JSC.BodyValueRef,
        method: Method,
    ) Request {
        return Request{
            .url = url,
            ._headers = headers,
            .body = body,
            .method = method,
        };
    }

    pub fn getContentType(
        this: *Request,
    ) ?ZigString.Slice {
        if (this.request_context.getRequest()) |req| {
            if (req.header("content-type")) |value| {
                return ZigString.Slice.fromUTF8NeverFree(value);
            }
        }

        if (this._headers) |headers| {
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
        return this.reported_estimated_size;
    }

    pub fn calculateEstimatedByteSize(this: *Request) void {
        this.reported_estimated_size = this.body.value.estimatedSize() + this.sizeOfURL() + @sizeOf(Request);
    }

    pub fn toJS(this: *Request, globalObject: *JSGlobalObject) JSValue {
        this.calculateEstimatedByteSize();
        return Request.toJSUnchecked(globalObject, this);
    }

    pub fn writeFormat(this: *Request, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);
        try writer.print("Request ({}) {{\n", .{bun.fmt.size(this.body.value.size(), .{})});
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
            try writer.print(comptime Output.prettyFmt("\"<b>{}<r>\"", enable_ansi_colors), .{this.url});
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>headers<d>:<r> ", enable_ansi_colors));
            try formatter.printAs(.Private, Writer, writer, this.getHeaders(formatter.globalThis), .DOMWrapper, enable_ansi_colors);

            if (this.body.value == .Blob) {
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                try this.body.value.Blob.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
            } else if (this.body.value == .InternalBlob or this.body.value == .WTFStringImpl) {
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                const size = this.body.value.size();
                if (size == 0) {
                    var empty = Blob.initEmpty(undefined);
                    try empty.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
                } else {
                    try Blob.writeFormatForSize(false, size, writer, enable_ansi_colors);
                }
            } else if (this.body.value == .Locked) {
                if (this.body.value.Locked.readable.get()) |stream| {
                    try writer.writeAll("\n");
                    try formatter.writeIndent(Writer, writer);
                    try formatter.printAs(.Object, Writer, writer, stream.value, stream.value.jsType(), enable_ansi_colors);
                }
            }
        }
        try writer.writeAll("\n");
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
    }

    pub fn mimeType(this: *const Request) string {
        if (this._headers) |headers| {
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
    ) JSC.JSValue {
        return ZigString.init(Properties.UTF8.default).toJS(globalThis);
    }
    pub fn getCredentials(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return ZigString.init(Properties.UTF8.include).toJS(globalThis);
    }
    pub fn getDestination(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return ZigString.init("").toJS(globalThis);
    }

    pub fn getIntegrity(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return ZigString.Empty.toJS(globalThis);
    }

    pub fn getSignal(this: *Request, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
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
    ) JSC.JSValue {
        return bun.String.static(@tagName(this.method)).toJS(globalThis);
    }

    pub fn getMode(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return ZigString.init(Properties.UTF8.navigate).toJS(globalThis);
    }

    pub fn finalizeWithoutDeinit(this: *Request) void {
        if (this._headers) |headers| {
            headers.deref();
            this._headers = null;
        }

        this.url.deref();
        this.url = bun.String.empty;

        if (this.signal) |signal| {
            signal.unref();
            this.signal = null;
        }
        this.internal_event_callback.deinit();
    }

    pub fn finalize(this: *Request) void {
        this.finalizeWithoutDeinit();
        _ = this.body.unref();
        if (this.weak_ptr_data.onFinalize()) {
            this.destroy();
        }
    }

    pub fn getRedirect(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return ZigString.init(Properties.UTF8.follow).toJS(globalThis);
    }
    pub fn getReferrer(
        this: *Request,
        globalObject: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        if (this._headers) |headers_ref| {
            if (headers_ref.get("referrer", globalObject)) |referrer| {
                return ZigString.init(referrer).toJS(globalObject);
            }
        }

        return ZigString.init("").toJS(globalObject);
    }
    pub fn getReferrerPolicy(
        _: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return ZigString.init("").toJS(globalThis);
    }
    pub fn getUrl(this: *Request, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        this.ensureURL() catch {
            globalObject.throw("Failed to join URL", .{}) catch {}; // TODO: propagate
            return .zero;
        };

        return this.url.toJS(globalObject);
    }

    pub fn sizeOfURL(this: *const Request) usize {
        if (this.url.length() > 0)
            return this.url.byteSlice().len;

        if (this.request_context.getRequest()) |req| {
            const req_url = req.url();
            if (req_url.len > 0 and req_url[0] == '/') {
                if (req.header("host")) |host| {
                    const fmt = bun.fmt.HostFormatter{
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
        if (!this.url.isEmpty()) return;

        if (this.request_context.getRequest()) |req| {
            const req_url = req.url();
            if (req_url.len > 0 and req_url[0] == '/') {
                if (req.header("host")) |host| {
                    const fmt = bun.fmt.HostFormatter{
                        .is_https = this.https,
                        .host = host,
                    };
                    const url_bytelength = std.fmt.count("{s}{any}{s}", .{
                        this.getProtocol(),
                        fmt,
                        req_url,
                    });

                    if (comptime Environment.allow_assert) {
                        bun.assert(this.sizeOfURL() == url_bytelength);
                    }

                    if (url_bytelength < 128) {
                        var buffer: [128]u8 = undefined;
                        const url = std.fmt.bufPrint(&buffer, "{s}{any}{s}", .{
                            this.getProtocol(),
                            fmt,
                            req_url,
                        }) catch @panic("Unexpected error while printing URL");

                        if (comptime Environment.allow_assert) {
                            bun.assert(this.sizeOfURL() == url.len);
                        }

                        var href = bun.JSC.URL.hrefFromString(bun.String.fromBytes(url));
                        if (!href.isEmpty()) {
                            if (href.byteSlice().ptr == url.ptr) {
                                this.url = bun.String.createLatin1(url[0..href.length()]);
                                href.deref();
                            } else {
                                this.url = href;
                            }
                        } else {
                            // TODO: what is the right thing to do for invalid URLS?
                            this.url = bun.String.createUTF8(url);
                        }

                        return;
                    }

                    if (strings.isAllASCII(host) and strings.isAllASCII(req_url)) {
                        this.url, const bytes = bun.String.createUninitialized(.latin1, url_bytelength);
                        _ = std.fmt.bufPrint(bytes, "{s}{any}{s}", .{
                            this.getProtocol(),
                            fmt,
                            req_url,
                        }) catch |err| switch (err) {
                            error.NoSpaceLeft => unreachable, // exact space should have been counted
                        };
                    } else {
                        // slow path
                        const temp_url = std.fmt.allocPrint(bun.default_allocator, "{s}{any}{s}", .{
                            this.getProtocol(),
                            fmt,
                            req_url,
                        }) catch bun.outOfMemory();
                        defer bun.default_allocator.free(temp_url);
                        this.url = bun.String.createUTF8(temp_url);
                    }

                    const href = bun.JSC.URL.hrefFromString(this.url);
                    // TODO: what is the right thing to do for invalid URLS?
                    if (!href.isEmpty()) {
                        this.url = href;
                    }

                    return;
                }
            }

            if (comptime Environment.allow_assert) {
                bun.assert(this.sizeOfURL() == req_url.len);
            }
            this.url = bun.String.createUTF8(req_url);
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

    pub fn constructInto(globalThis: *JSC.JSGlobalObject, arguments: []const JSC.JSValue) bun.JSError!Request {
        var success = false;
        const vm = globalThis.bunVM();
        const body = try vm.initRequestBodyValue(.{ .Null = {} });
        var req = Request{
            .body = body,
        };
        defer {
            if (!success) {
                req.finalizeWithoutDeinit();
                _ = req.body.unref();
            }
            if (req.body != body) {
                _ = body.unref();
            }
        }

        if (arguments.len == 0) {
            return globalThis.throw("Failed to construct 'Request': 1 argument required, but only 0 present.", .{});
        } else if (arguments[0].isEmptyOrUndefinedOrNull() or !arguments[0].isCell()) {
            return globalThis.throw("Failed to construct 'Request': expected non-empty string or object, got undefined", .{});
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
            const str = try bun.String.fromJS2(arguments[0], globalThis);
            req.url = str;

            if (!req.url.isEmpty())
                fields.insert(.url);
        } else if (!url_or_object_type.isObject()) {
            return globalThis.throw("Failed to construct 'Request': expected non-empty string or object", .{});
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
        const values_to_try = values_to_try_[0 .. @as(usize, @intFromBool(!is_first_argument_a_url)) +
            @as(usize, @intFromBool(arguments.len > 1 and arguments[1].isObject()))];
        for (values_to_try) |value| {
            const value_type = value.jsType();
            const explicit_check = values_to_try.len == 2 and value_type == .FinalObject and values_to_try[1].jsType() == .DOMWrapper;
            if (value_type == .DOMWrapper) {
                if (value.asDirect(Request)) |request| {
                    if (values_to_try.len == 1) {
                        request.cloneInto(&req, globalThis.allocator(), globalThis, fields.contains(.url));
                        success = true;
                        return req;
                    }

                    if (!fields.contains(.method)) {
                        req.method = request.method;
                        fields.insert(.method);
                    }

                    if (!fields.contains(.headers)) {
                        if (request.cloneHeaders(globalThis)) |headers| {
                            req._headers = headers;
                            fields.insert(.headers);
                        }

                        if (globalThis.hasException()) return error.JSError;
                    }

                    if (!fields.contains(.body)) {
                        switch (request.body.value) {
                            .Null, .Empty, .Used => {},
                            else => {
                                req.body.value = request.body.value.clone(globalThis);
                                if (globalThis.hasException()) return error.JSError;
                                fields.insert(.body);
                            },
                        }
                    }
                }

                if (value.asDirect(JSC.WebCore.Response)) |response| {
                    if (!fields.contains(.method)) {
                        req.method = response.init.method;
                        fields.insert(.method);
                    }

                    if (!fields.contains(.headers)) {
                        if (response.init.headers) |headers| {
                            req._headers = headers.cloneThis(globalThis);
                            fields.insert(.headers);
                        }
                    }

                    if (!fields.contains(.url)) {
                        if (!response.url.isEmpty()) {
                            req.url = response.url.dupeRef();
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

                    if (globalThis.hasException()) return error.JSError;
                }
            }

            if (!fields.contains(.body)) {
                if (value.fastGet(globalThis, .body)) |body_| {
                    fields.insert(.body);
                    req.body.value = try Body.Value.fromJS(globalThis, body_);
                }

                if (globalThis.hasException()) return error.JSError;
            }

            if (!fields.contains(.url)) {
                if (value.fastGet(globalThis, .url)) |url| {
                    req.url = bun.String.fromJS(url, globalThis);
                    if (!req.url.isEmpty())
                        fields.insert(.url);

                    // first value
                } else if (@intFromEnum(value) == @intFromEnum(values_to_try[values_to_try.len - 1]) and !is_first_argument_a_url and
                    value.implementsToString(globalThis))
                {
                    const str = bun.String.tryFromJS(value, globalThis) orelse return error.JSError;
                    req.url = str;
                    if (!req.url.isEmpty())
                        fields.insert(.url);
                }

                if (globalThis.hasException()) return error.JSError;
            }

            if (!fields.contains(.signal)) {
                if (try value.getTruthy(globalThis, "signal")) |signal_| {
                    fields.insert(.signal);
                    if (AbortSignal.fromJS(signal_)) |signal| {
                        //Keep it alive
                        signal_.ensureStillAlive();
                        req.signal = signal.ref();
                    } else {
                        if (!globalThis.hasException()) {
                            return globalThis.throw("Failed to construct 'Request': signal is not of type AbortSignal.", .{});
                        }
                        return error.JSError;
                    }
                }

                if (globalThis.hasException()) return error.JSError;
            }

            if (!fields.contains(.method) or !fields.contains(.headers)) {
                if (globalThis.hasException()) return error.JSError;
                if (try Response.Init.init(globalThis, value)) |response_init| {
                    if (!explicit_check or (explicit_check and value.fastGet(globalThis, .headers) != null)) {
                        if (response_init.headers) |headers| {
                            if (!fields.contains(.headers)) {
                                req._headers = headers;
                                fields.insert(.headers);
                            } else {
                                headers.deref();
                            }
                        }
                    }

                    if (globalThis.hasException()) return error.JSError;

                    if (!explicit_check or (explicit_check and value.fastGet(globalThis, .method) != null)) {
                        if (!fields.contains(.method)) {
                            req.method = response_init.method;
                            fields.insert(.method);
                        }
                    }
                    if (globalThis.hasException()) return error.JSError;
                }

                if (globalThis.hasException()) return error.JSError;
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (req.url.isEmpty()) {
            return globalThis.throw("Failed to construct 'Request': url is required.", .{});
        }

        const href = JSC.URL.hrefFromString(req.url);
        if (href.isEmpty()) {
            if (!globalThis.hasException()) {
                // globalThis.throw can cause GC, which could cause the above string to be freed.
                // so we must increment the reference count before calling it.
                return globalThis.ERR_INVALID_URL("Failed to construct 'Request': Invalid URL \"{}\"", .{req.url}).throw();
            }
            return error.JSError;
        }

        // hrefFromString increments the reference count if they end up being
        // the same
        //
        // we increment the reference count on usage above, so we must
        // decrement it to be perfectly balanced.
        req.url.deref();

        req.url = href;

        if (req.body.value == .Blob and
            req._headers != null and
            req.body.value.Blob.content_type.len > 0 and
            !req._headers.?.fastHas(.ContentType))
        {
            req._headers.?.put(.ContentType, req.body.value.Blob.content_type, globalThis);
        }

        req.calculateEstimatedByteSize();
        success = true;

        return req;
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*Request {
        const arguments_ = callframe.arguments_old(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        const request = try constructInto(globalThis, arguments);
        return Request.new(request);
    }

    pub fn getBodyValue(
        this: *Request,
    ) *Body.Value {
        return &this.body.value;
    }

    pub fn doClone(
        this: *Request,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const this_value = callframe.this();
        var cloned = this.clone(getAllocator(globalThis), globalThis);

        if (globalThis.hasException()) {
            cloned.finalize();
            return .zero;
        }

        const js_wrapper = cloned.toJS(globalThis);
        if (js_wrapper != .zero) {
            if (cloned.body.value == .Locked) {
                if (cloned.body.value.Locked.readable.get()) |readable| {
                    // If we are teed, then we need to update the cached .body
                    // value to point to the new readable stream
                    // We must do this on both the original and cloned request
                    // but especially the original request since it will have a stale .body value now.
                    Request.bodySetCached(js_wrapper, globalThis, readable.value);

                    if (this.body.value.Locked.readable.get()) |other_readable| {
                        Request.bodySetCached(this_value, globalThis, other_readable.value);
                    }
                }
            }
        }

        return js_wrapper;
    }

    // Returns if the request has headers already cached/set.
    pub fn hasFetchHeaders(this: *Request) bool {
        return this._headers != null;
    }

    /// Sets the headers of the request. This will take ownership of the headers.
    /// it will deref the previous headers if they exist.
    pub fn setFetchHeaders(
        this: *Request,
        headers: ?*FetchHeaders,
    ) void {
        if (this._headers) |old_headers| {
            old_headers.deref();
        }

        this._headers = headers;
    }

    /// Returns the headers of the request. If the headers are not already cached, it will create a new FetchHeaders object.
    /// If the headers are empty, it will look at request_context to get the headers.
    /// If the headers are empty and request_context is null, it will create an empty FetchHeaders object.
    pub fn ensureFetchHeaders(
        this: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) *FetchHeaders {
        if (this._headers) |headers| {
            // headers is already set
            return headers;
        }

        if (this.request_context.getRequest()) |req| {
            // we have a request context, so we can get the headers from it
            this._headers = FetchHeaders.createFromUWS(req);
        } else {
            // we don't have a request context, so we need to create an empty headers object
            this._headers = FetchHeaders.createEmpty();

            if (this.body.value == .Blob) {
                const content_type = this.body.value.Blob.content_type;
                if (content_type.len > 0) {
                    this._headers.?.put(.ContentType, content_type, globalThis);
                }
            }
        }

        return this._headers.?;
    }

    pub fn getFetchHeadersUnlessEmpty(
        this: *Request,
    ) ?*FetchHeaders {
        if (this._headers == null) {
            if (this.request_context.getRequest()) |req| {
                // we have a request context, so we can get the headers from it
                this._headers = FetchHeaders.createFromUWS(req);
            }
        }

        const headers = this._headers orelse return null;
        if (headers.isEmpty()) {
            return null;
        }
        return headers;
    }

    /// Returns the headers of the request. This will not look at the request contex to get the headers.
    pub fn getFetchHeaders(
        this: *Request,
    ) ?*FetchHeaders {
        return this._headers;
    }

    /// This should only be called by the JS code. use getFetchHeaders to get the current headers or ensureFetchHeaders to get the headers and create them if they don't exist.
    pub fn getHeaders(
        this: *Request,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return this.ensureFetchHeaders(globalThis).toJS(globalThis);
    }

    pub fn cloneHeaders(this: *Request, globalThis: *JSGlobalObject) ?*FetchHeaders {
        if (this._headers == null) {
            if (this.request_context.getRequest()) |uws_req| {
                this._headers = FetchHeaders.createFromUWS(uws_req);
            }
        }

        if (this._headers) |head| {
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
        _ = allocator;
        this.ensureURL() catch {};
        const vm = globalThis.bunVM();
        const body = vm.initRequestBodyValue(this.body.value.clone(globalThis)) catch {
            if (!globalThis.hasException()) {
                globalThis.throw("Failed to clone request", .{}) catch {};
            }
            return;
        };
        const original_url = req.url;

        req.* = Request{
            .body = body,
            .url = if (preserve_url) original_url else this.url.dupeRef(),
            .method = this.method,
            ._headers = this.cloneHeaders(globalThis),
        };

        if (this.signal) |signal| {
            req.signal = signal.ref();
        }
    }

    pub fn clone(this: *Request, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) *Request {
        const req = Request.new(undefined);
        this.cloneInto(req, allocator, globalThis, false);
        return req;
    }

    pub fn setTimeout(
        this: *Request,
        seconds: c_uint,
    ) void {
        _ = this.request_context.setTimeout(seconds);
    }
};
