//! Changes to many dense elements at once. Each `try_` function does nothing and returns false unless the result is
//! that of getting, setting and deleting the properties one by one.

use core::ops::Range;

use bun_alloc::AllocError;

use super::elements::{MIN_SPARSE_INDEX, grown_vector_length, store_unchecked};
use crate::heap::barrier;
use crate::{ElementKind, JsArray, JsObject, Storage, Value, Vm};

/// Up to here, moving the elements is cheaper than what it takes to avoid that.
const MAX_MOVED_BY_SHIFT: u32 = 32;

impl JsObject {
    /// Whether the first `length` elements are in the storage and can be moved around as words: nothing would see a
    /// hole being read or written. They may still be shared.
    #[inline(always)]
    fn can_move_elements(&self, length: u64) -> bool {
        self.has_unrestricted_elements()
            && length <= u64::from(self.public_length())
            && (!self.holes_must_forward_to_prototype()
                // SAFETY: only reads.
                || unsafe { self.elements_unchecked() }.is_some_and(|it| !it.has_holes()))
    }

    /// A marker may have missed an element, but the object refers to nothing new.
    #[inline(always)]
    fn did_move_elements(&self) {
        if barrier::is_fenced() {
            self.write_barrier_for_cell();
        }
    }

    /// Adds or replaces plain data elements from `start` on, whatever the attributes or prototypes say. Panics unless
    /// the elements are dense.
    #[inline]
    pub(super) fn store_elements(
        &self,
        vm: &Vm,
        start: u32,
        values: &[Value],
    ) -> Result<(), AllocError> {
        let end = u32::try_from(start as usize + values.len()).map_err(|_| AllocError)?;
        let kind = self.element_kind().generalized_for_slice(values);
        self.reserve_elements(vm, end)?;
        self.ensure_element_kind(vm, kind)?;
        let storage = self.storage();
        // SAFETY: inside, the kind can represent the values, and the barrier follows.
        unsafe {
            storage.set_public_length(storage.public_length().max(end));
            if kind == ElementKind::Double {
                for (index, &value) in (start..end).zip(values) {
                    store_unchecked(storage, kind, index, value);
                }
            } else {
                let first = storage.elements_ptr().add(start as usize);
                barrier::move_words(values.as_ptr().cast(), first, values.len());
            }
        }
        if kind == ElementKind::Contiguous {
            self.write_barrier_for_cell();
        }
        Ok(())
    }

    /// From `start` on, which is at most the public length.
    #[inline]
    pub fn try_set_elements(
        &self,
        vm: &Vm,
        start: u64,
        values: &[Value],
    ) -> Result<bool, AllocError> {
        if !self.has_unrestricted_elements()
            || start > u64::from(self.public_length())
            || start + values.len() as u64 > u64::from(Storage::MAX_VECTOR_LENGTH)
        {
            return Ok(false);
        }
        self.store_elements(vm, start as u32, values)?;
        Ok(true)
    }

    pub fn try_fill_elements(
        &self,
        vm: &Vm,
        range: Range<u64>,
        value: Value,
    ) -> Result<bool, AllocError> {
        if !self.has_unrestricted_elements()
            || range.start > range.end
            || range.end > u64::from(self.public_length())
        {
            return Ok(false);
        }
        self.ensure_element_kind(vm, ElementKind::for_value(value))?;
        let word = match value.as_number() {
            Some(number) if self.element_kind() == ElementKind::Double => number.to_bits(),
            _ => value.to_bits(),
        };
        // SAFETY: inside, the kind can represent the value, and the barrier follows.
        unsafe {
            let first = self.storage().elements_ptr().add(range.start as usize);
            barrier::fill_words(first, (range.end - range.start) as usize, word);
        }
        self.write_barrier(value);
        Ok(true)
    }

    /// Of the first `length`.
    pub fn try_reverse_elements(&self, vm: &Vm, length: u64) -> Result<bool, AllocError> {
        if !self.can_move_elements(length) {
            return Ok(false);
        }
        self.try_ensure_writable_elements(vm)?;
        // SAFETY: inside.
        unsafe { barrier::reverse_words(self.storage().elements_ptr(), length as usize) };
        self.did_move_elements();
        Ok(true)
    }

    pub fn try_copy_elements_within(
        &self,
        vm: &Vm,
        from: u64,
        to: u64,
        count: u64,
    ) -> Result<bool, AllocError> {
        if !self.can_move_elements(from.max(to).saturating_add(count)) {
            return Ok(false);
        }
        self.try_ensure_writable_elements(vm)?;
        // SAFETY: inside.
        unsafe { (self.storage()).move_elements(from as u32, to as u32, count as u32) };
        self.did_move_elements();
        Ok(true)
    }
}

impl JsArray {
    /// `Array.prototype.shift`. `None` if nothing has been done.
    #[inline]
    pub fn try_shift(&self, _: &Vm) -> Option<Value> {
        if !self.has_plain_writable_elements() {
            return None;
        }
        if self.length() == 0 {
            return Some(Value::UNDEFINED);
        }
        let first = self.try_get_dense(0)?;
        self.can_move_elements(0).then(|| {
            self.remove_range(0, 1);
            first
        })
    }

    /// Replaces `removed` elements from `start` on, if the array has that length.
    #[inline]
    pub fn try_splice(
        &self,
        vm: &Vm,
        length: u64,
        start: u64,
        removed: u64,
        items: &[Value],
    ) -> Result<bool, AllocError> {
        let added = items.len() as u64;
        if length != u64::from(self.length())
            || !self.can_move_elements(length)
            || length + added > u64::from(Storage::MAX_VECTOR_LENGTH) + removed
        {
            return Ok(false);
        }
        assert!(start <= length && removed <= length - start);
        let (start, removed, added) = (start as u32, removed as u32, added as u32);
        if added > removed {
            self.insert_holes(vm, start + removed, added - removed)?;
        } else if added < removed {
            self.try_ensure_writable_elements(vm)?;
            self.remove_range(start + added, removed - added);
        }
        if added != 0 {
            self.store_elements(vm, start, items)?;
        }
        Ok(true)
    }

    /// The elements are writable and can be moved, and the range is inside.
    #[inline]
    fn remove_range(&self, start: u32, count: u32) {
        let (kind, length, storage) = (self.element_kind(), self.length(), self.storage());
        let tail = length - start - count;
        // SAFETY: all ranges are inside the vector, and the words that the header moves to have been vacated.
        unsafe {
            if tail > MAX_MOVED_BY_SHIFT && start < tail && !self.may_be_read_by_marker() {
                let capacity = self.shape().out_of_line_capacity();
                let pre_capacity = self.pre_capacity(capacity) + count as usize;
                let vector_length = storage.vector_length() - count;
                storage.move_elements(0, count, start);
                let moved = storage.shift_header(capacity, count as isize);
                moved.set_lengths(length - count, vector_length);
                moved.set_pre_capacity(capacity, pre_capacity);
                self.set_moved_storage(moved, true);
            } else {
                storage.move_elements(start + count, start, tail);
                storage.clear_elements(kind, length - count, length);
                storage.set_public_length(length - count);
                self.did_move_elements();
            }
        }
    }

    /// The elements can be moved, `start` is at most the length, and the new length is at most the limit.
    fn insert_holes(&self, vm: &Vm, start: u32, count: u32) -> Result<(), AllocError> {
        let (kind, length) = (self.element_kind(), self.length());
        let (new_length, tail) = (length + count, length - start);
        let moves_front = tail > MAX_MOVED_BY_SHIFT && start < tail;
        if !moves_front || self.indexing_mode().is_copy_on_write() || self.may_be_read_by_marker() {
            self.ensure_public_length(vm, new_length)?;
            // SAFETY: inside the new length.
            unsafe {
                self.storage().move_elements(start, start + count, tail);
                self.storage().clear_elements(kind, start, start + count);
            }
            self.did_move_elements();
            return Ok(());
        }
        let capacity = self.shape().out_of_line_capacity();
        let vector_length = self.vector_length() + count;
        let left = (self.pre_capacity(capacity).checked_sub(count as usize))
            .filter(|_| vector_length <= Storage::MAX_VECTOR_LENGTH);
        let Some(left) = left else {
            return self.reallocate_with_holes(vm, start, count);
        };
        // SAFETY: the header moves into unused words of the same allocation.
        unsafe {
            let moved = self.storage().shift_header(capacity, -(count as isize));
            moved.set_lengths(new_length, vector_length);
            moved.move_elements(count, 0, start);
            moved.clear_elements(kind, start, start + count);
            if left != 0 {
                moved.set_pre_capacity(capacity, left);
            }
            self.set_moved_storage(moved, left != 0);
        }
        Ok(())
    }

    /// The room for growth is in front, but for half of what was left at the end.
    #[inline(never)]
    fn reallocate_with_holes(&self, vm: &Vm, start: u32, count: u32) -> Result<(), AllocError> {
        let (kind, length, shape) = (self.element_kind(), self.length(), self.shape());
        let (capacity, new_length) = (shape.out_of_line_capacity(), length + count);
        let total = grown_vector_length(capacity, new_length, new_length);
        let vector_length = total.min(new_length + (self.vector_length() - length) / 2);
        let pre_capacity = (total - vector_length) as usize;
        let new = Storage::try_allocate(vm, pre_capacity, capacity, Some(vector_length))?;
        // SAFETY: inside both, and every word that is in use is written.
        unsafe {
            let old = self.storage();
            old.copy_words_to(new, -1 - capacity as isize, capacity + 1 + start as usize);
            old.copy_elements_to(start, new, start + count, length - start);
            new.clear_elements(kind, start, start + count);
            new.clear_elements(kind, new_length, vector_length);
            new.set_lengths(new_length, vector_length);
            if pre_capacity != 0 {
                new.set_pre_capacity(capacity, pre_capacity);
            }
            self.set_shape_and_storage(&shape, new, pre_capacity != 0);
        }
        Ok(())
    }

    /// Defines the first `count` elements of `source`, but for its holes, from `start` on.
    pub fn try_append_elements(
        &self,
        vm: &Vm,
        start: u64,
        source: &JsObject,
        count: u64,
    ) -> Result<bool, AllocError> {
        let (from, length) = (source.element_kind(), u64::from(self.length()));
        if !from.is_dense()
            || from == ElementKind::Undecided
            || !self.has_unrestricted_elements()
            || !(length..=length + u64::from(MIN_SPARSE_INDEX)).contains(&start)
            || count > u64::from(source.public_length())
            || start + count > u64::from(Storage::MAX_VECTOR_LENGTH)
            || source.holes_must_forward_to_prototype()
        {
            return Ok(false);
        }
        let (start, count) = (start as u32, count as u32);
        // The length goes as far as the last element that is defined.
        match count.checked_sub(1).map(|last| source.try_get_dense(last)) {
            None => return Ok(true),
            Some(None) => return Ok(false),
            Some(Some(_)) => {}
        }
        self.reserve_elements(vm, start + count)?;
        self.ensure_element_kind(vm, from)?;
        self.ensure_public_length(vm, start + count)?;
        let (to, from) = (self.element_kind(), source.element_kind());
        // SAFETY: inside both, and `to` is at least as general as `from`.
        unsafe {
            let target = self.storage();
            if (to == ElementKind::Double) == (from == ElementKind::Double) {
                let first = target.elements_ptr().add(start as usize);
                barrier::move_words(source.storage().elements_ptr(), first, count as usize);
            } else {
                for index in 0..count {
                    if let Some(value) = source.try_get_dense(index) {
                        store_unchecked(target, to, start + index, value);
                    }
                }
            }
        }
        self.write_barrier_for_cell();
        Ok(true)
    }
}
