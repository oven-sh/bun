pub fn createCryptoError(globalThis: *JSC.JSGlobalObject, err_code: u32) JSValue {
    return bun.BoringSSL.ERR_toJS(globalThis, err_code);
}

pub const PasswordObject = @import("./crypto/PasswordObject.zig").PasswordObject;
pub const JSPasswordObject = @import("./crypto/PasswordObject.zig").JSPasswordObject;

pub const CryptoHasher = @import("./crypto/CryptoHasher.zig").CryptoHasher;
pub const MD4 = @import("./crypto/CryptoHasher.zig").MD4;
pub const MD5 = @import("./crypto/CryptoHasher.zig").MD5;
pub const SHA1 = @import("./crypto/CryptoHasher.zig").SHA1;
pub const SHA224 = @import("./crypto/CryptoHasher.zig").SHA224;
pub const SHA256 = @import("./crypto/CryptoHasher.zig").SHA256;
pub const SHA384 = @import("./crypto/CryptoHasher.zig").SHA384;
pub const SHA512 = @import("./crypto/CryptoHasher.zig").SHA512;
pub const SHA512_256 = @import("./crypto/CryptoHasher.zig").SHA512_256;
pub const HMAC = @import("./crypto/HMAC.zig");
pub const EVP = @import("./crypto/EVP.zig");

comptime {
    CryptoHasher.Extern.@"export"();
}

const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
