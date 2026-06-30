//! JSC bridge for BoringSSL error formatting. Keeps `src/boringssl/` free of JSC types.

// LAYERING: body sunk to `bun_jsc::system_error` so `crate::sql_jsc` shares
// the single canonical impl (same pattern as verify_error_to_js).
pub use bun_jsc::system_error::boringssl_err_to_js as err_to_js;
