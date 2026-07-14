use crate::JSValue;
use crate::error_code::ErrorCode;
use crate::zig_error_type::ZigErrorType;

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
    pub fn unwrap(self) -> core::result::Result<T, ErrorCode> {
        if self.success {
            // SAFETY: success == true implies the `value` arm is active.
            unsafe { Ok(self.result.value) }
        } else {
            // SAFETY: success == false implies the `err` arm is active.
            unsafe { Err(self.result.err.code) }
        }
    }

    pub fn value(val: T) -> Self {
        Self {
            result: Result { value: val },
            success: true,
        }
    }

    pub fn ok(val: T) -> Self {
        Self {
            result: Result { value: val },
            success: true,
        }
    }

    pub fn err(code: ErrorCode, err_value: JSValue) -> Self {
        Self {
            result: Result {
                err: ZigErrorType {
                    code,
                    value: err_value,
                },
            },
            success: false,
        }
    }
}
