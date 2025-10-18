/// In some parts of lockfile serialization, Bun will use `std.mem.sliceAsBytes` to convert a struct into raw
/// bytes to write. This makes lockfile serialization/deserialization much simpler/faster, at the cost of not
/// having any pointers within these structs.
///
/// One major caveat of this is that if any of these structs have uninitialized memory, then that can leak
/// garbage memory into the lockfile. See https://github.com/oven-sh/bun/issues/4319
///
/// The obvious way to introduce undefined memory into a struct is via `.field = undefined`, but a much more
/// subtle way is to have implicit padding in an extern struct. For example:
/// ```zig
/// const Demo = struct {
///     a: u8,  // @sizeOf(Demo, "a") == 1,   @offsetOf(Demo, "a") == 0
///     b: u64, // @sizeOf(Demo, "b") == 8,   @offsetOf(Demo, "b") == 8
/// }
/// ```
///
/// `a` is only one byte long, but due to the alignment of `b`, there is 7 bytes of padding between `a` and `b`,
/// which is considered *undefined memory*.
///
/// The solution is to have it explicitly initialized to zero bytes, like:
/// ```zig
/// const Demo = extern struct {
///     a: u8,
///     _padding: [7]u8 = .{0} ** 7,
///     b: u64, // same offset as before
/// }
/// ```
///
/// There is one other way to introduce undefined memory into a struct, which this does not check for, and that is
/// a union with unequal size fields.
pub fn assertNoUninitializedPadding(comptime T: type) void {
    const info_ = @typeInfo(T);
    const info = switch (info_) {
        .@"struct" => info_.@"struct",
        .@"union" => info_.@"union",
        .array => |a| {
            assertNoUninitializedPadding(a.child);
            return;
        },
        .optional => |a| {
            assertNoUninitializedPadding(a.child);
            return;
        },
        .pointer => |ptr| {
            // Pointers aren't allowed, but this just makes the assertion easier to invoke.
            assertNoUninitializedPadding(ptr.child);
            return;
        },
        else => {
            return;
        },
    };
    // if (info.layout != .Extern) {
    //     @compileError("assertNoUninitializedPadding(" ++ @typeName(T) ++ ") expects an extern struct type, got a struct of layout '" ++ @tagName(info.layout) ++ "'");
    // }
    for (info.fields) |field| {
        const fieldInfo = @typeInfo(field.type);
        switch (fieldInfo) {
            .@"struct" => assertNoUninitializedPadding(field.type),
            .@"union" => assertNoUninitializedPadding(field.type),
            .array => |a| assertNoUninitializedPadding(a.child),
            .optional => |a| assertNoUninitializedPadding(a.child),
            .pointer => {
                @compileError("Expected no pointer types in " ++ @typeName(T) ++ ", found field '" ++ field.name ++ "' of type '" ++ @typeName(field.type) ++ "'");
            },
            else => {},
        }
    }

    if (info_ == .@"union") {
        return;
    }

    var i = 0;
    for (info.fields, 0..) |field, j| {
        const offset = @offsetOf(T, field.name);
        if (offset != i) {
            @compileError(std.fmt.comptimePrint(
                \\Expected no possibly uninitialized bytes of memory in '{s}', but found a {d} byte gap between fields '{s}' and '{s}' This can be fixed by adding a padding field to the struct like `padding: [{d}]u8 = .{{0}} ** {d},` between these fields. For more information, look at `padding_checker.zig`
            ,
                .{
                    @typeName(T),
                    offset - i,
                    info.fields[j - 1].name,
                    field.name,
                    offset - i,
                    offset - i,
                },
            ));
        }
        i = offset + @sizeOf(field.type);
    }

    if (i != @sizeOf(T)) {
        @compileError(std.fmt.comptimePrint(
            \\Expected no possibly uninitialized bytes of memory in '{s}', but found a {d} byte gap at the end of the struct. This can be fixed by adding a padding field to the struct like `padding: [{d}]u8 = .{{0}} ** {d},` between these fields. For more information, look at `padding_checker.zig`
        ,
            .{
                @typeName(T),
                @sizeOf(T) - i,
                @sizeOf(T) - i,
                @sizeOf(T) - i,
            },
        ));
    }
}

const std = @import("std");
