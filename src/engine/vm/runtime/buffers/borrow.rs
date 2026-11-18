use core::ops::Deref;

use super::element::Element;
use super::slice::BufferSlice;
use crate::JsCell;
use crate::heap::keep_alive;

/// A reference to memory that no other thread has. It keeps the object that has the memory alive.
pub struct Borrowed<'a, T> {
    owner: &'a JsCell,
    elements: &'a [T],
}

impl<'a, T: Element> Borrowed<'a, T> {
    /// # Safety
    /// They are aligned, `owner` keeps them alive, and nothing changes them for `'a`.
    #[inline(always)]
    pub(super) unsafe fn new(owner: &'a JsCell, elements: BufferSlice<'a, T>) -> Borrowed<'a, T> {
        Borrowed {
            owner,
            // SAFETY: the caller's.
            elements: unsafe { core::slice::from_raw_parts(elements.as_ptr(), elements.len()) },
        }
    }
}

impl<T> Deref for Borrowed<'_, T> {
    type Target = [T];

    #[inline(always)]
    fn deref(&self) -> &[T] {
        self.elements
    }
}

impl<T> Drop for Borrowed<'_, T> {
    #[inline(always)]
    fn drop(&mut self) {
        keep_alive(self.owner.address());
    }
}
