//! Native backing for `node:tls` `SecureContext`. The shared TLS state is the
//! embedded `Native` (`us_ssl_ctx_t`) — `SSL_CTX*` plus the handful of policy
//! fields the C handshake/renegotiation code needs but BoringSSL doesn't store
//! (`reject_unauthorized`, `request_cert`, reneg limits). Every
//! `tls.connect`/`upgradeTLS`/`addContext` that names this object passes
//! `&this.native` to listen/connect/adopt; the C side `SSL_CTX_up_ref`s and
//! reads policy directly off the struct, so the expensive cert/key/CA parse
//! happens once.
//!
//! `tls.ts` memoises `createSecureContext()` by config hash, so the common
//! "one config, thousands of connections" pattern allocates one of these and
//! one `SSL_CTX` total instead of one per connection.
const SecureContext = @This();

pub const js = jsc.Codegen.JSSecureContext;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

native: Native,
/// Approximate cert/key/CA byte length plus the BoringSSL `SSL_CTX` floor
/// (~50 KB), so the GC can account for the off-heap allocation.
extra_memory: usize,

/// `struct us_ssl_ctx_t`. Single source of truth lives in
/// `uws/SocketContext.zig` so non-JS callers (HTTP thread, SQL drivers) can
/// build one without pulling in the JSC class.
pub const Native = uws.SocketContext.SslCtx;

comptime {
    if (@sizeOf(Native) != 24) @compileError("us_ssl_ctx_t layout drift vs libusockets.h");
}

pub fn constructor(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*SecureContext {
    const args = callframe.arguments();
    const opts = if (args.len > 0) args[0] else .js_undefined;

    var config = (try SSLConfig.fromJS(global.bunVM(), global, opts)) orelse SSLConfig.zero;
    defer config.deinit();

    return try create(global, &config, true);
}

pub fn create(global: *jsc.JSGlobalObject, config: *const SSLConfig, is_client: bool) bun.JSError!*SecureContext {
    const ctx_opts = config.asUSockets();
    var err: uws.create_bun_socket_error_t = .none;
    const native = ctx_opts.createSSLContext(is_client, &err) orelse {
        return global.throwValue(err.toJS(global));
    };
    return bun.new(SecureContext, .{
        .native = native,
        .extra_memory = ctx_opts.approxCertBytes() + ssl_ctx_base_cost,
    });
}

/// Hand the C-visible context to listen/connect/adopt. The C side bumps
/// `ref_count` while it holds it, so this is safe even if JS drops its ref
/// mid-connection.
pub inline fn handle(this: *SecureContext) *Native {
    return &this.native;
}

pub fn finalize(this: *SecureContext) callconv(.c) void {
    this.native.deinit();
    bun.destroy(this);
}

pub fn memoryCost(this: *SecureContext) usize {
    return @sizeOf(SecureContext) + this.extra_memory;
}

pub fn getNativeHandle(this: *SecureContext, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(f64, @floatFromInt(@intFromPtr(this.native.ssl_ctx))));
}

/// Exposed via `bun:internal-for-testing` so churn tests can assert
/// `SSL_CTX_new` was called O(1) times, not O(connections).
pub fn jsLiveCount(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return jsc.JSValue.jsNumber(c.us_ssl_ctx_live_count());
}

const ssl_ctx_base_cost: usize = 50 * 1024;

pub const c = uws.SocketContext.c;

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;
const SSLConfig = jsc.API.ServerConfig.SSLConfig;
