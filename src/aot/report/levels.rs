use super::ReportInput;
use crate::engine::AccessCountRecord;
use crate::ir::generated::{AccessCost, KnowledgeLevel};
use crate::ir::ids::ModuleId;
use crate::link::ModuleOrigin;

pub(super) const ASCENDING_LEVELS: [KnowledgeLevel; KnowledgeLevel::COUNT] = [
    KnowledgeLevel::Unknown,
    KnowledgeLevel::Expected,
    KnowledgeLevel::Proven,
];

// The engine's `rankOf`: where the words of a record hold the count of a level.
const fn rank_of(level: KnowledgeLevel) -> usize {
    match level {
        KnowledgeLevel::Unknown => 0,
        KnowledgeLevel::Expected => 1,
        KnowledgeLevel::Proven => 2,
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct LevelCounts {
    counts: [u64; KnowledgeLevel::COUNT],
}

impl LevelCounts {
    pub(super) fn from_words(words: [u32; KnowledgeLevel::COUNT]) -> LevelCounts {
        LevelCounts {
            counts: words.map(u64::from),
        }
    }

    pub fn get(&self, level: KnowledgeLevel) -> u64 {
        self.counts[rank_of(level)]
    }

    pub fn add_counts(&mut self, other: &LevelCounts) {
        for (count, added) in self.counts.iter_mut().zip(other.counts) {
            *count += added;
        }
    }

    pub fn typed(&self) -> u64 {
        self.get(KnowledgeLevel::Proven)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AccessColumn {
    Free,
    Tested,
    ByName,
}

impl AccessColumn {
    pub const ALL: [AccessColumn; 3] = [
        AccessColumn::Free,
        AccessColumn::Tested,
        AccessColumn::ByName,
    ];

    pub fn of(cost: AccessCost) -> AccessColumn {
        match cost {
            AccessCost::Free => AccessColumn::Free,
            AccessCost::TestsReceiver | AccessCost::TestsSlot => AccessColumn::Tested,
            AccessCost::ByName => AccessColumn::ByName,
        }
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct CostCounts {
    counts: [u64; AccessCost::COUNT],
}

impl CostCounts {
    pub(super) fn from_words(words: [u32; AccessCost::COUNT]) -> CostCounts {
        CostCounts {
            counts: words.map(u64::from),
        }
    }

    // The engine's `rankOf` is the number of the enumerator.
    pub fn get(&self, cost: AccessCost) -> u64 {
        self.counts[cost as usize]
    }

    pub fn add_counts(&mut self, other: &CostCounts) {
        for (count, added) in self.counts.iter_mut().zip(other.counts) {
            *count += added;
        }
    }

    pub fn in_column(&self, column: AccessColumn) -> u64 {
        let costs = AccessCost::ALL.into_iter();
        costs
            .filter(|&cost| AccessColumn::of(cost) == column)
            .map(|cost| self.get(cost))
            .sum()
    }

    pub fn total(&self) -> u64 {
        self.counts.iter().sum()
    }

    pub fn free(&self) -> u64 {
        self.get(AccessCost::Free)
    }

    pub fn not_free(&self) -> u64 {
        self.total() - self.free()
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct SiteTotals {
    pub accesses: LevelCounts,
    pub access_costs: CostCounts,
    pub calls: LevelCounts,
    pub type_tests: u64,
}

impl SiteTotals {
    pub fn add_record(&mut self, record: &AccessCountRecord) {
        self.add_totals(&SiteTotals {
            accesses: LevelCounts::from_words(record.accesses),
            access_costs: CostCounts::from_words(record.access_costs),
            calls: LevelCounts::from_words(record.calls),
            type_tests: u64::from(record.type_tests),
        });
    }

    pub fn add_totals(&mut self, other: &SiteTotals) {
        self.accesses.add_counts(&other.accesses);
        self.access_costs.add_counts(&other.access_costs);
        self.calls.add_counts(&other.calls);
        self.type_tests += other.type_tests;
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct ProgramTotals {
    pub program: SiteTotals,
    pub dependencies: SiteTotals,
}

impl ProgramTotals {
    pub fn combined(&self) -> SiteTotals {
        let mut all = self.program;
        all.add_totals(&self.dependencies);
        all
    }
}

pub(super) fn totals_of(
    records: &[AccessCountRecord],
    origin_of: impl Fn(ModuleId) -> ModuleOrigin,
) -> ProgramTotals {
    let mut totals = ProgramTotals::default();
    for record in records {
        match origin_of(record.module_id()) {
            ModuleOrigin::Program => totals.program.add_record(record),
            ModuleOrigin::Dependency => totals.dependencies.add_record(record),
            ModuleOrigin::Runtime => {}
        }
    }
    totals
}

pub fn compute_totals(input: &ReportInput<'_>) -> ProgramTotals {
    totals_of(input.engine.access_counts(), |module| {
        input.names.module_origin(module)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::ids::Id;

    impl LevelCounts {
        pub fn add(&mut self, level: KnowledgeLevel, amount: u64) {
            self.counts[rank_of(level)] += amount;
        }

        pub fn total(&self) -> u64 {
            self.counts.iter().sum()
        }

        pub fn untyped(&self) -> u64 {
            self.get(KnowledgeLevel::Expected) + self.get(KnowledgeLevel::Unknown)
        }
    }

    const ORIGINS: [ModuleOrigin; 3] = [
        ModuleOrigin::Program,
        ModuleOrigin::Dependency,
        ModuleOrigin::Runtime,
    ];

    fn record(module: u32, accesses: [u32; 3], calls: [u32; 3]) -> AccessCountRecord {
        AccessCountRecord {
            module,
            accesses,
            calls,
            type_tests: 1,
            access_costs: [accesses[0], 0, accesses[1], accesses[2]],
        }
    }

    fn totals(records: &[AccessCountRecord]) -> ProgramTotals {
        totals_of(records, |module| ORIGINS[module.index()])
    }

    #[test]
    fn words_are_indexed_by_level() {
        let program = totals(&[record(0, [1, 2, 4], [0; 3])]).program;
        assert_eq!(program.accesses.get(KnowledgeLevel::Unknown), 1);
        assert_eq!(program.accesses.get(KnowledgeLevel::Expected), 2);
        assert_eq!(program.accesses.get(KnowledgeLevel::Proven), 4);
        assert_eq!(program.accesses.total(), 7);
        assert_eq!(program.accesses.typed(), 4);
        assert_eq!(program.accesses.untyped(), 3);
    }

    #[test]
    fn cost_words_are_indexed_by_cost() {
        let costs = CostCounts::from_words([1, 2, 4, 8]);
        assert_eq!(costs.get(AccessCost::ByName), 1);
        assert_eq!(costs.get(AccessCost::TestsReceiver), 2);
        assert_eq!(costs.get(AccessCost::TestsSlot), 4);
        assert_eq!(costs.get(AccessCost::Free), 8);
        assert_eq!((costs.free(), costs.not_free(), costs.total()), (8, 7, 15));
    }

    #[test]
    fn columns_hold_every_cost_once() {
        let costs = CostCounts::from_words([1, 2, 4, 8]);
        assert_eq!(
            AccessColumn::ALL.map(|column| costs.in_column(column)),
            [8, 6, 1]
        );
    }

    #[test]
    fn ascending_levels_list_every_level_by_rank() {
        for (rank, level) in ASCENDING_LEVELS.into_iter().enumerate() {
            assert_eq!(rank_of(level), rank, "{level:?}");
        }
        for level in KnowledgeLevel::ALL {
            assert!(ASCENDING_LEVELS.contains(&level), "{level:?}");
        }
    }

    #[test]
    fn only_proven_accesses_are_typed() {
        for level in KnowledgeLevel::ALL {
            let mut counts = LevelCounts::default();
            counts.add(level, 1);
            let is_typed = level == KnowledgeLevel::Proven;
            assert_eq!(counts.typed(), u64::from(is_typed), "{level:?}");
            assert_eq!(counts.untyped(), u64::from(!is_typed), "{level:?}");
        }
    }

    #[test]
    fn module_counts_by_origin() {
        let records = [
            record(0, [1, 0, 0], [0, 0, 2]),
            record(1, [0, 0, 5], [0; 3]),
            record(2, [9, 9, 9], [9; 3]),
            record(0, [0, 0, 1], [0; 3]),
        ];
        let totals = totals(&records);
        assert_eq!(totals.program.accesses.total(), 2);
        assert_eq!(totals.program.access_costs.total(), 2);
        assert_eq!(totals.combined().access_costs.free(), 6);
        assert_eq!(totals.program.calls.total(), 2);
        assert_eq!(totals.program.type_tests, 2);
        assert_eq!(totals.dependencies.accesses.total(), 5);
        assert_eq!(totals.combined().accesses.total(), 7);
        assert_eq!(totals.combined().type_tests, 3);
    }

    #[test]
    fn no_record_counts_nothing() {
        assert_eq!(totals(&[]), ProgramTotals::default());
    }
}
