use core::ffi::c_char;
use std::ffi::CString;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult, SysErrorJsc};
use bun_uws as uws;
use bun_wyhash::Wyhash;

use crate::node::fs as node_fs;
use crate::webcore::Blob;
use crate::webcore::blob::store::Data as StoreData;

// ──────────────────────────────────────────────────────────────────────────
// SSLConfig
// ──────────────────────────────────────────────────────────────────────────

pub struct SSLConfig {
    pub server_name: Option<CString>,

    pub key_file_name: Option<CString>,
    pub cert_file_name: Option<CString>,

    pub ca_file_name: Option<CString>,
    pub dh_params_file_name: Option<CString>,

    pub passphrase: Option<CString>,

    pub key: Option<CStringList>,
    pub cert: Option<CStringList>,
    pub ca: Option<CStringList>,

    pub secure_options: u32,
    pub request_cert: i32,
    pub reject_unauthorized: i32,
    pub ssl_ciphers: Option<CString>,
    pub protos: Option<CString>,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
    pub requires_custom_request_ctx: bool,
    pub is_using_default_ciphers: bool,
    pub low_memory_mode: bool,
    /// Memoized `content_hash()`. Interior-mutable because it's lazily filled
    /// through `Arc<SSLConfig>` (shared ref) by the intern registry's hash
    /// context. Zig used a plain `u64` mutated via `*SSLConfig` (Zig pointers
    /// freely alias); Rust needs `UnsafeCell`-backed storage here.
    pub cached_hash: AtomicU64,
}

/// Owned list of NUL-terminated strings paired with a contiguous
/// `[*const c_char]` side-buffer. The side-buffer is what uSockets'
/// `us_bun_socket_context_options_t.{key,cert,ca}` expects (a `**const char`
/// with thin-pointer stride), matching the Zig `?[][*:0]const u8` layout.
///
/// `ptrs[i]` always equals `strings[i].as_ptr()`. The pointed-to buffers are
/// the `CString` heap allocations, which are stable for the lifetime of
/// `strings` (moving a `CString` does not move its backing `Box<[u8]>`).
pub struct CStringList {
    strings: Vec<CString>,
    ptrs: Vec<*const c_char>,
}

impl CStringList {
    pub fn from_vec(strings: Vec<CString>) -> Self {
        let ptrs: Vec<*const c_char> = strings.iter().map(|s| s.as_ptr()).collect();
        Self { strings, ptrs }
    }

    #[inline]
    pub fn as_ptr_array(&self) -> *const *const c_char {
        self.ptrs.as_ptr()
    }

    #[inline]
    pub fn len(&self) -> usize {
        debug_assert_eq!(self.strings.len(), self.ptrs.len());
        self.strings.len()
    }

    #[inline]
    pub fn iter(&self) -> core::slice::Iter<'_, CString> {
        self.strings.iter()
    }
}

// SAFETY: `ptrs` only ever points into the heap allocations owned by
// `strings` in the same struct; those allocations move with the struct and
// are freed by its Drop. No shared mutable state is exposed.
unsafe impl Send for CStringList {}
unsafe impl Sync for CStringList {}

/// Atomic shared pointer with weak support. Refcounting and allocation are
/// managed non-intrusively by `Arc`; the SSLConfig struct itself has no
/// refcount field.
pub type SharedPtr = Arc<SSLConfig>;

type WeakPtr = Weak<SSLConfig>;

impl SSLConfig {
    /// Extract the raw `*const SSLConfig` from an optional SharedPtr for
    /// pointer-equality comparison (interned configs have stable addresses).
    #[inline]
    pub fn raw_ptr(maybe_shared: Option<&SharedPtr>) -> Option<*const SSLConfig> {
        maybe_shared.map(|s| Arc::as_ptr(s))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFromBlobError
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: cannot derive `thiserror::Error` because `JsError` is not
// `std::error::Error`/`Display`. Manual `From<JsError>` instead.
#[derive(Debug)]
pub enum ReadFromBlobError {
    Js(JsError),
    NullStore,
    NotAFile,
    EmptyFile,
}

impl From<JsError> for ReadFromBlobError {
    #[inline]
    fn from(e: JsError) -> Self {
        ReadFromBlobError::Js(e)
    }
}

/// Convert a `ZBox` (NUL-terminated owned byte buffer) into a `CString`
/// without re-allocating. Matches Zig `toOwnedSliceZ` semantics (no
/// interior-NUL check).
#[inline]
fn zbox_into_cstring(z: bun_core::ZBox) -> CString {
    // SAFETY: `ZBox` guarantees a single trailing NUL; we hand the bytes
    // (including the sentinel) to `CString` without re-allocating.
    unsafe { CString::from_vec_with_nul_unchecked(z.into_vec_with_nul()) }
}

fn read_from_blob(
    global: &JSGlobalObject,
    blob: &Blob,
) -> Result<CString, ReadFromBlobError> {
    let store = blob.store.as_ref().ok_or(ReadFromBlobError::NullStore)?;
    let file = match &store.data {
        StoreData::File(f) => f,
        _ => return Err(ReadFromBlobError::NotAFile),
    };
    let mut fs = node_fs::NodeFS::default();
    let read_args = node_fs::args::ReadFile {
        path: file.pathlike.clone(),
        ..Default::default()
    };
    let maybe = fs.read_file_with_options(
        &read_args,
        node_fs::Flavor::Sync,
        node_fs::ReadFileStringType::NullTerminated,
    );
    let result = match maybe {
        Ok(result) => result,
        Err(err) => {
            return Err(global.throw_value(err.to_js(global)).into());
        }
    };
    // `read_file_with_options(NullTerminated)` transfers ownership of the
    // returned buffer to the caller, so we can return it directly without
    // duplicating.
    let node_fs::ret::ReadFileWithOptions::NullTerminated(zbox) = result else {
        unreachable!("ReadFileStringType::NullTerminated always yields the NullTerminated variant");
    };
    if zbox.is_empty() {
        return Err(ReadFromBlobError::EmptyFile);
    }
    Ok(zbox_into_cstring(zbox))
}

// ──────────────────────────────────────────────────────────────────────────
// asUSockets / forClientVerification
// ──────────────────────────────────────────────────────────────────────────

impl SSLConfig {
    pub fn as_usockets(&self) -> uws::SocketContext::BunSocketContextOptions {
        let mut ctx_opts = uws::SocketContext::BunSocketContextOptions::default();

        if let Some(v) = &self.key_file_name {
            ctx_opts.key_file_name = v.as_ptr();
        }
        if let Some(v) = &self.cert_file_name {
            ctx_opts.cert_file_name = v.as_ptr();
        }
        if let Some(v) = &self.ca_file_name {
            ctx_opts.ca_file_name = v.as_ptr();
        }
        if let Some(v) = &self.dh_params_file_name {
            ctx_opts.dh_params_file_name = v.as_ptr();
        }
        if let Some(v) = &self.passphrase {
            ctx_opts.passphrase = v.as_ptr();
        }
        ctx_opts.ssl_prefer_low_memory_usage = self.low_memory_mode as core::ffi::c_int;

        if let Some(key) = &self.key {
            ctx_opts.key = key.as_ptr_array();
            ctx_opts.key_count = u32::try_from(key.len()).unwrap();
        }
        if let Some(cert) = &self.cert {
            ctx_opts.cert = cert.as_ptr_array();
            ctx_opts.cert_count = u32::try_from(cert.len()).unwrap();
        }
        if let Some(ca) = &self.ca {
            ctx_opts.ca = ca.as_ptr_array();
            ctx_opts.ca_count = u32::try_from(ca.len()).unwrap();
        }

        if let Some(v) = &self.ssl_ciphers {
            ctx_opts.ssl_ciphers = v.as_ptr();
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
    ) -> uws::SocketContext::BunSocketContextOptions {
        let mut opts = self.as_usockets();
        opts.request_cert = 1;
        opts.reject_unauthorized = 0;
        opts
    }

    /// Returns a copy of this config for client-side TLS with manual verification.
    /// Sets request_cert=1 (to receive server cert) and reject_unauthorized=0
    /// (to handle verification manually in handshake callback).
    // PORT NOTE: reshaped for borrowck — Zig took `this: SSLConfig` by value
    // (shallow bitwise copy of raw pointers). With owned CString fields that
    // would be a double-free, so we take &self and deep-clone.
    pub fn for_client_verification(&self) -> SSLConfig {
        let mut copy = self.clone();
        copy.request_cert = 1;
        copy.reject_unauthorized = 0;
        copy
    }
}

// ──────────────────────────────────────────────────────────────────────────
// isSame / stringsEqual
// ──────────────────────────────────────────────────────────────────────────

impl SSLConfig {
    // PORT NOTE: Zig used `inline for (std.meta.fields(SSLConfig))` reflection.
    // Rust has no field reflection; expanded by hand. Keep field order in sync
    // with the struct definition above.
    pub fn is_same(&self, other: &SSLConfig) -> bool {
        opt_str_eq(&self.server_name, &other.server_name)
            && opt_str_eq(&self.key_file_name, &other.key_file_name)
            && opt_str_eq(&self.cert_file_name, &other.cert_file_name)
            && opt_str_eq(&self.ca_file_name, &other.ca_file_name)
            && opt_str_eq(&self.dh_params_file_name, &other.dh_params_file_name)
            && opt_str_eq(&self.passphrase, &other.passphrase)
            && opt_strs_eq(&self.key, &other.key)
            && opt_strs_eq(&self.cert, &other.cert)
            && opt_strs_eq(&self.ca, &other.ca)
            && self.secure_options == other.secure_options
            && self.request_cert == other.request_cert
            && self.reject_unauthorized == other.reject_unauthorized
            && opt_str_eq(&self.ssl_ciphers, &other.ssl_ciphers)
            && opt_str_eq(&self.protos, &other.protos)
            && self.client_renegotiation_limit == other.client_renegotiation_limit
            && self.client_renegotiation_window == other.client_renegotiation_window
            && self.requires_custom_request_ctx == other.requires_custom_request_ctx
            && self.is_using_default_ciphers == other.is_using_default_ciphers
            && self.low_memory_mode == other.low_memory_mode
        // cached_hash intentionally skipped
    }
}

fn opt_str_eq(first: &Option<CString>, second: &Option<CString>) -> bool {
    match (first, second) {
        (Some(a), Some(b)) => strings_equal(a, b),
        (None, None) => true,
        _ => false,
    }
}

fn opt_strs_eq(first: &Option<CStringList>, second: &Option<CStringList>) -> bool {
    match (first, second) {
        (Some(slice1), Some(slice2)) => {
            if slice1.len() != slice2.len() {
                return false;
            }
            debug_assert_eq!(slice1.len(), slice2.len());
            for (a, b) in slice1.iter().zip(slice2.iter()) {
                if !strings_equal(a, b) {
                    return false;
                }
            }
            true
        }
        (None, None) => true,
        _ => false,
    }
}

fn strings_equal(a: &CString, b: &CString) -> bool {
    let lhs = a.as_bytes();
    let rhs = b.as_bytes();
    bun_str::strings::eql_long(lhs, rhs, true)
}

// ──────────────────────────────────────────────────────────────────────────
// freeStrings / freeString / Drop
// ──────────────────────────────────────────────────────────────────────────

/// Port of `bun.freeSensitive` for owned NUL-terminated byte buffers.
/// Zeros the allocation before freeing (defence-in-depth for keys/passphrases).
// PORT NOTE: `bun_core::free_sensitive` only handles libc-malloc'd `*const c_char`;
// our fields are Rust-allocated `CString`, so we zero in-place and let Drop free.
fn free_sensitive_bytes(mut bytes: Vec<u8>) {
    for b in bytes.iter_mut() {
        // SAFETY: writing 0 into a byte we exclusively own.
        unsafe { core::ptr::write_volatile(b, 0) };
    }
    drop(bytes);
}

fn free_strings(slice: &mut Option<CStringList>) {
    let Some(inner) = slice.take() else { return };
    let CStringList { strings, ptrs } = inner;
    drop(ptrs);
    for string in strings {
        free_sensitive_bytes(string.into_bytes_with_nul());
    }
    // outer Vecs freed by drop
}

fn free_string(string: &mut Option<CString>) {
    let Some(inner) = string.take() else { return };
    free_sensitive_bytes(inner.into_bytes_with_nul());
}

/// Destructor. Called by `Arc` on strong 1->0 for interned configs, and
/// directly on value-type configs (e.g. `ServerConfig.ssl_config`).
///
/// For interned configs, we MUST remove from the registry before freeing the
/// string fields, since concurrent `intern()` calls may read those fields for
/// content comparison while we're still in the map. For non-interned configs,
/// `remove()` is a cheap no-op (pointer-identity check fails).
impl Drop for SSLConfig {
    fn drop(&mut self) {
        GlobalRegistry::remove(self);
        // PORT NOTE: Zig used `bun.meta.useAllFields` to enforce exhaustiveness.
        // Keep this list in sync with the struct definition.
        free_string(&mut self.server_name);
        free_string(&mut self.key_file_name);
        free_string(&mut self.cert_file_name);
        free_string(&mut self.ca_file_name);
        free_string(&mut self.dh_params_file_name);
        free_string(&mut self.passphrase);
        free_strings(&mut self.key);
        free_strings(&mut self.cert);
        free_strings(&mut self.ca);
        // secure_options: no-op
        // request_cert: no-op
        // reject_unauthorized: no-op
        free_string(&mut self.ssl_ciphers);
        free_string(&mut self.protos);
        // client_renegotiation_limit: no-op
        // client_renegotiation_window: no-op
        // requires_custom_request_ctx: no-op
        // is_using_default_ciphers: no-op
        // low_memory_mode: no-op
        // cached_hash: no-op
    }
}

// ──────────────────────────────────────────────────────────────────────────
// clone
// ──────────────────────────────────────────────────────────────────────────

fn clone_strings(slice: &Option<CStringList>) -> Option<CStringList> {
    let inner = slice.as_ref()?;
    let mut result = Vec::with_capacity(inner.len());
    for string in inner.iter() {
        result.push(string.clone());
    }
    Some(CStringList::from_vec(result))
}

fn clone_string(string: &Option<CString>) -> Option<CString> {
    string.clone()
}

impl Clone for SSLConfig {
    fn clone(&self) -> SSLConfig {
        SSLConfig {
            server_name: clone_string(&self.server_name),
            key_file_name: clone_string(&self.key_file_name),
            cert_file_name: clone_string(&self.cert_file_name),
            ca_file_name: clone_string(&self.ca_file_name),
            dh_params_file_name: clone_string(&self.dh_params_file_name),
            passphrase: clone_string(&self.passphrase),
            key: clone_strings(&self.key),
            cert: clone_strings(&self.cert),
            ca: clone_strings(&self.ca),
            secure_options: self.secure_options,
            request_cert: self.request_cert,
            reject_unauthorized: self.reject_unauthorized,
            ssl_ciphers: clone_string(&self.ssl_ciphers),
            protos: clone_string(&self.protos),
            client_renegotiation_limit: self.client_renegotiation_limit,
            client_renegotiation_window: self.client_renegotiation_window,
            requires_custom_request_ctx: self.requires_custom_request_ctx,
            is_using_default_ciphers: self.is_using_default_ciphers,
            low_memory_mode: self.low_memory_mode,
            cached_hash: AtomicU64::new(0),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// into_http — bridge to lower-tier `bun_http::ssl_config::SSLConfig`
// ──────────────────────────────────────────────────────────────────────────

impl SSLConfig {
    /// Deep-copy into the lower-tier `bun_http::ssl_config::SSLConfig` shape.
    /// `bun_http` cannot name this T6 type (cycle), and `from_js` lives here
    /// (it walks a `JSValue`), so callers that need an interned `bun_http`
    /// `SharedPtr` (e.g. `fetch()` → `AsyncHTTP`) convert at the boundary.
    pub fn into_http(self) -> bun_http::ssl_config::SSLConfig {
        // Disarm Drop: `self`'s fields are deep-copied via `dupe_z`, so the
        // originals must still drop normally — but we want a single
        // `GlobalRegistry::remove` call (on the source), not on a half-built
        // http config. The http config gets fresh allocations.
        fn dz(s: &Option<CString>) -> *const c_char {
            s.as_ref()
                .map(|c| bun_core::dupe_z(c.as_bytes()))
                .unwrap_or(core::ptr::null())
        }
        fn dzs(l: &Option<CStringList>) -> Option<Box<[*const c_char]>> {
            l.as_ref().map(|list| {
                list.iter()
                    .map(|c| bun_core::dupe_z(c.as_bytes()))
                    .collect::<Vec<_>>()
                    .into_boxed_slice()
            })
        }
        bun_http::ssl_config::SSLConfig {
            server_name: dz(&self.server_name),
            key_file_name: dz(&self.key_file_name),
            cert_file_name: dz(&self.cert_file_name),
            ca_file_name: dz(&self.ca_file_name),
            dh_params_file_name: dz(&self.dh_params_file_name),
            passphrase: dz(&self.passphrase),
            key: dzs(&self.key),
            cert: dzs(&self.cert),
            ca: dzs(&self.ca),
            secure_options: self.secure_options,
            request_cert: self.request_cert,
            reject_unauthorized: self.reject_unauthorized,
            ssl_ciphers: dz(&self.ssl_ciphers),
            protos: dz(&self.protos),
            client_renegotiation_limit: self.client_renegotiation_limit,
            client_renegotiation_window: self.client_renegotiation_window,
            requires_custom_request_ctx: self.requires_custom_request_ctx,
            is_using_default_ciphers: self.is_using_default_ciphers,
            low_memory_mode: self.low_memory_mode,
            cached_hash: 0,
        }
        // `self` drops here, freeing the original `CString`s and removing from
        // the runtime-tier `GlobalRegistry`.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// contentHash
// ──────────────────────────────────────────────────────────────────────────

impl SSLConfig {
    // PORT NOTE: Zig used `inline for (std.meta.fields(SSLConfig))` reflection.
    // Expanded by hand; keep field order in sync with struct definition.
    //
    // Takes `&self` (not `&mut`) because the intern registry calls this through
    // a pointer derived from `Arc::as_ptr`, which only grants shared provenance.
    // The memoization write goes through `AtomicU64` (interior mutability).
    pub fn content_hash(&self) -> u64 {
        let cached = self.cached_hash.load(Ordering::Relaxed);
        if cached != 0 {
            return cached;
        }
        // Zig: `std.hash.Wyhash` (final4 variant). NOT `Wyhash11`.
        let mut hasher = Wyhash::init(0);

        hash_opt_str(&mut hasher, &self.server_name);
        hash_opt_str(&mut hasher, &self.key_file_name);
        hash_opt_str(&mut hasher, &self.cert_file_name);
        hash_opt_str(&mut hasher, &self.ca_file_name);
        hash_opt_str(&mut hasher, &self.dh_params_file_name);
        hash_opt_str(&mut hasher, &self.passphrase);
        hash_opt_strs(&mut hasher, &self.key);
        hash_opt_strs(&mut hasher, &self.cert);
        hash_opt_strs(&mut hasher, &self.ca);
        hash_scalar(&mut hasher, &self.secure_options);
        hash_scalar(&mut hasher, &self.request_cert);
        hash_scalar(&mut hasher, &self.reject_unauthorized);
        hash_opt_str(&mut hasher, &self.ssl_ciphers);
        hash_opt_str(&mut hasher, &self.protos);
        hash_scalar(&mut hasher, &self.client_renegotiation_limit);
        hash_scalar(&mut hasher, &self.client_renegotiation_window);
        hash_scalar(&mut hasher, &self.requires_custom_request_ctx);
        hash_scalar(&mut hasher, &self.is_using_default_ciphers);
        hash_scalar(&mut hasher, &self.low_memory_mode);
        // cached_hash intentionally skipped

        let hash = hasher.final_();
        // Avoid 0 since it's the sentinel for "not computed"
        let hash = if hash == 0 { 1 } else { hash };
        // Relaxed: idempotent pure cache; racing writers store the same value.
        self.cached_hash.store(hash, Ordering::Relaxed);
        hash
    }
}

fn hash_opt_str(hasher: &mut Wyhash, value: &Option<CString>) {
    if let Some(s) = value {
        hasher.update(s.as_bytes());
    }
    hasher.update(&[0]);
}

fn hash_opt_strs(hasher: &mut Wyhash, value: &Option<CStringList>) {
    if let Some(slice) = value {
        for s in slice.iter() {
            hasher.update(s.as_bytes());
            hasher.update(&[0]);
        }
    }
    hasher.update(&[0]);
}

fn hash_scalar<T: Copy>(hasher: &mut Wyhash, value: &T) {
    // SAFETY: T is Copy/POD; reading its raw bytes is sound (matches Zig
    // `std.mem.asBytes(&value)`).
    let bytes = unsafe {
        core::slice::from_raw_parts(
            (value as *const T) as *const u8,
            core::mem::size_of::<T>(),
        )
    };
    hasher.update(bytes);
}

// ──────────────────────────────────────────────────────────────────────────
// GlobalRegistry
// ──────────────────────────────────────────────────────────────────────────

/// Weak dedup cache. Each map entry stores a weak pointer on its key's
/// backing allocation. `upgrade()` on that weak pointer is memory-safe
/// because the weak ref keeps the allocation alive (even if strong==0 and
/// `drop()` is running on another thread). The mutex only protects map
/// structure and the invariant that entry content is intact while in the map.
#[allow(non_snake_case)]
pub mod GlobalRegistry {
    use super::*;

    // PORT NOTE: Zig used `ArrayHashMapUnmanaged<*SSLConfig, WeakPtr, MapContext>`
    // where `MapContext` hashes/compares by *content* through the raw-pointer
    // key. That shape is UB in Rust: when an interned `Arc`'s strong count hits
    // 0, std `Arc` materializes a `&mut SSLConfig` (via `drop_in_place`)
    // *before* `Drop::drop` reaches `remove()`'s mutex; a concurrent `intern()`
    // probing the map would then form a `&SSLConfig` to the same allocation via
    // the raw key, aliasing that live `&mut`. Zig's model tolerates
    // read-while-deinit-blocked (.zig:336-341/.zig:356); Rust's does not.
    //
    // The Rust shape stores `(u64 content_hash, Weak)` and probes by:
    //   1. fast u64 hash filter,
    //   2. `Weak::upgrade()` (so the comparand is a fresh strong `Arc`),
    //   3. `is_same()` on the upgraded value.
    // `remove()` matches by `Weak::as_ptr` identity, never dereferencing.
    //
    // Backed by a flat `Vec` (linear scan): the number of distinct SSL configs
    // per process is tiny (typically <16) and `ArrayHashMap` is also linear
    // for `eql` collisions, so this is the same complexity class.
    // PERF(port): was ArrayHashMapUnmanaged — profile in Phase B.
    static REGISTRY: parking_lot::Mutex<Vec<(u64, WeakPtr)>> =
        parking_lot::Mutex::new(Vec::new());

    /// Takes a by-value SSLConfig, wraps it in a `SharedPtr` (strong=1), and
    /// either returns an existing equivalent (upgraded) or the new one. Either
    /// way, caller owns exactly one strong ref on the result.
    ///
    /// The returned `SharedPtr` is dropped normally.
    pub fn intern(config: SSLConfig) -> SharedPtr {
        // Compute hash on the owned value *before* `Arc::new`, so the cached
        // hash is stored before any other thread can observe this config.
        let hash = config.content_hash();
        let new_shared: SharedPtr = Arc::new(config);

        // Deferred cleanup MUST run after the mutex is released (Drop re-locks
        // the registry mutex via `SSLConfig::drop -> remove`).
        let mut dispose_new: Option<SharedPtr> = None;
        let mut dispose_old_weak: Option<WeakPtr> = None;

        // PORT NOTE: reshaped for borrowck — Zig returned directly while holding
        // the mutex, then ran `defer`s. We compute `result` in a block, drop
        // the guard, then dispose deferred values.
        let result = {
            let mut configs = REGISTRY.lock();

            // Zig: `getOrPutContext` — probe by content hash + content equality.
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
                        return existing_shared;
                    }
                    // Hash collision, different content — keep scanning.
                } else if Weak::as_ptr(weak) as *const () != core::ptr::null() {
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
                    Arc::downgrade(&new_shared),
                ));
                configs[idx].0 = hash;
            } else {
                configs.push((hash, Arc::downgrade(&new_shared)));
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
        let hash = config.cached_hash.load(Ordering::Relaxed);
        let self_ptr: *const SSLConfig = config;

        let mut configs = REGISTRY.lock();
        if configs.is_empty() {
            return;
        }
        // Zig: `getIndexContext` then pointer-identity check. We never
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
        // Drop the weak after unlock isn't strictly necessary (Weak::drop
        // doesn't re-enter), but matches Zig ordering.
        drop(configs);
        drop(weak);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Default / zero
// ──────────────────────────────────────────────────────────────────────────

impl Default for SSLConfig {
    fn default() -> Self {
        SSLConfig {
            server_name: None,
            key_file_name: None,
            cert_file_name: None,
            ca_file_name: None,
            dh_params_file_name: None,
            passphrase: None,
            key: None,
            cert: None,
            ca: None,
            secure_options: 0,
            request_cert: 0,
            reject_unauthorized: 0,
            ssl_ciphers: None,
            protos: None,
            client_renegotiation_limit: 0,
            client_renegotiation_window: 0,
            requires_custom_request_ctx: false,
            is_using_default_ciphers: true,
            low_memory_mode: false,
            cached_hash: AtomicU64::new(0),
        }
    }
}

impl SSLConfig {
    #[inline]
    pub fn zero() -> Self {
        Self::default()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// fromJS / fromGenerated
// ──────────────────────────────────────────────────────────────────────────

/// Convert a `ZBox` (NUL-terminated owned byte buffer) into a `CString`
/// without re-allocating. Matches Zig `toOwnedSliceZ` semantics (no
/// interior-NUL check).
#[inline]
fn zbox_into_cstring(z: bun_core::ZBox) -> CString {
    // SAFETY: `ZBox` guarantees a single trailing NUL; we hand the bytes
    // (including the sentinel) to `CString` without re-allocating. Zig
    // `toOwnedSliceZ` performs no interior-NUL check.
    unsafe { CString::from_vec_with_nul_unchecked(z.into_vec_with_nul()) }
}

// ── ReadFromBlobError ────────────────────────────────────────────────────
// PORT NOTE: cannot derive `thiserror::Error` because `JsError` is not
// `std::error::Error`/`Display`. Manual `From<JsError>` instead.
#[derive(Debug, strum::IntoStaticStr)]
pub enum ReadFromBlobError {
    Js(JsError),
    NullStore,
    NotAFile,
    EmptyFile,
}

impl From<JsError> for ReadFromBlobError {
    #[inline]
    fn from(e: JsError) -> Self {
        ReadFromBlobError::Js(e)
    }
}

fn read_from_blob(
    global: &JSGlobalObject,
    blob: &mut crate::webcore::Blob,
) -> Result<CString, ReadFromBlobError> {
    let store = blob.store.as_ref().ok_or(ReadFromBlobError::NullStore)?;
    let file = match &store.data {
        crate::webcore::blob::store::Data::File(f) => f,
        _ => return Err(ReadFromBlobError::NotAFile),
    };
    let mut fs = crate::node::fs::NodeFS::default();
    let read_args = crate::node::fs::args::ReadFile {
        // PORT NOTE: Zig copied `file.pathlike` by value into the args struct;
        // `PathOrFileDescriptor: Clone` now exists, so deep-clone.
        path: file.pathlike.clone(),
        ..Default::default()
    };
    let maybe = fs.read_file_with_options(
        &read_args,
        crate::node::fs::Flavor::Sync,
        crate::node::fs::ReadFileStringType::NullTerminated,
    );
    let result = match maybe {
        Ok(result) => result,
        Err(err) => {
            return Err(global.throw_value(err.to_js(global)).into());
        }
    };
    // `read_file_with_options(NullTerminated)` transfers ownership of the
    // returned buffer to the caller, so we can return it directly without
    // duplicating.
    let crate::node::fs::ret::ReadFileWithOptions::NullTerminated(zbox) = result else {
        unreachable!("ReadFileStringType::NullTerminated always yields the NullTerminated variant");
    };
    if zbox.is_empty() {
        return Err(ReadFromBlobError::EmptyFile);
    }
    Ok(zbox_into_cstring(zbox))
}

impl SSLConfig {
    pub fn from_js(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<SSLConfig>> {
        let generated = jsc::generated::SSLConfig::from_js(global, value)?;
        // `generated` dropped at scope exit
        Self::from_generated(vm, global, &generated)
    }

    pub fn from_generated(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        generated: &jsc::generated::SSLConfig,
    ) -> JsResult<Option<SSLConfig>> {
        let mut result = SSLConfig::zero();
        // errdefer result.deinit() — handled by Drop on error-path `?`
        let mut any = false;

        if let Some(passphrase) = generated.passphrase.get() {
            result.passphrase = Some(zbox_into_cstring(passphrase.to_owned_slice_z()));
            any = true;
        }
        if let Some(dh_params_file) = generated.dh_params_file.get() {
            result.dh_params_file_name = Some(handle_path(global, "dhParamsFile", &dh_params_file)?);
            any = true;
        }
        if let Some(server_name) = generated.server_name.get() {
            result.server_name = Some(zbox_into_cstring(server_name.to_owned_slice_z()));
            result.requires_custom_request_ctx = true;
        }

        result.low_memory_mode = generated.low_memory_mode;
        result.reject_unauthorized = generated
            .reject_unauthorized
            .unwrap_or_else(|| vm.get_tls_reject_unauthorized())
            as i32;
        result.request_cert = generated.request_cert as i32;
        result.secure_options = generated.secure_options;
        any = any
            || result.low_memory_mode
            || generated.reject_unauthorized.is_some()
            || generated.request_cert
            || result.secure_options != 0;

        result.ca = handle_file_for_field(global, "ca", &generated.ca)?.map(CStringList::from_vec);
        result.cert = handle_file_for_field(global, "cert", &generated.cert)?.map(CStringList::from_vec);
        result.key = handle_file_for_field(global, "key", &generated.key)?.map(CStringList::from_vec);
        result.requires_custom_request_ctx = result.requires_custom_request_ctx
            || result.ca.is_some()
            || result.cert.is_some()
            || result.key.is_some();

        if let Some(key_file) = generated.key_file.get() {
            result.key_file_name = Some(handle_path(global, "keyFile", &key_file)?);
            result.requires_custom_request_ctx = true;
        }
        if let Some(cert_file) = generated.cert_file.get() {
            result.cert_file_name = Some(handle_path(global, "certFile", &cert_file)?);
            result.requires_custom_request_ctx = true;
        }
        if let Some(ca_file) = generated.ca_file.get() {
            result.ca_file_name = Some(handle_path(global, "caFile", &ca_file)?);
            result.requires_custom_request_ctx = true;
        }

        let protocols: Option<CString> = match &generated.alpn_protocols {
            jsc::generated::SSLConfigAlpnProtocols::None => None,
            jsc::generated::SSLConfigAlpnProtocols::String(val) => {
                Some(zbox_into_cstring(val.get().to_owned_slice_z()))
            }
            jsc::generated::SSLConfigAlpnProtocols::Buffer(val) => {
                // SAFETY: `val.get()` returns a non-null `*mut JSCArrayBuffer`
                // owned by the GenVal for the duration of `generated`.
                let buffer: jsc::ArrayBuffer = unsafe { (*val.get()).as_array_buffer() };
                let mut v = buffer.byte_slice().to_vec();
                v.push(0);
                // SAFETY: we just appended the only NUL we rely on; matches Zig
                // `dupeZ` (no interior-NUL check).
                Some(unsafe { CString::from_vec_with_nul_unchecked(v) })
            }
        };
        if let Some(some_protocols) = protocols {
            result.protos = Some(some_protocols);
            result.requires_custom_request_ctx = true;
        }
        if let Some(ciphers) = generated.ciphers.get() {
            result.ssl_ciphers = Some(zbox_into_cstring(ciphers.to_owned_slice_z()));
            result.is_using_default_ciphers = false;
            result.requires_custom_request_ctx = true;
        }

        result.client_renegotiation_limit = generated.client_renegotiation_limit;
        result.client_renegotiation_window = generated.client_renegotiation_window;
        any = any
            || result.requires_custom_request_ctx
            || result.client_renegotiation_limit != 0
            || generated.client_renegotiation_window != 0;

        // We don't need to deinit `result` if `any` is false.
        if any { Ok(Some(result)) } else { Ok(None) }
    }
}

// ── handlePath / handleFile helpers ──────────────────────────────────

// PERF(port): was comptime monomorphization (comptime field: []const u8) —
// demoted to runtime &'static str since only used in cold error message.
fn handle_path(
    global: &JSGlobalObject,
    field: &'static str,
    string: &bun_str::String,
) -> JsResult<CString> {
    let name = string.to_owned_slice_z();
    // Zig: `std.posix.system.access(name, F_OK) != 0`.
    // TODO(port): Windows — Zig path goes through `std.posix.system.access`,
    // which on Windows shells out to `_waccess`; route through `bun_sys` once a
    // cross-platform `access(ZStr, F_OK)` lands there.
    // SAFETY: `name` is a valid NUL-terminated buffer; access(2) only reads it.
    if unsafe { libc::access(name.as_ptr(), libc::F_OK) } != 0 {
        // errdefer: free_sensitive(name) — zero before drop.
        free_sensitive_bytes(name.into_vec_with_nul());
        return Err(global.throw_invalid_arguments(
            format_args!("Unable to access {} path", field),
        ));
    }
    Ok(zbox_into_cstring(name))
}

fn handle_file_for_field(
    global: &JSGlobalObject,
    field: &'static str,
    file: &jsc::generated::SSLConfigFile,
) -> JsResult<Option<Vec<CString>>> {
    match handle_file(global, file) {
        Ok(v) => Ok(v),
        Err(ReadFromBlobError::Js(e)) => Err(e),
        Err(ReadFromBlobError::EmptyFile) => Err(global.throw_invalid_arguments(
            format_args!("TLSOptions.{} is an empty file", field),
        )),
        Err(ReadFromBlobError::NullStore) | Err(ReadFromBlobError::NotAFile) => {
            Err(global.throw_invalid_arguments(
                format_args!(
                    "TLSOptions.{} is not a valid BunFile (non-BunFile `Blob`s are not supported)",
                    field
                ),
            ))
        }
    }
}

fn handle_file(
    global: &JSGlobalObject,
    file: &jsc::generated::SSLConfigFile,
) -> Result<Option<Vec<CString>>, ReadFromBlobError> {
    let single = handle_single_file(
        global,
        match file {
            jsc::generated::SSLConfigFile::None => return Ok(None),
            jsc::generated::SSLConfigFile::String(val) => SingleFile::String(val.get()),
            // SAFETY: GenVal::get() yields a non-null pointer valid for the
            // lifetime of `generated`; we narrow it to `&mut` for the call.
            jsc::generated::SSLConfigFile::Buffer(val) => {
                SingleFile::Buffer(unsafe { &mut *val.get() })
            }
            // SAFETY: opaque `GenBlob` (`*mut c_void`) is the JS class `m_ctx`
            // pointer, layout-identical to `crate::webcore::Blob`.
            jsc::generated::SSLConfigFile::File(val) => {
                SingleFile::File(unsafe { &mut *(val.get() as *mut crate::webcore::Blob) })
            }
            jsc::generated::SSLConfigFile::Array(list) => {
                return handle_file_array(global, list.items());
            }
        },
    )?;
    // errdefer free_sensitive(single) — on the only fallible op below (alloc),
    // Rust aborts on OOM, so no errdefer needed.
    let mut result = Vec::with_capacity(1);
    result.push(single);
    Ok(Some(result))
}

fn handle_file_array(
    global: &JSGlobalObject,
    elements: &[jsc::generated::SSLConfigSingleFile],
) -> Result<Option<Vec<CString>>, ReadFromBlobError> {
    if elements.is_empty() {
        return Ok(None);
    }
    let mut result: Vec<CString> = Vec::with_capacity(elements.len());
    // errdefer { free_sensitive each; drop result } — need zeroing on error:
    let mut guard = scopeguard::guard(&mut result, |r| {
        for string in r.drain(..) {
            free_sensitive_bytes(string.into_bytes_with_nul());
        }
    });
    for elem in elements {
        // PERF(port): was appendAssumeCapacity
        guard.push(handle_single_file(
            global,
            match elem {
                jsc::generated::SSLConfigSingleFile::String(val) => SingleFile::String(val.get()),
                // SAFETY: see `handle_file` above — non-null GenVal pointers
                // valid for the lifetime of `generated`.
                jsc::generated::SSLConfigSingleFile::Buffer(val) => {
                    SingleFile::Buffer(unsafe { &mut *val.get() })
                }
                // SAFETY: opaque `GenBlob` (`*mut c_void`) is layout-identical
                // to `crate::webcore::Blob`.
                jsc::generated::SSLConfigSingleFile::File(val) => {
                    SingleFile::File(unsafe { &mut *(val.get() as *mut crate::webcore::Blob) })
                }
            },
        )?);
    }
    let result = scopeguard::ScopeGuard::into_inner(guard);
    Ok(Some(core::mem::take(result)))
}

// PORT NOTE: Zig used an anonymous `union(enum)` param; named here.
enum SingleFile<'a> {
    String(bun_str::String),
    Buffer(&'a mut jsc::JSCArrayBuffer),
    File(&'a mut crate::webcore::Blob),
}

fn handle_single_file(
    global: &JSGlobalObject,
    file: SingleFile<'_>,
) -> Result<CString, ReadFromBlobError> {
    match file {
        SingleFile::String(string) => Ok(zbox_into_cstring(string.to_owned_slice_z())),
        SingleFile::Buffer(jsc_buffer) => {
            let buffer: jsc::ArrayBuffer = jsc_buffer.as_array_buffer();
            let mut v = buffer.byte_slice().to_vec();
            v.push(0);
            // SAFETY: we just appended the only NUL we rely on; matches Zig
            // `dupeZ` (no interior-NUL check).
            Ok(unsafe { CString::from_vec_with_nul_unchecked(v) })
        }
        SingleFile::File(blob) => read_from_blob(global, blob),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// takeProtos / takeServerName
// ──────────────────────────────────────────────────────────────────────────

impl SSLConfig {
    pub fn take_protos(&mut self) -> Option<Box<[u8]>> {
        let protos = self.protos.take()?;
        // bun.memory.dropSentinel: convert NUL-terminated owned buffer to a
        // plain owned slice (drops the trailing NUL).
        Some(protos.into_bytes().into_boxed_slice())
    }

    pub fn take_server_name(&mut self) -> Option<Box<[u8]>> {
        let server_name = self.server_name.take()?;
        Some(server_name.into_bytes().into_boxed_slice())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WebSocket C-ABI exports (parseSSLConfig / freeSSLConfig)
//
// LAYERING: ground truth is `src/http_jsc/websocket_client/
// WebSocketUpgradeClient.zig::parseSSLConfig`, but `SSLConfig::from_js`
// dereferences Blob / JSCArrayBuffer / node_fs values (tier-6) and lives in
// this crate. `bun_runtime → bun_http_jsc`, so hosting the export here breaks
// the cycle without an opaque stub. The boxed payload is the lower-tier
// `bun_http::ssl_config::SSLConfig` (what `HTTPClient::connect` consumes),
// bridged via `into_http()`. C++ (JSWebSocket.cpp) links by symbol name only.
// ──────────────────────────────────────────────────────────────────────────

/// Parse SSLConfig from a JavaScript TLS options object.
/// This function is exported for C++ to call from JSWebSocket.cpp.
/// Returns null if parsing fails (an exception will be set on globalThis).
/// The returned SSLConfig is heap-allocated and ownership is transferred to the caller.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__WebSocket__parseSSLConfig(
    global_this: &JSGlobalObject,
    tls_value: JSValue,
) -> Option<Box<bun_http::ssl_config::SSLConfig>> {
    // SAFETY: `bun_vm()` returns the live VM for this global; the WebSocket
    // constructor only runs on the JS thread with an initialized VM.
    let vm = unsafe { &*global_this.bun_vm() };
    // Use SSLConfig::from_js for clean and safe parsing
    let config_opt = match SSLConfig::from_js(vm, global_this, tls_value) {
        Ok(c) => c,
        // Exception is already set on globalThis
        Err(_) => return None,
    };
    // No TLS options provided or all defaults → null
    let config = config_opt?;
    // Allocate on heap and return pointer (ownership transferred to caller).
    Some(Box::new(config.into_http()))
}

/// Free an SSLConfig previously returned by `parseSSLConfig`.
/// Exported for C++ so error/early-return paths in JSWebSocket.cpp and
/// WebSocket.cpp can release ownership without leaking the heap allocation
/// (and all duped cert/key/CA strings inside it) when `connect()` never
/// hands the pointer off to a Zig upgrade client.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__WebSocket__freeSSLConfig(
    config: *mut bun_http::ssl_config::SSLConfig,
) {
    // SAFETY: `config` was produced by `Box::into_raw` (via `Option<Box<_>>`
    // FFI niche) in `Bun__WebSocket__parseSSLConfig`; caller transfers
    // ownership back. `bun_http::SSLConfig::drop` runs `deinit()`.
    drop(unsafe { Box::from_raw(config) });
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/SSLConfig.zig (577 lines)
//   confidence: high
//   notes:      Struct + Default/Clone/Drop/is_same/content_hash/as_usockets/
//               take_{protos,server_name}/from_js/from_generated/file helpers
//               + GlobalRegistry::{intern,remove} all live. key/cert/ca use
//               CStringList (owned CString + thin-ptr side-buffer) so
//               as_usockets() hands a layout-correct **const c_char to uSockets.
//               GlobalRegistry reshaped from ArrayHashMap<*SSLConfig> to
//               Vec<(u64, Weak)> probe-via-upgrade to avoid &/&mut aliasing
//               between Arc::drop_in_place and concurrent intern().
// ──────────────────────────────────────────────────────────────────────────
