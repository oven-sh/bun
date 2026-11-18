//! Has the code verify that values are what their instructions are said to give.

use bun_engine_codegen::ir::{Builder, State, Type, Value as Ssa};
use bun_engine_codegen::passes::Analyses;
use bun_engine_vm::SpeculatedType as T;

use crate::graph::probes::Claim;
use crate::graph::{Gives, Graph, Kind};

fn claim_of(graph: &Graph, value: Ssa) -> Option<Claim> {
    match graph
        .node(value)
        .map(|(kind, data)| (kind.gives(), kind, data))
    {
        Some((_, Kind::Refine | Kind::Assume, data)) => {
            Some(Claim::Type(graph.interned_type(data)))
        }
        Some((Gives::Value(_), ..)) => Some(Claim::Type(graph.inherent_type(value))),
        Some((Gives::Boolean, ..)) => Some(Claim::IsBoolean),
        Some((Gives::Int52, ..)) => Some(Claim::IsInt52),
        Some(_) => None,
        None if graph.inherent_type(value) == T::INT52 => Some(Claim::IsInt52),
        None => Some(Claim::Type(graph.inherent_type(value))),
    }
    .filter(|it| !matches!(it, Claim::Type(ty) if ty.contains(T::BYTECODE_TOP)))
}

fn verify(graph: &mut Graph, claim: Claim, operand: Ssa, next: Ssa) {
    if let Some(data) = graph.sample(claim) {
        let mut ir = Builder::before(&mut graph.function, next);
        ir.node(Kind::Verify.id(), Type::Void, &[operand], data, State::NONE);
    }
}

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) {
    let cfg = analyses.cfg(&mut graph.function);
    let mut is_used = graph.function.value_table(false);
    for &block in cfg.order() {
        let function = &graph.function;
        let mut note = |it: Ssa| is_used[it] = true;
        (function.instructions(block)).for_each(|it| function.for_each_use(it, &mut note));
    }
    for &block in cfg.order() {
        let mut value = graph.function.first(block);
        for position in 0..graph.function.params(block).len() {
            let param = graph.function.params(block)[position];
            if let Some(claim) = claim_of(graph, param) {
                verify(graph, claim, param, value);
            }
        }
        while !value.is_none() {
            let next = graph.function.next(value);
            if let Some((Kind::CheckType | Kind::IsType, data)) = graph.node(value) {
                let known = Claim::Type(graph.type_check_at(data).known);
                verify(graph, known, graph.operand(value, 0), value);
            }
            if let Some((Kind::CheckModes | Kind::HasModes, data)) = graph.node(value) {
                let known = Claim::Modes(graph.mode_check_at(data).known);
                verify(graph, known, graph.operand(value, 0), value);
            }
            if let Some(claim) = claim_of(graph, value).filter(|_| is_used[value]) {
                verify(graph, claim, value, next);
            }
            value = next;
        }
    }
}
