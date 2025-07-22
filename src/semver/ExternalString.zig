pub const ExternalString = extern struct {
    value: String = String{},
    hash: u64 = 0,

    pub inline fn fmt(this: *const ExternalString, buf: []const u8) String.Formatter {
        return this.value.fmt(buf);
    }

    pub fn order(lhs: *const ExternalString, rhs: *const ExternalString, lhs_buf: []const u8, rhs_buf: []const u8) std.math.Order {
        if (lhs.hash == rhs.hash and lhs.hash > 0) return .eq;

        return lhs.value.order(&rhs.value, lhs_buf, rhs_buf);
    }

    /// ExternalString but without the hash
    pub inline fn from(in: string) ExternalString {
        return ExternalString{
            .value = String.init(in, in),
            .hash = bun.Wyhash.hash(0, in),
        };
    }

    pub inline fn isInline(this: ExternalString) bool {
        return this.value.isInline();
    }

    pub inline fn isEmpty(this: ExternalString) bool {
        return this.value.isEmpty();
    }

    pub inline fn len(this: ExternalString) usize {
        return this.value.len();
    }

    pub inline fn init(buf: string, in: string, hash: u64) ExternalString {
        return ExternalString{
            .value = String.init(buf, in),
            .hash = hash,
        };
    }

    pub inline fn slice(this: *const ExternalString, buf: string) string {
        return this.value.slice(buf);
    }
};

const string = []const u8;

const bun = @import("bun");
const std = @import("std");
const String = bun.Semver.String;
