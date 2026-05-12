//! Process/VM-scoped weak cache of `SSL_CTX*` keyed by config digest.
//!
//! The map holds **zero** refs on the cached `SSL_CTX*`. An `SSL_CTX` ex_data
//! slot stores a back-pointer to the heap `Entry`; BoringSSL's `CRYPTO_EX_free`
//! callback (registered once in `openssl.c`'s `us_ex_idx_init`) tombstones the
//! entry (`entry.ctx = null`) when the real refcount hits 0. The next
//! `get_or_create` for that digest sees the tombstone and rebuilds.
//!
//! Race-freedom relies on the per-VM instance only being touched from the JS
//! thread: every consumer's `SSL_CTX_free` (socket close, `owned_ssl_ctx`
//! deinit, `SecureContext.finalize`) runs there — JSC sweeps destructible
//! objects on the mutator, not heap-helper, thread. The mutex makes the
//! tombstone-write / `get_or_create`-load+`up_ref` ordering explicit and
//! protects against any future caller that does free off-thread; the lock is
//! uncontended in practice.
//!
//! This subsumes the per-consumer `createSSLContext` calls (Postgres, MySQL,
//! Valkey, `Bun.connect`, `upgradeTLS`, WebSocket client) and the JS-side
//! `tls.ts` SHA-256/WeakRef memo: every path that turns an `SSLConfig` into an
//! `SSL_CTX*` goes through here, so one config = one CTX per process.

use core::ffi::{c_int, c_long, c_void};
use core::ptr;

use bun_boringssl_sys as boringssl;
use bun_collections::ArrayHashMap;
use bun_threading::Mutex;
use bun_uws as uws;
use bun_uws::create_bun_socket_error_t;

// `jsc.API.ServerConfig.SSLConfig` — re-exported from src/runtime/socket/SSLConfig.rs
use crate::api::server::server_config::SSLConfig;

/// Local shim: `bun_uws::SocketContext::BunSocketContextOptions` is a `#[repr(C)]`
/// duplicate of `bun_uws_sys::BunSocketContextOptions` (same fields, same order)
/// but only the `_sys` copy has `.digest()`. Bridge by bitwise copy until the
/// upstream crates are unified.
trait BunSocketContextOptionsDigest {
    fn digest(&self) -> Digest;
}
impl BunSocketContextOptionsDigest for uws::SocketContext::BunSocketContextOptions {
    fn digest(&self) -> Digest {
        const _: () = assert!(
            core::mem::size_of::<uws::SocketContext::BunSocketContextOptions>()
                == core::mem::size_of::<bun_uws_sys::BunSocketContextOptions>()
        );
        // SAFETY: both are `#[repr(C)]` with identical field list/order (see
        // src/uws/lib.rs SocketContext::BunSocketContextOptions and
        // src/uws_sys/SocketContext.rs); Copy + POD, so a typed pointer cast
        // followed by a load is sound.
        let sys: bun_uws_sys::BunSocketContextOptions = unsafe {
            core::ptr::from_ref(self)
                .cast::<bun_uws_sys::BunSocketContextOptions>()
                .read()
        };
        sys.digest()
    }
}

pub struct SSLContextCache {
    // TODO(port): ArrayHashMap needs custom context = DigestContext, store_hash = false
    map: ArrayHashMap<Digest, *mut Entry>,
    mutex: Mutex,
    ops_since_compact: u32,
}

impl Default for SSLContextCache {
    fn default() -> Self {
        Self {
            map: ArrayHashMap::default(),
            mutex: Mutex::default(),
            ops_since_compact: 0,
        }
    }
}

pub type Digest = [u8; 32];

/// SHA-256 output is uniformly distributed, so the first 4 bytes are a perfect
/// bucket hash — no need to re-Wyhash 32 bytes (what AutoContext would do).
/// `eql` still compares the full digest. `store_hash = false` since recompute
/// is a single load.
pub struct DigestContext;

impl DigestContext {
    pub fn hash(&self, k: &Digest) -> u32 {
        u32::from_le_bytes([k[0], k[1], k[2], k[3]])
    }
    pub fn eql(&self, a: &Digest, b: &Digest, _: usize) -> bool {
        bun_core::strings::eql_long(a, b, false)
    }
}
// TODO(port): wire DigestContext as the ArrayHashMap hasher/eq (Zig: 4th generic param)

pub struct Entry {
    /// Nulled by `bun_ssl_ctx_cache_on_free` when BoringSSL drops the last
    /// ref. Tombstoned entries are reclaimed on the next `get_or_create` for
    /// the same digest, or by the periodic compact.
    pub ctx: *mut boringssl::SSL_CTX,
    /// BACKREF: the cache outlives every `Entry` it allocates (Drop clears
    /// ex_data first so the `CRYPTO_EX_free` callback never sees a dangling
    /// owner).
    pub owner: bun_ptr::BackRef<SSLContextCache>,
}

impl SSLContextCache {
    /// Returns +1 ref; caller must `SSL_CTX_free`. The map itself holds no ref.
    pub fn get_or_create(
        &mut self,
        config: &SSLConfig,
        err: &mut create_bun_socket_error_t,
    ) -> Option<*mut boringssl::SSL_CTX> {
        let opts = config.as_usockets();
        self.get_or_create_digest(opts, opts.digest(), err)
    }

    /// Variant for callers that already projected to `BunSocketContextOptions`
    /// (e.g. via `as_usockets_for_client_verification()`).
    pub fn get_or_create_opts(
        &mut self,
        opts: uws::SocketContext::BunSocketContextOptions,
        err: &mut create_bun_socket_error_t,
    ) -> Option<*mut boringssl::SSL_CTX> {
        self.get_or_create_digest(opts, opts.digest(), err)
    }

    /// Core entry — `d` already computed by caller. `SecureContext.intern()`
    /// threads its WeakGCMap key through here so the SHA-256 runs once total
    /// instead of three times on a miss.
    pub fn get_or_create_digest(
        &mut self,
        opts: uws::SocketContext::BunSocketContextOptions,
        d: Digest,
        err: &mut create_bun_socket_error_t,
    ) -> Option<*mut boringssl::SSL_CTX> {
        {
            let _guard = self.mutex.lock_guard();
            if let Some(entry) = self.map.get(&d) {
                // SAFETY: map values are live heap Entries (heap::alloc below); freed only
                // via compact_locked / Drop, both of which hold this mutex.
                let entry = unsafe { &**entry };
                if !entry.ctx.is_null() {
                    let ctx = entry.ctx;
                    // SAFETY: ctx non-null and tombstone write is serialized by this mutex.
                    unsafe { boringssl::SSL_CTX_up_ref(ctx) };
                    return Some(ctx);
                }
            }
        }

        // Miss (or tombstoned): build outside the lock. `create_ssl_context` does
        // file I/O / cert parsing and on Windows the system-CA load — none of
        // which has a reason to serialize, and holding a non-reentrant SRWLock
        // across an SSL_CTX_free that *did* tombstone would self-deadlock.
        let ctx = opts.create_ssl_context(err)?;

        let _guard = self.mutex.lock_guard();

        // Capture the backref before the mutable borrow of `self.map` so the
        // borrow checker doesn't see an overlapping immutable borrow at the
        // `Entry { owner: ... }` site below.
        let owner_ptr = bun_ptr::BackRef::new(&*self);

        // Re-check: another caller may have inserted while we were building.
        // Prefer the already-cached one and drop ours so callers converge.
        let gop = bun_core::handle_oom(self.map.get_or_put(d));
        if gop.found_existing {
            // SAFETY: existing map value is a live heap Entry (see above).
            let entry = unsafe { &mut **gop.value_ptr };
            if !entry.ctx.is_null() {
                let existing = entry.ctx;
                // SAFETY: existing non-null; ctx is the fresh CTX we just built and own.
                unsafe {
                    boringssl::SSL_CTX_up_ref(existing);
                    boringssl::SSL_CTX_free(ctx);
                }
                return Some(existing);
            }
            // Tombstone — adopt the rebuilt CTX into the existing slot.
            // SSL_CTX_set_ex_data only fails on OOM (Bun crashes anyway), but if
            // it did, the entry would never tombstone and `entry.ctx` would dangle
            // after the CTX is freed. Don't cache it; caller still owns the ref.
            // SAFETY: ctx is a valid SSL_CTX*; entry is a valid heap pointer.
            if unsafe {
                boringssl::SSL_CTX_set_ex_data(
                    ctx,
                    c::us_ssl_ctx_cache_ex_idx(),
                    std::ptr::from_mut::<Entry>(entry).cast::<c_void>(),
                )
            } != 1
            {
                return Some(ctx);
            }
            entry.ctx = ctx;
            return Some(ctx);
        }

        let entry = bun_core::heap::into_raw(Box::new(Entry {
            ctx,
            owner: owner_ptr,
        }));
        *gop.value_ptr = entry;
        // SAFETY: ctx is a valid SSL_CTX*; entry is a fresh non-null heap pointer.
        if unsafe {
            boringssl::SSL_CTX_set_ex_data(
                ctx,
                c::us_ssl_ctx_cache_ex_idx(),
                entry.cast::<c_void>(),
            )
        } != 1
        {
            self.map.swap_remove(&d);
            // SAFETY: entry was just heap-allocated above and not yet published to ex_data.
            drop(unsafe { bun_core::heap::take(entry) });
            return Some(ctx);
        }

        self.ops_since_compact += 1;
        if self.ops_since_compact > 16 {
            self.ops_since_compact = 0;
            self.compact_locked();
        }
        Some(ctx)
    }

    /// Reclaim tombstoned entries. Locked variant — callers hold `self.mutex`.
    fn compact_locked(&mut self) {
        let mut i: usize = 0;
        while i < self.map.count() {
            let entry = self.map.values()[i];
            // SAFETY: map values are live heap Entries; we hold the mutex.
            if unsafe { (*entry).ctx.is_null() } {
                // SAFETY: entry was heap-allocated in get_or_create_digest; ex_data
                // back-pointer is already moot (ctx == null means CRYPTO_EX_free ran).
                drop(unsafe { bun_core::heap::take(entry) });
                self.map.swap_remove_at(i);
            } else {
                i += 1;
            }
        }
    }
}

/// `CRYPTO_EX_free` for the cache slot. `ptr` is the `*Entry` we stashed via
/// `SSL_CTX_set_ex_data` (null for CTXs that never went through the cache —
/// e.g. `HTTPThread`'s, or build-fail paths). Runs synchronously inside
/// whichever `SSL_CTX_free` took the refcount to zero, on that caller's
/// thread; for the per-VM cache that's always the JS thread.
#[unsafe(no_mangle)]
pub extern "C" fn bun_ssl_ctx_cache_on_free(
    parent: *mut c_void,
    ptr: *mut c_void,
    ad: *mut boringssl::CRYPTO_EX_DATA,
    index: c_int,
    argl: c_long,
    argp: *mut c_void,
) {
    let _ = parent;
    let _ = ad;
    let _ = index;
    let _ = argl;
    let _ = argp;
    if ptr.is_null() {
        return;
    }
    // SAFETY: non-null ptr is the *Entry we stored via SSL_CTX_set_ex_data; the
    // owning cache outlives every SSL_CTX it hands out (Drop clears ex_data first).
    let entry: &mut Entry = unsafe { bun_ptr::callback_ctx::<Entry>(ptr) };
    let _guard = entry.owner.mutex.lock_guard();
    entry.ctx = ptr::null_mut();
}

impl Drop for SSLContextCache {
    /// VM teardown. Clears each live entry's ex_data so the eventual
    /// `SSL_CTX_free` (from sockets/SecureContexts that outlive RareData) doesn't
    /// dereference the freed `Entry`/map. Map itself holds no refs, so no
    /// `SSL_CTX_free` here.
    fn drop(&mut self) {
        let _guard = self.mutex.lock_guard();
        for &entry in self.map.values() {
            // SAFETY: map values are live heap Entries; we hold the mutex.
            let e = unsafe { &*entry };
            if !e.ctx.is_null() {
                // SAFETY: ctx non-null; clearing the ex_data slot we set.
                unsafe {
                    boringssl::SSL_CTX_set_ex_data(
                        e.ctx,
                        c::us_ssl_ctx_cache_ex_idx(),
                        ptr::null_mut(),
                    );
                }
            }
            // SAFETY: entry was heap-allocated in get_or_create_digest and is removed
            // from any ex_data above, so no other path can reach it.
            drop(unsafe { bun_core::heap::take(entry) });
        }
        // map storage freed by its own Drop
    }
}

pub mod c {
    use core::ffi::c_int;
    // TODO(port): move to bun_uws_sys
    unsafe extern "C" {
        /// Registered alongside the other usockets ex_data slots in
        /// `us_ex_idx_init` (pthread_once-guarded).
        pub safe fn us_ssl_ctx_cache_ex_idx() -> c_int;
    }
}

// ported from: src/runtime/api/bun/SSLContextCache.zig
