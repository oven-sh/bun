//! Snapshots of the object graph, and counts of cells.

mod graph;
mod inspector_format;
mod names;
mod statistics;
mod string_table;
mod v8_format;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_engine_text::{AllocError, StringBuilder, StringRef};
use bun_engine_vm::heap::Survivors;
use bun_engine_vm::{FastHashMap, Gc, JsCell, Vm};

pub use inspector_format::SnapshotKind;
pub use names::class_name;
pub use statistics::{count_cells, count_protected_cells};

use super::AnyRealm;
use super::json::Utf8Writer;
use graph::Graph;

/// By the address of the cell.
type Identifiers = FastHashMap<usize, u32>;

/// A cell has the same identifier in all snapshots until they are cleared.
#[derive(Default)]
pub struct HeapProfiler {
    /// `None` without a snapshot. Only has cells that are alive.
    identifiers: RefCell<Option<Identifiers>>,
    last_identifier: Cell<u32>,
}

impl HeapProfiler {
    pub fn of(vm: &Vm) -> Rc<HeapProfiler> {
        vm.extension()
    }

    pub fn has_snapshot(&self) -> bool {
        self.identifiers.borrow().is_some()
    }

    pub fn clear_snapshots(&self) {
        self.identifiers.take();
    }

    /// Clears the snapshots too.
    pub fn restart_identifiers(&self) {
        self.clear_snapshots();
        self.last_identifier.set(0);
    }

    /// `None` if it has been collected.
    pub fn cell_with_identifier(&self, _: &Vm, identifier: u32) -> Option<Gc<JsCell>> {
        let identifiers = self.identifiers.borrow();
        let (&cell, _) = (identifiers.iter().flatten()).find(|&(_, &it)| it == identifier)?;
        // SAFETY: those that die are removed.
        Some(unsafe { Gc::from_address(cell) })
    }

    /// Collects. Has the cells for which `includes`, which runs no script, holds.
    pub fn snapshot(
        &self,
        realms: &mut AnyRealm<'_>,
        kind: SnapshotKind,
        includes: &dyn Fn(Gc<JsCell>) -> bool,
    ) -> Result<StringRef, AllocError> {
        if kind == SnapshotKind::GcDebugging {
            self.clear_snapshots();
        }
        let json = self.with_graph(realms, |realms, graph| {
            inspector_format::write(realms, graph, kind, includes)
        });
        if kind == SnapshotKind::GcDebugging {
            self.clear_snapshots();
        }
        json
    }

    /// Collects.
    pub fn v8_snapshot(&self, realms: &mut AnyRealm<'_>) -> Result<StringRef, AllocError> {
        self.with_graph(realms, v8_format::write::<StringBuilder>)
    }

    /// The same in UTF-8.
    pub fn v8_snapshot_bytes(&self, realms: &mut AnyRealm<'_>) -> Result<Vec<u8>, AllocError> {
        self.with_graph(realms, v8_format::write::<Utf8Writer>)
    }

    fn with_graph<T>(
        &self,
        realms: &mut AnyRealm<'_>,
        write: impl FnOnce(&mut AnyRealm<'_>, Graph<'_>) -> Result<T, AllocError>,
    ) -> Result<T, AllocError> {
        let earlier = self.identifiers.take().unwrap_or_default();
        let (graph, identifiers) = Graph::collect(realms.heap(), earlier, &self.last_identifier)?;
        self.identifiers.replace(Some(identifiers));
        write(realms, graph)
    }

    pub(super) fn forget_dead_cells(&self, survivors: &Survivors) {
        if let Some(identifiers) = &mut *self.identifiers.borrow_mut() {
            // SAFETY: alive when the collection began.
            identifiers
                .retain(|&it, _| survivors.contains(unsafe { Gc::<JsCell>::from_address(it) }));
        }
    }
}
