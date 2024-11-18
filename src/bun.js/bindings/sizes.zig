//! This namespace contains JSC C++ type sizes/alignments exported from a code
//! generator Do not rely on any of these values in new code. If possible,
//! rewrite old ones to use another approach.
//!
//! It is not reliable to interpret C++ classes as raw bytes, since the
//! memory layout is not guaranteed by the compiler.
pub const Bun_FFI_PointerOffsetToArgumentsList = 6;
pub const Bun_FFI_PointerOffsetToTypedArrayVector = 16;
pub const Bun_CallFrame__callee = 3;
pub const Bun_CallFrame__argumentCountIncludingThis = 4;
pub const Bun_CallFrame__thisArgument = 5;
pub const Bun_CallFrame__firstArgument = 6;
pub const Bun_CallFrame__align = 8;
