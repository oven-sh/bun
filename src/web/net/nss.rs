//! The certificates and keys of the user, where Chromium has them on Linux.

use core::ffi::{c_char, c_int, c_uint, c_ulong, c_void};
use core::ptr::{null, null_mut};
use std::sync::OnceLock;

use bun_boringssl_sys::{EVP_PKEY, X509, i2d_X509};
use bun_core::{ZBox, ZStr};

use super::chain::{Cbs, OPENSSL_sk_free, OPENSSL_sk_new_null, X509_free, items};
use super::library::library;
use super::tls::Scheme;
use crate::Bytes;

type Handle = *mut c_void;

#[repr(C)]
struct Item {
    kind: c_int,
    data: *const u8,
    length: c_uint,
}

impl Item {
    fn new(bytes: &[u8]) -> Item {
        Item {
            kind: 0,
            data: bytes.as_ptr(),
            length: bytes.len() as c_uint,
        }
    }

    /// # Safety
    /// What it points at is alive.
    unsafe fn copy(&self) -> Bytes {
        // SAFETY: up to the caller.
        unsafe { core::slice::from_raw_parts(self.data, self.length as usize) }.into()
    }
}

#[repr(C)]
struct Node {
    next: *const Node,
    previous: *const Node,
    certificate: Handle,
}

#[repr(C)]
struct Chain {
    certificates: *const Item,
    length: c_int,
}

#[repr(C)]
#[derive(Default)]
struct Trust {
    ssl: c_uint,
    email: c_uint,
    object_signing: c_uint,
}

const TERMINAL_RECORD: c_uint = 1;
const TRUSTED: c_uint = 1 << 1;
const VALID_CA: c_uint = 1 << 3;
const TRUSTED_CA: c_uint = 1 << 4;

library! {
    Library b"libnss3.so"
    NSS_InitReadWrite: fn(*const c_char) -> c_int;
    PK11_GetInternalKeySlot: fn() -> Handle;
    PK11_FreeSlot: fn(Handle);
    PK11_NeedUserInit: fn(Handle) -> c_int;
    PK11_InitPin: fn(Handle, *const c_char, *const c_char) -> c_int;
    PK11_ListCerts: fn(c_int, Handle) -> *mut Node;
    CERT_DestroyCertList: fn(*mut Node);
    CERT_GetCertificateDer: fn(Handle, &mut Item) -> c_int;
    CERT_GetCertTrust: fn(Handle, &mut Trust) -> c_int;
    CERT_ChangeCertTrust: fn(Handle, Handle, &Trust) -> c_int;
    CERT_GetDefaultCertDB: fn() -> Handle;
    CERT_FindCertByDERCert: fn(Handle, &Item) -> Handle;
    CERT_DestroyCertificate: fn(Handle);
    CERT_CertChainFromCert: fn(Handle, c_int, c_int) -> *mut Chain;
    CERT_DestroyCertificateList: fn(*mut Chain);
    PK11_FindKeyByAnyCert: fn(Handle, Handle) -> Handle;
    SECKEY_DestroyPrivateKey: fn(Handle);
    SECKEY_GetPrivateKeyType: fn(Handle) -> c_int;
    PK11_SignatureLen: fn(Handle) -> c_int;
    PK11_SignWithMechanism: fn(Handle, c_ulong, *const Item, &mut Item, &Item) -> c_int;
    PK11_ImportDERPrivateKeyInfo: fn(Handle, &Item, *const Item, *const Item, c_int, c_int, c_uint, Handle) -> c_int;
    PK11_ImportDERCert: fn(Handle, &Item, c_ulong, *const c_char, c_int) -> c_int;
}

fn database(creates: bool) -> Option<Vec<u8>> {
    let directory = [bun_core::env_var::HOME.get()?, b"/.pki/nssdb"].concat();
    if creates {
        bun_sys::mkdir_recursive_at_mode(bun_sys::Fd::cwd(), &directory, 0o700).ok()?;
    }
    bun_sys::exists(&directory).then_some(directory)
}

fn library(creates_database: bool) -> Option<&'static Library> {
    static LIBRARY: OnceLock<Option<Library>> = OnceLock::new();
    let name = ZBox::from_bytes([b"sql:", &*database(creates_database)?].concat());
    let load = || {
        let Some(library) = Library::open() else {
            bun_core::warn!("The certificates of the user are not used: cannot load libnss3.so");
            return None;
        };
        // SAFETY: called once, with a terminated string.
        unsafe {
            ((library.NSS_InitReadWrite)(name.as_ptr()) == 0).then_some(())?;
            let slot = (library.PK11_GetInternalKeySlot)();
            if (library.PK11_NeedUserInit)(slot) != 0 {
                (library.PK11_InitPin)(slot, null(), null());
            }
            (library.PK11_FreeSlot)(slot);
        }
        Some(library)
    };
    LIBRARY.get_or_init(load).as_ref()
}

fn each_certificate<T>(
    kind: c_int,
    mut convert: impl FnMut(&'static Library, Handle) -> Option<T>,
) -> Vec<T> {
    let (Some(library), mut found) = (library(false), Vec::new()) else {
        return Vec::new();
    };
    // SAFETY: a circular list whose head has the links of a node. It is not used after it is destroyed.
    unsafe {
        let list = (library.PK11_ListCerts)(kind, null_mut());
        if !list.is_null() {
            let mut node = (*list).next;
            while node != list.cast_const() {
                found.extend(convert(library, (*node).certificate));
                node = (*node).next;
            }
            (library.CERT_DestroyCertList)(list);
        }
    }
    found
}

/// In the DER format.
pub(super) fn trusted_authorities() -> Vec<Bytes> {
    const AUTHORITIES: c_int = 3;
    each_certificate(AUTHORITIES, |library, certificate| {
        let (mut trust, mut der) = (Trust::default(), Item::new(b""));
        // SAFETY: the list holds the certificate.
        unsafe {
            let is_trusted = (library.CERT_GetCertTrust)(certificate, &mut trust) == 0
                && trust.ssl & TRUSTED_CA != 0;
            (is_trusted && (library.CERT_GetCertificateDer)(certificate, &mut der) == 0)
                .then(|| der.copy())
        }
    })
}

pub(super) fn distrusted() -> Vec<Bytes> {
    const ALL: c_int = 6;
    each_certificate(ALL, |library, certificate| {
        let (mut trust, mut der) = (Trust::default(), Item::new(b""));
        // SAFETY: the list holds the certificate.
        unsafe {
            let is_distrusted = (library.CERT_GetCertTrust)(certificate, &mut trust) == 0
                && trust.ssl & (TERMINAL_RECORD | TRUSTED | TRUSTED_CA) == TERMINAL_RECORD;
            (is_distrusted && (library.CERT_GetCertificateDer)(certificate, &mut der) == 0)
                .then(|| der.copy())
        }
    })
}

pub(super) fn version_of_trust() -> u64 {
    let modified = || {
        let home = bun_core::env_var::HOME.get()?;
        let file = ZBox::from_bytes([home, b"/.pki/nssdb/cert9.db"].concat());
        let time = bun_sys::stat_mtime(&bun_sys::stat(&file).ok()?);
        Some(time.sec as u64 * 1_000_000_000 + time.nsec as u64)
    };
    modified().unwrap_or(0)
}

pub(super) fn trusted_chain(_: &[Bytes], _: &[u8]) -> Option<Vec<Bytes>> {
    None
}

pub(super) struct Key(&'static Library, Handle);

// SAFETY: NSS locks what it has to.
unsafe impl Send for Key {}
// SAFETY: as above.
unsafe impl Sync for Key {}

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: it is from the library, and is not used any more.
        unsafe { (self.0.SECKEY_DestroyPrivateKey)(self.1) };
    }
}

/// Chains of certificates in the DER format, with the key of the first.
pub(super) fn identities() -> Vec<(Vec<Bytes>, Key)> {
    const OF_USER: c_int = 1;
    const SSL_CLIENT: c_int = 0;
    each_certificate(OF_USER, |library, certificate| {
        // SAFETY: the list holds the certificate. The chain is not used after it is destroyed.
        unsafe {
            let key = Some((library.PK11_FindKeyByAnyCert)(certificate, null_mut()))
                .filter(|it| !it.is_null())
                .map(|it| Key(library, it))?;
            let chain = Some((library.CERT_CertChainFromCert)(certificate, SSL_CLIENT, 0))
                .filter(|it| !it.is_null())?;
            let copies =
                core::slice::from_raw_parts((*chain).certificates, (*chain).length as usize)
                    .iter()
                    .map(|it| it.copy())
                    .collect();
            (library.CERT_DestroyCertificateList)(chain);
            Some((copies, key))
        }
    })
}

fn der_integer(number: &[u8]) -> Vec<u8> {
    let number = &number[number
        .iter()
        .take_while(|it| **it == 0)
        .count()
        .min(number.len() - 1)..];
    let padding: &[u8] = if number[0] >= 0x80 { &[0] } else { &[] };
    [
        &[2, (padding.len() + number.len()) as u8][..],
        padding,
        number,
    ]
    .concat()
}

impl Key {
    pub(super) fn supports(&self, scheme: Scheme, _: usize) -> bool {
        const RSA: c_int = 1;
        const CURVE: c_int = 6;
        // SAFETY: the key is alive.
        let kind = unsafe { (self.0.SECKEY_GetPrivateKeyType)(self.1) };
        kind == if scheme == Scheme::Ecdsa { CURVE } else { RSA }
    }

    /// As TLS has it.
    pub(super) fn sign(&self, scheme: Scheme, digest: &[u8]) -> Option<Vec<u8>> {
        match scheme {
            Scheme::Pss => self.sign_raw(scheme, digest),
            Scheme::Pkcs1 => {
                const SHA2: [u8; 8] = [0x60, 0x86, 0x48, 1, 0x65, 3, 4, 2];
                let (size, last_arc) = (digest.len() as u8, digest.len() as u8 / 16 - 1);
                let (start, end) = ([0x30, 17 + size, 0x30, 13, 6, 9], [last_arc, 5, 0, 4, size]);
                self.sign_raw(scheme, &[&start[..], &SHA2, &end, digest].concat())
            }
            Scheme::Ecdsa => {
                let raw = self.sign_raw(scheme, digest).filter(|it| it.len() >= 2)?;
                let (first, second) = raw.split_at(raw.len() / 2);
                let pair = [der_integer(first), der_integer(second)].concat();
                let long_form: &[u8] = if pair.len() >= 0x80 { &[0x81] } else { &[] };
                Some([&[0x30][..], long_form, &[pair.len() as u8], &pair].concat())
            }
        }
    }

    /// As PKCS #11 has it.
    fn sign_raw(&self, scheme: Scheme, input: &[u8]) -> Option<Vec<u8>> {
        let (hash, mask): (c_ulong, c_ulong) = match input.len() {
            32 => (0x250, 2),
            48 => (0x260, 3),
            _ => (0x270, 4),
        };
        let pss = [hash, mask, input.len() as c_ulong];
        let parameters = Item {
            kind: 0,
            data: pss.as_ptr().cast(),
            length: size_of_val(&pss) as c_uint,
        };
        let (mechanism, parameters) = match scheme {
            Scheme::Pkcs1 => (0x1, null()),
            Scheme::Pss => (0xd, &raw const parameters),
            Scheme::Ecdsa => (0x1041, null()),
        };
        // SAFETY: the key is alive, and the buffer is as long as the item says.
        unsafe {
            let mut signature = vec![0; usize::try_from((self.0.PK11_SignatureLen)(self.1)).ok()?];
            let mut output = Item {
                kind: 0,
                data: signature.as_mut_ptr(),
                length: signature.len() as c_uint,
            };
            ((self.0.PK11_SignWithMechanism)(
                self.1,
                mechanism,
                parameters,
                &mut output,
                &Item::new(input),
            ) == 0)
                .then_some(())?;
            signature.truncate(output.length as usize);
            Some(signature)
        }
    }
}

unsafe extern "C" {
    fn PKCS12_get_key_and_certs(
        key: &mut *mut EVP_PKEY,
        certificates: Handle,
        input: &mut Cbs,
        password: *const c_char,
    ) -> c_int;
    fn EVP_PKEY2PKCS8(key: *const EVP_PKEY) -> Handle;
    fn i2d_PKCS8_PRIV_KEY_INFO(info: Handle, out: *mut *mut u8) -> c_int;
    fn PKCS8_PRIV_KEY_INFO_free(info: Handle);
    fn EVP_PKEY_free(key: *mut EVP_PKEY);
    fn X509_check_private_key(certificate: *const X509, key: *const EVP_PKEY) -> c_int;
}

fn encoded(encode: impl Fn(*mut *mut u8) -> c_int) -> Vec<u8> {
    let mut bytes = vec![0; usize::try_from(encode(null_mut())).unwrap_or(0)];
    encode(&mut bytes.as_mut_ptr());
    bytes
}

/// The key, and the certificates with whether they are for it.
fn parse_pkcs12(file: &[u8], password: &ZStr) -> Option<(Vec<u8>, Vec<(Vec<u8>, bool)>)> {
    // SAFETY: what is allocated here is freed here, after its last use.
    unsafe {
        let (mut key, stack) = (null_mut(), OPENSSL_sk_new_null());
        let is_parsed = PKCS12_get_key_and_certs(
            &mut key,
            stack,
            &mut Cbs(file.as_ptr(), file.len()),
            password.as_ptr(),
        ) == 1
            && !key.is_null();
        let take = |certificate: *mut X509| {
            let taken = (
                encoded(|out| i2d_X509(certificate, out)),
                is_parsed && X509_check_private_key(certificate, key) == 1,
            );
            X509_free(certificate.cast());
            taken
        };
        let certificates = items(stack).map(|it| take(it.cast())).collect();
        OPENSSL_sk_free(stack);
        bun_boringssl_sys::ERR_clear_error();
        is_parsed.then_some(())?;
        let info = EVP_PKEY2PKCS8(key);
        let secret = encoded(|out| i2d_PKCS8_PRIV_KEY_INFO(info, out));
        PKCS8_PRIV_KEY_INFO_free(info);
        EVP_PKEY_free(key);
        Some((secret, certificates))
    }
}

/// The authorities that come with the certificate are trusted from now on.
pub(super) fn import_pkcs12(file: &[u8], password: &ZStr) -> Option<()> {
    const ALL_USES: c_uint = 0xff;
    let ((key, certificates), library) = (parse_pkcs12(file, password)?, library(true)?);
    // SAFETY: the arguments outlive the calls, and the handles are not used after they are freed.
    unsafe {
        let slot = (library.PK11_GetInternalKeySlot)();
        let mut status = (library.PK11_ImportDERPrivateKeyInfo)(
            slot,
            &Item::new(&key),
            null(),
            null(),
            1,
            1,
            ALL_USES,
            null_mut(),
        );
        for (der, is_own) in &certificates {
            let nickname = ZBox::from_bytes(format!("Imported {:016x}", bun_wyhash::hash(der)));
            status |= (library.PK11_ImportDERCert)(slot, &Item::new(der), 0, nickname.as_ptr(), 0);
            let imported = (library.CERT_FindCertByDERCert)(
                (library.CERT_GetDefaultCertDB)(),
                &Item::new(der),
            );
            if !imported.is_null() {
                if !is_own {
                    let trust = Trust {
                        ssl: VALID_CA | TRUSTED_CA,
                        email: VALID_CA,
                        object_signing: VALID_CA,
                    };
                    status |= (library.CERT_ChangeCertTrust)(
                        (library.CERT_GetDefaultCertDB)(),
                        imported,
                        &trust,
                    );
                }
                (library.CERT_DestroyCertificate)(imported);
            }
        }
        (library.PK11_FreeSlot)(slot);
        (status == 0).then_some(())
    }
}
