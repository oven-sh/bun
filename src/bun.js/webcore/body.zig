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

const Blob = JSC.WebCore.Blob;
const InlineBlob = JSC.WebCore.InlineBlob;
const AnyBlob = JSC.WebCore.AnyBlob;
const InternalBlob = JSC.WebCore.InternalBlob;
const Response = JSC.WebCore.Response;
const Request = JSC.WebCore.Request;

// https://developer.mozilla.org/en-US/docs/Web/API/Body
pub const Body = struct {
    init: Init = Init{ .headers = null, .status_code = 200 },
    value: Value, // = Value.empty,

    pub inline fn len(this: *const Body) Blob.SizeType {
        return this.value.size();
    }

    pub fn slice(this: *const Body) []const u8 {
        return this.value.slice();
    }

    pub fn use(this: *Body) Blob {
        return this.value.use();
    }

    pub fn clone(this: *Body, globalThis: *JSGlobalObject) Body {
        return Body{
            .init = this.init.clone(globalThis),
            .value = this.value.clone(globalThis),
        };
    }

    pub fn writeFormat(this: *const Body, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("bodyUsed: ");
        formatter.printAs(.Boolean, Writer, writer, JSC.JSValue.jsBoolean(this.value == .Used), .BooleanObject, enable_ansi_colors);
        formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
        try writer.writeAll("\n");

        // if (this.init.headers) |headers| {
        //     try formatter.writeIndent(Writer, writer);
        //     try writer.writeAll("headers: ");
        //     try headers.leak().writeFormat(formatter, writer, comptime enable_ansi_colors);
        //     try writer.writeAll("\n");
        // }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("status: ");
        formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(this.init.status_code), .NumberObject, enable_ansi_colors);
        if (this.value == .Blob) {
            try formatter.printComma(Writer, writer, enable_ansi_colors);
            try writer.writeAll("\n");
            try formatter.writeIndent(Writer, writer);
            try this.value.Blob.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
        } else if (this.value == .InternalBlob) {
            try formatter.printComma(Writer, writer, enable_ansi_colors);
            try writer.writeAll("\n");
            try formatter.writeIndent(Writer, writer);
            try Blob.writeFormatForSize(this.value.size(), writer, enable_ansi_colors);
        } else if (this.value == .Locked) {
            if (this.value.Locked.readable) |stream| {
                try formatter.printComma(Writer, writer, enable_ansi_colors);
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                formatter.printAs(.Object, Writer, writer, stream.value, stream.value.jsType(), enable_ansi_colors);
            }
        }
    }

    pub fn deinit(this: *Body, _: std.mem.Allocator) void {
        if (this.init.headers) |headers| {
            this.init.headers = null;

            headers.deref();
        }
        this.value.deinit();
    }

    pub const Init = struct {
        headers: ?*FetchHeaders = null,
        status_code: u16,
        method: Method = Method.GET,

        pub fn clone(this: Init, ctx: *JSGlobalObject) Init {
            var that = this;
            var headers = this.headers;
            if (headers) |head| {
                that.headers = head.cloneThis(ctx);
            }

            return that;
        }

        pub fn init(allocator: std.mem.Allocator, ctx: *JSGlobalObject, response_init: JSC.JSValue) !?Init {
            var result = Init{ .status_code = 200 };

            if (!response_init.isCell())
                return null;

            if (response_init.jsType() == .DOMWrapper) {
                // fast path: it's a Request object or a Response object
                // we can skip calling JS getters
                if (response_init.as(Request)) |req| {
                    if (req.headers) |headers| {
                        if (!headers.isEmpty()) {
                            result.headers = headers.cloneThis(ctx);
                        }
                    }

                    result.method = req.method;
                    return result;
                }

                if (response_init.as(Response)) |req| {
                    return req.body.init.clone(ctx);
                }
            }

            if (response_init.fastGet(ctx, .headers)) |headers| {
                if (headers.as(FetchHeaders)) |orig| {
                    if (!orig.isEmpty()) {
                        result.headers = orig.cloneThis(ctx);
                    }
                } else {
                    result.headers = FetchHeaders.createFromJS(ctx.ptr(), headers);
                }
            }

            if (response_init.fastGet(ctx, .status)) |status_value| {
                const number = status_value.coerceToInt64(ctx);
                if ((200 <= number and number < 600) or number == 101) {
                    result.status_code = @truncate(u16, @intCast(u32, number));
                } else {
                    const err = ctx.createRangeErrorInstance("The status provided ({d}) must be 101 or in the range of [200, 599]", .{number});
                    ctx.throwValue(err);
                    return null;
                }
            }

            if (response_init.fastGet(ctx, .method)) |method_value| {
                var method_str = method_value.toSlice(ctx, allocator);
                defer method_str.deinit();
                if (method_str.len > 0) {
                    result.method = Method.which(method_str.slice()) orelse .GET;
                }
            }

            return result;
        }
    };

    pub const PendingValue = struct {
        promise: ?JSValue = null,
        readable: ?JSC.WebCore.ReadableStream = null,
        // writable: JSC.WebCore.Sink

        global: *JSGlobalObject,
        task: ?*anyopaque = null,

        /// runs after the data is available.
        onReceiveValue: ?*const fn (ctx: *anyopaque, value: *Value) void = null,

        /// conditionally runs when requesting data
        /// used in HTTP server to ignore request bodies unless asked for it
        onStartBuffering: ?*const fn (ctx: *anyopaque) void = null,
        onStartStreaming: ?*const fn (ctx: *anyopaque) JSC.WebCore.DrainResult = null,

        deinit: bool = false,
        action: Action = Action{ .none = {} },

        pub fn toAnyBlob(this: *PendingValue) ?AnyBlob {
            if (this.promise != null)
                return null;

            return this.toAnyBlobAllowPromise();
        }

        pub fn toAnyBlobAllowPromise(this: *PendingValue) ?AnyBlob {
            var stream = if (this.readable != null) &this.readable.? else return null;

            if (stream.toAnyBlob(this.global)) |blob| {
                this.readable = null;
                return blob;
            }

            return null;
        }

        pub fn setPromise(value: *PendingValue, globalThis: *JSC.JSGlobalObject, action: Action) JSValue {
            value.action = action;

            if (value.readable) |readable| {
                // switch (readable.ptr) {
                //     .JavaScript
                // }
                switch (action) {
                    .getText, .getJSON, .getBlob, .getArrayBuffer => {
                        value.promise = switch (action) {
                            .getJSON => globalThis.readableStreamToJSON(readable.value),
                            .getArrayBuffer => globalThis.readableStreamToArrayBuffer(readable.value),
                            .getText => globalThis.readableStreamToText(readable.value),
                            .getBlob => globalThis.readableStreamToBlob(readable.value),
                            else => unreachable,
                        };
                        value.promise.?.ensureStillAlive();
                        readable.value.unprotect();

                        // js now owns the memory
                        value.readable = null;

                        return value.promise.?;
                    },
                    // TODO:
                    .getFormData => {},

                    .none => {},
                }
            }

            {
                var promise = JSC.JSPromise.create(globalThis);
                const promise_value = promise.asValue(globalThis);
                value.promise = promise_value;

                if (value.onStartBuffering) |onStartBuffering| {
                    value.onStartBuffering = null;
                    onStartBuffering(value.task.?);
                }
                return promise_value;
            }
        }

        pub const Action = union(enum) {
            none: void,
            getText: void,
            getJSON: void,
            getArrayBuffer: void,
            getBlob: void,
            getFormData: ?*bun.FormData.AsyncFormData,
        };
    };

    /// This is a duplex stream!
    pub const Value = union(Tag) {
        Blob: Blob,
        /// Single-use Blob
        /// Avoids a heap allocation.
        InternalBlob: InternalBlob,
        /// Single-use Blob that stores the bytes in the Value itself.
        // InlineBlob: InlineBlob,
        Locked: PendingValue,
        Used: void,
        Empty: void,
        Error: JSValue,
        Null: void,

        pub fn toBlobIfPossible(this: *Value) void {
            if (this.* != .Locked)
                return;

            if (this.Locked.toAnyBlob()) |blob| {
                this.* = switch (blob) {
                    .Blob => .{ .Blob = blob.Blob },
                    .InternalBlob => .{ .InternalBlob = blob.InternalBlob },
                    // .InlineBlob => .{ .InlineBlob = blob.InlineBlob },
                };
            }
        }

        pub fn size(this: *const Value) Blob.SizeType {
            return switch (this.*) {
                .Blob => this.Blob.size,
                .InternalBlob => @truncate(Blob.SizeType, this.InternalBlob.sliceConst().len),
                // .InlineBlob => @truncate(Blob.SizeType, this.InlineBlob.sliceConst().len),
                else => 0,
            };
        }

        pub fn estimatedSize(this: *const Value) usize {
            return switch (this.*) {
                .InternalBlob => this.InternalBlob.sliceConst().len,
                // .InlineBlob => this.InlineBlob.sliceConst().len,
                else => 0,
            };
        }

        pub fn createBlobValue(data: []u8, allocator: std.mem.Allocator, was_string: bool) Value {
            // if (data.len <= InlineBlob.available_bytes) {
            //     var _blob = InlineBlob{
            //         .bytes = undefined,
            //         .was_string = was_string,
            //         .len = @truncate(InlineBlob.IntSize, data.len),
            //     };
            //     @memcpy(&_blob.bytes, data.ptr, data.len);
            //     allocator.free(data);
            //     return Value{
            //         .InlineBlob = _blob,
            //     };
            // }

            return Value{
                .InternalBlob = InternalBlob{
                    .bytes = std.ArrayList(u8).fromOwnedSlice(allocator, data),
                    .was_string = was_string,
                },
            };
        }

        pub const Tag = enum {
            Blob,
            InternalBlob,
            // InlineBlob,
            Locked,
            Used,
            Empty,
            Error,
            Null,
        };

        // pub const empty = Value{ .Empty = {} };

        pub fn toReadableStream(this: *Value, globalThis: *JSGlobalObject) JSValue {
            JSC.markBinding(@src());

            switch (this.*) {
                .Used, .Empty => {
                    return JSC.WebCore.ReadableStream.empty(globalThis);
                },
                .Null => {
                    return JSValue.null;
                },
                .InternalBlob,
                .Blob,
                // .InlineBlob,
                => {
                    var blob = this.use();
                    defer blob.detach();
                    blob.resolveSize();
                    const value = JSC.WebCore.ReadableStream.fromBlob(globalThis, &blob, blob.size);

                    this.* = .{
                        .Locked = .{
                            .readable = JSC.WebCore.ReadableStream.fromJS(value, globalThis).?,
                            .global = globalThis,
                        },
                    };
                    this.Locked.readable.?.value.protect();

                    return value;
                },
                .Locked => {
                    var locked = &this.Locked;
                    if (locked.readable) |readable| {
                        return readable.value;
                    }
                    var drain_result: JSC.WebCore.DrainResult = .{
                        .estimated_size = 0,
                    };

                    if (locked.onStartStreaming) |drain| {
                        locked.onStartStreaming = null;
                        drain_result = drain(locked.task.?);
                    }

                    if (drain_result == .empty or drain_result == .aborted) {
                        this.* = .{ .Null = {} };
                        return JSC.WebCore.ReadableStream.empty(globalThis);
                    }

                    var reader = bun.default_allocator.create(JSC.WebCore.ByteStream.Source) catch unreachable;
                    reader.* = .{
                        .context = undefined,
                        .globalThis = globalThis,
                    };

                    reader.context.setup();

                    if (drain_result == .estimated_size) {
                        reader.context.highWaterMark = @truncate(Blob.SizeType, drain_result.estimated_size);
                        reader.context.size_hint = @truncate(Blob.SizeType, drain_result.estimated_size);
                    } else if (drain_result == .owned) {
                        reader.context.buffer = drain_result.owned.list;
                        reader.context.size_hint = @truncate(Blob.SizeType, drain_result.owned.size_hint);
                    }

                    locked.readable = .{
                        .ptr = .{ .Bytes = &reader.context },
                        .value = reader.toJS(globalThis),
                    };

                    locked.readable.?.value.protect();
                    return locked.readable.?.value;
                },

                else => unreachable,
            }
        }

        pub fn fromJS(
            globalThis: *JSGlobalObject,
            value: JSValue,
        ) ?Value {
            value.ensureStillAlive();

            if (value.isEmptyOrUndefinedOrNull()) {
                return Body.Value{
                    .Null = {},
                };
            }

            const js_type = value.jsType();

            if (js_type.isStringLike()) {
                var str = value.getZigString(globalThis);
                if (str.len == 0) {
                    return Body.Value{
                        .Empty = {},
                    };
                }

                // if (str.is16Bit()) {
                //     if (str.maxUTF8ByteLength() < InlineBlob.available_bytes or
                //         (str.len <= InlineBlob.available_bytes and str.utf8ByteLength() <= InlineBlob.available_bytes))
                //     {
                //         var blob = InlineBlob{
                //             .was_string = true,
                //             .bytes = undefined,
                //             .len = 0,
                //         };
                //         if (comptime Environment.allow_assert) {
                //             std.debug.assert(str.utf8ByteLength() <= InlineBlob.available_bytes);
                //         }

                //         const result = strings.copyUTF16IntoUTF8(
                //             blob.bytes[0..blob.bytes.len],
                //             []const u16,
                //             str.utf16SliceAligned(),
                //             true,
                //         );
                //         blob.len = @intCast(InlineBlob.IntSize, result.written);
                //         std.debug.assert(@as(usize, result.read) == str.len);
                //         std.debug.assert(@as(usize, result.written) <= InlineBlob.available_bytes);

                //         return Body.Value{
                //             .InlineBlob = blob,
                //         };
                //     }
                // } else {
                //     if (str.maxUTF8ByteLength() <= InlineBlob.available_bytes or
                //         (str.len <= InlineBlob.available_bytes and str.utf8ByteLength() <= InlineBlob.available_bytes))
                //     {
                //         var blob = InlineBlob{
                //             .was_string = true,
                //             .bytes = undefined,
                //             .len = 0,
                //         };
                //         if (comptime Environment.allow_assert) {
                //             std.debug.assert(str.utf8ByteLength() <= InlineBlob.available_bytes);
                //         }
                //         const result = strings.copyLatin1IntoUTF8(
                //             blob.bytes[0..blob.bytes.len],
                //             []const u8,
                //             str.slice(),
                //         );
                //         blob.len = @intCast(InlineBlob.IntSize, result.written);
                //         std.debug.assert(@as(usize, result.read) == str.len);
                //         std.debug.assert(@as(usize, result.written) <= InlineBlob.available_bytes);
                //         return Body.Value{
                //             .InlineBlob = blob,
                //         };
                //     }
                // }

                var buffer = str.toOwnedSlice(bun.default_allocator) catch {
                    globalThis.vm().throwError(globalThis, ZigString.static("Failed to clone string").toErrorInstance(globalThis));
                    return null;
                };

                return Body.Value{
                    .InternalBlob = .{
                        .bytes = std.ArrayList(u8).fromOwnedSlice(bun.default_allocator, buffer),
                        .was_string = true,
                    },
                };
            }

            if (js_type.isTypedArray()) {
                if (value.asArrayBuffer(globalThis)) |buffer| {
                    var bytes = buffer.byteSlice();

                    if (bytes.len == 0) {
                        return Body.Value{
                            .Empty = {},
                        };
                    }

                    // if (bytes.len <= InlineBlob.available_bytes) {
                    //     return Body.Value{
                    //         .InlineBlob = InlineBlob.init(bytes),
                    //     };
                    // }

                    return Body.Value{
                        .InternalBlob = .{
                            .bytes = std.ArrayList(u8){
                                .items = bun.default_allocator.dupe(u8, bytes) catch {
                                    globalThis.vm().throwError(globalThis, ZigString.static("Failed to clone ArrayBufferView").toErrorInstance(globalThis));
                                    return null;
                                },
                                .capacity = bytes.len,
                                .allocator = bun.default_allocator,
                            },
                            .was_string = false,
                        },
                    };
                }
            }

            if (value.as(JSC.DOMFormData)) |form_data| {
                return Body.Value{
                    .Blob = Blob.fromDOMFormData(globalThis, globalThis.allocator(), form_data),
                };
            }

            if (value.as(JSC.URLSearchParams)) |search_params| {
                return Body.Value{
                    .Blob = Blob.fromURLSearchParams(globalThis, globalThis.allocator(), search_params),
                };
            }

            if (js_type == .DOMWrapper) {
                if (value.as(Blob)) |blob| {
                    return Body.Value{
                        .Blob = blob.dupe(),
                    };
                }
            }

            value.ensureStillAlive();

            if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |readable| {
                switch (readable.ptr) {
                    .Blob => |blob| {
                        var result: Value = .{
                            .Blob = Blob.initWithStore(blob.store, globalThis),
                        };
                        blob.store.ref();

                        readable.done();

                        if (!blob.done) {
                            blob.done = true;
                            blob.deinit();
                        }
                        return result;
                    },
                    else => {},
                }

                return Body.Value.fromReadableStream(readable, globalThis);
            }

            return Body.Value{
                .Blob = Blob.get(globalThis, value, true, false) catch |err| {
                    if (err == error.InvalidArguments) {
                        globalThis.throwInvalidArguments("Expected an Array", .{});
                        return null;
                    }

                    globalThis.throwInvalidArguments("Invalid Body object", .{});
                    return null;
                },
            };
        }

        pub fn fromReadableStream(readable: JSC.WebCore.ReadableStream, globalThis: *JSGlobalObject) Value {
            if (readable.isLocked(globalThis)) {
                return .{ .Error = ZigString.init("Cannot use a locked ReadableStream").toErrorInstance(globalThis) };
            }

            readable.value.protect();
            return .{
                .Locked = .{
                    .readable = readable,
                    .global = globalThis,
                },
            };
        }

        pub fn resolve(to_resolve: *Value, new: *Value, global: *JSGlobalObject) void {
            if (to_resolve.* == .Locked) {
                var locked = &to_resolve.Locked;
                if (locked.readable) |readable| {
                    readable.done();
                    locked.readable = null;
                }

                if (locked.onReceiveValue) |callback| {
                    locked.onReceiveValue = null;
                    callback(locked.task.?, new);
                    return;
                }

                if (locked.promise) |promise_| {
                    const promise = promise_.asAnyPromise().?;
                    locked.promise = null;

                    switch (locked.action) {
                        .getText => {
                            switch (new.*) {
                                .InternalBlob,
                                // .InlineBlob,
                                => {
                                    var blob = new.useAsAnyBlob();
                                    promise.resolve(global, blob.toString(global, .transfer));
                                },
                                else => {
                                    var blob = new.use();
                                    promise.resolve(global, blob.toString(global, .transfer));
                                },
                            }
                        },
                        .getJSON => {
                            var blob = new.useAsAnyBlob();
                            const json_value = blob.toJSON(global, .share);
                            blob.detach();

                            if (json_value.isAnyError()) {
                                promise.reject(global, json_value);
                            } else {
                                promise.resolve(global, json_value);
                            }
                        },
                        .getArrayBuffer => {
                            var blob = new.useAsAnyBlob();
                            promise.resolve(global, blob.toArrayBuffer(global, .transfer));
                        },
                        .getFormData => inner: {
                            var blob = new.useAsAnyBlob();
                            defer blob.detach();
                            var async_form_data = locked.action.getFormData orelse {
                                promise.reject(global, ZigString.init("Internal error: task for FormData must not be null").toErrorInstance(global));
                                break :inner;
                            };
                            defer async_form_data.deinit();
                            async_form_data.toJS(global, blob.slice(), promise);
                        },
                        else => {
                            var ptr = bun.default_allocator.create(Blob) catch unreachable;
                            ptr.* = new.use();
                            ptr.allocator = bun.default_allocator;
                            promise.resolve(global, ptr.toJS(global));
                        },
                    }
                    JSC.C.JSValueUnprotect(global, promise_.asObjectRef());
                }
            }
        }
        pub fn slice(this: *const Value) []const u8 {
            return switch (this.*) {
                .Blob => this.Blob.sharedView(),
                .InternalBlob => this.InternalBlob.sliceConst(),
                // .InlineBlob => this.InlineBlob.sliceConst(),
                else => "",
            };
        }

        pub fn use(this: *Value) Blob {
            this.toBlobIfPossible();

            switch (this.*) {
                .Blob => {
                    var new_blob = this.Blob;
                    std.debug.assert(new_blob.allocator == null); // owned by Body
                    this.* = .{ .Used = {} };
                    return new_blob;
                },
                .InternalBlob => {
                    var new_blob = Blob.init(
                        this.InternalBlob.toOwnedSlice(),
                        // we will never resize it from here
                        // we have to use the default allocator
                        // even if it was actually allocated on a different thread
                        bun.default_allocator,
                        JSC.VirtualMachine.get().global,
                    );

                    this.* = .{ .Used = {} };
                    return new_blob;
                },
                // .InlineBlob => {
                //     const cloned = this.InlineBlob.bytes;
                //     const new_blob = Blob.create(
                //         cloned[0..this.InlineBlob.len],
                //         bun.default_allocator,
                //         JSC.VirtualMachine.get().global,
                //         this.InlineBlob.was_string,
                //     );

                //     this.* = .{ .Used = {} };
                //     return new_blob;
                // },
                else => {
                    return Blob.initEmpty(undefined);
                },
            }
        }

        pub fn tryUseAsAnyBlob(this: *Value) ?AnyBlob {
            const any_blob: AnyBlob = switch (this.*) {
                .Blob => AnyBlob{ .Blob = this.Blob },
                .InternalBlob => AnyBlob{ .InternalBlob = this.InternalBlob },
                // .InlineBlob => AnyBlob{ .InlineBlob = this.InlineBlob },
                .Locked => this.Locked.toAnyBlobAllowPromise() orelse return null,
                else => return null,
            };

            this.* = .{ .Used = {} };
            return any_blob;
        }

        pub fn useAsAnyBlob(this: *Value) AnyBlob {
            const any_blob: AnyBlob = switch (this.*) {
                .Blob => .{ .Blob = this.Blob },
                .InternalBlob => .{ .InternalBlob = this.InternalBlob },
                // .InlineBlob => .{ .InlineBlob = this.InlineBlob },
                .Locked => this.Locked.toAnyBlobAllowPromise() orelse AnyBlob{ .Blob = .{} },
                else => .{ .Blob = Blob.initEmpty(undefined) },
            };

            this.* = if (this.* == .Null)
                .{ .Null = {} }
            else
                .{ .Used = {} };
            return any_blob;
        }

        pub fn toErrorInstance(this: *Value, error_instance: JSC.JSValue, global: *JSGlobalObject) void {
            if (this.* == .Locked) {
                var locked = this.Locked;
                locked.deinit = true;
                if (locked.promise) |promise| {
                    if (promise.asAnyPromise()) |internal| {
                        internal.reject(global, error_instance);
                    }
                    JSC.C.JSValueUnprotect(global, promise.asObjectRef());
                    locked.promise = null;
                }

                if (locked.readable) |readable| {
                    readable.done();
                    locked.readable = null;
                }

                this.* = .{ .Error = error_instance };
                if (locked.onReceiveValue) |onReceiveValue| {
                    locked.onReceiveValue = null;
                    onReceiveValue(locked.task.?, this);
                }
                return;
            }

            this.* = .{ .Error = error_instance };
        }

        pub fn toErrorString(this: *Value, comptime err: string, global: *JSGlobalObject) void {
            var error_str = ZigString.init(err);
            var error_instance = error_str.toErrorInstance(global);
            return this.toErrorInstance(error_instance, global);
        }

        pub fn toError(this: *Value, err: anyerror, global: *JSGlobalObject) void {
            var error_str = ZigString.init(std.fmt.allocPrint(
                bun.default_allocator,
                "Error reading file {s}",
                .{@errorName(err)},
            ) catch unreachable);
            error_str.mark();
            var error_instance = error_str.toErrorInstance(global);
            return this.toErrorInstance(error_instance, global);
        }

        pub fn deinit(this: *Value) void {
            const tag = @as(Tag, this.*);
            if (tag == .Locked) {
                if (!this.Locked.deinit) {
                    this.Locked.deinit = true;

                    if (this.Locked.readable) |*readable| {
                        readable.done();
                    }
                }

                return;
            }

            if (tag == .InternalBlob) {
                this.InternalBlob.clearAndFree();
                this.* = Value{ .Null = {} };
            }

            if (tag == .Blob) {
                this.Blob.deinit();
                this.* = Value{ .Null = {} };
            }

            if (tag == .Error) {
                JSC.C.JSValueUnprotect(VirtualMachine.get().global, this.Error.asObjectRef());
            }
        }

        pub fn clone(this: *Value, globalThis: *JSC.JSGlobalObject) Value {
            if (this.* == .InternalBlob) {
                var internal_blob = this.InternalBlob;
                this.* = .{
                    .Blob = Blob.init(
                        internal_blob.toOwnedSlice(),
                        internal_blob.bytes.allocator,
                        globalThis,
                    ),
                };
            }

            // if (this.* == .InlineBlob) {
            //     return this.*;
            // }

            if (this.* == .Blob) {
                return Value{ .Blob = this.Blob.dupe() };
            }

            if (this.* == .Null) {
                return Value{ .Null = {} };
            }

            return Value{ .Empty = {} };
        }
    };

    pub fn @"404"(_: js.JSContextRef) Body {
        return Body{
            .init = Init{
                .headers = null,
                .status_code = 404,
            },
            .value = Value{ .Null = {} },
        };
    }

    pub fn @"200"(_: js.JSContextRef) Body {
        return Body{
            .init = Init{
                .status_code = 200,
            },
            .value = Value{ .Null = {} },
        };
    }

    pub fn extract(
        globalThis: *JSGlobalObject,
        value: JSValue,
    ) ?Body {
        return extractBody(
            globalThis,
            value,
            false,
            JSValue.zero,
        );
    }

    pub fn extractWithInit(
        globalThis: *JSGlobalObject,
        value: JSValue,
        init: JSValue,
    ) ?Body {
        return extractBody(
            globalThis,
            value,
            true,
            init,
        );
    }

    // https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
    inline fn extractBody(
        globalThis: *JSGlobalObject,
        value: JSValue,
        comptime has_init: bool,
        init: JSValue,
    ) ?Body {
        var body = Body{
            .value = Value{ .Null = {} },
            .init = Init{ .headers = null, .status_code = 200 },
        };
        var allocator = getAllocator(globalThis);

        if (comptime has_init) {
            if (Init.init(allocator, globalThis, init)) |maybeInit| {
                if (maybeInit) |init_| {
                    body.init = init_;
                }
            } else |_| {
                return null;
            }
        }

        body.value = Value.fromJS(globalThis, value) orelse return null;
        if (body.value == .Blob)
            std.debug.assert(body.value.Blob.allocator == null); // owned by Body

        return body;
    }
};

pub fn BodyMixin(comptime Type: type) type {
    return struct {
        pub fn getText(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                if (value.Locked.promise != null) {
                    return handleBodyAlreadyUsed(globalObject);
                }

                return value.Locked.setPromise(globalObject, .{ .getText = {} });
            }

            var blob = value.useAsAnyBlob();
            return JSC.JSPromise.wrap(globalObject, blob.toString(globalObject, .transfer));
        }

        pub fn getBody(
            this: *Type,
            globalThis: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            var body: *Body.Value = this.getBodyValue();

            if (body.* == .Used) {
                // TODO: make this closed
                return JSC.WebCore.ReadableStream.empty(globalThis);
            }

            return body.toReadableStream(globalThis);
        }

        pub fn getBodyUsed(
            this: *Type,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            return JSValue.jsBoolean(this.getBodyValue().* == .Used);
        }

        pub fn getJSON(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();
            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                if (value.Locked.promise != null) {
                    return handleBodyAlreadyUsed(globalObject);
                }
                return value.Locked.setPromise(globalObject, .{ .getJSON = {} });
            }

            var blob = value.useAsAnyBlob();
            return JSC.JSPromise.wrap(globalObject, blob.toJSON(globalObject, .share));
        }

        fn handleBodyAlreadyUsed(globalObject: *JSC.JSGlobalObject) JSValue {
            return JSC.JSPromise.rejectedPromiseValue(
                globalObject,
                ZigString.static("Body already used").toErrorInstance(globalObject),
            );
        }

        pub fn getArrayBuffer(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                if (value.Locked.promise != null) {
                    return handleBodyAlreadyUsed(globalObject);
                }
                return value.Locked.setPromise(globalObject, .{ .getArrayBuffer = {} });
            }

            var blob: AnyBlob = value.useAsAnyBlob();
            return JSC.JSPromise.wrap(globalObject, blob.toArrayBuffer(globalObject, .transfer));
        }

        pub fn getFormData(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                if (value.Locked.promise != null) {
                    return handleBodyAlreadyUsed(globalObject);
                }
            }

            var encoder = this.getFormDataEncoding() orelse {
                // TODO: catch specific errors from getFormDataEncoding
                const err = globalObject.createTypeErrorInstance("Can't decode form data from body because of incorrect MIME type/boundary", .{});
                return JSC.JSPromise.rejectedPromiseValue(
                    globalObject,
                    err,
                );
            };

            if (value.* == .Locked) {
                return value.Locked.setPromise(globalObject, .{ .getFormData = encoder });
            }

            var blob: AnyBlob = value.useAsAnyBlob();
            defer blob.detach();
            defer encoder.deinit();

            const js_value = bun.FormData.toJS(
                globalObject,
                blob.slice(),
                encoder.encoding,
            ) catch |err| {
                return JSC.JSPromise.rejectedPromiseValue(
                    globalObject,
                    globalObject.createTypeErrorInstance(
                        "FormData parse error {s}",
                        .{
                            @errorName(err),
                        },
                    ),
                );
            };

            return JSC.JSPromise.wrap(
                globalObject,
                js_value,
            );
        }

        pub fn getBlob(
            this: *Type,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            var value: *Body.Value = this.getBodyValue();

            if (value.* == .Used) {
                return handleBodyAlreadyUsed(globalObject);
            }

            if (value.* == .Locked) {
                if (value.Locked.promise != null) {
                    return handleBodyAlreadyUsed(globalObject);
                }

                return value.Locked.setPromise(globalObject, .{ .getBlob = {} });
            }

            var blob = value.use();
            var ptr = getAllocator(globalObject).create(Blob) catch unreachable;
            ptr.* = blob;
            blob.allocator = getAllocator(globalObject);

            if (blob.content_type.len == 0 and blob.store != null) {
                if (this.getFetchHeaders()) |fetch_headers| {
                    if (fetch_headers.fastGet(.ContentType)) |content_type| {
                        blob.store.?.mime_type = MimeType.init(content_type.slice());
                    }
                } else {
                    blob.store.?.mime_type = MimeType.text;
                }
            }

            return JSC.JSPromise.resolvedPromiseValue(globalObject, ptr.toJS(globalObject));
        }
    };
}
