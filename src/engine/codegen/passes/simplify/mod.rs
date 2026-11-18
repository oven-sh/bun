//! Replaces operations by cheaper ones, and values by others that are known to be equal.
//!
//! One walk over the tree of dominators comes to definitions before their uses and, where loops have one entry, to a
//! block after all its predecessors but those in the loop that it heads. Uses are counted, so what loses its last one
//! goes at once, and rules can tell whether an operand goes away with the instruction that they rewrite.

mod arithmetic;
mod bitwise;
mod blocks;
mod bytes;
mod checked;
mod comparisons;
mod conditions;
mod control;
mod conversions;
mod demanded;
mod division;
mod facts;
mod float_comparisons;
mod floats;
mod knowledge;
mod memory;
mod numbering;
mod params;
mod promises;
mod rewrite;
mod selects;
mod shifts;
mod shuffles;
mod vectors;
mod writes;

use self::facts::Facts;
use self::numbering::{Numbering, Reading, is_expression};
use self::promises::makes_promise;
use self::rewrite::Step;
use self::writes::Writes;
use super::Analyses;
use crate::analysis::{Cfg, Dominators};
use crate::bitset::BitSet;
use crate::ir::{
    Access, AccessFlags, Block, Checked, Edge, Function, Heap, Load, Op, State, Store, Table, Type,
    Value,
};
use crate::target::Target;

#[derive(Clone, Copy, Default)]
struct ValueInfo {
    uses: u32,
    /// The position in `Tables::facts` plus one.
    facts: u32,
    /// The position of the walk up to which a branch or check has decided whether the value is zero.
    decided_until: u32,
    /// For what depends on memory, the time according to [`Writes::now`]. For a parameter, see `params`.
    mark: u32,
    /// The position of the walk, plus one, at which it was last seen as an argument.
    last_passed: u32,
    is_zero: bool,
    is_in_state: bool,
    /// A branch or check has decided a comparison that has this value on the left.
    is_compared: bool,
    /// Can now be computed where the client did not expect it to be when it marked loads as `ALWAYS_READABLE`.
    is_set_free: bool,
}

/// Kept from one function to the next for their allocations.
#[derive(Default)]
pub(super) struct Tables {
    values: Table<Value, ValueInfo>,
    facts: Vec<Facts>,
    state_users: Table<State, u32>,
    numbering: Numbering,
    writes: Writes,
    /// An edge from a block that can be reached leads here.
    entered: BitSet,
    /// May have no use left.
    doomed: Vec<Value>,
    edges: Vec<Edge>,
    list: Vec<Value>,
    signatures: Vec<(u32, u32)>,
    predecessor_counts: Table<Block, u32>,
    #[cfg(debug_assertions)]
    pub(super) fired_rules: Option<Vec<&'static core::panic::Location<'static>>>,
}

struct Simplifier<'a> {
    function: &'a mut Function,
    cfg: &'a Cfg,
    dominators: &'a Dominators,
    target: Target,
    effort: Effort,
    tables: Tables,
    block: Block,
    /// Of the block in the walk.
    position: u32,
    end_of_subtree: u32,
    /// New instructions go before it.
    cursor: Value,
    /// How many more rules may be applied for the sake of the instruction at the cursor.
    budget: u32,
    /// The copy of the operation at the cursor may differ from the original.
    has_touched_operands: bool,
    changed_control: bool,
    may_be_untidy: bool,
    /// A value has been replaced after some of its uses were visited.
    left_aliases: bool,
    left_aliases_in_states: bool,
    changed_args_in_loops: bool,
    would_find_more: bool,
    has_promises: bool,
    has_set_free: bool,
    /// What has been set free has gone back to the start of a loop.
    withdraws_all_promises: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Effort {
    Low,
    High,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, target: Target) {
    const MOST_WALKS: usize = 3;
    if analyses.simplified_at == Some(function.revision()) {
        return;
    }
    if (0..MOST_WALKS).any(|_| !walk_once(function, analyses, target, Effort::High)) {
        analyses.cfg(function);
        analyses.simplified_at = Some(function.revision());
    }
}

/// Returns whether another walk would find more.
pub(super) fn walk_once(
    function: &mut Function,
    analyses: &mut Analyses,
    target: Target,
    effort: Effort,
) -> bool {
    let tables = core::mem::take(&mut analyses.simplify);
    let (cfg, dominators) = analyses.dominators(function);
    let mut simplifier = Simplifier {
        function,
        cfg,
        dominators,
        target,
        effort,
        tables,
        block: Block::NONE,
        position: 0,
        end_of_subtree: 0,
        cursor: Value::NONE,
        budget: 0,
        has_touched_operands: false,
        changed_control: false,
        may_be_untidy: false,
        left_aliases: false,
        left_aliases_in_states: false,
        changed_args_in_loops: false,
        would_find_more: false,
        has_promises: false,
        has_set_free: false,
        withdraws_all_promises: false,
    };
    simplifier.run();
    let (changed_control, would_find_more) =
        (simplifier.changed_control, simplifier.would_find_more);
    analyses.simplify = simplifier.tables;
    if changed_control {
        analyses.invalidate();
    }
    would_find_more
}

impl Simplifier<'_> {
    fn run(&mut self) {
        self.count_uses();
        if self.effort == Effort::High {
            self.replace_cycles_of_params();
        }
        self.walk();
        self.keep_promises();
        if self.effort == Effort::High
            && self.changed_args_in_loops
            && self.replace_cycles_of_params()
        {
            (self.left_aliases, self.would_find_more) = (true, true);
        }
        if self.changed_control || self.may_be_untidy {
            self.tidy_blocks();
        }
        if self.left_aliases {
            self.function.resolve_aliases();
        } else if self.left_aliases_in_states {
            for state in self.tables.state_users.keys() {
                if self.tables.state_users[state] != 0 {
                    self.function.resolve_state(state);
                }
            }
        }
    }

    /// Also removes what is not used, so that it does not stand in for a later instruction that computes the same.
    fn count_uses(&mut self) {
        let (function, tables, cfg) = (&mut *self.function, &mut self.tables, self.cfg);
        tables
            .values
            .refill(function.value_count(), ValueInfo::default());
        tables.facts.clear();
        tables.facts.extend(knowledge::COMMON);
        tables.state_users.refill(function.state_count(), 0);
        tables.writes.reset(function, cfg);
        tables.entered.reset(function.block_count());
        let mut to_number = 0;
        for &block in cfg.order().iter().rev() {
            for edge in function.successors(block) {
                tables.count(function.args(edge));
            }
            let mut next = function.last(block);
            while let Some(value) = next.expand() {
                next = function.previous(value);
                let is_used = tables.values[value].uses != 0;
                match function.op(value) {
                    Op::Binary(_, args) | Op::Compare(_, args) if is_used => tables.count(args),
                    &Op::Unary(_, arg) if is_used => tables.count(&[arg]),
                    &Op::Check(condition, exit) => {
                        tables.count(&[condition]);
                        tables.count_state(function, exit.state);
                        continue;
                    }
                    &Op::Checked(_, args, exit) => {
                        tables.count(&args);
                        tables.count_state(function, exit.state);
                    }
                    &Op::Load {
                        address, access, ..
                    } if !access.has(AccessFlags::ATOMIC)
                        && (is_used || access.has(AccessFlags::TRAPS)) =>
                    {
                        self.has_promises |= access.has(AccessFlags::ALWAYS_READABLE);
                        tables.count(&[address]);
                    }
                    Op::Store { args, access, .. } if !access.has(AccessFlags::ATOMIC) => {
                        tables.writes.expect(function, access.heap());
                        tables.count(args);
                    }
                    &Op::Branch(condition) => {
                        tables.count(&[condition]);
                        continue;
                    }
                    Op::Jump => continue,
                    op => {
                        let effects = function.effects(value);
                        if !is_used && !effects.must_execute() {
                            function.remove(value);
                            continue;
                        }
                        if effects.writes_memory() {
                            tables.writes.expect(function, effects.writes);
                        }
                        self.has_promises |= makes_promise(op);
                        tables.count(function.operands(value));
                        tables.count_state(function, function.state_of(value));
                    }
                }
                to_number += 1;
            }
            tables.writes.sum_up(cfg, self.dominators, block);
            if !function.params(block).is_empty() && cfg.loop_headed_by(block).is_none() {
                drop_unused_params(function, tables, cfg, block);
            }
        }
        tables.numbering.reset(to_number);
        self.has_promises &= !function.only_nodes_make_readable;
    }

    fn walk(&mut self) {
        let order = self.dominators.pre_order();
        while let Some(&block) = order.get(self.position as usize) {
            (self.block, self.end_of_subtree) = (block, self.dominators.end_of_subtree(block));
            if !self.enter_block() {
                let subtree = &order[self.position as usize..self.end_of_subtree as usize];
                self.discard_blocks(subtree);
                self.position = self.end_of_subtree;
                continue;
            }
            let mut value = self.function.first(block);
            while !self.function.next(value).is_none() {
                value = self.visit(value);
            }
            self.visit_end(value);
            self.tables.writes.leave(block);
            self.position += 1;
        }
    }

    #[inline(always)]
    fn point_at(&mut self, value: Value) {
        const BUDGET: u32 = 40;
        (self.cursor, self.budget) = (value, BUDGET);
        if self.has_set_free {
            self.follow_what_is_set_free(value);
        }
    }

    #[inline(always)]
    fn resolved(&mut self, value: Value) -> Value {
        match *self.function.op(value) {
            Op::Alias(replacement) => {
                self.has_touched_operands = true;
                self.function.resolve(replacement)
            }
            _ => value,
        }
    }

    /// Returns the next instruction. What is most frequent gets code in which the kind of operation is known.
    #[inline]
    fn visit(&mut self, value: Value) -> Value {
        self.point_at(value);
        // A loop may have asked before the operands were visited.
        self.tables.values[value].facts = 0;
        let ty = self.type_of(value);
        match *self.function.op(value) {
            Op::Binary(op, [a, b]) => {
                let mut args = [self.resolved(a), self.resolved(b)];
                if op.is_commutative() {
                    self.put_in_order(&mut args);
                }
                let rules = |this: &mut Self| this.binary(op, ty, args[0], args[1]);
                self.visit_expression(value, Op::Binary(op, args), ty, rules);
            }
            Op::Compare(mut cond, [a, b]) => {
                let mut args = [self.resolved(a), self.resolved(b)];
                if self.put_in_order(&mut args) {
                    cond = cond.commuted();
                }
                let rules = |this: &mut Self| this.compare(cond, args[0], args[1]);
                self.visit_expression(value, Op::Compare(cond, args), ty, rules);
            }
            Op::Unary(op, a) => {
                let a = self.resolved(a);
                let rules = |this: &mut Self| this.unary(op, ty, a);
                self.visit_expression(value, Op::Unary(op, a), ty, rules);
            }
            Op::Check(condition, exit) => {
                let op = Op::Check(self.resolved(condition), exit);
                self.visit_resolved(value, op, ty);
            }
            Op::Checked(op, [a, b], exit) => {
                let op = Op::Checked(op, [self.resolved(a), self.resolved(b)], exit);
                self.visit_resolved(value, op, ty);
            }
            Op::Load {
                kind,
                address,
                offset,
                access,
            } => {
                let address = self.resolved(address);
                self.visit_resolved(
                    value,
                    Op::Load {
                        kind,
                        address,
                        offset,
                        access,
                    },
                    ty,
                );
            }
            Op::Store {
                kind,
                args: [stored, address],
                offset,
                access,
            } => {
                let args = [self.resolved(stored), self.resolved(address)];
                self.visit_resolved(
                    value,
                    Op::Store {
                        kind,
                        args,
                        offset,
                        access,
                    },
                    ty,
                );
            }
            Op::Patchpoint(_) => {
                self.function.resolve_operands(value);
                self.note_writes(value);
            }
            _ => {
                self.function.resolve_operands(value);
                let mut op = self.op(value);
                let step = self.step(&mut op, ty);
                *self.function.op_mut(value) = op;
                self.follow_rules(value, step);
            }
        }
        self.remove_unused();
        self.function.next(value)
    }

    /// What has been seen before need not go through the rules again.
    #[inline(always)]
    fn visit_expression(
        &mut self,
        value: Value,
        op: Op,
        ty: Type,
        rules: impl FnOnce(&mut Self) -> Step,
    ) {
        if self.has_touched_operands {
            *self.function.op_mut(value) = op;
            self.has_touched_operands = false;
        }
        let vacancy = match self.find_expression(&op, ty) {
            Ok(known) => return self.replace(value, known),
            Err(vacancy) => vacancy,
        };
        match rules(self) {
            Step::Keep if self.tables.numbering.is_still_vacant(&vacancy) => {
                self.tables.numbering.add(&vacancy, value);
            }
            step => self.follow_rules(value, step),
        }
    }

    #[inline(always)]
    fn visit_resolved(&mut self, value: Value, mut op: Op, ty: Type) {
        let step = self.apply_rule(&mut op, ty);
        if self.has_touched_operands {
            *self.function.op_mut(value) = op;
            self.has_touched_operands = false;
        }
        if let Step::Keep = step {
            self.number(value, op, ty);
        } else {
            self.follow_rules(value, step);
        }
    }

    fn follow_rules(&mut self, value: Value, mut step: Step) {
        let ty = self.type_of(value);
        loop {
            match step {
                Step::Keep => return self.number(value, self.op(value), ty),
                Step::To(mut op) => {
                    self.change(value, op);
                    step = self.step(&mut op, ty);
                    *self.function.op_mut(value) = op;
                }
                Step::Is(other) => return self.replace(value, other),
                Step::Gone => return self.discard(value),
                Step::Exits(exit) => return self.end_block_at(value, exit),
            }
        }
    }

    #[inline(always)]
    fn number(&mut self, value: Value, op: Op, ty: Type) {
        let found = match op {
            Op::Check(condition, _) => return self.decide(condition, true),
            Op::Load {
                kind,
                address,
                offset,
                access,
            } if !access.has(AccessFlags::ATOMIC) => {
                let reading = Reading {
                    kind,
                    address,
                    offset,
                    ty,
                };
                return self.number_load(value, reading, access.heap());
            }
            Op::Store {
                kind: Store::Full,
                args,
                offset,
                access,
            } if !access.has(AccessFlags::ATOMIC) => {
                return self.number_store(value, args, offset, access);
            }
            Op::Checked(..) => self.find_expression(&op, ty),
            _ if is_expression(&op) => self.find_expression(&op, ty),
            _ => return self.number_by_key(value, op, ty),
        };
        match found {
            Ok(known) => {
                self.hit();
                self.replace(value, known);
            }
            Err(vacancy) => self.tables.numbering.add(&vacancy, value),
        }
    }

    fn number_by_key(&mut self, value: Value, op: Op, ty: Type) {
        let Some(key) = numbering::key(self.function, op) else {
            return self.note_writes(value);
        };
        match self.find_by_key(key, ty) {
            Ok(_) if ty == Type::Void => {
                self.hit();
                self.discard(value);
            }
            Ok(known) => {
                self.hit();
                self.replace(value, known);
            }
            Err(vacancy) => self.add_with_time(&vacancy, value),
        }
    }

    fn number_load(&mut self, load: Value, reading: Reading, heap: Heap) {
        match self.find_reading(reading, heap) {
            Ok(found) => {
                self.hit();
                self.set_free_if_stored(load, reading, found);
                self.replace(load, found);
            }
            Err(vacancy) => self.add_with_time(&vacancy, load),
        }
    }

    fn number_store(&mut self, store: Value, args: [Value; 2], offset: i32, access: Access) {
        let ([stored, address], heap) = (args, access.heap());
        let (kind, ty) = (Load::Full, self.type_of(stored));
        let reading = Reading {
            kind,
            address,
            offset,
            ty,
        };
        let before = self.find_reading(reading, heap);
        if matches!(before, Ok(found) if found == stored) && !access.has(AccessFlags::TRAPS) {
            self.hit();
            return self.discard(store);
        }
        self.tables.writes.write(heap);
        let after = match before {
            Ok(_) => self.find_reading(reading, heap),
            not_found => not_found,
        };
        if let Err(vacancy) = after {
            self.add_with_time(&vacancy, store);
        }
    }

    fn note_writes(&mut self, value: Value) {
        let effects = self.function.effects(value);
        if effects.writes_memory() {
            self.tables.writes.write(effects.writes);
        }
    }

    fn step(&mut self, op: &mut Op, ty: Type) -> Step {
        if self.budget == 0 {
            return Step::Keep;
        }
        self.budget -= 1;
        self.apply_rule(op, ty)
    }

    /// Puts the operands in their order first.
    #[inline(always)]
    fn apply_rule(&mut self, op: &mut Op, ty: Type) -> Step {
        match op {
            Op::Binary(op, args) => {
                if op.is_commutative() {
                    self.put_in_order(args);
                }
                self.binary(*op, ty, args[0], args[1])
            }
            Op::Compare(cond, args) => {
                if self.put_in_order(args) {
                    *cond = cond.commuted();
                }
                self.compare(*cond, args[0], args[1])
            }
            Op::FloatCompare(cond, args) => {
                if self.put_in_order(args) {
                    *cond = cond.commuted();
                }
                self.float_compare(*cond, args[0], args[1])
            }
            Op::Checked(op, args, exit) => {
                if *op != Checked::Sub {
                    self.put_in_order(args);
                }
                self.checked(*op, ty, args[0], args[1], *exit)
            }
            Op::VectorBinary(op, args) => {
                if op.is_commutative() {
                    self.put_in_order(args);
                }
                self.vector_binary(*op, args[0], args[1])
            }
            Op::MulWide(_, args) => {
                self.put_in_order(args);
                Step::Keep
            }
            _ => self.step_without_order(*op, ty),
        }
    }

    #[inline(always)]
    fn step_without_order(&mut self, op: Op, ty: Type) -> Step {
        match op {
            Op::Unary(op, a) => self.unary(op, ty, a),
            Op::Select([condition, then, or]) => self.select(ty, condition, then, or),
            Op::Extract(tuple, position) => self.extract(tuple, position),
            Op::Load { .. }
            | Op::Store { .. }
            | Op::LoadLane { .. }
            | Op::StoreLane { .. }
            | Op::AtomicUpdate { .. }
            | Op::AtomicCompareExchange { .. } => self.access(op),
            Op::Check(condition, exit) => self.check(condition, exit),
            Op::VectorUnary(op, a) => self.vector_unary(op, a),
            Op::VectorTernary(op, args) => self.vector_ternary(op, args),
            Op::VectorShift(op, [a, amount]) => self.vector_shift(op, a, amount),
            Op::VectorReduce(op, a) => self.vector_reduce(op, a),
            Op::Shuffle([a, b], pattern) => self.shuffle(a, b, pattern),
            Op::Splat(lanes, scalar) => self.splat(lanes, scalar),
            Op::ExtractLane {
                lanes,
                sign,
                lane,
                vector,
            } => self.extract_lane(lanes, sign, lane, vector),
            Op::ReplaceLane {
                lanes,
                lane,
                args: [vector, scalar],
            } => self.replace_lane(lanes, lane, vector, scalar),
            _ => Step::Keep,
        }
    }
}

impl Tables {
    #[inline(always)]
    fn count(&mut self, used: &[Value]) {
        for &value in used {
            self.values[value].uses += 1;
        }
    }

    #[inline]
    fn count_state(&mut self, function: &Function, state: State) {
        if state.is_none() {
            return;
        }
        self.state_users[state] += 1;
        if self.state_users[state] == 1 {
            for &value in function.state(state) {
                let info = &mut self.values[value];
                (info.uses, info.is_in_state) = (info.uses + 1, true);
            }
        }
    }
}

/// The arguments have not been counted yet.
fn drop_unused_params(function: &mut Function, tables: &Tables, cfg: &Cfg, block: Block) {
    let incoming = cfg.predecessors(block);
    let is_used = |param: Value| tables.values[param].uses != 0;
    if incoming.is_empty() || function.params(block).iter().all(|&param| is_used(param)) {
        return;
    }
    for position in 0..function.params(block).len() {
        let param = function.params(block)[position];
        if !is_used(param) {
            function.remove_param(param);
        }
    }
    function.drop_dead_params(block, incoming);
}
