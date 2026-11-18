//! For servers that do not send all the certificates that lead to an authority.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::null_mut;
use core::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use bun_boringssl_sys::{
    MemBio, OwnedX509, OwnedX509Store, SSL, SSL_get_ex_data, SSL_set_ex_data, SSL_set_verify,
    SSL_verify_cb, X509, X509_STORE, X509_STORE_CTX, X509_STORE_add_cert, i2d_X509,
};
use bun_http::{CertError, CertificateInfo};
use bun_threading::Guarded;

use super::embedder::{About, Outgoing, ResourceType};
use super::proxy::within;
use super::session::{Session, authorities, trusts_system};
use super::transaction::{self, Requester};
use super::{checks, tls};
use crate::url::Url;
use crate::{Bytes, exec};

type Handle = *mut c_void;

#[repr(C)]
struct GeneralName {
    kind: c_int,
    value: Handle,
}

#[repr(C)]
struct AccessDescription {
    method: Handle,
    location: *const GeneralName,
}

#[repr(C)]
pub(super) struct Cbs(pub(super) *const u8, pub(super) usize);

unsafe extern "C" {
    safe fn X509_STORE_new() -> Option<OwnedX509Store>;
    safe fn us_x509_store_ignore_expired_trust_anchors(store: &X509_STORE);
    safe fn X509_STORE_CTX_new() -> Handle;
    fn X509_STORE_CTX_init(
        context: Handle,
        store: &X509_STORE,
        leaf: &X509,
        untrusted: Handle,
    ) -> c_int;
    fn X509_STORE_CTX_set_default(context: Handle, name: *const c_char) -> c_int;
    fn X509_STORE_CTX_get0_param(context: Handle) -> Handle;
    fn X509_STORE_CTX_get0_chain(context: Handle) -> Handle;
    fn X509_STORE_CTX_free(context: Handle);
    fn X509_STORE_CTX_get_current_cert(context: *mut X509_STORE_CTX) -> *const X509;
    fn X509_STORE_CTX_get_ex_data(context: *mut X509_STORE_CTX, index: c_int) -> Handle;
    fn X509_STORE_CTX_set_error(context: *mut X509_STORE_CTX, error: c_int);
    safe fn SSL_get_ex_data_X509_STORE_CTX_idx() -> c_int;
    safe fn SSL_get_verify_callback(ssl: &SSL) -> Handle;
    safe fn SSL_get_verify_mode(ssl: &SSL) -> c_int;
    fn X509_VERIFY_PARAM_set_hostflags(parameters: Handle, flags: c_uint);
    fn X509_VERIFY_PARAM_set1_host(parameters: Handle, name: *const u8, length: usize) -> c_int;
    fn X509_VERIFY_PARAM_set1_ip_asc(parameters: Handle, address: *const c_char) -> c_int;
    fn us_x509_verify_cert(context: Handle, purpose: c_int) -> c_int;
    fn X509_get_ext_d2i(of: &X509, name: c_int, critical: Handle, index: Handle) -> Handle;
    fn AUTHORITY_INFO_ACCESS_free(it: Handle);
    fn OBJ_obj2nid(object: Handle) -> c_int;
    fn ASN1_STRING_get0_data(string: Handle) -> *const u8;
    fn ASN1_STRING_length(string: Handle) -> c_int;
    fn PKCS7_get_certificates(stack: Handle, input: &mut Cbs) -> c_int;
    pub(super) fn X509_free(certificate: Handle);
    pub(super) safe fn OPENSSL_sk_new_null() -> Handle;
    fn OPENSSL_sk_push(stack: Handle, value: *const c_void) -> usize;
    fn OPENSSL_sk_num(stack: *const c_void) -> usize;
    fn OPENSSL_sk_value(stack: *const c_void, at: usize) -> Handle;
    pub(super) fn OPENSSL_sk_free(stack: Handle);
}

/// # Safety
/// `stack` is null or outlives the result.
pub(super) unsafe fn items(stack: Handle) -> impl Iterator<Item = Handle> {
    // SAFETY: up to the caller.
    (0..unsafe { OPENSSL_sk_num(stack) }).map(move |at| unsafe { OPENSSL_sk_value(stack, at) })
}

/// # Safety
/// It is a certificate.
unsafe fn encode(certificate: *const X509) -> Bytes {
    // SAFETY: the first call only measures.
    unsafe {
        let mut der = vec![0; usize::try_from(i2d_X509(certificate, null_mut())).unwrap_or(0)];
        i2d_X509(certificate, &mut der.as_mut_ptr());
        der.into()
    }
}

/// The certificates that the user or an administrator has said never to trust.
static DISTRUSTED: Guarded<Vec<Bytes>> = Guarded::new(Vec::new());

/// What was set up with a server before they have changed is not used again: it would not show its certificate.
pub(super) async fn read_distrusted() {
    static READ_AT: AtomicU64 = AtomicU64::new(u64::MAX);
    static READING: Guarded<()> = Guarded::new(());
    let version = tls::version_of_trust();
    if READ_AT.load(Ordering::Acquire) == version {
        return;
    }
    let read = move || {
        let _reading = READING.lock();
        if READ_AT.load(Ordering::Acquire) != version {
            let now = tls::distrusted();
            if core::mem::replace(&mut *DISTRUSTED.lock(), now.clone()) != now {
                Session::renew_all_pools();
            }
            READ_AT.store(version, Ordering::Release);
        }
    };
    exec::blocking(read).await;
}

fn index_of_callback() -> c_int {
    static INDEX: OnceLock<c_int> = OnceLock::new();
    *INDEX.get_or_init(|| tls::new_data_index(None))
}

unsafe extern "C" fn verified(mut is_valid: c_int, context: *mut X509_STORE_CTX) -> c_int {
    const UNTRUSTED: c_int = 27;
    // SAFETY: `refuse_distrusted` has stored the callback.
    unsafe {
        let certificate = X509_STORE_CTX_get_current_cert(context);
        if is_valid == 1 && DISTRUSTED.lock().contains(&encode(certificate)) {
            X509_STORE_CTX_set_error(context, UNTRUSTED);
            is_valid = 0;
        }
        let ssl = X509_STORE_CTX_get_ex_data(context, SSL_get_ex_data_X509_STORE_CTX_idx());
        let next = SSL_get_ex_data(ssl.cast(), index_of_callback());
        core::mem::transmute::<Handle, SSL_verify_cb>(next)
            .map_or(is_valid, |it| it(is_valid, context))
    }
}

pub(super) fn refuse_distrusted(ssl: &mut SSL) {
    if !DISTRUSTED.lock().is_empty() {
        // SAFETY: `ssl` is alive.
        unsafe {
            SSL_set_ex_data(ssl, index_of_callback(), SSL_get_verify_callback(ssl));
            SSL_set_verify(ssl, SSL_get_verify_mode(ssl), Some(verified));
        }
    }
}

struct Store(OwnedX509Store);

// SAFETY: it has a lock.
unsafe impl Send for Store {}
// SAFETY: as above.
unsafe impl Sync for Store {}

fn store() -> Option<&'static X509_STORE> {
    static STORE: OnceLock<Option<Store>> = OnceLock::new();
    let authorities = authorities()?;
    let make = || {
        let store = X509_STORE_new()?;
        us_x509_store_ignore_expired_trust_anchors(&store);
        for file in authorities.iter().filter_map(|it| MemBio::new(it)) {
            while let Some(authority) = file.read_x509() {
                X509_STORE_add_cert(&store, &authority);
            }
        }
        Some(Store(store))
    };
    STORE.get_or_init(make).as_ref().map(|it| &*it.0)
}

/// From the first of `known`, none of which is trusted for being there.
fn verified_chain(known: &[Bytes], hostname: &[u8]) -> Option<Vec<Bytes>> {
    const SSL_SERVER: c_int = 2;
    const NEVER_CHECK_SUBJECT: c_uint = 0x20;
    let parsed = known.iter().map(|it| OwnedX509::from_der(it));
    let (parsed, store) = (parsed.collect::<Option<Vec<_>>>()?, store()?);
    let (leaf, address) = (parsed.first()?, bun_core::ZBox::from_bytes(hostname));
    let (untrusted, context) = (OPENSSL_sk_new_null(), X509_STORE_CTX_new());
    // SAFETY: the stack only borrows what `parsed` holds. Both outlive the context.
    unsafe {
        for certificate in &parsed {
            OPENSSL_sk_push(untrusted, (&raw const **certificate).cast());
        }
        let is_for_host = || {
            let parameters = X509_STORE_CTX_get0_param(context);
            X509_VERIFY_PARAM_set_hostflags(parameters, NEVER_CHECK_SUBJECT);
            X509_VERIFY_PARAM_set1_ip_asc(parameters, address.as_ptr()) == 1
                || X509_VERIFY_PARAM_set1_host(parameters, hostname.as_ptr(), hostname.len()) == 1
        };
        let is_valid = X509_STORE_CTX_init(context, store, leaf, untrusted) == 1
            && X509_STORE_CTX_set_default(context, c"ssl_server".as_ptr()) == 1
            && is_for_host()
            && us_x509_verify_cert(context, SSL_SERVER) == 1;
        let chain = is_valid.then(|| {
            items(X509_STORE_CTX_get0_chain(context))
                .map(|it| encode(it.cast()))
                .collect()
        });
        X509_STORE_CTX_free(context);
        OPENSSL_sk_free(untrusted);
        bun_boringssl_sys::ERR_clear_error();
        chain
    }
}

/// <https://www.rfc-editor.org/rfc/rfc5280#section-4.2.2.1>
fn where_issuers_are(certificate: &[u8]) -> Vec<Url> {
    const AUTHORITY_INFORMATION_ACCESS: c_int = 177;
    const ISSUERS: c_int = 179;
    const URI: c_int = 6;
    let Some(certificate) = OwnedX509::from_der(certificate) else {
        return Vec::new();
    };
    // SAFETY: a stack of descriptions, which is not used after it is freed.
    unsafe {
        let all = X509_get_ext_d2i(
            &certificate,
            AUTHORITY_INFORMATION_ACCESS,
            null_mut(),
            null_mut(),
        );
        let urls = items(all)
            .map(|it| &*it.cast::<AccessDescription>())
            .filter(|it| OBJ_obj2nid(it.method) == ISSUERS && (*it.location).kind == URI)
            .map(|it| (*it.location).value)
            .filter(|it| ASN1_STRING_length(*it) > 0)
            .filter_map(|it| {
                Url::parse(core::slice::from_raw_parts(
                    ASN1_STRING_get0_data(it),
                    ASN1_STRING_length(it) as usize,
                ))
            })
            .filter(|it| it.scheme() == b"http" && !checks::has_bad_port(it))
            .collect();
        AUTHORITY_INFO_ACCESS_free(all);
        urls
    }
}

fn certificates_in(file: &[u8]) -> Vec<Bytes> {
    let single = OwnedX509::from_der(file).or_else(|| MemBio::new(file)?.read_x509());
    // SAFETY: what is allocated here is freed here, after its last use.
    unsafe {
        let found = single.map_or_else(
            || {
                let stack = OPENSSL_sk_new_null();
                PKCS7_get_certificates(stack, &mut Cbs(file.as_ptr(), file.len()));
                let found = items(stack).map(|it| encode(it.cast())).collect();
                items(stack).for_each(|it| X509_free(it));
                OPENSSL_sk_free(stack);
                found
            },
            |it| vec![encode(&raw const *it)],
        );
        bun_boringssl_sys::ERR_clear_error();
        found
    }
}

async fn download(session: &Arc<Session>, url: Url, about: &About) -> Option<Vec<Bytes>> {
    const MAX_LENGTH: usize = 64 * 1024;
    let requester = Requester {
        about: About {
            url: url.clone(),
            method: b"GET"[..].into(),
            destination: None,
            resource_type: ResourceType::Other,
            referrer: None,
            ..about.clone()
        },
        includes_credentials: false,
        logs_in: false,
        prompts: false,
        login: None,
    };
    let request = Outgoing {
        url,
        method: b"GET"[..].into(),
        headers: Default::default(),
        body: None,
    };
    let mut answer = Box::pin(transaction::send(session, request, &requester, None))
        .await
        .ok()
        .filter(|it| it.status == 200)?;
    let file = answer.body.peek(MAX_LENGTH + 1).await.ok();
    file.filter(|it| it.len() <= MAX_LENGTH)
        .map(certificates_in)
}

async fn find_chain(
    session: &Arc<Session>,
    about: &About,
    mut known: Vec<Bytes>,
    hostname: &Bytes,
) -> Option<Vec<Bytes>> {
    const MAX_DOWNLOADS: usize = 5;
    let (sent, name) = (known.clone(), hostname.clone());
    if let Some(chain) = exec::blocking(move || tls::chain_of_system(&sent, &name)).await? {
        return Some(chain);
    }
    let (mut urls, mut looked_at) = (Vec::new(), 0);
    for next in 0..MAX_DOWNLOADS {
        for url in known[looked_at..]
            .iter()
            .rev()
            .flat_map(|it| where_issuers_are(it))
        {
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
        looked_at = known.len();
        let url = urls.get(next)?.clone();
        let Some(more) = session
            .issuers_at(url, |it| within(15, download(session, it, about)))
            .await
        else {
            continue;
        };
        known.extend(more);
        let (known, name) = (known.clone(), hostname.clone());
        let verify =
            move || verified_chain(&known, &name).or_else(|| tls::chain_of_system(&known, &name));
        if let Some(chain) = exec::blocking(verify).await? {
            return Some(chain);
        }
    }
    None
}

fn may_be_incomplete(error: Option<bun_http::Error>) -> bool {
    use CertError::*;
    matches!(
        error,
        Some(bun_http::Error::Cert(
            UNABLE_TO_GET_ISSUER_CERT
                | UNABLE_TO_GET_ISSUER_CERT_LOCALLY
                | UNABLE_TO_VERIFY_LEAF_SIGNATURE
                | SELF_SIGNED_CERT_IN_CHAIN
                | DEPTH_ZERO_SELF_SIGNED_CERT
        ))
    )
}

/// `sent` begins with `certificate`.
pub(super) async fn complete(
    session: &Arc<Session>,
    about: &About,
    mut certificate: CertificateInfo,
    sent: Vec<Bytes>,
) -> CertificateInfo {
    if certificate.error.is_none() || sent.first() != Some(&certificate.cert) {
        return certificate;
    }
    certificate.issuers = sent[1..].to_vec();
    if may_be_incomplete(certificate.error)
        && trusts_system()
        && let Some(chain) = find_chain(session, about, sent, &certificate.hostname).await
        && !chain.iter().any(|it| DISTRUSTED.lock().contains(it))
    {
        certificate.issuers = chain.into_iter().skip(1).collect();
        certificate.error = None;
    }
    certificate
}
