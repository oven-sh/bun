const JSC = @import("bun").JSC;

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
    pub const ServerWebSocket = JSC.API.ServerWebSocket;
    pub const TCPSocket = JSC.API.TCPSocket;
    pub const TLSSocket = JSC.API.TLSSocket;
    pub const Listener = JSC.API.Listener;
    pub const Expect = JSC.Jest.Expect;
    pub const Mock = JSC.Jest.Mock;
    pub const FileSystemRouter = JSC.API.FileSystemRouter;
    pub const MatchedRoute = JSC.API.MatchedRoute;
};
