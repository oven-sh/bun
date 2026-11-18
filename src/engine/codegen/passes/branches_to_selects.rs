//! Does without a branch that only chooses a truth value, or the lesser or greater of two integers.

use bun_engine_asm::Cond;

use super::Analyses;
use crate::analysis::Cfg;
use crate::ir::{Block, Builder, Edge, Function, Op, Type, Value};
use crate::target::Target;

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let cfg = analyses.cfg(function);
    let mut changed = false;
    for &block in cfg.order() {
        changed |= try_to_convert(function, cfg, block).is_some();
    }
    if changed {
        analyses.invalidate();
    }
}

/// Past a block that does nothing.
fn onward(function: &Function, cfg: &Cfg, edge: Edge) -> Edge {
    let target = function.target(edge);
    if *function.op(function.first(target)) == Op::Jump
        && function.params(target).is_empty()
        && cfg.predecessors(target).len() == 1
    {
        function.successor(target, 0)
    } else {
        edge
    }
}

fn try_to_convert(function: &mut Function, cfg: &Cfg, block: Block) -> Option<()> {
    let end = function.last(block);
    let Op::Branch(condition) = *function.op(end) else {
        return None;
    };
    let edges = [0, 1].map(|position| function.successor(block, position));
    let [then, or] = edges.map(|edge| onward(function, cfg, edge));
    if function.target(then) != function.target(or)
        || edges.iter().any(|&edge| function.is_rare(edge))
    {
        return None;
    }
    let pairs = function.args(then).iter().zip(function.args(or));
    let mut differing = pairs.enumerate().filter(|(_, (a, b))| a != b);
    let (position, (&a, &b)) = differing.next()?;
    if differing.next().is_some() {
        return None;
    }
    let chosen = choose(&mut Builder::before(function, end), condition, a, b)?;
    let (join, mut args) = (function.target(then), function.args(then).to_vec());
    args[position] = chosen;
    function.redirect(edges[0], join, &args);
    function.keep_only_successor(edges[0]);
    Some(())
}

fn choose(builder: &mut Builder<'_>, condition: Value, then: Value, or: Value) -> Option<Value> {
    let constants = (builder.int_constant(then), builder.int_constant(or));
    let truth = match (constants, *builder.op(condition)) {
        ((Some(1), Some(0)), Op::Compare(..) | Op::FloatCompare(..)) => condition,
        ((Some(1), Some(0)), _) => builder.is_not_zero(condition),
        ((Some(0), Some(1)), _) => builder.is_zero(condition),
        (_, Op::Compare(cond, operands))
            if !matches!(cond, Cond::Eq | Cond::Ne)
                && (operands == [then, or] || operands == [or, then]) =>
        {
            return Some(builder.select(condition, then, or));
        }
        _ => return None,
    };
    Some(if builder.type_of(then) == Type::I64 {
        builder.zero_extend(truth)
    } else {
        truth
    })
}
