use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::{JSGlobalObject, JSObject, JSValue, JsResult};
use bun_core::UnsafeStringView;
// `bun_core::unsafe_string_view::Slice` is an alias for `bun_core::UTF8Slice`.
use bun_core::unsafe_string_view::Slice as UTF8Slice;

bun_opaque::opaque_ffi! {
    /// Opaque JSC `JSString*` cell. Never constructed in Rust; only handled by reference.
    pub struct JSString;
}

// TODO(port): move to jsc_sys
//
// NOTE: the C ABI does not distinguish `*const T` from `*mut T`. We
// intentionally declare these params `*const` here — matching the convention in
// JSGlobalObject.rs / JSValue.rs — so that callers can pass `&self` / `&global`
// directly without an `as *const _ as *mut _` cast. `JSString` and
// `JSGlobalObject` are opaque zero-sized handles in Rust, so a shared `&` borrow
// covers zero bytes and C++ mutating the underlying GC cell does not violate
// Rust's aliasing rules.
unsafe extern "C" {
    safe fn JSC__JSString__toObject(this: &JSString, global: &JSGlobalObject) -> *mut JSObject;
    safe fn JSC__JSString__toUnsafeStringView(
        this: &JSString,
        global: &JSGlobalObject,
        unsafe_str_view: &mut UnsafeStringView,
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

    pub fn to_unsafe_string_view(
        &self,
        global: &JSGlobalObject,
        unsafe_str_view: &mut UnsafeStringView,
    ) {
        JSC__JSString__toUnsafeStringView(self, global, unsafe_str_view)
    }

    pub fn ensure_still_alive(&self) {
        // SAFETY: equivalent of `std::mem::doNotOptimizeAway(this)` — JSString is always a cell.
        core::hint::black_box(std::ptr::from_ref::<Self>(self));
    }

    pub fn get_unsafe_string_view(&self, global: &JSGlobalObject) -> UnsafeStringView {
        let mut out = UnsafeStringView::init(b"");
        self.to_unsafe_string_view(global, &mut out);
        out
    }

    // pub const view = getUnsafeStringView;
    #[inline]
    pub fn view(&self, global: &JSGlobalObject) -> UnsafeStringView {
        self.get_unsafe_string_view(global)
    }

    /// doesn't always allocate
    pub fn to_slice(&self, global: &JSGlobalObject) -> UTF8Slice {
        let mut str = UnsafeStringView::init(b"");
        self.to_unsafe_string_view(global, &mut str);
        str.to_slice()
    }

    // `to_slice_clone` always allocates an owned UTF-8 copy so the result
    // outlives the GC'd JSString. Returning `to_slice()` here (a borrow that
    // may alias JSC-owned memory) would hand callers a use-after-free once the
    // cell is collected.

    pub fn to_slice_clone(&self, global: &JSGlobalObject) -> JsResult<UTF8Slice> {
        let mut str = UnsafeStringView::init(b"");
        self.to_unsafe_string_view(global, &mut str);
        Ok(str.to_slice_clone())
    }

    // `to_slice_z` guarantees a NUL-terminated sentinel. `to_slice()` is not
    // NUL-terminated; passing it to a C API that expects one reads past the
    // buffer end.

    pub fn to_slice_z(&self, global: &JSGlobalObject) -> UTF8Slice {
        let mut str = UnsafeStringView::init(b"");
        self.to_unsafe_string_view(global, &mut str);
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
    /// Raw type-erased user-data pointer.
    ///
    /// This is the sole accessor for the `data` field. A `&T`-returning
    /// accessor is intentionally **not** provided: `data` is an opaque
    /// `*mut c_void` whose concrete pointee type is known only to the caller
    /// that constructed the `Iterator`, and that pointee is mutated by the
    /// append/write callbacks while C++ holds `*mut Iterator` re-entrantly.
    /// Callers must cast and dereference under their own `unsafe` block.
    ///
    /// Invariant: may be null. When set by
    /// `iter()`-style constructors it points to a stack-local context struct
    /// that outlives the `JSC__JSString__iterator` call.
    #[inline]
    pub fn data_ptr(&self) -> *mut c_void {
        self.data
    }
}
