#[cfg(test)]
mod tests;

use core::cell::Cell;
use core::ops::Range;

use super::body::FieldWord;
use super::builder::{
    BuilderScratch, ENTRY_BLOCK, FunctionBuilder, IS_PARAMETER, MAX_SPARE_BLOCKS,
    MAX_SPARE_FIELD_WORDS, MAX_SPARE_VALUES, NO_VALUE, PendingBlock, PendingTarget,
    PendingTerminator, PendingValue, PushedWords, push_words, recycle_vector,
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
    last_passed_by: Vec<Option<BlockId>>,
}

#[derive(Default)]
struct BodySize {
    value_count: u32,
    word_count: usize,
}

#[derive(Copy, Clone)]
struct PendingLists<'a> {
    values: &'a [ValueId],
    words: &'a [u32],
}

impl FunctionBuilder {
    pub fn finish(mut self) -> (Function, BuilderScratch) {
        self.order_late_parameters_as_declared();
        let FunctionBuilder {
            mut function,
            words: pending_words,
            values,
            mut blocks,
            mut targets,
            listed_values,
            ssa,
            targets_by_block,
            finish_scratch: mut scratch,
            ..
        } = self;
        debug_assert!(
            (0..blocks.len()).all(|index| ssa.is_sealed(BlockId::new(index))),
            "an unsealed block has parameters without arguments"
        );
        let mut unread: Vec<(ValueId, BlockId)> = ssa.unread_names().collect();
        unread.sort_unstable_by_key(|(narrowed, _)| narrowed.index());
        for (narrowed, block) in unread {
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
        let lists = PendingLists {
            values: &listed_values,
            words: &pending_words,
        };
        let BodySize {
            value_count,
            word_count,
        } = scratch.order_blocks(&mut blocks, &mut targets, &values, lists);
        scratch.numbers.resize(values.len(), NO_VALUE);
        let mut encoder = Encoder {
            lists,
            values: &values,
            blocks: &blocks,
            targets: &targets,
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
            targets: recycle_vector(targets, MAX_SPARE_BLOCKS),
            listed_values: recycle_vector(listed_values, MAX_SPARE_VALUES),
            ssa: ssa.recycle(),
            targets_by_block: targets_by_block.recycle(),
            finish: scratch.recycle(),
        };
        (function, scratch)
    }
}

#[inline]
fn terminator_of(block: &PendingBlock) -> &PendingTerminator {
    let terminator = block.terminator.as_ref();
    terminator.expect("add_block terminates every reached block")
}

#[inline]
fn targets_of<'a>(block: &PendingBlock, targets: &'a [PendingTarget]) -> &'a [PendingTarget] {
    let own = &terminator_of(block).targets;
    &targets[own.start as usize..own.end as usize]
}

#[inline]
fn first_target_of<'a>(block: &PendingBlock, targets: &'a [PendingTarget]) -> &'a PendingTarget {
    &targets_of(block, targets)[0]
}

#[inline]
fn successor_count(block: &PendingBlock) -> usize {
    terminator_of(block).targets.len() + usize::from(block.handler.is_some())
}

#[inline]
fn successor(block: &PendingBlock, targets: &[PendingTarget], index: usize) -> BlockId {
    let handler = block.handler.as_ref();
    let target = targets_of(block, targets).get(index).or(handler);
    target.expect("an index below the successor count").block
}

#[inline]
fn for_each_successor(
    block: &PendingBlock,
    targets: &[PendingTarget],
    mut visit: impl FnMut(BlockId),
) {
    for target in targets_of(block, targets) {
        visit(target.block);
    }
    if let Some(handler) = &block.handler {
        visit(handler.block);
    }
}

#[inline]
fn declared_type_of(parameter: &PendingValue) -> Option<TypeId> {
    debug_assert!(
        parameter.next == IS_PARAMETER,
        "a block lists no operation as a parameter"
    );
    optional_id_from_word(parameter.at)
}

#[inline]
fn parameter_lists<'a>(block: &PendingBlock, listed_values: &'a [ValueId]) -> [&'a [ValueId]; 3] {
    [
        block.parameters.items(listed_values),
        block.variable_parameters.items(listed_values),
        block.edge_results.items(listed_values),
    ]
}

fn parameters_of(block: &PendingBlock, listed: &[ValueId]) -> impl Iterator<Item = ValueId> {
    let [parameters, variable_parameters, edge_results] = parameter_lists(block, listed);
    let parameters = parameters.iter().chain(variable_parameters);
    parameters.chain(edge_results).copied()
}

#[inline]
fn parameter_count(block: &PendingBlock) -> usize {
    block.parameters.len() + block.variable_parameters.len() + block.edge_results.len()
}

#[inline]
fn has_declared_parameter(
    block: &PendingBlock,
    listed_values: &[ValueId],
    values: &[PendingValue],
) -> bool {
    for list in parameter_lists(block, listed_values) {
        for parameter in list {
            if declared_type_of(&values[parameter.index()]).is_some() {
                return true;
            }
        }
    }
    false
}

#[inline]
fn words_in<'a>(pending_words: &'a [u32], range: &Range<u32>) -> &'a [u32] {
    &pending_words[range.start as usize..range.end as usize]
}

#[inline]
fn pending_ids_in(pending_words: &[u32], range: &Range<u32>) -> impl Iterator<Item = ValueId> {
    let words = words_in(pending_words, range).iter();
    words.map(|&word| ValueId::from_word(word))
}

fn arguments_of(target: &PendingTarget, lists: PendingLists<'_>) -> impl Iterator<Item = ValueId> {
    let arguments = pending_ids_in(lists.words, &target.arguments);
    let variable_arguments = target.variable_arguments.items(lists.values);
    let arguments = arguments.chain(variable_arguments.iter().copied());
    arguments.chain(pending_ids_in(lists.words, &target.trailing_arguments))
}

#[inline]
fn argument_count(target: &PendingTarget) -> usize {
    target.arguments.len() + target.variable_arguments.len() + target.trailing_arguments.len()
}

#[inline]
fn has_same_handler(first: &PendingBlock, second: &PendingBlock, lists: PendingLists<'_>) -> bool {
    match (&first.handler, &second.handler) {
        (None, None) => true,
        (Some(first), Some(second)) => is_same_handler_edge(first, second, lists),
        (None, Some(_)) | (Some(_), None) => false,
    }
}

fn is_same_handler_edge(
    first: &PendingTarget,
    second: &PendingTarget,
    lists: PendingLists<'_>,
) -> bool {
    first.block == second.block
        && first.proofs.is_empty()
        && second.proofs.is_empty()
        && arguments_of(first, lists).eq(arguments_of(second, lists))
}

fn hands_on_parameter(block: &PendingBlock, edge: &PendingTarget, lists: PendingLists<'_>) -> bool {
    let parameters = parameter_lists(block, lists.values);
    let mut arguments = arguments_of(edge, lists);
    arguments.any(|argument| parameters.iter().any(|list| list.contains(&argument)))
}

#[inline]
fn target_length(target: &PendingTarget) -> usize {
    TargetHead::WORDS + argument_count(target) + target.proofs.len()
}

#[inline]
fn block_length(block: &PendingBlock, targets: &[PendingTarget]) -> usize {
    let terminator = terminator_of(block);
    let mut targets_length = block.handler.as_ref().map_or(0, target_length);
    for target in targets_of(block, targets) {
        targets_length += target_length(target);
    }
    BlockHead::WORDS
        + parameter_count(block) * ParameterHead::WORDS
        + block.value_word_count as usize
        + TerminatorHead::WORDS
        + terminator.fields.len()
        + targets_length
}

#[inline]
fn number_of(numbers: &[u32], value_count: u32, pending: ValueId) -> u32 {
    let number = numbers.get(pending.index()).copied();
    let number = number.filter(|&number| number != NO_VALUE);
    debug_assert!(
        number.is_some(),
        "{pending} is used, but no reached block lists it ahead of the use"
    );
    number.unwrap_or(value_count)
}

#[inline]
fn add_block(block: &mut PendingBlock, targets: &[PendingTarget]) -> u32 {
    let terminator = &mut block.terminator;
    terminator.get_or_insert_with(PendingTerminator::unreachable);
    let mut targets = targets_of(block, targets).iter().chain(&block.handler);
    debug_assert!(
        targets.all(|target| target.block != ENTRY_BLOCK),
        "no edge targets block 0"
    );
    successor_count(block) as u32
}

impl FinishScratch {
    fn order_blocks(
        &mut self,
        blocks: &mut [PendingBlock],
        targets: &mut [PendingTarget],
        values: &[PendingValue],
        lists: PendingLists<'_>,
    ) -> BodySize {
        self.reach_blocks(blocks, targets);
        if self.pass_by_blocks(blocks, targets, lists) {
            self.reach_blocks(blocks, targets);
        }
        let size = self.join_blocks(blocks, targets, values, lists);

        self.block_numbers.resize(blocks.len(), None);
        for (number, block) in self.order.iter().enumerate() {
            self.block_numbers[block.index()] = Some(BlockId::new(number));
        }
        size
    }

    fn reach_blocks(&mut self, blocks: &mut [PendingBlock], targets: &[PendingTarget]) {
        self.order.clear();
        self.is_reached.clear();
        self.is_reached.resize(blocks.len(), false);
        self.is_reached[ENTRY_BLOCK.index()] = true;
        let entry_successor_count = add_block(&mut blocks[ENTRY_BLOCK.index()], targets);
        self.stack.push((ENTRY_BLOCK, entry_successor_count));
        while let Some((block, unvisited_successor_count)) = self.stack.last_mut() {
            let Some(next) = unvisited_successor_count.checked_sub(1) else {
                self.order.push(*block);
                self.stack.pop();
                continue;
            };
            *unvisited_successor_count = next;
            let target = successor(&blocks[block.index()], targets, next as usize);
            if !core::mem::replace(&mut self.is_reached[target.index()], true) {
                match add_block(&mut blocks[target.index()], targets) {
                    0 => self.order.push(target),
                    unvisited => self.stack.push((target, unvisited)),
                }
            }
        }
        self.order.reverse();
    }

    fn pass_by_blocks(
        &mut self,
        blocks: &[PendingBlock],
        targets: &mut [PendingTarget],
        lists: PendingLists<'_>,
    ) -> bool {
        let FinishScratch {
            order,
            incoming,
            places,
            last_passed_by,
            ..
        } = self;
        if order.len() == 1 {
            return false;
        }
        places.clear();
        places.resize(blocks.len(), 0);
        for (place, block) in (0..).zip(order.iter()) {
            places[block.index()] = place;
        }
        const IS_LOOP_HEAD: u32 = 1 << 31;
        incoming.resize(blocks.len(), 0);
        for id in order.iter() {
            let place = places[id.index()];
            for_each_successor(&blocks[id.index()], targets, |target| {
                let edges = &mut incoming[target.index()];
                match place < places[target.index()] {
                    true => *edges += 1,
                    false => *edges |= IS_LOOP_HEAD,
                }
            });
        }
        last_passed_by.clear();
        last_passed_by.resize(blocks.len(), None);
        let mut is_any_passed_by = false;
        for id in order.iter().rev() {
            if *id == ENTRY_BLOCK {
                continue;
            }
            let block = &blocks[id.index()];
            let kind = terminator_of(block).kind;
            let (TerminatorKind::Jump, [target]) = (kind, targets_of(block, targets)) else {
                continue;
            };
            if block.value_count != 0
                || block.role != BlockRole::Ordinary
                || block.subject.is_some()
                || places[target.block.index()] <= places[id.index()]
                || !has_same_handler(block, &blocks[target.block.index()], lists)
            {
                continue;
            }
            let last = last_passed_by[target.block.index()];
            let target = match last {
                Some(last) => first_target_of(&blocks[last.index()], targets),
                None => target,
            };
            let edges_down_to_target = incoming[target.block.index()];
            if edges_down_to_target & IS_LOOP_HEAD != 0 {
                continue;
            }
            if parameter_count(block) != 0
                && (block.handler.is_some()
                    || edges_down_to_target < 2
                    || hands_on_parameter(block, target, lists))
            {
                continue;
            }
            last_passed_by[id.index()] = Some(last.unwrap_or(*id));
            is_any_passed_by = true;
        }
        incoming.clear();
        if !is_any_passed_by {
            return false;
        }

        let end_of = |targets: &[PendingTarget], place: u32| {
            let block = targets[place as usize].block;
            match last_passed_by[block.index()] {
                Some(last) => first_target_of(&blocks[last.index()], targets).block,
                None => block,
            }
        };
        let edges_that_end_at = incoming;
        edges_that_end_at.resize(blocks.len(), 0);
        let mut is_any_moved = false;
        for id in order.iter() {
            let own = terminator_of(&blocks[id.index()]).targets.clone();
            if !(own.clone())
                .any(|place| last_passed_by[targets[place as usize].block.index()].is_some())
            {
                continue;
            }
            for place in own.clone() {
                edges_that_end_at[end_of(targets, place).index()] += 1;
            }
            for place in own.clone() {
                let passed = targets[place as usize].block;
                let Some(last) = last_passed_by[passed.index()] else {
                    continue;
                };
                let moved = first_target_of(&blocks[last.index()], targets).clone();
                debug_assert!(last_passed_by[moved.block.index()].is_none());
                if edges_that_end_at[moved.block.index()] > 1 {
                    continue;
                }
                targets[place as usize] = moved;
                is_any_moved = true;
            }
            for place in own {
                edges_that_end_at[end_of(targets, place).index()] = 0;
            }
        }
        edges_that_end_at.clear();
        is_any_moved
    }

    fn join_blocks(
        &mut self,
        blocks: &[PendingBlock],
        targets: &[PendingTarget],
        values: &[PendingValue],
        lists: PendingLists<'_>,
    ) -> BodySize {
        let FinishScratch {
            order,
            incoming,
            goes_on_in_target,
            ..
        } = self;
        let mut size = BodySize::default();
        incoming.resize(blocks.len(), 0);
        goes_on_in_target.resize(blocks.len(), false);
        for id in order.iter() {
            let block = &blocks[id.index()];
            size.value_count += parameter_count(block) as u32 + block.value_count;
            size.word_count += block_length(block, targets);
            for_each_successor(block, targets, |target| incoming[target.index()] += 1);
        }
        let mut is_any_joined = false;
        for id in order.iter() {
            let block = &blocks[id.index()];
            let terminator = terminator_of(block);
            let (TerminatorKind::Jump, [target]) = (terminator.kind, targets_of(block, targets))
            else {
                continue;
            };
            let next = &blocks[target.block.index()];
            if incoming[target.block.index()] != 1
                || next.role != BlockRole::Ordinary
                || next.subject.is_some()
                || !has_same_handler(block, next, lists)
                || has_declared_parameter(next, lists.values, values)
            {
                continue;
            }
            goes_on_in_target[id.index()] = true;
            incoming[target.block.index()] = 0;
            is_any_joined = true;
            size.value_count -= parameter_count(next) as u32;
            size.word_count -= BlockHead::WORDS
                + parameter_count(next) * ParameterHead::WORDS
                + next.handler.as_ref().map_or(0, target_length)
                + TerminatorHead::WORDS
                + terminator.fields.len()
                + target_length(target);
        }
        if is_any_joined {
            order.retain(|&block| block == ENTRY_BLOCK || incoming[block.index()] != 0);
        }
        size
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
            last_passed_by: recycle_vector(self.last_passed_by, MAX_SPARE_BLOCKS),
        }
    }
}

struct Encoder<'a> {
    lists: PendingLists<'a>,
    values: &'a [PendingValue],
    blocks: &'a [PendingBlock],
    targets: &'a [PendingTarget],
    block_numbers: &'a [Option<BlockId>],
    goes_on_in_target: &'a [bool],
    numbers: &'a mut [u32],
    next_number: u32,
    value_count: u32,
    words: Vec<u32>,
}

impl Encoder<'_> {
    #[inline]
    fn find_joined_block(&self, block: BlockId) -> Option<BlockId> {
        if !self.goes_on_in_target[block.index()] {
            return None;
        }
        let target = targets_of(&self.blocks[block.index()], self.targets).first()?;
        Some(target.block)
    }

    fn encode_block(&mut self, id: BlockId) {
        let block = &self.blocks[id.index()];
        let first_joined = self.find_joined_block(id);
        let mut value_count = block.value_count;
        let mut frequency = block.frequency;
        let mut joined = first_joined;
        while let Some(part) = joined {
            value_count += self.blocks[part.index()].value_count;
            frequency = frequency.max(self.blocks[part.index()].frequency);
            joined = self.find_joined_block(part);
        }
        let subject = block
            .subject
            .map(|pending| ValueId::from_word(number_of(self.numbers, self.value_count, pending)));
        let head = BlockHead {
            parameter_count: parameter_count(block) as u32,
            value_count,
            role: block.role,
            subject,
            has_handler: block.handler.is_some(),
            frequency,
        };
        head.append_to(&mut PushedWords(&mut self.words));
        for list in parameter_lists(block, self.lists.values) {
            for &parameter in list {
                self.number_value(parameter);
                let ty = declared_type_of(&self.values[parameter.index()]);
                ParameterHead { ty }.append_to(&mut PushedWords(&mut self.words));
            }
        }
        if let Some(handler) = &block.handler {
            self.encode_target(handler);
        }
        let mut part = block;
        let mut joined = first_joined;
        loop {
            self.encode_values(part.first_value);
            let Some(following) = joined else {
                break;
            };
            let target = first_target_of(part, self.targets);
            part = &self.blocks[following.index()];
            if parameter_count(part) != 0 {
                let parameters = parameters_of(part, self.lists.values);
                for (parameter, argument) in parameters.zip(arguments_of(target, self.lists)) {
                    let number = number_of(self.numbers, self.value_count, argument);
                    self.numbers[parameter.index()] = number;
                }
            }
            joined = self.find_joined_block(following);
        }
        self.encode_terminator(part);
    }

    #[inline]
    fn number_value(&mut self, value: ValueId) {
        let number = &mut self.numbers[value.index()];
        debug_assert!(*number == NO_VALUE, "{value} is listed twice");
        *number = self.next_number;
        self.next_number += 1;
    }

    #[inline]
    fn encode_values(&mut self, first_value: u32) {
        let mut next = first_value;
        while next != NO_VALUE {
            let first_word = self.values[next as usize].at;
            let (mut end, mut behind) = (first_word, next);
            while behind != NO_VALUE {
                let value = self.values[behind as usize];
                if value.at != end {
                    break;
                }
                end += value.word_count;
                behind = value.next;
            }
            let start = self.words.len();
            let run = words_in(self.lists.words, &(first_word..end));
            self.words.extend_from_slice(run);
            while next != behind {
                let value = self.values[next as usize];
                let at = start + (value.at - first_word) as usize;
                let written = at..at + value.word_count as usize;
                self.encode_value(ValueId::from_word(next), written);
                next = value.next;
            }
        }
    }

    #[inline]
    fn encode_value(&mut self, id: ValueId, mut written: Range<usize>) {
        debug_assert!(
            self.values[id.index()].next != IS_PARAMETER,
            "a block lists no parameter as a value"
        );
        self.number_value(id);
        let head = self.words[written.start];
        if head & WRITTEN_POSITION_FOLLOWS != 0 {
            written.end -= 1;
        }
        let opcode = Opcode::ALL.get((head & !MARKS) as usize).copied();
        let opcode = opcode.expect("an operation begins with its opcode");
        self.number_operands(written, |words, visit| {
            visit_value_fields(opcode, words, ValueHead::WORDS, visit)
        });
    }

    #[inline]
    fn encode_terminator(&mut self, block: &PendingBlock) {
        let terminator = terminator_of(block);
        let kind = terminator.kind;
        let head = TerminatorHead {
            kind: kind.to_wire(),
            position: terminator.position,
            target_count: terminator.targets.len() as u32,
        };
        head.append_to(&mut PushedWords(&mut self.words));
        if !terminator.fields.is_empty() {
            let start = self.words.len();
            let fields = words_in(self.lists.words, &terminator.fields);
            push_words(&mut self.words, fields);
            self.number_operands(start..self.words.len(), |words, visit| {
                visit_terminator_fields(kind, words, 0, visit)
            });
        }
        for target in targets_of(block, self.targets) {
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
        head.append_to(&mut PushedWords(&mut self.words));
        for argument in pending_ids_in(self.lists.words, &target.arguments) {
            self.push_number_of(argument);
        }
        for &argument in target.variable_arguments.items(self.lists.values) {
            self.push_number_of(argument);
        }
        for argument in pending_ids_in(self.lists.words, &target.trailing_arguments) {
            self.push_number_of(argument);
        }
        let proofs = words_in(self.lists.words, &target.proofs);
        push_words(&mut self.words, proofs);
    }

    #[inline]
    fn push_number_of(&mut self, pending: ValueId) {
        let number = number_of(self.numbers, self.value_count, pending);
        self.words.push(number);
    }

    #[inline]
    fn number_operands(
        &mut self,
        written: Range<usize>,
        visit_fields: impl FnOnce(&[Cell<u32>], &mut dyn FnMut(FieldWord, usize)) -> Option<usize>,
    ) {
        let (numbers, value_count) = (&*self.numbers, self.value_count);
        let cells = Cell::from_mut(&mut self.words[written]).as_slice_of_cells();
        let end = visit_fields(cells, &mut |field: FieldWord, at: usize| match field {
            FieldWord::Operand => {
                let cell = &cells[at];
                let pending = ValueId::from_word(cell.get());
                cell.set(number_of(numbers, value_count, pending));
            }
            FieldWord::Reference(_) => {}
        });
        debug_assert_eq!(end, Some(cells.len()), "the fields have their wire form");
    }
}
