use crate::HTTPCertError;

pub struct CertificateInfo {
    pub cert: Box<[u8]>,
    pub cert_error: HTTPCertError,
    pub hostname: Box<[u8]>,
    /// `HTTPClient::remaining_redirect_count` at the hop that parked for this
    /// certificate. Threaded into `CertCheckResumeMessage` so a stale resume
    /// from a previous hop cannot un-park a later hop's `checkServerIdentity`.
    pub remaining_redirect_count: i8,
}

// All owned fields are `Box<[u8]>` (here and in `HTTPCertError`) and drop
// automatically — no explicit `Drop` impl needed.
