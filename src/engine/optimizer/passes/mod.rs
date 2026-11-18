//! What is done to a graph away from the heap.

mod escape;
mod hoist;
mod keep_owners_alive;
mod loop_writes;
mod predict;
mod prune_params;
mod separate_entered_loop;
mod specialize;
mod unbox_params;
mod unbox_states;
mod usage;
mod verify_results;

use bun_engine_codegen::Target;
use bun_engine_codegen::ir::{
    Access, AccessFlags, Entity, Function, Op, Value as Ssa, validate as validate_machine,
};
use bun_engine_codegen::passes::{Analyses, Pass};

use crate::builder::Built;
use crate::graph::probes::is_wanted;
use crate::graph::{Graph, Kind, Knowledge, validate};

fn checked(graph: &Graph, name: &str) {
    if !cfg!(debug_assertions) {
        return;
    }
    let found = validate_machine(&graph.function).and_then(|()| validate(graph));
    if let Err(problem) = found {
        panic!("after {name}: {problem}\n{:?}", graph.function);
    }
}

/// A parameter that stood for checks may have given way to its only argument.
fn hold_loose_loads(graph: &mut Graph) {
    for value in (0..graph.function.value_count()).map(Ssa::from_index) {
        if let Op::Load {
            address, access, ..
        } = *graph.function.op(value)
            && access.has(AccessFlags::ALWAYS_READABLE)
            && graph.is_loose(address, access.heap())
            && let Op::Load { access, .. } = graph.function.op_mut(value)
        {
            *access = Access::new(access.heap(), access.flags() - AccessFlags::ALWAYS_READABLE);
        }
    }
}

/// The nodes that only hold states for others.
fn remove_placeholders(graph: &mut Graph, analyses: &mut Analyses) {
    for &block in analyses.cfg(&mut graph.function).order() {
        let mut value = graph.function.first(block);
        while !value.is_none() {
            let next = graph.function.next(value);
            if let Some(Kind::Checkpoint | Kind::InlineEntry) = graph.kind(value) {
                graph.function.remove(value);
            }
            value = next;
        }
    }
}

pub(crate) fn optimize(
    graph: &mut Graph,
    analyses: &mut Analyses,
    knowledge: &mut Knowledge,
    observe: impl Fn(&str, &Function),
) -> Built {
    let target = Target::host();
    let done = |graph: &Graph, name: &str| {
        checked(graph, name);
        observe(name, &graph.function);
    };
    analyses.invalidate();
    analyses.cfg(&mut graph.function);
    done(graph, "build");
    separate_entered_loop::run(graph, analyses);
    prune_params::run(graph, analyses);
    done(graph, "prune_params");
    if bun_engine_vm::options().use_escape_analysis {
        escape::run(graph, analyses)?;
        done(graph, "escape");
    }
    let usage = usage::run(graph, analyses);
    predict::run(graph, analyses, &usage);
    unbox_params::run(graph, analyses);
    done(graph, "unbox_params");
    specialize::run(graph, analyses, &usage, knowledge);
    done(graph, "specialize");
    unbox_states::run(graph);
    // What a node does may depend on the realm of the code.
    if graph.realms.len() == 1 {
        Pass::SIMPLIFY_QUICKLY.run(&mut graph.function, analyses, target);
        hold_loose_loads(graph);
        done(graph, "simplify");
    }
    hoist::run(graph, analyses);
    done(graph, "hoist");
    remove_placeholders(graph, analyses);
    Pass::named("eliminate_dead_code").run(&mut graph.function, analyses, target);
    if is_wanted(|it| it.validate_proofs) {
        verify_results::run(graph, analyses);
    }
    keep_owners_alive::run(graph, analyses);
    done(graph, "eliminate_dead_code");
    Ok(())
}
