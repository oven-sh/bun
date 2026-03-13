pub fn IdentityContext(comptime Key: type) type {
    return struct {
        pub fn hash(_: @This(), key: Key) u64 {
            return switch (comptime @typeInfo(Key)) {
                .@"enum" => @intFromEnum(key),
                .int => key,
                else => @compileError("unexpected identity context type"),
            };
        }

        pub fn eql(_: @This(), a: Key, b: Key) bool {
            return a == b;
        }
    };
}

/// When storing hashes as keys in a hash table, we don't want to hash the hashes or else we increase the chance of collisions. This is also marginally faster since it means hashing less stuff.
/// `ArrayIdentityContext` and `IdentityContext` are distinct because ArrayHashMap expects u32 hashes but HashMap expects u64 hashes.
pub const ArrayIdentityContext = struct {
    pub fn hash(_: @This(), key: u32) u32 {
        return key;
    }

    pub fn eql(_: @This(), a: u32, b: u32, _: usize) bool {
        return a == b;
    }

    pub const U64 = struct {
        pub fn hash(_: @This(), key: u64) u32 {
            return @truncate(key);
        }

        pub fn eql(_: @This(), a: u64, b: u64, _: usize) bool {
            return a == b;
        }
    };
};
