use crate::link::ModuleOrigin;

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
