//! Checks the outcome of marking by tracing the whole heap once more, without relying on barriers.

use super::container::{self, Container};
use super::{AllocationKind, CellState, Gc, Heap, JsCell, PRECISE_BIT};
use crate::{CellType, FastHashSet};

pub(super) struct Verifier {
    heap: *const Heap,
    precise_cells: FastHashSet<usize>,
    reached: FastHashSet<usize>,
    /// If not, it looks no further than what it is given.
    is_marking_over: bool,
}

impl Verifier {
    /// For the time between the end of marking and the first change that follows from it, or a pause in which no marker
    /// is at work.
    pub(super) fn new(heap: &Heap, is_marking_over: bool) -> Verifier {
        Verifier {
            heap,
            precise_cells: heap.precise.borrow().iter().map(|it| it.cell()).collect(),
            reached: FastHashSet::default(),
            is_marking_over,
        }
    }

    pub(super) fn has_reached(&self, cell: usize) -> bool {
        self.reached.contains(&cell)
    }

    /// Whether it is the first time. `from` is zero for a root.
    pub(super) fn reach_cell(&mut self, from: usize, cell: usize) -> bool {
        if !self.is_marking_over && from != 0 {
            // SAFETY: allocated, and not freed before marking ends.
            let cell_type = unsafe { Gc::<JsCell>::from_address(cell) }.cell_type();
            // A coroutine has it by way of the executable, which gets the barrier.
            if cell_type != CellType::CodeBlock {
                self.check(from, cell, AllocationKind::Cell);
            }
            return false;
        }
        if !self.reached.insert(cell) {
            return false;
        }
        self.check(from, cell, AllocationKind::Cell);
        // SAFETY: marked.
        let cell = unsafe { Gc::<JsCell>::from_address(cell) };
        if cell.shape_id().is_none() {
            self.fail(from, cell.address(), "has been destroyed");
        }
        self.check(
            cell.address(),
            cell.shape_id().address(),
            AllocationKind::Cell,
        );
        if cell.shape().instance_type() != cell.cell_type() {
            self.fail(
                from,
                cell.address(),
                "is not of the type that its shape says",
            );
        }
        if cell.state() != CellState::PossiblyBlack as u8 {
            self.fail(from, cell.address(), "has not been visited");
        }
        true
    }

    pub(super) fn reach_auxiliary(&self, from: usize, base: usize) {
        self.check(from, base, AllocationKind::Auxiliary);
    }

    fn container(&self, address: usize) -> Option<Container> {
        // SAFETY: outlives the collection.
        let blocks = unsafe { &*self.heap }.blocks.borrow();
        let is_start = if address & PRECISE_BIT != 0 {
            self.precise_cells.contains(&address)
        } else {
            (blocks.block_containing(address))
                .is_some_and(|block| block.cell_containing(address) == Some(address))
        };
        is_start.then(|| container::of(address))
    }

    fn check(&self, from: usize, to: usize, kind: AllocationKind) {
        match self.container(to) {
            None => self.fail(from, to, "is not the start of anything in this heap"),
            Some(it) if it.attributes().kind != kind => self.fail(from, to, "is of another kind"),
            Some(it) if !it.heap().marks().contains(to) => self.fail(from, to, "is not marked"),
            Some(_) => {}
        }
    }

    fn describe(&self, address: usize) -> &'static str {
        let is_cell = |address| {
            (self.container(address)).is_some_and(|it| it.attributes().kind == AllocationKind::Cell)
        };
        if address == 0 {
            return "a root";
        }
        if !is_cell(address) {
            return "no cell";
        }
        // SAFETY: memory of the heap. The class is read only from a shape that is marked.
        let cell = unsafe { Gc::<JsCell>::from_address(address) };
        let shape = cell.shape_id().address();
        if is_cell(shape) && container::of(shape).heap().marks().contains(shape) {
            cell.class().name()
        } else {
            "a cell without a shape"
        }
    }

    #[cold]
    fn fail(&self, from: usize, to: usize, problem: &str) -> ! {
        // SAFETY: outlives the collection.
        let scope = unsafe { &*self.heap }.collection_scope();
        let (referrer, target) = (self.describe(from), self.describe(to));
        panic!("{scope:?}: {referrer} ({from:#x}) refers to {target} ({to:#x}), which {problem}");
    }
}
