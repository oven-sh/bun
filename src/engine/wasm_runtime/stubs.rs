//! Machine code between compiled functions, the run time and the host.

use core::ops::{Deref, DerefMut};

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Features, Options, Reg, Scratch};
use bun_engine_exec_memory::{CodeHandle, NativeFrames, OutOfExecutableMemory, Priority, link};
use bun_engine_wasm_compiler::abi::{
    ARGUMENT_FPRS, ARGUMENT_GPRS, CallProfile, Callable, ENTRY_CALLEE, FunctionSlot, HostLayout,
    INSTANCE, Import, InstanceLayout, MEMORY_BASE, NULL, PROFILE, RESULT_FPRS, RESULT_GPRS, SLOT,
    STUB_CALLEE, Stubs, Trap, frame,
};

use crate::call::{self, EntryFrame, ExitFrame, Registers};
use crate::code::{self, Callees};
use crate::frames::{self, Resumption};
use crate::instance::Instance;
use crate::interrupts;
use crate::operations::{self, Conduct};
use crate::outcome::Failure;

const FP: Gpr = abi::FRAME_POINTER;
const SP: Gpr = abi::STACK_POINTER;
const ARGUMENT: [Gpr; 4] = *abi::ARGUMENT_GPRS.first_chunk().unwrap();
const RESULT: Gpr = abi::RETURN_GPRS[0];
const FAILURE: Gpr = abi::RETURN_GPRS[1];
/// Neither an argument, nor a result, nor [`SLOT`].
const TEMP: Gpr = abi::NON_ARGUMENT_GPRS[1];
const HEADER_SIZE: i32 = frame::ARGUMENTS - frame::INSTANCE;

#[cfg(target_arch = "x86_64")]
const NOT_KEPT: RegisterSet = RegisterSet::EMPTY;
#[cfg(target_arch = "aarch64")]
const NOT_KEPT: RegisterSet =
    RegisterSet::of(&[abi::SCRATCH_GPRS[0], bun_engine_asm::arm64::LR], &[]);
/// What a stub saves so as to keep all registers.
const CHANGED_BY_CALLS: RegisterSet = abi::CALLER_SAVED
    .union(abi::CALLEE_SAVED_LOW_HALF)
    .difference(NOT_KEPT);

pub(crate) struct StubCode {
    _code: CodeHandle,
    pub(crate) for_compilers: Stubs,
    pub(crate) enter: usize,
    pub(crate) end_of_enter: usize,
    pub(crate) leave_entry: usize,
    pub(crate) host_call: usize,
    pub(crate) end_of_host_call: usize,
    pub(crate) native_call: usize,
    pub(crate) compile_lazily: usize,
    pub(crate) resume: usize,
    /// Takes a [`Failure`] in the second argument register and the return address in the third.
    pub(crate) trap: usize,
}

impl StubCode {
    pub(crate) fn new(host: &HostLayout, cpu: Features) -> Result<Self, OutOfExecutableMemory> {
        let mut masm = MacroAssembler::new(Options {
            features: cpu,
            shorten_jumps: true,
            seed: 0,
        });
        let [trap, fail_in_bare_frame, fail] = [(); 3].map(|()| masm.new_label());
        let exits = Exits {
            trap,
            fail_in_bare_frame,
            fail,
        };
        let mut writer = Writer {
            masm,
            host,
            exits,
            bare_frames: NativeFrames::default(),
        };
        let operations = operations::ALL.map(|(conduct, code)| writer.operation(conduct, code));
        let traps: [_; Trap::COUNT] = core::array::from_fn(|index| writer.trap(Trap::ALL[index]));
        writer.raise();
        let resume = writer.resume();
        let (enter, end_of_enter) = writer.enter();
        let leave_entry = writer.leave_entry();
        let (host_call, end_of_host_call) = writer.host_call();
        let native_call = writer.native_call();
        let compile_lazily = writer.compile_lazily();
        let check_entry = writer.check_entry();
        let poll = writer.poll();
        let write_barrier = writer.write_barrier();
        let note_callee = writer.note_callee();
        let tier_up_at_entry = writer.tier_up(code::tier_up_at_entry as *const (), None);
        let tier_up_in_loop = writer.tier_up(code::tier_up_in_loop as *const (), Some(SLOT));

        let bytes = writer.masm.finish().expect("the stubs are small");
        let code = link(&bytes, Priority::Required, |_| unreachable!())?;
        code.set_routines(&bytes, &writer.bare_frames);
        code.describe(|| "wasm stubs".into());
        let address = |label| code.address(bytes.offset_of(label));
        Ok(Self {
            for_compilers: Stubs {
                operations: operations.map(address),
                traps: traps.map(address),
                move_bytes: operations::move_bytes as *const () as usize,
                fill_bytes: operations::fill_bytes as *const () as usize,
                check_entry: address(check_entry),
                poll: address(poll),
                write_barrier: address(write_barrier),
                note_callee: address(note_callee),
                tier_up_at_entry: address(tier_up_at_entry),
                tier_up_in_loop: address(tier_up_in_loop),
            },
            enter: address(enter),
            end_of_enter: address(end_of_enter),
            leave_entry: address(leave_entry),
            host_call: address(host_call),
            end_of_host_call: address(end_of_host_call),
            native_call: address(native_call),
            compile_lazily: address(compile_lazily),
            resume: address(resume),
            trap: address(trap),
            _code: code,
        })
    }
}

struct Writer<'a> {
    masm: MacroAssembler,
    host: &'a HostLayout,
    exits: Exits,
    /// Those whose header is not filled in.
    bare_frames: NativeFrames,
}

#[derive(Clone, Copy)]
struct Exits {
    trap: Label,
    /// As `fail`, when the header of the frame is not filled in.
    fail_in_bare_frame: Label,
    /// Takes a [`Failure`] in [`FAILURE`] and needs [`INSTANCE`].
    fail: Label,
}

impl Deref for Writer<'_> {
    type Target = MacroAssembler;

    fn deref(&self) -> &MacroAssembler {
        &self.masm
    }
}

impl DerefMut for Writer<'_> {
    fn deref_mut(&mut self) -> &mut MacroAssembler {
        &mut self.masm
    }
}

fn registers(gprs: &[Gpr], fprs: &[Fpr]) -> impl Iterator<Item = Reg> {
    let gprs = gprs.iter().map(|&reg| Reg::from(reg));
    gprs.chain(fprs.iter().map(|&reg| Reg::from(reg)))
}

impl Writer<'_> {
    fn start(&mut self) -> Label {
        self.align(16, 15);
        self.here()
    }

    fn call_native(&mut self, function: *const ()) {
        self.move64(TEMP, function.expose_provenance());
        self.call_indirect(TEMP);
    }

    fn call_fallible(&mut self, function: *const ()) {
        self.call_native(function);
        (self.masm).branch_if_not_zero64(FAILURE, self.exits.fail);
    }

    fn load_runtime_data(&mut self, dst: Gpr) {
        let place = Address::new(INSTANCE, InstanceLayout::runtime_data(self.host));
        self.load64(dst, place);
    }

    fn load_vm(&mut self, dst: Gpr) {
        let place = Address::new(INSTANCE, InstanceLayout::vm(self.host));
        self.load64(dst, place);
    }

    fn load_memory_base(&mut self) {
        let place = Address::new(INSTANCE, InstanceLayout::memory_base(self.host));
        self.load64(MEMORY_BASE, place);
    }

    fn fill_in_header(&mut self) {
        self.store64(Address::new(FP, frame::INSTANCE), INSTANCE);
        self.store64(Address::new(FP, frame::CALLEE), STUB_CALLEE);
    }

    fn tell_host_of_frame(&mut self) {
        self.fill_in_header();
        self.load_vm(TEMP);
        let top_frame = Address::new(TEMP, self.host.vm_top_frame);
        self.store64(top_frame, FP);
    }

    fn enter_frame_of_stub(&mut self, is_bare: bool) {
        match is_bare {
            true => self.bare_frames.enter(&mut self.masm),
            false => self.enter_frame(),
        }
    }

    fn leave_frame_of_stub(&mut self, is_bare: bool) {
        match is_bare {
            true => self.bare_frames.leave(&mut self.masm),
            false => self.leave_frame(),
        }
    }

    fn operation(&mut self, conduct: Conduct, function: *const ()) -> Label {
        let start = self.start();
        if conduct == Conduct::Succeeds {
            self.load_runtime_data(ARGUMENT[0]);
            self.move64(TEMP, function.expose_provenance());
            self.jump_indirect(TEMP);
            return start;
        }
        let is_bare = conduct != Conduct::CallsHost;
        self.enter_frame_of_stub(is_bare);
        if !is_bare {
            self.tell_host_of_frame();
        }
        self.load_runtime_data(ARGUMENT[0]);
        self.call_native(function);
        (self.masm).branch_if_not_zero64(FAILURE, self.exits.fail_in_bare_frame);
        self.leave_frame_of_stub(is_bare);
        self.ret();
        start
    }

    fn trap(&mut self, trap: Trap) -> Label {
        let start = self.here();
        #[cfg(target_arch = "x86_64")]
        self.pop(ARGUMENT[2]);
        #[cfg(target_arch = "aarch64")]
        self.move64(ARGUMENT[2], bun_engine_asm::arm64::LR);
        self.move32(ARGUMENT[1], Failure::trap(trap).word());
        self.masm.jump(self.exits.trap);
        start
    }

    fn raise(&mut self) {
        let exits = self.exits;
        // Nothing goes on in the frame, and the stack pointer may be beyond the limit.
        self.bind(exits.trap);
        self.load64(INSTANCE, Address::new(FP, frame::INSTANCE));
        self.compute_address(SP, Address::new(FP, -HEADER_SIZE));
        self.push_pair(FP, ARGUMENT[2]);
        self.move64(FP, SP);
        self.move64(FAILURE, ARGUMENT[1]);

        self.bind(exits.fail_in_bare_frame);
        self.fill_in_header();

        self.bind(exits.fail);
        self.move64(ARGUMENT[1], FAILURE);
        self.move64(ARGUMENT[2], FP);
        self.load_runtime_data(ARGUMENT[0]);
        self.call_native(frames::raise as *const ());
        let [fp, address] = abi::RETURN_GPRS;
        self.move64(FP, fp);
        self.load_vm(abi::VM);
        self.load_tags();
        self.jump_indirect(address);
    }

    fn resume(&mut self) -> Label {
        let resumption = Address::new(TEMP, Instance::RESUMPTION);
        let start = self.start();
        self.load64(INSTANCE, Address::new(FP, frame::INSTANCE));
        self.load_memory_base();
        self.load_runtime_data(TEMP);
        self.load64(RESULT, resumption.plus(Resumption::STACK_POINTER));
        self.move64(SP, RESULT);
        self.jump_indirect(resumption.plus(Resumption::ADDRESS));
        start
    }

    fn store_values(&mut self, gprs: &[Gpr], fprs: &[Fpr], area: Address) {
        for reg in registers(gprs, fprs) {
            let place = area.plus(Registers::offset(reg));
            self.store_registers(RegisterSet::EMPTY.with(reg), 16, place);
        }
    }

    fn load_values(&mut self, gprs: &[Gpr], fprs: &[Fpr], area: Address) {
        for reg in registers(gprs, fprs) {
            let place = area.plus(Registers::offset(reg));
            self.load_registers(RegisterSet::EMPTY.with(reg), 16, place);
        }
    }

    fn enter(&mut self) -> (Label, Label) {
        let function = Address::new(FP, EntryFrame::FUNCTION);
        let values = Address::new(FP, EntryFrame::VALUES);
        let callable = Address::new(TEMP, self.host.function_callable);
        let stack_bytes = callable.plus(size_of::<Callable>() as i32);
        // Takes the function in `TEMP`, and leaves the stack pointer for the call in `dst`.
        let find_place = |writer: &mut Self, dst| {
            writer.load64(INSTANCE, callable.plus(Callable::INSTANCE));
            writer.compute_address(dst, values.plus(-HEADER_SIZE));
            writer.sub64(dst, dst, stack_bytes);
        };
        let transfer = |writer: &mut Self, function| {
            let callee_frame = Address::new(SP, frame::CALLEE_FRAME_FROM_STACK_POINTER);
            writer.load_runtime_data(ARGUMENT[0]);
            writer.move64(ARGUMENT[1], FP);
            writer.compute_address(ARGUMENT[2], values);
            writer.compute_address(ARGUMENT[3], callee_frame);
            writer.call_fallible(function);
        };
        let no_stack = self.new_label();

        let start = self.start();
        self.enter_frame();
        self.load64(TEMP, Address::new(FP, frame::CALLEE));
        find_place(self, ARGUMENT[3]);
        self.store64(Address::new(FP, frame::INSTANCE), INSTANCE);
        self.store64(Address::new(FP, frame::CALLEE), ENTRY_CALLEE);
        let limit = Address::new(INSTANCE, InstanceLayout::stack_limit(self.host));
        self.branch64(Cond::Below, ARGUMENT[3], limit, no_stack);
        self.move64(SP, ARGUMENT[3]);
        self.store64(function, TEMP);
        transfer(self, call::put_arguments as *const ());
        self.load_values(ARGUMENT_GPRS, ARGUMENT_FPRS, values);
        self.load64(TEMP, function);
        self.load64(SLOT, callable.plus(Callable::SLOT));
        self.load_memory_base();
        self.call_indirect(Address::new(SLOT, FunctionSlot::ENTRY));
        let end = self.here();
        self.load64(TEMP, function);
        find_place(self, ARGUMENT[3]);
        self.move64(SP, ARGUMENT[3]);
        self.store_values(RESULT_GPRS, RESULT_FPRS, values);
        transfer(self, call::take_results as *const ());
        self.load_vm(abi::VM);
        self.load_tags();
        self.leave_frame();
        self.ret();

        self.bind(no_stack);
        let failure = Failure::trap(Trap::StackOverflow);
        self.move32(FAILURE, failure.word());
        self.masm.jump(self.exits.fail);
        (start, end)
    }

    /// With anything but zero.
    fn leave_entry(&mut self) -> Label {
        let start = self.start();
        self.move32(RESULT, NULL);
        self.leave_frame();
        self.ret();
        start
    }

    fn host_call(&mut self) -> (Label, Label) {
        let slot = Address::new(FP, ExitFrame::SLOT);
        let values = slot.plus(-Registers::SIZE);
        let transfer = |writer: &mut Self, function| {
            writer.load_runtime_data(ARGUMENT[0]);
            writer.load64(ARGUMENT[1], slot);
            writer.move64(ARGUMENT[2], SP);
            writer.move64(ARGUMENT[3], FP);
            writer.call_fallible(function);
        };
        let [give_results, start_over] = [(); 2].map(|()| self.new_label());
        let start = self.start();
        self.enter_frame();
        self.fill_in_header();
        self.compute_address(SP, values);
        self.store64(slot, SLOT);
        self.store_values(ARGUMENT_GPRS, ARGUMENT_FPRS, values);
        transfer(self, call::call_host as *const ());
        self.branch_if_not_zero64(RESULT, start_over);
        self.bind(give_results);
        self.load_values(RESULT_GPRS, RESULT_FPRS, values);
        self.leave_frame();
        self.ret();

        self.bind(start_over);
        self.load_values(ARGUMENT_GPRS, ARGUMENT_FPRS, values);
        self.load64(SLOT, slot);
        self.leave_frame();
        self.jump_indirect(Address::new(SLOT, FunctionSlot::ENTRY));

        let end = self.start();
        self.load64(INSTANCE, Address::new(FP, frame::INSTANCE));
        self.load_memory_base();
        self.compute_address(SP, values);
        self.move64(abi::ARGUMENT_GPRS[4], RESULT);
        transfer(self, call::put_results as *const ());
        self.jump(give_results);
        (start, end)
    }

    fn native_call(&mut self) -> Label {
        let start = self.start();
        self.enter_frame();
        self.tell_host_of_frame();
        self.move64(ARGUMENT[3], INSTANCE);
        self.call_indirect(Address::new(SLOT, Import::HOST_DATA - Import::STUB));
        (self.masm).branch_if_not_zero64(FAILURE, self.exits.fail);
        self.leave_frame();
        self.ret();
        start
    }

    /// The general registers, and where the others are. Offsets are aligned, so no scratch register is needed.
    fn places_for(saved: RegisterSet) -> [(RegisterSet, Address); 2] {
        let gprs = saved.in_bank(Bank::Gpr);
        let vectors_start = (gprs.len() * 8).next_multiple_of(16) as i32;
        [
            (gprs, Address::new(SP, 0)),
            (saved - gprs, Address::new(SP, vectors_start)),
        ]
    }

    fn save(&mut self, saved: RegisterSet) {
        let places @ [_, (vectors, vectors_start)] = Self::places_for(saved);
        self.sub64(SP, SP, vectors_start.offset() + vectors.len() as i32 * 16);
        for (registers, place) in places {
            self.store_registers(registers, 16, place);
        }
    }

    fn enter_frame_saving(&mut self, saved: RegisterSet, is_bare: bool) -> Label {
        let start = self.start();
        self.enter_frame_of_stub(is_bare);
        self.save(saved);
        start
    }

    fn leave_frame_restoring(&mut self, saved: RegisterSet, is_bare: bool) {
        for (registers, place) in Self::places_for(saved) {
            self.load_registers(registers, 16, place);
        }
        self.leave_frame_of_stub(is_bare);
    }

    fn compile_lazily(&mut self) -> Label {
        let saved = RegisterSet::of(ARGUMENT_GPRS, ARGUMENT_FPRS).with(SLOT.into());
        let start = self.enter_frame_saving(saved, false);
        self.fill_in_header();
        self.load_runtime_data(ARGUMENT[0]);
        self.move64(ARGUMENT[1], SLOT);
        self.move64(ARGUMENT[2], FP);
        self.call_fallible(code::compile_lazily as *const ());
        self.leave_frame_restoring(saved, false);
        self.jump_indirect(Address::new(SLOT, FunctionSlot::ENTRY));
        start
    }

    /// The caller has left no room for a header.
    fn check_entry(&mut self) -> Label {
        let saved = RegisterSet::of(ARGUMENT_GPRS, ARGUMENT_FPRS);
        let saved = saved.with(SLOT.into()).with(TEMP.into());
        let start = self.start();
        self.sub64(SP, SP, HEADER_SIZE);
        if cfg!(target_arch = "x86_64") {
            self.transfer64(Address::new(SP, 0), Address::new(SP, HEADER_SIZE));
        }
        self.enter_frame();
        self.save(saved);
        self.fill_in_header();
        self.load_runtime_data(ARGUMENT[0]);
        self.move64(ARGUMENT[1], FP);
        self.call_fallible(interrupts::check_entry as *const ());
        if cfg!(target_arch = "x86_64") {
            self.transfer64(Address::new(FP, 8 + HEADER_SIZE), Address::new(FP, 8));
        }
        self.leave_frame_restoring(saved, false);
        self.add64(SP, SP, HEADER_SIZE);
        self.ret();
        start
    }

    fn poll(&mut self) -> Label {
        let terminate = self.new_label();
        let start = self.enter_frame_saving(CHANGED_BY_CALLS, true);
        self.load_runtime_data(ARGUMENT[0]);
        self.call_native(interrupts::must_terminate as *const ());
        self.branch_if_not_zero64(RESULT, terminate);
        self.leave_frame_restoring(CHANGED_BY_CALLS, true);
        self.ret();

        self.bind(terminate);
        self.load_pair64(TEMP, ARGUMENT[2], Address::new(FP, 0));
        self.move64(FP, TEMP);
        self.move32(ARGUMENT[1], Failure::TERMINATED.word());
        self.masm.jump(self.exits.trap);
        start
    }

    fn write_barrier(&mut self) -> Label {
        let start = self.enter_frame_saving(CHANGED_BY_CALLS, true);
        self.load_runtime_data(ARGUMENT[0]);
        self.move64(ARGUMENT[1], SLOT);
        self.call_native(operations::write_barrier as *const ());
        self.leave_frame_restoring(CHANGED_BY_CALLS, true);
        self.ret();
        start
    }

    fn note_callee(&mut self) -> Label {
        let seen = Address::new(PROFILE, CallProfile::SLOT);
        let first = self.new_label();
        let second = self.enter_frame_saving(CHANGED_BY_CALLS, true);
        self.load_runtime_data(ARGUMENT[0]);
        self.move64(ARGUMENT[1], PROFILE);
        self.call_native(code::note_second_callee as *const ());
        self.leave_frame_restoring(CHANGED_BY_CALLS, true);

        let start = self.here();
        // Other threads change the word, so it is read once.
        let scratch = self.scratch();
        let word = scratch.gprs[0].expect("a scratch register");
        let gprs = [None; 2];
        self.set_scratch(Scratch { gprs, ..scratch });
        self.load64(word, seen);
        self.branch_if_zero64(word, first);
        self.branch_test_bit64(TestCond::Zero, word, 0, second);
        self.move64(PROFILE, word);
        self.set_scratch(scratch);
        for index in 0..Callees::COUNT {
            let [hit, next] = [(); 2].map(|()| self.new_label());
            let offset = (index * CallProfile::SIZE) as i32 - Callees::TAG as i32;
            let slot = Address::new(PROFILE, offset + CallProfile::SLOT);
            let count = Address::new(PROFILE, offset + CallProfile::COUNT);
            self.branch64(Cond::Eq, slot, SLOT, hit);
            self.branch_if_not_zero64(slot, next);
            self.store64(slot, SLOT);
            self.bind(hit);
            self.add32_to_memory(count, 1);
            self.ret();
            self.bind(next);
        }
        self.ret();
        self.bind(first);
        self.store64(seen, SLOT);
        self.ret();
        start
    }

    /// `function` gets the instance, the frame pointer of the caller, the return address and [`SLOT`].
    fn tier_up(&mut self, function: *const (), result: Option<Gpr>) -> Label {
        let saved = CHANGED_BY_CALLS - result.into_iter().collect();
        let start = self.enter_frame_saving(saved, true);
        self.load_runtime_data(ARGUMENT[0]);
        self.load_pair64(ARGUMENT[1], ARGUMENT[2], Address::new(FP, 0));
        self.move64(ARGUMENT[3], SLOT);
        self.call_native(function);
        if let Some(result) = result {
            self.move64(result, RESULT);
        }
        self.leave_frame_restoring(saved, true);
        self.ret();
        start
    }
}

const _: () = assert!(Registers::SIZE % 16 == 0);
