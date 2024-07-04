const bun = @import("root").bun;
const std = @import("std");

const Impl = struct {
    pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        var is_first = true;
        inline for (std.meta.fieldNames(@This())) |fieldName| {
            const value = @field(self, fieldName);
            if (value) {
                if (!is_first)
                    try writer.write(" ");
                is_first = false;
                try writer.writeAll(fieldName);
            }
        }
    }

    pub fn isEmpty(self: @This()) bool {
        return @as(u8, @bitCast(self)) == 0;
    }

    pub fn get() @This() {
        return @bitCast(bun_cpu_features());
    }
};

const X86CPUFeatures = packed struct(u8) {
    sse42: bool = false,
    popcnt: bool = false,
    avx: bool = false,
    avx2: bool = false,
    avx512: bool = false,

    padding: u3 = 0,

    pub usingnamespace Impl;
};
const AArch64CPUFeatures = packed struct(u8) {
    neon: bool = false,
    fp: bool = false,
    aes: bool = false,
    crc32: bool = false,
    atomics: bool = false,
    sve: bool = false,

    padding: u2 = 0,

    pub usingnamespace Impl;
};

pub const CPUFeatures = if (bun.Environment.isX64)
    X86CPUFeatures
else if (bun.Environment.isAarch64)
    AArch64CPUFeatures
else
    struct {
        pub fn get() @This() {
            return .{};
        }

        pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
            _ = self; // autofix
            _ = writer; // autofix
        }

        pub fn isEmpty(self: @This()) bool {
            _ = self; // autofix
            return true;
        }
    };

extern "C" fn bun_cpu_features() u8;
