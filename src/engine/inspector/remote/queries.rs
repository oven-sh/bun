//! Searches through the heap.

use core::ffi::c_void;

use bun_engine_text::{PropertyName, StringImpl, names};
use bun_engine_vm::heap::{HeapGraphSink, RootReason, Scope};
use bun_engine_vm::{
    AbstractModuleRecord, AsciiLiteral, CallFrame, CellType, Cx, FastHashMap, FastHashSet, Gc,
    GlobalObject, JsCell, JsObject, JsResult, JsSymbol, ProxyObject, Value, root_vec,
};

use super::Registry;

/// `None` for what is not for them to see.
pub(crate) fn as_scripts_see_it(cell: Gc<JsCell>) -> Option<Value> {
    match cell.cell_type() {
        CellType::String | CellType::BigInt => Some(cell.into()),
        CellType::Symbol => (!cell.cast::<JsSymbol>().name().is_private()).then(|| cell.into()),
        CellType::GlobalObject => Some(cell.cast::<GlobalObject>().global_this().into()),
        CellType::Callee
        | CellType::AsyncFunctionGenerator
        | CellType::AsyncFromSyncIterator
        | CellType::InternalFieldTuple => None,
        _ => (cell.is_object() && !cell.is::<AbstractModuleRecord>()).then(|| cell.into()),
    }
}

fn inherits_directly(object: &JsObject, prototype: Gc<JsObject>) -> bool {
    object.chain_direct().skip(1).any(|it| it == prototype)
}

/// `queryInstances(constructorOrPrototype)`
pub(super) fn instances(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(&argument) = frame.arguments().first() else {
        return Ok(Value::UNDEFINED);
    };
    let Some(object) = argument.as_object() else {
        return Err(cx.throw_type_error("queryInstances first argument must be an object."));
    };
    let prototype = object.get_pure(cx, names::prototype);
    let prototype = prototype.and_then(Value::as_object).unwrap_or(object);
    if object.is::<ProxyObject>() || prototype.is::<ProxyObject>() {
        return Err(cx.throw_type_error("queryInstances cannot be called with a Proxy."));
    }
    // The engine has instances of these that are not for scripts to see.
    for (name, forbidden) in [
        ("Object", cx.object_prototype()),
        ("Function", cx.function_prototype()),
        ("Array", cx.array_prototype()),
        ("Map", cx.map_prototype()),
        ("Set", cx.set_prototype()),
        ("Promise", cx.promise_prototype()),
    ] {
        if prototype == forbidden || inherits_directly(&forbidden, prototype) {
            let message = format_args!("queryInstances cannot be called with {name}.");
            return Err(cx.throw_type_error(message));
        }
    }
    cx.heap.collect_and_sweep(Some(Scope::Full));
    let mut found = root_vec();
    cx.heap.for_each_live_cell(|cell| {
        if (cell.as_object()).is_some_and(|it| inherits_directly(&it, prototype)) {
            found.extend(as_scripts_see_it(cell));
        }
    });
    cx.new_array_from(&found).map(Value::from)
}

/// By address.
#[derive(Default)]
struct Graph {
    successors: FastHashMap<usize, Vec<usize>>,
    predecessors: FastHashMap<usize, Vec<usize>>,
    roots: Vec<usize>,
    objects: FastHashSet<usize>,
}

impl HeapGraphSink for Graph {
    fn node(&mut self, cell: Gc<JsCell>) {
        if cell.is_object() {
            self.objects.insert(cell.address());
        }
    }

    fn root(&mut self, cell: Gc<JsCell>, reason: RootReason) {
        if reason != RootReason::Debugger && !cell.is::<Registry>() {
            self.roots.push(cell.address());
        }
    }

    fn edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>) {
        let (from, to) = (from.address(), to.address());
        if from != to {
            self.successors.entry(from).or_default().push(to);
            self.predecessors.entry(to).or_default().push(from);
        }
    }

    fn property_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, _: PropertyName<'_>) {
        self.edge(from, to);
    }

    fn variable_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, _: PropertyName<'_>) {
        self.edge(from, to);
    }

    fn index_edge(&mut self, from: Gc<JsCell>, to: Gc<JsCell>, _: u32) {
        self.edge(from, to);
    }

    fn label(&mut self, _: Gc<JsCell>, _: &StringImpl) {}

    fn wrapped_object(&mut self, _: Gc<JsCell>, _: *const c_void) {}

    fn opaque_root_reason(&mut self, _: Gc<JsCell>, _: AsciiLiteral) {}
}

fn reachable(
    start: &[usize],
    edges: &FastHashMap<usize, Vec<usize>>,
    leads_on: impl Fn(usize) -> bool,
) -> FastHashSet<usize> {
    let (mut pending, mut seen) = (start.to_vec(), FastHashSet::default());
    while let Some(cell) = pending.pop() {
        if seen.insert(cell) && leads_on(cell) {
            pending.extend(edges.get(&cell).into_iter().flatten());
        }
    }
    seen
}

/// `queryHolders(object)`: the objects that refer to it, directly or through cells that are no objects.
pub(super) fn holders(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(&argument) = frame.arguments().first() else {
        return Ok(Value::UNDEFINED);
    };
    let Some(target) = argument.as_object() else {
        return Err(cx.throw_type_error("queryHolders first argument must be an object."));
    };
    let mut graph = Graph::default();
    let _defer = cx.heap.collect_and_analyze(&mut graph);
    let in_use = reachable(&graph.roots, &graph.successors, |_| true);
    let direct = graph.predecessors.get(&target.address());
    let holders = reachable(direct.map_or(&[], |it| it), &graph.predecessors, |cell| {
        !graph.objects.contains(&cell)
    });
    let mut found = root_vec();
    cx.heap.for_each_live_cell(|cell| {
        if holders.contains(&cell.address()) && in_use.contains(&cell.address()) {
            found.extend(as_scripts_see_it(cell));
        }
    });
    cx.new_array_from(&found).map(Value::from)
}
