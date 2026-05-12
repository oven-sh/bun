use core::cmp::Ordering;
use core::marker::{PhantomData, PhantomPinned};

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::String as BunString;

bun_opaque::opaque_ffi! {
    /// Opaque JSC BigInt cell. Always used behind a reference (`&JSBigInt`).
    pub struct JSBigInt;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    // safe: `JSValue` is a by-value tagged i64; returns a nullable GC-cell
    // pointer the caller checks before deref.
    safe fn JSC__JSBigInt__fromJS(value: JSValue) -> *mut JSBigInt;
    safe fn JSC__JSBigInt__orderDouble(this: &JSBigInt, num: f64) -> i8;
    safe fn JSC__JSBigInt__orderUint64(this: &JSBigInt, num: u64) -> i8;
    safe fn JSC__JSBigInt__orderInt64(this: &JSBigInt, num: i64) -> i8;
    safe fn JSC__JSBigInt__toInt64(this: &JSBigInt) -> i64;
    safe fn JSC__JSBigInt__toString(this: &JSBigInt, global: &JSGlobalObject) -> BunString;
}

/// Types that can be compared against a `JSBigInt` via the FFI order functions.
/// Mirrors the `comptime T: type` switch in the Zig `order` fn.
pub trait BigIntOrderable: Copy {
    fn raw_order(self, this: &JSBigInt) -> i8;
}

impl BigIntOrderable for f64 {
    #[inline]
    fn raw_order(self, this: &JSBigInt) -> i8 {
        debug_assert!(!self.is_nan());
        JSC__JSBigInt__orderDouble(this, self)
    }
}

impl BigIntOrderable for u64 {
    #[inline]
    fn raw_order(self, this: &JSBigInt) -> i8 {
        JSC__JSBigInt__orderUint64(this, self)
    }
}

impl BigIntOrderable for i64 {
    #[inline]
    fn raw_order(self, this: &JSBigInt) -> i8 {
        JSC__JSBigInt__orderInt64(this, self)
    }
}

impl JSBigInt {
    pub fn from_js(value: JSValue) -> Option<&'static JSBigInt> {
        // Returned pointer (if non-null) points to a GC-owned JSBigInt cell.
        // Lifetime is tied to GC, not Rust — caller must keep `value` alive
        // (stack-scanned) for as long as the returned ref is used. `JSBigInt`
        // is an opaque ZST handle so the deref is the centralised `opaque_ref`
        // proof.
        // TODO(port): lifetime — model as `&'a JSBigInt` tied to a stack guard?
        let p = JSC__JSBigInt__fromJS(value);
        (!p.is_null()).then(|| JSBigInt::opaque_ref(p))
    }

    pub fn order<T: BigIntOrderable>(&self, num: T) -> Ordering {
        let result = num.raw_order(self);
        if result == 0 {
            return Ordering::Equal;
        }
        if result < 0 {
            return Ordering::Less;
        }
        Ordering::Greater
    }

    pub fn to_int64(&self) -> i64 {
        JSC__JSBigInt__toInt64(self)
    }

    pub fn to_string(&self, global: &JSGlobalObject) -> JsResult<BunString> {
        crate::host_fn::from_js_host_call_generic(global, || JSC__JSBigInt__toString(self, global))
    }
}

// ported from: src/jsc/JSBigInt.zig
