const JSC = @import("javascript_core");

pub const Classes = struct {
    pub const Request = JSC.WebCore.Request;
    pub const Response = JSC.WebCore.Response;
    pub const SHA1 = JSC.API.Bun.Crypto.SHA1;
    pub const MD5 = JSC.API.Bun.Crypto.MD5;
    pub const MD4 = JSC.API.Bun.Crypto.MD4;
    pub const SHA224 = JSC.API.Bun.Crypto.SHA224;
    pub const SHA512 = JSC.API.Bun.Crypto.SHA512;
    pub const SHA384 = JSC.API.Bun.Crypto.SHA384;
    pub const SHA256 = JSC.API.Bun.Crypto.SHA256;
    pub const SHA512_256 = JSC.API.Bun.Crypto.SHA512_256;
    pub const TextDecoder = JSC.WebCore.TextDecoder;
    pub const Blob = JSC.WebCore.Blob;
    pub const Subprocess = JSC.Subprocess;
};
