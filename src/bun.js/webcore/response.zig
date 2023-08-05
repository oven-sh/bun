const std = @import("std");
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const RequestContext = @import("../../http.zig").RequestContext;
const MimeType = @import("../../http.zig").MimeType;
const ZigURL = @import("../../url.zig").URL;
const HTTPClient = @import("root").bun.HTTP;
const FetchRedirect = HTTPClient.FetchRedirect;
const NetworkThread = HTTPClient.NetworkThread;
const AsyncIO = NetworkThread.AsyncIO;
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
const DataURL = @import("../../resolver/data_url.zig").DataURL;

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
const Request = JSC.WebCore.Request;
const Blob = JSC.WebCore.Blob;

pub const Response = struct {
    const ResponseMixin = BodyMixin(@This());
    pub usingnamespace JSC.Codegen.JSResponse;

    allocator: std.mem.Allocator,
    body: Body,
    url: bun.String = bun.String.empty,
    status_text: bun.String = bun.String.empty,
    redirected: bool = false,

    // We must report a consistent value for this
    reported_estimated_size: ?u63 = null,

    pub const getText = ResponseMixin.getText;
    pub const getBody = ResponseMixin.getBody;
    pub const getBodyUsed = ResponseMixin.getBodyUsed;
    pub const getJSON = ResponseMixin.getJSON;
    pub const getArrayBuffer = ResponseMixin.getArrayBuffer;
    pub const getBlob = ResponseMixin.getBlob;
    pub const getFormData = ResponseMixin.getFormData;

    pub fn getFormDataEncoding(this: *Response) ?*bun.FormData.AsyncFormData {
        var content_type_slice: ZigString.Slice = this.getContentType() orelse return null;
        defer content_type_slice.deinit();
        const encoding = bun.FormData.Encoding.get(content_type_slice.slice()) orelse return null;
        return bun.FormData.AsyncFormData.init(this.allocator, encoding) catch unreachable;
    }

    pub fn estimatedSize(this: *Response) callconv(.C) usize {
        return this.reported_estimated_size orelse brk: {
            this.reported_estimated_size = @as(
                u63,
                @intCast(this.body.value.estimatedSize() + this.url.byteSlice().len + this.status_text.byteSlice().len + @sizeOf(Response)),
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
        return this.body.init.headers;
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
            try writer.writeAll(comptime Output.prettyFmt("<r>headers<d>:<r> ", enable_ansi_colors));
            formatter.printAs(.Private, Writer, writer, this.getHeaders(formatter.globalThis), .DOMWrapper, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime Output.prettyFmt("<r>statusText<d>:<r> ", enable_ansi_colors));
            try writer.print(comptime Output.prettyFmt("<r>\"<b>{}<r>\"", enable_ansi_colors), .{this.status_text});
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
        return this.body.init.status_code == 304 or (this.body.init.status_code >= 200 and this.body.init.status_code <= 299);
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
        if (this.body.init.status_code < 200) {
            return ZigString.init("error").toValue(globalThis);
        }

        return ZigString.init("default").toValue(globalThis);
    }

    pub fn getStatusText(
        this: *Response,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText
        return this.status_text.toJS(globalThis);
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
        if (this.body.init.headers == null) {
            this.body.init.headers = FetchHeaders.createEmpty();

            if (this.body.value == .Blob) {
                const content_type = this.body.value.Blob.content_type;
                if (content_type.len > 0) {
                    this.body.init.headers.?.put("content-type", content_type, globalThis);
                }
            }
        }

        return this.body.init.headers.?;
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
        var cloned = this.clone(getAllocator(globalThis), globalThis);
        return Response.makeMaybePooled(globalThis, cloned);
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
            .url = this.url.clone(),
            .status_text = this.status_text.clone(),
            .redirected = this.redirected,
        };
    }

    pub fn clone(this: *Response, allocator: std.mem.Allocator, globalThis: *JSGlobalObject) *Response {
        var new_response = allocator.create(Response) catch unreachable;
        this.cloneInto(new_response, allocator, globalThis);
        return new_response;
    }

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

        this.status_text.deref();
        this.url.deref();

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
            .WTFStringImpl => |str| {
                if (bun.String.init(str).hasPrefixComptime("<!DOCTYPE html>")) {
                    return MimeType.html.value;
                }

                return default.value;
            },
            .InternalBlob => {
                // auto-detect HTML if unspecified
                if (strings.hasPrefixComptime(response.body.value.slice(), "<!DOCTYPE html>")) {
                    return MimeType.html.value;
                }

                return response.body.value.InternalBlob.contentType();
            },
            .Null, .Used, .Locked, .Empty, .Error => return default.value,
        }
    }

    pub fn getContentType(
        this: *Response,
    ) ?ZigString.Slice {
        if (this.body.init.headers) |headers| {
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
        // var response = getAllocator(globalThis).create(Response) catch unreachable;

        var response = Response{
            .body = Body{
                .init = Body.Init{
                    .status_code = 200,
                },
                .value = .{ .Empty = {} },
            },
            .allocator = getAllocator(globalThis),
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
                response.body.init.status_code = @as(u16, @intCast(@min(@max(0, init.toInt32()), std.math.maxInt(u16))));
            } else {
                if (Body.Init.init(getAllocator(globalThis), globalThis, init) catch null) |_init| {
                    response.body.init = _init;
                }
            }
        }

        var headers_ref = response.getOrCreateHeaders(globalThis);
        headers_ref.putDefault("content-type", MimeType.json.value, globalThis);
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
                .value = .{ .Empty = {} },
            },
            .allocator = getAllocator(globalThis),
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
                response.body.init.status_code = @as(u16, @intCast(@min(@max(0, init.toInt32()), std.math.maxInt(u16))));
            } else {
                if (Body.Init.init(getAllocator(globalThis), globalThis, init) catch null) |_init| {
                    response.body.init = _init;
                    response.body.init.status_code = 302;
                }
            }
        }

        response.body.init.headers = response.getOrCreateHeaders(globalThis);
        var headers_ref = response.body.init.headers.?;
        headers_ref.put("location", url_string_slice.slice(), globalThis);
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
                .value = .{ .Empty = {} },
            },
            .allocator = getAllocator(globalThis),
        };

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
        const body: Body = @as(?Body, brk: {
            switch (arguments.len) {
                0 => {
                    break :brk Body.@"200"(globalThis);
                },
                1 => {
                    break :brk Body.extract(globalThis, arguments[0]);
                },
                else => {
                    if (arguments[1].isObject()) {
                        break :brk Body.extractWithInit(globalThis, arguments[0], arguments[1]);
                    }

                    std.debug.assert(!arguments[1].isEmptyOrUndefinedOrNull());

                    const err = globalThis.createTypeErrorInstance("Expected options to be one of: null, undefined, or object", .{});
                    globalThis.throwValue(err);
                    break :brk null;
                },
            }
            unreachable;
        }) orelse return null;

        var response = getAllocator(globalThis).create(Response) catch unreachable;

        response.* = Response{
            .body = body,
            .allocator = getAllocator(globalThis),
        };

        if (response.body.value == .Blob and
            response.body.init.headers != null and
            response.body.value.Blob.content_type.len > 0 and
            !response.body.init.headers.?.fastHas(.ContentType))
        {
            response.body.init.headers.?.put("content-type", response.body.value.Blob.content_type, globalThis);
        }

        return response;
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

        http: ?*HTTPClient.AsyncHTTP = null,
        result: HTTPClient.HTTPClientResult = .{},
        javascript_vm: *VirtualMachine = undefined,
        global_this: *JSGlobalObject = undefined,
        request_body: HTTPRequestBody = undefined,
        response_buffer: MutableString = undefined,
        request_headers: Headers = Headers{ .allocator = undefined },
        promise: JSC.JSPromise.Strong,
        concurrent_task: JSC.ConcurrentTask = .{},
        poll_ref: JSC.PollRef = .{},

        /// This is url + proxy memory buffer and is owned by FetchTasklet
        /// We always clone url and proxy (if informed)
        url_proxy_buffer: []const u8 = "",

        signal: ?*JSC.WebCore.AbortSignal = null,
        aborted: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),

        // must be stored because AbortSignal stores reason weakly
        abort_reason: JSValue = JSValue.zero,
        // Custom Hostname
        hostname: ?[]u8 = null,

        pub const HTTPRequestBody = union(enum) {
            AnyBlob: AnyBlob,
            Sendfile: HTTPClient.Sendfile,

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
                            _ = JSC.Node.Syscall.close(this.Sendfile.fd);
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
            if (this.url_proxy_buffer.len > 0) {
                bun.default_allocator.free(this.url_proxy_buffer);
                this.url_proxy_buffer.len = 0;
            }

            if (this.hostname) |hostname| {
                bun.default_allocator.free(hostname);
                this.hostname = null;
            }

            this.request_headers.entries.deinit(bun.default_allocator);
            this.request_headers.buf.deinit(bun.default_allocator);
            this.request_headers = Headers{ .allocator = undefined };
            this.http.?.clearData();

            this.result.deinitMetadata();
            this.response_buffer.deinit();
            this.request_body.detach();

            if (this.abort_reason != .zero)
                this.abort_reason.unprotect();

            if (this.signal) |signal| {
                this.signal = null;
                signal.detach(this);
            }
        }

        pub fn deinit(this: *FetchTasklet) void {
            if (this.http) |http| this.javascript_vm.allocator.destroy(http);
            this.javascript_vm.allocator.destroy(this);
        }

        pub fn onDone(this: *FetchTasklet) void {
            JSC.markBinding(@src());

            const globalThis = this.global_this;

            var ref = this.promise;
            const promise_value = ref.value();
            defer ref.strong.deinit();

            var poll_ref = this.poll_ref;
            var vm = globalThis.bunVM();
            defer poll_ref.unref(vm);

            if (promise_value.isEmptyOrUndefinedOrNull()) {
                this.clearData();
                return;
            }

            const promise = promise_value.asAnyPromise().?;

            const success = this.result.isSuccess();
            const result = switch (success) {
                true => this.onResolve(),
                false => this.onReject(),
            };
            result.ensureStillAlive();
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
            if (this.signal) |signal| {
                this.signal = null;
                signal.detach(this);
            }

            if (!this.abort_reason.isEmptyOrUndefinedOrNull()) {
                return this.abort_reason;
            }

            if (this.result.isTimeout()) {
                // Timeout without reason
                return JSC.WebCore.AbortSignal.createTimeoutError(JSC.ZigString.static("The operation timed out"), &JSC.ZigString.Empty, this.global_this);
            }

            if (this.result.isAbort()) {
                // Abort without reason
                return JSC.WebCore.AbortSignal.createAbortError(JSC.ZigString.static("The user aborted a request"), &JSC.ZigString.Empty, this.global_this);
            }

            const fetch_error = JSC.SystemError{
                .code = bun.String.static(@errorName(this.result.fail)),
                .message = switch (this.result.fail) {
                    error.ConnectionClosed => bun.String.static("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"),
                    error.FailedToOpenSocket => bun.String.static("Was there a typo in the url or port?"),
                    error.TooManyRedirects => bun.String.static("The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()"),
                    error.ConnectionRefused => bun.String.static("Unable to connect. Is the computer able to access the url?"),
                    else => bun.String.static("fetch() failed. For more information, pass `verbose: true` in the second argument to fetch()"),
                },
                .path = bun.String.create(this.http.?.url.href),
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

            const response = Body.Value{
                .InternalBlob = .{
                    .bytes = response_buffer.toManaged(bun.default_allocator),
                },
            };

            return response;
        }

        fn toResponse(this: *FetchTasklet, allocator: std.mem.Allocator) Response {
            const http_response = this.result.response;
            return Response{
                .allocator = allocator,
                .url = bun.String.createAtomIfPossible(this.result.href),
                .status_text = bun.String.createAtomIfPossible(http_response.status),
                .redirected = this.result.redirected,
                .body = .{
                    .init = .{
                        .headers = FetchHeaders.createFromPicoHeaders(http_response.headers),
                        .status_code = @as(u16, @truncate(http_response.status_code)),
                    },
                    .value = this.toBodyValue(),
                },
            };
        }

        pub fn onResolve(this: *FetchTasklet) JSValue {
            const allocator = bun.default_allocator;
            var response = allocator.create(Response) catch unreachable;
            response.* = this.toResponse(allocator);
            return Response.makeMaybePooled(@as(js.JSContextRef, @ptrCast(this.global_this)), response);
        }

        pub fn get(
            allocator: std.mem.Allocator,
            globalThis: *JSC.JSGlobalObject,
            promise: JSC.JSPromise.Strong,
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
                .promise = promise,
                .url_proxy_buffer = fetch_options.url_proxy_buffer,
                .signal = fetch_options.signal,
                .hostname = fetch_options.hostname,
            };

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
                proxy,
                if (fetch_tasklet.signal != null) &fetch_tasklet.aborted else null,
                fetch_options.hostname,
                fetch_options.redirect_type,
            );

            if (fetch_options.redirect_type != FetchRedirect.follow) {
                fetch_tasklet.http.?.client.remaining_redirect_count = 0;
            }

            fetch_tasklet.http.?.client.disable_timeout = fetch_options.disable_timeout;
            fetch_tasklet.http.?.client.verbose = fetch_options.verbose;
            fetch_tasklet.http.?.client.disable_keepalive = fetch_options.disable_keepalive;

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
            this.aborted.store(true, .Monotonic);

            if (this.http != null) {
                HTTPClient.http_thread.scheduleShutdown(this.http.?);
            }
        }

        const FetchOptions = struct {
            method: Method,
            headers: Headers,
            body: HTTPRequestBody,
            timeout: usize,
            disable_timeout: bool,
            disable_keepalive: bool,
            url: ZigURL,
            verbose: bool = false,
            redirect_type: FetchRedirect = FetchRedirect.follow,
            proxy: ?ZigURL = null,
            url_proxy_buffer: []const u8 = "",
            signal: ?*JSC.WebCore.AbortSignal = null,
            globalThis: ?*JSGlobalObject,
            // Custom Hostname
            hostname: ?[]u8 = null,
        };

        pub fn queue(
            allocator: std.mem.Allocator,
            global: *JSGlobalObject,
            fetch_options: FetchOptions,
            promise: JSC.JSPromise.Strong,
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

        const mime_type = data_url.decodeMimeType();
        blob.content_type = mime_type.value;

        var response = allocator.create(Response) catch @panic("out of memory");

        response.* = Response{
            .body = Body{
                .init = Body.Init{
                    .status_code = 200,
                },
                .value = .{
                    .Blob = blob,
                },
            },
            .allocator = allocator,
            .status_text = bun.String.fromBytes("OK"),
            .url = bun.String.fromBytes(data_url.url),
        };

        return JSPromise.resolvedPromiseValue(globalThis, response.toJS(globalThis));
    }

    pub export fn Bun__fetch(
        ctx: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        JSC.markBinding(@src());

        var exception_val = [_]JSC.C.JSValueRef{null};
        var exception: JSC.C.ExceptionRef = &exception_val;
        defer {
            if (exception.* != null) {
                ctx.throwValue(JSC.JSValue.c(exception.*));
            }
        }

        const globalThis = ctx.ptr();
        const arguments = callframe.arguments(2);

        if (arguments.len == 0) {
            const err = JSC.toTypeError(.ERR_MISSING_ARGS, fetch_error_no_args, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        var headers: ?Headers = null;
        var method = Method.GET;
        var script_ctx = globalThis.bunVM();

        var args = JSC.Node.ArgumentsSlice.init(script_ctx, arguments.ptr[0..arguments.len]);

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
        var verbose = script_ctx.log.level.atLeast(.debug);
        var proxy: ?ZigURL = null;
        var redirect_type: FetchRedirect = FetchRedirect.follow;
        var signal: ?*JSC.WebCore.AbortSignal = null;
        // Custom Hostname
        var hostname: ?[]u8 = null;

        var url_proxy_buffer: []const u8 = undefined;
        var is_file_url = false;

        // TODO: move this into a DRYer implementation
        // The status quo is very repetitive and very bug prone
        if (first_arg.as(Request)) |request| {
            request.ensureURL() catch unreachable;

            if (request.url.isEmpty()) {
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_blank_url, .{}, ctx);
                // clean hostname if any
                if (hostname) |host| {
                    bun.default_allocator.free(host);
                }
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }

            if (DataURL.parse(request.url.byteSlice()) catch {
                const err = JSC.createError(globalThis, "failed to fetch the data URL", .{});
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }) |data_url| {
                return dataURLResponse(data_url, globalThis, bun.default_allocator);
            }

            url = ZigURL.fromString(bun.default_allocator, request.url) catch {
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() URL is invalid", .{}, ctx);
                // clean hostname if any
                if (hostname) |host| {
                    bun.default_allocator.free(host);
                }

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
                            var slice_ = method_.toSlice(ctx.ptr(), getAllocator(ctx));
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
                                    bun.default_allocator.free(host);
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
                                    hostname = _hostname.toOwnedSliceZ(bun.default_allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, bun.default_allocator, .{ .body = &body }) catch unreachable;
                                // TODO: make this one pass
                            } else if (FetchHeaders.createFromJS(ctx.ptr(), headers_)) |headers__| {
                                if (headers__.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    hostname = _hostname.toOwnedSliceZ(bun.default_allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, bun.default_allocator, .{ .body = &body }) catch unreachable;
                                headers__.deref();
                            } else if (request.headers) |head| {
                                if (head.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    hostname = _hostname.toOwnedSliceZ(bun.default_allocator) catch unreachable;
                                }
                                headers = Headers.from(head, bun.default_allocator, .{ .body = &body }) catch unreachable;
                            }
                        } else if (request.headers) |head| {
                            headers = Headers.from(head, bun.default_allocator, .{ .body = &body }) catch unreachable;
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

                        if (options.get(globalThis, "proxy")) |proxy_arg| {
                            if (proxy_arg.isString() and proxy_arg.getLength(ctx) > 0) {
                                var href = JSC.URL.hrefFromJS(proxy_arg, globalThis);
                                if (href.tag == .Dead) {
                                    const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{}, ctx);
                                    // clean hostname if any
                                    if (hostname) |host| {
                                        bun.default_allocator.free(host);
                                    }
                                    bun.default_allocator.free(url_proxy_buffer);

                                    return JSPromise.rejectedPromiseValue(globalThis, err);
                                }
                                defer href.deref();
                                var buffer = std.fmt.allocPrint(bun.default_allocator, "{s}{}", .{ url_proxy_buffer, href }) catch {
                                    globalThis.throwOutOfMemory();
                                    return .zero;
                                };
                                url = ZigURL.parse(buffer[0..url.href.len]);
                                is_file_url = url.isFile();

                                proxy = ZigURL.parse(buffer[url.href.len..]);
                                bun.default_allocator.free(url_proxy_buffer);
                                url_proxy_buffer = buffer;
                            }
                        }
                    }
                } else {
                    method = request.method;
                    body = request.body.value.useAsAnyBlob();
                    if (request.headers) |head| {
                        if (head.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                            hostname = _hostname.toOwnedSliceZ(bun.default_allocator) catch unreachable;
                        }
                        headers = Headers.from(head, bun.default_allocator, .{ .body = &body }) catch unreachable;
                    }
                    if (request.signal) |signal_| {
                        _ = signal_.ref();
                        signal = signal_;
                    }
                }
            }
        } else if (bun.String.tryFromJS(first_arg, globalThis)) |str| {
            if (str.isEmpty()) {
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_blank_url, .{}, ctx);
                // clean hostname if any
                if (hostname) |host| {
                    bun.default_allocator.free(host);
                }
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }

            if (DataURL.parse(str.byteSlice()) catch {
                const err = JSC.createError(globalThis, "failed to fetch the data URL", .{});
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }) |data_url| {
                return dataURLResponse(data_url, globalThis, bun.default_allocator);
            }

            url = ZigURL.fromString(bun.default_allocator, str) catch {
                // clean hostname if any
                if (hostname) |host| {
                    bun.default_allocator.free(host);
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
                            var slice_ = method_.toSlice(ctx.ptr(), getAllocator(ctx));
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
                                    bun.default_allocator.free(host);
                                }
                                // an error was thrown
                                return JSC.JSValue.jsUndefined();
                            }
                        }

                        if (options.fastGet(ctx.ptr(), .headers)) |headers_| {
                            if (headers_.as(FetchHeaders)) |headers__| {
                                if (headers__.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    hostname = _hostname.toOwnedSliceZ(bun.default_allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, bun.default_allocator, .{ .body = &body }) catch unreachable;
                                // TODO: make this one pass
                            } else if (FetchHeaders.createFromJS(ctx.ptr(), headers_)) |headers__| {
                                defer headers__.deref();
                                if (headers__.fastGet(JSC.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                                    hostname = _hostname.toOwnedSliceZ(bun.default_allocator) catch unreachable;
                                }
                                headers = Headers.from(headers__, bun.default_allocator, .{ .body = &body }) catch unreachable;
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

                        if (options.getTruthy(globalThis, "proxy")) |proxy_arg| {
                            if (proxy_arg.isString() and proxy_arg.getLength(globalThis) > 0) {
                                var href = JSC.URL.hrefFromJS(proxy_arg, globalThis);
                                if (href.tag == .Dead) {
                                    const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{}, ctx);
                                    // clean hostname if any
                                    if (hostname) |host| {
                                        bun.default_allocator.free(host);
                                    }
                                    bun.default_allocator.free(url_proxy_buffer);

                                    return JSPromise.rejectedPromiseValue(globalThis, err);
                                }
                                defer href.deref();
                                var buffer = std.fmt.allocPrint(bun.default_allocator, "{s}{}", .{ url_proxy_buffer, href }) catch {
                                    globalThis.throwOutOfMemory();
                                    return .zero;
                                };
                                url = ZigURL.parse(buffer[0..url.href.len]);
                                proxy = ZigURL.parse(buffer[url.href.len..]);
                                bun.default_allocator.free(url_proxy_buffer);
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
            const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_blank_url, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        // This is not 100% correct.
        // We don't pass along headers, we ignore method, we ignore status code...
        // But it's better than status quo.
        if (is_file_url) {
            defer bun.default_allocator.free(url_proxy_buffer);
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

            const bun_file = Blob.findOrCreateFileFromPath(
                .{
                    .path = .{
                        .string = bun.PathString.init(
                            temp_file_path,
                        ),
                    },
                },
                globalThis,
            );

            var response = bun.default_allocator.create(Response) catch @panic("out of memory");

            response.* = Response{
                .body = Body{
                    .init = Body.Init{
                        .status_code = 200,
                    },
                    .value = .{ .Blob = bun_file },
                },
                .allocator = bun.default_allocator,
                .url = file_url_string.clone(),
            };

            return JSPromise.resolvedPromiseValue(globalThis, response.toJS(globalThis));
        }

        if (url.protocol.len > 0) {
            if (!(url.isHTTP() or url.isHTTPS())) {
                defer bun.default_allocator.free(url_proxy_buffer);
                const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, "protocol must be http: or https:", .{}, ctx);
                return JSPromise.rejectedPromiseValue(globalThis, err);
            }
        }

        if (!method.hasRequestBody() and body.size() > 0) {
            defer bun.default_allocator.free(url_proxy_buffer);
            const err = JSC.toTypeError(.ERR_INVALID_ARG_VALUE, fetch_error_unexpected_body, .{}, ctx);
            return JSPromise.rejectedPromiseValue(globalThis, err);
        }

        if (headers == null and body.size() > 0 and body.hasContentTypeFromUser()) {
            headers = Headers.from(
                null,
                bun.default_allocator,
                .{ .body = &body },
            ) catch unreachable;
        }

        var http_body = FetchTasklet.HTTPRequestBody{
            .AnyBlob = body,
        };

        if (body.needsToReadFile()) {
            prepare_body: {
                const opened_fd_res: JSC.Node.Maybe(bun.FileDescriptor) = switch (body.Blob.store.?.data.file.pathlike) {
                    .fd => |fd| JSC.Node.Maybe(bun.FileDescriptor).errnoSysFd(JSC.Node.Syscall.system.dup(fd), .open, fd) orelse .{ .result = fd },
                    .path => |path| JSC.Node.Syscall.open(path.sliceZ(&globalThis.bunVM().nodeFS().sync_error_buf), std.os.O.RDONLY | std.os.O.NOCTTY, 0),
                };

                const opened_fd = switch (opened_fd_res) {
                    .err => |err| {
                        bun.default_allocator.free(url_proxy_buffer);

                        const rejected_value = JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                        body.detach();
                        if (headers) |*headers_| {
                            headers_.buf.deinit(bun.default_allocator);
                            headers_.entries.deinit(bun.default_allocator);
                        }

                        return rejected_value;
                    },
                    .result => |fd| fd,
                };

                if (proxy == null and bun.HTTP.Sendfile.isEligible(url)) {
                    use_sendfile: {
                        const stat: std.os.Stat = switch (JSC.Node.Syscall.fstat(opened_fd)) {
                            .result => |result| result,
                            // bail out for any reason
                            .err => break :use_sendfile,
                        };

                        if (Environment.isMac) {
                            // macOS only supports regular files for sendfile()
                            if (!std.os.S.ISREG(stat.mode)) {
                                break :use_sendfile;
                            }
                        }

                        // if it's < 32 KB, it's not worth it
                        if (stat.size < 32 * 1024) {
                            break :use_sendfile;
                        }

                        const original_size = body.Blob.size;
                        const stat_size = @as(Blob.SizeType, @intCast(stat.size));
                        const blob_size = if (std.os.S.ISREG(stat.mode))
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

                        if (std.os.S.ISREG(stat.mode)) {
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
                    _ = JSC.Node.Syscall.close(opened_fd);
                }

                switch (res) {
                    .err => |err| {
                        bun.default_allocator.free(url_proxy_buffer);

                        const rejected_value = JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
                        body.detach();
                        if (headers) |*headers_| {
                            headers_.buf.deinit(bun.default_allocator);
                            headers_.entries.deinit(bun.default_allocator);
                        }

                        return rejected_value;
                    },
                    .result => |result| {
                        body.detach();
                        body.from(std.ArrayList(u8).fromOwnedSlice(bun.default_allocator, @constCast(result.slice())));
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
            default_allocator,
            globalThis,
            .{
                .method = method,
                .url = url,
                .headers = headers orelse Headers{
                    .allocator = bun.default_allocator,
                },
                .body = http_body,
                .timeout = std.time.ns_per_hour,
                .disable_keepalive = disable_keepalive,
                .disable_timeout = disable_timeout,
                .redirect_type = redirect_type,
                .verbose = verbose,
                .proxy = proxy,
                .url_proxy_buffer = url_proxy_buffer,
                .signal = signal,
                .globalThis = globalThis,
                .hostname = hostname,
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

// https://github.com/WebKit/WebKit/blob/main/Source/WebCore/workers/service/FetchEvent.h
pub const FetchEvent = struct {
    started_waiting_at: u64 = 0,
    response: ?*Response = null,
    request_context: ?*RequestContext = null,
    request: Request,
    pending_promise: JSValue = JSValue.zero,

    onPromiseRejectionCtx: *anyopaque = undefined,
    onPromiseRejectionHandler: ?*const fn (ctx: *anyopaque, err: anyerror, fetch_event: *FetchEvent, value: JSValue) void = null,
    rejected: bool = false,

    pub const Class = NewClass(
        FetchEvent,
        .{
            .name = "FetchEvent",
            .read_only = true,
            .ts = .{ .class = d.ts.class{ .interface = true } },
        },
        .{
            .respondWith = .{
                .rfn = respondWith,
                .ts = d.ts{
                    .tsdoc = "Render the response in the active HTTP request",
                    .@"return" = "void",
                    .args = &[_]d.ts.arg{
                        .{ .name = "response", .@"return" = "Response" },
                    },
                },
            },
            .waitUntil = waitUntil,
            .finalize = finalize,
        },
        .{
            .client = .{
                .get = getClient,
                .ro = true,
                .ts = d.ts{
                    .tsdoc = "HTTP client metadata. This is not implemented yet, do not use.",
                    .@"return" = "undefined",
                },
            },
            .request = .{
                .get = getRequest,
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
        VirtualMachine.get().allocator.destroy(this);
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
            switch (JSValue.fromRef(arg).jsTypeLoose()) {
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

        if (this.pending_promise.asAnyPromise()) |promise| {
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
            if (!VirtualMachine.get().had_errors) {
                Output.printElapsed(@as(f64, @floatFromInt((request_context.timer.lap()))) / std.time.ns_per_ms);

                Output.prettyError(
                    " <b>{s}<r><d> - <b>{d}<r> <d>transpiled, <d><b>{d}<r> <d>imports<r>\n",
                    .{
                        request_context.matched_route.?.name,
                        VirtualMachine.get().transpiled_count,
                        VirtualMachine.get().resolved_count,
                    },
                );
            }
        }

        defer this.pending_promise = JSValue.zero;
        var needs_mime_type = true;
        var content_length: ?usize = null;

        if (response.body.init.headers) |headers_ref| {
            var headers = Headers.from(headers_ref, request_context.allocator, .{}) catch unreachable;

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
