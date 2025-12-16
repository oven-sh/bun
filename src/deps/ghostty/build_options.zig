//! Build options for ghostty-vt module.
//! This provides the build_options that ghostty's SIMD code expects.

/// SIMD acceleration for optimized UTF-8 and escape sequence parsing.
/// Uses highway SIMD library with simdutf for fast UTF-8 decoding.
/// Note: Keep in sync with terminal_options.simd
pub const simd = true;
