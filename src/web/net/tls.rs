//! Certificates of clients.

use core::ffi::{c_int, c_long, c_void};
use core::ptr::null_mut;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use bun_boringssl_sys::{
    EVP_MD, OwnedX509, SSL, SSL_get_ex_data, SSL_set_ex_data, X509, X509_NAME,
};
use bun_core::ZStr;
use bun_http::browser::peer_certificate;
use bun_http::{CertificateInfo, HTTPThread};
use bun_threading::Guarded;

use crate::{Bytes, exec};

#[cfg(target_os = "macos")]
use super::keychain as store;
#[cfg(target_os = "linux")]
use super::nss as store;

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod store {
    use super::{Bytes, Scheme, ZStr};

    pub(super) enum Key {}

    impl Key {
        pub(super) fn supports(&self, _: Scheme, _: usize) -> bool {
            match *self {}
        }

        pub(super) fn sign(&self, _: Scheme, _: &[u8]) -> Option<Vec<u8>> {
            match *self {}
        }
    }

    pub(super) fn identities() -> Vec<(Vec<Bytes>, Key)> {
        Vec::new()
    }

    pub(super) fn trusted_authorities() -> Vec<Bytes> {
        Vec::new()
    }

    pub(super) fn distrusted() -> Vec<Bytes> {
        Vec::new()
    }

    pub(super) fn version_of_trust() -> u64 {
        0
    }

    pub(super) fn trusted_chain(_: &[Bytes], _: &[u8]) -> Option<Vec<Bytes>> {
        None
    }

    pub(super) fn import_pkcs12(_: &[u8], _: &ZStr) -> Option<()> {
        None
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Scheme {
    Pkcs1,
    Pss,
    Ecdsa,
}

/// With the length of the digest.
const ALGORITHMS: [(u16, Scheme, usize); 9] = [
    (0x0804, Scheme::Pss, 32),
    (0x0805, Scheme::Pss, 48),
    (0x0806, Scheme::Pss, 64),
    (0x0401, Scheme::Pkcs1, 32),
    (0x0501, Scheme::Pkcs1, 48),
    (0x0601, Scheme::Pkcs1, 64),
    (0x0403, Scheme::Ecdsa, 32),
    (0x0503, Scheme::Ecdsa, 48),
    (0x0603, Scheme::Ecdsa, 64),
];

pub struct ClientIdentity {
    /// In the DER format.
    pub chain: Vec<Bytes>,
    key: store::Key,
    algorithms: Vec<u16>,
}

type Buffer = c_void;

#[repr(C)]
struct KeyMethod {
    sign:
        unsafe extern "C" fn(*mut SSL, *mut u8, *mut usize, usize, u16, *const u8, usize) -> c_int,
    decrypt: Option<unsafe extern "C" fn()>,
    complete: unsafe extern "C" fn(*mut SSL, *mut u8, *mut usize, usize) -> c_int,
}

type FreeData =
    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void, c_int, c_long, *mut c_void);

unsafe extern "C" {
    fn SSL_get_ex_new_index(
        argl: c_long,
        argp: *mut c_void,
        unused: *mut c_void,
        dup: *mut c_void,
        free: Option<FreeData>,
    ) -> c_int;
    fn SSL_set_cert_cb(
        ssl: &mut SSL,
        callback: unsafe extern "C" fn(*mut SSL, *mut c_void) -> c_int,
        argument: *mut c_void,
    );
    fn SSL_set_info_callback(
        ssl: &mut SSL,
        callback: unsafe extern "C" fn(*const SSL, c_int, c_int),
    );
    fn SSL_total_renegotiations(ssl: *const SSL) -> c_int;
    fn SSL_get0_peer_certificates(ssl: *const SSL) -> *const c_void;
    fn SSL_get0_server_requested_CAs(ssl: *const SSL) -> *const c_void;
    fn SSL_set_chain_and_key(
        ssl: *mut SSL,
        chain: *const *mut Buffer,
        length: usize,
        key: *mut c_void,
        method: &'static KeyMethod,
    ) -> c_int;
    fn SSL_set_signing_algorithm_prefs(
        ssl: *mut SSL,
        algorithms: *const u16,
        length: usize,
    ) -> c_int;
    safe fn SSL_get_signature_algorithm_digest(algorithm: u16) -> Option<&'static EVP_MD>;
    fn CRYPTO_BUFFER_new(data: *const u8, length: usize, pool: *mut c_void) -> *mut Buffer;
    fn CRYPTO_BUFFER_free(buffer: *mut Buffer);
    fn CRYPTO_BUFFER_data(buffer: *const Buffer) -> *const u8;
    fn CRYPTO_BUFFER_len(buffer: *const Buffer) -> usize;
    fn OPENSSL_sk_num(stack: *const c_void) -> usize;
    fn OPENSSL_sk_value(stack: *const c_void, at: usize) -> *mut c_void;
    safe fn X509_get_issuer_name(certificate: &X509) -> *mut X509_NAME;
    fn X509_NAME_get0_der(name: *mut X509_NAME, der: &mut *const u8, length: &mut usize) -> c_int;
    safe fn X509_get0_notBefore(certificate: &X509) -> *const c_void;
    safe fn X509_get0_notAfter(certificate: &X509) -> *const c_void;
    safe fn X509_get_key_usage(certificate: &X509) -> u32;
    safe fn X509_get_extended_key_usage(certificate: &X509) -> u32;
    fn X509_cmp_current_time(time: *const c_void) -> c_int;
}

fn is_issued_by(certificate: &X509, authorities: &[Bytes]) -> bool {
    let (mut name, mut length) = (core::ptr::null(), 0);
    // SAFETY: the certificate owns the name.
    unsafe {
        X509_NAME_get0_der(X509_get_issuer_name(certificate), &mut name, &mut length) == 1
            && authorities
                .iter()
                .any(|it| **it == *core::slice::from_raw_parts(name, length))
    }
}

fn is_valid_now(certificate: &X509) -> bool {
    // SAFETY: the certificate owns the times.
    unsafe {
        X509_cmp_current_time(X509_get0_notBefore(certificate)) < 0
            && X509_cmp_current_time(X509_get0_notAfter(certificate)) > 0
    }
}

fn is_for_clients(certificate: &X509) -> bool {
    const DIGITAL_SIGNATURE: u32 = 0x80;
    const CLIENT_OR_ANY: u32 = 0x102;
    X509_get_key_usage(certificate) & DIGITAL_SIGNATURE != 0
        && X509_get_extended_key_usage(certificate) & CLIENT_OR_ANY != 0
}

/// Blocks. No `authorities` means any.
pub(super) fn identities_for(authorities: &[Bytes]) -> Vec<Arc<ClientIdentity>> {
    let fits = |chain: &[Bytes]| {
        let parsed: Vec<_> = chain
            .iter()
            .filter_map(|it| OwnedX509::from_der(it))
            .collect();
        (parsed.first()).is_some_and(|it| is_valid_now(it) && is_for_clients(it))
            && (authorities.is_empty() || parsed.iter().any(|it| is_issued_by(it, authorities)))
    };
    store::identities()
        .into_iter()
        .filter(|it| fits(&it.0))
        .map(|(chain, key)| {
            let supported = ALGORITHMS.iter().filter(|it| key.supports(it.1, it.2));
            Arc::new(ClientIdentity {
                algorithms: supported.map(|it| it.0).collect(),
                chain,
                key,
            })
        })
        .collect()
}

/// Those that the user has added, in the PEM format.
pub(super) fn authorities_of_user() -> impl Iterator<Item = Bytes> {
    store::trusted_authorities().into_iter().map(|der| {
        let lines = bun_base64::encode_alloc(&der)
            .chunks(64)
            .collect::<Vec<_>>()
            .join(&b'\n');
        [
            b"-----BEGIN CERTIFICATE-----\n",
            &*lines,
            b"\n-----END CERTIFICATE-----\n",
        ]
        .concat()
        .into()
    })
}

/// Blocks.
pub(super) fn chain_of_system(sent: &[Bytes], hostname: &[u8]) -> Option<Vec<Bytes>> {
    store::trusted_chain(sent, hostname)
}

/// Blocks.
pub(super) fn distrusted() -> Vec<Bytes> {
    store::distrusted()
}

/// [`distrusted`] stays the same while this does.
pub(super) fn version_of_trust() -> u64 {
    store::version_of_trust()
}

/// Blocks.
pub fn import_pkcs12(file: &[u8], password: &ZStr) -> bool {
    store::import_pkcs12(file, password).is_some()
}

impl ClientIdentity {
    fn sign(&self, algorithm: u16, message: &[u8]) -> Option<Vec<u8>> {
        let (mut digest, mut length) = ([0; 64], 0);
        let hash = SSL_get_signature_algorithm_digest(algorithm)?;
        // SAFETY: there is room for any digest.
        unsafe {
            bun_boringssl_sys::EVP_Digest(
                message.as_ptr().cast(),
                message.len(),
                digest.as_mut_ptr(),
                &raw mut length,
                hash,
                null_mut(),
            )
        };
        let scheme = ALGORITHMS.iter().find(|it| it.0 == algorithm)?.1;
        self.key.sign(scheme, &digest[..length as usize])
    }
}

/// What to do when the server asks for a certificate.
#[derive(Clone)]
pub(super) enum Choice {
    Undecided,
    Nothing,
    /// For the server with that certificate, which the app has accepted, or else with any valid one.
    Identity(Arc<ClientIdentity>, Option<Bytes>),
}

pub(super) struct CertificateRequest {
    pub authorities: Vec<Bytes>,
    pub server: CertificateInfo,
    pub sent: Vec<Bytes>,
}

pub(super) struct Handshake {
    choice: Choice,
    hostname: Bytes,
    keeps_certificates: bool,
    pub request: Guarded<Option<CertificateRequest>>,
    /// What the server has sent.
    pub certificates: Guarded<Vec<Bytes>>,
    /// For the HTTP thread.
    pub request_id: AtomicU32,
    /// `None` until the key has answered.
    signature: Arc<Guarded<Option<Option<Vec<u8>>>>>,
}

fn data_index() -> c_int {
    unsafe extern "C" fn free(
        _: *mut c_void,
        data: *mut c_void,
        _: *mut c_void,
        _: c_int,
        _: c_long,
        _: *mut c_void,
    ) {
        if !data.is_null() {
            // SAFETY: the reference that `install` has stored.
            drop(unsafe { Arc::from_raw(data.cast::<Handshake>()) });
        }
    }
    static INDEX: OnceLock<c_int> = OnceLock::new();
    *INDEX.get_or_init(|| new_data_index(Some(free)))
}

pub(super) fn new_data_index(free: Option<FreeData>) -> c_int {
    // SAFETY: what is null is optional.
    unsafe { SSL_get_ex_new_index(0, null_mut(), null_mut(), null_mut(), free) }
}

unsafe extern "C" fn sign(
    ssl: *mut SSL,
    out: *mut u8,
    length: *mut usize,
    room: usize,
    algorithm: u16,
    message: *const u8,
    size: usize,
) -> c_int {
    // SAFETY: `install` has stored the data, and BoringSSL passes buffers of these sizes.
    unsafe {
        let handshake = &*SSL_get_ex_data(ssl, data_index()).cast::<Handshake>();
        let Choice::Identity(identity, _) = &handshake.choice else {
            return FAILURE;
        };
        let message = core::slice::from_raw_parts(message, size);
        // Nothing would take it up again.
        if SSL_total_renegotiations(ssl) > 0 {
            *handshake.signature.lock() = Some(identity.sign(algorithm, message));
            return complete(ssl, out, length, room);
        }
        let (identity, signature) = (Arc::clone(identity), Arc::clone(&handshake.signature));
        let (message, id) = (
            message.to_vec(),
            handshake.request_id.load(Ordering::Relaxed),
        );
        drop(exec::blocking(move || {
            let made = identity.sign(algorithm, &message);
            *signature.lock() = Some(made);
            HTTPThread::schedule_cert_check_resume(id);
        }));
    }
    RETRY
}

const SUCCESS: c_int = 0;
const RETRY: c_int = 1;
const FAILURE: c_int = 2;

unsafe extern "C" fn complete(
    ssl: *mut SSL,
    out: *mut u8,
    length: *mut usize,
    room: usize,
) -> c_int {
    // SAFETY: as in `sign`.
    unsafe {
        let handshake = &*SSL_get_ex_data(ssl, data_index()).cast::<Handshake>();
        let Some(signature) = handshake.signature.lock().take() else {
            return RETRY;
        };
        let Some(signature) = signature.filter(|it| it.len() <= room) else {
            return FAILURE;
        };
        out.copy_from_nonoverlapping(signature.as_ptr(), signature.len());
        *length = signature.len();
    }
    SUCCESS
}

/// # Safety
/// It is null or a stack of buffers.
unsafe fn copies(stack: *const c_void) -> Vec<Bytes> {
    // SAFETY: up to the caller.
    unsafe {
        let copy = |it: *mut Buffer| {
            core::slice::from_raw_parts(CRYPTO_BUFFER_data(it), CRYPTO_BUFFER_len(it)).into()
        };
        (0..OPENSSL_sk_num(stack))
            .map(|at| copy(OPENSSL_sk_value(stack, at)))
            .collect()
    }
}

unsafe extern "C" fn certificate_requested(ssl: *mut SSL, data: *mut c_void) -> c_int {
    static METHOD: KeyMethod = KeyMethod {
        sign,
        decrypt: None,
        complete,
    };
    // SAFETY: `ssl` is alive and holds `data`. It takes references of its own to the buffers.
    unsafe {
        let handshake = &*data.cast::<Handshake>();
        let Some(server) = peer_certificate(&mut *ssl, &handshake.hostname) else {
            return 0;
        };
        match &handshake.choice {
            Choice::Nothing => 1,
            Choice::Identity(identity, accepted)
                if accepted
                    .as_ref()
                    .map_or_else(|| server.error.is_none(), |it| *it == server.cert) =>
            {
                let chain: Vec<_> = identity
                    .chain
                    .iter()
                    .map(|it| CRYPTO_BUFFER_new(it.as_ptr(), it.len(), null_mut()))
                    .collect();
                let algorithms = &identity.algorithms;
                let is_set =
                    SSL_set_chain_and_key(ssl, chain.as_ptr(), chain.len(), null_mut(), &METHOD)
                        & SSL_set_signing_algorithm_prefs(
                            ssl,
                            algorithms.as_ptr(),
                            algorithms.len(),
                        );
                chain.into_iter().for_each(|it| CRYPTO_BUFFER_free(it));
                is_set
            }
            Choice::Undecided | Choice::Identity(..) => {
                *handshake.request.lock() = Some(CertificateRequest {
                    authorities: copies(SSL_get0_server_requested_CAs(ssl)),
                    server,
                    sent: copies(SSL_get0_peer_certificates(ssl)),
                });
                0
            }
        }
    }
}

unsafe extern "C" fn progressed(ssl: *const SSL, kind: c_int, _: c_int) {
    const HANDSHAKE_DONE: c_int = 0x20;
    if kind == HANDSHAKE_DONE {
        // SAFETY: `install` has stored the data, and nothing else uses `ssl` meanwhile.
        unsafe {
            let handshake = &*SSL_get_ex_data(ssl, data_index()).cast::<Handshake>();
            *handshake.certificates.lock() = copies(SSL_get0_peer_certificates(ssl));
        }
    }
}

impl Handshake {
    pub(super) fn new(choice: Choice, hostname: &[u8], keeps_certificates: bool) -> Arc<Handshake> {
        Arc::new(Handshake {
            choice,
            hostname: hostname.into(),
            keeps_certificates,
            request: Guarded::default(),
            certificates: Guarded::default(),
            request_id: AtomicU32::new(0),
            signature: Arc::default(),
        })
    }

    pub(super) fn install(self: &Arc<Self>, ssl: &mut SSL) {
        let data = Arc::into_raw(Arc::clone(self)).cast_mut().cast();
        // SAFETY: `ssl` releases the reference when it is freed.
        unsafe {
            debug_assert!(SSL_get_ex_data(ssl, data_index()).is_null());
            SSL_set_ex_data(ssl, data_index(), data);
            SSL_set_cert_cb(ssl, certificate_requested, data);
            if self.keeps_certificates {
                SSL_set_info_callback(ssl, progressed);
            }
        }
    }
}
