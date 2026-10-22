//! Rust side of `src/jsc/bindings/Bindgen/Extern*.h`. The generated conversion that reads a value takes ownership.

use core::ffi::{c_uint, c_void};

use super::JsHeap;
use crate::{JSGlobalObject, JSValue};

/// `WTF::StringImpl*` carrying one ref, or null.
pub type ExternString = *mut bun_core::WTFStringImplStruct;

/// A WTF-backed `String` is never empty, as in `Bun::toString`.
#[inline]
pub fn adopt_string(ptr: ExternString) -> bun_core::String {
    let string = bun_core::String::adopt_wtf_impl(ptr);
    if string.is_empty() {
        return bun_core::String::EMPTY;
    }
    string
}

/// What `std::optional<T>` lowers to.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ExternOptional<T: Copy> {
    data: ExternOptionalData<T>,
    tag: u8,
}
#[repr(C)]
#[derive(Clone, Copy)]
union ExternOptionalData<T: Copy> {
    none: u8,
    some: T,
}
impl<T: Copy> ExternOptional<T> {
    #[inline(always)]
    pub fn get(self) -> Option<T> {
        if self.tag == 0 {
            return None;
        }
        // SAFETY: C++ initialized the alternative `tag` names.
        Some(unsafe { self.data.some })
    }
}

/// A mimalloc buffer this side now owns.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ExternVector<T: Copy> {
    data: *mut T,
    length: c_uint,
    capacity: c_uint,
}
impl<T: Copy> ExternVector<T> {
    /// The buffer becomes the `Vec`, where the global allocator is the one C++ used.
    ///
    /// # Safety
    /// No copy of `self` is used again.
    #[inline]
    pub unsafe fn into_vec(self) -> Vec<T> {
        if !bun_alloc::USE_MIMALLOC || self.data.is_null() {
            // SAFETY: forwarded.
            return unsafe { self.into_vec_with(|item| item) };
        }
        // SAFETY: a mimalloc buffer of `capacity` elements, `length` of them initialized; ownership was transferred.
        unsafe { Vec::from_raw_parts(self.data, self.length as usize, self.capacity as usize) }
    }

    /// Converts every element and frees the buffer.
    ///
    /// # Safety
    /// As [`into_vec`](Self::into_vec).
    #[inline]
    pub unsafe fn into_vec_with<U>(self, mut convert: impl FnMut(T) -> U) -> Vec<U> {
        if self.data.is_null() {
            return Vec::new();
        }
        // SAFETY: C++ initialized `length` elements.
        let items = unsafe { core::slice::from_raw_parts(self.data, self.length as usize) };
        let result = items.iter().map(|item| convert(*item)).collect();
        // SAFETY: allocated by `Bun::MimallocMalloc`; ownership was transferred.
        unsafe { bun_alloc::basic::free_without_size(self.data.cast()) };
        result
    }
}

/// Bytes in the C++ host function's frame, or in a JS value that frame keeps alive, until it returns. Another thread can write those of a shared buffer.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ExternBytes {
    data: *const u8,
    length: usize,
}
impl ExternBytes {
    /// # Safety
    /// The host function that passed this is the call `heap` belongs to.
    #[inline(always)]
    pub unsafe fn get<'a>(self, _: &JsHeap<'a>) -> &'a [u8] {
        // SAFETY: C++ never passes a null pointer for a present value.
        unsafe { core::slice::from_raw_parts(self.data, self.length) }
    }
    /// # Safety
    /// As [`get`](Self::get).
    #[inline(always)]
    pub unsafe fn get_optional<'a>(self, heap: &JsHeap<'a>) -> Option<&'a [u8]> {
        if self.data.is_null() {
            return None;
        }
        // SAFETY: forwarded.
        Some(unsafe { self.get(heap) })
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ExternWithValue<T: Copy> {
    pub converted: T,
    pub value: JSValue,
}

unsafe extern "C" {
    /// `value` is a `BufferSource`, or holds a `Blob` whose bytes are in memory.
    pub(super) safe fn Bun__Bindgen__bytesOfBlobOrBuffer(value: JSValue) -> ExternBytes;
    /// As above. Always sets `is_shared`.
    pub(super) safe fn Bun__Bindgen__bytesOfBlobOrBufferAndIsShared(
        value: JSValue,
        is_shared: &mut bool,
    ) -> ExternBytes;
    pub(super) fn Bun__Bindgen__constructArrayFromValues(
        global: *mut JSGlobalObject,
        values: *const JSValue,
        count: usize,
    ) -> JSValue;
    pub(super) fn Bun__Bindgen__createNullPrototypeObject(
        global: *mut JSGlobalObject,
        first_member_name_index: u32,
        values: *const JSValue,
        count: usize,
    ) -> JSValue;
    pub(super) fn Bun__Bindgen__createObject(
        global: *mut JSGlobalObject,
        first_member_name_index: u32,
        values: *const JSValue,
        count: usize,
    ) -> JSValue;
    pub(super) fn Bun__Bindgen__enumerationValueToJS(
        global: *mut JSGlobalObject,
        index: u32,
    ) -> JSValue;
    pub(super) fn Bun__Bindgen__putRecordEntry(
        global: &JSGlobalObject,
        record: JSValue,
        key: *const u8,
        key_length: usize,
        value: JSValue,
    ) -> bool;
    pub(super) fn Bun__Bindgen__setInternalField(
        global: *mut JSGlobalObject,
        cell: *mut c_void,
        offset: u32,
        value: JSValue,
    );
}
