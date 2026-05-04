const HMAC = @This();

ctx: BoringSSL.HMAC_CTX,
algorithm: EVP.Algorithm,

pub const new = bun.TrivialNew(@This());

pub fn init(algorithm: EVP.Algorithm, key: []const u8) ?*HMAC {
    const md = algorithm.md() orelse return null;
    var ctx: BoringSSL.HMAC_CTX = undefined;
    BoringSSL.HMAC_CTX_init(&ctx);
    if (BoringSSL.HMAC_Init_ex(&ctx, key.ptr, @intCast(key.len), md, null) != 1) {
        BoringSSL.HMAC_CTX_cleanup(&ctx);
        return null;
    }
    return HMAC.new(.{
        .ctx = ctx,
        .algorithm = algorithm,
    });
}

pub fn update(this: *HMAC, data: []const u8) void {
    _ = BoringSSL.HMAC_Update(&this.ctx, data.ptr, data.len);
}

pub fn size(this: *const HMAC) usize {
    return BoringSSL.HMAC_size(&this.ctx);
}

pub fn copy(this: *HMAC) !*HMAC {
    var ctx: BoringSSL.HMAC_CTX = undefined;
    BoringSSL.HMAC_CTX_init(&ctx);
    if (BoringSSL.HMAC_CTX_copy(&ctx, &this.ctx) != 1) {
        BoringSSL.HMAC_CTX_cleanup(&ctx);
        return error.BoringSSLError;
    }
    return HMAC.new(.{
        .ctx = ctx,
        .algorithm = this.algorithm,
    });
}

pub fn final(this: *HMAC, out: []u8) []u8 {
    var outlen: c_uint = undefined;
    _ = BoringSSL.HMAC_Final(&this.ctx, out.ptr, &outlen);
    return out[0..outlen];
}

pub fn deinit(this: *HMAC) void {
    BoringSSL.HMAC_CTX_cleanup(&this.ctx);
    bun.destroy(this);
}

const bun = @import("bun");
const jsc = bun.jsc;
const BoringSSL = bun.BoringSSL.c;
const EVP = jsc.API.Bun.Crypto.EVP;
