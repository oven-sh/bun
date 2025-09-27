const EVP = @This();

ctx: BoringSSL.EVP_MD_CTX = undefined,
md: *const BoringSSL.EVP_MD = undefined,
algorithm: Algorithm,

// we do this to avoid asking BoringSSL what the digest name is
// because that API is confusing
pub const Algorithm = enum {
    // @"DSA-SHA",
    // @"DSA-SHA1",
    // @"MD5-SHA1",
    // @"RSA-MD5",
    // @"RSA-RIPEMD160",
    // @"RSA-SHA1",
    // @"RSA-SHA1-2",
    // @"RSA-SHA224",
    // @"RSA-SHA256",
    // @"RSA-SHA384",
    // @"RSA-SHA512",
    // @"ecdsa-with-SHA1",
    blake2b256,
    blake2b512,
    blake2s256,
    md4,
    md5,
    ripemd160,
    sha1,
    sha224,
    sha256,
    sha384,
    sha512,
    @"sha512-224",
    @"sha512-256",

    @"sha3-224",
    @"sha3-256",
    @"sha3-384",
    @"sha3-512",
    shake128,
    shake256,

    pub fn md(this: Algorithm) ?*const BoringSSL.EVP_MD {
        return switch (this) {
            .blake2b256 => BoringSSL.EVP_blake2b256(),
            .blake2b512 => BoringSSL.EVP_blake2b512(),
            .md4 => BoringSSL.EVP_md4(),
            .md5 => BoringSSL.EVP_md5(),
            .ripemd160 => BoringSSL.EVP_ripemd160(),
            .sha1 => BoringSSL.EVP_sha1(),
            .sha224 => BoringSSL.EVP_sha224(),
            .sha256 => BoringSSL.EVP_sha256(),
            .sha384 => BoringSSL.EVP_sha384(),
            .sha512 => BoringSSL.EVP_sha512(),
            .@"sha512-224" => BoringSSL.EVP_sha512_224(),
            .@"sha512-256" => BoringSSL.EVP_sha512_256(),
            else => null,
        };
    }

    pub const names: std.EnumArray(Algorithm, bun.String) = brk: {
        var all = std.EnumArray(Algorithm, bun.String).initUndefined();
        var iter = all.iterator();
        while (iter.next()) |entry| {
            entry.value.* = bun.String.init(@tagName(entry.key));
        }
        break :brk all;
    };

    pub const map = bun.ComptimeStringMap(Algorithm, .{
        .{ "blake2b256", .blake2b256 },
        .{ "blake2b512", .blake2b512 },
        .{ "blake2s256", .blake2s256 },
        .{ "ripemd160", .ripemd160 },
        .{ "rmd160", .ripemd160 },
        .{ "md4", .md4 },
        .{ "md5", .md5 },
        .{ "sha1", .sha1 },
        .{ "sha128", .sha1 },
        .{ "sha224", .sha224 },
        .{ "sha256", .sha256 },
        .{ "sha384", .sha384 },
        .{ "sha512", .sha512 },
        .{ "sha-1", .sha1 },
        .{ "sha-224", .sha224 },
        .{ "sha-256", .sha256 },
        .{ "sha-384", .sha384 },
        .{ "sha-512", .sha512 },
        .{ "sha-512/224", .@"sha512-224" },
        .{ "sha-512_224", .@"sha512-224" },
        .{ "sha-512224", .@"sha512-224" },
        .{ "sha512-224", .@"sha512-224" },
        .{ "sha-512/256", .@"sha512-256" },
        .{ "sha-512_256", .@"sha512-256" },
        .{ "sha-512256", .@"sha512-256" },
        .{ "sha512-256", .@"sha512-256" },
        .{ "sha384", .sha384 },
        .{ "sha3-224", .@"sha3-224" },
        .{ "sha3-256", .@"sha3-256" },
        .{ "sha3-384", .@"sha3-384" },
        .{ "sha3-512", .@"sha3-512" },
        .{ "shake128", .shake128 },
        .{ "shake256", .shake256 },
        // .{ "md5-sha1", .@"MD5-SHA1" },
        // .{ "dsa-sha", .@"DSA-SHA" },
        // .{ "dsa-sha1", .@"DSA-SHA1" },
        // .{ "ecdsa-with-sha1", .@"ecdsa-with-SHA1" },
        // .{ "rsa-md5", .@"RSA-MD5" },
        // .{ "rsa-sha1", .@"RSA-SHA1" },
        // .{ "rsa-sha1-2", .@"RSA-SHA1-2" },
        // .{ "rsa-sha224", .@"RSA-SHA224" },
        // .{ "rsa-sha256", .@"RSA-SHA256" },
        // .{ "rsa-sha384", .@"RSA-SHA384" },
        // .{ "rsa-sha512", .@"RSA-SHA512" },
        // .{ "rsa-ripemd160", .@"RSA-RIPEMD160" },
    });
};

pub fn init(algorithm: Algorithm, md: *const BoringSSL.EVP_MD, engine: *BoringSSL.ENGINE) EVP {
    bun.BoringSSL.load();

    var ctx: BoringSSL.EVP_MD_CTX = undefined;
    BoringSSL.EVP_MD_CTX_init(&ctx);
    _ = BoringSSL.EVP_DigestInit_ex(&ctx, md, engine);
    return .{
        .ctx = ctx,
        .md = md,
        .algorithm = algorithm,
    };
}

pub fn reset(this: *EVP, engine: *BoringSSL.ENGINE) void {
    BoringSSL.ERR_clear_error();
    _ = BoringSSL.EVP_DigestInit_ex(&this.ctx, this.md, engine);
}

pub fn hash(this: *EVP, engine: *BoringSSL.ENGINE, input: []const u8, output: []u8) ?u32 {
    BoringSSL.ERR_clear_error();
    var outsize: c_uint = @min(@as(u16, @truncate(output.len)), this.size());
    if (BoringSSL.EVP_Digest(input.ptr, input.len, output.ptr, &outsize, this.md, engine) != 1) {
        return null;
    }

    return outsize;
}

pub fn final(this: *EVP, engine: *BoringSSL.ENGINE, output: []u8) []u8 {
    BoringSSL.ERR_clear_error();
    var outsize: u32 = @min(@as(u16, @truncate(output.len)), this.size());
    if (BoringSSL.EVP_DigestFinal_ex(
        &this.ctx,
        output.ptr,
        &outsize,
    ) != 1) {
        return "";
    }

    this.reset(engine);

    return output[0..outsize];
}

pub fn update(this: *EVP, input: []const u8) void {
    BoringSSL.ERR_clear_error();
    _ = BoringSSL.EVP_DigestUpdate(&this.ctx, input.ptr, input.len);
}

pub fn size(this: *const EVP) u16 {
    return @as(u16, @truncate(BoringSSL.EVP_MD_CTX_size(&this.ctx)));
}

pub fn copy(this: *const EVP, engine: *BoringSSL.ENGINE) error{OutOfMemory}!EVP {
    BoringSSL.ERR_clear_error();
    var new = init(this.algorithm, this.md, engine);
    if (BoringSSL.EVP_MD_CTX_copy_ex(&new.ctx, &this.ctx) == 0) {
        return error.OutOfMemory;
    }
    return new;
}

pub fn byNameAndEngine(engine: *BoringSSL.ENGINE, name: []const u8) ?EVP {
    if (Algorithm.map.getWithEql(name, strings.eqlCaseInsensitiveASCIIIgnoreLength)) |algorithm| {
        if (algorithm.md()) |md| {
            return EVP.init(algorithm, md, engine);
        }

        if (BoringSSL.EVP_get_digestbyname(@tagName(algorithm))) |md| {
            return EVP.init(algorithm, md, engine);
        }
    }

    return null;
}

pub fn byName(name: ZigString, global: *jsc.JSGlobalObject) ?EVP {
    var name_str = name.toSlice(global.allocator());
    defer name_str.deinit();
    return byNameAndEngine(global.bunVM().rareData().boringEngine(), name_str.slice());
}

pub fn deinit(this: *EVP) void {
    // https://github.com/oven-sh/bun/issues/3250
    _ = BoringSSL.EVP_MD_CTX_cleanup(&this.ctx);
}

pub const Digest = [BoringSSL.EVP_MAX_MD_SIZE]u8;
pub const PBKDF2 = @import("./PBKDF2.zig");
pub const pbkdf2 = PBKDF2.pbkdf2;

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const BoringSSL = bun.BoringSSL.c;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const ZigString = jsc.ZigString;
