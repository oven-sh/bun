use super::support::*;
use crate::assembler::{Assembler, Label};
use crate::verifier::verify_form;
use crate::*;

fn listing(body: &Body) -> Vec<(u32, &'static str, Vec<i32>)> {
    let row = |(offset, instruction): (u32, RawInstruction)| {
        let words = instruction.words().iter().map(|&word| word as i32);
        (offset, instruction.opcode.mnemonic(), words.collect())
    };
    instructions(body).into_iter().map(row).collect()
}

fn mnemonics(body: &Body) -> Vec<&'static str> {
    listing(body).into_iter().map(|row| row.1).collect()
}

fn finish(assembler: &mut Assembler) -> Body {
    let body = assembler.finish(CodeKind::Call, CodeFlags::all(), 16, 1);
    body.unwrap()
}

fn handlers(body: &Body) -> Vec<(u32, u32, u32)> {
    let handlers = body.handlers().iter();
    handlers
        .map(|handler| (handler.range.start, handler.range.end, handler.target))
        .collect()
}

fn operand_bytes(instruction: &RawInstruction) -> usize {
    match usize::from(instruction.size) {
        size if size == instruction.opcode.size::<Narrow>() => 1,
        size if size == instruction.opcode.size::<Wide16>() => 2,
        _ => 4,
    }
}

fn pad(assembler: &mut Assembler, bytes: u32) {
    (0..bytes).for_each(|_| assembler.loop_hint());
}

#[test]
fn bytes_of_each_width() {
    let mut a = Assembler::default();
    a.add(local(0), Register::argument(9), Operand::constant(111));
    a.add(local(127), Register::argument(10), Operand::constant(0));
    a.add(local(32768), Register::THIS, Operand::constant(1));
    a.get_by_id(Register::argument(121), local(127), IdentifierIndex(255));
    a.ret(local(1));
    let (add, get_by_id) = (Opcode::Add as u8, Opcode::GetById as u8);
    let expected: [&[u8]; 5] = [
        &[add, 0xff, 15, 127, 0, 0],
        &[0, add, 0x80, 0xff, 16, 0, 64, 0, 1, 0],
        &[
            1, add, 0xff, 0x7f, 0xff, 0xff, 5, 0, 0, 0, 1, 0, 0, 0x40, 2, 0, 0, 0,
        ],
        &[get_by_id, 127, 0x80, 255, 3, 0],
        &[Opcode::Return as u8, 0xfe],
    ];
    assert_eq!(finish(&mut a).instructions(), expected.concat());
}

#[test]
fn every_operand_at_the_limits_of_each_width() {
    let register = |offset: i32| offset as u32;
    let constant = |index| Operand::constant(index).word();
    let unsigned = [
        (0, 1),
        (255, 1),
        (256, 2),
        (65535, 2),
        (65536, 4),
        (constant(0), 4),
        (u32::MAX - 1, 4),
    ];
    let negative = [
        (register(-1), 1),
        (register(-128), 1),
        (register(-129), 2),
        (register(-32768), 2),
        (register(-32769), 4),
    ];
    let signed = [(127, 1), (128, 2), (32767, 2), (32768, 4)];
    let source = [
        (15, 1),
        (16, 2),
        (63, 2),
        (64, 4),
        (constant(0), 1),
        (constant(111), 1),
        (constant(112), 2),
        (constant(32703), 2),
        (constant(32704), 4),
        (i32::MAX as u32, 4),
    ];
    let mut a = Assembler::default();
    for &opcode in &Opcode::ALL[2..] {
        let shapes = opcode.shapes();
        if shapes.contains(&Shape::SuspendPoint) {
            continue;
        }
        for (index, &shape) in shapes.iter().enumerate() {
            let cases = match shape {
                Shape::Target => continue,
                Shape::Src => [&negative[..], &source].concat(),
                shape if shape.is_signed() => [&negative[..], &signed].concat(),
                _ => unsigned.to_vec(),
            };
            for (word, bytes) in cases {
                a.reset();
                let label = a.label();
                a.bind_loop_head(label);
                a.loop_hint();
                let site = a.here();
                let mut words = vec![0; shapes.len()];
                emit(&mut a, opcode, &words);
                a.set_operand(site, index, word);
                words[index] = word;
                for (word, &shape) in words.iter_mut().zip(shapes) {
                    if shape == Shape::Target {
                        *word = -1i32 as u32;
                    }
                }
                let body = finish(&mut a);
                let instruction = instructions(&body)[1].1;
                assert_eq!(instruction.opcode, opcode);
                assert_eq!(instruction.words(), words, "{opcode:?}");
                assert_eq!(operand_bytes(&instruction), bytes, "{opcode:?} {word:#x}");
            }
        }
    }
}

#[test]
fn forward_jumps_at_the_limits() {
    for (between, bytes, distance) in [
        (124, 1, 127),
        (125, 2, 131),
        (32761, 2, 32767),
        (32762, 4, 32772),
    ] {
        let mut a = Assembler::default();
        let label = a.label();
        a.jump_if_true(local(0), label);
        pad(&mut a, between);
        a.bind(label);
        a.ret(local(0));
        let jump = instructions(&finish(&mut a))[0].1;
        assert_eq!((operand_bytes(&jump), jump.words()[1]), (bytes, distance));
    }
}

#[test]
fn backward_jumps_at_the_limits() {
    for (distance, bytes) in [(128, 1), (129, 2), (32768, 2), (32769, 4)] {
        let mut a = Assembler::default();
        let label = a.label();
        a.bind_loop_head(label);
        pad(&mut a, distance);
        a.jump(label);
        let jump = instructions(&finish(&mut a))[distance as usize].1;
        assert_eq!(operand_bytes(&jump), bytes);
        assert_eq!(jump.words()[0], distance.wrapping_neg());
    }
}

#[test]
fn a_jump_that_grows_puts_another_out_of_reach() {
    for (between, bytes) in [(118, 1), (119, 2)] {
        let mut a = Assembler::default();
        let (near, far) = (a.label(), a.label());
        a.jump_if_true(local(0), near);
        a.jump_if_true(local(0), far);
        pad(&mut a, between);
        a.bind(near);
        pad(&mut a, 200);
        a.bind(far);
        a.ret(local(0));
        let widths = instructions(&finish(&mut a));
        let widths = widths[..2].iter().map(|row| operand_bytes(&row.1));
        assert_eq!(widths.collect::<Vec<_>>(), [bytes, 2]);
    }
}

#[test]
fn nested_jumps_shrink_from_the_inside_out() {
    let mut a = Assembler::default();
    let labels = [a.label(), a.label(), a.label(), a.label()];
    for label in labels {
        a.jump_if_true(local(0), label);
    }
    pad(&mut a, 118);
    a.bind(labels[3]);
    a.bind(labels[2]);
    a.bind(labels[1]);
    pad(&mut a, 200);
    a.bind(labels[0]);
    a.ret(local(0));
    let body = finish(&mut a);
    let targets = listing(&body)[..4].to_vec().into_iter();
    let targets = targets.map(|(offset, _, words)| (offset, words[1]));
    assert_eq!(
        targets.collect::<Vec<_>>(),
        [(0, 333), (6, 127), (9, 124), (12, 121)]
    );
}

#[test]
fn a_jump_over_jumps_that_more_than_triple() {
    let mut a = Assembler::default();
    let (over, far) = (a.label(), a.label());
    a.jump_if_true(local(0), over);
    (0..4000).for_each(|_| a.jump_if_true(local(0), far));
    a.bind(over);
    pad(&mut a, 33_000);
    a.bind(far);
    a.ret(local(0));
    assert_eq!(listing(&finish(&mut a))[0].2[1], 40_010);
}

#[test]
fn both_targets_have_to_be_in_reach() {
    let mut a = Assembler::default();
    let (done, generic) = (a.label(), a.label());
    a.iterator_next(local(0), local(1), done, generic);
    a.bind(done);
    pad(&mut a, 121);
    a.bind(generic);
    a.ret(local(0));
    let row = (0, "iterator_next", vec![-1, -2, 12, 133]);
    assert_eq!(listing(&finish(&mut a))[0], row);
}

#[test]
fn all_ways_to_decode_agree() {
    fn check<W: Width>(prefix: &[u8], opcode: Opcode) {
        let mut code = [prefix, &[opcode as u8]].concat();
        for (index, shape) in (0..).zip(opcode.shapes()) {
            let operand = match shape {
                Shape::Src if index % 2 == 0 => W::FIRST_CONSTANT + index,
                _ if shape.is_signed() => -1 - index,
                _ => index % 2,
            };
            code.extend(&operand.to_le_bytes()[..W::OPERAND_BYTES]);
        }
        code.resize(opcode.size::<W>(), 3);
        let expected = format!("{:?}", Instruction::read(&code, 0));
        for padding in [0, Opcode::MAX_SIZE] {
            code.resize(code.len() + padding, 0xa5);
            let raw = RawInstruction::read(&code, 0).unwrap();
            assert_eq!(
                format!("{:?}", (Instruction::from(&raw), raw.size)),
                expected
            );
        }
    }
    for &opcode in &Opcode::ALL[Opcode::Enter as usize..] {
        check::<Narrow>(&[], opcode);
        check::<Wide16>(&[Opcode::Wide16Prefix as u8], opcode);
        check::<Wide32>(&[Opcode::Wide32Prefix as u8], opcode);
    }
}

#[test]
fn metadata_is_grouped_by_kind() {
    let mut a = Assembler::default();
    a.get_by_id(local(0), local(0), IdentifierIndex(0));
    a.add(local(0), local(0), local(0));
    let site = a.here();
    a.call1(local(0), local(0), local(0), local(0), 8);
    a.get_by_id(local(0), local(0), IdentifierIndex(0));
    a.replace(site, Opcode::Subtract, &[0, 0, 0]);
    a.ret(local(0));
    let body = finish(&mut a);
    let entries = instructions(&body).into_iter().map(|row| row.1.metadata);
    assert_eq!(entries.collect::<Vec<_>>(), [2, 0, 1, 6, 0]);
    let layout = body.metadata();
    assert_eq!(layout.words(), 10);
    assert_eq!(layout.range(MetadataKind::Value), 0..0);
    assert_eq!(layout.range(MetadataKind::BinaryArithmetic), 0..2);
    assert_eq!(layout.range(MetadataKind::Branch), 2..2);
    assert_eq!(layout.range(MetadataKind::GetById), 2..10);
    assert_eq!(layout.range(MetadataKind::Coverage), 10..10);
    assert_eq!(layout.count(MetadataKind::GetById), 2);
    assert_eq!(layout.count(MetadataKind::Call), 0);
    assert_eq!(
        layout.ranges().collect::<Vec<_>>(),
        [
            (MetadataKind::BinaryArithmetic, 0..2),
            (MetadataKind::GetById, 2..10)
        ]
    );
}

#[test]
fn metadata_past_sixteen_bits() {
    for count in [65535, 65536, 65537] {
        let mut a = Assembler::default();
        (0..count).for_each(|_| a.negate(local(0), local(0)));
        a.ret(local(0));
        let body = finish(&mut a);
        assert_eq!(body.metadata().words(), count);
        for (index, (_, instruction)) in (0..count).zip(instructions(&body)) {
            assert_eq!(instruction.metadata, index);
            let bytes = if index < 65536 { 1 } else { 4 };
            assert_eq!(operand_bytes(&instruction), bytes);
        }
    }
}

#[test]
fn unreachable_code_leaves_nothing() {
    let mut a = Assembler::default();
    let (unused, head, inner) = (a.label(), a.label(), a.label());
    a.ret(local(0));
    a.bind(unused);
    a.bind_loop_head(head);
    a.position(1, 0, 2);
    a.negate(local(0), local(0));
    a.jump_if_true(local(0), inner);
    let switch = a.add_int_switch(inner, &[(1, head)]);
    a.switch_int(local(0), switch);
    let mask = a.add_spread_mask([true].into_iter());
    a.append_to_array(local(0), local(1), 1, mask);
    a.add_suspend_point(SuspendKind::Yield);
    assert!(!a.is_referenced(inner) && !a.is_referenced(head));
    a.bind(inner);
    a.jump(head);
    assert!(!a.is_reachable());
    let mut body = finish(&mut a);
    assert_eq!(mnemonics(&body), ["ret"]);
    assert!(body.tables.is_none() && body.positions().is_empty());
    assert_eq!(bytes(&mut body).len(), 2);
}

#[test]
fn jumps_are_threaded_and_left_out() {
    let mut a = Assembler::default();
    let (otherwise, end, out) = (a.label(), a.label(), a.label());
    a.jump_if_false(local(1), otherwise);
    a.mov(local(2), local(0));
    a.jump(end);
    a.bind(otherwise);
    a.jump(out);
    a.bind(end);
    a.mov(local(3), local(2));
    a.bind(out);
    a.ret(local(3));
    assert_eq!(
        listing(&finish(&mut a)),
        [
            (0, "jump_if_false", vec![-2, 9]),
            (3, "mov", vec![-3, -1]),
            (6, "mov", vec![-4, -3]),
            (9, "ret", vec![-4]),
        ]
    );
}

#[test]
fn a_cycle_of_jumps_stays() {
    let mut a = Assembler::default();
    let (first, second) = (a.label(), a.label());
    a.jump_if_true(local(0), first);
    a.ret(local(0));
    a.bind(first);
    a.jump(second);
    a.bind(second);
    a.jump(first);
    let listing = listing(&finish(&mut a));
    let (offset, mnemonic, words) = listing.last().unwrap();
    assert_eq!(*mnemonic, "jump");
    assert!(*offset as i32 + words[0] >= 5 && words[0] <= 0);
    assert!(listing[0].2[1] >= 5 && listing[0].2[1] <= *offset as i32);
}

#[test]
fn a_jump_in_place_of_a_branch_is_threaded() {
    let mut a = Assembler::default();
    let (head, otherwise) = (a.label(), a.label());
    a.bind_loop_head(head);
    a.loop_hint();
    a.jump_if_true(local(0), otherwise);
    a.ret(local(0));
    a.bind(otherwise);
    let site = a.here();
    a.jump_if_true(local(0), head);
    a.replace(site, Opcode::Goto, &[head.word()]);
    let listing = listing(&finish(&mut a));
    assert_eq!(listing[1], (1, "jump_if_true", vec![-1, -1]));
    assert_eq!(listing.len(), 3);
}

#[test]
fn a_jump_in_place_of_what_throws_keeps_its_position() {
    let mut a = Assembler::default();
    let next = a.label();
    a.position(1, 1, 1);
    let site = a.here();
    a.jump_if_less(local(0), local(0), next);
    a.replace(site, Opcode::Goto, &[next.word()]);
    assert!(!a.is_reachable());
    a.bind(next);
    a.position(2, 2, 2);
    a.throw(local(0));
    let body = finish(&mut a);
    let offsets = body.positions().entries().map(|entry| entry.0);
    assert_eq!(offsets.collect::<Vec<_>>(), [0, 2]);
}

#[test]
fn positions_are_for_what_throws() {
    let position = |divot| Position {
        divot,
        start: divot - 1,
        end: divot + 1,
    };
    let mut a = Assembler::default();
    a.negate(local(0), local(0));
    a.position(4, 3, 5);
    a.position(5, 4, 6);
    a.mov(local(0), local(1));
    a.negate(local(0), local(0));
    a.position(5, 4, 6);
    a.negate(local(0), local(0));
    a.position(9, 8, 10);
    a.negate(local(0), local(0));
    a.position(5, 4, 6);
    a.negate(local(0), local(0));
    a.set_records_positions(false);
    a.position(20, 19, 21);
    a.ret(local(0));
    assert_eq!(
        finish(&mut a).positions().entries().collect::<Vec<_>>(),
        [(8, position(5)), (18, position(9)), (23, position(5))]
    );
}

#[test]
fn a_handler_is_for_what_throws() {
    let mut a = Assembler::default();
    let (outer, inner, end) = (a.label(), a.label(), a.label());
    a.push_try(outer, HandlerKind::Finally);
    a.mov(local(0), local(1));
    a.push_try(inner, HandlerKind::Catch);
    a.mov(local(0), local(1));
    assert!(!a.is_referenced(inner));
    a.throw(local(0));
    assert!(a.is_referenced(inner) && !a.is_referenced(outer));
    a.pop_try();
    a.bind(inner);
    a.catch(local(1), local(2));
    a.pop_try();
    a.jump(end);
    a.bind(outer);
    a.catch(local(1), local(2));
    a.bind(end);
    a.ret(local(0));
    let body = finish(&mut a);
    assert_eq!(mnemonics(&body), ["mov", "mov", "throw", "catch", "ret"]);
    assert_eq!(handlers(&body), [(3, 8, 8)]);
}

#[test]
fn suspended_tries_are_split() {
    let one_byte = IdentifierIndex(0);
    let mut a = Assembler::default();
    let [outermost, outer, inner, nested] = [(); 4].map(|()| a.label());
    let throw = |a: &mut Assembler| a.check_initialized(local(0), one_byte);
    for handler in [outermost, outer, inner] {
        a.push_try(handler, HandlerKind::Catch);
        throw(&mut a);
    }
    let suspended = a.suspend_tries(1);
    assert_eq!(a.try_depth(), 1);
    throw(&mut a);
    a.push_try(nested, HandlerKind::Catch);
    throw(&mut a);
    a.pop_try();
    a.resume_tries(suspended);
    throw(&mut a);
    let suspended = a.suspend_tries(0);
    a.resume_tries(suspended);
    throw(&mut a);
    let suspended = a.suspend_tries(2);
    a.mov(local(0), local(0));
    a.resume_tries(suspended);
    throw(&mut a);
    let suspended = a.suspend_tries(2);
    throw(&mut a);
    a.resume_tries(suspended);
    a.mov(local(0), local(0));
    (0..3).for_each(|_| a.pop_try());
    for handler in [outermost, outer, inner, nested] {
        a.ret(local(0));
        a.bind(handler);
        a.catch(local(1), local(2));
    }
    a.ret(local(0));
    assert_eq!(
        handlers(&finish(&mut a)),
        [
            (6, 9, 49),
            (15, 27, 49),
            (3, 9, 42),
            (12, 15, 56),
            (15, 33, 42),
            (0, 33, 35),
        ]
    );
}

#[test]
fn int_switches_are_dense_or_sparse() {
    let evenly = |count: i32, step: i32| (0..count).map(|index| index * step).collect();
    let cases: [(Vec<i32>, bool); 8] = [
        (vec![], false),
        (vec![i32::MAX], true),
        (vec![i32::MIN, i32::MAX], false),
        (vec![29, 0], true),
        (vec![30, 0], false),
        (evenly(101, 10), true),
        (evenly(101, -10), true),
        (evenly(92, 11), false),
    ];
    for (keys, is_dense) in cases {
        let mut a = Assembler::default();
        let (default, first, second) = (a.label(), a.label(), a.label());
        let cases = keys.iter().map(|&key| (key, first));
        let cases: Vec<_> = cases.chain(keys.iter().map(|&key| (key, second))).collect();
        let switch = a.add_int_switch(default, &cases);
        a.switch_int(local(0), switch);
        assert!(!a.is_referenced(second));
        for label in [default, first, second] {
            a.bind(label);
            a.ret(local(0));
        }
        let body = finish(&mut a);
        let switch = &body.int_switches()[0];
        assert_eq!(matches!(switch.cases, IntCases::Dense { .. }), is_dense);
        assert!(keys.iter().all(|&key| switch.target(key) == 5));
        assert_eq!(switch.target(5), 3);
    }
}

#[test]
fn a_string_switch_in_unreachable_code_keeps_its_index() {
    let mut a = Assembler::default();
    let (start, dead, end) = (a.label(), a.label(), a.label());
    a.enter(0);
    a.jump(start);
    assert_eq!(a.add_string_switch(dead, &[dead]), StringSwitchIndex(0));
    a.bind(dead);
    a.bind(start);
    let switch = a.add_string_switch(end, &[end, end]);
    assert_eq!(switch, StringSwitchIndex(1));
    a.switch_string(local(0), switch);
    a.bind(end);
    a.ret(local(0));
    let body = a.finish(CodeKind::Call, CodeFlags::empty(), 2, 1).unwrap();
    assert_eq!(*body.string_switches()[1].targets, [5, 5]);
    assert_eq!(verify_form(&code(body, 0)), Ok(()));
}

#[test]
fn a_coverage_block_in_unreachable_code_stays_in_the_table() {
    let block = |start| CoverageBlock {
        start,
        end: start + 1,
        kind: CoverageKind::Plain,
    };
    let mut a = Assembler::default();
    let end = a.label();
    a.enter(0);
    a.jump(end);
    let dead = a.add_coverage_block(block(1));
    a.cover(dead);
    a.bind(end);
    let live = a.add_coverage_block(block(5));
    a.cover(live);
    a.ret(local(0));
    a.add_coverage_block(block(9));
    let body = a.finish(CodeKind::Call, CodeFlags::HAS_COVERAGE, 2, 1);
    let body = body.unwrap();
    assert_eq!(body.coverage_blocks(), [block(1), block(5), block(9)]);
    assert_eq!(mnemonics(&body), ["enter", "cover", "ret"]);
    assert_eq!(listing(&body)[1], (2, "cover", vec![1]));
    assert_eq!(body.metadata().count(MetadataKind::Coverage), 1);
    assert_eq!(verify_form(&code(body, 0)), Ok(()));
}

#[test]
fn equal_spread_masks_are_shared() {
    let mut a = Assembler::default();
    let mut add = |bits: u64, len| a.add_spread_mask((0..len).map(|bit| bits >> bit & 1 != 0));
    let masks = [
        add(5, 3),
        add(1 << 40, 41),
        add(5, 60),
        add(0, 9),
        add(0, 0),
    ];
    assert_eq!(masks.map(|mask| mask.0), [0, 1, 0, 2, 2]);
    a.ret(local(0));
    let body = finish(&mut a);
    let elements = |mask| {
        (0..64)
            .filter(|&element| body.is_spread(mask, element))
            .collect()
    };
    let elements: [Vec<u32>; 5] = masks.map(elements);
    assert_eq!(elements, [vec![0, 2], vec![40], vec![0, 2], vec![], vec![]]);
}

#[test]
fn registers_written_since_a_site() {
    let mut a = Assembler::default();
    let label = a.label();
    let start = a.here();
    a.track_writes();
    a.enter(1);
    let after_enter = a.here();
    a.call2(local(9), local(8), local(8), local(8), local(8), 8);
    a.replace(after_enter, Opcode::Move, &[local(2).word(), 0]);
    a.iterator_step(Register::argument(0), local(4));
    a.instanceof_custom(local(10), local(8), local(8), local(8), label);
    let written: [Vec<u32>; 3] = [start, after_enter, a.here()].map(|since| {
        (0..12)
            .filter(|&index| a.has_written(local(index), since))
            .collect()
    });
    let after = vec![2, 4, 5, 6, 10];
    assert_eq!(written, [[&[0, 1], &after[..]].concat(), after, vec![]]);
    assert!(a.has_written(Register::argument(0), start));
    assert!(!a.has_written(Register::THIS, start));
}

#[test]
fn too_many_locals_or_parameters() {
    let most = Body::MAX_FRAME_WORDS;
    for (locals, parameters, fits) in [
        (most, most, true),
        (most + 2, 1, false),
        (2, most + 1, false),
    ] {
        let mut a = Assembler::default();
        a.ret(local(0));
        let body = a.finish(CodeKind::Call, CodeFlags::empty(), locals, parameters);
        assert_eq!(body.is_ok(), fits);
    }
}

/// The first place on from `at` that is no `jump`, if there is one.
fn follow<T: Copy>(mut at: T, limit: usize, target_of_jump: impl Fn(T) -> Option<T>) -> Option<T> {
    for _ in 0..=limit {
        match target_of_jump(at) {
            Some(target) => at = target,
            None => return Some(at),
        }
    }
    None
}

fn check_against_program(body: &Body, program: &Program) {
    let emitted = &program.emitted;
    let decoded = instructions(body);
    let mut kept = decoded.iter().filter(|row| row.1.opcode != Opcode::Goto);
    let rows: Vec<_> = emitted
        .iter()
        .map(|it| (it.opcode != Opcode::Goto).then(|| kept.next().unwrap()))
        .collect();
    assert!(kept.next().is_none());

    let bound = |label: u32| program.labels[label as usize].unwrap();
    let expected = |index: usize| {
        let jump = |index: usize| {
            rows[index]
                .is_none()
                .then(|| bound(emitted[index].words[0]))
        };
        follow(index, rows.len(), jump).map(|index| rows[index].unwrap().0)
    };
    let actual = |offset: u32| {
        follow(offset, rows.len(), |offset| {
            let instruction = RawInstruction::read(body.instructions(), offset).unwrap();
            let is_jump = instruction.opcode == Opcode::Goto;
            is_jump.then(|| Jump(instruction.words()[0] as i32).from(offset))
        })
    };
    let same =
        |offset: u32, label: Label| assert_eq!(actual(offset), expected(bound(label.word())));

    for (index, (it, row)) in emitted.iter().zip(&rows).enumerate() {
        let Some(&(offset, instruction)) = *row else {
            continue;
        };
        assert_eq!(instruction.opcode, it.opcode);
        let operands = instruction.words().iter().zip(&it.words);
        for (&shape, (&word, &given)) in it.opcode.shapes().iter().zip(operands) {
            match shape {
                Shape::Target => same(Jump(word as i32).from(offset), Label::from_word(given)),
                Shape::SuspendPoint => {}
                _ => assert_eq!(word, given),
            }
        }
        if let Some((&(_, default), cases)) = it.cases.split_last() {
            let table = instruction.words()[1] as usize;
            if it.opcode == Opcode::SwitchString {
                let switch = &body.string_switches()[table];
                same(switch.default, default);
                assert_eq!(switch.targets.len(), cases.len());
                for &(key, label) in cases {
                    same(switch.targets[key as usize], label);
                }
            } else {
                let switch = &body.int_switches()[table];
                same(switch.default, default);
                for &(key, label) in cases {
                    same(switch.target(key), label);
                }
            }
        }
        let flow = it.opcode.flow();
        if !matches!(flow, Flow::Jumps | Flow::Ends) {
            let next = offset + u32::from(instruction.size);
            assert_eq!(actual(next), expected(index + 1));
        }
        if flow.can_throw() {
            let first = || Some(body.positions().entries().next()?.1);
            assert_eq!(body.positions().find(offset), it.position.or_else(first));
            let around = body.handlers().iter();
            let around = around.filter(|handler| handler.range.contains(&offset));
            let tries = it.tries.iter().rev();
            let tries = tries.filter(|it| program.is_referenced[it.0.word() as usize]);
            assert!(
                around
                    .map(|handler| (Some(handler.target), handler.kind))
                    .eq(tries.map(|&(label, kind)| (expected(bound(label.word())), kind)))
            );
        }
    }
}

#[test]
fn random_programs_keep_their_meaning() {
    let mut assembler = Assembler::default();
    for (rounds, steps, locals, entries) in [
        (1500, 30, 16, 20),
        (100, 600, 300, 600),
        (2, 20_000, 20, 20),
        (2, 3000, 70_000, 70_000),
    ] {
        let mut code = None;
        for seed in 0..rounds {
            let limits = Limits {
                steps,
                locals,
                entries,
                suspends: seed % 2 == 0 && locals < 1000,
            };
            let program = limits.build(&mut assembler, &mut Random::new(seed));
            let body = limits.finish(&mut assembler);
            check_against_program(&body, &program);
            let code = code.get_or_insert_with(|| super::support::code(copy(&body), entries));
            set_body(code, body);
            assert_eq!(verify_form(code), Ok(()), "{steps} steps, seed {seed}");
        }
    }
}
