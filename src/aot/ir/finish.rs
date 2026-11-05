#[cfg(test)]
mod tests;

use core::cell::Cell;
use core::ops::Range;

use super::body::FieldWord;
use super::builder::{
    BuilderScratch, ENTRY_BLOCK, FunctionBuilder, IS_PARAMETER, MAX_SPARE_BLOCKS,
    MAX_SPARE_FIELD_WORDS, MAX_SPARE_VALUES, NO_VALUE, PendingBlock, PendingTarget,
    PendingTerminator, PendingValue, recycle_vector,
};
use super::generated::{
    BlockHead, BlockRole, Body, Function, Opcode, ParameterHead, STANDS_IN_TAIL_POSITION,
    TargetHead, TerminatorHead, TerminatorKind, ValueHead, WRITTEN_POSITION_FOLLOWS,
    WRITTEN_POSITION_IS_FOR_CALLERS, visit_terminator_fields, visit_value_fields,
};
use super::ids::{BlockId, Id, TypeId, ValueId, optional_id_from_word};

const MARKS: u32 =
    WRITTEN_POSITION_FOLLOWS | STANDS_IN_TAIL_POSITION | WRITTEN_POSITION_IS_FOR_CALLERS;

#[derive(Default)]
pub(super) struct FinishScratch {
    is_reached: Vec<bool>,
    block_numbers: Vec<Option<BlockId>>,
    numbers: Vec<u32>,
    order: Vec<BlockId>,
    stack: Vec<(BlockId, u32)>,
    incoming: Vec<u32>,
    goes_on_in_target: Vec<bool>,
    places: Vec<u32>,
    is_passed_by: Vec<bool>,
}

#[derive(Default)]
struct BodySize {
    value_count: u32,
    word_count: usize,
}

impl FunctionBuilder {
    pub fn finish(self) -> (Function, BuilderScratch) {
        let FunctionBuilder {
            mut function,
            words: pending_words,
            values,
            mut blocks,
            ssa,
            finish_scratch: mut scratch,
            ..
        } = self;
        debug_assert!(
            (0..blocks.len()).all(|index| ssa.is_sealed(BlockId::new(index))),
            "an unsealed block has parameters without arguments"
        );
        for (narrowed, block) in ssa.unread_names() {
            let pending = &mut blocks[block.index()];
            if pending.first_value != narrowed.to_word() {
                continue;
            }
            let removed = &values[narrowed.index()];
            pending.first_value = removed.next;
            if pending.last_value == narrowed.to_word() {
                pending.last_value = NO_VALUE;
            }
            pending.value_count -= 1;
            pending.value_word_count -= removed.word_count;
        }
        let BodySize {
            value_count,
            word_count,
        } = scratch.order_blocks(&mut blocks, &values, &pending_words);
        scratch.numbers.resize(values.len(), NO_VALUE);
        let mut encoder = Encoder {
            pending_words: &pending_words,
            values: &values,
            blocks: &blocks,
            block_numbers: &scratch.block_numbers,
            goes_on_in_target: &scratch.goes_on_in_target,
            numbers: &mut scratch.numbers,
            next_number: 0,
            value_count,
            words: Vec::with_capacity(word_count),
        };
        for block in &scratch.order {
            encoder.encode_block(*block);
        }
        debug_assert_eq!(encoder.next_number, value_count);
        let words = encoder.words;
        debug_assert_eq!(words.len(), word_count);

        function.body = Body {
            code: words,
            block_count: scratch.order.len() as u32,
            value_count,
        };
        let scratch = BuilderScratch {
            words: recycle_vector(pending_words, MAX_SPARE_FIELD_WORDS),
            values: recycle_vector(values, MAX_SPARE_VALUES),
            blocks: recycle_vector(blocks, MAX_SPARE_BLOCKS),
            ssa: ssa.recycle(),
            finish: scratch.recycle(),
        };
        (function, scratch)
    }
}

fn terminator_of(block: &PendingBlock) -> &PendingTerminator {
    let terminator = block.terminator.as_ref();
    terminator.expect("add_block terminates every reached block")
}

fn successor_count(block: &PendingBlock) -> usize {
    terminator_of(block).targets.len() + usize::from(block.handler.is_some())
}

fn successor(block: &PendingBlock, index: usize) -> BlockId {
    let handler = block.handler.as_ref();
    let target = terminator_of(block).targets.get(index).or(handler);
    target.expect("an index below the successor count").block
}

fn declared_type_of(parameter: &PendingValue) -> Option<TypeId> {
    debug_assert!(
        parameter.next == IS_PARAMETER,
        "a block lists no operation as a parameter"
    );
    optional_id_from_word(parameter.at)
}

fn parameters_of(block: &PendingBlock) -> impl Iterator<Item = ValueId> {
    let parameters = block.parameters.iter().chain(&block.variable_parameters);
    parameters.chain(&block.edge_results).copied()
}

fn parameter_count(block: &PendingBlock) -> usize {
    block.parameters.len() + block.variable_parameters.len() + block.edge_results.len()
}

fn words_in<'a>(pending_words: &'a [u32], range: &Range<u32>) -> &'a [u32] {
    &pending_words[range.start as usize..range.end as usize]
}

fn pending_ids_in(pending_words: &[u32], range: &Range<u32>) -> impl Iterator<Item = ValueId> {
    let words = words_in(pending_words, range).iter();
    words.map(|&word| ValueId::from_word(word))
}

fn arguments_of(target: &PendingTarget, pending_words: &[u32]) -> impl Iterator<Item = ValueId> {
    let arguments = pending_ids_in(pending_words, &target.arguments);
    let arguments = arguments.chain(target.variable_arguments.iter().copied());
    arguments.chain(pending_ids_in(pending_words, &target.trailing_arguments))
}

fn argument_count(target: &PendingTarget) -> usize {
    target.arguments.len() + target.variable_arguments.len() + target.trailing_arguments.len()
}

fn has_same_handler(first: &PendingBlock, second: &PendingBlock, pending_words: &[u32]) -> bool {
    match (&first.handler, &second.handler) {
        (None, None) => true,
        (Some(first), Some(second)) => {
            first.block == second.block
                && first.proofs.is_empty()
                && second.proofs.is_empty()
                && arguments_of(first, pending_words).eq(arguments_of(second, pending_words))
        }
        (None, Some(_)) | (Some(_), None) => false,
    }
}

fn copy_of(target: &PendingTarget) -> PendingTarget {
    PendingTarget {
        block: target.block,
        arguments: target.arguments.clone(),
        variable_arguments: target.variable_arguments.clone(),
        trailing_arguments: target.trailing_arguments.clone(),
        proofs: target.proofs.clone(),
    }
}

fn target_length(target: &PendingTarget) -> usize {
    TargetHead::WORDS + argument_count(target) + target.proofs.len()
}

fn block_length(block: &PendingBlock) -> usize {
    let handler_length = block.handler.as_ref().map_or(0, target_length);
    let terminator = terminator_of(block);
    let targets_length: usize = terminator.targets.iter().map(target_length).sum();
    BlockHead::WORDS
        + parameter_count(block) * ParameterHead::WORDS
        + handler_length
        + block.value_word_count as usize
        + TerminatorHead::WORDS
        + terminator.fields.len()
        + targets_length
}

fn number_of(numbers: &[u32], value_count: u32, pending: ValueId) -> u32 {
    let number = numbers.get(pending.index()).copied();
    let number = number.filter(|&number| number != NO_VALUE);
    debug_assert!(
        number.is_some(),
        "{pending} is used, but no reached block lists it ahead of the use"
    );
    number.unwrap_or(value_count)
}

impl BodySize {
    fn add_block(&mut self, block: &mut PendingBlock) -> u32 {
        let terminator = &mut block.terminator;
        let terminator = terminator.get_or_insert_with(PendingTerminator::unreachable);
        let mut targets = terminator.targets.iter().chain(&block.handler);
        debug_assert!(
            targets.all(|target| target.block != ENTRY_BLOCK),
            "no edge targets block 0"
        );
        self.value_count += parameter_count(block) as u32 + block.value_count;
        self.word_count += block_length(block);
        successor_count(block) as u32
    }
}

impl FinishScratch {
    fn order_blocks(
        &mut self,
        blocks: &mut [PendingBlock],
        values: &[PendingValue],
        pending_words: &[u32],
    ) -> BodySize {
        let mut size = self.reach_blocks(blocks);
        if self.pass_by_blocks(blocks, pending_words) {
            size = self.reach_blocks(blocks);
        }
        self.join_blocks(blocks, values, pending_words, &mut size);

        self.block_numbers.resize(blocks.len(), None);
        for (number, block) in self.order.iter().enumerate() {
            self.block_numbers[block.index()] = Some(BlockId::new(number));
        }
        size
    }

    fn reach_blocks(&mut self, blocks: &mut [PendingBlock]) -> BodySize {
        let mut size = BodySize::default();
        self.order.clear();
        self.is_reached.clear();
        self.is_reached.resize(blocks.len(), false);
        self.is_reached[ENTRY_BLOCK.index()] = true;
        let entry_successor_count = size.add_block(&mut blocks[ENTRY_BLOCK.index()]);
        self.stack.push((ENTRY_BLOCK, entry_successor_count));
        while let Some((block, unvisited_successor_count)) = self.stack.last_mut() {
            let Some(next) = unvisited_successor_count.checked_sub(1) else {
                self.order.push(*block);
                self.stack.pop();
                continue;
            };
            *unvisited_successor_count = next;
            let target = successor(&blocks[block.index()], next as usize);
            if !core::mem::replace(&mut self.is_reached[target.index()], true) {
                let target_successor_count = size.add_block(&mut blocks[target.index()]);
                self.stack.push((target, target_successor_count));
            }
        }
        self.order.reverse();
        size
    }

    fn pass_by_blocks(&mut self, blocks: &mut [PendingBlock], pending_words: &[u32]) -> bool {
        self.places.clear();
        self.places.resize(blocks.len(), 0);
        for (place, block) in (0..).zip(&self.order) {
            self.places[block.index()] = place;
        }
        const IS_LOOP_HEAD: u32 = 1 << 31;
        self.incoming.resize(blocks.len(), 0);
        for id in &self.order {
            let block = &blocks[id.index()];
            for index in 0..successor_count(block) {
                let target = successor(block, index).index();
                match self.places[id.index()] < self.places[target] {
                    true => self.incoming[target] += 1,
                    false => self.incoming[target] |= IS_LOOP_HEAD,
                }
            }
        }
        self.is_passed_by.clear();
        self.is_passed_by.resize(blocks.len(), false);
        let mut is_any_passed_by = false;
        for id in self.order.iter().rev().filter(|&&id| id != ENTRY_BLOCK) {
            let block = &blocks[id.index()];
            let terminator = terminator_of(block);
            let (TerminatorKind::Jump, [target]) = (terminator.kind, &terminator.targets[..])
            else {
                continue;
            };
            if block.value_count != 0
                || block.role != BlockRole::Ordinary
                || block.subject.is_some()
                || self.places[target.block.index()] <= self.places[id.index()]
                || !has_same_handler(block, &blocks[target.block.index()], pending_words)
            {
                continue;
            }
            let last = self.find_last_passed_by(blocks, target.block);
            let target = last.map_or(target, |last| {
                &terminator_of(&blocks[last.index()]).targets[0]
            });
            let edges_down_to_target = self.incoming[target.block.index()];
            if edges_down_to_target & IS_LOOP_HEAD != 0 {
                continue;
            }
            let hands_on_parameter = || {
                let mut arguments = arguments_of(target, pending_words);
                arguments.any(|argument| parameters_of(block).any(|own| own == argument))
            };
            if parameter_count(block) != 0
                && (block.handler.is_some() || edges_down_to_target < 2 || hands_on_parameter())
            {
                continue;
            }
            self.is_passed_by[id.index()] = true;
            is_any_passed_by = true;
        }
        self.incoming.clear();
        if !is_any_passed_by {
            return false;
        }

        let mut is_any_moved = false;
        for id in &self.order {
            let target_count = terminator_of(&blocks[id.index()]).targets.len();
            for index in 0..target_count {
                let targets = &terminator_of(&blocks[id.index()]).targets;
                let Some(last) = self.find_last_passed_by(blocks, targets[index].block) else {
                    continue;
                };
                let moved = copy_of(&terminator_of(&blocks[last.index()]).targets[0]);
                let mut others = (0..target_count).filter(|&other| other != index);
                let leads_there_too = others.any(|other| {
                    let last = self.find_last_passed_by(blocks, targets[other].block);
                    let end =
                        last.map(|last| terminator_of(&blocks[last.index()]).targets[0].block);
                    end.unwrap_or(targets[other].block) == moved.block
                });
                if leads_there_too {
                    continue;
                }
                let terminator = blocks[id.index()].terminator.as_mut();
                terminator.expect("a reached block is terminated").targets[index] = moved;
                is_any_moved = true;
            }
        }
        is_any_moved
    }

    fn find_last_passed_by(&self, blocks: &[PendingBlock], block: BlockId) -> Option<BlockId> {
        let next = |passed: &BlockId| {
            let target = terminator_of(&blocks[passed.index()]).targets[0].block;
            self.is_passed_by[target.index()].then_some(target)
        };
        let first = self.is_passed_by[block.index()].then_some(block);
        core::iter::successors(first, next).last()
    }

    fn join_blocks(
        &mut self,
        blocks: &[PendingBlock],
        values: &[PendingValue],
        pending_words: &[u32],
        size: &mut BodySize,
    ) {
        self.incoming.resize(blocks.len(), 0);
        self.goes_on_in_target.resize(blocks.len(), false);
        for block in &self.order {
            let block = &blocks[block.index()];
            for index in 0..successor_count(block) {
                self.incoming[successor(block, index).index()] += 1;
            }
        }
        for id in &self.order {
            let block = &blocks[id.index()];
            let terminator = terminator_of(block);
            let (TerminatorKind::Jump, [target]) = (terminator.kind, &terminator.targets[..])
            else {
                continue;
            };
            let next = &blocks[target.block.index()];
            let mut parameters = parameters_of(next);
            if self.incoming[target.block.index()] != 1
                || next.role != BlockRole::Ordinary
                || next.subject.is_some()
                || !has_same_handler(block, next, pending_words)
                || parameters
                    .any(|parameter| declared_type_of(&values[parameter.index()]).is_some())
            {
                continue;
            }
            self.goes_on_in_target[id.index()] = true;
            self.incoming[target.block.index()] = 0;
            size.value_count -= parameter_count(next) as u32;
            size.word_count -= BlockHead::WORDS
                + parameter_count(next) * ParameterHead::WORDS
                + next.handler.as_ref().map_or(0, target_length)
                + TerminatorHead::WORDS
                + terminator.fields.len()
                + target_length(target);
        }
        let incoming = &self.incoming;
        (self.order).retain(|&block| block == ENTRY_BLOCK || incoming[block.index()] != 0);
    }

    fn recycle(self) -> FinishScratch {
        FinishScratch {
            is_reached: recycle_vector(self.is_reached, MAX_SPARE_BLOCKS),
            block_numbers: recycle_vector(self.block_numbers, MAX_SPARE_BLOCKS),
            numbers: recycle_vector(self.numbers, MAX_SPARE_VALUES),
            order: recycle_vector(self.order, MAX_SPARE_BLOCKS),
            stack: recycle_vector(self.stack, MAX_SPARE_BLOCKS),
            incoming: recycle_vector(self.incoming, MAX_SPARE_BLOCKS),
            goes_on_in_target: recycle_vector(self.goes_on_in_target, MAX_SPARE_BLOCKS),
            places: recycle_vector(self.places, MAX_SPARE_BLOCKS),
            is_passed_by: recycle_vector(self.is_passed_by, MAX_SPARE_BLOCKS),
        }
    }
}

struct Encoder<'a> {
    pending_words: &'a [u32],
    values: &'a [PendingValue],
    blocks: &'a [PendingBlock],
    block_numbers: &'a [Option<BlockId>],
    goes_on_in_target: &'a [bool],
    numbers: &'a mut [u32],
    next_number: u32,
    value_count: u32,
    words: Vec<u32>,
}

impl Encoder<'_> {
    fn find_joined_block(&self, block: BlockId) -> Option<BlockId> {
        let target = terminator_of(&self.blocks[block.index()]).targets.first()?;
        self.goes_on_in_target[block.index()].then_some(target.block)
    }

    fn encode_block(&mut self, id: BlockId) {
        let block = &self.blocks[id.index()];
        let parts = core::iter::successors(Some(id), |&part| self.find_joined_block(part));
        let value_count = parts
            .map(|part| self.blocks[part.index()].value_count)
            .sum();
        let subject = block
            .subject
            .map(|pending| ValueId::from_word(number_of(self.numbers, self.value_count, pending)));
        let head = BlockHead {
            parameter_count: parameter_count(block) as u32,
            value_count,
            role: block.role,
            subject,
            has_handler: block.handler.is_some(),
        };
        head.append_to(&mut self.words);
        for parameter in parameters_of(block) {
            self.number_value(parameter);
            let ty = declared_type_of(&self.values[parameter.index()]);
            ParameterHead { ty }.append_to(&mut self.words);
        }
        if let Some(handler) = &block.handler {
            self.encode_target(handler);
        }
        let mut part = block;
        let mut joined = self.find_joined_block(id);
        loop {
            let mut next = part.first_value;
            while next != NO_VALUE {
                next = self.encode_value(ValueId::from_word(next));
            }
            let Some(following) = joined else {
                break;
            };
            let arguments = arguments_of(&terminator_of(part).targets[0], self.pending_words);
            part = &self.blocks[following.index()];
            for (parameter, argument) in parameters_of(part).zip(arguments) {
                let number = number_of(self.numbers, self.value_count, argument);
                self.numbers[parameter.index()] = number;
            }
            joined = self.find_joined_block(following);
        }
        self.encode_terminator(terminator_of(part));
    }

    fn number_value(&mut self, value: ValueId) {
        let number = &mut self.numbers[value.index()];
        debug_assert!(*number == NO_VALUE, "{value} is listed twice");
        *number = self.next_number;
        self.next_number += 1;
    }

    fn encode_value(&mut self, id: ValueId) -> u32 {
        let value = self.values[id.index()];
        debug_assert!(
            value.next != IS_PARAMETER,
            "a block lists no parameter as a value"
        );
        self.number_value(id);
        let head = self.pending_words[value.at as usize];
        debug_assert_eq!(
            head & MARKS & !STANDS_IN_TAIL_POSITION,
            0,
            "no word for a written position follows the fields"
        );
        let opcode = Opcode::from_wire(head & !MARKS);
        let opcode = opcode.expect("an operation begins with its opcode");
        let head_and_fields = value.at..value.at + value.word_count;
        self.encode_fields(&head_and_fields, |words, visit| {
            visit_value_fields(opcode, words, ValueHead::WORDS, visit)
        });
        value.next
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
        for argument in arguments_of(target, self.pending_words) {
            let number = number_of(self.numbers, self.value_count, argument);
            self.words.push(number);
        }
        let proofs = words_in(self.pending_words, &target.proofs);
        self.words.extend_from_slice(proofs);
    }

    fn append_pending_words(&mut self, range: &Range<u32>) -> (&[u32], &[Cell<u32>]) {
        let start = self.words.len();
        let copied = words_in(self.pending_words, range);
        self.words.extend_from_slice(copied);
        let cells = Cell::from_mut(&mut self.words[start..]).as_slice_of_cells();
        (&*self.numbers, cells)
    }

    fn encode_fields(
        &mut self,
        range: &Range<u32>,
        visit_fields: impl FnOnce(&[Cell<u32>], &mut dyn FnMut(FieldWord, usize)) -> Option<usize>,
    ) {
        let value_count = self.value_count;
        let (numbers, cells) = self.append_pending_words(range);
        let end = visit_fields(cells, &mut |field: FieldWord, at: usize| match field {
            FieldWord::Operand => {
                let pending = ValueId::from_word(cells[at].get());
                cells[at].set(number_of(numbers, value_count, pending));
            }
            FieldWord::Reference(_) => {}
        });
        debug_assert_eq!(end, Some(cells.len()), "the fields have their wire form");
    }
}
