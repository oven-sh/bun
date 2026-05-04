//! Process/VM-scoped weak cache of `SSL_CTX*` keyed by config digest.
//!
//! The map holds **zero** refs on the cached `SSL_CTX*`. An `SSL_CTX` ex_data
//! slot stores a back-pointer to the heap `Entry`; BoringSSL's `CRYPTO_EX_free`
//! callback (registered once in `openssl.c`'s `us_ex_idx_init`) tombstones the
//! entry (`entry.ctx = null`) when the real refcount hits 0. The next
//! `getOrCreate` for that digest sees the tombstone and rebuilds.
//!
//! Race-freedom relies on the per-VM instance only being touched from the JS
//! thread: every consumer's `SSL_CTX_free` (socket close, `owned_ssl_ctx`
//! deinit, `SecureContext.finalize`) runs there — JSC sweeps destructible
//! objects on the mutator, not heap-helper, thread. The mutex makes the
//! tombstone-write / `getOrCreate`-load+`up_ref` ordering explicit and
//! protects against any future caller that does free off-thread; the lock is
//! uncontended in practice.
//!
//! This subsumes the per-consumer `createSSLContext` calls (Postgres, MySQL,
//! Valkey, `Bun.connect`, `upgradeTLS`, WebSocket client) and the JS-side
//! `tls.ts` SHA-256/WeakRef memo: every path that turns an `SSLConfig` into an
//! `SSL_CTX*` goes through here, so one config = one CTX per process.

const SSLContextCache = @This();

map: std.ArrayHashMapUnmanaged(Digest, *Entry, DigestContext, false) = .empty,
mutex: bun.Mutex = .{},
ops_since_compact: u32 = 0,

pub const Digest = [32]u8;

/// SHA-256 output is uniformly distributed, so the first 4 bytes are a perfect
/// bucket hash — no need to re-Wyhash 32 bytes (what AutoContext would do).
/// `eql` still compares the full digest. `store_hash = false` since recompute
/// is a single load.
const DigestContext = struct {
    pub fn hash(_: @This(), k: Digest) u32 {
        return std.mem.readInt(u32, k[0..4], .little);
    }
    pub fn eql(_: @This(), a: Digest, b: Digest, _: usize) bool {
        return bun.strings.eqlLong(&a, &b, false);
    }
};

pub const Entry = struct {
    /// Nulled by `bun_ssl_ctx_cache_on_free` when BoringSSL drops the last
    /// ref. Tombstoned entries are reclaimed on the next `getOrCreate` for the
    /// same digest, or by the periodic compact.
    ctx: ?*BoringSSL.SSL_CTX,
    owner: *SSLContextCache,
};

/// Returns +1 ref; caller must `SSL_CTX_free`. The map itself holds no ref.
pub fn getOrCreate(
    self: *SSLContextCache,
    config: *const SSLConfig,
    err: *uws.create_bun_socket_error_t,
) ?*BoringSSL.SSL_CTX {
    const opts = config.asUSockets();
    return self.getOrCreateDigest(opts, opts.digest(), err);
}

/// Variant for callers that already projected to `BunSocketContextOptions`
/// (e.g. via `asUSocketsForClientVerification()`).
pub fn getOrCreateOpts(
    self: *SSLContextCache,
    opts: uws.SocketContext.BunSocketContextOptions,
    err: *uws.create_bun_socket_error_t,
) ?*BoringSSL.SSL_CTX {
    return self.getOrCreateDigest(opts, opts.digest(), err);
}

/// Core entry — `d` already computed by caller. `SecureContext.intern()`
/// threads its WeakGCMap key through here so the SHA-256 runs once total
/// instead of three times on a miss.
pub fn getOrCreateDigest(
    self: *SSLContextCache,
    opts: uws.SocketContext.BunSocketContextOptions,
    d: Digest,
    err: *uws.create_bun_socket_error_t,
) ?*BoringSSL.SSL_CTX {
    {
        self.mutex.lock();
        defer self.mutex.unlock();
        if (self.map.get(d)) |entry| {
            if (entry.ctx) |ctx| {
                _ = BoringSSL.SSL_CTX_up_ref(ctx);
                return ctx;
            }
        }
    }

    // Miss (or tombstoned): build outside the lock. `createSSLContext` does
    // file I/O / cert parsing and on Windows the system-CA load — none of
    // which has a reason to serialize, and holding a non-reentrant SRWLock
    // across an SSL_CTX_free that *did* tombstone would self-deadlock.
    const ctx = opts.createSSLContext(err) orelse return null;

    self.mutex.lock();
    defer self.mutex.unlock();

    // Re-check: another caller may have inserted while we were building.
    // Prefer the already-cached one and drop ours so callers converge.
    const gop = bun.handleOom(self.map.getOrPut(bun.default_allocator, d));
    if (gop.found_existing) {
        const entry = gop.value_ptr.*;
        if (entry.ctx) |existing| {
            _ = BoringSSL.SSL_CTX_up_ref(existing);
            BoringSSL.SSL_CTX_free(ctx);
            return existing;
        }
        // Tombstone — adopt the rebuilt CTX into the existing slot.
        // SSL_CTX_set_ex_data only fails on OOM (Bun crashes anyway), but if
        // it did, the entry would never tombstone and `entry.ctx` would dangle
        // after the CTX is freed. Don't cache it; caller still owns the ref.
        if (BoringSSL.SSL_CTX_set_ex_data(ctx, c.us_ssl_ctx_cache_ex_idx(), entry) != 1) return ctx;
        entry.ctx = ctx;
        return ctx;
    }

    const entry = bun.new(Entry, .{ .ctx = ctx, .owner = self });
    gop.value_ptr.* = entry;
    if (BoringSSL.SSL_CTX_set_ex_data(ctx, c.us_ssl_ctx_cache_ex_idx(), entry) != 1) {
        _ = self.map.swapRemove(d);
        bun.destroy(entry);
        return ctx;
    }

    self.ops_since_compact += 1;
    if (self.ops_since_compact > 16) {
        self.ops_since_compact = 0;
        self.compactLocked();
    }
    return ctx;
}

/// `CRYPTO_EX_free` for the cache slot. `ptr` is the `*Entry` we stashed via
/// `SSL_CTX_set_ex_data` (null for CTXs that never went through the cache —
/// e.g. `HTTPThread`'s, or build-fail paths). Runs synchronously inside
/// whichever `SSL_CTX_free` took the refcount to zero, on that caller's
/// thread; for the per-VM cache that's always the JS thread.
export fn bun_ssl_ctx_cache_on_free(
    parent: ?*anyopaque,
    ptr: ?*anyopaque,
    ad: [*c]BoringSSL.CRYPTO_EX_DATA,
    index: c_int,
    argl: c_long,
    argp: ?*anyopaque,
) callconv(.c) void {
    _ = parent;
    _ = ad;
    _ = index;
    _ = argl;
    _ = argp;
    const entry: *Entry = @ptrCast(@alignCast(ptr orelse return));
    entry.owner.mutex.lock();
    defer entry.owner.mutex.unlock();
    entry.ctx = null;
}

/// Reclaim tombstoned entries. Locked variant — callers hold `self.mutex`.
fn compactLocked(self: *SSLContextCache) void {
    var i: usize = 0;
    while (i < self.map.count()) {
        const entry = self.map.values()[i];
        if (entry.ctx == null) {
            bun.destroy(entry);
            self.map.swapRemoveAt(i);
        } else i += 1;
    }
}

/// VM teardown. Clears each live entry's ex_data so the eventual
/// `SSL_CTX_free` (from sockets/SecureContexts that outlive RareData) doesn't
/// dereference the freed `Entry`/map. Map itself holds no refs, so no
/// `SSL_CTX_free` here.
pub fn deinit(self: *SSLContextCache) void {
    self.mutex.lock();
    defer self.mutex.unlock();
    for (self.map.values()) |entry| {
        if (entry.ctx) |ctx| {
            _ = BoringSSL.SSL_CTX_set_ex_data(ctx, c.us_ssl_ctx_cache_ex_idx(), null);
        }
        bun.destroy(entry);
    }
    self.map.deinit(bun.default_allocator);
}

pub const c = struct {
    /// Registered alongside the other usockets ex_data slots in
    /// `us_ex_idx_init` (pthread_once-guarded).
    pub extern fn us_ssl_ctx_cache_ex_idx() c_int;
};

comptime {
    // Force into the link even though nothing in Zig calls it — `openssl.c`
    // references it as the `CRYPTO_EX_free` for `us_ctx_cache_ex_idx`.
    _ = &bun_ssl_ctx_cache_on_free;
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;
const SSLConfig = jsc.API.ServerConfig.SSLConfig;
