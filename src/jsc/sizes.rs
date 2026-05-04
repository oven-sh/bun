//! This namespace contains JSC C++ type sizes/alignments exported from a code
//! generator. Do not rely on any of these values in new code. If possible,
//! rewrite old ones to use another approach.
//!
//! It is not reliable to interpret C++ classes as raw bytes, since the
//! memory layout is not guaranteed by the compiler.

pub const BUN_FFI_POINTER_OFFSET_TO_ARGUMENTS_LIST: usize = 6;
pub const BUN_FFI_POINTER_OFFSET_TO_TYPED_ARRAY_VECTOR: usize = 16;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/sizes.zig (8 lines)
//   confidence: high
//   todos:      0
//   notes:      Zig comptime_int constants mapped to usize; names SCREAMING_SNAKE_CASE per Rust convention.
// ──────────────────────────────────────────────────────────────────────────
