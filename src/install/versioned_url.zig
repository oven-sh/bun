pub const VersionedURL = VersionedURLType(u64);
pub const OldV2VersionedURL = VersionedURLType(u32);

pub fn VersionedURLType(comptime SemverIntType: type) type {
    return extern struct {
        url: String,
        version: Semver.VersionType(SemverIntType),

        pub fn eql(this: @This(), other: @This()) bool {
            return this.version.eql(other.version);
        }

        pub fn order(this: @This(), other: @This(), lhs_buf: []const u8, rhs_buf: []const u8) @import("std").math.Order {
            return this.version.order(other.version, lhs_buf, rhs_buf);
        }

        pub fn count(this: @This(), buf: []const u8, comptime Builder: type, builder: Builder) void {
            this.version.count(buf, comptime Builder, builder);
            builder.count(this.url.slice(buf));
        }

        pub fn clone(this: @This(), buf: []const u8, comptime Builder: type, builder: Builder) @This() {
            return @This(){
                .version = this.version.append(buf, Builder, builder),
                .url = builder.append(String, this.url.slice(buf)),
            };
        }

        pub fn migrate(this: @This()) VersionedURLType(u64) {
            if (comptime SemverIntType != u32) {
                @compileError("unexpected SemverIntType");
            }
            return .{
                .url = this.url,
                .version = this.version.migrate(),
            };
        }
    };
}

const bun = @import("bun");

const Semver = bun.Semver;
const String = Semver.String;
