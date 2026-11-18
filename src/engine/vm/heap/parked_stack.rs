//! Frames that are off the stack for a while.

use core::cell::{RefCell, UnsafeCell};

use bun_alloc::AllocError;
use bun_engine_macros::cell;

use super::conservative::{ConservativeRoots, Found};
use super::{Gc, GcFree, Heap, Survivors, Visitor};
use crate::{JsCell, Vm};

#[derive(Default)]
struct Contents {
    words: Box<[usize]>,
    /// From the first pause of the collector after the words have come.
    found: Option<Found>,
}

#[repr(transparent)]
struct Parked(UnsafeCell<Contents>);

// SAFETY: `visit_children` visits what has been found.
unsafe impl GcFree for Parked {}

/// Keeps alive what the words may refer to, for as long as it is alive itself.
#[cell(visit_children, estimated_size)]
pub struct ParkedStack {
    base: JsCell,
    parked: Parked,
}

impl ParkedStack {
    /// `fill` allocates nothing.
    pub fn create(
        vm: &Vm,
        word_count: usize,
        fill: impl FnOnce(&mut [usize]),
    ) -> Result<Gc<ParkedStack>, AllocError> {
        let mut words = Vec::new();
        (words.try_reserve_exact(word_count)).map_err(|_| AllocError)?;
        words.resize(word_count, 0);
        fill(&mut words);
        let (words, found) = (words.into_boxed_slice(), None);
        let stack = vm.allocate::<ParkedStack>(ParkedStackInit {
            base: vm.shape_for::<ParkedStack>(),
            parked: Parked(UnsafeCell::new(Contents { words, found })),
        });
        (vm.heap.parked_stacks.0.borrow_mut()).push(stack.address());
        (vm.heap).report_extra_memory_allocated(&stack, word_count * size_of::<usize>());
        Ok(stack)
    }

    /// Until the next change.
    fn contents(&self) -> &Contents {
        // SAFETY: only this thread changes it.
        unsafe { &*self.parked.0.get() }
    }

    fn change<R>(&self, change: impl FnOnce(&mut Contents) -> R) -> R {
        let _lock = self.lock();
        // SAFETY: markers take the lock, and this module keeps no borrow.
        change(unsafe { &mut *self.parked.0.get() })
    }

    pub fn word_count(&self) -> usize {
        self.contents().words.len()
    }

    /// From now on it is empty, and keeps nothing alive.
    pub fn take(&self) -> Box<[usize]> {
        self.change(core::mem::take).words
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.with_current_cell_locked(|visitor| {
            // SAFETY: under the lock. What was alive when it was found has been visited with this cell ever since.
            unsafe {
                let Contents { words, found } = &*self.parked.0.get();
                visitor.report_extra_memory(size_of_val(&**words));
                let Some(found) = found else { return };
                visitor.report_extra_memory(found.memory_size());
                for &cell in &found.cells {
                    visitor.append(Gc::<JsCell>::from_address(cell));
                }
                for &base in &found.auxiliary {
                    visitor.mark_auxiliary(base);
                }
            }
        });
    }

    fn estimated_size(&self, _: &Vm) -> usize {
        self.cell_size() + self.word_count() * size_of::<usize>()
    }
}

/// Those that were alive at the last collection or have been made since.
#[derive(Default)]
pub(super) struct ParkedStacks(RefCell<Vec<usize>>);

impl ParkedStacks {
    pub(super) fn prune(&self, survivors: &Survivors) {
        (self.0.borrow_mut()).retain(|&stack| survivors.contains_address(stack));
    }
}

impl Found {
    fn without_repetitions(mut self) -> Found {
        for list in [
            &mut self.cells,
            &mut self.auxiliary,
            &mut self.code_addresses,
        ] {
            list.sort_unstable();
            list.dedup();
            list.shrink_to_fit();
        }
        self
    }

    fn memory_size(&self) -> usize {
        (self.cells.len() + self.auxiliary.len() + self.code_addresses.len()) * size_of::<usize>()
    }
}

impl Heap {
    /// Wherever the stack is scanned. Adds the addresses of code to those that are on it.
    pub(super) fn scan_parked_stacks(&self, on_stack: &mut Found) {
        let (blocks, precise) = (self.blocks.borrow(), self.precise.borrow());
        let mut roots = None;
        self.parked_stacks.0.borrow_mut().retain(|&address| {
            // SAFETY: not swept.
            let stack = unsafe { Gc::<ParkedStack>::from_address(address) };
            if stack.word_count() == 0 {
                return false;
            }
            if stack.contents().found.is_none() {
                let roots = roots.get_or_insert_with(|| {
                    ConservativeRoots::new(&blocks, &precise, self.vm().code_address_range())
                });
                let range = stack.contents().words.as_ptr_range();
                // SAFETY: the words.
                unsafe { roots.scan(range.start.expose_provenance(), range.end.addr()) };
                let found = core::mem::take(&mut roots.found).without_repetitions();
                stack.change(|contents| contents.found = Some(found));
                // A marker may have been there.
                if self.is_marking.get() {
                    self.remember(&stack);
                }
            }
            let found = stack.contents().found.iter();
            (on_stack.code_addresses).extend(found.flat_map(|it| &it.code_addresses));
            true
        });
    }
}
