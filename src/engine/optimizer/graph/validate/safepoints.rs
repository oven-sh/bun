//! What has been begun is done by the time the collector or other code gets to look.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{Block, Entity, Heap, Op, Origin, Table, Type, Unary, Value as Ssa};
use bun_engine_vm::SpeculatedType as T;

use super::{Checked, about, exits};
use crate::graph::{Graph, Kind, heaps};

#[derive(Clone, Default, PartialEq)]
struct Pending {
    /// Made, or given their barrier, since the collector last had a chance, on each way here.
    looked_after: Vec<Ssa>,
    /// Stored into since then, on some way here, and not looked after.
    without_barrier: Vec<Ssa>,
    without_shape: Option<Ssa>,
    /// Where an assumption may have failed.
    unnoticed: Option<Origin>,
}

impl Pending {
    fn merge(&mut self, other: &Pending) {
        (self.looked_after).retain(|it| other.looked_after.contains(it));
        for &object in &other.without_barrier {
            self.note_store(object);
        }
        self.without_shape = self.without_shape.or(other.without_shape);
        self.unnoticed = self.unnoticed.or(other.unnoticed);
    }

    fn note_store(&mut self, object: Ssa) {
        if !self.looked_after.contains(&object) && !self.without_barrier.contains(&object) {
            self.without_barrier.push(object);
        }
    }

    fn look_after(&mut self, graph: &Graph, object: Ssa) {
        // A cell that is a constant may own memory at an address that is one too.
        let is_owned = |it: Ssa| {
            graph.constant(object).is_some()
                && (graph.constant(it)).is_some_and(|bits| !graph.cells.contains_key(&bits))
        };
        (self.without_barrier).retain(|&it| it != object && !is_owned(it));
        self.looked_after.push(object);
    }

    /// As the builder leaves them, stores that belong together are in one block, with none to another object between.
    fn check_is_only_about(&mut self, object: Ssa) -> Checked {
        self.looked_after.retain(|&it| it == object);
        let mut begun = self.without_barrier.iter().chain(&self.without_shape);
        match begun.find(|&&it| it != object) {
            Some(other) => Err(format!("interrupts the stores to v{}", other.index())),
            None => Ok(()),
        }
    }

    fn check_is_done(&self) -> Checked {
        if let Some(object) = self.without_barrier.first() {
            return Err(format!("comes before the barrier of v{}", object.index()));
        }
        if let Some(object) = self.without_shape {
            return Err(format!("finds v{} without a shape", object.index()));
        }
        Ok(())
    }
}

fn may_hold_references(heap: Heap) -> bool {
    let plain = [
        heaps::FRAME,
        heaps::SIDE_STATE,
        heaps::RANDOM_STATE,
        heaps::TYPED_ELEMENTS,
        heaps::DOUBLE_ELEMENTS,
        heaps::VIEW_LENGTH,
    ];
    !plain.contains(&heap)
}

fn may_be_reference(graph: &Graph, value: Ssa, origin: Origin) -> bool {
    let value = graph.root(value);
    let is_computed = match *graph.function.op(value) {
        Op::Binary(..) => true,
        Op::Unary(op, _) => op != Unary::Opaque,
        _ => false,
    };
    graph.function.type_of(value) == Type::I64
        && !is_computed
        && graph.inherent_type(value).intersects(T::CELL)
        && !graph.is_noted_as_no_cell(value, origin)
}

/// Whether it matters that what the code counts on still holds.
fn is_committing(graph: &Graph, value: Ssa) -> bool {
    let (function, effects) = (&graph.function, graph.function.effects(value));
    matches!(function.op(value), Op::Return(_))
        || function.may_alias(effects.writes, heaps::WORLD)
        || function.may_alias(effects.reads, heaps::WORLD)
            && graph.kind(value) != Some(Kind::Verify)
}

fn step(graph: &Graph, value: Ssa, pending: &mut Pending) -> Checked {
    let (function, kind) = (&graph.function, graph.kind(value));
    let (op, origin) = (function.op(value), function.origin(value));
    let collects = kind.is_some_and(Kind::can_collect);
    let mut checked = Ok(());
    if collects || exits(graph, value) || matches!(op, Op::Return(_)) {
        checked = pending.check_is_done();
    }
    let fills_new_object = |address| {
        let object = graph.object_at(address);
        graph.kind(object).is_some_and(Kind::allocates) && pending.looked_after.contains(&object)
    };
    if pending.unnoticed.is_some_and(|it| it != origin)
        && is_committing(graph, value)
        && !matches!(*op, Op::Store { args, .. } if fills_new_object(args[1]))
    {
        checked = Err("comes before an invalidation point".into());
    }
    if collects {
        pending.looked_after.clear();
    }
    let object = || graph.root(graph.operand(value, 0));
    if !graph.is_specialized {
        let written = match (*op, kind) {
            (Op::Store { args, access, .. }, _) => (may_hold_references(access.heap())
                || access.heap() == heaps::DOUBLE_ELEMENTS)
                .then(|| graph.object_at(args[1])),
            (_, Some(Kind::SetShape)) => Some(object()),
            _ => function.next(value).is_none().then_some(Ssa::NONE),
        };
        if let Some(written) = written {
            checked = checked.and_then(|()| pending.check_is_only_about(written));
        }
    }
    match (*op, kind) {
        (Op::Store { args, access, .. }, _) => {
            if may_hold_references(access.heap()) && may_be_reference(graph, args[0], origin) {
                pending.note_store(graph.object_at(args[1]));
            }
        }
        (_, Some(Kind::StoreBarrier)) => {
            pending.look_after(graph, object());
            if !graph.is_specialized {
                checked = checked.and_then(|()| pending.check_is_only_about(Ssa::NONE));
            }
        }
        (_, Some(Kind::GrowSlots)) => pending.without_shape = Some(object()),
        (_, Some(Kind::SetShape)) => {
            pending.without_shape.take_if(|&mut it| it == object());
            pending.note_store(object());
        }
        (_, Some(Kind::InvalidationPoint)) => pending.unnoticed = None,
        (_, Some(kind)) if kind.allocates() => pending.looked_after.push(value),
        _ => {}
    }
    if function.may_alias(function.effects(value).writes, heaps::WATCHPOINT_STATES) {
        pending.unnoticed = Some(origin);
    }
    checked
}

pub(super) fn validate(graph: &Graph, cfg: &Cfg) -> Checked {
    let function = &graph.function;
    let mut at_end: Table<Block, Option<Pending>> = Table::filled(function.block_count(), None);
    loop {
        let (mut checked, mut changed) = (Ok(()), false);
        for &block in cfg.order() {
            let mut incoming = (cfg.predecessors(block).iter())
                .filter_map(|&edge| at_end[function.source(edge)].as_ref());
            let mut pending = incoming.next().cloned().unwrap_or_default();
            incoming.for_each(|it| pending.merge(it));
            for value in function.instructions(block) {
                let found = step(graph, value, &mut pending);
                checked = checked.and_then(|()| about(graph, value, found));
            }
            changed |= at_end[block].as_ref() != Some(&pending);
            at_end[block] = Some(pending);
        }
        if checked.is_err() || !changed {
            return checked;
        }
    }
}
