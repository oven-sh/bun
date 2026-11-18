//! Code that starts at a loop gets back to it by way of the loops around it too. Those ways get a header of their own.

use bun_engine_codegen::ir::{Builder, Edge, Op, Value as Ssa};
use bun_engine_codegen::passes::Analyses;
use smallvec::SmallVec;

use crate::graph::{Entry, FrameIndex, Graph, Kind};

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) {
    let Entry::Loop(offset) = graph.entry else {
        return;
    };
    let cfg = analyses.cfg(&mut graph.function);
    let function = &graph.function;
    let Some(first) = function.successors(function.entries()[0].block).next() else {
        return;
    };
    let header = function.target(first);
    let checkpoint = function.first(header);
    let comes_from_above = |&edge: &Edge| {
        let from = graph.site(function.origin(function.last(function.source(edge))));
        edge == first || from.position.frame == FrameIndex::ROOT && from.position.offset < offset
    };
    let edges = cfg.predecessors(header);
    let outside: SmallVec<[Edge; 4]> = edges.iter().copied().filter(comes_from_above).collect();
    if outside.len() < 2
        || outside.len() == edges.len()
        || graph.kind(checkpoint) != Some(Kind::Checkpoint)
    {
        return;
    }
    let outer = graph.function.new_block();
    let params: SmallVec<[Ssa; 16]> = (0..graph.function.params(header).len())
        .map(|position| {
            let inner = graph.function.params(header)[position];
            let param = (graph.function).add_param(outer, graph.function.type_of(inner));
            graph.predict(param, graph.prediction(inner));
            param
        })
        .collect();
    let function = &mut graph.function;
    (outside.iter()).for_each(|&edge| function.set_target(edge, outer));
    let state = function.state_of(checkpoint);
    let passed = |&held: &Ssa| match *function.op(held) {
        Op::Param(position) if function.block_of(held) == header => params[position as usize],
        _ => held,
    };
    let values: SmallVec<[Ssa; 32]> = function.state(state).iter().map(passed).collect();
    let mut values = values.into_iter();
    let state = function.map_state(state, |_| values.next().unwrap());
    let origin = function.origin(checkpoint);
    let mut ir = Builder::at_end(function, outer);
    ir.origin = origin;
    let kind = Kind::Checkpoint;
    ir.node(kind.id(), kind.gives().machine_type(), &[], 0, state);
    ir.jump(header, &params);
    analyses.invalidate();
}
