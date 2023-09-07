const boring = @import("./deps/boringssl.translated.zig");
pub usingnamespace boring;
const std = @import("std");
const bun = @import("root").bun;

const builtin = @import("builtin");
var loaded = false;
pub fn load() void {
    if (loaded) return;
    loaded = true;
    boring.CRYPTO_library_init();
    std.debug.assert(boring.SSL_library_init() > 0);
    boring.SSL_load_error_strings();
    boring.ERR_load_BIO_strings();
    boring.OpenSSL_add_all_algorithms();

    if (!builtin.is_test) {
        std.mem.doNotOptimizeAway(&OPENSSL_memory_alloc);
        std.mem.doNotOptimizeAway(&OPENSSL_memory_get_size);
        std.mem.doNotOptimizeAway(&OPENSSL_memory_free);
    }
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

// void*, OPENSSL_memory_alloc, (size_t size)
// void, OPENSSL_memory_free, (void *ptr)
// size_t, OPENSSL_memory_get_size, (void *ptr)

// The following three functions can be defined to override default heap
// allocation and freeing. If defined, it is the responsibility of
// |OPENSSL_memory_free| to zero out the memory before returning it to the
// system. |OPENSSL_memory_free| will not be passed NULL pointers.
//
// WARNING: These functions are called on every allocation and free in
// BoringSSL across the entire process. They may be called by any code in the
// process which calls BoringSSL, including in process initializers and thread
// destructors. When called, BoringSSL may hold pthreads locks. Any other code
// in the process which, directly or indirectly, calls BoringSSL may be on the
// call stack and may itself be using arbitrary synchronization primitives.
//
// As a result, these functions may not have the usual programming environment
// available to most C or C++ code. In particular, they may not call into
// BoringSSL, or any library which depends on BoringSSL. Any synchronization
// primitives used must tolerate every other synchronization primitive linked
// into the process, including pthreads locks. Failing to meet these constraints
// may result in deadlocks, crashes, or memory corruption.

export fn OPENSSL_memory_alloc(size: usize) ?*anyopaque {
    return bun.Mimalloc.mi_malloc(size);
}

// BoringSSL always expects memory to be zero'd
export fn OPENSSL_memory_free(ptr: *anyopaque) void {
    const len = bun.Mimalloc.mi_usable_size(ptr);
    @memset(@as([*]u8, @ptrCast(ptr))[0..len], 0);
    bun.Mimalloc.mi_free(ptr);
}

export fn OPENSSL_memory_get_size(ptr: ?*const anyopaque) usize {
    return bun.Mimalloc.mi_usable_size(ptr);
}

test "load" {
    load();
}
