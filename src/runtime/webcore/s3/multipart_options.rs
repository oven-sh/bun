// CYCLEBREAK(b0): the struct body was MOVED DOWN to `bun_s3_signing::credentials`
// (pure config, no JSC deps) to break the dep cycle. This module is now a thin
// re-export so `crate::webcore::s3::multipart_options::MultiPartUploadOptions`
// and `bun_s3_signing::MultiPartUploadOptions` resolve to the SAME type — see
// the E0308 "distinct types" note this previously tripped in fetch.rs.
//
// Source of truth: src/runtime/webcore/s3/multipart_options.zig
pub use bun_s3_signing::MultiPartUploadOptions;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/multipart_options.zig (22 lines)
//   confidence: high
//   todos:      0
//   notes:      body lives in bun_s3_signing (CYCLEBREAK move-down); re-exported here
// ──────────────────────────────────────────────────────────────────────────
