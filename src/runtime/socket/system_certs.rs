//! Where the Linux system certificate store lives, for `--use-system-ca` and
//! `tls.getCACertificates('system')`. This module only finds and reads the files; `root_certs_linux.cpp` does the
//! PEM and X.509 work in BoringSSL.
//!
//! Sources are the union of what Node's `GetOpenSSLSystemCertificates` reads — `$SSL_CERT_FILE` else OpenSSL's
//! default file, and every regular file in `$SSL_CERT_DIR` else OpenSSL's default directory, where a variable that is
//! set but empty turns its source off — and the well-known distro bundles and directories earlier Bun releases read,
//! so no layout trusts fewer CAs than before. Distros alias these heavily (Debian links every root two or three times
//! under /etc/ssl/certs and repeats them in the bundle; Fedora points four bundle paths at one file), so each file is
//! read once per inode, each directory walked once per inode, and the C++ side keeps one copy of each certificate.

use core::ffi::{c_char, c_void};

use bun_core::{ZBox, ZStr, env_var, strings};
use bun_sys::O;

/// Receives the contents of one candidate file.
type OnFile = unsafe extern "C" fn(ctx: *mut c_void, data: *const u8, len: usize);

#[cfg(not(target_os = "android"))]
const WELL_KNOWN_BUNDLES: &[&[u8]] = &[
    b"/etc/ssl/certs/ca-certificates.crt", // Debian/Ubuntu/Gentoo/Arch/NixOS
    b"/etc/pki/tls/certs/ca-bundle.crt",   // Fedora/RHEL 6
    b"/etc/ssl/ca-bundle.pem",             // openSUSE
    b"/etc/pki/tls/cert.pem",              // Fedora/RHEL 7+
    b"/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", // CentOS/RHEL 7+, Amazon Linux
    b"/etc/ssl/cert.pem",                  // Alpine, FreeBSD
    b"/usr/local/etc/openssl/cert.pem",
    b"/usr/local/share/ca-certificates/ca-certificates.crt",
];

#[cfg(not(target_os = "android"))]
const WELL_KNOWN_DIRS: &[&[u8]] = &[
    b"/etc/ssl/certs",
    b"/etc/pki/tls/certs",
    b"/usr/share/ca-certificates",
    b"/usr/local/share/certs",
    b"/etc/openssl/certs",
    b"/var/ssl/certs",
    b"/usr/local/etc/openssl/certs",
    b"/System/Library/OpenSSL/certs",
];

// Android has no OpenSSL layout: mainline store (API 30+), base store, user-installed store.
#[cfg(target_os = "android")]
const WELL_KNOWN_BUNDLES: &[&[u8]] = &[];
#[cfg(target_os = "android")]
const WELL_KNOWN_DIRS: &[&[u8]] = &[
    b"/apex/com.android.conscrypt/cacerts",
    b"/system/etc/security/cacerts",
    b"/data/misc/user/0/cacerts-added",
];

struct Loader {
    ctx: *mut c_void,
    on_file: OnFile,
    /// `(st_dev, st_ino)` of every file already read and every directory already walked.
    seen: bun_collections::HashMap<(u64, u64), ()>,
    buf: Vec<u8>,
}

impl Loader {
    fn first_visit(&mut self, st: &bun_sys::Stat) -> bool {
        self.seen
            .insert((st.st_dev as u64, st.st_ino as u64), ())
            .is_none()
    }

    /// No file-type check, as in Node, so `SSL_CERT_FILE` may name a pipe.
    fn load_file(&mut self, path: &ZStr) {
        let Ok(file) = bun_sys::File::open(path, O::RDONLY | O::CLOEXEC, 0) else {
            return;
        };
        if let Ok(st) = file.stat()
            && !self.first_visit(&st)
        {
            return;
        }
        self.buf.clear();
        if file.read_to_end_into(&mut self.buf).is_err() {
            return;
        }
        // SAFETY: `on_file` and `ctx` come from the C++ caller, which keeps `ctx` alive for the whole call.
        unsafe { (self.on_file)(self.ctx, self.buf.as_ptr(), self.buf.len()) };
    }

    /// Every regular file (after following links) directly in `dir_path`, in name order.
    fn load_directory(&mut self, dir_path: &[u8]) {
        let Ok(dir) = bun_sys::Dir::open(dir_path) else {
            return;
        };
        if let Ok(st) = bun_sys::fstat(dir.fd())
            && !self.first_visit(&st)
        {
            return;
        }
        let mut names: Vec<ZBox> = Vec::new();
        let mut entries = bun_sys::dir_iterator::iterate(dir.fd());
        while let Ok(Some(entry)) = entries.next() {
            names.push(ZBox::from_bytes(entry.name.slice_u8()));
        }
        names.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

        let mut path = Vec::with_capacity(dir_path.len() + 64);
        for name in &names {
            let Ok(st) = bun_sys::fstatat(dir.fd(), name) else {
                continue;
            };
            if !bun_sys::is_regular_file(st.st_mode as bun_sys::Mode)
                || self
                    .seen
                    .contains_key(&(st.st_dev as u64, st.st_ino as u64))
            {
                continue;
            }
            path.clear();
            path.extend_from_slice(dir_path);
            path.push(b'/');
            path.extend_from_slice(name.as_bytes());
            self.load_file(ZBox::from_bytes(&path).as_zstr());
        }
    }
}

/// Safety: `default_cert_file` and `default_cert_dir` must be valid NUL-terminated C strings, and `ctx` whatever
/// `on_file` expects for the duration of the call.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__loadSystemCertificateFiles(
    default_cert_file: *const c_char,
    default_cert_dir: *const c_char,
    ctx: *mut c_void,
    on_file: OnFile,
) {
    let mut loader = Loader {
        ctx,
        on_file,
        seen: bun_collections::HashMap::new(),
        buf: Vec::new(),
    };

    match env_var::SSL_CERT_FILE::get() {
        Some(b"") => {}
        Some(path) => loader.load_file(ZBox::from_bytes(path).as_zstr()),
        None => {
            // SAFETY: caller contract.
            loader.load_file(unsafe { ZStr::from_c_ptr(default_cert_file) });
            for path in WELL_KNOWN_BUNDLES {
                loader.load_file(ZBox::from_bytes(path).as_zstr());
            }
        }
    }

    match env_var::SSL_CERT_DIR::get() {
        // OpenSSL accepts several directories separated by ':' here.
        Some(dirs) => {
            for dir in strings::tokenize(dirs, b":") {
                loader.load_directory(dir);
            }
        }
        None => {
            #[cfg(target_os = "android")]
            let _ = default_cert_dir;
            #[cfg(not(target_os = "android"))]
            // SAFETY: caller contract.
            loader.load_directory(unsafe { ZStr::from_c_ptr(default_cert_dir) }.as_bytes());
            for dir in WELL_KNOWN_DIRS {
                loader.load_directory(dir);
            }
        }
    }
}
