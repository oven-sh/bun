//! Builds one function in SSA form from code that assigns to variables.
//!
//! The construction is that of Braun et al., "Simple and Efficient Construction of Static Single Assignment Form", with block
//! parameters in the place of phi functions.

use crate::id::{BlockId, TyId, V};
use crate::ir::{Func, Op, Prediction, Target, Term};
use rustc_hash::{FxHashMap, FxHashSet};

/// A local variable of the function being built that no inner function captures.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Var(pub u32);

#[derive(Default)]
struct BlockState {
    defs: FxHashMap<Var, V>,
    preds: Vec<BlockId>,
    is_sealed: bool,
    /// Parameters added before the predecessors were all known.
    incomplete: Vec<(Var, V)>,
    above: Option<Above>,
}

#[derive(Copy, Clone)]
struct Above {
    parent: BlockId,
    jump: BlockId,
    depth: u32,
    root: BlockId,
}

enum Leap {
    No,
    To(BlockId),
    Value(V),
}

#[derive(Copy, Clone)]
enum Stored {
    Never,
    Once(V, BlockId),
    Often,
}

/// Where `read_in` goes on once it has the value of the variable at the end of a predecessor.
enum Awaiting {
    /// The block has one predecessor: the variable holds here what it holds there.
    Only(BlockId),
    /// The values at the ends of `preds` meet in `param` of `block`. That of `preds[at]` is looked for.
    Join { block: BlockId, param: V, preds: Vec<BlockId>, at: usize, only: Option<V> },
}

pub struct FuncBuilder {
    pub func: Func,
    pub block: BlockId,
    pub pos: u32,
    states: Vec<BlockState>,
    /// By variable: what it holds, and what it probably holds. Where definitions meet, those are the type and the prediction of the
    /// block parameter.
    vars: Vec<(TyId, Prediction)>,
    stored: Vec<Stored>,
    homes: Vec<smallvec::SmallVec<[BlockId; 4]>>,
    /// By variable whose type has no room for `undefined`: see `start_var_as`.
    blanks: FxHashMap<Var, (Op, TyId)>,
    undefined: TyId,
}

impl FuncBuilder {
    /// `func` has no block yet. The entry block is made, current and sealed. `undefined`: the type of that.
    pub fn new(func: Func, undefined: TyId) -> FuncBuilder {
        let mut builder = FuncBuilder { func, block: BlockId(0), pos: 0, states: Vec::new(), vars: Vec::new(), stored: Vec::new(), homes: Vec::new(), blanks: FxHashMap::default(), undefined };
        let entry = builder.new_block();
        builder.seal(entry);
        builder
    }

    pub fn new_block(&mut self) -> BlockId {
        self.states.push(BlockState::default());
        self.func.add_block()
    }

    /// A variable that holds values of the type.
    pub fn new_var(&mut self, ty: TyId) -> Var {
        self.vars.push((ty, Prediction::None));
        self.stored.push(Stored::Never);
        self.homes.push(smallvec::SmallVec::new());
        Var(self.vars.len() as u32 - 1)
    }

    pub fn ty_of_var(&self, var: Var) -> TyId {
        self.vars[var.0 as usize].0
    }

    /// Before the variable is read.
    pub fn predict_var(&mut self, var: Var, prediction: Prediction) {
        self.vars[var.0 as usize].1 = prediction;
    }

    /// Before the variable is read: the constant that stands for it where nothing has been stored to it, and the type of that. It is of
    /// the type of the variable. Without this it is `undefined`.
    pub fn start_var_as(&mut self, var: Var, blank: Op, ty: TyId) {
        self.blanks.insert(var, (blank, ty));
    }

    /// A parameter of the block for the values of the variable that meet there.
    fn add_param_for(&mut self, var: Var, block: BlockId) -> V {
        let (ty, prediction) = self.vars[var.0 as usize];
        let param = self.func.add_param(block, ty);
        self.func.values[param.idx()].prediction = prediction;
        param
    }

    pub fn switch_to(&mut self, block: BlockId) {
        self.block = block;
    }

    /// Whether control cannot come to where the next operation would go: the current block has ended, or nothing goes to it and nothing will.
    pub fn is_dead_here(&self) -> bool {
        let state = &self.states[self.block.idx()];
        !self.is_open() || (self.block != crate::ir::Func::ENTRY && state.is_sealed && state.preds.is_empty())
    }

    /// Whether the current block still takes operations.
    pub fn is_open(&self) -> bool {
        self.func.blocks[self.block.idx()].term.is_none()
    }

    pub fn emit(&mut self, op: Op, ty: TyId) -> V {
        debug_assert!(self.is_open());
        self.func.append(self.block, op, self.pos, ty)
    }

    /// Ends the current block. Does nothing if it has ended.
    pub fn terminate(&mut self, term: Term) {
        if !self.is_open() {
            return;
        }
        let from = self.block;
        let term = if self.is_dead_here() { Term::Unreachable } else { term };
        term.for_each_target(|t| {
            debug_assert!(!self.states[t.block.idx()].is_sealed, "a sealed block gets no new predecessor");
            self.states[t.block.idx()].preds.push(from);
        });
        self.func.blocks[from.idx()].term = Some(term);
    }

    pub fn jump(&mut self, to: BlockId) {
        self.terminate(Term::Jump(Target::new(to)));
    }

    pub fn branch(&mut self, cond: V, then: BlockId, otherwise: BlockId) {
        self.terminate(Term::Branch { cond, then: Target::new(then), otherwise: Target::new(otherwise) });
    }

    /// The value is of the type of the variable: see `Build::write`.
    pub fn write(&mut self, var: Var, value: V) {
        self.states[self.block.idx()].defs.insert(var, value);
        self.note_home(var, self.block);
        self.stored[var.0 as usize] = match self.stored[var.0 as usize] {
            Stored::Never => Stored::Once(value, self.block),
            Stored::Once(_, home) if home == self.block && self.is_open() => Stored::Once(value, home),
            _ => Stored::Often,
        };
    }

    fn note_home(&mut self, var: Var, block: BlockId) {
        let homes = &mut self.homes[var.0 as usize];
        if homes.len() <= 8 && !homes.contains(&block) {
            homes.push(block);
        }
    }

    fn leap(&self, var: Var, block: BlockId) -> Leap {
        let homes = &self.homes[var.0 as usize];
        let (true, Some(here)) = (homes.len() <= 8, self.states[block.idx()].above) else {
            return Leap::No;
        };
        let mut nearest: Option<(u32, bool)> = None;
        for &home in homes {
            if self.states[home.idx()].above.is_none_or(|above| above.root != here.root) {
                continue;
            }
            let Some(meet) = self.lowest_common(home, block) else {
                continue;
            };
            if meet == block && home != block {
                continue;
            }
            let depth = self.states[meet.idx()].above.map_or(0, |above| above.depth);
            let level = if meet == home { (depth, true) } else { (depth + 1, false) };
            nearest = nearest.max(Some(level));
        }
        match nearest {
            None if here.root != block => Leap::To(here.root),
            None => Leap::No,
            Some((depth, _)) if depth >= here.depth => Leap::No,
            Some((depth, is_home)) => match (self.ancestor_at(block, depth), is_home) {
                (Some(home), true) => self.states[home.idx()].defs.get(&var).map_or(Leap::No, |&value| Leap::Value(value)),
                (Some(join), false) => Leap::To(join),
                (None, _) => Leap::No,
            },
        }
    }

    fn ancestor_at(&self, mut block: BlockId, depth: u32) -> Option<BlockId> {
        loop {
            let above = self.states[block.idx()].above?;
            if above.depth <= depth {
                return Some(block);
            }
            block = if self.states[above.jump.idx()].above?.depth >= depth { above.jump } else { above.parent };
        }
    }

    fn lowest_common(&self, a: BlockId, b: BlockId) -> Option<BlockId> {
        let depth = self.states[a.idx()].above?.depth.min(self.states[b.idx()].above?.depth);
        let (mut a, mut b) = (self.ancestor_at(a, depth)?, self.ancestor_at(b, depth)?);
        while a != b {
            let (above_a, above_b) = (self.states[a.idx()].above?, self.states[b.idx()].above?);
            if above_a.depth == 0 {
                return None;
            }
            (a, b) = if above_a.jump != above_b.jump { (above_a.jump, above_b.jump) } else { (above_a.parent, above_b.parent) };
        }
        Some(a)
    }

    fn place(&mut self, block: BlockId) {
        let preds = &self.states[block.idx()].preds;
        let mut parent = preds.first().copied().filter(|pred| self.states[pred.idx()].above.is_some());
        for &pred in preds.iter().skip(1) {
            parent = parent.and_then(|parent| self.lowest_common(parent, pred));
        }
        let placed = parent.and_then(|parent| {
            let above = self.states[parent.idx()].above?;
            let jump = self.states[above.jump.idx()].above?;
            let is_even = above.depth - jump.depth == jump.depth - self.states[jump.jump.idx()].above?.depth;
            Some(Above { parent, jump: if is_even { jump.jump } else { parent }, depth: above.depth + 1, root: above.root })
        });
        self.states[block.idx()].above = Some(placed.unwrap_or(Above { parent: block, jump: block, depth: 0, root: block }));
    }

    pub fn read(&mut self, var: Var) -> V {
        self.read_in(var, self.block)
    }

    /// The predecessors of the block, each once, in ascending order.
    fn preds_of(&self, block: BlockId) -> Vec<BlockId> {
        let mut preds = self.states[block.idx()].preds.clone();
        preds.sort_unstable();
        preds.dedup();
        preds
    }

    /// It keeps its own list of where it has to go on: a function has as many blocks in a row as it has statements.
    fn read_in(&mut self, var: Var, block: BlockId) -> V {
        if let Stored::Once(value, home) = self.stored[var.0 as usize]
            && let Some(above) = self.states[home.idx()].above
            && self.ancestor_at(block, above.depth) == Some(home)
        {
            return value;
        }
        let mut awaiting: Vec<Awaiting> = Vec::new();
        let mut found_held: FxHashSet<V> = FxHashSet::default();
        let mut block = block;
        loop {
            // Up from `block` to where the variable has a value.
            let mut with_one_pred_in_a_row = 0;
            let mut value = loop {
                if let Some(&v) = self.states[block.idx()].defs.get(&var) {
                    if !awaiting.is_empty() {
                        found_held.insert(v);
                    }
                    break v;
                }
                let asks = self.states[block.idx()].preds.len() != 1 || with_one_pred_in_a_row % 4 == 3;
                match if asks { self.leap(var, block) } else { Leap::No } {
                    Leap::Value(v) => {
                        if !awaiting.is_empty() {
                            found_held.insert(v);
                        }
                        break v;
                    }
                    Leap::To(root) => {
                        block = root;
                        continue;
                    }
                    Leap::No => {}
                }
                let (is_sealed, preds) = (self.states[block.idx()].is_sealed, self.states[block.idx()].preds.len());
                if !is_sealed {
                    let param = self.add_param_for(var, block);
                    self.states[block.idx()].incomplete.push((var, param));
                    self.states[block.idx()].defs.insert(var, param);
                    self.stored[var.0 as usize] = Stored::Often;
                    self.note_home(var, block);
                    break param;
                }
                // Or it has come round a circle of blocks that nothing leads into: a loop after a `return`. Each of those has one
                // predecessor: a block where several meet has a value for the variable from when the walk first passes it. The length of
                // `awaiting` does not tell: below such a block the walk passes the same blocks once more.
                if preds == 0 || with_one_pred_in_a_row > self.states.len() {
                    let pos = self.pos;
                    let (blank, ty) = self.blanks.get(&var).cloned().unwrap_or((Op::Undefined, self.undefined));
                    let v = self.func.add_value(blank, pos, ty);
                    self.func.blocks[block.idx()].ops.insert(0, v);
                    self.states[block.idx()].defs.insert(var, v);
                    self.stored[var.0 as usize] = Stored::Often;
                    self.note_home(var, block);
                    break v;
                }
                if preds == 1 {
                    with_one_pred_in_a_row += 1;
                    awaiting.push(Awaiting::Only(block));
                    block = self.states[block.idx()].preds[0];
                    continue;
                }
                let param = self.add_param_for(var, block);
                self.states[block.idx()].defs.insert(var, param);
                let preds = self.preds_of(block);
                let first = preds[0];
                awaiting.push(Awaiting::Join { block, param, preds, at: 0, only: None });
                block = first;
                with_one_pred_in_a_row = 0;
            };
            // Back down with it.
            loop {
                match awaiting.pop() {
                    None => return value,
                    Some(Awaiting::Only(below)) => {
                        self.states[below.idx()].defs.insert(var, value);
                    }
                    Some(Awaiting::Join { block: join, param, preds, at, only }) => {
                        self.pass(preds[at], join, value);
                        let only = if at == 0 { Some(value) } else { only.filter(|&only| only == value) };
                        if let Some(&next) = preds.get(at + 1) {
                            awaiting.push(Awaiting::Join { block: join, param, preds, at: at + 1, only });
                            block = next;
                            break;
                        }
                        value = match only {
                            Some(only) if only != param && !found_held.contains(&param) && self.takes_back(join, param, &preds) => {
                                self.states[join.idx()].defs.insert(var, only);
                                only
                            }
                            _ => {
                                self.stored[var.0 as usize] = Stored::Often;
                                self.note_home(var, join);
                                param
                            }
                        };
                    }
                }
            }
        }
    }

    fn takes_back(&mut self, block: BlockId, param: V, preds: &[BlockId]) -> bool {
        if self.func.blocks[block.idx()].params.last() != Some(&param) {
            return false;
        }
        self.func.blocks[block.idx()].params.pop();
        for pred in preds {
            if let Some(term) = &mut self.func.blocks[pred.idx()].term {
                term.for_each_target_mut(|t| {
                    if t.block == block {
                        t.args.pop();
                    }
                });
            }
        }
        if param.idx() + 1 == self.func.values.len() {
            self.func.values.pop();
        } else {
            let undefined = self.undefined;
            self.func.values[param.idx()] = crate::ir::Value { def: crate::ir::Def::Op(Op::Undefined), pos: 0, ty: undefined, prediction: Prediction::None, finds_initialized: false };
            self.func.blocks[block.idx()].ops.insert(0, param);
        }
        true
    }

    /// Passes the value as one more argument wherever `pred` goes on to `block`.
    fn pass(&mut self, pred: BlockId, block: BlockId, value: V) {
        if let Some(term) = &mut self.func.blocks[pred.idx()].term {
            term.for_each_target_mut(|t| {
                if t.block == block {
                    t.args.push(value);
                }
            });
        }
    }

    /// Passes the value of `var` at the end of each predecessor of `block` as one more argument.
    fn fill(&mut self, var: Var, block: BlockId) {
        for pred in self.preds_of(block) {
            let value = self.read_in(var, pred);
            self.pass(pred, block, value);
        }
    }

    /// Every predecessor of `block` has been terminated.
    pub fn seal(&mut self, block: BlockId) {
        if self.states[block.idx()].is_sealed {
            return;
        }
        self.states[block.idx()].is_sealed = true;
        self.place(block);
        let incomplete = std::mem::take(&mut self.states[block.idx()].incomplete);
        for (var, _) in incomplete {
            self.fill(var, block);
        }
    }

    /// A constant that every block can refer to.
    pub fn entry_constant(&mut self, op: Op, ty: TyId) -> V {
        let v = self.func.add_value(op, 0, ty);
        self.func.blocks[crate::ir::Func::ENTRY.idx()].ops.insert(0, v);
        v
    }

    pub fn has_preds(&self, block: BlockId) -> bool {
        !self.states[block.idx()].preds.is_empty()
    }

    pub fn finish(mut self) -> Func {
        for b in 0..self.func.blocks.len() {
            debug_assert!(self.states[b].is_sealed, "block {b} was never sealed");
            if self.func.blocks[b].term.is_none() {
                self.func.blocks[b].term = Some(Term::Unreachable);
            }
        }
        self.func
    }
}
