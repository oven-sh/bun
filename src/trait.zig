/// Returns true if the passed type will coerce to []const u8.
/// Any of the following are considered strings:
/// ```
/// []const u8, [:S]const u8, *const [N]u8, *const [N:S]u8,
/// []u8, [:S]u8, *[:S]u8, *[N:S]u8.
/// ```
/// These types are not considered strings:
/// ```
/// u8, [N]u8, [*]const u8, [*:0]const u8,
/// [*]const [N]u8, []const u16, []const i8,
/// *const u8, ?[]const u8, ?*const [N]u8.
/// ```
pub inline fn isZigString(comptime T: type) bool {
    return comptime blk: {
        // Only pointer types can be strings, no optionals
        const info = @typeInfo(T);
        if (info != .Pointer) break :blk false;

        const ptr = &info.Pointer;
        // Check for CV qualifiers that would prevent coerction to []const u8
        if (ptr.is_volatile or ptr.is_allowzero) break :blk false;

        // If it's already a slice, simple check.
        if (ptr.size == .Slice) {
            break :blk ptr.child == u8;
        }

        // Otherwise check if it's an array type that coerces to slice.
        if (ptr.size == .One) {
            const child = @typeInfo(ptr.child);
            if (child == .Array) {
                const arr = &child.Array;
                break :blk arr.child == u8;
            }
        }

        break :blk false;
    };
}

pub inline fn isSlice(comptime T: type) bool {
    const info = @typeInfo(T);
    return info == .Pointer and info.Pointer.size == .Slice;
}

pub inline fn isNumber(comptime T: type) bool {
    return switch (@typeInfo(T)) {
        .Int, .Float, .ComptimeInt, .ComptimeFloat => true,
        else => false,
    };
}

pub inline fn isContainer(comptime T: type) bool {
    return switch (@typeInfo(T)) {
        .Struct, .Enum, .Opaque, .Union => true,
        else => false,
    };
}

pub inline fn isSingleItemPtr(comptime T: type) bool {
    const info = @typeInfo(T);
    return info == .Pointer and .Pointer.size == .One;
}

pub fn isExternContainer(comptime T: type) bool {
    return switch (@typeInfo(T)) {
        .Struct => |s| s.layout == .@"extern",
        .Union => |u| u.layout == .@"extern",
        else => false,
    };
}

pub fn isConstPtr(comptime T: type) bool {
    const info = @typeInfo(T);
    return info == .Pointer and info.Pointer.is_const;
}

pub fn isIndexable(comptime T: type) bool {
    const info = @typeInfo(T);
    return switch (info) {
        .Pointer => |ptr| switch (ptr.size) {
            .One => @typeInfo(ptr.child) == .Array,
            else => true,
        },
        .Array, .Vector => true,
        .Struct => |s| s.is_tuple,
        else => false,
    };
}
