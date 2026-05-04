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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/CertificateInfo.zig (14 lines)
//   confidence: high
//   todos:      0
//   notes:      deinit elided; HTTPCertError.code/.reason must be Box<[u8]> so Drop matches Zig free
// ──────────────────────────────────────────────────────────────────────────
