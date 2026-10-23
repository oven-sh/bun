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
}
