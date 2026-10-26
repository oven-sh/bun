//! The peer's certificate chain, collected from a live `SSL` for
//! `getPeerCertificate(true)` and `tls.checkServerIdentity`.

use bun_boringssl::c::{
    SSL, SSL_CTX_get_cert_store, SSL_get_SSL_CTX, SSL_get_peer_cert_chain,
    SSL_get_peer_certificate, SSL_is_server, X509, X509_STORE_CTX_free, X509_STORE_CTX_get1_issuer,
    X509_STORE_CTX_init, X509_STORE_CTX_new, X509_check_issued, X509_free, X509_up_ref,
    sk_X509_value,
};

/// Issuers looked up in the trust store beyond what the peer sent. Bounds the
/// walk so a cyclic store cannot loop forever.
const MAX_STORE_ISSUERS: usize = 16;

/// The peer's certificates, leaf first, each followed by its issuer, built as
/// Node's `getPeerCertificate(true)` builds it: the issuers among what the
/// peer sent, then the trust store's issuers up to a self-issued one. Owns one
/// reference per certificate, so it outlives the `SSL`.
pub struct PeerCertificateChain {
    certs: Vec<*mut X509>,
    /// The last certificate issued itself, so it is its own `issuerCertificate`.
    self_issued_terminal: bool,
}

// SAFETY: every entry is a +1 reference. BoringSSL's `X509` refcount is atomic
// (`CRYPTO_refcount_inc`), and its lazily computed extension cache is guarded by
// a per-object mutex (`x509v3_cache_extensions`), so another thread can read and
// free the entries after the `SSL` that produced them is gone.
unsafe impl Send for PeerCertificateChain {}

impl PeerCertificateChain {
    /// `None` when the peer sent no certificate.
    pub fn collect(ssl: &mut SSL) -> Option<Self> {
        let mut chain = Self {
            certs: Vec::new(),
            self_issued_terminal: false,
        };
        chain.collect_presented(ssl)?;
        chain.extend_through_store(ssl);
        let &last = chain.certs.last()?;
        // SAFETY: `last` is a +1 reference held by `chain`.
        chain.self_issued_terminal = unsafe { X509_check_issued(last, last) } == 0;
        Some(chain)
    }

    /// The leaf, then the issuers among what the peer sent. `None` when the
    /// peer sent no certificate.
    fn collect_presented(&mut self, ssl: &mut SSL) -> Option<()> {
        // SAFETY: `ssl` is live. `SSL_get_peer_certificate` returns a +1
        // reference; the chain and its entries are borrowed from the session
        // and up-ref'd before they are kept.
        unsafe {
            let sent = SSL_get_peer_cert_chain(ssl);
            let sent_len = if sent.is_null() {
                0
            } else {
                let mut n = 0;
                while !sk_X509_value(sent, n).is_null() {
                    n += 1;
                }
                n
            };
            // A server's `SSL_get_peer_cert_chain` leaves out the leaf. A client's has it at index 0.
            let mut candidates = 0..sent_len;
            let leaf = if SSL_is_server(ssl) != 0 {
                SSL_get_peer_certificate(ssl)
            } else {
                let leaf = sk_X509_value(sent, candidates.next()?);
                X509_up_ref(leaf);
                leaf
            };
            if leaf.is_null() {
                return None;
            }
            self.certs.push(leaf);
            let mut unused: Vec<usize> = candidates.collect();
            loop {
                let &subject = self.certs.last()?;
                let Some(position) = unused
                    .iter()
                    .position(|&i| X509_check_issued(sk_X509_value(sent, i), subject) == 0)
                else {
                    break;
                };
                let issuer = sk_X509_value(sent, unused.remove(position));
                X509_up_ref(issuer);
                self.certs.push(issuer);
            }
        }
        Some(())
    }

    /// Appends the issuers the trust store knows, up to a self-issued one.
    fn extend_through_store(&mut self, ssl: &mut SSL) {
        // SAFETY: `ssl` is live, and every context a TLS socket uses holds a
        // store (`us_ssl_ctx_build_raw` seeds the shared default roots when
        // there is no user `ca`). Every pointer below is checked for null
        // before use, and each +1 reference (the store context, every
        // issuer) is released exactly once.
        unsafe {
            let store = SSL_CTX_get_cert_store(SSL_get_SSL_CTX(ssl));
            if store.is_null() {
                return;
            }
            let store_ctx = X509_STORE_CTX_new();
            if store_ctx.is_null() {
                return;
            }
            if X509_STORE_CTX_init(
                store_ctx,
                store,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
            ) == 1
            {
                let mut added = 0;
                while added < MAX_STORE_ISSUERS {
                    let Some(&last) = self.certs.last() else {
                        break;
                    };
                    if X509_check_issued(last, last) == 0 {
                        break;
                    }
                    let mut issuer: *mut X509 = core::ptr::null_mut();
                    if X509_STORE_CTX_get1_issuer(&raw mut issuer, store_ctx, last) <= 0
                        || issuer.is_null()
                    {
                        break;
                    }
                    self.certs.push(issuer);
                    added += 1;
                }
            }
            X509_STORE_CTX_free(store_ctx);
        }
    }

    /// Leaf first, each certificate followed by its issuer.
    pub fn certs(&mut self) -> impl ExactSizeIterator<Item = &mut X509> + '_ {
        // Every entry is a live +1 reference owned by `self`.
        self.certs
            .iter_mut()
            .map(|&mut cert| X509::opaque_mut(cert))
    }

    /// Whether the last certificate issued itself, so it is its own issuer.
    pub fn self_issued_terminal(&self) -> bool {
        self.self_issued_terminal
    }
}

impl Drop for PeerCertificateChain {
    fn drop(&mut self) {
        for &cert in &self.certs {
            // SAFETY: `self` owns one reference to each entry.
            unsafe { X509_free(cert) };
        }
    }
}
