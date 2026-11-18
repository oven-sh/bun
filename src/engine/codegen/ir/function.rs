//! The tables that make up a function.

use core::hash::BuildHasher;

use bun_engine_asm::{Gpr, RegisterSet};
use smallvec::SmallVec;

use super::effects::{EffectFlags, HeapRange};
use super::entities::{
    Block, Cases, Edge, Entity, Heap, List, Patchpoint, Pool, Slot, Span, State, Table, Value,
    Variable, VectorConstant,
};
use super::node::{NodeInfo, NodeKind};
use super::op::{Binary, Bits64, Op, Origin, Type, Unary};
use super::patchpoint::{Boundary, Input, Output, PatchpointData};
use crate::hash::Seed;

#[derive(Clone)]
struct ValueData {
    op: Op,
    ty: Type,
    origin: Origin,
    block: Block,
    previous: Value,
    next: Value,
}

#[derive(Clone)]
struct BlockData {
    first: Value,
    last: Value,
    params: List<Value>,
    first_edge: u32,
    edge_count: u32,
    is_removed: bool,
}

#[derive(Clone)]
struct EdgeData {
    source: Block,
    target: Block,
    args: List<Value>,
    is_rare: bool,
}

#[derive(Clone, Copy)]
struct StateData {
    values: Span<Value>,
    tags: Span<u8>,
    layout: u32,
}

#[derive(Clone, Copy)]
pub struct SlotData {
    pub size: u32,
    /// At most 16.
    pub alignment: u32,
}

#[derive(Clone, Copy)]
pub struct Entry {
    pub block: Block,
    pub(crate) params: Span<Boundary>,
}

/// An edge to create.
#[derive(Clone, Copy)]
pub struct Successor<'a> {
    pub target: Block,
    pub args: &'a [Value],
    pub is_rare: bool,
}

impl<'a> Successor<'a> {
    pub fn new(target: Block, args: &'a [Value]) -> Self {
        Self {
            target,
            args,
            is_rare: false,
        }
    }

    pub fn rare(self) -> Self {
        Self {
            is_rare: true,
            ..self
        }
    }
}

impl From<Block> for Successor<'_> {
    fn from(target: Block) -> Self {
        Self::new(target, &[])
    }
}

impl Block {
    pub fn rare(self) -> Successor<'static> {
        Successor::from(self).rare()
    }
}

/// The edges that leave a block.
#[derive(Clone)]
pub struct Edges(core::ops::Range<u32>);

impl Iterator for Edges {
    type Item = Edge;

    #[inline]
    fn next(&mut self) -> Option<Edge> {
        self.0.next().map(Edge)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.0.size_hint()
    }
}

impl DoubleEndedIterator for Edges {
    #[inline]
    fn next_back(&mut self) -> Option<Edge> {
        self.0.next_back().map(Edge)
    }
}

impl ExactSizeIterator for Edges {}

#[derive(Clone)]
pub struct Function {
    values: Table<Value, ValueData>,
    blocks: Table<Block, BlockData>,
    edges: Table<Edge, EdgeData>,
    value_lists: Pool<Value>,
    states: Table<State, StateData>,
    state_tags: Pool<u8>,
    node_kinds: &'static [NodeInfo],
    patchpoints: Table<Patchpoint, PatchpointData>,
    inputs: Pool<Input>,
    outputs: Pool<(Type, Output)>,
    boundaries: Pool<Boundary>,
    heaps: Table<Heap, HeapRange>,
    slots: Table<Slot, SlotData>,
    variables: Table<Variable, Type>,
    vector_constants: Table<VectorConstant, u128>,
    cases: Table<Cases, Span<i64>>,
    case_lists: Pool<i64>,
    entries: Vec<Entry>,
    results: Span<Boundary>,
    /// An open hash table of the values that are in no block.
    floating: Vec<Value>,
    floating_count: usize,
    seed: Seed,
    /// Of the changes that add nothing to the tables.
    edits: usize,
    /// Never allocated, and kept by everything that is called.
    pub pinned: RegisterSet,
    pinned_values: SmallVec<[(Gpr, u64); 2]>,
    /// The bytes just below the frame pointer that are the client's.
    pub reserved_frame_bytes: u32,
    /// The least size of the area at the stack pointer. Operands and results of patchpoints extend it as they need.
    pub outgoing_bytes: u32,
    /// The frame is no smaller.
    pub least_frame_bytes: u32,
    /// Arithmetic has to turn a signaling NaN into a quiet one.
    pub quiets_nans: bool,
    /// The upper half of the register in which an I32 arrives is clear.
    pub params_are_extended: bool,
    /// A sum of 64 bits may be an address in an object of the collector, which knows the object only by such
    /// addresses. The parts of the sum that have one in them are in the object too, and passes keep it so.
    pub indexes_objects: bool,
    /// What makes a load `ALWAYS_READABLE` is a node, or else the client sees to it that the load stays below.
    pub only_nodes_make_readable: bool,
}

impl Function {
    pub fn new(pinned: RegisterSet) -> Self {
        let mut function = Self {
            values: Table::default(),
            blocks: Table::default(),
            edges: Table::default(),
            value_lists: Pool::default(),
            states: Table::default(),
            state_tags: Pool::default(),
            node_kinds: &[],
            patchpoints: Table::default(),
            inputs: Pool::default(),
            outputs: Pool::default(),
            boundaries: Pool::default(),
            heaps: Table::default(),
            slots: Table::default(),
            variables: Table::default(),
            vector_constants: Table::default(),
            cases: Table::default(),
            case_lists: Pool::default(),
            entries: Vec::new(),
            results: Span::default(),
            floating: Vec::new(),
            floating_count: 0,
            seed: Seed::default(),
            edits: 0,
            pinned,
            pinned_values: SmallVec::new(),
            reserved_frame_bytes: 0,
            outgoing_bytes: 0,
            least_frame_bytes: 0,
            quiets_nans: false,
            params_are_extended: false,
            indexes_objects: true,
            only_nodes_make_readable: false,
        };
        function.clear(pinned);
        function
    }

    /// Empties the function and keeps its allocations for the next.
    pub fn clear(&mut self, pinned: RegisterSet) {
        const INITIAL_FLOATING_CAPACITY: usize = 64;
        self.values.clear();
        self.blocks.clear();
        self.edges.clear();
        self.value_lists.clear();
        self.states.clear();
        self.state_tags.clear();
        self.patchpoints.clear();
        self.inputs.clear();
        self.outputs.clear();
        self.boundaries.clear();
        self.heaps.clear();
        self.slots.clear();
        self.variables.clear();
        self.vector_constants.clear();
        self.cases.clear();
        self.case_lists.clear();
        self.entries.clear();
        self.results = Span::default();
        self.floating.clear();
        self.floating.resize(INITIAL_FLOATING_CAPACITY, Value::NONE);
        self.floating_count = 0;
        self.pinned = pinned;
        self.pinned_values.clear();
        self.reserved_frame_bytes = 0;
        self.outgoing_bytes = 0;
        self.least_frame_bytes = 0;
        self.quiets_nans = false;
        self.params_are_extended = false;
        self.indexes_objects = true;
        self.only_nodes_make_readable = false;
        let predefined = [HeapRange::ALL, HeapRange::EMPTY].map(|range| self.heaps.push(range));
        debug_assert!(predefined == [Heap::EVERYTHING, Heap::NOTHING]);
    }

    pub fn reserve_values(&mut self, additional: usize) {
        self.values.reserve(additional);
    }

    /// Grows with every change to instructions, parameters and edges.
    #[inline]
    pub fn revision(&self) -> usize {
        self.edits + self.values.len() + self.edges.len()
    }

    // Values

    #[inline]
    pub fn value_count(&self) -> usize {
        self.values.len()
    }

    #[inline]
    pub fn op(&self, value: Value) -> &Op {
        &self.values[value].op
    }

    /// For a change that keeps the type. Not for a value that is in no block.
    #[inline]
    pub fn op_mut(&mut self, value: Value) -> &mut Op {
        self.edits += 1;
        debug_assert!(!self.values[value].op.is_floating());
        &mut self.values[value].op
    }

    #[inline]
    pub fn type_of(&self, value: Value) -> Type {
        self.values[value].ty
    }

    #[inline]
    pub fn origin(&self, value: Value) -> Origin {
        self.values[value].origin
    }

    pub fn set_origin(&mut self, value: Value, origin: Origin) {
        self.values[value].origin = origin;
    }

    /// `NONE` for constants and the like.
    #[inline]
    pub fn block_of(&self, value: Value) -> Block {
        self.values[value].block
    }

    /// An I32 has its sign extended.
    #[inline]
    pub fn int_constant(&self, value: Value) -> Option<i64> {
        match *self.op(value) {
            Op::Const32(constant) => Some(constant.into()),
            Op::Const64(constant) => Some(constant.get() as i64),
            _ => None,
        }
    }

    /// The bits of a scalar constant, extended with zeros.
    #[inline]
    pub fn constant_bits(&self, value: Value) -> Option<u64> {
        match *self.op(value) {
            Op::Const32(constant) => Some((constant as u32).into()),
            Op::ConstF32(bits) => Some(bits.into()),
            Op::Const64(bits) | Op::ConstF64(bits) => Some(bits.get()),
            _ => None,
        }
    }

    #[inline]
    pub fn is_int_constant(&self, value: Value, expected: i64) -> bool {
        self.int_constant(value) == Some(expected)
    }

    /// The operands other than those in a state.
    #[inline]
    pub fn operands(&self, value: Value) -> &[Value] {
        match &self.values[value].op {
            Op::Patchpoint(patchpoint) => &self.value_lists[self.patchpoints[*patchpoint].operands],
            Op::Return(values) | Op::WideNode { args: values, .. } => &self.value_lists[*values],
            op => op.inline_operands(),
        }
    }

    #[inline]
    pub fn operands_mut(&mut self, value: Value) -> &mut [Value] {
        self.edits += 1;
        match &mut self.values[value].op {
            Op::Patchpoint(patchpoint) => {
                &mut self.value_lists[self.patchpoints[*patchpoint].operands]
            }
            Op::Return(values) | Op::WideNode { args: values, .. } => {
                &mut self.value_lists[*values]
            }
            op => op.inline_operands_mut(),
        }
    }

    #[inline]
    pub fn state_of(&self, value: Value) -> State {
        match self.values[value].op {
            Op::Check(_, exit) | Op::Checked(_, _, exit) => exit.state,
            Op::Patchpoint(patchpoint) => self.patchpoints[patchpoint].state,
            Op::Node { state, .. } | Op::WideNode { state, .. } => state,
            _ => State::NONE,
        }
    }

    pub fn set_state_of(&mut self, value: Value, state: State) {
        self.edits += 1;
        match &mut self.values[value].op {
            Op::Check(_, exit) | Op::Checked(_, _, exit) => exit.state = state,
            Op::Patchpoint(patchpoint) => self.patchpoints[*patchpoint].state = state,
            Op::Node { state: own, .. } | Op::WideNode { state: own, .. } => *own = state,
            _ => unreachable!("has no state"),
        }
    }

    /// The operands, the values in the state and, for the end of a block, the arguments of the edges.
    #[inline]
    pub fn for_each_use(&self, user: Value, mut visit: impl FnMut(Value)) {
        self.operands(user)
            .iter()
            .chain(self.state(self.state_of(user)))
            .for_each(|&value| visit(value));
        let block = self.block_of(user);
        if self.last(block) == user {
            for edge in self.successors(block) {
                self.args(edge).iter().for_each(|&value| visit(value));
            }
        }
    }

    // Values in no block

    fn floating_slot(&self, hash: u64, matches: impl Fn(&ValueData) -> bool) -> usize {
        let mask = self.floating.len() - 1;
        let mut slot = hash as usize & mask;
        while !self.floating[slot].is_none() && !matches(&self.values[self.floating[slot]]) {
            slot = (slot + 1) & mask;
        }
        slot
    }

    #[inline]
    fn hash_floating(&self, op: Op) -> u64 {
        match op {
            Op::Const32(bits) => self.seed.hash_one(!u64::from(bits as u32)),
            Op::Const64(bits) => self.seed.hash_one(bits.get()),
            Op::ConstV128(constant) => self.seed.hash_one(self.vector_constants[constant]),
            _ => self.seed.hash_one(op),
        }
    }

    pub(crate) fn seed(&self) -> Seed {
        self.seed
    }

    fn add_floating(&mut self, slot: usize, op: Op, ty: Type) -> Value {
        let value = self.add_value(op, ty, Origin::default());
        self.floating[slot] = value;
        self.floating_count += 1;
        if self.floating_count * 2 > self.floating.len() {
            let grown = vec![Value::NONE; self.floating.len() * 2];
            for known in core::mem::replace(&mut self.floating, grown)
                .into_iter()
                .filter(|known| !known.is_none())
            {
                let slot = self.floating_slot(self.hash_floating(*self.op(known)), |_| false);
                self.floating[slot] = known;
            }
        }
        value
    }

    #[inline]
    fn intern(&mut self, op: Op, ty: Type) -> Value {
        let slot = self.floating_slot(self.hash_floating(op), |known| known.op == op);
        self.floating[slot]
            .expand()
            .unwrap_or_else(|| self.add_floating(slot, op, ty))
    }

    pub fn const32(&mut self, value: i32) -> Value {
        self.intern(Op::Const32(value), Type::I32)
    }

    pub fn const64(&mut self, value: i64) -> Value {
        self.intern(Op::Const64(Bits64::new(value as u64)), Type::I64)
    }

    pub fn const_f32(&mut self, value: f32) -> Value {
        self.constant(Type::F32, value.to_bits().into())
    }

    pub fn const_f64(&mut self, value: f64) -> Value {
        self.constant(Type::F64, value.to_bits())
    }

    /// The scalar with as many of the low bits as the type has.
    pub fn constant(&mut self, ty: Type, bits: u64) -> Value {
        let op = match ty {
            Type::I32 => Op::Const32(bits as i32),
            Type::I64 => Op::Const64(Bits64::new(bits)),
            Type::F32 => Op::ConstF32(bits as u32),
            Type::F64 => Op::ConstF64(Bits64::new(bits)),
            _ => unreachable!("not a scalar"),
        };
        self.intern(op, ty)
    }

    pub fn const_v128(&mut self, bits: u128) -> Value {
        let slot = self.floating_slot(
            self.seed.hash_one(bits),
            |known| matches!(known.op, Op::ConstV128(constant) if self.vector_constants[constant] == bits),
        );
        self.floating[slot].expand().unwrap_or_else(|| {
            let constant = self.vector_constants.push(bits);
            self.add_floating(slot, Op::ConstV128(constant), Type::V128)
        })
    }

    /// Equal bits give equal constants.
    pub fn intern_vector(&mut self, bits: u128) -> VectorConstant {
        let value = self.const_v128(bits);
        let Op::ConstV128(constant) = *self.op(value) else {
            unreachable!()
        };
        constant
    }

    #[inline]
    pub fn vector_constant(&self, constant: VectorConstant) -> u128 {
        self.vector_constants[constant]
    }

    pub fn zero(&mut self, ty: Type) -> Value {
        if ty == Type::V128 {
            self.const_v128(0)
        } else {
            self.constant(ty, 0)
        }
    }

    /// One of `pinned`, or the frame pointer.
    pub fn pinned(&mut self, register: Gpr) -> Value {
        self.intern(Op::Pinned(register), Type::I64)
    }

    /// Constants that are equal or close to what the register holds are taken from it.
    pub fn set_pinned_value(&mut self, register: Gpr, value: u64) {
        assert!(self.pinned.contains(register));
        self.pinned_values.push((register, value));
    }

    /// A pinned register and what has to be added to it to get `value`, if that is within `reach`.
    #[inline]
    pub fn pinned_near(
        &self,
        value: u64,
        reach: core::ops::RangeInclusive<i64>,
    ) -> Option<(Gpr, i64)> {
        let distances = self
            .pinned_values
            .iter()
            .map(|&(register, held)| (register, value.wrapping_sub(held) as i64));
        distances
            .filter(|(_, distance)| reach.contains(distance))
            .min_by_key(|&(_, distance)| distance.unsigned_abs())
    }

    /// See `indexes_objects`.
    pub(crate) fn may_be_in_object(&self, value: Value) -> bool {
        self.indexes_objects
            && self.type_of(value) == Type::I64
            && match *self.op(value) {
                Op::Unary(op, _) => op == Unary::Opaque,
                Op::Binary(op, _) => {
                    matches!(op, Binary::Add | Binary::Sub | Binary::And | Binary::Or)
                }
                Op::Checked(..) => false,
                ref op => !op.is_floating(),
            }
    }

    pub fn slot_address(&mut self, slot: Slot) -> Value {
        self.intern(Op::SlotAddress(slot), Type::I64)
    }

    pub(crate) fn displaced(&mut self, register: Gpr, offset: i32) -> Value {
        self.intern(Op::Displaced(register, offset), Type::I64)
    }

    // The order of instructions

    #[inline]
    fn add_value(&mut self, op: Op, ty: Type, origin: Origin) -> Value {
        self.values.push(ValueData {
            op,
            ty,
            origin,
            block: Block::NONE,
            previous: Value::NONE,
            next: Value::NONE,
        })
    }

    #[inline]
    pub fn append(&mut self, block: Block, op: Op, ty: Type, origin: Origin) -> Value {
        debug_assert!(!op.is_floating());
        let previous = self.blocks[block].last;
        let value = self.values.push(ValueData {
            op,
            ty,
            origin,
            block,
            previous,
            next: Value::NONE,
        });
        self.link_neighbours(value, block, previous, Value::NONE);
        value
    }

    #[inline]
    pub fn insert_before(&mut self, next: Value, op: Op, ty: Type, origin: Origin) -> Value {
        debug_assert!(!op.is_floating());
        let ValueData {
            block, previous, ..
        } = self.values[next];
        let value = self.values.push(ValueData {
            op,
            ty,
            origin,
            block,
            previous,
            next,
        });
        self.link_neighbours(value, block, previous, next);
        value
    }

    #[inline]
    fn link_neighbours(&mut self, value: Value, block: Block, previous: Value, next: Value) {
        self.set_next(block, previous, value);
        self.set_previous(block, next, value);
    }

    #[inline]
    fn set_next(&mut self, block: Block, value: Value, next: Value) {
        if value.is_none() {
            self.blocks[block].first = next;
        } else {
            self.values[value].next = next;
        }
    }

    #[inline]
    fn set_previous(&mut self, block: Block, value: Value, previous: Value) {
        if value.is_none() {
            self.blocks[block].last = previous;
        } else {
            self.values[value].previous = previous;
        }
    }

    /// The value still knows what followed it, so a walk can go on from it.
    #[inline]
    fn unlink(&mut self, value: Value) {
        self.edits += 1;
        let ValueData {
            block,
            previous,
            next,
            ..
        } = self.values[value];
        self.set_next(block, previous, next);
        self.set_previous(block, next, previous);
    }

    pub fn move_before(&mut self, value: Value, next: Value) {
        self.unlink(value);
        let ValueData {
            block, previous, ..
        } = self.values[next];
        let data = &mut self.values[value];
        (data.block, data.previous, data.next) = (block, previous, next);
        self.link_neighbours(value, block, previous, next);
    }

    /// For an instruction that nothing uses.
    #[inline]
    pub fn remove(&mut self, value: Value) {
        self.unlink(value);
        self.values[value].op = Op::Removed;
    }

    /// Removes the instruction. Until `resolve_aliases`, look at operands through `resolve`.
    #[inline]
    pub fn replace(&mut self, value: Value, replacement: Value) {
        debug_assert!(
            self.resolve(replacement) != value && self.type_of(value) == self.type_of(replacement)
        );
        self.unlink(value);
        self.values[value].op = Op::Alias(replacement);
    }

    #[inline]
    pub fn resolve(&self, mut value: Value) -> Value {
        while let Op::Alias(replacement) = self.values[value].op {
            value = replacement;
        }
        value
    }

    /// Of the operands other than those in a state.
    #[inline]
    pub fn resolve_operands(&mut self, value: Value) {
        let is_alias = |&operand: &Value| matches!(self.values[operand].op, Op::Alias(_));
        if self.operands(value).iter().any(is_alias) {
            for index in 0..self.operands(value).len() {
                let resolved = self.resolve(self.operands(value)[index]);
                self.operands_mut(value)[index] = resolved;
            }
        }
    }

    #[inline]
    fn resolve_span(&mut self, span: Span<Value>) -> bool {
        let mut found_alias = false;
        for value in &mut self.value_lists[span] {
            while let Op::Alias(replacement) = self.values[*value].op {
                (*value, found_alias) = (replacement, true);
            }
        }
        found_alias
    }

    /// Returns whether there was an alias among them.
    #[inline]
    pub fn resolve_args(&mut self, edge: Edge) -> bool {
        self.resolve_span(self.edges[edge].args.span)
    }

    pub fn resolve_state(&mut self, state: State) {
        self.resolve_span(self.states[state].values);
    }

    pub fn resolve_aliases(&mut self) {
        for block in self.blocks.keys() {
            let mut value = self.first(block);
            while !value.is_none() {
                self.resolve_operands(value);
                value = self.next(value);
            }
            for edge in self.successors(block) {
                self.resolve_args(edge);
            }
        }
        for state in self.states.keys() {
            self.resolve_state(state);
        }
    }

    #[inline]
    pub fn first(&self, block: Block) -> Value {
        self.blocks[block].first
    }

    #[inline]
    pub fn last(&self, block: Block) -> Value {
        self.blocks[block].last
    }

    #[inline]
    pub fn next(&self, value: Value) -> Value {
        self.values[value].next
    }

    #[inline]
    pub fn previous(&self, value: Value) -> Value {
        self.values[value].previous
    }

    pub fn instructions(&self, block: Block) -> impl Iterator<Item = Value> {
        core::iter::successors(self.first(block).expand(), |&value| {
            self.next(value).expand()
        })
    }

    pub fn instructions_backward(&self, block: Block) -> impl Iterator<Item = Value> {
        core::iter::successors(self.last(block).expand(), |&value| {
            self.previous(value).expand()
        })
    }

    // Blocks

    #[inline]
    pub fn block_count(&self) -> usize {
        self.blocks.len()
    }

    pub fn new_block(&mut self) -> Block {
        self.blocks.push(BlockData {
            first: Value::NONE,
            last: Value::NONE,
            params: List::default(),
            first_edge: 0,
            edge_count: 0,
            is_removed: false,
        })
    }

    pub fn blocks(&self) -> impl Iterator<Item = Block> {
        self.blocks
            .keys()
            .filter(|&block| !self.blocks[block].is_removed)
    }

    #[inline]
    pub fn is_removed(&self, block: Block) -> bool {
        self.blocks[block].is_removed
    }

    /// For a block that no edge reaches.
    pub fn remove_block(&mut self, block: Block) {
        while let Some(value) = self.first(block).expand() {
            self.remove(value);
        }
        for index in 0..self.params(block).len() {
            let param = self.params(block)[index];
            self.values[param].op = Op::Removed;
        }
        let data = &mut self.blocks[block];
        (data.params, data.edge_count, data.is_removed) = (List::default(), 0, true);
    }

    pub fn is_terminated(&self, block: Block) -> bool {
        self.last(block)
            .expand()
            .is_some_and(|last| self.effects(last).has(EffectFlags::ENDS_BLOCK))
    }

    /// Moves `first` and what follows it to a new block, with the edges. The old block is left without an end.
    pub fn split_before(&mut self, first: Value) -> Block {
        let ValueData {
            block: old,
            previous,
            ..
        } = self.values[first];
        let new = self.new_block();
        let last = self.blocks[old].last;
        self.set_next(old, previous, Value::NONE);
        self.blocks[old].last = previous;
        self.values[first].previous = Value::NONE;
        (self.blocks[new].first, self.blocks[new].last) = (first, last);
        self.adopt(new, first);
        self.move_edges(old, new);
        new
    }

    /// `block` jumps to `next`, which nothing else reaches. The parameters of `next` become aliases.
    pub fn merge_with_successor(&mut self, block: Block) {
        self.edits += 1;
        let edge = self.successor(block, 0);
        let next = self.target(edge);
        debug_assert!(*self.op(self.last(block)) == Op::Jump && next != block);
        for index in 0..self.params(next).len() {
            let (param, arg) = (self.params(next)[index], self.args(edge)[index]);
            self.values[param].op = Op::Alias(arg);
        }
        self.remove(self.last(block));
        let (first, last, previous) = (self.first(next), self.last(next), self.last(block));
        self.set_next(block, previous, first);
        self.values[first].previous = previous;
        self.blocks[block].last = last;
        self.adopt(block, first);
        self.move_edges(next, block);
        let data = &mut self.blocks[next];
        (data.first, data.last, data.params, data.is_removed) =
            (Value::NONE, Value::NONE, List::default(), true);
    }

    fn adopt(&mut self, block: Block, first: Value) {
        let mut value = first;
        while !value.is_none() {
            self.values[value].block = block;
            value = self.values[value].next;
        }
    }

    fn move_edges(&mut self, from: Block, to: Block) {
        for edge in self.successors(from) {
            self.edges[edge].source = to;
        }
        (self.blocks[to].first_edge, self.blocks[to].edge_count) = (
            self.blocks[from].first_edge,
            core::mem::take(&mut self.blocks[from].edge_count),
        );
    }

    // Parameters

    #[inline]
    pub fn params(&self, block: Block) -> &[Value] {
        &self.value_lists[self.blocks[block].params.span]
    }

    /// Every edge to the block needs one more argument.
    pub fn add_param(&mut self, block: Block, ty: Type) -> Value {
        let position = self.blocks[block].params.span.len() as u32;
        let param = self.add_value(Op::Param(position), ty, Origin::default());
        self.values[param].block = block;
        self.value_lists.push(&mut self.blocks[block].params, param);
        param
    }

    /// Makes an alias of a parameter, which keeps its position until `drop_dead_params`.
    pub fn replace_param(&mut self, param: Value, replacement: Value) {
        self.edits += 1;
        debug_assert!(matches!(self.op(param), Op::Param(_)) && self.resolve(replacement) != param);
        self.values[param].op = Op::Alias(replacement);
    }

    /// For a parameter that nothing uses. It keeps its position until `drop_dead_params`.
    pub fn remove_param(&mut self, param: Value) {
        self.edits += 1;
        debug_assert!(matches!(self.op(param), Op::Param(_)));
        self.values[param].op = Op::Removed;
    }

    /// `incoming` are all the edges to the block.
    pub fn drop_dead_params(&mut self, block: Block, incoming: &[Edge]) {
        let params = self.blocks[block].params.span;
        let mut kept = 0;
        for position in 0..params.len() {
            let param = self.value_lists[params][position];
            if !matches!(self.op(param), Op::Param(_)) {
                continue;
            }
            self.values[param].op = Op::Param(kept as u32);
            self.value_lists[params][kept] = param;
            for &edge in incoming {
                let args = &mut self.value_lists[self.edges[edge].args.span];
                args[kept] = args[position];
            }
            kept += 1;
        }
        self.blocks[block].params.span.truncate(kept);
        for &edge in incoming {
            self.edges[edge].args.span.truncate(kept);
        }
    }

    // Edges

    #[inline]
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    #[inline]
    pub fn successors(&self, block: Block) -> Edges {
        let data = &self.blocks[block];
        Edges(data.first_edge..data.first_edge + data.edge_count)
    }

    /// Whether the edge is still among those that leave its source.
    #[inline]
    pub fn is_attached(&self, edge: Edge) -> bool {
        self.successors(self.source(edge)).0.contains(&edge.0)
    }

    #[inline]
    pub fn successor(&self, block: Block, position: usize) -> Edge {
        assert!(position < self.blocks[block].edge_count as usize);
        Edge(self.blocks[block].first_edge + position as u32)
    }

    pub fn set_successors(&mut self, block: Block, successors: &[Successor<'_>]) {
        self.clear_successors(block);
        for &successor in successors {
            self.push_successor(block, successor);
        }
    }

    pub fn clear_successors(&mut self, block: Block) {
        self.edits += 1;
        (self.blocks[block].first_edge, self.blocks[block].edge_count) =
            (self.edges.len() as u32, 0);
    }

    /// No other edge has been made since `clear_successors` or the last edge of the block.
    pub fn push_successor(&mut self, block: Block, successor: Successor<'_>) -> Edge {
        let args = self.value_lists.add_list(successor.args);
        self.push_edge(EdgeData {
            source: block,
            target: successor.target,
            args,
            is_rare: successor.is_rare,
        })
    }

    /// Like `push_successor`, with the target, arguments and likelihood of `edge`.
    pub fn push_copy_of(&mut self, block: Block, edge: Edge) -> Edge {
        let args = self.value_lists.duplicate_list(self.edges[edge].args);
        self.push_edge(EdgeData {
            source: block,
            args,
            ..self.edges[edge]
        })
    }

    fn push_edge(&mut self, data: EdgeData) -> Edge {
        let block = &mut self.blocks[data.source];
        assert!((block.first_edge + block.edge_count) as usize == self.edges.len());
        block.edge_count += 1;
        self.edges.push(data)
    }

    /// Ends the source of the edge with a jump along it.
    pub fn keep_only_successor(&mut self, edge: Edge) {
        self.edits += 1;
        let block = self.edges[edge].source;
        let last = self.last(block);
        self.values[last].op = Op::Jump;
        self.edges[edge].is_rare = false;
        (self.blocks[block].first_edge, self.blocks[block].edge_count) = (edge.0, 1);
    }

    pub fn swap_successors(&mut self, a: Edge, b: Edge) {
        self.edits += 1;
        let data = self.edges[a].clone();
        self.edges[a] = core::mem::replace(&mut self.edges[b], data);
    }

    #[inline]
    pub fn source(&self, edge: Edge) -> Block {
        self.edges[edge].source
    }

    #[inline]
    pub fn target(&self, edge: Edge) -> Block {
        self.edges[edge].target
    }

    #[inline]
    pub fn is_rare(&self, edge: Edge) -> bool {
        self.edges[edge].is_rare
    }

    pub fn set_rare(&mut self, edge: Edge, is_rare: bool) {
        self.edges[edge].is_rare = is_rare;
    }

    #[inline]
    pub fn args(&self, edge: Edge) -> &[Value] {
        &self.value_lists[self.edges[edge].args.span]
    }

    #[inline]
    pub fn args_mut(&mut self, edge: Edge) -> &mut [Value] {
        self.edits += 1;
        &mut self.value_lists[self.edges[edge].args.span]
    }

    pub fn push_arg(&mut self, edge: Edge, arg: Value) {
        self.edits += 1;
        self.value_lists.push(&mut self.edges[edge].args, arg);
    }

    pub fn redirect(&mut self, edge: Edge, target: Block, args: &[Value]) {
        self.edits += 1;
        self.edges[edge].target = target;
        self.edges[edge].args = self.value_lists.add_list(args);
    }

    /// For a block whose parameters the arguments fit.
    pub fn set_target(&mut self, edge: Edge, target: Block) {
        self.edits += 1;
        self.edges[edge].target = target;
    }

    /// Puts an empty block in the middle of the edge.
    pub fn split_edge(&mut self, edge: Edge) -> Block {
        let middle = self.new_block();
        let origin = self.origin(self.last(self.source(edge)));
        self.append(middle, Op::Jump, Type::Void, origin);
        self.clear_successors(middle);
        self.push_edge(EdgeData {
            source: middle,
            is_rare: false,
            ..self.edges[edge]
        });
        self.edges[edge].target = middle;
        self.edges[edge].args = List::default();
        middle
    }

    // Entries and results

    /// A block that no edge reaches, with a parameter for each of `params`.
    pub fn add_entry(&mut self, params: &[(Type, Boundary)]) -> Block {
        let block = self.new_block();
        for &(ty, _) in params {
            self.add_param(block, ty);
        }
        let params = self
            .boundaries
            .add(params.iter().map(|&(_, boundary)| boundary));
        self.entries.push(Entry { block, params });
        block
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn entry_params(&self, entry: Entry) -> &[Boundary] {
        &self.boundaries[entry.params]
    }

    pub fn set_results(&mut self, results: &[Boundary]) {
        self.results = self.boundaries.add(results.iter().copied());
    }

    pub fn results(&self) -> &[Boundary] {
        &self.boundaries[self.results]
    }

    pub fn add_values(&mut self, values: &[Value]) -> Span<Value> {
        self.value_lists.add(values.iter().copied())
    }

    #[inline]
    pub fn values_in(&self, span: Span<Value>) -> &[Value] {
        &self.value_lists[span]
    }

    // States. Instructions share them, so they change only by what holds for the whole function.

    pub fn add_state(&mut self, values: &[Value]) -> State {
        let values = self.add_values(values);
        self.states.push(StateData {
            values,
            tags: Span::default(),
            layout: 0,
        })
    }

    /// `layout` and a tag for each value, at first zero, tell the client what the values stand for.
    pub fn add_described_state(
        &mut self,
        values: impl IntoIterator<Item = Value>,
        layout: u32,
    ) -> State {
        let values = self.value_lists.add(values);
        let tags = self.state_tags.add(core::iter::repeat_n(0, values.len()));
        self.states.push(StateData {
            values,
            tags,
            layout,
        })
    }

    pub fn state_layout(&self, state: State) -> u32 {
        self.states[state].layout
    }

    pub fn state_tags(&self, state: State) -> &[u8] {
        &self.state_tags[self.states[state].tags]
    }

    /// Puts another form of the same value in its place, which is available wherever that is.
    pub fn retag(&mut self, state: State, position: usize, value: Value, tag: u8) {
        self.edits += 1;
        let data = self.states[state];
        self.value_lists[data.values][position] = value;
        self.state_tags[data.tags][position] = tag;
    }

    #[inline]
    pub fn state_count(&self) -> usize {
        self.states.len()
    }

    #[inline]
    pub fn state(&self, state: State) -> &[Value] {
        if state.is_none() {
            &[]
        } else {
            &self.value_lists[self.states[state].values]
        }
    }

    /// For a state whose users all agree on the change.
    pub(crate) fn state_mut(&mut self, state: State) -> &mut [Value] {
        self.edits += 1;
        &mut self.value_lists[self.states[state].values]
    }

    pub fn map_state(&mut self, state: State, mut map: impl FnMut(Value) -> Value) -> State {
        if state.is_none() {
            return state;
        }
        let data = self.states[state];
        let (copy, tags) = (
            self.value_lists.duplicate(data.values),
            self.state_tags.duplicate(data.tags),
        );
        self.value_lists[copy]
            .iter_mut()
            .for_each(|value| *value = map(*value));
        self.states.push(StateData {
            values: copy,
            tags,
            ..data
        })
    }

    // Patchpoints

    pub fn add_patchpoint(
        &mut self,
        data: &PatchpointData,
        operands: &[(Value, Input)],
        results: &[(Type, Output)],
    ) -> Patchpoint {
        let mut data = *data;
        data.operands = self
            .value_lists
            .add(operands.iter().map(|&(value, _)| value));
        data.inputs = self.inputs.add(operands.iter().map(|&(_, input)| input));
        data.results = self.outputs.add(results.iter().copied());
        self.patchpoints.push(data)
    }

    #[inline]
    pub fn patchpoint(&self, patchpoint: Patchpoint) -> &PatchpointData {
        &self.patchpoints[patchpoint]
    }

    pub fn patchpoint_mut(&mut self, patchpoint: Patchpoint) -> &mut PatchpointData {
        self.edits += 1;
        &mut self.patchpoints[patchpoint]
    }

    pub fn inputs(&self, patchpoint: Patchpoint) -> &[Input] {
        &self.inputs[self.patchpoints[patchpoint].inputs]
    }

    pub fn outputs(&self, patchpoint: Patchpoint) -> &[(Type, Output)] {
        &self.outputs[self.patchpoints[patchpoint].results]
    }

    /// The operation of `value` with lists of operands of its own. A state is still shared.
    pub fn clone_op(&mut self, value: Value) -> Op {
        match *self.op(value) {
            Op::Patchpoint(patchpoint) => {
                let mut data = self.patchpoints[patchpoint];
                data.operands = self.value_lists.duplicate(data.operands);
                Op::Patchpoint(self.patchpoints.push(data))
            }
            Op::Return(values) => Op::Return(self.value_lists.duplicate(values)),
            Op::WideNode {
                kind,
                args,
                data,
                state,
            } => Op::WideNode {
                kind,
                args: self.value_lists.duplicate(args),
                data,
                state,
            },
            op => op,
        }
    }

    pub fn tuple_element_type(&self, tuple: Value, position: u32) -> Option<Type> {
        match *self.op(tuple) {
            Op::Wide(..) | Op::MulWide(..) => (position < 2).then_some(Type::I64),
            Op::Node { kind, .. } | Op::WideNode { kind, .. } => self
                .node_info(kind)
                .elements
                .get(position as usize)
                .copied(),
            Op::Patchpoint(patchpoint) => self
                .outputs(patchpoint)
                .get(position as usize)
                .map(|&(ty, _)| ty),
            _ => None,
        }
    }

    // Nodes

    pub fn set_node_kinds(&mut self, kinds: &'static [NodeInfo]) {
        self.node_kinds = kinds;
    }

    #[inline]
    pub fn node_info(&self, kind: NodeKind) -> &'static NodeInfo {
        &self.node_kinds[usize::from(kind.0)]
    }

    #[inline]
    pub fn node_op(&mut self, kind: NodeKind, operands: &[Value], data: u32, state: State) -> Op {
        match *operands {
            [] => Op::Node {
                kind,
                count: 0,
                args: [Value::NONE; 2],
                data,
                state,
            },
            [only] => Op::Node {
                kind,
                count: 1,
                args: [only, Value::NONE],
                data,
                state,
            },
            [first, second] => Op::Node {
                kind,
                count: 2,
                args: [first, second],
                data,
                state,
            },
            _ => Op::WideNode {
                kind,
                args: self.add_values(operands),
                data,
                state,
            },
        }
    }

    // Heaps, slots, variables and cases

    pub fn add_heap(&mut self, range: HeapRange) -> Heap {
        self.heaps.push(range)
    }

    /// For a client that knows the ranges only once it has seen all heaps.
    pub fn set_heap_range(&mut self, heap: Heap, range: HeapRange) {
        self.edits += 1;
        assert!(heap != Heap::EVERYTHING && heap != Heap::NOTHING);
        self.heaps[heap] = range;
    }

    #[inline]
    pub fn heap_range(&self, heap: Heap) -> HeapRange {
        self.heaps[heap]
    }

    pub fn heap_count(&self) -> usize {
        self.heaps.len()
    }

    pub fn add_slot(&mut self, size: u32, alignment: u32) -> Slot {
        assert!(alignment.is_power_of_two() && alignment <= 16);
        self.slots.push(SlotData { size, alignment })
    }

    pub fn slots(&self) -> &Table<Slot, SlotData> {
        &self.slots
    }

    pub fn add_variable(&mut self, ty: Type) -> Variable {
        self.variables.push(ty)
    }

    pub fn variable_count(&self) -> usize {
        self.variables.len()
    }

    pub fn variable_type(&self, variable: Variable) -> Type {
        self.variables[variable]
    }

    /// Once no instruction names a variable.
    pub fn forget_variables(&mut self) {
        self.variables.clear();
    }

    pub fn add_cases(&mut self, cases: impl IntoIterator<Item = i64>) -> Cases {
        let cases = self.case_lists.add(cases);
        self.cases.push(cases)
    }

    pub fn cases(&self, cases: Cases) -> &[i64] {
        &self.case_lists[self.cases[cases]]
    }

    pub fn has_cases(&self) -> bool {
        self.cases.len() != 0
    }

    pub fn value_table<T: Clone>(&self, initial: T) -> Table<Value, T> {
        Table::filled(self.values.len(), initial)
    }

    pub fn block_table<T: Clone>(&self, initial: T) -> Table<Block, T> {
        Table::filled(self.blocks.len(), initial)
    }

    pub fn is_valid_value(&self, value: Value) -> bool {
        value.index() < self.values.len()
    }
}
