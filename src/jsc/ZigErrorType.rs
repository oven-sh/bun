use bun_jsc::JSValue;
use crate::error_code::ErrorCode;

#[repr(C)]
pub struct ZigErrorType {
    pub code: ErrorCode,
    // PORT NOTE: bare JSValue field is OK here — this is a #[repr(C)] FFI payload
    // passed by value across the C++ boundary, not a heap-allocated Rust struct.
    pub value: JSValue,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ZigErrorType.zig (7 lines)
//   confidence: high
//   todos:      0
//   notes:      trivial #[repr(C)] struct; ErrorCode is sibling module in bun_jsc
// ──────────────────────────────────────────────────────────────────────────
