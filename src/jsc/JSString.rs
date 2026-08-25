use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::StringView;
use bun_core::Utf8Bytes;

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
        Ok(JSStringView { cell: self, view })
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
/// collected while its characters are in use. Every reader reborrows from
/// the guard, so nothing it hands out can outlive it.
pub struct JSStringView<'a> {
    pub(crate) cell: &'a JSString,
    pub(crate) view: StringView<'static>,
}

impl JSStringView<'_> {
    #[inline]
    pub fn view(&self) -> StringView<'_> {
        self.view
    }
    /// UTF-8 bytes; borrows when 8-bit ASCII, allocates otherwise. Never refs.
    #[inline]
    pub fn to_utf8(&self) -> Utf8Bytes<'_> {
        self.view.to_utf8()
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.view.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.view.is_empty()
    }
    #[inline]
    pub fn is_utf16(&self) -> bool {
        self.view.is_utf16()
    }
    #[inline]
    pub fn is_8bit(&self) -> bool {
        self.view.is_8bit()
    }
    #[inline]
    pub fn latin1_slice(&self) -> &[u8] {
        self.view.latin1_slice()
    }
    #[inline]
    pub fn utf16_slice(&self) -> &[u16] {
        self.view.utf16_slice()
    }
    #[inline]
    pub fn byte_slice(&self) -> &[u8] {
        self.view.byte_slice()
    }
    #[inline]
    pub fn as_utf8(&self) -> Option<&[u8]> {
        self.view.as_utf8()
    }
    #[inline]
    pub fn to_encoded_slice(&self) -> bun_core::EncodedSlice<'_> {
        self.view.to_encoded_slice()
    }
    #[inline]
    pub fn to_owned(&self) -> bun_core::String {
        self.view.to_owned()
    }
    #[inline]
    pub fn to_owned_slice(&self) -> Vec<u8> {
        self.view.to_owned_slice()
    }
    #[inline]
    pub fn eql(&self, other: StringView<'_>) -> bool {
        self.view.eql(other)
    }
    #[inline]
    pub fn eql_utf8(&self, other: &[u8]) -> bool {
        self.view.eql_utf8(other)
    }
    #[inline]
    pub fn eq_ascii(&self, ascii: &[u8]) -> bool {
        self.view.eq_ascii(ascii)
    }
    #[inline]
    pub fn starts_with_ascii(&self, ascii: &[u8]) -> bool {
        self.view.starts_with_ascii(ascii)
    }
    #[inline]
    pub fn char_at(&self, index: usize) -> u16 {
        self.view.char_at(index)
    }
    #[inline]
    pub fn in_map_case_insensitive<M: bun_core::comptime_string_map::ComptimeStringMap>(
        &self,
        map: &M,
    ) -> Option<M::Value>
    where
        M::Value: Copy,
    {
        self.view.in_map_case_insensitive(map)
    }
}

impl core::fmt::Display for JSStringView<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Display::fmt(&self.view, f)
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
