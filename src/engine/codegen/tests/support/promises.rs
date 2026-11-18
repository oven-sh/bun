//! A load that is `ALWAYS_READABLE` has to work as soon as its address can be computed, also from the arguments for
//! the parameters and what is stored in the variables that go into it.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{AccessFlags, Effects, Entity, Function, Op, Table, Value};

#[derive(Clone)]
pub(crate) enum Step {
    Compute(Value),
    /// Parameters and their arguments.
    Pass(Vec<(Value, Value)>),
}

pub(crate) struct Promise {
    pub(crate) load: Value,
    /// What leads to the address, in order.
    pub(crate) steps: Vec<Step>,
    /// The instructions and parameters that the steps need.
    given: Vec<Value>,
    /// The last of them, or `NONE`.
    pub(crate) after: Value,
}

fn can_move(function: &Function, value: Value) -> bool {
    let is_scalar_arithmetic = matches!(
        function.op(value),
        Op::Unary(..) | Op::Binary(..) | Op::Compare(..) | Op::FloatCompare(..) | Op::Select(_)
    );
    is_scalar_arithmetic && function.effects(value) == Effects::NONE
}

fn promise(
    function: &Function,
    position: &Table<Value, usize>,
    load: Value,
    mut pending: Vec<Value>,
    then: impl Iterator<Item = Step>,
) -> Promise {
    let (mut computed, mut given) = (Vec::new(), Vec::new());
    while let Some(value) = pending.pop() {
        if !can_move(function, value) {
            given.push(value);
        } else if !computed.contains(&value) {
            computed.push(value);
            pending.extend(function.operands(value));
        }
    }
    computed.sort_by_key(|&value| position[value]);
    given.retain(|&value| !function.op(value).is_floating());
    let after = given.iter().copied().max_by_key(|&value| position[value]);
    Promise {
        load,
        steps: computed
            .into_iter()
            .map(Step::Compute)
            .chain(then)
            .collect(),
        given,
        after: after.unwrap_or(Value::NONE),
    }
}

pub(crate) fn promises(function: &Function) -> Vec<Promise> {
    const MOST_FOR_A_LOAD: usize = 12;
    let is_trusting = |value| {
        let access = function.op(value).access();
        access.is_some_and(|access| access.has(AccessFlags::ALWAYS_READABLE))
    };
    if !(0..function.value_count())
        .map(Value::from_index)
        .any(is_trusting)
    {
        return Vec::new();
    }
    let cfg = Cfg::new(function);
    let in_block = |&block| {
        function
            .params(block)
            .iter()
            .copied()
            .chain(function.instructions(block))
    };
    let in_order: Vec<Value> = cfg.order().iter().flat_map(in_block).collect();
    let mut position = function.value_table(0);
    for (index, &value) in in_order.iter().enumerate() {
        position[value] = index;
    }
    let mut all = Vec::new();
    for load in in_order.iter().copied().filter(|&value| is_trusting(value)) {
        let (first, address) = (all.len(), *function.operands(load).last().unwrap());
        all.push(promise(
            function,
            &position,
            load,
            vec![address],
            std::iter::empty(),
        ));
        let mut next = first;
        while next < all.len() && all.len() - first < MOST_FOR_A_LOAD {
            let after = all[next].after.expand();
            let param = after.filter(|&after| matches!(function.op(after), Op::Param(_)));
            let block = param.map(|param| function.block_of(param));
            for &edge in block.map_or(&[][..], |block| cfg.predecessors(block)) {
                let arg_for = |value| match *function.op(value) {
                    Op::Param(index) if Some(function.block_of(value)) == block => {
                        function.args(edge)[index as usize]
                    }
                    _ => value,
                };
                let Promise { given, steps, .. } = &all[next];
                let pass = given.iter().map(|&param| (param, arg_for(param))).collect();
                let then = std::iter::once(Step::Pass(pass)).chain(steps.iter().cloned());
                let args = given.iter().map(|&value| arg_for(value)).collect();
                all.push(promise(function, &position, load, args, then));
            }
            if let [only] = all[next].given[..]
                && let Op::GetVariable(variable) = *function.op(only)
            {
                for &value in &in_order {
                    if let Op::SetVariable(same, stored) = *function.op(value)
                        && same == variable
                    {
                        let pass = Step::Pass(vec![(only, stored)]);
                        let then = std::iter::once(pass).chain(all[next].steps.iter().cloned());
                        all.push(promise(function, &position, load, vec![stored], then));
                    }
                }
            }
            next += 1;
        }
    }
    all
}
