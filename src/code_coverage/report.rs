use std::io::Write;

use bun_collections::StringHashMap;
use bun_collections::smallvec::SmallVec;
use bun_sort_by_number::SortByNumber;

use crate::positions::Positions;

/// The count of a counter that has no place in the code that ran, and of a line without code.
pub(crate) const UNKNOWN: u64 = u64::MAX;

/// Reports are merged by the numbers that Istanbul gives, so what it lacks comes last.
#[derive(Clone, Copy)]
pub(crate) enum KnownTo {
    Istanbul,
    Bun,
}

impl KnownTo {
    pub(crate) fn order(self, start: u32) -> u64 {
        (self as u64) << 32 | u64::from(start)
    }
}

/// `[start, end)` in bytes of the text.
#[derive(Clone, Copy)]
pub(crate) struct Counted {
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) count: u64,
}

pub(crate) struct Function {
    pub(crate) order: u64,
    pub(crate) name: Vec<u8>,
    pub(crate) declaration: (u32, u32),
    pub(crate) body: Counted,
}

pub(crate) type Arms = SmallVec<[Counted; 2]>;

pub(crate) struct Branch {
    pub(crate) order: u64,
    pub(crate) kind: &'static str,
    pub(crate) decision: (u32, u32),
    /// One that is not written is empty. A branch without arms still takes up a number.
    pub(crate) arms: Arms,
}

pub(crate) struct Report<'a> {
    pub(crate) positions: Positions<'a>,
    pub(crate) lines: Vec<u64>,
    pub(crate) statements: Vec<(u64, Counted)>,
    pub(crate) functions: Vec<Function>,
    pub(crate) branches: Vec<Branch>,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Total {
    pub(crate) covered: u64,
    pub(crate) total: u64,
}

impl Total {
    fn of(counts: impl Iterator<Item = u64>) -> Total {
        counts.fold(Total::default(), |all, count| Total {
            covered: all.covered + u64::from(count > 0),
            total: all.total + 1,
        })
    }

    fn add(&mut self, other: Total) {
        self.covered += other.covered;
        self.total += other.total;
    }

    /// Rounded down.
    pub(crate) fn percent(self) -> f64 {
        let hundredths = (self.covered * 10_000).checked_div(self.total);
        hundredths.unwrap_or(10_000) as f64 / 100.0
    }

    pub(crate) fn misses(self, threshold: f64) -> bool {
        match self.total {
            _ if threshold.is_nan() => true,
            total if threshold < 0.0 => (total - self.covered) as f64 > -threshold,
            0 => 1.0 < threshold,
            total => (self.covered as f64 / total as f64) < threshold,
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Summary {
    pub(crate) functions: Total,
    pub(crate) lines: Total,
    pub(crate) statements: Total,
    pub(crate) branches: Total,
}

impl Summary {
    pub(crate) fn add(&mut self, other: &Summary) {
        self.functions.add(other.functions);
        self.lines.add(other.lines);
        self.statements.add(other.statements);
        self.branches.add(other.branches);
    }
}

/// lcov knows a function by its name.
fn make_unique(name: &mut Vec<u8>, uses_of_names: &mut StringHashMap<u32>) {
    loop {
        let uses = bun_core::handle_oom(uses_of_names.get_or_put_value(name, 0));
        *uses += 1;
        if *uses == 1 {
            return;
        }
        let _ = write!(name, " ({uses})");
    }
}

impl<'a> Report<'a> {
    pub(crate) fn new(positions: Positions<'a>) -> Report<'a> {
        Report {
            lines: vec![UNKNOWN; positions.line_count()],
            positions,
            statements: Vec::new(),
            functions: Vec::new(),
            branches: Vec::new(),
        }
    }

    /// A line ran as often as what ran most on it.
    pub(crate) fn count_line_at(&mut self, offset: u32, count: u64) {
        let line = &mut self.lines[self.positions.line_of(offset)];
        if *line == UNKNOWN || *line < count {
            *line = count;
        }
    }

    pub(crate) fn finish(&mut self) {
        self.statements.sort_by_u64(|it| it.0);
        self.functions.sort_by_u64(|it| it.order);
        self.branches.sort_by_u64(|it| it.order);
        let mut uses_of_names: StringHashMap<u32> = StringHashMap::default();
        for (index, Function { name, .. }) in self.functions.iter_mut().enumerate() {
            if name.is_empty() {
                let _ = write!(name, "(anonymous_{index})");
            } else {
                make_unique(name, &mut uses_of_names);
            }
        }
    }

    /// The lines with code, from 1, and their counts.
    pub(crate) fn lines(&self) -> impl Iterator<Item = (usize, u64)> {
        (1..)
            .zip(self.lines.iter().copied())
            .filter(|it| it.1 != UNKNOWN)
    }

    /// With their numbers.
    pub(crate) fn branches(&self) -> impl Iterator<Item = (usize, &Branch)> {
        (self.branches.iter().enumerate()).filter(|it| !it.1.arms.is_empty())
    }

    /// From 1.
    pub(crate) fn line_of(&self, offset: u32) -> usize {
        self.positions.line_of(offset) + 1
    }

    pub(crate) fn summary(&self) -> Summary {
        let arms = self.branches.iter().flat_map(|it| &it.arms);
        Summary {
            functions: Total::of(self.functions.iter().map(|it| it.body.count)),
            lines: Total::of(self.lines().map(|it| it.1)),
            statements: Total::of(self.statements.iter().map(|it| it.1.count)),
            branches: Total::of(arms.map(|it| it.count)),
        }
    }
}
