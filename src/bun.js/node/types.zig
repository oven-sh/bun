pub const BlobOrStringOrBuffer = union(enum) {
    blob: jsc.WebCore.Blob,
    string_or_buffer: StringOrBuffer,

    pub fn deinit(this: *const BlobOrStringOrBuffer) void {
        switch (this.*) {
            .blob => |blob| {
                if (blob.store) |store| {
                    store.deref();
                }
            },
            .string_or_buffer => |*str| {
                str.deinit();
            },
        }
    }

    pub fn slice(this: *const BlobOrStringOrBuffer) []const u8 {
        return switch (this.*) {
            .blob => |*blob| blob.sharedView(),
            .string_or_buffer => |*str| str.slice(),
        };
    }

    pub fn protect(this: *const BlobOrStringOrBuffer) void {
        switch (this.*) {
            .string_or_buffer => |sob| {
                sob.protect();
            },
            else => {},
        }
    }

    pub fn deinitAndUnprotect(this: *BlobOrStringOrBuffer) void {
        switch (this.*) {
            .string_or_buffer => |*sob| {
                sob.deinitAndUnprotect();
            },
            .blob => |*blob| {
                blob.deinit();
            },
        }
    }

    pub fn byteLength(this: *const BlobOrStringOrBuffer) usize {
        return this.slice().len;
    }

    pub fn fromJSMaybeFileMaybeAsync(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, allow_file: bool, is_async: bool) JSError!?BlobOrStringOrBuffer {
        // Check StringOrBuffer first because it's more common and cheaper.
        const str = try StringOrBuffer.fromJSMaybeAsync(global, allocator, value, is_async, true) orelse {
            const blob = value.as(jsc.WebCore.Blob) orelse return null;
            if (allow_file and blob.needsToReadFile()) {
                return global.throwInvalidArguments("File blob cannot be used here", .{});
            }

            if (is_async) {
                // For async/cross-thread usage, copy the blob data to an owned slice
                // rather than referencing the store which isn't thread-safe
                const blob_data = blob.sharedView();
                const owned_data = allocator.dupe(u8, blob_data) catch return error.OutOfMemory;
                return .{ .string_or_buffer = .{ .encoded_slice = jsc.ZigString.Slice.init(allocator, owned_data) } };
            }

            if (blob.store) |store| {
                store.ref();
            }
            return .{ .blob = blob.* };
        };

        return .{ .string_or_buffer = str };
    }

    pub fn fromJSMaybeFile(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, allow_file: bool) JSError!?BlobOrStringOrBuffer {
        return fromJSMaybeFileMaybeAsync(global, allocator, value, allow_file, false);
    }

    pub fn fromJS(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue) JSError!?BlobOrStringOrBuffer {
        return fromJSMaybeFile(global, allocator, value, true);
    }

    pub fn fromJSAsync(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue) JSError!?BlobOrStringOrBuffer {
        return fromJSMaybeFileMaybeAsync(global, allocator, value, true, true);
    }

    pub fn fromJSWithEncodingValue(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, encoding_value: jsc.JSValue) bun.JSError!?BlobOrStringOrBuffer {
        return fromJSWithEncodingValueAllowRequestResponse(global, allocator, value, encoding_value, false);
    }

    pub fn fromJSWithEncodingValueAllowRequestResponse(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, encoding_value: jsc.JSValue, allow_request_response: bool) bun.JSError!?BlobOrStringOrBuffer {
        switch (value.jsType()) {
            .DOMWrapper => {
                if (value.as(jsc.WebCore.Blob)) |blob| {
                    if (blob.store) |store| {
                        store.ref();
                    }
                    return .{ .blob = blob.* };
                }
                if (allow_request_response) {
                    if (value.as(jsc.WebCore.Request)) |request| {
                        const bodyValue = request.getBodyValue();
                        bodyValue.toBlobIfPossible();

                        if (bodyValue.tryUseAsAnyBlob()) |any_blob_| {
                            var any_blob = any_blob_;
                            defer any_blob.detach();
                            return .{ .blob = any_blob.toBlob(global) };
                        }

                        return global.throwInvalidArguments("Only buffered Request/Response bodies are supported for now.", .{});
                    }

                    if (value.as(jsc.WebCore.Response)) |response| {
                        const bodyValue = response.getBodyValue();
                        bodyValue.toBlobIfPossible();

                        if (bodyValue.tryUseAsAnyBlob()) |any_blob_| {
                            var any_blob = any_blob_;
                            defer any_blob.detach();
                            return .{ .blob = any_blob.toBlob(global) };
                        }

                        return global.throwInvalidArguments("Only buffered Request/Response bodies are supported for now.", .{});
                    }
                }
            },
            else => {},
        }

        const allow_string_object = true;
        return .{ .string_or_buffer = try StringOrBuffer.fromJSWithEncodingValueAllowStringObject(global, allocator, value, encoding_value, allow_string_object) orelse return null };
    }
};

pub const StringOrBuffer = union(enum) {
    string: bun.SliceWithUnderlyingString,
    threadsafe_string: bun.SliceWithUnderlyingString,
    encoded_slice: jsc.ZigString.Slice,
    buffer: Buffer,

    pub const empty = StringOrBuffer{ .encoded_slice = jsc.ZigString.Slice.empty };

    pub fn toThreadSafe(this: *@This()) void {
        switch (this.*) {
            .string => {
                this.string.toThreadSafe();
                const str = this.string;
                this.* = .{
                    .threadsafe_string = str,
                };
            },
            .threadsafe_string => {},
            .encoded_slice => {},
            .buffer => {
                this.buffer.buffer.value.protect();
            },
        }
    }

    pub fn fromJSToOwnedSlice(globalObject: *jsc.JSGlobalObject, value: jsc.JSValue, allocator: std.mem.Allocator) bun.JSError![]u8 {
        if (value.asArrayBuffer(globalObject)) |array_buffer| {
            defer globalObject.vm().reportExtraMemory(array_buffer.len);

            return try allocator.dupe(u8, array_buffer.byteSlice());
        }

        const str = try bun.String.fromJS(value, globalObject);
        defer str.deref();

        const result = try str.toOwnedSlice(allocator);
        defer globalObject.vm().reportExtraMemory(result.len);
        return result;
    }

    pub fn toJS(this: *StringOrBuffer, ctx: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return switch (this.*) {
            inline .threadsafe_string, .string => |*str| {
                return str.transferToJS(ctx);
            },
            .encoded_slice => {
                defer {
                    this.encoded_slice.deinit();
                    this.encoded_slice = .{};
                }

                return bun.String.createUTF8ForJS(ctx, this.encoded_slice.slice());
            },
            .buffer => {
                if (this.buffer.buffer.value != .zero) {
                    return this.buffer.buffer.value;
                }

                return this.buffer.toNodeBuffer(ctx);
            },
        };
    }

    pub fn slice(this: *const StringOrBuffer) []const u8 {
        return switch (this.*) {
            inline else => |*str| str.slice(),
        };
    }

    pub fn deinit(this: *const StringOrBuffer) void {
        switch (this.*) {
            inline .threadsafe_string, .string => |*str| {
                str.deinit();
            },
            .encoded_slice => |*encoded| {
                encoded.deinit();
            },
            else => {},
        }
    }

    pub fn deinitAndUnprotect(this: *const StringOrBuffer) void {
        switch (this.*) {
            inline .threadsafe_string, .string => |*str| {
                str.deinit();
            },
            .buffer => |buffer| {
                buffer.buffer.value.unprotect();
            },
            .encoded_slice => |*encoded| {
                encoded.deinit();
            },
        }
    }

    pub fn fromJSMaybeAsync(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, is_async: bool, allow_string_object: bool) JSError!?StringOrBuffer {
        return switch (value.jsType()) {
            .String,
            .StringObject,
            .DerivedStringObject,
            => |str_type| {
                if (!allow_string_object and str_type != .String) {
                    return null;
                }
                var str = try bun.String.fromJS(value, global);
                defer str.deref();
                if (is_async) {
                    var possible_clone = str;
                    var sliced = try possible_clone.toThreadSafeSlice(allocator);
                    sliced.reportExtraMemory(global.vm());

                    if (sliced.underlying.isEmpty()) {
                        return .{ .encoded_slice = sliced.utf8 };
                    }

                    return .{ .threadsafe_string = sliced };
                } else {
                    return .{ .string = str.toSlice(allocator) };
                }
            },

            .ArrayBuffer,
            .Int8Array,
            .Uint8Array,
            .Uint8ClampedArray,
            .Int16Array,
            .Uint16Array,
            .Int32Array,
            .Uint32Array,
            .Float32Array,
            .Float16Array,
            .Float64Array,
            .BigInt64Array,
            .BigUint64Array,
            .DataView,
            => {
                const buffer = Buffer.fromArrayBuffer(global, value);

                if (is_async) {
                    buffer.buffer.value.protect();
                }

                return .{ .buffer = buffer };
            },
            else => null,
        };
    }

    pub fn fromJS(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue) JSError!?StringOrBuffer {
        return fromJSMaybeAsync(global, allocator, value, false, true);
    }

    pub fn fromJSWithEncoding(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, encoding: Encoding) bun.JSError!?StringOrBuffer {
        return fromJSWithEncodingMaybeAsync(global, allocator, value, encoding, false, true);
    }

    pub fn fromJSWithEncodingMaybeAsync(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, encoding: Encoding, is_async: bool, allow_string_object: bool) bun.JSError!?StringOrBuffer {
        if (value.isCell() and value.jsType().isArrayBufferLike()) {
            const buffer = Buffer.fromArrayBuffer(global, value);
            if (is_async) {
                buffer.buffer.value.protect();
            }
            return .{ .buffer = buffer };
        }

        if (encoding == .utf8) {
            return fromJSMaybeAsync(global, allocator, value, is_async, allow_string_object);
        }

        if (value.isString()) {
            var str = try bun.String.fromJS(value, global);
            defer str.deref();
            if (str.isEmpty()) {
                return fromJSMaybeAsync(global, allocator, value, is_async, allow_string_object);
            }

            const out = str.encode(encoding);
            defer global.vm().reportExtraMemory(out.len);

            return .{ .encoded_slice = jsc.ZigString.Slice.init(bun.default_allocator, out) };
        }

        return null;
    }

    pub fn fromJSWithEncodingValue(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, encoding_value: jsc.JSValue) bun.JSError!?StringOrBuffer {
        const encoding: Encoding = brk: {
            if (!encoding_value.isCell())
                break :brk .utf8;
            break :brk try Encoding.fromJS(encoding_value, global) orelse .utf8;
        };

        return fromJSWithEncoding(global, allocator, value, encoding);
    }

    pub fn fromJSWithEncodingValueAllowStringObject(global: *jsc.JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, encoding_value: jsc.JSValue, allow_string_object: bool) bun.JSError!?StringOrBuffer {
        const encoding: Encoding = brk: {
            if (!encoding_value.isCell())
                break :brk .utf8;
            break :brk try Encoding.fromJS(encoding_value, global) orelse .utf8;
        };
        const is_async = false;
        return fromJSWithEncodingMaybeAsync(global, allocator, value, encoding, is_async, allow_string_object);
    }
};

/// https://github.com/nodejs/node/blob/master/lib/buffer.js#L587
/// See `jsc.WebCore.encoding` for encoding and decoding functions.
/// must match src/bun.js/bindings/BufferEncodingType.h
pub const Encoding = enum(u8) {
    utf8,
    ucs2,
    utf16le,
    latin1,
    ascii,
    base64,
    base64url,
    hex,

    /// Refer to the buffer's encoding
    buffer,

    pub const map = bun.ComptimeStringMap(Encoding, .{
        .{ "utf-8", Encoding.utf8 },
        .{ "utf8", Encoding.utf8 },
        .{ "ucs-2", Encoding.utf16le },
        .{ "ucs2", Encoding.utf16le },
        .{ "utf16-le", Encoding.utf16le },
        .{ "utf16le", Encoding.utf16le },
        .{ "binary", Encoding.latin1 },
        .{ "latin1", Encoding.latin1 },
        .{ "ascii", Encoding.ascii },
        .{ "base64", Encoding.base64 },
        .{ "hex", Encoding.hex },
        .{ "buffer", Encoding.buffer },
        .{ "base64url", Encoding.base64url },
    });

    pub fn isBinaryToText(this: Encoding) bool {
        return switch (this) {
            .hex, .base64, .base64url => true,
            else => false,
        };
    }

    pub fn fromJS(value: jsc.JSValue, global: *jsc.JSGlobalObject) JSError!?Encoding {
        return map.fromJSCaseInsensitive(global, value);
    }

    /// Caller must verify the value is a string
    pub fn from(slice: []const u8) ?Encoding {
        return strings.inMapCaseInsensitive(slice, map);
    }

    pub fn assert(value: jsc.JSValue, globalObject: *jsc.JSGlobalObject, default: Encoding) bun.JSError!Encoding {
        if (value.isFalsey()) {
            return default;
        }

        if (!value.isString()) {
            return throwEncodingError(globalObject, value);
        }

        return try fromJSWithDefaultOnEmpty(value, globalObject, default) orelse throwEncodingError(globalObject, value);
    }

    pub fn fromJSWithDefaultOnEmpty(value: jsc.JSValue, globalObject: *jsc.JSGlobalObject, default: Encoding) bun.JSError!?Encoding {
        const str = try bun.String.fromJS(value, globalObject);
        defer str.deref();
        if (str.isEmpty()) {
            return default;
        }
        return str.inMapCaseInsensitive(Encoding.map);
    }

    pub fn throwEncodingError(globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError {
        return globalObject.ERR(.INVALID_ARG_VALUE, "encoding '{f}' is an invalid encoding", .{value.fmtString(globalObject)}).throw();
    }

    pub fn encodeWithSize(encoding: Encoding, globalObject: *jsc.JSGlobalObject, comptime size: usize, input: *const [size]u8) bun.JSError!jsc.JSValue {
        switch (encoding) {
            .base64 => {
                var buf: [std.base64.standard.Encoder.calcSize(size)]u8 = undefined;
                const len = bun.base64.encode(&buf, input);
                return jsc.ZigString.init(buf[0..len]).toJS(globalObject);
            },
            .base64url => {
                var buf: [std.base64.url_safe_no_pad.Encoder.calcSize(size)]u8 = undefined;
                const encoded = std.base64.url_safe_no_pad.Encoder.encode(&buf, input);

                return jsc.ZigString.init(buf[0..encoded.len]).toJS(globalObject);
            },
            .hex => {
                var buf: [size * 4]u8 = undefined;
                const out = std.fmt.bufPrint(
                    &buf,
                    "{x}",
                    .{input},
                ) catch |err| switch (err) {
                    error.NoSpaceLeft => unreachable,
                };
                const result = jsc.ZigString.init(out).toJS(globalObject);
                return result;
            },
            .buffer => {
                return jsc.ArrayBuffer.createBuffer(globalObject, input);
            },
            inline else => |enc| {
                return try jsc.WebCore.encoding.toStringComptime(input, globalObject, enc);
            },
        }
    }

    pub fn encodeWithMaxSize(encoding: Encoding, globalObject: *jsc.JSGlobalObject, comptime max_size: usize, input: []const u8) bun.JSError!jsc.JSValue {
        bun.assertf(
            input.len <= max_size,
            "input length ({}) should not exceed max_size ({})",
            .{ input.len, max_size },
        );
        switch (encoding) {
            .base64 => {
                var base64_buf: [std.base64.standard.Encoder.calcSize(max_size * 4)]u8 = undefined;
                const encoded_len = bun.base64.encode(&base64_buf, input);
                var encoded, const bytes = bun.String.createUninitialized(.latin1, encoded_len);
                @memcpy(@constCast(bytes), base64_buf[0..encoded_len]);
                return try encoded.transferToJS(globalObject);
            },
            .base64url => {
                var buf: [std.base64.url_safe_no_pad.Encoder.calcSize(max_size * 4)]u8 = undefined;
                const encoded = std.base64.url_safe_no_pad.Encoder.encode(&buf, input);

                return jsc.ZigString.init(buf[0..encoded.len]).toJS(globalObject);
            },
            .hex => {
                var buf: [max_size * 4]u8 = undefined;
                const out = std.fmt.bufPrint(
                    &buf,
                    "{x}",
                    .{input},
                ) catch |err| switch (err) {
                    error.NoSpaceLeft => unreachable,
                };
                const result = jsc.ZigString.init(out).toJS(globalObject);
                return result;
            },
            .buffer => {
                return jsc.ArrayBuffer.createBuffer(globalObject, input);
            },
            inline else => |enc| {
                return try jsc.WebCore.encoding.toStringComptime(input, globalObject, enc);
            },
        }
    }

    extern fn WebCore_BufferEncodingType_toJS(globalObject: *jsc.JSGlobalObject, encoding: Encoding) jsc.JSValue;
    pub fn toJS(encoding: Encoding, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return WebCore_BufferEncodingType_toJS(globalObject, encoding);
    }
};

/// This is used on the windows implementation of realpath, which is in javascript
pub fn jsAssertEncodingValid(global: *jsc.JSGlobalObject, call_frame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const value = call_frame.argument(0);
    _ = try Encoding.assert(value, global, .utf8);
    return .js_undefined;
}

const PathOrBuffer = union(Tag) {
    path: bun.PathString,
    buffer: Buffer,

    pub const Tag = enum { path, buffer };

    pub inline fn slice(this: PathOrBuffer) []const u8 {
        return this.path.slice();
    }
};

pub fn CallbackTask(comptime Result: type) type {
    return struct {
        callback: jsc.C.JSObjectRef,
        option: Option,
        success: bool = false,

        pub const Option = union {
            err: jsc.SystemError,
            result: Result,
        };
    };
}

pub const PathLike = union(enum) {
    string: bun.PathString,
    buffer: Buffer,
    slice_with_underlying_string: bun.SliceWithUnderlyingString,
    threadsafe_string: bun.SliceWithUnderlyingString,
    encoded_slice: jsc.ZigString.Slice,

    pub fn estimatedSize(this: *const PathLike) usize {
        return switch (this.*) {
            .string => this.string.estimatedSize(),
            .buffer => this.buffer.slice().len,
            .threadsafe_string, .slice_with_underlying_string => 0,
            .encoded_slice => this.encoded_slice.slice().len,
        };
    }

    pub fn deinit(this: *const PathLike) void {
        switch (this.*) {
            .string, .buffer => {},
            inline else => |*str| {
                str.deinit();
            },
        }
    }

    pub fn toThreadSafe(this: *PathLike) void {
        switch (this.*) {
            .slice_with_underlying_string => {
                this.slice_with_underlying_string.toThreadSafe();
                const slice_with_underlying_string = this.slice_with_underlying_string;
                this.* = .{ .threadsafe_string = slice_with_underlying_string };
            },
            .buffer => {
                this.buffer.buffer.value.protect();
            },
            else => {},
        }
    }

    pub fn deinitAndUnprotect(this: *const PathLike) void {
        switch (this.*) {
            inline .encoded_slice, .threadsafe_string, .slice_with_underlying_string => |*val| {
                val.deinit();
            },
            .buffer => |val| {
                val.buffer.value.unprotect();
            },
            else => {},
        }
    }

    pub inline fn slice(this: PathLike) string {
        return switch (this) {
            inline else => |*str| str.slice(),
        };
    }

    pub fn sliceZWithForceCopy(this: PathLike, buf: *bun.PathBuffer, comptime force: bool) if (force) [:0]u8 else [:0]const u8 {
        const sliced = this.slice();

        if (Environment.isWindows) {
            if (std.fs.path.isAbsolute(sliced)) {
                if (sliced.len > 2 and bun.path.isDriveLetter(sliced[0]) and sliced[1] == ':' and bun.path.isSepAny(sliced[2])) {
                    // Add the long path syntax. This affects most of node:fs
                    const drive_resolve_buf = bun.path_buffer_pool.get();
                    defer bun.path_buffer_pool.put(drive_resolve_buf);
                    const rest = path_handler.PosixToWinNormalizer.resolveCWDWithExternalBufZ(drive_resolve_buf, sliced) catch @panic("Error while resolving path.");
                    buf[0..4].* = bun.windows.long_path_prefix_u8;
                    // When long path syntax is used, the entire string should be normalized
                    const n = bun.path.normalizeBuf(rest, buf[4..], .windows).len;
                    buf[4 + n] = 0;
                    return buf[0 .. 4 + n :0];
                }
                return path_handler.PosixToWinNormalizer.resolveCWDWithExternalBufZ(buf, sliced) catch @panic("Error while resolving path.");
            }
        }

        if (sliced.len == 0) {
            if (comptime !force) return "";

            buf[0] = 0;
            return buf[0..0 :0];
        }

        if (comptime !force) {
            if (sliced[sliced.len - 1] == 0) {
                return sliced[0 .. sliced.len - 1 :0];
            }
        }

        @memcpy(buf[0..sliced.len], sliced);
        buf[sliced.len] = 0;
        return buf[0..sliced.len :0];
    }

    pub fn sliceZ(this: PathLike, buf: *bun.PathBuffer) callconv(bun.callconv_inline) [:0]const u8 {
        return sliceZWithForceCopy(this, buf, false);
    }

    pub fn sliceW(this: PathLike, buf: *bun.WPathBuffer) callconv(bun.callconv_inline) [:0]const u16 {
        return strings.toWPath(buf, this.slice());
    }

    pub fn osPath(this: PathLike, buf: *bun.OSPathBuffer) callconv(bun.callconv_inline) bun.OSPathSliceZ {
        if (comptime Environment.isWindows) {
            return sliceW(this, buf);
        }

        return sliceZWithForceCopy(this, buf, false);
    }

    pub fn osPathKernel32(this: PathLike, buf: *bun.PathBuffer) callconv(bun.callconv_inline) bun.OSPathSliceZ {
        if (comptime Environment.isWindows) {
            const s = this.slice();
            const b = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(b);
            // Device paths (\\.\, \\?\) and NT object paths (\??\) should not be normalized
            // because the "." in \\.\pipe\name would be incorrectly stripped as a "current directory" component.
            if (s.len >= 4 and bun.path.isSepAny(s[0]) and bun.path.isSepAny(s[1]) and (s[2] == '.' or s[2] == '?') and bun.path.isSepAny(s[3])) {
                return strings.toKernel32Path(@alignCast(std.mem.bytesAsSlice(u16, buf)), s);
            }
            if (s.len > 0 and bun.path.isSepAny(s[0])) {
                const resolve = path_handler.PosixToWinNormalizer.resolveCWDWithExternalBuf(buf, s) catch @panic("Error while resolving path.");
                const normal = path_handler.normalizeBuf(resolve, b, .windows);
                return strings.toKernel32Path(@alignCast(std.mem.bytesAsSlice(u16, buf)), normal);
            }
            const normal = path_handler.normalizeStringBuf(s, b, true, .windows, false);
            return strings.toKernel32Path(@alignCast(std.mem.bytesAsSlice(u16, buf)), normal);
        }

        return sliceZWithForceCopy(this, buf, false);
    }

    pub fn fromJS(ctx: *jsc.JSGlobalObject, arguments: *ArgumentsSlice) bun.JSError!?PathLike {
        return fromJSWithAllocator(ctx, arguments, bun.default_allocator);
    }

    pub fn fromJSWithAllocator(ctx: *jsc.JSGlobalObject, arguments: *ArgumentsSlice, allocator: std.mem.Allocator) bun.JSError!?PathLike {
        const arg = arguments.next() orelse return null;
        switch (arg.jsType()) {
            .Uint8Array,
            .DataView,
            => {
                const buffer = Buffer.fromTypedArray(ctx, arg);
                try Valid.pathBuffer(buffer, ctx);
                try Valid.pathNullBytes(buffer.slice(), ctx);

                arguments.protectEat();
                return .{ .buffer = buffer };
            },

            .ArrayBuffer => {
                const buffer = Buffer.fromArrayBuffer(ctx, arg);
                try Valid.pathBuffer(buffer, ctx);
                try Valid.pathNullBytes(buffer.slice(), ctx);

                arguments.protectEat();
                return .{ .buffer = buffer };
            },

            .String,
            .StringObject,
            .DerivedStringObject,
            => {
                var str = try arg.toBunString(ctx);
                defer str.deref();

                arguments.eat();

                return try fromBunString(ctx, &str, arguments.will_be_async, allocator);
            },
            else => {
                if (arg.as(jsc.DOMURL)) |domurl| {
                    var str: bun.String = domurl.fileSystemPath() catch |err| switch (err) {
                        error.NotFileUrl => {
                            return ctx.ERR(.INVALID_URL_SCHEME, "URL must be a non-empty \"file:\" path", .{}).throw();
                        },
                        error.InvalidPath => {
                            return ctx.ERR(.INVALID_FILE_URL_PATH, "URL must be a non-empty \"file:\" path", .{}).throw();
                        },
                        error.InvalidHost => {
                            return ctx.ERR(.INVALID_FILE_URL_HOST, "URL must be a non-empty \"file:\" path", .{}).throw();
                        },
                    };
                    defer str.deref();
                    if (str.isEmpty()) {
                        return ctx.ERR(.INVALID_ARG_VALUE, "URL must be a non-empty \"file:\" path", .{}).throw();
                    }
                    arguments.eat();

                    return try fromBunString(ctx, &str, arguments.will_be_async, allocator);
                }

                return null;
            },
        }
    }

    pub fn fromBunString(global: *jsc.JSGlobalObject, str: *bun.String, will_be_async: bool, allocator: std.mem.Allocator) !PathLike {
        try Valid.pathStringLength(str.length(), global);

        if (will_be_async) {
            var sliced = try str.toThreadSafeSlice(allocator);
            errdefer sliced.deinit();

            try Valid.pathNullBytes(sliced.slice(), global);

            sliced.reportExtraMemory(global.vm());

            if (sliced.underlying.isEmpty()) {
                return .{ .encoded_slice = sliced.utf8 };
            }
            return .{ .threadsafe_string = sliced };
        } else {
            var sliced = str.toSlice(allocator);
            errdefer sliced.deinit();

            try Valid.pathNullBytes(sliced.slice(), global);

            // Costs nothing to keep both around.
            if (sliced.isWTFAllocated()) {
                return .{ .slice_with_underlying_string = sliced };
            }

            sliced.reportExtraMemory(global.vm());

            // It is expensive to keep both around.
            return .{ .encoded_slice = sliced.utf8 };
        }
    }
};

pub const Valid = struct {
    pub fn pathSlice(zig_str: jsc.ZigString.Slice, ctx: *jsc.JSGlobalObject) bun.JSError!void {
        switch (zig_str.len) {
            0...bun.MAX_PATH_BYTES => return,
            else => {
                var system_error = bun.sys.Error.fromCode(.NAMETOOLONG, .open).withPath(zig_str.slice()).toSystemError();
                system_error.syscall = bun.String.dead;
                return ctx.throwValue(system_error.toErrorInstance(ctx));
            },
        }
        comptime unreachable;
    }

    pub fn pathStringLength(len: usize, ctx: *jsc.JSGlobalObject) bun.JSError!void {
        switch (len) {
            0...bun.MAX_PATH_BYTES => return,
            else => {
                var system_error = bun.sys.Error.fromCode(.NAMETOOLONG, .open).toSystemError();
                system_error.syscall = bun.String.dead;
                return ctx.throwValue(system_error.toErrorInstance(ctx));
            },
        }
        comptime unreachable;
    }

    pub fn pathString(zig_str: jsc.ZigString, ctx: *jsc.JSGlobalObject) bun.JSError!void {
        return pathStringLength(zig_str.len, ctx);
    }

    pub fn pathBuffer(buffer: Buffer, ctx: *jsc.JSGlobalObject) bun.JSError!void {
        const slice = buffer.slice();
        switch (slice.len) {
            0 => {
                return ctx.throwInvalidArguments("Invalid path buffer: can't be empty", .{});
            },
            else => {
                var system_error = bun.sys.Error.fromCode(.NAMETOOLONG, .open).toSystemError();
                system_error.syscall = bun.String.dead;
                return ctx.throwValue(system_error.toErrorInstance(ctx));
            },
            1...bun.MAX_PATH_BYTES => return,
        }
        comptime unreachable;
    }

    pub fn pathNullBytes(slice: []const u8, global: *jsc.JSGlobalObject) bun.JSError!void {
        if (bun.strings.indexOfChar(slice, 0) != null) {
            return global.ERR(.INVALID_ARG_VALUE, "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received {f}", .{bun.fmt.quote(slice)}).throw();
        }
    }
};

pub const VectorArrayBuffer = struct {
    value: jsc.JSValue,
    buffers: std.array_list.Managed(bun.PlatformIOVec),

    pub fn toJS(this: VectorArrayBuffer, _: *jsc.JSGlobalObject) jsc.JSValue {
        return this.value;
    }

    pub fn fromJS(globalObject: *jsc.JSGlobalObject, val: jsc.JSValue, allocator: std.mem.Allocator) bun.JSError!VectorArrayBuffer {
        if (!val.jsType().isArrayLike()) {
            return globalObject.throwInvalidArguments("Expected ArrayBufferView[]", .{});
        }

        var bufferlist = std.array_list.Managed(bun.PlatformIOVec).init(allocator);
        var i: usize = 0;
        const len = try val.getLength(globalObject);
        bun.handleOom(bufferlist.ensureTotalCapacityPrecise(len));

        while (i < len) {
            const element = try val.getIndex(globalObject, @as(u32, @truncate(i)));

            if (!element.isCell()) {
                return globalObject.throwInvalidArguments("Expected ArrayBufferView[]", .{});
            }

            const array_buffer = element.asArrayBuffer(globalObject) orelse {
                return globalObject.throwInvalidArguments("Expected ArrayBufferView[]", .{});
            };

            const buf = array_buffer.byteSlice();
            bun.handleOom(bufferlist.append(bun.platformIOVecCreate(buf)));
            i += 1;
        }

        return VectorArrayBuffer{ .value = val, .buffers = bufferlist };
    }
};

pub fn modeFromJS(ctx: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!?Mode {
    const mode_int = if (value.isNumber()) brk: {
        break :brk try node.validators.validateUint32(ctx, value, "mode", .{}, false);
    } else brk: {
        if (value.isUndefinedOrNull()) return null;

        if (!value.isString()) {
            return ctx.throwInvalidArgumentTypeValue("mode", "number", value);
        }

        // An easier method of constructing the mode is to use a sequence of
        // three octal digits (e.g. 765). The left-most digit (7 in the example),
        // specifies the permissions for the file owner. The middle digit (6 in
        // the example), specifies permissions for the group. The right-most
        // digit (5 in the example), specifies the permissions for others.

        var zig_str = jsc.ZigString.Empty;
        try value.toZigString(&zig_str, ctx);
        var slice = zig_str.slice();
        if (strings.hasPrefix(slice, "0o")) {
            slice = slice[2..];
        }

        break :brk std.fmt.parseInt(Mode, slice, 8) catch {
            var formatter = bun.jsc.ConsoleObject.Formatter{ .globalThis = ctx };
            defer formatter.deinit();
            return ctx.throwValue(ctx.ERR(.INVALID_ARG_VALUE, "The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received {f}", .{value.toFmt(&formatter)}).toJS());
        };
    };

    return @truncate(mode_int & 0o777);
}

pub const PathOrFileDescriptor = union(Tag) {
    fd: bun.FileDescriptor,
    path: PathLike,

    pub const Tag = enum { fd, path };
    pub const SerializeTag = enum(u8) { fd, path };

    /// This will unref() the path string if it is a PathLike.
    /// Does nothing for file descriptors, **does not** close file descriptors.
    pub fn deinit(this: PathOrFileDescriptor) void {
        if (this == .path) {
            this.path.deinit();
        }
    }

    pub fn estimatedSize(this: *const PathOrFileDescriptor) usize {
        return switch (this.*) {
            .path => this.path.estimatedSize(),
            .fd => 0,
        };
    }

    pub fn toThreadSafe(this: *PathOrFileDescriptor) void {
        if (this.* == .path) {
            this.path.toThreadSafe();
        }
    }

    pub fn deinitAndUnprotect(this: PathOrFileDescriptor) void {
        if (this == .path) {
            this.path.deinitAndUnprotect();
        }
    }

    pub fn hash(this: jsc.Node.PathOrFileDescriptor) u64 {
        return switch (this) {
            .path => bun.hash(this.path.slice()),
            .fd => bun.hash(std.mem.asBytes(&this.fd)),
        };
    }

    pub fn format(this: jsc.Node.PathOrFileDescriptor, writer: *std.Io.Writer) !void {
        switch (this) {
            .path => |p| try writer.writeAll(p.slice()),
            .fd => |fd| try writer.print("{}", .{fd}),
        }
    }

    pub fn fromJS(ctx: *jsc.JSGlobalObject, arguments: *ArgumentsSlice, allocator: std.mem.Allocator) bun.JSError!?jsc.Node.PathOrFileDescriptor {
        const first = arguments.next() orelse return null;

        if (try bun.FD.fromJSValidated(first, ctx)) |fd| {
            arguments.eat();
            return .{ .fd = fd };
        }

        return jsc.Node.PathOrFileDescriptor{
            .path = try PathLike.fromJSWithAllocator(ctx, arguments, allocator) orelse return null,
        };
    }
};

pub const FileSystemFlags = enum(c_int) {
    pub const tag_type = @typeInfo(FileSystemFlags).@"enum".tag_type;
    const O = bun.O;

    /// Open file for appending. The file is created if it does not exist.
    a = O.APPEND | O.WRONLY | O.CREAT,
    /// Like 'a' but fails if the path exists.
    // @"ax" = bun.O.APPEND | bun.O.EXCL,
    /// Open file for reading and appending. The file is created if it does not exist.
    // @"a+" = bun.O.APPEND | bun.O.RDWR,
    /// Like 'a+' but fails if the path exists.
    // @"ax+" = bun.O.APPEND | bun.O.RDWR | bun.O.EXCL,
    /// Open file for appending in synchronous mode. The file is created if it does not exist.
    // @"as" = bun.O.APPEND,
    /// Open file for reading and appending in synchronous mode. The file is created if it does not exist.
    // @"as+" = bun.O.APPEND | bun.O.RDWR,
    /// Open file for reading. An exception occurs if the file does not exist.
    r = O.RDONLY,
    /// Open file for reading and writing. An exception occurs if the file does not exist.
    // @"r+" = bun.O.RDWR,
    /// Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache.
    /// This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed.
    /// This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.openSync() should be used.
    // @"rs+" = bun.O.RDWR,
    /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    w = O.WRONLY | O.CREAT,
    /// Like 'w' but fails if the path exists.
    // @"wx" = bun.O.WRONLY | bun.O.TRUNC,
    // ///  Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists).
    // @"w+" = bun.O.RDWR | bun.O.CREAT,
    // ///  Like 'w+' but fails if the path exists.
    // @"wx+" = bun.O.RDWR | bun.O.EXCL,

    _,

    const map = bun.ComptimeStringMap(i32, .{
        .{ "r", O.RDONLY },
        .{ "rs", O.RDONLY | O.SYNC },
        .{ "sr", O.RDONLY | O.SYNC },
        .{ "r+", O.RDWR },
        .{ "rs+", O.RDWR | O.SYNC },
        .{ "sr+", O.RDWR | O.SYNC },

        .{ "R", O.RDONLY },
        .{ "RS", O.RDONLY | O.SYNC },
        .{ "SR", O.RDONLY | O.SYNC },
        .{ "R+", O.RDWR },
        .{ "RS+", O.RDWR | O.SYNC },
        .{ "SR+", O.RDWR | O.SYNC },

        .{ "w", O.TRUNC | O.CREAT | O.WRONLY },
        .{ "wx", O.TRUNC | O.CREAT | O.WRONLY | O.EXCL },
        .{ "xw", O.TRUNC | O.CREAT | O.WRONLY | O.EXCL },

        .{ "W", O.TRUNC | O.CREAT | O.WRONLY },
        .{ "WX", O.TRUNC | O.CREAT | O.WRONLY | O.EXCL },
        .{ "XW", O.TRUNC | O.CREAT | O.WRONLY | O.EXCL },

        .{ "w+", O.TRUNC | O.CREAT | O.RDWR },
        .{ "wx+", O.TRUNC | O.CREAT | O.RDWR | O.EXCL },
        .{ "xw+", O.TRUNC | O.CREAT | O.RDWR | O.EXCL },

        .{ "W+", O.TRUNC | O.CREAT | O.RDWR },
        .{ "WX+", O.TRUNC | O.CREAT | O.RDWR | O.EXCL },
        .{ "XW+", O.TRUNC | O.CREAT | O.RDWR | O.EXCL },

        .{ "a", O.APPEND | O.CREAT | O.WRONLY },
        .{ "ax", O.APPEND | O.CREAT | O.WRONLY | O.EXCL },
        .{ "xa", O.APPEND | O.CREAT | O.WRONLY | O.EXCL },
        .{ "as", O.APPEND | O.CREAT | O.WRONLY | O.SYNC },
        .{ "sa", O.APPEND | O.CREAT | O.WRONLY | O.SYNC },

        .{ "A", O.APPEND | O.CREAT | O.WRONLY },
        .{ "AX", O.APPEND | O.CREAT | O.WRONLY | O.EXCL },
        .{ "XA", O.APPEND | O.CREAT | O.WRONLY | O.EXCL },
        .{ "AS", O.APPEND | O.CREAT | O.WRONLY | O.SYNC },
        .{ "SA", O.APPEND | O.CREAT | O.WRONLY | O.SYNC },

        .{ "a+", O.APPEND | O.CREAT | O.RDWR },
        .{ "ax+", O.APPEND | O.CREAT | O.RDWR | O.EXCL },
        .{ "xa+", O.APPEND | O.CREAT | O.RDWR | O.EXCL },
        .{ "as+", O.APPEND | O.CREAT | O.RDWR | O.SYNC },
        .{ "sa+", O.APPEND | O.CREAT | O.RDWR | O.SYNC },

        .{ "A+", O.APPEND | O.CREAT | O.RDWR },
        .{ "AX+", O.APPEND | O.CREAT | O.RDWR | O.EXCL },
        .{ "XA+", O.APPEND | O.CREAT | O.RDWR | O.EXCL },
        .{ "AS+", O.APPEND | O.CREAT | O.RDWR | O.SYNC },
        .{ "SA+", O.APPEND | O.CREAT | O.RDWR | O.SYNC },
    });

    pub fn fromJS(ctx: *jsc.JSGlobalObject, val: jsc.JSValue) bun.JSError!?FileSystemFlags {
        if (val.isNumber()) {
            if (!val.isInt32()) {
                return ctx.throwValue(ctx.ERR(.OUT_OF_RANGE, "The value of \"flags\" is out of range. It must be an integer. Received {d}", .{val.asNumber()}).toJS());
            }
            const number = try val.coerce(i32, ctx);
            return @as(FileSystemFlags, @enumFromInt(@max(number, 0)));
        }

        const jsType = val.jsType();
        if (jsType.isStringLike()) {
            const str = try val.getZigString(ctx);
            if (str.isEmpty()) {
                return ctx.throwInvalidArguments("Expected flags to be a non-empty string. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags", .{});
            }
            // it's definitely wrong when the string is super long
            else if (str.len > 12) {
                return ctx.throwInvalidArguments("Invalid flag '{f}'. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags", .{str});
            }

            const flags: i32 = brk: {
                switch (str.is16Bit()) {
                    inline else => |is_16bit| {
                        const chars = if (is_16bit) str.utf16SliceAligned() else str.slice();

                        if (std.ascii.isDigit(@as(u8, @truncate(chars[0])))) {
                            // node allows "0o644" as a string :(
                            if (is_16bit) {
                                const slice = str.toSlice(bun.default_allocator);
                                defer slice.deinit();

                                break :brk @as(i32, @intCast(std.fmt.parseInt(Mode, slice.slice(), 10) catch break :brk null));
                            } else {
                                break :brk @as(i32, @intCast(std.fmt.parseInt(Mode, chars, 10) catch break :brk null));
                            }
                        }
                    },
                }

                break :brk map.getWithEql(str, jsc.ZigString.eqlComptime) orelse break :brk null;
            } orelse {
                return ctx.throwInvalidArguments("Invalid flag '{f}'. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags", .{str});
            };

            return @enumFromInt(flags);
        }

        return null;
    }

    /// Equivalent of GetValidFileMode, which is used to implement fs.access and copyFile
    pub fn fromJSNumberOnly(global: *jsc.JSGlobalObject, value: jsc.JSValue, comptime kind: enum { access, copy_file }) bun.JSError!FileSystemFlags {
        // Allow only int32 or null/undefined values.
        if (!value.isNumber()) {
            if (value.isUndefinedOrNull()) {
                return @enumFromInt(switch (kind) {
                    .access => 0, // F_OK
                    .copy_file => 0, // constexpr int kDefaultCopyMode = 0;
                });
            }
            return global.ERR(.INVALID_ARG_TYPE, "mode must be int32 or null/undefined", .{}).throw();
        }
        const min, const max = .{ 0, 7 };
        if (value.isInt32()) {
            const int: i32 = value.asInt32();
            if (int < min or int > max) {
                return global.ERR(.OUT_OF_RANGE, comptime std.fmt.comptimePrint("mode is out of range: >= {d} and <= {d}", .{ min, max }), .{}).throw();
            }
            return @enumFromInt(int);
        } else {
            const float = value.asNumber();
            if (std.math.isNan(float) or std.math.isInf(float) or float < min or float > max) {
                return global.ERR(.OUT_OF_RANGE, comptime std.fmt.comptimePrint("mode is out of range: >= {d} and <= {d}", .{ min, max }), .{}).throw();
            }
            return @enumFromInt(@as(i32, @intFromFloat(float)));
        }
    }

    pub fn asInt(flags: FileSystemFlags) tag_type {
        return @intFromEnum(flags);
    }
};

/// A class representing a directory stream.
///
/// Created by {@link opendir}, {@link opendirSync}, or `fsPromises.opendir()`.
///
/// ```js
/// import { opendir } from 'fs/promises';
///
/// try {
///   const dir = await opendir('./');
///   for await (const dirent of dir)
///     console.log(dirent.name);
/// } catch (err) {
///   console.error(err);
/// }
/// ```
///
/// When using the async iterator, the `fs.Dir` object will be automatically
/// closed after the iterator exits.
/// @since v12.12.0
pub const Dirent = struct {
    name: bun.String,
    path: bun.String,
    // not publicly exposed
    kind: Kind,

    pub const Kind = std.fs.File.Kind;

    extern fn Bun__JSDirentObjectConstructor(*jsc.JSGlobalObject) jsc.JSValue;
    pub const getConstructor = Bun__JSDirentObjectConstructor;

    extern fn Bun__Dirent__toJS(*jsc.JSGlobalObject, i32, *bun.String, *bun.String, cached_previous_path_jsvalue: ?*?*jsc.JSString) jsc.JSValue;
    pub fn toJS(this: *Dirent, globalObject: *jsc.JSGlobalObject, cached_previous_path_jsvalue: ?*?*jsc.JSString) bun.JSError!jsc.JSValue {
        return bun.jsc.fromJSHostCall(globalObject, @src(), Bun__Dirent__toJS, .{
            globalObject,
            switch (this.kind) {
                .file => bun.windows.libuv.UV_DIRENT_FILE,
                .block_device => bun.windows.libuv.UV_DIRENT_BLOCK,
                .character_device => bun.windows.libuv.UV_DIRENT_CHAR,
                .directory => bun.windows.libuv.UV_DIRENT_DIR,
                // event_port is deliberate there.
                .event_port, .named_pipe => bun.windows.libuv.UV_DIRENT_FIFO,
                .unix_domain_socket => bun.windows.libuv.UV_DIRENT_SOCKET,
                .sym_link => bun.windows.libuv.UV_DIRENT_LINK,
                .whiteout, .door, .unknown => bun.windows.libuv.UV_DIRENT_UNKNOWN,
            },
            &this.name,
            &this.path,
            cached_previous_path_jsvalue,
        });
    }

    pub fn toJSNewlyCreated(this: *Dirent, globalObject: *jsc.JSGlobalObject, previous_jsstring: ?*?*jsc.JSString) bun.JSError!jsc.JSValue {
        // Shouldn't techcnically be necessary.
        defer this.deref();
        return this.toJS(globalObject, previous_jsstring);
    }

    pub fn deref(this: *const Dirent) void {
        this.name.deref();
        this.path.deref();
    }
};

pub const PathOrBlob = union(enum) {
    path: jsc.Node.PathOrFileDescriptor,
    blob: Blob,

    const Blob = jsc.WebCore.Blob;

    pub fn fromJSNoCopy(ctx: *jsc.JSGlobalObject, args: *jsc.CallFrame.ArgumentsSlice) bun.JSError!PathOrBlob {
        if (try jsc.Node.PathOrFileDescriptor.fromJS(ctx, args, bun.default_allocator)) |path| {
            return PathOrBlob{
                .path = path,
            };
        }

        const arg = args.nextEat() orelse {
            return ctx.throwInvalidArgumentTypeValue("destination", "path, file descriptor, or Blob", .js_undefined);
        };
        if (arg.as(Blob)) |blob| {
            return PathOrBlob{
                .blob = blob.*,
            };
        }
        return ctx.throwInvalidArgumentTypeValue("destination", "path, file descriptor, or Blob", arg);
    }
};

const string = []const u8;

const std = @import("std");
const URL = @import("../../url.zig").URL;

const bun = @import("bun");
const Environment = bun.Environment;
const JSError = bun.JSError;
const Mode = bun.Mode;
const jsc = bun.jsc;
const path_handler = bun.path;
const strings = bun.strings;
const windows = bun.windows;
const ArgumentsSlice = jsc.CallFrame.ArgumentsSlice;

const node = bun.api.node;
const Buffer = node.Buffer;
