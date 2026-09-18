//! File reads for the native CA loaders in `packages/bun-usockets/src/crypto/root_certs*.cpp`, which keep to the
//! BoringSSL side (PEM, X509) and take bytes from here rather than opening files themselves.

use core::ffi::{c_char, c_int, c_void};

use bun_core::{ZBox, ZStr, env_var};
use bun_sys::O;

/// Receives the whole contents of one file.
pub(crate) type OnFile = unsafe extern "C" fn(ctx: *mut c_void, data: *const u8, len: usize);

/// Reads all of `path` (which may be a pipe or device) and hands it to `on_file`. Returns 0, or the errno of the
/// failed open/read without calling `on_file`.
pub(crate) fn read_file_for(path: &ZStr, ctx: *mut c_void, on_file: OnFile) -> c_int {
    let file = match bun_sys::File::open(path, O::RDONLY | O::CLOEXEC, 0) {
        Ok(file) => file,
        Err(err) => return err.get_errno() as c_int,
    };
    let mut bytes = Vec::new();
    if let Err(err) = file.read_to_end_into(&mut bytes) {
        return err.get_errno() as c_int;
    }
    // SAFETY: the C++ caller keeps `ctx` valid for the duration of this call.
    unsafe { on_file(ctx, bytes.as_ptr(), bytes.len()) };
    0
}

/// `NODE_EXTRA_CA_CERTS` and friends: one named file.
///
/// # Safety
/// `path` must be a valid NUL-terminated C string; `ctx` whatever `on_file` expects.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__readCertificateFile(
    path: *const c_char,
    ctx: *mut c_void,
    on_file: OnFile,
) -> c_int {
    // SAFETY: caller contract.
    read_file_for(unsafe { ZStr::from_c_ptr(path) }, ctx, on_file)
}

/// A pipe or FIFO reads only once, so the first loader keeps its bytes for the other. Locked across `open(2)`.
static STREAMED_DEFAULT_CERT_FILE: bun_threading::Guarded<Option<&'static [u8]>> =
    bun_threading::Guarded::new(None);

/// Reads `$SSL_CERT_FILE`, else `default_path`, with no file-type check (as Node). Only a regular file has a `stat`.
pub(crate) fn read_openssl_default_cert_file(
    default_path: &ZStr,
    on_file: impl FnOnce(&[u8], Option<&bun_sys::Stat>),
) {
    let from_env;
    let path = match env_var::SSL_CERT_FILE::get() {
        Some(b"") => return,
        Some(path) => {
            from_env = ZBox::from_bytes(path);
            from_env.as_zstr()
        }
        None => default_path,
    };

    let streamed: &'static [u8] = {
        let mut kept = STREAMED_DEFAULT_CERT_FILE.lock();
        if let Some(bytes) = *kept {
            bytes
        } else {
            let Ok(file) = bun_sys::File::open(path, O::RDONLY | O::CLOEXEC, 0) else {
                return;
            };
            let stat = file.stat().ok();
            let mut bytes = Vec::new();
            if file.read_to_end_into(&mut bytes).is_err() {
                return;
            }
            if let Some(stat) =
                stat.filter(|stat| bun_sys::is_regular_file(stat.st_mode as bun_sys::Mode))
            {
                drop(kept);
                return on_file(&bytes, Some(&stat));
            }
            *kept.insert(Box::leak(bytes.into_boxed_slice()))
        }
    };
    on_file(streamed, None);
}

/// The file half of OpenSSL's `X509_STORE_set_default_paths`, for the default store.
///
/// # Safety
/// `default_path` must be a valid NUL-terminated C string; `ctx` whatever `on_file` expects.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__readOpenSSLDefaultCertFile(
    default_path: *const c_char,
    ctx: *mut c_void,
    on_file: OnFile,
) {
    // SAFETY: caller contract.
    let default_path = unsafe { ZStr::from_c_ptr(default_path) };
    read_openssl_default_cert_file(default_path, |bytes, _| {
        // SAFETY: the C++ caller keeps `ctx` valid for the duration of this call.
        unsafe { on_file(ctx, bytes.as_ptr(), bytes.len()) }
    });
}
