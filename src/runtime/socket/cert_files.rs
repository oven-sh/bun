//! File reads for the native CA loaders in `packages/bun-usockets/src/crypto/root_certs*.cpp`, which keep to the
//! BoringSSL side (PEM, X509) and take bytes from here rather than opening files themselves.

use core::ffi::{c_char, c_int, c_void};

use bun_core::{ZBox, ZStr, env_var, strings};
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
    hand_over(&bytes, ctx, on_file);
    0
}

fn hand_over(bytes: &[u8], ctx: *mut c_void, on_file: OnFile) {
    // SAFETY: the C++ caller keeps `ctx` valid for the duration of this call.
    unsafe { on_file(ctx, bytes.as_ptr(), bytes.len()) };
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
    read_openssl_default_cert_file(default_path, |bytes, _| hand_over(bytes, ctx, on_file));
}

/// The files of the directory half of OpenSSL's `X509_STORE_set_default_paths` that are named `<subject hash>.<n>`.
///
/// # Safety
/// `default_path` must be a valid NUL-terminated C string; `ctx` whatever `on_file` expects.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__readOpenSSLDefaultCertDir(
    default_path: *const c_char,
    ctx: *mut c_void,
    on_file: OnFile,
) {
    // SAFETY: caller contract.
    let default_path = unsafe { ZStr::from_c_ptr(default_path) };
    let dirs = env_var::SSL_CERT_DIR::get().unwrap_or(default_path.as_bytes());
    let without_waiting = if cfg!(unix) { O::NONBLOCK } else { 0 };
    let mut bytes = Vec::new();
    for path in strings::tokenize(dirs, if cfg!(windows) { b";" } else { b":" }) {
        let Ok(dir) = bun_sys::Dir::open(path) else {
            continue;
        };
        let mut entries = bun_sys::dir_iterator::iterate(dir.fd());
        while let Ok(Some(entry)) = entries.next() {
            let name = entry.name.slice_u8();
            let is_hashed = matches!(
                name.split_at_checked(8),
                Some((hash, [b'.', n @ ..]))
                    if hash.iter().all(u8::is_ascii_hexdigit) && n.iter().all(u8::is_ascii_digit)
            );
            if is_hashed
                && let Ok(file) = dir.open_file(name, O::RDONLY | O::CLOEXEC | without_waiting, 0)
            {
                bytes.clear();
                if file.read_to_end_into(&mut bytes).is_ok() {
                    hand_over(&bytes, ctx, on_file);
                }
            }
        }
    }
}
