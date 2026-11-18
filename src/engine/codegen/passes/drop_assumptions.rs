//! Removes what only informs other passes, so that it does not hide patterns from instruction selection.

use super::Analyses;
use super::readability::withdraw_promises;
use crate::ir::{Entity, Function, Op, Unary, Value};
use crate::target::Target;

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let cfg = analyses.cfg(function);
    let values = (0..function.value_count()).map(Value::from_index);
    let dropped: Vec<Value> = values
        .filter(|&value| matches!(function.op(value), Op::Unary(Unary::FitsIn(_), _)))
        .collect();
    if dropped.is_empty() {
        return;
    }
    withdraw_promises(function, cfg, &dropped);
    for value in dropped {
        function.replace(value, function.operands(value)[0]);
    }
    function.resolve_aliases();
}
