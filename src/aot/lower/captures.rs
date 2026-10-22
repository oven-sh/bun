mod needs;
#[cfg(test)]
mod tests;
mod values;

use bun_sema::bind::ScopeId;
use smallvec::SmallVec;

use super::scope::{BindingRef, Initialization, WalkedFunction, WalkedFunctionId};
use super::{FileLowering, FunctionLowering};
use crate::ir::generated::LimitId;
use crate::ir::{DeclaredType, FunctionKey, ValueId};

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

pub(in crate::lower) fn is_initialized_before(
    functions: &[WalkedFunction],
    binding: &CapturedBinding,
    function: WalkedFunctionId,
    time: u32,
) -> bool {
    needs::is_initialized_before(functions, binding, function, time)
}

/// At the entry of every function.
pub(crate) fn unpack_captures(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    values::unpack_captures(lowering);
}

pub(crate) fn bind_captures(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    values::bind_captures(lowering);
}

pub(in crate::lower) fn capture_positions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
) -> Vec<DeclaredType> {
    values::capture_positions(file, key)
}

pub(in crate::lower) fn collect_capture_values(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: FunctionKey,
    home: Option<ValueId>,
) -> SmallVec<[ValueId; 4]> {
    values::collect_capture_values(lowering, key, home)
}

pub(in crate::lower) fn captures_home_object(
    file: &FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
) -> bool {
    values::captures_home_object(file, key)
}

pub(in crate::lower) fn find_captured_value(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    capture: Capture,
) -> Option<ValueId> {
    values::find_captured_value(lowering, capture)
}
