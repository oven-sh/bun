pub const ArrayBuffer = extern struct {
    ptr: ?[*]u8 = null,
    len: usize = 0,
    byte_len: usize = 0,
    value: jsc.JSValue = jsc.JSValue.zero,
    typed_array_type: jsc.JSValue.JSType = .Cell,
    shared: bool = false,

    pub fn isDetached(this: *const ArrayBuffer) bool {
        return this.ptr == null;
    }

    // require('buffer').kMaxLength.
    // keep in sync with Bun::Buffer::kMaxLength
    pub const max_size = std.math.maxInt(c_uint);

    extern fn JSBuffer__fromMmap(*jsc.JSGlobalObject, addr: *anyopaque, len: usize) jsc.JSValue;

    // 4 MB or so is pretty good for mmap()
    const mmap_threshold = 1024 * 1024 * 4;

    pub fn bytesPerElement(this: *const ArrayBuffer) ?u8 {
        return switch (this.typed_array_type) {
            .ArrayBuffer, .DataView => null,
            .Uint8Array, .Uint8ClampedArray, .Int8Array => 1,
            .Uint16Array, .Int16Array, .Float16Array => 2,
            .Uint32Array, .Int32Array, .Float32Array => 4,
            .BigUint64Array, .BigInt64Array, .Float64Array => 8,
            else => null,
        };
    }

    /// Only use this when reading from the file descriptor is _very_ cheap. Like, for example, an in-memory file descriptor.
    /// Do not use this for pipes, however tempting it may seem.
    pub fn toJSBufferFromFd(fd: bun.FileDescriptor, size: usize, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        const buffer_value = Bun__createUint8ArrayForCopy(globalObject, null, size, true);
        if (buffer_value == .zero) {
            return .zero;
        }

        var array_buffer = buffer_value.asArrayBuffer(globalObject) orelse @panic("Unexpected");
        var bytes = array_buffer.byteSlice();

        buffer_value.ensureStillAlive();

        var read: isize = 0;
        while (bytes.len > 0) {
            switch (bun.sys.pread(fd, bytes, read)) {
                .result => |amount| {
                    bytes = bytes[amount..];
                    read += @intCast(amount);

                    if (amount == 0) {
                        if (bytes.len > 0) {
                            @memset(bytes, 0);
                        }
                        break;
                    }
                },
                .err => |err| {
                    return globalObject.throwValue(err.toJS(globalObject) catch return .zero) catch .zero;
                },
            }
        }

        buffer_value.ensureStillAlive();

        return buffer_value;
    }

    extern fn ArrayBuffer__fromSharedMemfd(fd: i64, globalObject: *jsc.JSGlobalObject, byte_offset: usize, byte_length: usize, total_size: usize, jsc.JSValue.JSType) jsc.JSValue;
    pub const toArrayBufferFromSharedMemfd = ArrayBuffer__fromSharedMemfd;

    pub fn toJSBufferFromMemfd(fd: bun.FileDescriptor, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        const stat = switch (bun.sys.fstat(fd)) {
            .err => |err| {
                fd.close();
                return globalObject.throwValue(try err.toJS(globalObject));
            },
            .result => |fstat| fstat,
        };

        const size = stat.size;

        if (size == 0) {
            fd.close();
            return createBuffer(globalObject, "");
        }

        // mmap() is kind of expensive to do
        // It creates a new memory mapping.
        // If there is a lot of repetitive memory allocations in a tight loop, it performs poorly.
        // So we clone it when it's small.
        if (size < mmap_threshold) {
            const result = toJSBufferFromFd(fd, @intCast(size), globalObject);
            fd.close();
            return result;
        }

        const result = bun.sys.mmap(
            null,
            @intCast(@max(size, 0)),
            std.posix.PROT.READ | std.posix.PROT.WRITE,
            .{ .TYPE = .SHARED },
            fd,
            0,
        );
        fd.close();

        switch (result) {
            .result => |buf| {
                return JSBuffer__fromMmap(globalObject, buf.ptr, buf.len);
            },
            .err => |err| {
                return globalObject.throwValue(err.toJS(globalObject) catch return .zero) catch return .zero;
            },
        }
    }

    pub const Strong = struct {
        array_buffer: ArrayBuffer,
        held: jsc.Strong.Optional = .empty,

        pub fn clear(this: *ArrayBuffer.Strong) void {
            var ref: *bun.api.napi.Ref = this.ref orelse return;
            ref.set(jsc.JSValue.zero);
        }

        pub fn slice(this: *const ArrayBuffer.Strong) []u8 {
            return this.array_buffer.slice();
        }

        pub fn deinit(this: *ArrayBuffer.Strong) void {
            this.held.deinit();
        }
    };

    pub const empty = ArrayBuffer{ .len = 0, .byte_len = 0, .typed_array_type = .Uint8Array, .ptr = &.{} };

    pub const name = "Bun__ArrayBuffer";
    pub const Stream = std.io.FixedBufferStream([]u8);

    pub inline fn stream(this: ArrayBuffer) Stream {
        return Stream{ .pos = 0, .buf = this.slice() };
    }

    pub fn create(globalThis: *jsc.JSGlobalObject, bytes: []const u8, comptime kind: jsc.JSValue.JSType) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        return switch (comptime kind) {
            .Uint8Array => bun.jsc.fromJSHostCall(globalThis, @src(), Bun__createUint8ArrayForCopy, .{ globalThis, bytes.ptr, bytes.len, false }),
            .ArrayBuffer => bun.jsc.fromJSHostCall(globalThis, @src(), Bun__createArrayBufferForCopy, .{ globalThis, bytes.ptr, bytes.len }),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn createEmpty(globalThis: *jsc.JSGlobalObject, comptime kind: jsc.JSValue.JSType) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        return switch (comptime kind) {
            .Uint8Array => bun.jsc.fromJSHostCall(Bun__createUint8ArrayForCopy, .{ globalThis, null, 0, false }),
            .ArrayBuffer => bun.jsc.fromJSHostCall(Bun__createArrayBufferForCopy, .{ globalThis, null, 0 }),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn createBuffer(globalThis: *jsc.JSGlobalObject, bytes: []const u8) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        return bun.jsc.fromJSHostCall(globalThis, @src(), Bun__createUint8ArrayForCopy, .{ globalThis, bytes.ptr, bytes.len, true });
    }

    pub fn createUint8Array(globalThis: *jsc.JSGlobalObject, bytes: []const u8) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        return bun.jsc.fromJSHostCall(globalThis, @src(), Bun__createUint8ArrayForCopy, .{ globalThis, bytes.ptr, bytes.len, false });
    }

    extern "c" fn Bun__allocUint8ArrayForCopy(*jsc.JSGlobalObject, usize, **anyopaque) jsc.JSValue;
    extern "c" fn Bun__allocArrayBufferForCopy(*jsc.JSGlobalObject, usize, **anyopaque) jsc.JSValue;

    pub fn alloc(global: *jsc.JSGlobalObject, comptime kind: jsc.JSValue.JSType, len: u32) JSError!struct { jsc.JSValue, []u8 } {
        var ptr: [*]u8 = undefined;
        const buf = switch (comptime kind) {
            .Uint8Array => try bun.jsc.fromJSHostCall(global, @src(), Bun__allocUint8ArrayForCopy, .{ global, len, @ptrCast(&ptr) }),
            .ArrayBuffer => try bun.jsc.fromJSHostCall(global, @src(), Bun__allocArrayBufferForCopy, .{ global, len, @ptrCast(&ptr) }),
            else => @compileError("Not implemented yet"),
        };
        return .{ buf, ptr[0..len] };
    }

    extern "c" fn Bun__createUint8ArrayForCopy(*jsc.JSGlobalObject, ptr: ?*const anyopaque, len: usize, buffer: bool) jsc.JSValue;
    extern "c" fn Bun__createArrayBufferForCopy(*jsc.JSGlobalObject, ptr: ?*const anyopaque, len: usize) jsc.JSValue;

    pub fn fromTypedArray(ctx: *jsc.JSGlobalObject, value: jsc.JSValue) ArrayBuffer {
        return value.asArrayBuffer(ctx).?;
    }

    extern "c" fn JSArrayBuffer__fromDefaultAllocator(*jsc.JSGlobalObject, ptr: [*]u8, len: usize) jsc.JSValue;
    pub fn toJSFromDefaultAllocator(globalThis: *jsc.JSGlobalObject, bytes: []u8) jsc.JSValue {
        return JSArrayBuffer__fromDefaultAllocator(globalThis, bytes.ptr, bytes.len);
    }

    pub fn fromDefaultAllocator(globalThis: *jsc.JSGlobalObject, bytes: []u8, comptime typed_array_type: jsc.JSValue.JSType) jsc.JSValue {
        return switch (typed_array_type) {
            .ArrayBuffer => JSArrayBuffer__fromDefaultAllocator(globalThis, bytes.ptr, bytes.len),
            .Uint8Array => jsc.JSUint8Array.fromBytes(globalThis, bytes),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn fromBytes(bytes: []u8, typed_array_type: jsc.JSValue.JSType) ArrayBuffer {
        return ArrayBuffer{ .len = @as(u32, @intCast(bytes.len)), .byte_len = @as(u32, @intCast(bytes.len)), .typed_array_type = typed_array_type, .ptr = bytes.ptr };
    }

    pub fn toJSUnchecked(this: ArrayBuffer, ctx: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        // The reason for this is
        // JSC C API returns a detached arraybuffer
        // if you pass it a zero-length TypedArray
        // we don't ever want to send the user a detached arraybuffer
        // that's just silly.
        if (this.byte_len == 0) {
            if (this.typed_array_type == .ArrayBuffer) {
                return create(ctx, "", .ArrayBuffer);
            }

            if (this.typed_array_type == .Uint8Array) {
                return create(ctx, "", .Uint8Array);
            }

            // TODO: others
        }

        if (this.typed_array_type == .ArrayBuffer) {
            return makeArrayBufferWithBytesNoCopy(
                ctx,
                this.ptr,
                this.byte_len,
                MarkedArrayBuffer_deallocator,
                @as(*anyopaque, @ptrFromInt(@intFromPtr(&bun.default_allocator))),
            );
        }

        return makeTypedArrayWithBytesNoCopy(
            ctx,
            this.typed_array_type.toTypedArrayType(),
            this.ptr,
            this.byte_len,
            MarkedArrayBuffer_deallocator,
            @as(*anyopaque, @ptrFromInt(@intFromPtr(&bun.default_allocator))),
        );
    }

    const log = Output.scoped(.ArrayBuffer, .visible);

    pub fn toJS(this: ArrayBuffer, ctx: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        if (this.value != .zero) {
            return this.value;
        }

        // If it's not a mimalloc heap buffer, we're not going to call a deallocator
        if (this.len > 0 and !bun.mimalloc.mi_is_in_heap_region(this.ptr)) {
            log("toJS but will never free: {d} bytes", .{this.len});

            if (this.typed_array_type == .ArrayBuffer) {
                return makeArrayBufferWithBytesNoCopy(
                    ctx,
                    this.ptr,
                    this.byte_len,
                    null,
                    null,
                );
            }

            return makeTypedArrayWithBytesNoCopy(
                ctx,
                this.typed_array_type.toTypedArrayType(),
                this.ptr,
                this.byte_len,
                null,
                null,
            );
        }

        return this.toJSUnchecked(ctx);
    }

    pub fn toJSWithContext(
        this: ArrayBuffer,
        ctx: *jsc.JSGlobalObject,
        deallocator: ?*anyopaque,
        callback: jsc.C.JSTypedArrayBytesDeallocator,
    ) bun.JSError!jsc.JSValue {
        if (this.value != .zero) {
            return this.value;
        }

        if (this.typed_array_type == .ArrayBuffer) {
            return makeArrayBufferWithBytesNoCopy(
                ctx,
                this.ptr,
                this.byte_len,
                callback,
                deallocator,
            );
        }

        return makeTypedArrayWithBytesNoCopy(
            ctx,
            this.typed_array_type.toTypedArrayType(),
            this.ptr,
            this.byte_len,
            callback,
            deallocator,
        );
    }

    pub const fromArrayBuffer = fromTypedArray;

    /// The equivalent of
    ///
    /// ```js
    ///    new ArrayBuffer(view.buffer, view.byteOffset, view.byteLength)
    /// ```
    pub inline fn byteSlice(this: *const @This()) []u8 {
        if (this.isDetached()) {
            return &.{};
        }
        return this.ptr.?[0..this.byte_len];
    }

    /// The equivalent of
    ///
    /// ```js
    ///    new ArrayBuffer(view.buffer, view.byteOffset, view.byteLength)
    /// ```
    pub const slice = byteSlice;

    pub inline fn asU16(this: *const @This()) []u16 {
        return @alignCast(this.asU16Unaligned());
    }

    pub inline fn asU16Unaligned(this: *const @This()) []align(1) u16 {
        if (this.isDetached()) {
            return &.{};
        }
        return @ptrCast(this.ptr.?[0 .. this.byte_len / @sizeOf(u16) * @sizeOf(u16)]);
    }

    pub inline fn asU32(this: *const @This()) []u32 {
        return @alignCast(this.asU32Unaligned());
    }

    pub inline fn asU32Unaligned(this: *const @This()) []align(1) u32 {
        if (this.isDetached()) {
            return &.{};
        }
        return @ptrCast(this.ptr.?[0 .. this.byte_len / @sizeOf(u32) * @sizeOf(u32)]);
    }

    pub const BinaryType = enum(u4) {
        Buffer,
        ArrayBuffer,
        Uint8Array,
        Uint8ClampedArray,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Float16Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array,
        // DataView,

        pub fn toJSType(this: BinaryType) jsc.JSValue.JSType {
            return switch (this) {
                .ArrayBuffer => .ArrayBuffer,
                .Buffer => .Uint8Array,
                // .DataView => .DataView,
                .Float32Array => .Float32Array,
                .Float16Array => .Float16Array,
                .Float64Array => .Float64Array,
                .Int16Array => .Int16Array,
                .Int32Array => .Int32Array,
                .Int8Array => .Int8Array,
                .Uint16Array => .Uint16Array,
                .Uint32Array => .Uint32Array,
                .Uint8Array => .Uint8Array,
                .Uint8ClampedArray => .Uint8ClampedArray,
                .BigInt64Array => .BigInt64Array,
                .BigUint64Array => .BigUint64Array,
            };
        }

        pub fn toTypedArrayType(this: BinaryType) TypedArrayType {
            return switch (this) {
                .Buffer => .TypeNone,
                .ArrayBuffer => .TypeNone,
                .Int8Array => .TypeInt8,
                .Int16Array => .TypeInt16,
                .Int32Array => .TypeInt32,
                .Uint8Array => .TypeUint8,
                .Uint8ClampedArray => .TypeUint8Clamped,
                .Uint16Array => .TypeUint16,
                .Uint32Array => .TypeUint32,
                .Float16Array => .TypeFloat16,
                .Float32Array => .TypeFloat32,
                .Float64Array => .TypeFloat64,
                .BigInt64Array => .TypeBigInt64,
                .BigUint64Array => .TypeBigUint64,
            };
        }

        pub const Map = bun.ComptimeStringMap(
            BinaryType,
            .{
                .{ "ArrayBuffer", .ArrayBuffer },
                .{ "Buffer", .Buffer },
                // .{ "DataView", .DataView },
                .{ "Float32Array", .Float32Array },
                .{ "Float16Array", .Float16Array },
                .{ "Float64Array", .Float64Array },
                .{ "Int16Array", .Int16Array },
                .{ "Int32Array", .Int32Array },
                .{ "Int8Array", .Int8Array },
                .{ "Uint16Array", .Uint16Array },
                .{ "Uint32Array", .Uint32Array },
                .{ "Uint8Array", .Uint8Array },
                .{ "arraybuffer", .ArrayBuffer },
                .{ "buffer", .Buffer },
                // .{ "dataview", .DataView },
                .{ "float16array", .Float16Array },
                .{ "float32array", .Float32Array },
                .{ "float64array", .Float64Array },
                .{ "int16array", .Int16Array },
                .{ "int32array", .Int32Array },
                .{ "int8array", .Int8Array },
                .{ "nodebuffer", .Buffer },
                .{ "uint16array", .Uint16Array },
                .{ "uint32array", .Uint32Array },
                .{ "uint8array", .Uint8Array },
            },
        );

        pub fn fromString(input: []const u8) ?BinaryType {
            return Map.get(input);
        }

        pub fn fromJSValue(globalThis: *jsc.JSGlobalObject, input: jsc.JSValue) bun.JSError!?BinaryType {
            if (input.isString()) {
                const str = try input.toBunString(globalThis);
                defer str.deref();
                return Map.getWithEql(str, bun.String.eqlComptime);
            }

            return null;
        }

        /// This clones bytes
        pub fn toJS(this: BinaryType, bytes: []const u8, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            switch (this) {
                .Buffer => return jsc.ArrayBuffer.createBuffer(globalThis, bytes),
                .ArrayBuffer => return jsc.ArrayBuffer.create(globalThis, bytes, .ArrayBuffer),
                .Uint8Array => return jsc.ArrayBuffer.create(globalThis, bytes, .Uint8Array),

                // These aren't documented, but they are supported
                .Uint8ClampedArray,
                .Uint16Array,
                .Uint32Array,
                .Int8Array,
                .Int16Array,
                .Int32Array,
                .Float16Array,
                .Float32Array,
                .Float64Array,
                .BigInt64Array,
                .BigUint64Array,
                => {
                    const buffer = try jsc.ArrayBuffer.create(globalThis, bytes, .ArrayBuffer);
                    return jsc.JSValue.c(jsc.C.JSObjectMakeTypedArrayWithArrayBuffer(globalThis, this.toTypedArrayType().toC(), buffer.asObjectRef(), null));
                },
            }
        }
    };

    // Note: keep in sync wih <JavaScriptCore/TypedArrayType.h>
    pub const TypedArrayType = enum(u8) {
        TypeNone,
        TypeInt8,
        TypeUint8,
        TypeUint8Clamped,
        TypeInt16,
        TypeUint16,
        TypeInt32,
        TypeUint32,
        TypeFloat16,
        TypeFloat32,
        TypeFloat64,
        TypeBigInt64,
        TypeBigUint64,
        TypeDataView,

        pub fn toC(this: TypedArrayType) jsc.C.JSTypedArrayType {
            return switch (this) {
                .TypeNone => .kJSTypedArrayTypeNone,
                .TypeInt8 => .kJSTypedArrayTypeInt8Array,
                .TypeInt16 => .kJSTypedArrayTypeInt16Array,
                .TypeInt32 => .kJSTypedArrayTypeInt32Array,
                .TypeUint8 => .kJSTypedArrayTypeUint8Array,
                .TypeUint8Clamped => .kJSTypedArrayTypeUint8ClampedArray,
                .TypeUint16 => .kJSTypedArrayTypeUint16Array,
                .TypeUint32 => .kJSTypedArrayTypeUint32Array,
                .TypeFloat16 => .kJSTypedArrayTypeNone,
                .TypeFloat32 => .kJSTypedArrayTypeFloat32Array,
                .TypeFloat64 => .kJSTypedArrayTypeFloat64Array,
                .TypeBigInt64 => .kJSTypedArrayTypeBigInt64Array,
                .TypeBigUint64 => .kJSTypedArrayTypeBigUint64Array,
                .TypeDataView => .kJSTypedArrayTypeNone,
            };
        }

        pub fn toNapi(this: TypedArrayType) ?bun.api.napi.napi_typedarray_type {
            return switch (this) {
                .TypeNone => null,
                .TypeInt8 => .int8_array,
                .TypeInt16 => .int16_array,
                .TypeInt32 => .int32_array,
                .TypeUint8 => .uint8_array,
                .TypeUint8Clamped => .uint8_clamped_array,
                .TypeUint16 => .uint16_array,
                .TypeUint32 => .uint32_array,
                .TypeFloat16 => null,
                .TypeFloat32 => .float32_array,
                .TypeFloat64 => .float64_array,
                .TypeBigInt64 => .bigint64_array,
                .TypeBigUint64 => .biguint64_array,
                .TypeDataView => null,
            };
        }
    };
};

pub const MarkedArrayBuffer = struct {
    buffer: ArrayBuffer = .{},
    allocator: ?std.mem.Allocator = null,

    pub inline fn stream(this: *MarkedArrayBuffer) ArrayBuffer.Stream {
        return this.buffer.stream();
    }

    pub fn fromTypedArray(ctx: *jsc.JSGlobalObject, value: jsc.JSValue) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .allocator = null,
            .buffer = ArrayBuffer.fromTypedArray(ctx, value),
        };
    }

    pub fn fromArrayBuffer(ctx: *jsc.JSGlobalObject, value: jsc.JSValue) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .allocator = null,
            .buffer = ArrayBuffer.fromArrayBuffer(ctx, value),
        };
    }

    pub fn fromString(str: []const u8, allocator: std.mem.Allocator) !MarkedArrayBuffer {
        const buf = try allocator.dupe(u8, str);
        return MarkedArrayBuffer.fromBytes(buf, allocator, jsc.JSValue.JSType.Uint8Array);
    }

    pub fn fromJS(global: *jsc.JSGlobalObject, value: jsc.JSValue) ?MarkedArrayBuffer {
        const array_buffer = value.asArrayBuffer(global) orelse return null;
        return MarkedArrayBuffer{ .buffer = array_buffer, .allocator = null };
    }

    pub fn fromBytes(bytes: []u8, allocator: std.mem.Allocator, typed_array_type: jsc.JSValue.JSType) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .buffer = ArrayBuffer.fromBytes(bytes, typed_array_type),
            .allocator = allocator,
        };
    }

    pub const empty = MarkedArrayBuffer{
        .allocator = null,
        .buffer = ArrayBuffer.empty,
    };

    pub inline fn slice(this: *const @This()) []u8 {
        return this.buffer.byteSlice();
    }

    pub fn destroy(this: *MarkedArrayBuffer) void {
        const content = this.*;
        if (this.allocator) |allocator| {
            this.allocator = null;
            allocator.free(content.buffer.slice());
            allocator.destroy(this);
        }
    }

    pub fn init(allocator: std.mem.Allocator, size: u32, typed_array_type: jsc.JSValue.JSType) !*MarkedArrayBuffer {
        const bytes = try allocator.alloc(u8, size);
        const container = try allocator.create(MarkedArrayBuffer);
        container.* = MarkedArrayBuffer.fromBytes(bytes, allocator, typed_array_type);
        return container;
    }

    pub fn toNodeBuffer(this: *const MarkedArrayBuffer, ctx: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.createBuffer(ctx, this.buffer.byteSlice());
    }

    pub fn toJS(this: *const MarkedArrayBuffer, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        if (!this.buffer.value.isEmptyOrUndefinedOrNull()) {
            return this.buffer.value;
        }
        if (this.buffer.byte_len == 0) {
            return makeTypedArrayWithBytesNoCopy(
                globalObject,
                this.buffer.typed_array_type.toTypedArrayType(),
                null,
                0,
                null,
                null,
            );
        }
        return makeTypedArrayWithBytesNoCopy(
            globalObject,
            this.buffer.typed_array_type.toTypedArrayType(),
            this.buffer.ptr,
            this.buffer.byte_len,
            MarkedArrayBuffer_deallocator,
            this.buffer.ptr,
        );
    }
};

pub export fn MarkedArrayBuffer_deallocator(bytes_: *anyopaque, _: *anyopaque) void {
    const mimalloc = bun.mimalloc;
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    // if (comptime Environment.allow_assert) {
    //     bun.assert(mimalloc.mi_check_owned(bytes_) or
    //         mimalloc.mi_heap_check_owned(jsc.VirtualMachine.get().arena.heap.?, bytes_));
    // }

    mimalloc.mi_free(bytes_);
}

pub export fn BlobArrayBuffer_deallocator(_: *anyopaque, blob: *anyopaque) void {
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    var store = bun.cast(*jsc.WebCore.Blob.Store, blob);
    store.deref();
}

extern fn Bun__makeArrayBufferWithBytesNoCopy(*jsc.JSGlobalObject, ?*anyopaque, usize, jsc.C.JSTypedArrayBytesDeallocator, ?*anyopaque) jsc.JSValue;
extern fn Bun__makeTypedArrayWithBytesNoCopy(*jsc.JSGlobalObject, ArrayBuffer.TypedArrayType, ?*anyopaque, usize, jsc.C.JSTypedArrayBytesDeallocator, ?*anyopaque) jsc.JSValue;

pub fn makeArrayBufferWithBytesNoCopy(globalObject: *jsc.JSGlobalObject, ptr: ?*anyopaque, len: usize, deallocator: jsc.C.JSTypedArrayBytesDeallocator, deallocatorContext: ?*anyopaque) bun.JSError!jsc.JSValue {
    return bun.jsc.fromJSHostCall(globalObject, @src(), Bun__makeArrayBufferWithBytesNoCopy, .{ globalObject, ptr, len, deallocator, deallocatorContext });
}

pub fn makeTypedArrayWithBytesNoCopy(globalObject: *jsc.JSGlobalObject, arrayType: ArrayBuffer.TypedArrayType, ptr: ?*anyopaque, len: usize, deallocator: jsc.C.JSTypedArrayBytesDeallocator, deallocatorContext: ?*anyopaque) bun.JSError!jsc.JSValue {
    return bun.jsc.fromJSHostCall(globalObject, @src(), Bun__makeTypedArrayWithBytesNoCopy, .{ globalObject, arrayType, ptr, len, deallocator, deallocatorContext });
}

/// Corresponds to `JSC::ArrayBuffer`.
pub const JSCArrayBuffer = opaque {
    const Self = @This();

    extern fn JSC__ArrayBuffer__asBunArrayBuffer(self: *Self, out: *ArrayBuffer) void;
    extern fn JSC__ArrayBuffer__ref(self: *Self) void;
    extern fn JSC__ArrayBuffer__deref(self: *Self) void;

    pub const Ref = bun.ptr.ExternalShared(Self);

    pub const external_shared_descriptor = struct {
        pub const ref = JSC__ArrayBuffer__ref;
        pub const deref = JSC__ArrayBuffer__deref;
    };

    pub fn asArrayBuffer(self: *Self) ArrayBuffer {
        var out: ArrayBuffer = undefined;
        JSC__ArrayBuffer__asBunArrayBuffer(self, &out);
        return out;
    }
};

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const Output = bun.Output;
const jsc = bun.jsc;
