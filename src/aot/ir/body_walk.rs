use super::body::{FieldWord, WELL_FORMED, Words};
use super::generated::{
    BlockHead, Opcode, ParameterHead, STANDS_IN_TAIL_POSITION, TargetHead, TerminatorHead,
    TerminatorKind, ValueHead, WRITTEN_POSITION_FOLLOWS, WRITTEN_POSITION_IS_FOR_CALLERS,
    visit_terminator_fields, visit_value_fields,
};

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
    let marks =
        WRITTEN_POSITION_FOLLOWS | STANDS_IN_TAIL_POSITION | WRITTEN_POSITION_IS_FOR_CALLERS;
    let opcode = Opcode::from_wire(head.opcode & !marks).expect(WELL_FORMED);
    let end = visit_value_fields(opcode, words, at + ValueHead::WORDS, visit).expect(WELL_FORMED);
    end + usize::from(head.opcode & WRITTEN_POSITION_FOLLOWS != 0)
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
    visit_target_arguments(&head, at, visit)
}

fn visit_target_arguments(
    head: &[u32; TargetHead::WORDS],
    at: usize,
    visit: &mut dyn FnMut(FieldWord, usize),
) -> usize {
    let head = TargetHead::from_words(head).expect(WELL_FORMED);
    let first_argument = at + TargetHead::WORDS;
    let first_proof = first_argument + head.argument_count as usize;
    for argument in first_argument..first_proof {
        visit(FieldWord::Operand, argument);
    }
    first_proof + head.proof_count as usize
}
