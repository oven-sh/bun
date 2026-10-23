use crate::diagnostics::SourcePosition;
use crate::ir::generated::{IllTypedCause, UnprovenCause};
use crate::link::ModuleOrigin;
use crate::statistics::{LimitId, Stage};

pub(super) const LIMIT_REACHED: &str = UnprovenCause::LimitReached.name();

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum SubjectKind {
    Value,
    AllocationSite,
    Object,
    Function,
    Build,
}

impl SubjectKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            SubjectKind::Value => "value",
            SubjectKind::AllocationSite => "allocationSite",
            SubjectKind::Object => "object",
            SubjectKind::Function => "function",
            SubjectKind::Build => "build",
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct ReportedLoss {
    pub stage: Stage,
    // An enumerator's name as the schema spells it. `format::code_of` gives the printed form.
    pub reason: &'static str,
    pub ill_typed_cause: IllTypedCause,
    pub limit: LimitId,
    pub subject_kind: SubjectKind,
    pub subject: Option<SourcePosition>,
    pub witness: Option<SourcePosition>,
    pub count: u64,
}

#[derive(Default)]
pub(super) struct LossList {
    pub losses: Vec<ReportedLoss>,
    // Parallel to `EngineResult::accesses`.
    pub loss_of_access: Vec<Option<u32>>,
    // Parallel to `EngineResult::allocation_remarks`.
    pub loss_of_allocation: Vec<Option<u32>>,
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub(super) struct OriginCounts {
    pub program: u64,
    pub dependencies: u64,
}

impl OriginCounts {
    pub(super) fn add_for_origin(&mut self, origin: ModuleOrigin, count: u64) {
        match origin {
            ModuleOrigin::Program => self.program += count,
            ModuleOrigin::Dependency => self.dependencies += count,
            ModuleOrigin::Runtime => {}
        }
    }

    pub(super) fn total(self) -> u64 {
        self.program + self.dependencies
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_modules_are_not_counted() {
        let mut counts = OriginCounts::default();
        counts.add_for_origin(ModuleOrigin::Program, 2);
        counts.add_for_origin(ModuleOrigin::Dependency, 3);
        counts.add_for_origin(ModuleOrigin::Runtime, 5);
        assert_eq!(
            (counts.program, counts.dependencies, counts.total()),
            (2, 3, 5)
        );
    }

    #[test]
    fn subject_kinds_have_distinct_names() {
        let names = [
            SubjectKind::Value,
            SubjectKind::AllocationSite,
            SubjectKind::Object,
            SubjectKind::Function,
            SubjectKind::Build,
        ]
        .map(SubjectKind::name);
        for (index, name) in names.iter().enumerate() {
            assert!(!names[..index].contains(name));
        }
    }
}
