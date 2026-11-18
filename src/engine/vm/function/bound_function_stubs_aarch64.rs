//! Turn the frame of a bound function into one of its target.

use core::arch::naked_asm;

use bun_engine_bytecode::Specialization::{Call, Construct};
use bun_engine_macros::in_call_frame;

use crate::call::stubs::{native_call_entry, native_construct_entry};
use crate::{CallFrame, Executable, ImmutableArray, JsBoundFunction, JsFunction, Vm};

/// Neither the frame pointer nor the return address has been pushed.
const fn from_stack_pointer(offset: usize) -> usize {
    offset - CallFrame::LINKAGE_SIZE
}

/// `$load` puts what goes in the slot of `this` in `x4`, given the bound function in `x2` and its target in `x3`.
macro_rules! entry {
    ($name:ident, $specialization:expr, $native:ident, [$($load:literal),*] $(, $operand:ident = $value:expr)*) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "C" fn $name() {
            naked_asm!(
                "ldr x2, [sp, #{callee}]",
                "ldrb w0, [x2, #{forwarded}]",
                "ldr x3, [x2, #{target}]",
                $($load,)*
                "cbnz w0, 3f",
                "2:",
                "str x4, [sp, #{this}]",
                "ldr x9, [x3, #{executable}]",
                "ldr x10, [x9, #{code_block_of_executable}]",
                "stp x10, x3, [sp, #{code_block}]",
                "ldr x16, [x9, #{entry}]",
                "br x16",
                "3:",
                "ldr x10, [x21, #{limit}]",
                "mov x11, sp",
                "cmp w0, #{max}",
                // Clears the carry if there are more.
                "ccmp x11, x10, #0, ls",
                "b.lo 4f",
                "ldr w5, [sp, #{count}]",
                "cmp w5, #{max_moved}",
                "b.ls 5f",
                "4:",
                "b {native}",
                "5:",
                // The header moves down by an even number of words.
                "tbz w0, #0, 8f",
                "add x6, sp, #{first}",
                "sub w7, w5, #1",
                "cbz w7, 7f",
                "6:",
                "ldr x10, [x6], #8",
                "stur x10, [x6, #-16]",
                "sub w7, w7, #1",
                "cbnz w7, 6b",
                "7:",
                "sub x11, x11, #8",
                "8:",
                "sub x11, x11, x0, lsl #3",
                "mov sp, x11",
                "add w5, w5, w0",
                "str x5, [sp, #{count}]",
                "add x6, x2, #{arguments}",
                "add x7, sp, #{first}",
                "cmp w0, #{max_inline}",
                "b.ls 9f",
                "ldr x6, [x6]",
                "add x6, x6, #{elements}",
                "9:",
                "ldr x10, [x6], #8",
                "str x10, [x7], #8",
                "sub w0, w0, #1",
                "cbnz w0, 9b",
                "b 2b",
                code_block = const from_stack_pointer(CallFrame::OFFSET_OF_CODE_BLOCK),
                callee = const from_stack_pointer(CallFrame::OFFSET_OF_CALLEE),
                count = const from_stack_pointer(CallFrame::OFFSET_OF_ARGUMENT_COUNT),
                this = const from_stack_pointer(CallFrame::OFFSET_OF_THIS),
                first = const from_stack_pointer(CallFrame::OFFSET_OF_ARGUMENTS),
                forwarded = const JsBoundFunction::offset_of_forwarded_arguments($specialization),
                target = const JsBoundFunction::OFFSET_OF_TARGET,
                arguments = const JsBoundFunction::OFFSET_OF_ARGUMENTS,
                max = const JsBoundFunction::MAX_FORWARDED_ARGUMENTS,
                max_moved = const JsBoundFunction::MAX_MOVED_ARGUMENTS,
                max_inline = const JsBoundFunction::MAX_INLINE_ARGUMENTS,
                elements = const ImmutableArray::OFFSET_OF_ELEMENTS,
                executable = const JsFunction::OFFSET_OF_EXECUTABLE,
                code_block_of_executable = const Executable::offset_of_code_block($specialization),
                entry = const Executable::offset_of_entry($specialization),
                limit = const Vm::OFFSET_OF_REAL_STACK_LIMIT,
                native = sym $native,
                $($operand = const $value,)*
            )
        }
    };
}

entry!(
    call,
    Call,
    native_call_entry,
    ["ldr x4, [x2, #{bound_this}]"],
    bound_this = JsBoundFunction::OFFSET_OF_BOUND_THIS
);
entry!(
    construct,
    Construct,
    native_construct_entry,
    ["ldr x4, [sp, #{this}]", "cmp x4, x2", "csel x4, x3, x4, eq"]
);
