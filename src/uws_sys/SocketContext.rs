//! Legacy home of the `us_socket_context_t` opaque, which is gone — sockets
//! now belong to embedded `SocketGroup`s and dispatch by `kind`. What remains
//! here is the `us_bun_socket_context_options_t` extern mirror, kept under its
//! old name so `SSLConfig.asUSockets()` callers don't churn.

use core::ffi::{c_char, c_long};
use core::ptr;

use core::sync::atomic::{AtomicPtr, Ordering};

use bun_boringssl_sys::SSL_CTX;
// Forward ref: Sha256 wrapper to be provided by bun_boringssl_sys (move-in pass).
use bun_boringssl_sys::Sha256;

use crate::create_bun_socket_error_t;

/// Hook: `fn(path: &ZStr) -> Option<[mtime_sec, mtime_nsec, size]>`. Registered
/// by `bun_runtime::init()`; null = stat unavailable (digest feeds zeros).
pub static STAT_FILE_HOOK: AtomicPtr<()> = AtomicPtr::new(ptr::null_mut());
pub type StatFileFn = unsafe fn(&bun_core::ZStr) -> Option<[i64; 3]>;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct BunSocketContextOptions {
    pub key_file_name: *const c_char,
    pub cert_file_name: *const c_char,
    pub passphrase: *const c_char,
    pub dh_params_file_name: *const c_char,
    pub ca_file_name: *const c_char,
    pub ssl_ciphers: *const c_char,
    pub ssl_prefer_low_memory_usage: i32,
    pub key: *const *const c_char,
    pub key_count: u32,
    pub cert: *const *const c_char,
    pub cert_count: u32,
    pub ca: *const *const c_char,
    pub ca_count: u32,
    pub secure_options: u32,
    pub reject_unauthorized: i32,
    pub request_cert: i32,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
}

impl Default for BunSocketContextOptions {
    fn default() -> Self {
        Self {
            key_file_name: ptr::null(),
            cert_file_name: ptr::null(),
            passphrase: ptr::null(),
            dh_params_file_name: ptr::null(),
            ca_file_name: ptr::null(),
            ssl_ciphers: ptr::null(),
            ssl_prefer_low_memory_usage: 0,
            key: ptr::null(),
            key_count: 0,
            cert: ptr::null(),
            cert_count: 0,
            ca: ptr::null(),
            ca_count: 0,
            secure_options: 0,
            reject_unauthorized: 0,
            request_cert: 0,
            client_renegotiation_limit: 3,
            client_renegotiation_window: 600,
        }
    }
}

impl BunSocketContextOptions {
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
    pub fn create_ssl_context(self, err: &mut create_bun_socket_error_t) -> Option<*mut SSL_CTX> {
        // SAFETY: FFI call; `self` is `#[repr(C)]` and passed by value, `err` is a valid out-param.
        let ctx = unsafe { c::us_ssl_ctx_from_options(self, err) };
        if ctx.is_null() { None } else { Some(ctx) }
    }

    /// SHA-256 over every field this struct carries, dereferencing string
    /// pointers so the digest is content-addressed (not pointer-addressed).
    /// Two option structs that build the same `SSL_CTX*` produce the same
    /// digest. Used as the key for `SSLContextCache`.
    pub fn digest(&self) -> [u8; 32] {
        let mut h = Sha256::init();

        let feed_z = |hp: &mut Sha256, s: *const c_char| {
            // Presence byte so null ≠ "" — both would otherwise feed only
            // the trailing 0. In practice "" usually fails create_ssl_context
            // and never caches, but injectivity is cheap to guarantee.
            hp.update(&[(!s.is_null()) as u8]);
            if !s.is_null() {
                // SAFETY: caller-provided NUL-terminated C string.
                hp.update(unsafe { core::ffi::CStr::from_ptr(s) }.to_bytes());
            }
            hp.update(&[0]); // terminator so {a:"xy"} ≠ {a:"x",b:"y"}
        };

        let feed_arr = |hp: &mut Sha256, arr: *const *const c_char, n: u32| {
            hp.update(&[(!arr.is_null()) as u8]);
            hp.update(as_bytes(&n));
            if !arr.is_null() {
                // SAFETY: `arr` points to `n` (possibly null) C strings.
                let slice = unsafe { core::slice::from_raw_parts(arr, n as usize) };
                for &s in slice {
                    hp.update(&[(!s.is_null()) as u8]);
                    if !s.is_null() {
                        // SAFETY: NUL-terminated C string.
                        hp.update(unsafe { core::ffi::CStr::from_ptr(s) }.to_bytes());
                    }
                    hp.update(&[0]);
                }
            }
            hp.update(&[0]);
        };

        // File-backed fields: feed path + (mtime, size) so an in-place cert
        // rotation produces a fresh digest. stat() is ~1µs and only runs when
        // the file form is used (Bun-specific; node:tls always passes inline
        // bytes). On stat failure we feed zeros — `create_ssl_context` will fail
        // on the same path and the entry never reaches the cache.
        let feed_path = |hp: &mut Sha256, s: *const c_char| {
            hp.update(&[(!s.is_null()) as u8]);
            if !s.is_null() {
                // SAFETY: NUL-terminated C string.
                let path = unsafe { bun_core::ZStr::from_ptr(s.cast::<u8>()) };
                hp.update(path.as_bytes());
                let mut meta: [i64; 3] = [0; 3];
                if !path.as_bytes().is_empty() {
                    let hook = STAT_FILE_HOOK.load(Ordering::Relaxed);
                    if !hook.is_null() {
                        // SAFETY: hook was registered as a `StatFileFn` by runtime init.
                        if let Some(m) = unsafe { core::mem::transmute::<_, StatFileFn>(hook)(path) } {
                            meta = m;
                        }
                    }
                }
                hp.update(as_bytes(&meta));
            }
            hp.update(&[0]);
        };

        feed_path(&mut h, self.key_file_name);
        feed_path(&mut h, self.cert_file_name);
        feed_z(&mut h, self.passphrase);
        feed_path(&mut h, self.dh_params_file_name);
        feed_path(&mut h, self.ca_file_name);
        feed_z(&mut h, self.ssl_ciphers);
        h.update(as_bytes(&self.ssl_prefer_low_memory_usage));
        feed_arr(&mut h, self.key, self.key_count);
        feed_arr(&mut h, self.cert, self.cert_count);
        feed_arr(&mut h, self.ca, self.ca_count);
        h.update(as_bytes(&self.secure_options));
        h.update(as_bytes(&self.reject_unauthorized));
        h.update(as_bytes(&self.request_cert));
        h.update(as_bytes(&self.client_renegotiation_limit));
        h.update(as_bytes(&self.client_renegotiation_window));
        let mut out = [0u8; 32];
        h.final_(&mut out);
        out
    }

    /// Best-effort byte count of cert/key/CA material — fed into
    /// `SecureContext.memoryCost` so the GC sees the off-heap allocation.
    pub fn approx_cert_bytes(&self) -> usize {
        let mut n: usize = 0;
        let sum = |arr: *const *const c_char, count: u32, n: &mut usize| {
            if arr.is_null() {
                return;
            }
            // SAFETY: `arr` points to `count` (possibly null) C strings.
            let slice = unsafe { core::slice::from_raw_parts(arr, count as usize) };
            for &s in slice {
                if !s.is_null() {
                    // SAFETY: NUL-terminated C string.
                    *n += unsafe { core::ffi::CStr::from_ptr(s) }.to_bytes().len();
                }
            }
        };
        sum(self.key, self.key_count, &mut n);
        sum(self.cert, self.cert_count, &mut n);
        sum(self.ca, self.ca_count, &mut n);
        n
    }
}

/// `std.mem.asBytes` equivalent: view a `#[repr(C)]`/POD value as a byte slice.
#[inline]
fn as_bytes<T: Copy>(v: &T) -> &[u8] {
    // SAFETY: `T: Copy` (POD), reading `size_of::<T>()` bytes from `&T` is valid.
    unsafe { core::slice::from_raw_parts((v as *const T).cast::<u8>(), core::mem::size_of::<T>()) }
}

pub mod c {
    use super::*;
    unsafe extern "C" {
        pub fn us_ssl_ctx_from_options(
            options: BunSocketContextOptions,
            err: *mut create_bun_socket_error_t,
        ) -> *mut SSL_CTX;
        pub fn us_ssl_ctx_live_count() -> c_long;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/SocketContext.zig (139 lines)
//   confidence: medium
//   todos:      0
//   notes:      bun_boringssl_sys::Sha256 (forward-ref) / STAT_FILE_HOOK / ZStr API names assumed; verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
