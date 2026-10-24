#[cfg(test)]
mod tests;

use core::cell::Cell;
use core::ops::Range;

use super::body::FieldWord;
use super::builder::{
    BuilderScratch, ENTRY_BLOCK, FunctionBuilder, MAX_SPARE_BLOCKS, MAX_SPARE_FIELD_WORDS,
    MAX_SPARE_VALUES, PendingBlock, PendingDefinition, PendingTarget, PendingTerminator,
    PendingValue, recycle_vector,
};
use super::generated::{
    BlockHead, Body, Function, Opcode, ParameterHead, TargetHead, TerminatorHead, ValueHead,
    visit_terminator_fields, visit_value_fields,
};
use super::ids::{BlockId, Id, TypeId, ValueId};

#[derive(Default)]
pub(super) struct FinishScratch {
    is_reached: Vec<bool>,
    block_numbers: Vec<Option<BlockId>>,
    value_numbers: Vec<Option<ValueId>>,
    order: Vec<BlockId>,
    stack: Vec<(BlockId, u32)>,
}

impl FunctionBuilder {
    pub fn finish(self) -> (Function, BuilderScratch) {
        let FunctionBuilder {
            mut function,
            values,
            field_words,
            mut blocks,
            ssa,
            finish_scratch: mut scratch,
            ..
        } = self;
        debug_assert!(
            (0..blocks.len()).all(|index| ssa.is_sealed(BlockId::new(index))),
            "an unsealed block has parameters without arguments"
        );
        close_open_blocks(&mut blocks);
        scratch.order_blocks(&blocks);
        let (value_count, word_count) = scratch.number_values(&blocks, &values);
        let mut encoder = Encoder {
            values: &values,
            field_words: &field_words,
            blocks: &blocks,
            block_numbers: &scratch.block_numbers,
            value_numbers: &scratch.value_numbers,
            value_count,
            words: Vec::with_capacity(word_count),
        };
        for block in &scratch.order {
            encoder.encode_block(&blocks[block.index()]);
        }
        let words = encoder.words;
        debug_assert_eq!(words.len(), word_count);

        function.body = Body {
            code: words,
            block_count: scratch.order.len() as u32,
            value_count,
        };
        let scratch = BuilderScratch {
            values: recycle_vector(values, MAX_SPARE_VALUES),
            field_words: recycle_vector(field_words, MAX_SPARE_FIELD_WORDS),
            blocks: recycle_vector(blocks, MAX_SPARE_BLOCKS),
            ssa: ssa.recycle(),
            finish: scratch.recycle(),
        };
        (function, scratch)
    }
}

fn close_open_blocks(blocks: &mut [PendingBlock]) {
    for block in blocks {
        let terminator = &mut block.terminator;
        let terminator = terminator.get_or_insert_with(PendingTerminator::unreachable);
        let mut targets = terminator.targets.iter().chain(&block.handler);
        debug_assert!(
            targets.all(|target| target.block != ENTRY_BLOCK),
            "no edge targets block 0"
        );
    }
}

fn terminator_of(block: &PendingBlock) -> &PendingTerminator {
    let terminator = block.terminator.as_ref();
    terminator.expect("close_open_blocks terminates every block")
}

fn successor_count(block: &PendingBlock) -> usize {
    terminator_of(block).targets.len() + usize::from(block.handler.is_some())
}

fn successor(block: &PendingBlock, index: usize) -> BlockId {
    let handler = block.handler.as_ref();
    let target = terminator_of(block).targets.get(index).or(handler);
    target.expect("an index below the successor count").block
}

fn operation_of(value: &PendingValue) -> (Opcode, &Range<u32>) {
    match &value.definition {
        PendingDefinition::Operation { opcode, fields } => (*opcode, fields),
        PendingDefinition::Parameter { .. } => {
            unreachable!("a block lists no parameter as a value")
        }
    }
}

fn declared_type_of(parameter: &PendingValue) -> Option<TypeId> {
    match parameter.definition {
        PendingDefinition::Parameter { declared } => declared,
        PendingDefinition::Operation { .. } => {
            unreachable!("a block lists no operation as a parameter")
        }
    }
}

fn parameters_of(block: &PendingBlock) -> impl Iterator<Item = ValueId> {
    let parameters = block.parameters.iter().chain(&block.variable_parameters);
    parameters.chain(&block.edge_results).copied()
}

fn parameter_count(block: &PendingBlock) -> usize {
    block.parameters.len() + block.variable_parameters.len() + block.edge_results.len()
}

fn arguments_of(target: &PendingTarget) -> impl Iterator<Item = ValueId> {
    let arguments = target.arguments.iter().chain(&target.variable_arguments);
    arguments.chain(&target.trailing_arguments).copied()
}

fn argument_count(target: &PendingTarget) -> usize {
    target.arguments.len() + target.variable_arguments.len() + target.trailing_arguments.len()
}

fn target_length(target: &PendingTarget) -> usize {
    TargetHead::WORDS + argument_count(target) + target.proofs.len()
}

fn block_length(block: &PendingBlock, values: &[PendingValue]) -> usize {
    let handler_length = block.handler.as_ref().map_or(0, target_length);
    let listed_values = block.values.iter();
    let values_length: usize = listed_values
        .map(|value| ValueHead::WORDS + operation_of(&values[value.index()]).1.len())
        .sum();
    let terminator = terminator_of(block);
    let targets_length: usize = terminator.targets.iter().map(target_length).sum();
    BlockHead::WORDS
        + parameter_count(block) * ParameterHead::WORDS
        + handler_length
        + values_length
        + TerminatorHead::WORDS
        + terminator.fields.len()
        + targets_length
}

fn number_of(value_numbers: &[Option<ValueId>], value_count: u32, pending: ValueId) -> u32 {
    let number = value_numbers.get(pending.index()).copied().flatten();
    debug_assert!(
        number.is_some(),
        "{pending} is used, but no reached block lists it"
    );
    number.map_or(value_count, ValueId::to_word)
}

impl FinishScratch {
    fn order_blocks(&mut self, blocks: &[PendingBlock]) {
        let successor_count_of = |block: BlockId| successor_count(&blocks[block.index()]) as u32;
        self.is_reached.resize(blocks.len(), false);
        self.is_reached[ENTRY_BLOCK.index()] = true;
        self.stack
            .push((ENTRY_BLOCK, successor_count_of(ENTRY_BLOCK)));
        while let Some((block, unvisited_successor_count)) = self.stack.last_mut() {
            let Some(next) = unvisited_successor_count.checked_sub(1) else {
                self.order.push(*block);
                self.stack.pop();
                continue;
            };
            *unvisited_successor_count = next;
            let target = successor(&blocks[block.index()], next as usize);
            if !core::mem::replace(&mut self.is_reached[target.index()], true) {
                self.stack.push((target, successor_count_of(target)));
            }
        }
        self.order.reverse();

        self.block_numbers.resize(blocks.len(), None);
        for (number, block) in self.order.iter().enumerate() {
            self.block_numbers[block.index()] = Some(BlockId::new(number));
        }
    }

    // The number of values and of words of the body.
    fn number_values(&mut self, blocks: &[PendingBlock], values: &[PendingValue]) -> (u32, usize) {
        self.value_numbers.resize(values.len(), None);
        let (mut value_count, mut word_count) = (0, 0);
        for block in &self.order {
            let block = &blocks[block.index()];
            for value in parameters_of(block).chain(block.values.iter().copied()) {
                let number = &mut self.value_numbers[value.index()];
                debug_assert!(number.is_none(), "{value} is listed twice");
                *number = Some(ValueId::from_word(value_count));
                value_count += 1;
            }
            word_count += block_length(block, values);
        }
        (value_count, word_count)
    }

    fn recycle(self) -> FinishScratch {
        FinishScratch {
            is_reached: recycle_vector(self.is_reached, MAX_SPARE_BLOCKS),
            block_numbers: recycle_vector(self.block_numbers, MAX_SPARE_BLOCKS),
            value_numbers: recycle_vector(self.value_numbers, MAX_SPARE_VALUES),
            order: recycle_vector(self.order, MAX_SPARE_BLOCKS),
            stack: recycle_vector(self.stack, MAX_SPARE_BLOCKS),
        }
    }
}

struct Encoder<'a> {
    values: &'a [PendingValue],
    field_words: &'a [u32],
    blocks: &'a [PendingBlock],
    block_numbers: &'a [Option<BlockId>],
    value_numbers: &'a [Option<ValueId>],
    value_count: u32,
    words: Vec<u32>,
}

impl Encoder<'_> {
    fn encode_block(&mut self, block: &PendingBlock) {
        let values = self.values;
        let subject = block.subject.map(|pending| {
            ValueId::from_word(number_of(self.value_numbers, self.value_count, pending))
        });
        let head = BlockHead {
            parameter_count: parameter_count(block) as u32,
            value_count: block.values.len() as u32,
            role: block.role,
            subject,
            frequency: block.frequency,
            has_handler: block.handler.is_some(),
        };
        head.append_to(&mut self.words);
        for parameter in parameters_of(block) {
            let ty = declared_type_of(&values[parameter.index()]);
            ParameterHead { ty }.append_to(&mut self.words);
        }
        if let Some(handler) = &block.handler {
            self.encode_target(handler);
        }
        for &value in &block.values {
            self.encode_value(value);
        }
        self.encode_terminator(terminator_of(block));
    }

    fn encode_value(&mut self, id: ValueId) {
        let value = &self.values[id.index()];
        let (opcode, fields) = operation_of(value);
        let head = ValueHead {
            opcode: opcode.to_wire(),
            position: value.position,
        };
        head.append_to(&mut self.words);
        self.encode_fields(fields, |words, visit| {
            visit_value_fields(opcode, words, 0, visit)
        });
    }

    fn encode_terminator(&mut self, terminator: &PendingTerminator) {
        let kind = terminator.kind;
        let head = TerminatorHead {
            kind: kind.to_wire(),
            position: terminator.position,
            target_count: terminator.targets.len() as u32,
        };
        head.append_to(&mut self.words);
        self.encode_fields(&terminator.fields, |words, visit| {
            visit_terminator_fields(kind, words, 0, visit)
        });
        for target in &terminator.targets {
            self.encode_target(target);
        }
    }

    fn encode_target(&mut self, target: &PendingTarget) {
        debug_assert_eq!(
            argument_count(target) + target.proofs.len(),
            parameter_count(&self.blocks[target.block.index()]),
            "an edge fills every parameter of its target"
        );
        let block = self.block_numbers[target.block.index()];
        let head = TargetHead {
            block: block.expect("a successor of a reached block is reached"),
            argument_count: argument_count(target) as u32,
            proof_count: target.proofs.len() as u32,
        };
        head.append_to(&mut self.words);
        for argument in arguments_of(target) {
            let number = number_of(self.value_numbers, self.value_count, argument);
            self.words.push(number);
        }
        self.words.extend_from_slice(&target.proofs);
    }

    fn encode_fields(
        &mut self,
        fields: &Range<u32>,
        visit_fields: impl FnOnce(&[Cell<u32>], &mut dyn FnMut(FieldWord, usize)) -> Option<usize>,
    ) {
        let (value_numbers, value_count) = (self.value_numbers, self.value_count);
        let field_words = self.field_words;
        let fields = &field_words[fields.start as usize..fields.end as usize];
        let start = self.words.len();
        self.words.extend_from_slice(fields);
        let cells = Cell::from_mut(&mut self.words[start..]).as_slice_of_cells();
        let end = visit_fields(cells, &mut |field: FieldWord, at: usize| match field {
            FieldWord::Operand => {
                let pending = ValueId::from_word(cells[at].get());
                cells[at].set(number_of(value_numbers, value_count, pending));
            }
            FieldWord::Reference(_) => {}
        });
        debug_assert_eq!(end, Some(cells.len()), "the fields have their wire form");
    }
}
