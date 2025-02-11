const bun = @import("root").bun;

const std = @import("std");
const boring = bun.BoringSSL;

pub fn generate(key: []const u8, data: []const u8, algorithm: bun.JSC.API.Bun.Crypto.EVP.Algorithm, out: *[boring.EVP_MAX_MD_SIZE]u8) ?[]const u8 {
    var outlen: c_uint = boring.EVP_MAX_MD_SIZE;
    if (boring.HMAC(
        algorithm.md() orelse bun.Output.panic("Expected BoringSSL algorithm for HMAC", .{}),
        key.ptr,
        key.len,
        data.ptr,
        data.len,
        out,
        &outlen,
    ) == null) {
        return null;
    }

    return out[0..outlen];
}
