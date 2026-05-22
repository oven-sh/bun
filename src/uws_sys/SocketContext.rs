//! Legacy home of the `us_socket_context_t` opaque, which is gone — sockets
//! now belong to embedded `SocketGroup`s and dispatch by `kind`. What remains
//! here is the `us_bun_socket_context_options_t` extern mirror, kept under its
//! old name so `SSLConfig.asUSockets()` callers don't churn.

use core::ffi::{c_char, c_long};
use core::ptr;

use bun_boringssl_sys::SSL_CTX;

use crate::create_bun_socket_error_t;

/// `[mtime_sec, mtime_nsec, size]` for the SSL cache-key digest (spec
/// `SocketContext.zig:81`: `bun.sys.stat(path)` → `st.mtime() ++ st.size`).
/// Body moved DOWN from `bun_sys` — it only needs `libc::stat`, which this
/// crate already links, so the former link-time hook bought nothing. Returns
/// `None` on stat failure (digest feeds zeros — `create_ssl_context` will then
/// fail on the same path and the entry never reaches the cache).
#[cfg(unix)]
fn stat_for_digest(path: &bun_core::ZStr) -> Option<[i64; 3]> {
    // SAFETY: POD, zero-valid — `libc::stat` is all-integer; `stat(2)` writes it.
    let mut st: libc::stat = bun_core::ffi::zeroed();
    // SAFETY: `path` is NUL-terminated (ZStr invariant).
    let rc = unsafe { libc::stat(path.as_ptr().cast::<c_char>(), &raw mut st) };
    if rc != 0 {
        return None;
    }
    // libc exposes mtime as `st_mtime` (sec) + `st_mtime_nsec` (nsec) on
    // Linux/BSD/macOS. Widen to i64 (already i64 on LP64; cast is a no-op).
    Some([
        st.st_mtime as i64,
        st.st_mtime_nsec as i64,
        st.st_size as i64,
    ])
}

#[cfg(windows)]
fn stat_for_digest(path: &bun_core::ZStr) -> Option<[i64; 3]> {
    use bun_windows_sys as fs;
    use bun_windows_sys::FILETIME;
    // Spec parity: `bun.sys.stat` on Windows is libuv `uv_fs_stat`, which opens
    // via `CreateFileW` *without* `FILE_FLAG_OPEN_REPARSE_POINT` and therefore
    // follows symlinks to the target. `GetFileAttributesExW` does NOT follow
    // reparse points — it would return the link's own mtime/size and miss an
    // in-place cert rotation behind a symlink (stale SSL_CTX served). Match
    // libuv: open query-only, `GetFileInformationByHandle`, close.
    //
    // `bun_core::to_w_path_normalized` lives above this crate, so widen
    // inline: UTF-8→UTF-16LE (≤ input.len() code units), normalize `/`→`\`,
    // NUL-terminate. Heap-allocated (cold init path; avoids a 64KB stack
    // `WPathBuffer` and the wrong-unit `MAX_PATH_BYTES` previously used here).
    let bytes = path.as_bytes();
    let mut wbuf = vec![0u16; bytes.len() + 1];
    let n = bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut wbuf, bytes).len();
    bun_paths::slashes_to_windows_in_place(&mut wbuf[..n]);
    wbuf[n] = 0;
    // SAFETY: `wbuf` is NUL-terminated at `[n]`. dwDesiredAccess=0 is query-
    // only (metadata). FILE_FLAG_BACKUP_SEMANTICS lets this succeed on dirs;
    // omitting FILE_FLAG_OPEN_REPARSE_POINT makes CreateFileW follow symlinks.
    let h = unsafe {
        fs::CreateFileW(
            wbuf.as_ptr(),
            0,
            fs::FILE_SHARE_READ | fs::FILE_SHARE_WRITE | fs::FILE_SHARE_DELETE,
            ptr::null_mut(),
            fs::OPEN_EXISTING,
            fs::FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        )
    };
    if h == fs::INVALID_HANDLE_VALUE {
        return None;
    }
    let mut data: fs::BY_HANDLE_FILE_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `h` is a valid open handle; `data` is a valid out-ptr.
    let ok = unsafe { fs::GetFileInformationByHandle(h, &raw mut data) };
    // SAFETY: `h` is a valid open handle from CreateFileW above.
    unsafe { fs::CloseHandle(h) };
    if ok == 0 {
        return None;
    }
    let ft: FILETIME = data.ftLastWriteTime;
    // FILETIME = 100ns ticks since 1601-01-01. Feed raw ticks split as
    // `[sec_field, nsec_field, size]` — the digest only needs *some*
    // deterministic encoding of mtime, not the libuv POSIX-epoch split the
    // deleted `__bun_uws_stat_file` produced. The SSL-context cache keyed on
    // this digest is in-memory process-lifetime only (spec `SocketContext.zig`
    // — no on-disk persistence), so cross-version byte-compat of the key is
    // irrelevant; only stability *within* a process matters.
    let ticks = (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime);
    let size = (u64::from(data.nFileSizeHigh) << 32) | u64::from(data.nFileSizeLow);
    Some([
        (ticks / 10_000_000) as i64,
        (ticks % 10_000_000) as i64 * 100,
        size as i64,
    ])
}

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
                hp.update(unsafe { bun_core::ffi::cstr(s) }.to_bytes());
            }
            hp.update(&[0]); // terminator so {a:"xy"} ≠ {a:"x",b:"y"}
        };

        let feed_arr = |hp: &mut Sha256, arr: *const *const c_char, n: u32| {
            hp.update(&[(!arr.is_null()) as u8]);
            hp.update(bun_core::bytes_of(&n));
            if !arr.is_null() {
                // SAFETY: `arr` points to `n` (possibly null) C strings.
                let slice = unsafe { bun_core::ffi::slice(arr, n as usize) };
                for &s in slice {
                    hp.update(&[(!s.is_null()) as u8]);
                    if !s.is_null() {
                        // SAFETY: NUL-terminated C string.
                        hp.update(unsafe { bun_core::ffi::cstr(s) }.to_bytes());
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
                let bytes = unsafe { bun_core::ffi::cstr(s) }.to_bytes();
                // SAFETY: `s[bytes.len()] == 0` (CStr invariant) and `s[..len]` is readable.
                let path = unsafe { bun_core::ZStr::from_raw(s.cast::<u8>(), bytes.len()) };
                hp.update(path.as_bytes());
                let mut meta: [i64; 3] = [0; 3];
                if !path.as_bytes().is_empty() {
                    if let Some(m) = stat_for_digest(path) {
                        meta = m;
                    }
                }
                hp.update(bun_core::bytes_of(&meta));
            }
            hp.update(&[0]);
        };

        feed_path(&mut h, self.key_file_name);
        feed_path(&mut h, self.cert_file_name);
        feed_z(&mut h, self.passphrase);
        feed_path(&mut h, self.dh_params_file_name);
        feed_path(&mut h, self.ca_file_name);
        feed_z(&mut h, self.ssl_ciphers);
        h.update(bun_core::bytes_of(&self.ssl_prefer_low_memory_usage));
        feed_arr(&mut h, self.key, self.key_count);
        feed_arr(&mut h, self.cert, self.cert_count);
        feed_arr(&mut h, self.ca, self.ca_count);
        h.update(bun_core::bytes_of(&self.secure_options));
        h.update(bun_core::bytes_of(&self.reject_unauthorized));
        h.update(bun_core::bytes_of(&self.request_cert));
        h.update(bun_core::bytes_of(&self.client_renegotiation_limit));
        h.update(bun_core::bytes_of(&self.client_renegotiation_window));
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
            let slice = unsafe { bun_core::ffi::slice(arr, count as usize) };
            for &s in slice {
                if !s.is_null() {
                    // SAFETY: NUL-terminated C string.
                    *n += unsafe { bun_core::ffi::cstr(s) }.to_bytes().len();
                }
            }
        };
        sum(self.key, self.key_count, &mut n);
        sum(self.cert, self.cert_count, &mut n);
        sum(self.ca, self.ca_count, &mut n);
        n
    }
}

/// Thin SHA-256 wrapper over the raw `bun_boringssl_sys` FFI so `digest()`
/// reads the same as the Zig (`Sha256.init`/`update`/`final`). No higher-tier
/// `bun_boringssl::Sha256` exists yet; this stays local until one does.
struct Sha256(core::mem::MaybeUninit<bun_boringssl_sys::SHA256_CTX>);
impl Sha256 {
    #[inline]
    fn init() -> Self {
        let mut ctx = core::mem::MaybeUninit::<bun_boringssl_sys::SHA256_CTX>::uninit();
        // SAFETY: SHA256_Init writes the full ctx; never reads uninit bytes.
        unsafe { bun_boringssl_sys::SHA256_Init(ctx.as_mut_ptr()) };
        Self(ctx)
    }
    #[inline]
    fn update(&mut self, data: &[u8]) {
        // SAFETY: ctx was initialized in `init`; data is a valid readable slice.
        unsafe {
            bun_boringssl_sys::SHA256_Update(
                self.0.as_mut_ptr(),
                data.as_ptr().cast::<core::ffi::c_void>(),
                data.len(),
            )
        };
    }
    #[inline]
    fn final_(&mut self, out: &mut [u8; 32]) {
        // SAFETY: ctx was initialized in `init`; out has room for 32 bytes.
        unsafe { bun_boringssl_sys::SHA256_Final(out.as_mut_ptr(), self.0.as_mut_ptr()) };
    }
}

pub mod c {
    use super::*;
    unsafe extern "C" {
        pub fn us_ssl_ctx_from_options(
            options: BunSocketContextOptions,
            err: *mut create_bun_socket_error_t,
        ) -> *mut SSL_CTX;
        // safe: no args; reads a process-global counter — no preconditions.
        pub safe fn us_ssl_ctx_live_count() -> c_long;
    }
}

// ported from: src/uws_sys/SocketContext.zig
