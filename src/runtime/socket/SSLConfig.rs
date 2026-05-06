use core::ffi::c_char;
use std::ffi::CString;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use bun_uws as uws;
use bun_wyhash::Wyhash11;

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
// contentHash
// ──────────────────────────────────────────────────────────────────────────

impl SSLConfig {
    // PORT NOTE: Zig used `inline for (std.meta.fields(SSLConfig))` reflection.
    // Expanded by hand; keep field order in sync with struct definition.
    pub fn content_hash(&mut self) -> u64 {
        if self.cached_hash != 0 {
            return self.cached_hash;
        }
        let mut hasher = Wyhash11::init(0);

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
        self.cached_hash = if hash == 0 { 1 } else { hash };
        self.cached_hash
    }
}

fn hash_opt_str(hasher: &mut Wyhash11, value: &Option<CString>) {
    if let Some(s) = value {
        hasher.update(s.as_bytes());
    }
    hasher.update(&[0]);
}

fn hash_opt_strs(hasher: &mut Wyhash11, value: &Option<CStringList>) {
    if let Some(slice) = value {
        for s in slice.iter() {
            hasher.update(s.as_bytes());
            hasher.update(&[0]);
        }
    }
    hasher.update(&[0]);
}

fn hash_scalar<T: Copy>(hasher: &mut Wyhash11, value: &T) {
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
pub mod GlobalRegistry {
    use super::*;

    // TODO(port): Zig used ArrayHashMapUnmanaged with a custom MapContext that
    // hashes/compares by *content* (content_hash / is_same) while the key is a
    // raw `*SSLConfig`. bun_collections::ArrayHashMap needs equivalent
    // per-map-context support; if not available, wrap *mut SSLConfig in a
    // newtype implementing Hash/Eq via unsafe deref.
    //
    // Backing storage + intern() are gated until the content-hash MapContext
    // adapter exists; remove() is a no-op while no map is populated.

    /// Called from `SSLConfig::drop()` on strong 1->0. If `intern()` replaced
    /// our slot while we blocked on the mutex, the pointer-identity check
    /// fails and we skip (intern already disposed our weak ref).
    ///
    /// No-op for configs that were never interned.
    pub(super) fn remove(_config: *mut SSLConfig) {
        // No-op until intern() and the static map land. Every SSLConfig is
        // currently un-interned, so the Zig path would early-return on
        // `configs.count() == 0` anyway.
        // TODO(port): wire to ArrayHashMap once content-hash context is available.
    }

    
    mod _gated_intern {
        use super::*;
        use bun_collections::ArrayHashMap;

        // bun_threading::Mutex has no `const fn new()`; use parking_lot here
        // (already a workspace dep) until a const constructor lands.
        static MUTEX: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

        struct MapContext;
        impl MapContext {
            fn hash(key: *mut SSLConfig) -> u32 {
                // SAFETY: key points into a live Arc allocation while held by the
                // registry mutex (see module doc).
                unsafe { (*key).content_hash() as u32 }
            }
            fn eql(a: *mut SSLConfig, b: *mut SSLConfig) -> bool {
                // SAFETY: see above.
                unsafe { (*a).is_same(&*b) }
            }
        }

        /// Module-level storage. Zig: `var configs: ArrayHashMapUnmanaged(...) = .empty`.
        ///
        /// Access discipline: every caller holds `MUTEX` for the full lifetime of
        /// the returned `&'static mut`, so the `static mut` aliasing rules are
        /// upheld by that lock (PORTING.md §Concurrency: lock owns data, but
        /// `ArrayHashMap` has no `const fn new()` so it can't sit inside the
        /// `Mutex` directly — lazy `Option` init under the lock instead).
        fn configs() -> &'static mut ArrayHashMap<*mut SSLConfig, WeakPtr> {
            // `*mut SSLConfig` key makes the map `!Sync`; `static mut` sidesteps
            // the auto-trait bound and matches Zig's plain `var`.
            static mut CONFIGS: Option<ArrayHashMap<*mut SSLConfig, WeakPtr>> = None;
            // SAFETY: only ever entered while `MUTEX` is held (see `intern` /
            // `remove`), guaranteeing a single live `&mut` at a time.
            #[allow(static_mut_refs)]
            unsafe {
                CONFIGS.get_or_insert_with(ArrayHashMap::new)
            }
        }

        /// Takes a by-value SSLConfig, wraps it in a `SharedPtr` (strong=1), and
        /// either returns an existing equivalent (upgraded) or the new one. Either
        /// way, caller owns exactly one strong ref on the result.
        ///
        /// The returned `SharedPtr` is dropped normally.
        pub fn intern(config: SSLConfig) -> SharedPtr {
            let new_shared: SharedPtr = Arc::new(config);
            let new_ptr = Arc::as_ptr(&new_shared) as *mut SSLConfig;

            // Deferred cleanup MUST run after the mutex is released (Drop re-locks
            // the registry mutex via `SSLConfig::drop -> remove`).
            let mut dispose_new: Option<SharedPtr> = None;
            let mut dispose_old_weak: Option<WeakPtr> = None;

            // PORT NOTE: reshaped for borrowck — Zig returned directly while holding
            // the mutex, then ran `defer`s. We compute `result` in a labeled block,
            // drop the guard, then dispose deferred values.
            let result = 'locked: {
                let _guard = MUTEX.lock();
                let configs = configs();

                // TODO(port): get_or_put_context with MapContext (content hash/eq)
                let gop = configs.get_or_put(new_ptr);
                if gop.found_existing {
                    if let Some(existing_shared) = gop.value_ptr.upgrade() {
                        // Existing config is still alive; dispose the new duplicate.
                        dispose_new = Some(new_shared);
                        break 'locked existing_shared;
                    } else {
                        // strong==0: existing is dying. Its `drop()` is blocked in
                        // `remove()` waiting for this mutex, so content is still
                        // intact (fields not yet freed). Replace the slot; the
                        // dying config's `remove()` will pointer-mismatch and no-op
                        // when it runs.
                        dispose_old_weak = Some(core::mem::replace(gop.value_ptr, Weak::new()));
                        *gop.key_ptr = new_ptr;
                        *gop.value_ptr = Arc::downgrade(&new_shared);
                        new_shared
                    }
                } else {
                    *gop.value_ptr = Arc::downgrade(&new_shared);
                    new_shared
                }
            };
            // _guard dropped here; now safe to drop dispose_new / dispose_old_weak.
            drop(dispose_new);
            drop(dispose_old_weak);
            result
        }

        pub(in super::super) fn remove(config: *mut SSLConfig) {
            let _guard = MUTEX.lock();
            let configs = configs();
            if configs.count() == 0 {
                return;
            }
            // TODO(port): get_index_context with MapContext
            let Some(idx) = configs.get_index(config) else { return };
            if configs.keys()[idx] != config {
                return;
            }
            let weak = configs.values()[idx].clone();
            configs.swap_remove_at(idx);
            drop(weak);
        }
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
//
// Gated: depends on `crate::webcore::Blob` store layout, `crate::node::fs::NodeFS`
// readFile-with-NullTerminated variant, and `bun_jsc::generated::SSLConfig*`
// GenVal/GenOpt accessor shapes (`.get()` returning WTFStringImpl). Re-enable
// once those tier-6 surfaces stabilise.

mod _gated_from_js {
    use super::*;
    use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult};
    use bun_str::WTFStringImpl;

    // ── ReadFromBlobError ────────────────────────────────────────────────
    #[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
    pub enum ReadFromBlobError {
        #[error(transparent)]
        Js(#[from] JsError),
        #[error("NullStore")]
        NullStore,
        #[error("NotAFile")]
        NotAFile,
        #[error("EmptyFile")]
        EmptyFile,
    }

    fn read_from_blob(
        global: &JSGlobalObject,
        blob: &mut crate::webcore::Blob,
    ) -> Result<CString, ReadFromBlobError> {
        let store = blob.store.as_ref().ok_or(ReadFromBlobError::NullStore)?;
        let file = match &store.data {
            crate::webcore::blob::StoreData::File(f) => f,
            _ => return Err(ReadFromBlobError::NotAFile),
        };
        let mut fs = crate::node::fs::NodeFS::default();
        // TODO(port): verify NodeFS::read_file_with_options signature/variants
        let maybe = fs.read_file_with_options(
            crate::node::fs::ReadFileArgs { path: file.pathlike.clone() },
            crate::node::fs::Flavor::Sync,
            crate::node::fs::ReadFileEncoding::NullTerminated,
        );
        let result = match maybe {
            bun_sys::Result::Ok(result) => result,
            bun_sys::Result::Err(err) => {
                return Err(global.throw_value(err.to_js(global)?).into());
            }
        };
        // `read_file_with_options(NullTerminated)` transfers ownership of the
        // returned buffer to the caller, so we can return it directly without
        // duplicating.
        if result.null_terminated.is_empty() {
            return Err(ReadFromBlobError::EmptyFile);
        }
        // TODO(port): result.null_terminated is already NUL-terminated owned bytes;
        // wrap as CString without re-allocating.
        Ok(result.null_terminated)
    }

    impl SSLConfig {
        pub fn from_js(
            vm: &mut jsc::VirtualMachine,
            global: &JSGlobalObject,
            value: JSValue,
        ) -> JsResult<Option<SSLConfig>> {
            let mut generated = jsc::generated::SSLConfig::from_js(global, value)?;
            // `generated` dropped at scope exit
            Self::from_generated(vm, global, &generated)
        }

        pub fn from_generated(
            vm: &mut jsc::VirtualMachine,
            global: &JSGlobalObject,
            generated: &jsc::generated::SSLConfig,
        ) -> JsResult<Option<SSLConfig>> {
            let mut result = SSLConfig::zero();
            // errdefer result.deinit() — handled by Drop on error-path `?`
            let mut any = false;

            if let Some(passphrase) = generated.passphrase.get() {
                result.passphrase = Some(passphrase.to_owned_slice_z());
                any = true;
            }
            if let Some(dh_params_file) = generated.dh_params_file.get() {
                result.dh_params_file_name = Some(handle_path(global, "dhParamsFile", dh_params_file)?);
                any = true;
            }
            if let Some(server_name) = generated.server_name.get() {
                result.server_name = Some(server_name.to_owned_slice_z());
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
                result.key_file_name = Some(handle_path(global, "keyFile", key_file)?);
                result.requires_custom_request_ctx = true;
            }
            if let Some(cert_file) = generated.cert_file.get() {
                result.cert_file_name = Some(handle_path(global, "certFile", cert_file)?);
                result.requires_custom_request_ctx = true;
            }
            if let Some(ca_file) = generated.ca_file.get() {
                result.ca_file_name = Some(handle_path(global, "caFile", ca_file)?);
                result.requires_custom_request_ctx = true;
            }

            let protocols: Option<CString> = match &generated.alpn_protocols {
                jsc::generated::SSLConfigAlpnProtocols::None => None,
                jsc::generated::SSLConfigAlpnProtocols::String(val) => {
                    Some(val.get().to_owned_slice_z())
                }
                jsc::generated::SSLConfigAlpnProtocols::Buffer(val) => {
                    let buffer: jsc::ArrayBuffer = val.get().as_array_buffer();
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
                result.ssl_ciphers = Some(ciphers.to_owned_slice_z());
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
        string: WTFStringImpl,
    ) -> JsResult<CString> {
        let name = string.to_owned_slice_z();
        // TODO(port): bun_sys::access wrapper; Zig called std.posix.system.access.
        // SAFETY: `name` is a valid NUL-terminated CString; access(2) only reads it.
        if unsafe { libc::access(name.as_ptr(), libc::F_OK) } != 0 {
            // errdefer: free_sensitive(name) — scopeguard not needed; name drops on
            // return, but we need zeroing:
            free_sensitive_bytes(name.into_bytes_with_nul());
            return Err(global.throw_invalid_arguments(
                format_args!("Unable to access {} path", field),
                (),
            ));
        }
        Ok(name)
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
                (),
            )),
            Err(ReadFromBlobError::NullStore) | Err(ReadFromBlobError::NotAFile) => {
                Err(global.throw_invalid_arguments(
                    format_args!(
                        "TLSOptions.{} is not a valid BunFile (non-BunFile `Blob`s are not supported)",
                        field
                    ),
                    (),
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
                jsc::generated::SSLConfigFile::Buffer(val) => SingleFile::Buffer(val.get()),
                jsc::generated::SSLConfigFile::File(val) => SingleFile::File(val.get()),
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
        let guard = scopeguard::guard(&mut result, |r| {
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
                    jsc::generated::SSLConfigSingleFile::Buffer(val) => SingleFile::Buffer(val.get()),
                    jsc::generated::SSLConfigSingleFile::File(val) => SingleFile::File(val.get()),
                },
            )?);
        }
        let result = scopeguard::ScopeGuard::into_inner(guard);
        Ok(Some(core::mem::take(result)))
    }

    // PORT NOTE: Zig used an anonymous `union(enum)` param; named here.
    enum SingleFile<'a> {
        String(WTFStringImpl),
        Buffer(&'a jsc::JSCArrayBuffer),
        File(&'a mut crate::webcore::Blob),
    }

    fn handle_single_file(
        global: &JSGlobalObject,
        file: SingleFile<'_>,
    ) -> Result<CString, ReadFromBlobError> {
        match file {
            SingleFile::String(string) => Ok(string.to_owned_slice_z()),
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
// PORT STATUS
//   source:     src/runtime/socket/SSLConfig.zig (577 lines)
//   confidence: medium
//   todos:      10
//   notes:      Struct + Default/Clone/Drop/is_same/content_hash/as_usockets/
//               take_{protos,server_name} real. from_js/from_generated/file
//               helpers + GlobalRegistry::intern gated on tier-6 surfaces
//               (webcore::Blob store, node::fs::NodeFS, generated GenVal
//               accessors, ArrayHashMap content-hash context). key/cert/ca use
//               CStringList (owned CString + thin-ptr side-buffer) so
//               as_usockets() hands a layout-correct **const c_char to uSockets.
// ──────────────────────────────────────────────────────────────────────────
