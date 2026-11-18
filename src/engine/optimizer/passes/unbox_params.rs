//! Passes numbers and booleans from block to block without tags.

use bun_engine_codegen::ir::{Block, Builder, Edge, State, Table, Type, Value as Ssa};
use bun_engine_codegen::passes::Analyses;
use bun_engine_vm::SpeculatedType as T;
use smallvec::SmallVec;

use crate::graph::{ExitKind, Format, Graph, Kind, ON_EDGE};

/// The form in which arithmetic computes a result with that prediction.
pub(super) fn format_for(prediction: T) -> Format {
    if prediction.is_empty() {
        Format::Tagged
    } else if T::INT32.contains(prediction) {
        Format::Int32
    } else if T::BOOLEAN.contains(prediction) {
        Format::Boolean
    } else if (T::INT32 | T::INT52).contains(prediction) {
        Format::Int52
    } else if T::FULL_NUMBER.contains(prediction) {
        Format::Double
    } else {
        Format::Tagged
    }
}

fn kinds_for(format: Format) -> (Kind, Kind) {
    match format {
        Format::Int32 => (Kind::AsInt32, Kind::BoxInt32),
        Format::Int52 => (Kind::AsInt52, Kind::BoxInt52),
        Format::Double => (Kind::AsDouble, Kind::BoxDouble),
        Format::Boolean => (Kind::AsBoolean, Kind::BoxBoolean),
        Format::Tagged | Format::Saved | Format::Virtual => unreachable!("is not unboxed"),
    }
}

/// The form that specialization gives the result of a node, or one that this converts to freely.
pub(super) fn promised_format(graph: &Graph, value: Ssa) -> Option<Format> {
    let computes_number = matches!(
        graph.kind(value)?,
        Kind::NumberAdd
            | Kind::NumberSubtract
            | Kind::NumberMultiply
            | Kind::NumberDivide
            | Kind::NumberRemainder
            | Kind::NumberNegate
            | Kind::NumberPower
            | Kind::QuietToNumber
            | Kind::NumberAbs
            | Kind::NumberMin
            | Kind::NumberMax
            | Kind::NumberFloor
            | Kind::NumberCeil
            | Kind::NumberTrunc
            | Kind::NumberRound
            | Kind::UInt32ToNumber
    );
    computes_number.then(|| match format_for(graph.prediction(value)) {
        Format::Tagged | Format::Boolean => Format::Double,
        format => format,
    })
}

/// The form in which the value is at hand.
pub(super) fn evident_format(graph: &Graph, value: Ssa) -> Option<Format> {
    match graph.kind(value) {
        Some(Kind::BoxInt32) => Some(Format::Int32),
        Some(Kind::BoxInt52) => Some(Format::Int52),
        Some(Kind::BoxDouble) => Some(Format::Double),
        Some(Kind::BoxBoolean) => Some(Format::Boolean),
        _ => (graph.constant(value)).map(|bits| format_for(graph.type_of_constant(bits))),
    }
}

/// The form in which the value is going to be available without a check.
fn native_format(graph: &Graph, formats: &Table<Ssa, Format>, value: Ssa) -> Format {
    (promised_format(graph, value))
        .or_else(|| evident_format(graph, value))
        .or_else(|| formats.get(value).copied())
        .unwrap_or(Format::Tagged)
}

pub(super) fn converts_freely(from: Format, to: Format) -> bool {
    from == to
        || matches!(
            (from, to),
            (Format::Int32, Format::Int52 | Format::Double) | (Format::Int52, Format::Double)
        )
}

fn checkpoint_of(graph: &Graph, block: Block) -> Option<Ssa> {
    let first = graph.function.first(block);
    let has_failed = graph.has_exited(graph.function.origin(first), ExitKind::BadRepresentation);
    (graph.kind(first) == Some(Kind::Checkpoint) && !has_failed).then_some(first)
}

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) {
    let cfg = analyses.cfg(&mut graph.function);
    let joins = || {
        cfg.order()
            .iter()
            .copied()
            .filter(|&block| !cfg.predecessors(block).is_empty())
    };
    let mut formats = graph.function.value_table(Format::Tagged);
    for block in joins() {
        for &param in graph.function.params(block) {
            if graph.function.type_of(param) == Type::I64 {
                formats[param] = format_for(graph.prediction(param));
            }
        }
    }
    // Unboxing pays if some argument is unboxed already, and is possible if the others can be checked.
    let mut changed = true;
    while core::mem::take(&mut changed) {
        for block in joins() {
            let can_check = checkpoint_of(graph, block).is_some();
            for (position, &param) in graph.function.params(block).iter().enumerate() {
                if formats[param] == Format::Tagged {
                    continue;
                }
                let args = cfg
                    .predecessors(block)
                    .iter()
                    .map(|&edge| graph.function.args(edge)[position]);
                let mut are_free = args.map(|arg| {
                    converts_freely(native_format(graph, &formats, arg), formats[param])
                });
                if !if can_check {
                    are_free.any(|is_free| is_free)
                } else {
                    are_free.all(|is_free| is_free)
                } {
                    formats[param] = Format::Tagged;
                    changed = true;
                }
            }
        }
    }

    let mut did_split = false;
    for block in joins() {
        let count = graph.function.params(block).len();
        let unboxed: SmallVec<[usize; 8]> = (0..count)
            .filter(|&position| formats[graph.function.params(block)[position]] != Format::Tagged)
            .collect();
        if unboxed.is_empty() {
            continue;
        }
        let checkpoint = checkpoint_of(graph, block);
        let edges: SmallVec<[Edge; 4]> = cfg
            .predecessors(block)
            .iter()
            .map(|&edge| {
                let needs_check = |&position: &usize| {
                    let format = formats[graph.function.params(block)[position]];
                    !converts_freely(
                        native_format(graph, &formats, graph.function.args(edge)[position]),
                        format,
                    )
                };
                let state_is_needed = unboxed.iter().any(needs_check);
                let is_shared = graph.function.successors(graph.function.source(edge)).len() > 1;
                let edge = if state_is_needed && is_shared {
                    did_split = true;
                    let middle = graph.function.split_edge(edge);
                    graph.function.successor(middle, 0)
                } else {
                    edge
                };
                let state = if state_is_needed {
                    state_on_edge(graph, checkpoint.unwrap(), edge)
                } else {
                    State::NONE
                };
                for &position in &unboxed {
                    let (arg, kind) = (
                        graph.function.args(edge)[position],
                        kinds_for(formats[graph.function.params(block)[position]]).0,
                    );
                    let last = graph.function.last(graph.function.source(edge));
                    let mut ir = Builder::before(&mut graph.function, last);
                    ir.origin =
                        checkpoint.map_or(ir.origin, |checkpoint| ir.function.origin(checkpoint));
                    let converted = ir.node(
                        kind.id(),
                        kind.gives().machine_type(),
                        &[arg],
                        ON_EDGE,
                        state,
                    );
                    graph.function.push_arg(edge, converted);
                }
                edge
            })
            .collect();
        for &position in &unboxed {
            let old = graph.function.params(block)[position];
            let (unbox, kind) = kinds_for(formats[old]);
            let new = graph
                .function
                .add_param(block, unbox.gives().machine_type());
            if kind == Kind::BoxInt52 {
                graph.declare(new, T::INT52);
            }
            let first = graph.function.first(block);
            let boxed = Builder::before(&mut graph.function, first).node(
                kind.id(),
                Type::I64,
                &[new],
                0,
                State::NONE,
            );
            graph.predict(boxed, graph.prediction(old));
            graph.function.replace_param(old, boxed);
        }
        graph.function.drop_dead_params(block, &edges);
    }
    graph.function.resolve_aliases();
    if did_split {
        analyses.invalidate();
    }
}

fn state_on_edge(graph: &mut Graph, checkpoint: Ssa, edge: Edge) -> State {
    let (block, state) = (
        graph.function.block_of(checkpoint),
        graph.function.state_of(checkpoint),
    );
    let mut held = graph.function.state(state).iter();
    if held.all(|&value| graph.function.block_of(value) != block) {
        return state;
    }
    let pairs: SmallVec<[(Ssa, Ssa); 8]> = graph
        .function
        .params(block)
        .iter()
        .copied()
        .zip(graph.function.args(edge).iter().copied())
        .collect();
    let passed = |value| {
        pairs
            .iter()
            .find(|&&(param, _)| param == value)
            .map_or(value, |&(_, arg)| arg)
    };
    graph.function.map_state(state, passed)
}
