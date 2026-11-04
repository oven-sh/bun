use core::ops::Range;

use smallvec::SmallVec;

use super::entry_parameters::EntryPosition;
use super::finish::FinishScratch;
use super::generated::{
    BlockRole, EntryParameter, Function, Opcode, STANDS_IN_TAIL_POSITION, TerminatorKind,
    ValueHead, visit_terminator_fields, visit_value_fields,
};
use super::ids::{BlockId, Id, TypeId, ValueId, optional_id_to_word};
use super::ssa::SsaState;

pub(super) const MAX_SPARE_VALUES: usize = 1 << 16;
pub(super) const MAX_SPARE_FIELD_WORDS: usize = 1 << 18;
pub(super) const MAX_SPARE_BLOCKS: usize = 1 << 12;
pub(super) const ENTRY_BLOCK: BlockId = BlockId::from_word(0);
pub(super) const NO_VALUE: u32 = u32::MAX;
pub(super) const IS_PARAMETER: u32 = u32::MAX - 1;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct LocalVariable(pub(super) u32);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Handler {
    pub(super) block: BlockId,
    pub(super) visible_variable_count: u32,
}

impl Handler {
    pub fn block(self) -> BlockId {
        self.block
    }
}

#[derive(Copy, Clone, Debug)]
pub struct Edge<'a> {
    pub block: BlockId,
    pub arguments: &'a [ValueId],
    pub proofs: &'a [u32],
}

impl<'a> Edge<'a> {
    pub fn to(block: BlockId) -> Edge<'a> {
        Edge::with_arguments(block, &[])
    }

    pub fn with_arguments(block: BlockId, arguments: &'a [ValueId]) -> Edge<'a> {
        Edge {
            block,
            arguments,
            proofs: &[],
        }
    }

    pub fn with_proofs(block: BlockId, proofs: &'a [u32]) -> Edge<'a> {
        Edge {
            block,
            arguments: &[],
            proofs,
        }
    }
}

#[derive(Default)]
pub struct BuilderScratch {
    pub(super) words: Vec<u32>,
    pub(super) values: Vec<PendingValue>,
    pub(super) blocks: Vec<PendingBlock>,
    pub(super) ssa: SsaState,
    pub(super) finish: FinishScratch,
}

pub(super) fn recycle_vector<T>(mut vector: Vec<T>, max_spare_capacity: usize) -> Vec<T> {
    if vector.capacity() > max_spare_capacity {
        return Vec::new();
    }
    vector.clear();
    vector
}

/// An operation: `at..at + word_count` of `FunctionBuilder::words` is its wire form (`ValueHead`, fields), with pending ids as operands.
/// `next` is the id of the next operation in its block, or `NO_VALUE` for the last one.
/// A parameter: `next` is `IS_PARAMETER`, `at` is `optional_id_to_word(declared)`, `word_count` is 0.
#[derive(Copy, Clone)]
pub(super) struct PendingValue {
    pub(super) at: u32,
    pub(super) word_count: u32,
    pub(super) next: u32,
}

const _: () = assert!(size_of::<PendingValue>() == 12);

/// `arguments`, `trailing_arguments` and `proofs` are ranges of `FunctionBuilder::words`. An argument is a pending id.
/// Only SSA construction adds to an edge later.
pub(super) struct PendingTarget {
    pub(super) block: BlockId,
    pub(super) arguments: Range<u32>,
    pub(super) variable_arguments: SmallVec<[ValueId; 4]>,
    pub(super) trailing_arguments: Range<u32>,
    pub(super) proofs: Range<u32>,
}

impl PendingTarget {
    pub(super) fn new(block: BlockId) -> PendingTarget {
        PendingTarget {
            block,
            arguments: 0..0,
            variable_arguments: SmallVec::new(),
            trailing_arguments: 0..0,
            proofs: 0..0,
        }
    }
}

/// `fields` is a range of `FunctionBuilder::words`, with pending ids as operands.
pub(super) struct PendingTerminator {
    pub(super) kind: TerminatorKind,
    pub(super) position: Option<u32>,
    pub(super) fields: Range<u32>,
    pub(super) targets: SmallVec<[PendingTarget; 2]>,
}

impl PendingTerminator {
    pub(super) fn unreachable() -> PendingTerminator {
        PendingTerminator {
            kind: TerminatorKind::Unreachable,
            position: None,
            fields: 0..0,
            targets: SmallVec::new(),
        }
    }
}

pub(super) struct PendingBlock {
    pub(super) parameters: SmallVec<[ValueId; 4]>,
    pub(super) variable_parameters: SmallVec<[ValueId; 4]>,
    pub(super) edge_results: SmallVec<[ValueId; 4]>,
    /// The operations, linked through `PendingValue::next`.
    pub(super) first_value: u32,
    pub(super) last_value: u32,
    pub(super) value_count: u32,
    /// The words of those operations.
    pub(super) value_word_count: u32,
    pub(super) terminator: Option<PendingTerminator>,
    pub(super) handler: Option<PendingTarget>,
    pub(super) covering: Option<Handler>,
    pub(super) role: BlockRole,
    pub(super) subject: Option<ValueId>,
    pub(super) visible_variable_count: u32,
}

impl Default for PendingBlock {
    fn default() -> PendingBlock {
        PendingBlock {
            parameters: SmallVec::new(),
            variable_parameters: SmallVec::new(),
            edge_results: SmallVec::new(),
            first_value: NO_VALUE,
            last_value: NO_VALUE,
            value_count: 0,
            value_word_count: 0,
            terminator: None,
            handler: None,
            covering: None,
            role: BlockRole::Ordinary,
            subject: None,
            visible_variable_count: 0,
        }
    }
}

pub struct FunctionBuilder {
    pub(super) function: Function,
    /// Whatever has a length of its own lies here and is named by a range: operations, fields of terminators, explicit arguments, proofs.
    pub(super) words: Vec<u32>,
    pub(super) values: Vec<PendingValue>,
    pub(super) blocks: Vec<PendingBlock>,
    pub(super) current_block: BlockId,
    pub(super) position: Option<u32>,
    stands_in_tail_position: bool,
    pub(super) ssa: SsaState,
    pub(super) finish_scratch: FinishScratch,
}

impl FunctionBuilder {
    pub fn new(function: Function, scratch: BuilderScratch) -> FunctionBuilder {
        debug_assert!(function.body.code.is_empty());
        let mut builder = FunctionBuilder {
            function,
            words: scratch.words,
            values: scratch.values,
            blocks: scratch.blocks,
            current_block: ENTRY_BLOCK,
            position: None,
            stands_in_tail_position: false,
            ssa: scratch.ssa,
            finish_scratch: scratch.finish,
        };
        let entry = builder.create_block(None);
        for index in 0..builder.function.entry_parameter_count() {
            let position = builder.function.entry_parameter(index);
            let position = position.expect("an index below the count");
            let declared = builder.function.entry_parameter_type(position);
            builder.add_parameter(entry, Some(declared));
        }
        builder.seal(entry);
        builder
    }

    pub fn function(&self) -> &Function {
        &self.function
    }

    pub fn entry_value(&self, position: EntryPosition) -> Option<ValueId> {
        let index = self.function.entry_parameter_index(position)?;
        Some(self.blocks[ENTRY_BLOCK.index()].parameters[index])
    }

    pub fn capture(&self, index: u32) -> ValueId {
        self.entry_value(EntryPosition::new(EntryParameter::Capture, index))
            .expect("the function declares the capture")
    }

    pub fn parameter(&self, index: u32) -> ValueId {
        self.entry_value(EntryPosition::new(EntryParameter::Parameter, index))
            .expect("the function declares the parameter")
    }

    pub fn this_value(&self) -> Option<ValueId> {
        self.entry_value(EntryPosition::single(EntryParameter::This))
    }

    pub fn callee(&self) -> Option<ValueId> {
        self.entry_value(EntryPosition::single(EntryParameter::Callee))
    }

    pub fn new_target(&self) -> Option<ValueId> {
        self.entry_value(EntryPosition::single(EntryParameter::NewTarget))
    }

    pub fn argument_count(&self) -> Option<ValueId> {
        self.entry_value(EntryPosition::single(EntryParameter::ArgumentCount))
    }

    pub fn hidden_rest(&self) -> Option<ValueId> {
        self.entry_value(EntryPosition::single(EntryParameter::HiddenRest))
    }

    pub fn create_block(&mut self, handler: Option<Handler>) -> BlockId {
        let block = BlockId::new(self.blocks.len());
        self.blocks.push(PendingBlock::default());
        self.ssa.add_block();
        if let Some(handler) = handler {
            debug_assert!(
                !self.ssa.is_sealed(handler.block),
                "a sealed handler covers no new block"
            );
            let pending = &mut self.blocks[block.index()];
            pending.handler = Some(PendingTarget::new(handler.block));
            pending.covering = Some(handler);
            self.ssa.add_predecessor(handler.block, block);
        }
        block
    }

    pub fn create_handler(
        &mut self,
        role: BlockRole,
        subject: Option<ValueId>,
        outer: Option<Handler>,
    ) -> Handler {
        debug_assert!(role != BlockRole::Ordinary, "a handler block has a role");
        let block = self.create_block(outer);
        let visible_variable_count = self.ssa.variable_count();
        let pending = &mut self.blocks[block.index()];
        pending.role = role;
        pending.subject = subject;
        pending.visible_variable_count = visible_variable_count;
        Handler {
            block,
            visible_variable_count,
        }
    }

    pub fn handler_of(&self, block: BlockId) -> Option<Handler> {
        self.blocks[block.index()].covering
    }

    pub fn add_parameter(&mut self, block: BlockId, declared: Option<TypeId>) -> ValueId {
        self.assert_takes_parameters(block);
        debug_assert!(
            self.blocks[block.index()].edge_results.is_empty(),
            "parameters that every edge fills with an argument precede edge results"
        );
        let parameter = self.add_parameter_value(declared);
        self.blocks[block.index()].parameters.push(parameter);
        parameter
    }

    pub fn add_edge_result(&mut self, block: BlockId) -> ValueId {
        self.assert_takes_parameters(block);
        let parameter = self.add_parameter_value(None);
        self.blocks[block.index()].edge_results.push(parameter);
        parameter
    }

    fn assert_takes_parameters(&self, block: BlockId) {
        debug_assert!(
            !self.has_predecessors(block) && !self.ssa.is_sealed(block),
            "explicit parameters are added before the first edge"
        );
        debug_assert!(
            self.blocks[block.index()].role == BlockRole::Ordinary,
            "a handler block has variable parameters only"
        );
    }

    pub(super) fn add_parameter_value(&mut self, declared: Option<TypeId>) -> ValueId {
        let value = self.next_value_id();
        self.values.push(PendingValue {
            at: optional_id_to_word(declared),
            word_count: 0,
            next: IS_PARAMETER,
        });
        value
    }

    fn next_value_id(&self) -> ValueId {
        let index = self.values.len();
        assert!(
            index < IS_PARAMETER as usize,
            "the id of a value lies below IS_PARAMETER"
        );
        ValueId::new(index)
    }

    pub fn switch_to(&mut self, block: BlockId) {
        self.current_block = block;
    }

    pub fn current_block(&self) -> BlockId {
        self.current_block
    }

    pub fn is_open(&self) -> bool {
        self.blocks[self.current_block.index()].terminator.is_none()
    }

    pub fn is_unreachable(&self) -> bool {
        let block = self.current_block;
        !self.is_open()
            || (block != ENTRY_BLOCK && self.ssa.is_sealed(block) && !self.has_predecessors(block))
    }

    pub fn has_predecessors(&self, block: BlockId) -> bool {
        self.ssa.predecessor_count(block) > 0
    }

    pub fn set_position(&mut self, position: Option<u32>) {
        self.position = position;
    }

    // What is emitted from here on stands for a call in tail position: a stack trace that passes through it does not list the function.
    pub fn set_tail_position(&mut self, stands: bool) -> bool {
        std::mem::replace(&mut self.stands_in_tail_position, stands)
    }

    #[cfg(test)]
    pub fn position(&self) -> Option<u32> {
        self.position
    }

    pub fn emit(&mut self, opcode: Opcode, fields: &[u32]) -> ValueId {
        debug_assert_eq!(
            visit_value_fields(opcode, fields, 0, &mut |_, _| {}),
            Some(fields.len()),
            "{}: the fields have their wire form",
            opcode.name()
        );
        if !self.is_open() {
            debug_assert!(false, "a value is emitted into an open block");
            let block = self.create_block(None);
            self.seal(block);
            self.switch_to(block);
        }
        let mark = if self.stands_in_tail_position {
            STANDS_IN_TAIL_POSITION
        } else {
            0
        };
        let head = ValueHead {
            opcode: opcode.to_wire() | mark,
            position: self.position,
        };
        self.append_value(self.current_block, head, fields, false)
    }

    /// `at_front`: ahead of every operation that `block` lists. `block` may be terminated already.
    pub(super) fn append_operation(
        &mut self,
        block: BlockId,
        opcode: Opcode,
        position: Option<u32>,
        fields: &[u32],
        at_front: bool,
    ) -> ValueId {
        let head = ValueHead {
            opcode: opcode.to_wire(),
            position,
        };
        self.append_value(block, head, fields, at_front)
    }

    fn append_value(
        &mut self,
        block: BlockId,
        head: ValueHead,
        fields: &[u32],
        at_front: bool,
    ) -> ValueId {
        let value = self.next_value_id();
        let at = self.end_of_words();
        head.append_to(&mut self.words);
        self.words.extend_from_slice(fields);
        let word_count = self.end_of_words() - at;

        let id = value.to_word();
        let mut next = NO_VALUE;
        let pending = &mut self.blocks[block.index()];
        if pending.first_value == NO_VALUE {
            pending.first_value = id;
            pending.last_value = id;
        } else if at_front {
            next = pending.first_value;
            pending.first_value = id;
        } else {
            self.values[pending.last_value as usize].next = id;
            pending.last_value = id;
        }
        pending.value_count += 1;
        pending.value_word_count += word_count;
        self.values.push(PendingValue {
            at,
            word_count,
            next,
        });
        value
    }

    /// None: a parameter.
    pub(super) fn opcode_of(&self, value: ValueId) -> Option<Opcode> {
        let pending = self.values[value.index()];
        if pending.next == IS_PARAMETER {
            return None;
        }
        let head = self.words[pending.at as usize];
        let opcode = Opcode::from_wire(head & !STANDS_IN_TAIL_POSITION);
        debug_assert!(opcode.is_some(), "an operation begins with its opcode");
        opcode
    }

    pub fn terminate(&mut self, kind: TerminatorKind, fields: &[u32], edges: &[Edge<'_>]) {
        debug_assert_eq!(
            visit_terminator_fields(kind, fields, 0, &mut |_, _| {}),
            Some(fields.len()),
            "{}: the fields have their wire form",
            kind.name()
        );
        if !self.is_open() {
            return;
        }
        let block = self.current_block;
        if self.is_unreachable() {
            self.blocks[block.index()].terminator = Some(PendingTerminator::unreachable());
            return;
        }
        let targets = edges.iter().map(|edge| self.create_target(edge)).collect();
        for edge in edges {
            self.ssa.add_predecessor(edge.block, block);
        }
        let fields = self.append_words(fields);
        self.blocks[block.index()].terminator = Some(PendingTerminator {
            kind,
            position: self.position,
            fields,
            targets,
        });
    }

    fn create_target(&mut self, edge: &Edge<'_>) -> PendingTarget {
        let target = &self.blocks[edge.block.index()];
        let parameter_count = target.parameters.len();
        debug_assert!(edge.block != ENTRY_BLOCK, "no edge targets block 0");
        debug_assert!(
            !self.ssa.is_sealed(edge.block),
            "a sealed block gets no new predecessor"
        );
        debug_assert!(
            target.role == BlockRole::Ordinary,
            "only handler edges reach a handler block"
        );
        debug_assert!(
            edge.proofs.len() <= target.edge_results.len(),
            "a proof fills an edge result"
        );
        debug_assert_eq!(
            edge.arguments.len() + edge.proofs.len(),
            parameter_count + target.edge_results.len(),
            "an edge fills every explicit parameter of its target"
        );
        let explicit_argument_count = parameter_count.min(edge.arguments.len());
        let (arguments, trailing_arguments) = edge.arguments.split_at(explicit_argument_count);
        PendingTarget {
            block: edge.block,
            arguments: self.append_pending_ids(arguments),
            variable_arguments: SmallVec::new(),
            trailing_arguments: self.append_pending_ids(trailing_arguments),
            proofs: self.append_words(edge.proofs),
        }
    }

    fn append_pending_ids(&mut self, values: &[ValueId]) -> Range<u32> {
        let start = self.end_of_words();
        let ids = values.iter().map(|value| value.to_word());
        self.words.extend(ids);
        start..self.end_of_words()
    }

    fn append_words(&mut self, words: &[u32]) -> Range<u32> {
        let start = self.end_of_words();
        self.words.extend_from_slice(words);
        start..self.end_of_words()
    }

    fn end_of_words(&self) -> u32 {
        u32::try_from(self.words.len()).expect("the words of a function fit 32 bits")
    }

    pub fn create_variable(&mut self, declared: Option<TypeId>) -> LocalVariable {
        self.ssa.create_variable(declared)
    }
}
