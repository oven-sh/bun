use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::StringView;
use bun_core::Utf8Bytes;
use bun_core::strings::CodeUnits;

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
    fn JSC__JSString__firstCharacters(this: &JSString, characters: *mut u16, capacity: u32);
    safe fn JSC__JSString__singleLatin1Character(global: &JSGlobalObject, character: u8)
    -> JSValue;
    fn JSC__JSString__tryCreateUninitializedLatin1(
        global: &JSGlobalObject,
        length: u32,
        characters: *mut *mut u8,
    ) -> JSValue;
}

/// Where `JSC::JSString` and `JSC::JSRopeString` keep what [`JSString::characters`] reads. bindings.cpp asserts each of these beside `JSC__JSString__substringOfResolved`.
mod layout {
    /// `JSString::m_fiber`: a `StringImpl*`, or the flags of a rope.
    pub(super) const FIBER: usize = 8;
    pub(super) const IS_ROPE: usize = 1;
    pub(super) const IS_SUBSTRING: usize = 2;
    pub(super) const ROPE_LENGTH: usize = 16;
    /// The base of a substring is its second fiber, a pointer in two parts.
    pub(super) const FIBER1_LOWER: usize = 20;
    pub(super) const FIBER1_UPPER: usize = 24;
    /// The offset of a substring is its third fiber: 48 bits that start here.
    pub(super) const FIBER2_LOWER: usize = 26;
}

/// The characters of a string and where they lie in a string that is no rope, so that a part of them can be answered as a substring.
#[derive(Clone, Copy)]
pub(crate) struct Characters<'a> {
    /// The string itself, or the base of a substring. Never a rope.
    pub(crate) owner: &'a JSString,
    /// Where `units` start in `owner`.
    pub(crate) offset: u32,
    pub(crate) units: CodeUnits<'a>,
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

    /// The characters of a string that is no rope, read in place.
    #[inline(always)]
    pub(crate) fn flat_characters(&self) -> Option<CodeUnits<'_>> {
        // SAFETY: every JSString has `m_fiber`.
        let fiber: usize = unsafe { self.read_at(layout::FIBER) };
        if fiber & layout::IS_ROPE != 0 {
            return None;
        }
        // SAFETY: the fiber of a string that is no rope is its StringImpl, never null.
        let text = unsafe { &*(fiber as *const bun_core::WTFStringImplStruct) };
        let length = text.length() as usize;
        // SAFETY: a StringImpl has that many characters there, of the width that it says.
        Some(unsafe {
            if text.is_8bit() {
                CodeUnits::U8(core::slice::from_raw_parts(text.m_ptr.latin1, length))
            } else {
                CodeUnits::U16(core::slice::from_raw_parts(text.m_ptr.utf16, length))
            }
        })
    }

    /// Whether it is a rope that is no substring.
    #[inline(always)]
    pub(crate) fn has_to_be_resolved(&self) -> bool {
        // SAFETY: every JSString has `m_fiber`.
        let fiber: usize = unsafe { self.read_at(layout::FIBER) };
        fiber & layout::IS_ROPE != 0 && fiber & layout::IS_SUBSTRING == 0
    }

    /// The characters, read in place: nothing resolved, nothing thrown. `None` for a rope that is no substring.
    /// The width of a substring's characters is that of its base's storage now: a string that is used as a
    /// property key takes the storage of an equal key, of either width.
    #[inline(always)]
    pub(crate) fn characters(&self) -> Option<Characters<'_>> {
        if let Some(units) = self.flat_characters() {
            return Some(Characters {
                owner: self,
                offset: 0,
                units,
            });
        }
        // SAFETY: every JSString has `m_fiber`.
        let fiber: usize = unsafe { self.read_at(layout::FIBER) };
        if fiber & layout::IS_SUBSTRING == 0 {
            return None;
        }
        // SAFETY: `fiber` says that this cell is a JSRopeString, which has these fields. The
        // base of a substring is a JSString that the substring keeps alive.
        let (owner, offset, length) = unsafe {
            let length: u32 = self.read_at(layout::ROPE_LENGTH);
            let lower: u32 = self.read_at(layout::FIBER1_LOWER);
            let upper: u16 = self.read_at(layout::FIBER1_UPPER);
            let offset: u32 = self.read_at(layout::FIBER2_LOWER);
            let owner = &*(((upper as usize) << 32 | lower as usize) as *const JSString);
            (owner, offset, length)
        };
        let range = offset as usize..offset as usize + length as usize;
        let units = match owner.flat_characters()? {
            CodeUnits::U8(units) => CodeUnits::U8(&units[range]),
            CodeUnits::U16(units) => CodeUnits::U16(&units[range]),
        };
        Some(Characters {
            owner,
            offset,
            units,
        })
    }

    /// The first `N` characters, and 0 for those it does not have.
    #[cold]
    pub(crate) fn first_characters<const N: usize>(&self) -> [u16; N] {
        let mut characters = [0; N];
        // SAFETY: at most `N` of them are written.
        unsafe { JSC__JSString__firstCharacters(self, characters.as_mut_ptr(), N as u32) };
        characters
    }

    /// `length` characters of this string from `offset` on, sharing them with it.
    #[inline(always)]
    pub(crate) unsafe fn substring_of_resolved(
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
    pub(crate) unsafe fn substrings_of_resolved<const N: usize>(
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
        // SAFETY: an element of a local array. One by one, as they were written: a wider load would wait for the stores.
        core::array::from_fn(|index| unsafe { (&raw const substrings[index]).read_volatile() })
    }

    /// `JSString::MaxLength`.
    pub const MAX_LENGTH: usize = i32::MAX as usize;

    /// The string of one 8-bit character, which every VM already has.
    #[inline]
    pub fn single_latin1_character(global: &JSGlobalObject, character: u8) -> JSValue {
        JSC__JSString__singleLatin1Character(global, character)
    }

    /// A new 8-bit string of `length` characters (2 to [`JSString::MAX_LENGTH`]), `None` when they cannot be allocated. SAFETY: `fill` writes all of them.
    #[inline(always)]
    pub(crate) unsafe fn try_create_latin1_with(
        global: &JSGlobalObject,
        length: usize,
        fill: impl FnOnce(*mut u8),
    ) -> Option<JSValue> {
        assert!(length >= 2 && length <= Self::MAX_LENGTH);
        let mut characters = core::ptr::null_mut();
        // SAFETY: `characters` receives the address of `length` bytes that the new string owns.
        let string = unsafe {
            JSC__JSString__tryCreateUninitializedLatin1(global, length as u32, &raw mut characters)
        };
        if string.is_empty() {
            return None;
        }
        fill(characters);
        Some(string)
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
