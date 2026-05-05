pub fn createCryptoError(globalThis: *jsc.JSGlobalObject, err_code: u32) JSValue {
    return bun.BoringSSL.ERR_toJS(globalThis, err_code);
}

pub const PasswordObject = @import("./PasswordObject.zig").PasswordObject;
pub const JSPasswordObject = @import("./PasswordObject.zig").JSPasswordObject;

pub const CryptoHasher = @import("./CryptoHasher.zig").CryptoHasher;
pub const MD4 = @import("./CryptoHasher.zig").MD4;
pub const MD5 = @import("./CryptoHasher.zig").MD5;
pub const SHA1 = @import("./CryptoHasher.zig").SHA1;
pub const SHA224 = @import("./CryptoHasher.zig").SHA224;
pub const SHA256 = @import("./CryptoHasher.zig").SHA256;
pub const SHA384 = @import("./CryptoHasher.zig").SHA384;
pub const SHA512 = @import("./CryptoHasher.zig").SHA512;
pub const SHA512_256 = @import("./CryptoHasher.zig").SHA512_256;
pub const HMAC = @import("./HMAC.zig");
pub const EVP = @import("./EVP.zig");

comptime {
    CryptoHasher.Extern.@"export"();
}

const bun = @import("bun");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
