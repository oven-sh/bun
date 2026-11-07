use rustc_hash::FxHashSet;

use crate::ir::{LayoutId, TypeId};
use crate::lower::CheckerTypeId;

#[derive(Default, Clone)]
pub(crate) struct FamilyFacts {
    pub(crate) layouts_with_members_without_layout: Vec<LayoutId>,
    pub(crate) conversions: Vec<(TypeId, TypeId)>,
    seen_conversions: FxHashSet<(TypeId, TypeId)>,
    seen_member_flows: FxHashSet<(CheckerTypeId, CheckerTypeId)>,
}

impl FamilyFacts {
    pub(crate) fn record_conversion(&mut self, source: TypeId, target: TypeId) {
        if source != target && self.seen_conversions.insert((source, target)) {
            self.conversions.push((source, target));
        }
    }

    pub(crate) fn begins_member_flow(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
    ) -> bool {
        self.seen_member_flows.insert((source, target))
    }

    #[cfg(test)]
    pub(crate) fn add_member_without_layout(&mut self, layout: LayoutId) {
        self.layouts_with_members_without_layout.push(layout);
    }

    pub(crate) fn finish(mut self) -> FamilyFacts {
        self.layouts_with_members_without_layout.sort_unstable();
        self.layouts_with_members_without_layout.dedup();
        self.seen_conversions = FxHashSet::default();
        self.seen_member_flows = FxHashSet::default();
        self
    }
}
