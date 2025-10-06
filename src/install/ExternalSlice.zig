pub fn ExternalSlice(comptime Type: type) type {
    return extern struct {
        pub const Slice = @This();

        pub const Child: type = Type;

        off: u32 = 0,
        len: u32 = 0,

        pub const invalid: @This() = .{ .off = std.math.maxInt(u32), .len = std.math.maxInt(u32) };

        pub inline fn isInvalid(this: Slice) bool {
            return this.off == std.math.maxInt(u32) and this.len == std.math.maxInt(u32);
        }

        pub inline fn contains(this: Slice, id: u32) bool {
            return id >= this.off and id < (this.len + this.off);
        }

        pub inline fn get(this: Slice, in: []const Type) []const Type {
            if (comptime Environment.allow_assert) {
                bun.assert(this.off + this.len <= in.len);
            }
            // it should be impossible to address this out of bounds due to the minimum here
            return in.ptr[this.off..@min(in.len, this.off + this.len)];
        }

        pub inline fn mut(this: Slice, in: []Type) []Type {
            if (comptime Environment.allow_assert) {
                bun.assert(this.off + this.len <= in.len);
            }
            return in.ptr[this.off..@min(in.len, this.off + this.len)];
        }

        pub inline fn begin(this: Slice) u32 {
            return this.off;
        }

        pub inline fn end(this: Slice) u32 {
            return this.off + this.len;
        }

        pub fn init(buf: []const Type, in: []const Type) Slice {
            // if (comptime Environment.allow_assert) {
            //     bun.assert(@intFromPtr(buf.ptr) <= @intFromPtr(in.ptr));
            //     bun.assert((@intFromPtr(in.ptr) + in.len) <= (@intFromPtr(buf.ptr) + buf.len));
            // }

            return Slice{
                .off = @as(u32, @truncate((@intFromPtr(in.ptr) - @intFromPtr(buf.ptr)) / @sizeOf(Type))),
                .len = @as(u32, @truncate(in.len)),
            };
        }
    };
}

pub const ExternalStringMap = extern struct {
    name: ExternalStringList = .{},
    value: ExternalStringList = .{},
};

pub const ExternalStringList = ExternalSlice(ExternalString);
pub const ExternalPackageNameHashList = ExternalSlice(PackageNameHash);
pub const VersionSlice = ExternalSlice(Semver.Version);

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const PackageNameHash = bun.install.PackageNameHash;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
