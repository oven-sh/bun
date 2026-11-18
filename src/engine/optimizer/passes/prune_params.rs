//! Does without parameters that only ever get one value.

use bun_engine_codegen::ir::{Op, Value as Ssa};
use bun_engine_codegen::passes::Analyses;

use crate::graph::Graph;

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) {
    let cfg = analyses.cfg(&mut graph.function);
    let function = &mut graph.function;
    let joins = || {
        let blocks = cfg.order().iter().map(|&it| (it, cfg.predecessors(it)));
        blocks.filter(|(_, edges)| !edges.is_empty())
    };
    // What a parameter stands for as far as is known: nothing yet, another value, or itself.
    let mut sources = function.value_table(Ssa::NONE);
    let mut changed = true;
    while core::mem::take(&mut changed) {
        for (block, edges) in joins() {
            for (position, &param) in function.params(block).iter().enumerate() {
                let mut found = Ssa::NONE;
                for &edge in edges {
                    let arg = function.args(edge)[position];
                    let is_passed_on = matches!(function.op(arg), Op::Param(_))
                        && !cfg.predecessors(function.block_of(arg)).is_empty();
                    let source = if is_passed_on { sources[arg] } else { arg };
                    if found.is_none() {
                        found = source;
                    } else if !source.is_none() && source != found && arg != param {
                        found = param;
                    }
                }
                if sources[param] != param && sources[param] != found {
                    (sources[param], changed) = (found, true);
                }
            }
        }
    }
    for (block, edges) in joins() {
        let mut has_dead = false;
        for position in 0..function.params(block).len() {
            let param = function.params(block)[position];
            if sources[param] != param {
                function.replace_param(param, sources[param]);
                has_dead = true;
            }
        }
        if has_dead {
            function.drop_dead_params(block, edges);
        }
    }
    function.resolve_aliases();
}
