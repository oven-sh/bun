//! The attempts at one position after the other.

use smallvec::SmallVec;

use super::memo::{Memoizing, Surroundings};
use super::output::{Label, ROOT, Section};
use super::state::{FREE_RETURNS, Fail, Spot, State};
use super::switch::WIDE_RANGES_SWITCHED;
use super::work::MAX_UNCOUNTED;
use super::{Captures, Emitter, Memory, Turn};
use crate::Error;
use crate::analysis::{Frequencies, Landmark, Prefixes, find_landmark, plan_scan};
use crate::compile::graph::{Form, Graph, Id, Kind, MAX_REACH, NEAR, Node, Traits};
use crate::compile::lower::Lowered;
use crate::compile::memory::{StackLimit, push, reserve};
use crate::compile::{Mode, Options, Purpose};
use crate::program::{
    Approach, Class, Comparison, Direction, MAX_LENGTH, Op, Place, Probe, Room, Scan, ScanId,
    ScopeKind, Slot, UNBOUNDED, Width,
};
use crate::surrogate::TRAILS;
use crate::tree::Tree;

pub(in crate::compile) fn emit(
    tree: &Tree,
    graph: &mut Graph,
    lowered: Lowered,
    options: &Options<'_>,
    purpose: Purpose,
    memory: &mut Memory,
) -> Result<(), Error> {
    let Lowered {
        root,
        pair_count,
        referenced_pairs,
    } = lowered;
    memory.output.start(graph.node_count() * 2)?;
    memory.actions.clear();
    memory.alternatives.clear();
    memory.tests.clear();
    memory.owed.clear();
    memory.held.clear();
    let mut frequencies = Frequencies::USUAL;
    frequencies.sample(options.sample);
    let mut emitter = Emitter {
        output: &mut memory.output,
        counts_turns: purpose == Purpose::Counting,
        memoizing: referenced_pairs.map(|referenced_pairs| Memoizing {
            referenced_pairs,
            entries: Vec::new(),
            references_left: graph.reference_count(),
        }),
        surroundings: Surroundings::NONE,
        is_in_loop: false,
        looks: 0,
        look: None,
        wide_ranges_left: WIDE_RANGES_SWITCHED,
        free_returns_left: FREE_RETURNS,
        searches: SmallVec::new(),
        graph,
        state: State::INITIAL,
        direction: Direction::Forward,
        actions: &mut memory.actions,
        alternatives: &mut memory.alternatives,
        tests: &mut memory.tests,
        tests_fail: Fail::NO_MATCH,
        epochs: 0,
        match_start: Spot::NOWHERE,
        owed: &mut memory.owed,
        turn: Turn {
            start: Spot::NOWHERE,
            required: None,
            undo: None,
        },
        captures: Captures::Written,
        held: &mut memory.held,
        last_of_turn: None,
        precedes_visit: false,
        weight: 1,
        repeats: false,
        following: 0,
        frequencies: &frequencies,
        first_run: None,
        epoch_at_start: None,
        passed: SmallVec::new(),
        stack: StackLimit(options.stack_limit),
    };
    let reads_pairs = tree.is_unicode_aware() && options.width == Width::Utf16;
    emitter.search(root, tree.is_sticky(), reads_pairs)?;
    emitter.output.lay_out(&mut emitter.searches)?;
    let (program, graph) = (&mut emitter.output.program, emitter.graph);
    program.fixed_work = (program.ops.iter().map(Op::fixed_work)).fold(0, u32::saturating_add);
    // The interpreter does its own counting.
    if program.fixed_work > MAX_UNCOUNTED && purpose != Purpose::Memoizing {
        program.count_work(&emitter.searches)?;
    }
    reserve(&mut program.classes, graph.classes.len())?;
    (program.classes).extend(graph.classes.drain(..).map(Class::new));
    core::mem::swap(&mut program.referenced_pairs, &mut graph.referenced_pairs);
    program.purpose = purpose;
    program.attempt = emitter.match_start.place.slot;
    program.pair_count = pair_count;
    program.reports_captures = options.mode == Mode::Captures;
    program.width = options.width;
    program.is_unicode_aware = tree.is_unicode_aware();
    program.min_length = graph[root].min;
    Ok(())
}

/// The run that every attempt enters at the same distance from its start, before it has had a choice.
///
/// Once the rest of the pattern has failed wherever the run can end, it fails for all that enter the run further on.
#[derive(Clone, Copy)]
pub(super) struct FirstRun {
    pub(super) node: Id,
    /// Expects the position to be the end of the run.
    pub(super) restart: Label,
}

#[derive(Clone, Copy)]
struct Labels {
    give_up: Label,
    /// One unit further.
    next: Label,
    search: Label,
    attempt: Label,
}

impl Emitter<'_> {
    fn search(&mut self, root: Id, is_sticky: bool, reads_pairs: bool) -> Result<(), Error> {
        let give_up = self.output.label()?;
        let no_match = self.fail_to_either(give_up, give_up)?;
        if is_sticky {
            // What a search has found out serves the next.
            self.repeats = self.memoizing.is_some();
            self.leave_pair(reads_pairs)?;
            self.need_node(root, 0, no_match)?;
            self.attempt(root, no_match)?;
        } else {
            let mut prefixes = Prefixes::default();
            prefixes.find(self.graph, &[root]);
            if prefixes.rows.is_empty() && prefixes.longest_at_end.is_none() {
                self.attempt_at_start(root, reads_pairs, no_match)?;
            } else {
                self.leave_pair(reads_pairs)?;
                self.attempt_everywhere(root, &prefixes, reads_pairs, give_up)?;
            }
        }
        self.bind_settled(give_up, Room::NONE, ROOT)?;
        self.op(Op::NoMatch)
    }

    fn leave_pair(&mut self, reads_pairs: bool) -> Result<(), Error> {
        match reads_pairs {
            true => self.op(Op::LeavePair),
            false => Ok(()),
        }
    }

    fn attempt(&mut self, root: Id, fail: Fail) -> Result<(), Error> {
        self.match_start = self.spot()?;
        debug_assert!(self.match_start.place.delta == 0);
        self.node(root, 0, fail).map(drop)
    }

    fn attempt_at_start(
        &mut self,
        root: Id,
        reads_pairs: bool,
        no_match: Fail,
    ) -> Result<(), Error> {
        self.leave_pair(reads_pairs)?;
        self.need_node(root, 0, no_match)?;
        let slot = self.plan_scope(1, ScopeKind::Position(self.state.room))?;
        let fail = self.target(no_match)?;
        self.op(Op::SaveStart { slot, fail })?;
        self.state.scope = slot.scope;
        self.state.anchor = Some(Place { slot, delta: 0 });
        self.epoch_at_start = Some(self.state.epoch);
        self.attempt(root, no_match)
    }

    fn attempt_everywhere(
        &mut self,
        root: Id,
        prefixes: &Prefixes,
        reads_pairs: bool,
        give_up: Label,
    ) -> Result<(), Error> {
        let labels = Labels {
            give_up,
            next: self.output.label()?,
            search: self.output.label()?,
            attempt: self.output.label()?,
        };
        self.searches.push(labels.search);
        let Node { min, max, .. } = self.graph[root];
        let room = Room::NONE.with(Direction::Forward, min);
        let is_near_end = max <= MAX_LENGTH && self.ends_at_end(root, 0);
        if is_near_end {
            self.op(Op::SkipToTail { length: max })?;
        }
        let has_few_starts = is_near_end && max - min < POSITIONS_WORTH_A_SCAN;
        let (mut scan, mut landmark) = (None, None);
        if !has_few_starts {
            let planned = plan_scan(self.graph, prefixes, self.frequencies)?;
            let attempts = planned.as_ref().map_or(1.0, |it| it.1);
            scan = planned.map(|(scan, _)| Scan {
                stops_often: scan.stops_often && max > 1,
                ..scan
            });
            if attempts > ATTEMPTS_WORTH_A_LANDMARK || self.ends_at_end(root, 0) {
                landmark = find_landmark(self.graph, root, self.frequencies, attempts / 8.0)?;
            }
        }
        match landmark {
            Some((Landmark::Units(scan), approach)) => {
                return self.attempt_near(root, scan, approach, reads_pairs, labels);
            }
            Some((Landmark::End, approach)) => self.walk_back_from_end(approach)?,
            None => {}
        }
        let looks_behind = scan
            .as_ref()
            .is_some_and(|it| it.offsets().any(|it| it < 0));
        let skips = scan.is_some() || prefixes.rows.is_empty();
        let unscanned_tail = prefixes.longest_at_end.max((min == 0).then_some(0));
        let unscanned = self.output.label()?;
        let has_unscanned_start = skips && (prefixes.some_are_at_start || looks_behind);
        if has_unscanned_start {
            self.op(Op::Need {
                direction: Direction::Backward,
                count: 1,
                fail: unscanned,
            })?;
        }
        self.jump(labels.search)?;

        self.bind_settled(labels.next, room, ROOT)?;
        self.need(1, Fail::NO_MATCH)?;
        self.advance(1)?;
        let behind = Room::NONE.with(Direction::Backward, has_unscanned_start.into());
        self.bind_settled(labels.search, behind, ROOT)?;
        let probe = match scan {
            Some(scan) => self.scan(scan, min, unscanned_tail, unscanned, give_up)?,
            None => {
                if let Some(length) = prefixes.longest_at_end.filter(|_| skips) {
                    self.op(Op::SkipToTail { length })?;
                }
                self.need(min, Fail::NO_MATCH)?;
                None
            }
        };
        self.output.bind(unscanned, Section::Cold, Room::NONE, ROOT);
        let check = Op::Need {
            direction: Direction::Forward,
            count: min,
            fail: give_up,
        };
        self.output.op(Section::Cold, check)?;
        self.output
            .op(Section::Cold, Op::Jump { to: labels.attempt })?;

        let always_scans = !has_unscanned_start && unscanned_tail.is_none();
        match probe.filter(|_| always_scans) {
            Some(probe) => {
                self.bind(labels.attempt)?;
                self.note_passed(probe.offset.into(), Some(probe.step));
            }
            None => self.bind_settled(labels.attempt, room, ROOT)?,
        }
        self.repeated_attempt(root, reads_pairs, labels)
    }

    fn repeated_attempt(
        &mut self,
        root: Id,
        reads_pairs: bool,
        labels: Labels,
    ) -> Result<(), Error> {
        self.repeats = true;
        self.find_first_run(root, labels)?;
        let undo = self.plan_undo(self.graph[root].extent() > NEAR)?;
        let attempt_fails = self.fail_to(labels.next, undo)?;
        if reads_pairs && self.graph.first(root).intersects_wide(TRAILS) {
            let fail = labels.next;
            self.op(Op::NotInPair { offset: 0, fail })?;
        }
        self.attempt(root, attempt_fails)
    }

    fn save_at_root(&mut self) -> Result<Slot, Error> {
        let slot = self.position_at_root(Room::NONE)?;
        self.op(Op::Save { slot })?;
        Ok(slot)
    }

    fn position_at_root(&mut self, room: Room) -> Result<Slot, Error> {
        let slot = self.output.add_scope(ROOT, 1, ScopeKind::Position(room))?;
        self.weigh(slot);
        Ok(slot)
    }

    fn walk_back_from_end(&mut self, approach: Approach) -> Result<(), Error> {
        let slot = self.save_at_root()?;
        self.op(Op::SkipToTail { length: 0 })?;
        let found = self.position_at_root(Room::NONE)?.scope;
        self.op(Op::WalkBack {
            slot,
            found,
            class: approach.class,
            max: approach.max,
        })
    }

    /// Makes attempts only from where the next landmark can be reached.
    fn attempt_near(
        &mut self,
        root: Id,
        scan: Scan,
        approach: Approach,
        reads_pairs: bool,
        labels: Labels,
    ) -> Result<(), Error> {
        let look_further = self.output.label()?;
        self.searches.push(look_further);
        self.bind_settled(look_further, Room::NONE, ROOT)?;
        let slot = self.save_at_root()?;
        self.need(approach.min, Fail::NO_MATCH)?;
        self.advance(approach.min as i32)?;
        self.scan(scan, 0, None, labels.give_up, labels.give_up)?;
        let found = self.position_at_root(self.state.room.with(Direction::Backward, 0))?;
        self.op(Op::WalkBack {
            slot,
            found: found.scope,
            class: approach.class,
            max: approach.max,
        })?;
        self.jump(labels.search)?;

        let room = Room::NONE.with(Direction::Forward, self.graph[root].min);
        self.bind_settled(labels.next, room, found.scope)?;
        self.advance(1)?;
        self.bind_settled(labels.search, Room::NONE, found.scope)?;
        self.weigh(found);
        self.op(Op::ComparePlace {
            when: Comparison::Above,
            offset: 0,
            place: Place {
                slot: found,
                delta: -(approach.min as i32),
            },
            to: look_further,
        })?;
        self.state.room = room;
        self.repeated_attempt(root, reads_pairs, labels)
    }

    /// Returns a probe that holds afterwards.
    fn scan(
        &mut self,
        mut scan: Scan,
        min: u32,
        unscanned_tail: Option<u32>,
        unscanned: Label,
        give_up: Label,
    ) -> Result<Option<Probe>, Error> {
        scan.need = scan.need.max(min);
        let mut fail = give_up;
        if let Some(length) = unscanned_tail {
            scan.need = scan.need.max(length + 1);
            fail = self.output.label()?;
            self.output.bind(fail, Section::Cold, Room::NONE, ROOT);
            self.output.op(Section::Cold, Op::SkipToTail { length })?;
            self.output.op(Section::Cold, Op::Jump { to: unscanned })?;
        }
        let id = ScanId(self.output.program.scans.len() as u32);
        let first = scan.rows.is_empty().then_some(scan.first);
        self.state.room.ahead = scan.need;
        push(&mut self.output.program.scans, scan)?;
        self.op(Op::Scan { id, fail })?;
        Ok(first)
    }

    fn ends_at_end(&self, id: Id, depth: u32) -> bool {
        const MAX_DEPTH: u32 = 8;
        let mut terms = self.graph.terms(&id).iter().rev();
        let last = terms.find(|&&it| self.graph[it].max != 0 || self.is_end(it));
        last.is_some_and(|&last| match self.graph[last].kind {
            Kind::Alternation(children) if depth < MAX_DEPTH => {
                let mut alternatives = self.graph.children_of(children).iter();
                alternatives.all(|&it| self.ends_at_end(it, depth + 1))
            }
            _ => self.is_end(last),
        })
    }

    fn is_end(&self, id: Id) -> bool {
        self.graph[id].kind == Kind::Edge(Direction::Forward)
    }

    fn starts_at_start(&self, id: Id) -> bool {
        let terms = self.graph.terms(&id).iter().map(|&it| &self.graph[it]);
        let mut empty = terms.take_while(|it| it.max == 0);
        empty.any(|it| it.kind == Kind::Edge(Direction::Backward))
    }

    fn find_first_run(&mut self, root: Id, labels: Labels) -> Result<(), Error> {
        if !self.graph.referenced_pairs.is_empty() {
            return Ok(());
        }
        let mut repeated = root;
        if let Kind::Alternation(children) = self.graph[root].kind {
            match self.graph.children_of(children) {
                [before @ .., last] if before.iter().all(|&it| self.starts_at_start(it)) => {
                    repeated = *last;
                }
                _ => return Ok(()),
            }
        }
        let terms = self.graph.terms(&repeated);
        let before = terms
            .iter()
            .take_while(|&&it| self.graph[it].is(Traits::RIGID));
        let (count, mut distance) = before.fold((0, 0u32), |(count, sum), &it| {
            (count + 1, sum.saturating_add(self.graph[it].min))
        });
        let Some((&node, after)) = terms[count..].split_first() else {
            return Ok(());
        };
        match self.graph[node].kind {
            Kind::Run { max: UNBOUNDED, .. } => {}
            Kind::Repeat {
                body,
                min,
                max: UNBOUNDED,
                form: Form::Possessive | Form::Stepped,
                ..
            } if self.graph.turns_are_alike(body) && self.only_step(body).is_some() => {
                distance = distance.saturating_add(min);
            }
            _ => return Ok(()),
        }
        if distance > MAX_REACH
            || after
                .iter()
                .all(|&it| self.graph[it].is(Traits::CANNOT_FAIL))
        {
            return Ok(());
        }
        let restart = match distance {
            1 => labels.search,
            _ => self.write_restart(distance, labels)?,
        };
        self.first_run = Some(FirstRun { node, restart });
        Ok(())
    }

    /// Moves to the first start from which the run is entered after its end.
    fn write_restart(&mut self, distance: u32, labels: Labels) -> Result<Label, Error> {
        let restart = self.output.label()?;
        let room = Room::NONE.with(Direction::Backward, distance);
        (self.output).bind(restart, Section::Cold, room, self.state.scope);
        if distance == 0 {
            let check = Op::Need {
                direction: Direction::Forward,
                count: 1,
                fail: labels.give_up,
            };
            self.output.op(Section::Cold, check)?;
        }
        let by = 1 - distance as i32;
        self.output.op(Section::Cold, Op::Advance { by })?;
        self.output
            .op(Section::Cold, Op::Jump { to: labels.search })?;
        Ok(restart)
    }
}

const ATTEMPTS_WORTH_A_LANDMARK: f32 = 1.0 / 64.0;
const POSITIONS_WORTH_A_SCAN: u32 = 8;
