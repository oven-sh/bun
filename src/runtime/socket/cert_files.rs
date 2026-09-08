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

/// The file half of OpenSSL's `X509_STORE_set_default_paths`: `$SSL_CERT_FILE`, else `default_path`
/// (`X509_get_default_cert_file()`). A variable that is set but empty names no file. Failures are silent, as there.
///
/// # Safety
/// `default_path` must be a valid NUL-terminated C string; `ctx` whatever `on_file` expects.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__readOpenSSLDefaultCertFile(
    default_path: *const c_char,
    ctx: *mut c_void,
    on_file: OnFile,
) {
    match env_var::SSL_CERT_FILE::get() {
        Some(b"") => {}
        Some(path) => {
            let _ = read_file_for(ZBox::from_bytes(path).as_zstr(), ctx, on_file);
        }
        None => {
            // SAFETY: caller contract.
            let _ = read_file_for(unsafe { ZStr::from_c_ptr(default_path) }, ctx, on_file);
        }
    }
}
