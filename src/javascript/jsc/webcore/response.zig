const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const bun = @import("../../../global.zig");
const RequestContext = @import("../../../http.zig").RequestContext;
const MimeType = @import("../../../http.zig").MimeType;
const ZigURL = @import("../../../query_string_map.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;

const JSC = @import("../../../jsc.zig");
const js = JSC.C;

const Method = @import("../../../http/method.zig").Method;

const ObjectPool = @import("../../../pool.zig").ObjectPool;

const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const strings = @import("../../../global.zig").strings;
const string = @import("../../../global.zig").string;
const default_allocator = @import("../../../global.zig").default_allocator;
const FeatureFlags = @import("../../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../../env.zig");
const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = @import("../javascript.zig").Task;
const JSPrinter = @import("../../../js_printer.zig");
const picohttp = @import("picohttp");

pub const Response = struct {
    pub const Class = NewClass(
        Response,
        .{ .name = "Response" },
        .{
            .@"constructor" = constructor,
            .@"text" = .{
                .rfn = getText,
                .ts = d.ts{},
            },
            .@"json" = .{
                .rfn = getJson,
                .ts = d.ts{},
            },
            .@"arrayBuffer" = .{
                .rfn = getArrayBuffer,
                .ts = d.ts{},
            },

            .@"clone" = .{
                .rfn = doClone,
                .ts = d.ts{},
            },
        },
        .{
            .@"url" = .{
                .@"get" = getURL,
                .ro = true,
            },

            .@"ok" = .{
                .@"get" = getOK,
                .ro = true,
            },
            .@"status" = .{
                .@"get" = getStatus,
                .ro = true,
            },
            .@"statusText" = .{
                .@"get" = getStatusText,
                .ro = true,
            },
            .@"headers" = .{
                .@"get" = getHeaders,
                .ro = true,
            },
        },
    );

    allocator: std.mem.Allocator,
    body: Body,
    url: string = "",
    status_text: string = "",
    redirected: bool = false,

    pub const Props = struct {};

    pub fn writeFormat(this: *const Response, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);
        try formatter.writeIndent(Writer, writer);
        try writer.print("Response ({}) {{\n", .{bun.fmt.size(this.body.len)});
        {
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("ok: ");
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.isOK()), .BooleanObject, enable_ansi_colors);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try this.body.writeFormat(formatter, writer, enable_ansi_colors);

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
            try JSPrinter.writeJSONString(this.status_text, Writer, writer, false);
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("redirected: ");
            formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.redirected), .BooleanObject, enable_ansi_colors);
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
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return ZigString.init(this.url).withEncoding().toValueGC(ctx.ptr()).asObjectRef();
    }

    pub fn getStatusText(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        return ZigString.init(this.status_text).withEncoding().toValueGC(ctx.ptr()).asObjectRef();
    }

    pub fn getOK(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        return js.JSValueMakeBoolean(ctx, this.isOK());
    }

    pub fn getHeaders(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        if (this.body.init.headers == null) {
            this.body.init.headers = Headers.empty(this.allocator);
        }

        return Headers.Class.make(ctx, &this.body.init.headers.?);
    }

    pub fn doClone(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var cloned = this.clone(getAllocator(ctx));
        return Response.Class.make(ctx, cloned);
    }

    pub fn cloneInto(this: *const Response, new_response: *Response, allocator: std.mem.Allocator) void {
        new_response.* = Response{
            .allocator = allocator,
            .body = this.body.clone(allocator),
            .url = allocator.dupe(u8, this.url) catch unreachable,
            .status_text = allocator.dupe(u8, this.status_text) catch unreachable,
            .redirected = this.redirected,
        };
    }

    pub fn clone(this: *const Response, allocator: std.mem.Allocator) *Response {
        var new_response = allocator.create(Response) catch unreachable;
        this.cloneInto(new_response, allocator);
        return new_response;
    }

    pub fn getText(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {

        // https://developer.mozilla.org/en-US/docs/Web/API/Response/text
        defer this.body.value = .Empty;
        return JSPromise.resolvedPromiseValue(
            ctx.ptr(),
            (brk: {
                switch (this.body.value) {
                    .Unconsumed => {
                        if (this.body.len > 0) {
                            if (this.body.ptr) |_ptr| {
                                var zig_string = ZigString.init(_ptr[0..this.body.len]);
                                zig_string.detectEncoding();
                                if (zig_string.is16Bit()) {
                                    var value = zig_string.to16BitValue(ctx.ptr());
                                    this.body.ptr_allocator.?.free(_ptr[0..this.body.len]);
                                    this.body.ptr_allocator = null;
                                    this.body.ptr = null;
                                    break :brk value;
                                }

                                break :brk zig_string.toValue(ctx.ptr());
                            }
                        }

                        break :brk ZigString.init("").toValue(ctx.ptr());
                    },
                    .Empty => {
                        break :brk ZigString.init("").toValue(ctx.ptr());
                    },
                    .String => |str| {
                        var zig_string = ZigString.init(str);

                        zig_string.detectEncoding();
                        if (zig_string.is16Bit()) {
                            var value = zig_string.to16BitValue(ctx.ptr());
                            if (this.body.ptr_allocator) |allocator| this.body.deinit(allocator);
                            break :brk value;
                        }

                        break :brk zig_string.toValue(ctx.ptr());
                    },
                    .ArrayBuffer => |buffer| {
                        break :brk ZigString.init(buffer.ptr[buffer.offset..buffer.byte_len]).toValue(ctx.ptr());
                    },
                    else => unreachable,
                }
            }),
        ).asRef();
    }

    var temp_error_buffer: [4096]u8 = undefined;
    var error_arg_list: [1]js.JSObjectRef = undefined;
    pub fn getJson(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var zig_string = ZigString.init("");
        var deallocate = false;
        defer {
            if (deallocate) {
                if (this.body.value == .Unconsumed) {
                    this.body.ptr_allocator.?.free(this.body.ptr.?[0..this.body.len]);
                    this.body.ptr_allocator = null;
                    this.body.ptr = null;
                    this.body.len = 0;
                }
            }

            this.body.value = .Empty;
        }

        var json_value = (js.JSValueMakeFromJSONString(
            ctx,
            brk: {
                switch (this.body.value) {
                    .Unconsumed => {
                        if (this.body.ptr) |_ptr| {
                            zig_string = ZigString.init(_ptr[0..this.body.len]);
                            deallocate = true;

                            break :brk zig_string.toJSStringRef();
                        }

                        break :brk zig_string.toJSStringRef();
                    },
                    .Empty => {
                        break :brk zig_string.toJSStringRef();
                    },
                    .String => |str| {
                        zig_string = ZigString.init(str);
                        break :brk zig_string.toJSStringRef();
                    },
                    .ArrayBuffer => |buffer| {
                        zig_string = ZigString.init(buffer.ptr[buffer.offset..buffer.byte_len]);
                        break :brk zig_string.toJSStringRef();
                    },
                    else => unreachable,
                }
            },
        ) orelse {
            var out = std.fmt.bufPrint(&temp_error_buffer, "Invalid JSON\n\n \"{s}\"", .{zig_string.slice()[0..std.math.min(zig_string.len, 4000)]}) catch unreachable;
            error_arg_list[0] = ZigString.init(out).toValueGC(ctx.ptr()).asRef();
            return JSPromise.rejectedPromiseValue(
                ctx.ptr(),
                JSValue.fromRef(
                    js.JSObjectMakeError(
                        ctx,
                        1,
                        &error_arg_list,
                        exception,
                    ),
                ),
            ).asRef();
        });

        return JSPromise.resolvedPromiseValue(
            ctx.ptr(),
            JSValue.fromRef(json_value),
        ).asRef();
    }
    pub fn getArrayBuffer(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        defer this.body.value = .Empty;
        return JSPromise.resolvedPromiseValue(
            ctx.ptr(),
            JSValue.fromRef(
                (brk: {
                    switch (this.body.value) {
                        .Unconsumed => {
                            if (this.body.ptr) |_ptr| {
                                break :brk JSC.MarkedArrayBuffer.fromBytes(_ptr[0..this.body.len], default_allocator, .ArrayBuffer).toJSObjectRef(ctx, exception);
                            }
                            break :brk js.JSObjectMakeTypedArray(
                                ctx,
                                js.JSTypedArrayType.kJSTypedArrayTypeArrayBuffer,
                                0,
                                exception,
                            );
                        },
                        .Empty => {
                            break :brk js.JSObjectMakeTypedArray(ctx, js.JSTypedArrayType.kJSTypedArrayTypeArrayBuffer, 0, exception);
                        },
                        .String => |str| {
                            break :brk js.JSObjectMakeTypedArrayWithBytesNoCopy(
                                ctx,
                                js.JSTypedArrayType.kJSTypedArrayTypeArrayBuffer,
                                @intToPtr([*]u8, @ptrToInt(str.ptr)),
                                str.len,
                                null,
                                null,
                                exception,
                            );
                        },
                        .ArrayBuffer => |buffer| {
                            break :brk js.JSObjectMakeTypedArrayWithBytesNoCopy(
                                ctx,
                                js.JSTypedArrayType.kJSTypedArrayTypeArrayBuffer,
                                buffer.ptr,
                                buffer.byte_len,
                                null,
                                null,
                                exception,
                            );
                        },
                        else => unreachable,
                    }
                }),
            ),
        ).asRef();
    }

    pub fn getStatus(
        this: *Response,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        return js.JSValueMakeNumber(ctx, @intToFloat(f64, this.body.init.status_code));
    }

    pub fn finalize(
        this: *Response,
    ) void {
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

    pub fn mimeType(response: *const Response, request_ctx: *const RequestContext) string {
        if (response.body.init.headers) |headers| {
            // Remember, we always lowercase it
            // hopefully doesn't matter here tho
            if (headers.getHeaderIndex("content-type")) |content_type| {
                return headers.asStr(headers.entries.items(.value)[content_type]);
            }
        }

        if (request_ctx.url.extname.len > 0) {
            return MimeType.byExtension(request_ctx.url.extname).value;
        }

        switch (response.body.value) {
            .Empty => {
                return "text/plain";
            },
            .String => |body| {
                // poor man's mimetype sniffing
                if (body.len > 0 and (body[0] == '{' or body[0] == '[')) {
                    return MimeType.json.value;
                }

                return MimeType.html.value;
            },
            else => {
                return "application/octet-stream";
            },
        }
    }

    pub fn constructor(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        const body: Body = brk: {
            switch (arguments.len) {
                0 => {
                    break :brk Body.@"200"(ctx);
                },
                1 => {
                    break :brk Body.extract(ctx, arguments[0], exception);
                },
                else => {
                    if (js.JSValueGetType(ctx, arguments[1]) == js.JSType.kJSTypeObject) {
                        break :brk Body.extractWithInit(ctx, arguments[0], arguments[1], exception);
                    } else {
                        break :brk Body.extract(ctx, arguments[0], exception);
                    }
                },
            }
            unreachable;
        };

        // if (exception != null) {
        //     return null;
        // }

        var response = getAllocator(ctx).create(Response) catch unreachable;
        response.* = Response{
            .body = body,
            .allocator = getAllocator(ctx),
            .url = "",
        };
        return Response.Class.make(
            ctx,
            response,
        );
    }
};

pub const Fetch = struct {
    const headers_string = "headers";
    const method_string = "method";

    var fetch_body_string: MutableString = undefined;
    var fetch_body_string_loaded = false;

    const JSType = js.JSType;

    const fetch_error_no_args = "fetch() expects a string but received no arguments.";
    const fetch_error_blank_url = "fetch() URL must not be a blank string.";
    const JSTypeErrorEnum = std.enums.EnumArray(JSType, string);
    const fetch_type_error_names: JSTypeErrorEnum = brk: {
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

    const fetch_type_error_string_values = .{
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeUndefined)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNull)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeBoolean)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNumber)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeString)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeObject)}),
        std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeSymbol)}),
    };

    const fetch_type_error_strings: JSTypeErrorEnum = brk: {
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

    const fetch_error_cant_fetch_same_origin = "fetch to same-origin on the server is not supported yet - sorry! (it would just hang forever)";

    pub const FetchTasklet = struct {
        promise: *JSInternalPromise = undefined,
        http: HTTPClient.AsyncHTTP = undefined,
        status: Status = Status.pending,
        javascript_vm: *VirtualMachine = undefined,
        global_this: *JSGlobalObject = undefined,

        empty_request_body: MutableString = undefined,
        pooled_body: *BodyPool.Node = undefined,
        this_object: js.JSObjectRef = null,
        resolve: js.JSObjectRef = null,
        reject: js.JSObjectRef = null,
        context: FetchTaskletContext = undefined,

        const Pool = ObjectPool(FetchTasklet, init, true, 32);
        const BodyPool = ObjectPool(MutableString, MutableString.init2048, true, 8);
        pub const FetchTaskletContext = struct {
            tasklet: *FetchTasklet,
        };

        pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet {
            return FetchTasklet{};
        }

        pub const Status = enum(u8) {
            pending,
            running,
            done,
        };

        pub fn onDone(this: *FetchTasklet) void {
            var args = [1]js.JSValueRef{undefined};

            var callback_object = switch (this.http.state.load(.Monotonic)) {
                .success => this.resolve,
                .fail => this.reject,
                else => unreachable,
            };

            args[0] = switch (this.http.state.load(.Monotonic)) {
                .success => this.onResolve().asObjectRef(),
                .fail => this.onReject().asObjectRef(),
                else => unreachable,
            };

            _ = js.JSObjectCallAsFunction(this.global_this.ref(), callback_object, null, 1, &args, null);

            this.release();
        }

        pub fn reset(_: *FetchTasklet) void {}

        pub fn release(this: *FetchTasklet) void {
            js.JSValueUnprotect(this.global_this.ref(), this.resolve);
            js.JSValueUnprotect(this.global_this.ref(), this.reject);
            js.JSValueUnprotect(this.global_this.ref(), this.this_object);

            this.global_this = undefined;
            this.javascript_vm = undefined;
            this.promise = undefined;
            this.status = Status.pending;
            var pooled = this.pooled_body;
            BodyPool.release(pooled);
            this.pooled_body = undefined;
            this.http = undefined;
            this.this_object = null;
            this.resolve = null;
            this.reject = null;
            Pool.release(@fieldParentPtr(Pool.Node, "data", this));
        }

        pub const FetchResolver = struct {
            pub fn call(
                _: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                _: usize,
                arguments: [*c]const js.JSValueRef,
                _: js.ExceptionRef,
            ) callconv(.C) js.JSObjectRef {
                return JSPrivateDataPtr.from(js.JSObjectGetPrivate(arguments[0]))
                    .get(FetchTaskletContext).?.tasklet.onResolve().asObjectRef();
                //  return  js.JSObjectGetPrivate(arguments[0]).? .tasklet.onResolve().asObjectRef();
            }
        };

        pub const FetchRejecter = struct {
            pub fn call(
                _: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                _: usize,
                arguments: [*c]const js.JSValueRef,
                _: js.ExceptionRef,
            ) callconv(.C) js.JSObjectRef {
                return JSPrivateDataPtr.from(js.JSObjectGetPrivate(arguments[0]))
                    .get(FetchTaskletContext).?.tasklet.onReject().asObjectRef();
            }
        };

        pub fn onReject(this: *FetchTasklet) JSValue {
            const fetch_error = std.fmt.allocPrint(
                default_allocator,
                "fetch() failed – {s}\nurl: \"{s}\"",
                .{
                    @errorName(this.http.err orelse error.HTTPFail),
                    this.http.url.href,
                },
            ) catch unreachable;
            return ZigString.init(fetch_error).toErrorInstance(this.global_this);
        }

        pub fn onResolve(this: *FetchTasklet) JSValue {
            var allocator = default_allocator;
            var http_response = this.http.response.?;
            var response_headers = Headers.fromPicoHeaders(allocator, http_response.headers) catch unreachable;
            response_headers.guard = .immutable;
            var response = allocator.create(Response) catch unreachable;
            var duped = allocator.dupe(u8, this.http.response_buffer.toOwnedSlice()) catch unreachable;

            response.* = Response{
                .allocator = allocator,
                .url = allocator.dupe(u8, this.http.url.href) catch unreachable,
                .status_text = allocator.dupe(u8, http_response.status) catch unreachable,
                .redirected = this.http.redirect_count > 0,
                .body = .{
                    .init = .{
                        .headers = response_headers,
                        .status_code = @truncate(u16, http_response.status_code),
                    },
                    .value = .{
                        .Unconsumed = 0,
                    },
                    .ptr = duped.ptr,
                    .len = duped.len,
                    .ptr_allocator = allocator,
                },
            };
            return JSValue.fromRef(Response.Class.make(@ptrCast(js.JSContextRef, this.global_this), response));
        }

        pub fn get(
            allocator: std.mem.Allocator,
            method: Method,
            url: ZigURL,
            headers: Headers.Entries,
            headers_buf: string,
            request_body: ?*MutableString,
            timeout: usize,
        ) !*FetchTasklet.Pool.Node {
            var linked_list = FetchTasklet.Pool.get(allocator);
            linked_list.data.javascript_vm = VirtualMachine.vm;
            linked_list.data.empty_request_body = MutableString.init(allocator, 0) catch unreachable;
            linked_list.data.pooled_body = BodyPool.get(allocator);
            linked_list.data.http = try HTTPClient.AsyncHTTP.init(
                allocator,
                method,
                url,
                headers,
                headers_buf,
                &linked_list.data.pooled_body.data,
                request_body orelse &linked_list.data.empty_request_body,

                timeout,
            );
            linked_list.data.context = .{ .tasklet = &linked_list.data };

            return linked_list;
        }

        pub fn queue(
            allocator: std.mem.Allocator,
            global: *JSGlobalObject,
            method: Method,
            url: ZigURL,
            headers: Headers.Entries,
            headers_buf: string,
            request_body: ?*MutableString,
            timeout: usize,
        ) !*FetchTasklet.Pool.Node {
            var node = try get(allocator, method, url, headers, headers_buf, request_body, timeout);
            node.data.promise = JSInternalPromise.create(global);

            node.data.global_this = global;
            node.data.http.callback = callback;
            var batch = NetworkThread.Batch{};
            node.data.http.schedule(allocator, &batch);
            NetworkThread.global.pool.schedule(batch);
            VirtualMachine.vm.active_tasks +|= 1;
            return node;
        }

        pub fn callback(http_: *HTTPClient.AsyncHTTP) void {
            var task: *FetchTasklet = @fieldParentPtr(FetchTasklet, "http", http_);
            @atomicStore(Status, &task.status, Status.done, .Monotonic);
            task.javascript_vm.eventLoop().enqueueTaskConcurrent(Task.init(task));
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

        if (!js.JSValueIsString(ctx, arguments[0])) {
            const fetch_error = fetch_type_error_strings.get(js.JSValueGetType(ctx, arguments[0]));
            return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
        }

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

        NetworkThread.init() catch @panic("Failed to start network thread");
        const url = ZigURL.parse(url_str);

        if (url.origin.len > 0 and strings.eql(url.origin, VirtualMachine.vm.bundler.options.origin.origin)) {
            const fetch_error = fetch_error_cant_fetch_same_origin;
            return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
        }

        var headers: ?Headers = null;
        var body: string = "";
        var method = Method.GET;

        if (arguments.len >= 2 and js.JSValueIsObject(ctx, arguments[1])) {
            var array = js.JSObjectCopyPropertyNames(ctx, arguments[1]);
            defer js.JSPropertyNameArrayRelease(array);
            const count = js.JSPropertyNameArrayGetCount(array);
            var i: usize = 0;
            while (i < count) : (i += 1) {
                var property_name_ref = js.JSPropertyNameArrayGetNameAtIndex(array, i);
                switch (js.JSStringGetLength(property_name_ref)) {
                    "headers".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "headers")) {
                            if (js.JSObjectGetProperty(ctx, arguments[1], property_name_ref, null)) |value| {
                                if (GetJSPrivateData(Headers, value)) |headers_ptr| {
                                    headers = headers_ptr.*;
                                } else if (Headers.JS.headersInit(ctx, value) catch null) |headers_| {
                                    headers = headers_;
                                }
                            }
                        }
                    },
                    "body".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "body")) {
                            if (js.JSObjectGetProperty(ctx, arguments[1], property_name_ref, null)) |value| {
                                var body_ = Body.extractBody(ctx, value, false, null, exception);
                                if (exception.* != null) return js.JSValueMakeNull(ctx);
                                switch (body_.value) {
                                    .ArrayBuffer => |arraybuffer| {
                                        body = arraybuffer.ptr[0..arraybuffer.byte_len];
                                    },
                                    .String => |str| {
                                        body = str;
                                    },
                                    else => {},
                                }
                            }
                        }
                    },
                    "method".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "method")) {
                            if (js.JSObjectGetProperty(ctx, arguments[1], property_name_ref, null)) |value| {
                                var string_ref = js.JSValueToStringCopy(ctx, value, exception);

                                if (exception.* != null) return js.JSValueMakeNull(ctx);
                                defer js.JSStringRelease(string_ref);
                                var method_name_buf: [16]u8 = undefined;
                                var method_name = method_name_buf[0..js.JSStringGetUTF8CString(string_ref, &method_name_buf, method_name_buf.len)];
                                method = Method.which(method_name) orelse method;
                            }
                        }
                    },
                    else => {},
                }
            }
        }

        var header_entries: Headers.Entries = .{};
        var header_buf: string = "";

        if (headers) |head| {
            header_entries = head.entries;
            header_buf = head.buf.items;
        }
        var resolve = js.JSObjectMakeFunctionWithCallback(ctx, null, Fetch.FetchTasklet.FetchResolver.call);
        var reject = js.JSObjectMakeFunctionWithCallback(ctx, null, Fetch.FetchTasklet.FetchRejecter.call);

        js.JSValueProtect(ctx, resolve);
        js.JSValueProtect(ctx, reject);

        // var resolve = FetchTasklet.FetchResolver.Class.make(ctx: js.JSContextRef, ptr: *ZigType)
        var queued = FetchTasklet.queue(
            default_allocator,
            globalThis,
            method,
            url,
            header_entries,
            header_buf,
            null,
            std.time.ns_per_hour,
        ) catch unreachable;
        queued.data.this_object = js.JSObjectMake(ctx, null, JSPrivateDataPtr.init(&queued.data.context).ptr());
        js.JSValueProtect(ctx, queued.data.this_object);

        var promise = js.JSObjectMakeDeferredPromise(ctx, &resolve, &reject, exception);
        queued.data.reject = reject;
        queued.data.resolve = resolve;

        return promise;
        // queued.data.promise.create(globalThis: *JSGlobalObject)
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Headers
pub const Headers = struct {
    pub usingnamespace HTTPClient.Headers;
    entries: Headers.Entries,
    buf: std.ArrayListUnmanaged(u8),
    allocator: std.mem.Allocator,
    used: u32 = 0,
    guard: Guard = Guard.none,

    pub fn deinit(
        headers: *Headers,
    ) void {
        headers.buf.deinit(headers.allocator);
        headers.entries.deinit(headers.allocator);
    }

    pub fn empty(allocator: std.mem.Allocator) Headers {
        var headers: Headers = undefined;
        return Headers{
            .entries = @TypeOf(headers.entries){},
            .buf = @TypeOf(headers.buf){},
            .used = 0,
            .allocator = allocator,
            .guard = Guard.none,
        };
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/Headers#methods
    pub const JS = struct {

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/get
        pub fn get(
            this: *Headers,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            if (arguments.len == 0 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringIsEqual(arguments[0], Properties.Refs.empty_string)) {
                return js.JSValueMakeNull(ctx);
            }

            const key_len = js.JSStringGetUTF8CString(arguments[0], &header_kv_buf, header_kv_buf.len);
            const key = header_kv_buf[0 .. key_len - 1];
            if (this.getHeaderIndex(key)) |index| {
                var str = this.asStr(this.entries.items(.value)[index]);
                var ref = js.JSStringCreateWithUTF8CString(str.ptr);
                defer js.JSStringRelease(ref);
                return js.JSValueMakeString(ctx, ref);
            } else {
                return js.JSValueMakeNull(ctx);
            }
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/set
        // > The difference between set() and Headers.append is that if the specified header already exists and accepts multiple values
        // > set() overwrites the existing value with the new one, whereas Headers.append appends the new value to the end of the set of values.
        pub fn set(
            this: *Headers,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            if (this.guard == .request or arguments.len < 2 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringIsEqual(arguments[0], Properties.Refs.empty_string) or !js.JSValueIsString(ctx, arguments[1])) {
                return js.JSValueMakeUndefined(ctx);
            }

            this.putHeaderFromJS(arguments[0], arguments[1], false);
            return js.JSValueMakeUndefined(ctx);
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/append
        pub fn append(
            this: *Headers,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            if (this.guard == .request or arguments.len < 2 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringIsEqual(arguments[0], Properties.Refs.empty_string) or !js.JSValueIsString(ctx, arguments[1])) {
                return js.JSValueMakeUndefined(ctx);
            }

            this.putHeaderFromJS(arguments[0], arguments[1], true);
            return js.JSValueMakeUndefined(ctx);
        }
        pub fn delete(
            this: *Headers,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            if (this.guard == .request or arguments.len < 1 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringIsEqual(arguments[0], Properties.Refs.empty_string)) {
                return js.JSValueMakeUndefined(ctx);
            }

            const key_len = js.JSStringGetUTF8CString(arguments[0], &header_kv_buf, header_kv_buf.len) - 1;
            const key = header_kv_buf[0..key_len];

            if (this.getHeaderIndex(key)) |header_i| {
                this.entries.orderedRemove(header_i);
            }

            return js.JSValueMakeUndefined(ctx);
        }
        pub fn entries(
            _: *Headers,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("<r><b>Headers.entries()<r> is not implemented yet - sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }
        pub fn keys(
            _: *Headers,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("H<r><b>Headers.keys()<r> is not implemented yet- sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }
        pub fn values(
            _: *Headers,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("<r><b>Headers.values()<r> is not implemented yet - sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }

        pub fn headersInit(ctx: js.JSContextRef, header_prop: js.JSObjectRef) !?Headers {
            const header_keys = js.JSObjectCopyPropertyNames(ctx, header_prop);
            defer js.JSPropertyNameArrayRelease(header_keys);
            const total_header_count = js.JSPropertyNameArrayGetCount(header_keys);
            if (total_header_count == 0) return null;

            // 2 passes through the headers

            // Pass #1: find the "real" count.
            // The number of things which are strings or numbers.
            // Anything else should be ignored.
            // We could throw a TypeError, but ignoring silently is more JavaScript-like imo
            var real_header_count: usize = 0;
            var estimated_buffer_len: usize = 0;
            var j: usize = 0;
            while (j < total_header_count) : (j += 1) {
                var key_ref = js.JSPropertyNameArrayGetNameAtIndex(header_keys, j);
                var value_ref = js.JSObjectGetProperty(ctx, header_prop, key_ref, null);

                switch (js.JSValueGetType(ctx, value_ref)) {
                    js.JSType.kJSTypeNumber => {
                        const key_len = js.JSStringGetLength(key_ref);
                        if (key_len > 0) {
                            real_header_count += 1;
                            estimated_buffer_len += key_len;
                            estimated_buffer_len += std.fmt.count("{d}", .{js.JSValueToNumber(ctx, value_ref, null)});
                        }
                    },
                    js.JSType.kJSTypeString => {
                        const key_len = js.JSStringGetLength(key_ref);
                        const value_len = js.JSStringGetLength(value_ref);
                        if (key_len > 0 and value_len > 0) {
                            real_header_count += 1;
                            estimated_buffer_len += key_len + value_len;
                        }
                    },
                    else => {},
                }
            }

            if (real_header_count == 0 or estimated_buffer_len == 0) return null;

            j = 0;
            var allocator = getAllocator(ctx);
            var headers = Headers{
                .allocator = allocator,
                .buf = try std.ArrayListUnmanaged(u8).initCapacity(allocator, estimated_buffer_len),
                .entries = Headers.Entries{},
            };
            errdefer headers.deinit();
            try headers.entries.ensureTotalCapacity(allocator, real_header_count);
            headers.buf.expandToCapacity();
            while (j < total_header_count) : (j += 1) {
                var key_ref = js.JSPropertyNameArrayGetNameAtIndex(header_keys, j);
                var value_ref = js.JSObjectGetProperty(ctx, header_prop, key_ref, null);

                switch (js.JSValueGetType(ctx, value_ref)) {
                    js.JSType.kJSTypeNumber => {
                        if (js.JSStringGetLength(key_ref) == 0) continue;
                        try headers.appendInit(ctx, key_ref, .kJSTypeNumber, value_ref);
                    },
                    js.JSType.kJSTypeString => {
                        if (js.JSStringGetLength(value_ref) == 0 or js.JSStringGetLength(key_ref) == 0) continue;
                        try headers.appendInit(ctx, key_ref, .kJSTypeString, value_ref);
                    },
                    else => {},
                }
            }
            return headers;
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/Headers
        pub fn constructor(
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSObjectRef {
            var headers = getAllocator(ctx).create(Headers) catch unreachable;
            if (arguments.len > 0 and js.JSValueIsObjectOfClass(ctx, arguments[0], Headers.Class.get().*)) {
                var other = castObj(arguments[0], Headers);
                other.clone(headers) catch unreachable;
            } else if (arguments.len == 1 and js.JSValueIsObject(ctx, arguments[0])) {
                headers.* = (JS.headersInit(ctx, arguments[0]) catch unreachable) orelse Headers{
                    .entries = @TypeOf(headers.entries){},
                    .buf = @TypeOf(headers.buf){},
                    .used = 0,
                    .allocator = getAllocator(ctx),
                    .guard = Guard.none,
                };
            } else {
                headers.* = Headers.empty(getAllocator(ctx));
            }

            return Headers.Class.make(ctx, headers);
        }

        pub fn finalize(
            this: *Headers,
        ) void {
            this.deinit();
        }
    };
    pub const Class = NewClass(
        Headers,
        .{
            .name = "Headers",
            .read_only = true,
        },
        .{
            .@"get" = .{
                .rfn = JS.get,
            },
            .@"set" = .{
                .rfn = JS.set,
                .ts = d.ts{},
            },
            .@"append" = .{
                .rfn = JS.append,
                .ts = d.ts{},
            },
            .@"delete" = .{
                .rfn = JS.delete,
                .ts = d.ts{},
            },
            .@"entries" = .{
                .rfn = JS.entries,
                .ts = d.ts{},
            },
            .@"keys" = .{
                .rfn = JS.keys,
                .ts = d.ts{},
            },
            .@"values" = .{
                .rfn = JS.values,
                .ts = d.ts{},
            },
            .@"constructor" = .{
                .rfn = JS.constructor,
                .ts = d.ts{},
            },
            .@"finalize" = .{
                .rfn = JS.finalize,
            },
            .toJSON = .{
                .rfn = toJSON,
                .name = "toJSON",
            },
        },
        .{},
    );

    // https://developer.mozilla.org/en-US/docs/Glossary/Guard
    pub const Guard = enum {
        immutable,
        request,
        @"request-no-cors",
        response,
        none,
    };

    pub fn fromPicoHeaders(allocator: std.mem.Allocator, picohttp_headers: []const picohttp.Header) !Headers {
        var total_len: usize = 0;
        for (picohttp_headers) |header| {
            total_len += header.name.len;
            total_len += header.value.len;
        }
        // for the null bytes
        total_len += picohttp_headers.len * 2;
        var headers = Headers{
            .allocator = allocator,
            .entries = Headers.Entries{},
            .buf = std.ArrayListUnmanaged(u8){},
        };
        try headers.entries.ensureTotalCapacity(allocator, picohttp_headers.len);
        try headers.buf.ensureTotalCapacity(allocator, total_len);
        headers.buf.expandToCapacity();
        headers.guard = Guard.request;

        for (picohttp_headers) |header| {
            headers.entries.appendAssumeCapacity(.{
                .name = headers.appendString(
                    string,
                    header.name,
                    true,
                    true,
                    true,
                ),
                .value = headers.appendString(
                    string,
                    header.value,
                    true,
                    true,
                    true,
                ),
            });
        }

        return headers;
    }

    // TODO: is it worth making this lazy? instead of copying all the request headers, should we just do it on get/put/iterator?
    pub fn fromRequestCtx(allocator: std.mem.Allocator, request: *RequestContext) !Headers {
        return fromPicoHeaders(allocator, request.request.headers);
    }

    pub fn asStr(headers: *const Headers, ptr: Api.StringPointer) []u8 {
        return headers.buf.items[ptr.offset..][0..ptr.length];
    }

    threadlocal var header_kv_buf: [4096]u8 = undefined;

    pub fn putHeader(headers: *Headers, key_: []const u8, value_: []const u8, comptime append: bool) void {
        const key = strings.copyLowercase(strings.trim(key_, " \n\r"), &header_kv_buf);
        const value = strings.copyLowercase(strings.trim(value_, " \n\r"), header_kv_buf[key.len..]);
        return headers.putHeaderNormalized(key, value, append);
    }

    pub fn putHeaderNumber(headers: *Headers, key_: []const u8, value_: u32, comptime append: bool) void {
        const key = strings.copyLowercase(strings.trim(key_, " \n\r"), &header_kv_buf);
        const value = std.fmt.bufPrint(header_kv_buf[key.len..], "{d}", .{value_}) catch unreachable;
        return headers.putHeaderNormalized(key, value, append);
    }

    pub fn putHeaderFromJS(headers: *Headers, key_: js.JSStringRef, value_: js.JSStringRef, comptime append: bool) void {
        const key_len = js.JSStringGetUTF8CString(key_, &header_kv_buf, header_kv_buf.len) - 1;
        // TODO: make this one pass instead of two
        var key = strings.trim(header_kv_buf[0..key_len], " \n\r");
        key = std.ascii.lowerString(key[0..key.len], key);

        var remainder = header_kv_buf[key.len..];
        const value_len = js.JSStringGetUTF8CString(value_, remainder.ptr, remainder.len) - 1;
        var value = strings.trim(remainder[0..value_len], " \n\r");

        headers.putHeaderNormalized(key, value, append);
    }

    pub fn putHeaderNormalized(headers: *Headers, key: []const u8, value: []const u8, comptime append: bool) void {
        if (headers.getHeaderIndex(key)) |header_i| {
            const existing_value = headers.entries.items(.value)[header_i];

            if (append) {
                const end = @truncate(u32, value.len + existing_value.length + 2);
                headers.buf.ensureUnusedCapacity(headers.allocator, end) catch unreachable;
                headers.buf.expandToCapacity();
                var new_end = headers.buf.items[headers.used..][0 .. end - 1];
                const existing_buf = headers.asStr(existing_value);
                std.mem.copy(u8, existing_buf, new_end);
                new_end[existing_buf.len] = ',';
                std.mem.copy(u8, new_end[existing_buf.len + 1 ..], value);
                new_end.ptr[end - 1] = 0;
                headers.entries.items(.value)[header_i] = Api.StringPointer{ .offset = headers.used, .length = end - 1 };
                headers.used += end;
                // Can we get away with just overwriting in-place?
            } else if (existing_value.length < value.len) {
                std.mem.copy(u8, headers.asStr(existing_value), value);
                headers.entries.items(.value)[header_i].length = @truncate(u32, value.len);
                headers.asStr(headers.entries.items(.value)[header_i]).ptr[value.len] = 0;
                // Otherwise, append to the buffer, and just don't bother dealing with the existing header value
                // We assume that these header objects are going to be kind of short-lived.
            } else {
                headers.buf.ensureUnusedCapacity(headers.allocator, value.len + 1) catch unreachable;
                headers.buf.expandToCapacity();
                headers.entries.items(.value)[header_i] = headers.appendString(string, value, false, true, true);
            }
        } else {
            headers.appendHeader(key, value, false, false, true);
        }
    }

    pub fn getHeaderIndex(headers: *const Headers, key: string) ?u32 {
        for (headers.entries.items(.name)) |name, i| {
            if (name.length == key.len and strings.eqlInsensitive(key, headers.asStr(name))) {
                return @truncate(u32, i);
            }
        }

        return null;
    }

    pub fn appendHeader(
        headers: *Headers,
        key: string,
        value: string,
        comptime needs_lowercase: bool,
        comptime needs_normalize: bool,
        comptime append_null: bool,
    ) void {
        headers.buf.ensureUnusedCapacity(headers.allocator, key.len + value.len + 2) catch unreachable;
        headers.buf.expandToCapacity();
        headers.entries.append(
            headers.allocator,
            .{
                .name = headers.appendString(
                    string,
                    key,
                    needs_lowercase,
                    needs_normalize,
                    append_null,
                ),
                .value = headers.appendString(
                    string,
                    value,
                    needs_lowercase,
                    needs_normalize,
                    append_null,
                ),
            },
        ) catch unreachable;
    }

    fn appendString(
        this: *Headers,
        comptime StringType: type,
        str: StringType,
        comptime needs_lowercase: bool,
        comptime needs_normalize: bool,
        comptime append_null: bool,
    ) Api.StringPointer {
        var ptr = Api.StringPointer{ .offset = this.used, .length = 0 };
        ptr.length = @truncate(
            u32,
            switch (comptime StringType) {
                js.JSStringRef => js.JSStringGetLength(str),
                else => str.len,
            },
        );
        if (Environment.allow_assert) std.debug.assert(ptr.length > 0);

        if (Environment.allow_assert) std.debug.assert(this.buf.items.len >= ptr.offset + ptr.length);
        var slice = this.buf.items[ptr.offset..][0..ptr.length];
        switch (comptime StringType) {
            js.JSStringRef => {
                ptr.length = @truncate(u32, js.JSStringGetUTF8CString(str, slice.ptr, slice.len) - 1);
            },
            else => {
                std.mem.copy(u8, slice, str);
            },
        }

        if (comptime needs_normalize) {
            slice = strings.trim(slice, " \r\n");
        }

        if (comptime needs_lowercase) {
            for (slice) |c, i| {
                slice[i] = std.ascii.toLower(c);
            }
        }
        if (comptime append_null) {
            slice.ptr[slice.len] = 0;
            this.used += 1;
        }

        ptr.length = @truncate(u32, slice.len);
        this.used += @truncate(u32, ptr.length);
        return ptr;
    }

    pub fn toJSON(
        this: *Headers,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        const slice = this.entries.slice();
        const keys = slice.items(.name);
        const values = slice.items(.value);
        const StackFallback = std.heap.StackFallbackAllocator(32 * 2 * @sizeOf(ZigString));
        var stack = StackFallback{
            .buffer = undefined,
            .fallback_allocator = default_allocator,
            .fixed_buffer_allocator = undefined,
        };
        var allocator = stack.get();
        var key_strings_ = allocator.alloc(ZigString, keys.len * 2) catch unreachable;
        var key_strings = key_strings_[0..keys.len];
        var value_strings = key_strings_[keys.len..];

        for (keys) |key, i| {
            key_strings[i] = ZigString.init(this.asStr(key));
            key_strings[i].detectEncoding();
            value_strings[i] = ZigString.init(this.asStr(values[i]));
            value_strings[i].detectEncoding();
        }

        var result = JSValue.fromEntries(ctx.ptr(), key_strings.ptr, value_strings.ptr, keys.len, true).asObjectRef();
        allocator.free(key_strings_);
        return result;
    }

    pub fn writeFormat(this: *const Headers, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        if (this.entries.len == 0) {
            try writer.writeAll("Headers (0 KB) {}");
            return;
        }

        try writer.print("Headers ({}) {{\n", .{bun.fmt.size(this.buf.items.len)});
        const Writer = @TypeOf(writer);
        {
            var slice = this.entries.slice();
            const names = slice.items(.name);
            const values = slice.items(.value);
            formatter.indent += 1;
            defer formatter.indent -|= 1;

            for (names) |name, i| {
                if (i > 0) {
                    formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                    writer.writeAll("\n") catch unreachable;
                }

                const value = values[i];
                formatter.writeIndent(Writer, writer) catch unreachable;
                try JSPrinter.writeJSONString(this.asStr(name), Writer, writer, false);
                writer.writeAll(": ") catch unreachable;
                try JSPrinter.writeJSONString(this.asStr(value), Writer, writer, false);
            }
        }

        try writer.writeAll("\n");
        try formatter.writeIndent(@TypeOf(writer), writer);
        try writer.writeAll("}");
    }

    fn appendNumber(this: *Headers, num: f64) Api.StringPointer {
        var ptr = Api.StringPointer{ .offset = this.used, .length = @truncate(
            u32,
            std.fmt.count("{d}", .{num}),
        ) };
        std.debug.assert(this.buf.items.len >= ptr.offset + ptr.length);
        var slice = this.buf.items[ptr.offset..][0..ptr.length];
        var buf = std.fmt.bufPrint(slice, "{d}", .{num}) catch &[_]u8{};
        ptr.length = @truncate(u32, buf.len);
        this.used += ptr.length;
        return ptr;
    }

    pub fn appendInit(this: *Headers, ctx: js.JSContextRef, key: js.JSStringRef, comptime value_type: js.JSType, value: js.JSValueRef) !void {
        this.entries.append(this.allocator, .{
            .name = this.appendString(js.JSStringRef, key, true, true, false),
            .value = switch (comptime value_type) {
                js.JSType.kJSTypeNumber => this.appendNumber(js.JSValueToNumber(ctx, value, null)),
                js.JSType.kJSTypeString => this.appendString(js.JSStringRef, value, true, true, false),
                else => unreachable,
            },
        }) catch unreachable;
    }

    pub fn clone(this: *Headers, to: *Headers) !void {
        to.* = Headers{
            .entries = try this.entries.clone(this.allocator),
            .buf = try @TypeOf(this.buf).initCapacity(this.allocator, this.buf.items.len),
            .used = this.used,
            .allocator = this.allocator,
            .guard = Guard.none,
        };
        to.buf.expandToCapacity();
        std.mem.copy(u8, to.buf.items, this.buf.items);
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Body
pub const Body = struct {
    init: Init,
    value: Value,
    ptr: ?[*]u8 = null,
    len: usize = 0,
    ptr_allocator: ?std.mem.Allocator = null,

    pub fn slice(this: *const Body) []const u8 {
        return switch (this.value) {
            .String => this.value.String,
            .ArrayBuffer => this.value.ArrayBuffer.slice(),
            else => "",
        };
    }

    pub fn clone(this: Body, allocator: std.mem.Allocator) Body {
        var value: Value = .{ .Empty = 0 };
        var ptr: ?[*]u8 = null;
        var len: usize = 0;
        switch (this.value) {
            .ArrayBuffer => |buffer| {
                value = .{
                    .ArrayBuffer = ArrayBuffer.fromBytes(allocator.dupe(u8, buffer.slice()) catch unreachable, buffer.typed_array_type),
                };
                len = buffer.len;
                ptr = value.ArrayBuffer.ptr;
            },
            .String => |str| {
                value = .{
                    .String = allocator.dupe(u8, str) catch unreachable,
                };
                len = str.len;
                ptr = bun.constStrToU8(value.String).ptr;
            },
            else => {},
        }

        return Body{
            .init = this.init.clone(allocator),
            .value = value,
            .ptr_allocator = if (len > 0) allocator else null,
            .ptr = ptr,
            .len = len,
        };
    }

    pub fn writeFormat(this: *const Body, formatter: *JSC.Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("bodyUsed: ");
        formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(!(this.value == .Unconsumed or this.value == .Empty)), .BooleanObject, enable_ansi_colors);
        try formatter.printComma(Writer, writer, enable_ansi_colors);
        try writer.writeAll("\n");

        if (this.init.headers) |*headers| {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll("headers: ");
            try headers.writeFormat(formatter, writer, comptime enable_ansi_colors);
            try writer.writeAll("\n");
        }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("status: ");
        formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(this.init.status_code), .NumberObject, enable_ansi_colors);
    }

    pub fn deinit(this: *Body, allocator: std.mem.Allocator) void {
        this.ptr_allocator = null;
        if (this.init.headers) |*headers| {
            headers.deinit();
        }

        switch (this.value) {
            .ArrayBuffer => {},
            .String => |str| {
                allocator.free(str);
            },
            .Empty => {},
            else => {},
        }
    }

    pub const Init = struct {
        headers: ?Headers,
        status_code: u16,

        pub fn clone(this: Init, allocator: std.mem.Allocator) Init {
            var that = this;
            var headers = this.headers;
            if (headers) |*head| {
                headers.?.allocator = allocator;
                var new_headers: Headers = undefined;
                head.clone(&new_headers) catch unreachable;
                that.headers = new_headers;
            }

            return that;
        }

        pub fn init(_: std.mem.Allocator, ctx: js.JSContextRef, init_ref: js.JSValueRef) !?Init {
            var result = Init{ .headers = null, .status_code = 0 };
            var array = js.JSObjectCopyPropertyNames(ctx, init_ref);
            defer js.JSPropertyNameArrayRelease(array);
            const count = js.JSPropertyNameArrayGetCount(array);
            var i: usize = 0;
            while (i < count) : (i += 1) {
                var property_name_ref = js.JSPropertyNameArrayGetNameAtIndex(array, i);
                switch (js.JSStringGetLength(property_name_ref)) {
                    "headers".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "headers")) {
                            // only support headers as an object for now.
                            if (js.JSObjectGetProperty(ctx, init_ref, property_name_ref, null)) |header_prop| {
                                switch (js.JSValueGetType(ctx, header_prop)) {
                                    js.JSType.kJSTypeObject => {
                                        result.headers = try Headers.JS.headersInit(ctx, header_prop);
                                    },
                                    else => {},
                                }
                            }
                        }
                    },
                    "statusCode".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "statusCode")) {
                            var value_ref = js.JSObjectGetProperty(ctx, init_ref, property_name_ref, null);
                            var exception: js.JSValueRef = null;
                            const number = js.JSValueToNumber(ctx, value_ref, &exception);
                            if (exception != null or !std.math.isFinite(number)) continue;
                            result.status_code = @truncate(u16, @floatToInt(u64, number));
                        }
                    },
                    else => {},
                }
            }

            if (result.headers == null and result.status_code < 200) return null;
            return result;
        }
    };

    pub const PendingValue = struct {
        promise: ?JSValue = null,
        global: *JSGlobalObject,
        task: ?*anyopaque = null,
    };

    pub const Value = union(Tag) {
        ArrayBuffer: ArrayBuffer,
        String: string,
        Empty: u0,
        Unconsumed: u0,
        Locked: PendingValue,

        pub const Tag = enum {
            ArrayBuffer,
            String,
            Empty,
            Unconsumed,
            Locked,
        };

        pub fn length(value: *const Value) usize {
            switch (value.*) {
                .ArrayBuffer => |buf| {
                    return buf.ptr[buf.offset..buf.byte_len].len;
                },
                .String => |str| {
                    return str.len;
                },
                else => {
                    return 0;
                },
            }
        }
    };

    pub fn @"404"(_: js.JSContextRef) Body {
        return Body{ .init = Init{
            .headers = null,
            .status_code = 404,
        }, .value = .{ .Empty = 0 } };
    }

    pub fn @"200"(_: js.JSContextRef) Body {
        return Body{ .init = Init{
            .headers = null,
            .status_code = 200,
        }, .value = .{ .Empty = 0 } };
    }

    pub fn extract(ctx: js.JSContextRef, body_ref: js.JSObjectRef, exception: js.ExceptionRef) Body {
        return extractBody(
            ctx,
            body_ref,
            false,
            null,
            exception,
        );
    }

    pub fn extractWithInit(ctx: js.JSContextRef, body_ref: js.JSObjectRef, init_ref: js.JSValueRef, exception: js.ExceptionRef) Body {
        return extractBody(
            ctx,
            body_ref,
            true,
            init_ref,
            exception,
        );
    }

    // https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
    inline fn extractBody(
        ctx: js.JSContextRef,
        body_ref: js.JSObjectRef,
        comptime has_init: bool,
        init_ref: js.JSValueRef,
        exception: js.ExceptionRef,
    ) Body {
        var body = Body{ .init = Init{ .headers = null, .status_code = 200 }, .value = .{ .Empty = 0 } };
        const value = JSC.JSValue.fromRef(body_ref);
        switch (value.jsType()) {
            JSC.JSValue.JSType.String,
            JSC.JSValue.JSType.StringObject,
            JSC.JSValue.JSType.DerivedStringObject,
            => {
                var allocator = getAllocator(ctx);

                if (comptime has_init) {
                    if (Init.init(allocator, ctx, init_ref.?)) |maybeInit| {
                        if (maybeInit) |init_| {
                            body.init = init_;
                        }
                    } else |_| {}
                }
                var zig_str = JSC.ZigString.init("");
                value.toZigString(&zig_str, ctx.ptr());

                if (zig_str.len == 0) {
                    body.value = .{ .String = "" };
                    return body;
                }

                body.value = Value{
                    .String = std.fmt.allocPrint(default_allocator, "{}", .{zig_str}) catch unreachable,
                };
                body.ptr_allocator = default_allocator;
                // body.ptr = body.
                // body.len = body.value.String.len;str.characters8()[0..len] };

                return body;
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
                var allocator = getAllocator(ctx);

                if (comptime has_init) {
                    if (Init.init(allocator, ctx, init_ref.?)) |maybeInit| {
                        if (maybeInit) |init_| {
                            body.init = init_;
                        }
                    } else |_| {}
                }
                body.value = Value{ .ArrayBuffer = value.asArrayBuffer(ctx.ptr()).? };
                body.ptr = body.value.ArrayBuffer.ptr[body.value.ArrayBuffer.offset..body.value.ArrayBuffer.byte_len].ptr;
                body.len = body.value.ArrayBuffer.ptr[body.value.ArrayBuffer.offset..body.value.ArrayBuffer.byte_len].len;
                return body;
            },
            else => {},
        }

        if (exception == null) {
            JSError(getAllocator(ctx), "Body must be a string or a TypedArray (for now)", .{}, ctx, exception);
        }

        return body;
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Request
pub const Request = struct {
    request_context: *RequestContext,
    url_string_ref: js.JSStringRef = null,
    headers: ?Headers = null,

    pub const Class = NewClass(
        Request,
        .{
            .name = "Request",
            .read_only = true,
        },
        .{},
        .{
            .@"cache" = .{
                .@"get" = getCache,
                .@"ro" = true,
            },
            .@"credentials" = .{
                .@"get" = getCredentials,
                .@"ro" = true,
            },
            .@"destination" = .{
                .@"get" = getDestination,
                .@"ro" = true,
            },
            .@"headers" = .{
                .@"get" = getHeaders,
                .@"ro" = true,
            },
            .@"integrity" = .{
                .@"get" = getIntegrity,
                .@"ro" = true,
            },
            .@"method" = .{
                .@"get" = getMethod,
                .@"ro" = true,
            },
            .@"mode" = .{
                .@"get" = getMode,
                .@"ro" = true,
            },
            .@"redirect" = .{
                .@"get" = getRedirect,
                .@"ro" = true,
            },
            .@"referrer" = .{
                .@"get" = getReferrer,
                .@"ro" = true,
            },
            .@"referrerPolicy" = .{
                .@"get" = getReferrerPolicy,
                .@"ro" = true,
            },
            .@"url" = .{
                .@"get" = getUrl,
                .@"ro" = true,
            },
        },
    );

    pub fn getCache(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, ZigString.init(Properties.UTF8.default).toValueGC(ctx.ptr()).asRef());
    }
    pub fn getCredentials(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, ZigString.init(Properties.UTF8.include).toValueGC(ctx.ptr()).asRef());
    }
    pub fn getDestination(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, ZigString.init("").toValueGC(ctx.ptr()).asRef());
    }
    pub fn getHeaders(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.headers == null) {
            this.headers = Headers.fromRequestCtx(getAllocator(ctx), this.request_context) catch unreachable;
        }

        return Headers.Class.make(ctx, &this.headers.?);
    }
    pub fn getIntegrity(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.Empty.toValueGC(ctx.ptr()).asRef();
    }
    pub fn getMethod(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        const string_contents: string = switch (this.request_context.method) {
            .GET => Properties.UTF8.GET,
            .HEAD => Properties.UTF8.HEAD,
            .PATCH => Properties.UTF8.PATCH,
            .PUT => Properties.UTF8.PUT,
            .POST => Properties.UTF8.POST,
            .OPTIONS => Properties.UTF8.OPTIONS,
            else => "",
        };

        return ZigString.init(string_contents).toValueGC(ctx.ptr()).asRef();
    }

    pub fn getMode(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(Properties.UTF8.navigate).toValueGC(ctx.ptr()).asRef();
    }
    pub fn getRedirect(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(Properties.UTF8.follow).toValueGC(ctx.ptr()).asRef();
    }
    pub fn getReferrer(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.request_context.header("Referrer")) |referrer| {
            return ZigString.init(referrer).toValueGC(ctx.ptr()).asRef();
        } else {
            return ZigString.init("").toValueGC(ctx.ptr()).asRef();
        }
    }
    pub fn getReferrerPolicy(
        _: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init("").toValueGC(ctx.ptr()).asRef();
    }
    pub fn getUrl(
        this: *Request,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.url_string_ref == null) {
            this.url_string_ref = js.JSStringCreateWithUTF8CString(this.request_context.getFullURL());
        }

        return js.JSValueMakeString(ctx, this.url_string_ref);
    }
};

// https://github.com/WebKit/WebKit/blob/main/Source/WebCore/workers/service/FetchEvent.h
pub const FetchEvent = struct {
    started_waiting_at: u64 = 0,
    response: ?*Response = null,
    request_context: *RequestContext,
    request: Request,
    pending_promise: ?*JSInternalPromise = null,

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
        return Request.Class.make(ctx, &this.request);
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
        if (this.request_context.has_called_done) return js.JSValueMakeUndefined(ctx);
        var globalThis = ctx.ptr();

        // A Response or a Promise that resolves to a Response. Otherwise, a network error is returned to Fetch.
        if (arguments.len == 0 or !Response.Class.loaded or !js.JSValueIsObject(ctx, arguments[0])) {
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            this.request_context.sendInternalError(error.respondWithWasEmpty) catch {};
            return js.JSValueMakeUndefined(ctx);
        }

        var arg = arguments[0];

        if (!js.JSValueIsObjectOfClass(ctx, arg, Response.Class.ref)) {
            this.pending_promise = this.pending_promise orelse JSInternalPromise.resolvedPromise(globalThis, JSValue.fromRef(arguments[0]));
        }

        if (this.pending_promise) |promise| {
            var status = promise.status(globalThis.vm());

            if (status == .Pending) {
                VirtualMachine.vm.tick();
                status = promise.status(globalThis.vm());
            }

            switch (status) {
                .Fulfilled => {},
                else => {
                    this.rejected = true;
                    this.pending_promise = null;
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

        if (!js.JSValueIsObjectOfClass(ctx, arg, Response.Class.ref)) {
            this.rejected = true;
            this.pending_promise = null;
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            this.onPromiseRejectionHandler.?(this.onPromiseRejectionCtx, error.RespondWithInvalidType, this, JSValue.fromRef(exception.*));

            return js.JSValueMakeUndefined(ctx);
        }

        var response: *Response = GetJSPrivateData(Response, arg) orelse {
            this.rejected = true;
            this.pending_promise = null;
            JSError(getAllocator(ctx), "event.respondWith()'s Response object was invalid. This may be an internal error.", .{}, ctx, exception);
            this.onPromiseRejectionHandler.?(this.onPromiseRejectionCtx, error.RespondWithInvalidTypeInternal, this, JSValue.fromRef(exception.*));
            return js.JSValueMakeUndefined(ctx);
        };

        defer {
            if (!VirtualMachine.vm.had_errors) {
                Output.printElapsed(@intToFloat(f64, (this.request_context.timer.lap())) / std.time.ns_per_ms);

                Output.prettyError(
                    " <b>{s}<r><d> - <b>{d}<r> <d>transpiled, <d><b>{d}<r> <d>imports<r>\n",
                    .{
                        this.request_context.matched_route.?.name,
                        VirtualMachine.vm.transpiled_count,
                        VirtualMachine.vm.resolved_count,
                    },
                );
            }
        }

        defer this.pending_promise = null;
        var needs_mime_type = true;
        var content_length: ?usize = null;
        if (response.body.init.headers) |*headers| {
            this.request_context.clearHeaders() catch {};
            var i: usize = 0;
            while (i < headers.entries.len) : (i += 1) {
                var header = headers.entries.get(i);
                const name = headers.asStr(header.name);
                if (strings.eqlComptime(name, "content-type")) {
                    needs_mime_type = false;
                }

                if (strings.eqlComptime(name, "content-length")) {
                    content_length = std.fmt.parseInt(usize, headers.asStr(header.value), 10) catch null;
                    continue;
                }

                this.request_context.appendHeaderSlow(
                    name,
                    headers.asStr(header.value),
                ) catch unreachable;
            }
        }

        if (needs_mime_type) {
            this.request_context.appendHeader("Content-Type", response.mimeType(this.request_context));
        }

        const content_length_ = content_length orelse response.body.value.length();

        if (content_length_ == 0) {
            this.request_context.sendNoContent() catch return js.JSValueMakeUndefined(ctx);
            return js.JSValueMakeUndefined(ctx);
        }

        if (FeatureFlags.strong_etags_for_built_files) {
            switch (response.body.value) {
                .ArrayBuffer => |buf| {
                    const did_send = this.request_context.writeETag(buf.ptr[buf.offset..buf.byte_len]) catch false;
                    if (did_send) return js.JSValueMakeUndefined(ctx);
                },
                .String => |str| {
                    const did_send = this.request_context.writeETag(str) catch false;
                    if (did_send) {
                        // defer getAllocator(ctx).destroy(str.ptr);
                        return js.JSValueMakeUndefined(ctx);
                    }
                },
                else => unreachable,
            }
        }

        defer this.request_context.done();
        defer {
            if (response.body.ptr_allocator) |alloc| {
                if (response.body.ptr) |ptr| {
                    alloc.free(ptr[0..response.body.len]);
                }

                response.body.ptr_allocator = null;
            }
        }

        this.request_context.writeStatusSlow(response.body.init.status_code) catch return js.JSValueMakeUndefined(ctx);
        this.request_context.prepareToSendBody(content_length_, false) catch return js.JSValueMakeUndefined(ctx);

        switch (response.body.value) {
            .ArrayBuffer => |buf| {
                this.request_context.writeBodyBuf(buf.ptr[buf.offset..buf.byte_len]) catch return js.JSValueMakeUndefined(ctx);
            },
            .String => |str| {
                // defer getAllocator(ctx).destroy(str.ptr);
                this.request_context.writeBodyBuf(str) catch return js.JSValueMakeUndefined(ctx);
            },
            else => unreachable,
        }

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

// pub const ReadableStream = struct {
//     pub const Class = NewClass(
//         ReadableStream,
//         .{
//             .name = "ReadableStream",
//         },
//         .{},
//         .{

//         },
//     );
// };

// pub const TextEncoder = struct {
//     pub const Class = NewClass(
//         TextEncoder,
//         .{
//             .name = "TextEncoder",
//         },
//         .{
//             .encoding = .{
//                 .@"get" = getEncoding,
//                 .ro = true,
//             },
//         },
//         .{
//             .encode = .{
//                 .rfn = encode,
//             },
//             .constructor = .{
//                 .rfn = constructor,
//             },
//             .encodeInto = .{
//                 .rfn = encodeInto,
//             },
//         },
//     );

//     const encoding_str = "utf-8";
//     pub fn getEncoding(
//         this: *TextEncoder,
//         ctx: js.JSContextRef,
//         thisObject: js.JSObjectRef,
//         prop: js.JSStringRef,
//         exception: js.ExceptionRef,
//     ) js.JSValueRef {
//         return ZigString.init(encoding_str).toValue(ctx).asRef()
//     }
// };

// pub const TextDecoder = struct {
//     pub const Class = NewClass(
//         TextDecoder,
//         .{
//             .name = "TextDecoder",
//         },
//         .{},
//         .{
//             .decode = .{},
//             .constructor = .{},
//         },
//     );
// };

test "" {
    std.testing.refAllDecls(Api);
}
