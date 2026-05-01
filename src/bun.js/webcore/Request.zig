//! https://developer.mozilla.org/en-US/docs/Web/API/Request

const Request = @This();

url: bun.String = bun.String.empty,

#headers: ?*FetchHeaders = null,
signal: ?*AbortSignal = null,
#body: *Body.Value.HiveRef,
#js_ref: jsc.JSRef = .empty(),
method: Method = Method.GET,
flags: Flags = .{},
request_context: jsc.API.AnyRequestContext = jsc.API.AnyRequestContext.Null,
weak_ptr_data: WeakRef.Data = .empty,
// We must report a consistent value for this
reported_estimated_size: usize = 0,
internal_event_callback: InternalJSEventCallback = .{},

pub const Flags = packed struct(u8) {
    redirect: FetchRedirect = .follow,
    cache: FetchCacheMode = .default,
    mode: FetchRequestMode = .cors,
    https: bool = false,
};

pub const js = jsc.Codegen.JSRequest;
// NOTE: toJS is overridden
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const new = bun.TrivialNew(@This());

const RequestMixin = BodyMixin(@This());
pub const getText = RequestMixin.getText;
pub const getBytes = RequestMixin.getBytes;
pub const getBody = RequestMixin.getBody;
pub const getBodyUsed = RequestMixin.getBodyUsed;
pub const getJSON = RequestMixin.getJSON;
pub const getArrayBuffer = RequestMixin.getArrayBuffer;
pub const getBlob = RequestMixin.getBlob;
pub const getFormData = RequestMixin.getFormData;
pub const getBlobWithoutCallFrame = RequestMixin.getBlobWithoutCallFrame;
pub const WeakRef = bun.ptr.WeakPtr(Request, "weak_ptr_data");

pub fn memoryCost(this: *const Request) usize {
    return @sizeOf(Request) + this.request_context.memoryCost() + this.url.byteSlice().len + this.#body.value.memoryCost();
}

pub export fn Request__setCookiesOnRequestContext(this: *Request, cookieMap: ?*jsc.WebCore.CookieMap) void {
    this.request_context.setCookies(cookieMap);
}

pub export fn Request__getUWSRequest(
    this: *Request,
) ?*uws.Request {
    return this.request_context.getRequest();
}

pub export fn Request__setInternalEventCallback(
    this: *Request,
    callback: jsc.JSValue,
    globalThis: *jsc.JSGlobalObject,
) void {
    this.internal_event_callback = InternalJSEventCallback.init(callback, globalThis);
    // we always have the abort event but we need to enable the timeout event as well in case of `node:http`.Server.setTimeout is set
    this.request_context.enableTimeoutEvents();
}

pub export fn Request__setTimeout(this: *Request, seconds: jsc.JSValue, globalThis: *jsc.JSGlobalObject) void {
    if (!seconds.isNumber()) {
        globalThis.throw("Failed to set timeout: The provided value is not of type 'number'.", .{}) catch {};
        return;
    }

    this.setTimeout(seconds.to(c_uint));
}

pub export fn Request__clone(this: *Request, globalThis: *jsc.JSGlobalObject) ?*Request {
    return this.clone(bun.default_allocator, globalThis) catch null;
}

comptime {
    _ = Request__clone;
    _ = Request__getUWSRequest;
    _ = Request__setInternalEventCallback;
    _ = Request__setTimeout;
}

pub const InternalJSEventCallback = struct {
    function: jsc.Strong.Optional = .empty,

    pub const EventType = jsc.API.NodeHTTPResponse.AbortEvent;

    pub fn init(function: jsc.JSValue, globalThis: *jsc.JSGlobalObject) InternalJSEventCallback {
        return InternalJSEventCallback{
            .function = .create(function, globalThis),
        };
    }

    pub fn hasCallback(this: *InternalJSEventCallback) bool {
        return this.function.has();
    }

    pub fn trigger(this: *InternalJSEventCallback, eventType: EventType, globalThis: *jsc.JSGlobalObject) bool {
        if (this.function.get()) |callback| {
            _ = callback.call(globalThis, .js_undefined, &.{jsc.JSValue.jsNumber(
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
    method: Method,
    request_context: jsc.API.AnyRequestContext,
    https: bool,
    signal: ?*AbortSignal,
    body: *Body.Value.HiveRef,
) Request {
    return Request{
        .request_context = request_context,
        .method = method,
        .flags = .{ .https = https },
        .signal = signal,
        .#body = body,
    };
}

/// TODO: do we need this?
pub fn init2(
    url: bun.String,
    headers: ?*FetchHeaders,
    body: *Body.Value.HiveRef,
    method: Method,
) Request {
    return Request{
        .url = url,
        .#headers = headers,
        .#body = body,
        .method = method,
    };
}

pub fn getContentType(
    this: *Request,
) bun.JSError!?ZigString.Slice {
    if (this.request_context.getRequest()) |req| {
        if (req.header("content-type")) |value| {
            return ZigString.Slice.fromUTF8NeverFree(value);
        }
    }

    if (this.#headers) |headers| {
        if (headers.fastGet(.ContentType)) |value| {
            return value.toSlice(bun.default_allocator);
        }
    }

    if (this.#body.value == .Blob) {
        if (this.#body.value.Blob.content_type.len > 0)
            return ZigString.Slice.fromUTF8NeverFree(this.#body.value.Blob.content_type);
    }

    return null;
}

pub fn getFormDataEncoding(this: *Request) bun.JSError!?*bun.FormData.AsyncFormData {
    var content_type_slice: ZigString.Slice = (try this.getContentType()) orelse return null;
    defer content_type_slice.deinit();
    const encoding = bun.FormData.Encoding.get(content_type_slice.slice()) orelse return null;
    return bun.FormData.AsyncFormData.init(bun.default_allocator, encoding);
}

pub fn estimatedSize(this: *Request) callconv(bun.jsc.conv) usize {
    return this.reported_estimated_size;
}

pub fn getRemoteSocketInfo(this: *Request, globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    if (this.request_context.getRemoteSocketInfo()) |info| {
        return jsc.JSSocketAddress.create(globalObject, info.ip, info.port, info.is_ipv6);
    }

    return null;
}

pub fn calculateEstimatedByteSize(this: *Request) void {
    this.reported_estimated_size = this.#body.value.estimatedSize() + this.sizeOfURL() + @sizeOf(Request);
}

pub export fn Bun__JSRequest__calculateEstimatedByteSize(this: *Request) void {
    this.calculateEstimatedByteSize();
}

pub inline fn getBodyReadableStream(
    this: *Request,
    globalObject: *JSGlobalObject,
) ?jsc.WebCore.ReadableStream {
    if (this.#js_ref.tryGet()) |js_ref| {
        if (js.gc.stream.get(js_ref)) |stream| {
            // JS is always source of truth for the stream
            return jsc.WebCore.ReadableStream.fromJS(stream, globalObject) catch |err| {
                _ = globalObject.takeException(err);
                return null;
            };
        }
    }
    if (this.#body.value == .Locked) {
        return this.#body.value.Locked.readable.get(globalObject);
    }
    return null;
}
pub inline fn detachReadableStream(this: *Request, globalObject: *jsc.JSGlobalObject) void {
    if (this.#js_ref.tryGet()) |js_ref| {
        js.gc.stream.clear(js_ref, globalObject);
    }
    if (this.#body.value == .Locked) {
        var old = this.#body.value.Locked.readable;
        old.deinit();
        this.#body.value.Locked.readable = .{};
    }
}

pub fn toJS(this: *Request, globalObject: *JSGlobalObject) JSValue {
    this.calculateEstimatedByteSize();
    const js_value = js.toJSUnchecked(globalObject, this);
    this.#js_ref = .initWeak(js_value);

    this.checkBodyStreamRef(globalObject);
    return js_value;
}

extern "C" fn Bun__JSRequest__createForBake(globalObject: *jsc.JSGlobalObject, requestPtr: *Request) callconv(jsc.conv) jsc.JSValue;
pub fn toJSForBake(this: *Request, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return bun.jsc.fromJSHostCall(
        globalObject,
        @src(),
        Bun__JSRequest__createForBake,
        .{ globalObject, this },
    );
}

extern "JS" fn Bun__getParamsIfBunRequest(this_value: JSValue) JSValue;

pub fn writeFormat(this: *Request, this_value: JSValue, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
    const Writer = @TypeOf(writer);

    const params_object = Bun__getParamsIfBunRequest(this_value);

    const class_label = switch (params_object) {
        .zero => "Request",
        else => "BunRequest",
    };
    try writer.print("{s} ({f}) {{\n", .{ class_label, bun.fmt.size(this.#body.value.size(), .{}) });
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
        try writer.print(comptime Output.prettyFmt("\"<b>{f}<r>\"", enable_ansi_colors), .{this.url});
        formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
        try writer.writeAll("\n");

        if (params_object.isCell()) {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>params<d>:<r> ", enable_ansi_colors));
            try formatter.printAs(.Private, Writer, writer, params_object, .Object, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");
        }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime Output.prettyFmt("<r>headers<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Private, Writer, writer, try this.getHeaders(formatter.globalThis), .DOMWrapper, enable_ansi_colors);

        if (this.#body.value == .Blob) {
            try writer.writeAll("\n");
            try formatter.writeIndent(Writer, writer);
            try this.#body.value.Blob.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
        } else if (this.#body.value == .InternalBlob or this.#body.value == .WTFStringImpl) {
            try writer.writeAll("\n");
            try formatter.writeIndent(Writer, writer);
            const size = this.#body.value.size();
            if (size == 0) {
                var empty = Blob.initEmpty(undefined);
                try empty.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
            } else {
                try Blob.writeFormatForSize(false, size, writer, enable_ansi_colors);
            }
        } else if (this.#body.value == .Locked) {
            if (this.getBodyReadableStream(formatter.globalThis)) |stream| {
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
    if (this.#headers) |headers| {
        if (try headers.fastGet(.ContentType)) |content_type| {
            return content_type.slice();
        }
    }

    switch (this.#body.value) {
        .Blob => |blob| {
            if (blob.content_type.len > 0) {
                return blob.content_type;
            }

            return MimeType.other.value;
        },
        .InternalBlob => return this.#body.value.InternalBlob.contentType(),
        .WTFStringImpl => return MimeType.text.value,
        // .InlineBlob => return this.#body.value.InlineBlob.contentType(),
        .Null, .Error, .Used, .Locked, .Empty => return MimeType.other.value,
    }
}

pub fn getCache(
    this: *Request,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return switch (this.flags.cache) {
        inline else => |tag| ZigString.static(@tagName(tag)).toJS(globalThis),
    };
}
pub fn getCredentials(
    _: *Request,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return ZigString.init("include").toJS(globalThis);
}
pub fn getDestination(
    _: *Request,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return ZigString.init("").toJS(globalThis);
}

pub fn getIntegrity(
    _: *Request,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return ZigString.Empty.toJS(globalThis);
}

pub fn getSignal(this: *Request, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
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
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return this.method.toJS(globalThis);
}

pub fn getMode(
    this: *Request,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return switch (this.flags.mode) {
        inline else => |tag| ZigString.static(@tagName(tag)).toJS(globalThis),
    };
}

pub fn finalizeWithoutDeinit(this: *Request) void {
    if (this.#headers) |headers| {
        headers.deref();
        this.#headers = null;
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
    this.#js_ref.finalize();
    this.finalizeWithoutDeinit();
    _ = this.#body.unref();
    if (this.weak_ptr_data.onFinalize()) {
        bun.destroy(this);
    }
}

pub fn getRedirect(
    this: *Request,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return switch (this.flags.redirect) {
        inline else => |tag| ZigString.static(@tagName(tag)).toJS(globalThis),
    };
}
pub fn getReferrer(
    this: *Request,
    globalObject: *jsc.JSGlobalObject,
) jsc.JSValue {
    if (this.#headers) |headers_ref| {
        if (headers_ref.get("referrer", globalObject)) |referrer| {
            return ZigString.init(referrer).toJS(globalObject);
        }
    }

    return ZigString.init("").toJS(globalObject);
}
pub fn getReferrerPolicy(
    _: *Request,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return ZigString.init("").toJS(globalThis);
}
pub fn getUrl(this: *Request, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    try this.ensureURL();
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
                    .is_https = this.flags.https,
                    .host = host,
                };
                return this.getProtocol().len + req_url.len + std.fmt.count("{f}", .{fmt});
            }
        }
        return req_url.len;
    }

    return 0;
}

pub fn getProtocol(this: *const Request) []const u8 {
    if (this.flags.https)
        return "https://";

    return "http://";
}

pub fn ensureURL(this: *Request) bun.OOM!void {
    if (!this.url.isEmpty()) return;

    if (this.request_context.getRequest()) |req| {
        const req_url = req.url();
        if (req_url.len > 0 and req_url[0] == '/') {
            if (req.header("host")) |host| {
                const fmt = bun.fmt.HostFormatter{
                    .is_https = this.flags.https,
                    .host = host,
                };
                const url_bytelength = std.fmt.count("{s}{f}{s}", .{
                    this.getProtocol(),
                    fmt,
                    req_url,
                });

                if (comptime Environment.allow_assert) {
                    bun.assert(this.sizeOfURL() == url_bytelength);
                }

                if (url_bytelength < 128) {
                    var buffer: [128]u8 = undefined;
                    const url = std.fmt.bufPrint(&buffer, "{s}{f}{s}", .{
                        this.getProtocol(),
                        fmt,
                        req_url,
                    }) catch @panic("Unexpected error while printing URL");

                    if (comptime Environment.allow_assert) {
                        bun.assert(this.sizeOfURL() == url.len);
                    }

                    var href = bun.jsc.URL.hrefFromString(bun.String.fromBytes(url));
                    if (!href.isEmpty()) {
                        if (href.byteSlice().ptr == url.ptr) {
                            this.url = bun.String.cloneLatin1(url[0..href.length()]);
                            href.deref();
                        } else {
                            this.url = href;
                        }
                    } else {
                        // TODO: what is the right thing to do for invalid URLS?
                        this.url = bun.String.cloneUTF8(url);
                    }

                    return;
                }

                if (strings.isAllASCII(host) and strings.isAllASCII(req_url)) {
                    this.url, const bytes = bun.String.createUninitialized(.latin1, url_bytelength);
                    _ = std.fmt.bufPrint(bytes, "{s}{f}{s}", .{
                        this.getProtocol(),
                        fmt,
                        req_url,
                    }) catch |err| switch (err) {
                        error.NoSpaceLeft => unreachable, // exact space should have been counted
                    };
                } else {
                    // slow path
                    const temp_url = try std.fmt.allocPrint(bun.default_allocator, "{s}{f}{s}", .{
                        this.getProtocol(),
                        fmt,
                        req_url,
                    });
                    defer bun.default_allocator.free(temp_url);
                    this.url = bun.String.cloneUTF8(temp_url);
                }

                const href = bun.jsc.URL.hrefFromString(this.url);
                // TODO: what is the right thing to do for invalid URLS?
                if (!href.isEmpty()) {
                    this.url.deref();
                    this.url = href;
                }

                return;
            }
        }

        if (comptime Environment.allow_assert) {
            bun.assert(this.sizeOfURL() == req_url.len);
        }
        this.url = bun.String.cloneUTF8(req_url);
    }
}

const Fields = enum {
    method,
    headers,
    body,
    // referrer,
    // referrerPolicy,
    mode,
    // credentials,
    redirect,
    cache,
    // integrity,
    // keepalive,
    signal,
    // proxy,
    // timeout,
    url,
};
fn checkBodyStreamRef(this: *Request, globalObject: *JSGlobalObject) void {
    if (this.#js_ref.tryGet()) |js_value| {
        if (this.#body.value == .Locked) {
            if (this.#body.value.Locked.readable.get(globalObject)) |stream| {
                // Store the stream in js.gc.stream instead of holding a strong reference
                // to avoid circular references. The Request object owns the stream,
                // so Locked.readable should not be used directly by consumers.
                stream.value.ensureStillAlive();
                js.gc.stream.set(js_value, globalObject, stream.value);
                this.#body.value.Locked.readable.deinit();
                this.#body.value.Locked.readable = .{};
            }
        }
    }
}
pub fn constructInto(globalThis: *jsc.JSGlobalObject, arguments: []const jsc.JSValue, this_value: jsc.JSValue) bun.JSError!Request {
    var success = false;
    const vm = globalThis.bunVM();
    const body = try vm.initRequestBodyValue(.{ .Null = {} });
    var req = Request{
        .#body = body,
        .#js_ref = .initWeak(this_value),
    };
    defer {
        if (!success) {
            req.finalizeWithoutDeinit();
            _ = req.#body.unref();
        }
        if (req.#body != body) {
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
        url_or_object.as(jsc.DOMURL) != null;

    if (is_first_argument_a_url) {
        const str = try bun.String.fromJS(arguments[0], globalThis);
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
            .js_undefined
        else
            url_or_object,
        if (is_first_argument_a_url) .js_undefined else url_or_object,
    };
    const values_to_try = values_to_try_[0 .. @as(usize, @intFromBool(!is_first_argument_a_url)) +
        @as(usize, @intFromBool(arguments.len > 1 and arguments[1].isObject()))];
    for (values_to_try) |value| {
        const value_type = value.jsType();
        const explicit_check = values_to_try.len == 2 and value_type == .FinalObject and values_to_try[1].jsType() == .DOMWrapper;
        if (value_type == .DOMWrapper) {
            if (value.asDirect(Request)) |request| {
                if (values_to_try.len == 1) {
                    try request.cloneInto(&req, bun.default_allocator, globalThis, fields.contains(.url));
                    success = true;
                    return req;
                }

                if (!fields.contains(.method)) {
                    req.method = request.method;
                    fields.insert(.method);
                }

                if (!fields.contains(.redirect)) {
                    req.flags.redirect = request.flags.redirect;
                    fields.insert(.redirect);
                }

                if (!fields.contains(.cache)) {
                    req.flags.cache = request.flags.cache;
                    fields.insert(.cache);
                }

                if (!fields.contains(.mode)) {
                    req.flags.mode = request.flags.mode;
                    fields.insert(.mode);
                }

                if (!fields.contains(.headers)) {
                    if (try request.cloneHeaders(globalThis)) |headers| {
                        req.#headers = headers;
                        fields.insert(.headers);
                    }

                    if (globalThis.hasException()) return error.JSError;
                }

                if (!fields.contains(.body)) {
                    switch (request.#body.value) {
                        .Null, .Empty, .Used => {},
                        else => {
                            req.#body.value = try request.#body.value.clone(globalThis);
                            fields.insert(.body);
                        },
                    }
                }
            }

            if (value.asDirect(Response)) |response| {
                if (!fields.contains(.method)) {
                    req.method = response.getMethod();
                    fields.insert(.method);
                }

                if (!fields.contains(.headers)) {
                    if (response.getInitHeaders()) |headers| {
                        req.#headers = try headers.cloneThis(globalThis);
                        fields.insert(.headers);
                    }
                }

                if (!fields.contains(.url)) {
                    const url = response.getUrl();
                    if (!url.isEmpty()) {
                        req.url = url.dupeRef();
                        fields.insert(.url);
                    }
                }

                if (!fields.contains(.body)) {
                    const bodyValue = response.getBodyValue();
                    switch (bodyValue.*) {
                        .Null, .Empty, .Used => {},
                        else => {
                            req.#body.value = try bodyValue.clone(globalThis);
                            fields.insert(.body);
                        },
                    }
                }

                if (globalThis.hasException()) return error.JSError;
            }
        }

        if (!fields.contains(.body)) {
            if (try value.fastGet(globalThis, .body)) |body_| {
                fields.insert(.body);
                req.#body.value = try Body.Value.fromJS(globalThis, body_);
            }

            if (globalThis.hasException()) return error.JSError;
        }

        if (!fields.contains(.url)) {
            if (try value.fastGet(globalThis, .url)) |url| {
                req.url = try bun.String.fromJS(url, globalThis);
                if (!req.url.isEmpty())
                    fields.insert(.url);

                // first value
            } else if (@intFromEnum(value) == @intFromEnum(values_to_try[values_to_try.len - 1]) and !is_first_argument_a_url and
                try value.implementsToString(globalThis))
            {
                const str = try bun.String.fromJS(value, globalThis);
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
                if (!explicit_check or (explicit_check and (try value.fastGet(globalThis, .headers)) != null)) {
                    if (response_init.headers) |headers| {
                        if (!fields.contains(.headers)) {
                            req.#headers = headers;
                            fields.insert(.headers);
                        } else {
                            headers.deref();
                        }
                    }
                }

                if (globalThis.hasException()) return error.JSError;

                if (!explicit_check or (explicit_check and (try value.fastGet(globalThis, .method)) != null)) {
                    if (!fields.contains(.method)) {
                        req.method = response_init.method;
                        fields.insert(.method);
                    }
                }
                if (globalThis.hasException()) return error.JSError;
            }

            if (globalThis.hasException()) return error.JSError;
        }

        // Extract redirect option
        if (!fields.contains(.redirect)) {
            if (try value.getOptionalEnum(globalThis, "redirect", FetchRedirect)) |redirect_value| {
                req.flags.redirect = redirect_value;
                fields.insert(.redirect);
            }
        }

        // Extract cache option
        if (!fields.contains(.cache)) {
            if (try value.getOptionalEnum(globalThis, "cache", FetchCacheMode)) |cache_value| {
                req.flags.cache = cache_value;
                fields.insert(.cache);
            }
        }

        // Extract mode option
        if (!fields.contains(.mode)) {
            if (try value.getOptionalEnum(globalThis, "mode", FetchRequestMode)) |mode_value| {
                req.flags.mode = mode_value;
                fields.insert(.mode);
            }
        }
    }

    if (globalThis.hasException()) {
        return error.JSError;
    }

    if (req.url.isEmpty()) {
        return globalThis.throw("Failed to construct 'Request': url is required.", .{});
    }

    const href = jsc.URL.hrefFromString(req.url);
    if (href.isEmpty()) {
        if (!globalThis.hasException()) {
            // globalThis.throw can cause GC, which could cause the above string to be freed.
            // so we must increment the reference count before calling it.
            return globalThis.ERR(.INVALID_URL, "Failed to construct 'Request': Invalid URL \"{f}\"", .{req.url}).throw();
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

    if (req.#body.value == .Blob and
        req.#headers != null and
        req.#body.value.Blob.content_type.len > 0 and
        !req.#headers.?.fastHas(.ContentType))
    {
        try req.#headers.?.put(.ContentType, req.#body.value.Blob.content_type, globalThis);
    }

    req.calculateEstimatedByteSize();
    req.checkBodyStreamRef(globalThis);
    success = true;

    return req;
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, this_value: jsc.JSValue) bun.JSError!*Request {
    const arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.ptr[0..arguments_.len];

    const request = try constructInto(globalThis, arguments, this_value);
    return Request.new(request);
}

pub fn getBodyValue(
    this: *Request,
) *Body.Value {
    return &this.#body.value;
}

pub fn doClone(
    this: *Request,
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const this_value = callframe.this();
    const cloned = try this.clone(bun.default_allocator, globalThis);

    const js_wrapper = cloned.toJS(globalThis);
    if (js_wrapper != .zero) {
        // After toJS, checkBodyStreamRef has already moved the streams from
        // Locked.readable to js.gc.stream. So we need to use js.gc.stream
        // to get the streams and update the body cache.
        if (js.gc.stream.get(js_wrapper)) |cloned_stream| {
            js.bodySetCached(js_wrapper, globalThis, cloned_stream);
        }
    }

    // Update the original request's body cache with the new teed stream.
    // At this point, this.#body.value.Locked.readable still holds the teed stream
    // because checkBodyStreamRef hasn't been called on the original request yet.
    if (this.#body.value == .Locked) {
        if (this.#body.value.Locked.readable.get(globalThis)) |readable| {
            js.bodySetCached(this_value, globalThis, readable.value);
        }
    }

    this.checkBodyStreamRef(globalThis);
    return js_wrapper;
}

// Returns if the request has headers already cached/set.
pub fn hasFetchHeaders(this: *Request) bool {
    return this.#headers != null;
}

/// Sets the headers of the request. This will take ownership of the headers.
/// it will deref the previous headers if they exist.
pub fn setFetchHeaders(
    this: *Request,
    headers: ?*FetchHeaders,
) void {
    if (this.#headers) |old_headers| {
        old_headers.deref();
    }

    this.#headers = headers;
}

/// Returns the headers of the request. If the headers are not already cached, it will create a new FetchHeaders object.
/// If the headers are empty, it will look at request_context to get the headers.
/// If the headers are empty and request_context is null, it will create an empty FetchHeaders object.
pub fn ensureFetchHeaders(
    this: *Request,
    globalThis: *jsc.JSGlobalObject,
) bun.JSError!*FetchHeaders {
    if (this.#headers) |headers| {
        // headers is already set
        return headers;
    }

    if (this.request_context.getRequest()) |req| {
        // we have a request context, so we can get the headers from it
        this.#headers = FetchHeaders.createFromUWS(req);
    } else {
        // we don't have a request context, so we need to create an empty headers object
        this.#headers = FetchHeaders.createEmpty();
        const content_type = switch (this.#body.value) {
            .Blob => |blob| blob.content_type,
            .Locked => |locked| if (locked.readable.get(globalThis)) |*readable| switch (readable.ptr) {
                .Blob => |blob| blob.content_type,
                else => null,
            } else null,
            else => null,
        };

        if (content_type) |content_type_| {
            if (content_type_.len > 0) {
                try this.#headers.?.put(.ContentType, content_type_, globalThis);
            }
        }
    }

    return this.#headers.?;
}

pub fn getFetchHeadersUnlessEmpty(
    this: *Request,
) ?*FetchHeaders {
    if (this.#headers == null) {
        if (this.request_context.getRequest()) |req| {
            // we have a request context, so we can get the headers from it
            this.#headers = FetchHeaders.createFromUWS(req);
        }
    }

    const headers = this.#headers orelse return null;
    if (headers.isEmpty()) {
        return null;
    }
    return headers;
}

/// Returns the headers of the request. This will not look at the request contex to get the headers.
pub fn getFetchHeaders(
    this: *Request,
) ?*FetchHeaders {
    return this.#headers;
}

/// This should only be called by the JS code. use getFetchHeaders to get the current headers or ensureFetchHeaders to get the headers and create them if they don't exist.
pub fn getHeaders(
    this: *Request,
    globalThis: *jsc.JSGlobalObject,
) bun.JSError!jsc.JSValue {
    return (try this.ensureFetchHeaders(globalThis)).toJS(globalThis);
}

pub fn cloneHeaders(this: *Request, globalThis: *JSGlobalObject) bun.JSError!?*FetchHeaders {
    if (this.#headers == null) {
        if (this.request_context.getRequest()) |uws_req| {
            this.#headers = FetchHeaders.createFromUWS(uws_req);
        }
    }

    if (this.#headers) |head| {
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
) bun.JSError!void {
    _ = allocator;
    this.ensureURL() catch {};
    const vm = globalThis.bunVM();
    var body_ = brk: {
        if (this.#js_ref.tryGet()) |js_ref| {
            if (js.gc.stream.get(js_ref)) |stream| {
                var readable = try jsc.WebCore.ReadableStream.fromJS(stream, globalThis);
                if (readable != null) {
                    break :brk try this.#body.value.cloneWithReadableStream(globalThis, &readable.?);
                }
            }
        }

        break :brk try this.#body.value.clone(globalThis);
    };
    errdefer body_.deinit();
    const body = try vm.initRequestBodyValue(body_);
    const url = if (preserve_url) req.url else this.url.dupeRef();
    errdefer if (!preserve_url) url.deref();
    const headers = try this.cloneHeaders(globalThis);
    errdefer if (headers) |_h| _h.deref();

    req.* = Request{
        .#body = body,
        .url = url,
        .method = this.method,
        .flags = this.flags,
        .#headers = headers,
    };

    if (this.signal) |signal| {
        req.signal = signal.ref();
    }
}

pub fn clone(this: *Request, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) bun.JSError!*Request {
    const req = Request.new(undefined);
    errdefer bun.destroy(req);
    try this.cloneInto(req, allocator, globalThis, false);
    return req;
}

pub fn setTimeout(
    this: *Request,
    seconds: c_uint,
) void {
    _ = this.request_context.setTimeout(seconds);
}

const string = []const u8;

const Environment = @import("../../env.zig");
const std = @import("std");
const FetchCacheMode = @import("../../http/FetchCacheMode.zig").FetchCacheMode;
const FetchRedirect = @import("../../http/FetchRedirect.zig").FetchRedirect;
const FetchRequestMode = @import("../../http/FetchRequestMode.zig").FetchRequestMode;
const Method = @import("../../http/Method.zig").Method;

const bun = @import("bun");
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const uws = bun.uws;
const FetchHeaders = bun.webcore.FetchHeaders;
const MimeType = bun.http.MimeType;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;

const AbortSignal = jsc.WebCore.AbortSignal;
const Response = jsc.WebCore.Response;

const Blob = jsc.WebCore.Blob;
const InlineBlob = jsc.WebCore.Blob.Inline;
const InternalBlob = jsc.WebCore.Blob.Internal;

const Body = jsc.WebCore.Body;
const BodyMixin = jsc.WebCore.Body.Mixin;
