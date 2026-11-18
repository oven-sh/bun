//! The certificates and keys of the user on Windows, in stores and on smart cards.

use core::ffi::{CStr, c_char, c_void};
use core::ptr::{null, null_mut};
use std::sync::OnceLock;

use bun_core::ZStr;

use super::library::library;
use super::tls::{Scheme, pair_in_der};
use crate::Bytes;

type Handle = *mut c_void;

/// `CERT_CONTEXT`
#[repr(C)]
struct Certificate {
    encoding: u32,
    bytes: *const u8,
    length: u32,
    info: *const Info,
}

/// `CERT_INFO`
#[repr(C)]
struct Info {
    before: [usize; 12],
    kind_of_key: *const c_char,
}

/// `CERT_CHAIN_CONTEXT` and `CERT_SIMPLE_CHAIN`
#[repr(C)]
struct List<T> {
    size: u32,
    status: [u32; 2],
    count: u32,
    items: *const *const T,
}

/// `CERT_CHAIN_ELEMENT`
#[repr(C)]
struct Element {
    size: u32,
    certificate: *const Certificate,
}

/// `BCRYPT_PSS_PADDING_INFO`, which starts with `BCRYPT_PKCS1_PADDING_INFO`.
#[repr(C)]
struct Padding {
    digest: *const u16,
    salt: u32,
}

library! {
    Stores b"crypt32.dll"
    CertOpenStore: fn(usize, u32, usize, u32, *const u16) -> Handle;
    CertCloseStore: fn(Handle, u32) -> i32;
    CertEnumCertificatesInStore: fn(Handle, *const Certificate) -> *const Certificate;
    CertDuplicateCertificateContext: fn(*const Certificate) -> *const Certificate;
    CertFreeCertificateContext: fn(*const Certificate) -> i32;
    CertGetCertificateContextProperty: fn(*const Certificate, u32, *mut c_void, &mut u32) -> i32;
    CertGetCertificateChain: fn(Handle, *const Certificate, *const c_void, Handle, &[usize; 4], u32, *const c_void, &mut *const List<List<Element>>) -> i32;
    CertFreeCertificateChain: fn(*const List<List<Element>>);
    CryptAcquireCertificatePrivateKey: fn(*const Certificate, u32, *const c_void, &mut usize, &mut u32, &mut i32) -> i32;
}

library! {
    Keys b"ncrypt.dll"
    NCryptSignHash: fn(usize, *const Padding, *const u8, u32, *mut u8, u32, &mut u32, u32) -> i32;
}

struct System {
    stores: Stores,
    keys: Keys,
}

fn system() -> Option<&'static System> {
    static SYSTEM: OnceLock<Option<System>> = OnceLock::new();
    let load = || {
        let (stores, keys) = Stores::open().zip(Keys::open())?;
        Some(System { stores, keys })
    };
    SYSTEM.get_or_init(load).as_ref()
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

const OF_USER: u32 = 1 << 16;

impl Certificate {
    fn der(&self) -> Bytes {
        // SAFETY: the system has made it.
        unsafe { core::slice::from_raw_parts(self.bytes, self.length as usize) }.into()
    }
}

impl<T> List<T> {
    fn items(&self) -> impl Iterator<Item = &T> {
        // SAFETY: as above.
        (0..self.count as usize).map(|at| unsafe { &**self.items.add(at) })
    }
}

impl System {
    fn visit(&self, place: u32, name: &str, mut each: impl FnMut(&Certificate)) {
        const BY_NAME: usize = 10;
        const EXISTING_AND_READ_ONLY: u32 = 0xc000;
        let (stores, how) = (&self.stores, place | EXISTING_AND_READ_ONLY);
        // SAFETY: a terminated string. Each step releases the certificate of the one before.
        unsafe {
            let store = (stores.CertOpenStore)(BY_NAME, 0, 0, how, wide(name).as_ptr());
            if store.is_null() {
                return;
            }
            let mut at = (stores.CertEnumCertificatesInStore)(store, null());
            while let Some(certificate) = at.as_ref() {
                each(certificate);
                at = (stores.CertEnumCertificatesInStore)(store, at);
            }
            (stores.CertCloseStore)(store, 0);
        }
    }

    fn chain(&self, certificate: &Certificate) -> Option<Vec<Bytes>> {
        // It would not go through the proxy.
        const WITHOUT_NETWORK: u32 = 0x2104;
        let (usage, mut found) = ([size_of::<[usize; 4]>(), 0, 0, 0], null());
        // SAFETY: what is null is optional, and the chain is read before it is released.
        unsafe {
            let made = (self.stores.CertGetCertificateChain)(
                null_mut(),
                certificate,
                null(),
                null_mut(),
                &usage,
                WITHOUT_NETWORK,
                null(),
                &mut found,
            );
            let first = found.as_ref().filter(|_| made != 0)?.items().next();
            let chain = first.map(|it| it.items().map(|it| (*it.certificate).der()).collect());
            (self.stores.CertFreeCertificateChain)(found);
            chain
        }
    }
}

/// They come with those of the system.
pub(super) fn trusted_authorities() -> Vec<Bytes> {
    Vec::new()
}

pub(super) fn distrusted() -> Vec<Bytes> {
    const OF_POLICY_FOR_USER: u32 = 7 << 16;
    let mut found = Vec::new();
    if let Some(system) = system() {
        // That of the user includes those of the machine.
        for place in [OF_USER, OF_POLICY_FOR_USER] {
            system.visit(place, "Disallowed", |it| found.push(it.der()));
        }
    }
    found
}

pub(super) fn version_of_trust() -> u64 {
    const KEPT_SECONDS: f64 = 60.;
    (crate::time::wall_now() / KEPT_SECONDS) as u64
}

pub(super) fn trusted_chain(_: &[Bytes], _: &[u8]) -> Option<Vec<Bytes>> {
    None
}

pub(super) fn import_pkcs12(_: &[u8], _: &ZStr) -> Option<()> {
    None
}

/// The certificate keeps the key once it has been asked for.
pub(super) struct Key(&'static System, *const Certificate);

// SAFETY: both libraries are thread safe.
unsafe impl Send for Key {}
// SAFETY: as above.
unsafe impl Sync for Key {}

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: it is ours.
        unsafe { (self.0.stores.CertFreeCertificateContext)(self.1) };
    }
}

/// Chains of certificates in the DER format, with the key of the first.
pub(super) fn identities() -> Vec<(Vec<Bytes>, Key)> {
    const WHERE_THE_KEY_IS: u32 = 2;
    let (Some(system), mut found) = (system(), Vec::new()) else {
        return Vec::new();
    };
    system.visit(OF_USER, "MY", |it| {
        let stores = &system.stores;
        // SAFETY: it only asks for the size, and the copy is released with the key.
        unsafe {
            if (stores.CertGetCertificateContextProperty)(it, WHERE_THE_KEY_IS, null_mut(), &mut 0)
                != 0
                && let Some(chain) = system.chain(it)
            {
                let copy = (stores.CertDuplicateCertificateContext)(it);
                found.push((chain, Key(system, copy)));
            }
        }
    });
    found
}

impl Key {
    fn handle(&self) -> Option<usize> {
        const KEPT_AND_ONLY_MODERN: u32 = 0x4_0001;
        let mut key = 0;
        // SAFETY: the certificate is alive.
        let found = unsafe {
            (self.0.stores.CryptAcquireCertificatePrivateKey)(
                self.1,
                KEPT_AND_ONLY_MODERN,
                null(),
                &mut key,
                &mut 0,
                &mut 0,
            )
        };
        (found != 0).then_some(key)
    }

    pub(super) fn supports(&self, scheme: Scheme, _: usize) -> bool {
        // SAFETY: the certificate is alive.
        let kind = unsafe { CStr::from_ptr((*(*self.1).info).kind_of_key) };
        kind == match scheme {
            Scheme::Ecdsa => c"1.2.840.10045.2.1",
            _ => c"1.2.840.113549.1.1.1",
        }
    }

    /// As TLS has it. The system may ask the user.
    pub(super) fn sign(&self, scheme: Scheme, digest: &[u8]) -> Option<Vec<u8>> {
        let (key, name) = (self.handle()?, wide(&format!("SHA{}", digest.len() * 8)));
        let padding = Padding {
            digest: name.as_ptr(),
            salt: digest.len() as u32,
        };
        let (padding, kind) = match scheme {
            Scheme::Pkcs1 => (&raw const padding, 2),
            Scheme::Pss => (&raw const padding, 8),
            Scheme::Ecdsa => (null(), 0),
        };
        let (mut signature, mut length) = (vec![0; 2048], 0);
        // SAFETY: buffers with their sizes.
        let status = unsafe {
            (self.0.keys.NCryptSignHash)(
                key,
                padding,
                digest.as_ptr(),
                digest.len() as u32,
                signature.as_mut_ptr(),
                signature.len() as u32,
                &mut length,
                kind,
            )
        };
        signature.truncate(length as usize);
        match scheme {
            _ if status != 0 => None,
            Scheme::Ecdsa => pair_in_der(&signature),
            _ => Some(signature),
        }
    }
}
