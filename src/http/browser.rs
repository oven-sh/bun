//! Where a request of a browser differs from one of `fetch()`.

use core::ptr::null_mut;

use bun_boringssl_sys::{SSL, SSL_get_verify_result, i2d_X509};
use bun_core::strings;

use crate::{CertificateInfo, Headers, Response};

pub enum Negotiation {
    Send(Vec<u8>),
    /// With what has already come through the tunnel.
    Done(Vec<u8>),
    Failed,
}

/// Called on the HTTP thread. Who gets the `CertificateInfo` also deals with its `error`.
pub trait Browser {
    /// An empty body only has the `Content-Length` that it was given.
    fn method(&self) -> &[u8];
    /// Before a handshake.
    fn configure_tls(&self, ssl: &mut SSL, is_for_proxy: bool);
    /// Whether to ask the proxy for a tunnel.
    fn tunnels(&self) -> bool;
    /// `received` is `None` on a new connection.
    fn negotiate(&self, received: Option<&[u8]>) -> Negotiation;
    /// What wakes the request up may be something else.
    fn take_approval_of_certificate(&self) -> bool;
    /// Of a response that is not the final one.
    fn informed(&self, response: &Response);
}

pub(crate) fn certificate_error(ssl: &mut SSL, hostname: &[u8]) -> Option<crate::Error> {
    // SAFETY: `ssl` is live.
    match unsafe { SSL_get_verify_result(ssl) } {
        0 if bun_uws::check_server_identity(ssl, hostname) => None,
        0 => Some(crate::Error::ERR_TLS_CERT_ALTNAME_INVALID),
        code => Some(crate::get_cert_error_from_no(code as i32)),
    }
}

/// From when it has been verified.
pub fn peer_certificate(ssl: &mut SSL, hostname: &[u8]) -> Option<CertificateInfo> {
    let peer = ssl.peer_certificate()?;
    // SAFETY: the first call only measures.
    let cert = unsafe {
        let mut der = vec![0; usize::try_from(i2d_X509(&raw const *peer, null_mut())).ok()?];
        i2d_X509(&raw const *peer, &mut der.as_mut_ptr());
        der.into()
    };
    Some(CertificateInfo {
        cert,
        issuers: bun_uws::verified_issuers(ssl),
        hostname: hostname.into(),
        error: certificate_error(ssl, hostname),
    })
}

/// `None` if the body ends with the connection.
pub fn content_length(headers: &Headers) -> Result<Option<usize>, crate::Error> {
    let mut values = headers
        .iter()
        .filter(|it| it.name().eq_ignore_ascii_case(b"content-length"))
        .flat_map(|it| strings::split(it.value(), b","))
        .map(|it| strings::trim(it, b" \t"));
    let first = values.next().unwrap_or_default();
    if values.any(|it| it != first) {
        return Err(crate::Error::InvalidContentLength);
    }
    Ok(bun_http_types::parse_content_length_strict(first).and_then(|it| it.try_into().ok()))
}
