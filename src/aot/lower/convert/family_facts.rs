use rustc_hash::FxHashSet;

use crate::ir::{LayoutId, TypeId};

#[derive(Default)]
pub(crate) struct FamilyFacts {
    pub(crate) layouts_with_members_without_layout: Vec<LayoutId>,
    pub(crate) conversions: Vec<(TypeId, TypeId)>,
    seen_conversions: FxHashSet<(TypeId, TypeId)>,
}

impl FamilyFacts {
    pub(crate) fn record_conversion(&mut self, source: TypeId, target: TypeId) {
        if source != target && self.seen_conversions.insert((source, target)) {
            self.conversions.push((source, target));
        }
    }

    pub(crate) fn add_member_without_layout(&mut self, layout: LayoutId) {
        self.layouts_with_members_without_layout.push(layout);
    }

    pub(crate) fn finish(mut self) -> FamilyFacts {
        self.layouts_with_members_without_layout.sort_unstable();
        self.layouts_with_members_without_layout.dedup();
        self.seen_conversions = FxHashSet::default();
        self
    }
}
