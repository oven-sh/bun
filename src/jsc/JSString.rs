use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::{Str, StringView};

bun_opaque::opaque_ffi! {
    /// Opaque JSC `JSString*` cell. Never constructed in Rust; only handled by reference.
    pub struct JSString;
}

unsafe extern "C" {
    pub(crate) safe fn JSC__JSString__view(
        this: &JSString,
        global: &JSGlobalObject,
    ) -> StringView<'static>;
    fn JSC__JSString__iterator(this: &JSString, global_object: &JSGlobalObject, iter: *mut c_void);
    safe fn JSC__JSString__length(this: &JSString) -> usize;
    safe fn JSC__JSString__is8Bit(this: &JSString) -> bool;
}

impl JSString {
    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(self)
    }

    #[inline]
    pub fn ensure_still_alive(&self) {
        // Keep the cell pointer observable to the GC's conservative stack scan.
        core::hint::black_box(std::ptr::from_ref::<Self>(self));
    }

    /// Throws when resolving a rope runs out of memory.
    #[track_caller]
    pub fn view<'a>(&'a self, global: &JSGlobalObject) -> JsResult<JSStringView<'a>> {
        let view = crate::call_check_slow(global, || JSC__JSString__view(self, global))?;
        Ok(JSStringView::new(self, view))
    }

    pub fn iterator(&self, global_object: &JSGlobalObject, iter: &mut Iterator) {
        // SAFETY: `self`/`global_object` are valid opaque GC-cell handles; `iter`
        // is a caller-owned `Iterator` (extern struct) passed through to C++.
        unsafe { JSC__JSString__iterator(self, global_object, core::ptr::from_mut(iter).cast()) }
    }

    pub fn len(&self) -> usize {
        JSC__JSString__length(self)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn is_8bit(&self) -> bool {
        JSC__JSString__is8Bit(self)
    }
}

/// A JSString's characters, borrowed via `JSString::view` (a substring rope
/// is viewed in place, not flattened). Keeps the cell observable to the GC's
/// conservative stack scan until dropped (the Rust counterpart of
/// `GCOwnedDataScope`), so a string `toString()` just created cannot be
/// collected while its characters are in use. Derefs to `Str`, so nothing it
/// hands out can outlive the guard.
pub struct JSStringView<'a> {
    cell: &'a JSString,
    view: StringView<'static>,
}

impl<'a> JSStringView<'a> {
    #[inline]
    pub(crate) fn new(cell: &'a JSString, view: StringView<'static>) -> Self {
        Self { cell, view }
    }
}

impl core::ops::Deref for JSStringView<'_> {
    type Target = Str;
    #[inline]
    fn deref(&self) -> &Str {
        &self.view
    }
}

impl core::fmt::Display for JSStringView<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Display::fmt(&**self, f)
    }
}

impl Drop for JSStringView<'_> {
    #[inline]
    fn drop(&mut self) {
        self.cell.ensure_still_alive();
    }
}

pub(crate) type JStringIteratorAppend8Callback =
    unsafe extern "C" fn(*mut Iterator, *const u8, u32);
pub(crate) type JStringIteratorAppend16Callback =
    unsafe extern "C" fn(*mut Iterator, *const u16, u32);
pub(crate) type JStringIteratorWrite8Callback =
    unsafe extern "C" fn(*mut Iterator, *const u8, u32, u32);
pub(crate) type JStringIteratorWrite16Callback =
    unsafe extern "C" fn(*mut Iterator, *const u16, u32, u32);

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
