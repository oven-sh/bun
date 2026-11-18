//! Access to the characters of a string.

use core::ops::{Deref, Range};
use core::ptr::NonNull;

use bun_alloc::AllocError;
use bun_engine_text::{PackedText, StringImpl, StringRef, Text};

use super::string::impl_at;
use crate::heap::{MutatorState, keep_alive};
use crate::{Cx, Gc, JsResult, JsRopeString, JsString, NoGc, Vm};

/// The characters of a string, which stay where they are while this is alive.
pub struct StringView {
    owner: Gc<JsString>,
    offset: u32,
    text: PackedText<'static>,
}

impl StringView {
    #[inline(always)]
    fn of_flat(owner: Gc<JsString>) -> StringView {
        StringView {
            owner,
            offset: 0,
            // SAFETY: as in `ResolvedString::deref`.
            text: unsafe { impl_at(owner.fiber()).as_ref() }.text().pack(),
        }
    }

    #[inline(always)]
    pub fn text(&self) -> Text<'_> {
        self.text.unpack()
    }

    /// The string that has the characters, which is no rope, and where they start in it.
    #[inline(always)]
    pub fn owner(&self) -> (Gc<JsString>, u32) {
        (self.owner, self.offset)
    }

    /// Panics if the range is not inside the view.
    #[inline(always)]
    pub fn substring(&self, vm: &Vm, range: Range<usize>) -> Gc<JsString> {
        let start = self.offset + range.start as u32;
        JsRopeString::substring(vm, self.owner, start, self.text().slice(range))
    }
}

impl Drop for StringView {
    #[inline(always)]
    fn drop(&mut self) {
        keep_alive(self.owner.address());
    }
}

/// The same, of a string that has its own `StringImpl`.
pub struct ResolvedString {
    owner: Gc<JsString>,
    string: NonNull<StringImpl>,
}

impl ResolvedString {
    #[inline(always)]
    fn of_flat(owner: Gc<JsString>) -> ResolvedString {
        ResolvedString {
            owner,
            string: impl_at(owner.fiber()),
        }
    }
}

impl Deref for ResolvedString {
    type Target = StringImpl;

    #[inline(always)]
    fn deref(&self) -> &StringImpl {
        // SAFETY: the owner holds it or, having swapped it for an atom, the `Vm` does while the owner is on the stack.
        unsafe { self.string.as_ref() }
    }
}

impl Drop for ResolvedString {
    #[inline(always)]
    fn drop(&mut self) {
        keep_alive(self.owner.address());
    }
}

impl JsString {
    #[inline(always)]
    pub fn try_resolved(&self) -> Option<ResolvedString> {
        (!self.is_rope()).then(|| ResolvedString::of_flat(self.into()))
    }

    #[inline(always)]
    pub fn try_resolve(&self, vm: &Vm) -> Result<ResolvedString, AllocError> {
        if let Some(rope) = self.as_rope() {
            rope.flatten(vm)?;
        }
        Ok(ResolvedString::of_flat(self.into()))
    }

    #[inline(always)]
    pub fn resolve(&self, cx: &Cx) -> JsResult<ResolvedString> {
        cx.or_out_of_memory(self.try_resolve(cx))
    }

    /// For code that has no right to allocate in the heap. Empty if there is no memory.
    pub fn to_string_without_collecting(&self) -> StringRef {
        // During a collection the string may be dead, and it may be too late to have it destroyed.
        if let Some(rope) = self.as_rope()
            && self.heap().mutator_state() == MutatorState::Running
            && rope.flatten_without_collecting().is_err()
        {
            return StringRef::empty();
        }
        self.to_string_without_resolving()
    }

    /// The same. `None` if there is no memory.
    #[inline(always)]
    pub(crate) fn view_without_collecting(&self) -> Option<StringView> {
        if let Some(rope) = self.as_concatenation() {
            rope.flatten_without_collecting().ok()?;
        }
        self.try_view()
    }

    pub fn to_string_ref(&self, cx: &Cx) -> JsResult<StringRef> {
        Ok(StringRef::retain(&*self.resolve(cx)?))
    }

    /// Unless the characters have to be put together first.
    #[inline(always)]
    pub fn try_view(&self) -> Option<StringView> {
        let Some(rope) = self.as_rope() else {
            return Some(StringView::of_flat(self.into()));
        };
        let (base, offset) = rope.as_substring()?;
        let mut view = StringView::of_flat(base);
        view.offset = offset;
        let range = offset as usize..(offset + rope.rope_length()) as usize;
        view.text = view.text.unpack().slice(range).pack();
        Some(view)
    }

    /// The same, without a guard.
    #[inline(always)]
    pub fn try_text<'a>(&self, _: &'a NoGc<'_>) -> Option<Text<'a>> {
        self.try_view().map(|view| view.text.unpack())
    }

    #[inline(always)]
    pub fn view(&self, cx: &Cx) -> JsResult<StringView> {
        match self.try_view() {
            Some(view) => Ok(view),
            None => Ok(StringView::of_flat(self.resolve(cx)?.owner)),
        }
    }

    /// Panics past the end.
    #[inline(always)]
    pub fn unit_at(&self, cx: &Cx, index: u32) -> JsResult<u16> {
        Ok(self.view(cx)?.text().at(index as usize))
    }

    /// Panics past the end.
    #[inline(always)]
    pub fn string_at(&self, cx: &Cx, index: u32) -> JsResult<Gc<JsString>> {
        Ok(Self::from_unit(cx, self.unit_at(cx, index)?))
    }

    /// Panics if the range is not inside the string.
    #[inline(always)]
    pub fn substring(&self, cx: &Cx, start: u32, end: u32) -> JsResult<Gc<JsString>> {
        match self.try_view() {
            Some(view) if start == 0 && end as usize == view.text().len() => Ok(self.into()),
            Some(view) => Ok(view.substring(cx, start as usize..end as usize)),
            None => self.substring_of_concatenation(cx, start, end),
        }
    }

    #[inline(never)]
    fn substring_of_concatenation(&self, cx: &Cx, start: u32, end: u32) -> JsResult<Gc<JsString>> {
        assert!(start <= end && end <= self.len());
        if start == end {
            return Ok(cx.small_strings.empty());
        }
        let (fiber, offset) = self.fiber_containing(start..end);
        if end - start == fiber.len() {
            return Ok(fiber);
        }
        // A character is copied once for each time that the length of what has it grows fourfold.
        if fiber.is_concatenation() && fiber.len() > self.len() / 4 {
            return Ok(self.view(cx)?.substring(cx, start as usize..end as usize));
        }
        let range = offset as usize..(offset + end - start) as usize;
        Ok(fiber.view(cx)?.substring(cx, range))
    }
}
