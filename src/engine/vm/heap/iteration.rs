//! Going through the cells of the heap.

use core::mem::needs_drop;

use super::directory::Directory;
use super::{AllocationKind, CellKind, Gc, Heap, IsoSpace, JsCell, MutatorState, space};
use crate::{FastHashSet, TypeFlags};

fn for_each_live_cell_of(directory: &Directory, visit: &mut impl FnMut(Gc<JsCell>)) {
    if directory.attributes().kind == AllocationKind::Cell {
        for block in directory.blocks_in_use() {
            // SAFETY: live.
            block.for_each_live_cell(|cell| visit(unsafe { Gc::from_address(cell) }));
        }
    }
}

impl Heap {
    /// `visit` does not allocate.
    pub fn for_each_live_cell(&self, mut visit: impl FnMut(Gc<JsCell>)) {
        self.stop_allocating();
        let _state = self.enter_state(MutatorState::Collecting);
        self.for_each_directory(|directory| for_each_live_cell_of(directory, &mut visit));
        self.for_each_live_precise_cell(visit);
    }

    fn for_each_live_precise_cell(&self, mut visit: impl FnMut(Gc<JsCell>)) {
        for allocation in self.precise.borrow().iter() {
            if allocation.attributes.kind == AllocationKind::Cell && allocation.is_live() {
                // SAFETY: live.
                visit(unsafe { Gc::from_address(allocation.cell()) });
            }
        }
    }

    /// `visit` does not allocate.
    pub fn for_each_live_cell_in(&self, space: &IsoSpace, mut visit: impl FnMut(Gc<JsCell>)) {
        space.allocator.stop_allocating(self);
        let _state = self.enter_state(MutatorState::Collecting);
        if let Some(directory) = space.allocator.directory() {
            for_each_live_cell_of(directory, &mut visit);
        }
    }

    /// Those of `destructible_cells`, and the large ones of other spaces. `visit` does not allocate.
    pub(crate) fn for_each_live_destructible_cell(&self, mut visit: impl FnMut(Gc<JsCell>)) {
        let allocators = self.destructible_cells.allocators();
        allocators.iter().for_each(|it| it.stop_allocating(self));
        let _state = self.enter_state(MutatorState::Collecting);
        for directory in allocators.iter().filter_map(|it| it.directory()) {
            for_each_live_cell_of(directory, &mut visit);
        }
        self.for_each_live_precise_cell(visit);
    }

    /// Of a type that needs no destruction or whose shape is immortal. `visit` does not allocate.
    pub fn for_each_live<T: CellKind>(&self, mut visit: impl FnMut(Gc<T>)) {
        const {
            assert!(size_of::<T>() <= space::LARGE_CUTOFF);
            assert!(!needs_drop::<T>() || T::FLAGS.contains(TypeFlags::SHAPE_IS_IMMORTAL));
        };
        let space = match needs_drop::<T>() {
            true => &self.destructible_cells,
            false => &self.cells,
        };
        let Some(allocator) = space.allocator_for(size_of::<T>()) else {
            return;
        };
        allocator.stop_allocating(self);
        let _state = self.enter_state(MutatorState::Collecting);
        if let Some(directory) = allocator.directory() {
            for_each_live_cell_of(directory, &mut |cell| {
                cell.downcast().into_iter().for_each(&mut visit)
            });
        }
    }

    /// Those that are protected or have a strong handle.
    pub fn for_each_protected_cell(&self, mut visit: impl FnMut(Gc<JsCell>)) {
        let mut cells: FastHashSet<usize> = self.protected.borrow().keys().copied().collect();
        self.strong_set.for_each_cell(|cell| {
            cells.insert(cell);
        });
        let _defer = self.defer_collection();
        for cell in cells {
            // SAFETY: a root.
            visit(unsafe { Gc::from_address(cell) });
        }
    }
}
