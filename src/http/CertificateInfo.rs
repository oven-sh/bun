pub struct CertificateInfo {
    pub cert: Box<[u8]>,
    pub hostname: Box<[u8]>,
}

// All owned fields are `Box<[u8]>` and drop automatically — no explicit
// `Drop` impl needed.
