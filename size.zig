const std = @import("std");

pub const Ident = union(enum) {
    foo: i32,
    bar: i32,
    baz: i32,
};

pub fn main() void {
    const ident: Ident = .{ .foo = 420 };
    switch (ident) {
        .foo => |val| std.debug.print("FOO: {d}\n", .{val}),
        else => |lol| {
            std.debug.print("FUCK: {any}\n", .{lol});
        },
    }
}
