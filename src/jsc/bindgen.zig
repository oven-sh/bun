pub fn BindgenTrivial(comptime T: type) type {
    return struct {
        pub const ZigType = T;
        pub const ExternType = T;

        pub fn convertFromExtern(extern_value: ExternType) ZigType {
            return extern_value;
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
    pub const ExternType = ?*jsc.Strong.Impl;
    pub const OptionalZigType = ZigType.Optional;
    pub const OptionalExternType = ExternType;

    pub fn convertFromExtern(extern_value: ExternType) ZigType {
        return .{ .impl = extern_value.? };
    }

    pub fn convertOptionalFromExtern(extern_value: OptionalExternType) OptionalZigType {
        return .{ .impl = extern_value };
    }
};

/// This represents both `IDLNull` and `IDLMonostateUndefined`.
pub const BindgenNull = struct {
    pub const ZigType = void;
    pub const ExternType = u8;

    pub fn convertFromExtern(extern_value: ExternType) ZigType {
        _ = extern_value;
    }
};

pub fn BindgenOptional(comptime Child: type) type {
    return struct {
        pub const ZigType = if (@hasDecl(Child, "OptionalZigType"))
            Child.OptionalZigType
        else
            ?Child.ZigType;

        pub const ExternType = if (@hasDecl(Child, "OptionalExternType"))
            Child.OptionalExternType
        else
            ExternTaggedUnion(&.{ u8, Child.ExternType });

        pub fn convertFromExtern(extern_value: ExternType) ZigType {
            if (comptime @hasDecl(Child, "OptionalExternType")) {
                return Child.convertOptionalFromExtern(extern_value);
            }
            if (extern_value.tag == 0) {
                return null;
            }
            bun.assert_eql(extern_value.tag, 1);
            return Child.convertFromExtern(extern_value.data.@"1");
        }
    };
}

pub const BindgenString = struct {
    pub const ZigType = bun.string.WTFString;
    pub const ExternType = ?bun.string.WTFStringImpl;
    pub const OptionalZigType = ZigType.Optional;
    pub const OptionalExternType = ExternType;

    pub fn convertFromExtern(extern_value: ExternType) ZigType {
        return .adopt(extern_value.?);
    }

    pub fn convertOptionalFromExtern(extern_value: OptionalExternType) OptionalZigType {
        return .adopt(extern_value);
    }
};

pub fn BindgenUnion(comptime children: []const type) type {
    var tagged_field_types: [children.len]type = undefined;
    var untagged_field_types: [children.len]type = undefined;
    for (&tagged_field_types, &untagged_field_types, children) |*tagged, *untagged, *child| {
        tagged.* = child.ZigType;
        untagged.* = child.ExternType;
    }

    const tagged_field_types_const = tagged_field_types;
    const untagged_field_types_const = untagged_field_types;
    const zig_type = bun.meta.TaggedUnion(&tagged_field_types_const);
    const extern_type = ExternTaggedUnion(&untagged_field_types_const);

    return struct {
        pub const ZigType = zig_type;
        pub const ExternType = extern_type;

        pub fn convertFromExtern(extern_value: ExternType) ZigType {
            const tag: std.meta.Tag(ZigType) = @enumFromInt(extern_value.tag);
            return switch (tag) {
                inline else => |t| @unionInit(
                    ZigType,
                    @tagName(t),
                    children[@intFromEnum(t)].convertFromExtern(
                        @field(extern_value.data, @tagName(t)),
                    ),
                ),
            };
        }
    };
}

pub fn ExternTaggedUnion(comptime field_types: []const type) type {
    if (comptime field_types.len > std.math.maxInt(u8)) {
        @compileError("too many union fields");
    }
    return extern struct {
        data: ExternUnion(field_types),
        tag: u8,
    };
}

fn ExternUnion(comptime field_types: []const type) type {
    var info = @typeInfo(bun.meta.TaggedUnion(field_types));
    info.@"union".tag_type = null;
    info.@"union".layout = .@"extern";
    info.@"union".decls = &.{};
    return @Type(info);
}

pub fn BindgenArray(comptime Child: type) type {
    return struct {
        pub const ZigType = bun.collections.ArrayListDefault(Child.ZigType);
        pub const ExternType = ExternArrayList(Child.ExternType);

        pub fn convertFromExtern(extern_value: ExternType) ZigType {
            const length: usize = @intCast(extern_value.length);
            const capacity: usize = @intCast(extern_value.capacity);

            const data = extern_value.data orelse return .init();
            bun.assertf(
                length <= capacity,
                "length ({d}) should not exceed capacity ({d})",
                .{ length, capacity },
            );
            var unmanaged: std.ArrayListUnmanaged(Child.ExternType) = .{
                .items = data[0..length],
                .capacity = capacity,
            };

            if (comptime !bun.use_mimalloc) {
                // Don't reuse memory in this case; it would be freed by the wrong allocator.
            } else if (comptime Child.ZigType == Child.ExternType) {
                return .fromUnmanaged(.{}, unmanaged);
            } else if (comptime @sizeOf(Child.ZigType) <= @sizeOf(Child.ExternType) and
                @alignOf(Child.ZigType) <= bun.allocators.mimalloc.MI_MAX_ALIGN_SIZE)
            {
                // We can reuse the allocation, but we still need to convert the elements.
                var storage: []u8 = @ptrCast(unmanaged.allocatedSlice());

                // Convert the elements.
                for (0..length) |i| {
                    // Zig doesn't have a formal aliasing model, so we should be maximally
                    // pessimistic.
                    var old_elem: Child.ExternType = undefined;
                    @memcpy(
                        std.mem.asBytes(&old_elem),
                        storage[i * @sizeOf(Child.ExternType) ..][0..@sizeOf(Child.ExternType)],
                    );
                    const new_elem = Child.convertFromExtern(old_elem);
                    @memcpy(
                        storage[i * @sizeOf(Child.ZigType) ..][0..@sizeOf(Child.ZigType)],
                        std.mem.asBytes(&new_elem),
                    );
                }

                const new_size_is_multiple =
                    comptime @sizeOf(Child.ExternType) % @sizeOf(Child.ZigType) == 0;
                const new_capacity = if (comptime new_size_is_multiple)
                    capacity * (@sizeOf(Child.ExternType) / @sizeOf(Child.ZigType))
                else blk: {
                    const new_capacity = storage.len / @sizeOf(Child.ZigType);
                    const new_alloc_size = new_capacity * @sizeOf(Child.ZigType);
                    if (new_alloc_size != storage.len) {
                        // Allocation isn't a multiple of `@sizeOf(Child.ZigType)`; we have to
                        // resize it.
                        storage = bun.handleOom(
                            bun.default_allocator.realloc(storage, new_alloc_size),
                        );
                    }
                    break :blk new_capacity;
                };

                const items_ptr: [*]Child.ZigType = @ptrCast(@alignCast(storage.ptr));
                const new_unmanaged: std.ArrayListUnmanaged(Child.ZigType) = .{
                    .items = items_ptr[0..length],
                    .capacity = new_capacity,
                };
                return .fromUnmanaged(.{}, new_unmanaged);
            }

            defer unmanaged.deinit(
                if (bun.use_mimalloc) bun.default_allocator else std.heap.raw_c_allocator,
            );
            var result = bun.handleOom(ZigType.initCapacity(length));
            for (unmanaged.items) |*item| {
                result.appendAssumeCapacity(Child.convertFromExtern(item.*));
            }
            return result;
        }
    };
}

fn ExternArrayList(comptime Child: type) type {
    return extern struct {
        data: ?[*]Child,
        length: c_uint,
        capacity: c_uint,
    };
}

fn BindgenExternalShared(comptime T: type) type {
    return struct {
        pub const ZigType = bun.ptr.ExternalShared(T);
        pub const ExternType = ?*T;
        pub const OptionalZigType = ZigType.Optional;
        pub const OptionalExternType = ExternType;

        pub fn convertFromExtern(extern_value: ExternType) ZigType {
            return .adopt(extern_value.?);
        }

        pub fn convertOptionalFromExtern(extern_value: OptionalExternType) OptionalZigType {
            return .adopt(extern_value);
        }
    };
}

pub const BindgenArrayBuffer = BindgenExternalShared(jsc.JSCArrayBuffer);
pub const BindgenBlob = BindgenExternalShared(webcore.Blob);

const bun = @import("bun");
const std = @import("std");

const jsc = bun.bun_js.jsc;
const webcore = bun.bun_js.webcore;
