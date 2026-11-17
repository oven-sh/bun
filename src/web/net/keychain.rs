//! The certificates and keys of the user on macOS, in keychains and on smart cards.

use core::ffi::c_void;
use core::ptr::{null, null_mut};
use std::sync::OnceLock;

use bun_core::ZStr;

use super::library::library;
use super::tls::Scheme;
use crate::Bytes;

type Ref = *const c_void;

/// A variable with a reference, or a table of callbacks.
#[repr(transparent)]
struct Constant(Ref);

// SAFETY: it never changes.
unsafe impl Sync for Constant {}

library! {
    Foundation b"/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
    [kCFBooleanTrue kCFTypeArrayCallBacks kCFTypeDictionaryKeyCallBacks kCFTypeDictionaryValueCallBacks]
    CFRelease: fn(Ref);
    CFArrayCreate: fn(Ref, *const Ref, isize, &Constant) -> Ref;
    CFArrayGetCount: fn(Ref) -> isize;
    CFArrayGetValueAtIndex: fn(Ref, isize) -> Ref;
    CFDictionaryCreate: fn(Ref, *const Ref, *const Ref, isize, &Constant, &Constant) -> Ref;
    CFDictionaryGetValue: fn(Ref, Ref) -> Ref;
    CFEqual: fn(Ref, Ref) -> u8;
    CFNumberGetValue: fn(Ref, isize, &mut i32) -> u8;
    CFDataCreate: fn(Ref, *const u8, isize) -> Ref;
    CFDataGetBytePtr: fn(Ref) -> *const u8;
    CFDataGetLength: fn(Ref) -> isize;
    CFStringCreateWithBytes: fn(Ref, *const u8, isize, u32, u8) -> Ref;
}

library! {
    Security b"/System/Library/Frameworks/Security.framework/Security"
    [
        kSecClass kSecClassIdentity kSecMatchLimit kSecMatchLimitAll kSecReturnRef kSecAttrCanSign
        kSecPolicyOid kSecPolicyAppleSSL
        kSecKeyAlgorithmRSASignatureDigestPKCS1v15SHA256
        kSecKeyAlgorithmRSASignatureDigestPKCS1v15SHA384
        kSecKeyAlgorithmRSASignatureDigestPKCS1v15SHA512
        kSecKeyAlgorithmRSASignatureDigestPSSSHA256
        kSecKeyAlgorithmRSASignatureDigestPSSSHA384
        kSecKeyAlgorithmRSASignatureDigestPSSSHA512
        kSecKeyAlgorithmECDSASignatureDigestX962SHA256
        kSecKeyAlgorithmECDSASignatureDigestX962SHA384
        kSecKeyAlgorithmECDSASignatureDigestX962SHA512
    ]
    SecItemCopyMatching: fn(Ref, &mut Ref) -> i32;
    SecIdentityCopyCertificate: fn(Ref, &mut Ref) -> i32;
    SecIdentityCopyPrivateKey: fn(Ref, &mut Ref) -> i32;
    SecCertificateCopyData: fn(Ref) -> Ref;
    SecCertificateCreateWithData: fn(Ref, Ref) -> Ref;
    SecPolicyCreateSSL: fn(u8, Ref) -> Ref;
    SecPolicyCopyProperties: fn(Ref) -> Ref;
    SecTrustSettingsCopyCertificates: fn(u32, &mut Ref) -> i32;
    SecTrustSettingsCopyTrustSettings: fn(Ref, u32, &mut Ref) -> i32;
    SecTrustCreateWithCertificates: fn(Ref, Ref, &mut Ref) -> i32;
    SecTrustSetNetworkFetchAllowed: fn(Ref, u8) -> i32;
    SecTrustEvaluateWithError: fn(Ref, *mut Ref) -> bool;
    SecTrustGetTrustResult: fn(Ref, &mut u32) -> i32;
    SecTrustCopyCertificateChain: fn(Ref) -> Ref;
    SecKeyIsAlgorithmSupported: fn(Ref, isize, Ref) -> u8;
    SecKeyCreateSignature: fn(Ref, Ref, Ref, *mut Ref) -> Ref;
}

struct System {
    foundation: Foundation,
    security: Security,
}

fn system() -> Option<&'static System> {
    static SYSTEM: OnceLock<Option<System>> = OnceLock::new();
    let load = || {
        let opened = Foundation::open().zip(Security::open());
        if opened.is_none() {
            bun_core::warn!("The keychains are not used: cannot load Security.framework");
        }
        opened.map(|(foundation, security)| System {
            foundation,
            security,
        })
    };
    SYSTEM.get_or_init(load).as_ref()
}

/// A reference that is released.
struct Owned(&'static System, Ref);

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: it is ours.
        unsafe { (self.0.foundation.CFRelease)(self.1) };
    }
}

impl Owned {
    /// # Safety
    /// It is an array.
    unsafe fn items(&self) -> impl Iterator<Item = Ref> {
        let foundation = &self.0.foundation;
        // SAFETY: up to the caller.
        (0..unsafe { (foundation.CFArrayGetCount)(self.1) })
            // SAFETY: it has that many.
            .map(|at| unsafe { (foundation.CFArrayGetValueAtIndex)(self.1, at) })
    }

    /// # Safety
    /// It is data.
    unsafe fn bytes(&self) -> Vec<u8> {
        let foundation = &self.0.foundation;
        // SAFETY: up to the caller.
        unsafe {
            match (foundation.CFDataGetLength)(self.1) as usize {
                0 => Vec::new(),
                length => {
                    core::slice::from_raw_parts((foundation.CFDataGetBytePtr)(self.1), length)
                        .to_vec()
                }
            }
        }
    }
}

impl System {
    fn own(&'static self, it: Ref) -> Option<Owned> {
        (!it.is_null()).then(|| Owned(self, it))
    }

    fn own_result(&'static self, copy: impl FnOnce(&mut Ref) -> i32) -> Option<Owned> {
        let mut result = null();
        (copy(&mut result) == 0).then(|| self.own(result))?
    }

    fn data(&'static self, bytes: &[u8]) -> Option<Owned> {
        // SAFETY: it makes a copy.
        self.own(unsafe {
            (self.foundation.CFDataCreate)(null(), bytes.as_ptr(), bytes.len() as isize)
        })
    }

    fn string(&'static self, text: &[u8]) -> Option<Owned> {
        const UTF8: u32 = 0x0800_0100;
        let create = self.foundation.CFStringCreateWithBytes;
        // SAFETY: it makes a copy.
        self.own(unsafe { create(null(), text.as_ptr(), text.len() as isize, UTF8, 0) })
    }

    /// Whether what has been set in `domain` says to trust it for TLS or not to. `None` if it says neither.
    ///
    /// # Safety
    /// It is a certificate.
    unsafe fn is_trusted_in(&'static self, domain: u32, certificate: Ref) -> Option<bool> {
        const INT: isize = 9;
        const TRUST_ROOT: i32 = 1;
        const DENY: i32 = 3;
        const UNSPECIFIED: i32 = 4;
        let (foundation, security) = (&self.foundation, &self.security);
        // SAFETY: up to the caller. The settings are dictionaries with values of these types.
        unsafe {
            let settings = self.own_result(|it| {
                (security.SecTrustSettingsCopyTrustSettings)(certificate, domain, it)
            })?;
            let is_for_tls = |policy| {
                let properties = self.own((security.SecPolicyCopyProperties)(policy))?;
                let kind =
                    (foundation.CFDictionaryGetValue)(properties.1, security.kSecPolicyOid.0);
                Some(
                    !kind.is_null()
                        && (foundation.CFEqual)(kind, security.kSecPolicyAppleSSL.0) != 0,
                )
            };
            let mut verdicts = settings.items().map(|setting| {
                let get = |key: &[u8]| {
                    let value = (foundation.CFDictionaryGetValue)(setting, self.string(key)?.1);
                    (!value.is_null()).then_some(value)
                };
                let applies = get(b"kSecTrustSettingsApplication").is_none()
                    && get(b"kSecTrustSettingsPolicyString").is_none()
                    && get(b"kSecTrustSettingsPolicy")
                        .is_none_or(|it| is_for_tls(it) == Some(true));
                let mut result = TRUST_ROOT;
                if let Some(given) = get(b"kSecTrustSettingsResult") {
                    (foundation.CFNumberGetValue)(given, INT, &mut result);
                }
                (applies && result != UNSPECIFIED).then_some(result != DENY)
            });
            let first = verdicts.next();
            first.map_or(Some(true), |it| it.or_else(|| verdicts.flatten().next()))
        }
    }

    /// With whether somebody has said that one of them is to be trusted. Without `server` it is for a client.
    ///
    /// # Safety
    /// `certificates` is a certificate or an array of them.
    unsafe fn chain(
        &'static self,
        certificates: Ref,
        server: Option<&Owned>,
    ) -> Option<(Vec<Bytes>, bool)> {
        const PROCEED: u32 = 1;
        let security = &self.security;
        // SAFETY: up to the caller, and what is made here outlives the calls.
        unsafe {
            let policy = self.own((security.SecPolicyCreateSSL)(
                server.is_some().into(),
                server.map_or(null(), |it| it.1),
            ))?;
            let trust = self.own_result(|it| {
                (security.SecTrustCreateWithCertificates)(certificates, policy.1, it)
            })?;
            // It would not go through the proxy.
            (security.SecTrustSetNetworkFetchAllowed)(trust.1, 0);
            let mut result = 0;
            let is_trusted = (security.SecTrustEvaluateWithError)(trust.1, null_mut())
                && (security.SecTrustGetTrustResult)(trust.1, &mut result) == 0
                && result == PROCEED;
            let chain = self.own((security.SecTrustCopyCertificateChain)(trust.1))?;
            let copies = chain.items().map(|it| {
                let der = self.own((security.SecCertificateCopyData)(it))?;
                Some(der.bytes().into())
            });
            Some((copies.collect::<Option<_>>()?, is_trusted))
        }
    }

    fn identities(&'static self) -> Option<Owned> {
        let (foundation, security) = (&self.foundation, &self.security);
        let pairs = [
            (security.kSecClass, security.kSecClassIdentity),
            (security.kSecMatchLimit, security.kSecMatchLimitAll),
            (security.kSecReturnRef, foundation.kCFBooleanTrue),
            (security.kSecAttrCanSign, foundation.kCFBooleanTrue),
        ];
        let (keys, values) = (pairs.map(|it| it.0.0), pairs.map(|it| it.1.0));
        // SAFETY: both have that length.
        unsafe {
            let query = self.own((foundation.CFDictionaryCreate)(
                null(),
                keys.as_ptr(),
                values.as_ptr(),
                pairs.len() as isize,
                foundation.kCFTypeDictionaryKeyCallBacks,
                foundation.kCFTypeDictionaryValueCallBacks,
            ))?;
            self.own_result(|it| (security.SecItemCopyMatching)(query.1, it))
        }
    }
}

/// They come with those of the system.
pub(super) fn trusted_authorities() -> Vec<Bytes> {
    Vec::new()
}

/// What the user says comes before what an administrator says.
pub(super) fn distrusted() -> Vec<Bytes> {
    const USER_AND_ADMINISTRATOR: [u32; 2] = [0, 1];
    let (Some(system), mut found) = (system(), Vec::new()) else {
        return Vec::new();
    };
    let security = &system.security;
    for domain in USER_AND_ADMINISTRATOR {
        // SAFETY: it is an array of certificates.
        unsafe {
            let listed =
                system.own_result(|it| (security.SecTrustSettingsCopyCertificates)(domain, it));
            for certificate in listed.iter().flat_map(|it| it.items()) {
                let mut verdicts = USER_AND_ADMINISTRATOR.into_iter();
                if verdicts.find_map(|it| system.is_trusted_in(it, certificate)) == Some(false) {
                    let der = system.own((security.SecCertificateCopyData)(certificate));
                    found.extend(der.map(|it| it.bytes().into()));
                }
            }
        }
    }
    found
}

pub(super) fn version_of_trust() -> u64 {
    const KEPT_SECONDS: f64 = 60.;
    (crate::time::wall_now() / KEPT_SECONDS) as u64
}

pub(super) fn import_pkcs12(_: &[u8], _: &ZStr) -> Option<()> {
    None
}

/// The chain from the first of `sent` to what the user or an administrator trusts for `hostname`.
pub(super) fn trusted_chain(sent: &[Bytes], hostname: &[u8]) -> Option<Vec<Bytes>> {
    let system = system()?;
    let (foundation, security) = (&system.foundation, &system.security);
    // SAFETY: the arguments outlive the calls.
    unsafe {
        let parsed = sent.iter().map(|it| {
            let der = system.data(it)?;
            system.own((security.SecCertificateCreateWithData)(null(), der.1))
        });
        let parsed = parsed.collect::<Option<Vec<_>>>()?;
        let references: Vec<_> = parsed.iter().map(|it| it.1).collect();
        let certificates = system.own((foundation.CFArrayCreate)(
            null(),
            references.as_ptr(),
            references.len() as isize,
            foundation.kCFTypeArrayCallBacks,
        ))?;
        let server = system.string(hostname)?;
        let (chain, is_trusted) = system.chain(certificates.1, Some(&server))?;
        is_trusted.then_some(chain)
    }
}

pub(super) struct Key(Owned);

// SAFETY: Security.framework is thread safe.
unsafe impl Send for Key {}
// SAFETY: as above.
unsafe impl Sync for Key {}

/// Chains of certificates in the DER format, with the key of the first.
pub(super) fn identities() -> Vec<(Vec<Bytes>, Key)> {
    let Some(found) = system().and_then(System::identities) else {
        return Vec::new();
    };
    let (system, security) = (found.0, &found.0.security);
    // SAFETY: an array of identities is what was asked for.
    unsafe {
        let parts = found.items().filter_map(|identity| {
            let certificate =
                system.own_result(|it| (security.SecIdentityCopyCertificate)(identity, it))?;
            let key = system.own_result(|it| (security.SecIdentityCopyPrivateKey)(identity, it))?;
            Some((system.chain(certificate.1, None)?.0, Key(key)))
        });
        parts.collect()
    }
}

impl Key {
    fn algorithm(&self, scheme: Scheme, digest_length: usize) -> Ref {
        let it = &self.0.0.security;
        let by_length = match scheme {
            Scheme::Pkcs1 => [
                it.kSecKeyAlgorithmRSASignatureDigestPKCS1v15SHA256,
                it.kSecKeyAlgorithmRSASignatureDigestPKCS1v15SHA384,
                it.kSecKeyAlgorithmRSASignatureDigestPKCS1v15SHA512,
            ],
            Scheme::Pss => [
                it.kSecKeyAlgorithmRSASignatureDigestPSSSHA256,
                it.kSecKeyAlgorithmRSASignatureDigestPSSSHA384,
                it.kSecKeyAlgorithmRSASignatureDigestPSSSHA512,
            ],
            Scheme::Ecdsa => [
                it.kSecKeyAlgorithmECDSASignatureDigestX962SHA256,
                it.kSecKeyAlgorithmECDSASignatureDigestX962SHA384,
                it.kSecKeyAlgorithmECDSASignatureDigestX962SHA512,
            ],
        };
        by_length[digest_length / 16 - 2].0
    }

    pub(super) fn supports(&self, scheme: Scheme, digest_length: usize) -> bool {
        const SIGN: isize = 0;
        let (Owned(system, key), algorithm) = (&self.0, self.algorithm(scheme, digest_length));
        // SAFETY: the key is alive.
        unsafe { (system.security.SecKeyIsAlgorithmSupported)(*key, SIGN, algorithm) != 0 }
    }

    /// As TLS has it. The system may ask the user.
    pub(super) fn sign(&self, scheme: Scheme, digest: &[u8]) -> Option<Vec<u8>> {
        let (Owned(system, key), algorithm) = (&self.0, self.algorithm(scheme, digest.len()));
        let digest = system.data(digest)?;
        // SAFETY: the arguments outlive the call, whose result is data.
        unsafe {
            let signature = system.own((system.security.SecKeyCreateSignature)(
                *key,
                algorithm,
                digest.1,
                null_mut(),
            ))?;
            Some(signature.bytes())
        }
    }
}
