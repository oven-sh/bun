const CPUFeatures = @This();

flags: Flags,

extern "c" fn bun_cpu_features() u8;

pub const Flags = switch (@import("builtin").cpu.arch) {
    .x86_64 => packed struct(u8) {
        none: bool,

        sse42: bool,
        popcnt: bool,
        avx: bool,
        avx2: bool,
        avx512: bool,

        padding: u2 = 0,
    },
    .aarch64 => packed struct(u8) {
        none: bool,

        neon: bool,
        fp: bool,
        aes: bool,
        crc32: bool,
        atomics: bool,
        sve: bool,

        padding: u1 = 0,
    },
    else => unreachable,
};

pub fn format(features: @This(), writer: *std.Io.Writer) !void {
    var is_first = true;
    inline for (@typeInfo(Flags).@"struct".fields) |field| brk: {
        if (comptime (bun.strings.eql(field.name, "padding") or
            bun.strings.eql(field.name, "none")))
            break :brk;

        if (@field(features.flags, field.name)) {
            if (!is_first)
                try writer.writeAll(" ");
            is_first = false;
            try writer.writeAll(field.name);
        }
    }
}

pub fn isEmpty(features: CPUFeatures) bool {
    return @as(u8, @bitCast(features.flags)) == 0;
}

pub fn hasAnyAVX(features: CPUFeatures) bool {
    return features.flags.avx or features.flags.avx2 or features.flags.avx512;
}

pub fn get() CPUFeatures {
    const flags: Flags = @bitCast(bun_cpu_features());
    bun.debugAssert(flags.none == false and flags.padding == 0); // sanity check

    if (bun.Environment.isX64) {
        bun.analytics.Features.no_avx += @as(usize, @intFromBool(!flags.avx));
        bun.analytics.Features.no_avx2 += @as(usize, @intFromBool(!flags.avx2));
    }

    return .{ .flags = flags };
}

const bun = @import("bun");
const std = @import("std");
