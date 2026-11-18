//! Runs a program one operation at a time.

mod memo;
mod subject;
mod table;
mod visit;

use bun_engine_text::{CodeUnit, Text, with_text};

use crate::context::{Context, Memory, Outcome, Words};
use crate::meter::{FUEL, Report};
use crate::program::{Direction, Loop, Op, Place, Program, UNSET, Width, join_halves};
pub(crate) use memo::Memo;
use subject::Subject;

const WORK_PER_OP: i64 = 9;
const WORK_PER_UNIT: i64 = 2;

pub(crate) fn end_address(subject: Text<'_>) -> usize {
    with_text!(subject, |units| units.as_ptr_range().end.addr())
}

/// Where a search goes on.
pub(crate) struct Pause {
    next: usize,
    position: usize,
    top: usize,
    /// The position before it has last gone back.
    reached: usize,
    attempt: Option<usize>,
    /// Since the pause before.
    work: u64,
    turns: u64,
}

impl Pause {
    #[inline]
    pub(crate) fn before(start: u32) -> Pause {
        Pause {
            next: 0,
            position: start as usize,
            top: 0,
            reached: start as usize,
            attempt: None,
            work: 0,
            turns: 0,
        }
    }

    pub(crate) fn reached(&self) -> usize {
        self.reached
    }

    /// Where the present attempt has started, if that is known.
    pub(crate) fn attempt(&self) -> Option<u32> {
        self.attempt.map(|it| it as u32)
    }

    pub(crate) fn work(&self) -> u64 {
        self.work
    }

    pub(crate) fn take_turns(&mut self) -> u64 {
        core::mem::take(&mut self.turns)
    }

    pub(crate) fn report(&self, program: &Program, subject: Text<'_>) -> Report {
        let from_end = |position: usize| position as i64 - subject.len() as i64;
        Report {
            work: self.work,
            saved_work: 0,
            position: from_end(self.reached),
            attempt: self.attempt.map(from_end),
            work_per_unit: program.work_per_unit(),
        }
    }
}

impl Program {
    /// Looks for a match from `start` on. If the program reports captures, `captures` has
    /// [`capture_entries`](Program::capture_entries) elements, and a match writes them all.
    pub fn exec(
        &self,
        subject: Text<'_>,
        start: u32,
        captures: &mut [u32],
        context: &mut Context,
    ) -> Outcome {
        let Context { memory, meter } = context;
        let mut pause = Pause::before(start);
        meter.has_polled = 0;
        loop {
            let outcome = self.go_on(subject, captures, memory, None, &mut pause, FUEL);
            meter.interpreted = meter.interpreted.saturating_add(pause.work);
            let mut poll = || meter.poll(&pause.report(self, subject), end_address(subject));
            if let Some(outcome) = outcome.or_else(|| poll().err()) {
                return outcome;
            }
        }
    }

    /// Nothing if the fuel runs out first. With more memory it can go on after [`Outcome::OutOfMemory`].
    #[inline]
    pub(crate) fn go_on(
        &self,
        subject: Text<'_>,
        captures: &mut [u32],
        memory: &mut Memory,
        memo: Option<&mut Memo>,
        pause: &mut Pause,
        fuel: u32,
    ) -> Option<Outcome> {
        assert!(subject.is_latin1() == (self.width == Width::Latin1));
        if pause.position > subject.len() {
            return Some(Outcome::NoMatch);
        }
        let own_entries = match self.reports_captures {
            true => 0,
            false => self.capture_entries(),
        };
        let words = self.cell_count() + own_entries;
        if memory.cells.ensure(words, usize::MAX).is_none() {
            return Some(Outcome::OutOfMemory);
        }
        let (cells, own_captures) =
            memory.cells.as_mut_slice()[..words].split_at_mut(self.cell_count());
        let machine = Machine {
            cells,
            captures: match self.reports_captures {
                true => &mut captures[..self.capture_entries()],
                false => own_captures,
            },
            stack: &mut memory.stack,
            max_stack_words: memory.max_stack_words,
            top: pause.top,
            memo,
            extra_work: 0,
        };
        match subject {
            Text::Latin1(units) => machine.run(self, Subject::new(units), pause, fuel),
            Text::Utf16(units) => machine.run(self, Subject::new(units), pause, fuel),
        }
    }

    /// The present attempt has not started after this position.
    pub(crate) fn latest_attempt(&self, pause: &Pause, memory: &mut Memory) -> usize {
        let saved = memory.cells.as_mut_slice().get(self.attempt.cell as usize);
        let saved = saved.map_or(0, |&it| it as usize);
        pause.attempt.unwrap_or_else(|| saved.max(pause.position))
    }
}

struct Machine<'a> {
    cells: &'a mut [u32],
    captures: &'a mut [u32],
    stack: &'a mut Words,
    max_stack_words: usize,
    top: usize,
    memo: Option<&'a mut Memo>,
    /// What the functions that the loop calls have done.
    extra_work: i64,
}

#[inline(always)]
fn plus(position: usize, offset: impl Into<i32>) -> usize {
    position.wrapping_add_signed(offset.into() as isize)
}

impl Machine<'_> {
    #[inline(always)]
    fn at(&self, place: Place) -> usize {
        plus(self.cells[place.slot.cell as usize] as usize, place.delta)
    }

    fn run<U: CodeUnit>(
        mut self,
        program: &Program,
        subject: Subject<'_, U>,
        pause: &mut Pause,
        given: u32,
    ) -> Option<Outcome> {
        let ops = program.ops();
        let (mut next, mut position, mut fuel) = (pause.next, pause.position, i64::from(given));

        macro_rules! check {
            ($holds:expr, $fail:expr) => {
                if !$holds {
                    next = $fail.index();
                }
            };
        }
        macro_rules! pause_if_spent {
            () => {
                if fuel < 0 {
                    (pause.reached, pause.attempt) = (position, None);
                    break None;
                }
            };
        }
        macro_rules! go_back_to {
            ($position:expr, $knows_attempt:expr) => {{
                let (left, back) = (position, $position);
                position = back;
                if let Some(memo) = &mut self.memo {
                    memo.go_back_to(position);
                }
                if $knows_attempt && fuel < 0 {
                    let attempt = self.cells[program.attempt.cell as usize];
                    (pause.reached, pause.attempt) = (left, Some(attempt as usize));
                    break None;
                }
            }};
        }
        macro_rules! pass {
            ($position:expr) => {{
                let left = position;
                position = $position;
                fuel -= left.abs_diff(position) as i64 * WORK_PER_UNIT;
            }};
        }

        let outcome = loop {
            let op = &ops[next];
            next += 1;
            fuel -= WORK_PER_OP;
            match *op {
                Op::Jump { to } => next = to.index(),
                Op::Again { to } | Op::Turned { to, .. } => {
                    next = to.index();
                    pause_if_spent!();
                }
                Op::NoMatch => break Some(Outcome::NoMatch),
                Op::Match { start, end } => {
                    break Some(Outcome::Match {
                        start: self.at(start) as u32,
                        end: plus(position, end) as u32,
                    });
                }
                Op::MatchHere { start, end } => {
                    break Some(Outcome::Match {
                        start: plus(position, start) as u32,
                        end: plus(position, end) as u32,
                    });
                }
                Op::Need {
                    direction,
                    count,
                    fail,
                } => check!(subject.room(position, direction) >= count as usize, fail),
                Op::AtEdge {
                    direction,
                    offset,
                    fail,
                } => check!(subject.room(plus(position, offset), direction) == 0, fail),
                Op::NotInPair { offset, fail } => {
                    check!(!subject.is_in_pair(plus(position, offset)), fail);
                }
                Op::Unit {
                    offset,
                    value,
                    mask,
                    fail,
                } => {
                    let unit = subject.unit(plus(position, offset));
                    check!(unit.is_some_and(|unit| unit | mask == value), fail);
                }
                Op::Word {
                    bytes,
                    offset,
                    value,
                    mask,
                    fail,
                } => {
                    let word = subject.word(plus(position, offset), bytes);
                    let (value, mask) = (join_halves(value), join_halves(mask));
                    check!(word.is_some_and(|word| word | mask == value), fail);
                }
                Op::Class {
                    offset,
                    class,
                    fail,
                } => check!(
                    subject.is_in(plus(position, offset), program.class(class)),
                    fail
                ),
                Op::ClassCount {
                    offset,
                    count,
                    class,
                    fail,
                } => {
                    let (from, class) = (plus(position, offset), program.class(class));
                    let end = subject.run(from, Direction::Forward, class, count.into(), 0);
                    fuel -= (end - from) as i64 * WORK_PER_UNIT;
                    check!(end - from == count as usize, fail);
                }
                Op::Pair {
                    offset,
                    class,
                    fail,
                } => {
                    let pair = subject.pair(plus(position, offset));
                    check!(pair.is_some_and(|c| program.class(class).contains(c)), fail);
                }
                Op::Switch { offset, table } => {
                    let unit = subject.unit(plus(position, offset)).unwrap_or_default();
                    next = program.switch(table).target(unit).index();
                }
                Op::Advance { by } => {
                    position = plus(position, by);
                    pause_if_spent!();
                }
                Op::LeavePair => position -= usize::from(subject.is_in_pair(position)),
                Op::SkipToTail { length } => {
                    position = position.max(subject.len().saturating_sub(length as usize));
                }
                Op::Scan { id, fail } => {
                    let mut found = position;
                    check!(subject.scan(&mut found, program.scan(id), program), fail);
                    pass!(found);
                }
                Op::WalkBack {
                    slot, class, max, ..
                } => {
                    let cell = &mut self.cells[slot.cell as usize];
                    let floor = core::mem::replace(cell, position as u32);
                    let class = program.class(class);
                    pass!(subject.run(position, Direction::Backward, class, max, floor));
                }
                Op::SaveStart { slot, fail } => match position {
                    0 => self.cells[slot.cell as usize] = 0,
                    _ => next = fail.index(),
                },
                Op::Save { slot } => self.cells[slot.cell as usize] = position as u32,
                Op::Load { from, metered } => go_back_to!(self.at(from), metered),
                Op::ComparePlace {
                    when,
                    offset,
                    place,
                    to,
                } => {
                    let here = position as i64 + i64::from(offset);
                    let slot = self.cells[place.slot.cell as usize];
                    check!(
                        !when.holds(here, i64::from(slot) + i64::from(place.delta)),
                        to
                    );
                }
                Op::Run {
                    direction,
                    code_points,
                    is_counted,
                    class,
                    max,
                    reserve,
                    ..
                } => {
                    let class = program.class(class);
                    let end = match code_points {
                        true => subject.run_code_points(position, direction, class, max, reserve),
                        false => subject.run(position, direction, class, max, reserve),
                    };
                    if is_counted {
                        pause.turns += position.abs_diff(end) as u64;
                    }
                    pass!(end);
                }
                Op::GiveBack {
                    direction,
                    stride,
                    floor,
                    filter,
                    fail,
                } => {
                    let filter = filter.class().map(|class| program.class(class));
                    let (floor, mut back) = (self.at(floor), position);
                    let found = subject.give_back(&mut back, direction, stride, floor, filter);
                    check!(found, fail);
                    pass!(back);
                    go_back_to!(position, false);
                }
                Op::CodePoint {
                    direction,
                    class,
                    reserve,
                    fail,
                } => {
                    let class = program.class(class);
                    let end = subject.run_code_points(position, direction, class, 1, reserve);
                    check!(end != position, fail);
                    position = end;
                }
                Op::BackReference {
                    direction,
                    ignore_case,
                    first,
                    count,
                    reserve,
                    fail,
                } => {
                    if let Some(memo) = &mut self.memo {
                        memo.note_read();
                    }
                    fuel -= i64::from(count);
                    let pairs = program.referenced_pairs(first, count).iter();
                    let mut starts = pairs.map(|&pair| usize::from(pair) * 2);
                    if let Some(entry) = starts.find(|&entry| self.captures[entry] != UNSET) {
                        let captured =
                            self.captures[entry] as usize..self.captures[entry + 1] as usize;
                        let mut work = 0;
                        let end = subject
                            .repeats(
                                captured,
                                position,
                                direction,
                                ignore_case,
                                program,
                                &mut work,
                            )
                            .filter(|&end| subject.room(end, direction) >= reserve as usize);
                        fuel -= work;
                        match end {
                            Some(end) => position = end,
                            None => next = fail.index(),
                        }
                    }
                }
                Op::Capture { offset, entry } => {
                    self.captures[entry as usize] = plus(position, offset) as u32;
                }
                Op::CapturePlace { place, entry } => {
                    self.captures[entry as usize] = self.at(place) as u32;
                }
                Op::Clear { pairs } => {
                    fuel -= pairs.entries().len() as i64;
                    self.captures[pairs.entries()].fill(UNSET);
                }
                Op::SaveCaptures { slot, pairs } => {
                    let entries = &self.captures[pairs.entries()];
                    fuel -= entries.len() as i64;
                    self.cells[slot.cell as usize..][..entries.len()].copy_from_slice(entries);
                }
                Op::RestoreCaptures { slot, pairs } => {
                    let entries = &mut self.captures[pairs.entries()];
                    fuel -= entries.len() as i64;
                    entries.copy_from_slice(&self.cells[slot.cell as usize..][..entries.len()]);
                }
                Op::Zero { slot } => self.cells[slot.cell as usize] = 0,
                Op::Increment { slot } => self.cells[slot.cell as usize] += 1,
                Op::RaiseTo { slot, value } => self.cells[slot.cell as usize] = value,
                Op::CompareNumber {
                    when,
                    slot,
                    value,
                    to,
                } => {
                    let number = self.cells[slot.cell as usize];
                    check!(!when.holds(number.into(), value.into()), to);
                }
                Op::Spend { .. } => pause_if_spent!(),
                Op::CountTurn => pause.turns += 1,
                Op::Choose { slot, target, .. } => self.cells[slot.cell as usize] = target.0,
                Op::Resume { slot } => next = self.cells[slot.cell as usize] as usize,
                Op::Enter { id } => {
                    self.cells[program.loops[id.index()].turns_cell() as usize] = 0;
                }
                Op::Push { id } => {
                    let it = &program.loops[id.index()];
                    if self.push(it, position).is_none() {
                        next -= 1;
                        (pause.reached, pause.attempt) = (position, None);
                        break Some(Outcome::OutOfMemory);
                    }
                    fuel -= it.frame_size() as i64;
                }
                Op::Pop { id } => {
                    let it = &program.loops[id.index()];
                    fuel -= it.frame_size() as i64;
                    go_back_to!(self.pop(it), true);
                }
                Op::Retreat { id, none } => {
                    let it = &program.loops[id.index()];
                    next = match self.cells[it.turns_cell() as usize] {
                        0 => none.index(),
                        _ => it.back_into_turn().index(),
                    };
                }
                Op::Visit { site, seen } => {
                    let fate = self.visit(program, subject, site, position);
                    next = self.after_visit(program, site, fate, seen).unwrap_or(next);
                    fuel -= self.take_extra_work();
                    pause_if_spent!();
                }
                Op::VisitRun { site, seen, .. } => {
                    let fate = self.visit_run(program, subject, op, &mut position);
                    next = self.after_visit(program, site, fate, seen).unwrap_or(next);
                    fuel -= self.take_extra_work();
                    pause_if_spent!();
                }
                Op::EnterLook { depth } => {
                    if let Some(memo) = &mut self.memo {
                        memo.enter_look(depth);
                    }
                }
                Op::LeaveLook { depth, has_found } => {
                    if let Some(memo) = &mut self.memo {
                        memo.leave_look(depth, has_found, &program.sites);
                    }
                }
                Op::DoubtVisit => go_back_to!(position, false),
                Op::Mark { slot } => self.cells[slot.cell as usize] = self.top as u32,
                Op::Cut { slot } => self.top = self.cells[slot.cell as usize] as usize,
            }
        };
        pause.work = (i64::from(given) - fuel) as u64;
        (pause.next, pause.position, pause.top) = (next, position, self.top);
        outcome
    }

    fn take_extra_work(&mut self) -> i64 {
        let of_memo = self.memo.as_mut().map_or(0, |it| it.take_work());
        core::mem::take(&mut self.extra_work) + of_memo as i64
    }

    #[inline]
    fn push(&mut self, it: &Loop, position: usize) -> Option<()> {
        let turns = &mut self.cells[it.turns_cell() as usize];
        let is_short = *turns == 0 && it.first_frame_is_short();
        let top = self.top + if is_short { 1 } else { it.frame_size() };
        self.stack.ensure(top, self.max_stack_words)?;
        *turns += 1;
        let (last, frame) = self.stack.as_mut_slice()[self.top..top].split_last_mut()?;
        *last = position as u32;
        if !is_short {
            let cells = &self.cells[it.cells().start as usize..it.cells().end as usize];
            let (of_cells, of_captures) = frame.split_at_mut(cells.len());
            of_cells.copy_from_slice(cells);
            of_captures.copy_from_slice(&self.captures[it.pairs().entries()]);
        }
        self.top = top;
        Some(())
    }

    #[inline]
    fn pop(&mut self, it: &Loop) -> usize {
        let turns = &mut self.cells[it.turns_cell() as usize];
        *turns -= 1;
        let is_short = *turns == 0 && it.first_frame_is_short();
        let top = self.top - if is_short { 1 } else { it.frame_size() };
        let (frame, last) = self.stack.as_mut_slice()[top..self.top].split_at(self.top - top - 1);
        let captures = &mut self.captures[it.pairs().entries()];
        if is_short {
            captures.fill(UNSET);
        } else {
            let cells = &mut self.cells[it.cells().start as usize..it.cells().end as usize];
            let (of_cells, of_captures) = frame.split_at(cells.len());
            cells.copy_from_slice(of_cells);
            captures.copy_from_slice(of_captures);
        }
        self.top = top;
        last[0] as usize
    }
}
