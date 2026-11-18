//! Maps, sets and weak references.

mod finalization_registry;
mod hashed_key;
mod iterator;
mod map;
mod ordered_collection;
mod ordered_table;
mod set;
mod weak_collection;
mod weak_map;
mod weak_ref;

use core::cell::RefCell;
use core::sync::atomic::AtomicU64;

pub use finalization_registry::{JsFinalizationRegistry, Registration};
pub use hashed_key::HashedKey;
pub use iterator::{JsMapIterator, JsSetIterator};
pub use map::JsMap;
pub use ordered_collection::{MapCursor, OrderedCollection, OrderedCursor, SetCursor};
pub use ordered_table::{MapKind, MapTable, OrderedTable, SetKind, SetTable, TableKind};
pub use set::JsSet;
pub use weak_collection::{WeakCollection, WeakKind, can_be_held_weakly};
pub use weak_map::{JsWeakMap, JsWeakSet};
pub use weak_ref::JsWeakRef;

use crate::heap::Scope;
use crate::vm::Root;
use crate::{Gc, Visitor, Vm};

pub(crate) struct State {
    empty_map_table: Root<MapTable>,
    empty_set_table: Root<SetTable>,
    /// Counts the synchronous runs of scripts.
    job: AtomicU64,
    /// The finalization registries that the collection in progress has found work for.
    to_clean_up: RefCell<Vec<usize>>,
}

impl Default for State {
    fn default() -> State {
        State {
            empty_map_table: Root::new(),
            empty_set_table: Root::new(),
            job: AtomicU64::new(0),
            to_clean_up: RefCell::default(),
        }
    }
}

impl State {
    #[inline(always)]
    fn empty_map_table(&self) -> Gc<MapTable> {
        // SAFETY: set when the `Vm` is made.
        unsafe { self.empty_map_table.get().unwrap_unchecked() }
    }

    #[inline(always)]
    fn empty_set_table(&self) -> Gc<SetTable> {
        // SAFETY: as above.
        unsafe { self.empty_set_table.get().unwrap_unchecked() }
    }
}

impl crate::services::Service for State {
    fn initialize(&self, vm: &Vm) {
        self.empty_map_table.set(Some(MapTable::create_empty(vm)));
        self.empty_set_table.set(Some(SetTable::create_empty(vm)));
    }

    fn visit(&self, visitor: &mut Visitor) {
        self.empty_map_table.visit(visitor);
        self.empty_set_table.visit(visitor);
    }

    fn did_collect(&self, vm: &Vm, _: Scope) {
        let _defer = vm.heap.defer_collection();
        for registry in self.to_clean_up.take() {
            // SAFETY: has survived the collection.
            unsafe { Gc::<JsFinalizationRegistry>::from_address(registry) }.schedule_cleanup();
        }
    }
}
