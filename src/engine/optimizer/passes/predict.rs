//! Carries what profiles have seen forward to the values that have none.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{Op, Value as Ssa};
use bun_engine_codegen::passes::Analyses;
use bun_engine_vm::SpeculatedType as T;

use super::usage::{Usage, Use};
use crate::graph::{ArithmeticData as Seen, ExitKind, Graph, Kind, type_of_param};

const INTEGER: T = T::INT32.union(T::INT52);

fn fits_int32(seen: Seen, usage: Use) -> bool {
    (!seen.intersects(Seen::MAY_OVERFLOW_INT32 | Seen::MAY_BE_DOUBLE)
        || !usage.contains(Use::AS_NUMBER))
        && (!seen.contains(Seen::MAY_BE_NEGATIVE_ZERO) || !usage.contains(Use::SIGN_OF_ZERO))
}

fn fits_int52(seen: Seen, usage: Use) -> bool {
    !seen.contains(Seen::MAY_OVERFLOW_INT52)
        && (!seen.contains(Seen::MAY_BE_NEGATIVE_ZERO) || !usage.contains(Use::SIGN_OF_ZERO))
}

/// `guesses` is for when no more is going to be found out about the operands.
fn predict(graph: &Graph, value: Ssa, usage: Use, guesses: bool) -> Option<T> {
    let (kind, data) = graph.node(value)?;
    let seen = Seen::from_bits_retain(data);
    let flags = [Seen::SAW_DOUBLE_FIRST, Seen::SAW_DOUBLE_SECOND];
    let as_seen = |(&operand, flag): (&Ssa, Seen)| match graph.prediction(operand) {
        number if T::FULL_NUMBER.contains(number) && !(guesses && number.is_empty()) => number,
        _ if seen.contains(flag) => T::BOXED_NUMBER,
        _ => T::INT32,
    };
    let operands = match kind {
        Kind::QuietToNumber => {
            let operand = graph.prediction(graph.root(graph.operand(value, 0)));
            let (likely, origin) = (
                operand | graph.interned_type(data),
                graph.function.origin(value),
            );
            let failures = [ExitKind::Mixed, ExitKind::Overflow];
            let fits = (T::INT32 | T::BOOLEAN | T::NULL).contains(likely)
                && !failures.into_iter().any(|it| graph.has_exited(origin, it));
            return Some(if fits { T::INT32 } else { T::BOXED_DOUBLE });
        }
        Kind::UInt32ToNumber => {
            return Some(if fits_int32(seen, usage) {
                T::INT32
            } else {
                INTEGER
            });
        }
        Kind::NumberAdd
        | Kind::NumberSubtract
        | Kind::NumberMultiply
        | Kind::NumberDivide
        | Kind::NumberRemainder
        | Kind::NumberNegate
        | Kind::NumberAbs
        | Kind::NumberMin
        | Kind::NumberMax
        | Kind::NumberFloor
        | Kind::NumberCeil
        | Kind::NumberTrunc
        | Kind::NumberRound
        | Kind::NumberPower
        | Kind::NumberToNumber => (graph.function.operands(value).iter().zip(flags)).map(as_seen),
        _ => return None,
    };
    if operands.clone().any(|prediction| prediction.is_empty()) {
        return None;
    }
    let all = operands.fold(T::empty(), |all, prediction| all | prediction);
    // What the graph computes has a form of its own.
    let mut flagged = graph.function.operands(value).iter().zip(flags);
    let saw_double = seen.contains(Seen::WAS_NO_INT32)
        || flagged.any(|(&operand, flag)| {
            seen.contains(flag) && !T::BOXED_NUMBER.contains(graph.inherent_type(operand))
        });
    let are_int32 = T::INT32.contains(all) && !saw_double;
    let are_integers = INTEGER.contains(all) && (all.intersects(T::INT52) || !saw_double);
    let usage = match kind {
        Kind::NumberDivide | Kind::NumberRemainder if usage.contains(Use::NON_INTEGER) => {
            usage | Use::AS_NUMBER
        }
        _ => usage,
    };
    Some(match kind {
        Kind::NumberToNumber if saw_double => all & T::FULL_NUMBER | T::BOXED_NUMBER,
        Kind::NumberToNumber => all & T::FULL_NUMBER,
        Kind::NumberFloor | Kind::NumberCeil | Kind::NumberTrunc | Kind::NumberRound
            if fits_int32(seen, Use::all()) =>
        {
            T::INT32
        }
        Kind::NumberPower if are_int32 && fits_int32(seen, Use::all()) => T::INT32,
        Kind::NumberPower => T::BOXED_DOUBLE,
        Kind::NumberMin | Kind::NumberMax if are_int32 => T::INT32,
        // A product can be too large to be exact, so its low bits are not those of the integer.
        Kind::NumberMultiply if are_int32 && fits_int32(seen, usage | Use::AS_NUMBER) => T::INT32,
        Kind::NumberMultiply if are_integers && fits_int52(seen, usage) => INTEGER,
        Kind::NumberMultiply => T::BOXED_DOUBLE,
        _ if are_int32 && fits_int32(seen, usage) => T::INT32,
        Kind::NumberAdd | Kind::NumberSubtract | Kind::NumberNegate
            if are_integers && fits_int52(seen, usage) =>
        {
            INTEGER
        }
        _ => T::BOXED_DOUBLE,
    })
}

/// What parameters are certain to be: no more than their arguments.
fn declare_params(graph: &mut Graph, cfg: &Cfg) {
    let mut found = graph.function.value_table(T::empty());
    let mut changed = true;
    while core::mem::take(&mut changed) {
        for &block in cfg.order() {
            for &edge in cfg.predecessors(block) {
                let function = &graph.function;
                for (&arg, &param) in function.args(edge).iter().zip(function.params(block)) {
                    let arg = graph.root(arg);
                    let is_passed_on = matches!(function.op(arg), Op::Param(_))
                        && !cfg.predecessors(function.block_of(arg)).is_empty();
                    let widened = found[param]
                        | if is_passed_on {
                            type_of_param(found[arg])
                        } else {
                            graph.inherent_type(arg)
                        };
                    changed |= core::mem::replace(&mut found[param], widened) != widened;
                }
            }
        }
    }
    for &block in cfg.order() {
        for position in 0..graph.function.params(block).len() {
            let param = graph.function.params(block)[position];
            if !found[param].is_empty() {
                graph.declare(param, found[param]);
            }
        }
    }
}

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses, usage: &Usage) {
    let cfg = analyses.cfg(&mut graph.function);
    declare_params(graph, cfg);
    graph
        .predictions
        .grow_to(graph.function.value_count(), T::empty());
    graph.saved.sort_unstable_by_key(|it| (it.0, it.1));
    graph.restored.sort_unstable_by_key(|it| (it.0, it.1));
    propagate(graph, cfg, usage, false);
    propagate(graph, cfg, usage, true);
}

/// Both lists are sorted.
fn carry_over_suspensions(graph: &mut Graph) -> bool {
    let (mut changed, mut first) = (false, 0);
    for position in 0..graph.restored.len() {
        let (point, word, restored) = graph.restored[position];
        first += graph.saved[first..].partition_point(|it| (it.0, it.1) < (point, word));
        let saved = (graph.saved[first..].iter()).take_while(|it| (it.0, it.1) == (point, word));
        let seen: T = saved.map(|it| graph.prediction(graph.root(it.2))).collect();
        let widened = graph.predictions[restored] | seen.boxed();
        changed |= core::mem::replace(&mut graph.predictions[restored], widened) != widened;
    }
    changed
}

fn propagate(graph: &mut Graph, cfg: &Cfg, usage: &Usage, guesses: bool) {
    let has_cycles = cfg.loops().len() != 0 || !graph.restored.is_empty();
    let mut changed = true;
    while core::mem::take(&mut changed) {
        changed |= carry_over_suspensions(graph);
        for &block in cfg.order() {
            for &edge in cfg.predecessors(block) {
                for position in 0..graph.function.args(edge).len() {
                    let (arg, param) = (
                        graph.function.args(edge)[position],
                        graph.function.params(block)[position],
                    );
                    let widened = graph.predictions[param] | graph.prediction(arg);
                    changed |= core::mem::replace(&mut graph.predictions[param], widened)
                        != widened
                        && has_cycles;
                }
            }
            let mut value = graph.function.first(block);
            while !value.is_none() {
                if let Some(prediction) = predict(graph, value, usage.of(value), guesses) {
                    let widened = graph.predictions[value] | prediction;
                    changed |= core::mem::replace(&mut graph.predictions[value], widened)
                        != widened
                        && has_cycles;
                }
                value = graph.function.next(value);
            }
        }
    }
}
