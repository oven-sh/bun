use crate::error_code::ErrorCode;
use crate::zig_error_type::ZigErrorType;
use crate::JSValue;

#[repr(C)]
pub struct Errorable<T: Copy> {
    pub result: Result<T>,
    pub success: bool,
}

#[repr(C)]
pub union Result<T: Copy> {
    pub value: T,
    pub err: ZigErrorType,
}

impl<T: Copy> Errorable<T> {
    pub fn unwrap(self) -> core::result::Result<T, bun_core::Error> {
        if self.success {
            // SAFETY: success == true implies the `value` arm is active.
            unsafe { Ok(self.result.value) }
        } else {
            // SAFETY: success == false implies the `err` arm is active.
            unsafe { Err(self.result.err.code.to_error()) }
        }
    }

    pub fn value(val: T) -> Self {
        Self { result: Result { value: val }, success: true }
    }

    pub fn ok(val: T) -> Self {
        Self { result: Result { value: val }, success: true }
    }

    pub fn err(code: bun_core::Error, err_value: JSValue) -> Self {
        Self {
            result: Result {
                err: ZigErrorType {
                    code: ErrorCode::from(code),
                    value: err_value,
                },
            },
            success: false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Errorable.zig (43 lines)
//   confidence: high
//   todos:      0
//   notes:      extern union requires T: Copy; Result<T> shadows core::result::Result by design
// ──────────────────────────────────────────────────────────────────────────
