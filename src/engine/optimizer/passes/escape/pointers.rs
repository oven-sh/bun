//! The values that may turn out to point to an object that has not been made, and where they are still needed.

use bun_engine_codegen::BitSet;
use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{AccessFlags, Block, Entity, Op, State, Table, Type, Value as Ssa};

use super::objects::{MOST_WORDS, is_made_by};
use super::picture::{Id, members};
use crate::graph::{Graph, Kind, heaps};

const MOST_NUMBERS: usize = 512;
const NO_NUMBER: u16 = u16::MAX;

pub(super) struct Pointers {
    /// A check has that of its operand, and a storage that of its owner.
    numbers: Table<Ssa, u16>,
    /// By number.
    values: Vec<Ssa>,
    words: usize,
    /// By the position of the block. Without its parameters.
    live_in: Vec<u64>,
    in_state: BitSet,
}

/// What happens to an object in the block that makes it.
#[derive(Clone, Copy, Default)]
struct Fate {
    is_open: bool,
    escapes: bool,
    changes_shape: bool,
}

struct Search<'a> {
    graph: &'a Graph,
    numbers: Table<Ssa, u16>,
    values: Vec<Ssa>,
    unused: Vec<u16>,
    /// By number.
    fates: Vec<Fate>,
    heaps_with_pointers: BitSet,
    numbered_in_block: Vec<Ssa>,
    /// An object, and another that has it.
    held: Vec<(u16, u16)>,
    has_candidates: bool,
}

/// Gives the object back if it gives anything.
fn passes_on(kind: Kind) -> bool {
    kind.gives_operand() || matches!(kind, Kind::ToObject | Kind::ToThis)
}

fn only_looks(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::StoreBarrier
            | Kind::Verify
            | Kind::HasModes
            | Kind::LoadShapeId
            | Kind::LoadExecutable
            | Kind::StrictEqual
            | Kind::LooseEqual
            | Kind::PlainTypeof
            | Kind::GenericTypeof
    ) || super::answers::is_test(kind)
}

impl Search<'_> {
    fn number(&self, value: Ssa) -> Option<u16> {
        Some(self.numbers[value]).filter(|&it| it != NO_NUMBER)
    }

    fn share(&mut self, value: Ssa, number: u16) {
        self.numbers[value] = number;
        self.numbered_in_block.push(value);
    }

    fn add(&mut self, value: Ssa, is_open: bool) -> Option<u16> {
        let number = self.unused.pop().or_else(|| {
            (self.values.len() < MOST_NUMBERS).then(|| {
                self.values.push(value);
                self.fates.push(Fate::default());
                self.values.len() as u16 - 1
            })
        })?;
        self.values[usize::from(number)] = value;
        self.fates[usize::from(number)] = Fate {
            is_open,
            ..Fate::default()
        };
        self.share(value, number);
        Some(number)
    }

    fn put(&mut self, object: Ssa, holder: Option<u16>) {
        match (self.number(object), holder) {
            (Some(object), Some(holder)) => self.held.push((object, holder)),
            (Some(object), None) => self.fates[usize::from(object)].escapes = true,
            (None, _) => {}
        }
    }

    fn visit_node(&mut self, value: Ssa, kind: Kind, data: u32) {
        let operands = self.graph.function.operands(value);
        if is_made_by(kind) {
            let allocation = self.graph.allocations[data as usize];
            let fits = allocation.size as usize / 8 <= MOST_WORDS
                && self.graph.shapes[allocation.shape].out_of_line_capacity == 0;
            let number = fits.then(|| self.add(value, true)).flatten();
            return operands.iter().for_each(|&it| self.put(it, number));
        }
        let changes_shape = matches!(kind, Kind::SetShape | Kind::GrowSlots);
        if changes_shape || passes_on(kind) {
            if let Some(number) = self.number(operands[0]) {
                self.fates[usize::from(number)].changes_shape |= changes_shape;
                self.share(value, number);
            }
        } else if !only_looks(kind) {
            operands.iter().for_each(|&it| self.put(it, None));
        }
    }

    fn visit(&mut self, value: Ssa) {
        let function = &self.graph.function;
        if let Some((kind, data)) = self.graph.node(value) {
            return self.visit_node(value, kind, data);
        }
        match *function.op(value) {
            Op::Load {
                address, access, ..
            } => {
                let owner = self.number(address);
                let Some(owner) = owner.filter(|_| function.type_of(value) == Type::I64) else {
                    return;
                };
                if access.heap() == heaps::STORAGE {
                    self.share(value, owner);
                } else if access.has(AccessFlags::IMMUTABLE)
                    || self.heaps_with_pointers.contains(access.heap().index())
                {
                    self.add(value, false);
                }
            }
            Op::Store {
                args: [stored, address],
                access,
                ..
            } => {
                let holder = self.number(address);
                if holder.is_some() && self.number(stored).is_some() {
                    self.heaps_with_pointers.insert(access.heap().index());
                }
                self.put(stored, holder);
            }
            Op::Compare(..) => {}
            _ => (function.operands(value).iter()).for_each(|&it| self.put(it, None)),
        }
    }

    fn enter(&mut self, cfg: &Cfg, block: Block) {
        let function = &self.graph.function;
        for (position, &param) in function.params(block).iter().enumerate() {
            let mut entering =
                (cfg.predecessors(block).iter()).filter(|&&edge| !cfg.is_backward(function, edge));
            if entering.any(|&edge| self.number(function.args(edge)[position]).is_some()) {
                self.add(param, false);
            }
        }
    }

    /// There is nothing to gain from putting off what is needed right away and in the form in which it is made.
    fn leave(&mut self) {
        let mut changed = true;
        while core::mem::take(&mut changed) {
            for &(object, holder) in &self.held {
                let Fate {
                    is_open, escapes, ..
                } = self.fates[usize::from(holder)];
                let fate = &mut self.fates[usize::from(object)];
                changed |= is_open && escapes && !core::mem::replace(&mut fate.escapes, true);
            }
        }
        self.held.clear();
        for value in self.numbered_in_block.drain(..).rev() {
            let number = self.numbers[value];
            let fate = &mut self.fates[usize::from(number)];
            let is_dropped = fate.is_open && fate.escapes && !fate.changes_shape;
            if is_dropped {
                self.numbers[value] = NO_NUMBER;
            }
            if self.values[usize::from(number)] == value {
                self.has_candidates |= fate.is_open && !is_dropped;
                fate.is_open = false;
                self.unused.extend(is_dropped.then_some(number));
            }
        }
    }
}

impl Pointers {
    /// `None` if there is no object to follow.
    pub(super) fn find(graph: &Graph, cfg: &Cfg) -> Option<Self> {
        let mut search = Search {
            graph,
            numbers: graph.function.value_table(NO_NUMBER),
            values: Vec::new(),
            unused: Vec::new(),
            fates: Vec::new(),
            heaps_with_pointers: BitSet::with_size(graph.function.heap_count()),
            numbered_in_block: Vec::new(),
            held: Vec::new(),
            has_candidates: false,
        };
        for &block in cfg.order() {
            search.enter(cfg, block);
            (graph.function.instructions(block)).for_each(|value| search.visit(value));
            search.leave();
        }
        search.has_candidates.then(|| {
            let words = search.values.len().div_ceil(64);
            let mut pointers = Self {
                numbers: search.numbers,
                values: search.values,
                words,
                live_in: vec![0; cfg.order().len() * words],
                in_state: BitSet::with_size(graph.function.state_count()),
            };
            pointers.find_live(graph, cfg);
            pointers
        })
    }

    fn find_live(&mut self, graph: &Graph, cfg: &Cfg) {
        let (function, words) = (&graph.function, self.words);
        for (position, &block) in cfg.order().iter().enumerate().rev() {
            let (live, later) = self.live_in[position * words..].split_at_mut(words);
            for edge in function.successors(block) {
                if !cfg.is_backward(function, edge) {
                    let distance = cfg.position(function.target(edge)) as usize - position - 1;
                    let there = &later[distance * words..];
                    live.iter_mut()
                        .zip(there)
                        .for_each(|(it, more)| *it |= more);
                }
            }
            let mut note = |value: Ssa| {
                let number = usize::from(self.numbers[value]);
                let has_number = number < MOST_NUMBERS;
                if has_number {
                    live[number / 64] |= 1 << (number % 64);
                }
                has_number
            };
            let args = function.successors(block).flat_map(|it| function.args(it));
            args.for_each(|&arg| _ = note(arg));
            let mut seen = [State::NONE; 2];
            for value in function.instructions(block) {
                (function.operands(value).iter()).for_each(|&operand| _ = note(operand));
                for (state, seen) in graph.states_for(value).into_iter().zip(&mut seen) {
                    if !state.is_none() && core::mem::replace(seen, state) != state {
                        let held = function.state(state).iter();
                        if held.fold(false, |found, &it| note(it) | found) {
                            self.in_state.insert(state.index());
                        }
                    }
                }
            }
            for (index, word) in live.iter_mut().enumerate() {
                let here = members(*word)
                    .filter(|bit| function.block_of(self.values[index * 64 + bit]) == block);
                *word &= !here.fold(0, |all, bit| all | 1 << bit);
            }
        }
        for (position, &block) in cfg.order().iter().enumerate() {
            let around = match cfg.loop_headed_by(block) {
                Some(own) => cfg.loops()[own].parent,
                None => cfg.loop_of(block),
            };
            if let Some(around) = around.expand() {
                let header = cfg.loops()[around].positions().start as usize;
                let (earlier, live) = self.live_in.split_at_mut(position * words);
                let throughout = &earlier[header * words..][..words];
                live.iter_mut()
                    .zip(throughout)
                    .for_each(|(it, more)| *it |= more);
            }
        }
    }

    pub(super) fn count(&self) -> usize {
        self.values.len()
    }

    pub(super) fn number(&self, value: Ssa) -> Option<Id> {
        let number = self.numbers.get(value).copied();
        number.filter(|&it| it != NO_NUMBER).map(Id)
    }

    pub(super) fn are_in(&self, state: State) -> bool {
        !state.is_none() && self.in_state.contains(state.index())
    }

    /// Of the block at this position.
    pub(super) fn live_at_start(&self, position: u32) -> impl Iterator<Item = Ssa> {
        let live = &self.live_in[position as usize * self.words..][..self.words];
        (live.iter().enumerate())
            .flat_map(|(index, &word)| members(word).map(move |bit| index * 64 + bit))
            .map(|number| self.values[number])
    }
}
