const std = @import("std");
const bun = @import("root").bun;

pub usingnamespace std.meta;

pub fn ReturnOfMaybe(comptime function: anytype) type {
    const Func = @TypeOf(function);
    const typeinfo: std.builtin.Type.Fn = @typeInfo(Func).Fn;
    const MaybeType = typeinfo.return_type orelse @compileError("Expected the function to have a return type");
    return MaybeResult(MaybeType);
}

pub fn MaybeResult(comptime MaybeType: type) type {
    const maybe_ty_info = @typeInfo(MaybeType);

    const maybe = maybe_ty_info.Union;
    if (maybe.fields.len != 2) @compileError("Expected the Maybe type to be a union(enum) with two variants");

    if (std.mem.eql(u8, maybe.fields[0].name, "err")) {
        @compileError("Expected the first field of the Maybe type to be \"err\"");
    }

    if (std.mem.eql(u8, maybe.fields[1].name, "result")) {
        @compileError("Expected the first field of the Maybe type to be \"err\"");
    }

    return maybe.fields[1].type;
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

// partially emulates behaviour of @typeName in previous Zig versions,
// converting "some.namespace.MyType" to "MyType"
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

/// Returns .{a, ...args_}
pub fn ConcatArgs1(
    comptime func: anytype,
    comptime a: anytype,
    comptime args_: anytype,
) std.meta.ArgsTuple(@TypeOf(func)) {
    var args: std.meta.ArgsTuple(@TypeOf(func)) = undefined;
    args[0] = a;

    inline for (args_, 1..) |arg, i| {
        args[i] = arg;
    }

    return args;
}

/// Returns .{a, b, ...args_}
pub inline fn ConcatArgs2(
    comptime func: anytype,
    a: anytype,
    b: anytype,
    args_: anytype,
) std.meta.ArgsTuple(@TypeOf(func)) {
    var args: std.meta.ArgsTuple(@TypeOf(func)) = undefined;
    args[0] = a;
    args[1] = b;

    inline for (args_, 2..) |arg, i| {
        args[i] = arg;
    }

    return args;
}

/// Returns .{a, b, c, d, ...args_}
pub inline fn ConcatArgs4(
    comptime func: anytype,
    a: anytype,
    b: anytype,
    c: anytype,
    d: anytype,
    args_: anytype,
) std.meta.ArgsTuple(@TypeOf(func)) {
    var args: std.meta.ArgsTuple(@TypeOf(func)) = undefined;
    args[0] = a;
    args[1] = b;
    args[2] = c;
    args[3] = d;

    inline for (args_, 4..) |arg, i| {
        args[i] = arg;
    }

    return args;
}
