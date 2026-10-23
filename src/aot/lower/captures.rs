mod needs;
#[cfg(test)]
mod tests;
mod values;

use bun_sema::bind::ScopeId;
use smallvec::SmallVec;

pub(in crate::lower) use self::needs::is_initialized_before;
pub(crate) use self::values::bind_captures;
pub(in crate::lower) use self::values::{
    capture_positions, captures_home_object, collect_capture_values, find_captured_value,
};
use super::FunctionLowering;
use super::scope::{BindingRef, Initialization, WalkedFunction, WalkedFunctionId};
use crate::ir::generated::LimitId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(in crate::lower) enum Capture {
    Environment(ScopeId),
    Value(BindingRef),
}

pub(in crate::lower) type CaptureList = SmallVec<[Capture; 4]>;

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct CapturedBinding {
    pub(in crate::lower) binding: BindingRef,
    pub(in crate::lower) scope: ScopeId,
    pub(in crate::lower) owner: WalkedFunctionId,
    pub(in crate::lower) is_immutable: bool,
    pub(in crate::lower) initialization: Option<Initialization>,
}

pub(in crate::lower) struct CaptureInput<'x> {
    pub(in crate::lower) functions: &'x [WalkedFunction],
    pub(in crate::lower) bindings: &'x [CapturedBinding],
    pub(in crate::lower) uses: &'x [(WalkedFunctionId, BindingRef)],
    pub(in crate::lower) references: &'x [(WalkedFunctionId, WalkedFunctionId)],
    pub(in crate::lower) entry_captures: &'x [(WalkedFunctionId, BindingRef)],
    pub(in crate::lower) max_captures: usize,
}

pub(in crate::lower) struct CapturePlan {
    pub(in crate::lower) captures: Vec<CaptureList>,
    pub(in crate::lower) fields: Vec<BindingRef>,
    pub(in crate::lower) functions_over_limit: Vec<WalkedFunctionId>,
}

/// What a closure has room for.
pub(in crate::lower) fn max_captures() -> usize {
    let limit = LimitId::MaxCaptures;
    limit.value_on_arm64().min(limit.value_on_x86_64()) as usize
}

pub(in crate::lower) fn compute_captures(input: &CaptureInput<'_>) -> CapturePlan {
    needs::solve(input)
}

/// At the entry of every function.
pub(crate) fn unpack_captures(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    values::unpack_captures(lowering);
}
