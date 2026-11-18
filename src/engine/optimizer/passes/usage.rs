//! How much of a number its users look at.

use bun_engine_codegen::BitSet;
use bun_engine_codegen::ir::{Entity, Op, State, Table, Value as Ssa};
use bun_engine_codegen::passes::Analyses;
use bun_engine_vm::{SpeculatedType as T, Value};

use crate::graph::{AS_INDEX, Graph, Kind};

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(super) struct Use: u8 {
        /// More than the low 32 bits of an integer.
        const AS_NUMBER = 1 << 0;
        const SIGN_OF_ZERO = 1 << 1;
        /// More than what ToInt32 makes of what is no integer.
        const NON_INTEGER = 1 << 2;
    }
}

pub(super) struct Usage(Table<Ssa, Use>);

impl Usage {
    pub(super) fn of(&self, value: Ssa) -> Use {
        self.0.get(value).copied().unwrap_or(Use::all())
    }
}

/// Adding it to a sum of such numbers loses no bits.
fn is_small_integer(graph: &Graph, value: Ssa) -> bool {
    T::INT32.contains(graph.inherent_type(value)) || graph.kind(value) == Some(Kind::UInt32ToNumber)
}

fn is_nonzero_constant(graph: &Graph, value: Ssa) -> bool {
    graph
        .constant(value)
        .is_some_and(|bits| bits > Value::NUMBER_TAG)
}

fn use_of_operand(
    graph: &Graph,
    (kind, data): (Kind, u32),
    own: Use,
    operands: &[Ssa],
    position: usize,
) -> Use {
    const MAGNITUDE: Use = Use::AS_NUMBER.union(Use::NON_INTEGER);
    match kind {
        Kind::Truncate => Use::empty(),
        Kind::AsInt32 | Kind::AsInt52 if data == AS_INDEX => MAGNITUDE,
        Kind::Clamp
        | Kind::TruncateInRange
        | Kind::Compare
        | Kind::LooseEqual
        | Kind::StrictEqual
        | Kind::ToBoolean
        | Kind::ToString
        | Kind::ExactInt32
        | Kind::IsType => MAGNITUDE,
        Kind::NumberAdd | Kind::NumberSubtract => {
            let mut wanted = own | Use::NON_INTEGER;
            if operands
                .iter()
                .any(|&operand| is_nonzero_constant(graph, operand))
            {
                wanted -= Use::SIGN_OF_ZERO;
            }
            if !is_small_integer(graph, operands[1 - position]) {
                wanted |= Use::AS_NUMBER;
            }
            wanted
        }
        Kind::NumberNegate | Kind::NumberToNumber | Kind::QuietToNumber => own,
        Kind::NumberAbs => MAGNITUDE,
        Kind::NumberRemainder if position == 1 => MAGNITUDE,
        Kind::NumberMultiply
        | Kind::NumberRemainder
        | Kind::NumberMin
        | Kind::NumberMax
        | Kind::NumberFloor
        | Kind::NumberCeil
        | Kind::NumberTrunc
        | Kind::NumberRound => own | MAGNITUDE,
        Kind::StoreBarrier | Kind::Verify => Use::empty(),
        _ => Use::all(),
    }
}

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) -> Usage {
    let cfg = analyses.cfg(&mut graph.function);
    let (graph, function) = (&*graph, &graph.function);
    let mut usage = function.value_table(Use::empty());
    // Code that takes over at an exit may do what this graph has left out.
    let mut seen_states = BitSet::with_size(function.state_count());
    let mut changed = true;
    while core::mem::take(&mut changed) {
        for &block in cfg.order().iter().rev() {
            for edge in function.successors(block) {
                for (&arg, &param) in function
                    .args(edge)
                    .iter()
                    .zip(function.params(function.target(edge)))
                {
                    let wanted = usage[param];
                    usage[arg] |= wanted;
                }
            }
            for value in function.instructions_backward(block) {
                let (operands, site) =
                    (function.operands(value), graph.site(function.origin(value)));
                for state in [function.state_of(value), site.state_for_handler] {
                    if state != State::NONE && seen_states.insert(state.index()) {
                        (function.state(state).iter()).for_each(|&held| usage[held] = Use::all());
                    }
                }
                let node = graph.node(value);
                for (position, &operand) in operands.iter().enumerate() {
                    let wanted = node.map_or(Use::all(), |node| {
                        use_of_operand(graph, node, usage[value], operands, position)
                    });
                    usage[operand] |= wanted;
                }
            }
            if cfg.loop_headed_by(block).is_some()
                || cfg
                    .predecessors(block)
                    .iter()
                    .any(|&edge| cfg.is_backward(function, edge))
            {
                for &edge in cfg.predecessors(block) {
                    let lags = |(&arg, &param): (&Ssa, &Ssa)| {
                        !usage[arg].contains(usage[param])
                            && !matches!(function.op(arg), Op::Const64(_))
                    };
                    changed |= cfg.is_backward(function, edge)
                        && function
                            .args(edge)
                            .iter()
                            .zip(function.params(block))
                            .any(lags);
                }
            }
        }
    }
    Usage(usage)
}
