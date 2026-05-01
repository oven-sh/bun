//! Native backing for `node:tls` `SecureContext`. Owns one BoringSSL
//! `SSL_CTX*`; every `tls.connect`/`upgradeTLS`/`addContext` that names this
//! object passes that pointer to listen/connect/adopt, where `SSL_new()`
//! up-refs it for each socket. Policy (verify mode, reneg limits) is encoded
//! on the SSL_CTX itself in `us_ssl_ctx_from_options`, so the SSL_CTX's own
//! refcount is the only refcount and a socket safely outlives a GC'd
//! SecureContext.
//!
//! `intern()` memoises by config digest at two levels: a `WeakGCMap` on the
//! global (same digest → same `JSSecureContext` while alive) and the per-VM
//! native `SSLContextCache` (same digest → same `SSL_CTX*` regardless of which
//! consumer asked). The "one config, thousands of connections" pattern
//! allocates one of these and one `SSL_CTX` total — `tls.ts` no longer hashes
//! in JS.
const SecureContext = @This();

pub const js = jsc.Codegen.JSSecureContext;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

ctx: *BoringSSL.SSL_CTX,
/// `BunSocketContextOptions.digest()` — exactly the fields that reach
/// `us_ssl_ctx_from_options`. Stored so an `intern()` WeakGCMap hit (keyed by
/// the low 64 bits) can do a full content-equality check before reusing.
digest: [32]u8,
/// Approximate cert/key/CA byte length plus the BoringSSL `SSL_CTX` floor
/// (~50 KB), so the GC can account for the off-heap allocation.
extra_memory: usize,

pub fn constructor(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*SecureContext {
    const args = callframe.arguments();
    const opts = if (args.len > 0) args[0] else .js_undefined;

    var config = (try SSLConfig.fromJS(global.bunVM(), global, opts)) orelse SSLConfig.zero;
    defer config.deinit();

    return try create(global, &config);
}

/// Mode-neutral: Node lets one `SecureContext` back both `tls.connect()` and
/// `tls.createServer({secureContext})`, so we cannot bake client-vs-server
/// into the `SSL_CTX`. CTX-level verify mode is whatever `config` asked for
/// (i.e. servers don't send CertificateRequest unless `requestCert` was set);
/// the per-socket attach overrides client SSLs to `SSL_VERIFY_PEER` so chain
/// validation always runs and `verify_error` is populated for the JS-side
/// `rejectUnauthorized` decision. The trust store is loaded unconditionally in
/// `us_ssl_ctx_from_options` so that override has roots to validate against.
pub fn create(global: *jsc.JSGlobalObject, config: *const SSLConfig) bun.JSError!*SecureContext {
    const ctx_opts = config.asUSockets();
    var err: uws.create_bun_socket_error_t = .none;
    const ctx = global.bunVM().rareData().sslCtxCache().getOrCreateOpts(ctx_opts, &err) orelse {
        // `err` is only set for the input-validation paths (bad PEM, missing
        // file, …). When BoringSSL itself fails (e.g. unsupported curve) the
        // enum is still `.none`; surface the library error stack instead of
        // throwing an empty placeholder.
        if (err == .none) {
            const code = BoringSSL.ERR_get_error();
            if (code != 0) return global.throwValue(bun.BoringSSL.ERR_toJS(global, code));
            return global.throw("Failed to create SSL context", .{});
        }
        return global.throwValue(err.toJS(global));
    };
    return bun.new(SecureContext, .{
        .ctx = ctx,
        .digest = ctx_opts.digest(),
        .extra_memory = ctx_opts.approxCertBytes() + ssl_ctx_base_cost,
    });
}

/// `tls.createSecureContext(opts)` entry point. WeakGCMap-memoised by config
/// digest so identical configs return the same `JSSecureContext` cell while
/// it's alive; falls through to `create()` (which itself hits the native
/// `SSLContextCache`) on miss. Returning the same cell is what makes
/// `secureContext === createSecureContext(opts)` hold and lets `Listener.zig`
/// pointer-compare without a JS-side WeakRef map.
pub fn intern(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments();
    const opts = if (args.len > 0) args[0] else .js_undefined;

    var config = (try SSLConfig.fromJS(global.bunVM(), global, opts)) orelse SSLConfig.zero;
    defer config.deinit();

    const d = config.ctxDigest();
    const key = std.mem.readInt(u64, d[0..8], .little);

    const cached = cpp.Bun__SecureContextCache__get(global, key);
    if (cached != .zero) {
        if (fromJS(cached)) |existing| {
            // 64-bit key collision is ~2⁻⁶⁴ but a false hit hands the wrong
            // cert to a connection. Full-digest compare is 32 bytes; cheap.
            if (bun.strings.eqlLong(&existing.digest, &d, false)) {
                return cached;
            }
        }
    }

    const sc = try create(global, &config);
    const value = sc.toJS(global);
    cpp.Bun__SecureContextCache__set(global, key, value);
    return value;
}

/// `SSL_CTX_up_ref` and return — for callers that want to outlive this
/// wrapper's GC. Most paths just pass `this.ctx` directly and let `SSL_new`
/// take its own ref.
pub fn borrow(this: *SecureContext) *BoringSSL.SSL_CTX {
    _ = BoringSSL.SSL_CTX_up_ref(this.ctx);
    return this.ctx;
}

pub fn finalize(this: *SecureContext) callconv(.c) void {
    BoringSSL.SSL_CTX_free(this.ctx);
    bun.destroy(this);
}

pub fn memoryCost(this: *SecureContext) usize {
    return @sizeOf(SecureContext) + this.extra_memory;
}

/// Exposed via `bun:internal-for-testing` so churn tests can assert
/// `SSL_CTX_new` was called O(1) times, not O(connections).
pub fn jsLiveCount(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return jsc.JSValue.jsNumber(c.us_ssl_ctx_live_count());
}

const ssl_ctx_base_cost: usize = 50 * 1024;

pub const c = uws.SocketContext.c;

const cpp = struct {
    pub extern fn Bun__SecureContextCache__get(*jsc.JSGlobalObject, u64) jsc.JSValue;
    pub extern fn Bun__SecureContextCache__set(*jsc.JSGlobalObject, u64, jsc.JSValue) void;
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;
const SSLConfig = jsc.API.ServerConfig.SSLConfig;
