//! Bindings to [BoringSSL](https://commondatastorage.googleapis.com/chromium-boringssl-docs/headers.html).
//!
//! Most of this code has been translated to zig from BoringSSL's header files
//! using `zig translate-c`.  Avoid using externed functions and structs in new
//! code. Instead, separate it out into a new file and namespace it.
//!
pub const Translated = @import("./boringssl/boringssl.translated.zig");
usingnamespace Translated;
// usingnamespace @import("./boringssl/boringssl.translated.zig");
pub const X509 = @import("./boringssl/x509.zig").X509;
