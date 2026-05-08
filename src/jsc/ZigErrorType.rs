use crate::JSValue;
use crate::error_code::ErrorCode;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ZigErrorType {
    pub code: ErrorCode,
    // PORT NOTE: bare JSValue field is OK here — this is a #[repr(C)] FFI payload
    // passed by value across the C++ boundary, not a heap-allocated Rust struct.
    pub value: JSValue,
}

// ported from: src/jsc/ZigErrorType.zig
