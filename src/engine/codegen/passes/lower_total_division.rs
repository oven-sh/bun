//! x86-64 faults where a quotient does not exist or fit, so those divisors take another way.

use super::Analyses;
use crate::ir::{Binary, Builder, Entity, Function, Op, Successor, Value};
use crate::target::Target;

fn partial(op: &Op) -> Option<(Binary, [Value; 2])> {
    match *op {
        Op::Binary(Binary::TotalDiv, args) => Some((Binary::Div, args)),
        Op::Binary(Binary::TotalRem, args) => Some((Binary::Rem, args)),
        _ => None,
    }
}

/// For a divisor of 0 or −1.
fn special_result(builder: &mut Builder<'_>, op: Binary, [dividend, divisor]: [Value; 2]) -> Value {
    if op == Binary::Div {
        builder.mul(dividend, divisor)
    } else {
        let ty = builder.type_of(dividend);
        builder.zero(ty)
    }
}

fn lower(function: &mut Function, value: Value, op: Binary, args: [Value; 2]) {
    let divisor = args[1];
    match function.int_constant(divisor) {
        Some(0 | -1) => {
            let result = special_result(&mut Builder::before(function, value), op, args);
            return function.replace(value, result);
        }
        Some(_) => return *function.op_mut(value) = Op::Binary(op, args),
        None => {}
    }
    let (block, origin) = (function.block_of(value), function.origin(value));
    let rest = function.split_before(value);
    let result = function.add_param(rest, function.type_of(value));
    function.replace(value, result);

    let (usual, special) = (function.new_block(), function.new_block());
    let mut builder = Builder::at_end(function, block);
    builder.origin = origin;
    let next = builder.add(divisor, 1);
    let is_usual = builder.above(next, 1);
    builder.branch(is_usual, usual, Successor::from(special).rare());
    builder.switch_to(usual);
    let quotient = builder.binary(op, args[0], divisor);
    builder.jump(rest, &[quotient]);
    builder.switch_to(special);
    let known = special_result(&mut builder, op, args);
    builder.jump(rest, &[known]);
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, target: Target) {
    let mut values = (0..function.value_count()).map(Value::from_index);
    if !target.is_x64() || !values.any(|value| partial(function.op(value)).is_some()) {
        return;
    }
    for &block in analyses.cfg(function).order() {
        // From the end, so that no instruction moves twice.
        let mut value = function.last(block);
        while !value.is_none() {
            let previous = function.previous(value);
            if let Some((op, args)) = partial(function.op(value)) {
                lower(function, value, op, args);
            }
            value = previous;
        }
    }
    function.resolve_aliases();
    analyses.invalidate();
}
