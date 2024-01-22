const BoringSSL = @import("root").bun.BoringSSL;
const std = @import("std");

pub const bun = if (@import("build_options").project.len == 0) @import("./bun.zig") else @import("root").bun;

fn NewHasher(comptime digest_size: comptime_int, comptime ContextType: type, comptime Full: anytype, comptime Init: anytype, comptime Update: anytype, comptime Final: anytype) type {
    return struct {
        hasher: ContextType = undefined,

        pub const Digest = [digest_size]u8;
        pub const digest: comptime_int = digest_size;

        pub fn init() @This() {
            BoringSSL.load();
            var this: @This() = .{
                .hasher = undefined,
            };

            std.debug.assert(Init(&this.hasher) == 1);
            return this;
        }

        pub fn hash(bytes: []const u8, out: *Digest) void {
            @setRuntimeSafety(false);
            _ = Full(bytes.ptr, bytes.len, out);
        }

        pub fn update(this: *@This(), data: []const u8) void {
            @setRuntimeSafety(false);
            std.debug.assert(Update(&this.hasher, data.ptr, data.len) == 1);
        }

        pub fn final(this: *@This(), out: *Digest) void {
            @setRuntimeSafety(false);
            std.debug.assert(Final(out, &this.hasher) == 1);
        }
    };
}

fn NewEVP(
    comptime digest_size: comptime_int,
    comptime MDName: []const u8,
) type {
    return struct {
        ctx: BoringSSL.EVP_MD_CTX = undefined,

        pub const Digest = [digest_size]u8;
        pub const digest: comptime_int = digest_size;

        pub fn init() @This() {
            BoringSSL.load();

            const md = @call(.auto, @field(BoringSSL, MDName), .{});
            var this = @This(){};

            BoringSSL.EVP_MD_CTX_init(&this.ctx);

            std.debug.assert(BoringSSL.EVP_DigestInit(&this.ctx, md) == 1);

            return this;
        }

        pub fn hash(bytes: []const u8, out: *Digest, engine: *BoringSSL.ENGINE) void {
            const md = @call(.auto, @field(BoringSSL, MDName), .{});

            std.debug.assert(BoringSSL.EVP_Digest(bytes.ptr, bytes.len, out, null, md, engine) == 1);
        }

        pub fn update(this: *@This(), data: []const u8) void {
            std.debug.assert(BoringSSL.EVP_DigestUpdate(&this.ctx, data.ptr, data.len) == 1);
        }

        pub fn final(this: *@This(), out: *Digest) void {
            std.debug.assert(BoringSSL.EVP_DigestFinal(&this.ctx, out, null) == 1);
        }

        pub fn deinit(this: *@This()) void {
            _ = BoringSSL.EVP_MD_CTX_cleanup(&this.ctx);
        }
    };
}
pub const EVP = struct {
    pub const SHA1 = NewEVP(std.crypto.hash.Sha1.digest_length, "EVP_sha1");
    pub const MD5 = NewEVP(16, "EVP_md5");
    pub const MD4 = NewEVP(16, "EVP_md4");
    pub const SHA224 = NewEVP(28, "EVP_sha224");
    pub const SHA512 = NewEVP(std.crypto.hash.sha2.Sha512.digest_length, "EVP_sha512");
    pub const SHA384 = NewEVP(std.crypto.hash.sha2.Sha384.digest_length, "EVP_sha384");
    pub const SHA256 = NewEVP(std.crypto.hash.sha2.Sha256.digest_length, "EVP_sha256");
    pub const SHA512_256 = NewEVP(std.crypto.hash.sha2.Sha512256.digest_length, "EVP_sha512_256");
    pub const MD5_SHA1 = NewEVP(std.crypto.hash.Sha1.digest_length, "EVP_md5_sha1");
    pub const Blake2 = NewEVP(256 / 8, "EVP_blake2b256");
};

pub const SHA1 = EVP.SHA1;
pub const MD5 = EVP.MD5;
pub const MD4 = EVP.MD4;
pub const SHA224 = EVP.SHA224;
pub const SHA512 = EVP.SHA512;
pub const SHA384 = EVP.SHA384;
pub const SHA256 = EVP.SHA256;
pub const SHA512_256 = EVP.SHA512_256;
pub const MD5_SHA1 = EVP.MD5_SHA1;

/// API that OpenSSL 3 deprecated
pub const Hashers = struct {
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

    pub const RIPEMD160 = NewHasher(
        BoringSSL.RIPEMD160_DIGEST_LENGTH,
        BoringSSL.RIPEMD160_CTX,
        BoringSSL.RIPEMD160,
        BoringSSL.RIPEMD160_Init,
        BoringSSL.RIPEMD160_Update,
        BoringSSL.RIPEMD160_Final,
    );
};

const boring = [_]type{
    Hashers.SHA1,
    Hashers.SHA512,
    Hashers.SHA384,
    Hashers.SHA256,
    Hashers.SHA512_256,
    void,
    void,
};

const zig = [_]type{
    std.crypto.hash.Sha1,
    std.crypto.hash.sha2.Sha512,
    std.crypto.hash.sha2.Sha384,
    std.crypto.hash.sha2.Sha256,
    std.crypto.hash.sha2.Sha512256,
    std.crypto.hash.blake2.Blake2b256,
    std.crypto.hash.Blake3,
};

const evp = [_]type{
    EVP.SHA1,
    EVP.SHA512,
    EVP.SHA384,
    EVP.SHA256,
    EVP.SHA512_256,
    EVP.Blake2,
    void,
};

const labels = [_][]const u8{
    "SHA1",
    "SHA512",
    "SHA384",
    "SHA256",
    "SHA512_256",
    "Blake2",
    "Blake3",
};
pub fn main() anyerror!void {
    var file = try std.fs.cwd().openFileZ(bun.argv()[bun.argv().len - 1], .{});
    const bytes = try file.readToEndAlloc(std.heap.c_allocator, std.math.maxInt(usize));

    const engine = BoringSSL.ENGINE_new().?;

    std.debug.print(
        "Hashing {any:3}\n\n",
        .{bun.fmt.size(bytes.len)},
    );

    {
        var clock1 = try std.time.Timer.start();
        std.mem.doNotOptimizeAway(bun.hash(bytes));
        const zig_time = clock1.read();
        std.debug.print(
            "Wyhash:\n\n     zig: {any}\n\n",
            .{std.fmt.fmtDuration(zig_time)},
        );
    }

    {
        var clock1 = try std.time.Timer.start();
        std.mem.doNotOptimizeAway(std.hash.XxHash64.hash(0, bytes));
        const zig_time = clock1.read();
        std.debug.print(
            "xxhash:\n\n     zig: {any}\n\n",
            .{std.fmt.fmtDuration(zig_time)},
        );
    }

    {
        var clock1 = try std.time.Timer.start();
        std.mem.doNotOptimizeAway(std.hash.Murmur2_64.hash(bytes));
        const zig_time = clock1.read();
        std.debug.print(
            "Murmur2_64:\n\n     zig: {any}\n\n",
            .{std.fmt.fmtDuration(zig_time)},
        );
    }

    inline for (evp, 0..) |BoringHasher, i| {
        const ZigHasher = zig[i];
        std.debug.print(
            comptime labels[i] ++ ":\n\n",
            .{},
        );
        const DigestType = if (BoringHasher != void) BoringHasher.Digest else [32]u8;
        var digest1 = std.mem.zeroes(DigestType);
        var digest2 = std.mem.zeroes(DigestType);
        var digest3 = std.mem.zeroes(DigestType);
        var digest4 = std.mem.zeroes(DigestType);
        defer {
            std.mem.doNotOptimizeAway(&digest1);
            std.mem.doNotOptimizeAway(&digest2);
            std.mem.doNotOptimizeAway(&digest3);
            std.mem.doNotOptimizeAway(&digest4);
        }

        var clock1 = try std.time.Timer.start();
        ZigHasher.hash(bytes, &digest1, .{});
        const zig_time = clock1.read();

        const boring_time = brk: {
            if (BoringHasher != void) {
                var clock2 = try std.time.Timer.start();
                BoringHasher.hash(bytes, &digest2, engine);
                break :brk clock2.read();
            } else {
                break :brk 0;
            }
        };

        const evp_time: usize = brk: {
            if (evp[i] != void) {
                var clock3 = try std.time.Timer.start();
                evp[i].hash(bytes, &digest3, engine);
                break :brk clock3.read();
            }

            break :brk 0;
        };

        const evp_in_time: usize = brk: {
            if (evp[i] != void) {
                var evp_in = evp[i].init();
                var clock4 = try std.time.Timer.start();
                evp_in.update(bytes);
                evp_in.final(&digest4);
                break :brk clock4.read();
            }

            break :brk 0;
        };

        std.debug.print(
            "     zig: {}\n",
            .{std.fmt.fmtDuration(zig_time)},
        );

        if (boring_time > 0)
            std.debug.print(
                "  boring: {}\n",
                .{std.fmt.fmtDuration(boring_time)},
            );
        if (evp_time > 0)
            std.debug.print(
                "     evp: {}\n",
                .{std.fmt.fmtDuration(evp_time)},
            );

        if (evp_in_time > 0)
            std.debug.print(
                "  evp in: {}\n\n",
                .{std.fmt.fmtDuration(evp_in_time)},
            );

        if (!std.mem.eql(u8, &digest3, &digest2)) {
            @panic("\ndigests don't match! for " ++ labels[i]);
        }
    }
}

// TODO(sno2): update SHA256 test to include BoringSSL engine
// test "sha256" {
//     const value: []const u8 = "hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world! hello, world!";
//     var hash: SHA256.Digest = undefined;
//     var hash2: SHA256.Digest = undefined;
//     SHA256.hash(value, &hash);
//     std.crypto.hash.sha2.Sha256.hash(value, &hash2, .{});
//     try std.testing.expectEqual(hash, hash2);
// }
