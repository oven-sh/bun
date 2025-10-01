pub fn BindgenTrivial(comptime T: type) type {
    return struct {
        pub const ZigType = T;
        pub const FFIType = T;

        pub fn convertFromFFI(ffi_value: FFIType) ZigType {
            return ffi_value;
        }
    };
}

pub const BindgenBool = BindgenTrivial(bool);
pub const BindgenU8 = BindgenTrivial(u8);
pub const BindgenI8 = BindgenTrivial(i8);
pub const BindgenU16 = BindgenTrivial(u16);
pub const BindgenI16 = BindgenTrivial(i16);
pub const BindgenU32 = BindgenTrivial(u32);
pub const BindgenI32 = BindgenTrivial(i32);
pub const BindgenU64 = BindgenTrivial(u64);
pub const BindgenI64 = BindgenTrivial(i64);
pub const BindgenF64 = BindgenTrivial(f64);
pub const BindgenRawAny = BindgenTrivial(jsc.JSValue);

pub const BindgenStrongAny = struct {
    pub const ZigType = jsc.Strong;
    pub const FFIType = ?*jsc.Strong.Impl;
    pub const OptionalZigType = ZigType.Optional;
    pub const OptionalFFIType = FFIType;

    pub fn convertFromFFI(ffi_value: FFIType) ZigType {
        return .{ .impl = ffi_value.? };
    }

    pub fn convertOptionalFromFFI(ffi_value: OptionalFFIType) OptionalZigType {
        return .{ .impl = ffi_value };
    }
};

/// This represents both `IDLNull` and `IDLMonostateUndefined`.
pub const BindgenNull = struct {
    pub const ZigType = void;
    pub const FFIType = u8;

    pub fn convertFromFFI(ffi_value: FFIType) ZigType {
        _ = ffi_value;
    }
};

pub fn BindgenOptional(comptime Child: type) type {
    return struct {
        pub const ZigType = if (@hasDecl(Child, "OptionalZigType"))
            Child.OptionalZigType
        else
            ?Child.ZigType;

        pub const FFIType = if (@hasDecl(Child, "OptionalFFIType"))
            Child.OptionalFFIType
        else
            FFITaggedUnion(&.{ u8, Child.FFIType });

        pub fn convertFromFFI(ffi_value: FFIType) ZigType {
            if (comptime @hasDecl(Child, "OptionalFFIType")) {
                return Child.convertOptionalFromFFI(ffi_value);
            }
            if (ffi_value.tag == 0) {
                return null;
            }
            bun.assert_eql(ffi_value.tag, 1);
            return Child.convertFromFFI(ffi_value.data.@"1");
        }
    };
}

pub const BindgenString = struct {
    pub const ZigType = bun.string.WTFString;
    pub const FFIType = ?bun.string.WTFStringImpl;
    pub const OptionalZigType = ZigType.Optional;
    pub const OptionalFFIType = FFIType;

    pub fn convertFromFFI(ffi_value: FFIType) ZigType {
        return .adopt(ffi_value.?);
    }

    pub fn convertOptionalFromFFI(ffi_value: OptionalFFIType) OptionalZigType {
        return .adopt(ffi_value);
    }
};

pub fn BindgenUnion(comptime children: []const type) type {
    var tagged_field_types: [children.len]type = undefined;
    var untagged_field_types: [children.len]type = undefined;
    for (&tagged_field_types, &untagged_field_types, children) |*tagged, *untagged, *child| {
        tagged.* = child.ZigType;
        untagged.* = child.FFIType;
    }

    const tagged_field_types_const = tagged_field_types;
    const untagged_field_types_const = untagged_field_types;
    const zig_type = bun.meta.TaggedUnion(&tagged_field_types_const);
    const ffi_type = FFITaggedUnion(&untagged_field_types_const);

    return struct {
        pub const ZigType = zig_type;
        pub const FFIType = ffi_type;

        pub fn convertFromFFI(ffi_value: FFIType) ZigType {
            const tag: std.meta.Tag(ZigType) = @enumFromInt(ffi_value.tag);
            return switch (tag) {
                inline else => |t| @unionInit(
                    ZigType,
                    @tagName(t),
                    children[@intFromEnum(t)].convertFromFFI(
                        @field(ffi_value.data, @tagName(t)),
                    ),
                ),
            };
        }
    };
}

pub fn FFITaggedUnion(comptime field_types: []const type) type {
    if (comptime field_types.len > std.math.maxInt(u8)) {
        @compileError("too many union fields");
    }
    return extern struct {
        data: FFIUnion(field_types),
        tag: u8,
    };
}

fn FFIUnion(comptime field_types: []const type) type {
    var info = @typeInfo(bun.meta.TaggedUnion(field_types));
    info.@"union".tag_type = null;
    info.@"union".layout = .@"extern";
    info.@"union".decls = &.{};
    return @Type(info);
}

pub fn BindgenArray(comptime Child: type) type {
    return struct {
        pub const ZigType = bun.collections.ArrayListDefault(Child.ZigType);
        pub const FFIType = FFIArrayList(Child.FFIType);

        pub fn convertFromFFI(ffi_value: FFIType) ZigType {
            const length: usize = @intCast(ffi_value.length);
            const capacity: usize = @intCast(ffi_value.capacity);

            const data = ffi_value.data orelse return .init();
            var unmanaged: std.ArrayListUnmanaged(Child.FFIType) = .{
                .items = data[0..length],
                .capacity = capacity,
            };

            if (comptime !bun.use_mimalloc) {} else if (comptime Child.ZigType == Child.FFIType) {
                return .fromUnmanaged(.{}, unmanaged);
            } else if (comptime @sizeOf(Child.ZigType) <= @sizeOf(Child.FFIType) and
                @alignOf(Child.ZigType) <= bun.allocators.mimalloc.MI_MAX_ALIGN_SIZE)
            {
                // We can reuse the allocation, but we still need to convert the elements.
                var storage: []u8 = @ptrCast(unmanaged.allocatedSlice());
                var new_capacity = unmanaged.capacity;
                if (comptime @sizeOf(Child.FFIType) % @sizeOf(Child.ZigType) != 0) {
                    new_capacity = storage.len / @sizeOf(Child.ZigType);
                    const new_alloc_size = new_capacity * @sizeOf(Child.ZigType);
                    if (new_alloc_size != storage.len) {
                        // Allocation isn't a multiple of `@sizeOf(Child.ZigType)`; we have to
                        // resize it.
                        storage = bun.handleOom(
                            bun.default_allocator.realloc(storage, new_alloc_size),
                        );
                    }
                }
                // Convert the elements.
                for (0..length) |i| {
                    // Zig doesn't have a formal aliasing model, so we should be maximally
                    // pessimistic.
                    var old_elem: Child.FFIType = undefined;
                    @memcpy(
                        std.mem.asBytes(&old_elem),
                        storage[i * @sizeOf(Child.FFIType) ..][0..@sizeOf(Child.FFIType)],
                    );
                    const new_elem = Child.convertFromFFI(old_elem);
                    @memcpy(
                        storage[i * @sizeOf(Child.ZigType) ..][0..@sizeOf(Child.ZigType)],
                        std.mem.asBytes(&new_elem),
                    );
                }
                const items_ptr: [*]Child.ZigType = @ptrCast(@alignCast(storage.ptr));
                const items = items_ptr[0..length];
                return .fromOwnedSlice(.{}, items);
            }

            defer unmanaged.deinit(
                if (bun.use_mimalloc) bun.default_allocator else std.heap.raw_c_allocator,
            );
            var result = bun.handleOom(ZigType.initCapacity(length));
            for (unmanaged.items) |*item| {
                result.appendAssumeCapacity(Child.convertFromFFI(item.*));
            }
            return result;
        }
    };
}

fn FFIArrayList(comptime Child: type) type {
    return extern struct {
        data: ?[*]Child,
        length: c_uint,
        capacity: c_uint,
    };
}

fn BindgenExternalShared(comptime T: type) type {
    return struct {
        pub const ZigType = bun.ptr.ExternalShared(T);
        pub const FFIType = ?*T;
        pub const OptionalZigType = ZigType.Optional;
        pub const OptionalFFIType = FFIType;

        pub fn convertFromFFI(ffi_value: FFIType) ZigType {
            return .adopt(ffi_value.?);
        }

        pub fn convertOptionalFromFFI(ffi_value: OptionalFFIType) OptionalZigType {
            return .adopt(ffi_value);
        }
    };
}

pub const BindgenArrayBuffer = BindgenExternalShared(jsc.JSCArrayBuffer);
pub const BindgenBlob = BindgenExternalShared(webcore.Blob);

const bun = @import("bun");
const std = @import("std");

const jsc = bun.bun_js.jsc;
const webcore = bun.bun_js.webcore;
