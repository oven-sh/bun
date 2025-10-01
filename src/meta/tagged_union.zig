fn deinitImpl(comptime Union: type, value: *Union) void {
    switch (std.meta.activeTag(value.*)) {
        inline else => |tag| bun.memory.deinit(&@field(value, @tagName(tag))),
    }
    value.* = undefined;
}

/// Creates a tagged union with fields corresponding to `field_types`. The fields are named
/// @"0", @"1", @"2", etc.
pub fn TaggedUnion(comptime field_types: []const type) type {
    // Types created with @Type can't contain decls, so in order to have a `deinit` method, we
    // have to do it this way...
    return switch (comptime field_types.len) {
        0 => @compileError("cannot create an empty tagged union"),
        1 => union(enum) {
            @"0": field_types[0],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        2 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        3 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        4 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        5 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        6 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        7 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        8 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        9 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        10 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            @"9": field_types[9],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        11 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            @"9": field_types[9],
            @"10": field_types[10],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        12 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            @"9": field_types[9],
            @"10": field_types[10],
            @"11": field_types[11],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        13 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            @"9": field_types[9],
            @"10": field_types[10],
            @"11": field_types[11],
            @"12": field_types[12],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        14 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            @"9": field_types[9],
            @"10": field_types[10],
            @"11": field_types[11],
            @"12": field_types[12],
            @"13": field_types[13],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        15 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            @"9": field_types[9],
            @"10": field_types[10],
            @"11": field_types[11],
            @"12": field_types[12],
            @"13": field_types[13],
            @"14": field_types[14],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        16 => union(enum) {
            @"0": field_types[0],
            @"1": field_types[1],
            @"2": field_types[2],
            @"3": field_types[3],
            @"4": field_types[4],
            @"5": field_types[5],
            @"6": field_types[6],
            @"7": field_types[7],
            @"8": field_types[8],
            @"9": field_types[9],
            @"10": field_types[10],
            @"11": field_types[11],
            @"12": field_types[12],
            @"13": field_types[13],
            @"14": field_types[14],
            @"15": field_types[15],
            pub fn deinit(self: *@This()) void {
                deinitImpl(@This(), self);
            }
        },
        else => @compileError("too many union fields"),
    };
}

const bun = @import("bun");
const std = @import("std");
