//! The system certificate store on Linux and the other non-Apple Unixes, for `--use-system-ca` and `tls.getCACertificates('system')`:
//! `us_load_system_certificates_posix`, called once per process from `root_certs.cpp`.
//!
//! Sources are the union of what Node's `GetOpenSSLSystemCertificates` reads — `$SSL_CERT_FILE` else OpenSSL's
//! default file, and every regular file in `$SSL_CERT_DIR` else OpenSSL's default directory, where a variable that is
//! set but empty turns its source off — and the well-known distro bundles and directories earlier Bun releases read,
//! so no layout trusts fewer CAs than before. Distros alias these heavily (Debian links every root two or three times
//! under /etc/ssl/certs and repeats them in the bundle; Fedora points four bundle paths at one file), so each file is
//! read once per inode, each directory walked once per inode, and each certificate kept once per DER encoding. PEM
//! framing and X.509 parsing stay in BoringSSL.

use core::ffi::{c_char, c_long, c_void};
use core::ptr;

use bun_boringssl_sys as boringssl;
use bun_core::{ZBox, ZStr, env_var, strings};
use bun_sys::O;

use super::cert_files;

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
    /// One per distinct certificate, in discovery order.
    certs: Vec<boringssl::OwnedCryptoBuffer>,
    /// `(st_dev, st_ino)` of every file already read and every directory already walked.
    seen: bun_collections::HashMap<(u64, u64), ()>,
    /// SHA-256 of every DER encoding already in `certs`.
    ders: bun_collections::HashMap<[u8; 32], ()>,
    buf: Vec<u8>,
}

impl Loader {
    /// As a `PEM_read_bio_X509` loop would: blocks of other types are skipped, and a block that does not decode or a
    /// CERTIFICATE that is not shaped like one ends the file. Nothing is parsed here: `PEM_bytes_read_bio` is that
    /// loop minus the ASN.1 parse, and the certificates go into an `X509_LAZY_CERT_SET`.
    fn load_pem(&mut self, pem: &[u8]) {
        let Some(bio) = boringssl::MemBio::new(pem) else {
            return;
        };
        while let Some(der) = next_certificate(&bio) {
            let mut digest = [0u8; 32];
            bun_sha_hmac::sha::hashers::SHA256::hash(&der, &mut digest);
            if self.ders.contains_key(&digest) {
                continue;
            }
            // SAFETY: it only reads `der`.
            if unsafe { boringssl::X509_LAZY_CERT_SET_can_index(der.as_ptr(), der.len()) } == 0 {
                break;
            }
            let Some(buf) = boringssl::OwnedCryptoBuffer::new(&der) else {
                break;
            };
            self.certs.push(buf);
            self.ders.insert(digest, ());
        }
        boringssl::ERR_clear_error();
    }

    fn first_visit(&mut self, st: &bun_sys::Stat) -> bool {
        self.seen
            .insert((st.st_dev as u64, st.st_ino as u64), ())
            .is_none()
    }

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
        let buf = core::mem::take(&mut self.buf);
        self.load_pem(&buf);
        self.buf = buf;
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

fn next_certificate(bio: &boringssl::MemBio<'_>) -> Option<boringssl::OpensslBytes> {
    let mut der: *mut u8 = ptr::null_mut();
    let mut der_len: c_long = 0;
    // SAFETY: `bio` is live. BoringSSL allocates `der_len` bytes or leaves `der` null.
    unsafe {
        boringssl::PEM_bytes_read_bio(
            &raw mut der,
            &raw mut der_len,
            ptr::null_mut(),
            c"CERTIFICATE".as_ptr(),
            bio.as_ptr(),
            Some(no_password),
            ptr::null_mut(),
        );
        boringssl::OpensslBytes::from_raw(der, der_len as usize)
    }
}

/// Never answers, so an encrypted PEM block fails instead of prompting the terminal.
extern "C" fn no_password(
    _buf: *mut c_char,
    _size: core::ffi::c_int,
    _rwflag: core::ffi::c_int,
    _u: *mut c_void,
) -> core::ffi::c_int {
    0
}

/// Returns the system store as a lazily-parsed set (NULL if empty or on error); the caller owns the reference.
#[unsafe(no_mangle)]
extern "C" fn us_load_system_certificates_posix() -> *mut boringssl::X509_LAZY_CERT_SET {
    let mut loader = Loader {
        certs: Vec::new(),
        seen: bun_collections::HashMap::new(),
        ders: bun_collections::HashMap::new(),
        buf: Vec::new(),
    };

    // The default store reads this file too, so `cert_files` reads it for both.
    // SAFETY: BoringSSL returns a static NUL-terminated string.
    let default_file = unsafe { ZStr::from_c_ptr(boringssl::X509_get_default_cert_file()) };
    cert_files::read_openssl_default_cert_file(default_file, |pem, stat| {
        if let Some(stat) = stat {
            loader.first_visit(stat);
        }
        loader.load_pem(pem);
    });
    if env_var::SSL_CERT_FILE::get().is_none() {
        for path in WELL_KNOWN_BUNDLES {
            // `default_file` is in this list, and a FIFO there cannot be opened a second time.
            if *path != default_file.as_bytes() {
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
            #[cfg(not(target_os = "android"))]
            // SAFETY: BoringSSL returns a static NUL-terminated string.
            loader.load_directory(
                unsafe { ZStr::from_c_ptr(boringssl::X509_get_default_cert_dir()) }.as_bytes(),
            );
            for dir in WELL_KNOWN_DIRS {
                loader.load_directory(dir);
            }
        }
    }

    if loader.certs.is_empty() {
        return ptr::null_mut();
    }
    // SAFETY: `certs` holds live buffers; the set takes its own reference to each.
    unsafe { boringssl::X509_LAZY_CERT_SET_new(loader.certs.as_ptr().cast(), loader.certs.len()) }
}
