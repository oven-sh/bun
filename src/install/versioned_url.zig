const Semver = @import("./semver.zig");
const String = @import("./semver.zig").String;

const VersionedURL = @This();

url: String,
version: Semver.Version,

pub fn eql(this: VersionedURL, other: VersionedURL) bool {
    return this.version.eql(other.version);
}

pub fn order(this: VersionedURL, other: VersionedURL, lhs_buf: []const u8, rhs_buf: []const u8) @import("std").math.Order {
    return this.version.order(other.version, lhs_buf, rhs_buf);
}

pub fn fmt(this: VersionedURL, buf: []const u8) Semver.Version.Formatter {
    return this.version.fmt(buf);
}

pub fn count(this: VersionedURL, buf: []const u8, comptime Builder: type, builder: Builder) void {
    this.version.count(buf, comptime Builder, builder);
    builder.count(this.url.slice(buf));
}

pub fn clone(this: VersionedURL, buf: []const u8, comptime Builder: type, builder: Builder) VersionedURL {
    return VersionedURL{
        .version = this.version.clone(buf, Builder, builder),
        .url = builder.append(String, this.url.slice(buf)),
    };
}
