use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::StringView;
use bun_core::Utf8Bytes;

bun_opaque::opaque_ffi! {
    /// Opaque JSC `JSString*` cell. Never constructed in Rust; only handled by reference.
    pub struct JSString;
}

unsafe extern "C" {
    pub(crate) safe fn JSC__JSString__view<'a>(
        this: &'a JSString,
        global: &JSGlobalObject,
    ) -> StringView<'a>;
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

    /// Walk this string's characters without resolving it: a rope's fibers
    /// are handed to `visitor` one at a time, until it returns `false`.
    pub fn visit<V: StringVisitor>(&self, global_object: &JSGlobalObject, visitor: &mut V) {
        /// One callback: hand `len` characters at `ptr` to the visitor behind
        /// `it.data`, stopping the iteration if it says so.
        ///
        /// # Safety
        /// `it` is the `Iterator` built in `visit::<V>` (so `data` is its
        /// `&mut V`, not otherwise borrowed during `JSC__JSString__iterator`),
        /// and `ptr[..len]` is live for the call.
        unsafe fn deliver<V, T>(
            it: *mut Iterator,
            ptr: *const T,
            len: u32,
            f: impl FnOnce(&mut V, &[T]) -> bool,
        ) {
            // SAFETY: fn contract.
            let (it, visitor, chunk) = unsafe {
                let it = &mut *it;
                let visitor = &mut *it.data.cast::<V>();
                (it, visitor, bun_core::ffi::slice(ptr, len as usize))
            };
            if !f(visitor, chunk) {
                it.stop = 1;
            }
        }
        // SAFETY (the four below): JSC calls back synchronously with the
        // `Iterator` passed to `JSC__JSString__iterator` and a live segment.
        unsafe extern "C" fn append8<V: StringVisitor>(
            it: *mut Iterator,
            ptr: *const u8,
            len: u32,
        ) {
            // SAFETY: see above.
            unsafe { deliver::<V, u8>(it, ptr, len, |v, c| v.append8(c)) }
        }
        unsafe extern "C" fn append16<V: StringVisitor>(
            it: *mut Iterator,
            ptr: *const u16,
            len: u32,
        ) {
            // SAFETY: see above.
            unsafe { deliver::<V, u16>(it, ptr, len, |v, c| v.append16(c)) }
        }
        unsafe extern "C" fn write8<V: StringVisitor>(
            it: *mut Iterator,
            ptr: *const u8,
            len: u32,
            offset: u32,
        ) {
            // SAFETY: see above.
            unsafe { deliver::<V, u8>(it, ptr, len, |v, c| v.write8(c, offset)) }
        }
        unsafe extern "C" fn write16<V: StringVisitor>(
            it: *mut Iterator,
            ptr: *const u16,
            len: u32,
            offset: u32,
        ) {
            // SAFETY: see above.
            unsafe { deliver::<V, u16>(it, ptr, len, |v, c| v.write16(c, offset)) }
        }
        let mut iter = Iterator {
            data: core::ptr::from_mut(visitor).cast(),
            stop: 0,
            append8: Some(append8::<V>),
            append16: Some(append16::<V>),
            write8: Some(write8::<V>),
            write16: Some(write16::<V>),
        };
        self.iterator(global_object, &mut iter);
    }

    pub fn length(&self) -> usize {
        JSC__JSString__length(self)
    }

    pub fn is_8bit(&self) -> bool {
        JSC__JSString__is8Bit(self)
    }
}

/// A JSString's characters, borrowed via `JSString::view` (a substring rope
/// is viewed in place, not flattened). Keeps the cell observable to the GC's
/// conservative stack scan until dropped (the Rust counterpart of
/// `GCOwnedDataScope`), so a string `toString()` just created cannot be
/// collected while its characters are in use.
pub struct JSStringView<'a> {
    pub(crate) cell: &'a JSString,
    pub(crate) view: StringView<'a>,
}

impl JSStringView<'_> {
    /// UTF-8 bytes; borrows when 8-bit ASCII, allocates otherwise. Never refs.
    #[inline]
    pub fn to_utf8(&self) -> Utf8Bytes<'_> {
        self.view.to_utf8()
    }
}

impl core::ops::Deref for JSStringView<'_> {
    type Target = bun_core::String;

    #[inline]
    fn deref(&self) -> &bun_core::String {
        &self.view
    }
}

impl core::fmt::Display for JSStringView<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Display::fmt(&*self.view, f)
    }
}

impl Drop for JSStringView<'_> {
    #[inline]
    fn drop(&mut self) {
        self.cell.ensure_still_alive();
    }
}

/// The segments of a [`JSString`] as [`JSString::visit`] finds them:
/// `append*` in order from the start, `write*` at a given character offset.
/// Return `false` from any of them to stop.
pub trait StringVisitor {
    fn append8(&mut self, chunk: &[u8]) -> bool;
    fn append16(&mut self, chunk: &[u16]) -> bool;
    fn write8(&mut self, chunk: &[u8], offset: u32) -> bool;
    fn write16(&mut self, chunk: &[u16], offset: u32) -> bool;
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
