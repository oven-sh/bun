//! Builds one function in SSA form from code that assigns to variables.
//!
//! The construction is that of Braun et al., "Simple and Efficient Construction of Static Single Assignment Form", with block
//! parameters in the place of phi functions.

use crate::id::{BlockId, TyId, V};
use crate::ir::{Func, Op, Prediction, Target, Term};
use rustc_hash::FxHashMap;

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
}

/// Where `read_in` goes on once it has the value of the variable at the end of a predecessor.
enum Awaiting {
    /// The block has one predecessor: the variable holds here what it holds there.
    Only(BlockId),
    /// The values at the ends of `preds` meet in `param` of `block`. That of `preds[at]` is looked for.
    Join { block: BlockId, param: V, preds: Vec<BlockId>, at: usize },
}

pub struct FuncBuilder {
    pub func: Func,
    pub block: BlockId,
    pub pos: u32,
    states: Vec<BlockState>,
    /// By variable: what it holds, and what it probably holds. Where definitions meet, those are the type and the prediction of the
    /// block parameter.
    vars: Vec<(TyId, Prediction)>,
    /// By variable whose type has no room for `undefined`: see `start_var_as`.
    blanks: FxHashMap<Var, (Op, TyId)>,
    undefined: TyId,
}

impl FuncBuilder {
    /// `func` has no block yet. The entry block is made, current and sealed. `undefined`: the type of that.
    pub fn new(func: Func, undefined: TyId) -> FuncBuilder {
        let mut builder = FuncBuilder { func, block: BlockId(0), pos: 0, states: Vec::new(), vars: Vec::new(), blanks: FxHashMap::default(), undefined };
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
        let mut awaiting: Vec<Awaiting> = Vec::new();
        let mut block = block;
        loop {
            // Up from `block` to where the variable has a value.
            let mut with_one_pred_in_a_row = 0;
            let mut value = loop {
                if let Some(&v) = self.states[block.idx()].defs.get(&var) {
                    break v;
                }
                let (is_sealed, preds) = (self.states[block.idx()].is_sealed, self.states[block.idx()].preds.len());
                if !is_sealed {
                    let param = self.add_param_for(var, block);
                    self.states[block.idx()].incomplete.push((var, param));
                    self.states[block.idx()].defs.insert(var, param);
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
                awaiting.push(Awaiting::Join { block, param, preds, at: 0 });
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
                    Some(Awaiting::Join { block: join, param, preds, at }) => {
                        self.pass(preds[at], join, value);
                        if let Some(&next) = preds.get(at + 1) {
                            awaiting.push(Awaiting::Join { block: join, param, preds, at: at + 1 });
                            block = next;
                            break;
                        }
                        value = param;
                    }
                }
            }
        }
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
