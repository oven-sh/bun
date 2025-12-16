//! Build options for ghostty-vt module.
//! This provides the build_options that ghostty's SIMD code expects.

/// SIMD acceleration for optimized UTF-8 and escape sequence parsing.
/// Currently disabled because ghostty's SIMD uses C++ implementations (vt.cpp)
/// that would need to be built and linked separately.
/// The scalar fallback paths provide correct functionality.
/// Note: Keep in sync with terminal_options.simd
pub const simd = false;
