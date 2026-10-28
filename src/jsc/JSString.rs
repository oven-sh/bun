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
        owner: &mut *const JSString,
    ) -> StringView<'a>;
    fn JSC__JSString__iterator(this: &JSString, global_object: &JSGlobalObject, iter: *mut c_void);
    safe fn JSC__JSString__length(this: &JSString) -> usize;
    safe fn JSC__JSString__is8Bit(this: &JSString) -> bool;
    fn JSC__JSString__substringOfResolved(
        this: &JSString,
        global: &JSGlobalObject,
        offset: u32,
        length: u32,
    ) -> JSValue;
    fn JSC__JSString__substringsOfResolved(
        this: &JSString,
        global: &JSGlobalObject,
        ranges: *const [u32; 2],
        count: usize,
        substrings: *mut JSValue,
    );
    fn JSC__JSString__firstCharacters(this: &JSString, characters: *mut u16, capacity: u32) -> u32;
    fn JSC__JSString__createUninitializedLatin1(
        global: &JSGlobalObject,
        length: u32,
        characters: *mut *mut u8,
    ) -> JSValue;
}

/// Where `JSC::JSString` and `JSC::JSRopeString` keep what [`JSString::latin1_characters`] reads. bindings.cpp asserts each of these beside `JSC__JSString__substringOfResolved`.
mod layout {
    /// `JSString::m_fiber`: a `StringImpl*`, or the flags of a rope.
    pub(super) const FIBER: usize = 8;
    pub(super) const IS_ROPE: usize = 1;
    pub(super) const IS_SUBSTRING: usize = 2;
    pub(super) const IS_8BIT: usize = 4;
    pub(super) const ROPE_LENGTH: usize = 16;
    /// The base of a substring is its second fiber, a pointer in two parts.
    pub(super) const FIBER1_LOWER: usize = 20;
    pub(super) const FIBER1_UPPER: usize = 24;
    /// The offset of a substring is its third fiber: 48 bits that start here.
    pub(super) const FIBER2_LOWER: usize = 26;
}

/// The characters of an 8-bit string and where they lie in a string that is no rope, so that a part of them can be answered as a substring.
#[derive(Clone, Copy)]
pub struct Latin1Characters<'a> {
    /// The string itself, or the base of a substring. Never a rope.
    pub owner: &'a JSString,
    /// Where `characters` start in `owner`.
    pub offset: u32,
    pub characters: &'a [u8],
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
        let mut owner: *const JSString = self;
        let view =
            crate::call_check_slow(global, || JSC__JSString__view(self, global, &mut owner))?;
        Ok(JSStringView {
            cell: self,
            owner: JSString::opaque_ref(owner),
            view,
        })
    }

    pub fn iterator(&self, global_object: &JSGlobalObject, iter: &mut Iterator) {
        // SAFETY: `self`/`global_object` are valid opaque GC-cell handles; `iter`
        // is a caller-owned `Iterator` (extern struct) passed through to C++.
        unsafe { JSC__JSString__iterator(self, global_object, core::ptr::from_mut(iter).cast()) }
    }

    pub fn length(&self) -> usize {
        JSC__JSString__length(self)
    }

    pub fn is_8bit(&self) -> bool {
        JSC__JSString__is8Bit(self)
    }

    #[inline(always)]
    unsafe fn read_at<T: Copy>(&self, offset: usize) -> T {
        // SAFETY: the caller names a field of this cell. `&JSString` covers none of its bytes,
        // so the address goes through an integer, as in `JSValue::js_type`.
        unsafe { ((std::ptr::from_ref(self) as usize + offset) as *const T).read_unaligned() }
    }

    /// The characters of an 8-bit string that is no rope, read in place.
    #[inline(always)]
    pub fn flat_latin1_characters(&self) -> Option<&[u8]> {
        // SAFETY: every JSString has `m_fiber`.
        let fiber: usize = unsafe { self.read_at(layout::FIBER) };
        if fiber & layout::IS_ROPE != 0 {
            return None;
        }
        // SAFETY: the fiber of a string that is no rope is its StringImpl, never null.
        let text = unsafe { &*(fiber as *const bun_core::WTFStringImplStruct) };
        if !text.is_8bit() {
            return None;
        }
        // SAFETY: an 8-bit StringImpl has that many Latin-1 characters there, and the pointer is not null, which spares
        // the caller of an inlined `Option<&[u8]>` the test for it.
        Some(unsafe {
            let characters = text.m_ptr.latin1;
            core::hint::assert_unchecked(!characters.is_null());
            core::slice::from_raw_parts(characters, text.length() as usize)
        })
    }

    /// The characters, read in place: no call, nothing resolved, nothing thrown.
    #[inline]
    pub fn latin1_characters(&self) -> Option<Latin1Characters<'_>> {
        // SAFETY: every JSString has `m_fiber`.
        let fiber: usize = unsafe { self.read_at(layout::FIBER) };
        if fiber & layout::IS_ROPE != 0 {
            return self.latin1_characters_of_substring(fiber);
        }
        Some(Latin1Characters {
            owner: self,
            offset: 0,
            characters: self.flat_latin1_characters()?,
        })
    }

    #[inline]
    fn latin1_characters_of_substring(&self, fiber: usize) -> Option<Latin1Characters<'_>> {
        const SUBSTRING_OF_8BIT: usize = layout::IS_SUBSTRING | layout::IS_8BIT;
        if fiber & SUBSTRING_OF_8BIT != SUBSTRING_OF_8BIT {
            return None;
        }
        // SAFETY: `fiber` says that this cell is a JSRopeString, which has these fields. The
        // base of a substring is a JSString that is no rope and that the substring keeps alive,
        // and offset + length lie within it.
        unsafe {
            let length: u32 = self.read_at(layout::ROPE_LENGTH);
            let lower: u32 = self.read_at(layout::FIBER1_LOWER);
            let upper: u16 = self.read_at(layout::FIBER1_UPPER);
            let offset: u32 = self.read_at(layout::FIBER2_LOWER);
            let owner = &*(((upper as usize) << 32 | lower as usize) as *const JSString);
            let text =
                &*(owner.read_at::<usize>(layout::FIBER) as *const bun_core::WTFStringImplStruct);
            Some(Latin1Characters {
                owner,
                offset,
                characters: core::slice::from_raw_parts(
                    text.m_ptr.latin1.add(offset as usize),
                    length as usize,
                ),
            })
        }
    }

    /// How many of the first characters were written to `characters`: all that fit.
    #[cold]
    pub fn first_characters(&self, characters: &mut [u16]) -> usize {
        // SAFETY: at most `characters.len()` of them are written.
        unsafe {
            JSC__JSString__firstCharacters(self, characters.as_mut_ptr(), characters.len() as u32)
                as usize
        }
    }

    /// `length` characters of this string from `offset` on, sharing them with it.
    #[inline(always)]
    pub unsafe fn substring_of_resolved(
        &self,
        global: &JSGlobalObject,
        offset: u32,
        length: u32,
    ) -> JSValue {
        // SAFETY: the caller's.
        unsafe { JSC__JSString__substringOfResolved(self, global, offset, length) }
    }

    /// As [`substring_of_resolved`](Self::substring_of_resolved), several with one call.
    #[inline(always)]
    pub unsafe fn substrings_of_resolved<const N: usize>(
        &self,
        global: &JSGlobalObject,
        ranges: &[[u32; 2]; N],
    ) -> [JSValue; N] {
        let mut substrings = [JSValue::ZERO; N];
        // SAFETY: `N` ranges are read and `N` values written.
        unsafe {
            JSC__JSString__substringsOfResolved(
                self,
                global,
                ranges.as_ptr(),
                N,
                substrings.as_mut_ptr(),
            )
        };
        substrings
    }

    /// `JSString::MaxLength`.
    pub const MAX_LENGTH: usize = i32::MAX as usize;

    /// A new 8-bit string of `length` characters (2 to [`JSString::MAX_LENGTH`]). SAFETY: `fill` writes all of them, and allocates nothing in the JavaScript heap.
    #[inline(always)]
    pub unsafe fn create_latin1_with(
        global: &JSGlobalObject,
        length: usize,
        fill: impl FnOnce(*mut u8),
    ) -> JSValue {
        assert!(length >= 2 && length <= Self::MAX_LENGTH);
        let mut characters = core::ptr::null_mut();
        // SAFETY: `characters` receives the address of `length` bytes that the new string owns.
        let string = unsafe {
            JSC__JSString__createUninitializedLatin1(global, length as u32, &raw mut characters)
        };
        fill(characters);
        string
    }
}

/// A JSString's characters, borrowed via `JSString::view` (a substring rope
/// is viewed in place, not flattened). Keeps the cell observable to the GC's
/// conservative stack scan until dropped (the Rust counterpart of
/// `GCOwnedDataScope`), so a string `toString()` just created cannot be
/// collected while its characters are in use.
pub struct JSStringView<'a> {
    pub(crate) cell: &'a JSString,
    /// The cell that owns the characters. It's the base string when `cell` is a substring rope.
    pub(crate) owner: &'a JSString,
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
        self.owner.ensure_still_alive();
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
