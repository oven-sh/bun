usingnamespace @import("../base.zig");
const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const http = @import("../../../http.zig");
usingnamespace @import("../javascript.zig");
usingnamespace @import("../bindings/bindings.zig");

pub const Response = struct {
    pub const Class = NewClass(
        Response,
        .{ .name = "Response" },
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
    );

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
    ) void {
        this.body.deinit(this.allocator);
        this.allocator.destroy(this);
    }

    pub fn mimeType(response: *const Response, request_ctx: *const http.RequestContext) string {
        if (response.body.init.headers) |headers| {
            // Remember, we always lowercase it
            // hopefully doesn't matter here tho
            if (headers.getHeaderIndex("content-type")) |content_type| {
                return headers.asStr(headers.entries.items(.value)[content_type]);
            }
        }

        if (request_ctx.url.extname.len > 0) {
            return http.MimeType.byExtension(request_ctx.url.extname).value;
        }

        switch (response.body.value) {
            .Empty => {
                return "text/plain";
            },
            .String => |body| {
                // poor man's mimetype sniffing
                if (body.len > 0 and (body[0] == '{' or body[0] == '[')) {
                    return http.MimeType.json.value;
                }

                return http.MimeType.html.value;
            },
            .ArrayBuffer => {
                return "application/octet-stream";
            },
        }
    }

    pub fn constructor(
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        const body: Body = brk: {
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

        // if (exception != null) {
        //     return null;
        // }

        var response = getAllocator(ctx).create(Response) catch unreachable;
        response.* = Response{
            .body = body,
            .allocator = getAllocator(ctx),
        };
        return Response.Class.make(
            ctx,
            response,
        );
    }
};

// https://developer.mozilla.org/en-US/docs/Web/API/Headers
pub const Headers = struct {
    pub const Kv = struct {
        name: Api.StringPointer,
        value: Api.StringPointer,
    };
    pub const Entries = std.MultiArrayList(Kv);
    entries: Entries,
    buf: std.ArrayListUnmanaged(u8),
    allocator: *std.mem.Allocator,
    used: u32 = 0,
    guard: Guard = Guard.none,

    pub fn deinit(
        headers: *Headers,
    ) void {
        headers.buf.deinit(headers.allocator);
        headers.entries.deinit(headers.allocator);
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/Headers#methods
    pub const JS = struct {

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/get
        pub fn get(
            this: *Headers,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
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
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            if (this.guard == .request or arguments.len < 2 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringIsEqual(arguments[0], Properties.Refs.empty_string) or !js.JSValueIsString(ctx, arguments[1])) {
                return js.JSValueMakeUndefined(ctx);
            }

            this.putHeader(arguments[0], arguments[1], false);
            return js.JSValueMakeUndefined(ctx);
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/append
        pub fn append(
            this: *Headers,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            if (this.guard == .request or arguments.len < 2 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringIsEqual(arguments[0], Properties.Refs.empty_string) or !js.JSValueIsString(ctx, arguments[1])) {
                return js.JSValueMakeUndefined(ctx);
            }

            this.putHeader(arguments[0], arguments[1], true);
            return js.JSValueMakeUndefined(ctx);
        }
        pub fn delete(
            this: *Headers,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
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
            this: *Headers,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("<r><b>Headers.entries()<r> is not implemented yet - sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }
        pub fn keys(
            this: *Headers,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("H<r><b>eaders.keys()<r> is not implemented yet- sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }
        pub fn values(
            this: *Headers,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            Output.prettyErrorln("<r><b>Headers.values()<r> is not implemented yet - sorry!!", .{});
            return js.JSValueMakeNull(ctx);
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/Headers/Headers
        pub fn constructor(
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            var headers = getAllocator(ctx).create(Headers) catch unreachable;
            if (arguments.len > 0 and js.JSValueIsObjectOfClass(ctx, arguments[0], Headers.Class.get().*)) {
                var other = castObj(arguments[0], Headers);
                other.clone(headers) catch unreachable;
            } else {
                headers.* = Headers{
                    .entries = @TypeOf(headers.entries){},
                    .buf = @TypeOf(headers.buf){},
                    .used = 0,
                    .allocator = getAllocator(ctx),
                    .guard = Guard.none,
                };
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

    // TODO: is it worth making this lazy? instead of copying all the request headers, should we just do it on get/put/iterator?
    pub fn fromRequestCtx(allocator: *std.mem.Allocator, request: *http.RequestContext) !Headers {
        var total_len: usize = 0;
        for (request.request.headers) |header| {
            total_len += header.name.len;
            total_len += header.value.len;
        }
        // for the null bytes
        total_len += request.request.headers.len * 2;
        var headers = Headers{
            .allocator = allocator,
            .entries = Entries{},
            .buf = std.ArrayListUnmanaged(u8){},
        };
        try headers.entries.ensureTotalCapacity(allocator, request.request.headers.len);
        try headers.buf.ensureTotalCapacity(allocator, total_len);
        headers.buf.expandToCapacity();
        headers.guard = Guard.request;

        for (request.request.headers) |header| {
            headers.entries.appendAssumeCapacity(Kv{
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

        headers.guard = Guard.immutable;

        return headers;
    }

    pub fn asStr(headers: *const Headers, ptr: Api.StringPointer) []u8 {
        return headers.buf.items[ptr.offset..][0..ptr.length];
    }

    threadlocal var header_kv_buf: [4096]u8 = undefined;

    pub fn putHeader(headers: *Headers, key_: js.JSStringRef, value_: js.JSStringRef, comptime append: bool) void {
        const key_len = js.JSStringGetUTF8CString(key_, &header_kv_buf, header_kv_buf.len) - 1;
        // TODO: make this one pass instead of two
        var key = strings.trim(header_kv_buf[0..key_len], " \n\r");
        key = std.ascii.lowerString(key[0..key.len], key);

        var remainder = header_kv_buf[key.len..];
        const value_len = js.JSStringGetUTF8CString(value_, remainder.ptr, remainder.len) - 1;
        var value = strings.trim(remainder[0..value_len], " \n\r");

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
            Kv{
                .name = headers.appendString(
                    string,
                    key,
                    needs_lowercase,
                    needs_normalize,
                    append_null,
                ),
                .value = headers.appendString(
                    string,
                    key,
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
        std.debug.assert(ptr.length > 0);

        std.debug.assert(this.buf.items.len >= ptr.offset + ptr.length);
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
        this.entries.append(this.allocator, Kv{
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

    pub fn deinit(this: *Body, allocator: *std.mem.Allocator) void {
        if (this.init.headers) |headers| {
            headers.deinit();
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

                                        if (real_header_count == 0 or estimated_buffer_len == 0) continue :upper;

                                        j = 0;
                                        var headers = Headers{
                                            .allocator = allocator,
                                            .buf = try std.ArrayListUnmanaged(u8).initCapacity(allocator, estimated_buffer_len),
                                            .entries = Headers.Entries{},
                                        };
                                        errdefer headers.deinit();
                                        try headers.entries.ensureTotalCapacity(allocator, real_header_count);

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
                                        result.headers = headers;
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
    pub const Value = union(Tag) {
        ArrayBuffer: ArrayBuffer,
        String: string,
        Empty: u0,
        pub const Tag = enum {
            ArrayBuffer,
            String,
            Empty,
        };

        pub fn length(value: *const Value) usize {
            switch (value.*) {
                .ArrayBuffer => |buf| {
                    return buf.ptr[buf.offset..buf.byte_len].len;
                },
                .String => |str| {
                    return str.len;
                },
                .Empty => {
                    return 0;
                },
            }
        }
    };

    pub fn @"404"(ctx: js.JSContextRef) Body {
        return Body{ .init = Init{
            .headers = null,
            .status_code = 404,
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

        switch (js.JSValueGetType(ctx, body_ref)) {
            .kJSTypeString => {
                var allocator = getAllocator(ctx);

                if (comptime has_init) {
                    if (Init.init(allocator, ctx, init_ref.?)) |maybeInit| {
                        if (maybeInit) |init_| {
                            body.init = init_;
                        }
                    } else |err| {}
                }

                var str = JSValue.fromRef(body_ref).toWTFString(VirtualMachine.vm.global);
                const len = str.length();
                if (len == 0) {
                    body.value = .{ .String = "" };
                    return body;
                }

                body.value = Value{ .String = str.characters8()[0..len] };
                return body;
            },
            .kJSTypeObject => {
                const typed_array = js.JSValueGetTypedArrayType(ctx, body_ref, exception);
                switch (typed_array) {
                    js.JSTypedArrayType.kJSTypedArrayTypeNone => {},
                    else => {
                        const buffer = ArrayBuffer{
                            .ptr = @ptrCast([*]u8, js.JSObjectGetTypedArrayBytesPtr(ctx, body_ref.?, exception).?),
                            .offset = @truncate(u32, js.JSObjectGetTypedArrayByteOffset(ctx, body_ref.?, exception)),
                            .len = @truncate(u32, js.JSObjectGetTypedArrayLength(ctx, body_ref.?, exception)),
                            .byte_len = @truncate(u32, js.JSObjectGetTypedArrayLength(ctx, body_ref.?, exception)),
                            .typed_array_type = typed_array,
                        };
                        var allocator = getAllocator(ctx);

                        if (comptime has_init) {
                            if (Init.init(allocator, ctx, init_ref.?)) |maybeInit| {
                                if (maybeInit) |init_| {
                                    body.init = init_;
                                }
                            } else |err| {}
                        }
                        body.value = Value{ .ArrayBuffer = buffer };
                        return body;
                    },
                }
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
    request_context: *http.RequestContext,
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
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.default);
    }
    pub fn getCredentials(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.include);
    }
    pub fn getDestination(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.empty_string);
    }
    pub fn getHeaders(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.headers == null) {
            this.headers = Headers.fromRequestCtx(getAllocator(ctx), this.request_context) catch unreachable;
        }

        return Headers.Class.make(ctx, &this.headers.?);
    }
    pub fn getIntegrity(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.empty_string);
    }
    pub fn getMethod(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        const string_ref = switch (this.request_context.method) {
            .GET => Properties.Refs.GET,
            .HEAD => Properties.Refs.HEAD,
            .PATCH => Properties.Refs.PATCH,
            .PUT => Properties.Refs.PUT,
            .POST => Properties.Refs.POST,
            .OPTIONS => Properties.Refs.OPTIONS,
            else => Properties.Refs.empty_string,
        };
        return js.JSValueMakeString(ctx, string_ref);
    }

    pub fn getMode(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.navigate);
    }
    pub fn getRedirect(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.follow);
    }
    pub fn getReferrer(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.empty_string);
    }
    pub fn getReferrerPolicy(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeString(ctx, Properties.Refs.empty_string);
    }
    pub fn getUrl(
        this: *Request,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
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
    request_context: *http.RequestContext,
    request: Request,

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
        this: *FetchEvent,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        Output.prettyErrorln("FetchEvent.client is not implemented yet - sorry!!", .{});
        Output.flush();
        return js.JSValueMakeUndefined(ctx);
    }
    pub fn getRequest(
        this: *FetchEvent,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return Request.Class.make(ctx, &this.request);
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
    pub fn respondWith(
        this: *FetchEvent,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.request_context.has_called_done) return js.JSValueMakeUndefined(ctx);

        // A Response or a Promise that resolves to a Response. Otherwise, a network error is returned to Fetch.
        if (arguments.len == 0 or !Response.Class.loaded) {
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            this.request_context.sendInternalError(error.respondWithWasEmpty) catch {};
            return js.JSValueMakeUndefined(ctx);
        }

        var resolved = JSInternalPromise.resolvedPromise(VirtualMachine.vm.global, JSValue.fromRef(arguments[0]));

        var status = resolved.status(VirtualMachine.vm.global.vm());

        if (status == .Pending) {
            VirtualMachine.vm.global.vm().drainMicrotasks();
        }

        status = resolved.status(VirtualMachine.vm.global.vm());

        switch (status) {
            .Fulfilled => {},
            else => {
                this.request_context.sendInternalError(error.rejectedPromise) catch {};
                return js.JSValueMakeUndefined(ctx);
            },
        }

        var arg = resolved.result(VirtualMachine.vm.global.vm()).asObjectRef();

        if (!js.JSValueIsObjectOfClass(ctx, arg, Response.Class.ref)) {
            JSError(getAllocator(ctx), "event.respondWith() must be a Response or a Promise<Response>.", .{}, ctx, exception);
            this.request_context.sendInternalError(error.respondWithWasEmpty) catch {};
            return js.JSValueMakeUndefined(ctx);
        }

        var response: *Response = GetJSPrivateData(Response, arg) orelse {
            JSError(getAllocator(ctx), "event.respondWith()'s Response object was invalid. This may be an internal error.", .{}, ctx, exception);
            this.request_context.sendInternalError(error.respondWithWasInvalid) catch {};
            return js.JSValueMakeUndefined(ctx);
        };

        defer this.request_context.arena.deinit();

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

    pub fn waitUntil(
        this: *FetchEvent,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
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
