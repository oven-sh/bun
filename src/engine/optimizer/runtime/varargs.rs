//! Makes the frame for a call whose arguments come from lists.

use core::mem::offset_of;

use bun_engine_bytecode::Specialization;
use bun_engine_macros::native_abi;
use bun_engine_vm::call::MAX_ARGUMENTS;
use bun_engine_vm::{
    CallFrame, Cx, Value, Vm, argument_list_length, load_argument_list, load_spread_arguments,
    spread_argument_count,
};

use super::operations::{Target, find_target, realm_of_caller};
use crate::graph::Lists;

/// What the code has put at the bottom of its frame. The parts follow, the last first.
#[repr(C)]
pub(crate) struct Operands {
    callee: u64,
    this: u64,
}

/// What is known when the code is compiled.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(crate) struct Form(pub(crate) u64);

impl Operands {
    pub(super) const OFFSET_OF_CALLEE: usize = offset_of!(Operands, callee);
    pub(super) const OFFSET_OF_THIS: usize = offset_of!(Operands, this);
}

impl Form {
    pub(super) const LISTS_SHIFT: u8 = 32;
    pub(super) const PARTS_SHIFT: u8 = 1;
    pub(super) const CONSTRUCTS: i32 = Specialization::Construct as i32;

    pub(crate) fn new(lists: u32, parts: u32, specialization: Specialization) -> Self {
        let (lists, parts) = (u64::from(lists), u64::from(parts));
        Self(lists << Self::LISTS_SHIFT | parts << Self::PARTS_SHIFT | specialization as u64)
    }

    fn lists(self) -> Lists {
        Lists::from_data((self.0 >> Self::LISTS_SHIFT) as u32)
    }

    /// # Safety
    /// They are for a call of this form.
    unsafe fn parts(self, operands: &Operands) -> &[Option<Value>] {
        let count = (self.0 as u32 >> Self::PARTS_SHIFT) as usize;
        // SAFETY: the caller's.
        unsafe { core::slice::from_raw_parts(core::ptr::from_ref(operands).add(1).cast(), count) }
    }
}

fn count(frame: &CallFrame, lists: Lists, parts: &[Option<Value>]) -> usize {
    match (lists.skip_in_list, parts[0]) {
        (Some(skip), Some(list)) => parts.len() - 1 + argument_list_length(list, skip),
        _ => spread_argument_count(parts, frame.rest(lists.skip_in_frame as usize)),
    }
}

/// Where the new frame starts, which is below the operands, or zero if it threw.
#[native_abi]
pub(super) unsafe fn size(vm: &Vm, frame: &CallFrame, operands: &Operands, form: Form) -> usize {
    // SAFETY: the code passes what belongs together.
    let count = count(frame, form.lists(), unsafe { form.parts(operands) });
    let words = (CallFrame::HEADER_WORDS + count.min(MAX_ARGUMENTS) + 1).next_multiple_of(2);
    let new_frame = (core::ptr::from_ref(operands).addr()).saturating_sub(words * size_of::<u64>());
    if count > MAX_ARGUMENTS || new_frame < vm.soft_stack_limit() {
        // SAFETY: called from there.
        let _ = unsafe { realm_of_caller(vm) }.throw_stack_overflow();
        return 0;
    }
    new_frame
}

#[native_abi]
pub(super) unsafe fn fill(
    vm: &Vm,
    frame: &CallFrame,
    operands: &Operands,
    form: Form,
    new_frame: *mut u64,
) -> Target {
    // SAFETY: as above. Nothing has run since the frame was sized, and the stack pointer is below it.
    unsafe {
        let (lists, parts) = (form.lists(), form.parts(operands));
        let count = count(frame, lists, parts);
        let arguments = new_frame.byte_add(CallFrame::OFFSET_OF_ARGUMENTS).cast();
        let arguments = core::slice::from_raw_parts_mut(arguments, count);
        let forwarded = frame.rest(lists.skip_in_frame as usize);
        if let (Some(skip), Some(list)) = (lists.skip_in_list, parts[0]) {
            let (single, rest) = arguments.split_at_mut(parts.len() - 1);
            load_spread_arguments(&parts[1..], forwarded, single);
            let global = frame.code_block().expect("optimized code").global();
            load_argument_list(&Cx::from_global(global).no_gc(), list, skip, rest);
        } else {
            load_spread_arguments(parts, forwarded, arguments);
        }
        let header = [operands.callee, count as u64 + 1, operands.this];
        (new_frame
            .byte_add(CallFrame::OFFSET_OF_CALLEE)
            .cast::<[u64; 3]>())
        .write(header);
        find_target(vm, &*new_frame.cast(), form.0 as u32 & 1)
    }
}
