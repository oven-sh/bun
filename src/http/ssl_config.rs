//! MOVE-IN: ssl_config (MOVE_DOWN bun_runtime::socket::SSLConfig → bun_http)
//! JSC-dependent constructors (from_js / from_generated / read_from_blob /
//! handle_path / handle_file*) stay in bun_runtime (tier-6, Pass C).

use core::ffi::CStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use bun_core::{CStrRef, SensitiveCString};
use bun_uws as uws;
// Wyhash final4 variant. NOT `Wyhash11`.
use bun_threading::Guarded as Mutex;
use bun_wyhash::Wyhash;

type CStrSlice = Option<Box<[SensitiveCString]>>;

pub struct SSLConfig {
    pub server_name: Option<SensitiveCString>,

    pub key_file_name: Option<SensitiveCString>,
    pub cert_file_name: Option<SensitiveCString>,

    pub ca_file_name: Option<SensitiveCString>,
    pub dh_params_file_name: Option<SensitiveCString>,

    pub passphrase: Option<SensitiveCString>,

    pub key: CStrSlice,
    pub cert: CStrSlice,
    pub ca: CStrSlice,
    pub crl: CStrSlice,

    pub secure_options: u32,
    pub session_timeout: i32,
    pub allow_partial_trust_chain: bool,
    pub sigalgs: Option<SensitiveCString>,
    pub ecdh_curve: Option<SensitiveCString>,
    /// Minimum/maximum TLS protocol version (TLS1_VERSION..TLS1_3_VERSION); 0 = unset/default.
    pub ssl_min_version: i32,
    pub ssl_max_version: i32,
    pub request_cert: i32,
    pub reject_unauthorized: i32,
    pub ssl_ciphers: Option<SensitiveCString>,
    pub protos: Option<SensitiveCString>,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
    pub requires_custom_request_ctx: bool,
    pub is_using_default_ciphers: bool,
    pub low_memory_mode: bool,
    /// Memoized `content_hash()`. Interior-mutable because it's lazily filled
    /// through `Arc<SSLConfig>` (shared ref) by the intern registry's hash
    /// context.
    pub cached_hash: CachedHash,
}

/// Opaque, so that other crates can write an `SSLConfig` literal but not its hash.
#[derive(Default)]
pub struct CachedHash(AtomicU64);

/// Casing alias for callers that snake_cased the type name.
pub type SslConfig = SSLConfig;

/// Atomic shared pointer with weak support. Refcounting and allocation are
/// managed non-intrusively by `Arc`; the `SSLConfig` struct itself has no
/// refcount field.
#[derive(Clone)]
#[repr(transparent)]
pub struct SharedPtr(Arc<SSLConfig>);

pub(crate) type WeakPtr = Weak<SSLConfig>;

impl SharedPtr {
    #[inline]
    pub(crate) fn new(config: SSLConfig) -> Self {
        Self(Arc::new(config))
    }
    #[inline]
    pub(crate) fn get(&self) -> &SSLConfig {
        &self.0
    }
    #[inline]
    pub(crate) fn clone_weak(&self) -> WeakPtr {
        Arc::downgrade(&self.0)
    }
}

impl core::ops::Deref for SharedPtr {
    type Target = SSLConfig;
    #[inline]
    fn deref(&self) -> &SSLConfig {
        &self.0
    }
}

impl SSLConfig {
    pub(crate) const ZERO: SSLConfig = SSLConfig {
        server_name: None,
        key_file_name: None,
        cert_file_name: None,
        ca_file_name: None,
        dh_params_file_name: None,
        passphrase: None,
        key: None,
        cert: None,
        ca: None,
        crl: None,
        secure_options: 0,
        session_timeout: 0,
        allow_partial_trust_chain: false,
        sigalgs: None,
        ecdh_curve: None,
        ssl_min_version: 0,
        ssl_max_version: 0,
        request_cert: 0,
        reject_unauthorized: 0,
        ssl_ciphers: None,
        protos: None,
        client_renegotiation_limit: 0,
        client_renegotiation_window: 0,
        requires_custom_request_ctx: false,
        is_using_default_ciphers: true,
        low_memory_mode: false,
        cached_hash: CachedHash(AtomicU64::new(0)),
    };

    #[inline]
    pub fn zero() -> Self {
        Self::default()
    }

    /// What was assigned to `tls.DEFAULT_CIPHERS`, for a config without `ciphers`. It then needs a context of its own, like one with `ciphers`.
    pub fn set_default_ciphers(&mut self, ciphers: &[u8]) {
        self.ssl_ciphers = Some(SensitiveCString::new(ciphers));
        self.requires_custom_request_ctx = true;
        // An empty TLS 1.2 list would leave BoringSSL's built-in one in effect.
        if ciphers.is_empty() {
            self.ssl_min_version = self
                .ssl_min_version
                .max(i32::from(bun_boringssl_sys::TLS1_3_VERSION));
        }
    }

    #[inline]
    pub fn server_name_cstr(&self) -> Option<&CStr> {
        self.server_name.as_ref().map(SensitiveCString::as_cstr)
    }

    #[inline]
    pub fn server_name_bytes(&self) -> Option<&[u8]> {
        self.server_name.as_ref().map(SensitiveCString::as_bytes)
    }

    #[inline]
    pub fn protos_bytes(&self) -> Option<&[u8]> {
        self.protos.as_ref().map(SensitiveCString::as_bytes)
    }

    /// Extract the raw `*const SSLConfig` from an optional shared handle for
    /// pointer-equality comparison (interned configs have stable addresses).
    #[inline]
    pub(crate) fn raw_ptr<D>(maybe_shared: Option<&D>) -> Option<*const SSLConfig>
    where
        D: core::ops::Deref<Target = SSLConfig>,
    {
        maybe_shared.map(|s| &raw const **s)
    }

    pub fn as_usockets(&self) -> uws::socket_context::BunSocketContextOptions<'_> {
        uws::socket_context::BunSocketContextOptions {
            key_file_name: self.key_file_name.as_ref().map(CStrRef::from),
            cert_file_name: self.cert_file_name.as_ref().map(CStrRef::from),
            passphrase: self.passphrase.as_ref().map(CStrRef::from),
            dh_params_file_name: self.dh_params_file_name.as_ref().map(CStrRef::from),
            ca_file_name: self.ca_file_name.as_ref().map(CStrRef::from),
            ssl_ciphers: self.ssl_ciphers.as_ref().map(CStrRef::from),
            ssl_prefer_low_memory_usage: i32::from(self.low_memory_mode),
            allow_partial_trust_chain: i32::from(self.allow_partial_trust_chain),
            key: self.key.as_deref().into(),
            cert: self.cert.as_deref().into(),
            ca: self.ca.as_deref().into(),
            secure_options: self.secure_options,
            ssl_min_version: self.ssl_min_version,
            ssl_max_version: self.ssl_max_version,
            reject_unauthorized: self.reject_unauthorized,
            request_cert: self.request_cert,
            client_renegotiation_limit: self.client_renegotiation_limit,
            client_renegotiation_window: self.client_renegotiation_window,
            session_timeout: self.session_timeout,
            crl: self.crl.as_deref().into(),
            sigalgs: self.sigalgs.as_ref().map(CStrRef::from),
            ecdh_curve: self.ecdh_curve.as_ref().map(CStrRef::from),
        }
    }

    /// Returns socket options for client-side TLS with manual verification.
    /// Sets request_cert=1 (to receive server cert) and reject_unauthorized=0
    /// (to handle verification manually in handshake callback).
    pub fn as_usockets_for_client_verification(
        &self,
    ) -> uws::socket_context::BunSocketContextOptions<'_> {
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

    pub(crate) fn is_same(&self, other: &SSLConfig) -> bool {
        self.server_name == other.server_name
            && self.key_file_name == other.key_file_name
            && self.cert_file_name == other.cert_file_name
            && self.ca_file_name == other.ca_file_name
            && self.dh_params_file_name == other.dh_params_file_name
            && self.passphrase == other.passphrase
            && self.key == other.key
            && self.cert == other.cert
            && self.ca == other.ca
            && self.crl == other.crl
            && self.secure_options == other.secure_options
            && self.session_timeout == other.session_timeout
            && self.allow_partial_trust_chain == other.allow_partial_trust_chain
            && self.sigalgs == other.sigalgs
            && self.ecdh_curve == other.ecdh_curve
            && self.ssl_min_version == other.ssl_min_version
            && self.ssl_max_version == other.ssl_max_version
            && self.request_cert == other.request_cert
            && self.reject_unauthorized == other.reject_unauthorized
            && self.ssl_ciphers == other.ssl_ciphers
            && self.protos == other.protos
            && self.client_renegotiation_limit == other.client_renegotiation_limit
            && self.client_renegotiation_window == other.client_renegotiation_window
            && self.requires_custom_request_ctx == other.requires_custom_request_ctx
            && self.is_using_default_ciphers == other.is_using_default_ciphers
            && self.low_memory_mode == other.low_memory_mode
    }

    // Takes `&self` (not `&mut`) because the intern registry calls this through
    // a pointer derived from `Arc::as_ptr`, which only grants shared provenance.
    // The memoization write goes through `AtomicU64` (interior mutability).
    pub(crate) fn content_hash(&self) -> u64 {
        let cached = self.cached_hash.0.load(Ordering::Relaxed);
        if cached != 0 {
            return cached;
        }
        let mut hasher = Wyhash::init(0);
        macro_rules! hash_cstr {
            ($f:ident) => {
                if let Some(s) = &self.$f {
                    hasher.update(s.as_bytes());
                }
                hasher.update(&[0]);
            };
        }
        macro_rules! hash_slice {
            ($f:ident) => {
                if let Some(slice) = &self.$f {
                    for s in slice.iter() {
                        hasher.update(s.as_bytes());
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
        hash_slice!(crl);
        hasher.update(&self.secure_options.to_ne_bytes());
        hasher.update(&self.session_timeout.to_ne_bytes());
        hasher.update(&[self.allow_partial_trust_chain as u8]);
        hash_cstr!(sigalgs);
        hash_cstr!(ecdh_curve);
        hasher.update(&self.ssl_min_version.to_ne_bytes());
        hasher.update(&self.ssl_max_version.to_ne_bytes());
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
        let hash = if hash == 0 { 1 } else { hash };
        // Relaxed: idempotent pure cache; racing writers store the same value.
        self.cached_hash.0.store(hash, Ordering::Relaxed);
        hash
    }

    pub fn take_protos(&mut self) -> Option<Box<[u8]>> {
        Some(self.protos.take()?.as_bytes().into())
    }

    pub fn take_server_name(&mut self) -> Option<Box<[u8]>> {
        Some(self.server_name.take()?.as_bytes().into())
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
            server_name: self.server_name.clone(),
            key_file_name: self.key_file_name.clone(),
            cert_file_name: self.cert_file_name.clone(),
            ca_file_name: self.ca_file_name.clone(),
            dh_params_file_name: self.dh_params_file_name.clone(),
            passphrase: self.passphrase.clone(),
            key: self.key.clone(),
            cert: self.cert.clone(),
            ca: self.ca.clone(),
            crl: self.crl.clone(),
            secure_options: self.secure_options,
            session_timeout: self.session_timeout,
            allow_partial_trust_chain: self.allow_partial_trust_chain,
            sigalgs: self.sigalgs.clone(),
            ecdh_curve: self.ecdh_curve.clone(),
            ssl_min_version: self.ssl_min_version,
            ssl_max_version: self.ssl_max_version,
            request_cert: self.request_cert,
            reject_unauthorized: self.reject_unauthorized,
            ssl_ciphers: self.ssl_ciphers.clone(),
            protos: self.protos.clone(),
            client_renegotiation_limit: self.client_renegotiation_limit,
            client_renegotiation_window: self.client_renegotiation_window,
            requires_custom_request_ctx: self.requires_custom_request_ctx,
            is_using_default_ciphers: self.is_using_default_ciphers,
            low_memory_mode: self.low_memory_mode,
            cached_hash: CachedHash::default(),
        }
    }
}

impl Drop for SSLConfig {
    fn drop(&mut self) {
        global_registry::remove(self);
    }
}

/// Weak dedup cache. Each map entry stores a weak pointer on its key's
/// backing allocation. `upgrade()` on that weak pointer is memory-safe
/// because the weak ref keeps the allocation alive (even if strong==0 and
/// `Drop` is running on another thread). The mutex only protects map
/// structure and the invariant that entry content is intact while in the
/// map.
pub mod global_registry {
    use super::*;

    // The registry must not hash/compare by *content* through a raw-pointer
    // key: that shape is UB. When an interned `Arc`'s strong count hits
    // 0, std `Arc` materializes a `&mut SSLConfig` (via `drop_in_place`)
    // *before* `Drop::drop` reaches `remove()`'s mutex; a concurrent `intern()`
    // probing the map would then form a `&SSLConfig` to the same allocation via
    // the raw key, aliasing that live `&mut`.
    //
    // So the registry stores `(u64 content_hash, Weak)` and probes by:
    //   1. fast u64 hash filter,
    //   2. `Weak::upgrade()` (so the comparand is a fresh strong `Arc`),
    //   3. `is_same()` on the upgraded value.
    // `remove()` matches by `Weak::as_ptr` identity, never dereferencing.
    //
    // Backed by a flat `Vec` (linear scan): the number of distinct SSL configs
    // per process is tiny (typically <16) and `ArrayHashMap` is also linear
    // for `eql` collisions, so this is the same complexity class.
    static REGISTRY: Mutex<Vec<(u64, WeakPtr)>> = Mutex::new(Vec::new());

    /// Takes a by-value SSLConfig, wraps it in a `SharedPtr` (strong=1), and
    /// either returns an existing equivalent (upgraded) or the new one. Either
    /// way, caller owns exactly one strong ref on the result.
    pub fn intern(config: SSLConfig) -> SharedPtr {
        // Compute hash on the owned value *before* `Arc::new`, so the cached
        // hash is stored before any other thread can observe this config.
        let hash = config.content_hash();
        let new_shared = SharedPtr::new(config);

        // Deferred cleanup MUST run after the mutex is released (Drop re-locks
        // the registry mutex via `SSLConfig::drop -> remove`).
        let mut dispose_new: Option<SharedPtr> = None;
        let mut dispose_old_weak: Option<WeakPtr> = None;

        // Compute `result` in a block, drop
        // the guard, then dispose deferred values.
        let result = {
            let mut configs = REGISTRY.lock();

            // Probe by content hash + content equality.
            let mut found_idx: Option<usize> = None;
            for (i, (h, weak)) in configs.iter().enumerate() {
                if *h != hash {
                    continue;
                }
                if let Some(existing_shared) = weak.upgrade() {
                    if existing_shared.is_same(&new_shared) {
                        // Existing config is still alive; dispose the new
                        // duplicate (after unlock).
                        dispose_new = Some(new_shared);
                        drop(configs);
                        drop(dispose_new);
                        drop(dispose_old_weak);
                        return SharedPtr(existing_shared);
                    }
                    // Hash collision, different content — keep scanning.
                } else {
                    // strong==0: existing is dying. Its `drop()` is blocked in
                    // `remove()` waiting for this mutex, so its slot is still
                    // here. We can't `is_same()` it (would alias `&mut`), but
                    // a hash match with a dying entry is a strong hint this is
                    // the same config — replace the slot. The dying config's
                    // `remove()` will pointer-mismatch and no-op when it runs.
                    found_idx = Some(i);
                    break;
                }
            }

            if let Some(idx) = found_idx {
                dispose_old_weak = Some(core::mem::replace(
                    &mut configs[idx].1,
                    new_shared.clone_weak(),
                ));
                configs[idx].0 = hash;
            } else {
                configs.push((hash, new_shared.clone_weak()));
            }
            new_shared
        };
        // guard dropped here; now safe to drop dispose_new / dispose_old_weak.
        drop(dispose_new);
        drop(dispose_old_weak);
        result
    }

    /// Called from `SSLConfig::drop()` on strong 1->0. If `intern()` replaced
    /// our slot while we blocked on the mutex, the pointer-identity check
    /// fails and we skip (intern already disposed our weak ref).
    ///
    /// No-op for configs that were never interned.
    pub(super) fn remove(config: &SSLConfig) {
        // Read memoized hash via the atomic — never recompute here (we're
        // inside `Drop::drop`, holding `&mut SSLConfig`, and recomputation
        // would race with nothing but is wasted work for non-interned configs).
        let hash = config.cached_hash.0.load(Ordering::Relaxed);
        let self_ptr: *const SSLConfig = config;

        let mut configs = REGISTRY.lock();
        if configs.is_empty() {
            return;
        }
        // We never
        // dereference stored weaks here — only compare `Weak::as_ptr`.
        let Some(idx) = configs.iter().position(|(h, weak)| {
            // Hash filter only applies if this config was hashed (interned
            // configs always are; non-interned configs have hash==0 and won't
            // match any stored entry's nonzero hash, but check identity anyway
            // for robustness).
            (hash == 0 || *h == hash) && Weak::as_ptr(weak) == self_ptr
        }) else {
            return;
        };
        let (_, weak) = configs.swap_remove(idx);
        // Dropping the weak after unlock isn't strictly necessary (Weak::drop
        // doesn't re-enter).
        drop(configs);
        drop(weak);
    }
}
