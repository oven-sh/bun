use core::ops::{Add, AddAssign};

use crate::link::ModuleOrigin;

#[derive(Copy, Clone, Default, PartialEq, Debug)]
pub(super) struct OriginCounts<T = u64> {
    pub program: T,
    pub dependencies: T,
}

impl<T: PartialEq> Eq for OriginCounts<T> {}

impl<T: Copy + Add<Output = T> + AddAssign> OriginCounts<T> {
    pub(super) fn add_for_origin(&mut self, origin: ModuleOrigin, count: T) {
        match origin {
            ModuleOrigin::Program => self.program += count,
            ModuleOrigin::Dependency => self.dependencies += count,
            ModuleOrigin::Runtime => {}
        }
    }

    pub(super) fn total(self) -> T {
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
