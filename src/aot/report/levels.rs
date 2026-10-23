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

    pub fn add(&mut self, level: KnowledgeLevel, amount: u64) {
        self.counts[rank_of(level)] += amount;
    }

    pub fn add_counts(&mut self, other: &LevelCounts) {
        for level in KnowledgeLevel::ALL {
            self.add(level, other.get(level));
        }
    }

    pub fn total(&self) -> u64 {
        self.counts.iter().sum()
    }

    pub fn typed(&self) -> u64 {
        self.get(KnowledgeLevel::Proven)
    }

    pub fn untyped(&self) -> u64 {
        self.get(KnowledgeLevel::Expected) + self.get(KnowledgeLevel::Unknown)
    }
}

/// The columns of the line that ends a build.
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

/// What the code of each property access does where it stands.
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
