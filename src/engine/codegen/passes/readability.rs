//! Keeps the promise of `ALWAYS_READABLE` when a value is replaced by one that equals it only on some paths.

use crate::analysis::Cfg;
use crate::bitset::BitSet;
use crate::ir::{Access, AccessFlags, EffectFlags, Effects, Entity, Function, Op, Value};

/// The address, if it is computed and the load promises that it can be read.
fn trusted_address(function: &Function, value: Value) -> Option<Value> {
    match *function.op(value) {
        Op::Load {
            address, access, ..
        }
        | Op::LoadLane {
            args: [_, address],
            access,
            ..
        } if access.has(AccessFlags::ALWAYS_READABLE) && !function.op(address).is_floating() => {
            Some(address)
        }
        _ => None,
    }
}

/// Not above branches and checks, so what is computed from its value cannot get there either.
pub(super) fn is_held(effects: Effects) -> bool {
    effects.must_execute() || effects.has(EffectFlags::CONTROL_DEPENDENT)
}

pub(super) fn withdraw_promise(function: &mut Function, load: Value) {
    if let Op::Load { access, .. } | Op::LoadLane { access, .. } = function.op_mut(load) {
        *access = Access::new(access.heap(), access.flags() - AccessFlags::ALWAYS_READABLE);
    }
}

/// From the loads whose addresses are computed from one of the values.
pub(super) fn withdraw_promises(function: &mut Function, cfg: &Cfg, origins: &[Value]) {
    if function.only_nodes_make_readable {
        return;
    }
    let trusting: Vec<Value> = (0..function.value_count())
        .map(Value::from_index)
        .filter(|&value| trusted_address(function, value).is_some())
        .collect();
    if trusting.is_empty() {
        return;
    }
    let mut replaced = BitSet::with_size(function.value_count());
    for origin in origins {
        replaced.insert(origin.index());
    }
    let mut went_back = false;
    for &block in cfg.order() {
        for value in function.instructions(block) {
            let mut operands = function.operands(value).iter();
            if operands.any(|operand| replaced.contains(operand.index()))
                && !is_held(function.effects(value))
                && function.op(value).access().is_none()
            {
                replaced.insert(value.index());
            }
        }
        for edge in function.successors(block) {
            let params = function.params(function.target(edge));
            for (param, arg) in params.iter().zip(function.args(edge)) {
                if replaced.contains(arg.index()) && replaced.insert(param.index()) {
                    went_back |= cfg.is_backward(function, edge);
                }
            }
        }
    }
    for load in trusting {
        let address = trusted_address(function, load);
        if went_back || address.is_some_and(|address| replaced.contains(address.index())) {
            withdraw_promise(function, load);
        }
    }
}
