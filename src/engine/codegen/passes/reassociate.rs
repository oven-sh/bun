//! Regroups trees of one associative operation on integers: what cancels out goes, pairs of shifts become rotations,
//! what a loop does not change comes together, and what is ready last is taken in last.

use bun_engine_asm::Sign;
use smallvec::SmallVec;

use super::Analyses;
use crate::analysis::Cfg;
use crate::ir::Binary::{Add, And, Mul, Or, RotateRight, Shl, Shr, Sub, Xor};
use crate::ir::{
    Binary, Block, Builder, Entity, Function, Op, State, Table, Type, Unary, Value, evaluate,
};
use crate::target::Target;

const MOST_LEAVES: usize = 32;
/// All leaves are live where the new tree is built.
const MOST_LEAVES_TO_SAVE_TIME: usize = 8;

#[derive(Clone, Copy, Default)]
struct ValueInfo {
    uses: u32,
    /// The last user is in the same block and of the same family.
    is_used_by_kin: bool,
    /// In cycles from the start of the block.
    ready: u32,
}

/// Terms are joined in this order.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Rank {
    /// It is what the tree gave in the previous turn of the loop.
    closes_cycle: bool,
    /// Of the loop in which it is computed.
    depth: u32,
    ready: u32,
}

#[derive(Clone, Copy)]
struct Term {
    value: Value,
    is_subtracted: bool,
    /// The number of operations between it and the result.
    distance: u32,
    rank: Rank,
}

type Terms = SmallVec<[Term; 8]>;

struct Tree {
    family: Binary,
    root: Value,
    inner: SmallVec<[Value; 8]>,
    leaves: Terms,
    constant: u64,
    constants: usize,
}

struct Reassociation<'a> {
    function: &'a mut Function,
    cfg: &'a Cfg,
    values: Table<Value, ValueInfo>,
    block: Block,
}

/// `Add` stands for differences and negations too.
#[inline]
fn family(function: &Function, value: Value) -> Option<Binary> {
    let family = match *function.op(value) {
        Op::Binary(op @ (Add | Mul | And | Or | Xor), _) => op,
        Op::Binary(Sub, _) | Op::Unary(Unary::Neg, _) => Add,
        _ => return None,
    };
    function.type_of(value).is_int().then_some(family)
}

fn neutral(family: Binary, ty: Type) -> u64 {
    match family {
        Mul => 1,
        And => u64::MAX >> (64 - ty.width().bits()),
        _ => 0,
    }
}

fn latency(op: &Op) -> u32 {
    match op {
        Op::Load { .. } => 4,
        Op::Binary(Mul | Binary::MulHigh(_), _) => 3,
        Op::Unary(Unary::Wrap | Unary::Widen(_) | Unary::Opaque | Unary::FitsIn(_), _) => 0,
        _ => 1,
    }
}

fn latency_of(family: Binary) -> u32 {
    latency(&Op::Binary(family, [Value::NONE; 2]))
}

impl Rank {
    fn joined(self, other: Self, family: Binary) -> Self {
        Self {
            ready: self.ready.max(other.ready) + latency_of(family),
            ..self.max(other)
        }
    }
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let cfg = analyses.cfg(function);
    let mut values = function.value_table(ValueInfo::default());
    let mut blocks_with_trees = Vec::new();
    for &block in cfg.order() {
        let mut has_tree = false;
        for user in function.instructions(block) {
            let own = family(function, user);
            for &operand in function.operands(user) {
                let is_kin = own.is_some()
                    && family(function, operand) == own
                    && function.block_of(operand) == block;
                values[operand].uses += 1;
                values[operand].is_used_by_kin = is_kin;
                has_tree |= is_kin;
            }
        }
        for edge in function.successors(block) {
            for &arg in function.args(edge) {
                values[arg].uses += 1;
                values[arg].is_used_by_kin = false;
            }
        }
        if has_tree {
            blocks_with_trees.push(block);
        }
    }
    if blocks_with_trees.is_empty() {
        return;
    }
    for state in (0..function.state_count()).map(State::from_index) {
        function
            .state(state)
            .iter()
            .for_each(|&kept| values[kept].uses += 1);
    }
    let mut pass = Reassociation {
        function,
        cfg,
        values,
        block: Block::NONE,
    };
    for block in blocks_with_trees {
        pass.visit(block);
    }
}

impl Reassociation<'_> {
    fn is_inner(&self, value: Value) -> bool {
        let info = self.values[value];
        info.uses == 1 && info.is_used_by_kin
    }

    fn ready(&self, value: Value) -> u32 {
        if self.function.block_of(value) == self.block {
            self.values[value].ready
        } else {
            0
        }
    }

    fn visit(&mut self, block: Block) {
        self.block = block;
        let mut next = self.function.first(block);
        while let Some(value) = next.expand() {
            next = self.function.next(value);
            let operands = self.function.op(value).inline_operands().iter();
            let latest = operands
                .map(|&operand| self.ready(operand))
                .max()
                .unwrap_or(0);
            self.values[value].ready = latest + latency(self.function.op(value));
            if !self.is_inner(value)
                && let Some(family) = family(self.function, value)
                && self
                    .function
                    .operands(value)
                    .iter()
                    .any(|&operand| self.is_inner(operand))
            {
                let tree = self.gather(family, value);
                self.regroup(tree);
            }
        }
    }

    fn gather(&self, family: Binary, root: Value) -> Tree {
        let (function, ty) = (&*self.function, self.function.type_of(root));
        let mut tree = Tree {
            family,
            root,
            inner: SmallVec::new(),
            leaves: Terms::new(),
            constant: neutral(family, ty),
            constants: 0,
        };
        let mut pending: SmallVec<[_; 8]> = smallvec::smallvec![(root, false, 0)];
        while let Some((value, is_subtracted, distance)) = pending.pop() {
            let has_room = tree.leaves.len() + pending.len() + 2 <= MOST_LEAVES;
            if value == root || self.is_inner(value) && has_room {
                tree.inner.push(value);
                let (operands, last_is_subtracted) = match function.op(value) {
                    Op::Binary(op, args) => (&args[..], *op == Sub),
                    op => (op.inline_operands(), true),
                };
                for (position, &operand) in operands.iter().enumerate() {
                    let flips = last_is_subtracted && position == operands.len() - 1;
                    pending.push((operand, is_subtracted != flips, distance + 1));
                }
            } else if let Some(bits) = function.constant_bits(value) {
                let op = if is_subtracted { Sub } else { family };
                tree.constant = evaluate::binary(op, ty, tree.constant, bits).unwrap();
                tree.constants += 1;
            } else {
                let home = function.block_of(value).expand();
                let rank = Rank {
                    closes_cycle: self.is_fed_by(value, root),
                    depth: home.map_or(0, |home| self.cfg.depth(home)),
                    ready: self.ready(value),
                };
                tree.leaves.push(Term {
                    value,
                    is_subtracted,
                    distance,
                    rank,
                });
            }
        }
        tree
    }

    fn insert(&mut self, root: Value, op: Binary, a: Value, b: Value) -> Value {
        let ty = self.function.type_of(root);
        let value = Builder::before(self.function, root).insert(Op::Binary(op, [a, b]), ty);
        self.values
            .grow_to(self.function.value_count(), ValueInfo::default());
        value
    }

    fn constant(&mut self, ty: Type, bits: u64) -> Value {
        let constant = self.function.constant(ty, bits);
        self.values
            .grow_to(self.function.value_count(), ValueInfo::default());
        constant
    }

    fn with_constant(&self, op: Binary, value: Value) -> Option<(Value, u64)> {
        match *self.function.op(value) {
            Op::Binary(found, [a, b]) if found == op => Some((a, self.function.constant_bits(b)?)),
            _ => None,
        }
    }

    /// A value and the factor by which the term is a multiple of it.
    fn as_multiple(&self, term: &Term) -> (Value, u64) {
        let bits = u64::from(self.function.type_of(term.value).width().bits());
        let (value, factor) = self
            .with_constant(Mul, term.value)
            .or_else(|| {
                self.with_constant(Shl, term.value)
                    .map(|(value, by)| (value, 1 << (by % bits)))
            })
            .unwrap_or((term.value, 1));
        (
            value,
            if term.is_subtracted {
                factor.wrapping_neg()
            } else {
                factor
            },
        )
    }

    fn add_up_multiples(&mut self, tree: &mut Tree) {
        let ty = self.function.type_of(tree.root);
        let mut multiples: SmallVec<[_; 8]> = tree
            .leaves
            .drain(..)
            .map(|term| (self.as_multiple(&term), term))
            .collect();
        multiples.sort_unstable_by_key(|&((value, _), term)| (value, term.value));
        for group in multiples.chunk_by(|a, b| a.0.0 == b.0.0) {
            let ((value, _), first) = group[0];
            let factors = group.iter().map(|&((_, factor), _)| factor);
            let factor = factors.fold(0, u64::wrapping_add) & neutral(And, ty);
            if group.len() == 1 {
                tree.leaves.push(first);
            } else if factor == 1 || factor == neutral(And, ty) {
                tree.leaves.push(Term {
                    value,
                    is_subtracted: factor != 1,
                    ..first
                });
            } else if factor != 0 {
                let factor = self.constant(ty, factor);
                let value = self.insert(tree.root, Mul, value, factor);
                tree.leaves.push(Term {
                    value,
                    is_subtracted: false,
                    ..first
                });
            }
        }
    }

    fn drop_repetitions(&mut self, tree: &mut Tree) {
        let mut all = core::mem::take(&mut tree.leaves);
        all.sort_unstable_by_key(|term| term.value);
        let groups = all.chunk_by(|a, b| a.value == b.value);
        let kept = groups.filter(|group| tree.family != Xor || group.len() % 2 != 0);
        tree.leaves.extend(kept.map(|group| group[0]));
        let ones = neutral(And, self.function.type_of(tree.root));
        let has_complement = |term: &Term| {
            matches!(self.with_constant(Xor, term.value), Some((inverse, mask))
                if mask == ones && all.iter().any(|other| other.value == inverse))
        };
        if tree.family != Xor && all.iter().any(has_complement) {
            tree.constant = !neutral(tree.family, self.function.type_of(tree.root)) & ones;
        }
    }

    fn pair_shifts(&mut self, tree: &mut Tree) {
        let bits = u64::from(self.function.type_of(tree.root).width().bits());
        let mut position = 0;
        while let Some(&term) = tree.leaves.get(position) {
            position += 1;
            let Some((value, right)) = self.with_constant(Shr, term.value) else {
                continue;
            };
            let completes = |other: &Term| {
                matches!(self.with_constant(Shl, other.value), Some((same, left))
                    if same == value && left % bits + right % bits == bits)
            };
            if let Some(partner) = tree.leaves.iter().position(completes) {
                let amount = self.constant(Type::I32, right);
                tree.leaves[position - 1].value =
                    self.insert(tree.root, RotateRight, value, amount);
                tree.leaves.remove(partner);
                position -= usize::from(partner < position);
            }
        }
    }

    /// A parameter to which the result of the tree goes back at the end of the loop.
    fn is_fed_by(&self, value: Value, root: Value) -> bool {
        let Op::Param(position) = *self.function.op(value) else {
            return false;
        };
        let incoming = self.cfg.predecessors(self.function.block_of(value));
        let last = incoming.last();
        last.is_some_and(|&edge| self.function.args(edge)[position as usize] == root)
    }

    /// Whether the parts of a sum that is an address in an object are in there too, however it is grouped.
    fn can_be_grouped_freely(&self, tree: &Tree) -> bool {
        let is_distance = |term: &Term| {
            let unscaled = self
                .with_constant(Shl, term.value)
                .filter(|&(_, by)| by < 16);
            let unscaled = unscaled.map_or(term.value, |(value, _)| value);
            let op = self.function.op(unscaled);
            !term.is_subtracted && matches!(op, Op::Unary(Unary::Widen(Sign::Unsigned), _))
        };
        let others = tree.leaves.iter().filter(|term| !is_distance(term)).count();
        let may_be_in_object = |term: &Term| self.function.may_be_in_object(term.value);
        tree.family != Add
            || others <= 1 && tree.constant as i64 >= 0
            || !tree.leaves.iter().any(may_be_in_object)
    }

    /// When the result is ready if the first two terms are joined until one is left.
    fn time_needed(tree: &Tree) -> u32 {
        let mut ranks: SmallVec<[Rank; 8]> = tree.leaves.iter().map(|term| term.rank).collect();
        while let [a, b, ..] = ranks[..] {
            let joined = a.joined(b, tree.family);
            ranks.drain(..2);
            ranks.insert(ranks.partition_point(|&rank| rank <= joined), joined);
        }
        ranks.first().map_or(0, |rank| rank.ready)
    }

    fn regroup(&mut self, mut tree: Tree) {
        if !self.can_be_grouped_freely(&tree) {
            return;
        }
        let ty = self.function.type_of(tree.root);
        let size_before = tree.leaves.len() + tree.constants;
        match tree.family {
            Add => self.add_up_multiples(&mut tree),
            Mul => {}
            _ => self.drop_repetitions(&mut tree),
        }
        if matches!(tree.family, Or | Xor) {
            self.pair_shifts(&mut tree);
        }
        let is_settled = match tree.family {
            Mul | And => tree.constant == 0,
            Or => tree.constant == neutral(And, ty),
            _ => false,
        };
        if is_settled {
            tree.leaves.clear();
        }
        let has_constant = tree.constant != neutral(tree.family, ty) || tree.leaves.is_empty();
        tree.leaves
            .sort_unstable_by_key(|term| (term.rank, term.value));

        let depth = self.cfg.depth(self.block);
        let unchanging = tree.leaves.partition_point(|term| term.rank.depth < depth);
        let shrinks = tree.leaves.len() + usize::from(has_constant) < size_before;
        let last_step = u32::from(has_constant);
        let shortens_cycle = |term: &Term| term.rank.closes_cycle && term.distance > 1 + last_step;
        let saves_time = || {
            let needed = Self::time_needed(&tree) + last_step * latency_of(tree.family);
            tree.leaves.len() <= MOST_LEAVES_TO_SAVE_TIME && needed < self.values[tree.root].ready
        };
        if shrinks
            || (2..tree.leaves.len()).contains(&unchanging)
            || tree.leaves.last().is_some_and(shortens_cycle)
            || saves_time()
        {
            self.rebuild(&tree, has_constant);
        }
    }

    /// The root keeps its place and gives the result.
    fn rebuild(&mut self, tree: &Tree, has_constant: bool) {
        let (root, family) = (tree.root, tree.family);
        let (mut terms, mut last_op) = (tree.leaves.clone(), None);
        while let [a, b, ..] = terms[..] {
            terms.drain(..2);
            let (op, [lhs, rhs], is_subtracted) = match (a.is_subtracted, b.is_subtracted) {
                (false, true) => (Sub, [a.value, b.value], false),
                (true, false) => (Sub, [b.value, a.value], false),
                (both, _) => (family, [a.value, b.value], both),
            };
            let value = if terms.is_empty() && !has_constant && !is_subtracted {
                last_op = Some(Op::Binary(op, [lhs, rhs]));
                root
            } else {
                self.insert(root, op, lhs, rhs)
            };
            let rank = a.rank.joined(b.rank, family);
            let place = terms.partition_point(|term| term.rank <= rank);
            terms.insert(
                place,
                Term {
                    value,
                    is_subtracted,
                    rank,
                    ..a
                },
            );
        }
        let ready = terms.first().map_or(0, |term| term.rank.ready);
        self.values[root].ready = ready + u32::from(last_op.is_none()) * latency_of(family);
        let constant = self.constant(self.function.type_of(root), tree.constant);
        *self.function.op_mut(root) = last_op.unwrap_or_else(|| match terms.first() {
            Some(term) if term.is_subtracted => Op::Binary(Sub, [constant, term.value]),
            Some(term) => Op::Binary(family, [term.value, constant]),
            None => Op::Binary(Or, [constant, constant]),
        });
        for &inner in &tree.inner[1..] {
            self.function.remove(inner);
        }
    }
}
