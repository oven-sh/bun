use core::mem::ManuallyDrop;

use crate::JSValue;

/// C++ `Errorable*` (headers-handwritten.h): `{ union { T value; EncodedJSValue err; }; bool success; }`.
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
    pub err: JSValue,
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
        // SAFETY: a union has no validity invariant; zeroing the whole of it
        // means C++ never sees uninitialized bytes in the `value` arm.
        let mut result: Result<T> = unsafe { core::mem::MaybeUninit::zeroed().assume_init() };
        result.err = value;
        Self {
            result,
            success: false,
        }
    }
}

bun_core::assert_ffi_layout!(Errorable<crate::ResolvedSource>, 144, 8);
bun_core::assert_ffi_layout!(Errorable<bun_core::String>, 32, 8);

impl<T> Drop for Errorable<T> {
    fn drop(&mut self) {
        if self.success {
            // SAFETY: success == true implies the `value` arm is active.
            unsafe { ManuallyDrop::drop(&mut self.result.value) }
        }
    }
}
