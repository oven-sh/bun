use core::ops::Range;

use smallvec::SmallVec;

use super::entry_parameters::EntryPosition;
use super::finish::FinishScratch;
use super::generated::{
    BlockFrequency, BlockRole, EntryParameter, Function, Opcode, TerminatorKind,
    visit_terminator_fields, visit_value_fields,
};
use super::ids::{BlockId, Id, TypeId, ValueId};
use super::ssa::SsaState;

pub(super) const MAX_SPARE_VALUES: usize = 1 << 16;
pub(super) const MAX_SPARE_FIELD_WORDS: usize = 1 << 18;
pub(super) const MAX_SPARE_BLOCKS: usize = 1 << 12;
pub(super) const ENTRY_BLOCK: BlockId = BlockId::from_word(0);

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
    pub(super) values: Vec<PendingValue>,
    pub(super) field_words: Vec<u32>,
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

pub(super) enum PendingDefinition {
    Parameter { declared: Option<TypeId> },
    Operation { opcode: Opcode, fields: Range<u32> },
}

pub(super) struct PendingValue {
    pub(super) definition: PendingDefinition,
    pub(super) position: Option<u32>,
}

const _: () = assert!(size_of::<PendingValue>() <= 24);

pub(super) struct PendingTarget {
    pub(super) block: BlockId,
    pub(super) arguments: SmallVec<[ValueId; 4]>,
    pub(super) variable_arguments: SmallVec<[ValueId; 4]>,
    pub(super) trailing_arguments: SmallVec<[ValueId; 4]>,
    pub(super) proofs: SmallVec<[u32; 4]>,
}

impl PendingTarget {
    pub(super) fn new(block: BlockId) -> PendingTarget {
        PendingTarget {
            block,
            arguments: SmallVec::new(),
            variable_arguments: SmallVec::new(),
            trailing_arguments: SmallVec::new(),
            proofs: SmallVec::new(),
        }
    }
}

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

#[derive(Default)]
pub(super) struct PendingBlock {
    pub(super) parameters: SmallVec<[ValueId; 4]>,
    pub(super) variable_parameters: SmallVec<[ValueId; 4]>,
    pub(super) edge_results: SmallVec<[ValueId; 4]>,
    pub(super) values: SmallVec<[ValueId; 8]>,
    pub(super) terminator: Option<PendingTerminator>,
    pub(super) handler: Option<PendingTarget>,
    pub(super) covering: Option<Handler>,
    pub(super) role: BlockRole,
    pub(super) subject: Option<ValueId>,
    pub(super) frequency: BlockFrequency,
    pub(super) visible_variable_count: u32,
}

pub struct FunctionBuilder {
    pub(super) function: Function,
    pub(super) values: Vec<PendingValue>,
    pub(super) field_words: Vec<u32>,
    pub(super) blocks: Vec<PendingBlock>,
    pub(super) current_block: BlockId,
    pub(super) position: Option<u32>,
    pub(super) ssa: SsaState,
    pub(super) finish_scratch: FinishScratch,
}

impl FunctionBuilder {
    pub fn new(function: Function, scratch: BuilderScratch) -> FunctionBuilder {
        debug_assert!(function.body.code.is_empty());
        let mut builder = FunctionBuilder {
            function,
            values: scratch.values,
            field_words: scratch.field_words,
            blocks: scratch.blocks,
            current_block: ENTRY_BLOCK,
            position: None,
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

    pub fn set_frequency(&mut self, block: BlockId, frequency: BlockFrequency) {
        self.blocks[block.index()].frequency = frequency;
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
        let value = ValueId::new(self.values.len());
        self.values.push(PendingValue {
            definition: PendingDefinition::Parameter { declared },
            position: None,
        });
        value
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
        let fields = self.append_field_words(fields);
        let value = ValueId::new(self.values.len());
        self.values.push(PendingValue {
            definition: PendingDefinition::Operation { opcode, fields },
            position: self.position,
        });
        self.blocks[self.current_block.index()].values.push(value);
        value
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
        let fields = self.append_field_words(fields);
        self.blocks[block.index()].terminator = Some(PendingTerminator {
            kind,
            position: self.position,
            fields,
            targets,
        });
    }

    fn create_target(&self, edge: &Edge<'_>) -> PendingTarget {
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
            arguments: SmallVec::from_slice(arguments),
            variable_arguments: SmallVec::new(),
            trailing_arguments: SmallVec::from_slice(trailing_arguments),
            proofs: SmallVec::from_slice(edge.proofs),
        }
    }

    fn append_field_words(&mut self, fields: &[u32]) -> Range<u32> {
        let start = self.field_word_count();
        self.field_words.extend_from_slice(fields);
        start..self.field_word_count()
    }

    fn field_word_count(&self) -> u32 {
        u32::try_from(self.field_words.len()).expect("the field words of a function fit 32 bits")
    }

    pub fn create_variable(&mut self, declared: Option<TypeId>) -> LocalVariable {
        self.ssa.create_variable(declared)
    }
}
