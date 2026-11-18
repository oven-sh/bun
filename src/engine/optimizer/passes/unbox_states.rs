//! Leaves it to the exit to put tags on values.

use bun_engine_codegen::ir::{Entity, State};

use crate::graph::{Format, Graph, Kind};

pub(super) fn run(graph: &mut Graph) {
    for state in (0..graph.function.state_count()).map(State::from_index) {
        for position in 0..graph.function.state(state).len() {
            let value = graph.root(graph.function.state(state)[position]);
            if let Some((_, offset)) = graph.where_saved(value) {
                let offset = graph.function.const64(offset.into());
                (graph.function).retag(state, position, offset, Format::Saved as u8);
                continue;
            }
            let format = match graph.kind(value) {
                Some(Kind::BoxInt32) => Format::Int32,
                Some(Kind::BoxInt52) => Format::Int52,
                Some(Kind::BoxDouble) => Format::Double,
                Some(Kind::BoxBoolean) => Format::Boolean,
                _ => continue,
            };
            graph
                .function
                .retag(state, position, graph.operand(value, 0), format as u8);
        }
    }
}
