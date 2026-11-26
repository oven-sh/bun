use std::io::Write;

use bun_collections::StringHashMap;
use bun_collections::smallvec::SmallVec;
use bun_sort_by_number::{SortByNumber, number_of_pair};

use crate::inline_map::InlineMap;
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

#[derive(Clone, Copy)]
pub(crate) enum Token {
    Code,
    /// It counts on a line without code.
    Minor,
    /// It also counts before code, unless a statement that did not run starts on the line.
    Closing,
}

/// `[start, end)` in bytes of the text.
#[derive(Clone, Copy)]
pub(crate) struct Counted {
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) count: u64,
}

impl Counted {
    fn range(&self) -> (u32, u32) {
        (self.start, self.end)
    }

    fn add(&mut self, other: Counted) {
        self.count = self.count.saturating_add(other.count).min(UNKNOWN - 1);
    }
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
    /// 0 if the line that it starts on is not ignored.
    pub(crate) count_of_ignored_line: u64,
    /// One that is not written is empty. A branch without arms still takes up a number.
    pub(crate) arms: Arms,
}

pub(crate) struct Report<'a> {
    pub(crate) positions: Positions<'a>,
    /// Until it is finished, the offsets are in the code that has the map.
    map: Option<&'a InlineMap>,
    /// The count, and where the code starts.
    lines: Vec<(u64, u32)>,
    /// The line, the offset and the count of what is not `Token::Code`.
    other_tokens: Vec<(u32, u32, u64)>,
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

fn raise(most: &mut u64, count: u64) {
    if *most == UNKNOWN || *most < count {
        *most = count;
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

/// Istanbul knows an entry by its range. What a tool puts around code gets the range of the code, and so does a copy.
fn move_to_file<T>(
    all: &mut Vec<T>,
    counted: fn(&mut T) -> &mut Counted,
    mut range_in_file: impl FnMut(&mut T) -> Option<(u32, u32)>,
    are_alike: fn(&T, &T) -> bool,
) {
    let mut found: Vec<_> = (all.drain(..))
        .filter_map(|mut it| Some((range_in_file(&mut it)?, *counted(&mut it), it)))
        .collect();
    found.sort_by_u32(|it| it.1.start);
    found.sort_by_u64(|it| number_of_pair(it.0.0, it.0.1));
    found.dedup_by(|inner, outer| {
        (inner.0 == outer.0 && inner.1.start < outer.1.end)
            .then(|| outer.1 = inner.1)
            .is_some()
    });
    found.dedup_by(|copy, it| {
        (copy.0 == it.0 && are_alike(&copy.2, &it.2))
            .then(|| it.1.add(copy.1))
            .is_some()
    });
    all.extend(found.into_iter().map(|((start, end), in_code, mut it)| {
        *counted(&mut it) = Counted {
            start,
            end,
            ..in_code
        };
        it
    }));
}

impl<'a> Report<'a> {
    pub(crate) fn new(positions: Positions<'a>, map: Option<&'a InlineMap>) -> Report<'a> {
        let positions = map.map_or(positions, |it| Positions::new(&it.file));
        Report {
            lines: vec![(UNKNOWN, u32::MAX); positions.line_count()],
            other_tokens: Vec::new(),
            positions,
            map,
            statements: Vec::new(),
            functions: Vec::new(),
            branches: Vec::new(),
        }
    }

    /// A line ran as often as what ran most on it.
    pub(crate) fn count_line_at(&mut self, offset: u32, count: u64, token: Token) {
        let Some(offset) = (self.map).map_or(Some(offset), |it| Some(it.token(offset)?.0)) else {
            return;
        };
        let line = self.positions.line_of(offset);
        let (most, start) = &mut self.lines[line];
        let offset = match token {
            Token::Code => {
                *start = offset.min(*start);
                return raise(most, count);
            }
            // That of a generated call can be mapped to any parenthesis.
            Token::Closing if self.map.is_none() => offset,
            _ => u32::MAX - 1,
        };
        if offset < *start {
            self.other_tokens.push((line as u32, offset, count));
        }
    }

    fn move_to_file(&mut self, map: &InlineMap) {
        let range = |it: (u32, u32)| map.range(it, it.1);
        move_to_file(
            &mut self.statements,
            |it| &mut it.1,
            |it| range(it.1.range()),
            |_, _| true,
        );
        move_to_file(
            &mut self.functions,
            |it| &mut it.body,
            |it| {
                let whole = range((it.declaration.0, it.body.end))?;
                it.declaration = range(it.declaration).unwrap_or(whole);
                range(it.body.range()).or(Some(whole))
            },
            |a, b| a.declaration == b.declaration,
        );
        self.branches.retain_mut(|it| {
            let (start, end) = it.decision;
            let later_arms = it.arms.iter().map(|it| it.start).filter(|&it| it > start);
            let test = (start, later_arms.min().unwrap_or(end));
            let Some(whole) = map
                .range(test, end)
                .filter(|_| it.order < KnownTo::Bun.order(0) || map.first_token_in(test).is_some())
            else {
                return false;
            };
            for arm in &mut it.arms {
                (arm.start, arm.end) = match arm.start == arm.end {
                    true => (whole.0, whole.0),
                    false => range(arm.range()).unwrap_or(whole),
                };
            }
            it.decision = whole;
            true
        });
        (self.branches).sort_by_u64(|it| number_of_pair(it.decision.0, !it.decision.1));
        self.branches.dedup_by(|copy, it| {
            let [of_copy, ranges] = [&*copy, it].map(|it| it.arms.iter().map(Counted::range));
            (copy.decision == it.decision && of_copy.eq(ranges))
                .then(|| (it.arms.iter_mut().zip(&copy.arms)).for_each(|it| it.0.add(*it.1)))
                .is_some()
        });
        for index in 0..self.statements.len() {
            let Counted { start, count, .. } = self.statements[index].1;
            self.count_line_at(start, count, Token::Minor);
        }
    }

    pub(crate) fn finish(&mut self) {
        if let Some(map) = self.map.take() {
            self.move_to_file(map);
        }
        for (_, it) in self.statements.iter().filter(|it| it.1.count == 0) {
            let (most, start) = &mut self.lines[self.positions.line_of(it.start)];
            if *most != UNKNOWN {
                *start = 0;
            }
        }
        for (line, offset, count) in self.other_tokens.drain(..) {
            let (most, start) = &mut self.lines[line as usize];
            if offset < *start {
                raise(most, count);
            }
        }
        // genhtml refuses a branch on a line without code, or that was taken on a line that did not run.
        for index in 0..self.branches.len() {
            let branch = &self.branches[index];
            if let Some(most) = branch.arms.iter().map(|it| it.count).max() {
                let most = most.max(branch.count_of_ignored_line);
                self.count_line_at(branch.decision.0, most, Token::Code);
            }
        }
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
            .zip(self.lines.iter().map(|it| it.0))
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
