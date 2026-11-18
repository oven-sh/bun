//! The operations of a memoizing program.

use bun_engine_text::CodeUnit;

use super::Machine;
use super::memo::{Circumstances, Memo, State, Word};
use super::subject::Subject;
use crate::program::{
    Class, Counter, Direction, Op, Program, Progress, Readable, Reads, Site, SiteId, Target,
    UNBOUNDED, UNSET,
};

const WORK_OF_VISIT: i64 = 40;
const WORK_PER_NUMBER: i64 = 12;
const WORK_PER_UNIT: i64 = 3;

/// A longer capture is known by where it is.
const UNITS_HASHED: usize = 64;

/// What has come of the last visit.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Fate {
    Unknown,
    Failure,
    Success,
}

#[derive(Clone, Copy)]
struct States {
    ignoring_captures: Option<State>,
    exact: Option<State>,
}

impl States {
    #[inline(always)]
    fn words(self, memo: &mut Memo, site: &Site, position: usize) -> [Option<Word>; 2] {
        let first = (self.ignoring_captures).map(|it| memo.word(it, site, position));
        [first, self.exact.map(|it| memo.word(it, site, position))]
    }

    #[inline(always)]
    fn put_on_trial(self, memo: &mut Memo, site: &Site, first: usize, last: usize) {
        if let Some(state) = self.ignoring_captures {
            memo.put_on_trial(state, site, first, last);
        }
        if let Some(state) = self.exact.filter(|_| site.depth != 0) {
            memo.put_on_trial(state, site, first, last);
        }
    }

    /// One of the two has a mark at the position.
    fn fate(self, memo: &mut Memo, site: &Site, is_first: bool, position: usize) -> Fate {
        if !is_first && !matches!(site.reads, Reads::Nothing) {
            memo.note_read();
        }
        let state = match is_first {
            true => self.ignoring_captures,
            false => self.exact,
        };
        match state.is_some_and(|it| site.look.is_some() && memo.has_succeeded(it, position)) {
            true => Fate::Success,
            false => Fate::Failure,
        }
    }
}

#[inline(always)]
fn read(memo: &mut Memo, [first, second]: [Option<Word>; 2]) -> [u64; 2] {
    let first = first.map_or(0, |it| *memo.bits(it));
    [first, second.map_or(0, |it| *memo.bits(it))]
}

#[inline(always)]
fn mark(memo: &mut Memo, [first, second]: [Option<Word>; 2], bits: u64) {
    if let Some(word) = first {
        *memo.bits(word) |= bits;
    }
    if let Some(word) = second {
        *memo.bits(word) |= bits;
    }
}

impl Machine<'_> {
    /// Where to go on, if not with the next operation.
    #[inline]
    pub(super) fn after_visit(
        &mut self,
        program: &Program,
        site: SiteId,
        fate: Fate,
        seen: Target,
    ) -> Option<usize> {
        match fate {
            Fate::Unknown => None,
            Fate::Failure => Some(seen.index()),
            Fate::Success => {
                let (mark, found) = program.sites.look(&program.sites.sites[site.index()])?;
                self.top = self.cells[mark.cell as usize] as usize;
                Some(found.index())
            }
        }
    }

    fn count<U: CodeUnit>(
        &self,
        counter: &Counter,
        subject: Subject<'_, U>,
        direction: Direction,
        position: usize,
    ) -> u32 {
        let (max, enough) = (u64::from(counter.max), u64::from(counter.enough));
        let (count, enough, is_out_of_reach) = match counter.progress {
            Progress::Turns(slot) => {
                let turns = u64::from(self.cells[slot.cell as usize]);
                let room = subject.room(position, direction) as u64;
                (turns, enough, max > turns.max(enough) + room + 1)
            }
            Progress::Distance(start, length) => {
                let (start, length) = (self.at(start), u64::from(length));
                let room = subject.room(start, direction) as u64;
                let distance = start.abs_diff(position) as u64;
                (distance, enough * length, max * length > room)
            }
        };
        match counter.max == UNBOUNDED || is_out_of_reach {
            true => count.min(enough) as u32,
            false => count as u32,
        }
    }

    /// Two numbers that are the same only for the same text. Nothing if the memo has been emptied.
    fn identify<U: CodeUnit>(&mut self, subject: Subject<'_, U>, pair: u16) -> Option<[u32; 2]> {
        const IS_TEXT: u32 = 1 << 31;
        let [start, end] = [0, 1].map(|side| self.captures[usize::from(pair) * 2 + side]);
        let Some(text) = subject.slice(start as usize..end as usize) else {
            return Some([UNSET; 2]);
        };
        let length = end - start;
        if size_of_val(text) <= size_of::<u32>() {
            let join = |all: u32, unit: &U| all << (8 * size_of::<U>()) | unit.to_u32();
            return Some([IS_TEXT | length, text.iter().fold(0, join)]);
        }
        if text.len() > UNITS_HASHED {
            return Some([length, start]);
        }
        let mix = |hash: u64, unit: &U| {
            (hash.rotate_left(5) ^ u64::from(unit.to_u32())).wrapping_mul(0x517c_c1b7_2722_0a95)
        };
        self.extra_work += text.len() as i64 * WORK_PER_UNIT;
        let first = (self.memo.as_mut()?).first_with(text.iter().fold(0, mix), length, start)?;
        let is_same = subject.slice(first as usize..(first + length) as usize) == Some(text);
        Some([length, if is_same { first } else { start }])
    }

    /// The number of turns around the site that have started at the position.
    fn empty_turns(&mut self, program: &Program, site: &Site, position: usize) -> u32 {
        let turns = program.sites.turns(site);
        let count = turns.take_while(|it| self.at(it.place) == position).count();
        self.extra_work += count as i64 * WORK_PER_NUMBER;
        count as u32
    }

    /// The error is what is known already.
    #[inline(always)]
    fn states<U: CodeUnit>(
        &mut self,
        program: &Program,
        subject: Subject<'_, U>,
        id: SiteId,
        position: usize,
        empty_turns: Option<u32>,
    ) -> Result<States, Fate> {
        let (site, mut list) = (&program.sites.sites[id.index()], Circumstances::default());
        self.extra_work += WORK_OF_VISIT;
        if let Some(count) = empty_turns {
            self.append(&mut list, count)?;
        }
        for counter in program.sites.counters(site) {
            let count = self.count(counter, subject, site.direction, position);
            self.append(&mut list, count)?;
        }
        let memo = self.memo.as_mut().ok_or(Fate::Unknown)?;
        let is_lasting = site.depth == 0 || memo.can_try();
        let mut states = States {
            ignoring_captures: None,
            exact: None,
        };
        if !matches!(site.reads, Reads::Nothing) && memo.can_try() && memo.trusts(id) {
            let state = State::new(id, true, &list);
            states.ignoring_captures = Some(state);
            if memo.make_room() {
                let word = memo.word(state, site, position);
                if *memo.bits(word) >> (position % 64) & 1 != 0 {
                    return Err(states.fate(memo, site, true, position));
                }
            }
        }
        let readable = match site.reads {
            Reads::Nothing => &[],
            Reads::These { first, end } => &program.sites.readable[first as usize..end as usize],
            Reads::TooMany => return Ok(states),
        };
        for &readable in readable {
            match readable {
                Readable::Entry(entry) => self.append(&mut list, self.captures[entry as usize])?,
                Readable::Pair(pair) => {
                    let [first, second] = self.identify(subject, pair).ok_or(Fate::Unknown)?;
                    self.append(&mut list, first)?;
                    self.append(&mut list, second)?;
                }
            }
        }
        states.exact = is_lasting.then(|| State::new(id, false, &list));
        Ok(states)
    }

    #[inline(always)]
    fn append(&mut self, list: &mut Circumstances, number: u32) -> Result<(), Fate> {
        self.extra_work += WORK_PER_NUMBER;
        let appended = self.memo.as_mut().and_then(|it| it.append(list, number));
        appended.ok_or(Fate::Unknown)
    }

    #[inline(never)]
    pub(super) fn visit<U: CodeUnit>(
        &mut self,
        program: &Program,
        subject: Subject<'_, U>,
        id: SiteId,
        position: usize,
    ) -> Fate {
        let site = &program.sites.sites[id.index()];
        let has_turns = program.sites.turns(site).next().is_some();
        let empty_turns = has_turns.then(|| self.empty_turns(program, site, position));
        let states = match self.states(program, subject, id, position, empty_turns) {
            Ok(states) => states,
            Err(fate) => return fate,
        };
        let Some(memo) = self.memo.as_mut() else {
            return Fate::Unknown;
        };
        if !memo.make_room() {
            return Fate::Unknown;
        }
        let (words, bit) = (states.words(memo, site, position), 1 << (position % 64));
        let [first, second] = read(memo, words);
        if (first | second) & bit != 0 {
            return states.fate(memo, site, first & bit != 0, position);
        }
        mark(memo, words, bit);
        states.put_on_trial(memo, site, position, position);
        Fate::Unknown
    }

    /// Stops where the search has been before.
    #[inline(never)]
    pub(super) fn visit_run<U: CodeUnit>(
        &mut self,
        program: &Program,
        subject: Subject<'_, U>,
        op: &Op,
        position: &mut usize,
    ) -> Fate {
        let Op::VisitRun {
            direction,
            code_points,
            class,
            max,
            reserve,
            site: id,
            ..
        } = *op
        else {
            unreachable!("the operation is a run")
        };
        let run = Run {
            subject,
            direction,
            code_points,
            class: program.class(class),
            reserve,
        };
        let (site, start) = (&program.sites.sites[id.index()], *position);
        let is_peculiar = self.empty_turns(program, site, start) != 0
            || (self.memo.as_ref()).is_some_and(|it| it.is_end_of_match(site, start));
        let states = if (max as usize) < subject.room(start, direction) {
            Err(Fate::Unknown)
        } else {
            *position = run.pass(start, is_peculiar.into());
            if is_peculiar && *position == start {
                return Fate::Unknown;
            }
            self.states(program, subject, id, *position, None)
        };
        let fate = match (states, &mut self.memo) {
            (Ok(states), Some(memo)) => run.visit(memo, states, site, position),
            (Err(fate @ (Fate::Failure | Fate::Success)), _) => fate,
            _ => {
                *position = run.pass(*position, max);
                Fate::Unknown
            }
        };
        self.extra_work += start.abs_diff(*position) as i64 * WORK_PER_UNIT;
        fate
    }
}

struct Run<'a, U> {
    subject: Subject<'a, U>,
    direction: Direction,
    code_points: bool,
    class: &'a Class,
    reserve: u32,
}

impl<U: CodeUnit> Run<'_, U> {
    fn pass(&self, position: usize, max: u32) -> usize {
        let (direction, class, reserve) = (self.direction, self.class, self.reserve);
        match self.code_points {
            true => (self.subject).run_code_points(position, direction, class, max, reserve),
            false => self.subject.run(position, direction, class, max, reserve),
        }
    }

    /// The number of positions from this one on that are in its word and have no mark.
    fn unmarked(&self, marks: u64, position: usize) -> u32 {
        let bit = (position % 64) as u32;
        match self.direction {
            _ if self.code_points => 1,
            Direction::Forward => (marks >> bit).trailing_zeros().min(64 - bit),
            Direction::Backward => (marks << (63 - bit)).leading_zeros().min(bit + 1),
        }
    }

    fn visit(&self, memo: &mut Memo, states: States, site: &Site, position: &mut usize) -> Fate {
        let (start, mut last_marked) = (*position, None);
        let found = loop {
            let here = *position;
            if !memo.make_room() {
                *position = self.pass(here, UNBOUNDED);
                break None;
            }
            let (words, bit) = (states.words(memo, site, here), 1 << (here % 64));
            let [first, second] = read(memo, words);
            if (first | second) & bit != 0 {
                break Some(first & bit != 0);
            }
            let unmarked = self.unmarked(first | second, here) as usize;
            *position = self.pass(here, unmarked as u32);
            let passed = position.abs_diff(here);
            let more = passed.min(unmarked - 1);
            let (lowest, last) = match self.direction {
                Direction::Forward => (here, here + more),
                Direction::Backward => (here - more, here - more),
            };
            mark(memo, words, u64::MAX >> (63 - more) << (lowest % 64));
            last_marked = Some(last);
            if passed < unmarked {
                break None;
            }
        };
        if let Some(last) = last_marked {
            states.put_on_trial(memo, site, start, last);
        }
        found.map_or(Fate::Unknown, |it| states.fate(memo, site, it, *position))
    }
}
