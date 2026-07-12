use crate::HTTPCertError;

pub struct CertificateInfo {
    pub cert: Box<[u8]>,
    pub cert_error: HTTPCertError,
    pub hostname: Box<[u8]>,
}

// All owned fields (`Box<[u8]>` here, `ZBox` in `HTTPCertError`) drop
// automatically — no explicit `Drop` impl needed.
