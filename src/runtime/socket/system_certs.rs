//! The Linux system certificate store, read from the same places as Node's `--use-system-ca`
//! (`GetOpenSSLSystemCertificates` in Node's `src/crypto/crypto_context.cc`): `$SSL_CERT_FILE` or
//! `/etc/ssl/cert.pem`, plus every regular file in `$SSL_CERT_DIR` or `/etc/ssl/certs`.
//!
//! Distros link every root several times under `/etc/ssl/certs` next to the bundle, so a file is read once
//! per inode and a certificate is handed out once per DER encoding. `root_certs_linux.cpp` parses the DER.

use core::ffi::{c_char, c_void};

use bun_core::{ZBox, ZStr, env_var, strings};
use bun_sys::O;

/// Returns false when the bytes are not a certificate, which ends the file they came from.
type AddCertificate = unsafe extern "C" fn(ctx: *mut c_void, der: *const u8, len: usize) -> bool;

struct Loader {
    ctx: *mut c_void,
    add: AddCertificate,
    /// `(st_dev, st_ino)` of every file already read.
    files_read: bun_collections::HashMap<(u64, u64), ()>,
    /// The DER encoding of every certificate already handed out.
    certificates: bun_collections::HashMap<Vec<u8>, ()>,
}

impl Loader {
    /// Marks the file as read. Returns false when it was read before under another name.
    fn first_visit(&mut self, st: &bun_sys::Stat) -> bool {
        self.files_read
            .insert((st.st_dev as u64, st.st_ino as u64), ())
            .is_none()
    }

    /// No file type check, as in Node, so `SSL_CERT_FILE` can name a pipe.
    fn load_named_file(&mut self, path: &ZStr) {
        if let Ok(st) = bun_sys::stat(path)
            && !self.first_visit(&st)
        {
            return;
        }
        let Ok(file) = bun_sys::File::open(path, O::RDONLY | O::CLOEXEC, 0) else {
            return;
        };
        let mut bytes = Vec::new();
        if file.read_to_end_into(&mut bytes).is_err() {
            return;
        }
        self.load_pem(&bytes);
    }

    /// Every regular file in the directory, in name order.
    fn load_directory(&mut self, dir_path: &[u8]) {
        let Ok(dir) = bun_sys::Dir::open(dir_path) else {
            return;
        };
        let mut names: Vec<ZBox> = Vec::new();
        let mut entries = bun_sys::dir_iterator::iterate(dir.fd());
        while let Ok(Some(entry)) = entries.next() {
            names.push(ZBox::from_bytes(entry.name.slice_u8()));
        }
        names.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

        for name in &names {
            let Ok(st) = bun_sys::fstatat(dir.fd(), name) else {
                continue;
            };
            if !bun_sys::is_regular_file(st.st_mode as bun_sys::Mode) || !self.first_visit(&st) {
                continue;
            }
            let Ok(bytes) = bun_sys::File::read_from(dir.fd(), name.as_bytes()) else {
                continue;
            };
            self.load_pem(&bytes);
        }
    }

    /// Follows BoringSSL's `PEM_read_bio_X509`: other block names are skipped, and the file ends at the
    /// first block that would not parse (bad END line, headers, bad base64, rejected DER).
    fn load_pem(&mut self, bytes: &[u8]) {
        let mut lines = strings::split(bytes, b"\n").map(trim_trailing_space);
        loop {
            let name = loop {
                let Some(line) = lines.next() else {
                    return;
                };
                if let Some(rest) = line.strip_prefix(b"-----BEGIN ")
                    && let Some(name) = rest.strip_suffix(b"-----")
                {
                    break name;
                }
            };

            let mut section: Vec<u8> = Vec::new();
            let mut header_len: Option<usize> = None;
            let end_line = loop {
                let Some(line) = lines.next() else {
                    return;
                };
                if line.starts_with(b"-----END ") {
                    break line;
                }
                if line.is_empty() && header_len.is_none() {
                    header_len = Some(section.len());
                    continue;
                }
                section.extend_from_slice(line);
                section.push(b'\n');
            };
            let end_ok = end_line
                .strip_prefix(b"-----END ")
                .and_then(|rest| rest.strip_prefix(name))
                .is_some_and(|rest| rest == b"-----");
            if !end_ok {
                return;
            }

            if name != b"CERTIFICATE" && name != b"X509 CERTIFICATE" {
                continue;
            }
            let (header, body) = match header_len {
                Some(len) => section.split_at(len),
                None => (&[][..], &section[..]),
            };
            if !header.is_empty() {
                return;
            }
            let der = match bun_base64::decode_alloc(body) {
                Ok(der) if !der.is_empty() => der,
                _ => return,
            };
            if self.certificates.contains_key(der.as_slice()) {
                continue;
            }
            // SAFETY: `add` and `ctx` come from the C++ caller, which keeps `ctx` alive for the whole call.
            if !unsafe { (self.add)(self.ctx, der.as_ptr(), der.len()) } {
                return;
            }
            self.certificates.insert(der, ());
        }
    }
}

/// BoringSSL's PEM reader drops every trailing byte that is not above ' '.
fn trim_trailing_space(mut line: &[u8]) -> &[u8] {
    while let [rest @ .., last] = line
        && *last <= b' '
    {
        line = rest;
    }
    line
}

/// # Safety
/// `default_cert_file` and `default_cert_dir` must be valid NUL-terminated C strings.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__forEachSystemCertificate(
    default_cert_file: *const c_char,
    default_cert_dir: *const c_char,
    ctx: *mut c_void,
    add: AddCertificate,
) {
    let mut loader = Loader {
        ctx,
        add,
        files_read: bun_collections::HashMap::new(),
        certificates: bun_collections::HashMap::new(),
    };

    match env_var::SSL_CERT_FILE::get() {
        // SAFETY: caller contract guarantees a valid NUL-terminated string.
        None => loader.load_named_file(unsafe { ZStr::from_c_ptr(default_cert_file) }),
        Some(b"") => {}
        Some(path) => loader.load_named_file(ZBox::from_bytes(path).as_zstr()),
    }

    match env_var::SSL_CERT_DIR::get() {
        None => {
            #[cfg(target_os = "android")]
            {
                // Android has no OpenSSL layout: the mainline store (API 30+), the base store, then the
                // user-installed store.
                let _ = default_cert_dir;
                for dir in [
                    &b"/apex/com.android.conscrypt/cacerts"[..],
                    b"/system/etc/security/cacerts",
                    b"/data/misc/user/0/cacerts-added",
                ] {
                    loader.load_directory(dir);
                }
            }
            #[cfg(not(target_os = "android"))]
            {
                // SAFETY: caller contract guarantees a valid NUL-terminated string.
                loader.load_directory(unsafe { ZStr::from_c_ptr(default_cert_dir) }.as_bytes());
            }
        }
        // OpenSSL accepts several directories separated by ':' here.
        Some(dirs) => {
            for dir in strings::tokenize(dirs, b":") {
                loader.load_directory(dir);
            }
        }
    }
}
