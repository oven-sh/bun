//! File reads for the native CA loaders in `packages/bun-usockets/src/crypto/root_certs*.cpp`, which keep to the
//! BoringSSL side (PEM, X509) and take bytes from here rather than opening files themselves.

use core::ffi::{c_char, c_int, c_void};

use bun_core::{ZBox, ZStr, env_var, strings};
use bun_sys::{E, Error, O, Tag};

/// Receives the whole contents of one file.
pub(crate) type OnFile = unsafe extern "C" fn(ctx: *mut c_void, data: *const u8, len: usize);

/// Far more than a list of certificates takes. A device may never end.
const MAX_FILE_LEN: usize = 64 << 20;

/// Reads all of `file` as OpenSSL sees it, which takes each line, or 254 bytes of it, for a C string. An empty one is
/// the end of the file there. Here it is only an error within a block.
pub(crate) fn read_pem(file: &bun_sys::File, bytes: &mut Vec<u8>) -> bun_sys::Result<()> {
    loop {
        bytes.try_reserve(8192).map_err(|_| Error::oom())?;
        bun_core::vec::append_with(bytes, usize::MAX, |spare| file.read_all_buf(spare))?;
        if bytes.len() < bytes.capacity() {
            break;
        }
        if bytes.len() >= MAX_FILE_LEN {
            return Err(Error::from_code(E::EFBIG, Tag::read));
        }
    }
    if !strings::contains_char(bytes, 0) {
        return Ok(());
    }
    let all = core::mem::take(bytes);
    let mut rest = &all[..];
    while !rest.is_empty() {
        let max = rest.len().min(254);
        let len = strings::index_of_char_usize(&rest[..max], b'\n').map_or(max, |at| at + 1);
        let (piece, after) = rest.split_at(len);
        match strings::index_of_char_usize(piece, 0) {
            None => bytes.extend_from_slice(piece),
            Some(0) => bytes.extend_from_slice(b"-----END -\n"),
            Some(nul) => {
                bytes.extend_from_slice(&piece[..nul]);
                bytes.push(b'\n');
            }
        }
        rest = after;
    }
    Ok(())
}

/// Reads all of `path` (which may be a pipe or device) and hands it to `on_file`. Returns 0, or the errno of the
/// failed open/read without calling `on_file`.
pub(crate) fn read_file_for(path: &ZStr, ctx: *mut c_void, on_file: OnFile) -> c_int {
    let file = match bun_sys::File::open(path, O::RDONLY | O::CLOEXEC, 0) {
        Ok(file) => file,
        Err(err) => return err.get_errno() as c_int,
    };
    let mut bytes = Vec::new();
    if let Err(err) = read_pem(&file, &mut bytes) {
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
            if read_pem(&file, &mut bytes).is_err() {
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
