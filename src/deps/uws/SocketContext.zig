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

    /// Build a BoringSSL `SSL_CTX*` from these options. Caller owns one ref
    /// and releases with `SSL_CTX_free` — the passphrase is freed inside this
    /// call once private-key load completes, so plain `SSL_CTX_free` is
    /// correct on every path.
    ///
    /// Mode-neutral: the same `SSL_CTX*` may back client connects and server
    /// accepts. CTX-level verify mode comes from `request_cert`/`ca`/
    /// `reject_unauthorized` here; the per-socket client override (always run
    /// chain validation, populate verify_error) is applied in
    /// `us_internal_ssl_attach`, so a server reusing this ctx never sends
    /// CertificateRequest unless these options asked it to.
    pub fn createSSLContext(options: BunSocketContextOptions, err: *uws.create_bun_socket_error_t) ?*BoringSSL.SSL_CTX {
        return c.us_ssl_ctx_from_options(options, err);
    }

    /// SHA-256 over every field this struct carries, dereferencing string
    /// pointers so the digest is content-addressed (not pointer-addressed).
    /// Two option structs that build the same `SSL_CTX*` produce the same
    /// digest. Used as the key for `SSLContextCache`.
    pub fn digest(self: BunSocketContextOptions) [32]u8 {
        var h = bun.sha.Hashers.SHA256.init();
        const feedZ = struct {
            fn f(hp: *bun.sha.Hashers.SHA256, s: [*c]const u8) void {
                if (s) |p| hp.update(bun.sliceTo(p, 0));
                hp.update(&.{0}); // terminator so {a:"xy"} ≠ {a:"x",b:"y"}
            }
        }.f;
        const feedArr = struct {
            fn f(hp: *bun.sha.Hashers.SHA256, arr: ?[*]const ?[*:0]const u8, n: u32) void {
                if (arr) |a| for (a[0..n]) |s| {
                    if (s) |p| hp.update(bun.sliceTo(p, 0));
                    hp.update(&.{0});
                };
                hp.update(&.{0});
            }
        }.f;
        feedZ(&h, self.key_file_name);
        feedZ(&h, self.cert_file_name);
        feedZ(&h, self.passphrase);
        feedZ(&h, self.dh_params_file_name);
        feedZ(&h, self.ca_file_name);
        feedZ(&h, self.ssl_ciphers);
        h.update(std.mem.asBytes(&self.ssl_prefer_low_memory_usage));
        feedArr(&h, self.key, self.key_count);
        feedArr(&h, self.cert, self.cert_count);
        feedArr(&h, self.ca, self.ca_count);
        h.update(std.mem.asBytes(&self.secure_options));
        h.update(std.mem.asBytes(&self.reject_unauthorized));
        h.update(std.mem.asBytes(&self.request_cert));
        h.update(std.mem.asBytes(&self.client_renegotiation_limit));
        h.update(std.mem.asBytes(&self.client_renegotiation_window));
        var out: [32]u8 = undefined;
        h.final(&out);
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

pub const c = struct {
    pub extern fn us_ssl_ctx_from_options(BunSocketContextOptions, *uws.create_bun_socket_error_t) ?*BoringSSL.SSL_CTX;
    pub extern fn us_ssl_ctx_live_count() c_long;
};

const std = @import("std");
const bun = @import("bun");
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;
