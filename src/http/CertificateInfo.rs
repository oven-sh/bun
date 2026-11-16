pub struct CertificateInfo {
    pub cert: Box<[u8]>,
    pub issuers: Vec<Box<[u8]>>,
    pub hostname: Box<[u8]>,
}

// All owned fields drop automatically — no explicit
// `Drop` impl needed.
