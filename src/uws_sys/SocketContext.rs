//! Legacy home of the `us_socket_context_t` opaque, which is gone — sockets
//! now belong to embedded `SocketGroup`s and dispatch by `kind`. What remains
//! here is the `us_bun_socket_context_options_t` extern mirror, kept under its
//! old name so `SSLConfig.asUSockets()` callers don't churn.

use core::ffi::c_long;
use core::marker::PhantomData;
use core::ptr;

use bun_boringssl_sys::{OwnedSslCtx, SSL_CTX};
use bun_core::{CStrRef, SensitiveCString};

use crate::create_bun_socket_error_t;

/// `[mtime_sec, mtime_nsec, size]` for the SSL cache-key digest.
/// Body moved DOWN from `bun_sys` — it only needs `libc::stat`, which this
/// crate already links, so the former link-time hook bought nothing. Returns
/// `None` on stat failure (digest feeds zeros — `create_ssl_context` will then
/// fail on the same path and the entry never reaches the cache).
#[cfg(unix)]
fn stat_for_digest(path: &bun_core::ZStr) -> Option<[i64; 3]> {
    // SAFETY: POD, zero-valid — `libc::stat` is all-integer; `stat(2)` writes it.
    let mut st: libc::stat = bun_core::ffi::zeroed();
    // SAFETY: `path` is NUL-terminated (ZStr invariant).
    let rc = unsafe { libc::stat(path.as_ptr(), &raw mut st) };
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
    use std::os::windows::io::{AsRawHandle as _, HandleOrInvalid, OwnedHandle};
    // `GetFileAttributesExW` does NOT follow reparse points — it would return the link's own
    // mtime/size and miss an in-place cert rotation behind a symlink (stale SSL_CTX served).
    // Instead: open query-only, `GetFileInformationByHandle`, close.
    let mut wide = bun_paths::OSPath::from(path);
    bun_paths::to_native_in_place(wide.as_mut_slice());
    // SAFETY: `wide` is NUL-terminated. dwDesiredAccess=0 is query-
    // only (metadata). FILE_FLAG_BACKUP_SEMANTICS lets this succeed on dirs;
    // omitting FILE_FLAG_OPEN_REPARSE_POINT makes CreateFileW follow symlinks.
    let h = unsafe {
        HandleOrInvalid::from_raw_handle(fs::CreateFileW(
            wide.as_ptr(),
            0,
            fs::FILE_SHARE_READ | fs::FILE_SHARE_WRITE | fs::FILE_SHARE_DELETE,
            ptr::null_mut(),
            fs::OPEN_EXISTING,
            fs::FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        ))
    };
    let h = OwnedHandle::try_from(h).ok()?;
    let mut data: fs::BY_HANDLE_FILE_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `h` is a valid open handle; `data` is a valid out-ptr.
    if unsafe { fs::GetFileInformationByHandle(h.as_raw_handle(), &raw mut data) } == 0 {
        return None;
    }
    let ft: FILETIME = data.ftLastWriteTime;
    // FILETIME = 100ns ticks since 1601-01-01. Feed raw ticks split as
    // `[sec_field, nsec_field, size]` — the digest only needs *some*
    // deterministic encoding of mtime, not the POSIX-epoch split the
    // deleted `__bun_uws_stat_file` produced. The SSL-context cache keyed on
    // this digest is in-memory process-lifetime only (no on-disk
    // persistence), so cross-version byte-compat of the key is
    // irrelevant; only stability *within* a process matters.
    let ticks = (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime);
    let size = (u64::from(data.nFileSizeHigh) << 32) | u64::from(data.nFileSizeLow);
    Some([
        (ticks / 10_000_000) as i64,
        (ticks % 10_000_000) as i64 * 100,
        size as i64,
    ])
}

/// An `Option<&[SensitiveCString]>` as C reads it: a nullable `const char *const *` and its count.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct CStrArray<'a> {
    ptr: *const SensitiveCString,
    len: usize,
    _borrow: PhantomData<&'a [SensitiveCString]>,
}

impl<'a> From<Option<&'a [SensitiveCString]>> for CStrArray<'a> {
    fn from(strings: Option<&'a [SensitiveCString]>) -> Self {
        match strings {
            Some(strings) => Self {
                ptr: strings.as_ptr(),
                len: strings.len(),
                _borrow: PhantomData,
            },
            None => Self::default(),
        }
    }
}

impl<'a> CStrArray<'a> {
    fn iter(self) -> impl Iterator<Item = CStrRef<'a>> {
        // SAFETY: null, or the parts of a slice that is borrowed for `'a`.
        let strings = unsafe { ptr::slice_from_raw_parts(self.ptr, self.len).as_ref() };
        strings.unwrap_or_default().iter().map(CStrRef::from)
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct BunSocketContextOptions<'a> {
    pub key_file_name: Option<CStrRef<'a>>,
    pub cert_file_name: Option<CStrRef<'a>>,
    pub passphrase: Option<CStrRef<'a>>,
    pub dh_params_file_name: Option<CStrRef<'a>>,
    pub ca_file_name: Option<CStrRef<'a>>,
    pub ssl_ciphers: Option<CStrRef<'a>>,
    pub ssl_prefer_low_memory_usage: i32,
    pub allow_partial_trust_chain: i32,
    pub key: CStrArray<'a>,
    pub cert: CStrArray<'a>,
    pub ca: CStrArray<'a>,
    pub secure_options: u32,
    pub ssl_min_version: i32,
    pub ssl_max_version: i32,
    pub reject_unauthorized: i32,
    pub request_cert: i32,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
    pub session_timeout: i32,
    pub crl: CStrArray<'a>,
    pub sigalgs: Option<CStrRef<'a>>,
    pub ecdh_curve: Option<CStrRef<'a>>,
}
bun_core::assert_ffi_layout!(
    BunSocketContextOptions<'static>, 168, 8;
    allow_partial_trust_chain @ 52, secure_options @ 104, crl @ 136,
);

impl Default for BunSocketContextOptions<'_> {
    fn default() -> Self {
        Self {
            key_file_name: None,
            cert_file_name: None,
            passphrase: None,
            dh_params_file_name: None,
            ca_file_name: None,
            ssl_ciphers: None,
            ssl_prefer_low_memory_usage: 0,
            allow_partial_trust_chain: 0,
            key: CStrArray::default(),
            cert: CStrArray::default(),
            ca: CStrArray::default(),
            secure_options: 0,
            ssl_min_version: 0,
            ssl_max_version: 0,
            reject_unauthorized: 0,
            request_cert: 0,
            client_renegotiation_limit: 3,
            client_renegotiation_window: 600,
            session_timeout: 0,
            crl: CStrArray::default(),
            sigalgs: None,
            ecdh_curve: None,
        }
    }
}

impl BunSocketContextOptions<'_> {
    /// Build a BoringSSL `SSL_CTX` from these options. The verify mode follows
    /// `request_cert`/`reject_unauthorized` only; see `us_ssl_ctx_from_options`.
    pub fn create_ssl_context(self, err: &mut create_bun_socket_error_t) -> Option<OwnedSslCtx> {
        c::us_ssl_ctx_from_options(self, err)
    }

    /// Sets `digest` (this struct's `digest()`) as the session id context: see `us_ssl_apply_selected_ctx`.
    pub fn create_ssl_context_with_digest(
        self,
        digest: &[u8; 32],
        err: &mut create_bun_socket_error_t,
    ) -> Option<OwnedSslCtx> {
        let ctx = self.create_ssl_context(err)?;
        ctx.set_session_id_context(digest);
        Some(ctx)
    }

    /// SHA-256 over every field this struct carries, dereferencing string
    /// pointers so the digest is content-addressed (not pointer-addressed).
    /// Two option structs that build the same `SSL_CTX*` produce the same
    /// digest. Used as the key for `SSLContextCache`.
    pub fn digest(&self) -> [u8; 32] {
        let mut h = Sha256::init();

        let feed_z = |hp: &mut Sha256, s: Option<CStrRef<'_>>| {
            // Presence byte so null ≠ "" — both would otherwise feed only
            // the trailing 0. In practice "" usually fails create_ssl_context
            // and never caches, but injectivity is cheap to guarantee.
            hp.update(&[s.is_some() as u8]);
            if let Some(s) = s {
                hp.update(s.to_cstr().to_bytes());
            }
            hp.update(&[0]); // terminator so {a:"xy"} ≠ {a:"x",b:"y"}
        };

        let feed_arr = |hp: &mut Sha256, arr: CStrArray<'_>| {
            hp.update(&[(!arr.ptr.is_null()) as u8]);
            hp.update(bun_core::bytes_of(&(arr.len as u32)));
            for s in arr.iter() {
                feed_z(hp, Some(s));
            }
            hp.update(&[0]);
        };

        // File-backed fields: feed path + (mtime, size) so an in-place cert
        // rotation produces a fresh digest. stat() is ~1µs and only runs when
        // the file form is used (Bun-specific; node:tls always passes inline
        // bytes). On stat failure we feed zeros — `create_ssl_context` will fail
        // on the same path and the entry never reaches the cache.
        let feed_path = |hp: &mut Sha256, s: Option<CStrRef<'_>>| {
            hp.update(&[s.is_some() as u8]);
            if let Some(s) = s {
                let path = bun_core::ZStr::from_cstr(s.to_cstr());
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
        feed_arr(&mut h, self.key);
        feed_arr(&mut h, self.cert);
        feed_arr(&mut h, self.ca);
        h.update(bun_core::bytes_of(&self.secure_options));
        h.update(bun_core::bytes_of(&self.ssl_min_version));
        h.update(bun_core::bytes_of(&self.ssl_max_version));
        h.update(bun_core::bytes_of(&self.reject_unauthorized));
        h.update(bun_core::bytes_of(&self.request_cert));
        h.update(bun_core::bytes_of(&self.client_renegotiation_limit));
        h.update(bun_core::bytes_of(&self.client_renegotiation_window));
        h.update(bun_core::bytes_of(&self.session_timeout));
        feed_arr(&mut h, self.crl);
        h.update(bun_core::bytes_of(&self.allow_partial_trust_chain));
        feed_z(&mut h, self.sigalgs);
        feed_z(&mut h, self.ecdh_curve);
        let mut out = [0u8; 32];
        h.final_(&mut out);
        out
    }

    /// Best-effort byte count of cert/key/CA material — fed into
    /// `SecureContext.memoryCost` so the GC sees the off-heap allocation.
    pub fn approx_cert_bytes(&self) -> usize {
        let sum = |arr: CStrArray<'_>| arr.iter().map(|s| s.to_cstr().count_bytes()).sum::<usize>();
        sum(self.key) + sum(self.cert) + sum(self.ca) + sum(self.crl)
    }
}

/// Thin SHA-256 wrapper over the raw `bun_boringssl_sys` FFI. No higher-tier
/// `bun_boringssl::Sha256` exists yet; this stays local until one does.
struct Sha256(core::mem::MaybeUninit<bun_boringssl_sys::SHA256_CTX>);
impl Sha256 {
    #[inline]
    fn init() -> Self {
        let mut ctx = core::mem::MaybeUninit::<bun_boringssl_sys::SHA256_CTX>::uninit();
        bun_boringssl_sys::SHA256_Init(&mut ctx);
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
        pub(crate) safe fn us_ssl_ctx_from_options(
            options: BunSocketContextOptions,
            err: &mut create_bun_socket_error_t,
        ) -> Option<OwnedSslCtx>;
        // safe: no args; reads a process-global counter — no preconditions.
        pub safe fn us_ssl_ctx_live_count() -> c_long;
        /// Appends the certificates in the NUL-terminated PEM `content` to
        /// `ctx`'s trust store; returns 0 when nothing could be added.
        pub fn us_ssl_ctx_add_ca_cert(
            ctx: *mut SSL_CTX,
            content: *const core::ffi::c_char,
        ) -> core::ffi::c_int;
        /// Parses a PKCS#12 blob into malloc'd PEM key/cert/ca strings (the
        /// caller frees them with libc free); returns 0 with a static
        /// `err_reason` tag on failure.
        pub fn us_ssl_parse_pkcs12(
            data: *const core::ffi::c_char,
            len: usize,
            pass: *const core::ffi::c_char,
            out_key: *mut *mut core::ffi::c_char,
            out_key_len: *mut usize,
            out_cert: *mut *mut core::ffi::c_char,
            out_cert_len: *mut usize,
            out_ca: *mut *mut core::ffi::c_char,
            out_ca_len: *mut usize,
            err_reason: *mut *const core::ffi::c_char,
        ) -> core::ffi::c_int;
    }
}
