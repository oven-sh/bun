//! Copies instructions and blocks, and then gives each use of a copied value the copy that reaches it.

use bun_engine_asm::Sign;

use super::Analyses;
use super::reaching::{Held, Reaching, Read};
use crate::analysis::Cfg;
use crate::ir::{
    Block, Builder, Edge, Entity, Exit, Function, Op, PatchpointFlags, State, Successor, Table,
    Type, Unary, Value, Variable, evaluate,
};

/// About the number of instructions that a copy takes, if one can be made.
fn cost_of_copy(function: &Function, value: Value) -> Option<u32> {
    const EXIT: u32 = 2;
    const PATCHPOINT: u32 = 4;
    match *function.op(value) {
        // No parameter can stand for it where it is taken apart.
        _ if function.type_of(value) == Type::Tuple && function.next(value).is_none() => None,
        Op::Patchpoint(patchpoint) => {
            let flags = function.patchpoint(patchpoint).flags;
            (!flags.contains(PatchpointFlags::UNIQUE)).then_some(PATCHPOINT)
        }
        Op::Check(..) | Op::Checked(..) | Op::Node { .. } | Op::WideNode { .. } => Some(EXIT),
        Op::Unary(
            Unary::Wrap | Unary::Widen(Sign::Unsigned) | Unary::Opaque | Unary::FitsIn(_),
            _,
        )
        | Op::Extract(..) => Some(0),
        _ => Some(1),
    }
}

/// About the number of instructions that a copy of the blocks takes, if one can be made and it is no more than `most`.
pub fn cost_of_copying(function: &Function, blocks: &[Block], most: u32) -> Option<u32> {
    let instructions = blocks
        .iter()
        .flat_map(|&block| function.instructions(block));
    instructions
        .map(|value| cost_of_copy(function, value))
        .try_fold(0, |sum, cost| Some(sum + cost?).filter(|&sum| sum <= most))
}

/// The edge, if its source only jumps, or else that of a new block in its middle.
pub(super) fn as_jump(function: &mut Function, edge: Edge) -> Edge {
    if *function.op(function.last(function.source(edge))) == Op::Jump {
        edge
    } else {
        let middle = function.split_edge(edge);
        function.successor(middle, 0)
    }
}

/// What a copy of some instructions would be like.
pub(super) struct Preview {
    /// Not counting the end of a block.
    pub(super) cost: u32,
    /// The edge that is certain to be taken, if the end of a block is included.
    pub(super) taken: Option<Edge>,
    /// Whether the last check that is certain to pass or to fail does the latter.
    pub(super) settled_check_fails: Option<bool>,
}

pub struct CopyOfLoop {
    pub header: Block,
    /// The edges from the copy to the header of the loop that was copied.
    pub returning: Vec<Edge>,
}

struct Copy {
    original: Value,
    block: Block,
    value: Value,
}

/// Until `repair_uses`, the function is not valid. What has been added since `new` cannot be copied.
pub struct Copier {
    /// For the values of the path or the loop that is being copied.
    stand_ins: Table<Value, Value>,
    with_stand_in: Vec<Value>,
    last_state: (State, State),
    /// Empty until a loop is copied.
    blocks: Table<Block, Block>,
    copies: Vec<Copy>,
    args: Vec<Value>,
}

#[derive(Clone, Copy)]
enum Use {
    Operand(Value),
    Arg(Edge),
    Kept(State),
}

impl Copier {
    pub fn new(function: &Function) -> Self {
        Self {
            stand_ins: function.value_table(Value::NONE),
            with_stand_in: Vec::new(),
            last_state: (State::NONE, State::NONE),
            blocks: Table::default(),
            copies: Vec::new(),
            args: Vec::new(),
        }
    }

    #[inline]
    pub(super) fn stand_in(&self, value: Value) -> Value {
        stand_in(&self.stand_ins, value)
    }

    pub(super) fn set_stand_in(&mut self, original: Value, value: Value) {
        self.stand_ins[original] = value;
        self.with_stand_in.push(original);
    }

    pub(super) fn forget_stand_ins(&mut self) {
        self.last_state = (State::NONE, State::NONE);
        for original in self.with_stand_in.drain(..) {
            self.stand_ins[original] = Value::NONE;
        }
    }

    fn constant(&self, function: &Function, value: Value) -> Option<u64> {
        function.constant_bits(self.stand_in(value))
    }

    // Paths: series of blocks, each a successor of the one before, that are copied to the end of one block

    /// Leaves stand-ins for what is constant. `None` if the instructions are many or cannot be copied.
    pub(super) fn preview(
        &mut self,
        function: &mut Function,
        first: Value,
        last: Value,
    ) -> Option<Preview> {
        const MOST_INSTRUCTIONS: usize = 8;
        let mut preview = Preview {
            cost: 0,
            taken: None,
            settled_check_fails: None,
        };
        let (mut value, block) = (first, function.block_of(first));
        for _ in 0..MOST_INSTRUCTIONS {
            let (cost, ty) = (cost_of_copy(function, value)?, function.type_of(value));
            if ty == Type::Tuple {
                return None;
            }
            if value == function.last(block) {
                preview.taken = self.successor_taken(function, block);
            } else if let Op::Check(condition, _) = *function.op(value)
                && let Some(bits) = self.constant(function, condition)
            {
                preview.settled_check_fails = Some(bits != 0);
                preview.cost += if bits == 0 { 0 } else { cost };
            } else if let Some(bits) = self.fold(function, value) {
                let constant = function.constant(ty, bits);
                self.set_stand_in(value, constant);
            } else {
                preview.cost += cost;
            }
            if value == last {
                return Some(preview);
            }
            value = function.next(value);
        }
        None
    }

    /// Of the target of the edge, which leaves the path that has been previewed so far.
    pub(super) fn preview_target(
        &mut self,
        function: &mut Function,
        edge: Edge,
    ) -> Option<Preview> {
        let target = function.target(edge);
        for (&param, &arg) in function.params(target).iter().zip(function.args(edge)) {
            self.set_stand_in(param, self.stand_in(arg));
        }
        self.preview(function, function.first(target), function.last(target))
    }

    fn fold(&self, function: &Function, value: Value) -> Option<u64> {
        let (of, ty) = (
            |operand| self.constant(function, operand),
            |value| function.type_of(value),
        );
        match *function.op(value) {
            Op::Unary(Unary::Opaque, _) => None,
            Op::Unary(op, a) => evaluate::unary(op, ty(a), ty(value), of(a)?),
            Op::Binary(op, [a, b]) => evaluate::binary(op, ty(value), of(a)?, of(b)?),
            Op::Checked(op, [a, b], _) => evaluate::checked(op, ty(value), of(a)?, of(b)?),
            Op::Compare(cond, [a, b]) => {
                Some(evaluate::compare(cond, ty(a), of(a)?, of(b)?).into())
            }
            Op::FloatCompare(cond, [a, b]) => {
                Some(evaluate::float_compare(cond, ty(a), of(a)?, of(b)?).into())
            }
            Op::Select([condition, then, or]) => of(if of(condition)? != 0 { then } else { or }),
            _ => None,
        }
    }

    fn successor_taken(&self, function: &Function, block: Block) -> Option<Edge> {
        let position = match *function.op(function.last(block)) {
            Op::Jump => 0,
            Op::Branch(condition) => usize::from(self.constant(function, condition)? == 0),
            Op::Switch(subject, cases) => {
                let (key, keys) = (
                    function.int_constant(self.stand_in(subject))?,
                    function.cases(cases),
                );
                let found = keys.iter().position(|&other| other == key);
                found.unwrap_or(keys.len())
            }
            Op::JumpTable(index, cases) => {
                let index = self.constant(function, index)?;
                *function.cases(cases).get(index as usize)? as usize
            }
            _ => return None,
        };
        Some(function.successor(block, position))
    }

    /// Replaces the jump along `edge` with all instructions of its target but the last.
    pub(super) fn copy_body(&mut self, function: &mut Function, edge: Edge) {
        let (into, from) = (function.source(edge), function.target(edge));
        for (&param, &arg) in function.params(from).iter().zip(function.args(edge)) {
            self.set_stand_in(param, arg);
        }
        function.remove(function.last(into));
        self.copy_body_from(function, function.first(from), into);
    }

    /// Up to the end of the block, which is not included.
    pub(super) fn copy_body_from(&mut self, function: &mut Function, first: Value, into: Block) {
        let (mut value, end) = (first, function.last(function.block_of(first)));
        while value != end {
            self.copy_instruction(function, value, into);
            value = function.next(value);
        }
    }

    /// Follows the body. `taken` is the edge that the block is certain to take.
    pub(super) fn copy_end(
        &mut self,
        function: &mut Function,
        from: Block,
        into: Block,
        taken: Option<Edge>,
    ) {
        let end = function.last(from);
        let Some(taken) = taken else {
            self.copy_instruction(function, end, into);
            function.clear_successors(into);
            for edge in function.successors(from) {
                self.copy_edge(function, edge, into);
            }
            return;
        };
        function.append(into, Op::Jump, Type::Void, function.origin(end));
        function.clear_successors(into);
        let edge = self.copy_edge(function, taken, into);
        function.set_rare(edge, false);
    }

    pub(super) fn end_path(&mut self, into: Block) {
        self.note_copies(0, into);
        self.forget_stand_ins();
    }

    // Loops

    /// One more turn of a natural loop, whose blocks are given in order and can be copied. `entering` is an edge to the
    /// header from elsewhere, which now goes to the copy. Without it, the copy of the header has parameters.
    pub fn copy_loop(
        &mut self,
        function: &mut Function,
        blocks: &[Block],
        entering: Option<Edge>,
    ) -> CopyOfLoop {
        let header = blocks[0];
        if self.blocks.len() == 0 {
            take_tuples_apart_at_once(function);
        }
        self.blocks.grow_to(function.block_count(), Block::NONE);
        for &block in blocks {
            let (copy, noted) = (function.new_block(), self.with_stand_in.len());
            self.blocks[block] = copy;
            let entering = entering.filter(|_| block == header);
            for position in 0..function.params(block).len() {
                let param = function.params(block)[position];
                let stand_in = match entering {
                    Some(edge) => function.args(edge)[position],
                    None => function.add_param(copy, function.type_of(param)),
                };
                self.set_stand_in(param, stand_in);
            }
            self.note_copies(noted, copy);
        }
        let mut result = CopyOfLoop {
            header: self.blocks[header],
            returning: Vec::new(),
        };
        if let Some(edge) = entering {
            function.redirect(edge, result.header, &[]);
        }
        for &block in blocks {
            let (copy, noted) = (self.blocks[block], self.with_stand_in.len());
            self.copy_body_from(function, function.first(block), copy);
            let taken = self.successor_taken(function, block);
            self.copy_end(function, block, copy, taken);
            self.note_copies(noted, copy);
            for edge in function.successors(copy) {
                let target = function.target(edge);
                if target == header {
                    result.returning.push(edge);
                } else if target.index() < self.blocks.len() && !self.blocks[target].is_none() {
                    function.set_target(edge, self.blocks[target]);
                }
            }
        }
        for &block in blocks {
            self.blocks[block] = Block::NONE;
        }
        self.forget_stand_ins();
        result
    }

    // Parts

    fn note_copies(&mut self, from: usize, block: Block) {
        let copies = self.with_stand_in[from..].iter().map(|&original| Copy {
            original,
            block,
            value: self.stand_ins[original],
        });
        self.copies.extend(copies);
    }

    fn copy_edge(&mut self, function: &mut Function, edge: Edge, into: Block) -> Edge {
        self.args.clear();
        let args = function.args(edge).iter();
        self.args
            .extend(args.map(|&arg| stand_in(&self.stand_ins, arg)));
        let successor = Successor {
            target: function.target(edge),
            args: &self.args,
            is_rare: function.is_rare(edge),
        };
        function.push_successor(into, successor)
    }

    fn copy_instruction(&mut self, function: &mut Function, value: Value, into: Block) {
        let (ty, origin) = (function.type_of(value), function.origin(value));
        let state = self.copy_state(function, function.state_of(value));
        let op = function.clone_op(value);
        let mut builder = Builder::at_end(function, into);
        builder.origin = origin;
        let new = |operand| self.stand_in(operand);
        let copy = match op {
            Op::Unary(op, a) => builder.convert(op, ty, new(a)),
            // A constant would not stay below the checks, with what is computed from it.
            Op::Binary(op, [a, b]) if !op.is_partial() => builder.binary(op, new(a), new(b)),
            Op::Compare(cond, [a, b]) => builder.compare(cond, new(a), new(b)),
            Op::FloatCompare(cond, [a, b]) => builder.float_compare(cond, new(a), new(b)),
            Op::Select([condition, then, or]) => builder.select(new(condition), new(then), new(or)),
            Op::Check(condition, exit) => {
                return builder.check(new(condition), Exit { state, ..exit });
            }
            _ => {
                let copy = builder.insert(op, ty);
                for operand in function.operands_mut(copy) {
                    *operand = new(*operand);
                }
                if !state.is_none() {
                    function.set_state_of(copy, state);
                }
                copy
            }
        };
        if ty != Type::Void {
            self.set_stand_in(value, copy);
        }
    }

    fn copy_state(&mut self, function: &mut Function, state: State) -> State {
        if state != self.last_state.0 {
            let values = function.state(state);
            let changes = values.iter().any(|&value| self.stand_in(value) != value);
            let copy = if changes {
                function.map_state(state, |value| stand_in(&self.stand_ins, value))
            } else {
                state
            };
            self.last_state = (state, copy);
        }
        self.last_state.1
    }

    pub fn repair_uses(self, function: &mut Function, analyses: &mut Analyses) {
        analyses.invalidate();
        if self.copies.is_empty() {
            return;
        }
        let (cfg, dominators) = analyses.dominators(function);
        let mut reaching = Reaching::new(cfg, dominators);
        let mut variables = Table::filled(self.stand_ins.len(), Variable::NONE);
        for &Copy { original, .. } in &self.copies {
            if variables[original].is_none() {
                variables[original] = reaching.add_variable(function.type_of(original));
                let home = function.block_of(original);
                if cfg.is_reachable(home) {
                    reaching.define(variables[original], home, Held::Value(original));
                }
            }
        }
        for copy in &self.copies {
            if cfg.is_reachable(copy.block) {
                let held = match variable_of(&variables, copy.value) {
                    Some(other) if function.block_of(copy.value) != copy.block => {
                        Held::AnswerTo(reaching.read(other, copy.block))
                    }
                    _ => Held::Value(copy.value),
                };
                reaching.define(variables[copy.original], copy.block, held);
            }
        }
        let uses = find_uses(function, cfg, &variables, &mut reaching);
        reaching.solve(function);
        for (user, position, read) in uses {
            let values = match user {
                Use::Operand(value) => function.operands_mut(value),
                Use::Arg(edge) => function.args_mut(edge),
                Use::Kept(state) => function.state_mut(state),
            };
            values[position as usize] = reaching.answer(read);
        }
    }
}

fn take_tuples_apart_at_once(function: &mut Function) {
    for value in (0..function.value_count()).map(Value::from_index) {
        if let Op::Extract(tuple, _) = *function.op(value)
            && function.block_of(value) != function.block_of(tuple)
            && let Some(next) = function.next(tuple).expand()
        {
            function.move_before(value, next);
        }
    }
}

#[inline]
fn stand_in(stand_ins: &Table<Value, Value>, value: Value) -> Value {
    if value.index() < stand_ins.len() && !stand_ins[value].is_none() {
        stand_ins[value]
    } else {
        value
    }
}

#[inline]
fn variable_of(variables: &Table<Value, Variable>, value: Value) -> Option<Variable> {
    if value.index() < variables.len() {
        variables[value].expand()
    } else {
        None
    }
}

/// Those outside the block of the value. A state that has such values is used in one block only from now on.
fn find_uses(
    function: &mut Function,
    cfg: &Cfg,
    variables: &Table<Value, Variable>,
    reaching: &mut Reaching<'_>,
) -> Vec<(Use, u32, Read)> {
    let mut uses = Vec::new();
    let mut note = |function: &Function, block: Block, user: Use, values: &[Value]| {
        let mut found_any = false;
        for (position, &value) in (0..).zip(values) {
            if let Some(variable) = variable_of(variables, value) {
                found_any = true;
                if function.block_of(value) != block {
                    uses.push((user, position, reaching.read(variable, block)));
                }
            }
        }
        found_any
    };
    let mut last_users = Table::filled(function.state_count(), (Block::NONE, State::NONE));
    for &block in cfg.order() {
        let mut value = function.first(block);
        while !value.is_none() {
            note(
                function,
                block,
                Use::Operand(value),
                function.operands(value),
            );
            if let Some(state) = function.state_of(value).expand() {
                let (last_user, own) = &mut last_users[state];
                if own.is_none() {
                    *own = state;
                    if note(function, block, Use::Kept(state), function.state(state)) {
                        *last_user = block;
                    }
                } else if !last_user.is_none() {
                    if *last_user != block {
                        (*last_user, *own) = (block, function.map_state(state, |kept| kept));
                        note(function, block, Use::Kept(*own), function.state(*own));
                    }
                    function.set_state_of(value, *own);
                }
            }
            value = function.next(value);
        }
        for edge in function.successors(block) {
            note(function, block, Use::Arg(edge), function.args(edge));
        }
    }
    uses
}
