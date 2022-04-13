const BoringSSL = @import("boringssl");
const std = @import("std");

fn NewHasher(comptime digest_size: comptime_int, comptime ContextType: type, comptime Full: anytype, comptime Init: anytype, comptime Update: anytype, comptime Final: anytype) type {
    return struct {
        hasher: ContextType = undefined,

        pub const Digest = [digest_size]u8;
        pub const digest: comptime_int = digest_size;

        pub fn init() @This() {
            var this: @This() = .{
                .hasher = undefined,
            };

            std.debug.assert(Init(&this.hasher) == 1);
            return this;
        }

        pub fn hash(bytes: []const u8, out: *Digest) void {
            _ = Full(bytes.ptr, bytes.len, out);
        }

        pub fn update(this: *@This(), data: []const u8) void {
            std.debug.assert(Update(&this.hasher, data.ptr, data.len) == 1);
        }

        pub fn final(this: *@This(), out: *Digest) void {
            std.debug.assert(Final(out, &this.hasher) == 1);
        }
    };
}

pub const SHA1 = NewHasher(
    std.crypto.hash.Sha1.digest_length,
    BoringSSL.SHA_CTX,
    BoringSSL.SHA1,
    BoringSSL.SHA1_Init,
    BoringSSL.SHA1_Update,
    BoringSSL.SHA1_Final,
);

pub const SHA512 = NewHasher(
    std.crypto.hash.sha2.Sha512.digest_length,
    BoringSSL.SHA512_CTX,
    BoringSSL.SHA512,
    BoringSSL.SHA512_Init,
    BoringSSL.SHA512_Update,
    BoringSSL.SHA512_Final,
);

pub const SHA384 = NewHasher(
    std.crypto.hash.sha2.Sha384.digest_length,
    BoringSSL.SHA512_CTX,
    BoringSSL.SHA384,
    BoringSSL.SHA384_Init,
    BoringSSL.SHA384_Update,
    BoringSSL.SHA384_Final,
);

pub const SHA256 = NewHasher(
    std.crypto.hash.sha2.Sha256.digest_length,
    BoringSSL.SHA256_CTX,
    BoringSSL.SHA256,
    BoringSSL.SHA256_Init,
    BoringSSL.SHA256_Update,
    BoringSSL.SHA256_Final,
);

pub const SHA512_256 = NewHasher(
    std.crypto.hash.sha2.Sha512256.digest_length,
    BoringSSL.SHA512_CTX,
    BoringSSL.SHA512_256,
    BoringSSL.SHA512_256_Init,
    BoringSSL.SHA512_256_Update,
    BoringSSL.SHA512_256_Final,
);

pub fn main() anyerror!void {
    var file = try std.fs.cwd().openFileZ(std.os.argv[std.os.argv.len - 1], .{});
    var bytes = try file.readToEndAlloc(std.heap.c_allocator, std.math.maxInt(usize));

    const boring = [_]type{
        SHA1,
        SHA512,
        SHA384,
        SHA256,
        SHA512_256,
    };

    const zig = [_]type{
        std.crypto.hash.Sha1,
        std.crypto.hash.sha2.Sha512,
        std.crypto.hash.sha2.Sha384,
        std.crypto.hash.sha2.Sha256,
        std.crypto.hash.sha2.Sha512256,
    };

    const labels = [_][]const u8{
        "SHA1",
        "SHA512",
        "SHA384",
        "SHA256",
        "SHA512_256",
    };

    inline for (boring) |BoringHasher, i| {
        const ZigHasher = zig[i];
        std.debug.print(
            comptime labels[i] ++ " - hashing {.3f}:\n",
            .{std.fmt.fmtIntSizeBin(bytes.len)},
        );
        var digest1: BoringHasher.Digest = undefined;
        var digest2: BoringHasher.Digest = undefined;
        var clock1 = try std.time.Timer.start();
        ZigHasher.hash(bytes, &digest1, .{});
        const zig_time = clock1.read();

        var clock2 = try std.time.Timer.start();
        BoringHasher.hash(bytes, &digest2);
        const boring_time = clock2.read();

        std.debug.print(
            "     zig: {}\n",
            .{std.fmt.fmtDuration(zig_time)},
        );
        std.debug.print(
            "  boring: {}\n\n",
            .{std.fmt.fmtDuration(boring_time)},
        );

        if (!std.mem.eql(u8, &digest1, &digest2)) {
            @panic("\ndigests don't match! for " ++ labels[i]);
        }
    }
}

test "sha256" {
    const value: []const u8 = "hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world!";
    var hash: SHA256.Digest = undefined;
    var hash2: SHA256.Digest = undefined;
    SHA256.hash(value, &hash);
    std.crypto.hash.sha2.Sha256.hash(value, &hash2, .{});
    try std.testing.expectEqual(hash, hash2);
}
