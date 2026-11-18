//! Turns a selection into a branch where a constant that it selects settles a check or a branch that follows closely.

use super::Analyses;
use super::copier::{Copier, Preview};
use super::readability::withdraw_promises;
use crate::ir::{Builder, Edge, Entity, Function, Op, Successor, Value};
use crate::target::Target;

const GREATEST_DISTANCE: usize = 6;
const GREATEST_COST: u32 = 6;
const MOST_SUCCESSORS: usize = 3;

#[derive(Clone, Copy)]
struct Arm {
    value: Value,
    taken: Option<Edge>,
    is_rare: bool,
}

struct Specialization {
    select: Value,
    condition: Value,
    arms: [Arm; 2],
    /// A check, or the end of the block.
    last: Value,
}

fn selects_constant(function: &Function, value: Value) -> bool {
    matches!(*function.op(value), Op::Select([condition, then, or])
        if !function.op(condition).is_constant()
            && (function.op(then).is_constant() || function.op(or).is_constant()))
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let mut values = (0..function.value_count()).map(Value::from_index);
    if !values.any(|value| selects_constant(function, value)) {
        return;
    }
    let (cfg, frequencies) = analyses.frequencies(function);
    let (mut found, mut copier) = (Vec::new(), Copier::new(function));
    for &block in cfg.order() {
        // From the end, so that no instruction moves to a new block again and again.
        let mut value = function.last(block);
        while !value.is_none() && !frequencies.is_cold(block) {
            if let Some(specialization) = plan(function, &mut copier, value) {
                value = specialization.select;
                found.push(specialization);
            }
            value = function.previous(value);
        }
    }
    if found.is_empty() {
        return;
    }
    let selects: Vec<Value> = found.iter().map(|found| found.select).collect();
    withdraw_promises(function, cfg, &selects);
    for specialization in &found {
        specialize(function, &mut copier, specialization);
    }
    copier.repair_uses(function, analyses);
}

fn plan(function: &mut Function, copier: &mut Copier, last: Value) -> Option<Specialization> {
    let tested = match *function.op(last) {
        Op::Check(tested, _) | Op::Branch(tested) => tested,
        Op::Switch(tested, _) | Op::JumpTable(tested, _)
            if function.successors(function.block_of(last)).len() <= MOST_SUCCESSORS =>
        {
            tested
        }
        _ => return None,
    };
    if function.block_of(tested) != function.block_of(last) {
        return None;
    }
    let mut value = last;
    for _ in 0..GREATEST_DISTANCE {
        value = function.previous(value).expand()?;
        if selects_constant(function, value)
            && let Some(found) = plan_for(function, copier, value, last)
        {
            return Some(found);
        }
    }
    None
}

fn plan_for(
    function: &mut Function,
    copier: &mut Copier,
    select: Value,
    last: Value,
) -> Option<Specialization> {
    let Op::Select([condition, then, or]) = *function.op(select) else {
        unreachable!("not a selection")
    };
    let [as_it_is, for_then, for_or] = [select, then, or].map(|selected| {
        copier.set_stand_in(select, selected);
        let preview = copier.preview(function, function.next(select), last);
        copier.forget_stand_ins();
        preview.filter(|preview| preview.cost <= GREATEST_COST)
    });
    let is_settled =
        |preview: &Preview| preview.taken.is_some() || preview.settled_check_fails.is_some();
    let previews = [for_then?, for_or?];
    if is_settled(&as_it_is?) || !previews.iter().any(is_settled) {
        return None;
    }
    let arm = |value, preview: &Preview| Arm {
        value,
        taken: preview.taken,
        is_rare: preview.settled_check_fails == Some(true)
            || preview.taken.is_some_and(|taken| function.is_rare(taken)),
    };
    Some(Specialization {
        select,
        condition,
        arms: [arm(then, &previews[0]), arm(or, &previews[1])],
        last,
    })
}

fn specialize(function: &mut Function, copier: &mut Copier, specialization: &Specialization) {
    let Specialization {
        select,
        condition,
        mut arms,
        last,
    } = *specialization;
    let (block, origin) = (function.block_of(select), function.origin(select));
    if let Some(next) = function.next(last).expand() {
        let rest = function.split_before(next);
        let mut builder = Builder::at_end(function, block);
        builder.origin = origin;
        builder.jump(rest, &[]);
        let taken = Some(function.successor(block, 0));
        arms = arms.map(|arm| Arm { taken, ..arm });
    }
    let original = function.split_before(select);
    let [then, or] = arms.map(|arm| {
        let target = function.new_block();
        copier.set_stand_in(select, arm.value);
        copier.copy_body_from(function, function.next(select), target);
        copier.copy_end(function, original, target, arm.taken);
        copier.end_path(target);
        Successor {
            target,
            args: &[],
            is_rare: arm.is_rare,
        }
    });
    let mut builder = Builder::at_end(function, block);
    builder.origin = origin;
    builder.branch(condition, then, or);
}
