// MySQL authentication methods
pub const AuthMethod = enum {
    mysql_native_password,
    caching_sha2_password,
    sha256_password,

    pub fn scramble(this: AuthMethod, password: []const u8, auth_data: []const u8, buf: *[32]u8) ![]u8 {
        if (password.len == 0) {
            return &.{};
        }

        const len = scrambleLength(this);

        switch (this) {
            .mysql_native_password => @memcpy(buf[0..len], &try Auth.mysql_native_password.scramble(password, auth_data)),
            .caching_sha2_password => @memcpy(buf[0..len], &try Auth.caching_sha2_password.scramble(password, auth_data)),
            .sha256_password => @memcpy(buf[0..len], &try Auth.caching_sha2_password.scramble(password, auth_data)),
        }

        return buf[0..len];
    }

    pub fn scrambleLength(this: AuthMethod) usize {
        return switch (this) {
            .mysql_native_password => 20,
            .caching_sha2_password => 32,
            .sha256_password => 32,
        };
    }

    const Map = bun.ComptimeEnumMap(AuthMethod);

    pub const fromString = Map.get;
};

const Auth = @import("./protocol/Auth.zig");
const bun = @import("bun");
