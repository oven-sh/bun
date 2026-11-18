//! The frames of loops. A frame has the cells, then the captures, then the position.

use bun_engine_asm::prelude::*;
use bun_engine_regexp::Context;
use bun_engine_regexp::program::Loop;

use crate::call::Helper;
use crate::frame::{Location, POSITION, Stack};
use crate::generator::Generator;

/// More than that are copied whether they are used or not.
const CELLS_LOOKED_AT: usize = 24;

#[derive(Clone, Copy, PartialEq)]
enum Transfer {
    ToStack,
    FromStack,
}

impl<'a> Generator<'a> {
    fn stack(&self) -> Stack {
        self.frame.stack.expect("the survey has seen the operation")
    }

    pub(crate) fn load_stack_limit(&mut self, stack: Stack, context: Gpr) {
        let limit = self.frame.temporary(1);
        let end = Address::new(context, Context::OFFSET_OF_STACK_END as i32);
        self.masm.load64(limit, end);
        self.masm.sub64(limit, limit, stack.max_frame_words * 4);
        self.masm.store64(stack.limit, limit);
    }

    pub(crate) fn find_moved_stack(&mut self, stack: Stack) {
        let context = self.context_in_register(self.frame.temporary(0));
        self.load_stack_limit(stack, context);
        if let Some(copy) = stack.start {
            let start = self.frame.temporary(1);
            let address = Address::new(context, Context::OFFSET_OF_STACK_START as i32);
            self.masm.load64(start, address);
            self.masm.store64(copy, start);
        }
    }

    pub(crate) fn push(&mut self, it: &'a Loop) {
        let stack = self.stack();
        let (grow, grown) = self.call_out_of_line(Helper::GrowStack);
        self.masm.branch64(Cond::Gt, stack.top, stack.limit, grow);
        self.masm.bind(grown);
        let only_position = self.masm.new_label();
        if it.first_frame_is_short() {
            self.compare_number(Cond::Eq, it.turns_cell(), 0, only_position);
            if it.work_of_frame() != 0 {
                self.spend(it.work_of_frame());
            }
            self.transfer_frame(it, Transfer::ToStack);
            (self.masm).add64(stack.top, stack.top, (it.frame_size() - 1) * 4);
            self.masm.bind(only_position);
            self.masm.store32(Address::new(stack.top, 0), POSITION);
            self.masm.add64(stack.top, stack.top, 4);
        } else {
            self.transfer_frame(it, Transfer::ToStack);
            let size = it.frame_size() as i32 * 4;
            self.masm
                .store32(Address::new(stack.top, size - 4), POSITION);
            self.masm.add64(stack.top, stack.top, size);
        }
        self.add_to_number(it.turns_cell(), 1);
    }

    pub(crate) fn pop(&mut self, it: &'a Loop) {
        let (stack, position) = (self.stack(), self.frame.temporary(0));
        self.masm
            .load32_signed64(position, Address::new(stack.top, -4));
        self.go_back_to(position, it.work_of_frame());
        self.add_to_number(it.turns_cell(), -1);
        let done = self.masm.new_label();
        if it.first_frame_is_short() {
            let first = self.defer(move |generator| {
                generator.masm.sub64(stack.top, stack.top, 4);
                if !it.pairs().is_empty() {
                    generator.clear(it.pairs());
                }
                generator.masm.jump(done);
            });
            self.compare_number(Cond::Eq, it.turns_cell(), 0, first);
        }
        self.masm.sub64(stack.top, stack.top, it.frame_size() * 4);
        self.transfer_frame(it, Transfer::FromStack);
        self.masm.bind(done);
    }

    /// The frame starts at the top of the stack.
    fn transfer_frame(&mut self, it: &Loop, transfer: Transfer) {
        let (cells, frame) = (it.cells(), Address::new(self.stack().top, 0));
        let in_frame = |cell: u32| frame.plus((cell - it.cells().start) as i32 * 4);
        if cells.len() > CELLS_LOOKED_AT {
            self.transfer_cells(in_frame(cells.start), cells.clone(), transfer);
        } else {
            let mut start = cells.start;
            for cell in cells.start..=cells.end {
                let is_in_memory = cell != cells.end
                    && self.frame.is_used(cell)
                    && matches!(self.frame.cell(cell), Location::Memory(_));
                if !is_in_memory {
                    self.transfer_cells(in_frame(start), start..cell, transfer);
                    start = cell + 1;
                }
            }
        }
        for &(cell, register) in self.frame.cell_registers() {
            match transfer {
                _ if !cells.contains(&cell) => {}
                Transfer::ToStack => self.masm.store32(in_frame(cell), register),
                Transfer::FromStack => self.masm.load32_signed64(register, in_frame(cell)),
            }
        }
        let entries = it.pairs().entries();
        let captures = self.capture_address(entries.start);
        self.transfer_words(in_frame(cells.end), captures, entries.len(), transfer);
    }

    fn transfer_cells(&mut self, frame: Address, cells: core::ops::Range<u32>, transfer: Transfer) {
        let home = self.frame.cells.plus(cells.start as i32 * 4);
        self.transfer_words(frame, home, cells.len(), transfer);
    }

    fn transfer_words(&mut self, frame: Address, home: Address, count: usize, transfer: Transfer) {
        match transfer {
            Transfer::ToStack => self.copy_words(frame, home, count),
            Transfer::FromStack => self.copy_words(home, frame, count),
        }
    }

    pub(crate) fn mark(&mut self, cell: u32) {
        let stack = self.stack();
        let start = stack.start.expect("the survey has seen the operation");
        let height = self.frame.temporary(0);
        self.masm.sub64(height, stack.top, start);
        match self.frame.cell(cell) {
            Location::Register(cell) => self.masm.move32(cell, height),
            Location::Memory(cell) => self.masm.store32(cell, height),
        }
    }

    pub(crate) fn cut(&mut self, cell: u32) {
        let stack = self.stack();
        let start = stack.start.expect("the survey has seen the operation");
        match self.frame.cell(cell) {
            Location::Register(cell) => self.masm.move32(stack.top, cell),
            Location::Memory(cell) => self.masm.load32(stack.top, cell),
        }
        self.masm.add64(stack.top, stack.top, start);
    }
}
