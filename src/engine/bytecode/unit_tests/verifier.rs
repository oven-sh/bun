use core::fmt::Write;
use std::rc::Rc;

use bun_engine_text::{Identifier, Text};

use super::support::*;
use crate::assembler::Assembler;
use crate::code::Tables;
use crate::verifier::verify_form;
use crate::*;

const LOCALS: u32 = 16;
const PARAMETERS: u32 = 3;
const ENTRIES: u32 = 12;

fn fault(code: &Code) -> Option<Fault> {
    verify_form(code).err().map(|error| error.fault)
}

fn assemble(flags: CodeFlags, parameters: u32, emit: impl FnOnce(&mut Assembler)) -> Body {
    let mut assembler = Assembler::default();
    emit(&mut assembler);
    let body = assembler.finish(CodeKind::Construct, flags, LOCALS, parameters);
    body.unwrap()
}

fn plain(emit: impl FnOnce(&mut Assembler)) -> Body {
    assemble(CodeFlags::all() - CodeFlags::SUSPENDS, PARAMETERS, |a| {
        a.enter(0);
        emit(a);
        a.ret(local(1));
    })
}

fn suspending(emit: impl FnOnce(&mut Assembler)) -> Body {
    assemble(CodeFlags::SUSPENDS, 1, |a| {
        a.enter(0);
        a.resume_dispatch();
        emit(a);
        a.generator_return(local(1), local(2));
    })
}

/// And what follows them.
fn instruction_bytes(body: &mut Body) -> &mut [u8] {
    let start = body.start as usize;
    &mut bytes(body)[start..]
}

fn tables(body: &mut Body) -> &mut Tables {
    body.tables.as_mut().unwrap()
}

/// With the second instruction as `Wide16`, if it is narrow.
fn widened(body: &Body) -> Option<Body> {
    let instruction = instructions(body)[1].1;
    let opcode = instruction.opcode;
    (usize::from(instruction.size) == opcode.size::<Narrow>()).then(|| {
        let mut wide = copy(body);
        let (before, rest) = bytes(&mut wide).split_at(body.start as usize + 2);
        let mut all = [before, &[Opcode::Wide16Prefix as u8, opcode as u8]].concat();
        for (&shape, &word) in opcode.shapes().iter().zip(instruction.words()) {
            let stored = match Operand::from_word(word).as_constant() {
                Some(index) if shape == Shape::Src => index + Wide16::FIRST_CONSTANT as u32,
                _ => word,
            };
            all.extend((stored as u16).to_le_bytes());
        }
        all.extend(&rest[1 + opcode.shapes().len()..]);
        *bytes(&mut wide) = all.into();
        wide.instructions_size += 1 + opcode.shapes().len() as u32;
        wide
    })
}

fn of_bytes(instructions: &[u8]) -> Body {
    let mut body = plain(|_| {});
    *bytes(&mut body) = instructions.into();
    body.instructions_size = instructions.len() as u32;
    body
}

#[test]
fn operands_at_their_limits() {
    use Opcode::*;
    let register = |index| local(index).word();
    let constant = |index| Operand::constant(index).word();
    let (ok, last, past) = (register(1), register(LOCALS - 1), register(LOCALS));
    let scope = Register::SCOPE.word();
    let bad = |index| Some(Fault::Operand(index));
    let cases: &[(Opcode, &[u32], Option<Fault>)] = &[
        (Move, &[last, last], None),
        (Move, &[past, ok], bad(0)),
        (Move, &[scope, ok], bad(0)),
        (Move, &[ok, scope], None),
        (Move, &[scope, scope], None),
        (Not, &[scope, scope], bad(0)),
        (CopyScope, &[scope], bad(0)),
        (IteratorBegin, &[scope, ok], bad(0)),
        (IteratorSkip, &[scope], bad(0)),
        (IteratorClose, &[scope, 0], None),
        (Move, &[ok, past], bad(1)),
        (Move, &[ok, 0], bad(1)),
        (Move, &[ok, 1], bad(1)),
        (Move, &[ok, 2], bad(1)),
        (Move, &[ok, 3], None),
        (Move, &[ok, 4], bad(1)),
        (Move, &[5, 5], None),
        (Move, &[7, 7], None),
        (Move, &[ok, 8], bad(1)),
        (Move, &[8, ok], bad(0)),
        (Move, &[3, ok], bad(0)),
        (Move, &[constant(STRING), ok], bad(0)),
        (Move, &[ok, constant(ENTRIES - 1)], None),
        (Move, &[ok, constant(ENTRIES)], bad(1)),
        (Move, &[ok, constant(ARRAY)], bad(1)),
        (Move, &[ok, constant(REGEXP)], bad(1)),
        (Move, &[i32::MIN as u32, ok], bad(0)),
        (CheckThis, &[3], None),
        (CheckThis, &[constant(STRING)], bad(0)),
        (ToThis, &[3], bad(0)),
        (PostIncrement, &[ok, last], None),
        (PostIncrement, &[ok, ok], bad(1)),
        (PostDecrement, &[ok, ok], bad(1)),
        (IteratorSkip, &[register(LOCALS - 3)], None),
        (IteratorSkip, &[register(LOCALS - 2)], bad(0)),
        (IteratorSkip, &[7], bad(0)),
        (IteratorBegin, &[register(LOCALS - 2), ok], bad(0)),
        (IteratorClose, &[register(LOCALS - 2), 0], bad(0)),
        (IteratorClose, &[ok, CloseMode::COUNT], bad(1)),
        (Concatenate, &[ok, scope, LOCALS], None),
        (Concatenate, &[ok, scope, LOCALS + 1], bad(1)),
        (Concatenate, &[ok, last, u32::MAX], bad(1)),
        (Concatenate, &[ok, 7, 1], bad(1)),
        (Concatenate, &[ok, past, 0], None),
        (Call, &[ok, ok, ok, 1, 8], None),
        (Call, &[ok, ok, ok, 1, 6], bad(4)),
        (Call, &[ok, ok, ok, 0, 10], bad(3)),
        (Call, &[ok, ok, ok, 2, 8], bad(4)),
        (Call, &[ok, ok, ok, 3, 10], None),
        (Call, &[ok, ok, ok, 4, 10], bad(4)),
        (Call, &[ok, ok, ok, 1, 11], bad(4)),
        (Call, &[ok, ok, ok, LOCALS - 7, LOCALS], None),
        (Call, &[ok, ok, ok, LOCALS - 6, LOCALS], bad(4)),
        (Call, &[ok, ok, ok, 1, LOCALS + 2], bad(4)),
        (Call, &[ok, ok, ok, u32::MAX, 10], bad(4)),
        (Call1, &[ok, ok, ok, ok, 10], None),
        (Call1, &[ok, ok, ok, ok, 8], bad(4)),
        (Call2, &[ok, ok, ok, ok, ok, 10], None),
        (Call2, &[ok, ok, ok, ok, ok, 8], bad(5)),
        (GetScoped, &[ok, ok, Body::MAX_FRAME_WORDS], None),
        (GetScoped, &[ok, ok, Body::MAX_FRAME_WORDS + 1], bad(2)),
        (HasShapeWithFlags, &[ok, ok, u32::MAX], None),
        (GetFromArguments, &[ok, ok, PARAMETERS - 2], None),
        (GetFromArguments, &[ok, ok, PARAMETERS - 1], bad(2)),
        (EnsureArguments, &[ok, 2], bad(1)),
        (EnsureRest, &[ok, Body::MAX_FRAME_WORDS], None),
        (EnsureRest, &[ok, Body::MAX_FRAME_WORDS + 1], bad(1)),
        (CallWithSpread, &[ok, ok, ok, 0, 0, 0], bad(2)),
        (CallWithSpread, &[ok, ok, ok, 1, 0, 0], bad(4)),
        (DeleteGlobal, &[ok, ENTRIES - 1], None),
        (DeleteGlobal, &[ok, ENTRIES], bad(1)),
        (CopyRest, &[ok, ok, 3, ok, 0], None),
        (CopyRest, &[ok, ok, 4, ok, 0], bad(2)),
        (NewObjectLiteral, &[ok, 2, ok, 2, 0], None),
        (NewObjectLiteral, &[ok, 2, ok, 3, 0], bad(1)),
        (NewFunction, &[ok, ok, FUNCTION], None),
        (NewFunction, &[ok, ok, CLASS], bad(2)),
        (NewFunction, &[ok, ok, 2], bad(2)),
        (NewClass, &[ok, ok, ok, FUNCTION, ok, ok], bad(3)),
        (CreateScope, &[ok, ok, WITH_SCOPE], bad(2)),
        (CreateScope, &[ok, ok, 2], bad(2)),
        (CreateWithScope, &[ok, ok, BLOCK_SCOPE, ok], bad(2)),
        (NewArrayFromConstant, &[ok, REGEXP], bad(1)),
        (NewArrayFromConstant, &[ok, ENTRIES], bad(1)),
        (NewRegExp, &[ok, ARRAY], bad(1)),
        (SwitchInt, &[ok, 0], bad(1)),
        (SwitchString, &[ok, 0], bad(1)),
        (AppendToArray, &[ok, ok, 1, 0], bad(3)),
        (Cover, &[0], bad(0)),
        (GetGlobal, &[ok, 0, Unresolved::COUNT], bad(2)),
        (ThrowError, &[ErrorKind::COUNT, ok], bad(0)),
        (ThrowError, &[0, constant(STRING)], None),
        (ThrowError, &[0, constant(LONG_STRING)], None),
        (ThrowError, &[0, constant(STRING + 1)], bad(1)),
        (ThrowStatic, &[StaticError::COUNT - 1, 0], None),
        (ThrowStatic, &[StaticError::COUNT, 0], bad(0)),
        (DynamicImport, &[ok, ok, ok, ok, ImportPhase::COUNT], bad(4)),
        (Debug, &[DebugHook::COUNT], bad(0)),
        (NewArray, &[ok, ok, 0, ArrayShape::COUNT], bad(3)),
        (PutById, &[ok, 0, ok, 4], bad(3)),
        (PutById, &[ok, 0, ok, 256], bad(3)),
        (DefineMethod, &[ok, ok, ok, 16], bad(3)),
        (IsCellOfType, &[ok, ok, 255], None),
        (IsCellOfType, &[ok, ok, 256], bad(2)),
        (DirectEval, &[ok, ok, ok, 256], bad(3)),
    ];
    for &(opcode, words, expected) in cases {
        let body = plain(|a| {
            let site = a.here();
            a.call2(local(0), local(0), local(0), local(0), local(0), 8);
            a.replace(site, opcode, words);
        });
        let expected = expected.map(|fault| VerifyError {
            fault,
            offset: Some(2),
        });
        let wide = widened(&body);
        for body in [Some(body), wide].into_iter().flatten() {
            let error = verify_form(&code(body, ENTRIES)).err();
            assert_eq!(error, expected, "{opcode:?} {words:?}");
        }
    }
    for (variables, expected) in [(LOCALS - 1, None), (LOCALS, bad(0))] {
        let body = assemble(CodeFlags::empty(), 1, |a| {
            a.enter(variables);
            a.ret(local(0));
        });
        assert_eq!(fault(&code(body, 0)), expected);
    }
}

#[test]
fn a_constant_is_not_taken_for_a_parameter() {
    for constant in [100, 200] {
        let body = assemble(CodeFlags::empty(), 1000, |a| {
            a.enter(0);
            a.ret(Operand::constant(constant));
        });
        assert_eq!(fault(&code(body, ENTRIES)), Some(Fault::Operand(0)));
    }
}

#[test]
fn wide_operands_of_the_wrong_kind() {
    let wide = |body: Body, entries| code(widened(&body).unwrap_or(body), entries);
    let mut no_functions = wide(plain(|a| a.mov(local(1), Operand::constant(ARRAY))), 1);
    no_functions.functions = Rc::new([]);
    assert_eq!(fault(&no_functions), Some(Fault::Operand(1)));
    let class = FunctionIndex(CLASS);
    let no_constants = wide(plain(|a| a.new_function(local(1), local(0), class)), 0);
    assert_eq!(fault(&no_constants), Some(Fault::Operand(2)));
    let many_constants = wide(plain(|a| a.mov(local(1), local(20_000))), 70_000);
    assert_eq!(fault(&many_constants), Some(Fault::Operand(1)));
}

#[test]
fn metadata_of_a_kind_that_has_none() {
    let mut body = plain(|a| a.get_argument(local(1), 1 << 16));
    instruction_bytes(&mut body)[12..16].fill(0xff);
    body.layout_size = 0;
    assert_eq!(fault(&code(body, 0)), Some(Fault::Metadata));
}

#[test]
fn instructions_that_need_a_flag() {
    let mut needed = vec![];
    for flag in CodeFlags::all().iter() {
        for &opcode in &Opcode::ALL[2..] {
            let second = match flag {
                CodeFlags::SUSPENDS => Opcode::LoopHint,
                _ => Opcode::ResumeDispatch,
            };
            let start = [Opcode::Enter as u8, 0, second as u8, opcode as u8];
            let mut body = of_bytes(&[&start[..], &[0xff; 8]].concat());
            (body.flags, body.parameters) = (CodeFlags::all() - flag, 1);
            if fault(&code(body, 0)) == Some(Fault::Flags) {
                needed.push(opcode.mnemonic());
            }
        }
    }
    assert_eq!(
        needed.join(" "),
        "get_by_id_direct get_internal_field put_internal_field new_array_with_species new_promise \
         create_promise to_object has_shape_with_flags resume_generator \
         async_iterator_next resume_dispatch create_generator create_async_generator suspend await resume \
         resume_after_yield resume_after_await resume_after_delegate generator_return generator_throw \
         debug_await tail_call tail_call_varargs tail_call_with_spread debug debug_await \
         jump_if_frame_is_kept cover"
    );
}

#[test]
fn instructions_out_of_place() {
    let order = Some(Fault::Order);
    let check = |body, expected| assert_eq!(fault(&code(body, ENTRIES)), expected);
    let no_flags = CodeFlags::empty();
    check(assemble(no_flags, 1, |_| {}), Some(Fault::FallsOffTheEnd));
    check(
        assemble(no_flags, 1, |a| a.enter(0)),
        Some(Fault::FallsOffTheEnd),
    );
    check(assemble(no_flags, 1, |a| a.ret(local(0))), order);
    check(plain(|a| a.enter(0)), order);
    check(plain(|a| a.catch(local(1), local(2))), order);
    let tail_call = |a: &mut Assembler, dst| a.tail_call(dst, local(0), local(0), 1, 8);
    check(plain(|a| tail_call(a, local(1))), None);
    check(plain(|a| tail_call(a, local(2))), order);
    check(
        plain(|a| {
            tail_call(a, local(1));
            a.throw(local(1));
        }),
        order,
    );
    check(suspending(|_| {}), None);
    check(suspending(|a| a.resume_dispatch()), order);
    check(
        assemble(CodeFlags::SUSPENDS, 1, |a| {
            a.enter(0);
            a.ret(local(0));
        }),
        order,
    );
}

#[test]
fn bytes_that_are_no_instruction() {
    let (enter, ret) = (Opcode::Enter as u8, Opcode::Return as u8);
    let cases: [&[u8]; 6] = [
        &[enter, 0, Opcode::COUNT as u8],
        &[enter, 0, ret],
        &[enter, 0, 0],
        &[enter, 0, 0, ret, 0xff],
        &[enter, 0, 0, 0, ret, 0xff, 0xff],
        &[enter, 0, 1, 0, ret, 0xff, 0xff],
    ];
    for bytes in cases {
        let code = code(of_bytes(bytes), 0);
        assert_eq!(fault(&code), Some(Fault::NotAnInstruction));
    }
}

#[test]
fn where_a_jump_may_lead() {
    let body = suspending(|a| {
        let (next, handler) = (a.label(), a.label());
        a.jump_if_true(local(0), next);
        a.push_try(handler, HandlerKind::Catch);
        let point = a.add_suspend_point(SuspendKind::Await);
        a.r#await(local(1), local(2), point);
        a.resume(local(1), point);
        a.throw(local(0));
        a.pop_try();
        a.bind(handler);
        a.catch(local(1), local(2));
        a.bind(next);
    });
    let accepts = |target: i32| {
        let mut body = copy(&body);
        instruction_bytes(&mut body)[5] = (target - 3) as u8;
        match fault(&code(body, 0)) {
            None => true,
            Some(fault) => {
                assert_eq!(fault, Fault::Target);
                false
            }
        }
    };
    let accepted: Vec<_> = (-2..30).filter(|&target| accepts(target)).collect();
    assert_eq!(accepted, [3, 6, 13, 20]);
}

#[test]
fn damaged_headers_and_tables() {
    let body = suspending(|a| {
        let (handler, next, last) = (a.label(), a.label(), a.label());
        a.position(1, 1, 1);
        a.push_try(handler, HandlerKind::Catch);
        for kind in [SuspendKind::Start, SuspendKind::Yield] {
            let point = a.add_suspend_point(kind);
            a.suspend(local(1), local(2), kind, point);
            a.resume(local(1), point);
            a.add(local(3), local(3), local(4));
            a.mov(local(4), local(5));
        }
        let dense = a.add_int_switch(next, &[(1, next), (2, last)]);
        a.switch_int(local(0), dense);
        a.bind(next);
        let sparse = a.add_int_switch(last, &[(1, last), (2000, last)]);
        a.switch_char(local(0), sparse);
        a.pop_try();
        a.bind(handler);
        a.catch(local(1), local(2));
        let strings = a.add_string_switch(last, &[last]);
        a.switch_string(local(0), strings);
        a.bind(last);
    });
    let size = body.instructions_size;
    let positions = size as usize;
    let damages: &[(Fault, &dyn Fn(&mut Body))] = &[
        (Fault::Header, &|b| b.locals = 15),
        (Fault::Header, &|b| b.locals = 0),
        (Fault::Header, &|b| b.locals = Body::MAX_FRAME_WORDS + 2),
        (Fault::Header, &|b| b.parameters = 0),
        (Fault::Header, &|b| b.parameters = 2),
        (Fault::Header, &|b| {
            b.flags = CodeFlags::from_bits_retain(0xff)
        }),
        (Fault::Header, &|b| b.instructions_size = u32::MAX),
        (Fault::Header, &|b| bytes(b)[1] = 0xff),
        (Fault::Header, &|b| b.layout_size = 6),
        (Fault::Header, &|b| b.layout_size = u8::MAX),
        (Fault::Header, &|b| {
            bytes(b)[4] = 1 << (MetadataKind::COUNT - 32);
        }),
        (Fault::MetadataLayout, &|b| bytes(b)[5] = 0),
        (Fault::MetadataLayout, &|b| bytes(b)[5] = 3),
        (Fault::MetadataLayout, &|b| bytes(b)[7] = 4),
        (Fault::Metadata, &|b| bytes(b)[5] = 1),
        (Fault::Metadata, &|b| instruction_bytes(b)[15] = 1),
        (Fault::Metadata, &|b| bytes(b)[0] ^= 6),
        (Fault::Positions, &|b| {
            instruction_bytes(b)[positions + 1] = 4
        }),
        (Fault::Positions, &|b| {
            instruction_bytes(b)[positions + 1] = size as u8
        }),
        (Fault::Handlers, &|b| tables(b).handlers[0].range.start += 1),
        (Fault::Handlers, &|b| tables(b).handlers[0].range.end += 1),
        (Fault::Handlers, &|b| tables(b).handlers[0].range = 3..3),
        (Fault::Handlers, &|b| {
            tables(b).handlers[0].range.end = size + 1
        }),
        (Fault::Handlers, &|b| tables(b).handlers[0].target = 3),
        (Fault::Handlers, &|b| {
            tables(b).handlers[0].target = u32::MAX
        }),
        (Fault::Target, &|b| tables(b).int_switches[0].default += 1),
        (Fault::Target, &|b| tables(b).int_switches[1].default = size),
        (Fault::Target, &|b| tables(b).string_switches[0].default = 0),
        (Fault::Target, &|b| {
            tables(b).string_switches[0].targets[0] = 8
        }),
        (Fault::Switches, &|b| {
            let targets = [3, 3].into();
            let first = i32::MAX;
            tables(b).int_switches[0].cases = IntCases::Dense { first, targets };
        }),
        (Fault::Switches, &|b| {
            tables(b).int_switches[1].cases = IntCases::Sparse([(1, 3), (1, 3)].into());
        }),
        (Fault::Operand(1), &|b| instruction_bytes(b)[42] = 0),
        (Fault::Operand(3), &|b| {
            tables(b).suspend_points[0].suspend = 20
        }),
        (Fault::Operand(1), &|b| {
            tables(b).suspend_points[0].resume = 25
        }),
        (Fault::Operand(3), &|b| tables(b).suspend_points.swap(0, 1)),
        (Fault::Operand(3), &|b| {
            tables(b).suspend_points[1].kind = SuspendKind::Await;
        }),
        (Fault::Operand(1), &|b| instruction_bytes(b)[10] = 1),
        (Fault::Order, &|b| {
            instruction_bytes(b)[8] = Opcode::Move as u8
        }),
        (Fault::Order, &|b| {
            instruction_bytes(b)[17] = Opcode::Resume as u8
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).suspend_points[0].registers.start += 1;
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).saved_registers[0].register = Register::SCOPE;
        }),
        (Fault::ScopeRegisters, &|b| {
            tables(b).scope_registers = [(0, local(LOCALS))].into();
        }),
        (Fault::ScopeRegisters, &|b| {
            tables(b).scope_registers = [(2, local(1)), (0, local(1))].into();
        }),
        (Fault::SuspendPoints, &|b| {
            let points = &mut tables(b).suspend_points;
            *points = [&points[..], &points[1..]].concat().into();
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).saved_registers[0].register = Register::THIS
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).saved_registers[3].register = local(LOCALS)
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).saved_registers.swap(0, 1)
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).suspend_points[0].registers = 1..4
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).suspend_points[1].registers = 4..99
        }),
        (Fault::SavedRegisters, &|b| {
            tables(b).set_saved_registers(&[local(0); 9])
        }),
    ];
    let mut whole = code(copy(&body), 0);
    assert_eq!(verify_form(&whole), Ok(()));
    for (index, (expected, damage)) in damages.iter().enumerate() {
        let mut body = copy(&body);
        damage(&mut body);
        set_body(&mut whole, body);
        assert_eq!(fault(&whole), Some(*expected), "{index}");
    }
    set_body(&mut whole, body);
    whole.string_switches[0] = Box::default();
    assert_eq!(fault(&whole), Some(Fault::Switches));
    whole.string_switches = Box::default();
    assert_eq!(fault(&whole), Some(Fault::Switches));
}

#[test]
fn constants_and_names() {
    let with_constant = |flags, constant| {
        let mut body = plain(|_| {});
        body.flags = flags;
        let mut code = code(body, 0);
        code.constants = [constant].into();
        fault(&code)
    };
    let of_host = || Constant::LinkTime(LinkTimeConstant::FIRST_OF_HOST);
    let bad = Some(Fault::Constants);
    assert_eq!(with_constant(CodeFlags::BUILTIN, of_host()), None);
    assert_eq!(with_constant(CodeFlags::empty(), of_host()), bad);
    let array =
        |values: [Constant; 1]| Constant::Array(Rc::new(ArrayLiteral::Values(values.into())));
    let nested = array([array([Constant::Null])]);
    assert_eq!(with_constant(CodeFlags::empty(), nested), bad);
    let template = Constant::Template(Rc::new(TemplateSite {
        cooked: [None].into(),
        raw: [].into(),
        end: 0,
    }));
    assert_eq!(with_constant(CodeFlags::empty(), template), bad);

    for (names, is_literal, expected) in [
        (["a", "b"], true, None),
        (["a", "a"], true, Some(Fault::NameLists)),
        (["a", "7"], true, Some(Fault::NameLists)),
        (["7", "7"], false, None),
    ] {
        let list = NameListIndex(0);
        let mut code = code(
            plain(|a| match is_literal {
                true => a.new_object_literal(local(1), list, local(1), 2, 2),
                false => a.copy_rest(local(1), local(0), list, local(1), 0),
            }),
            0,
        );
        code.name_lists = [names.map(Identifier::from_literal).into()].into();
        assert_eq!(fault(&code), expected);
    }
}

fn damage_word(random: &mut Random, word: &mut u32) {
    *word = match random.below(4) {
        0 => word.wrapping_add(random.below(9)).wrapping_sub(4),
        1 => *word ^ 1 << random.below(32),
        2 => random.skewed_below(u32::MAX),
        _ => random.pick(&[0, 1, i32::MAX as u32, i32::MIN as u32, u32::MAX]),
    };
}

fn damage_tables(random: &mut Random, tables: &mut Tables) {
    let mut words: Vec<&mut u32> = vec![];
    for handler in &mut tables.handlers {
        let range = &mut handler.range;
        words.extend([&mut range.start, &mut range.end, &mut handler.target]);
    }
    for switch in &mut tables.int_switches {
        words.push(&mut switch.default);
        match &mut switch.cases {
            IntCases::Dense { targets, .. } => words.extend(targets),
            IntCases::Sparse(cases) => words.extend(cases.iter_mut().map(|case| &mut case.1)),
        }
    }
    for switch in &mut tables.string_switches {
        words.extend(switch.targets.iter_mut().chain([&mut switch.default]));
    }
    for point in &mut tables.suspend_points {
        let range = &mut point.registers;
        words.extend([&mut point.suspend, &mut point.resume]);
        words.extend([&mut range.start, &mut range.end]);
    }
    let choice = random.below((words.len() + tables.saved_registers.len()) as u32 + 1) as usize;
    if let Some(index) = choice.checked_sub(words.len()) {
        if let Some(saved) = tables.saved_registers.get_mut(index) {
            let mut word = saved.register.word();
            damage_word(random, &mut word);
            saved.register = Register::from_word(word);
        }
    } else {
        damage_word(random, words[choice]);
    }
}

fn damage(random: &mut Random, body: &mut Body) {
    let at = random.below(bytes(body).len() as u32) as usize;
    match random.below(16) {
        0 => damage_word(random, &mut body.locals),
        1 => damage_word(random, &mut body.parameters),
        2 => damage_word(random, &mut body.instructions_size),
        3 => damage_word(random, &mut body.start),
        4 => body.flags ^= CodeFlags::from_bits_retain(1 << random.below(8)),
        5 => body.layout_size ^= 1 << random.below(8),
        6 => *bytes(body) = bytes(body)[..at.max(1)].into(),
        7 => body.tables = None,
        8..11 if body.tables.is_some() => damage_tables(random, tables(body)),
        11 | 12 => bytes(body)[at] ^= 1 << random.below(8),
        13 => bytes(body)[at] = bytes(body)[at].wrapping_add(random.pick(&[1, 0xff])),
        _ => bytes(body)[at] = random.next() as u8,
    }
}

struct Discard;

impl Write for Discard {
    fn write_str(&mut self, _: &str) -> core::fmt::Result {
        Ok(())
    }
}

fn use_verified(body: &Body, walk: &mut Walk) {
    let mut offset = 0;
    while (offset as usize) < body.instructions().len() {
        body.positions().find(offset);
        offset += Instruction::read(body.instructions(), offset).1;
    }
    for kind in MetadataKind::ALL {
        body.metadata().count(kind);
    }
    body.saved_words();
    if body.locals() > 1 << 16 {
        return;
    }
    let liveness = Liveness::new(body).unwrap();
    for block in liveness.graph().blocks() {
        liveness.walk_backwards(body, block, walk, |_, _, _| {});
    }
}

#[test]
fn damaged_code_is_refused_or_harmless() {
    let (mut assembler, mut walk) = (Assembler::default(), Walk::default());
    let mut whole = code(plain(|_| {}), 200);
    let (mut accepted, mut refused) = (0, 0);
    for seed in 0..300 {
        let limits = Limits {
            steps: 40,
            locals: if seed % 3 == 0 { 200 } else { 16 },
            entries: if seed % 3 == 0 { 200 } else { 20 },
            suspends: seed % 2 == 0,
        };
        let random = &mut Random::new(seed);
        limits.build(&mut assembler, random);
        let body = limits.finish(&mut assembler);
        set_body(&mut whole, copy(&body));
        for _ in 0..40 {
            let mut body = copy(&body);
            for _ in 0..=random.skewed_below(4) {
                damage(random, &mut body);
            }
            whole.body = body;
            write!(
                Discard,
                "{}",
                Dump::new(&whole, Text::EMPTY).with_positions()
            )
            .unwrap();
            if verify_form(&whole).is_ok() {
                use_verified(&whole.body, &mut walk);
                accepted += 1;
            } else {
                refused += 1;
            }
        }
    }
    assert!(accepted > 1000 && refused > 1000, "{accepted} {refused}");
}

#[test]
fn what_scopes_have() {
    use Opcode::*;
    let names = |count| ["a", "b", "c"].map(Identifier::from_literal)[..count].into();
    let outermost = StaticScope::of_names(ScopeKind::Block, None, names(1));
    let around = StaticScope::of_names(ScopeKind::Block, Some(outermost), names(2));
    let register = |index| local(index).word();
    let (scope, block, with, other) = (register(0), register(1), register(2), register(3));
    let cases: &[(Opcode, &[u32], bool)] = &[
        (GetScoped, &[other, scope, 1], true),
        (GetScoped, &[other, scope, 2], false),
        (GetScoped, &[other, block, 2], true),
        (GetScoped, &[other, block, 3], false),
        (GetScoped, &[other, with, 0], false),
        (GetScoped, &[other, other, 0], false),
        (GetScoped, &[other, Register::THIS.word(), 0], false),
        (PutScoped, &[scope, 1, other], true),
        (PutScoped, &[scope, 2, other], false),
        (GetOuter, &[other, scope, 1, 0], true),
        (GetOuter, &[other, scope, 1, 1], false),
        (GetOuter, &[other, scope, 2, 0], false),
        (GetOuter, &[other, block, 1, 0], false),
        (PutOuter, &[scope, 1, 1, other], false),
        (GetInternal, &[other, scope, 1, 1], false),
        (GetScopedChecked, &[other, scope, 1], true),
        (GetScopedChecked, &[other, scope, 2], false),
        (GetOuterChecked, &[other, scope, 1, 1], false),
        (GetImport, &[other, scope, 0, 0], false),
        (CreateScope, &[other, scope, BLOCK_SCOPE], true),
        (CreateScope, &[other, block, BLOCK_SCOPE], false),
        (CreateScope, &[Register::THIS.word(), scope, 0], false),
        (NewFunction, &[other, block, FUNCTION], true),
        (NewFunction, &[other, scope, FUNCTION], false),
        (NewClass, &[other, other, scope, CLASS, other, other], true),
        (NewClass, &[other, other, block, CLASS, other, other], false),
        (CopyScope, &[block], true),
        (CopyScope, &[with], false),
        (CreateScopedArguments, &[other, other], false),
        (ResolveDynamic, &[other, with, 0], true),
        (ResolveDynamic, &[other, other, 0], false),
        (PutHoisted, &[other, 0, other], false),
        (DirectEval, &[other, other, other, 0], false),
        (DynamicImport, &[other, other, other, other, 0], false),
    ];
    for &(opcode, words, is_valid) in cases {
        let body = plain(|a| {
            a.mov(local(3), Register::THIS);
            a.create_scope(local(1), local(0), ScopeIndex(BLOCK_SCOPE));
            a.create_with_scope(local(2), local(1), ScopeIndex(WITH_SCOPE), local(3));
            emit(a, opcode, words);
        });
        let mut code = code(body, ENTRIES);
        let block = StaticScope::of_names(ScopeKind::Block, Some(Rc::clone(&around)), names(3));
        let functions = Rc::get_mut(&mut code.functions).unwrap();
        functions[FUNCTION as usize].scope = Some(Rc::clone(&block));
        functions[CLASS as usize].scope = Some(Rc::clone(&around));
        code.scopes = [Rc::clone(&block), StaticScope::with(Some(block))].into();
        let fault = verify(&code, Some(&around)).err().map(|it| it.fault);
        assert_eq!(fault, (!is_valid).then_some(Fault::Scope), "{opcode:?}");
        assert_eq!(verify_form(&code), Ok(()));
    }
}

#[test]
fn what_only_a_constructor_does() {
    let mut body = plain(|a| a.create_this(Register::THIS, Register::THIS, 0));
    assert_eq!(fault(&code(copy(&body), 0)), None);
    body.kind = CodeKind::Call;
    assert_eq!(fault(&code(body, 0)), Some(Fault::Flags));
}

#[test]
fn an_index_is_no_name() {
    let accepts = |emit: &dyn Fn(&mut Assembler)| {
        let mut code = code(plain(emit), 1);
        code.identifiers = [Identifier::from_literal("0")].into();
        fault(&code).is_none()
    };
    let name = IdentifierIndex(0);
    assert!(!accepts(&|a| a.get_by_id(local(1), local(1), name)));
    assert!(accepts(&|a| {
        a.throw_if_nullish(local(1), StaticError::PropertyOfNullish, name);
    }));
}

#[test]
fn locals_are_written_first() {
    let fault = |body| verify(&code(body, ENTRIES), None).err().map(|it| it.fault);
    let this = Register::THIS;
    let on_one_way = |also_on_the_other| {
        plain(|a| {
            let skip = a.label();
            if also_on_the_other {
                a.mov(local(1), this);
            }
            a.jump_if_true(this, skip);
            a.mov(local(1), this);
            a.bind(skip);
        })
    };
    assert_eq!(fault(on_one_way(true)), None);
    assert_eq!(fault(on_one_way(false)), Some(Fault::Unwritten));

    let around_a_throw = |before| {
        suspending(|a| {
            let handler = a.label();
            a.create_generator(local(1));
            a.push_try(handler, HandlerKind::Catch);
            if before {
                a.mov(local(2), this);
            }
            a.to_number(local(3), this);
            a.mov(local(2), this);
            a.throw(this);
            a.pop_try();
            a.bind(handler);
            a.catch(local(3), local(4));
            let point = a.add_suspend_point(SuspendKind::Yield);
            a.suspend(local(1), local(4), SuspendKind::Yield, point);
            a.resume(local(1), point);
        })
    };
    assert_eq!(fault(around_a_throw(true)), None);
    assert_eq!(fault(around_a_throw(false)), Some(Fault::Unwritten));
}
