const std = @import("std");

pub fn Bitflags(comptime T: type) type {
    const tyinfo = @typeInfo(T);
    const IntType = tyinfo.Struct.backing_integer.?;
    const IntTypeInfo = @typeInfo(IntType);
    const IntRepresentingNumOfBits = std.math.IntFittingRange(0, IntTypeInfo.Int.bits);

    return struct {
        pub const IMPL_BITFLAGS: u0 = 0;

        pub inline fn empty() T {
            return @bitCast(@as(IntType, 0));
        }

        pub inline fn intersects(lhs: T, rhs: T) bool {
            return asBits(lhs) & asBits(rhs) != 0;
        }

        pub inline fn fromName(comptime name: []const u8) T {
            var this: T = .{};
            @field(this, name) = true;
            return this;
        }

        pub inline fn fromNames(comptime names: []const []const u8) T {
            var this: T = .{};
            inline for (names) |name| {
                @field(this, name) = true;
            }
            return this;
        }

        pub fn bitwiseOr(lhs: T, rhs: T) T {
            return @bitCast(@as(IntType, @bitCast(lhs)) | @as(IntType, @bitCast(rhs)));
        }

        pub fn bitwiseAnd(lhs: T, rhs: T) T {
            return @bitCast(@as(IntType, asBits(lhs) & asBits(rhs)));
        }

        pub inline fn intersect(lhs: T, rhs: T) T {
            return bitwiseAnd(lhs, rhs);
        }

        pub inline fn insert(this: *T, other: T) void {
            this.* = bitwiseOr(this.*, other);
        }

        pub inline fn remove(this: *T, other: T) void {
            this.* = @bitCast(asBits(this.*) & ~asBits(other));
        }

        pub inline fn maskOut(this: T, other: T) T {
            return @bitCast(asBits(this) & ~asBits(other));
        }

        pub fn contains(lhs: T, rhs: T) bool {
            return @as(IntType, @bitCast(lhs)) & @as(IntType, @bitCast(rhs)) != 0;
        }

        pub inline fn leadingZeroes(this: T) IntRepresentingNumOfBits {
            return @clz(asBits(this));
        }

        pub inline fn all() T {
            var ret: T = @bitCast(@as(IntType, 0));
            @setEvalBranchQuota(5000);
            inline for (std.meta.fields(T)) |field| {
                if (comptime !std.mem.eql(u8, field.name, "__unused")) {
                    @field(ret, field.name) = true;
                }
            }
            return ret;
        }

        pub inline fn not(this: T) T {
            return fromBitsTruncate(~asBits(this));
        }

        pub inline fn difference(lhs: T, rhs: T) T {
            // 1100     1100        1100
            // 1010     0101        0100
            return @bitCast(asBits(lhs) & asBits(not(rhs)));
        }

        /// Convert from a bits value, unsetting any unknown bits.
        pub inline fn fromBitsTruncate(bits: IntType) T {
            return bitwiseAnd(@bitCast(bits), all());
        }

        pub inline fn asBits(this: T) IntType {
            return @as(IntType, @bitCast(this));
        }

        pub fn isEmpty(this: T) bool {
            return asBits(this) == 0;
        }

        pub fn eq(lhs: T, rhs: T) bool {
            return asBits(lhs) == asBits(rhs);
        }

        pub fn eql(lhs: T, rhs: T) bool {
            return eq(lhs, rhs);
        }

        pub fn neq(lhs: T, rhs: T) bool {
            return asBits(lhs) != asBits(rhs);
        }

        pub fn hash(this: *const T, hasher: *std.hash.Wyhash) void {
            hasher.update(std.mem.asBytes(this));
        }
    };
}
