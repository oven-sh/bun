pub fn createCryptoError(globalThis: *jsc.JSGlobalObject, err_code: u32) JSValue {
    return bun.BoringSSL.ERR_toJS(globalThis, err_code);
}

pub const PasswordObject = @import("./PasswordObject.rust").PasswordObject;
pub const JSPasswordObject = @import("./PasswordObject.rust").JSPasswordObject;

pub const CryptoHasher = @import("./CryptoHasher.rust").CryptoHasher;
pub const MD4 = @import("./CryptoHasher.rust").MD4;
pub const MD5 = @import("./CryptoHasher.rust").MD5;
pub const SHA1 = @import("./CryptoHasher.rust").SHA1;
pub const SHA224 = @import("./CryptoHasher.rust").SHA224;
pub const SHA256 = @import("./CryptoHasher.rust").SHA256;
pub const SHA384 = @import("./CryptoHasher.rust").SHA384;
pub const SHA512 = @import("./CryptoHasher.rust").SHA512;
pub const SHA512_256 = @import("./CryptoHasher.rust").SHA512_256;
pub const HMAC = @import("./HMAC.rust");
pub const EVP = @import("./EVP.rust");

comptime {
    CryptoHasher.Extern.@"export"();
}

const bun = @import("bun");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
