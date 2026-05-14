use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::{JSGlobalObject, JSObject, JSValue, JsResult};
use bun_core::ZigString;
// `ZigString.Slice` in Zig — re-exported in Rust as `bun_core::zig_string::Slice`
// (alias for `bun_core::ZigStringSlice`).
use bun_core::zig_string::Slice as ZigStringSlice;

bun_opaque::opaque_ffi! {
    /// Opaque JSC `JSString*` cell. Never constructed in Rust; only handled by reference.
    pub struct JSString;
}

// TODO(port): move to jsc_sys
//
// NOTE: Zig declares several of these params as `*JSString` / `*JSGlobalObject`
// (mutable), but the C ABI does not distinguish `*const T` from `*mut T`. We
// intentionally declare them `*const` here — matching the convention in
// JSGlobalObject.rs / JSValue.rs — so that callers can pass `&self` / `&global`
// directly without an `as *const _ as *mut _` cast. `JSString` and
// `JSGlobalObject` are opaque zero-sized handles in Rust, so a shared `&` borrow
// covers zero bytes and C++ mutating the underlying GC cell does not violate
// Rust's aliasing rules.
unsafe extern "C" {
    safe fn JSC__JSString__toObject(this: &JSString, global: &JSGlobalObject) -> *mut JSObject;
    safe fn JSC__JSString__toZigString(
        this: &JSString,
        global: &JSGlobalObject,
        zig_str: &mut ZigString,
    );
    safe fn JSC__JSString__eql(this: &JSString, global: &JSGlobalObject, other: &JSString) -> bool;
    fn JSC__JSString__iterator(this: &JSString, global_object: &JSGlobalObject, iter: *mut c_void);
    safe fn JSC__JSString__length(this: &JSString) -> usize;
    safe fn JSC__JSString__is8Bit(this: &JSString) -> bool;
}

impl JSString {
    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(self)
    }

    pub fn to_object<'a>(&self, global: &'a JSGlobalObject) -> Option<&'a JSObject> {
        // Returns either null or a valid GC-owned JSObject*; `JSObject` is an
        // opaque ZST handle so the deref is the centralised `opaque_ref` proof.
        let p = JSC__JSString__toObject(self, global);
        (!p.is_null()).then(|| JSObject::opaque_ref(p))
    }

    pub fn to_zig_string(&self, global: &JSGlobalObject, zig_str: &mut ZigString) {
        JSC__JSString__toZigString(self, global, zig_str)
    }

    pub fn ensure_still_alive(&self) {
        // SAFETY: matches Zig's std.mem.doNotOptimizeAway(this) — JSString is always a cell.
        core::hint::black_box(std::ptr::from_ref::<Self>(self));
    }

    pub fn get_zig_string(&self, global: &JSGlobalObject) -> ZigString {
        let mut out = ZigString::init(b"");
        self.to_zig_string(global, &mut out);
        out
    }

    // pub const view = getZigString;
    #[inline]
    pub fn view(&self, global: &JSGlobalObject) -> ZigString {
        self.get_zig_string(global)
    }

    /// doesn't always allocate
    pub fn to_slice(&self, global: &JSGlobalObject) -> ZigStringSlice {
        let mut str = ZigString::init(b"");
        self.to_zig_string(global, &mut str);
        str.to_slice()
    }

    // Spec (JSString.zig:44-52): `str.toSliceClone(allocator)` always allocates
    // an owned UTF-8 copy so the result outlives the GC'd JSString. Returning
    // `to_slice()` here (a borrow that may alias JSC-owned memory) would hand
    // callers a use-after-free once the cell is collected.
    // TODO(b2-blocked): un-gate once `bun_core::ZigString::to_slice_clone` is
    // ported; gated so wrong-semantics fallback cannot be called.

    pub fn to_slice_clone(&self, global: &JSGlobalObject) -> JsResult<ZigStringSlice> {
        let mut str = ZigString::init(b"");
        self.to_zig_string(global, &mut str);
        Ok(str.to_slice_clone())
    }

    // Spec (JSString.zig:54-62): `str.toSliceZ(allocator)` guarantees a `[:0]`
    // sentinel. `to_slice()` is not NUL-terminated; passing it to a C API that
    // expects one reads past the buffer end.
    // TODO(b2-blocked): un-gate once `bun_core::ZigString::to_slice_z` is
    // ported; gated so wrong-semantics fallback cannot be called.

    pub fn to_slice_z(&self, global: &JSGlobalObject) -> ZigStringSlice {
        let mut str = ZigString::init(b"");
        self.to_zig_string(global, &mut str);
        str.to_slice_z()
    }

    pub fn eql(&self, global: &JSGlobalObject, other: &JSString) -> bool {
        JSC__JSString__eql(self, global, other)
    }

    pub fn iterator(&self, global_object: &JSGlobalObject, iter: *mut c_void) {
        // SAFETY: `self`/`global_object` are valid opaque GC-cell handles; `iter`
        // points to a caller-owned `Iterator` (extern struct) passed through to C++.
        unsafe { JSC__JSString__iterator(self, global_object, iter) }
    }

    pub fn length(&self) -> usize {
        JSC__JSString__length(self)
    }

    pub fn is_8bit(&self) -> bool {
        JSC__JSString__is8Bit(self)
    }
}

pub type JStringIteratorAppend8Callback = unsafe extern "C" fn(*mut Iterator, *const u8, u32);
pub type JStringIteratorAppend16Callback = unsafe extern "C" fn(*mut Iterator, *const u16, u32);
pub type JStringIteratorWrite8Callback = unsafe extern "C" fn(*mut Iterator, *const u8, u32, u32);
pub type JStringIteratorWrite16Callback = unsafe extern "C" fn(*mut Iterator, *const u16, u32, u32);

#[repr(C)]
pub struct Iterator {
    pub data: *mut c_void,
    pub stop: u8,
    pub append8: Option<JStringIteratorAppend8Callback>,
    pub append16: Option<JStringIteratorAppend16Callback>,
    pub write8: Option<JStringIteratorWrite8Callback>,
    pub write16: Option<JStringIteratorWrite16Callback>,
}

impl Iterator {
    /// Raw type-erased user-data pointer (Zig: `data: ?*anyopaque`).
    ///
    /// This is the sole accessor for the `data` field. A `&T`-returning
    /// accessor is intentionally **not** provided: `data` is an opaque
    /// `*mut c_void` whose concrete pointee type is known only to the caller
    /// that constructed the `Iterator`, and that pointee is mutated by the
    /// append/write callbacks while C++ holds `*mut Iterator` re-entrantly.
    /// Callers must cast and dereference under their own `unsafe` block.
    ///
    /// Invariant: may be null (Zig spec declares it optional). When set by
    /// `iter()`-style constructors it points to a stack-local context struct
    /// that outlives the `JSC__JSString__iterator` call.
    #[inline]
    pub fn data_ptr(&self) -> *mut c_void {
        self.data
    }
}

// ported from: src/jsc/JSString.zig
