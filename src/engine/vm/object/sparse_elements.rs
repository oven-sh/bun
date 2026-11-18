use core::cell::Cell;
use core::ops::Range;

use bun_alloc::AllocError;
use bun_engine_macros::{Trace, cell};

use crate::{
    Attributes, DontEnumMode, Gc, JsCell, PropertyDescriptor, TracedMap, TypeFlags, Value, Vm,
};

#[derive(Clone, Copy, Trace)]
pub struct SparseEntry {
    /// A `GetterSetter` for an accessor.
    pub value: Value,
    pub attributes: Attributes,
}

impl SparseEntry {
    pub fn descriptor(self) -> PropertyDescriptor {
        PropertyDescriptor::stored(self.value, self.attributes)
    }
}

/// The elements of an object that has few of them for its length, or some with unusual attributes.
#[cell(name = "SparseArrayValueMap", cell_type = SparseElements, flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub struct SparseElements {
    base: JsCell,
    pub(self) map: TracedMap<u32, SparseEntry>,
    entries_with_attributes: Cell<u32>,
    /// `None` unless all entries have been added in that order, one next to the other.
    run: Cell<Option<Run>>,
}

/// With the index that goes on with it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Run {
    Ascending(u32),
    Descending(u32),
}

impl SparseElements {
    /// More take so much memory that the system is more likely to end the process than to refuse it.
    const MAX_LENGTH: usize = 1 << 26;

    pub(super) fn create(vm: &Vm) -> Gc<SparseElements> {
        vm.allocate::<SparseElements>(SparseElementsInit {
            base: vm.shapes.sparse_elements(),
            entries_with_attributes: Cell::new(0),
            run: Cell::new(None),
        })
    }

    pub fn len(&self) -> usize {
        self.map().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub(super) fn has_only_plain_entries(&self) -> bool {
        self.entries_with_attributes.get() == 0
    }

    /// Whether it looks as if a loop is filling an array of that length from one of its ends.
    pub(super) fn is_being_filled(&self, length: u32) -> bool {
        match self.run.get() {
            Some(Run::Ascending(_)) => true,
            Some(Run::Descending(next)) => next as usize + 1 + self.len() == length as usize,
            None => false,
        }
    }

    #[inline]
    pub fn get(&self, index: u32) -> Option<SparseEntry> {
        self.map().get(&index)
    }

    /// If there is a writable data property at the index.
    #[inline]
    pub(super) fn try_replace(&self, index: u32, value: Value) -> bool {
        let writable = (self.get(index).map(|it| it.attributes))
            .filter(|it| !it.intersects(Attributes::REJECTS_PLAIN_STORE));
        (writable.map(|attributes| self.map().insert(index, SparseEntry { value, attributes })))
            .is_some()
    }

    pub(super) fn try_reserve(&self, additional: usize) -> Result<(), AllocError> {
        let (map, capacity) = (self.map(), self.map().capacity());
        if map.len() + additional <= capacity {
            return Ok(());
        }
        if map.len() + additional > Self::MAX_LENGTH {
            return Err(AllocError);
        }
        map.try_reserve(additional)
    }

    /// There is such an entry, or room has been reserved.
    pub(crate) fn insert(&self, index: u32, value: Value, attributes: Attributes) {
        let old = self.map().insert(index, SparseEntry { value, attributes });
        self.did_drop(old);
        if old.is_none() {
            self.run.set(match self.run.get() {
                _ if self.len() == 1 && index == 0 => Some(Run::Ascending(1)),
                Some(Run::Ascending(next)) if next == index => Some(Run::Ascending(index + 1)),
                run if self.len() == 1 || run == Some(Run::Descending(index)) => {
                    index.checked_sub(1).map(Run::Descending)
                }
                _ => None,
            });
        }
        if !attributes.is_empty() {
            self.entries_with_attributes.update(|count| count + 1);
        }
    }

    pub(super) fn remove(&self, index: u32) {
        self.did_drop(self.map().remove(&index));
        self.run.set(None);
    }

    fn did_drop(&self, entry: Option<SparseEntry>) {
        if entry.is_some_and(|entry| !entry.attributes.is_empty()) {
            self.entries_with_attributes.update(|count| count - 1);
        }
    }

    /// In no order. `visit` does not touch them.
    pub(super) fn for_each(&self, mut visit: impl FnMut(u32, SparseEntry)) {
        self.map().for_each(|&index, entry| visit(index, entry));
    }

    /// `restrict` only adds attributes, and at least one.
    pub(super) fn restrict_all(&self, restrict: impl Fn(Attributes) -> Attributes) {
        (self.map()).update_values(|entry| entry.attributes = restrict(entry.attributes));
        self.entries_with_attributes.set(self.len() as u32);
    }

    /// Those of the range that are in use, in ascending order.
    pub(crate) fn try_sorted_indices(
        &self,
        range: Range<u32>,
        mode: DontEnumMode,
    ) -> Result<Vec<u32>, AllocError> {
        let mut indices = Vec::new();
        (indices.try_reserve_exact(range.len().min(self.len()))).map_err(|_| AllocError)?;
        if range.len() <= self.len() {
            let is_included = |entry: SparseEntry| mode.includes(entry.attributes);
            indices.extend(range.filter(|&index| self.get(index).is_some_and(is_included)));
            return Ok(indices);
        }
        self.for_each(|index, entry| {
            if range.contains(&index) && mode.includes(entry.attributes) {
                indices.push(index);
            }
        });
        indices.sort_unstable();
        Ok(indices)
    }

    pub(super) fn first_index_from(&self, start: u32) -> Option<u32> {
        self.map().min_key(|&index| index >= start)
    }
}
