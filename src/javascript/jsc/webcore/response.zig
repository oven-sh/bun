usingnamespace @import("../base.zig");
const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const http = @import("../../../http.zig");

pub const Response = struct {
    pub const Class = NewClass(
        Response,
        "Response",
        .{
            .@"constructor" = constructor,
        },
        .{
            // .@"url" = .{
            //     .@"get" = getURL,
            //     .ro = true,
            // },
            .@"ok" = .{
                .@"get" = getOK,
                .ro = true,
            },
            .@"status" = .{
                .@"get" = getStatus,
                .ro = true,
            },
        },
        false,
        false,
    );

    pub var class_definition: js.JSClassDefinition = undefined;
    pub var class_ref: js.JSClassRef = undefined;
    pub var loaded = false;

    pub fn load() void {
        if (!loaded) {
            class_definition = Class.define();
            class_ref = js.JSClassRetain(js.JSClassCreate(&class_definition));
            loaded = true;
        }
    }
    allocator: *std.mem.Allocator,
    body: Body,

    pub const Props = struct {};

    pub fn getOK(
        this: *Response,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        return js.JSValueMakeBoolean(ctx, this.body.init.status_code >= 200 and this.body.init.status_code <= 299);
    }

    pub fn getStatus(
        this: *Response,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        return js.JSValueMakeNumber(ctx, @intToFloat(f64, this.body.init.status_code));
    }

    pub fn finalize(
        this: *Response,
        ctx: js.JSContextRef,
    ) void {
        this.body.deinit(this.allocator);
        this.allocator.destroy(this);
    }

    pub fn constructor(
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        arguments_len: usize,
        arguments_ptr: [*c]const js.JSValueRef,
        exception: js.ExceptionRef,
    ) callconv(.C) js.JSObjectRef {
        const arguments = arguments_ptr[0..arguments_len];

        const body = brk: {
            switch (arguments.len) {
                0 => {
                    break :brk Body.@"404"(ctx);
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

        if (exception != null) {
            return null;
        }

        var allocator = getAllocator(ctx);
        var response = allocator.create(Response) catch return null;

        response.* = Response{
            .body = body,
            .allocator = allocator,
        };
        return js.JSObjectMake(ctx, class_ref, response);
    }
};

pub const Headers = struct {
    pub const Kv = struct {
        key: Api.StringPointer,
        value: Api.StringPointer,
    };
    pub const Entries = std.MultiArrayList(Kv);
    entries: Entries,
    buf: std.ArrayListUnmanaged(u8),
    allocator: *std.mem.Allocator,
    used: usize = 0,

    fn appendString(this: *Headers, str: js.JSStringRef, comptime needs_lowercase: bool) Api.StringPointer {
        const ptr = Api.StringPointer{ .offset = this.used, .length = js.JSStringGetLength(str) };
        std.debug.assert(ptr.length > 0);
        std.debug.assert(this.buf.items.len >= ptr.offset + ptr.length);
        var slice = this.buf.items[ptr.offset][0..ptr.length];
        ptr.length = js.JSStringGetUTF8CString(this, slice.ptr, slice.len);
        if (needs_lowercase) {
            for (slice) |c, i| {
                slice[i] = std.ascii.toLower(c);
            }
        }

        this.used += ptr.len;
        return ptr;
    }

    fn appendNumber(this: *Headers, num: f64) Api.StringPointer {
        const ptr = Api.StringPointer{ .offset = this.used, .length = std.fmt.count("{d}", num) };
        std.debug.assert(this.buf.items.len >= ptr.offset + ptr.length);
        var slice = this.buf.items[ptr.offset][0..ptr.length];
        ptr.length = std.fmt.bufPrint(slice, "{d}", num) catch 0;
        this.used += ptr.len;
        return ptr;
    }

    pub fn append(this: *Headers, ctx: js.JSContextRef, key: js.JSStringRef, comptime value_type: js.JSType, value: js.JSValueRef) !void {
        this.entries.append(this.allocator, Kv{
            .key = this.appendString(key, true),
            .value = switch (comptime value_type) {
                js.JSType.kJSTypeNumber => this.appendNumber(js.JSValueToNumber(ctx, value, null)),
                js.JSType.kJSTypeString => this.appendString(value, false),
            },
        });
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Body
pub const Body = struct {
    init: Init,
    value: Value,

    pub fn deinit(this: *Body, allocator: *std.mem.Allocator) void {
        if (this.init.headers) |headers| {
            headers.buf.deinit(headers.allocator);
            headers.entries.deinit(headers.allocator);
        }

        switch (this.value) {
            .ArrayBuffer => {},
            .String => |str| {
                allocator.free(str);
            },
            .Empty => {},
        }
    }

    pub const Init = struct {
        headers: ?Headers,
        status_code: u16,

        pub fn init(allocator: *std.mem.Allocator, ctx: js.JSContextRef, init_ref: js.JSValueRef) !?Init {
            var result = Init{ .headers = null, .status_code = 0 };
            var array = js.JSObjectCopyPropertyNames(ctx, init_ref);
            defer js.JSPropertyNameArrayRelease(array);
            const count = js.JSPropertyNameArrayGetCount(array);
            var i: usize = 0;
            upper: while (i < count) : (i += 1) {
                var property_name_ref = js.JSPropertyNameArrayGetNameAtIndex(array, i);
                switch (js.JSStringGetLength(property_name_ref)) {
                    "headers".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "headers")) {
                            // only support headers as an object for now.
                            if (js.JSObjectGetProperty(ctx, init_ref, property_name_ref, null)) |header_prop| {
                                switch (js.JSValueGetType(ctx, header_prop)) {
                                    js.JSType.kJSTypeObject => {
                                        const header_keys = js.JSObjectCopyPropertyNames(ctx, header_prop);
                                        defer js.JSPropertyNameArrayRelease(header_keys);
                                        const total_header_count = js.JSPropertyNameArrayGetCount(array);
                                        if (total_header_count == 0) continue :upper;

                                        // 2 passes through the headers

                                        // Pass #1: find the "real" count.
                                        // The number of things which are strings or numbers.
                                        // Anything else should be ignored.
                                        // We could throw a TypeError, but ignoring silently is more JavaScript-like imo
                                        var real_header_count: usize = 0;
                                        var estimated_buffer_len: usize = 0;
                                        var j: usize = 0;
                                        while (j < total_header_count) : (j += 1) {
                                            var key_ref = js.JSPropertyNameArrayGetNameAtIndex(j);
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
                                                    const value_len = js.JSStringGetLength(value_ref);
                                                    if (key_len > 0 and value_len > 0) {
                                                        real_header_count += 1;
                                                        estimated_buffer_len += key_len + value_len;
                                                    }
                                                },
                                                else => {},
                                            }
                                        }

                                        if (real_header_count == 0 or estimated_buffer_len == 0) continue :upper;

                                        j = 0;
                                        var headers = Headers{
                                            .buf = try std.ArrayList(u8).initCapacity(allocator, estimated_buffer_len),
                                            .entries = std.mem.zeroes(Headers.Entries),
                                        };
                                        errdefer headers.deinit();
                                        try headers.entries.ensureTotalCapacity(allocator, real_header_count);

                                        while (j < total_header_count) : (j += 1) {
                                            var key_ref = js.JSPropertyNameArrayGetNameAtIndex(j);
                                            var value_ref = js.JSObjectGetProperty(ctx, header_prop, key_ref, null);

                                            switch (js.JSValueGetType(ctx, value_ref)) {
                                                js.JSType.kJSTypeNumber => {
                                                    if (js.JSStringGetLength(key_ref) == 0) continue;
                                                    try headers.append(ctx, key_ref, .kJSTypeNumber, value_ref);
                                                },
                                                js.JSType.kJSTypeString => {
                                                    if (js.JSStringGetLength(value_ref) == 0 or js.JSStringGetLength(key_ref) == 0) continue;
                                                    try headers.append(ctx, key_ref, .kJSTypeString, value_ref);
                                                },
                                                else => {},
                                            }
                                        }
                                        result.headers = headers;
                                    },
                                    else => {},
                                }
                            }
                        }
                    },
                    "statusCode".len => {
                        if (js.JSStringIsEqualToUTF8CString(property_name_ref, "statusCode")) {
                            var value_ref = js.JSObjectGetProperty(ctx, header_prop, key_ref, null);
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
    pub const Value = union(Tag) {
        ArrayBuffer: ArrayBuffer,
        String: string,
        Empty: u0,
        pub const Tag = enum {
            ArrayBuffer,
            String,
            Empty,
        };
    };

    pub fn @"404"(ctx: js.JSContextRef) Body {
        return Body{ .init = Init{
            .headers = null,
            .status_code = 404,
        }, .value = .{ .Empty = 0 } };
    }

    pub fn extract(ctx: js.JSContextRef, body_ref: js.JSObjectRef, exception: ExceptionValueRef) Body {
        return extractBody(ctx, body_ref, false, null);
    }

    pub fn extractWithInit(ctx: js.JSContextRef, body_ref: js.JSObjectRef, init_ref: js.JSValueRef, exception: ExceptionValueRef) Body {
        return extractBody(ctx, body_ref, true, init_ref);
    }

    // https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
    inline fn extractBody(
        ctx: js.JSContextRef,
        body_ref: js.JSObjectRef,
        comptime has_init: bool,
        init_ref: js.JSValueRef,
        exception: ExceptionValueRef,
    ) Body {
        var body = Body{ .init = Init{ .headers = null, .status_code = 200 }, .value = .{ .Empty = 0 } };

        switch (js.JSValueGetType(ctx, body_ref)) {
            js.kJSTypeString => {
                if (exception == null) {
                    var allocator = getAllocator(ctx);

                    if (has_init) {
                        body.init = Init.init(allocator, ctx, init_ref.?) catch unreachable;
                    }
                    const len = js.JSStringGetLength(body_ref);
                    if (len == 0) {
                        body.value = .{ .String = "" };
                        return body;
                    }

                    var str = try allocator.alloc(u8, len);

                    body.value = Value{ .String = str[0..js.JSStringGetUTF8CString(body_ref, str.ptr, len)] };
                    return body;
                }
            },
            js.kJSTypeObject => {
                const typed_array = js.JSValueGetTypedArrayType(ctx, body_ref, exception);
                switch (typed_array) {
                    js.JSTypedArrayType.kJSTypedArrayTypeNone => {},
                    else => {
                        const buffer = ArrayBuffer{
                            .ptr = js.JSObjectGetTypedArrayBytesPtr(ctx, body_ref, exception),
                            .offset = js.JSObjectGetTypedArrayByteOffset(ctx, body_ref, exception),
                            .len = js.JSObjectGetTypedArrayLength(ctx, body_ref, exception),
                            .byte_len = js.JSObjectGetTypedArrayLength(ctx, body_ref, exception),
                            .typed_array_type = typed_array,
                        };
                        if (exception == null) {
                            if (has_init) {
                                body.init = Init.init(allocator, ctx, init_ref.?) catch unreachable;
                            }
                            body.value = Value{ .ArrayBuffer = buffer };
                            return body;
                        }
                    },
                }
            },
            else => {},
        }

        if (exception == null) {
            JSError(getAllocator(allocator), "Body must be a string or a TypedArray (for now)", .{}, ctx, exception);
        }

        return null;
    }
};

pub const FetchEvent = struct {
    started_waiting_at: u64 = 0,
    response: ?*Response = null,
    request_context: *http.RequestContext,

    pub const Class = NewClass(
        FetchEvent,
        "FetchEvent",
        .{ .@"respondWith" = respondWith, .@"waitUntil" = waitUntil },
        .{
            .@"client" = getClient,
            .@"request" = getRequest,
        },
        true,
        false,
    );
};
