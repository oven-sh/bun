//! Code that all optimized code of the process shares.

#![forbid(unsafe_code)]

mod varargs_frame;

use std::sync::OnceLock;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options};
use bun_engine_bytecode::Specialization;
use bun_engine_exec_memory::{CodeHandle, NativeFrames, Priority, link};
use bun_engine_interpreter::replace_frame;
use bun_engine_vm::{CallFrame, Vm, call};

use super::exits::{self, Saved};
use super::registers::*;
use super::{operations, probes, search, tiering, varargs};

pub(crate) struct Thunks {
    /// Comes back, with all registers as they were, only if there is no better code to go on in.
    pub(crate) exit: usize,
    pub(crate) catch: usize,
    /// By specialization. For a callee that has no executable.
    pub(crate) find_target: [usize; 2],
    /// To jump to. Goes on at the continuation, with all in place for the call instruction.
    pub(crate) fill_varargs_frame: usize,
    pub(crate) tail_call_varargs: usize,
    /// These replace the word at the stack pointer with their result, and keep all registers.
    pub(crate) allocate: usize,
    pub(crate) remember: usize,
    pub(crate) to_int32: usize,
    pub(crate) tier_up: usize,
    /// The same, given the words of a `Searched`.
    pub(crate) search_and_load: usize,
    pub(crate) search_for_store: usize,
    /// Keeps all registers and leaves the words at the stack pointer, which it is given, alone.
    pub(crate) probe: usize,
    _code: CodeHandle,
}

struct Emitter {
    m: MacroAssembler,
    frames: NativeFrames,
}

const ARGUMENTS: &[Gpr] = &abi::ARGUMENT_GPRS;
const RESULTS: [Gpr; 2] = abi::RETURN_GPRS;
const OPERANDS: Gpr = abi::SAVED_GPRS[0];
const TOP_CALL_FRAME: Address = at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME);
const LINKAGE: RegisterSet = RegisterSet::of(&[SP, FP], &[]);

fn for_each_saved(m: &mut MacroAssembler, registers: RegisterSet, is_saving: bool) {
    for gpr in registers.gprs() {
        let place = at(SP, Saved::offset_of_gpr(gpr.number()));
        if is_saving {
            m.store64(place, gpr);
        } else {
            m.load64(gpr, place);
        }
    }
    for fpr in registers.fprs() {
        let place = at(SP, Saved::offset_of_fpr(fpr.number()));
        if is_saving {
            m.store_f64(place, fpr);
        } else {
            m.load_f64(fpr, place);
        }
    }
}

impl Emitter {
    fn routine(&mut self, emit: impl FnOnce(&mut Self)) -> Label {
        self.m.align(16, 15);
        let start = self.m.here();
        emit(self);
        start
    }

    fn save(&mut self, registers: RegisterSet) {
        self.frames.enter(&mut self.m);
        (self.m).compute_address(SP, Address::new(SP, -(size_of::<Saved>() as i32)));
        for_each_saved(&mut self.m, registers, true);
    }

    fn restore_and_return(&mut self, registers: RegisterSet) {
        for_each_saved(&mut self.m, registers, false);
        self.frames.leave(&mut self.m);
        self.m.ret();
    }

    fn throw_if_zero(&mut self) {
        let throw = self.m.external_address(call::throw_from_frame());
        self.m.branch_if_zero64(RESULTS[0], throw);
    }

    fn exit(&mut self) {
        let (registers, go) = (abi::ALL - LINKAGE, self.m.new_label());
        self.save(registers);
        (self.m).move_arguments(&[VM.into(), SP.into(), FP.into()]);
        self.m.call_address(exits::leave as *const () as usize);
        self.m.branch_if_not_zero64(RESULTS[1], go);
        self.restore_and_return(registers);
        self.m.bind(go);
        self.m.move64(FP, RESULTS[0]);
        self.m.jump_indirect(RESULTS[1]);
    }

    /// The stack pointer is where the exception was thrown.
    fn catch(&mut self) {
        self.m.move64(ARGUMENTS[0], FP);
        (self.m).call_address(exits::end_of_frame as *const () as usize);
        self.m.move64(SP, RESULTS[0]);
        self.m.move64(ARGUMENTS[0], FP);
        (self.m).call_address(exits::leave_to_unwind as *const () as usize);
        self.m.move64(FP, RESULTS[0]);
        self.m.jump_address(call::throw_from_frame());
    }

    fn find_target(&mut self, specialization: Specialization) {
        self.m.store64(TOP_CALL_FRAME, FP);
        // This frame is where that of the callee is going to be.
        self.frames.enter(&mut self.m);
        (self.m).move_arguments(&[VM.into(), FP.into(), (specialization as i32).into()]);
        (self.m).call_address(operations::find_target as *const () as usize);
        self.frames.leave(&mut self.m);
        self.throw_if_zero();
        self.m.move64(EXECUTABLE, RESULTS[1]);
        self.m.move64(ENTRY, RESULTS[0]);
        self.m.ret();
    }

    /// Leaves the stack pointer at the start of the new frame, and the target in the registers for results.
    fn fill_varargs_frame(&mut self) {
        let (operands, slow, done) = (OPERANDS, self.m.new_label(), self.m.new_label());
        self.m.move64(operands, SP);
        self.fill_usual_varargs_frame(slow);
        self.m.jump(done);
        self.m.bind(slow);
        self.m.store64(TOP_CALL_FRAME, FP);
        self.m.push_pair(FORM, FORM);
        (self.m).move_arguments(&[VM.into(), FP.into(), operands.into(), FORM.into()]);
        self.m.call_address(varargs::size as *const () as usize);
        self.throw_if_zero();
        self.m.load64(FORM, at(SP, 0));
        self.m.move64(SP, RESULTS[0]);
        let arguments = [VM, FP, operands, FORM, RESULTS[0]];
        self.m.move_arguments(&arguments.map(Argument::from));
        self.m.call_address(varargs::fill as *const () as usize);
        self.throw_if_zero();
        self.m.bind(done);
    }

    fn prepare_call_varargs(&mut self) {
        self.fill_varargs_frame();
        self.m.move64(EXECUTABLE, RESULTS[1]);
        self.m.move64(ENTRY, RESULTS[0]);
        self.m.compute_address(SP, at(SP, CallFrame::LINKAGE_SIZE));
        self.m.jump_indirect(CONTINUATION);
    }

    fn tail_call_varargs(&mut self) {
        let (entry, executable) = (abi::SAVED_GPRS[0], abi::SAVED_GPRS[1]);
        self.fill_varargs_frame();
        self.m.move64(entry, RESULTS[0]);
        self.m.move64(executable, RESULTS[1]);
        self.m.move_arguments(&[FP.into(), SP.into()]);
        self.m.call_address(replace_frame as *const () as usize);
        self.m.move64(FP, RESULTS[0]);
        self.m.leave_frame();
        self.m.move64(EXECUTABLE, executable);
        self.m.jump_indirect(entry);
    }

    fn probe(&mut self) {
        let registers = abi::CALLER_SAVED - LINKAGE;
        self.save(registers);
        self.m.move64(ARGUMENTS[0], VM);
        (self.m).compute_address(ARGUMENTS[1], at(FP, CallFrame::LINKAGE_SIZE));
        (self.m).load64(ARGUMENTS[2], at(FP, CallFrame::OFFSET_OF_CALLER));
        self.m.call_address(probes::probe as *const () as usize);
        self.restore_and_return(registers);
    }

    /// Calls a function of the `Vm`, the word and the frame.
    fn keeping(&mut self, function: *const (), may_collect: bool) {
        self.keeping_with(function, may_collect, |m, word| {
            m.load64(ARGUMENTS[1], word);
        });
    }

    /// With the address of the word in its place.
    fn searching(&mut self, function: *const (), may_collect: bool) {
        self.keeping_with(function, may_collect, |m, word| {
            m.compute_address(ARGUMENTS[1], word);
        });
    }

    fn keeping_with(
        &mut self,
        function: *const (),
        may_collect: bool,
        pass: impl FnOnce(&mut MacroAssembler, Address),
    ) {
        let (registers, word) = (abi::CALLER_SAVED - LINKAGE, at(FP, CallFrame::LINKAGE_SIZE));
        self.save(registers);
        let m = &mut self.m;
        m.move64(ARGUMENTS[0], VM);
        pass(m, word);
        m.load64(ARGUMENTS[2], at(FP, CallFrame::OFFSET_OF_CALLER));
        if may_collect {
            m.store64(TOP_CALL_FRAME, ARGUMENTS[2]);
            m.store32(at(ARGUMENTS[2], CallFrame::OFFSET_OF_CALL_SITE), 0);
        }
        m.call_address(function as usize);
        m.store64(word, RESULTS[0]);
        self.restore_and_return(registers);
    }
}

fn generate() -> Option<Thunks> {
    let mut e = Emitter {
        m: MacroAssembler::new(Options {
            features: Features::host(),
            shorten_jumps: true,
            seed: 0,
        }),
        frames: NativeFrames::default(),
    };
    let (exit, catch) = (e.routine(Emitter::exit), e.routine(Emitter::catch));
    let find_target = [Specialization::Call, Specialization::Construct]
        .map(|specialization| e.routine(|e| e.find_target(specialization)));
    let fill_varargs_frame = e.routine(Emitter::prepare_call_varargs);
    let tail_call_varargs = e.routine(Emitter::tail_call_varargs);
    let allocate = e.routine(|e| e.keeping(operations::allocate as *const (), true));
    let remember = e.routine(|e| e.keeping(operations::remember as *const (), false));
    let to_int32 = e.routine(|e| e.keeping(operations::to_int32 as *const (), false));
    let tier_up = e.routine(|e| e.keeping(tiering::optimize_fully as *const (), true));
    let search_and_load = e.routine(|e| e.searching(search::load as *const (), false));
    let search_for_store = e.routine(|e| e.searching(search::store as *const (), true));
    let probe = e.routine(Emitter::probe);
    let code = e.m.finish().ok()?;
    let handle = link(&code, Priority::Required, |_| 0).ok()?;
    handle.set_routines(&code, &e.frames);
    handle.describe(|| "optimizer thunks".into());
    let address = |label| handle.address(code.offset_of(label));
    Some(Thunks {
        exit: address(exit),
        catch: address(catch),
        find_target: find_target.map(address),
        fill_varargs_frame: address(fill_varargs_frame),
        tail_call_varargs: address(tail_call_varargs),
        allocate: address(allocate),
        remember: address(remember),
        to_int32: address(to_int32),
        tier_up: address(tier_up),
        search_and_load: address(search_and_load),
        search_for_store: address(search_for_store),
        probe: address(probe),
        _code: handle,
    })
}

impl Thunks {
    /// None if there is no memory to run code from.
    pub(crate) fn get() -> Option<&'static Thunks> {
        static THUNKS: OnceLock<Option<Thunks>> = OnceLock::new();
        THUNKS.get_or_init(generate).as_ref()
    }
}
