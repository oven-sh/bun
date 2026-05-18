use crate::HTTPCertError;

pub struct CertificateInfo {
    pub cert: Box<[u8]>,
    pub cert_error: HTTPCertError,
    pub hostname: Box<[u8]>,
}

// PORT NOTE: Zig `deinit` took an allocator and freed `cert`, `cert_error.code`,
// `cert_error.reason`, and `hostname`. In Rust these are `Box<[u8]>` (here and
// in `HTTPCertError`) and drop automatically at scope exit — no explicit `Drop`
// impl needed. The allocator param is deleted per §Allocators.

// ported from: src/http/CertificateInfo.zig
