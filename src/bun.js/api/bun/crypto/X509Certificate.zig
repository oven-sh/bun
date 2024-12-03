//! An X509 Certificate wrapping BoringSSL.
//! 
//! This code is used by both `node:crypto` and other internal APIs, so its API
//! uses zig-native constructs instead of `JSValue`, etc.
//! 
//! ## References
//! - [RFC 5280 - X509 Certificates](https://datatracker.ietf.org/doc/html/rfc5280)
//! - [RFC 1422 - PEM](https://www.rfc-editor.org/rfc/rfc1422)
//! - [BoringSSL API Docs - `x509.h`](https://commondatastorage.googleapis.com/chromium-boringssl-docs/x509.h.html)

const X509Certificate = @This();
const bun = @import("root").bun;
usingnamespace bun.BoringSSL;

const X509 = BoringSSL.X509;


/// Do not access directly.
/// 
/// @internal
cert: *X509,

pub const Error = error {};

/// ## Parameters
/// - `buffer` - a PEM or DER encoded certificate.
pub fn parse(buffer: []const u8) Error!X509Certificate {
    // BIO_new
    // PEM_read_bio_X509_AUX()
    // PEM_read_bio_x
    _ = buffer;
    @panic("todo");
}
