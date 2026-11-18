//! What baseline code has counted, for the optimizing compiler.

use core::cmp::Reverse;
use core::ptr;
use core::sync::atomic::Ordering;

use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::CallProfile;
use bun_engine_wasm_compiler::optimize::{CallFeedback, Feedback, InliningBudget};
use bun_engine_wasm_format::CodeIndex;
use smallvec::SmallVec;

use super::CodeGroup;
use super::tiering::entry_increment;
use crate::instance::Instance;
use crate::module::Module;

/// The first functions that a call reached, if it reached several.
#[repr(C)]
pub(crate) struct Callees([CallProfile; Self::COUNT]);

impl Callees {
    pub(crate) const COUNT: usize = 4;
    /// Added to the address in [`CallProfile::slot`].
    pub(crate) const TAG: usize = 1;
}

/// # Safety
/// For the stub. The profile is that of a call in a function of the instance.
#[native_abi]
pub(crate) unsafe fn note_second_callee(instance: &Instance, profile: &CallProfile) {
    let mut all = instance.code().callees.lock();
    let first = profile.slot.load(Ordering::Relaxed);
    if first & Callees::TAG != 0 {
        return;
    }
    let calls_before = profile.count.load(Ordering::Relaxed).saturating_sub(1);
    let callees = Box::new(Callees(core::array::from_fn(|index| CallProfile {
        slot: if index == 0 { first } else { 0 }.into(),
        count: if index == 0 { calls_before } else { 0 }.into(),
    })));
    let address = ptr::from_ref(&*callees).expose_provenance();
    all.push(callees);
    profile
        .slot
        .store(address + Callees::TAG, Ordering::Release);
}

pub(super) struct Observed<'a> {
    pub(super) module: &'a Module,
    pub(super) group: &'a CodeGroup,
}

impl Feedback for Observed<'_> {
    fn entry_count(&self, code: CodeIndex) -> u32 {
        self.group.existing_function(code).map_or(0, |function| {
            let state = function.state.lock();
            let counted = state.heat.counted_at_entry(self.group.slot(code));
            counted / entry_increment(self.module, code) as u32
        })
    }

    fn loop_turns(&self, code: CodeIndex, index: u32) -> u32 {
        let function = self.group.existing_function(code);
        function.map_or(0, |it| it.state.lock().heat.turns(it, index))
    }

    fn call(&self, code: CodeIndex, site: u32) -> CallFeedback {
        let function = self.group.existing_function(code);
        let profile = function.and_then(|function| function.call_profiles.get(site as usize));
        let Some(profile) = profile else {
            return CallFeedback::default();
        };
        let count = profile.count.load(Ordering::Relaxed);
        let slot = profile.slot.load(Ordering::Acquire);
        let target = |slot, count| Some((self.group.code_with_slot(slot)?, count));
        if slot & Callees::TAG == 0 {
            let targets = target(slot, count).into_iter().collect();
            return CallFeedback { count, targets };
        }
        // SAFETY: from `note_second_callee`, and the group keeps it.
        let Callees(callees) = unsafe { &*ptr::with_exposed_provenance(slot - Callees::TAG) };
        let mut targets: SmallVec<_> = (callees.iter())
            .filter_map(|it| {
                let slot = it.slot.load(Ordering::Relaxed);
                target(slot, it.count.load(Ordering::Relaxed))
            })
            .collect();
        targets.sort_unstable_by_key(|&(_, count)| Reverse(count));
        CallFeedback { count, targets }
    }

    fn inlining_budget(&self) -> InliningBudget {
        let budget = &self.group.inlining_budget;
        *budget.get_or_init(|| InliningBudget::new(self.module))
    }
}
