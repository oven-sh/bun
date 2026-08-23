use core::mem::ManuallyDrop;

use crate::JSValue;
use crate::error_code::ErrorCode;
use crate::zig_error_type::ZigErrorType;

/// C++ `Errorable*` (headers-handwritten.h): `{ union { T value; ZigErrorType err; }; bool success; }`.
/// Owns `value` when `success`; the frame that declares it (Rust or C++) is
/// responsible for dropping it, and consumers take fields out by transfer.
#[repr(C)]
pub struct Errorable<T> {
    pub result: Result<T>,
    pub success: bool,
}

#[repr(C)]
pub union Result<T> {
    pub value: ManuallyDrop<T>,
    pub err: ZigErrorType,
}

impl<T> Errorable<T> {
    pub fn ok(val: T) -> Self {
        Self {
            result: Result {
                value: ManuallyDrop::new(val),
            },
            success: true,
        }
    }

    /// `value` is the JS error to throw/reject with.
    pub fn err(value: JSValue) -> Self {
        Self {
            result: Result {
                err: ZigErrorType {
                    code: ErrorCode(ErrorCode::JS_ERROR_OBJECT),
                    value,
                },
            },
            success: false,
        }
    }
}

impl<T> Drop for Errorable<T> {
    fn drop(&mut self) {
        if self.success {
            // SAFETY: success == true implies the `value` arm is active.
            unsafe { ManuallyDrop::drop(&mut self.result.value) }
        }
    }
}
