use super::support::*;
use crate::assembler::Assembler;
use crate::verifier::verify_form;
use crate::*;

type Set = Vec<bool>;

/// What the shapes say, spelled out: the slots read, and those written with the ways out on which they are.
fn effects(
    body: &Body,
    instruction: &RawInstruction,
    with_saved: bool,
) -> (Vec<i32>, Vec<(i32, bool, bool)>) {
    let (mut uses, mut defs) = (vec![], vec![]);
    let words = instruction.words();
    for (index, &shape) in instruction.opcode.shapes().iter().enumerate() {
        let slot = words[index] as i32;
        let run = |count: u32| (0..count as i32).map(move |element| slot - element);
        let always = |slot| (slot, true, true);
        match shape {
            Shape::Dst => defs.push(always(slot)),
            Shape::DstIfJumps => defs.push((slot, false, true)),
            Shape::DstUnlessJumps => defs.push((slot, true, false)),
            Shape::Reg => uses.push(slot),
            Shape::Src if slot < 0x4000_0000 => uses.push(slot),
            Shape::Mut => {
                uses.push(slot);
                defs.push(always(slot));
            }
            Shape::Dst2 => defs.extend(run(2).map(always)),
            Shape::Dst3 => defs.extend(run(3).map(always)),
            Shape::Reg2 => uses.extend(run(2)),
            Shape::Reg3 => uses.extend(run(3)),
            Shape::Mut3 => {
                uses.extend(run(3));
                defs.extend(run(3).map(always));
            }
            Shape::First => uses.extend(run(words[index + 1])),
            Shape::ArgumentCount => {
                uses.extend((1..slot).map(|argument| 5 + argument - words[index + 1] as i32));
            }
            Shape::Variables => defs.extend((0..=slot).map(|local| always(-1 - local))),
            Shape::SuspendPoint if with_saved => {
                let saved = body.saved_registers(SuspendPointIndex(words[index]));
                let saved = saved.iter().map(|it| it.register.offset());
                match instruction.opcode {
                    Opcode::Resume => defs.extend(saved.map(always)),
                    _ => uses.extend(saved),
                }
            }
            _ => {}
        }
    }
    (uses, defs)
}

/// What is live before each instruction.
fn naive_liveness(body: &Body, is_dispatched: bool) -> Vec<Set> {
    let rows = instructions(body);
    let row_at = |offset| rows.binary_search_by_key(&offset, |row| row.0).unwrap();
    let mut live = vec![vec![false; body.locals() as usize]; rows.len()];
    let steps: Vec<_> = rows
        .iter()
        .map(|&(offset, instruction)| {
            let mut edges = vec![];
            instruction.for_each_successor(body, offset, |to, kind| edges.push((row_at(to), kind)));
            if !is_dispatched && instruction.opcode.flow() == Flow::Suspends {
                edges.push((row_at(offset) + 1, EdgeKind::FallThrough));
            }
            if !is_dispatched && instruction.opcode == Opcode::ResumeDispatch {
                edges.retain(|edge| edge.1 != EdgeKind::Jump);
            }
            (edges, effects(body, &instruction, is_dispatched))
        })
        .collect();
    let mut has_changed = true;
    while core::mem::take(&mut has_changed) {
        for (index, (edges, (uses, defs))) in steps.iter().enumerate().rev() {
            let mut before = vec![false; body.locals() as usize];
            for &(to, kind) in edges {
                let mut after = live[to].clone();
                for &(slot, falling, jumping) in defs.iter().filter(|def| def.0 < 0) {
                    after[!slot as usize] &= match kind {
                        EdgeKind::FallThrough => !falling,
                        EdgeKind::Jump => !jumping,
                        EdgeKind::Throw => true,
                    };
                }
                before.iter_mut().zip(after).for_each(|(a, b)| *a |= b);
            }
            for &slot in uses.iter().filter(|&&slot| slot < 0) {
                before[!slot as usize] = true;
            }
            has_changed |= before != live[index];
            live[index] = before;
        }
    }
    live
}

fn members(set: &Set) -> Vec<Register> {
    let indices = (0..).zip(set).filter(|&(_, &is_member)| is_member);
    indices.map(|(index, _)| local(index)).collect()
}

fn random_bodies(mut check: impl FnMut(&Body)) {
    let mut assembler = Assembler::default();
    for (rounds, steps, locals) in [(400, 40, 14), (60, 200, 64), (30, 300, 200)] {
        for seed in 0..rounds {
            let limits = Limits {
                steps,
                locals,
                entries: 20,
                suspends: seed % 2 == 0,
            };
            limits.build(&mut assembler, &mut Random::new(seed));
            check(&limits.finish(&mut assembler));
        }
    }
}

#[test]
fn uses_and_defs_follow_from_the_shapes() {
    random_bodies(|body| {
        for (_, instruction) in instructions(body) {
            let (mut uses, mut defs) = (vec![], vec![]);
            instruction.for_each_use(body, |run| {
                uses.extend(run.registers().map(Register::offset));
            });
            instruction.for_each_def(body, |run, written| {
                assert!(!written.holds_on(EdgeKind::Throw));
                let falling = written.holds_on(EdgeKind::FallThrough);
                let jumping = written.holds_on(EdgeKind::Jump);
                defs.extend(run.registers().map(|it| (it.offset(), falling, jumping)));
            });
            let (mut expected_uses, mut expected_defs) = effects(body, &instruction, true);
            uses.sort_unstable();
            expected_uses.sort_unstable();
            defs.sort_unstable();
            expected_defs.sort_unstable();
            assert_eq!((uses, defs), (expected_uses, expected_defs));
        }
    });
}

#[test]
fn blocks_agree_with_the_successors_of_their_instructions() {
    random_bodies(|body| {
        let graph = Graph::new(body).unwrap();
        let (mut end, mut forward, mut backward) = (0, vec![], vec![]);
        for block in graph.blocks() {
            let range = graph.range(block);
            assert!(range.start == end && range.start < range.end);
            end = range.end;
            let mut expected = vec![];
            for (offset, instruction) in graph.instructions(body, block) {
                assert_eq!(graph.block_at(offset), block);
                let handler = body.handler_for(offset).map(|handler| handler.target);
                assert_eq!(
                    graph.handler(block).map(|it| graph.range(it).start),
                    handler
                );
                instruction.for_each_successor(body, offset, |to, kind| {
                    if kind != EdgeKind::FallThrough || to == range.end {
                        expected.push((to, kind as u8));
                    }
                    let is_last = offset + u32::from(instruction.size) == range.end;
                    assert!(kind != EdgeKind::Jump || is_last);
                });
            }
            expected.sort_unstable();
            expected.dedup();
            let edges = graph.successors(block).iter();
            let edges = edges.map(|edge| (graph.range(edge.block).start, edge.kind as u8));
            let mut edges: Vec<_> = edges.collect();
            edges.sort_unstable();
            assert_eq!(edges, expected);
            let successors = graph.successors(block).iter();
            forward.extend(successors.map(|edge| (block, edge.block, edge.kind as u8)));
            let predecessors = graph.predecessors(block).iter();
            backward.extend(predecessors.map(|edge| (edge.block, block, edge.kind as u8)));
        }
        assert_eq!(end as usize, body.instructions().len());
        forward.sort_unstable();
        backward.sort_unstable();
        assert_eq!(forward, backward);
    });
}

#[test]
fn liveness_agrees_with_a_naive_solution() {
    let mut walk = Walk::default();
    random_bodies(|body| {
        let liveness = Liveness::new(body).unwrap();
        let mut expected = naive_liveness(body, true);
        for ((offset, _), expected) in instructions(body).into_iter().zip(&expected) {
            let live = liveness.live_before(body, offset, &mut walk);
            assert_eq!(live.iter().collect::<Vec<_>>(), members(expected));
        }
        for block in liveness.graph().blocks().rev() {
            let mut first = vec![];
            liveness.walk_backwards(body, block, &mut walk, |_, _, live| {
                first = members(&expected.pop().unwrap());
                assert_eq!(live.iter().collect::<Vec<_>>(), first);
            });
            let live_in = liveness.live_in(block);
            assert_eq!(live_in.words().len(), body.locals().div_ceil(64) as usize);
            assert_eq!(live_in.iter().collect::<Vec<_>>(), first);
            assert_eq!(live_in.is_empty(), first.is_empty());
            assert!(
                (0..body.locals()).all(|index| {
                    live_in.contains(local(index)) == first.contains(&local(index))
                })
            );
        }
        assert!(expected.is_empty());
    });
}

fn saved_at(body: &Body, point: u32) -> Vec<Register> {
    let saved = body.saved_registers(SuspendPointIndex(point));
    saved.iter().map(|it| it.register).collect()
}

#[test]
fn what_is_live_after_a_resumption_is_saved() {
    let mut points = 0;
    random_bodies(|body| {
        let rows = instructions(body);
        let expected = naive_liveness(body, false);
        for (index, point) in (0..).zip(body.suspend_points()) {
            let row = rows.iter().position(|row| row.0 == point.resume).unwrap();
            let saved = saved_at(body, index);
            let mut expected = members(&expected[row]);
            expected.retain(|&register| register != Register::SCOPE);
            assert_eq!(saved, expected);
            points += 1;
        }
    });
    assert!(points > 500);
}

#[test]
fn points_share_what_they_save() {
    let mut a = Assembler::default();
    let (handler, skipped) = (a.label(), a.label());
    let generator = local(1);
    let wait = |a: &mut Assembler| {
        let point = a.add_suspend_point(SuspendKind::Await);
        a.r#await(generator, local(2), point);
        a.resume(generator, point);
        a.resume_after_await(local(2));
    };
    a.enter(70);
    a.resume_dispatch();
    a.jump(skipped);
    wait(&mut a);
    a.bind(skipped);
    wait(&mut a);
    wait(&mut a);
    a.push_try(handler, HandlerKind::Catch);
    wait(&mut a);
    a.mov(local(70), local(3));
    a.mov(local(3), local(2));
    a.throw(local(70));
    a.pop_try();
    a.bind(handler);
    a.catch(local(4), local(5));
    a.mov(local(2), local(70));
    wait(&mut a);
    a.mov(local(2), local(3));
    wait(&mut a);
    a.async_return(generator, local(2));
    let body = a.finish(CodeKind::Call, CodeFlags::SUSPENDS, 72, 1);
    let body = body.unwrap();
    let saved = [0, 1, 2, 3, 4].map(|point| saved_at(&body, point));
    let both = [local(3), local(70)];
    assert_eq!(saved, [&both, &both, &both, &both[..1], &[]]);
    assert_eq!(body.tables.as_ref().unwrap().saved_registers.len(), 3);
    assert_eq!(body.saved_words(), 2);
    let liveness = Liveness::new(&body).unwrap();
    assert!(liveness.live_in(BlockIndex(0)).is_empty());
    assert_eq!(verify_form(&code(body, 0)), Ok(()));
}

#[test]
fn each_register_has_a_word_of_its_own_and_kept_ones_get_through() {
    let mut a = Assembler::default();
    let generator = local(1);
    let wait = |a: &mut Assembler, kept: &[Register]| {
        let point = a.add_suspend_point(SuspendKind::Await);
        a.keep_while_suspended(kept.iter().copied());
        a.r#await(generator, local(2), point);
        a.resume(generator, point);
    };
    a.enter(6);
    a.resume_dispatch();
    wait(&mut a, &[]);
    a.mov(local(2), local(5));
    wait(&mut a, &[local(3), Register::SCOPE]);
    a.mov(local(6), local(2));
    wait(&mut a, &[]);
    a.async_return(generator, local(6));
    let body = a.finish(CodeKind::Call, CodeFlags::SUSPENDS, 8, 1).unwrap();
    let words = |point| {
        let saved = body.saved_registers(SuspendPointIndex(point)).iter();
        saved.map(|it| (it.register, it.word)).collect::<Vec<_>>()
    };
    assert_eq!(words(0), [(local(3), 1), (local(5), 2)]);
    assert_eq!(words(1), [(local(2), 0), (local(3), 1)]);
    assert_eq!(words(2), [(local(6), 3)]);
    assert_eq!(body.saved_words(), 4);
    assert_eq!(verify(&code(body, 0), None), Ok(()));
}

#[test]
fn what_cannot_throw_keeps_nothing_alive_for_the_handler() {
    let mut a = Assembler::default();
    let handler = a.label();
    a.enter(0);
    a.push_try(handler, HandlerKind::Catch);
    a.mov(local(1), Register::THIS);
    a.to_string(local(2), Register::THIS);
    a.ret(local(2));
    a.pop_try();
    a.bind(handler);
    a.catch(local(4), local(5));
    a.concatenate(local(1), local(1), 2);
    a.ret(local(1));
    let body = a.finish(CodeKind::Call, CodeFlags::empty(), 6, 1).unwrap();
    let liveness = Liveness::new(&body).unwrap();
    let mut walk = Walk::default();
    let mut live = |offset| {
        let live = liveness.live_before(&body, offset, &mut walk);
        live.iter().collect::<Vec<_>>()
    };
    assert_eq!(live(2), [local(2)]);
    assert_eq!(live(5), [local(1), local(2)]);
}

#[test]
fn many_blocks_and_many_locals() {
    const VARIABLES: u32 = 4000;
    let mut a = Assembler::default();
    let head = a.label();
    a.enter(1);
    a.resume_dispatch();
    a.bind_loop_head(head);
    for variable in 2..VARIABLES {
        let skip = a.label();
        a.mov(local(variable + 1), local(variable));
        a.jump_if_true(local(0), skip);
        let point = a.add_suspend_point(SuspendKind::Yield);
        a.suspend(local(1), local(0), SuspendKind::Yield, point);
        a.resume(local(1), point);
        a.bind(skip);
    }
    a.mov(local(2), local(VARIABLES));
    a.jump(head);
    let body = a.finish(CodeKind::Call, CodeFlags::SUSPENDS, VARIABLES + 2, 1);
    let body = body.unwrap();
    for point in 0..VARIABLES - 2 {
        assert_eq!(saved_at(&body, point), [local(point + 3)]);
    }
}

#[test]
fn sets_that_take_too_much_memory() {
    let mut a = Assembler::default();
    a.enter(0);
    for _ in 0..64 {
        let next = a.label();
        a.jump_if_true(local(0), next);
        a.bind(next);
    }
    a.ret(local(0));
    let locals = Body::MAX_FRAME_WORDS;
    let body = a.finish(CodeKind::Call, CodeFlags::empty(), locals, 1);
    assert!(Liveness::new(&body.unwrap()).is_err());
}
