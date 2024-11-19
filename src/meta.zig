const std = @import("std");
const bun = @import("root").bun;

pub usingnamespace std.meta;

pub fn OptionalChild(comptime T: type) type {
    const tyinfo = @typeInfo(T);
    if (tyinfo != .Pointer) @compileError("OptionalChild(T) requires that T be a pointer to an optional type.");
    const child = @typeInfo(tyinfo.Pointer.child);
    if (child != .Optional) @compileError("OptionalChild(T) requires that T be a pointer to an optional type.");
    return child.Optional.child;
}

pub fn EnumFields(comptime T: type) []const std.builtin.Type.EnumField {
    const tyinfo = @typeInfo(T);
    return switch (tyinfo) {
        .Union => std.meta.fields(tyinfo.Union.tag_type.?),
        .Enum => tyinfo.Enum.fields,
        else => {
            @compileError("Used `EnumFields(T)` on a type that is not an `enum` or a `union(enum)`");
        },
    };
}

pub fn ReturnOf(comptime function: anytype) type {
    return ReturnOfType(@TypeOf(function));
}

pub fn ReturnOfType(comptime Type: type) type {
    const typeinfo: std.builtin.Type.Fn = @typeInfo(Type).Fn;
    return typeinfo.return_type orelse void;
}

pub fn typeName(comptime Type: type) []const u8 {
    const name = @typeName(Type);
    return typeBaseName(name);
}

/// partially emulates behaviour of @typeName in previous Zig versions,
/// converting "some.namespace.MyType" to "MyType"
pub fn typeBaseName(comptime fullname: [:0]const u8) [:0]const u8 {
    // leave type name like "namespace.WrapperType(namespace.MyType)" as it is
    const baseidx = comptime std.mem.indexOf(u8, fullname, "(");
    if (baseidx != null) return fullname;

    const idx = comptime std.mem.lastIndexOf(u8, fullname, ".");

    const name = if (idx == null) fullname else fullname[(idx.? + 1)..];
    return comptime std.fmt.comptimePrint("{s}", .{name});
}

pub fn enumFieldNames(comptime Type: type) []const []const u8 {
    var names: [std.meta.fields(Type).len][]const u8 = std.meta.fieldNames(Type).*;
    var i: usize = 0;
    for (names) |name| {
        // zig seems to include "_" or an empty string in the list of enum field names
        // it makes sense, but humans don't want that
        if (bun.strings.eqlAnyComptime(name, &.{ "_none", "", "_" })) {
            continue;
        }
        names[i] = name;
        i += 1;
    }
    return names[0..i];
}

pub fn banFieldType(comptime Container: type, comptime T: type) void {
    comptime {
        for (std.meta.fields(Container)) |field| {
            if (field.type == T) {
                @compileError(std.fmt.comptimePrint(typeName(T) ++ " field \"" ++ field.name ++ "\" not allowed in " ++ typeName(Container), .{}));
            }
        }
    }
}

// []T -> T
// *const T -> T
// *[n]T -> T
pub fn Item(comptime T: type) type {
    switch (@typeInfo(T)) {
        .Pointer => |ptr| {
            if (ptr.size == .One) {
                switch (@typeInfo(ptr.child)) {
                    .Array => |array| {
                        return array.child;
                    },
                    else => {},
                }
            }
            return ptr.child;
        },
        else => return std.meta.Child(T),
    }
}

/// Returns a tuple of arguments to func, with the first two arguments passed separately and the
/// rest from a tuple
pub inline fn ConcatArgs2(
    /// The function to create arguments for
    comptime func: anytype,
    /// Value for the first argument to func
    a: @typeInfo(@TypeOf(func)).Fn.params[0].type.?,
    /// Value for the second argument to func
    b: @typeInfo(@TypeOf(func)).Fn.params[1].type.?,
    /// Tuple containing the other arguments to func
    rest: anytype, // TODO: deduce an exact type from func's arguments (@190n's attempt crashed the zig compiler)
) std.meta.ArgsTuple(@TypeOf(func)) {
    var args: std.meta.ArgsTuple(@TypeOf(func)) = undefined;
    args[0] = a;
    args[1] = b;

    inline for (rest, 2..) |arg, i| {
        args[i] = arg;
    }

    return args;
}

pub fn isSimpleCopyType(comptime T: type) bool {
    const tyinfo = @typeInfo(T);
    return switch (tyinfo) {
        .Void => true,
        .Bool => true,
        .Int => true,
        .Float => true,
        .Enum => true,
        .Struct => {
            inline for (tyinfo.Struct.fields) |field| {
                if (!isSimpleCopyType(field.type)) return false;
            }
            return true;
        },
        .Union => {
            inline for (tyinfo.Union.fields) |field| {
                if (!isSimpleCopyType(field.type)) return false;
            }
            return true;
        },
        .Optional => return isSimpleCopyType(tyinfo.Optional.child),
        else => false,
    };
}

pub fn isSimpleEqlType(comptime T: type) bool {
    const tyinfo = @typeInfo(T);
    return switch (tyinfo) {
        .Type => true,
        .Void => true,
        .Bool => true,
        .Int => true,
        .Float => true,
        .Enum => true,
        else => false,
    };
}

pub const ListContainerType = enum {
    array_list,
    baby_list,
    small_list,
};
pub fn looksLikeListContainerType(comptime T: type) ?struct { list: ListContainerType, child: type } {
    const tyinfo = @typeInfo(T);
    if (tyinfo == .Struct) {
        // Looks like array list
        if (tyinfo.Struct.fields.len == 2 and
            std.mem.eql(u8, tyinfo.Struct.fields[0].name, "items") and
            std.mem.eql(u8, tyinfo.Struct.fields[1].name, "capacity"))
            return .{ .list = .array_list, .child = std.meta.Child(tyinfo.Struct.fields[0].type) };

        // Looks like babylist
        if (tyinfo.Struct.fields.len == 3 and
            std.mem.eql(u8, tyinfo.Struct.fields[0].name, "ptr") and
            std.mem.eql(u8, tyinfo.Struct.fields[1].name, "len") and
            std.mem.eql(u8, tyinfo.Struct.fields[2].name, "cap"))
            return .{ .list = .baby_list, .child = std.meta.Child(tyinfo.Struct.fields[0].type) };

        // Looks like SmallList
        if (tyinfo.Struct.fields.len == 2 and
            std.mem.eql(u8, tyinfo.Struct.fields[0].name, "capacity") and
            std.mem.eql(u8, tyinfo.Struct.fields[1].name, "data")) return .{
            .list = .small_list,
            .child = std.meta.Child(
                @typeInfo(tyinfo.Struct.fields[1].type).Union.fields[0].type,
            ),
        };
    }

    return null;
}
