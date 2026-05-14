use crate::HTTPCertError;

pub struct CertificateInfo {
    pub cert: Box<[u8]>,
    pub cert_error: HTTPCertError,
    pub hostname: Box<[u8]>,
}

// PORT NOTE: `cert`, `cert_error.code`, `cert_error.reason`, and `hostname` are
// `Box<[u8]>` (here and in `HTTPCertError`) and drop automatically at scope
// exit — no explicit `Drop` impl needed.
