//! From the graph to operations.
//!
//! The code of a node falls through when it succeeds. What has to be done before the position, a cell or a capture
//! changes is put off until then, so that a failure among the first tests has nothing to undo.

mod alternation;
mod leaf;
mod look;
mod memo;
mod output;
mod repeat;
mod run;
mod search;
mod stacked;
mod state;
mod stepped;
mod switch;
mod tests;
mod work;

use smallvec::SmallVec;

use super::graph::{Graph, Id, Kind, Span, Traits};
use super::memory::{StackLimit, push};
use crate::Error;
use crate::analysis::Frequencies;
use crate::program::{Direction, LookId, Op, Pairs, Place, Program, ScopeKind, Slot, UNBOUNDED};
use memo::{Memoizing, Surroundings};
use output::{Label, Output};
use search::FirstRun;
pub(super) use search::emit;
use state::{Action, Alternative, Entry, Fail, Spot, State, Undo};
use tests::{Passed, Test};

pub(super) struct Memory {
    output: Output,
    actions: Vec<Action>,
    alternatives: Vec<Alternative>,
    tests: Vec<Test>,
    owed: Vec<Pairs>,
    held: Vec<Spot>,
}

impl Memory {
    pub(super) const fn new() -> Memory {
        Memory {
            output: Output::new(),
            actions: Vec::new(),
            alternatives: Vec::new(),
            tests: Vec::new(),
            owed: Vec::new(),
            held: Vec::new(),
        }
    }

    /// The last one.
    pub(super) fn program(&mut self) -> &mut Program {
        &mut self.output.program
    }

    pub(super) fn into_program(self) -> Program {
        self.output.program
    }
}

struct Emitter<'a> {
    graph: &'a mut Graph,
    output: &'a mut Output,
    state: State,
    direction: Direction,
    actions: &'a mut Vec<Action>,
    alternatives: &'a mut Vec<Alternative>,
    /// Not yet written. They all fail to `tests_fail`.
    tests: &'a mut Vec<Test>,
    tests_fail: Fail,
    epochs: u32,
    match_start: Spot,
    /// To be cleared when the match is accepted.
    owed: &'a mut Vec<Pairs>,
    turn: Turn,
    /// For the next sequence.
    captures: Captures,
    held: &'a mut Vec<Spot>,
    /// For the next node, after which the turn that started there cannot fail.
    last_of_turn: Option<Entry>,
    /// For the next node, which is followed by a visit that makes one at its end needless.
    precedes_visit: bool,
    /// How often the code at hand is expected to run.
    weight: u32,
    /// Whether the code at hand can run more than once on the same part of the subject.
    repeats: bool,
    /// The most units that can be passed after the node at hand.
    following: u32,
    frequencies: &'a Frequencies,
    first_run: Option<FirstRun>,
    /// In which the position is the start of the subject.
    epoch_at_start: Option<u32>,
    /// Tests that are known to pass.
    passed: SmallVec<[Passed; 4]>,
    counts_turns: bool,
    memoizing: Option<Memoizing>,
    surroundings: Surroundings,
    is_in_loop: bool,
    /// How many lookarounds the code at hand is inside of.
    looks: u32,
    look: Option<LookId>,
    /// For the tables of switches that are still to be made.
    wide_ranges_left: usize,
    free_returns_left: usize,
    /// Where the search for the start of a match goes on.
    searches: SmallVec<[Label; 2]>,
    stack: StackLimit,
}

/// What becomes of the groups whose parentheses are terms of a sequence.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Captures {
    Written,
    /// Nothing is written before the group ends.
    Held,
    Skipped,
}

/// The innermost turn of a loop.
#[derive(Clone, Copy)]
struct Turn {
    start: Spot,
    /// The turn can be empty while the number in the slot is below the value.
    required: Option<(Slot, u32)>,
    undo: Option<Undo>,
}

impl Emitter<'_> {
    /// At least the minimum of the node and `rest` more units are known to follow. Returns where later failures go.
    fn node(&mut self, id: Id, rest: u32, fail: Fail) -> Result<Fail, Error> {
        self.stack.check()?;
        if !self.state.is_reachable {
            (self.captures, self.last_of_turn) = (Captures::Written, None);
            self.precedes_visit = false;
            return Ok(fail);
        }
        let node = &self.graph[id];
        let (kind, traits) = (node.kind, node.traits);
        self.count_turn(traits.contains(Traits::COUNTS_TURN))?;
        let entry = self.entry();
        let last_of_turn = self.last_of_turn.take();
        let last_of_turn = last_of_turn.filter(|_| !traits.contains(Traits::CUTS));
        self.precedes_visit &= traits.contains(Traits::REENTERED)
            && matches!(
                kind,
                Kind::Sequence(_) | Kind::Alternation(_) | Kind::Turn(_)
            );
        let mark = match traits.contains(Traits::CUTS) {
            true => Some(self.plan_mark()?),
            false => None,
        };
        let back = match kind {
            Kind::Sequence(children) => self.sequence(id, children, last_of_turn, rest, fail)?,
            Kind::Alternation(children) => {
                self.alternation(id, children, last_of_turn, rest, fail)?
            }
            Kind::Repeat { .. } => self.repeat(id, rest, fail)?,
            Kind::Turn(body) => self.turn(id, body, rest, fail)?,
            Kind::Look {
                body,
                direction,
                negated,
            } => self.look(body, direction, negated, fail)?,
            Kind::Run { .. } => self.run(id, rest, fail)?,
            _ => return self.leaf(id, rest, fail).map(|()| fail),
        };
        if traits.contains(Traits::REENTERED) || self.first_run.is_some_and(|it| it.node == id) {
            return Ok(back);
        }
        if let Some(slot) = mark
            && self.state.is_reachable
            && !self.is_unchanged_since(entry)
        {
            self.commit()?;
            self.op(Op::Cut { slot })?;
        }
        match last_of_turn {
            Some(turn) => self.release_turn(turn)?,
            None => self.release(entry)?,
        }
        Ok(fail)
    }

    fn sequence(
        &mut self,
        id: Id,
        children: Span,
        last_of_turn: Option<Entry>,
        rest: u32,
        mut fail: Fail,
    ) -> Result<Fail, Error> {
        let is_rigid = self.graph[id].is(Traits::RIGID);
        let can_fail = |&index: &usize| {
            let child = &self.graph[self.graph.children[index]];
            let makes_no_choice = child.is(Traits::RIGID) || matches!(child.kind, Kind::Run { .. });
            !child.is(Traits::CANNOT_FAIL) || !makes_no_choice
        };
        let last_to_fail = last_of_turn.and_then(|_| children.range().rfind(can_fail));
        let captures = core::mem::replace(&mut self.captures, Captures::Written);
        let is_test = |&index: &usize| !self.graph[self.graph.children[index]].is_bookkeeping();
        let before_visit = core::mem::take(&mut self.precedes_visit)
            .then(|| children.range().rfind(is_test))
            .flatten();
        let mins = self.graph.children_of(children).iter();
        let mut needed = mins.fold(rest, |sum, &child| sum + self.graph[child].min);
        if let Some(turn) = last_of_turn.filter(|_| last_to_fail.is_none()) {
            self.release_turn(turn)?;
        }
        let (following, given) = (self.following, fail);
        let (mut bounded, mut unbounded) = (u64::from(following), 0);
        for &child in self.graph.children_of(children) {
            match self.graph[child].extent() {
                UNBOUNDED => unbounded += 1,
                max => bounded += u64::from(max),
            }
        }
        for index in children.range() {
            let child = self.graph.children[index];
            needed -= self.graph[child].min;
            match self.graph[child].extent() {
                UNBOUNDED => unbounded -= 1,
                max => bounded -= u64::from(max),
            }
            self.following = match unbounded {
                0 => u32::try_from(bounded).unwrap_or(UNBOUNDED),
                _ => UNBOUNDED,
            };
            if !is_rigid {
                self.keep_offsets_short()?;
            }
            if Some(index) == last_to_fail && fail == given {
                self.last_of_turn = last_of_turn;
            }
            self.precedes_visit = Some(index) == before_visit;
            match (captures, self.graph[child].kind) {
                (Captures::Skipped, Kind::Open(_) | Kind::Close(_)) => {}
                (Captures::Held, Kind::Open(_)) => self.hold_capture()?,
                (Captures::Held, Kind::Close(pair)) => self.write_held_capture(pair)?,
                _ => fail = self.node(child, needed, fail)?,
            }
            if let Some(turn) = last_of_turn.filter(|_| Some(index) == last_to_fail) {
                self.release_turn(turn)?;
            }
        }
        self.following = following;
        Ok(fail)
    }

    fn turn(&mut self, id: Id, body: Id, rest: u32, fail: Fail) -> Result<Fail, Error> {
        let outer = (self.turn.start, self.turn.required);
        let surroundings = self.surroundings;
        self.turn.start = self.spot()?;
        self.surround_with_turn(self.turn.start.place)?;
        if self.graph[id].min != 0 {
            self.turn.required = None;
        }
        let back = self.node(body, rest, fail)?;
        (self.turn.start, self.turn.required) = outer;
        self.surroundings = surroundings;
        Ok(back)
    }

    fn count_turn(&mut self, is_counted: bool) -> Result<(), Error> {
        match is_counted && self.counts_turns {
            true => self.op(Op::CountTurn),
            false => Ok(()),
        }
    }

    fn plan_mark(&mut self) -> Result<Slot, Error> {
        let slot = self.plan_scope(1, ScopeKind::Mark)?;
        push(self.actions, Action::Protect(Op::Mark { slot }))?;
        Ok(slot)
    }

    fn weigh(&mut self, slot: Slot) {
        let weight = &mut self.output.program.cell_weights[slot.cell as usize];
        *weight = weight.saturating_add(self.weight);
    }

    fn weigh_place(&mut self, place: Place) -> Place {
        self.weigh(place.slot);
        place
    }
}
