//! What the headers in `include/engine/text` pass. C++ keeps it valid for the call.

use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::MaybeUninit;

use bun_engine_text::{AllocError, Text};

/// `notFound`
pub(crate) const NOT_FOUND: usize = usize::MAX;

/// `StringView`
#[derive(Clone, Copy)]
#[repr(C)]
pub(crate) struct RawText<'a> {
    characters: *const c_void,
    length: u32,
    is_latin1: bool,
    lifetime: PhantomData<Text<'a>>,
}

impl<'a> RawText<'a> {
    #[inline(always)]
    pub(crate) fn text(self) -> Text<'a> {
        let length = self.length as usize;
        // SAFETY: only C++ makes views, of `length` units of the width that the flag names.
        unsafe {
            if self.is_latin1 {
                Text::Latin1(slice(self.characters.cast(), length))
            } else {
                Text::Utf16(slice(self.characters.cast(), length))
            }
        }
    }

    /// `None` for the null view.
    #[inline(always)]
    pub(crate) fn non_null(self) -> Option<Text<'a>> {
        (!self.characters.is_null()).then(|| self.text())
    }
}

/// # Safety
/// `length` elements that outlive `'a`.
#[inline(always)]
pub(crate) unsafe fn slice<'a, T>(first: *const T, length: usize) -> &'a [T] {
    if first.is_null() {
        return &[];
    }
    // SAFETY: the caller's.
    unsafe { core::slice::from_raw_parts(first, length) }
}

/// # Safety
/// Room for `length` elements that nothing else uses for `'a`.
#[inline(always)]
pub(crate) unsafe fn room<'a, T>(first: *mut T, length: usize) -> &'a mut [MaybeUninit<T>] {
    if first.is_null() {
        return &mut [];
    }
    // SAFETY: the caller's.
    unsafe { core::slice::from_raw_parts_mut(first.cast(), length) }
}

/// For the functions that have no way to fail.
#[inline(always)]
pub(crate) fn or_abort<T>(result: Result<T, AllocError>) -> T {
    result.unwrap_or_else(|_| bun_alloc::out_of_memory())
}
