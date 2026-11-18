use core::cell::{Cell, RefCell};
use core::mem::offset_of;

use bun_engine_text::{Identifier, PropertyName};

use crate::heap::HeapAnalyzer;
use crate::{
    Attributes, FastHashMap, Field, GlobalObject, InlineWatchpointSet, Trace, Value, Visitor, Vm,
    WatchpointState,
};

/// A variable of the global scope. Its address does not change.
#[repr(C)]
pub struct GlobalBinding {
    value: Field<Option<Value>>,
    /// Watched from the first store, invalidated by the second.
    watchpoints: InlineWatchpointSet,
    attributes: Cell<Attributes>,
}

impl GlobalBinding {
    pub const OFFSET_OF_VALUE: usize = offset_of!(GlobalBinding, value);
    pub const OFFSET_OF_WATCHPOINTS: usize = offset_of!(GlobalBinding, watchpoints);

    /// `None` before it is initialized.
    #[inline(always)]
    pub fn get(&self) -> Option<Value> {
        self.value.get()
    }

    /// # Safety
    /// `owner` has the binding.
    #[inline(always)]
    pub unsafe fn set(&self, vm: &Vm, owner: &GlobalObject, value: Value) {
        // SAFETY: the caller's.
        unsafe { self.value.set(owner, Some(value)) };
        self.watchpoints.touch(vm);
    }

    pub fn watchpoints(&self) -> &InlineWatchpointSet {
        &self.watchpoints
    }

    pub fn attributes(&self) -> Attributes {
        self.attributes.get()
    }

    /// # Safety
    /// The watchpoints are invalid, and the barrier of the owner follows.
    #[inline(always)]
    pub unsafe fn set_without_barrier(&self, value: Value) {
        // SAFETY: the caller's.
        unsafe { self.value.set_without_barrier(Some(value)) }
    }

    pub(super) fn make_read_only(&self, vm: &Vm) {
        self.watchpoints.invalidate_and_keep_slow(vm);
        self.attributes
            .set(self.attributes() | Attributes::READ_ONLY);
    }
}

const CHUNK_SIZE: usize = 32;

#[derive(Default)]
#[cfg_attr(rootcheck, rootcheck::allow("a value gets in only through the owner"))]
pub struct GlobalBindings {
    #[expect(clippy::vec_box, reason = "handed out by address")]
    chunks: RefCell<Vec<Box<[GlobalBinding; CHUNK_SIZE]>>>,
    /// In the order of the bindings.
    names: RefCell<Vec<Identifier>>,
    indices: RefCell<FastHashMap<Identifier, u32>>,
}

// SAFETY: `add` takes the lock of the owner, and `set` runs its barrier.
unsafe impl Trace for GlobalBindings {
    fn trace(&self, visitor: &mut Visitor) {
        visitor.with_current_cell_locked(|visitor| {
            // SAFETY: not changed while the lock is held.
            for binding in unsafe { &*self.chunks.as_ptr() }
                .iter()
                .flat_map(|it| &**it)
            {
                // SAFETY: the owner keeps it alive.
                unsafe { visitor.append_hidden_word(binding.value.word_concurrently()) };
            }
        });
    }
}

impl GlobalBindings {
    pub fn is_empty(&self) -> bool {
        self.names.borrow().is_empty()
    }

    fn at(&self, index: usize) -> &GlobalBinding {
        let binding = &raw const self.chunks.borrow()[index / CHUNK_SIZE][index % CHUNK_SIZE];
        // SAFETY: boxed, and kept for as long as `self`.
        unsafe { &*binding }
    }

    #[inline]
    pub fn find(&self, name: PropertyName<'_>) -> Option<&GlobalBinding> {
        let index = *self.indices.borrow().get(&name)?;
        Some(self.at(index as usize))
    }

    pub fn names(&self) -> Vec<Identifier> {
        self.names.borrow().clone()
    }

    pub(super) fn analyze(&self, owner: &GlobalObject, analyzer: &mut HeapAnalyzer) {
        for (index, name) in self.names.borrow().iter().enumerate() {
            if let Some(value) = self.at(index).get().and_then(Value::as_cell) {
                analyzer.variable_edge(owner.as_cell().into(), value, name.name());
            }
        }
    }

    /// There is none of that name yet.
    pub(crate) fn add(
        &self,
        owner: &GlobalObject,
        name: PropertyName<'_>,
        attributes: Attributes,
        is_initialized: bool,
    ) -> &GlobalBinding {
        let index = self.names.borrow().len();
        if index.is_multiple_of(CHUNK_SIZE) {
            let chunk = Box::new(core::array::from_fn(|_| GlobalBinding {
                value: Field::new(None),
                watchpoints: InlineWatchpointSet::new(WatchpointState::Clear),
                attributes: Cell::new(Attributes::NONE),
            }));
            let _lock = owner.lock();
            self.chunks.borrow_mut().push(chunk);
        }
        self.names.borrow_mut().push(name.to_identifier());
        let mut indices = self.indices.borrow_mut();
        indices.insert(name.to_identifier(), index as u32);
        let binding = self.at(index);
        binding.attributes.set(attributes);
        // SAFETY: no cell.
        unsafe {
            binding
                .value
                .set_without_barrier(is_initialized.then_some(Value::UNDEFINED));
        }
        binding
    }
}
