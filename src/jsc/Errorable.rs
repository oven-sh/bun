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
    pub fn unwrap(self) -> core::result::Result<T, ErrorCode> {
        let this = ManuallyDrop::new(self);
        if this.success {
            // SAFETY: success == true implies the `value` arm is active; `this`
            // is ManuallyDrop so the value is moved out exactly once.
            unsafe {
                Ok(ManuallyDrop::into_inner(core::ptr::read(
                    &this.result.value,
                )))
            }
        } else {
            // SAFETY: success == false implies the `err` arm is active.
            unsafe { Err(this.result.err.code) }
        }
    }

    pub fn value(&self) -> Option<&T> {
        // SAFETY: success == true implies the `value` arm is active.
        self.success.then(|| unsafe { &*self.result.value })
    }

    pub fn value_mut(&mut self) -> Option<&mut T> {
        // SAFETY: success == true implies the `value` arm is active.
        self.success.then(|| unsafe { &mut *self.result.value })
    }

    pub fn ok(val: T) -> Self {
        Self {
            result: Result {
                value: ManuallyDrop::new(val),
            },
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

impl<T> Drop for Errorable<T> {
    fn drop(&mut self) {
        if self.success {
            // SAFETY: success == true implies the `value` arm is active.
            unsafe { ManuallyDrop::drop(&mut self.result.value) }
        }
    }
}
