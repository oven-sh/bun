//! MOVE-IN: ssl_config (MOVE_DOWN bun_runtime::socket::SSLConfig → bun_http)
//! JSC-dependent constructors (from_js / from_generated / read_from_blob /
//! handle_path / handle_file*) stay in bun_runtime (tier-6, Pass C).

use core::ffi::{CStr, c_char};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use bun_uws as uws;
// Wyhash final4 variant. NOT `Wyhash11`.
use bun_threading::Guarded as Mutex;
use bun_wyhash::Wyhash;

/// Owned, NUL-terminated C-string slice. The
/// pointer is heap-owned (allocated via `dupeZ`); freed via
/// `free_sensitive` in `deinit`.
type CStrPtr = *const c_char;
/// Owned slice of owned C strings.
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
    pub crl: CStrSlice,

    pub secure_options: u32,
    pub session_timeout: i32,
    pub allow_partial_trust_chain: bool,
    pub sigalgs: CStrPtr,
    pub ecdh_curve: CStrPtr,
    /// Minimum/maximum TLS protocol version (TLS1_VERSION..TLS1_3_VERSION); 0 = unset/default.
    pub ssl_min_version: i32,
    pub ssl_max_version: i32,
    pub request_cert: i32,
    pub reject_unauthorized: i32,
    pub ssl_ciphers: CStrPtr,
    pub protos: CStrPtr,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
    pub requires_custom_request_ctx: bool,
    pub is_using_default_ciphers: bool,
    pub low_memory_mode: bool,
    /// Memoized `content_hash()`. Interior-mutable because it's lazily filled
    /// through `Arc<SSLConfig>` (shared ref) by the intern registry's hash
    /// context.
    pub cached_hash: AtomicU64,
}

/// Casing alias for callers that snake_cased the type name.
pub type SslConfig = SSLConfig;

/// Atomic shared pointer with weak support. Refcounting and allocation are
/// managed non-intrusively by `Arc`; the `SSLConfig` struct itself has no
/// refcount field.
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
        crl: None,
        secure_options: 0,
        session_timeout: 0,
        allow_partial_trust_chain: false,
        sigalgs: core::ptr::null(),
        ecdh_curve: core::ptr::null(),
        ssl_min_version: 0,
        ssl_max_version: 0,
        request_cert: 0,
        reject_unauthorized: 0,
        ssl_ciphers: core::ptr::null(),
        protos: core::ptr::null(),
        client_renegotiation_limit: 0,
        client_renegotiation_window: 0,
        requires_custom_request_ctx: false,
        is_using_default_ciphers: true,
        low_memory_mode: false,
        cached_hash: AtomicU64::new(0),
    };

    #[inline]
    pub fn zero() -> Self {
        Self::default()
    }

    /// Borrow `server_name` as a `&CStr` (None if null). Convenience accessor
    /// for callers that previously pattern-matched `Option<CString>`.
    #[inline]
    pub fn server_name_cstr(&self) -> Option<&CStr> {
        if self.server_name.is_null() {
            None
        } else {
            // SAFETY: see `cstr_bytes` invariant — heap-owned, NUL-terminated.
            Some(unsafe { CStr::from_ptr(self.server_name) })
        }
    }

    /// Borrow `server_name` as bytes (no trailing NUL). None if null.
    #[inline]
    pub fn server_name_bytes(&self) -> Option<&[u8]> {
        if self.server_name.is_null() {
            None
        } else {
            Some(cstr_bytes(self.server_name))
        }
    }

    /// Borrow `protos` as bytes (no trailing NUL). None if null.
    #[inline]
    pub fn protos_bytes(&self) -> Option<&[u8]> {
        if self.protos.is_null() {
            None
        } else {
            Some(cstr_bytes(self.protos))
        }
    }

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
        ctx_opts.ssl_min_version = self.ssl_min_version;
        ctx_opts.ssl_max_version = self.ssl_max_version;
        ctx_opts.secure_options = self.secure_options;
        ctx_opts.client_renegotiation_limit = self.client_renegotiation_limit;
        ctx_opts.client_renegotiation_window = self.client_renegotiation_window;
        ctx_opts.session_timeout = self.session_timeout;
        ctx_opts.allow_partial_trust_chain = i32::from(self.allow_partial_trust_chain);
        if !self.sigalgs.is_null() {
            ctx_opts.sigalgs = self.sigalgs;
        }
        if !self.ecdh_curve.is_null() {
            ctx_opts.ecdh_curve = self.ecdh_curve;
        }
        if let Some(crl) = &self.crl {
            ctx_opts.crl = crl.as_ptr();
            ctx_opts.crl_count = crl.len() as u32;
        }

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
        eq_slice!(crl);
        if self.secure_options != other.secure_options {
            return false;
        }
        if self.session_timeout != other.session_timeout {
            return false;
        }
        if self.allow_partial_trust_chain != other.allow_partial_trust_chain {
            return false;
        }
        eq_cstr!(sigalgs);
        eq_cstr!(ecdh_curve);
        if self.ssl_min_version != other.ssl_min_version {
            return false;
        }
        if self.ssl_max_version != other.ssl_max_version {
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

    // Takes `&self` (not `&mut`) because the intern registry calls this through
    // a pointer derived from `Arc::as_ptr`, which only grants shared provenance.
    // The memoization write goes through `AtomicU64` (interior mutability).
    pub fn content_hash(&self) -> u64 {
        let cached = self.cached_hash.load(Ordering::Relaxed);
        if cached != 0 {
            return cached;
        }
        let mut hasher = Wyhash::init(0);
        macro_rules! hash_cstr {
            ($f:ident) => {
                if !self.$f.is_null() {
                    hasher.update(cstr_bytes(self.$f));
                }
                hasher.update(&[0]);
            };
        }
        macro_rules! hash_slice {
            ($f:ident) => {
                if let Some(slice) = &self.$f {
                    for s in slice.iter() {
                        hasher.update(cstr_bytes(*s));
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
        self.cached_hash.store(hash, Ordering::Relaxed);
        hash
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
        free_strings(&mut self.crl);
        free_string(&mut self.sigalgs);
        free_string(&mut self.ecdh_curve);
        free_string(&mut self.ssl_ciphers);
        free_string(&mut self.protos);
    }

    pub fn take_protos(&mut self) -> Option<Box<[u8]>> {
        if self.protos.is_null() {
            return None;
        }
        let p = core::mem::replace(&mut self.protos, core::ptr::null());
        let bytes = cstr_bytes(p);
        // Copy rather than reuse the allocation in place:
        // `Box<[u8]>` must own a global-allocator allocation of exactly `len`
        // bytes, which the NUL-terminated `dupe_z` allocation is not.
        let owned = bytes.to_vec().into_boxed_slice();
        // SAFETY: `p` was `dupe_z`-allocated when this config was built and
        // taken (replaced with null) above — sole owner, NUL-terminated.
        unsafe { bun_core::free_sensitive(p) };
        Some(owned)
    }

    pub fn take_server_name(&mut self) -> Option<Box<[u8]>> {
        if self.server_name.is_null() {
            return None;
        }
        let p = core::mem::replace(&mut self.server_name, core::ptr::null());
        let bytes = cstr_bytes(p);
        let owned = bytes.to_vec().into_boxed_slice();
        // SAFETY: `p` was `dupe_z`-allocated when this config was built and
        // taken (replaced with null) above — sole owner, NUL-terminated.
        unsafe { bun_core::free_sensitive(p) };
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
            crl: clone_strings(&self.crl),
            secure_options: self.secure_options,
            session_timeout: self.session_timeout,
            allow_partial_trust_chain: self.allow_partial_trust_chain,
            sigalgs: clone_string(self.sigalgs),
            ecdh_curve: clone_string(self.ecdh_curve),
            ssl_min_version: self.ssl_min_version,
            ssl_max_version: self.ssl_max_version,
            request_cert: self.request_cert,
            reject_unauthorized: self.reject_unauthorized,
            ssl_ciphers: clone_string(self.ssl_ciphers),
            protos: clone_string(self.protos),
            client_renegotiation_limit: self.client_renegotiation_limit,
            client_renegotiation_window: self.client_renegotiation_window,
            requires_custom_request_ctx: self.requires_custom_request_ctx,
            is_using_default_ciphers: self.is_using_default_ciphers,
            low_memory_mode: self.low_memory_mode,
            cached_hash: AtomicU64::new(0),
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
// SAFETY: the raw-pointer fields are only read (never written) through `&self`
// and point to heap-owned immutable C strings; the sole interior-mutable field
// (`cached_hash`) is an `AtomicU64`, which is itself `Sync`.
unsafe impl Sync for SSLConfig {}

/// Borrow a non-null, heap-owned, NUL-terminated C string field as bytes.
///
/// INVARIANT: every `CStrPtr` stored on an `SSLConfig` (or in a `CStrSlice`)
/// was produced by `clone_string` / `dupe_z` / `bun_core::dupe_z` (the TLS
/// option parser) — all NUL-terminate — and remains valid for as long as the
/// owning `SSLConfig` is alive. Centralises the `unsafe { ffi::cstr(..) }`
/// upgrade so the SAFETY argument lives in one place.
#[inline]
fn cstr_bytes<'a>(p: CStrPtr) -> &'a [u8] {
    debug_assert!(!p.is_null());
    // SAFETY: see fn doc — `p` is a live, NUL-terminated, owned C string.
    unsafe { bun_core::ffi::cstr(p) }.to_bytes()
}

fn cstr_eq(a: CStrPtr, b: CStrPtr) -> bool {
    match (a.is_null(), b.is_null()) {
        (true, true) => true,
        (false, false) => bun_core::strings::eql_long(cstr_bytes(a), cstr_bytes(b), true),
        _ => false,
    }
}

fn free_strings(slice: &mut CStrSlice) {
    if let Some(inner) = slice.take() {
        for s in inner.iter() {
            // SAFETY: each entry is a `dupe_z` allocation owned by this config;
            // the slice was `take`n so this is the final owner.
            unsafe { bun_core::free_sensitive(*s) };
        }
    }
}

fn free_string(s: &mut CStrPtr) {
    if s.is_null() {
        return;
    }
    // SAFETY: `*s` is a `dupe_z` allocation owned by this config; replaced with
    // null so no alias remains.
    unsafe { bun_core::free_sensitive(core::mem::replace(s, core::ptr::null())) };
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
    bun_core::dupe_z(cstr_bytes(s))
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

    /// Called from `SSLConfig::deinit()` on strong 1->0. If `intern()` replaced
    /// our slot while we blocked on the mutex, the pointer-identity check
    /// fails and we skip (intern already disposed our weak ref).
    ///
    /// No-op for configs that were never interned.
    pub(super) fn remove(config: &SSLConfig) {
        // Read memoized hash via the atomic — never recompute here (we're
        // inside `Drop::drop`, holding `&mut SSLConfig`, and recomputation
        // would race with nothing but is wasted work for non-interned configs).
        let hash = config.cached_hash.load(Ordering::Relaxed);
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

pub use global_registry as GlobalRegistry;
