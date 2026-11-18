#![allow(clippy::disallowed_methods)]

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options as AssemblerOptions};
use bun_engine_codegen::ir::*;
use bun_engine_codegen::passes::Level;
use bun_engine_codegen::{CallSite, Client, Compiler, ExitSite, Frame, Options, PatchpointSite};
use bun_engine_exec_memory::{CodeHandle, Priority, link};

struct Plain;

impl Client<MacroAssembler> for Plain {
    fn prologue(&mut self, masm: &mut MacroAssembler, _: usize, frame: &Frame) {
        masm.enter_frame();
        masm.sub64(abi::STACK_POINTER, abi::STACK_POINTER, frame.size);
    }
    fn shared_exit(&mut self, _: &mut MacroAssembler, _: Token) -> Option<Label> {
        None
    }
    fn exit(&mut self, masm: &mut MacroAssembler, site: &ExitSite<'_>) {
        match site.state.iter().next().unwrap() {
            Location::Gpr(reg) => masm.move64(abi::RETURN_GPRS[0], reg),
            Location::Frame(offset) => masm.load64(
                abi::RETURN_GPRS[0],
                Address::new(abi::FRAME_POINTER, offset),
            ),
            _ => unreachable!(),
        }
        masm.leave_frame();
        masm.ret();
    }
    fn patchpoint(&mut self, _: &mut MacroAssembler, _: &PatchpointSite<'_>) {}
    fn after_call(&mut self, _: &mut MacroAssembler, _: &CallSite<'_>) {}
    fn out_of_line(&mut self, _: &mut MacroAssembler) {}
}

fn compile(function: &mut Function, level: Level) -> CodeHandle {
    let mut masm = MacroAssembler::new(AssemblerOptions {
        features: Features::host(),
        shorten_jumps: true,
        seed: 0,
    });
    Compiler::default()
        .compile(
            function,
            Options {
                level,
                records_origins: false,
            },
            &mut masm,
            &mut Plain,
        )
        .unwrap();
    let code = masm.finish().unwrap();
    if let Ok(path) = std::env::var("CODE_DUMP") {
        std::fs::write(path, code.bytes()).unwrap();
    }
    link(&code, Priority::Required, |_| unreachable!()).unwrap()
}

fn argument(index: usize) -> (Type, Boundary) {
    (
        Type::I64,
        Boundary::Register(abi::ARGUMENT_GPRS[index].into()),
    )
}

#[test]
fn sums_an_array() {
    for level in [Level::Quick, Level::Full] {
        let mut function = Function::new(abi::CALLEE_SAVED);
        function.set_results(&[Boundary::Register(abi::RETURN_GPRS[0].into())]);
        let entry = function.add_entry(&[argument(0), argument(1)]);
        let [array, length] = [0, 1].map(|index| function.params(entry)[index]);
        let (body, done) = (function.new_block(), function.new_block());
        let (index, sum) = (
            function.add_param(body, Type::I32),
            function.add_param(body, Type::I32),
        );
        let mut b = Builder::at_end(&mut function, entry);
        let zero = b.const32(0);
        b.jump(body, &[zero, zero]);
        b.switch_to(body);
        let wide = b.zero_extend(index);
        let scaled = b.shl(wide, 2);
        let address = b.add(array, scaled);
        let element = b.load(Type::I32, address, 0, Heap::EVERYTHING);
        let old = b.zero_extend(sum);
        let state = b.add_state(&[old]);
        let next_sum = b.checked(
            Checked::Add,
            sum,
            element,
            Exit {
                token: Token(0),
                state,
            },
        );
        let next = b.add(index, 1);
        let limit = b.wrap(length);
        let more = b.less_than(next, limit);
        b.branch(more, Successor::new(body, &[next, next_sum]), done);
        b.switch_to(done);
        let result = b.zero_extend(next_sum);
        b.ret(&[result]);
        let code = compile(&mut function, level);
        // SAFETY: the function has this type.
        let sum = unsafe {
            std::mem::transmute::<usize, extern "C" fn(*const i32, u64) -> u64>(code.start())
        };
        assert_eq!(sum([1, 2, 3, 4].as_ptr(), 4), 10);
        assert_eq!(sum([1, 2, i32::MAX, 4].as_ptr(), 4), 3);
    }
}

#[test]
fn a_later_exit_finds_the_operand_of_a_checked_addition() {
    for level in [Level::Quick, Level::Full] {
        let mut function = Function::new(abi::CALLEE_SAVED);
        function.set_results(&[Boundary::Register(abi::RETURN_GPRS[0].into())]);
        let entry = function.add_entry(&[argument(0), argument(1)]);
        let [stop, length] = [0, 1].map(|index| function.params(entry)[index]);
        let [head, rest, done] = [(); 3].map(|()| function.new_block());
        let [index, previous] = [(); 2].map(|()| function.add_param(head, Type::I32));
        let result = function.add_param(done, Type::I64);
        let mut b = Builder::at_end(&mut function, entry);
        let (zero, stop, length) = (b.const32(0), b.wrap(stop), b.wrap(length));
        b.jump(head, &[zero, zero]);
        b.switch_to(head);
        let [behind, here] = [previous, index].map(|it| {
            let wide = b.zero_extend(it);
            b.or(wide, 1 << 20)
        });
        let is_negative = b.less_than(stop, 0);
        b.branch(is_negative, Successor::new(done, &[behind]), rest);
        b.switch_to(rest);
        let exit = Exit {
            token: Token(0),
            state: b.add_state(&[index]),
        };
        let next = b.checked(Checked::Add, index, 1, exit);
        let is_there = b.equal(next, stop);
        b.check(is_there, exit);
        let more = b.less_than(next, length);
        let (again, out) = ([next, index], [here]);
        b.branch(
            more,
            Successor::new(head, &again),
            Successor::new(done, &out),
        );
        b.switch_to(done);
        b.ret(&[result]);
        let code = compile(&mut function, level);
        // SAFETY: the function has this type.
        let run =
            unsafe { std::mem::transmute::<usize, extern "C" fn(u64, u64) -> u32>(code.start()) };
        assert_eq!(run(5, 9), 4);
        assert_eq!(run(50, 9), 1 << 20 | 8);
    }
}
