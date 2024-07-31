const bun = @import("root").bun;
const std = @import("std");

fn Impl(comptime T: type) type {
    return struct {
        pub fn format(this: T, comptime _: []const u8, _: anytype, writer: anytype) !void {
            var is_first = true;
            inline for (comptime std.meta.fieldNames(T)) |fieldName| {
                if (comptime bun.strings.eqlComptime(fieldName, "padding") or bun.strings.eqlComptime(fieldName, "none"))
                    continue;

                const value = @field(this, fieldName);
                if (value) {
                    if (!is_first)
                        try writer.writeAll(" ");
                    is_first = false;
                    try writer.writeAll(fieldName);
                }
            }
        }

        pub fn isEmpty(this: T) bool {
            return @as(u8, @bitCast(this)) == 0;
        }

        pub fn get() T {
            const this: T = @bitCast(bun_cpu_features());

            // sanity check
            assert(this.none == false and this.padding == 0);

            if (bun.Environment.isX64) {
                bun.analytics.Features.no_avx += @as(usize, @intFromBool(!this.avx));
                bun.analytics.Features.no_avx2 += @as(usize, @intFromBool(!this.avx2));
            }

            return this;
        }
    };
}

const X86CPUFeatures = packed struct(u8) {
    none: bool = false,

    sse42: bool = false,
    popcnt: bool = false,
    avx: bool = false,
    avx2: bool = false,
    avx512: bool = false,

    padding: u2 = 0,

    pub usingnamespace Impl(@This());
};
const AArch64CPUFeatures = packed struct(u8) {
    none: bool = false,

    neon: bool = false,
    fp: bool = false,
    aes: bool = false,
    crc32: bool = false,
    atomics: bool = false,
    sve: bool = false,

    padding: u1 = 0,

    pub usingnamespace Impl(@This());
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

        pub fn format(_: @This(), comptime _: []const u8, _: anytype, _: anytype) !void {}

        pub fn isEmpty(_: @This()) bool {
            return true;
        }
    };

extern "C" fn bun_cpu_features() u8;

const assert = bun.debugAssert;
