//! Makes objects no earlier than something wants to see them, and not at all on the ways where nothing does.
//!
//! A walk along the order of the blocks keeps a picture of the objects that have not been made. What the code does to
//! them it does to the picture, and states describe them. What holds at the head of a loop is found by trials.

mod answers;
mod loops;
mod make;
mod merge;
mod objects;
mod picture;
mod pointers;
mod states;
mod visit;

use core::ops::Range;

use bun_engine_codegen::analysis::{Cfg, Loop};
use bun_engine_codegen::ir::{Block, Edge, Op, Table, Value as Ssa};
use bun_engine_codegen::passes::Analyses;

use self::objects::Object;
use self::picture::{Id, Picture, Positions, Word};
use self::pointers::Pointers;
use super::prune_params;
use crate::builder::{Built, Refusal};
use crate::graph::Graph;

/// What a value of the graph has turned out to be.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Meaning {
    Itself,
    /// The instruction is gone, as for the next two.
    Value(Ssa),
    Object(Id),
    StorageOf(Id),
    /// The object had been made by then, so the check stays.
    Checked(Id),
}

#[derive(Clone)]
struct Arrival {
    edge: Edge,
    picture: Picture,
}

struct Sinking<'a> {
    graph: &'a mut Graph,
    cfg: &'a Cfg,
    pointers: Pointers,
    objects: Vec<Option<Object>>,
    meanings: Table<Ssa, Meaning>,
    now: Picture,
    /// Where new instructions go.
    before: Ssa,
    run: make::Run,
    arrivals: Table<Block, Vec<Arrival>>,
    heads: Table<Loop, loops::Head>,
    /// The positions of the blocks on trial. The graph stays as it is unless that is empty.
    trial: Range<u32>,
    found_on_trial: Vec<Ssa>,
    has_learned: bool,
    /// That a loop is not as its last trial promised.
    has_learned_too_late: bool,
    /// The loops that start before this position need no more trials.
    settled_until: u32,
    steps_left_for_trials: usize,
    most_words: usize,
    latest_stamp: u32,
    empty: Word,
    spare: Vec<Picture>,
    meeting: merge::Meeting,
    descriptions: states::Descriptions,
    with_dead_params: Vec<Block>,
    may_have_needless_params: bool,
    changed_control_flow: bool,
}

pub(super) fn run(graph: &mut Graph, analyses: &mut Analyses) -> Built {
    const STEPS_PER_VALUE: usize = 24;
    const WORDS_IN_ALL: usize = 2_000_000;
    const WORDS_AT_A_TIME: usize = 160;
    if graph.allocations.is_empty() {
        return Ok(());
    }
    let cfg = analyses.cfg(&mut graph.function);
    if !cfg.loops().values().all(|it| it.is_natural) {
        return Ok(());
    }
    let Some(pointers) = Pointers::find(graph, cfg) else {
        return Ok(());
    };
    let function = &mut graph.function;
    let places = function.state_count() + function.edge_count();
    let mut sinking = Sinking {
        objects: vec![None; pointers.count()],
        pointers,
        meanings: function.value_table(Meaning::Itself),
        now: Picture::default(),
        before: Ssa::NONE,
        run: make::Run::None,
        arrivals: function.block_table(Vec::new()),
        heads: Table::filled(cfg.loops().len(), loops::Head::default()),
        trial: 0..0,
        found_on_trial: Vec::new(),
        has_learned: false,
        has_learned_too_late: false,
        settled_until: 0,
        steps_left_for_trials: function.value_count() * STEPS_PER_VALUE,
        most_words: WORDS_AT_A_TIME.min(WORDS_IN_ALL / places.max(1)),
        latest_stamp: 0,
        empty: Word::value(function.const64(0)),
        spare: Vec::new(),
        meeting: merge::Meeting::default(),
        descriptions: states::Descriptions::new(function),
        with_dead_params: Vec::new(),
        may_have_needless_params: false,
        changed_control_flow: false,
        graph,
        cfg,
    };
    sinking.walk(0..cfg.order().len() as u32);
    if sinking.has_learned_too_late {
        return Err(Refusal::Unsupported);
    }
    let Sinking {
        with_dead_params,
        may_have_needless_params,
        changed_control_flow,
        ..
    } = sinking;
    if changed_control_flow {
        analyses.invalidate();
    }
    let cfg = analyses.cfg(&mut graph.function);
    for block in with_dead_params {
        (graph.function).drop_dead_params(block, cfg.predecessors(block));
    }
    graph.function.resolve_aliases();
    if may_have_needless_params || changed_control_flow {
        prune_params::run(graph, analyses);
    }
    Ok(())
}

impl Sinking<'_> {
    fn is_on_trial(&self) -> bool {
        !self.trial.is_empty()
    }

    fn walk(&mut self, positions: Range<u32>) {
        for position in positions {
            if self.has_learned_too_late {
                return;
            }
            let block = self.cfg.order()[position as usize];
            if !self.is_on_trial() && position >= self.settled_until {
                self.settle(block);
            }
            if self.enter(block) {
                self.run = make::Run::None;
                let mut value = self.graph.function.first(block);
                while !value.is_none() {
                    self.visit(value);
                    value = self.graph.function.next(value);
                }
                self.leave(block);
            }
        }
    }

    fn leave(&mut self, block: Block) {
        let taken = self.edge_taken(block);
        if let Some(edge) = taken.filter(|_| !self.is_on_trial()) {
            self.graph.function.keep_only_successor(edge);
            self.changed_control_flow = true;
        }
        for edge in self.graph.function.successors(block) {
            let target = self.graph.function.target(edge);
            let is_followed =
                !self.is_on_trial() || self.trial.contains(&self.cfg.position(target));
            if !is_followed || taken.is_some_and(|it| it != edge) {
                continue;
            }
            let picture = self.needed_along(edge);
            if self.cfg.is_backward(&self.graph.function, edge) {
                self.close_loop(Arrival { edge, picture });
            } else {
                self.arrivals[target].push(Arrival { edge, picture });
            }
        }
    }

    /// If there are others, and it is certain.
    fn edge_taken(&self, block: Block) -> Option<Edge> {
        let function = &self.graph.function;
        let position = match *function.op(function.last(block)) {
            Op::Branch(condition) => usize::from(self.found_integer(condition)? == 0),
            Op::Switch(key, cases) => {
                let (key, keys) = (self.found_integer(key)?, function.cases(cases));
                keys.iter().position(|&it| it == key).unwrap_or(keys.len())
            }
            _ => return None,
        };
        Some(function.successor(block, position))
    }

    fn needed_along(&mut self, edge: Edge) -> Picture {
        if self.now.entries.is_empty() {
            return Picture::default();
        }
        let roots = self.pointed_to_along(edge);
        let mut picture = self.spare.pop().unwrap_or_default();
        (self.now).copy_part(self.now.reachable_from(roots), &mut picture);
        picture
    }

    fn pointed_to_along(&self, edge: Edge) -> Positions {
        let function = &self.graph.function;
        let position = self.cfg.position(function.target(edge));
        let args = function.args(edge).iter().copied();
        self.pointed_to_by(self.pointers.live_at_start(position).chain(args))
    }

    fn pointed_to_by(&self, values: impl Iterator<Item = Ssa>) -> Positions {
        let ids = values.filter_map(|value| self.object_behind(value));
        ids.fold(0, |all, id| all | 1 << self.now.position(id))
    }

    fn recycle(&mut self, picture: Picture) {
        if picture.entries.capacity() != 0 {
            self.spare.push(picture);
        }
    }

    // Meanings

    fn meaning(&self, value: Ssa) -> Meaning {
        self.meanings.get(value).copied().unwrap_or(Meaning::Itself)
    }

    fn set_meaning(&mut self, value: Ssa, meaning: Meaning) {
        self.meanings[value] = meaning;
        if self.is_on_trial() {
            self.found_on_trial.push(value);
        }
    }

    fn object_behind(&self, value: Ssa) -> Option<Id> {
        match self.meaning(value) {
            Meaning::Object(id) | Meaning::StorageOf(id) | Meaning::Checked(id) => Some(id),
            Meaning::Itself | Meaning::Value(_) => None,
        }
    }

    /// `None` for what no object or register has.
    fn word_for(&self, value: Ssa) -> Option<Word> {
        match self.meaning(value) {
            Meaning::Object(id) | Meaning::Checked(id) => Some(Word::object(id)),
            Meaning::Value(other) => Some(Word::value(other)),
            Meaning::StorageOf(_) => None,
            Meaning::Itself => match self.graph.root(value) {
                root if root == value => Some(Word::value(value)),
                root => self.word_for(root),
            },
        }
    }

    /// If it is a constant thanks to this pass.
    fn found_integer(&self, value: Ssa) -> Option<i64> {
        match self.meaning(value) {
            Meaning::Value(other) => self.graph.function.int_constant(other),
            _ => None,
        }
    }

    fn object(&self, id: Id) -> &Object {
        self.objects[id.index()].as_ref().expect("has been seen")
    }

    fn take_for_one(&mut self, id: Id, other: Id) {
        if id != other {
            let other = self.object(other).clone();
            let object = self.objects[id.index()].as_mut();
            object.expect("has been seen").stand_for(&other);
        }
    }

    fn new_stamp(&mut self) -> u32 {
        self.latest_stamp += 1;
        self.latest_stamp
    }

    /// Whether one could stand for the other, given parameters for the words that differ. Neither has been made.
    fn are_alike(&self, places: [(&Picture, usize); 2]) -> bool {
        let [first, second] = places.map(|(picture, position)| {
            let entry = &picture.entries[position];
            let object = self.object(entry.id);
            let allocation = &self.graph.allocations[object.allocation as usize];
            let telling = (object.telling_word()).map(|it| picture.words_at(position)[it]);
            (
                (object.kind, allocation.size, allocation.allocator),
                (entry.shape, entry.word_count, telling),
            )
        });
        first == second && first.1.2 != Some(Word::UNKNOWN)
    }
}
