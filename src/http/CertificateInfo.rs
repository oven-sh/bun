use bun_uws::PeerCertificateChain;

/// What the JS thread's `tls.checkServerIdentity` callback gets. The HTTP
/// thread fills it after the handshake and parks the connection until the
/// JS thread answers. The chain holds its own references, so either thread
/// can drop it, before or after the socket is gone.
pub struct CertificateInfo {
    pub chain: PeerCertificateChain,
    pub hostname: Box<[u8]>,
}
