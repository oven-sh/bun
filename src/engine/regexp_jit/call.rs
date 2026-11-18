//! Calls of the functions that help, which leave all registers but one as they are.

use bun_engine_asm::prelude::*;
use bun_engine_regexp::helper;
use bun_engine_unicode::IgnoreCase;

use crate::OUT_OF_MEMORY;
use crate::frame::{CONSTANT, END, Location, POSITION};
use crate::generator::Generator;

#[derive(Clone, Copy)]
pub(crate) enum Helper {
    /// Sets the fuel.
    Poll,
    /// The same where the start of the attempt has been saved.
    PollInAttempt,
    /// Sets the top of the stack, and overwrites the first two temporary registers.
    GrowStack,
    /// Sets the first temporary register.
    GrowCells,
    /// Compares the first two temporary registers, and sets the first.
    EqualIgnoringCase,
}

const HELPERS: [Helper; 5] = [
    Helper::Poll,
    Helper::PollInAttempt,
    Helper::GrowStack,
    Helper::GrowCells,
    Helper::EqualIgnoringCase,
];

#[derive(Default)]
pub(crate) struct Stubs([Option<Label>; HELPERS.len()]);

const RETURN_ADDRESS: Gpr = CONSTANT;

impl Generator<'_> {
    /// Returns where to go to make the call, and the label to bind where it comes back.
    pub(crate) fn call_out_of_line(&mut self, helper: Helper) -> (Label, Label) {
        let back = self.masm.new_label();
        let stub = *self.stubs.0[helper as usize].get_or_insert_with(|| self.masm.new_label());
        let call = self.defer(move |generator| {
            generator.masm.move_label_address(RETURN_ADDRESS, back);
            generator.masm.jump(stub);
        });
        (call, back)
    }

    pub(crate) fn write_stubs(&mut self) {
        for helper in HELPERS {
            if let Some(stub) = self.stubs.0[helper as usize] {
                self.masm.bind(stub);
                self.write_stub(helper);
            }
        }
    }

    /// The address while a call is being made.
    fn during_call(address: Address) -> Address {
        match address.base() {
            abi::STACK_POINTER => Address::new(
                abi::FRAME_POINTER,
                2 * MacroAssembler::PUSH_SIZE + address.offset(),
            ),
            _ => address,
        }
    }

    fn argument(location: Location) -> Argument {
        match location {
            Location::Register(register) => register.into(),
            Location::Memory(address) => Argument::Load64(Self::during_call(address)),
        }
    }

    fn context_argument(&self) -> Argument {
        Self::argument(self.frame.context.expect("the frame keeps the context"))
    }

    fn poll(&mut self, attempt: Argument) {
        let fuel = self.frame.fuel.expect("the code is metered");
        let description = helper::describe(self.program.work_per_unit(), self.passes_vectors);
        let (function, last) = match self.program.counts_turns() {
            false => (helper::poll as *const (), END.into()),
            true => (
                helper::poll_racing as *const (),
                self.frame.turns.map_or(Argument::Imm(0), Self::argument),
            ),
        };
        let description = match self.frame.saved_work {
            None => Argument::Imm(description as i64),
            Some(saved) => {
                self.masm.shl64(saved, saved, helper::SHIFT_OF_SAVED_WORK);
                self.holding_constant(|it| it.masm.or64(saved, saved, description as u32 as i32));
                saved.into()
            }
        };
        let arguments = [
            self.context_argument(),
            fuel.into(),
            POSITION.into(),
            attempt,
            description,
            last,
        ];
        self.call(function, &arguments, fuel);
        self.holding_constant(Self::forget_what_is_reported);
        let ends = self.masm.new_label();
        self.masm.branch64(Cond::Lt, fuel, 0, ends);
        self.masm.jump_indirect(RETURN_ADDRESS);
        self.masm.bind(ends);
        self.return_with(fuel);
    }

    fn write_stub(&mut self, helper: Helper) {
        let (first, second) = (self.frame.temporary(0), self.frame.temporary(1));
        match helper {
            Helper::Poll => self.poll(helper::NOWHERE.into()),
            Helper::PollInAttempt => match self.frame.cell(self.program.attempt().cell) {
                Location::Register(cell) => self.poll(cell.into()),
                Location::Memory(cell) => self.poll(Argument::Load32(Self::during_call(cell))),
            },
            Helper::GrowStack => {
                let stack = self.frame.stack.expect("the code has a stack");
                let words = stack.max_frame_words.into();
                let arguments = [self.context_argument(), stack.top.into(), words];
                self.call(helper::grow_stack as *const (), &arguments, stack.top);
                self.holding_constant(|generator| generator.find_moved_stack(stack));
                self.come_back_unless_zero(stack.top, OUT_OF_MEMORY);
            }
            Helper::GrowCells => {
                let words = self
                    .frame
                    .words_in_context
                    .expect("the context has the cells");
                let arguments = [self.context_argument(), words.into()];
                self.call(helper::grow_cells as *const (), &arguments, first);
                self.come_back_unless_zero(first, OUT_OF_MEMORY);
            }
            Helper::EqualIgnoringCase => {
                let folds = self.program.case_equivalence() == IgnoreCase::CodePoints;
                let arguments = [first.into(), second.into(), u32::from(folds).into()];
                self.call(helper::equal_ignoring_case as *const (), &arguments, first);
                self.masm.jump_indirect(RETURN_ADDRESS);
            }
        }
    }

    fn call(&mut self, function: *const (), arguments: &[Argument], result: Gpr) {
        let mut kept: RegisterSet = abi::TEMPORARY_GPRS.into_iter().collect();
        kept.remove(result);
        kept.remove(RETURN_ADDRESS);
        let (masm, stack_pointer) = (&mut *self.masm, abi::STACK_POINTER);
        masm.push(RETURN_ADDRESS);
        masm.enter_frame();
        masm.sub64(
            stack_pointer,
            stack_pointer,
            (kept.len() * 8).next_multiple_of(16),
        );
        masm.and64(stack_pointer, stack_pointer, -16);
        masm.store_registers(kept, 8, Address::new(stack_pointer, 0));
        masm.move_arguments(arguments);
        masm.call_address(function.expose_provenance());
        // The register with the result can be among those that are loaded.
        masm.move64(RETURN_ADDRESS, abi::RETURN_GPRS[0]);
        masm.load_registers(kept, 8, Address::new(stack_pointer, 0));
        masm.move64(result, RETURN_ADDRESS);
        masm.leave_frame();
        masm.pop(RETURN_ADDRESS);
    }

    fn come_back_unless_zero(&mut self, result: Gpr, code: u32) {
        let gives_up = self.masm.new_label();
        self.masm.branch_if_zero64(result, gives_up);
        self.masm.jump_indirect(RETURN_ADDRESS);
        self.masm.bind(gives_up);
        self.return_with(code);
    }
}
