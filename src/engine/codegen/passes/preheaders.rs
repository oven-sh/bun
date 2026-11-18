//! The way into a natural loop.

use super::copier::as_jump;
use crate::analysis::{Cfg, Loop};
use crate::ir::{Builder, Edge, Function, Value};

/// They come before the edges from inside.
pub(super) fn entering_edges<'a>(function: &Function, cfg: &'a Cfg, entered: Loop) -> &'a [Edge] {
    let edges = cfg.predecessors(cfg.loops()[entered].header);
    &edges[..edges.partition_point(|&edge| !cfg.includes(entered, function.source(edge)))]
}

/// Makes the edges meet in a new block if there are several.
pub(super) fn only_entering_edge(function: &mut Function, entering: &[Edge]) -> Edge {
    if let [only] = *entering {
        return only;
    }
    let (header, meeting) = (function.target(entering[0]), function.new_block());
    let params: Vec<Value> = (0..function.params(header).len())
        .map(|position| {
            let ty = function.type_of(function.params(header)[position]);
            function.add_param(meeting, ty)
        })
        .collect();
    for &edge in entering {
        function.set_target(edge, meeting);
    }
    let origin = function.origin(function.first(header));
    let mut builder = Builder::at_end(function, meeting);
    builder.origin = origin;
    builder.jump(header, &params);
    function.successor(meeting, 0)
}

/// The only edge into the loop from now on, which leaves a block that ends with a jump. To be called once for a loop
/// while `cfg` is in use, which does not know the blocks that may be added.
pub fn edge_from_preheader(function: &mut Function, cfg: &Cfg, entered: Loop) -> Edge {
    let only = only_entering_edge(function, entering_edges(function, cfg, entered));
    as_jump(function, only)
}
