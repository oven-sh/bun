use crate::{ffi, JSCell, JSValue};

/// ABI-compatible with `JSC::JSValue`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DecodedJSValue {
    pub u: EncodedValueDescriptor,
}

/// ABI-compatible with `JSC::EncodedValueDescriptor`.
#[repr(C)]
#[derive(Copy, Clone)]
pub union EncodedValueDescriptor {
    pub as_int64: i64,
    pub ptr: *mut JSCell,
    pub as_bits: AsBits,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct AsBits {
    pub payload: i32,
    pub tag: i32,
}

impl DecodedJSValue {
    /// Equivalent to `JSC::JSValue::encode`.
    pub fn encode(self) -> JSValue {
        // SAFETY: union was constructed from a valid encoded JSValue; reading as i64 is the
        // canonical encoding. JSValue is #[repr(transparent)] over i64.
        unsafe { core::mem::transmute::<i64, JSValue>(self.u.as_int64) }
    }

    fn as_u64(self) -> u64 {
        // SAFETY: reading the i64 arm of the union; @bitCast i64 -> u64 is a same-size reinterpret.
        unsafe { self.u.as_int64 as u64 }
    }

    /// Equivalent to `JSC::JSValue::isCell`. Note that like JSC, this method treats 0 as a cell.
    pub fn is_cell(self) -> bool {
        self.as_u64() & ffi::NOT_CELL_MASK == 0
    }

    /// Equivalent to `JSC::JSValue::asCell`.
    pub fn as_cell(self) -> *mut JSCell {
        debug_assert!(self.is_cell(), "not a cell: 0x{:x}", self.as_u64());
        // SAFETY: is_cell() guarantees the punned bits form a valid (possibly null) JSCell pointer.
        unsafe { self.u.ptr }
    }
}

const _: () = assert!(
    core::mem::size_of::<usize>() == 8,
    "EncodedValueDescriptor assumes a 64-bit system",
);
const _: () = assert!(
    cfg!(target_endian = "little"),
    "EncodedValueDescriptor.as_bits assumes a little-endian system",
);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/DecodedJSValue.zig (49 lines)
//   confidence: high
//   todos:      0
//   notes:      ffi::NOT_CELL_MASK from sibling FFI.zig; encode() uses transmute (JSValue is repr(transparent) i64)
// ──────────────────────────────────────────────────────────────────────────
