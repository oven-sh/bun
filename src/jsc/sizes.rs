//! This namespace contains JSC C++ type sizes/alignments exported from a code
//! generator. Do not rely on any of these values in new code. If possible,
//! rewrite old ones to use another approach.
//!
//! It is not reliable to interpret C++ classes as raw bytes, since the
//! memory layout is not guaranteed by the compiler.

pub const BUN_FFI_POINTER_OFFSET_TO_ARGUMENTS_LIST: usize = 6;
pub const BUN_FFI_POINTER_OFFSET_TO_TYPED_ARRAY_VECTOR: usize = 16;
pub const BUN_FFI_POINTER_OFFSET_TO_TYPED_ARRAY_LENGTH: usize = 24;

// ported from: src/jsc/sizes.zig
