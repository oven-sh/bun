const boring = @import("./boringssl.translated.zig");
pub usingnamespace boring;
const std = @import("std");

var loaded = false;
pub fn load() void {
    if (loaded) return;
    loaded = true;
    boring.CRYPTO_library_init();
    std.debug.assert(boring.SSL_library_init() > 0);
    boring.SSL_load_error_strings();
    boring.ERR_load_BIO_strings();
    boring.OpenSSL_add_all_algorithms();
}

var ctx_: ?*boring.SSL_CTX = null;
pub fn initClient() *boring.SSL {
    if (ctx_ != null) _ = boring.SSL_CTX_up_ref(ctx_.?);

    var ctx = ctx_ orelse brk: {
        ctx_ = boring.SSL_CTX.init().?;
        break :brk ctx_.?;
    };

    var ssl = boring.SSL.init(ctx);
    ssl.setIsClient(true);

    return ssl;
}

test "load" {
    load();
}
