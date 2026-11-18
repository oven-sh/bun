//! What holds of a graph besides what the back end asks of a function.

mod exits;
mod forms;
mod recipes;
mod safepoints;

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{Op, Value as Ssa};

use super::Graph;

type Checked = Result<(), String>;

pub(crate) fn validate(graph: &Graph) -> Checked {
    let cfg = Cfg::new(&graph.function);
    recipes::validate(graph, &cfg)?;
    exits::validate(graph, &cfg)?;
    forms::validate(graph, &cfg)?;
    safepoints::validate(graph, &cfg)
}

fn about(graph: &Graph, value: Ssa, checked: Checked) -> Checked {
    checked.map_err(|problem| {
        let block = graph.function.block_of(value);
        let before = (graph.function.instructions(block)).take_while(|&it| it != value);
        format!(
            "{value:?} in line {} of {block:?} {problem}",
            before.count() + 1
        )
    })
}

fn exits(graph: &Graph, value: Ssa) -> bool {
    match graph.kind(value) {
        Some(kind) => kind.can_exit(),
        None => matches!(graph.function.op(value), Op::Check(..) | Op::Checked(..)),
    }
}
