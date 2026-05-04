use core::cmp::Ordering;
use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::{from_js_host_call_generic, JSGlobalObject, JSValue, JsResult};
use bun_str::String as BunString;

/// Opaque JSC BigInt cell. Always used behind a reference (`&JSBigInt`).
#[repr(C)]
pub struct JSBigInt {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSBigInt__fromJS(value: JSValue) -> *mut JSBigInt;
    fn JSC__JSBigInt__orderDouble(this: *const JSBigInt, num: f64) -> i8;
    fn JSC__JSBigInt__orderUint64(this: *const JSBigInt, num: u64) -> i8;
    fn JSC__JSBigInt__orderInt64(this: *const JSBigInt, num: i64) -> i8;
    fn JSC__JSBigInt__toInt64(this: *const JSBigInt) -> i64;
    fn JSC__JSBigInt__toString(this: *const JSBigInt, global: *const JSGlobalObject) -> BunString;
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
        // SAFETY: `this` is a valid JSBigInt cell reference.
        unsafe { JSC__JSBigInt__orderDouble(this, self) }
    }
}

impl BigIntOrderable for u64 {
    #[inline]
    fn raw_order(self, this: &JSBigInt) -> i8 {
        // SAFETY: `this` is a valid JSBigInt cell reference.
        unsafe { JSC__JSBigInt__orderUint64(this, self) }
    }
}

impl BigIntOrderable for i64 {
    #[inline]
    fn raw_order(self, this: &JSBigInt) -> i8 {
        // SAFETY: `this` is a valid JSBigInt cell reference.
        unsafe { JSC__JSBigInt__orderInt64(this, self) }
    }
}

impl JSBigInt {
    pub fn from_js(value: JSValue) -> Option<&'static JSBigInt> {
        // SAFETY: FFI call; returned pointer (if non-null) points to a GC-owned
        // JSBigInt cell. Lifetime is tied to GC, not Rust — caller must keep
        // `value` alive (stack-scanned) for as long as the returned ref is used.
        // TODO(port): lifetime — model as `&'a JSBigInt` tied to a stack guard?
        unsafe { JSC__JSBigInt__fromJS(value).as_ref() }
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
        // SAFETY: `self` is a valid JSBigInt cell reference.
        unsafe { JSC__JSBigInt__toInt64(self) }
    }

    pub fn to_string(&self, global: &JSGlobalObject) -> JsResult<BunString> {
        // TODO(port): `from_js_host_call_generic` wraps the raw FFI call with
        // exception-scope checking (Zig: `bun.jsc.fromJSHostCallGeneric`).
        // Signature assumed: (global, src_loc, fn, args) -> JsResult<T>.
        from_js_host_call_generic(global, core::panic::Location::caller(), || {
            // SAFETY: `self` and `global` are valid for the duration of the call.
            unsafe { JSC__JSBigInt__toString(self, global) }
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSBigInt.zig (44 lines)
//   confidence: medium
//   todos:      3
//   notes:      from_js_host_call_generic shape guessed; from_js() lifetime is GC-bound not 'static
// ──────────────────────────────────────────────────────────────────────────
