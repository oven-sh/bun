//! Legacy home of the `us_socket_context_t` opaque, which is gone — sockets
//! now belong to embedded `SocketGroup`s and dispatch by `kind`. What remains
//! here is the `us_bun_socket_context_options_t` extern mirror, kept under its
//! old name so `SSLConfig.asUSockets()` callers don't churn.

pub const BunSocketContextOptions = extern struct {
    key_file_name: [*c]const u8 = null,
    cert_file_name: [*c]const u8 = null,
    passphrase: [*c]const u8 = null,
    dh_params_file_name: [*c]const u8 = null,
    ca_file_name: [*c]const u8 = null,
    ssl_ciphers: [*c]const u8 = null,
    ssl_prefer_low_memory_usage: i32 = 0,
    key: ?[*]const ?[*:0]const u8 = null,
    key_count: u32 = 0,
    cert: ?[*]const ?[*:0]const u8 = null,
    cert_count: u32 = 0,
    ca: ?[*]const ?[*:0]const u8 = null,
    ca_count: u32 = 0,
    secure_options: u32 = 0,
    reject_unauthorized: i32 = 0,
    request_cert: i32 = 0,
    client_renegotiation_limit: u32 = 3,
    client_renegotiation_window: u32 = 600,

    /// Build a `us_ssl_ctx_t` from these options. Caller owns the result and
    /// must `us_ssl_ctx_deinit` it (which drops the strdup'd passphrase
    /// ex-data — bare `SSL_CTX_free` would leak it).
    pub fn createSSLContext(options: BunSocketContextOptions, is_client: bool, err: *uws.create_bun_socket_error_t) ?SslCtx {
        var out: SslCtx = undefined;
        if (c.us_ssl_ctx_init(&out, options, @intFromBool(is_client), err) == 0) return null;
        return out;
    }

    /// Best-effort byte count of cert/key/CA material — fed into
    /// `SecureContext.memoryCost` so the GC sees the off-heap allocation.
    pub fn approxCertBytes(self: BunSocketContextOptions) usize {
        var n: usize = 0;
        if (self.key) |arr| for (arr[0..self.key_count]) |k| {
            if (k) |s| n += bun.sliceTo(s, 0).len;
        };
        if (self.cert) |arr| for (arr[0..self.cert_count]) |k| {
            if (k) |s| n += bun.sliceTo(s, 0).len;
        };
        if (self.ca) |arr| for (arr[0..self.ca_count]) |k| {
            if (k) |s| n += bun.sliceTo(s, 0).len;
        };
        return n;
    }
};

/// `struct us_ssl_ctx_t` mirror — also embedded in `SecureContext`.
pub const SslCtx = extern struct {
    ssl_ctx: ?*BoringSSL.SSL_CTX,
    ref_count: u32,
    client_renegotiation_limit: u32,
    client_renegotiation_window: u32,
    reject_unauthorized: u8,
    request_cert: u8,
    is_client: u8,
    borrowed: u8,

    /// Value-typed copy that shares `from`'s `SSL_CTX*` (up_ref'd) but owns
    /// its own refcount. Safe to embed in a per-connection object whose
    /// lifetime is independent of the `SecureContext` JS wrapper.
    pub fn initBorrowed(from: *const SslCtx) SslCtx {
        var out: SslCtx = undefined;
        c.us_ssl_ctx_init_borrowed(&out, from);
        return out;
    }

    pub fn deinit(self: *SslCtx) void {
        c.us_ssl_ctx_deinit(self);
    }
};

pub const c = struct {
    pub extern fn us_ssl_ctx_init(*SslCtx, BunSocketContextOptions, c_int, *uws.create_bun_socket_error_t) c_int;
    pub extern fn us_ssl_ctx_init_borrowed(*SslCtx, *const SslCtx) void;
    pub extern fn us_ssl_ctx_deinit(*SslCtx) void;
    pub extern fn us_ssl_ctx_live_count() c_long;
};

const bun = @import("bun");
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;
