//! From the addresses in caches and graphs back to what is there.

use std::rc::Rc;

use bun_engine_text::Identifier;
use bun_engine_vm::{
    ArrayAllocationProfile, Cx, ElementKind, Gc, GlobalObject, HeldBuffer, JsArrayBufferView,
    JsCell, RootVec, Shape, ShapeId, SpeculatedType, Value, Vm, WatchpointSet, root_vec,
};

use crate::graph::Graph;

/// The part of a plan that stays on the thread of the `Vm`.
pub(crate) struct Dependencies {
    /// Kept alive by the code.
    #[cfg_attr(rootcheck, rootcheck::allow("a root wherever it is"))]
    pub(crate) strong: RootVec<Gc<JsCell>>,
    /// The code dies with any of them.
    #[cfg_attr(rootcheck, rootcheck::allow("a root wherever it is"))]
    pub(crate) weak: RootVec<Gc<JsCell>>,
    /// By `ShapeIndex`. Weak too.
    #[cfg_attr(rootcheck, rootcheck::allow("a root wherever it is"))]
    pub(crate) shapes: RootVec<Gc<Shape>>,
    #[cfg_attr(rootcheck, rootcheck::allow("a root wherever it is"))]
    pub(crate) realms: RootVec<Gc<GlobalObject>>,
    pub(crate) watchpoints: Vec<Rc<WatchpointSet>>,
    /// Those whose addresses keys are compared with.
    pub(crate) names: Vec<Identifier>,
}

impl Default for Dependencies {
    fn default() -> Self {
        Self {
            strong: root_vec(),
            weak: root_vec(),
            shapes: root_vec(),
            realms: root_vec(),
            watchpoints: Vec::new(),
            names: Vec::new(),
        }
    }
}

impl Dependencies {
    pub(crate) fn keep(&mut self, cell: Gc<JsCell>) {
        self.strong.push(cell);
    }
}

/// `id` has just been read from a cache of a code block that is alive.
pub(crate) fn shape_in_cache(id: ShapeId) -> Gc<Shape> {
    assert!(!id.is_none());
    // SAFETY: a collection clears the caches that name a dead shape.
    unsafe { id.decode() }
}

/// The kind of their elements, and how many they have had room for.
pub(crate) fn what_became_of_arrays(profile: &ArrayAllocationProfile) -> (ElementKind, u32) {
    // SAFETY: the profile of a code block.
    unsafe { profile.update() }
}

/// Makes one if there is none.
pub(crate) fn buffer_of_view(vm: &Vm, view: &JsArrayBufferView) -> Option<HeldBuffer> {
    let _defer = vm.heap.defer_collection();
    if !view.has_buffer() {
        vm.count_rearrangement();
    }
    // SAFETY: graphs are built at the request of running code, and nothing borrows elements while it has code run.
    unsafe { view.buffer_unchecked(vm) }.ok()
}

pub(crate) fn realm_while_building<'a>(global: Gc<GlobalObject>) -> &'a Cx {
    // SAFETY: graphs are built at the request of running code, which is inside a call that has the `Cx`.
    unsafe { Cx::from_global(global) }
}

/// While the graph is built. `None` for the empty value and for what is no value.
pub(crate) fn constant_of_graph(graph: &Graph, bits: u64) -> Option<Value> {
    let is_value = SpeculatedType::of_immediate(bits).is_some() || graph.cells.contains_key(&bits);
    // SAFETY: the builder roots the cells that it describes.
    is_value.then(|| unsafe { Value::from_bits_or_empty(bits) })?
}
