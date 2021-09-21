const std = @import("std");

const RangeTable = @This();

pub const R16Range = [2]u16;
pub const R32Range = [2]u32;

latin_offset: u8 = 0,

r16_max: u16 = 0xFFFF,
r16_min: u16 = 256,
r16: []const R16Range = &[_]R16Range{},
r32: []const R32Range = &[_]R32Range{},
r32_max: u32 = std.math.maxInt(u32),
r32_min: u32 = std.math.maxInt(u16) + 1,

pub fn init(
    comptime latin_offset: u8,
    comptime r16: []const R16Range,
    comptime r32: []const R32Range,
) RangeTable {
    return comptime brk: {
        @setEvalBranchQuota(9999);
        var min_16: u16 = std.math.maxInt(u16);
        var max_16: u16 = 0;

        var min_32: u32 = std.math.maxInt(u32);
        var max_32: u32 = 0;

        for (r16) |group, i| {
            min_16 = std.math.max(std.math.min(min_16, group[0]), latin_offset);
            max_16 = std.math.max(max_16, group[1]);
        }

        for (r32) |group, i| {
            min_32 = std.math.min(min_32, group[0]);
            max_32 = std.math.max(max_32, group[1]);
        }

        break :brk RangeTable{
            .latin_offset = latin_offset,
            .r16_min = min_16,

            .r16_max = max_16,
            .r16 = r16,
            .r32 = r32,
            .r32_min = min_32,
            .r32_max = max_32,
        };
    };
}

pub fn inRange16(this: *const RangeTable, value: u16) bool {
    const slice = this.r16[this.latin_offset..];
    var lo: u16 = 0;
    var hi: u16 = @intCast(u16, slice.len);
    while (lo < hi) {
        const mid = (lo + hi) / 2;
        const range = slice[mid];
        if (value <= range[0] and value <= range[1]) {
            return true;
        }
        hi = if (value < range[0]) mid else hi;
        lo = if (!(value < range[0])) mid else lo;
    }

    return false;
}

pub fn inRange32(this: *const RangeTable, value: u32) bool {
    const slice = this.r32;
    var lo: u16 = 0;
    var hi: u16 = @intCast(u16, slice.len);
    while (lo < hi) {
        const mid = (lo + hi) / 2;
        const range = slice[mid];
        if (value <= range[0] and value <= range[1]) {
            return true;
        }
        hi = if (value < range[0]) mid else hi;
        lo = if (!(value < range[0])) mid else lo;
    }

    return false;
}

pub fn includes(this: *const RangeTable, comptime width: u3, comptime ValueType: type, value: ValueType) bool {
    switch (comptime width) {
        0 => @compileError("dont use this"),
        1 => @compileError("dont use this"),
        2 => {
            if (value < this.r16_min or value > this.r16_max) return false;
            return this.inRange16(@intCast(u16, value));
        },
        else => {
            if (value < this.r32_min or value > this.r32_max) return false;

            return this.inRange32(@intCast(u32, value));
        },
    }
}

test "in16" {
    const u16range: []const R16Range = &[_]R16Range{
        R16Range{ 0x2c6, 0x2d1 },
        R16Range{ 0x2e0, 0x2e4 },
        R16Range{ 0x2ec, 0x2ec },
        R16Range{ 0x2ee, 0x2ee },
        R16Range{ 0x370, 0x374 },
        R16Range{ 0x376, 0x377 },
        R16Range{ 0x37a, 0x37d },
        R16Range{ 0x37f, 0x37f },
        R16Range{ 0x386, 0x386 },
        R16Range{ 0x388, 0x38a },
        R16Range{ 0x38c, 0x38c },
        R16Range{ 0x38e, 0x3a1 },
        R16Range{ 0x3a3, 0x3f5 },
        R16Range{ 0x3f7, 0x481 },
        R16Range{ 0x48a, 0x52f },
        R16Range{ 0x531, 0x556 },
        R16Range{ 0x559, 0x559 },
    };
    const table = init(
        0,
        u16range,
        &.{},
    );

    const bytes: []const u8 = &[_]u8{ 205, 189 };
    var decoded = try std.unicode.utf8Decode(bytes);
    try std.testing.expect(table.includes(2, @TypeOf(decoded), decoded));

    const bytes2: []const u8 = &[_]u8{ 213, 153 };
    decoded = try std.unicode.utf8Decode(bytes2);
    try std.testing.expect(!table.includes(3, @TypeOf(decoded), decoded));
}
