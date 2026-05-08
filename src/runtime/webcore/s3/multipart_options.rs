// The struct body lives in `bun_s3_signing::credentials`
// (pure config, no JSC deps) to break the dep cycle. This module is now a thin
// re-export so `crate::webcore::s3::multipart_options::MultiPartUploadOptions`
// and `bun_s3_signing::MultiPartUploadOptions` resolve to the SAME type — see
// the E0308 "distinct types" note this previously tripped in fetch.rs.
//
// Source of truth: src/runtime/webcore/s3/multipart_options.zig
pub use bun_s3_signing::MultiPartUploadOptions;

// ported from: src/runtime/webcore/s3/multipart_options.zig
