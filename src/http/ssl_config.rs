//! MOVE-IN: ssl_config (MOVE_DOWN bun_runtime::socket::SSLConfig → bun_http)
//! Ground truth: src/runtime/socket/SSLConfig.zig
//! JSC-dependent constructors (from_js / from_generated / read_from_blob /
//! handle_path / handle_file*) stay in bun_runtime (tier-6, Pass C).

use core::ffi::{c_char, CStr};
use std::sync::{Arc, Weak};

use bun_uws as uws;
// TODO(port): Zig used `std.hash.Wyhash`; routed to Wyhash11 until std Wyhash
// is ported (see bun_wyhash TODO). Only affects content_hash (cache key).
use bun_wyhash::Wyhash11 as Wyhash;
use parking_lot::Mutex;

/// Owned, NUL-terminated C-string slice (`?[*:0]const u8` in Zig). The
/// pointer is heap-owned (allocated via `dupeZ`); freed via
/// `free_sensitive` in `deinit`.
type CStrPtr = *const c_char;
/// Owned slice of owned C strings (`?[][*:0]const u8` in Zig).
type CStrSlice = Option<Box<[CStrPtr]>>;

pub struct SSLConfig {
    pub server_name: CStrPtr,

    pub key_file_name: CStrPtr,
    pub cert_file_name: CStrPtr,

    pub ca_file_name: CStrPtr,
    pub dh_params_file_name: CStrPtr,

    pub passphrase: CStrPtr,

    pub key: CStrSlice,
    pub cert: CStrSlice,
    pub ca: CStrSlice,

    pub secure_options: u32,
    pub request_cert: i32,
    pub reject_unauthorized: i32,
    pub ssl_ciphers: CStrPtr,
    pub protos: CStrPtr,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
    pub requires_custom_request_ctx: bool,
    pub is_using_default_ciphers: bool,
    pub low_memory_mode: bool,
    pub cached_hash: u64,
}

/// Casing alias for callers that snake_cased the type name.
pub type SslConfig = SSLConfig;

/// Atomic shared pointer with weak support. Refcounting and allocation are
/// managed non-intrusively by `Arc`; the `SSLConfig` struct itself has no
/// refcount field. Mirrors `bun.ptr.shared.WithOptions(*SSLConfig,
/// .{ .atomic = true, .allow_weak = true })`.
#[derive(Clone)]
#[repr(transparent)]
pub struct SharedPtr(Arc<SSLConfig>);

pub type WeakPtr = Weak<SSLConfig>;

impl SharedPtr {
    #[inline]
    pub fn new(config: SSLConfig) -> Self {
        Self(Arc::new(config))
    }
    #[inline]
    pub fn get(&self) -> &SSLConfig {
        &self.0
    }
    #[inline]
    pub fn clone_weak(&self) -> WeakPtr {
        Arc::downgrade(&self.0)
    }
    #[inline]
    pub fn as_arc(&self) -> &Arc<SSLConfig> {
        &self.0
    }
}

impl core::ops::Deref for SharedPtr {
    type Target = SSLConfig;
    #[inline]
    fn deref(&self) -> &SSLConfig {
        &self.0
    }
}

impl From<Arc<SSLConfig>> for SharedPtr {
    #[inline]
    fn from(a: Arc<SSLConfig>) -> Self {
        Self(a)
    }
}

impl SSLConfig {
    pub const ZERO: SSLConfig = SSLConfig {
        server_name: core::ptr::null(),
        key_file_name: core::ptr::null(),
        cert_file_name: core::ptr::null(),
        ca_file_name: core::ptr::null(),
        dh_params_file_name: core::ptr::null(),
        passphrase: core::ptr::null(),
        key: None,
        cert: None,
        ca: None,
        secure_options: 0,
        request_cert: 0,
        reject_unauthorized: 0,
        ssl_ciphers: core::ptr::null(),
        protos: core::ptr::null(),
        client_renegotiation_limit: 0,
        client_renegotiation_window: 0,
        requires_custom_request_ctx: false,
        is_using_default_ciphers: true,
        low_memory_mode: false,
        cached_hash: 0,
    };

    /// Extract the raw `*const SSLConfig` from an optional shared handle for
    /// pointer-equality comparison (interned configs have stable addresses).
    #[inline]
    pub fn raw_ptr<D>(maybe_shared: Option<&D>) -> Option<*const SSLConfig>
    where
        D: core::ops::Deref<Target = SSLConfig>,
    {
        maybe_shared.map(|s| &raw const **s)
    }

    pub fn as_usockets(&self) -> uws::socket_context::BunSocketContextOptions {
        let mut ctx_opts = uws::socket_context::BunSocketContextOptions::default();

        if !self.key_file_name.is_null() {
            ctx_opts.key_file_name = self.key_file_name;
        }
        if !self.cert_file_name.is_null() {
            ctx_opts.cert_file_name = self.cert_file_name;
        }
        if !self.ca_file_name.is_null() {
            ctx_opts.ca_file_name = self.ca_file_name;
        }
        if !self.dh_params_file_name.is_null() {
            ctx_opts.dh_params_file_name = self.dh_params_file_name;
        }
        if !self.passphrase.is_null() {
            ctx_opts.passphrase = self.passphrase;
        }
        ctx_opts.ssl_prefer_low_memory_usage = i32::from(self.low_memory_mode);

        if let Some(key) = &self.key {
            ctx_opts.key = key.as_ptr();
            ctx_opts.key_count = key.len() as u32;
        }
        if let Some(cert) = &self.cert {
            ctx_opts.cert = cert.as_ptr();
            ctx_opts.cert_count = cert.len() as u32;
        }
        if let Some(ca) = &self.ca {
            ctx_opts.ca = ca.as_ptr();
            ctx_opts.ca_count = ca.len() as u32;
        }

        if !self.ssl_ciphers.is_null() {
            ctx_opts.ssl_ciphers = self.ssl_ciphers;
        }
        ctx_opts.request_cert = self.request_cert;
        ctx_opts.reject_unauthorized = self.reject_unauthorized;

        ctx_opts
    }

    /// Returns socket options for client-side TLS with manual verification.
    /// Sets request_cert=1 (to receive server cert) and reject_unauthorized=0
    /// (to handle verification manually in handshake callback).
    pub fn as_usockets_for_client_verification(
        &self,
    ) -> uws::socket_context::BunSocketContextOptions {
        let mut opts = self.as_usockets();
        opts.request_cert = 1;
        opts.reject_unauthorized = 0;
        opts
    }

    /// Returns a copy of this config for client-side TLS with manual verification.
    /// Sets request_cert=1 (to receive server cert) and reject_unauthorized=0
    /// (to handle verification manually in handshake callback).
    pub fn for_client_verification(&self) -> SSLConfig {
        let mut copy = self.clone();
        copy.request_cert = 1;
        copy.reject_unauthorized = 0;
        copy
    }

    pub fn is_same(&self, other: &SSLConfig) -> bool {
        macro_rules! eq_cstr {
            ($f:ident) => {
                if !cstr_eq(self.$f, other.$f) {
                    return false;
                }
            };
        }
        macro_rules! eq_slice {
            ($f:ident) => {
                match (&self.$f, &other.$f) {
                    (Some(a), Some(b)) => {
                        if a.len() != b.len() {
                            return false;
                        }
                        for (x, y) in a.iter().zip(b.iter()) {
                            if !cstr_eq(*x, *y) {
                                return false;
                            }
                        }
                    }
                    (None, None) => {}
                    _ => return false,
                }
            };
        }
        eq_cstr!(server_name);
        eq_cstr!(key_file_name);
        eq_cstr!(cert_file_name);
        eq_cstr!(ca_file_name);
        eq_cstr!(dh_params_file_name);
        eq_cstr!(passphrase);
        eq_slice!(key);
        eq_slice!(cert);
        eq_slice!(ca);
        if self.secure_options != other.secure_options {
            return false;
        }
        if self.request_cert != other.request_cert {
            return false;
        }
        if self.reject_unauthorized != other.reject_unauthorized {
            return false;
        }
        eq_cstr!(ssl_ciphers);
        eq_cstr!(protos);
        if self.client_renegotiation_limit != other.client_renegotiation_limit {
            return false;
        }
        if self.client_renegotiation_window != other.client_renegotiation_window {
            return false;
        }
        if self.requires_custom_request_ctx != other.requires_custom_request_ctx {
            return false;
        }
        if self.is_using_default_ciphers != other.is_using_default_ciphers {
            return false;
        }
        if self.low_memory_mode != other.low_memory_mode {
            return false;
        }
        true
    }

    pub fn content_hash(&mut self) -> u64 {
        if self.cached_hash != 0 {
            return self.cached_hash;
        }
        let mut hasher = Wyhash::init(0);
        macro_rules! hash_cstr {
            ($f:ident) => {
                if !self.$f.is_null() {
                    // SAFETY: non-null field is a NUL-terminated heap string we own.
                    hasher.update(unsafe { bun_core::ffi::cstr(self.$f) }.to_bytes());
                }
                hasher.update(&[0]);
            };
        }
        macro_rules! hash_slice {
            ($f:ident) => {
                if let Some(slice) = &self.$f {
                    for s in slice.iter() {
                        // SAFETY: each entry is a NUL-terminated heap string we own.
                        hasher.update(unsafe { bun_core::ffi::cstr(*s) }.to_bytes());
                        hasher.update(&[0]);
                    }
                }
                hasher.update(&[0]);
            };
        }
        hash_cstr!(server_name);
        hash_cstr!(key_file_name);
        hash_cstr!(cert_file_name);
        hash_cstr!(ca_file_name);
        hash_cstr!(dh_params_file_name);
        hash_cstr!(passphrase);
        hash_slice!(key);
        hash_slice!(cert);
        hash_slice!(ca);
        hasher.update(&self.secure_options.to_ne_bytes());
        hasher.update(&self.request_cert.to_ne_bytes());
        hasher.update(&self.reject_unauthorized.to_ne_bytes());
        hash_cstr!(ssl_ciphers);
        hash_cstr!(protos);
        hasher.update(&self.client_renegotiation_limit.to_ne_bytes());
        hasher.update(&self.client_renegotiation_window.to_ne_bytes());
        hasher.update(&[u8::from(self.requires_custom_request_ctx)]);
        hasher.update(&[u8::from(self.is_using_default_ciphers)]);
        hasher.update(&[u8::from(self.low_memory_mode)]);
        let hash = hasher.final_();
        // Avoid 0 since it's the sentinel for "not computed"
        self.cached_hash = if hash == 0 { 1 } else { hash };
        self.cached_hash
    }

    /// Destructor. Called by `Arc` on strong 1->0 for interned configs,
    /// and directly on value-type configs (e.g. `ServerConfig.ssl_config`).
    ///
    /// For interned configs, we MUST remove from the registry before freeing
    /// the string fields, since concurrent `intern()` calls may read those
    /// fields for content comparison while we're still in the map. For
    /// non-interned configs, `remove()` is a cheap no-op (pointer-identity
    /// check fails).
    pub fn deinit(&mut self) {
        global_registry::remove(self);
        free_string(&mut self.server_name);
        free_string(&mut self.key_file_name);
        free_string(&mut self.cert_file_name);
        free_string(&mut self.ca_file_name);
        free_string(&mut self.dh_params_file_name);
        free_string(&mut self.passphrase);
        free_strings(&mut self.key);
        free_strings(&mut self.cert);
        free_strings(&mut self.ca);
        free_string(&mut self.ssl_ciphers);
        free_string(&mut self.protos);
    }

    pub fn take_protos(&mut self) -> Option<Box<[u8]>> {
        if self.protos.is_null() {
            return None;
        }
        let p = core::mem::replace(&mut self.protos, core::ptr::null());
        // SAFETY: p is a NUL-terminated heap string we own.
        let bytes = unsafe { bun_core::ffi::cstr(p) }.to_bytes();
        // TODO(port): bun.memory.dropSentinel — reuses the allocation in
        // place; here we copy. PERF(port).
        let owned = bytes.to_vec().into_boxed_slice();
        bun_core::free_sensitive(p);
        Some(owned)
    }

    pub fn take_server_name(&mut self) -> Option<Box<[u8]>> {
        if self.server_name.is_null() {
            return None;
        }
        let p = core::mem::replace(&mut self.server_name, core::ptr::null());
        // SAFETY: p is a NUL-terminated heap string we own.
        let bytes = unsafe { bun_core::ffi::cstr(p) }.to_bytes();
        let owned = bytes.to_vec().into_boxed_slice();
        bun_core::free_sensitive(p);
        Some(owned)
    }
}

impl Default for SSLConfig {
    fn default() -> Self {
        Self::ZERO
    }
}

impl Clone for SSLConfig {
    fn clone(&self) -> Self {
        Self {
            server_name: clone_string(self.server_name),
            key_file_name: clone_string(self.key_file_name),
            cert_file_name: clone_string(self.cert_file_name),
            ca_file_name: clone_string(self.ca_file_name),
            dh_params_file_name: clone_string(self.dh_params_file_name),
            passphrase: clone_string(self.passphrase),
            key: clone_strings(&self.key),
            cert: clone_strings(&self.cert),
            ca: clone_strings(&self.ca),
            secure_options: self.secure_options,
            request_cert: self.request_cert,
            reject_unauthorized: self.reject_unauthorized,
            ssl_ciphers: clone_string(self.ssl_ciphers),
            protos: clone_string(self.protos),
            client_renegotiation_limit: self.client_renegotiation_limit,
            client_renegotiation_window: self.client_renegotiation_window,
            requires_custom_request_ctx: self.requires_custom_request_ctx,
            is_using_default_ciphers: self.is_using_default_ciphers,
            low_memory_mode: self.low_memory_mode,
            cached_hash: 0,
        }
    }
}

impl Drop for SSLConfig {
    fn drop(&mut self) {
        self.deinit();
    }
}

// SAFETY: all raw pointers are heap-owned C strings with no interior
// shared mutable state; cross-thread transfer is safe.
unsafe impl Send for SSLConfig {}
unsafe impl Sync for SSLConfig {}

fn cstr_eq(a: CStrPtr, b: CStrPtr) -> bool {
    match (a.is_null(), b.is_null()) {
        (true, true) => true,
        (false, false) => {
            // SAFETY: both are non-null NUL-terminated strings we own.
            let lhs = unsafe { bun_core::ffi::cstr(a) }.to_bytes();
            let rhs = unsafe { bun_core::ffi::cstr(b) }.to_bytes();
            bun_string::strings::eql_long(lhs, rhs, true)
        }
        _ => false,
    }
}

fn free_strings(slice: &mut CStrSlice) {
    if let Some(inner) = slice.take() {
        for s in inner.iter() {
            bun_core::free_sensitive(*s);
        }
    }
}

fn free_string(s: &mut CStrPtr) {
    if s.is_null() {
        return;
    }
    bun_core::free_sensitive(core::mem::replace(s, core::ptr::null()));
}

fn clone_strings(slice: &CStrSlice) -> CStrSlice {
    let inner = slice.as_ref()?;
    let mut out = Vec::with_capacity(inner.len());
    for s in inner.iter() {
        out.push(clone_string(*s));
    }
    Some(out.into_boxed_slice())
}

fn clone_string(s: CStrPtr) -> CStrPtr {
    if s.is_null() {
        return core::ptr::null();
    }
    // SAFETY: s is a NUL-terminated heap string we own.
    let bytes = unsafe { bun_core::ffi::cstr(s) }.to_bytes();
    bun_core::dupe_z(bytes)
}

/// Weak dedup cache. Each map entry stores a weak pointer on its key's
/// backing allocation. `upgrade()` on that weak pointer is memory-safe
/// because the weak ref keeps the allocation alive (even if strong==0 and
/// `Drop` is running on another thread). The mutex only protects map
/// structure and the invariant that entry content is intact while in the
/// map.
pub mod global_registry {
    use super::*;
    use bun_collections::ArrayHashMap;

    /// Newtype over `*const SSLConfig` so the static `Mutex<ArrayHashMap<K,_>>`
    /// is `Send`. The pointer is only used for identity comparison; the
    /// allocation is kept alive by the paired `WeakPtr` value while in the map.
    #[derive(Copy, Clone, PartialEq, Eq, Hash)]
    #[repr(transparent)]
    struct ConfigKey(*const SSLConfig);
    // SAFETY: pointer is identity-only; backing allocation lifetime is
    // guaranteed by the `WeakPtr` paired with each key (see `intern`).
    unsafe impl Send for ConfigKey {}
    unsafe impl Sync for ConfigKey {}

    // PERF(port): was Lock-guarded — Mutex<T> owns the map.
    static CONFIGS: Mutex<Option<ArrayHashMap<ConfigKey, WeakPtr>>> =
        Mutex::new(None);

    /// Takes a by-value SSLConfig, wraps it in a `SharedPtr` (strong=1),
    /// and either returns an existing equivalent (upgraded) or the new
    /// one. Either way, caller owns exactly one strong ref on the result.
    pub fn intern(config: SSLConfig) -> SharedPtr {
        let new_shared = SharedPtr::new(config);
        let new_ptr: *const SSLConfig = new_shared.get();

        // Deferred cleanup MUST run after `unlock` (Drop re-locks the
        // registry mutex via `SSLConfig::deinit -> remove`).
        let mut dispose_new: Option<SharedPtr> = None;
        let mut dispose_old_weak: Option<WeakPtr> = None;

        let result = {
            let mut guard = CONFIGS.lock();
            let map = guard.get_or_insert_with(ArrayHashMap::default);

            // TODO(port): Zig used content-hash + is_same as map context.
            // ArrayHashMap here is keyed by pointer; emulate content
            // lookup by linear scan over the (small) map.
            let mut found_slot: Option<usize> = None;
            // PORT NOTE: reshaped for borrowck — iterate keys() slice instead of (k,v) iter.
            for (idx, k) in map.keys().iter().enumerate() {
                // SAFETY: map keys are interned config addresses; backing
                // allocation kept alive by the weak ref while in the map.
                if unsafe { (*k.0).is_same(&*new_ptr) } {
                    found_slot = Some(idx);
                    break;
                }
            }
            if let Some(idx) = found_slot {
                if let Some(existing) = map.get_index_mut(idx).unwrap().1.upgrade() {
                    // Existing config is still alive; dispose the new duplicate.
                    dispose_new = Some(new_shared);
                    SharedPtr(existing)
                } else {
                    // strong==0: existing is dying. Its `Drop` is blocked
                    // in `remove()` waiting for this mutex, so content is
                    // still intact (fields not yet freed). Replace the
                    // slot; the dying config's `remove()` will
                    // pointer-mismatch and no-op when it runs.
                    //
                    // NOTE: cannot mutate the key in-place — `ArrayHashMap`
                    // stores a parallel `hashes[idx]` derived from the key
                    // (pointer address) which `get_index_mut` does NOT
                    // refresh. Remove the stale slot and re-insert so the
                    // new pointer's hash is stored and `remove(new_ptr)`
                    // can find it later. (Zig's MapContext is content-
                    // hashed so in-place key replacement is safe there.)
                    let (_, old_weak) = map.swap_remove_at(idx);
                    dispose_old_weak = Some(old_weak);
                    map.insert(ConfigKey(new_ptr), new_shared.clone_weak());
                    new_shared
                }
            } else {
                map.insert(ConfigKey(new_ptr), new_shared.clone_weak());
                new_shared
            }
        };
        drop(dispose_old_weak);
        drop(dispose_new);
        result
    }

    /// Called from `SSLConfig::deinit()` on strong 1->0. If `intern()`
    /// replaced our slot while we blocked on the mutex, the
    /// pointer-identity check fails and we skip (intern already disposed
    /// our weak ref).
    ///
    /// No-op for configs that were never interned.
    pub(super) fn remove(config: *const SSLConfig) {
        let mut guard = CONFIGS.lock();
        let Some(map) = guard.as_mut() else { return };
        if map.is_empty() {
            return;
        }
        // Pointer-identity removal.
        map.swap_remove(&ConfigKey(config));
    }
}

pub use global_registry as GlobalRegistry;

// ported from: src/runtime/socket/SSLConfig.zig
