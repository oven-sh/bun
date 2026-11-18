//! Cells as the run time has them.

use core::num::NonZeroUsize;

use bun_engine_vm::{Gc, JsCell, Visitor};
use bun_engine_wasm_runtime::HostCell;

pub(crate) fn host_cell(cell: Gc<JsCell>) -> HostCell {
    HostCell(NonZeroUsize::new(cell.address()).expect("a cell is not at zero"))
}

/// For the `trace` methods of the run time.
pub(crate) fn visit_with(visitor: &mut Visitor) -> impl FnMut(HostCell) {
    // SAFETY: the run time reports cells of this heap.
    |cell| visitor.append(unsafe { Gc::<JsCell>::from_address(cell.address()) })
}
