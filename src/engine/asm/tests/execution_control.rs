mod machine;
mod support;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, RegOrMem, Scratch, Target};
use bun_engine_exec_memory::{
    CodeHandle, Priority, link, replace_with_jump, set_move_value, set_transfer_target,
    transfer_target,
};
use machine::operands::SP;
use machine::values::Random;
use machine::{Case, Harness, Machine, Operation, Registers, host, install};

const FP: Gpr = abi::FRAME_POINTER;

fn linked(emit: impl FnOnce(&mut MacroAssembler)) -> CodeHandle {
    let mut masm = Harness::assembler(Features::empty(), false, 0);
    emit(&mut masm);
    install(&masm.finish().unwrap())
}

fn put(m: &mut Machine, place: RegOrMem, value: usize) {
    match place {
        RegOrMem::Reg(reg) => m.set64(reg, value as u64),
        RegOrMem::Mem(memory) => m.store(Size::S64, memory, value as u64),
    }
}

#[test]
fn jumps() {
    let mut h = Harness::new();
    for _ in 0..8 {
        let jump = Operation::custom("jump".into(), |masm, target| masm.jump(target));
        h.add(Case::new(jump, |_| true));
    }
    let exit = linked(|masm| host::exit(masm.assembler()));
    let address = exit.start();
    let jump = Operation::custom("jump_address".into(), move |masm, _| {
        masm.jump_address(address)
    });
    h.add(Case::new(jump, |_| true));
    for _ in 0..4 {
        for ([], place) in h.registers_or_memories() {
            let jump = Operation::custom(format!("jump_indirect({place:x?})"), move |masm, _| {
                masm.jump_indirect(place)
            });
            let case = Case::new(jump.naming(place), |_| true).reads(Size::S64, place);
            h.add(case.given(move |m, _| {
                put(m, place, address);
                true
            }));
        }
    }
    drop(h);
}

#[test]
fn calls_return() {
    let mut h = Harness::new();
    let counter = abi::SAVED_GPRS[0];
    h.operand_registers.remove(counter);
    let callee = linked(|masm| {
        masm.add64(counter, counter, 1);
        masm.ret();
    });
    let address = callee.start();
    let called = move |m: &mut Machine| m.set64(counter, m.get64(counter).wrapping_add(1));
    let add = |h: &mut Harness, case: Case| h.add(case.overwrites_free_stack());
    let call = Operation::custom("call_address".into(), move |masm, _| {
        masm.call_address(address)
    });
    add(&mut h, Case::new(call, called));
    for is_patchable in [false, true] {
        let call = Operation::custom("call".into(), move |masm, _| {
            let (callee, done) = (masm.new_label(), masm.new_label());
            if is_patchable {
                masm.patchable_call(callee);
            } else {
                masm.call(callee);
            }
            masm.jump(done);
            masm.bind(callee);
            masm.add64(counter, counter, 1);
            masm.ret();
            masm.bind(done);
        });
        add(&mut h, Case::new(call, called));
    }
    for ([], place) in h.registers_or_memories() {
        if matches!(place, RegOrMem::Mem(bun_engine_asm::Memory::Address(at)) if at.uses(SP) && at.offset() < 64)
        {
            continue;
        }
        let call = Operation::custom(format!("call_indirect({place:x?})"), move |masm, _| {
            masm.call_indirect(place)
        });
        let case = Case::new(call.naming(place), called).reads(Size::S64, place);
        let case = case.given(move |m, _| {
            put(m, place, address);
            true
        });
        add(&mut h, case);
    }
    drop(h);
}

#[test]
fn a_frame_holds_the_frame_of_the_caller_and_the_return_address() {
    let mut h = Harness::new();
    h.operand_registers.remove(FP);
    for room in [0, 16, 4096, 0x12_3450] {
        for [frame, saved, distance] in h.gprs() {
            if frame == saved || frame == distance || saved == distance {
                continue;
            }
            let call = Operation::custom(format!("frame of {room}"), move |masm, _| {
                let (callee, done) = (masm.new_label(), masm.new_label());
                masm.sub64(SP, SP, host::STACK_MISALIGNMENT);
                masm.call(callee);
                let back = masm.here();
                masm.add64(SP, SP, host::STACK_MISALIGNMENT);
                masm.jump(done);
                masm.bind(callee);
                masm.enter_frame();
                masm.sub64(SP, SP, room);
                masm.move64(frame, FP);
                masm.load64(saved, Address::new(FP, 0));
                masm.move_label_address(distance, back);
                masm.sub64(distance, distance, Address::new(FP, 8));
                masm.leave_frame();
                masm.ret();
                masm.bind(done);
            });
            let case = Case::new(call, move |m| {
                m.set64(frame, m.get64(SP) - host::STACK_MISALIGNMENT as u64 - 16);
                m.set64(saved, m.get64(FP));
                m.set64(distance, 0);
            });
            h.add(case.overwrites_free_stack());
        }
    }
}

#[test]
fn jump_tables() {
    let mut h = Harness::new();
    for round in 0..120 {
        let (count, [index, result]) = (1 + round % 12, h.gprs()[round / 12 % 2]);
        let jump = Operation::custom(format!("jump_table({index:?}, {count})"), move |masm, _| {
            let (start, done) = (masm.new_label(), masm.new_label());
            let targets: Vec<Label> = (0..count).map(|_| masm.new_label()).collect();
            masm.jump(start);
            for (number, &target) in targets.iter().enumerate() {
                if number == count / 2 {
                    masm.bind(start);
                    masm.jump_table(index, &targets);
                }
                masm.bind(target);
                masm.move64(result, number);
                masm.jump(done);
            }
            masm.bind(done);
        });
        let case = Case::new(jump.naming([index, result]), move |m| {
            m.set64(result, m.get64(index));
            if index != result {
                m.forget(index);
            }
        });
        h.add(case.given(move |m, random| {
            m.set64(index, random.below(count) as u64);
            true
        }));
    }
}

#[test]
fn addresses_of_labels_and_patchable_moves() {
    let mut h = Harness::new();
    for _ in 0..40 {
        let (reg, value) = (h.any_gpr(), h.random.next());
        let jump = Operation::custom(
            format!("move_label_address({reg:?})"),
            move |masm, target| {
                let there = masm.new_label();
                masm.move_label_address(reg, there);
                masm.jump_indirect(reg);
                masm.breakpoint();
                masm.bind(there);
                masm.jump(target);
            },
        );
        h.add(Case::new(jump, move |m| {
            m.forget(reg);
            true
        }));
        let name = format!("patchable_move64({reg:?}, {value:x})");
        let patchable =
            Operation::custom(name, move |masm, _| _ = masm.patchable_move64(reg, value));
        h.add(Case::new(patchable, move |m| m.set64(reg, value)).keeps_first_scratch());
    }
}

fn registers(h: &Harness) -> Registers {
    let mut registers = Registers {
        fprs: [0; 32],
        gprs: [0; 32],
        host_stack: 0,
    };
    registers.gprs[usize::from(SP.number())] = h.stack_pointer() as u64;
    registers
}

#[test]
fn what_is_patched_after_a_replaceable_point_leaves_its_jump_alone() {
    let mut h = Harness::new();
    let result = abi::RETURN_GPRS[0];
    let giving = |value: i32| {
        linked(|masm| {
            masm.move32(result, value);
            host::exit(masm.assembler());
        })
    };
    let (one, two, three) = (giving(1), giving(2), giving(3));
    for shorten_jumps in [false, true] {
        for before in 0..8 {
            let mut masm = Harness::assembler(Features::host(), shorten_jumps, 0);
            (0..before).for_each(|_| masm.nop());
            let first_point = masm.replaceable_point();
            let value = masm.patchable_move64(result, 7);
            host::exit(masm.assembler());
            let second_entry = masm.here();
            let second_point = masm.replaceable_point();
            let symbol = masm.external(Target::Symbol(0));
            let jump = masm.patchable_jump(symbol);
            let code = masm.finish().unwrap();
            let handle = link(&code, Priority::Required, |_| one.start()).unwrap();
            let at = |label| handle.address(code.offset_of(label));
            let mut run = |entry| {
                let mut registers = registers(&h);
                h.execute(entry, &mut registers);
                registers.gprs[usize::from(result.number())]
            };
            assert_eq!((run(handle.start()), run(at(second_entry))), (7, 1));
            // SAFETY: the labels are of the kinds these take, and only this thread runs the code.
            unsafe {
                replace_with_jump(at(first_point), two.start()).unwrap();
                replace_with_jump(at(second_point), two.start()).unwrap();
                set_move_value(at(value), u64::MAX);
                set_transfer_target(at(jump), three.start()).unwrap();
                assert_eq!(transfer_target(at(jump)), three.start());
            }
            assert_eq!((run(handle.start()), run(at(second_entry))), (2, 2));
        }
    }
}

#[test]
fn the_assembler_tells_its_state() {
    for features in machine::feature_sets() {
        let mut masm = Harness::assembler(features, false, 0);
        assert_eq!((masm.features(), masm.size()), (features, 0));
        let (usual, none) = (
            masm.scratch(),
            Scratch {
                gprs: [None; 2],
                fprs: [None; 2],
            },
        );
        assert_eq!((masm.set_scratch(none), masm.scratch()), (usual, none));
        masm.reserve(10_000);
        assert_eq!(masm.size(), 0);
        for _ in 0..5000 {
            masm.add64(abi::RETURN_GPRS[0], abi::RETURN_GPRS[0], 1);
        }
        assert_eq!(masm.size(), 20_000);
        assert_eq!(masm.finish().unwrap().bytes().len(), 20_000);
    }
}

#[derive(Clone)]
enum Ending {
    FallsThrough,
    Jump(usize),
    JumpToAddress(usize),
    PatchableJump(usize),
    IfBitIsSet(u8, usize),
    IfLowBitsAreClear(usize),
    IfBelow(u32, usize),
    IfFloatIsNotEqual(usize),
    Table([usize; 4]),
}

#[derive(Clone)]
struct Block {
    filling: usize,
    alignment: Option<(u32, u32)>,
    is_replaceable: bool,
    constant: u64,
    calls: bool,
    ending: Ending,
}

const MULTIPLIER: u64 = 6_364_136_223_846_793_005;
const STEPS: u64 = 300;

fn random_blocks(random: &mut Random, gaps: &[usize]) -> Vec<Block> {
    let count = 2 + random.below(40);
    let blocks = (0..count).map(|index| {
        let (to, rarity) = (random.below(count), random.next().trailing_zeros() as usize);
        let endings = [
            Ending::Jump(to),
            Ending::JumpToAddress(to),
            Ending::PatchableJump(to),
            Ending::Table([(); 4].map(|()| random.below(count))),
            Ending::FallsThrough,
            Ending::IfBitIsSet(32 + random.below(32) as u8, to),
            Ending::IfLowBitsAreClear(to),
            Ending::IfBelow(random.next() as u32, to),
            Ending::IfFloatIsNotEqual(to),
        ];
        let choices = if index + 1 == count { 4 } else { endings.len() };
        Block {
            filling: gaps[rarity.min(gaps.len() - 1)].saturating_sub(random.below(24)),
            alignment: (random.below(4) == 0)
                .then(|| (1 << random.below(7), random.pick(&[3, 15, 63]))),
            is_replaceable: random.below(5) == 0,
            constant: random.next(),
            calls: random.below(5) == 0,
            ending: endings[random.below(choices)].clone(),
        }
    });
    blocks.collect()
}

fn interpret(blocks: &[Block], mut state: u64) -> u64 {
    let mut index = 0;
    for _ in 0..STEPS {
        let block = &blocks[index];
        state = state.wrapping_mul(MULTIPLIER).wrapping_add(block.constant);
        state ^= u64::from(block.calls);
        let choose = |taken: bool, to: usize| if taken { to } else { index + 1 };
        index = match block.ending {
            Ending::FallsThrough => index + 1,
            Ending::Jump(to) | Ending::JumpToAddress(to) | Ending::PatchableJump(to) => to,
            Ending::IfBitIsSet(bit, to) => choose(state >> bit & 1 != 0, to),
            Ending::IfLowBitsAreClear(to) => choose(state >> 40 & 1 == 0, to),
            Ending::IfBelow(limit, to) => choose((state as u32) < limit, to),
            Ending::IfFloatIsNotEqual(to) => choose(state >> 62 != 0, to),
            Ending::Table(targets) => targets[(state >> 62) as usize],
        };
    }
    state
}

fn assemble(blocks: &[Block], masm: &mut MacroAssembler, exit: usize) {
    let [state, steps, temp] = *abi::TEMPORARY_GPRS.first_chunk().unwrap();
    let float = abi::ARGUMENT_FPRS[0];
    let labels: Vec<Label> = blocks.iter().map(|_| masm.new_label()).collect();
    let (callee, exit) = (masm.new_label(), masm.external_address(exit));
    let places: Vec<Label> = blocks.iter().map(|_| masm.new_label()).collect();
    let exits = [exit, masm.new_label()];
    masm.move32(steps, STEPS + 1);
    for (index, block) in blocks.iter().enumerate() {
        if let Some((alignment, most)) = block.alignment {
            masm.align(alignment, most);
        }
        if block.is_replaceable {
            masm.replaceable_point();
        }
        match index % 3 {
            0 => masm.bind(labels[index]),
            1 => {
                masm.alias(labels[index], places[index]);
                masm.bind(places[index]);
            }
            _ => masm.bind(places[index]),
        }
        masm.branch_sub32(ResultCond::Zero, steps, steps, 1, exits[index % 2]);
        masm.move_float_constant(FloatWidth::F64, float, block.constant);
        masm.move_f64_to_bits(temp, float);
        masm.mul64(state, state, MULTIPLIER);
        masm.add64(state, state, temp);
        if block.calls {
            masm.call(callee);
        }
        let after = masm.new_label();
        masm.jump(after);
        let end = masm.size() + block.filling;
        while masm.size() < end {
            masm.breakpoint();
        }
        masm.bind(after);
        match block.ending {
            Ending::FallsThrough => {}
            Ending::Jump(to) => masm.jump(labels[to]),
            Ending::PatchableJump(to) => _ = masm.patchable_jump(labels[to]),
            Ending::JumpToAddress(to) => {
                masm.move_label_address(temp, labels[to]);
                masm.jump_indirect(temp);
            }
            Ending::IfBitIsSet(bit, to) => {
                masm.branch_test_bit64(TestCond::NonZero, state, bit, labels[to])
            }
            Ending::IfLowBitsAreClear(to) => {
                masm.extract_bits(Sign::Unsigned, Width::W64, temp, state, 40, 1);
                masm.branch_if_zero32(temp, labels[to]);
            }
            Ending::IfBelow(limit, to) => masm.branch32(Cond::Below, state, limit, labels[to]),
            Ending::IfFloatIsNotEqual(to) => {
                masm.shr64(temp, state, 62);
                masm.convert_i32_to_f64(float, temp);
                masm.branch_f64_with_zero(FloatCond::Ne, float, labels[to]);
            }
            Ending::Table(targets) => {
                masm.shr64(temp, state, 62);
                masm.jump_table(temp, &targets.map(|to| labels[to]));
            }
        }
    }
    masm.bind(callee);
    masm.xor64(state, state, 1);
    masm.ret();
    for index in (2..blocks.len()).step_by(3) {
        masm.alias(labels[index], places[index]);
    }
    masm.alias(exits[1], exit);
}

fn random_programs(count: usize, gaps: &[usize]) {
    let mut h = Harness::new();
    let exit = linked(|masm| host::exit(masm.assembler()));
    let state = usize::from(abi::TEMPORARY_GPRS[0].number());
    for round in 0..machine::scaled_runs(count) {
        let blocks = random_blocks(&mut h.random, gaps);
        let mut masm = Harness::assembler(Features::host(), round % 2 == 0, 0);
        assemble(&blocks, &mut masm, exit.start());
        let code = install(&masm.finish().unwrap());
        for _ in 0..8 {
            let (mut registers, first) = (registers(&h), h.random.next());
            registers.gprs[state] = first;
            h.execute(code.start(), &mut registers);
            assert_eq!(registers.gprs[state], interpret(&blocks, first));
        }
    }
}

#[test]
fn small_random_programs() {
    random_programs(400, &[0, 32, 96, 160]);
}

#[test]
fn medium_random_programs() {
    random_programs(60, &[0, 64, 4 << 10, 16 << 10, 32 << 10]);
}

#[test]
fn large_random_programs() {
    random_programs(6, &[0, 64, 32 << 10, 256 << 10, 1 << 20]);
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
mod traps {
    use super::*;

    extern "C" fn exit_with_scratch_register(_: i32, _: *mut libc::siginfo_t, context: *mut u8) {
        // SAFETY: the system passes a context, and the process may end at any time.
        unsafe {
            let machine = &(*context.cast::<libc::ucontext_t>()).uc_mcontext;
            #[cfg(target_arch = "x86_64")]
            let value = machine.gregs[libc::REG_R11 as usize];
            #[cfg(target_arch = "aarch64")]
            let value = machine.regs[16];
            libc::_exit((value >> 8) as i32 - (value & 0xff) as i32);
        }
    }

    /// The exit code of a child process that runs the code.
    fn trap(emit: impl FnOnce(&mut MacroAssembler)) -> i32 {
        let mut h = Harness::new();
        let (code, mut registers) = (linked(emit), registers(&h));
        // SAFETY: the child makes only calls that are allowed in a signal handler.
        unsafe {
            let child = libc::fork();
            if child == 0 {
                let mut action = std::mem::MaybeUninit::<libc::sigaction>::zeroed().assume_init();
                action.sa_sigaction = exit_with_scratch_register as *const () as usize;
                action.sa_flags = libc::SA_SIGINFO;
                libc::sigaction(libc::SIGTRAP, &raw const action, std::ptr::null_mut());
                h.execute(code.start(), &mut registers);
                libc::_exit(255);
            }
            let mut status = 0;
            assert_eq!(libc::waitpid(child, &raw mut status, 0), child);
            assert!(libc::WIFEXITED(status));
            libc::WEXITSTATUS(status)
        }
    }

    #[test]
    fn breakpoint_and_abort_raise_a_signal() {
        assert_eq!(trap(|masm| masm.breakpoint()), 0);
        assert_eq!(trap(|masm| masm.abort(0xf012)), 0xf0 - 0x12);
    }
}
