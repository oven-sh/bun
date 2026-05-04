use bun_str::ZStr;

pub struct HTTPCertError {
    pub error_no: i32,
    // TODO(port): CertificateInfo.deinit frees code/reason — ownership unclear
    // (borrowed in onHandshake, owned via dupeZ in CertificateInfo / http.zig:115).
    // May need owned NUL-terminated type (Box<ZStr> / ZString) instead of &'static.
    pub code: &'static ZStr,
    pub reason: &'static ZStr,
}

impl Default for HTTPCertError {
    fn default() -> Self {
        Self {
            error_no: 0,
            code: ZStr::EMPTY,
            reason: ZStr::EMPTY,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/HTTPCertError.zig (3 lines)
//   confidence: medium
//   todos:      1
//   notes:      file-level struct; [:0]const u8 fields default to "" so mapped to &'static ZStr,
//               but CertificateInfo.deinit frees them (heap-owned in some paths) — ownership TBD
// ──────────────────────────────────────────────────────────────────────────
