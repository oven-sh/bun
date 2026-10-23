use super::body::{
    BlockView, FieldWord, StreamError, TargetView, TerminatorView, ValueView, WELL_FORMED, Words,
};
use super::generated::{
    BlockHead, InternalErrorKind, Opcode, ParameterHead, TargetHead, TerminatorHead,
    TerminatorKind, ValueHead, visit_terminator_fields, visit_value_fields,
};
use super::ids::{ABSENT_WORD, BlockId, ValueId};

const _: () = assert!(ParameterHead::WORDS == 1);

fn split_head<H>(
    words: &[u32],
    length: usize,
    from_words: fn(&[u32]) -> Option<H>,
    invalid: InternalErrorKind,
) -> Result<(H, &[u32]), InternalErrorKind> {
    let (head, rest) = words
        .split_at_checked(length)
        .ok_or(InternalErrorKind::ListOutOfBounds)?;
    Ok((from_words(head).ok_or(invalid)?, rest))
}

fn split_fields(
    words: &[u32],
    length: Option<usize>,
) -> Result<(&[u32], &[u32]), InternalErrorKind> {
    length
        .and_then(|length| words.split_at_checked(length))
        .ok_or(InternalErrorKind::ListOutOfBounds)
}

fn consumed_words<'a>(words: &'a [u32], rest: &[u32]) -> &'a [u32] {
    &words[..words.len() - rest.len()]
}

fn value_id_range_end(first: u32, count: u32) -> Option<u32> {
    first.checked_add(count).filter(|&end| end != ABSENT_WORD)
}

pub(super) fn read_block(
    words: &[u32],
    id: BlockId,
    first_parameter: u32,
) -> Result<(BlockView<'_>, &[u32]), StreamError> {
    let fail = |kind, value| StreamError {
        kind,
        block: Some(id),
        value,
    };
    let fail_in_block = |kind| fail(kind, None);
    let out_of_bounds = fail(InternalErrorKind::ListOutOfBounds, None);
    let invalid_head = InternalErrorKind::UnknownEnumerator;
    let (head, rest) = split_head(words, BlockHead::WORDS, BlockHead::from_words, invalid_head)
        .map_err(fail_in_block)?;
    let (parameter_types, rest) = rest
        .split_at_checked(head.parameter_count as usize)
        .ok_or(out_of_bounds)?;
    let first_value =
        value_id_range_end(first_parameter, head.parameter_count).ok_or(out_of_bounds)?;
    let end = value_id_range_end(first_value, head.value_count).ok_or(out_of_bounds)?;

    let mut values_and_rest = rest;
    if head.has_handler {
        (_, values_and_rest) = read_target(rest).map_err(fail_in_block)?;
    }
    let handler = consumed_words(rest, values_and_rest);

    let mut rest = values_and_rest;
    for value in (first_value..end).map(ValueId::from_word) {
        (_, rest) = read_value(rest, value).map_err(|kind| fail(kind, Some(value)))?;
    }
    let values = consumed_words(values_and_rest, rest);
    let (_, next_block) = read_terminator(rest).map_err(fail_in_block)?;
    let block = BlockView {
        id,
        first_parameter: ValueId::from_word(first_parameter),
        role: head.role,
        subject: head.subject,
        frequency: head.frequency,
        parameter_types,
        handler,
        value_count: head.value_count,
        values,
        terminator: consumed_words(rest, next_block),
    };
    Ok((block, next_block))
}

pub(super) fn read_value(
    words: &[u32],
    id: ValueId,
) -> Result<(ValueView<'_>, &[u32]), InternalErrorKind> {
    let invalid_head = InternalErrorKind::IdOutOfRange;
    let (head, rest) = split_head(words, ValueHead::WORDS, ValueHead::from_words, invalid_head)?;
    let opcode = Opcode::from_wire(head.opcode).ok_or(InternalErrorKind::UnknownEnumerator)?;
    let length = visit_value_fields(opcode, rest, 0, &mut |_, _| {});
    let (fields, rest) = split_fields(rest, length)?;
    let value = ValueView {
        id,
        opcode,
        position: head.position,
        fields,
    };
    Ok((value, rest))
}

pub(super) fn read_terminator(
    words: &[u32],
) -> Result<(TerminatorView<'_>, &[u32]), InternalErrorKind> {
    let (head, rest) = split_head(
        words,
        TerminatorHead::WORDS,
        TerminatorHead::from_words,
        InternalErrorKind::IdOutOfRange,
    )?;
    let kind = TerminatorKind::from_wire(head.kind).ok_or(InternalErrorKind::UnknownEnumerator)?;
    let length = visit_terminator_fields(kind, rest, 0, &mut |_, _| {});
    let (fields, targets_and_rest) = split_fields(rest, length)?;
    let mut rest = targets_and_rest;
    for _ in 0..head.target_count {
        (_, rest) = read_target(rest)?;
    }
    let terminator = TerminatorView {
        kind,
        position: head.position,
        fields,
        target_count: head.target_count,
        targets: consumed_words(targets_and_rest, rest),
    };
    Ok((terminator, rest))
}

pub(super) fn read_target(words: &[u32]) -> Result<(TargetView<'_>, &[u32]), InternalErrorKind> {
    let out_of_bounds = InternalErrorKind::ListOutOfBounds;
    let invalid_head = InternalErrorKind::IdOutOfRange;
    let (head, rest) = split_head(
        words,
        TargetHead::WORDS,
        TargetHead::from_words,
        invalid_head,
    )?;
    let (arguments, rest) = rest
        .split_at_checked(head.argument_count as usize)
        .ok_or(out_of_bounds)?;
    let (proofs, rest) = rest
        .split_at_checked(head.proof_count as usize)
        .ok_or(out_of_bounds)?;
    if arguments.contains(&ABSENT_WORD) {
        return Err(InternalErrorKind::IdOutOfRange);
    }
    let target = TargetView {
        block: head.block,
        arguments,
        proofs,
    };
    Ok((target, rest))
}

fn read_words<const N: usize, W: Words + ?Sized>(words: &W, at: usize) -> [u32; N] {
    core::array::from_fn(|index| words.get(at + index).expect(WELL_FORMED))
}

pub(super) fn walk_body<W: Words + ?Sized>(
    words: &W,
    block_count: u32,
    visit: &mut dyn FnMut(FieldWord, usize),
) {
    let mut at = 0;
    for _ in 0..block_count {
        at = walk_block(words, at, visit);
    }
}

fn walk_block<W: Words + ?Sized>(
    words: &W,
    at: usize,
    visit: &mut dyn FnMut(FieldWord, usize),
) -> usize {
    let head = read_words::<{ BlockHead::WORDS }, W>(words, at);
    let head = BlockHead::from_words(&head).expect(WELL_FORMED);
    let mut at = BlockHead::visit_words(words, at, visit).expect(WELL_FORMED);
    for _ in 0..head.parameter_count {
        at = ParameterHead::visit_words(words, at, visit).expect(WELL_FORMED);
    }
    if head.has_handler {
        at = walk_target(words, at, visit);
    }
    for _ in 0..head.value_count {
        at = walk_value(words, at, visit);
    }
    walk_terminator(words, at, visit)
}

fn walk_value<W: Words + ?Sized>(
    words: &W,
    at: usize,
    visit: &mut dyn FnMut(FieldWord, usize),
) -> usize {
    let head = read_words::<{ ValueHead::WORDS }, W>(words, at);
    let head = ValueHead::from_words(&head).expect(WELL_FORMED);
    let opcode = Opcode::from_wire(head.opcode).expect(WELL_FORMED);
    visit_value_fields(opcode, words, at + ValueHead::WORDS, visit).expect(WELL_FORMED)
}

fn walk_terminator<W: Words + ?Sized>(
    words: &W,
    at: usize,
    visit: &mut dyn FnMut(FieldWord, usize),
) -> usize {
    let head = read_words::<{ TerminatorHead::WORDS }, W>(words, at);
    let head = TerminatorHead::from_words(&head).expect(WELL_FORMED);
    let kind = TerminatorKind::from_wire(head.kind).expect(WELL_FORMED);
    let first_field = at + TerminatorHead::WORDS;
    let mut at = visit_terminator_fields(kind, words, first_field, visit).expect(WELL_FORMED);
    for _ in 0..head.target_count {
        at = walk_target(words, at, visit);
    }
    at
}

fn walk_target<W: Words + ?Sized>(
    words: &W,
    at: usize,
    visit: &mut dyn FnMut(FieldWord, usize),
) -> usize {
    let head = read_words::<{ TargetHead::WORDS }, W>(words, at);
    let head = TargetHead::from_words(&head).expect(WELL_FORMED);
    let first_argument = at + TargetHead::WORDS;
    let first_proof = first_argument + head.argument_count as usize;
    for argument in first_argument..first_proof {
        visit(FieldWord::Operand, argument);
    }
    first_proof + head.proof_count as usize
}

#[cfg(test)]
mod tests {
    use super::super::body::Body;
    use super::super::builder::Edge;
    use super::super::generated::BlockRole;
    use super::super::ids::{PropertyKeyId, TypeId};
    use super::super::references::ReferenceKind;
    use super::super::testing::build_function;
    use super::super::types::TypeTable;
    use super::*;

    const OUT_OF_BOUNDS: InternalErrorKind = InternalErrorKind::ListOutOfBounds;
    const ENTRY: BlockId = BlockId::from_word(0);

    fn target_head(block: u32, argument_count: u32, proof_count: u32) -> TargetHead {
        TargetHead {
            block: BlockId::from_word(block),
            argument_count,
            proof_count,
        }
    }

    fn block_head_words(head: BlockHead) -> Vec<u32> {
        let mut words = Vec::new();
        head.append_to(&mut words);
        words
    }

    fn value_words(opcode: u32, fields: &[u32]) -> Vec<u32> {
        let mut words = Vec::new();
        let head = ValueHead {
            opcode,
            position: None,
        };
        head.append_to(&mut words);
        words.extend_from_slice(fields);
        words
    }

    fn terminator_words(kind: u32, fields: &[u32], target_count: u32) -> Vec<u32> {
        let mut words = Vec::new();
        let head = TerminatorHead {
            kind,
            position: None,
            target_count,
        };
        head.append_to(&mut words);
        words.extend_from_slice(fields);
        words
    }

    fn target_words(head: TargetHead, arguments_and_proofs: &[u32]) -> Vec<u32> {
        let mut words = Vec::new();
        head.append_to(&mut words);
        words.extend_from_slice(arguments_and_proofs);
        words
    }

    fn unreachable_words() -> Vec<u32> {
        terminator_words(TerminatorKind::Unreachable.to_wire(), &[], 0)
    }

    fn empty_block(head: BlockHead) -> Vec<u32> {
        [block_head_words(head), unreachable_words()].concat()
    }

    fn block_with_value(opcode: u32, fields: &[u32]) -> Vec<u32> {
        let head = BlockHead {
            value_count: 1,
            ..BlockHead::default()
        };
        let value = value_words(opcode, fields);
        [block_head_words(head), value, unreachable_words()].concat()
    }

    fn block_with_terminator(kind: u32, fields: &[u32], target_count: u32) -> Vec<u32> {
        let terminator = terminator_words(kind, fields, target_count);
        [block_head_words(BlockHead::default()), terminator].concat()
    }

    fn block_with_jump(target: TargetHead, arguments_and_proofs: &[u32]) -> Vec<u32> {
        let jump = block_with_terminator(TerminatorKind::Jump.to_wire(), &[], 1);
        [jump, target_words(target, arguments_and_proofs)].concat()
    }

    fn changed_word_index(before: &[u32], after: &[u32]) -> usize {
        assert_eq!(before.len(), after.len());
        let mut changed = (0..before.len()).filter(|&at| before[at] != after[at]);
        let index = changed.next().expect("a word differs");
        assert_eq!(changed.next(), None);
        index
    }

    fn check(code: Vec<u32>, block_count: u32, value_count: u32) -> Result<(), StreamError> {
        let body = Body {
            code,
            block_count,
            value_count,
        };
        body.check_stream()
    }

    fn error_in_entry(kind: InternalErrorKind, value: Option<u32>) -> Result<(), StreamError> {
        Err(StreamError {
            kind,
            block: Some(ENTRY),
            value: value.map(ValueId::from_word),
        })
    }

    fn visits_of(words: &[u32], block_count: u32) -> Vec<(FieldWord, usize)> {
        let mut visits = Vec::new();
        let mut visit = |field, at| visits.push((field, at));
        walk_body(words, block_count, &mut visit);
        visits
    }

    #[derive(Default)]
    struct TestStream {
        words: Vec<u32>,
        expected_visits: Vec<(FieldWord, usize)>,
    }

    impl TestStream {
        fn expect_visit(&mut self, field: FieldWord, offset: usize) {
            self.expected_visits
                .push((field, self.words.len() + offset));
        }

        fn push_visited(&mut self, field: FieldWord, word: u32) {
            self.expect_visit(field, 0);
            self.words.push(word);
        }

        fn push_block_head(&mut self, head: BlockHead) {
            let words = block_head_words(head);
            if head.subject.is_some() {
                let without_subject = BlockHead {
                    subject: None,
                    ..head
                };
                let offset = changed_word_index(&words, &block_head_words(without_subject));
                self.expect_visit(FieldWord::Operand, offset);
            }
            self.words.extend(words);
        }

        fn push_parameter(&mut self, ty: Option<TypeId>) {
            if ty.is_some() {
                self.expect_visit(FieldWord::Reference(ReferenceKind::Type), 0);
            }
            ParameterHead { ty }.append_to(&mut self.words);
        }

        fn push_target(&mut self, block: u32, arguments: &[u32], proofs: &[u32]) {
            let head = target_head(block, arguments.len() as u32, proofs.len() as u32);
            head.append_to(&mut self.words);
            for &argument in arguments {
                self.push_visited(FieldWord::Operand, argument);
            }
            self.words.extend_from_slice(proofs);
        }

        fn push_value_head(&mut self, opcode: Opcode) {
            self.words.extend(value_words(opcode.to_wire(), &[]));
        }

        fn push_terminator_head(&mut self, kind: TerminatorKind, target_count: u32) {
            let head = terminator_words(kind.to_wire(), &[], target_count);
            self.words.extend(head);
        }
    }

    fn guarded_stream() -> TestStream {
        let with_parameter = BlockHead {
            parameter_count: 1,
            ..BlockHead::default()
        };
        let mut stream = TestStream::default();

        stream.push_block_head(with_parameter);
        stream.push_parameter(Some(TypeTable::ANYTHING));
        stream.push_terminator_head(TerminatorKind::Jump, 1);
        stream.push_target(1, &[], &[]);

        stream.push_block_head(BlockHead {
            value_count: 1,
            has_handler: true,
            ..BlockHead::default()
        });
        stream.push_target(4, &[0], &[]);
        stream.push_value_head(Opcode::PropGet);
        stream.words.push(0);
        stream.push_visited(FieldWord::Operand, 0);
        stream.push_visited(FieldWord::Reference(ReferenceKind::PropertyKey), 7);
        stream.push_terminator_head(TerminatorKind::Branch, 2);
        stream.push_visited(FieldWord::Operand, 1);
        stream.push_target(2, &[], &[0]);
        stream.push_target(3, &[], &[]);

        stream.push_block_head(with_parameter);
        stream.push_parameter(None);
        stream.push_terminator_head(TerminatorKind::Return, 0);
        stream.push_visited(FieldWord::Operand, 2);

        stream.push_block_head(BlockHead::default());
        stream.push_terminator_head(TerminatorKind::Return, 0);
        stream.words.push(ABSENT_WORD);

        stream.push_block_head(BlockHead {
            role: BlockRole::IterationCleanup,
            subject: Some(ValueId::from_word(0)),
            ..with_parameter
        });
        stream.push_parameter(Some(TypeTable::ANYTHING));
        stream.push_terminator_head(TerminatorKind::Unreachable, 0);
        stream
    }

    fn guarded_body() -> Body {
        Body {
            code: guarded_stream().words,
            block_count: 5,
            value_count: 4,
        }
    }

    fn build_guarded_body() -> Body {
        let function = build_function(&[TypeTable::ANYTHING], |builder| {
            let object = builder.parameter(0);
            let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
            let covered = builder.create_block(Some(handler));
            let taken = builder.create_block(None);
            let not_taken = builder.create_block(None);
            let narrowed = builder.add_edge_result(taken);
            builder.jump(Edge::to(covered));
            builder.seal(covered);
            builder.switch_to(covered);
            let value = builder.prop_get(object, PropertyKeyId::from_word(7), false, false);
            builder.branch(value, Edge::with_proofs(taken, &[0]), Edge::to(not_taken));
            builder.seal(taken);
            builder.seal(not_taken);
            builder.seal(handler.block());
            builder.switch_to(taken);
            builder.return_value(Some(narrowed));
            builder.switch_to(not_taken);
            builder.return_value(None);
            builder.switch_to(handler.block());
            builder.unreachable();
        });
        function.body
    }

    fn assert_prefixes_are_out_of_bounds(body: &Body) {
        assert_eq!(body.check_stream(), Ok(()));
        for length in 0..body.code.len() {
            let prefix = body.code[..length].to_vec();
            let error = check(prefix, body.block_count, body.value_count).unwrap_err();
            assert_eq!(error.kind, OUT_OF_BOUNDS, "{length}");
        }
    }

    #[test]
    fn truncated_stream_is_out_of_bounds() {
        assert_prefixes_are_out_of_bounds(&guarded_body());
        assert_prefixes_are_out_of_bounds(&build_guarded_body());

        let words = block_with_value(Opcode::Undefined.to_wire(), &[]);
        let cut_in_value_head = words[..BlockHead::WORDS + 1].to_vec();
        let in_value = error_in_entry(OUT_OF_BOUNDS, Some(0));
        assert_eq!(check(cut_in_value_head, 1, 1), in_value);
    }

    #[test]
    fn counts_past_end_of_stream() {
        let in_block = error_in_entry(OUT_OF_BOUNDS, None);
        let parameters = BlockHead {
            parameter_count: u32::MAX,
            ..BlockHead::default()
        };
        assert_eq!(check(empty_block(parameters), 1, 0), in_block);
        let values = BlockHead {
            value_count: u32::MAX,
            ..BlockHead::default()
        };
        assert_eq!(check(empty_block(values), 1, 0), in_block);
        let arguments = block_with_jump(target_head(0, u32::MAX, 0), &[0]);
        assert_eq!(check(arguments, 1, 0), in_block);
        let proofs = block_with_jump(target_head(0, 0, u32::MAX), &[0]);
        assert_eq!(check(proofs, 1, 0), in_block);
        let targets = [
            block_with_terminator(TerminatorKind::Jump.to_wire(), &[], u32::MAX),
            target_words(target_head(0, 0, 0), &[]),
        ]
        .concat();
        assert_eq!(check(targets, 1, 0), in_block);

        let values_below_absent_word = BlockHead {
            value_count: u32::MAX - 1,
            ..BlockHead::default()
        };
        let error = check(empty_block(values_below_absent_word), 1, 0).unwrap_err();
        assert_eq!(error.kind, OUT_OF_BOUNDS);
        assert_eq!(value_id_range_end(u32::MAX - 2, 1), Some(u32::MAX - 1));
        assert_eq!(value_id_range_end(u32::MAX - 1, 1), None);
        assert_eq!(value_id_range_end(u32::MAX, 1), None);

        let operands = block_with_value(Opcode::Strcat.to_wire(), &[u32::MAX, 0]);
        let in_value = error_in_entry(OUT_OF_BOUNDS, Some(0));
        assert_eq!(check(operands, 1, 1), in_value);
        let switch = TerminatorKind::Switch.to_wire();
        let cases = block_with_terminator(switch, &[0, u32::MAX, 0, 0], 0);
        assert_eq!(check(cases, 1, 0), in_block);
    }

    #[test]
    fn unknown_opcode_and_terminator_kind() {
        let kind = InternalErrorKind::UnknownEnumerator;
        let unknown_opcode = block_with_value(Opcode::COUNT as u32, &[]);
        assert_eq!(check(unknown_opcode, 1, 1), error_in_entry(kind, Some(0)));
        let unknown_kind = block_with_terminator(TerminatorKind::COUNT as u32, &[], 0);
        assert_eq!(check(unknown_kind, 1, 0), error_in_entry(kind, None));
    }

    #[test]
    fn absent_argument_is_out_of_range() {
        let words = block_with_jump(target_head(0, 2, 0), &[0, ABSENT_WORD]);
        let out_of_range = error_in_entry(InternalErrorKind::IdOutOfRange, None);
        assert_eq!(check(words, 1, 0), out_of_range);
    }

    #[test]
    fn absent_target_block_is_out_of_range() {
        let to_entry = block_with_jump(target_head(0, 0, 0), &[]);
        let to_next = block_with_jump(target_head(1, 0, 0), &[]);
        let mut words = to_entry.clone();
        words[changed_word_index(&to_entry, &to_next)] = ABSENT_WORD;
        let out_of_range = error_in_entry(InternalErrorKind::IdOutOfRange, None);
        assert_eq!(check(words, 1, 0), out_of_range);
    }

    #[test]
    fn invalid_role_is_unknown_enumerator() {
        let ordinary = empty_block(BlockHead::default());
        let catch_handler = empty_block(BlockHead {
            role: BlockRole::CatchHandler,
            ..BlockHead::default()
        });
        let mut words = ordinary.clone();
        words[changed_word_index(&ordinary, &catch_handler)] = BlockRole::COUNT as u32;
        let unknown_enumerator = error_in_entry(InternalErrorKind::UnknownEnumerator, None);
        assert_eq!(check(words, 1, 0), unknown_enumerator);
    }

    #[test]
    fn handler_is_read_between_parameters_and_values() {
        let mut stream = TestStream::default();
        stream.push_block_head(BlockHead {
            parameter_count: 1,
            value_count: 1,
            has_handler: true,
            ..BlockHead::default()
        });
        stream.push_parameter(Some(TypeTable::NUMBER));
        stream.push_target(3, &[0], &[]);
        stream.push_value_head(Opcode::Undefined);
        stream.push_terminator_head(TerminatorKind::Unreachable, 0);
        stream.words.push(77);

        let (block, rest) = read_block(&stream.words, ENTRY, 0).expect(WELL_FORMED);
        assert_eq!(rest, [77]);
        let parameter_types: Vec<Option<TypeId>> = block.parameter_types().collect();
        assert_eq!(parameter_types, [Some(TypeTable::NUMBER)]);
        let handler = block.handler().expect("the block names a handler");
        assert_eq!(handler.block, BlockId::from_word(3));
        let arguments: Vec<ValueId> = handler.arguments().collect();
        assert_eq!(arguments, [ValueId::from_word(0)]);
        assert!(handler.proofs.is_empty());
        let values = block.values().map(|value| (value.id, value.opcode));
        let values: Vec<(ValueId, Opcode)> = values.collect();
        assert_eq!(values, [(ValueId::from_word(1), Opcode::Undefined)]);
        assert_eq!(block.terminator().kind, TerminatorKind::Unreachable);

        let words = empty_block(BlockHead::default());
        let (block, _) = read_block(&words, ENTRY, 0).expect(WELL_FORMED);
        assert!(block.handler().is_none());

        let body = build_guarded_body();
        let blocks: Vec<BlockView<'_>> = body.blocks().collect();
        let handlers = blocks.iter().filter_map(BlockView::handler);
        let handlers: Vec<BlockId> = handlers.map(|handler| handler.block).collect();
        let [handler] = handlers[..] else {
            panic!("one block names a handler");
        };
        let role = blocks[handler.to_word() as usize].role;
        assert_eq!(role, BlockRole::CatchHandler);
    }

    #[test]
    fn proofs_follow_arguments() {
        let words = target_words(target_head(2, 2, 2), &[5, 6, 7, ABSENT_WORD, 9]);
        let (target, rest) = read_target(&words).expect(WELL_FORMED);
        assert_eq!(target.block, BlockId::from_word(2));
        let arguments: Vec<ValueId> = target.arguments().collect();
        assert_eq!(arguments, [ValueId::from_word(5), ValueId::from_word(6)]);
        assert_eq!(target.proofs, [7, ABSENT_WORD]);
        assert_eq!(rest, [9]);
    }

    #[test]
    fn walk_visits_subject_parameter_types_arguments_and_fields() {
        let body = guarded_body();
        assert_eq!(body.check_stream(), Ok(()));
        let visits = visits_of(&body.code, body.block_count);
        assert_eq!(visits, guarded_stream().expected_visits);
    }

    #[test]
    fn walk_skips_absent_optionals() {
        let mut stream = TestStream::default();
        stream.push_block_head(BlockHead {
            parameter_count: 1,
            value_count: 1,
            ..BlockHead::default()
        });
        stream.push_parameter(None);
        stream.push_value_head(Opcode::Check);
        stream.push_visited(FieldWord::Operand, 0);
        stream.push_visited(FieldWord::Reference(ReferenceKind::Type), 5);
        stream.words.push(ABSENT_WORD);
        stream.push_terminator_head(TerminatorKind::Return, 0);
        stream.words.push(ABSENT_WORD);
        assert_eq!(check(stream.words.clone(), 1, 2), Ok(()));
        assert_eq!(visits_of(&stream.words, 1), stream.expected_visits);
    }
}
