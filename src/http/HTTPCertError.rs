use bun_string::ZStr;

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

// ported from: src/http/HTTPCertError.zig
