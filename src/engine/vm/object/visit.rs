use core::sync::atomic::Ordering;

use crate::heap::{HeapAnalyzer, Marker, delay};
use crate::{
    CellType, Class, ElementKind, Gc, ImmutableArray, JsCell, JsDestructibleObject, JsFinalObject,
    JsObject, JsString, PropertyOffset, Storage, TypeFlags, Value,
};

/// False, having done nothing, if it is of another kind.
#[inline(always)]
pub(crate) fn visit_common_cell(cell: Gc<JsCell>, marker: &mut impl Marker) -> bool {
    // SAFETY: each type means that class and no other.
    unsafe {
        match cell.cell_type() {
            CellType::FinalObject => cell.cast_unchecked::<JsFinalObject>().visit(marker),
            CellType::String => cell.cast_unchecked::<JsString>().visit_fibers(marker),
            CellType::Array => {
                (cell.cast_unchecked::<JsObject>()).visit_shape_and_storage(marker);
            }
            _ => return false,
        }
    }
    true
}

pub(crate) unsafe extern "C" fn destroy_by_class_field(cell: *mut JsCell) {
    // SAFETY: the space has only `JsDestructibleObject`s.
    unsafe {
        let class = cell
            .byte_add(JsDestructibleObject::OFFSET_OF_CLASS)
            .cast::<&'static Class>()
            .read();
        (class.ops().destroy)(cell);
    }
}

pub(crate) unsafe extern "C" fn destroy_by_shape(cell: *mut JsCell) {
    // SAFETY: the space has only cells whose shape is destroyed after them.
    unsafe { ((*cell).class().ops().destroy)(cell) }
}

impl JsObject {
    /// The highest offset in use, unless the object was caught in the middle of a change.
    #[inline(always)]
    pub(super) fn visit_shape_and_storage(
        &self,
        visitor: &mut impl Marker,
    ) -> Option<PropertyOffset> {
        let is_fenced = visitor.is_fenced();
        let order = if is_fenced {
            Ordering::Acquire
        } else {
            Ordering::Relaxed
        };
        let id = self.load_shape_id(order);
        visitor.append_shape(id);
        if is_fenced && id.is_nuked() {
            visitor.did_race();
            return None;
        }
        // SAFETY: not nuked, and kept alive by the cell.
        let shape = unsafe { visitor.decode(id) };
        let rarity = if shape.slot_count() < 4 && !shape.instance_indexing_mode().has_elements() {
            500
        } else {
            5
        };
        delay::of_helper(rarity);
        let max_offset = shape.load_max_offset(order);
        delay::of_helper(rarity);
        let storage = self.load_storage(order);
        if storage.is_none() {
            return Some(max_offset);
        }
        let mode = shape.instance_indexing_mode();
        let capacity = max_offset.out_of_line_capacity();
        delay::of_helper(rarity);
        let flags = self.load_inline_flags(order);
        delay::of_helper(rarity);
        if is_fenced
            && (self.load_shape_id(order) != id
                || shape.max_offset() != max_offset
                || self.load_storage(order) != storage)
        {
            visitor.did_race();
            return None;
        }
        delay::of_helper(rarity);
        // SAFETY: the shape and the storage went together at one time, and memory is not freed during marking.
        unsafe {
            if mode.is_copy_on_write() {
                let array = ImmutableArray::from_storage(storage);
                visitor.append_word(array.address() as u64);
                return Some(max_offset);
            }
            let mut base = storage.base(capacity);
            if flags.contains(TypeFlags::HAS_PRE_CAPACITY) {
                base -= storage.pre_capacity(capacity) * size_of::<u64>();
            }
            visitor.mark_auxiliary(base);
            let slots = storage.slots(max_offset.out_of_line_size());
            visitor.append_slots(slots.as_ptr().cast(), slots.len());
            match mode.kind() {
                ElementKind::Contiguous => visitor.append_elements(storage),
                ElementKind::Sparse => {
                    visitor.append_word(storage.value_at(0).word_concurrently());
                }
                _ => {}
            }
        }
        Some(max_offset)
    }

    pub fn analyze_properties(&self, analyzer: &mut HeapAnalyzer) {
        let this = Gc::from(self.as_cell());
        for (name, offset, _) in self.shape().properties().iter() {
            if let Some(cell) = self.get_direct_at(offset).as_cell() {
                analyzer.property_edge(this, cell, name);
            }
        }
        if self.element_kind() == ElementKind::Contiguous {
            for index in 0..self.public_length() {
                if let Some(cell) = self.try_get_dense(index).and_then(Value::as_cell) {
                    analyzer.index_edge(this, cell, index);
                }
            }
        }
    }

    pub(crate) fn storage_size(&self) -> usize {
        if self.indexing_mode().is_copy_on_write() {
            return 0;
        }
        let has_elements = self.indexing_mode().has_elements();
        // SAFETY: it has elements.
        let words = has_elements.then(|| unsafe { self.element_words() });
        Storage::size(self.shape().out_of_line_capacity(), words)
    }
}
