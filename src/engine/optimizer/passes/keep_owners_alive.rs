//! The collector keeps memory of the heap that the stack points into, but looks at what is in there only by way of its
//! owner. Other memory goes with its owner.

use bun_engine_codegen::ir::{Builder, State, Table, Type, Value as Ssa};
use bun_engine_codegen::passes::Analyses;
use smallvec::SmallVec;

use crate::graph::{Graph, Kind};

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) {
    let cfg = analyses.cfg(&mut graph.function);
    let mut collects = Table::filled(cfg.loops().len(), false);
    for &block in cfg.order() {
        let mut around = cfg.loop_of(block);
        let mut values = graph.function.instructions(block);
        if !around.is_none() && values.any(|it| graph.kind(it).is_some_and(Kind::can_collect)) {
            while !around.is_none() && !core::mem::replace(&mut collects[around], true) {
                around = cfg.loops()[around].parent;
            }
        }
    }
    // Two places have the same number only if there is no collection on any way from one to the other.
    let (mut latest, mut periods) = (0, graph.function.value_table(0));
    let mut at_end = graph.function.block_table(0);
    // In this block and period: owners, and what keeps them.
    let mut kept: SmallVec<[(Ssa, Ssa); 8]> = SmallVec::new();
    for &block in cfg.order() {
        let function = &graph.function;
        let is_quiet = |it| cfg.loops()[it].is_natural && !collects[it];
        let turns_quietly = cfg.loop_headed_by(block).is_some_and(is_quiet);
        let mut incoming = (cfg.predecessors(block).iter())
            .filter(|&&edge| !(turns_quietly && cfg.is_backward(function, edge)))
            .map(|&edge| at_end[function.source(edge)]);
        let first = incoming.next().unwrap_or(0);
        let mut period = if first != 0 && incoming.all(|it| it == first) {
            first
        } else {
            latest += 1;
            latest
        };
        let mut value = graph.function.first(block);
        kept.clear();
        while !value.is_none() {
            let next = graph.function.next(value);
            if graph.kind(value).is_some_and(Kind::can_collect) {
                latest += 1;
                period = latest;
                kept.clear();
            }
            periods[value] = period;
            let op = graph.function.op(value);
            if op.access().is_some()
                && let Some(&address) = op.inline_operands().last()
                && let Some(owned) = graph.what_is_at(address)
                && periods[owned.pointer] != period
            {
                let owner = graph.root(owned.owner);
                match kept.iter().find(|it| it.0 == owner) {
                    Some(&(_, node)) => graph.function.move_before(node, next),
                    None => {
                        if kept.len() == kept.inline_size() {
                            kept.clear();
                        }
                        let mut ir = Builder::before(&mut graph.function, next);
                        let kind = Kind::KeepAlive.id();
                        kept.push((owner, ir.node(kind, Type::Void, &[owner], 0, State::NONE)));
                    }
                }
            }
            value = next;
        }
        at_end[block] = period;
    }
}
