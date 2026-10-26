use bun_uws::PeerCertificateChain;

/// What the JS thread's `tls.checkServerIdentity` callback gets. The HTTP
/// thread fills it after the handshake. The chain owns its certificates.
pub struct CertificateInfo {
    pub chain: PeerCertificateChain,
    pub hostname: Box<[u8]>,
}
