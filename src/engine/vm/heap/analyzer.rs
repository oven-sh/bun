use core::ffi::c_void;

use bun_engine_text::{PropertyName, StringImpl};

use super::{Gc, JsCell, Scope, Visitor};
use crate::AsciiLiteral;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum RootReason {
    None,
    ProtectedValues,
    StrongHandles,
    StrongReferences,
    Exceptions,
    Debugger,
    ExecutingCode,
    /// The owner of a weak handle keeps its target.
    WeakSets,
    /// Marked because other cells are, such as the value for a key of a weak map.
    Output,
    /// The same, by the rules of the embedder.
    Embedder,
}

/// Receives the object graph from a collection. It only hears of cells that survive, and of no reference on the stack.
pub trait HeapGraphSink {
    /// Once for each cell, after all roots.
    fn node(&mut self, cell: Gc<JsCell>);
    fn root(&mut self, cell: Gc<JsCell>, reason: RootReason);
    fn edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>);
    fn property_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, name: PropertyName<'_>);
    fn variable_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, name: PropertyName<'_>);
    fn index_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, index: u32);
    fn label(&mut self, cell: Gc<JsCell>, label: &StringImpl);
    fn wrapped_object(&mut self, cell: Gc<JsCell>, wrapped: *const c_void);
    fn opaque_root_reason(&mut self, cell: Gc<JsCell>, reason: AsciiLiteral);
}

/// What `analyze_heap` tells of the references that `visit_children` has kept hidden.
pub struct HeapAnalyzer {
    pub(super) root_reason: RootReason,
    sink: *mut dyn HeapGraphSink,
}

fn has_survived(cell: Gc<JsCell>) -> bool {
    cell.heap().marks().contains(cell.address())
}

impl HeapAnalyzer {
    /// # Safety
    /// It goes before the borrow ends.
    pub(super) unsafe fn new(sink: &mut dyn HeapGraphSink) -> HeapAnalyzer {
        HeapAnalyzer {
            root_reason: RootReason::None,
            // SAFETY: only the lifetime changes.
            sink: unsafe {
                core::mem::transmute::<&mut dyn HeapGraphSink, *mut dyn HeapGraphSink>(sink)
            },
        }
    }

    fn sink(&mut self) -> &mut dyn HeapGraphSink {
        // SAFETY: borrowed for as long as `self` exists.
        unsafe { &mut *self.sink }
    }

    pub fn edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>) {
        if has_survived(to) {
            self.sink().edge(from, to);
        }
    }

    pub fn property_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, name: PropertyName<'_>) {
        if has_survived(to) {
            self.sink().property_edge(from, to, name);
        }
    }

    pub fn variable_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, name: PropertyName<'_>) {
        if has_survived(to) {
            self.sink().variable_edge(from, to, name);
        }
    }

    pub fn index_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, index: u32) {
        if has_survived(to) {
            self.sink().index_edge(from, to, index);
        }
    }

    pub fn label(&mut self, cell: Gc<JsCell>, label: &StringImpl) {
        self.sink().label(cell, label);
    }

    pub fn wrapped_object(&mut self, cell: Gc<JsCell>, wrapped: *const c_void) {
        self.sink().wrapped_object(cell, wrapped);
    }

    /// After marking.
    pub(super) fn analyze(&mut self, cell: Gc<JsCell>) {
        self.sink().node(cell);
        // SAFETY: the method of its class.
        unsafe { (cell.class().ops().analyze_heap)(&cell, self) }
    }

    /// `referrer` is the cell that is being visited, or zero.
    pub(super) fn will_mark(&mut self, referrer: usize, cell: usize) {
        let reason = self.root_reason;
        // SAFETY: what is being visited, and what it refers to.
        unsafe {
            let cell = Gc::from_address(cell);
            if referrer == 0 || reason != RootReason::None {
                self.sink().root(cell, reason);
            } else {
                self.sink().edge(Gc::from_address(referrer), cell);
            }
        }
    }

    pub(super) fn opaque_root_reason(&mut self, cell: usize, reason: AsciiLiteral) {
        // SAFETY: has just been marked.
        let cell = unsafe { Gc::from_address(cell) };
        self.sink().opaque_root_reason(cell, reason);
    }
}

#[repr(C)]
pub struct HeapObserver {
    pub will_collect: unsafe extern "C" fn(&HeapObserver),
    pub did_collect: unsafe extern "C" fn(&HeapObserver, Scope),
}

impl HeapObserver {
    pub(super) fn will_collect(&self) {
        // SAFETY: promised by whoever added it.
        unsafe { (self.will_collect)(self) }
    }

    pub(super) fn did_collect(&self, scope: Scope) {
        // SAFETY: as above.
        unsafe { (self.did_collect)(self, scope) }
    }
}

/// Roots that only the embedder knows.
pub struct MarkingConstraint {
    execute: unsafe extern "C" fn(*mut c_void, &mut Visitor),
    destroy: unsafe extern "C" fn(*mut c_void),
    context: *mut c_void,
    pub(super) depends_on_marking: bool,
}

impl MarkingConstraint {
    /// # Safety
    /// The functions can be called with `context`, `destroy` last.
    pub unsafe fn new(
        execute: unsafe extern "C" fn(*mut c_void, &mut Visitor),
        destroy: unsafe extern "C" fn(*mut c_void),
        context: *mut c_void,
        depends_on_marking: bool,
    ) -> MarkingConstraint {
        MarkingConstraint {
            execute,
            destroy,
            context,
            depends_on_marking,
        }
    }

    pub(super) fn execute(&self, visitor: &mut Visitor) {
        // SAFETY: promised by its maker.
        unsafe { (self.execute)(self.context, visitor) }
    }
}

impl Drop for MarkingConstraint {
    fn drop(&mut self) {
        // SAFETY: as above.
        unsafe { (self.destroy)(self.context) }
    }
}
